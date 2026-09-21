import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory } from '../src/live/memory.ts';
import { applyMemoryPatch } from '../server/memory-data.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('pending speech survives reload and each run consumes only its captured buffer', async t => {
  const disk = storage();
  const requests: { memories: string[]; transcript: string }[] = [];
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, ((_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return new Promise<Response>(r => { resolve = r; });
  }) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'I like tea.');
  assert.equal(new ConversationMemory(disk).getSnapshot().pending, 'user: I like tea.\n');
  assert.equal(new ConversationMemory(disk).context(), '');
  const work = memory.summarize();
  memory.record('user', 'My name is Alex.');
  resolve(Response.json({ patch: { add: ['Likes tea.'], update: [], remove: [] } }));
  await work;
  assert.equal(memory.getSnapshot().pending, 'user: My name is Alex.\n');
  assert.deepEqual(JSON.parse(disk.getItem('conversation.memory.v2')!).memories, ['Likes tea.']);
  assert.equal(new ConversationMemory(disk).getSnapshot().pending, 'user: My name is Alex.\n');
  assert.equal(new ConversationMemory(disk).context(), 'Likes tea.');
  const next = memory.summarize();
  assert.deepEqual(requests[1], { memories: ['Likes tea.'], transcript: 'user: My name is Alex.\n' });
  resolve(Response.json({ patch: { add: [], update: [{ index: 0, text: 'Alex likes tea.' }], remove: [] } }));
  await next;
  assert.equal(memory.getSnapshot().pending, '');
  assert.equal(memory.context(), 'Alex likes tea.');
  assert.equal(new ConversationMemory(disk).getSnapshot().pending, '');
});

test('migration removes old raw conversation storage while preserving summary', () => {
  const disk = storage();
  disk.setItem('conversation.memory.v1', JSON.stringify({ summary: 'Likes tea.', pending: [{ id: 'old', text: 'raw conversation' }] }));
  const memory = new ConversationMemory(disk);
  assert.equal(memory.context(), 'Likes tea.');
  assert.equal(memory.getSnapshot().pending, '');
  assert.deepEqual(JSON.parse(disk.getItem('conversation.memory.v2')!), { memories: ['Likes tea.'] });
});

test('clearing memory invalidates in-flight summaries, including a late success', async () => {
  const disk = storage();
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch);
  memory.record('user', 'My name is Alex.');
  const work = memory.summarize();
  memory.clear();
  resolve(Response.json({ patch: { add: ['Name: Alex.'], update: [], remove: [] } }));
  await work;
  assert.equal(memory.context(), '');
  assert.equal(new ConversationMemory(disk).context(), '');
  assert.equal(memory.getSnapshot().busy, false);
});

test('failure keeps queued memory and successful retry compacts it', async t => {
  let fail = true;
  const memory = new ConversationMemory(storage(), (async () => fail ? new Response('', { status: 502 }) : Response.json({ patch: { add: ['Likes tea.'], update: [], remove: [] } })) as typeof fetch);
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

test('default browser fetch is called without the memory object as its receiver', async t => {
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    if (this instanceof ConversationMemory) throw new TypeError('Illegal invocation');
    return Response.json({ patch: { add: ['Likes tea.'], update: [], remove: [] } });
  });
  const memory = new ConversationMemory(storage());
  t.after(memory.pause);
  memory.record('user', 'I like tea.');
  await memory.summarize();
  assert.equal(memory.getSnapshot().error, null);
  assert.equal(memory.context(), 'Likes tea.');
  assert.equal(memory.getSnapshot().pending, '');
});

test('memory request failures show server guidance and retain the buffer', async t => {
  const memory = new ConversationMemory(storage(), (async () => Response.json({ error: 'Memory is busy. Try again in a minute.' }, { status: 429 })) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'I like tea.');
  await memory.summarize();
  assert.equal(memory.getSnapshot().error, 'Memory is busy. Try again in a minute.');
  assert.match(memory.getSnapshot().pending, /I like tea/);
});


test('no-op durably consumes the buffer and records review status without a notification', async t => {
  const disk = storage();
  disk.setItem('conversation.memory.v2', JSON.stringify({ memories: ['Likes tea.'] }));
  const memory = new ConversationMemory(disk, (async () => Response.json({ patch: { add: [], update: [], remove: [] } })) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'Okay, thanks.');
  await memory.summarize();
  assert.equal(memory.getSnapshot().pending, '');
  assert.equal(memory.getSnapshot().revision, 0);
  assert.deepEqual(memory.getSnapshot().changes, []);
  assert.deepEqual(memory.getSnapshot().memories, ['Likes tea.']);
  const restored = new ConversationMemory(disk).getSnapshot();
  assert.equal(restored.pending, '');
  assert.equal(restored.lastReview?.changes, 0);
  assert.ok(restored.lastReview?.at);
  assert.deepEqual(restored.memories, ['Likes tea.']);
});

test('reload during a review retains its batch and later speech for retry', async t => {
  const disk = storage();
  let resolve!: (response: Response) => void;
  const memory = new ConversationMemory(disk, (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch);
  memory.record('user', 'I grow orchids.');
  const work = memory.summarize();
  memory.record('user', 'I prefer short replies.');
  memory.pause();
  const restored = new ConversationMemory(disk, (async (_url, init) => {
    assert.match(JSON.parse(init!.body as string).transcript, /I grow orchids[\s\S]*I prefer short replies/);
    return Response.json({ patch: { add: ['Grows orchids.', 'Prefers short replies.'], update: [], remove: [] } });
  }) as typeof fetch);
  t.after(restored.pause);
  resolve(Response.json({ patch: { add: ['Stale result.'], update: [], remove: [] } }));
  await work;
  await restored.summarize();
  assert.deepEqual(new ConversationMemory(disk).getSnapshot().memories, ['Grows orchids.', 'Prefers short replies.']);
  assert.equal(new ConversationMemory(disk).getSnapshot().pending, '');
});

test('restored pending speech is automatically reviewed after resume', async t => {
  const disk = storage();
  const beforeReload = new ConversationMemory(disk);
  beforeReload.record('user', 'I grow orchids.');
  beforeReload.pause();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const restored = new ConversationMemory(disk, (async () => {
    requests++;
    return Response.json({ patch: { add: ['Grows orchids.'], update: [], remove: [] } });
  }) as typeof fetch);
  t.after(restored.pause);
  restored.resume();
  t.mock.timers.tick(29999);
  assert.equal(requests, 0);
  t.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(restored.getSnapshot().busy, false);
  assert.deepEqual(new ConversationMemory(disk).getSnapshot().memories, ['Grows orchids.']);
  assert.equal(new ConversationMemory(disk).getSnapshot().pending, '');
});

test('duplicate additions are silent; corrections and forgetting affect only targeted entries', async t => {
  const disk = storage();
  disk.setItem('conversation.memory.v2', JSON.stringify({ memories: ['Likes tea.', 'Speaks Slovak.', 'Lives in Prague.'] }));
  let patch = { add: ['  LIKES tea.  '], update: [] as { index: number; text: string }[], remove: [] as number[] };
  const memory = new ConversationMemory(disk, (async () => Response.json({ patch })) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'I like tea.');
  await memory.summarize();
  assert.equal(memory.getSnapshot().revision, 0);
  patch = { add: ['Enjoys gardening.'], update: [{ index: 2, text: 'Lives in Bratislava.' }], remove: [0] };
  memory.record('user', 'I moved to Bratislava. I enjoy gardening. Forget that I like tea.');
  await memory.summarize();
  assert.deepEqual(memory.getSnapshot().memories, ['Speaks Slovak.', 'Lives in Bratislava.', 'Enjoys gardening.']);
  assert.deepEqual(memory.getSnapshot().changes, [
    { kind: 'updated', text: 'Lives in Bratislava.' }, { kind: 'added', text: 'Enjoys gardening.' }, { kind: 'removed', text: 'Likes tea.' },
  ]);
  assert.equal(memory.getSnapshot().revision, 1);
});

test('invalid patch preserves prior memory and unreviewed speech', async t => {
  const disk = storage();
  disk.setItem('conversation.memory.v2', JSON.stringify({ memories: ['Speaks Slovak.'] }));
  const memory = new ConversationMemory(disk, (async () => Response.json({ patch: { add: [], update: [{ index: 4, text: 'Invalid.' }], remove: [] } })) as typeof fetch);
  t.after(memory.pause);
  memory.record('user', 'Hello');
  await memory.summarize();
  assert.deepEqual(memory.getSnapshot().memories, ['Speaks Slovak.']);
  assert.equal(memory.getSnapshot().pending, 'user: Hello\n');
  assert.equal(memory.getSnapshot().revision, 0);
  assert.ok(memory.getSnapshot().error);
});


test('correction to an already-known value removes the obsolete fact without duplicating', () => {
  assert.deepEqual(applyMemoryPatch(['Lives in Prague.', 'Lives in Bratislava.'], { add: [], update: [{ index: 0, text: 'Lives in Bratislava.' }], remove: [] }), {
    memories: ['Lives in Bratislava.'], changes: [{ kind: 'updated', text: 'Lives in Bratislava.' }],
  });
});
