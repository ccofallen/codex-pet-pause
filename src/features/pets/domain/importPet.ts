import {
  BUILTIN_PET_ID, type CodexPetManifest, type PetFrameMetadata, type SpriteVersion,
  type StoredCodexPet,
} from './types';
import { analyzeAtlasPixels } from '../sprite/analyzeAtlas';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SPRITESHEET_BYTES = 16 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type PetImportErrorCode =
  | 'manifest-not-object'
  | 'unsafe-id'
  | 'reserved-id'
  | 'name-required'
  | 'name-too-long'
  | 'description-invalid'
  | 'description-too-long'
  | 'unsupported-version'
  | 'spritesheet-path-missing'
  | 'manifest-file-invalid'
  | 'manifest-too-large'
  | 'atlas-file-invalid'
  | 'atlas-too-large'
  | 'manifest-json-invalid'
  | 'spritesheet-path-invalid'
  | 'atlas-name-mismatch'
  | 'atlas-decode-failed'
  | 'atlas-dimensions-invalid'
  | 'atlas-idle-empty'
  | 'archive-selection-mixed'
  | 'archive-selection-multiple'
  | 'archive-too-large'
  | 'archive-invalid'
  | 'archive-encrypted'
  | 'archive-path-unsafe'
  | 'archive-entry-limit'
  | 'archive-expanded-too-large'
  | 'archive-files-missing'
  | 'archive-multiple-manifests'
  | 'archive-atlas-ambiguous';

export class PetImportError extends Error {
  constructor(
    readonly code: PetImportErrorCode,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(code);
    this.name = 'PetImportError';
  }
}

interface DecodedImage {
  width: number;
  height: number;
  frameMetadata?: PetFrameMetadata;
}

export type ImageDecoder = (file: File) => Promise<DecodedImage>;

function readFrameMetadata(
  image: CanvasImageSource,
  width: number,
  height: number,
): PetFrameMetadata | undefined {
  const version: SpriteVersion | undefined = width === 1536 && height === 1872
    ? 1
    : width === 1536 && height === 2288 ? 2 : undefined;
  if (version === undefined || typeof document === 'undefined') return undefined;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    return analyzeAtlasPixels(data, width, height, version);
  } catch {
    return undefined;
  }
}

export async function decodeBrowserImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      const frameMetadata = readFrameMetadata(bitmap, bitmap.width, bitmap.height);
      return {
        width: bitmap.width,
        height: bitmap.height,
        ...(frameMetadata === undefined ? {} : { frameMetadata }),
      };
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const frameMetadata = readFrameMetadata(image, image.naturalWidth, image.naturalHeight);
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          ...(frameMetadata === undefined ? {} : { frameMetadata }),
        });
      };
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsText(file);
  });
}

function readManifest(value: unknown): CodexPetManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PetImportError('manifest-not-object');
  }

  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== 'string' || !SAFE_ID.test(manifest.id)) {
    throw new PetImportError('unsafe-id');
  }
  if (manifest.id === BUILTIN_PET_ID) {
    throw new PetImportError('reserved-id');
  }

  if (typeof manifest.displayName !== 'string') {
    throw new PetImportError('name-required');
  }
  const displayName = manifest.displayName.trim();
  if (codePointLength(displayName) === 0) {
    throw new PetImportError('name-required');
  }
  if (codePointLength(displayName) > 80) {
    throw new PetImportError('name-too-long', { maximumCharacters: 80 });
  }

  let description: string | undefined;
  if (manifest.description !== undefined) {
    if (typeof manifest.description !== 'string') {
      throw new PetImportError('description-invalid');
    }
    description = manifest.description.trim();
    if (codePointLength(description) > 500) {
      throw new PetImportError('description-too-long', { maximumCharacters: 500 });
    }
  }

  if (manifest.spriteVersionNumber !== undefined && manifest.spriteVersionNumber !== 2) {
    throw new PetImportError('unsupported-version');
  }
  if (typeof manifest.spritesheetPath !== 'string' || manifest.spritesheetPath.length === 0) {
    throw new PetImportError('spritesheet-path-missing');
  }

  return {
    id: manifest.id,
    displayName,
    ...(description === undefined ? {} : { description }),
    ...(manifest.spriteVersionNumber === 2 ? { spriteVersionNumber: 2 } : {}),
    spritesheetPath: manifest.spritesheetPath,
  };
}

function preflightManifestFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.json') || file.type !== 'application/json') {
    throw new PetImportError('manifest-file-invalid');
  }
  if (file.size > MAX_MANIFEST_BYTES) {
    throw new PetImportError('manifest-too-large', { maximumBytes: MAX_MANIFEST_BYTES });
  }
}

async function parseManifestContent(file: File): Promise<CodexPetManifest> {
  try {
    return readManifest(JSON.parse(await readFileText(file)));
  } catch (reason) {
    if (reason instanceof PetImportError) throw reason;
    throw new PetImportError('manifest-json-invalid');
  }
}

export async function parseCodexPetManifestFile(file: File): Promise<CodexPetManifest> {
  preflightManifestFile(file);
  return parseManifestContent(file);
}

export async function parseCodexPetImport(
  manifestFile: File,
  spritesheetFile: File,
  now: number,
  decode: ImageDecoder = decodeBrowserImage,
): Promise<StoredCodexPet> {
  preflightManifestFile(manifestFile);
  if (!spritesheetFile.name.toLowerCase().endsWith('.webp') || spritesheetFile.type !== 'image/webp') {
    throw new PetImportError('atlas-file-invalid');
  }
  if (spritesheetFile.size > MAX_SPRITESHEET_BYTES) {
    throw new PetImportError('atlas-too-large', { maximumBytes: MAX_SPRITESHEET_BYTES });
  }

  const manifest = await parseManifestContent(manifestFile);
  const expectedFilename = manifest.spritesheetPath.split(/[\\/]/).at(-1);
  if (!expectedFilename?.toLowerCase().endsWith('.webp')) {
    throw new PetImportError('spritesheet-path-invalid');
  }
  if (expectedFilename !== spritesheetFile.name) {
    throw new PetImportError('atlas-name-mismatch', { expectedFilename });
  }

  const spriteVersion: SpriteVersion = manifest.spriteVersionNumber === 2 ? 2 : 1;
  let decodedImage: DecodedImage;
  try {
    decodedImage = await decode(spritesheetFile);
  } catch {
    throw new PetImportError('atlas-decode-failed');
  }

  const expectedHeight = spriteVersion === 1 ? 1872 : 2288;
  if (decodedImage.width !== 1536 || decodedImage.height !== expectedHeight) {
    throw new PetImportError('atlas-dimensions-invalid', {
      version: spriteVersion,
      expectedWidth: 1536,
      expectedHeight,
    });
  }
  if (decodedImage.frameMetadata?.animationColumns.idle.length === 0) {
    throw new PetImportError('atlas-idle-empty');
  }

  return {
    id: manifest.id,
    displayName: manifest.displayName,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    spriteVersion,
    spritesheetFilename: spritesheetFile.name,
    spritesheet: spritesheetFile,
    importedAt: now,
    updatedAt: now,
    ...(decodedImage.frameMetadata === undefined ? {} : {
      frameMetadata: decodedImage.frameMetadata,
    }),
  };
}
