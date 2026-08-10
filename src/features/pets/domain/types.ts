export const BUILTIN_PET_ID = 'builtin-cat' as const;

export interface PetPosition {
  xRatio: number;
  yRatio: number;
}

export const DEFAULT_PET_POSITION: PetPosition = { xRatio: 0.82, yRatio: 0.72 };

export type SpriteVersion = 1 | 2;

export type StandardPetAnimation =
  | 'idle' | 'running-right' | 'running-left' | 'waving' | 'jumping'
  | 'failed' | 'waiting' | 'running' | 'review';

export interface PetFrameMetadata {
  animationColumns: Record<StandardPetAnimation, number[]>;
  visibleLookDirections?: number[];
}

export interface CodexPetManifest {
  id: string;
  displayName: string;
  description?: string;
  spriteVersionNumber?: 2;
  spritesheetPath: string;
}

export interface CodexPetMetadata {
  id: string;
  displayName: string;
  description?: string;
  spriteVersion: SpriteVersion;
  spritesheetFilename: string;
  importedAt: number;
  updatedAt: number;
  atlasRevision?: string;
  frameMetadata?: PetFrameMetadata;
}

export interface StoredCodexPet extends CodexPetMetadata {
  assetKind?: 'full';
  spritesheet: Blob;
}

export interface CatalogCodexPet extends CodexPetMetadata {
  assetKind: 'catalog';
  thumbnail?: Blob;
}

export type ListedCodexPet = StoredCodexPet | CatalogCodexPet;

export type ActivePet =
  | { source: 'builtin'; id: typeof BUILTIN_PET_ID; displayName: string }
  | { source: 'imported'; id: string; displayName: string; pet: StoredCodexPet };
