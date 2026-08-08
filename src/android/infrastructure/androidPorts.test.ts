import { expect, test } from 'vitest';
import { createAndroidAudio, createAndroidNotifications } from './androidPorts';

test('reports unavailable Android notifications without requesting or delivering browser notifications', async () => {
  const notifications = createAndroidNotifications();

  expect(notifications.status()).toBe('unavailable');
  await expect(notifications.request()).resolves.toBe('unavailable');
  await expect(notifications.notify({ title: 'Meow', body: 'Take a break', tag: 'neko-pause-reminder' })).resolves.toBeUndefined();
});

test('keeps Android audio safe until native playback is connected', async () => {
  await expect(createAndroidAudio().play()).resolves.toBeUndefined();
});
