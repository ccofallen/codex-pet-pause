import { beforeEach, expect, test, vi } from 'vitest';
import { createBrowserNotifications } from './browserNotifications';

const payload = { title: 'Meow', body: 'Time to drink water.', tag: 'neko-pause-reminder' } as const;

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  static deliveries: Array<[string, NotificationOptions | undefined]> = [];
  static instances: FakeNotification[] = [];
  static failConstruction = false;
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(title: string, options?: NotificationOptions) {
    if (FakeNotification.failConstruction) throw new Error('constructor blocked');
    FakeNotification.deliveries.push([title, options]);
    FakeNotification.instances.push(this);
  }
}

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockReset();
  FakeNotification.deliveries = [];
  FakeNotification.instances = [];
  FakeNotification.failConstruction = false;
});

test('reports unavailable without the Notification API and never throws', async () => {
  const notifications = createBrowserNotifications(null);
  expect(notifications.status()).toBe('unavailable');
  await expect(notifications.request()).resolves.toBe('unavailable');
  await expect(notifications.notify(payload)).resolves.toBeUndefined();
});

test('requests permission only when request is explicitly called', async () => {
  FakeNotification.requestPermission.mockResolvedValue('denied');
  const notifications = createBrowserNotifications(FakeNotification as unknown as typeof Notification);
  expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

  await expect(notifications.request()).resolves.toBe('denied');

  expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
});

test('delivers the supplied localized payload', async () => {
  FakeNotification.permission = 'granted';
  const notifications = createBrowserNotifications(FakeNotification as unknown as typeof Notification);

  await notifications.notify(payload);

  expect(FakeNotification.deliveries).toEqual([
    ['Meow', { body: 'Time to drink water.', tag: 'neko-pause-reminder' }],
  ]);
});

test('focuses the app then closes a clicked notification', async () => {
  FakeNotification.permission = 'granted';
  const focusWindow = vi.fn();
  const notifications = createBrowserNotifications(
    FakeNotification as unknown as typeof Notification,
    focusWindow,
  );

  await notifications.notify(payload);
  FakeNotification.instances[0]?.onclick?.(new Event('click'));

  expect(focusWindow).toHaveBeenCalledTimes(1);
  expect(FakeNotification.instances[0]?.close).toHaveBeenCalledTimes(1);
  expect(focusWindow).toHaveBeenCalledBefore(FakeNotification.instances[0]!.close);
});

test('closes a clicked notification even when focus fails', async () => {
  FakeNotification.permission = 'granted';
  const focusWindow = vi.fn(() => { throw new Error('focus blocked'); });
  const notifications = createBrowserNotifications(
    FakeNotification as unknown as typeof Notification,
    focusWindow,
  );

  await notifications.notify(payload);
  expect(() => FakeNotification.instances[0]?.onclick?.(new Event('click'))).not.toThrow();

  expect(focusWindow).toHaveBeenCalledTimes(1);
  expect(FakeNotification.instances[0]?.close).toHaveBeenCalledTimes(1);
});

test('does not create a system notification without granted permission', async () => {
  const notifications = createBrowserNotifications(FakeNotification as unknown as typeof Notification);
  await notifications.notify(payload);
  expect(FakeNotification.deliveries).toEqual([]);
});

test('swallows notification constructor failures', async () => {
  FakeNotification.permission = 'granted';
  FakeNotification.failConstruction = true;
  const notifications = createBrowserNotifications(FakeNotification as unknown as typeof Notification);

  await expect(notifications.notify(payload)).resolves.toBeUndefined();
});
