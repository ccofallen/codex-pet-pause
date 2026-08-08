import { afterEach, describe, expect, test, vi } from 'vitest';
import { readAndroidBlobBytes } from './androidRepositories';

afterEach(() => vi.unstubAllGlobals());

describe('readAndroidBlobBytes', () => {
  test('prefers Blob.arrayBuffer when the runtime provides it', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2]).buffer);

    await expect(readAndroidBlobBytes({ arrayBuffer } as unknown as Blob))
      .resolves.toEqual(new Uint8Array([1, 2]).buffer);
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  test('falls back to FileReader when Blob.arrayBuffer is unavailable', async () => {
    class FallbackReader {
      result: ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(): void {
        this.result = new Uint8Array([3, 4]).buffer;
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', FallbackReader);

    await expect(readAndroidBlobBytes({} as Blob))
      .resolves.toEqual(new Uint8Array([3, 4]).buffer);
  });

  test('rejects a FileReader failure without producing an empty asset', async () => {
    class FailingReader {
      result: ArrayBuffer | null = null;
      error: DOMException | null = new DOMException('broken reader');
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsArrayBuffer(): void {
        this.onerror?.();
      }
    }
    vi.stubGlobal('FileReader', FailingReader);

    await expect(readAndroidBlobBytes({} as Blob)).rejects.toThrow('broken reader');
  });
});
