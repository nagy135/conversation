import express from 'express';
import { memoryRouter } from './memory.ts';
import { fileURLToPath } from 'node:url';
import { createSessionConfig } from './session.ts';
import { readSessionError } from './session-error.ts';

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
    if (!req.is('application/sdp')) {
      res.status(415).json({ error: 'Expected a WebRTC audio offer.' }); return;
    }
    next();
  }, express.text({ type: 'application/sdp', limit: '32kb' }), async (req, res) => {
    if (typeof req.body !== 'string' || !req.body.startsWith('v=0') || !req.body.includes('m=audio')) {
      res.status(400).json({ error: 'Invalid audio connection offer.' }); return;
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
      const upstream = await upstreamFetch('https://api.openai.com/v1/live/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: createSessionConfig(), transport: { type: 'webrtc', sdp: req.body } }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!upstream.ok) {
        const failure = await readSessionError(upstream);
        console.error('Voice session rejected', { status: upstream.status, code: failure.code, requestId: failure.requestId });
        if (failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter);
        res.status(upstream.status === 429 ? 429 : 502).json({ error: failure.message }); return;
      }
      const result = await upstream.json();
      if (typeof result.session?.id !== 'string' || typeof result.transport?.sdp !== 'string') throw new Error('Invalid upstream response');
      res.json({ session: { id: result.session.id }, transport: { type: 'webrtc', sdp: result.transport.sdp } });
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
