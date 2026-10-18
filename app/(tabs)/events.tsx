import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, baseUrl, fmtDateTime, isConfigured, MotionEvent, useConfig } from '../../lib/config';

export default function Events() {
  const router = useRouter();
  const { config, cameras } = useConfig();
  const [events, setEvents] = useState<MotionEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isConfigured(config)) return;
    setRefreshing(true);
    try {
      setEvents(await api<MotionEvent[]>(config, '/api/events?limit=100'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setRefreshing(false);
  }, [config]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const name = (id: string) => cameras.find(c => c.id === id)?.name ?? id;

  return (
    <FlatList
      data={events}
      keyExtractor={e => e.id}
      refreshing={refreshing}
      onRefresh={load}
      ListEmptyComponent={<Text style={s.empty}>{error ? `Error: ${error}` : 'No motion events yet.'}</Text>}
      renderItem={({ item }) => (
        <Pressable style={s.row} onPress={() => router.push(`/playback/${item.camera}?ts=${item.start}`)}>
          {item.thumbUrl ? (
            <Image source={{ uri: baseUrl(config) + item.thumbUrl }} style={s.thumb} />
          ) : (
            <View style={[s.thumb, { backgroundColor: '#222' }]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{name(item.camera)}</Text>
            <Text style={s.sub}>{fmtDateTime(item.start)}</Text>
            <Text style={s.sub}>{Math.max(1, Math.round((item.end - item.start) / 1000))}s of motion</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  thumb: { width: 128, height: 72, borderRadius: 6 },
  title: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sub: { color: '#999', marginTop: 2 },
  empty: { color: '#999', textAlign: 'center', marginTop: 48 },
});
