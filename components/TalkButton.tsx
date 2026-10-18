import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { baseUrl, Config } from '../lib/config';

/** Push-to-talk: records while held, then uploads the clip; the hub plays it through the camera speaker. */
export function TalkButton({ config, id }: { config: Config; id: string }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [status, setStatus] = useState<'idle' | 'recording' | 'sending'>('idle');
  const held = useRef(false);

  const start = async () => {
    held.current = true;
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) return Alert.alert('Microphone permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!held.current) return; // released while preparing
      recorder.record();
      setStatus('recording');
    } catch (e) {
      Alert.alert('Could not start recording', (e as Error).message);
    }
  };

  const stop = async () => {
    held.current = false;
    if (status !== 'recording') return;
    setStatus('sending');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri) throw new Error('no audio captured');
      const blob = await (await fetch(recorder.uri)).blob();
      const r = await fetch(`${baseUrl(config)}/api/talk/${id}`, { method: 'POST', body: blob });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
    } catch (e) {
      Alert.alert('Talk failed', (e as Error).message);
    }
    setStatus('idle');
  };

  return (
    <Pressable style={[s.btn, status === 'recording' && s.live]} onPressIn={start} onPressOut={stop} disabled={status === 'sending'}>
      <Text style={s.text}>{status === 'recording' ? 'Release to send' : status === 'sending' ? 'Sending…' : 'Hold to talk'}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { backgroundColor: '#333', paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  live: { backgroundColor: '#dc2626' },
  text: { color: '#fff', fontWeight: '700' },
});
