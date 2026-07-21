export type AffinityLevel = 'new' | 'familiar' | 'close' | 'best-friend';

export const addAffinity = (value: number): number => Math.min(100, Math.max(0, value) + 1);

export function getAffinityLevel(value: number): AffinityLevel {
  if (value >= 60) return 'best-friend';
  if (value >= 30) return 'close';
  if (value >= 10) return 'familiar';
  return 'new';
}
