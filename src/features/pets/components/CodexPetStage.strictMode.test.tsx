import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AppController } from '../../../app/appController';
import { createDefaultSettings } from '../../../app/defaults';
import type { AppSnapshot } from '../../../app/model';
import { AppProvider } from '../../../app/AppProvider';
import type { StoredCodexPet } from '../domain/types';
import { CodexPetStage } from './CodexPetStage';
import { I18nProvider } from '../../../i18n/I18nProvider';

const NOW = 1_800_000_000_000;
const PET: StoredCodexPet = {
  id: 'murk',
  displayName: 'Murk',
  spriteVersion: 2,
  spritesheetFilename: 'spritesheet.webp',
  spritesheet: new Blob(['atlas'], { type: 'image/webp' }),
  importedAt: NOW,
  updatedAt: NOW,
};

function createController(): AppController {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.activePetId = PET.id;
  const snapshot: AppSnapshot = {
    ready: true,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [] },
    storageMode: 'persistent',
    notificationStatus: 'granted',
    pets: [PET],
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    hydrate: vi.fn(async () => undefined),
    applyCommittedRuntimeState: vi.fn(),
    reconcileNow: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    snooze: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resumePause: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    saveSettings: vi.fn(async () => undefined),
    savePet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined),
    selectPet: vi.fn(async () => undefined),
    savePetPosition: vi.fn(async () => undefined),
    requestNotifications: vi.fn(async (): Promise<AppSnapshot['notificationStatus']> => 'granted'),
    listHistorySince: vi.fn(async () => []),
    clearAll: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  window.innerWidth = 1_000;
  window.innerHeight = 800;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(pointer: fine)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('keeps the displayed imported-pet atlas URL alive when StrictMode replays effects', async () => {
  let sequence = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:stage-${sequence += 1}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url));

  const view = render(
    <StrictMode>
      <AppProvider controller={createController()}>
        <I18nProvider locale="en"><CodexPetStage pet={PET} /></I18nProvider>
      </AppProvider>
    </StrictMode>,
  );

  const loader = await screen.findByTestId('pet-atlas-loader');
  const displayedUrl = loader.getAttribute('src');
  expect(displayedUrl).not.toBeNull();
  expect(revoked).not.toContain(displayedUrl);

  view.unmount();
  await waitFor(() => expect(new Set(revoked)).toEqual(new Set(created)));
});
