import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import { parseAndroidRuntimeSnapshot } from './runtimeSnapshot';

const settings = createDefaultSettings(10, 'en');
const completedEvent = {
  id: 'event-1',
  reminderId: 'lookAway',
  reminderType: 'lookAway',
  action: 'completed',
  occurredAt: 20,
};

function rawRuntimeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: 7,
    settingsJson: JSON.stringify(settings),
    historyJson: [JSON.stringify(completedEvent)],
    ...overrides,
  };
}

describe('parseAndroidRuntimeSnapshot', () => {
  test('parses settings and history from the compact revisioned payload', () => {
    expect(parseAndroidRuntimeSnapshot(rawRuntimeSnapshot())).toEqual({
      revision: 7,
      settings,
      history: [completedEvent],
    });
  });

  test.each([
    ['pets', []],
    ['overlay', { activePet: {} }],
    ['spritesheetBase64', 'YQ=='],
  ])('rejects forbidden runtime field %s', (field, value) => {
    expect(() => parseAndroidRuntimeSnapshot(rawRuntimeSnapshot({ [field]: value })))
      .toThrow('invalid Android runtime snapshot');
  });

  test('rejects unsupported schemas, invalid revisions, and invalid history', () => {
    expect(() => parseAndroidRuntimeSnapshot(rawRuntimeSnapshot({ schemaVersion: 2 })))
      .toThrow('unsupported Android runtime schema');
    expect(() => parseAndroidRuntimeSnapshot(rawRuntimeSnapshot({ revision: -1 })))
      .toThrow('invalid Android runtime snapshot');
    expect(() => parseAndroidRuntimeSnapshot(rawRuntimeSnapshot({ historyJson: ['{}'] })))
      .toThrow('invalid Android history JSON');
  });
});
