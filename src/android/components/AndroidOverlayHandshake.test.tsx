import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AndroidOverlayApp } from './AndroidOverlayApp';

const emptySnapshot = {
  schemaVersion: 1,
  settingsJson: null,
  historyJson: [],
  pets: [],
  overlay: { xRatio: 0.5, yRatio: 0.5 },
};

describe('Android overlay handshake', () => {
  afterEach(() => {
    delete window.AndroidOverlay;
  });

  it('registers once and does not resend ready after state updates', () => {
    const postMessage = vi.fn();
    window.AndroidOverlay = { postMessage };
    render(<AndroidOverlayApp />);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] as string)).toEqual({ type: 'overlay-ready' });

    act(() => {
      window.dispatchEvent(new CustomEvent('android-overlay-message', {
        detail: { type: 'state-changed', snapshot: emptySnapshot },
      }));
      window.dispatchEvent(new CustomEvent('android-overlay-message', {
        detail: { type: 'state-changed', snapshot: emptySnapshot },
      }));
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
