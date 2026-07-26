import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function referencesFromHtml(html) {
  return [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

function referencesFromCss(css) {
  return [...css.matchAll(/\burl\(\s*["']?([^"')]+)["']?\s*\)/g)]
    .map((match) => match[1]);
}

function isAllowedExternalReference(reference) {
  const scheme = reference.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  return (
    reference.startsWith('#')
    || reference.startsWith('//')
    || scheme === 'http'
    || scheme === 'https'
    || scheme === 'data'
    || scheme === 'blob'
  );
}

function packagedFilePath(reference, sourceFile, packageDirectory) {
  if (isAllowedExternalReference(reference)) return undefined;
  const targetUrl = new URL(reference, pathToFileURL(sourceFile));
  if (targetUrl.protocol !== 'file:') return undefined;
  const targetPath = fileURLToPath(targetUrl);
  const packageRelativePath = relative(packageDirectory, targetPath);
  if (
    packageRelativePath === '..'
    || packageRelativePath.startsWith(`..${sep}`)
    || isAbsolute(packageRelativePath)
  ) {
    return undefined;
  }
  return targetPath;
}

async function verifyReference(reference, sourceFile, packageDirectory) {
  if (isAllowedExternalReference(reference)) return [];
  const targetUrl = new URL(reference, pathToFileURL(sourceFile));
  if (targetUrl.protocol !== 'file:') {
    return [`Unsupported packaged resource protocol: ${reference} from ${sourceFile}`];
  }
  const targetPath = fileURLToPath(targetUrl);
  const packageRelativePath = relative(packageDirectory, targetPath);
  if (
    packageRelativePath === '..'
    || packageRelativePath.startsWith(`..${sep}`)
    || isAbsolute(packageRelativePath)
  ) {
    return [`${reference} from ${sourceFile} resolves outside packaged dist`];
  }
  try {
    await access(targetPath);
    return [];
  } catch {
    return [`Missing packaged resource: ${reference} from ${sourceFile}`];
  }
}

export async function verifyPackagedResources(directory) {
  const packageDirectory = resolve(directory);
  const indexPath = resolve(packageDirectory, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const failures = [];
  const htmlReferences = referencesFromHtml(html);

  for (const reference of htmlReferences) {
    failures.push(...await verifyReference(reference, indexPath, packageDirectory));
  }

  for (const reference of htmlReferences.filter((entry) => /\.css(?:[?#]|$)/.test(entry))) {
    const cssPath = packagedFilePath(reference, indexPath, packageDirectory);
    if (cssPath === undefined) continue;
    const css = await readFile(cssPath, 'utf8').catch(() => undefined);
    if (css === undefined) continue;
    for (const cssReference of referencesFromCss(css)) {
      failures.push(...await verifyReference(cssReference, cssPath, packageDirectory));
    }
  }

  for (const reference of htmlReferences.filter((entry) => /manifest\.webmanifest(?:[?#]|$)/.test(entry))) {
    const manifestPath = packagedFilePath(reference, indexPath, packageDirectory);
    if (manifestPath === undefined) continue;
    const serializedManifest = await readFile(manifestPath, 'utf8').catch(() => undefined);
    if (serializedManifest === undefined) continue;
    const manifest = JSON.parse(serializedManifest);
    const manifestReferences = [
      manifest.start_url,
      manifest.scope,
      ...(manifest.icons ?? []).map((icon) => icon.src),
    ].filter((entry) => typeof entry === 'string');
    for (const manifestReference of manifestReferences) {
      failures.push(...await verifyReference(manifestReference, manifestPath, packageDirectory));
    }
  }

  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-packaged-resources.mjs <dist-directory>');
  }
  const failures = await verifyPackagedResources(process.argv[2]);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Packaged desktop resources resolve inside dist.');
}
