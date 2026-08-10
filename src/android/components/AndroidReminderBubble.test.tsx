import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import { AndroidOverlayApp } from './AndroidOverlayApp';

function snapshotFor(size: 'small' | 'large', reminderDue: boolean): AndroidHostSnapshot {
  const settings = createDefaultSettings(1, 'en');
  settings.petSize = size;
  if (reminderDue) {
    settings.reminders[0] = {
      ...settings.reminders[0]!,
      enabled: true,
      status: 'due',
    };
  }
  return {
    schemaVersion: 1,
    settingsJson: JSON.stringify(settings),
    historyJson: [],
    pets: [],
    overlay: { xRatio: 0.8, yRatio: 0.7 },
  };
}

function send(detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', { detail })));
}

afterEach(() => {
  delete window.AndroidOverlay;
});

test('applies current pet snapshots immediately while ignoring legacy bubble lifecycle events', () => {
  window.AndroidOverlay = { postMessage: vi.fn() };
  render(<AndroidOverlayApp />);

  send({ type: 'state-changed', snapshot: snapshotFor('small', true) });
  send({ type: 'show-reminder', side: 'right', generation: 1 });
  send({ type: 'state-changed', snapshot: snapshotFor('large', false) });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('android-pet')).toHaveStyle('--android-pet-size: 96px');

  send({ type: 'close-bubble' });
  expect(screen.getByTestId('android-pet')).toHaveStyle('--android-pet-size: 96px');
});
