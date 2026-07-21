import { act, render, screen } from '@testing-library/react';
import { useLayoutEffect, type ComponentProps } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { PetFrameMetadata } from '../domain/types';
import { PetSprite } from './PetSprite';

const middleGapMetadata: PetFrameMetadata = {
  animationColumns: {
    idle: [2],
    'running-right': [0],
    'running-left': [0],
    waving: [0, 1, 3],
    jumping: [0],
    failed: [0],
    waiting: [0],
    running: [0],
    review: [0],
  },
  visibleLookDirections: [0],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('renders a v1 animation with a dynamic atlas and version-correct position', () => {
  render(<PetSprite atlasUrl="blob:v1" version={1} animation="review" animate={false} />);

  const sprite = screen.getByTestId('pet-sprite');
  expect(sprite).toHaveAttribute('data-row', '8');
  expect(sprite).toHaveAttribute('data-column', '0');
  expect(sprite).toHaveStyle({ backgroundImage: 'url("blob:v1")', backgroundPosition: '0% 100%' });
});

test('renders a v2 look direction and ignores look direction for v1', () => {
  const { rerender } = render(
    <PetSprite atlasUrl="blob:v2" version={2} animation="idle" lookDirection={180} animate />,
  );
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '10');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
  expect(screen.getByTestId('pet-sprite')).toHaveStyle({ backgroundPosition: '0% 100%' });

  rerender(<PetSprite atlasUrl="blob:v1" version={1} animation="idle" lookDirection={180} animate={false} />);
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
});

test('resets the animated frame when the atlas changes', () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <PetSprite atlasUrl="blob:first" version={2} animation="idle" animate />,
  );
  act(() => vi.advanceTimersByTime(280));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '1');

  rerender(<PetSprite atlasUrl="blob:second" version={2} animation="idle" animate />);
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
});

test('exposes reset loading and frame state synchronously during renderer transitions', () => {
  vi.useFakeTimers();
  const observed: string[] = [];

  function Harness(props: ComponentProps<typeof PetSprite> & { transition: number }) {
    useLayoutEffect(() => {
      const sprite = document.querySelector<HTMLElement>('[data-testid="pet-sprite"]');
      observed.push(`${sprite?.dataset.atlasStatus}:${sprite?.dataset.row}:${sprite?.dataset.column}`);
    }, [props.transition]);
    const { transition: _transition, ...spriteProps } = props;
    return <PetSprite {...spriteProps} />;
  }

  const { rerender } = render(
    <Harness transition={0} atlasUrl="blob:first" version={2} animation="idle" animate />,
  );
  act(() => screen.getByTestId('pet-atlas-loader').dispatchEvent(new Event('load')));
  act(() => vi.advanceTimersByTime(280));

  rerender(<Harness transition={1} atlasUrl="blob:first" version={2} animation="failed" animate />);
  rerender(<Harness transition={2} atlasUrl="blob:first" version={1} animation="failed" animate />);
  rerender(<Harness transition={3} atlasUrl="blob:first" version={2} animation="idle" lookDirection={180} animate />);
  rerender(<Harness transition={4} atlasUrl="blob:second" version={2} animation="idle" animate />);

  expect(observed).toEqual([
    'loading:0:0',
    'loaded:5:0',
    'loaded:5:0',
    'loaded:10:0',
    'loading:0:0',
  ]);
});

test('shows fallback content when atlas loading fails', () => {
  render(
    <PetSprite atlasUrl="blob:broken" fallbackUrl="fallback.png" version={2} animation="idle" animate={false} />,
  );
  act(() => screen.getByTestId('pet-atlas-loader').dispatchEvent(new Event('error')));

  expect(screen.getByTestId('pet-sprite-fallback')).toHaveAttribute('src', 'fallback.png');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-atlas-status', 'failed');
});

test('keeps a static first frame when reduced motion is active', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));

  render(<PetSprite atlasUrl="blob:v2" version={2} animation="failed" animate />);
  act(() => vi.advanceTimersByTime(1_000));

  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
  expect(vi.getTimerCount()).toBe(0);
});

test('advances through explicit visible columns without rendering a transparent gap', () => {
  vi.useFakeTimers();
  render(
    <PetSprite
      atlasUrl="blob:v2"
      version={2}
      animation="waving"
      frameMetadata={middleGapMetadata}
      animate
    />,
  );

  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
  act(() => vi.advanceTimersByTime(180));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '1');
  act(() => vi.advanceTimersByTime(180));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '3');
});

test('falls back to a visible idle frame for an unavailable v2 look direction', () => {
  render(
    <PetSprite
      atlasUrl="blob:v2"
      version={2}
      animation="failed"
      lookDirection={180}
      frameMetadata={middleGapMetadata}
      animate={false}
    />,
  );

  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '2');
});
