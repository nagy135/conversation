export interface HistoryMessage { role: 'user' | 'assistant'; text: string; }
export const MAX_HISTORY_MESSAGES = 100;
export const MAX_HISTORY_CHARS = 48000;

export function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

export function validHistory(value: unknown): value is HistoryMessage[] {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_MESSAGES) return false;
  let length = 0;
  return value.every(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim()) return false;
    length += message.text.length;
    return length <= MAX_HISTORY_CHARS;
  });
}

/** Retain the most recent speech within a predictable startup context budget. */
export function recentHistory<T extends HistoryMessage>(messages: T[]): T[] {
  let remaining = MAX_HISTORY_CHARS;
  const result: T[] = [];
  for (const message of messages.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    if (!remaining) break;
    if (!message.text.trim()) continue;
    const text = message.text.slice(-remaining);
    result.push({ ...message, text });
    remaining -= text.length;
  }
  return result.reverse();
}
