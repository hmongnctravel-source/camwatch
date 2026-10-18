import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Config, hlsUrl, isConfigured, useConfig } from '../../lib/config';

function Tile({ config, cam, onPress }: { config: Config; cam: Camera; onPress: () => void }) {
  const player = useVideoPlayer({ uri: hlsUrl(config, cam), contentType: 'hls' }, p => {
    p.muted = true;
    p.play();
  });
  return (
    <Pressable style={s.tile} onPress={onPress}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="cover" />
      <Text style={s.label}>{cam.name}</Text>
    </Pressable>
  );
}

export default function Live() {
  const router = useRouter();
  const { config, loaded, cameras, error, refresh } = useConfig();
  if (!loaded) return null;

  if (!isConfigured(config) || error || cameras.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.text}>
          {!isConfigured(config)
            ? 'Connect to your CamWatch hub to get started.'
            : error
              ? `Can't reach the hub: ${error}`
              : 'The hub has no cameras configured.'}
        </Text>
        <Pressable style={s.btn} onPress={() => (isConfigured(config) ? refresh() : router.push('/settings'))}>
          <Text style={s.btnText}>{isConfigured(config) ? 'Retry' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={cameras}
      keyExtractor={c => c.id}
      numColumns={2}
      renderItem={({ item }) => <Tile config={config} cam={item} onPress={() => router.push(`/camera/${item.id}`)} />}
    />
  );
}

const s = StyleSheet.create({
  tile: { flex: 1, aspectRatio: 16 / 9, margin: 4, backgroundColor: '#111', borderRadius: 8, overflow: 'hidden' },
  label: { position: 'absolute', left: 8, bottom: 6, color: '#fff', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  text: { color: '#ccc', fontSize: 16, textAlign: 'center' },
  btn: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '600' },
});
