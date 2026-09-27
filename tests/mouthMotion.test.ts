import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MouthMotion } from '../src/components/mouthMotion';
import { RemoteAudioMeter } from '../src/live/audioMeter';

test('jaw opens and closes between syllables in one continuous speaking turn', () => {
  const mouth = new MouthMotion();
  const run = (level: number, frames: number) => {
    let result = 0;
    for (let i = 0; i < frames; i++) result = mouth.update(level, 1 / 60, true);
    return result;
  };
  for (const peak of [0.3, 0.22, 0.4, 0.27]) {
    assert.ok(run(peak, 8) > 0.3, 'Each syllable must visibly open the mouth');
    assert.ok(run(0.015, 5) < 0.01, 'An 83 ms consonant gap must close the jaw');
  }
  assert.equal(run(0, 10), 0, 'Silence must close the mouth');
});

test('jaw responds to different loudness, stays bounded, and resets on pause/reduced motion', () => {
  const mouth = new MouthMotion();
  let loud = 0;
  for (let i = 0; i < 12; i++) loud = mouth.update(0.5, 1 / 60, true);
  let soft = 0;
  for (let i = 0; i < 5; i++) soft = mouth.update(0.18, 1 / 60, true);
  assert.ok(loud > 0.6 && loud <= 0.65);
  assert.ok(soft < loud / 3 && soft > 0);
  assert.equal(mouth.update(1, 1 / 60, false), 0);
  assert.equal(mouth.update(0, 1 / 60, true), 0);
});

test('remote meter reads waveform valleys and releases its audio resources', async t => {
  let amplitude = 0.1;
  let sourceDisconnected = false;
  let analyserDisconnected = false;
  let closed = false;
  let resumed = false;
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(data: Float32Array) { data.fill(amplitude); },
    disconnect() { analyserDisconnected = true; },
  };
  const source = {
    connect(target: unknown) { assert.equal(target, analyser); },
    disconnect() { sourceDisconnected = true; },
  };
  class Context {
    state = 'suspended';
    createAnalyser() { return analyser; }
    createMediaStreamSource() { return source; }
    async resume() { resumed = true; this.state = 'running'; }
    async close() { closed = true; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  });
  const meter = new RemoteAudioMeter();
  meter.attach({} as MediaStream);
  assert.ok(resumed);
  assert.equal(analyser.fftSize, 512);
  assert.ok(Math.abs(meter.read()! - 0.1) < 0.00001);
  amplitude = 0;
  assert.equal(meter.read(), 0);
  meter.close();
  assert.ok(sourceDisconnected && analyserDisconnected && closed);
  assert.equal(meter.read(), null, 'Unavailable meter lets the transport use its RTP fallback');
});
