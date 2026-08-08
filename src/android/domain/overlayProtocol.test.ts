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
        metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
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
          metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
          assetPath: '../escape.webp',
          spritesheetBase64: 'c3ByaXRl',
        },
      },
    }));

    expect(value!.overlay).toEqual({ xRatio: 0.82, yRatio: 0.72 });
  });

  test('rejects malformed JSON payloads instead of passing them to repositories', () => {
    expect(() => parseAndroidHostSnapshot(snapshotFixture({ settingsJson: '{' })))
      .toThrow('invalid Android settings JSON');
  });

  test('validates settings, activity events, and pet metadata by their own schemas', () => {
    const pet = {
      id: 'momo',
      metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
      assetPath: 'pets/momo/spritesheet.webp',
      spritesheetBase64: 'c3ByaXRl',
    };
    const value = parseAndroidHostSnapshot(snapshotFixture({
      historyJson: ['{"id":"event-1","action":"completed","occurredAt":100}'],
      pets: [pet],
      overlay: { xRatio: 0.25, yRatio: 0.75, activePet: pet },
    }));

    expect(value).toMatchObject({
      historyJson: ['{"id":"event-1","action":"completed","occurredAt":100}'],
      pets: [pet],
      overlay: { activePet: pet },
    });
  });

  test('rejects wrong typed payloads and non-canonical base64 independently', () => {
    expect(() => parseAndroidHostSnapshot(snapshotFixture({ settingsJson: '{"schemaVersion":4}' })))
      .toThrow('invalid Android settings JSON');
    expect(() => parseAndroidHostSnapshot(snapshotFixture({ historyJson: ['{"schemaVersion":5}'] })))
      .toThrow('invalid Android history JSON');
    expect(() => parseAndroidHostSnapshot(snapshotFixture({
      pets: [{ id: 'momo', metadataJson: '{"schemaVersion":5}', assetPath: 'pets/momo/spritesheet.webp', spritesheetBase64: 'c3ByaXRl' }],
    }))).toThrow('invalid Android pet metadata JSON');
    expect(() => parseAndroidHostSnapshot(snapshotFixture({
      pets: [{ id: 'momo', metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}', assetPath: 'pets/momo/spritesheet.webp', spritesheetBase64: 'AB==' }],
    }))).toThrow('invalid Android pet spritesheet');
  });
});
