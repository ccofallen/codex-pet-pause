import type { StandardPetAnimation } from './types';

export type AmbientAnimation = Extract<
  StandardPetAnimation,
  'waving' | 'jumping' | 'review' | 'running'
>;

const AMBIENT_ANIMATIONS: readonly AmbientAnimation[] = [
  'waving', 'jumping', 'review', 'running',
];

function normalizedRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ambientDelayMs(randomValue: number): number {
  return 12_000 + Math.round(normalizedRandom(randomValue) * 13_000);
}

export function ambientAnimation(randomValue: number): AmbientAnimation {
  const index = Math.min(
    AMBIENT_ANIMATIONS.length - 1,
    Math.floor(normalizedRandom(randomValue) * AMBIENT_ANIMATIONS.length),
  );
  return AMBIENT_ANIMATIONS[index]!;
}
