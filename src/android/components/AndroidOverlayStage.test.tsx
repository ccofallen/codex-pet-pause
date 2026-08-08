import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import {
  AndroidOverlayStage,
  type AndroidOverlayMessageHost,
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
  const postMessage = vi.fn<AndroidOverlayMessageHost['postMessage']>();
  render(
    <AndroidOverlayStage
      snapshot={snapshotFor(size, { customPet, reminderDue })}
      host={{ postMessage }}
      menuOpen={menuOpen}
      bubbleOpen={bubbleOpen}
      side={side}
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
    `https://appassets.androidplatform.net/local-files/pets/momo/${REVISION}/spritesheet.webp`,
  );
});

test('opens a three-action menu toward available screen space', () => {
  renderOverlay({ menuOpen: true, side: 'right' });

  const menu = screen.getByRole('menu');
  expect(menu).toHaveAttribute('data-expand', 'left');
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent))
    .toEqual(['Settings', 'Hide', 'Quit']);
});

test('sends menu choices through the typed overlay host contract', async () => {
  const user = userEvent.setup();
  const { postMessage } = renderOverlay({ menuOpen: true });

  await user.click(screen.getByRole('menuitem', { name: 'Hide' }));

  expect(postMessage).toHaveBeenCalledWith({ type: 'menu-action', action: 'hide' });
});

test('reuses reminder presentation copy in the transparent overlay bubble', () => {
  renderOverlay({ bubbleOpen: true, reminderDue: true });

  const bubble = screen.getByRole('dialog', { name: 'Look into the distance' });
  expect(bubble).toHaveTextContent('You have been looking at the screen for a while. Want to look into the distance?');
});
