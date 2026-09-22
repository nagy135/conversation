import { recentHistory, validHistory, validSessionId } from '../../server/history.ts';
import { collectSources } from './sources';
import type { Source, Transcript } from './types';

export const CONVERSATION_KEY = 'conversation.current.v1';
interface SavedConversation { transcript: Transcript[]; sources: Source[]; sessionId: string | null; }

export class ConversationStorage {
  error: string | null = null;
  private storage?: Storage;

  load(): SavedConversation {
    const empty = { transcript: [], sources: [], sessionId: null };
    try {
      this.storage = globalThis.localStorage;
      if (!this.storage) throw new Error('Storage unavailable');
      const raw = this.storage.getItem(CONVERSATION_KEY);
      if (!raw) return empty;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !validHistory(saved.transcript) || !saved.transcript.every((entry: Transcript) =>
        typeof entry.id === 'string' && Number.isFinite(entry.startMs) && Number.isFinite(entry.endMs) && entry.endMs >= entry.startMs,
      ) || !Array.isArray(saved.sources)) throw new Error('Invalid conversation');
      const sources = collectSources([], {
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', annotations: saved.sources.map((source: Source) => ({ ...source, type: 'url_citation' })) }] },
      });
      return { transcript: saved.transcript, sources, sessionId: validSessionId(saved.sessionId) ? saved.sessionId : null };
    } catch {
      this.error = 'The saved conversation could not be loaded in this browser.';
      return empty;
    }
  }

  save(conversation: SavedConversation) {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(CONVERSATION_KEY, JSON.stringify({ version: 1, ...conversation, transcript: recentHistory(conversation.transcript) }));
      this.error = null;
    } catch {
      this.error = 'This conversation could not be saved. Reloading may lose recent speech.';
    }
  }

  clear(all = false) {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      if (all) this.storage.clear();
      else this.storage.removeItem(CONVERSATION_KEY);
      this.error = null;
    } catch {
      this.error = 'Browser data could not be cleared. Please try again.';
    }
  }
}
