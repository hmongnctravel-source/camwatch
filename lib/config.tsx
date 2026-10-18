import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Config = { server: string; token: string };
export type Camera = { id: string; name: string; stream: string; ptz: boolean; talk: boolean; record: string };
export type MotionEvent = { id: string; camera: string; start: number; end: number; thumbUrl: string | null };
export type Segment = { name: string; start: number; duration: number; url: string };

const KEY = 'camwatch.config.v2';

export const normalizeServer = (s: string) => s.trim().replace(/\/+$/, '');
export const isConfigured = (c: Config) => !!c.server && !!c.token;
/** All hub URLs carry the token in the path so HLS sub-requests and <Image>/<Video> sources stay authenticated. */
export const baseUrl = (c: Config) => `${c.server}/t/${encodeURIComponent(c.token)}`;
export const hlsUrl = (c: Config, cam: Camera) =>
  `${baseUrl(c)}/go2rtc/api/stream.m3u8?src=${encodeURIComponent(cam.stream)}&mp4`;

export async function api<T>(c: Config, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(baseUrl(c) + path, init);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

type Ctx = {
  config: Config;
  loaded: boolean;
  save: (c: Config) => Promise<void>;
  cameras: Camera[];
  error: string | null;
  refresh: () => Promise<void>;
};
const Context = createContext<Ctx | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>({ server: '', token: '' });
  const [loaded, setLoaded] = useState(false);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setConfig(JSON.parse(raw));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!isConfigured(config)) return setCameras([]);
    try {
      setCameras(await api<Camera[]>(config, '/api/cameras'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [config]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (c: Config) => {
    const next = { server: normalizeServer(c.server), token: c.token.trim() };
    setConfig(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }, []);

  const value = useMemo(() => ({ config, loaded, save, cameras, error, refresh }), [config, loaded, save, cameras, error, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConfig() {
  const v = useContext(Context);
  if (!v) throw new Error('useConfig outside ConfigProvider');
  return v;
}

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
