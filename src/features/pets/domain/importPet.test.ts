import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  decodeBrowserImage, parseCodexPetImport, parseCodexPetManifestFile, type ImageDecoder,
} from './importPet';
import { BUILTIN_PET_ID, type PetFrameMetadata } from './types';

const file = (name: string, body: BlobPart, type: string) => new File([body], name, { type });
const validManifest = (overrides: Record<string, unknown> = {}) => ({
  id: 'murk',
  displayName: 'Murk',
  description: 'Moon ghost',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
  ...overrides,
});
const frameMetadata: PetFrameMetadata = {
  animationColumns: {
    idle: [0, 1],
    'running-right': [0],
    'running-left': [0],
    waving: [0, 2],
    jumping: [0],
    failed: [0],
    waiting: [0],
    running: [0],
    review: [0],
  },
  visibleLookDirections: [0, 8, 15],
};

function mockCanvasElement(canvas: HTMLCanvasElement): void {
  (vi.spyOn(document, 'createElement') as unknown as {
    mockReturnValue(value: HTMLCanvasElement): void;
  }).mockReturnValue(canvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseCodexPetManifestFile', () => {
  test('parses and normalizes a valid manifest independently of its atlas', async () => {
    await expect(parseCodexPetManifestFile(file(
      'pet.json',
      JSON.stringify({
        id: ' murk '.trim(),
        displayName: '  Murk  ',
        description: '  Moon ghost  ',
        spriteVersionNumber: 2,
        spritesheetPath: 'bundle/spritesheet.webp',
      }),
      'application/json',
    ))).resolves.toEqual({
      id: 'murk',
      displayName: 'Murk',
      description: 'Moon ghost',
      spriteVersionNumber: 2,
      spritesheetPath: 'bundle/spritesheet.webp',
    });
  });

  test('independent manifest parsing keeps current size and JSON errors', async () => {
    await expect(parseCodexPetManifestFile(
      file('pet.json', ' '.repeat(64 * 1024 + 1), 'application/json'),
    )).rejects.toMatchObject({ code: 'manifest-too-large' });
    await expect(parseCodexPetManifestFile(
      file('pet.json', '{broken', 'application/json'),
    )).rejects.toMatchObject({ code: 'manifest-json-invalid' });
  });
});

describe('decodeBrowserImage', () => {
  test('closes the decoded ImageBitmap after reading its dimensions', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1536, height: 2288, close })));
    mockCanvasElement({
      width: 0, height: 0, getContext: () => null,
    } as unknown as HTMLCanvasElement);

    await expect(decodeBrowserImage(file('spritesheet.webp', 'x', 'image/webp')))
      .resolves.toEqual({ width: 1536, height: 2288 });
    expect(close).toHaveBeenCalledOnce();
  });

  test('revokes the fallback object URL after the Image has loaded', async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('createImageBitmap', undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    mockCanvasElement({
      width: 0, height: 0, getContext: () => null,
    } as unknown as HTMLCanvasElement);
    vi.stubGlobal('Image', class {
      naturalWidth = 1536;
      naturalHeight = 1872;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        expect(value).toBe('blob:fallback');
        this.onload?.();
      }
    });

    await expect(decodeBrowserImage(file('spritesheet.webp', 'x', 'image/webp')))
      .resolves.toEqual({ width: 1536, height: 1872 });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fallback');
  });

  test('draws a decoded atlas and returns metadata for visible pixels', async () => {
    const close = vi.fn();
    const bitmap = { width: 1536, height: 2288, close };
    const pixels = new Uint8ClampedArray(1536 * 2288 * 4);
    pixels[3] = 255;
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    mockCanvasElement({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, getImageData: () => ({ data: pixels }) }),
    } as unknown as HTMLCanvasElement);

    const result = await decodeBrowserImage(file('spritesheet.webp', 'x', 'image/webp'));

    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(result.frameMetadata?.animationColumns.idle).toEqual([0]);
    expect(close).toHaveBeenCalledOnce();
  });

  test('keeps valid dimensions when canvas readback fails', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1536, height: 2288, close })));
    mockCanvasElement({
      width: 0,
      height: 0,
      getContext: () => { throw new Error('canvas blocked'); },
    } as unknown as HTMLCanvasElement);

    await expect(decodeBrowserImage(file('spritesheet.webp', 'x', 'image/webp')))
      .resolves.toEqual({ width: 1536, height: 2288 });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('parseCodexPetImport', () => {
  let decode: ReturnType<typeof vi.fn<ImageDecoder>>;

  beforeEach(() => {
    decode = vi.fn(async () => ({ width: 1536, height: 2288 }));
  });

  test('accepts a hatch-pet v2 pair', async () => {
    const manifest = file('pet.json', JSON.stringify(validManifest()), 'application/json');
    const atlas = file('spritesheet.webp', 'webp', 'image/webp');

    await expect(parseCodexPetImport(manifest, atlas, 123, decode)).resolves.toMatchObject({
      id: 'murk', displayName: 'Murk', description: 'Moon ghost', spriteVersion: 2,
      spritesheetFilename: 'spritesheet.webp', importedAt: 123, updatedAt: 123,
    });
    expect(decode).toHaveBeenCalledWith(atlas);
  });

  test('copies decoder-provided frame metadata onto the stored pet', async () => {
    decode.mockResolvedValueOnce({ width: 1536, height: 2288, frameMetadata });

    const pet = await parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest()), 'application/json'),
      file('spritesheet.webp', 'webp', 'image/webp'),
      123,
      decode,
    );

    expect(pet.frameMetadata).toEqual(frameMetadata);
  });

  test('keeps dimensions-only decoder results backward compatible', async () => {
    const pet = await parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest()), 'application/json'),
      file('spritesheet.webp', 'webp', 'image/webp'),
      123,
      decode,
    );

    expect(pet).not.toHaveProperty('frameMetadata');
  });

  test('accepts v1 and trims display text while normalizing a manifest path', async () => {
    decode.mockResolvedValueOnce({ width: 1536, height: 1872 });
    const manifest = file('pet.json', JSON.stringify({
      id: 'kabi', displayName: '  Kabi  ', description: '  Cloud cat  ',
      spritesheetPath: 'nested\\spritesheet.webp',
    }), 'application/json');

    await expect(parseCodexPetImport(
      manifest, file('spritesheet.webp', 'webp', 'image/webp'), 50, decode,
    )).resolves.toMatchObject({
      id: 'kabi', displayName: 'Kabi', description: 'Cloud cat', spriteVersion: 1,
    });
  });

  test('rejects the reserved built-in pet ID', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest({ id: BUILTIN_PET_ID })), 'application/json'),
      file('spritesheet.webp', 'webp', 'image/webp'), 123, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'reserved-id' });
    expect(decode).not.toHaveBeenCalled();
  });

  test.each([
    [undefined, 1536, 2288],
    [2, 1536, 1872],
  ] as const)('rejects a version/dimension mismatch', async (version, width, height) => {
    decode.mockResolvedValueOnce({ width, height });
    const json = file('pet.json', JSON.stringify({
      id: 'pet', displayName: 'Pet', spritesheetPath: 'spritesheet.webp',
      ...(version === undefined ? {} : { spriteVersionNumber: version }),
    }), 'application/json');
    await expect(parseCodexPetImport(
      json, file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({
      name: 'PetImportError',
      code: 'atlas-dimensions-invalid',
      details: { version: version ?? 1, expectedWidth: 1536, expectedHeight: version === 2 ? 2288 : 1872 },
    });
  });

  test('rejects malformed JSON', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', '{broken', 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'manifest-json-invalid' });
  });

  test('rejects an invalid atlas before reading a malformed manifest', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', '{broken', 'application/json'),
      file('spritesheet.webp', 'x', 'image/png'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'atlas-file-invalid' });
  });

  test.each([
    ['missing id', { id: undefined }, 'unsafe-id'],
    ['unsafe id', { id: '../murk' }, 'unsafe-id'],
    ['overlong id', { id: `a${'b'.repeat(64)}` }, 'unsafe-id'],
    ['missing display name', { displayName: undefined }, 'name-required'],
    ['blank display name', { displayName: '  ' }, 'name-required'],
    ['overlong display name', { displayName: '猫'.repeat(81) }, 'name-too-long'],
    ['invalid description', { description: 7 }, 'description-invalid'],
    ['overlong description', { description: '月'.repeat(501) }, 'description-too-long'],
    ['missing spritesheet path', { spritesheetPath: undefined }, 'spritesheet-path-missing'],
    ['unsupported version', { spriteVersionNumber: 3 }, 'unsupported-version'],
  ])('rejects %s', async (_label, overrides, code) => {
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest(overrides)), 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code });
  });

  test('rejects a non-object manifest with a presentation-neutral code', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', '[]', 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'manifest-not-object' });
  });

  test.each([
    ['pet.txt', 'application/json', 'spritesheet.webp', 'image/webp', 'manifest-file-invalid'],
    ['pet.json', 'text/plain', 'spritesheet.webp', 'image/webp', 'manifest-file-invalid'],
    ['pet.json', 'application/json', 'spritesheet.png', 'image/webp', 'atlas-file-invalid'],
    ['pet.json', 'application/json', 'spritesheet.webp', 'image/png', 'atlas-file-invalid'],
  ])('rejects wrong file extension or MIME type', async (jsonName, jsonType, atlasName, atlasType, code) => {
    await expect(parseCodexPetImport(
      file(jsonName, JSON.stringify(validManifest({ spritesheetPath: atlasName })), jsonType),
      file(atlasName, 'x', atlasType), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code });
  });

  test('rejects a mismatched spritesheet basename', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest({
        spritesheetPath: '/generated/expected.webp',
      })), 'application/json'),
      file('selected.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({
      name: 'PetImportError', code: 'atlas-name-mismatch', details: { expectedFilename: 'expected.webp' },
    });
  });

  test('rejects a spritesheet path that does not point to WebP', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest({ spritesheetPath: 'spritesheet.png' })), 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'spritesheet-path-invalid' });
  });

  test('rejects JSON over 64 KiB', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', ' '.repeat(64 * 1024 + 1), 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({
      name: 'PetImportError', code: 'manifest-too-large', details: { maximumBytes: 64 * 1024 },
    });
  });

  test('rejects WebP over 16 MiB', async () => {
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest()), 'application/json'),
      file('spritesheet.webp', new Uint8Array(16 * 1024 * 1024 + 1), 'image/webp'), 1, decode,
    )).rejects.toMatchObject({
      name: 'PetImportError', code: 'atlas-too-large', details: { maximumBytes: 16 * 1024 * 1024 },
    });
  });

  test('reports decoder rejection as an undecodable WebP', async () => {
    decode.mockRejectedValueOnce(new Error('codec failure'));
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest()), 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'atlas-decode-failed' });
  });

  test('rejects an atlas whose idle row has no visible frames', async () => {
    decode.mockResolvedValueOnce({
      width: 1536,
      height: 2288,
      frameMetadata: { ...frameMetadata, animationColumns: { ...frameMetadata.animationColumns, idle: [] } },
    });
    await expect(parseCodexPetImport(
      file('pet.json', JSON.stringify(validManifest()), 'application/json'),
      file('spritesheet.webp', 'x', 'image/webp'), 1, decode,
    )).rejects.toMatchObject({ name: 'PetImportError', code: 'atlas-idle-empty' });
  });
});
