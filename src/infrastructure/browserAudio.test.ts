import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { createBrowserAudio } from './browserAudio';

afterEach(() => vi.unstubAllGlobals());

test('does not construct or play webpage audio without an approved source', async () => {
  const factory = vi.fn();
  await createBrowserAudio(factory, null).play();
  expect(factory).not.toHaveBeenCalled();
});

test('plays and reuses only the explicitly approved source', async () => {
  const audio = { currentTime: 4, volume: 1, play: vi.fn(async () => undefined) };
  const factory = vi.fn(() => audio as unknown as HTMLAudioElement);
  const port = createBrowserAudio(factory, '/assets/cat/meow.wav');
  await port.play();
  await port.play();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledWith('/assets/cat/meow.wav');
  expect(audio.currentTime).toBe(0);
  expect(audio.volume).toBe(0.45);
  expect(audio.play).toHaveBeenCalledTimes(2);
});

test('supports the approved integration call with the browser factory defaulted', async () => {
  const audio = { currentTime: 4, volume: 1, play: vi.fn(async () => undefined) };
  const AudioConstructor = vi.fn(function AudioConstructor() { return audio; });
  vi.stubGlobal('Audio', AudioConstructor);

  await createBrowserAudio(undefined, '/assets/cat/meow.wav').play();

  expect(AudioConstructor).toHaveBeenCalledWith('/assets/cat/meow.wav');
  expect(audio.currentTime).toBe(0);
  expect(audio.volume).toBe(0.45);
});

test('wires the base-aware approved source into the application entry point', () => {
  expect(readFileSync('src/main.tsx', 'utf8')).toContain(
    'audio: createBrowserAudio(undefined, `${import.meta.env.BASE_URL}assets/cat/meow.wav`),',
  );
});

test('swallows missing audio and rejected playback', async () => {
  const unavailable = createBrowserAudio(() => null, '/assets/cat/meow.wav');
  const failedFactory = createBrowserAudio(() => { throw new Error('unavailable'); }, '/assets/cat/meow.wav');
  const blocked = createBrowserAudio(() => ({
    currentTime: 4,
    play: vi.fn(async () => { throw new Error('blocked'); }),
  } as unknown as HTMLAudioElement), '/assets/cat/meow.wav');

  await expect(unavailable.play()).resolves.toBeUndefined();
  await expect(failedFactory.play()).resolves.toBeUndefined();
  await expect(blocked.play()).resolves.toBeUndefined();
});
