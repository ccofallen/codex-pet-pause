import { act, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ThemeProvider } from './ThemeProvider';

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() { return matches; },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
  return {
    setMatches(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent)));
    },
  };
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

test('applies explicit light and dark themes to the document', () => {
  const view = render(<ThemeProvider mode="light"><span>child</span></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe('light');
  view.rerender(<ThemeProvider mode="dark"><span>child</span></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('system theme falls back to light when matchMedia is unavailable', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  render(<ThemeProvider mode="system"><span>child</span></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('system theme follows matchMedia changes', () => {
  const media = installMatchMedia(false);
  render(<ThemeProvider mode="system"><span>child</span></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe('light');
  media.setMatches(true);
  expect(document.documentElement.dataset.theme).toBe('dark');
});
