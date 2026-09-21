import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { LiveClient } from "../src/live/client";
import { LiveTranscripts } from "../src/live/transcripts";
import type { ServerEvent } from "../src/live/types";

function browserFixture(
  t: TestContext,
  delayedMicrophone = false,
  autoStart = true,
) {
  const sent: Array<{
    type: string;
    event_id?: string;
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
      requests.push(init!);
      return Response.json({
        session: { id: "live_test" },
        transport: { type: "webrtc", sdp: "v=0\r\nanswer" },
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
  return { client, audio, track, sent, requests, emit, user, releaseMicrophone };
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

test('stop silences immediately, waits for close, and allows a fresh session', async t => {
  const { client, audio, track, sent, emit, user } = browserFixture(t);
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
  assert.equal(client.getSnapshot().transcript.length, 0);
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
