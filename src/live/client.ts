import { LiveTransport } from './transport';
import { LiveTranscripts } from './transcripts';
import type { LiveSnapshot, ServerEvent } from './types';

const initial = (): LiveSnapshot => ({
  status: 'idle', speaking: false, thinking: false, error: null,
  audioBlocked: false, transcript: [],
});

export class LiveClient {
  private snapshot = initial();
  private listeners = new Set<() => void>();
  private transport: LiveTransport | null = null;
  private transcripts = new LiveTranscripts();
  private working = new Set<string>();
  private greeting: string | null = null;
  private sequence = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<LiveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  async start(audio: HTMLAudioElement) {
    if (this.transport) return;
    this.transcripts = new LiveTranscripts();
    this.working.clear();
    this.update({ ...initial(), status: 'connecting' });
    const transport = new LiveTransport(audio, {
      onEvent: event => { if (this.transport === transport) this.handle(event); },
      onError: error => { if (this.transport === transport) this.finish(error); },
      onSpeaking: speaking => {
        if (this.transport === transport && this.snapshot.status === 'connected') this.update({ speaking });
      },
      onAudioBlocked: () => { if (this.transport === transport) this.update({ audioBlocked: true }); },
    });
    this.transport = transport;
    await transport.connect();
  }
  stop = () => {
    if (this.snapshot.status === 'closing') return;
    if (this.snapshot.status !== 'connected') { this.finish(); return; }
    this.greeting = null;
    this.transport?.silence();
    this.update({ status: 'closing', speaking: false, thinking: false, audioBlocked: false });
    this.closeTimer = setTimeout(() => this.finish(), 5000);
    this.transport?.send({ type: 'session.close', event_id: `close-${++this.sequence}` });
  };
  dispose = () => {
    this.transport?.send({ type: 'session.close', event_id: `close-${++this.sequence}` });
    this.finish();
  };
  resumeAudio = async () => {
    const transport = this.transport;
    if (!transport) return;
    try {
      await transport.resumeAudio();
      if (this.transport === transport) this.update({ audioBlocked: false, error: null });
    } catch {
      if (this.transport === transport) this.update({ error: 'Allow sound in your browser to hear the conversation.' });
    }
  };
  private finish(error?: string) {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.greeting = null;
    this.transport?.close();
    this.transport = null;
    this.working.clear();
    this.update({ status: 'idle', speaking: false, thinking: false, audioBlocked: false, ...(error ? { error } : {}) });
  }
  private handle(event: ServerEvent) {
    if (event.type === 'session.closed') { this.finish(); return; }
    if (this.snapshot.status === 'closing') return;
    switch (event.type) {
      case 'session.started':
        if (this.snapshot.status !== 'connecting') return;
        this.update({ status: 'connected' });
        this.greeting = `greeting-${++this.sequence}`;
        this.transport?.send({
          type: 'session.instructions.append', event_id: this.greeting, delegation_id: null,
          content: 'The user pressed play. Greet them briefly in English: Hi! What’s on your mind? Then listen. Follow their language when they reply.',
        });
        break;
      case 'session.instructions.appended':
        if (this.greeting && event.client_event_id === this.greeting) {
          this.greeting = null;
          if (!this.snapshot.transcript.length && !this.snapshot.speaking) this.transport?.send({
            type: 'session.commentary.append', event_id: `cue-${++this.sequence}`, delegation_id: null,
            content: 'Begin with the brief greeting now, following the greeting instructions.',
          });
        }
        break;
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta':
        this.transcripts.append(event);
        this.update({ transcript: this.transcripts.entries });
        break;
      case 'session.delegation.created':
        if (event.delegation) this.working.add(event.delegation.id);
        this.update({ thinking: this.working.size > 0 });
        break;
      case 'response.event':
        if (event.event && ['response.completed', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(event.event.type)) {
          if (event.delegation_id) this.working.delete(event.delegation_id);
          this.update({ thinking: this.working.size > 0 });
        }
        break;
      case 'error':
        if (event.error?.client_event_id === this.greeting) this.greeting = null;
        this.update({ error: 'The voice service had a problem. Try speaking again, or restart the conversation.' });
        break;
    }
  }
}
