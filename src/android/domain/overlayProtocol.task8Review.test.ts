import { describe, expect, test } from 'vitest';
import { parseAndroidHostSnapshot } from './overlayProtocol';

const revision = '0123456789abcdef0123456789abcdef';
const metadataJson = JSON.stringify({
  id: 'moon.cat',
  displayName: 'Moon Cat',
  spriteVersion: 2,
  spritesheetFilename: 'spritesheet.webp',
  importedAt: 10,
  updatedAt: 20,
});

function snapshot(assetPath: string) {
  const pet = { id: 'moon.cat', metadataJson, assetPath, spritesheetBase64: 'YQ==' };
  return {
    schemaVersion: 1,
    settingsJson: null,
    historyJson: [],
    pets: [pet],
    overlay: { xRatio: 0.5, yRatio: 0.5, activePet: pet },
  };
}

describe('Android pet id and asset path parity', () => {
  test('accepts a canonical immutable path for a dotted shared pet id', () => {
    const value = snapshot(`pets/moon.cat/${revision}/spritesheet.webp`);
    expect(parseAndroidHostSnapshot(value)).toEqual(value);
  });

  test.each([
    `pets//${revision}/spritesheet.webp`,
    `pets/./${revision}/spritesheet.webp`,
    `pets/../${revision}/spritesheet.webp`,
    `pets/moon%2Fcat/${revision}/spritesheet.webp`,
    `pets/moon%5Ccat/${revision}/spritesheet.webp`,
    `pets/moon cat/${revision}/spritesheet.webp`,
    `pets/moon.cat/${revision}/../spritesheet.webp`,
  ])('rejects non-canonical asset path %s', (assetPath) => {
    expect(() => parseAndroidHostSnapshot(snapshot(assetPath))).toThrow('invalid Android pet asset');
  });
});
