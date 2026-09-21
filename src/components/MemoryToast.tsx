import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ConversationMemory } from '../live/memory';

interface Notice { phase: 'saving' | 'saved' | 'error'; summary: string; error: string | null; }

export function MemoryToast({ memory }: { memory: ConversationMemory }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let wasBusy = memory.getSnapshot().busy;
    let previousRevision = memory.getSnapshot().revision;
    return memory.subscribe(() => {
      const current = memory.getSnapshot();
      if (current.busy && !wasBusy) {
        setNotice({ phase: 'saving', summary: current.summary, error: null });
      } else if (wasBusy && !current.busy) {
        if (current.revision === previousRevision && !current.error) {
          setNotice(null);
          setExpanded(false);
        } else {
          setNotice({ phase: current.error ? 'error' : 'saved', summary: current.summary, error: current.error });
        }
      } else if (!current.busy && !current.summary && !current.pending && !current.error) {
        setNotice(null);
        setExpanded(false);
      }
      if (!current.busy) previousRevision = current.revision;
      wasBusy = current.busy;
    });
  }, [memory]);

  useEffect(() => {
    if (!notice || notice.phase === 'saving' || expanded || focused) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice, expanded, focused]);

  if (!notice) return null;
  const title = notice.phase === 'saving' ? 'Updating memory…' : notice.phase === 'saved' ? 'Memory saved' : 'Memory needs attention';
  const dismiss = () => { setNotice(null); setExpanded(false); setFocused(false); };
  return (
    <View style={styles.position} pointerEvents="box-none">
      <View testID="memory-toast" style={[styles.bubble, expanded && styles.expanded]}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${expanded ? 'Collapse' : 'Expand'} memory`}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(value => !value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={styles.toggle}
          >
            <View style={styles.icon}>
              {notice.phase === 'saving' ? <ActivityIndicator size="small" color="#384c40" />
                : <Text style={styles.check}>{notice.phase === 'saved' ? '✓' : '!'}</Text>}
            </View>
            <View style={styles.heading}>
              <Text accessibilityLiveRegion="polite" style={styles.title}>{title}</Text>
              {!expanded && <Text numberOfLines={1} style={styles.preview}>{notice.error || notice.summary || 'Gathering what we talked about…'}</Text>}
            </View>
            <Text style={styles.chevron}>{expanded ? '⌄' : '⌃'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss memory notification" onPress={dismiss} style={styles.dismiss}>
            <Text style={styles.dismissText}>×</Text>
          </Pressable>
        </View>
        {expanded && <View style={styles.details}>
          {notice.phase === 'saving' && <Text style={styles.caption}>Adding our recent conversation. {notice.summary ? 'Previous memory below.' : ''}</Text>}
          {notice.error && <Text accessibilityRole="alert" style={styles.error}>{notice.error}</Text>}
          <ScrollView style={styles.scroll} accessibilityLabel="Summarized memory">
            <Text selectable style={styles.summary}>{notice.summary || 'Your summary will appear here when it is ready.'}</Text>
          </ScrollView>
        </View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'fixed' as 'absolute', bottom: 24, right: 20, left: 20, zIndex: 10, alignItems: 'flex-end' },
  bubble: { width: '100%', maxWidth: 330, borderRadius: 22, backgroundColor: '#fffdf8', borderWidth: 1, borderColor: '#e2e5da', boxShadow: '0 8px 32px rgba(38, 52, 42, 0.15)', overflow: 'hidden' },
  expanded: { maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center' },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingLeft: 14, paddingRight: 4, minWidth: 0 },
  icon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#eaf0e7', alignItems: 'center', justifyContent: 'center' },
  check: { color: '#384c40', fontSize: 17 },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 13, fontWeight: '600', color: '#384c40' },
  preview: { fontSize: 12, color: '#777e70' },
  chevron: { color: '#777e70', fontSize: 18 },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 22, color: '#777e70' },
  details: { paddingHorizontal: 18, paddingBottom: 18, gap: 10 },
  caption: { fontSize: 12, lineHeight: 18, color: '#777e70' },
  error: { fontSize: 12, lineHeight: 18, color: '#9a3c29' },
  scroll: { maxHeight: '40vh' as unknown as number },
  summary: { fontSize: 14, lineHeight: 22, color: '#4b5548' },
});
