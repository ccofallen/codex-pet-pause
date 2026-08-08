import { describe, expect, test } from 'vitest';
import { selectBootstrap } from './bootstrapHost';

describe('selectBootstrap', () => {
  test('selects Android only for the explicit Android build host', () => {
    expect(selectBootstrap('android')).toBe('android');
    expect(selectBootstrap('desktop')).toBe('web');
    expect(selectBootstrap(undefined)).toBe('web');
  });
});
