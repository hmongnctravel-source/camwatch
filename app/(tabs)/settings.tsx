import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { api, Camera, Config, normalizeServer } from '../../lib/config';
import { useConfig } from '../../lib/config';
import { registerForPush } from '../../lib/push';

export default function Settings() {
  const { config, loaded, save, refresh } = useConfig();
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (loaded) {
      setServer(config.server);
      setToken(config.token);
    }
  }, [loaded, config]);

  const draft = (): Config => ({ server: normalizeServer(server), token: token.trim() });

  const test = async () => {
    setMsg('Testing…');
    try {
      const cams = await api<Camera[]>(draft(), '/api/cameras');
      setMsg(`Connected: ${cams.length} camera(s) found`);
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    }
  };

  const onSave = async () => {
    await save(draft());
    await refresh();
    setMsg(await registerForPush(draft()));
  };

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.h}>Hub address</Text>
      <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false}
        placeholder="http://192.168.1.10:8080 or https://cams.example.com" placeholderTextColor="#666" />
      <Text style={s.h}>Access token</Text>
      <TextInput style={s.input} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false}
        secureTextEntry placeholder="token from hub/config.json" placeholderTextColor="#666" />
      <Pressable style={s.alt} onPress={test}><Text style={s.btnText}>Test connection</Text></Pressable>
      <Pressable style={s.btn} onPress={onSave}><Text style={s.btnText}>Save & enable alerts</Text></Pressable>
      {!!msg && <Text style={s.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10 },
  h: { color: '#fff', fontWeight: '700', fontSize: 16, marginTop: 8 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8 },
  btn: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  alt: { backgroundColor: '#333', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '600' },
  msg: { color: '#9ca3af', marginTop: 8 },
});
