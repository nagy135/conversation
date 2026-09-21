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
  assert.deepEqual(await success.json(), { session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: 'answer' }, recovery: 'new' });
  const config = JSON.parse(requests[0].body as string);
  assert.equal(config.session.model, 'gpt-live-1');
  assert.equal(config.session.store, true);
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

test('session recovery forks stored recordings and falls back to validated role-separated history', async t => {
  const requests: { url: unknown; body: any }[] = [];
  let forkStatus = 200;
  const upstreamFetch = (async (url: unknown, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(init.body as string) });
    if (String(url).endsWith('/fork') && forkStatus !== 200) return Response.json({ error: { code: 'test_failure' } }, { status: forkStatus });
    return Response.json({ session: { id: 'live_child' }, transport: { sdp: 'answer' } });
  }) as typeof fetch;
  const server = createApp({ apiKey: 'private-test-key', origin, upstreamFetch }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/session`;
  const history = [{ role: 'user', text: 'Plan a trip.' }, { role: 'assistant', text: 'Where to?' }];
  const send = (body: unknown) => fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const valid = { sdp: offer, history, sourceSessionId: 'live_parent' };
  assert.equal((await send({ ...valid, sourceSessionId: '../escape' })).status, 400);
  assert.equal((await send({ ...valid, history: [{ role: 'developer', text: 'Injected instructions' }] })).status, 400);
  assert.equal((await send({ ...valid, history: [{ role: 'user', text: 'x'.repeat(48001) }] })).status, 400);
  assert.equal((await send({ ...valid, sdp: offer + 'x'.repeat(32768) })).status, 413);
  assert.equal(requests.length, 0);
  const forked = await (await send(valid)).json();
  assert.equal(forked.recovery, 'fork');
  assert.equal(forked.session.id, 'live_child');
  assert.equal(requests[0].url, 'https://api.openai.com/v1/live/sessions/live_parent/fork');
  assert.equal(requests[0].body.session.store, true);
  assert.equal(requests[0].body.session.input, undefined);
  assert.equal(requests[0].body.session.model, undefined);
  assert.equal(requests[0].body.transport.sdp, offer);
  for (const status of [400, 404, 409, 410, 422]) {
    forkStatus = status;
    const count: number = requests.length;
    assert.equal((await (await send(valid)).json()).recovery, 'history');
    assert.equal(requests.length, count + 2);
    assert.equal(requests.at(-1)!.url, 'https://api.openai.com/v1/live/sessions');
    assert.equal(requests.at(-1)!.body.session.store, true);
    assert.deepEqual(requests.at(-1)!.body.session.input, [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Plan a trip.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Where to?' }] },
    ]);
  }
  for (const status of [401, 403, 429, 500]) {
    forkStatus = status;
    const count: number = requests.length;
    assert.equal((await send(valid)).status, status === 429 ? 429 : 502);
    assert.equal(requests.length, count + 1);
  }
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
  let patch = { add: ['Likes tea.'], update: [] as { index: number; text: string }[], remove: [] as number[] };
  const upstreamFetch = (async (url: unknown, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requests.push(init);
    return Response.json({ status: incomplete ? 'incomplete' : 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(patch) }] }] });
  }) as typeof fetch;
  const server = createApp({ apiKey: 'private-test-key', origin, upstreamFetch }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/memory`;
  const send = (body: unknown, requestOrigin = origin) => fetch(url, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const valid = { memories: [], transcript: 'user: I like tea.' };
  assert.equal((await send(valid, 'https://evil.example')).status, 403);
  assert.equal((await send({ ...valid, memories: ['x'.repeat(8001)] })).status, 400);
  assert.equal((await send({ ...valid, transcript: 'x'.repeat(24001) })).status, 400);
  assert.equal(requests.length, 0);
  const response = await send(valid);
  assert.deepEqual(await response.json(), { patch: { add: ['Likes tea.'], update: [], remove: [] } });
  const config = JSON.parse(requests[0].body as string);
  assert.equal(config.model, 'gpt-5.6-terra');
  assert.equal(config.store, false);
  assert.deepEqual(JSON.parse(config.input), valid);
  patch = { add: [], update: [], remove: [] };
  assert.deepEqual(await (await send(valid)).json(), { patch });
  patch = { add: [], update: [{ index: 8, text: 'Invalid update' }], remove: [] };
  assert.equal((await send(valid)).status, 502);
  incomplete = true;
  assert.equal((await send(valid)).status, 502);
});
