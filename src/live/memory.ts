import { applyMemoryPatch, validMemories, type MemoryChange } from '../../server/memory-data.ts';

const KEY = 'conversation.memory.v2';
const LEGACY_KEY = 'conversation.memory.v1';
const REVIEW_POLICY_VERSION = 1;
interface Saved { memories: string[]; pending: string; lastReview: { at: string; changes: number } | null; reviewPolicyVersion: number; }
class MemoryRequestError extends Error {}

export interface MemorySnapshot extends Saved { revision: number; changes: MemoryChange[]; busy: boolean; error: string | null; }

/** Durable review queue; one summary request at a time, independent of voice. */
export class ConversationMemory {
  private state: MemorySnapshot = { memories: [], changes: [], revision: 0, pending: '', lastReview: null, reviewPolicyVersion: 0, busy: false, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private requestFetch: typeof fetch = (...args) => fetch(...args)) {
    try {
      this.storage ??= globalThis.localStorage;
      const stored = this.storage?.getItem(KEY);
      if (stored) {
        const saved = JSON.parse(stored);
        if (validMemories(saved?.memories)) this.state = {
          ...this.state, memories: saved.memories,
          pending: typeof saved.pending === 'string' ? saved.pending : '',
          reviewPolicyVersion: saved.reviewPolicyVersion === REVIEW_POLICY_VERSION ? REVIEW_POLICY_VERSION : 0,
          lastReview: typeof saved.lastReview?.at === 'string' && Number.isFinite(Date.parse(saved.lastReview.at))
            && Number.isInteger(saved.lastReview.changes) && saved.lastReview.changes >= 0 ? saved.lastReview : null,
        };
      } else {
        const legacy = JSON.parse(this.storage?.getItem(LEGACY_KEY) || 'null');
        if (typeof legacy?.summary === 'string' && legacy.summary.trim() && legacy.summary !== 'No lasting details yet.' && validMemories([legacy.summary])) {
          this.state = { ...this.state, memories: [legacy.summary] };
        }
        if (legacy !== null) this.storage?.setItem(KEY, JSON.stringify({ memories: this.state.memories }));
      }
      // Keep the existing summary as an entry; never migrate raw transcripts.
      this.storage?.removeItem(LEGACY_KEY);
    } catch { this.state.error = 'Browser memory could not be loaded.'; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<MemorySnapshot>, save = false) {
    this.state = { ...this.state, ...patch };
    if (save) {
      try {
        if (!this.storage) throw new Error('Storage unavailable');
        // Commit the patch and consumed queue together so reload cannot lose unreviewed speech.
        this.storage.setItem(KEY, JSON.stringify({ memories: this.state.memories, pending: this.state.pending, lastReview: this.state.lastReview, reviewPolicyVersion: this.state.reviewPolicyVersion }));
      } catch { this.state.error = 'Memory cannot be saved in this browser.'; }
    }
    this.listeners.forEach(listener => listener());
  }
  record(role: 'user' | 'assistant', text: string) {
    if (!text) return;
    this.update({ pending: this.state.pending + `${role}: ${text}\n` }, true);
    this.schedule();
  }
  /** Once per policy upgrade, recover topics that the earlier reviewer deliberately skipped. */
  recoverTopics(transcript: { role: 'user' | 'assistant'; text: string }[]) {
    if (this.state.reviewPolicyVersion === REVIEW_POLICY_VERSION) return;
    const history = transcript.map(entry => `${entry.role}: ${entry.text}\n`).join('');
    this.update({ pending: history + this.state.pending, reviewPolicyVersion: REVIEW_POLICY_VERSION }, true);
  }
  resume = () => { this.schedule(); };
  private schedule() {
    if (!this.timer && !this.request && this.state.pending.length) {
      this.timer = setTimeout(() => { this.timer = null; void this.summarize(); }, 30000);
    }
  }
  context() {
    return this.state.memories.join('\n');
  }
  summarize = async () => {
    if (this.request || !this.state.pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const controller = new AbortController();
    this.request = controller;
    // Snapshot only unsummarized fragments. New arrivals remain in the next batch.
    const batch = this.state.pending.slice(0, 24000);
    this.update({ busy: true, error: null, changes: [] });
    try {
      const response = await this.requestFetch('/api/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memories: this.state.memories, transcript: batch }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const detail = typeof failure?.error === 'string' && failure.error.length <= 500
          ? failure.error : `Memory request failed (HTTP ${response.status}).`;
        throw new MemoryRequestError(detail);
      }
      const result = await response.json();
      if (this.request !== controller) return;
      const { memories, changes } = applyMemoryPatch(this.state.memories, result.patch);
      const changed = JSON.stringify(memories) !== JSON.stringify(this.state.memories);
      // No-op advances the durable queue, but does not create a memory-change toast.
      this.update({ memories, changes, revision: this.state.revision + (changed ? 1 : 0), pending: this.state.pending.slice(batch.length), lastReview: { at: new Date().toISOString(), changes: changes.length } }, true);
    } catch (error) {
      if (this.request === controller) this.update({ error: error instanceof MemoryRequestError
        ? error.message
        : 'Could not complete the memory request. Pending speech will be retried.' });
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.update({ busy: false });
        this.schedule();
      }
    }
  };
  clear = () => {
    this.pause();
    this.update({ memories: [], changes: [], revision: 0, pending: '', lastReview: null, reviewPolicyVersion: REVIEW_POLICY_VERSION, busy: false, error: null }, true);
  };
  pause = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.update({ busy: false });
  };
}
