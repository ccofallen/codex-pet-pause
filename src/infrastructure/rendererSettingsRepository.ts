import type { Locale } from '../i18n/types';
import {
  createBrowserSettingsRepository,
  type SettingsRepository,
} from './settingsRepository';
import {
  createSynchronizedSettingsRepository,
  type LockManagerLike,
} from './synchronizedSettingsRepository';

interface RendererSettingsRepositoryOptions {
  storage: Storage;
  defaultLocale: Locale;
  desktopShellAvailable: boolean;
  lifecycle: 'authoritative' | 'passive';
  locks?: LockManagerLike;
}

export function createRendererSettingsRepository({
  storage,
  defaultLocale,
  desktopShellAvailable,
  lifecycle,
  locks,
}: RendererSettingsRepositoryOptions): SettingsRepository {
  const repository = createBrowserSettingsRepository(storage, defaultLocale);

  if (!desktopShellAvailable) {
    return repository;
  }

  return createSynchronizedSettingsRepository(repository, storage, {
    conflictPolicy:
      lifecycle === 'passive' ? 'replay-user-operation' : 'reject',
    ...(locks === undefined ? {} : { locks }),
  });
}
