import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import {
  androidPetAnimation,
  AndroidOverlayStage,
} from './AndroidOverlayStage';

const REVISION = '0123456789abcdef0123456789abcdef';

function snapshotFor(
  size: 'small' | 'medium' | 'large' = 'medium',
  options: { customPet?: boolean; reminderDue?: boolean } = {},
): AndroidHostSnapshot {
  const settings = createDefaultSettings(1, 'en');
  settings.petSize = size;
  if (options.customPet) settings.activePetId = 'momo';
  if (options.reminderDue) settings.reminders[0] = {
    ...settings.reminders[0]!,
    enabled: true,
    status: 'due',
  };
  const pet = {
    id: 'momo',
    metadataJson: JSON.stringify({
      id: 'momo',
      displayName: 'Momo',
      spriteVersion: 2,
      spritesheetFilename: 'momo.webp',
      importedAt: 10,
      updatedAt: 20,
    }),
    assetPath: `pets/momo/${REVISION}/spritesheet.webp`,
    spritesheetBase64: 'c3ByaXRl',
  } as const;
  return {
    schemaVersion: 1,
    settingsJson: JSON.stringify(settings),
    historyJson: [],
    pets: options.customPet ? [pet] : [],
    overlay: {
      xRatio: 0.8,
      yRatio: 0.7,
      ...(options.customPet ? { activePet: pet } : {}),
    },
  };
}

function renderOverlay({
  size = 'medium',
  menuOpen = false,
  bubbleOpen = false,
  side = 'left',
  customPet = false,
  reminderDue = false,
}: {
  size?: 'small' | 'medium' | 'large';
  menuOpen?: boolean;
  bubbleOpen?: boolean;
  side?: 'left' | 'right';
  customPet?: boolean;
  reminderDue?: boolean;
} = {}) {
  const postMessage = vi.fn();
  const legacyCombinedSurfaceProps = {
    host: { postMessage },
    menuOpen,
    bubbleOpen,
    side,
  };
  render(
    <AndroidOverlayStage
      snapshot={snapshotFor(size, { customPet, reminderDue })}
      {...legacyCombinedSurfaceProps}
    />,
  );
  return { postMessage };
}

test.each([['small', 56], ['medium', 72], ['large', 96]] as const)(
  'renders %s at %idp', (size, dp) => {
    renderOverlay({ size });
    expect(screen.getByTestId('android-pet')).toHaveStyle(`--android-pet-size: ${dp}px`);
  },
);

test('renders the built-in cat without depending on the desktop petShell stage', () => {
  renderOverlay();

  expect(screen.getByTestId('cat-sprite')).toBeInTheDocument();
  expect(screen.queryByTestId('interactive-cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
});

test('loads a selected custom pet from its immutable bundled local-origin asset path', () => {
  renderOverlay({ customPet: true });

  expect(screen.getByTestId('pet-atlas-loader')).toHaveAttribute(
    'src',
    `https://appassets.androidplatform.net/pet-assets/pets/momo/${REVISION}/spritesheet.webp`,
  );
});

test('never renders or emits legacy combined-surface behavior', async () => {
  const user = userEvent.setup();
  const { postMessage } = renderOverlay({
    menuOpen: true,
    bubbleOpen: true,
    side: 'right',
    reminderDue: true,
  });

  await user.click(screen.getByTestId('android-pet'));
  await user.dblClick(screen.getByTestId('android-pet'));

  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(postMessage).not.toHaveBeenCalled();
});

test('preserves tap and drag animation selection for default and imported pets', () => {
  expect(androidPetAnimation(false, { type: 'tap', sequence: 1 }, false)).toBe('review');
  expect(androidPetAnimation(true, { type: 'tap', sequence: 1 }, false)).toBe('waving');
  expect(androidPetAnimation(false, { type: 'drag', facing: 'left', sequence: 2 }, false))
    .toBe('picked-up');
  expect(androidPetAnimation(true, { type: 'drag', facing: 'right', sequence: 2 }, false))
    .toBe('running-right');
  expect(androidPetAnimation(false, { type: 'idle', sequence: 3 }, true)).toBe('waiting');
});

test('uses a pet-only stage with no expansion layout or surface siblings', () => {
  renderOverlay();

  const stage = screen.getByTestId('android-overlay-stage');
  expect(stage).not.toHaveAttribute('data-expand');
  expect(stage.children).toHaveLength(1);
  expect(stage.firstElementChild).toBe(screen.getByTestId('android-pet'));
});
