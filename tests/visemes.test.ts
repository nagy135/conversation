import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAudioMeter } from '../src/live/audioMeter';
import VISEMES from '../src/vendor/wawa-lipsync/visemes';

test('received audio feeds the library without duplicate playback and clears stale poses on silence', t => {
  let volume = 0.1;
  const contexts: Context[] = [];
  const connections: unknown[] = [];
  let disconnects = 0;
  class Context {
    state = 'running'; destination = {};
    constructor() { contexts.push(this); }
    createAnalyser() { return { fftSize: 0, disconnect() {}, getFloatTimeDomainData(data: Float32Array) { data.fill(volume); } }; }
    createMediaStreamSource() { return { connect(node: unknown) { connections.push(node); }, disconnect() { disconnects++; } }; }
    async close() { this.state = 'closed'; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => previous ? Object.defineProperty(globalThis, 'AudioContext', previous) : Reflect.deleteProperty(globalThis, 'AudioContext'));
  const detector = { viseme: VISEMES.aa, processAudio() {}, connectSource(source: AudioNode) { source.connect(this as unknown as AudioNode); } };
  const meter = new RemoteAudioMeter(() => detector);
  meter.attach({} as MediaStream);
  assert.ok(connections.includes(detector));
  assert.ok(!connections.includes(contexts[0].destination));
  assert.deepEqual(meter.readVisemes(), { viseme_aa: 1 });
  detector.viseme = VISEMES.PP;
  assert.deepEqual(meter.readVisemes(), { viseme_PP: 1 });
  volume = 0;
  assert.deepEqual(meter.readVisemes(), {}, 'Silence must close the mouth even if the library retains its last prediction');
  volume = 0.1;
  detector.viseme = VISEMES.sil;
  assert.deepEqual(meter.readVisemes(), {});
  contexts[0].state = 'suspended';
  assert.equal(meter.readVisemes(), null);
  meter.attach({} as MediaStream);
  assert.equal(contexts[0].state, 'closed');
  meter.close();
  assert.equal(contexts[1].state, 'closed');
  assert.equal(disconnects, 2);
  assert.equal(meter.readVisemes(), null);
});
