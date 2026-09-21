import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory } from '../src/live/memory.ts';
import type { Transcript } from '../src/live/types.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const entries = (text: string): Transcript[] => [{ id: '1', role: 'user', text, startMs: 0, endMs: 1 }];

test('pending memory survives reload and changes during summarization are retained', async t => {
  const disk = storage();
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch);
  t.after(memory.pause);
  memory.record('session', entries('I like tea.'));
  assert.match(new ConversationMemory(disk).context(), /I like tea/);
  const work = memory.summarize();
  memory.record('session', entries('I like tea. My name is Alex.'));
  resolve(Response.json({ summary: 'Likes tea.' }));
  await work;
  assert.equal(memory.getSnapshot().summary, 'Likes tea.');
  assert.match(memory.getSnapshot().pending[0].text, /Alex/);
  assert.match(new ConversationMemory(disk).context(), /Alex/);
});

test('clearing memory invalidates in-flight summaries, including a late success', async () => {
  const disk = storage();
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch);
  memory.record('session', entries('My name is Alex.'));
  const work = memory.summarize();
  memory.clear();
  resolve(Response.json({ summary: 'Name: Alex.' }));
  await work;
  assert.equal(memory.context(), '');
  assert.equal(new ConversationMemory(disk).context(), '');
  assert.equal(memory.getSnapshot().busy, false);
});

test('failure keeps queued memory and successful retry compacts it', async t => {
  let fail = true;
  const memory = new ConversationMemory(storage(), (async () => fail ? new Response('', { status: 502 }) : Response.json({ summary: 'Likes tea.' })) as typeof fetch);
  t.after(memory.pause);
  memory.record('session', entries('I like tea.'));
  await memory.summarize();
  assert.equal(memory.getSnapshot().pending.length, 1);
  assert.ok(memory.getSnapshot().error);
  fail = false;
  await memory.summarize();
  assert.equal(memory.getSnapshot().pending.length, 0);
  assert.equal(memory.context(), 'Likes tea.');
});
