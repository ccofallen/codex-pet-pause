export const PETDEX_URL = 'https://petdex.dev/';
export const MAX_PETDEX_ARCHIVE_BYTES = 32 * 1024 * 1024;

export function isAllowedPetdexNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && (url.hostname === 'petdex.dev' || url.hostname.endsWith('.petdex.dev'));
  } catch {
    return false;
  }
}

export function isSupportedPetArchive(filename, mimeType = '', rawUrl = '') {
  const normalizedFilename = String(filename ?? '').toLowerCase();
  const normalizedMime = String(mimeType ?? '').toLowerCase();
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    pathname = '';
  }
  return normalizedFilename.endsWith('.zip')
    || pathname.endsWith('.zip')
    || normalizedMime === 'application/zip'
    || normalizedMime === 'application/x-zip-compressed';
}
