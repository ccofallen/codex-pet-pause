import {
  BlobReader, Uint8ArrayWriter, ZipReader,
} from '@zip.js/zip.js';
import {
  parseCodexPetManifestFile, PetImportError,
} from './importPet';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 128;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;

export interface CodexPetFilePair {
  manifestFile: File;
  spritesheetFile: File;
}

export interface ArchiveEntry {
  filename: string;
  directory: boolean;
  encrypted: boolean;
  uncompressedSize: number;
  read(): Promise<Uint8Array>;
}

export interface OpenArchiveResult {
  entries: Iterable<ArchiveEntry> | AsyncIterable<ArchiveEntry>;
  close(): Promise<void>;
}

export type ArchiveOpener = (file: File) => Promise<OpenArchiveResult>;

interface NormalizedArchiveEntry {
  entry: ArchiveEntry;
  path: string;
}

async function openZipJsArchive(file: File): Promise<OpenArchiveResult> {
  const reader = new ZipReader(new BlobReader(file), { strictness: 'strict' });
  const entries = (async function* (): AsyncGenerator<ArchiveEntry> {
    for await (const source of reader.getEntriesGenerator({ strictness: 'strict' })) {
      yield {
        filename: source.filename,
        directory: source.directory,
        encrypted: Boolean(source.encrypted),
        uncompressedSize: source.uncompressedSize,
        read: async () => {
          if (source.directory || !('getData' in source)) return new Uint8Array();
          return source.getData(new Uint8ArrayWriter(), {
            checkSignature: true,
            checkOverlappingEntry: true,
            strictness: 'strict',
          });
        },
      };
    }
  }());
  return { entries, close: () => reader.close() };
}

function normalizeEntryPath(filename: string): string {
  if (filename.includes('\0')) throw new PetImportError('archive-path-unsafe');
  const slashPath = filename.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[A-Za-z]:/.test(slashPath)) {
    throw new PetImportError('archive-path-unsafe');
  }
  const segments = slashPath.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) throw new PetImportError('archive-path-unsafe');
  return segments.join('/');
}

function dirname(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function joinPath(directory: string, relative: string): string {
  return normalizeEntryPath(directory.length === 0 ? relative : `${directory}/${relative}`);
}

function isIgnored(path: string): boolean {
  const segments = path.split('/');
  return segments.includes('__MACOSX') || basename(path) === '.DS_Store';
}

function isWebp(path: string): boolean {
  return basename(path).toLowerCase().endsWith('.webp');
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function selectAtlas(
  entries: NormalizedArchiveEntry[],
  manifestPath: string,
  spritesheetPath: string,
): NormalizedArchiveEntry {
  const manifestDirectory = dirname(manifestPath);
  let resolvedPath: string | undefined;
  try {
    normalizeEntryPath(spritesheetPath);
    resolvedPath = joinPath(manifestDirectory, spritesheetPath);
  } catch (reason) {
    if (!(reason instanceof PetImportError) || reason.code !== 'archive-path-unsafe') throw reason;
  }

  if (resolvedPath !== undefined) {
    const resolvedMatches = entries.filter(({ path }) => (
      isWebp(path) && path.toLowerCase() === resolvedPath.toLowerCase()
    ));
    if (resolvedMatches.length > 1) {
      throw new PetImportError('archive-atlas-ambiguous');
    }
    if (resolvedMatches.length === 1) return resolvedMatches[0]!;
  }

  const expectedBasename = basename(spritesheetPath).toLowerCase();
  const fallbackMatches = entries.filter(({ path }) => (
    isWebp(path)
    && dirname(path).toLowerCase() === manifestDirectory.toLowerCase()
    && basename(path).toLowerCase() === expectedBasename
  ));
  if (fallbackMatches.length > 1) {
    throw new PetImportError('archive-atlas-ambiguous');
  }
  if (fallbackMatches.length === 0) {
    throw new PetImportError('archive-files-missing');
  }
  return fallbackMatches[0]!;
}

export async function extractCodexPetArchive(
  archiveFile: File,
  openArchive: ArchiveOpener = openZipJsArchive,
): Promise<CodexPetFilePair> {
  if (!archiveFile.name.toLowerCase().endsWith('.zip')) {
    throw new PetImportError('archive-invalid');
  }
  if (archiveFile.size > MAX_ARCHIVE_BYTES) {
    throw new PetImportError('archive-too-large');
  }

  let archive: OpenArchiveResult | undefined;
  try {
    archive = await openArchive(archiveFile);
    const entries: ArchiveEntry[] = [];
    for await (const entry of archive.entries) {
      if (entries.length === MAX_ARCHIVE_ENTRIES) {
        throw new PetImportError('archive-entry-limit');
      }
      entries.push(entry);
    }
    const normalizedEntries = entries.map((entry) => ({
      entry,
      path: normalizeEntryPath(entry.filename),
    }));

    if (normalizedEntries.some(({ entry }) => entry.encrypted)) {
      throw new PetImportError('archive-encrypted');
    }
    const expandedBytes = normalizedEntries.reduce(
      (total, { entry }) => total + entry.uncompressedSize,
      0,
    );
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new PetImportError('archive-expanded-too-large');
    }

    const files = normalizedEntries.filter(({ entry, path }) => (
      !entry.directory && !isIgnored(path)
    ));
    const manifests = files.filter(({ path }) => basename(path).toLowerCase() === 'pet.json');
    if (manifests.length === 0) {
      throw new PetImportError('archive-files-missing');
    }
    if (manifests.length > 1) {
      throw new PetImportError('archive-multiple-manifests');
    }

    const manifest = manifests[0]!;
    const manifestFile = new File(
      [copyToArrayBuffer(await manifest.entry.read())],
      basename(manifest.path),
      { type: 'application/json' },
    );
    const parsedManifest = await parseCodexPetManifestFile(manifestFile);
    const atlas = selectAtlas(files, manifest.path, parsedManifest.spritesheetPath);
    const spritesheetFile = new File(
      [copyToArrayBuffer(await atlas.entry.read())],
      basename(parsedManifest.spritesheetPath),
      { type: 'image/webp' },
    );

    return { manifestFile, spritesheetFile };
  } catch (reason) {
    if (reason instanceof PetImportError) throw reason;
    throw new PetImportError('archive-invalid');
  } finally {
    await archive?.close().catch(() => undefined);
  }
}
