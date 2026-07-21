import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const verifier = fileURLToPath(new URL('./verify-deployment-build.mjs', import.meta.url));
const pageBase = '/codex-pet-pause/';
const expectedIcons = [
  { src: `${pageBase}icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
  { src: `${pageBase}icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
];

function pageFixture({ index, icons = expectedIcons, serviceWorker, iconFiles, bundleAssets } = {}) {
  return {
    index: index ?? `<script type="module" src="${pageBase}assets/app.js"></script><link rel="stylesheet" href="${pageBase}assets/app.css"><link rel="icon" href="${pageBase}favicon.svg"><link rel="manifest" href="${pageBase}manifest.webmanifest">`,
    manifest: { start_url: pageBase, scope: pageBase, icons },
    serviceWorker: serviceWorker ?? `e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("${pageBase}index.html")))`,
    iconFiles: iconFiles ?? icons.map(({ src }) => src.slice(pageBase.length)),
    bundleAssets,
  };
}

function rootFixture() {
  return {
    index: '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"><link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest">',
    manifest: {
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    serviceWorker: 'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html")))',
    iconFiles: ['icons/pwa-192x192.png', 'icons/pwa-512x512.png'],
  };
}

async function writeFixture(directory, fixture) {
  const dist = join(directory, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  for (const [file, contents] of Object.entries(fixture.bundleAssets ?? { 'app.js': 'app' })) {
    const path = join(dist, 'assets', file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  await writeFile(join(dist, 'index.html'), fixture.index);
  await writeFile(join(dist, 'manifest.webmanifest'), JSON.stringify(fixture.manifest));
  await writeFile(join(dist, 'sw.js'), fixture.serviceWorker);
  for (const icon of fixture.iconFiles) {
    const path = join(dist, icon);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'icon');
  }
}

async function runCase(name, input, fixture, expectedStatus, expectedOutput) {
  const directory = await mkdtemp(join(tmpdir(), 'verify-deployment-build-'));
  try {
    await writeFixture(directory, fixture);
    const result = spawnSync(process.execPath, [verifier, input], {
      cwd: directory,
      encoding: 'utf8',
    });
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== expectedStatus || !output.includes(expectedOutput)) {
      throw new Error(`${name}: expected status ${expectedStatus} and ${JSON.stringify(expectedOutput)}, got status ${result.status}: ${output.trim()}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const failures = [];
const cases = [
  ['normalizes an all-slash base to root', '////', rootFixture(), 0, 'Deployment build verified for /'],
  ['rejects an escaped local stylesheet URL', pageBase, pageFixture({
    index: `<script type="module" src="${pageBase}assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"><link rel="icon" href="${pageBase}favicon.svg"><link rel="manifest" href="${pageBase}manifest.webmanifest">`,
  }), 1, 'index.html local URL escapes base after resolution: /assets/app.css -> /assets/app.css'],
  ['rejects a root-absolute public media URL from an emitted bundle', pageBase, pageFixture({
    bundleAssets: { 'app.js': 'const cat = "/assets/cat/neko-pause-cat.webp";' },
  }), 1, 'built bundle local URL escapes base after resolution: /assets/cat/neko-pause-cat.webp -> /assets/cat/neko-pause-cat.webp'],
  ['requires every built-in media URL from an emitted bundle to exist in dist', pageBase, pageFixture({
    bundleAssets: { 'app.js': `const meow = "${pageBase}assets/cat/meow.wav";` },
  }), 1, `referenced built-in media is missing from dist: ${pageBase}assets/cat/meow.wav`],
  ['accepts resolved local URLs with query and fragment components', pageBase, pageFixture({
    index: `<script type="module" src="assets/app.js"></script><link rel="stylesheet" href="${pageBase}assets/app.css?cache=1#style"><link rel="icon" href="?cache=1"><img src="#preview"><link rel="manifest" href="${pageBase}manifest.webmanifest?cache=1#manifest">`,
  }), 0, `Deployment build verified for ${pageBase}`],
  ['rejects a traversal URL after resolution', pageBase, pageFixture({
    index: `<script type="module" src="${pageBase}assets/app.js"></script><link rel="stylesheet" href="${pageBase}../assets/app.css"><link rel="icon" href="${pageBase}favicon.svg"><link rel="manifest" href="${pageBase}manifest.webmanifest">`,
  }), 1, `index.html local URL escapes base after resolution: ${pageBase}../assets/app.css -> /assets/app.css`],
  ['requires the complete expected icon set', pageBase, pageFixture({
    icons: [expectedIcons[1]],
  }), 1, 'manifest icons do not match the expected icon set'],
  ['requires every referenced icon file', pageBase, pageFixture({
    iconFiles: ['icons/pwa-192x192.png'],
  }), 1, `referenced icon is missing from dist: ${pageBase}icons/pwa-512x512.png`],
  ['requires the expected manifest link path', pageBase, pageFixture({
    index: `<script type="module" src="${pageBase}assets/app.js"></script><link rel="stylesheet" href="${pageBase}assets/app.css"><link rel="icon" href="${pageBase}favicon.svg"><link rel="manifest" href="${pageBase}other.webmanifest">`,
  }), 1, `index.html must contain exactly one rel=manifest link to ${pageBase}manifest.webmanifest`],
  ['requires the Workbox navigation handler call', pageBase, pageFixture({
    serviceWorker: `const note = 'createHandlerBoundToURL("${pageBase}index.html")'; // createHandlerBoundToURL("${pageBase}index.html")`,
  }), 1, `service worker must register a NavigationRoute with createHandlerBoundToURL("${pageBase}index.html")`],
];
for (const test of cases) {
  try {
    await runCase(...test);
  } catch (error) {
    failures.push(error.message);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Deployment verifier regression harness passed (${cases.length} cases).`);
}
