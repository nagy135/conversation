import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory } from '../src/live/memory.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('only summaries persist and each run consumes only its captured buffer', async t => {
  const disk = storage();
  const requests: { summary: string; transcript: string }[] = [];
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, ((_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return new Promise<Response>(r => { resolve = r; });
  }) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'I like tea.');
  assert.equal(disk.getItem('conversation.memory.v1'), null);
  assert.equal(new ConversationMemory(disk).context(), '');
  const work = memory.summarize();
  memory.record('user', 'My name is Alex.');
  resolve(Response.json({ summary: 'Likes tea.' }));
  await work;
  assert.equal(memory.getSnapshot().pending, 'user: My name is Alex.\n');
  assert.deepEqual(JSON.parse(disk.getItem('conversation.memory.v1')!), { summary: 'Likes tea.' });
  assert.equal(new ConversationMemory(disk).context(), 'Likes tea.');
  const next = memory.summarize();
  assert.deepEqual(requests[1], { summary: 'Likes tea.', transcript: 'user: My name is Alex.\n' });
  resolve(Response.json({ summary: 'Alex likes tea.' }));
  await next;
  assert.equal(memory.getSnapshot().pending, '');
  assert.equal(memory.context(), 'Alex likes tea.');
});

test('migration removes old raw conversation storage while preserving summary', () => {
  const disk = storage();
  disk.setItem('conversation.memory.v1', JSON.stringify({ summary: 'Likes tea.', pending: [{ id: 'old', text: 'raw conversation' }] }));
  const memory = new ConversationMemory(disk);
  assert.equal(memory.context(), 'Likes tea.');
  assert.equal(memory.getSnapshot().pending, '');
  assert.deepEqual(JSON.parse(disk.getItem('conversation.memory.v1')!), { summary: 'Likes tea.' });
});

test('clearing memory invalidates in-flight summaries, including a late success', async () => {
  const disk = storage();
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch);
  memory.record('user', 'My name is Alex.');
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
  memory.record('user', 'I like tea.');
  await memory.summarize();
  assert.match(memory.getSnapshot().pending, /I like tea/);
  assert.ok(memory.getSnapshot().error);
  fail = false;
  await memory.summarize();
  assert.equal(memory.getSnapshot().pending.length, 0);
  assert.equal(memory.context(), 'Likes tea.');
});
