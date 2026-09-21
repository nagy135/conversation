export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'closing';
export interface Transcript {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  startMs: number;
  endMs: number;
}
export interface LiveSnapshot {
  status: ConnectionStatus;
  speaking: boolean;
  thinking: boolean;
  error: string | null;
  audioBlocked: boolean;
  transcript: Transcript[];
}
export interface ServerEvent {
  type: string;
  event_id?: string;
  client_event_id?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  delegation?: { id: string; target: string };
  delegation_id?: string | null;
  event?: { type: string };
  reason?: string;
  error?: { message?: string; client_event_id?: string };
}
