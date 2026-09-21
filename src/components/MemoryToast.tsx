import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ConversationMemory } from '../live/memory';

import type { MemoryChange } from '../../server/memory-data.ts';

interface Notice { changes: MemoryChange[]; }
const describe = (change: MemoryChange) => `${change.kind === 'updated' ? 'Updated: ' : change.kind === 'removed' ? 'Forgot: ' : ''}${change.text}`;

export function MemoryToast({ memory }: { memory: ConversationMemory }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let previousRevision = memory.getSnapshot().revision;
    return memory.subscribe(() => {
      const current = memory.getSnapshot();
      if (current.busy) return;
      if (current.revision !== previousRevision && current.changes.length && !current.error) {
        setNotice({ changes: current.changes });
      } else if (!current.memories.length && !current.pending && !current.changes.length) {
        setNotice(null);
        setExpanded(false);
      }
      previousRevision = current.revision;
    });
  }, [memory]);

  useEffect(() => {
    if (!notice || expanded || focused) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice, expanded, focused]);

  if (!notice) return null;
  const title = notice.changes.every(change => change.kind === 'added') ? 'Remembered' : 'Memory updated';
  const dismiss = () => { setNotice(null); setExpanded(false); setFocused(false); };
  return (
    <View style={styles.position}>
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
              <Text style={styles.check}>✓</Text>
            </View>
            <View style={styles.heading}>
              <Text accessibilityLiveRegion="polite" style={styles.title}>{title}</Text>
              {!expanded && <Text numberOfLines={1} style={styles.preview}>{notice.changes.map(describe).join(' · ')}</Text>}
            </View>
            <Text style={styles.chevron}>{expanded ? '⌄' : '⌃'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss memory notification" onPress={dismiss} style={styles.dismiss}>
            <Text style={styles.dismissText}>×</Text>
          </Pressable>
        </View>
        {expanded && <View style={styles.details}>
          <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 12 }} accessibilityLabel="Memory changes">
            {notice.changes.map((change, index) => <Text key={index} selectable style={styles.summary}>{describe(change)}</Text>)}
          </ScrollView>
        </View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'fixed' as 'absolute', bottom: 24, right: 20, left: 20, zIndex: 10, pointerEvents: 'box-none', alignItems: 'flex-end' },
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
