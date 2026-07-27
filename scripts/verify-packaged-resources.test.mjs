import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./verify-packaged-resources.mjs', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

test('accepts packaged HTML resources that resolve beside index.html', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-packaged-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("packaged");');
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><script type="module" src="./assets/app.js"></script>',
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects resources that file: would resolve outside the packaged dist directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-unpackaged-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("unreachable");');
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><script type="module" src="/assets/app.js"></script>',
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /resolves outside packaged dist/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an absolute file URL outside the packaged dist directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-file-url-'));
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'codex-pet-outside-'));
  try {
    const outsideResource = join(outsideDirectory, 'outside.js');
    await writeFile(outsideResource, 'console.log("outside");');
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><script type="module" src="${pathToFileURL(outsideResource)}"></script>`,
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /resolves outside packaged dist/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test('consistently ignores allowed external HTML and CSS references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-external-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'assets', 'app.css'),
      [
        '.http { background: url("https://example.com/http.png"); }',
        '.protocol { background: url(//cdn.example.com/protocol.png); }',
        '.data { background: url(data:image/png;base64,AAAA); }',
        '.blob { background: url(blob:https://example.com/id); }',
      ].join('\n'),
    );
    await writeFile(
      join(directory, 'index.html'),
      [
        '<!doctype html>',
        '<link rel="stylesheet" href="./assets/app.css">',
        '<link rel="preconnect" href="https://example.com">',
        '<script src="//cdn.example.com/app.js"></script>',
        '<img src="data:image/png;base64,AAAA">',
        '<img src="blob:https://example.com/id">',
      ].join(''),
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('skips http, https, and protocol-relative stylesheet and manifest links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-external-links-'));
  try {
    await writeFile(
      join(directory, 'index.html'),
      [
        '<!doctype html>',
        '<link rel="stylesheet" href="http://example.com/http.css">',
        '<link rel="stylesheet" href="https://example.com/https.css">',
        '<link rel="stylesheet" href="//cdn.example.com/protocol.css">',
        '<link rel="manifest" href="http://example.com/http.webmanifest">',
        '<link rel="manifest" href="https://example.com/https.webmanifest">',
        '<link rel="manifest" href="//cdn.example.com/protocol.webmanifest">',
      ].join(''),
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('continues validating local stylesheets and manifests beside external links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-mixed-links-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'assets', 'local.css'),
      '.missing { background: url("./missing.png"); }',
    );
    await writeFile(
      join(directory, 'manifest.webmanifest'),
      JSON.stringify({
        start_url: './',
        scope: './',
        icons: [{ src: './missing-icon.png' }],
      }),
    );
    await writeFile(
      join(directory, 'index.html'),
      [
        '<!doctype html>',
        '<link rel="stylesheet" href="./assets/local.css">',
        '<link rel="stylesheet" href="https://example.com/external.css">',
        '<link rel="manifest" href="./manifest.webmanifest">',
        '<link rel="manifest" href="//cdn.example.com/external.webmanifest">',
      ].join(''),
    );
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing packaged resource: \.\/missing\.png/);
    assert.match(result.stderr, /Missing packaged resource: \.\/missing-icon\.png/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the generated desktop build resolves its resources inside packaged dist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-desktop-build-'));
  try {
    const build = spawnSync(
      process.execPath,
      [vite, 'build', '--mode', 'desktop', '--outDir', directory],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);

    const html = await readFile(join(directory, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /(?:src|href)="\/assets\//);

    const smoke = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(smoke.status, 0, smoke.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
