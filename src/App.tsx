import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MemoryToast } from './components/MemoryToast';
import { LiveClient } from './live/client';

export default function App() {
  const [client] = useState(() => new LiveClient());
  const audio = useRef<HTMLAudioElement | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const memory = useSyncExternalStore(client.memory.subscribe, client.memory.getSnapshot, client.memory.getSnapshot);
  const [showMemory, setShowMemory] = useState(false);
  const active = state.status === 'connected';
  const busy = state.status === 'connecting' || state.status === 'closing';
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

  const label = state.status === 'connecting' ? 'Connecting…'
    : state.status === 'closing' ? 'Pausing…'
    : active ? state.speaking ? 'Speaking' : state.thinking ? 'Thinking' : 'Listening'
    : state.error ? 'Press play to reconnect.' : 'Paused. Press play to resume.';
  const buttonLabel = state.status === 'connecting' ? 'Cancel connection'
    : state.status === 'closing' ? 'Pausing conversation'
    : active ? 'Pause conversation' : 'Resume conversation';
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.wordmarkDot} />
        <Text style={styles.wordmark}>conversation</Text>
      </View>
      <View style={styles.main}>
        <View style={styles.stage}>
          <Pressable
            testID="play-button"
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            accessibilityHint={active ? 'Pauses voice and turns off your microphone. Your conversation is saved.' : 'Resumes your conversation using your microphone.'}
            disabled={state.status === 'closing'}
            onPress={() => {
              if (state.status !== 'idle') client.stop();
              else if (audio.current) void client.start(audio.current);
            }}
            style={({ pressed }) => [styles.play, active && styles.playActive, state.speaking && styles.speaking, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator size="large" color="#fffaf3" />
              : active ? <View style={styles.pauseIcon}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View> : <View style={styles.playIcon} />}
          </Pressable>
          <View style={styles.status}>
            {active && <View style={[styles.statusDot, state.speaking && styles.statusSpeaking]} />}
            <Text accessibilityLiveRegion="polite" style={styles.statusText}>{label}</Text>
          </View>
          {state.audioBlocked && (
            <Pressable accessibilityRole="button" onPress={() => void client.resumeAudio()} style={styles.soundButton}>
              <Text style={styles.soundText}>Tap to enable sound</Text>
            </Pressable>
          )}
          {state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
          {state.storageError && <Text accessibilityRole="alert" style={styles.error}>{state.storageError}</Text>}
          {state.status === 'idle' && (state.transcript.length > 0 || state.sources.length > 0 || state.sessionId) && (
            <Pressable accessibilityRole="button" onPress={() => {
              client.newConversation();
              if (audio.current) void client.start(audio.current);
            }} style={styles.soundButton}>
              <Text style={styles.soundText}>New conversation</Text>
            </Pressable>
          )}
          <View style={styles.transcriptArea}>
            {state.transcript.length === 0 ? (
              <Text style={styles.placeholder}>{active ? 'Your words will appear here.' : 'A little space to talk.'}</Text>
            ) : (
              <ScrollView
                ref={scroll}
                style={styles.transcript}
                contentContainerStyle={styles.transcriptContent}
                onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
                accessibilityLabel="Conversation transcript"
              >
                {state.transcript.map(entry => (
                  <View key={entry.id} style={styles.line}>
                    <Text style={styles.speaker}>{entry.role === 'user' ? 'YOU' : 'AI'}</Text>
                    <Text style={[styles.transcriptText, entry.role === 'user' && styles.userText]}>{entry.text.trim()}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
          {state.sources.length > 0 && (
            <View style={styles.sources}>
              <Text style={styles.sourcesLabel}>SOURCES</Text>
              <ScrollView
                style={styles.sourcesScroll}
                contentContainerStyle={styles.sourcesContent}
                accessibilityLabel="Conversation sources"
                nestedScrollEnabled
              >
                {state.sources.map(source => (
                  <Pressable key={source.url} accessibilityRole="link" accessibilityLabel={source.title} onPress={() => void Linking.openURL(source.url)}>
                    <Text style={styles.sourceLink}>{source.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
      <View style={styles.memoryArea}>
        <Pressable accessibilityRole="button" onPress={() => setShowMemory(!showMemory)}>
          <Text style={styles.soundText}>{memory.busy ? 'Reviewing memory…' : 'Memory'}{memory.pending.length ? ' · pending' : ''}</Text>
        </Pressable>
        {showMemory && <View style={styles.memoryDetails}>
          <Text style={styles.placeholder}>Facts, interests, and topics you discuss, saved in this browser.</Text>
          <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 12 }}>{memory.memories.length ? memory.memories.map((text, index) => <Text key={index} style={styles.transcriptText}>• {text}</Text>) : <Text style={styles.transcriptText}>Nothing remembered yet.</Text>}</ScrollView>
          {memory.pending.length > 0 && <Text style={styles.placeholder}>New speech is saved for memory review, including after reloading.</Text>}
          {memory.lastReview && <Text style={styles.placeholder}>Last reviewed at {new Date(memory.lastReview.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. {memory.lastReview.changes ? `${memory.lastReview.changes} ${memory.lastReview.changes === 1 ? 'memory change' : 'memory changes'}.` : 'No new memories needed.'}</Text>}
          {memory.error && <Text accessibilityRole="alert" style={styles.error}>{memory.error}</Text>}
          {memory.pending.length > 0 && !memory.busy && <Pressable accessibilityRole="button" onPress={() => void client.memory.summarize()}><Text style={styles.soundText}>Update memory</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={state.status !== 'idle'} onPress={client.memory.clear}><Text style={styles.soundText}>{state.status === 'idle' ? 'Clear memory' : 'Pause conversation to clear memory'}</Text></Pressable>
        </View>}
      </View>
      <Text style={styles.footer}>Just your voice. An AI listening.</Text>
      <MemoryToast memory={client.memory} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { minHeight: '100vh' as unknown as number, backgroundColor: '#f6f4ef', paddingHorizontal: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 32 },
  wordmarkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#bd533a' },
  wordmark: { fontSize: 16, letterSpacing: -0.5, color: '#383b32', fontWeight: '500' },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 55 },
  stage: { alignItems: 'center', width: '100%', maxWidth: 480 },
  play: { width: 190, height: 190, borderRadius: 95, backgroundColor: '#bd533a', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 35px rgba(132, 62, 39, 0.12)' },
  playActive: { backgroundColor: '#384c40' },
  speaking: { boxShadow: '0 0 0 12px rgba(56, 76, 64, 0.08), 0 0 0 25px rgba(56, 76, 64, 0.035)' },
  pressed: { transform: [{ scale: 0.96 }] },
  playIcon: { width: 0, height: 0, marginLeft: 10, borderTopWidth: 23, borderBottomWidth: 23, borderLeftWidth: 35, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#fffaf3' },
  pauseIcon: { flexDirection: 'row', gap: 12 },
  pauseBar: { width: 12, height: 40, borderRadius: 3, backgroundColor: '#fffaf3' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 32, minHeight: 22 },
  statusText: { color: '#50534a', fontSize: 14, letterSpacing: 0.1 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#748672' },
  statusSpeaking: { backgroundColor: '#bd533a' },
  transcriptArea: { height: 175, width: '100%', marginTop: 32 },
  placeholder: { color: '#85877e', textAlign: 'center', fontSize: 13, paddingTop: 8 },
  transcript: { flex: 1 },
  transcriptContent: { paddingTop: 8, paddingBottom: 16, gap: 16 },
  line: { flexDirection: 'row', gap: 15, alignItems: 'flex-start' },
  speaker: { width: 27, fontSize: 9, letterSpacing: 1, color: '#96988e', paddingTop: 5 },
  transcriptText: { flex: 1, fontSize: 14, lineHeight: 22, color: '#4b5548' },
  userText: { color: '#85867d' },
  error: { color: '#9a3c29', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 18, maxWidth: 360 },
  soundButton: { padding: 12, marginTop: 8 },
  soundText: { fontSize: 13, color: '#384c40', textDecorationLine: 'underline' },
  sources: { width: '100%', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#e2e5da', gap: 10 },
  sourcesScroll: { maxHeight: 112 },
  sourcesContent: { gap: 10, paddingBottom: 4 },
  sourcesLabel: { fontSize: 9, letterSpacing: 1, color: '#96988e' },
  sourceLink: { color: '#4b5548', fontSize: 12, lineHeight: 18, textDecorationLine: 'underline' },
  memoryArea: { alignItems: 'center', paddingBottom: 20, gap: 12 },
  memoryDetails: { width: '100%', maxWidth: 480, gap: 14 },
  footer: { fontSize: 11, color: '#94968b', letterSpacing: 0.4, textAlign: 'center', paddingBottom: 25 },
});
