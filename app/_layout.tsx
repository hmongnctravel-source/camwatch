import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ConfigProvider, isConfigured, useConfig } from '../lib/config';
import { registerForPush } from '../lib/push';

function Shell() {
  const router = useRouter();
  const { config, loaded } = useConfig();

  useEffect(() => {
    if (loaded && isConfigured(config)) registerForPush(config);
  }, [loaded, config]);

  useEffect(() => {
    const open = (data?: Record<string, unknown>) => {
      if (typeof data?.cameraId === 'string') router.push(`/camera/${data.cameraId}`);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(r => open(r.notification.request.content.data));
    Notifications.getLastNotificationResponseAsync().then(r => r && open(r.notification.request.content.data));
    return () => sub.remove();
  }, [router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#111' },
        headerTintColor: '#fff',
        contentStyle: { backgroundColor: '#000' },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="camera/[id]" options={{ title: 'Live' }} />
      <Stack.Screen name="playback/[id]" options={{ title: 'Recordings' }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <ConfigProvider>
      <StatusBar style="light" />
      <Shell />
    </ConfigProvider>
  );
}
