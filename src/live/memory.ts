import type { Transcript } from './types';

const KEY = 'conversation.memory.v1';
interface Pending { id: string; text: string; }
interface Saved { summary: string; pending: Pending[]; }
export interface MemorySnapshot extends Saved { busy: boolean; error: string | null; }

/** Browser-owned durable queue; one summary request at a time, independent of voice. */
export class ConversationMemory {
  private state: MemorySnapshot = { summary: '', pending: [], busy: false, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private requestFetch: typeof fetch = fetch) {
    try {
      this.storage ??= globalThis.localStorage;
      const saved = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (saved && typeof saved.summary === 'string' && saved.summary.length <= 8000 && Array.isArray(saved.pending)
        && saved.pending.every((p: Pending) => p && typeof p.id === 'string' && typeof p.text === 'string')) {
        this.state = { ...this.state, summary: saved.summary, pending: saved.pending };
      }
    } catch { this.state.error = 'Browser memory could not be loaded.'; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<MemorySnapshot>, save = false) {
    this.state = { ...this.state, ...patch };
    if (save) {
      try {
        if (!this.storage) throw new Error('Storage unavailable');
        this.storage.setItem(KEY, JSON.stringify({ summary: this.state.summary, pending: this.state.pending }));
      } catch { this.state.error = 'Memory cannot be saved in this browser.'; }
    }
    this.listeners.forEach(listener => listener());
  }
  record(id: string, entries: Transcript[]) {
    const text = entries.map(e => `${e.role}: ${e.text}`).join('\n').slice(-24000);
    if (!text || this.state.pending.find(p => p.id === id)?.text === text) return;
    const pending = this.state.pending.filter(p => p.id !== id);
    pending.push({ id, text });
    this.update({ pending }, true);
    this.schedule();
  }
  resume = () => { this.schedule(); };
  private schedule() {
    if (!this.timer && !this.request && this.state.pending.length) {
      this.timer = setTimeout(() => { this.timer = null; void this.summarize(); }, 30000);
    }
  }
  context() {
    return [this.state.summary, ...this.state.pending.map(p => p.text)].filter(Boolean).join('\n\n').slice(-32000);
  }
  summarize = async () => {
    if (this.request || !this.state.pending.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const controller = new AbortController();
    this.request = controller;
    // Consume a bounded batch. Changed conversations remain queued for the next pass.
    const batch = this.state.pending.slice(0, 1);
    this.update({ busy: true, error: null });
    try {
      const response = await this.requestFetch('/api/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: this.state.summary, transcript: batch.map(p => p.text).join('\n\n') }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
      });
      if (!response.ok) throw new Error('Summary failed');
      const result = await response.json();
      if (typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 8000) throw new Error('Invalid summary');
      if (this.request !== controller) return;
      this.update({ summary: result.summary, pending: this.state.pending.filter(p => !batch.some(b => b.id === p.id && b.text === p.text)) }, true);
    } catch {
      if (this.request === controller) this.update({ error: 'Memory summary paused. Your conversation is queued for retry.' });
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.update({ busy: false });
        if (!this.state.error) this.schedule();
      }
    }
  };
  clear = () => {
    this.pause();
    this.update({ summary: '', pending: [], busy: false, error: null }, true);
  };
  pause = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.update({ busy: false });
  };
}
