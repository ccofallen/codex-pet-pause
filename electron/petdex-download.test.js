import { describe, expect, it } from 'vitest';
import {
  isAllowedPetdexNavigation,
  isSupportedPetArchive,
  MAX_PETDEX_ARCHIVE_BYTES,
  revealSettingsAfterPetdexDownload,
} from './petdex-download.js';

describe('Petdex download policy', () => {
  it('accepts Petdex HTTPS pages and rejects lookalike or unsafe origins', () => {
    expect(isAllowedPetdexNavigation('https://petdex.dev/pets/boba')).toBe(true);
    expect(isAllowedPetdexNavigation('https://cdn.petdex.dev/boba.zip')).toBe(true);
    expect(isAllowedPetdexNavigation('https://petdex.dev.example.com/boba.zip')).toBe(false);
    expect(isAllowedPetdexNavigation('http://petdex.dev/pets/boba')).toBe(false);
  });

  it('recognizes ZIP downloads from filename, URL, or MIME type', () => {
    expect(isSupportedPetArchive('boba.zip')).toBe(true);
    expect(isSupportedPetArchive('download', '', 'https://petdex.dev/files/boba.zip')).toBe(true);
    expect(isSupportedPetArchive('download', 'application/zip')).toBe(true);
    expect(isSupportedPetArchive('pet.json', 'application/json')).toBe(false);
    expect(MAX_PETDEX_ARCHIVE_BYTES).toBe(32 * 1024 * 1024);
  });

  it('closes Petdex and reveals the settings window after a download handoff', () => {
    const calls = [];
    const petdexWindow = {
      isDestroyed: () => false,
      hide: () => calls.push('hide-petdex'),
      close: () => calls.push('close-petdex'),
    };
    const settingsWindow = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: () => calls.push('restore-settings'),
      show: () => calls.push('show-settings'),
      focus: () => calls.push('focus-settings'),
    };

    revealSettingsAfterPetdexDownload(settingsWindow, petdexWindow);

    expect(calls).toEqual([
      'hide-petdex',
      'close-petdex',
      'restore-settings',
      'show-settings',
      'focus-settings',
    ]);
  });
});
