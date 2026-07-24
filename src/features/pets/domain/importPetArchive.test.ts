import {
  BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter, type Entry,
} from '@zip.js/zip.js';
import { describe, expect, test, vi } from 'vitest';
import { parseCodexPetImport, PetImportError } from './importPet';
import {
  extractCodexPetArchive, type ArchiveEntry, type ArchiveOpener,
} from './importPetArchive';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const zipFile = new File(['zip'], 'pet.zip', { type: 'application/zip' });
const validManifest = {
  id: 'murk',
  displayName: 'Murk',
  spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
};

function entry(
  filename: string,
  content: string,
  overrides: Partial<ArchiveEntry> = {},
): ArchiveEntry {
  const data = bytes(content);
  return {
    filename,
    directory: false,
    encrypted: false,
    uncompressedSize: data.byteLength,
    read: vi.fn(async () => data),
    ...overrides,
  };
}

function opener(entries: ArchiveEntry[]): ArchiveOpener {
  return vi.fn(async () => ({ entries, close: vi.fn(async () => undefined) }));
}

describe('extractCodexPetArchive', () => {
  test('extracts one nested manifest and its relative atlas', async () => {
    const macMetadata = entry('__MACOSX/._pet.json', 'metadata');
    const manifest = entry('download/murk/pet.json', JSON.stringify({
      id: 'murk',
      displayName: 'Murk',
      spriteVersionNumber: 2,
      spritesheetPath: 'art/spritesheet.webp',
    }));
    const atlas = entry('download/murk/art/spritesheet.webp', 'webp');
    const notes = entry('download/README.txt', 'notes');
    const open = opener([macMetadata, manifest, atlas, notes]);

    const result = await extractCodexPetArchive(
      new File(['zip'], 'murk.zip', { type: 'application/zip' }),
      open,
    );

    expect(result.manifestFile.name).toBe('pet.json');
    expect(result.manifestFile.type).toBe('application/json');
    expect(result.spritesheetFile.name).toBe('spritesheet.webp');
    expect(result.spritesheetFile.type).toBe('image/webp');
    expect(manifest.read).toHaveBeenCalledOnce();
    expect(atlas.read).toHaveBeenCalledOnce();
    expect(macMetadata.read).not.toHaveBeenCalled();
    expect(notes.read).not.toHaveBeenCalled();
  });

  test('uses one unambiguous same-directory basename for exported absolute paths', async () => {
    const open = opener([
      entry('kabi/pet.json', JSON.stringify({
        id: 'kabi',
        displayName: 'Kabi',
        spritesheetPath: '/generated/kabi/spritesheet.webp',
      })),
      entry('kabi/spritesheet.webp', 'webp'),
    ]);

    await expect(extractCodexPetArchive(
      new File(['zip'], 'kabi.zip', { type: 'application/zip' }),
      open,
    )).resolves.toMatchObject({
      manifestFile: { name: 'pet.json' },
      spritesheetFile: { name: 'spritesheet.webp' },
    });
  });

  test('names a case-insensitive atlas match for importer compatibility', async () => {
    const pair = await extractCodexPetArchive(zipFile, opener([
      entry('pet.json', JSON.stringify(validManifest)),
      entry('SPRITESHEET.WEBP', 'webp'),
    ]));

    await expect(parseCodexPetImport(
      pair.manifestFile,
      pair.spritesheetFile,
      123,
      vi.fn(async () => ({ width: 1536, height: 2288 })),
    )).resolves.toMatchObject({
      id: 'murk',
      spritesheetFilename: 'spritesheet.webp',
    });
  });

  test.each([
    ['unsafe traversal', [entry('../pet.json', '{}')], 'archive-path-unsafe'],
    ['absolute entry', [entry('/pet.json', '{}')], 'archive-path-unsafe'],
    ['drive entry', [entry('C:/pet.json', '{}')], 'archive-path-unsafe'],
    ['drive-relative unrelated entry', [
      entry('pet.json', JSON.stringify(validManifest)),
      entry('spritesheet.webp', 'webp'),
      entry('C:notes.txt', 'notes'),
    ], 'archive-path-unsafe'],
    ['NUL entry', [entry('pet\0.json', '{}')], 'archive-path-unsafe'],
    ['ignored unsafe metadata', [
      entry('__MACOSX/../pet.json', '{}'),
    ], 'archive-path-unsafe'],
    ['encrypted entry', [
      entry('pet.json', '{}', { encrypted: true }),
    ], 'archive-encrypted'],
    ['encrypted unrelated entry', [
      entry('pet.json', JSON.stringify(validManifest)),
      entry('spritesheet.webp', 'webp'),
      entry('notes.txt', 'secret', { encrypted: true }),
    ], 'archive-encrypted'],
    ['multiple manifests', [
      entry('a/pet.json', '{}'),
      entry('b/pet.json', '{}'),
    ], 'archive-multiple-manifests'],
  ])('rejects %s', async (_label, entries, code) => {
    await expect(extractCodexPetArchive(
      zipFile,
      opener(entries),
    )).rejects.toMatchObject({ name: 'PetImportError', code });
  });

  test('rejects more than 128 entries before reading content', async () => {
    const entries = Array.from({ length: 129 }, (_, index) => (
      entry(`notes/${index}.txt`, 'x')
    ));

    await expect(extractCodexPetArchive(
      zipFile,
      opener(entries),
    )).rejects.toMatchObject({ code: 'archive-entry-limit' });
    expect(entries.every(({ read }) => !vi.mocked(read).mock.calls.length)).toBe(true);
  });

  test('streams ZIP.js entries and stops after the 129th entry', async () => {
    let yielded = 0;
    const eagerEnumeration = vi.spyOn(ZipReader.prototype, 'getEntries')
      .mockRejectedValue(new Error('eager enumeration must not be used'));
    const streamingEnumeration = vi.spyOn(ZipReader.prototype, 'getEntriesGenerator')
      .mockImplementation(async function* () {
        while (true) {
          yielded += 1;
          if (yielded > 129) {
            throw new Error('enumerated beyond the entry limit boundary');
          }
          yield {
            filename: `notes/${yielded}.txt`,
            directory: false,
            encrypted: false,
            uncompressedSize: 1,
            getData: vi.fn(),
          } as unknown as Entry;
        }
      });

    try {
      await expect(extractCodexPetArchive(zipFile)).rejects.toMatchObject({
        code: 'archive-entry-limit',
      });
      expect(eagerEnumeration).not.toHaveBeenCalled();
      expect(streamingEnumeration).toHaveBeenCalledOnce();
      expect(yielded).toBe(129);
    } finally {
      eagerEnumeration.mockRestore();
      streamingEnumeration.mockRestore();
    }
  });

  test('rejects declared expanded content over 32 MiB before extraction', async () => {
    const huge = entry('pet.json', '{}', {
      uncompressedSize: 32 * 1024 * 1024 + 1,
    });

    await expect(extractCodexPetArchive(
      zipFile,
      opener([huge]),
    )).rejects.toMatchObject({ code: 'archive-expanded-too-large' });
    expect(huge.read).not.toHaveBeenCalled();
  });

  test('rejects a declared expanded-size sum over 32 MiB before extraction', async () => {
    const manifest = entry('pet.json', JSON.stringify(validManifest), {
      uncompressedSize: 16 * 1024 * 1024 + 1,
    });
    const atlas = entry('spritesheet.webp', 'webp', {
      uncompressedSize: 16 * 1024 * 1024,
    });

    await expect(extractCodexPetArchive(
      zipFile,
      opener([manifest, atlas]),
    )).rejects.toMatchObject({ code: 'archive-expanded-too-large' });
    expect(manifest.read).not.toHaveBeenCalled();
    expect(atlas.read).not.toHaveBeenCalled();
  });

  test('rejects a missing atlas', async () => {
    await expect(extractCodexPetArchive(
      new File(['zip'], 'missing.zip', { type: 'application/zip' }),
      opener([entry('pet.json', JSON.stringify(validManifest))]),
    )).rejects.toMatchObject({ code: 'archive-files-missing' });
  });

  test('rejects ambiguous case-insensitive atlas matches', async () => {
    await expect(extractCodexPetArchive(
      new File(['zip'], 'ambiguous.zip', { type: 'application/zip' }),
      opener([
        entry('pet/pet.json', JSON.stringify(validManifest)),
        entry('pet/spritesheet.webp', 'one'),
        entry('pet/SPRITESHEET.WEBP', 'two'),
      ]),
    )).rejects.toMatchObject({ code: 'archive-atlas-ambiguous' });
  });

  test('rejects a compressed archive over 32 MiB without opening it', async () => {
    const open = opener([]);

    await expect(extractCodexPetArchive(
      new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'large.zip'),
      open,
    )).rejects.toMatchObject({ code: 'archive-too-large' });
    expect(open).not.toHaveBeenCalled();
  });

  test('rejects a non-ZIP filename without opening it', async () => {
    const open = opener([]);

    await expect(extractCodexPetArchive(
      new File(['zip'], 'pet.webp', { type: 'application/zip' }),
      open,
    )).rejects.toMatchObject({ code: 'archive-invalid' });
    expect(open).not.toHaveBeenCalled();
  });

  test('closes the archive after successful extraction', async () => {
    const close = vi.fn(async () => undefined);
    await extractCodexPetArchive(zipFile, async () => ({
      entries: [
        entry('pet.json', JSON.stringify(validManifest)),
        entry('spritesheet.webp', 'webp'),
      ],
      close,
    }));

    expect(close).toHaveBeenCalledOnce();
  });

  test('closes the archive after validation fails', async () => {
    const close = vi.fn(async () => undefined);
    await expect(extractCodexPetArchive(zipFile, async () => ({
      entries: [entry('../pet.json', '{}')],
      close,
    }))).rejects.toMatchObject({ code: 'archive-path-unsafe' });

    expect(close).toHaveBeenCalledOnce();
  });

  test('maps unknown reader errors to archive-invalid', async () => {
    await expect(extractCodexPetArchive(zipFile, async () => {
      throw new Error('reader failure');
    })).rejects.toMatchObject({ name: 'PetImportError', code: 'archive-invalid' });
  });

  test('preserves PetImportError codes from the archive opener', async () => {
    await expect(extractCodexPetArchive(zipFile, async () => {
      throw new PetImportError('archive-encrypted');
    })).rejects.toMatchObject({ name: 'PetImportError', code: 'archive-encrypted' });
  });

  test('preserves manifest validation errors and still closes the archive', async () => {
    const close = vi.fn(async () => undefined);
    await expect(extractCodexPetArchive(zipFile, async () => ({
      entries: [
        entry('pet.json', JSON.stringify({ ...validManifest, id: '../unsafe' })),
        entry('spritesheet.webp', 'webp'),
      ],
      close,
    }))).rejects.toMatchObject({ code: 'unsafe-id' });

    expect(close).toHaveBeenCalledOnce();
  });
});

async function realArchive(): Promise<File> {
  const writer = new BlobWriter('application/zip');
  const zip = new ZipWriter(writer);
  await zip.add('pet/murk/pet.json', new TextReader(JSON.stringify({
    id: 'murk',
    displayName: 'Murk',
    spriteVersionNumber: 2,
    spritesheetPath: 'spritesheet.webp',
  })));
  await zip.add('pet/murk/spritesheet.webp', new Uint8ArrayReader(bytes('webp')));
  await zip.close();
  const archiveBlob = await writer.getData();
  return new File(
    [await archiveBlob.arrayBuffer()],
    'murk.zip',
    { type: 'application/zip' },
  );
}

async function realArchiveWithEntries(count: number): Promise<File> {
  const writer = new BlobWriter('application/zip');
  const zip = new ZipWriter(writer);
  for (let index = 0; index < count; index += 1) {
    await zip.add(`notes/${index}.txt`, new TextReader('x'));
  }
  await zip.close();
  const archiveBlob = await writer.getData();
  return new File(
    [await archiveBlob.arrayBuffer()],
    'many-entries.zip',
    { type: 'application/zip' },
  );
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

test('extracts a real ZIP.js archive', async () => {
  const originalArrayBuffer = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    value(this: Blob) {
      return readBlobBytes(this);
    },
  });

  try {
    const result = await extractCodexPetArchive(await realArchive());
    expect(new TextDecoder().decode(await readBlobBytes(result.spritesheetFile))).toBe('webp');
  } finally {
    if (originalArrayBuffer === undefined) {
      delete (Blob.prototype as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
    } else {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', originalArrayBuffer);
    }
  }
});

test('rejects a real 129-entry ZIP.js archive', async () => {
  const originalArrayBuffer = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    value(this: Blob) {
      return readBlobBytes(this);
    },
  });

  try {
    await expect(extractCodexPetArchive(
      await realArchiveWithEntries(129),
    )).rejects.toMatchObject({ code: 'archive-entry-limit' });
  } finally {
    if (originalArrayBuffer === undefined) {
      delete (Blob.prototype as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
    } else {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', originalArrayBuffer);
    }
  }
});
