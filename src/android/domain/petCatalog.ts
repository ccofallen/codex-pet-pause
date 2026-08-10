import type { CatalogCodexPet } from '../../features/pets/domain/types';

export interface AndroidCatalogPet extends CatalogCodexPet {
  thumbnailUrl?: string;
}

export interface AndroidPetCatalogState {
  revision: number;
  activePetId: string;
  pets: AndroidCatalogPet[];
}

export interface AndroidPetCatalogSession {
  load(): Promise<AndroidPetCatalogState | undefined>;
  select(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  dispose(): void;
}
