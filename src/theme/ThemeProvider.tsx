import { useEffect, type PropsWithChildren } from 'react';
import type { ThemeMode } from '../app/model';

interface ThemeProviderProps extends PropsWithChildren {
  mode: ThemeMode;
}

export function ThemeProvider({ mode, children }: ThemeProviderProps) {
  useEffect(() => {
    const root = document.documentElement;
    if (mode !== 'system') {
      root.dataset.theme = mode;
      return;
    }

    if (typeof window.matchMedia !== 'function') {
      root.dataset.theme = 'light';
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applySystemTheme = (): void => {
      root.dataset.theme = media.matches ? 'dark' : 'light';
    };
    applySystemTheme();
    media.addEventListener('change', applySystemTheme);
    return () => media.removeEventListener('change', applySystemTheme);
  }, [mode]);

  return children;
}
