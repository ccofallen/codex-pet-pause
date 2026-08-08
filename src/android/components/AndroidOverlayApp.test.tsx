import { render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AndroidOverlayApp } from './AndroidOverlayApp';

afterEach(() => {
  delete window.AndroidOverlay;
});

test('announces overlay-ready through the typed bridge as soon as the local overlay app mounts', () => {
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };

  render(<AndroidOverlayApp />);

  expect(postMessage).toHaveBeenCalledWith('{"type":"overlay-ready"}');
});
