import type { Translator } from './messages';

export type Locale = 'zh-CN' | 'en';

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
