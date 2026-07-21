import { createContext, useContext, useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { translate } from './messages';
import type { I18n, Locale } from './types';

const I18nContext = createContext<I18n | undefined>(undefined);

interface I18nProviderProps {
  locale: Locale;
  children: ReactNode;
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  const i18n = useMemo<I18n>(() => ({
    locale,
    t: (key, ...args) => translate(locale, key, ...args),
    formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
    formatTime: (timestamp) => new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp),
  }), [locale]);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'document.title');
  }, [locale]);

  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value === undefined) throw new Error('useI18n must be used within an I18nProvider');
  return value;
}
