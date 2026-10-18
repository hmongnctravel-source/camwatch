import { Stack, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, baseUrl, Config, dayKey, fmtTime, Segment, useConfig } from '../../lib/config';

function SegmentPlayer({ uri, startAt, onEnd }: { uri: string; startAt: number; onEnd: () => void }) {
  const player = useVideoPlayer({ uri, contentType: 'progressive' }, p => {
    if (startAt > 0) p.currentTime = startAt;
    p.play();
  });
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => endRef.current());
    return () => sub.remove();
  }, [player]);
  return <VideoView player={player} style={s.video} nativeControls fullscreenOptions={{ enable: true }} />;
}

type Listing = { days: string[]; segments: Segment[] };

export default function Playback() {
  const { id, ts } = useLocalSearchParams<{ id: string; ts?: string }>();
  const { config } = useConfig();
  const target = ts ? Number(ts) : null;

  const [days, setDays] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [segs, setSegs] = useState<Segment[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = async (c: Config, date?: string) => {
    try {
      return await api<Listing>(c, `/api/recordings/${id}${date ? `?date=${date}` : ''}`);
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  // Initial load: list the days, then open the day of the tapped event (or the latest day).
  useEffect(() => {
    (async () => {
      const first = await load(config);
      if (!first) return;
      setDays(first.days);
      const want = target ? dayKey(target) : null;
      setDay(want && first.days.includes(want) ? want : (first.days.at(-1) ?? null));
    })();
  }, [config, id]);

  useEffect(() => {
    if (!day) return;
    (async () => {
      const l = await load(config, day);
      if (!l) return;
      setSegs(l.segments);
      // Jump to the segment containing the event, starting a few seconds before the motion.
      const hit = target ? l.segments.findIndex(x => target >= x.start && target < x.start + x.duration * 1000) : -1;
      setStartAt(hit >= 0 ? Math.max(0, (target! - l.segments[hit].start) / 1000 - 5) : 0);
      setIndex(hit >= 0 ? hit : l.segments.length ? 0 : null);
    })();
  }, [day]);

  const current = index !== null ? segs[index] : null;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Recordings' }} />
      {current ? (
        <SegmentPlayer
          key={current.url + startAt}
          uri={baseUrl(config) + current.url}
          startAt={startAt}
          onEnd={() => index !== null && index + 1 < segs.length && (setStartAt(0), setIndex(index + 1))}
        />
      ) : (
        <View style={[s.video, s.center]}>
          <Text style={s.muted}>{error ? `Error: ${error}` : days.length ? 'Pick a clip' : 'No recordings yet'}</Text>
        </View>
      )}

      <ScrollView horizontal style={s.days} contentContainerStyle={{ gap: 8, padding: 8 }} showsHorizontalScrollIndicator={false}>
        {days.map(d => (
          <Pressable key={d} style={[s.chip, d === day && s.chipOn]} onPress={() => setDay(d)}>
            <Text style={s.chipText}>{d.slice(5)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={segs}
        keyExtractor={x => x.name}
        renderItem={({ item, index: i }) => (
          <Pressable style={[s.seg, i === index && s.segOn]} onPress={() => (setStartAt(0), setIndex(i))}>
            <Text style={s.segText}>{fmtTime(item.start)}</Text>
            <Text style={s.muted}>{item.duration}s</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#111' },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#999' },
  days: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  chip: { backgroundColor: '#222', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16 },
  chipOn: { backgroundColor: '#2563eb' },
  chipText: { color: '#fff', fontWeight: '600' },
  seg: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  segOn: { backgroundColor: '#1e293b' },
  segText: { color: '#fff' },
});
