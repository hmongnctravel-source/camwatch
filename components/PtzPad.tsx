import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, Config } from '../lib/config';

type Dir = 'up' | 'down' | 'left' | 'right';
const send = (config: Config, id: string, dir: Dir | 'stop', ms?: number) =>
  api(config, `/api/ptz/${id}`, { method: 'POST', body: JSON.stringify({ dir, ms }) }).catch(() => {});

function Btn({ config, id, dir, label }: { config: Config; id: string; dir: Dir; label: string }) {
  // Hold to move: the hub caps a move at 3s as a safety net, release sends an explicit stop.
  return (
    <Pressable
      style={({ pressed }) => [s.btn, pressed && { backgroundColor: '#2563eb' }]}
      onPressIn={() => send(config, id, dir, 3000)}
      onPressOut={() => send(config, id, 'stop')}
    >
      <Text style={s.arrow}>{label}</Text>
    </Pressable>
  );
}

export function PtzPad({ config, id }: { config: Config; id: string }) {
  return (
    <View style={s.pad}>
      <View style={s.row}><Btn config={config} id={id} dir="up" label="▲" /></View>
      <View style={s.row}>
        <Btn config={config} id={id} dir="left" label="◀" />
        <View style={s.gap} />
        <Btn config={config} id={id} dir="right" label="▶" />
      </View>
      <View style={s.row}><Btn config={config} id={id} dir="down" label="▼" /></View>
    </View>
  );
}

const s = StyleSheet.create({
  pad: { alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row' },
  gap: { width: 56 },
  btn: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#fff', fontSize: 22 },
});
