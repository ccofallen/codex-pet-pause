import type { AudioPort, NotificationPort } from '../../app/appController';

export function createAndroidNotifications(): NotificationPort {
  return {
    status: () => 'unavailable',
    async request() { return 'unavailable'; },
    async notify() {},
  };
}

export function createAndroidAudio(): AudioPort {
  return {
    async play() {},
  };
}
