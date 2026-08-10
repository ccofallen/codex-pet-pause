import type { StoredCodexPet } from '../../features/pets/domain/types';
import type {
  AndroidNativePetFile,
  AndroidHostSnapshot,
  AndroidPetArchiveEvent,
  AndroidPetImportHost,
  AndroidPetPersistResult,
  AndroidPendingArchiveOutcome,
  AndroidPetWrite,
} from '../bridge/androidHost';
import { readAndroidBlobBytes } from './androidRepositories';

export type AndroidPetImportEvent = AndroidPetArchiveEvent & { claimId?: number };
export type AndroidPetImportClaim = Pick<AndroidPetImportEvent, 'token' | 'claimId'>;

export interface AndroidPetImport {
  connect(listener?: (event: AndroidPetImportEvent) => void): () => void;
  dispose(): void;
  openPetdex(): Promise<void>;
  pickFiles(): Promise<File[]>;
  consumePendingArchive(token: string, claim?: AndroidPetImportClaim): Promise<File>;
  completePendingArchive(
    token: string,
    outcome: AndroidPendingArchiveOutcome,
    claim?: AndroidPetImportClaim,
  ): Promise<void>;
  persistValidatedPet(
    pet: StoredCodexPet,
    claim?: AndroidPetImportClaim,
  ): Promise<AndroidPetPersistResult | void>;
  isClaimActive?(claim: AndroidPetImportClaim): boolean;
  subscribe(listener: (event: AndroidPetImportEvent) => void): () => void;
}

function decodeBase64(value: string): ArrayBuffer {
  const text = atob(value);
  const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function nativeFile(value: AndroidNativePetFile): File {
  return new File([decodeBase64(value.base64)], value.name, { type: value.mimeType });
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function createAndroidPetImport(
  host: AndroidPetImportHost,
  applyCommittedSnapshot?: (snapshot: AndroidHostSnapshot) => void,
): AndroidPetImport {
  let listener: ((event: AndroidPetImportEvent) => void) | undefined;
  let activeToken: string | undefined;
  const queuedTokens: string[] = [];
  const knownTokens = new Set<string>();
  let navigationListener: ((event: AndroidPetImportEvent) => void) | undefined;
  let unsubscribeHost: (() => void) | undefined;
  let disposed = false;
  let persisting = false;
  let claimSequence = 0;
  let activeClaimId: number | undefined;
  let persistenceClaimId: number | undefined;
  let acknowledgement: {
    token: string;
    outcome: AndroidPendingArchiveOutcome;
    claimId?: number;
  } | undefined;

  const claimMatches = (
    claim: AndroidPetImportClaim,
    includePersistence = false,
  ): boolean => activeToken === claim.token && (
    claim.claimId === undefined
    || activeClaimId === claim.claimId
    || (includePersistence && persistenceClaimId === claim.claimId)
    || (includePersistence && acknowledgement?.claimId === claim.claimId)
  );

  const requireClaim = (claim: AndroidPetImportClaim, includePersistence = false): void => {
    if (!claimMatches(claim, includePersistence)) {
      throw new Error('stale Android pending archive claim');
    }
  };

  const deliverNext = (): void => {
    if (disposed || listener === undefined
      || activeClaimId !== undefined || persistenceClaimId !== undefined
      || acknowledgement !== undefined) return;
    activeToken ??= queuedTokens.shift();
    if (activeToken === undefined) return;
    activeClaimId = ++claimSequence;
    listener({ type: 'pet-archive-ready', token: activeToken, claimId: activeClaimId });
  };

  const connectHost = (): void => {
    if (disposed || unsubscribeHost !== undefined) return;
    unsubscribeHost = host.subscribePetArchives((event) => {
      if (knownTokens.has(event.token)) return;
      knownTokens.add(event.token);
      queuedTokens.push(event.token);
      navigationListener?.(event);
      deliverNext();
    });
  };

  return {
    connect(nextNavigationListener): () => void {
      navigationListener = nextNavigationListener;
      connectHost();
      return () => {
        if (navigationListener === nextNavigationListener) navigationListener = undefined;
        unsubscribeHost?.();
        unsubscribeHost = undefined;
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeHost?.();
      unsubscribeHost = undefined;
      navigationListener = undefined;
      listener = undefined;
      queuedTokens.length = 0;
      knownTokens.clear();
      if (activeToken !== undefined
        && persistenceClaimId === undefined
        && acknowledgement === undefined) {
        const token = activeToken;
        activeToken = undefined;
        activeClaimId = undefined;
        void host.completePendingArchive(token, 'retry').catch(() => undefined);
      }
    },

    openPetdex: () => host.openPetdex(),

    async pickFiles(): Promise<File[]> {
      const selection = await host.pickPetFiles();
      return selection.status === 'cancelled' ? [] : selection.files.map(nativeFile);
    },

    async consumePendingArchive(token: string, claim?: AndroidPetImportClaim): Promise<File> {
      if (claim !== undefined) requireClaim(claim);
      const archive = nativeFile(await host.consumePendingArchive(token));
      if (claim !== undefined) requireClaim(claim);
      return archive;
    },

    async completePendingArchive(token, outcome, claim): Promise<void> {
      if (claim !== undefined) requireClaim(claim, true);
      if (activeToken !== token) throw new Error('Android pending archive is not active');
      if (acknowledgement !== undefined) {
        throw new Error('Android pending archive acknowledgement already in progress');
      }
      const claimId = claim?.claimId ?? activeClaimId ?? persistenceClaimId;
      const transaction: {
        token: string;
        outcome: AndroidPendingArchiveOutcome;
        claimId?: number;
      } = {
        token,
        outcome,
        ...(claimId === undefined ? {} : { claimId }),
      };
      acknowledgement = transaction;
      activeClaimId = undefined;
      persistenceClaimId = undefined;
      try {
        try {
          await host.completePendingArchive(token, outcome);
        } catch {
          await host.completePendingArchive(token, outcome);
        }
      } catch (error) {
        if (acknowledgement === transaction) acknowledgement = undefined;
        if (disposed) {
          activeToken = undefined;
          knownTokens.delete(token);
        } else {
          deliverNext();
        }
        throw error;
      }
      if (acknowledgement === transaction) acknowledgement = undefined;
      activeToken = undefined;
      activeClaimId = undefined;
      persistenceClaimId = undefined;
      if (outcome === 'retry') {
        queuedTokens.length = 0;
        knownTokens.clear();
        return;
      }
      knownTokens.delete(token);
      deliverNext();
    },

    async persistValidatedPet(
      pet: StoredCodexPet,
      claim?: AndroidPetImportClaim,
    ): Promise<AndroidPetPersistResult | void> {
      const ownsArchive = claim !== undefined;
      if (claim !== undefined) {
        requireClaim(claim);
        persisting = true;
        persistenceClaimId = claim.claimId;
        activeClaimId = undefined;
      }
      try {
        const { spritesheet, ...metadata } = pet;
        const bytes = new Uint8Array(await readAndroidBlobBytes(spritesheet));
        if (bytes.byteLength === 0) throw new Error('empty Android pet spritesheet');
        const input: AndroidPetWrite = {
          id: pet.id,
          metadataJson: JSON.stringify(metadata),
          spritesheetBase64: encodeBase64(bytes),
        };
        const result = await host.persistValidatedPet(input);
        if (result !== undefined) applyCommittedSnapshot?.(result.snapshot);
        return result;
      } catch (error) {
        if (ownsArchive) {
          persisting = false;
          persistenceClaimId = undefined;
          if (disposed && activeToken !== undefined) {
            const token = activeToken;
            activeToken = undefined;
            knownTokens.delete(token);
            await host.completePendingArchive(token, 'retry').catch(() => undefined);
          } else {
            deliverNext();
          }
        }
        throw error;
      } finally {
        if (ownsArchive) persisting = false;
      }
    },

    isClaimActive(claim): boolean {
      return claimMatches(claim, true);
    },

    subscribe(nextListener): () => void {
      if (listener !== undefined) throw new Error('Android pending archive listener already installed');
      if (disposed) throw new Error('Android pet importer disposed');
      listener = nextListener;
      connectHost();
      deliverNext();
      return () => {
        if (listener === nextListener) {
          listener = undefined;
          if (!persisting && acknowledgement === undefined) activeClaimId = undefined;
        }
      };
    },
  };
}
