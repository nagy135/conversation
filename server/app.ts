import express from 'express';
import { memoryRouter } from './memory.ts';
import { fileURLToPath } from 'node:url';
import { createSessionConfig } from './session.ts';
import { readSessionError } from './session-error.ts';
import { validHistory, validSessionId } from './history.ts';

export function createApp({
  apiKey = process.env.OPENAI_API_KEY,
  origin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173',
  upstreamFetch = fetch,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(apiKey?.trim() ? 200 : 503).json({ ready: Boolean(apiKey?.trim()) });
  });
  // Bound session creation across this single-process demo instance.
  let attempts: number[] = [];
  let pending = 0;
  app.post('/api/session', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin !== origin) {
      res.status(403).json({ error: 'This endpoint only accepts requests from this app.' }); return;
    }
    if (!req.is('application/sdp') && !req.is('application/json')) {
      res.status(415).json({ error: 'Expected a WebRTC audio offer.' }); return;
    }
    next();
  }, express.text({ type: 'application/sdp', limit: '32kb' }), express.json({ limit: '384kb' }), async (req, res) => {
    const sdp = req.is('application/sdp') ? req.body : req.body?.sdp;
    const history = req.is('application/sdp') ? [] : req.body?.history ?? [];
    const sourceSessionId = req.is('application/sdp') ? null : req.body?.sourceSessionId ?? null;
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || !sdp.includes('m=audio')) {
      res.status(400).json({ error: 'Invalid audio connection offer.' }); return;
    }
    if (Buffer.byteLength(sdp) > 32768) {
      res.status(413).json({ error: 'Audio connection offer is too large.' }); return;
    }
    if (!validHistory(history)) {
      res.status(400).json({ error: 'Invalid conversation history.' }); return;
    }
    if (sourceSessionId !== null && !validSessionId(sourceSessionId)) {
      res.status(400).json({ error: 'Invalid saved session identifier.' }); return;
    }
    if (!apiKey?.trim()) {
      res.status(503).json({ error: 'The voice service is waiting for its API key.' }); return;
    }
    const now = Date.now();
    attempts = attempts.filter(time => now - time < 60_000);
    if (pending >= 3 || attempts.length >= 12) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many connection attempts. Please try again in a minute.' }); return;
    }
    attempts.push(now);
    pending++;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const config = createSessionConfig(history);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      const create = (path: string, session: object) => upstreamFetch(`https://api.openai.com/v1/live/sessions${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }),
        signal,
      });
      let recovery = sourceSessionId ? 'fork' : history.length ? 'history' : 'new';
      let upstream = sourceSessionId
        ? await create(`/${encodeURIComponent(sourceSessionId)}/fork`, { store: true, delegation: config.delegation })
        : await create('', config);
      // A recording may still be finalizing, expired, or come from an older non-stored session.
      // Do not hide authentication, quota, rate-limit, or transient service failures by retrying.
      if (sourceSessionId && [400, 404, 409, 410, 422].includes(upstream.status)) {
        await upstream.body?.cancel();
        recovery = history.length ? 'history' : 'new';
        upstream = await create('', config);
      }
      if (!upstream.ok) {
        const failure = await readSessionError(upstream);
        console.error('Voice session rejected', { status: upstream.status, code: failure.code, requestId: failure.requestId });
        if (failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter);
        res.status(upstream.status === 429 ? 429 : 502).json({ error: failure.message }); return;
      }
      const result = await upstream.json();
      if (typeof result.session?.id !== 'string' || typeof result.transport?.sdp !== 'string') throw new Error('Invalid upstream response');
      res.json({ session: { id: result.session.id }, transport: { type: 'webrtc', sdp: result.transport.sdp }, recovery });
    } catch {
      if (!res.destroyed) res.status(504).json({ error: 'The voice connection timed out or was interrupted. Please try again.' });
    } finally {
      pending--;
      res.off('close', disconnected);
    }
  });
  app.use('/api', memoryRouter(apiKey, origin, upstreamFetch));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url)), { dotfiles: 'deny' }));
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : error.status === 400 ? 400 : 500).json({ error: error.status === 413 ? 'Request is too large.' : error.status === 400 ? 'Invalid request.' : 'Something went wrong. Please try again.' });
  });
  return app;
}
