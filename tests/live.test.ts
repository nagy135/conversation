import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { LiveClient } from "../src/live/client";
import { LiveTranscripts } from "../src/live/transcripts";
import type { ServerEvent } from "../src/live/types";
import { CONVERSATION_KEY } from '../src/live/conversation';

function browserFixture(
  t: TestContext,
  delayedMicrophone = false,
  autoStart = true,
  savedMemory = '',
  savedConversation?: string,
) {
  const storage = new Map<string, string>();
  storage.set('conversation.memory.v1', JSON.stringify({ summary: savedMemory }));
  if (savedConversation) storage.set(CONVERSATION_KEY, savedConversation);
  const sent: Array<{
    type: string;
    event_id?: string;
    content?: string;
    delegation_id?: string | null;
    session?: object;
    item?: { output: string };
  }> = [];
  const requests: RequestInit[] = [];
  const track = {
    enabled: true,
    stopped: false,
    onended: null,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let releaseMicrophone = () => {};
  const microphone = delayedMicrophone
    ? new Promise<typeof stream>((resolve) => {
        releaseMicrophone = () => resolve(stream);
      })
    : Promise.resolve(stream);
  const channel = {
    readyState: "open",
    onopen: null as (() => void) | null,
    onmessage: null as ((message: { data: string }) => void) | null,
    onclose: null,
    onerror: null,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close() {
      this.readyState = "closed";
    },
  };
  const emit = (event: ServerEvent) =>
    channel.onmessage?.({ data: JSON.stringify(event) });
  class Peer extends EventTarget {
    connectionState = "new";
    iceGatheringState = "complete";
    localDescription: { sdp: string } | null = null;
    onconnectionstatechange = null;
    ontrack = null;
    addTrack() {}
    createDataChannel() {
      channel.readyState = "open";
      return channel;
    }
    async createOffer() {
      return { sdp: "v=0\r\nm=audio mock" };
    }
    async setLocalDescription(offer: { sdp: string }) {
      this.localDescription = offer;
    }
    async setRemoteDescription() {
      this.connectionState = "connected";
      channel.onopen?.();
      if (autoStart)
        emit({ type: "session.started" });
    }
    async getStats() {
      return new Map();
    }
    close() {
      this.connectionState = "closed";
    }
  }
  for (const [key, value] of Object.entries({
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia: () => microphone } },
    RTCPeerConnection: Peer,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      if (_input === '/api/memory') return Response.json({ patch: { add: [], update: [], remove: [] } });
      requests.push(init!);
      return Response.json({
        session: { id: `live_test_${requests.length}` },
        transport: { type: "webrtc", sdp: "v=0\r\nanswer" },
        recovery: JSON.parse(init!.body as string).sourceSessionId ? 'fork' : 'new',
      });
    },
  );
  const mockAudio = {
    srcObject: null,
    paused: false,
    pause() {
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
  };
  const audio = mockAudio as unknown as HTMLAudioElement;
  const client = new LiveClient();
  t.after(() => {
    client.dispose();
    emit({
      type: "session.closed",
      reason: "close_requested",
    });
  });
  const user = (text: string, start: number, end: number) =>
    emit({
      type: "session.input_transcript.delta",
      delta: text,
      start_ms: start,
      end_ms: end,
    });
  return { client, audio, track, sent, requests, emit, user, releaseMicrophone, storage };
}

test('startup waits for session readiness and acknowledged greeting, and greets once', async t => {
  const { client, audio, sent, emit } = browserFixture(t, false, false);
  await client.start(audio);
  assert.equal(client.getSnapshot().status, 'connecting');
  assert.equal(sent.length, 0);
  emit({ type: 'session.started' });
  emit({ type: 'session.started' });
  assert.equal(sent.length, 1);
  emit({ type: 'session.instructions.appended', client_event_id: 'wrong' });
  assert.equal(sent.length, 1);
  emit({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
  emit({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
  assert.deepEqual(sent.map(e => e.type), ['session.instructions.append', 'session.commentary.append']);
});

test('cancel while awaiting microphone permission releases the late track', async t => {
  const { client, audio, track, releaseMicrophone, requests } = browserFixture(t, true);
  const starting = client.start(audio);
  client.stop();
  releaseMicrophone();
  await starting;
  assert.equal(client.getSnapshot().status, 'idle');
  assert.equal(track.stopped, true);
  assert.equal(requests.length, 0);
});

test('stop silences immediately, waits for close, and continues with saved history', async t => {
  const { client, audio, track, sent, emit, user, requests } = browserFixture(t);
  await client.start(audio);
  user('Hello', 100, 300);
  client.stop();
  assert.equal(track.enabled, false);
  assert.equal(audio.paused, true);
  assert.equal(client.getSnapshot().status, 'closing');
  assert.equal(sent.at(-1)?.type, 'session.close');
  await client.start(audio);
  assert.equal(client.getSnapshot().status, 'closing');
  emit({ type: 'session.closed' });
  assert.equal(track.stopped, true);
  assert.equal(client.getSnapshot().transcript[0].text, 'Hello');
  await client.start(audio);
  assert.equal(client.getSnapshot().status, 'connected');
  assert.equal(client.getSnapshot().transcript.length, 1);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body as string).history, [{ role: 'user', text: 'Hello' }]);
  assert.equal(JSON.parse(requests.at(-1)!.body as string).sourceSessionId, 'live_test_1');
  assert.equal(client.getSnapshot().sessionId, 'live_test_2');
  assert.match(sent.filter(e => e.type === 'session.instructions.append').at(-1)?.content || '', /continuing the conversation/);
  user('Again', 100, 300);
  assert.deepEqual(client.getSnapshot().transcript.map(entry => entry.text), ['Hello', 'Again']);
  assert.equal(new Set(client.getSnapshot().transcript.map(entry => entry.id)).size, 2);
});

test('user speech before the greeting acknowledgement suppresses the cue', async t => {
  const { client, audio, sent, emit, user } = browserFixture(t);
  await client.start(audio);
  user('Hi', 0, 200);
  emit({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
  assert.equal(sent.filter(e => e.type === 'session.commentary.append').length, 0);
});

test('late and overlapping transcript fragments keep independent speakers and deduplicate', () => {
  const transcripts = new LiveTranscripts();
  const append = (type: string, delta: string, start_ms: number, end_ms: number) => transcripts.append({ type, delta, start_ms, end_ms });
  append('session.input_transcript.delta', ' world', 300, 600);
  append('session.output_transcript.delta', 'Hello!', 150, 400);
  append('session.input_transcript.delta', 'Hello', 0, 300);
  append('session.input_transcript.delta', 'Hello', 0, 300);
  assert.deepEqual(transcripts.entries.map(e => [e.role, e.text]), [['user', 'Hello world'], ['assistant', 'Hello!']]);
});

test('web citations survive reconnects, reject unsafe links, and clear for a new conversation', async t => {
  const { client, audio, emit } = browserFixture(t);
  await client.start(audio);
  const citation = { type: 'url_citation', url: 'https://example.com/hours', title: 'Official opening hours' };
  emit({ type: 'response.event', event: { type: 'response.output_text.annotation.added', annotation: citation } });
  emit({ type: 'response.event', event: { type: 'response.output_item.done', item: { type: 'message', content: [{ type: 'output_text', annotations: [citation, { type: 'url_citation', url: 'javascript:alert(1)' }, { type: 'url_citation', url: 'https://secret@example.com/' }, { type: 'url_citation', url: 'invalid' }] }] } } });
  assert.deepEqual(client.getSnapshot().sources, [{ url: citation.url, title: citation.title }]);
  client.stop();
  emit({ type: 'session.closed' });
  assert.equal(client.getSnapshot().sources.length, 1);
  await client.start(audio);
  assert.equal(client.getSnapshot().sources.length, 1);
  await client.newConversation(audio);
  assert.equal(client.getSnapshot().status, 'connected');
  assert.deepEqual(client.getSnapshot().sources, []);
});

test('reload restores transcript and sources, seeds startup, and prompts a follow-up question once', async t => {
  const { client, audio, user, emit, storage, sent, requests } = browserFixture(t);
  await client.start(audio);
  user('Let us plan a trip.', 100, 300);
  emit({ type: 'session.output_transcript.delta', delta: 'Where to?', start_ms: 500, end_ms: 900 });
  emit({ type: 'response.event', event: { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://example.com', title: 'Travel' } } });
  const saved = storage.get(CONVERSATION_KEY)!;
  assert.deepEqual(JSON.parse(saved).transcript.map((entry: { text: string }) => entry.text), ['Let us plan a trip.', 'Where to?']);
  client.dispose();
  const restored = new LiveClient();
  t.after(() => restored.dispose());
  assert.equal(restored.getSnapshot().status, 'idle');
  assert.deepEqual(restored.getSnapshot().transcript, client.getSnapshot().transcript);
  assert.deepEqual(restored.getSnapshot().sources, client.getSnapshot().sources);
  assert.equal(restored.getSnapshot().sessionId, 'live_test_1');
  await restored.start(audio);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body as string).history, [
    { role: 'user', text: 'Let us plan a trip.' }, { role: 'assistant', text: 'Where to?' },
  ]);
  assert.equal(JSON.parse(requests.at(-1)!.body as string).sourceSessionId, 'live_test_1');
  assert.equal(JSON.parse(storage.get(CONVERSATION_KEY)!).sessionId, 'live_test_2');
  emit({ type: 'session.instructions.appended', client_event_id: sent.at(-1)?.event_id });
  assert.equal(sent.filter(event => event.type === 'session.commentary.append').length, 1);
  const greeting = sent.findLast(event => event.type === 'session.instructions.append');
  assert.match(greeting?.content || '', /Always open with one concrete, natural follow-up question based on the most recent topic or unresolved point/);
  assert.match(greeting?.content || '', /Never open with a generic invitation/);
  assert.match(sent.findLast(event => event.type === 'session.commentary.append')?.content || '', /Begin with your concrete follow-up question now/);
  emit({ type: 'session.instructions.appended', client_event_id: greeting?.event_id });
  assert.equal(sent.filter(event => event.type === 'session.commentary.append').length, 1);
  user('Prague', 100, 300);
  assert.deepEqual(restored.getSnapshot().transcript.map(entry => entry.text), ['Let us plan a trip.', 'Where to?', 'Prague']);
});

for (const status of ['idle', 'connected', 'closing'] as const) {
  test(`new conversation starts voice from ${status}, discards history, and keeps memory`, async t => {
    const { client, audio, user, emit, storage, requests, sent } = browserFixture(t, false, true, 'Prefers Slovak.');
    await client.start(audio);
    user('Old topic', 0, 100);
    if (status !== 'connected') client.stop();
    if (status === 'idle') emit({ type: 'session.closed' });
    assert.equal(client.getSnapshot().status, status);
    const starting = client.newConversation(audio);
    assert.equal(client.getSnapshot().status, 'connecting');
    assert.equal(storage.has(CONVERSATION_KEY), false);
    assert.deepEqual(client.getSnapshot().transcript, []);
    assert.equal(client.memory.getSnapshot().pending, '');
    assert.deepEqual(client.memory.getSnapshot().memories, ['Prefers Slovak.']);
    await starting;
    assert.equal(client.getSnapshot().status, 'connected');
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests.at(-1)!.body as string).history, []);
    assert.equal(JSON.parse(requests.at(-1)!.body as string).sourceSessionId, null);
    const greeting = sent.findLast(event => event.type === 'session.instructions.append');
    assert.match(greeting?.content || '', /Give a brief, natural greeting/);
    assert.match(greeting?.content || '', /Prefers Slovak/);
    emit({ type: 'session.instructions.appended', client_event_id: greeting?.event_id });
    assert.equal(sent.at(-1)?.type, 'session.commentary.append');
  });
}

test('fork without local captions greets on joining, and final captions persist during close', async t => {
  const { client, audio, emit, sent, user, storage } = browserFixture(t, false, true, '', JSON.stringify({ version: 1, sessionId: 'live_saved', transcript: [], sources: [] }));
  await client.start(audio);
  assert.match(sent[0].content || '', /continuing the conversation/);
  emit({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
  assert.equal(sent.filter(event => event.type === 'session.commentary.append').length, 1);
  client.stop();
  user('Last words', 0, 100);
  emit({ type: 'session.closed' });
  assert.equal(JSON.parse(storage.get(CONVERSATION_KEY)!).transcript[0].text, 'Last words');
});

test('corrupt browser data and storage write failures do not prevent voice', async t => {
  const { client, audio, user } = browserFixture(t, false, true, '', '{broken');
  assert.deepEqual(client.getSnapshot().transcript, []);
  assert.match(client.getSnapshot().storageError || '', /could not be loaded/);
  t.mock.method(localStorage, 'setItem', () => { throw new Error('quota'); });
  await client.start(audio);
  user('Still talking', 0, 100);
  assert.equal(client.getSnapshot().status, 'connected');
  assert.equal(client.getSnapshot().transcript[0].text, 'Still talking');
  assert.match(client.getSnapshot().storageError || '', /could not be saved/);
});


test('fresh session receives remembered language before the greeting cue', async t => {
  const { client, audio, sent, emit } = browserFixture(t, false, false, 'The user speaks Slovak and prefers short replies.');
  await client.start(audio);
  emit({ type: 'session.started' });
  assert.match(sent[0].content || '', /The user speaks Slovak/);
  assert.match(sent[0].content || '', /Use their remembered preferred language for your first spoken words/);
  assert.doesNotMatch(sent[0].content || '', /Greet them briefly in English/);
  assert.equal(sent.filter(e => e.type === 'session.commentary.append').length, 0);
  emit({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
  assert.equal(sent.at(-1)?.type, 'session.commentary.append');
});


test('full wipe stops voice, empties storage, and ignores a late memory review', async t => {
  const { client, audio, user, emit, storage, track, requests, sent } = browserFixture(t, false, true, 'Prefers Slovak.');
  let resolveReview!: (response: Response) => void;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => input === '/api/memory'
    ? new Promise<Response>(resolve => { resolveReview = resolve; }) : originalFetch(input, init));
  await client.start(audio);
  user('Old private topic', 0, 100);
  const review = client.memory.summarize();
  storage.set('other-local-setting', 'value');
  client.clearAll();
  assert.equal(track.stopped, true);
  assert.equal(audio.paused, true);
  assert.equal(client.getSnapshot().status, 'idle');
  assert.deepEqual(client.getSnapshot().transcript, []);
  assert.equal(client.getSnapshot().sessionId, null);
  assert.deepEqual(client.memory.getSnapshot().memories, []);
  assert.equal(client.memory.getSnapshot().pending, '');
  assert.equal(storage.size, 0);
  emit({ type: 'session.input_transcript.delta', delta: 'Late speech', start_ms: 100, end_ms: 200 });
  resolveReview(Response.json({ patch: { add: ['Old private topic'], update: [], remove: [] } }));
  await review;
  assert.equal(storage.size, 0);
  assert.deepEqual(client.memory.getSnapshot().memories, []);
  await client.start(audio);
  assert.deepEqual(JSON.parse(requests.at(-1)!.body as string).history, []);
  assert.equal(JSON.parse(requests.at(-1)!.body as string).sourceSessionId, null);
  assert.doesNotMatch(sent.findLast(event => event.type === 'session.instructions.append')!.content!, /Prefers Slovak/);
});

test('new conversation starts immediately during connection and releases the old late microphone', async t => {
  const { client, audio, releaseMicrophone, track, storage, requests } = browserFixture(t, true, true, 'Likes hiking.');
  client.memory.record('user', 'Discard pending topic');
  const starting = client.start(audio);
  const freshTrack = { ...track, enabled: true, stopped: false };
  const freshStream = { getTracks: () => [freshTrack], getAudioTracks: () => [freshTrack] };
  t.mock.method(navigator.mediaDevices, 'getUserMedia', async () => freshStream as unknown as MediaStream);
  await client.newConversation(audio);
  assert.equal(client.getSnapshot().status, 'connected');
  releaseMicrophone();
  await starting;
  assert.equal(track.stopped, true);
  assert.equal(freshTrack.stopped, false);
  assert.equal(freshTrack.enabled, true);
  assert.equal(requests.length, 1);
  assert.equal(client.getSnapshot().status, 'connected');
  assert.deepEqual(JSON.parse(storage.get(CONVERSATION_KEY)!).transcript, []);
  assert.deepEqual(JSON.parse(requests[0].body as string).history, []);
  assert.equal(JSON.parse(requests[0].body as string).sourceSessionId, null);
  assert.deepEqual(client.memory.getSnapshot().memories, ['Likes hiking.']);
  assert.equal(client.memory.getSnapshot().pending, '');
});

test('failed full wipe reports a storage error', t => {
  const { client } = browserFixture(t);
  t.mock.method(localStorage, 'clear', () => { throw new Error('blocked'); });
  client.clearAll();
  assert.match(client.getSnapshot().storageError || '', /could not be cleared/);
});
