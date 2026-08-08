import { describe, expect, test } from 'vitest';
import { parseAndroidHostSnapshot } from './overlayProtocol';

function snapshotFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    settingsJson: '{"schemaVersion":5}',
    historyJson: [],
    pets: [],
    overlay: {
      xRatio: 0.25,
      yRatio: 0.75,
      activePet: {
        id: 'momo',
        metadataJson: '{"id":"momo"}',
        assetPath: 'pets/momo/spritesheet.webp',
        spritesheetBase64: 'c3ByaXRl',
      },
    },
    ...overrides,
  };
}

describe('parseAndroidHostSnapshot', () => {
  test('rejects a native snapshot with an unsupported schema', () => {
    expect(() => parseAndroidHostSnapshot({ schemaVersion: 2 })).toThrow('unsupported Android state schema');
  });

  test('repairs coordinates without accepting executable pet paths', () => {
    const value = parseAndroidHostSnapshot(snapshotFixture({
      overlay: {
        xRatio: -1,
        yRatio: 2,
        activePet: {
          id: 'momo',
          metadataJson: '{"id":"momo"}',
          assetPath: '../escape.webp',
          spritesheetBase64: 'c3ByaXRl',
        },
      },
    }));

    expect(value.overlay).toEqual({ xRatio: 0.82, yRatio: 0.72 });
  });

  test('rejects malformed JSON payloads instead of passing them to repositories', () => {
    expect(() => parseAndroidHostSnapshot(snapshotFixture({ settingsJson: '{' })))
      .toThrow('invalid Android settings JSON');
  });
});
