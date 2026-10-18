import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api, Config } from './config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Registers this device's Expo push token with the hub. Returns a human-readable status. */
export async function registerForPush(config: Config): Promise<string> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('motion', {
        name: 'Motion alerts',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'Notification permission denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'No EAS projectId: run "eas init" to enable push notifications';
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api(config, '/api/devices', { method: 'POST', body: JSON.stringify({ token }) });
    return 'Push notifications enabled';
  } catch (e) {
    return `Push setup failed: ${(e as Error).message}`;
  }
}
