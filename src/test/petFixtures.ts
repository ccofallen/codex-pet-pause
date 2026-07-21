import type { StoredCodexPet } from '../features/pets/domain/types';

export const MURK_TEST_PET: StoredCodexPet = {
  id: 'murk',
  displayName: 'Murk',
  description: 'Moon ghost',
  spriteVersion: 2,
  spritesheetFilename: 'spritesheet.webp',
  spritesheet: new Blob(['test-webp'], { type: 'image/webp' }),
  importedAt: 100,
  updatedAt: 100,
  frameMetadata: {
    animationColumns: {
      idle: [0, 1, 2, 3, 4, 5],
      'running-right': [0, 1, 2, 3, 4, 5],
      'running-left': [0, 1, 2, 3, 4, 5],
      waving: [0, 1, 2, 3],
      jumping: [0, 1, 2, 3, 4],
      failed: [0, 1, 2, 3, 4, 5],
      waiting: [0, 1, 2, 3, 4, 5],
      running: [0, 1, 2, 3, 4, 5],
      review: [0, 1, 2, 3, 4, 5],
    },
    visibleLookDirections: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
};
