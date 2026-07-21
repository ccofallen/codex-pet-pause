import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const syntheticOrigin = 'https://deployment-build.invalid';

function normalizeBasePath(value) {
  const segment = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return segment === '' ? '/' : `/${segment}/`;
}

function parseHtmlTags(html) {
  const tags = [];
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of html.matchAll(tagPattern)) {
    const attributes = new Map();
    for (const attribute of match[2].matchAll(attributePattern)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    tags.push({ name: match[1].toLowerCase(), attributes });
  }
  return tags;
}

function resolveReference(value, baseUrl) {
  const url = new URL(value, baseUrl);
  if (url.protocol === 'data:') return { external: true, url };
  if (url.origin !== baseUrl.origin) {
    return { external: /^https?:$/.test(url.protocol), url };
  }
  return { external: false, url };
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (source.startsWith('//', index)) {
      index = source.indexOf('\n', index + 2);
      if (index === -1) break;
    } else if (source.startsWith('/*', index)) {
      index = source.indexOf('*/', index + 2);
      if (index === -1) break;
      index += 2;
    } else if (character === '"' || character === "'") {
      const quote = character;
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') index += 1;
        value += source[index] ?? '';
        index += 1;
      }
      index += 1;
      tokens.push({ type: 'string', value });
    } else if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/.test(source[index] ?? '')) index += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, index) });
    } else {
      tokens.push({ type: 'punctuation', value: character });
      index += 1;
    }
  }
  return tokens;
}

function consumeQualifiedName(tokens, index, expectedName) {
  if (tokens[index]?.type !== 'identifier') return null;
  let name = tokens[index].value;
  index += 1;
  while (tokens[index]?.value === '.' && tokens[index + 1]?.type === 'identifier') {
    name = tokens[index + 1].value;
    index += 2;
  }
  return name === expectedName ? index : null;
}

function hasNavigationRouteHandler(serviceWorker, expectedUrl) {
  const tokens = tokenizeJavaScript(serviceWorker);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== 'registerRoute' || tokens[index + 1]?.value !== '(' || tokens[index + 2]?.value !== 'new') continue;
    let cursor = consumeQualifiedName(tokens, index + 3, 'NavigationRoute');
    if (cursor === null || tokens[cursor]?.value !== '(') continue;
    cursor = consumeQualifiedName(tokens, cursor + 1, 'createHandlerBoundToURL');
    if (cursor === null || tokens[cursor]?.value !== '(' || tokens[cursor + 1]?.type !== 'string' || tokens[cursor + 1].value !== expectedUrl) continue;
    if (tokens[cursor + 2]?.value === ')' && tokens[cursor + 3]?.value === ')' && tokens[cursor + 4]?.value === ')') return true;
  }
  return false;
}

const expectedBase = normalizeBasePath(process.argv[2] ?? '/');
const expectedBaseUrl = new URL(expectedBase, syntheticOrigin);
const dist = resolve('dist');
const index = await readFile(resolve(dist, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = await readFile(resolve(dist, 'sw.js'), 'utf8');
const files = await readdir(resolve(dist, 'assets'));

const failures = [];
const tags = parseHtmlTags(index);
const assetTags = new Set(['script', 'link', 'img', 'audio', 'video', 'source', 'track', 'embed', 'object']);
for (const tag of tags) {
  if (!assetTags.has(tag.name)) continue;
  for (const attribute of ['src', 'href']) {
    const value = tag.attributes.get(attribute);
    if (value === undefined) continue;
    const reference = resolveReference(value, expectedBaseUrl);
    if (reference.external) continue;
    if (!reference.url.pathname.startsWith(expectedBase)) {
      failures.push(`index.html local URL escapes base after resolution: ${value} -> ${reference.url.pathname}`);
    }
  }
}
const bundledLocalUrlPattern = /(?:url\(\s*|["'`])(\/(?:assets|icons)\/[^"'`\s)\\]+|\/favicon\.svg)(?=["'`\s)]|\))/g;
const builtInMediaPaths = [
  'assets/cat/neko-pause-cat.webp',
  'assets/cat/neko-pause-cat-fallback.png',
  'assets/cat/meow.wav',
];
for (const file of files.filter((entry) => /\.(?:css|js)$/.test(entry))) {
  const bundle = await readFile(resolve(dist, 'assets', file), 'utf8');
  for (const match of bundle.matchAll(bundledLocalUrlPattern)) {
    const value = match[1];
    const reference = resolveReference(value, expectedBaseUrl);
    if (!reference.url.pathname.startsWith(expectedBase)) {
      failures.push(`built bundle local URL escapes base after resolution: ${value} -> ${reference.url.pathname}`);
    }
  }
  for (const mediaPath of builtInMediaPaths) {
    const mediaUrl = `${expectedBase}${mediaPath}`;
    if (!bundle.includes(mediaUrl)) continue;
    try {
      await readFile(resolve(dist, mediaPath));
    } catch {
      failures.push(`referenced built-in media is missing from dist: ${mediaUrl}`);
    }
  }
}
const manifestLinks = tags.filter(({ name, attributes }) => name === 'link' && attributes.get('rel')?.split(/\s+/).includes('manifest'));
const expectedManifestPath = `${expectedBase}manifest.webmanifest`;
if (manifestLinks.length !== 1) {
  failures.push(`index.html must contain exactly one rel=manifest link to ${expectedManifestPath}`);
} else {
  const manifestReference = resolveReference(manifestLinks[0].attributes.get('href') ?? '', expectedBaseUrl);
  if (manifestReference.external || manifestReference.url.pathname !== expectedManifestPath) {
    failures.push(`index.html must contain exactly one rel=manifest link to ${expectedManifestPath}`);
  }
}
if (manifest.start_url !== expectedBase) failures.push(`manifest start_url is ${manifest.start_url}`);
if (manifest.scope !== expectedBase) failures.push(`manifest scope is ${manifest.scope}`);
const expectedIcons = [
  { src: `${expectedBase}icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
  { src: `${expectedBase}icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
];
const icons = manifest.icons ?? [];
const normalizeIcons = (value) => value
  .map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose }))
  .sort((left, right) => left.src.localeCompare(right.src));
if (JSON.stringify(normalizeIcons(icons)) !== JSON.stringify(normalizeIcons(expectedIcons))) {
  failures.push('manifest icons do not match the expected icon set');
}
for (const icon of icons) {
  const reference = resolveReference(icon.src ?? '', expectedBaseUrl);
  if (reference.external || !reference.url.pathname.startsWith(expectedBase)) {
    failures.push(`icon escapes base after resolution: ${icon.src} -> ${reference.url.pathname}`);
    continue;
  }
  try {
    await readFile(resolve(dist, reference.url.pathname.slice(expectedBase.length)));
  } catch {
    failures.push(`referenced icon is missing from dist: ${icon.src}`);
  }
}
const navigationFallback = `createHandlerBoundToURL("${expectedBase}index.html")`;
if (!hasNavigationRouteHandler(serviceWorker, `${expectedBase}index.html`)) {
  failures.push(`service worker must register a NavigationRoute with ${navigationFallback}`);
}
if (index.includes('__NEKO_TEST_NOW__') || serviceWorker.includes('__NEKO_TEST_NOW__')) failures.push('test clock leaked into release output');
if (files.length === 0) failures.push('no built assets found');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Deployment build verified for ${expectedBase}`);
}
