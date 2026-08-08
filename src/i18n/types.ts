import type { Translator } from './messages';

export const supportedLocales = ['zh-CN', 'en'] as const;

export type Locale = typeof supportedLocales[number];

export type WidenMessage<T> = T extends (...args: infer P) => string
  ? (...args: P) => string
  : string;

export type CatalogFrom<T extends Record<string, unknown>> = {
  [K in keyof T]: WidenMessage<T[K]>;
};

export interface I18n {
  locale: Locale;
  t: Translator;
  formatNumber(value: number): string;
  formatTime(timestamp: number): string;
}
