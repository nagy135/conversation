const KEY = 'conversation.memory.v1';
interface Saved { summary: string; }
class MemoryRequestError extends Error {}

export interface MemorySnapshot extends Saved { revision: number; pending: string; busy: boolean; error: string | null; }

/** Browser-owned volatile transcript buffer; one summary request at a time, independent of voice. */
export class ConversationMemory {
  private state: MemorySnapshot = { summary: '', revision: 0, pending: '', busy: false, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private requestFetch: typeof fetch = (...args) => fetch(...args)) {
    try {
      this.storage ??= globalThis.localStorage;
      const saved = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (saved && typeof saved.summary === 'string' && saved.summary.length <= 8000) {
        this.state = { ...this.state, summary: saved.summary };
      }
      // Migrate v1: discard previously persisted raw conversations, even with an invalid summary.
      if (saved !== null) this.storage?.setItem(KEY, JSON.stringify({ summary: this.state.summary }));
    } catch { this.state.error = 'Browser memory could not be loaded.'; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<MemorySnapshot>, save = false) {
    this.state = { ...this.state, ...patch };
    if (save) {
      try {
        if (!this.storage) throw new Error('Storage unavailable');
        this.storage.setItem(KEY, JSON.stringify({ summary: this.state.summary }));
      } catch { this.state.error = 'Memory cannot be saved in this browser.'; }
    }
    this.listeners.forEach(listener => listener());
  }
  record(role: 'user' | 'assistant', text: string) {
    if (!text) return;
    this.update({ pending: this.state.pending + `${role}: ${text}\n` });
    this.schedule();
  }
  resume = () => { this.schedule(); };
  private schedule() {
    if (!this.timer && !this.request && this.state.pending.length) {
      this.timer = setTimeout(() => { this.timer = null; void this.summarize(); }, 30000);
    }
  }
  context() {
    return this.state.summary;
  }
  summarize = async () => {
    if (this.request || !this.state.pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const controller = new AbortController();
    this.request = controller;
    // Snapshot only unsummarized fragments. New arrivals remain in the next batch.
    const batch = this.state.pending.slice(0, 24000);
    this.update({ busy: true, error: null });
    try {
      const response = await this.requestFetch('/api/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: this.state.summary, transcript: batch }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const detail = typeof failure?.error === 'string' && failure.error.length <= 500
          ? failure.error : `Memory request failed (HTTP ${response.status}).`;
        throw new MemoryRequestError(detail);
      }
      const result = await response.json();
      if (typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 8000) throw new Error('Invalid summary');
      if (this.request !== controller) return;
      this.update({ revision: this.state.revision + 1, summary: result.summary, pending: this.state.pending.slice(batch.length) }, true);
    } catch (error) {
      if (this.request === controller) this.update({ error: error instanceof MemoryRequestError
        ? error.message
        : 'Could not complete the memory request. Keep this page open to retry.' });
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
    this.update({ summary: '', revision: 0, pending: '', busy: false, error: null }, true);
  };
  pause = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.update({ busy: false });
  };
}
