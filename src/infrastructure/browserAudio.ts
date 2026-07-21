import type { AudioPort } from '../app/appController';

export type AudioFactory = (source: string) => HTMLAudioElement | null;

const browserAudioFactory: AudioFactory = (source) => (
  typeof Audio === 'undefined' ? null : new Audio(source)
);

export function createBrowserAudio(
  factory: AudioFactory = browserAudioFactory,
  approvedSource: string | null = null,
): AudioPort {
  let audio: HTMLAudioElement | null | undefined;

  return {
    async play(): Promise<void> {
      if (approvedSource === null) return;
      try {
        audio ??= factory(approvedSource);
        if (audio === null) return;
        audio.currentTime = 0;
        audio.volume = 0.45;
        await audio.play();
      } catch {
        // The visual cat reminder and system notification remain authoritative.
      }
    },
  };
}
