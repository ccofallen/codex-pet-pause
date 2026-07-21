import type { NotificationPort } from '../app/appController';
import type { NotificationStatus } from '../app/model';

export type FocusWindow = () => void;

const focusBrowserWindow: FocusWindow = () => window.focus();

function browserNotification(): typeof Notification | null {
  return typeof Notification === 'undefined' ? null : Notification;
}

function permissionStatus(api: typeof Notification | null): NotificationStatus {
  return api === null ? 'unavailable' : api.permission;
}

export function createBrowserNotifications(
  api: typeof Notification | null = browserNotification(),
  focusWindow: FocusWindow = focusBrowserWindow,
): NotificationPort {
  return {
    status(): NotificationStatus {
      return permissionStatus(api);
    },

    async request(): Promise<NotificationStatus> {
      if (api === null) return 'unavailable';
      try {
        return await api.requestPermission();
      } catch {
        return permissionStatus(api);
      }
    },

    async notify(payload): Promise<void> {
      if (api === null || api.permission !== 'granted') return;
      try {
        const delivery = new api(payload.title, { body: payload.body, tag: payload.tag });
        delivery.onclick = () => {
          try {
            focusWindow();
          } catch {
            // The user can still return to the in-page reminder manually.
          } finally {
            delivery.close();
          }
        };
      } catch {
        // In-page reminders remain authoritative when system delivery fails.
      }
    },
  };
}
