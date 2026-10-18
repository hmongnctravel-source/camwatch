import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PtzPad } from '../../components/PtzPad';
import { TalkButton } from '../../components/TalkButton';
import { Camera, Config, hlsUrl, useConfig } from '../../lib/config';

function Live({ config, cam }: { config: Config; cam: Camera }) {
  const router = useRouter();
  const player = useVideoPlayer({ uri: hlsUrl(config, cam), contentType: 'hls' }, p => p.play());
  return (
    <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
      <Stack.Screen options={{ title: cam.name }} />
      <VideoView player={player} style={s.video} nativeControls allowsPictureInPicture fullscreenOptions={{ enable: true }} />
      <View style={s.section}>
        <Pressable style={s.alt} onPress={() => router.push(`/playback/${cam.id}`)}>
          <Text style={s.btnText}>Recordings & playback</Text>
        </Pressable>
        {cam.talk && <TalkButton config={config} id={cam.id} />}
        {cam.ptz && <PtzPad config={config} id={cam.id} />}
      </View>
    </ScrollView>
  );
}

export default function CameraScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { config, loaded, cameras } = useConfig();
  const cam = cameras.find(c => c.id === id);
  if (!loaded) return null;
  if (!cam) return <Text style={s.text}>Camera not found.</Text>;
  return <Live config={config} cam={cam} />;
}

const s = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#111' },
  section: { paddingHorizontal: 16, gap: 16 },
  text: { color: '#ccc', padding: 20 },
  alt: { backgroundColor: '#333', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
});
