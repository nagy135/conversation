import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MemoryToast } from './components/MemoryToast';
import { LiveClient } from './live/client';
import { avatars, defaultAvatar } from './avatars';

const TalkingFace = lazy(() => import('./components/TalkingFace').then(module => ({ default: module.TalkingFace })));

function Icon({ name }: { name: 'plus' | 'transcript' | 'pause' | 'play' | 'mic' | 'close' | 'memory' | 'arrow' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'plus' && <path d="M12 5v14M5 12h14" />}
    {name === 'transcript' && <><path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h7" /></>}
    {name === 'pause' && <><path strokeWidth="3" d="M8 6v12M16 6v12" /></>}
    {name === 'play' && <path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none" />}
    {name === 'mic' && <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6" /></>}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'memory' && <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z" /><path d="M19 3v4M17 5h4" /></>}
    {name === 'arrow' && <path d="M7 17 17 7M7 7h10v10" />}
  </svg>;
}

export default function App() {
  const [avatar, setAvatar] = useState(defaultAvatar);
  const [client] = useState(() => new LiveClient());
  const audio = useRef<HTMLAudioElement | null>(null);
  const scroll = useRef<HTMLDivElement | null>(null);
  const liveChat = useRef<HTMLDivElement | null>(null);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const memory = useSyncExternalStore(client.memory.subscribe, client.memory.getSnapshot, client.memory.getSnapshot);
  const [showMemory, setShowMemory] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const memoryMenu = useRef<HTMLDivElement | null>(null);
  const memoryToggle = useRef<HTMLButtonElement | null>(null);
  const transcriptToggle = useRef<HTMLButtonElement | null>(null);
  const transcriptPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showMemory) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !memoryMenu.current?.contains(event.target)) setShowMemory(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowMemory(false);
        memoryToggle.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [showMemory]);

  useEffect(() => {
    if (showTranscript) transcriptPanel.current?.focus();
  }, [showTranscript]);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    if (liveChat.current) liveChat.current.scrollTop = liveChat.current.scrollHeight;
  }, [state.transcript, showTranscript]);

  useEffect(() => {
    const chat = liveChat.current;
    if (!chat) return;
    const observer = new ResizeObserver(() => { chat.scrollTop = chat.scrollHeight; });
    observer.observe(chat);
    if (chat.firstElementChild) observer.observe(chat.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const active = state.status === 'connected';
  const busy = state.status === 'connecting' || state.status === 'closing';
  const speaking = active && state.speaking && !state.audioBlocked;
  useEffect(() => {
    const element = document.createElement('audio');
    element.autoplay = true;
    element.setAttribute('playsinline', '');
    audio.current = element;
    client.memory.resume();
    // Defer past StrictMode's setup/cleanup probe so joining creates only one connection.
    let mounted = true;
    queueMicrotask(() => { if (mounted) void client.start(element); });
    const leave = () => client.dispose();
    const returnToPage = (event: PageTransitionEvent) => { if (event.persisted) void client.start(element); };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', returnToPage);
    return () => {
      mounted = false;
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', returnToPage);
      client.dispose();
      audio.current = null;
    };
  }, [client]);

  const buttonLabel = state.status === 'connecting' ? 'Cancel connection'
    : state.status === 'closing' ? 'Pausing conversation'
    : active ? 'Pause conversation' : 'Resume conversation';
  const closeTranscript = () => { setShowTranscript(false); transcriptToggle.current?.focus(); };

  return (
    <div className={`app-page${showTranscript ? ' transcript-open' : ''}`} data-testid="app-page">
      <header className="app-header" data-testid="app-header">
        <a className="brand" href="/" aria-label="Conversation home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>conversation<span className="brand-period">.</span></a>
        <nav aria-label="Conversation controls">
          <button ref={transcriptToggle} type="button" className={`quiet-button transcript-toggle${showTranscript ? ' selected' : ''}`} aria-expanded={showTranscript} aria-controls="conversation-transcript" onClick={() => setShowTranscript(value => !value)}>
            <Icon name="transcript" /><span>Full history</span>{state.sources.length > 0 && <span className="source-count">{state.sources.length}<span className="sr-only"> sources</span></span>}
          </button>
          <span className="header-divider" />
          <button data-testid="new-conversation" type="button" className="quiet-button" title="Start a new conversation. Your memories stay with you." onClick={() => { if (audio.current) void client.newConversation(audio.current); }}>
            <Icon name="plus" /><span>New conversation</span>
          </button>
        </nav>
      </header>

      <main className="conversation-stage">
        <div className="portrait">
          <Suspense fallback={<div className="scene-loading" aria-hidden="true"><span /></div>}>
            <TalkingFace key={avatar.id} avatar={avatar} active={active} speaking={speaking} thinking={state.thinking} voiceActivity={client.voiceActivity} />
          </Suspense>
        </div>
        <div ref={liveChat} className="live-chat" role="log" aria-label="Recent conversation" aria-live="off" tabIndex={0}>
          <div>{state.transcript.length ? state.transcript.slice(-4).map(entry => <div key={entry.id} className={`chat-message ${entry.role}`}>
            <span className="chat-speaker">{entry.role === 'user' ? 'You' : 'Companion'}</span>
            <p>{entry.text.trim()}</p>
          </div>) : <p className="chat-placeholder">Your conversation will appear here.</p>}</div>
        </div>
        {(state.audioBlocked || state.error || state.storageError) && <div className="notices">
          {state.audioBlocked && <button type="button" className="sound-button" onClick={() => void client.resumeAudio()}>Tap to enable sound <span aria-hidden="true">↗</span></button>}
          {state.error && <p role="alert">{state.error}</p>}
          {state.storageError && <p role="alert">{state.storageError}</p>}
        </div>}
        <div className="conversation-dock">
          <span className={`mic-state${active ? ' on' : ''}`}><Icon name="mic" /><span>Mic {active ? 'on' : 'off'}</span></span>
          <span className="dock-divider" />
          <button
            data-testid="play-button"
            type="button"
            className={`play-button${active ? ' active' : ''}`}
            aria-label={buttonLabel}
            disabled={state.status === 'closing'}
            onClick={() => {
              if (state.status !== 'idle') client.stop();
              else if (audio.current) void client.start(audio.current);
            }}
          >
            {busy ? <span className="status-spinner" aria-hidden="true" /> : <Icon name={active ? 'pause' : 'play'} />}
            <span>{state.status === 'connecting' ? 'Cancel' : state.status === 'closing' ? 'Pausing…' : active ? 'Pause' : 'Let’s talk'}</span>
          </button>
        </div>
      </main>

      {showTranscript && <aside id="conversation-transcript" ref={transcriptPanel} tabIndex={-1} className="transcript-panel" aria-label="Conversation transcript" onKeyDown={event => { if (event.key === 'Escape') closeTranscript(); }}>
        <div className="panel-header"><div><span className="eyebrow">OUR CONVERSATION</span><h2>A few words between us.</h2></div><button type="button" className="icon-button" aria-label="Close transcript" onClick={closeTranscript}><Icon name="close" /></button></div>
        <div className="transcript-scroll" ref={scroll} tabIndex={0} aria-label="Transcript messages">
          {state.transcript.length ? state.transcript.map(entry => <div key={entry.id} className={`transcript-line ${entry.role}`}><span className="eyebrow">{entry.role === 'user' ? 'YOU' : 'COMPANION'}</span><p>{entry.text.trim()}</p></div>) : <div className="transcript-empty"><Icon name="transcript" /><p>Every conversation<br />starts with a hello.</p><span>Your words will appear here.</span></div>}
        </div>
        {state.sources.length > 0 && <section className="sources" aria-label="Conversation sources"><div className="sources-header"><span className="eyebrow">MENTIONED ALONG THE WAY</span><button type="button" onClick={client.clearSources}>Clear sources</button></div><div className="source-list">{state.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<Icon name="arrow" /></a>)}</div></section>}
        <div className="transcript-footnote">Saved in this browser, so we can pick up where we left off.</div>
      </aside>}

      <footer className="app-footer">
        <div ref={memoryMenu} className="memory-menu" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setShowMemory(false);
        }}>
          <button ref={memoryToggle} type="button" className="memory-toggle" aria-expanded={showMemory} aria-controls="memory-details" onClick={() => setShowMemory(value => !value)}>
            <Icon name="memory" />Memory<span className="memory-count">{memory.memories.length}</span>
          </button>
          {showMemory && <section id="memory-details" aria-label="Memory management" className="memory-panel">
            <div><span className="eyebrow">THE LITTLE THINGS THAT STAY</span><h2>Getting to know you.</h2></div>
            <div className="memory-list">{memory.memories.length ? memory.memories.map((text, index) => <p key={index}>{text}</p>) : <p>Nothing remembered yet. That comes with conversation.</p>}</div>
            <div data-testid="reset-actions" className="reset-actions"><button type="button" className="wipe-button" onClick={() => {
              if (window.confirm('Wipe all data saved in this browser for this app, including your conversation and memory? This cannot be undone.')) client.clearAll();
            }}>Wipe everything<span>Conversation + memory</span></button></div>
          </section>}
        </div>
        <div className="avatar-picker">
          <label htmlFor="avatar-choice">Avatar</label>
          <select id="avatar-choice" value={avatar.id} onChange={event => {
            const next = avatars.find(option => option.id === event.target.value);
            if (next) setAvatar(next);
          }}>
            {avatars.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <a className="avatar-credit" href="/models/credits.html" target="_blank" rel="noopener noreferrer">{avatar.credit} · Credits</a>
        </div>
      </footer>
      <MemoryToast memory={client.memory} />
    </div>
  );
}
