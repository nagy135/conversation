/** Shared validation and deterministic patch application; no model-generated toast text. */
export interface MemoryPatch {
  add: string[];
  update: { index: number; text: string }[];
  remove: number[];
}
export interface MemoryChange { kind: 'added' | 'updated' | 'removed'; text: string; }
const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
export function validMemories(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 200
    && value.every(text => typeof text === 'string' && text.trim().length > 0 && text.length <= 8000)
    && value.join('\n').length <= 24000;
}
export function applyMemoryPatch(previous: string[], value: unknown): { memories: string[]; changes: MemoryChange[] } {
  if (!value || typeof value !== 'object') throw new Error('Invalid memory patch');
  const patch = value as MemoryPatch;
  if (!Array.isArray(patch.add) || !Array.isArray(patch.update) || !Array.isArray(patch.remove)
    || !validMemories(patch.add)) throw new Error('Invalid memory patch');
  const touched = new Set<number>();
  const checkIndex = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= previous.length || touched.has(index)) throw new Error('Invalid memory index');
    touched.add(index);
  };
  for (const entry of patch.update) {
    if (!entry || !validMemories([entry.text])) throw new Error('Invalid memory update');
    checkIndex(entry.index);
  }
  patch.remove.forEach(checkIndex);
  const updates = new Map(patch.update.map(entry => [entry.index, entry.text.trim()]));
  const removals = new Set(patch.remove);
  const candidates = previous.flatMap((text, index) => removals.has(index) ? [] : [updates.get(index) ?? text]);
  candidates.push(...patch.add.map(text => text.trim()));
  const seen = new Set<string>();
  const memories = candidates.filter(text => { const id = key(text); if (seen.has(id)) return false; seen.add(id); return true; });
  if (!validMemories(memories)) throw new Error('Memory capacity exceeded');
  const before = new Set(previous.map(key));
  const after = new Set(memories.map(key));
  if (before.size === after.size && [...before].every(id => after.has(id))) return { memories: previous, changes: [] };
  const changes: MemoryChange[] = [];
  const announced = new Set<string>();
  for (const [index, text] of updates) {
    if (!after.has(key(previous[index])) && after.has(key(text)) && !announced.has(key(text))) {
      changes.push({ kind: 'updated', text });
      announced.add(key(text));
    }
  }
  for (const text of memories) {
    if (!before.has(key(text)) && !announced.has(key(text))) changes.push({ kind: 'added', text });
  }
  // Updates already describe the new value; only explicit removals need a separate notice.
  for (const index of patch.remove) {
    if (!after.has(key(previous[index]))) changes.push({ kind: 'removed', text: previous[index] });
  }
  return { memories: changes.length ? memories : previous, changes };
}
export const memoryPatchSchema = {
  type: 'object', additionalProperties: false, required: ['add', 'update', 'remove'],
  properties: {
    add: { type: 'array', items: { type: 'string' } },
    update: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['index', 'text'], properties: { index: { type: 'integer' }, text: { type: 'string' } } } },
    remove: { type: 'array', items: { type: 'integer' } },
  },
};
