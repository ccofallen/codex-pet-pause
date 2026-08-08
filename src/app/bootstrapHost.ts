export type BootstrapHost = 'web' | 'android';

export const selectBootstrap = (value: string | undefined): BootstrapHost =>
  value === 'android' ? 'android' : 'web';
