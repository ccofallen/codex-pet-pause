import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CatSprite } from './CatSprite';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('shows the fallback until the atlas has loaded, then removes it', () => {
  render(<CatSprite animation="idle" animate={false} />);
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '0');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '0');
  expect(screen.getByTestId('cat-sprite')).toHaveStyle({
    backgroundImage: 'url("/assets/cat/neko-pause-cat.webp")',
  });
  expect(screen.getByTestId('cat-sprite-fallback')).toHaveAttribute('src', '/assets/cat/neko-pause-cat-fallback.png');

  act(() => screen.getByTestId('cat-atlas-loader').dispatchEvent(new Event('load')));

  expect(screen.queryByTestId('cat-sprite-fallback')).not.toBeInTheDocument();
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-atlas-status', 'loaded');
});

test('keeps the fallback when the atlas fails to load', () => {
  render(<CatSprite animation="idle" animate={false} />);

  act(() => screen.getByTestId('cat-atlas-loader').dispatchEvent(new Event('error')));

  expect(screen.getByTestId('cat-sprite-fallback')).toBeInTheDocument();
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-atlas-status', 'failed');
});

test('advances using row-specific durations and freezes when disabled', () => {
  vi.useFakeTimers();
  const { rerender } = render(<CatSprite animation="eating" animate />);
  act(() => vi.advanceTimersByTime(260));
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '1');
  rerender(<CatSprite animation="eating" animate={false} />);
  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '0');
});

test('renders a static look cell instead of advancing animation', () => {
  render(<CatSprite animation="idle" lookDirection={270} animate />);
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '10');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '4');
});

test('does not schedule JavaScript animation frames when the OS prefers reduced motion', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));

  render(<CatSprite animation="eating" animate />);
  act(() => vi.advanceTimersByTime(1_000));

  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '0');
  expect(vi.getTimerCount()).toBe(0);
});
