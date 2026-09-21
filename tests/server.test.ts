import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';

const origin = 'https://conversation.infiniter.tech';
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
test('session proxy validates input, protects secrets, and preserves rate-limit guidance', async t => {
  const requests: RequestInit[] = [];
  let fail = false;
  const upstreamFetch = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return fail ? Response.json({ error: { code: 'rate_limit_exceeded', message: 'secret-upstream-text' } }, { status: 429, headers: { 'retry-after': '12' } })
      : Response.json({ session: { id: 'live_test', private: 'secret-field' }, transport: { sdp: 'answer' } });
  }) as typeof fetch;
  const server = createApp({ apiKey: 'private-test-key', origin, upstreamFetch }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (body = offer, requestOrigin: string | null = origin, type = 'application/sdp') => fetch(`${url}/api/session`, {
    method: 'POST', headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), 'Content-Type': type }, body,
  });
  assert.equal((await send(offer, 'https://evil.example')).status, 403);
  assert.equal((await send(offer, null)).status, 403);
  assert.equal((await send(offer, origin, 'text/plain')).status, 415);
  assert.equal((await send('broken')).status, 400);
  assert.equal((await send(offer + 'x'.repeat(33000))).status, 413);
  assert.equal(requests.length, 0);
  const success = await send();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await success.json(), { session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: 'answer' } });
  const config = JSON.parse(requests[0].body as string);
  assert.equal(config.session.model, 'gpt-live-1');
  assert.equal(config.session.store, false);
  assert.deepEqual(config.session.delegation.responses.tools, [{ type: 'web_search' }]);
  assert.equal(config.session.delegation.responses.tool_choice, 'auto');
  assert.equal(config.transport.sdp, offer);
  fail = true;
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '12');
  assert.doesNotMatch(await limited.text(), /secret-upstream-text|private-test-key/);
  for (let i = 0; i < 10; i++) await send();
  const bounded = await send();
  assert.equal(bounded.status, 429);
  assert.equal(requests.length, 12);
});

test('missing configuration is visible without leaking environment values', async t => {
  const server = createApp({ apiKey: '', origin }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ready: false });
  assert.equal((await fetch(`${url}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/sdp' }, body: offer })).status, 503);
});

test('memory proxy validates requests, uses Terra, and rejects incomplete summaries', async t => {
  const requests: RequestInit[] = [];
  let incomplete = false;
  const upstreamFetch = (async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requests.push(init);
    return Response.json({ status: incomplete ? 'incomplete' : 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Likes tea.' }] }] });
  }) as typeof fetch;
  const server = createApp({ apiKey: 'private-test-key', origin, upstreamFetch }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/memory`;
  const send = (body: unknown, requestOrigin = origin) => fetch(url, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const valid = { summary: '', transcript: 'user: I like tea.' };
  assert.equal((await send(valid, 'https://evil.example')).status, 403);
  assert.equal((await send({ ...valid, summary: 'x'.repeat(8001) })).status, 400);
  assert.equal((await send({ ...valid, transcript: 'x'.repeat(24001) })).status, 400);
  assert.equal(requests.length, 0);
  const response = await send(valid);
  assert.deepEqual(await response.json(), { summary: 'Likes tea.' });
  const config = JSON.parse(requests[0].body as string);
  assert.equal(config.model, 'gpt-5.6-terra');
  assert.equal(config.store, false);
  assert.deepEqual(JSON.parse(config.input), valid);
  incomplete = true;
  assert.equal((await send(valid)).status, 502);
});
