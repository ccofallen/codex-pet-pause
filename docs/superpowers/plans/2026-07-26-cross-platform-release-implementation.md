# Codex Pet Pause Cross-Platform Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish installable Codex Pet Pause packages for macOS, Windows, and Linux from one GitHub Release, with persistent local data and an approved minimal single-line cat identity.

**Architecture:** Keep the accepted Electron application and existing web application in one repository. Electron Builder produces native installers on GitHub-hosted macOS, Windows, and Ubuntu runners; a tag-only release job collects validated artifacts into one GitHub Release. A deterministic Node asset generator turns one vector brand source into platform icons, PWA icons, and the README cover.

**Tech Stack:** Electron 35, Electron Builder 24, React 19, Vite 8, TypeScript 5.9, GitHub Actions, Node.js 22, Sharp, png2icons.

## Global Constraints

- Repository: `ccofallen/codex-pet-pause`.
- Application ID remains `io.elevenlabs.codexpetpause`.
- Product name remains `Codex Pet Pause`.
- macOS targets DMG for Apple Silicon and Intel.
- Windows targets an x64 NSIS installer.
- Linux targets x64 AppImage and DEB.
- Initial packages are unsigned and must document Gatekeeper and SmartScreen warnings.
- Automatic updates, app stores, Windows ARM64, and Linux ARM64 remain out of scope.
- Settings, reminders, activity history, window state, and imported pets remain local and survive relaunch and upgrades.
- The application icon is a deep warm brown rounded square with a warm gold single-line closed-eye cat.
- The icon contains no pause symbol, text, gradient, badge, complex facial detail, or decorative object.

## Repository Preparation

The current accepted desktop working copy has a local root commit that is not
based on the public repository history. Do not force-push it. Before Task 1,
add `https://github.com/ccofallen/codex-pet-pause.git` as `origin`, fetch
`origin/main`, and use the `superpowers:using-git-worktrees` skill to create a
clean feature worktree based on `origin/main`. Overlay the accepted desktop
working tree into that feature worktree without copying `.git`, `node_modules`,
`dist`, `release`, or `.superpowers`. Retain remote-only files. Perform all
tasks and commits in that feature worktree, preserving the accepted local app
as the source of truth when a shared file differs.

---

### Task 0: Port the Accepted Desktop Shell onto GitHub 0.2.0

**Files:**
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `src/app/DesktopApp.tsx`
- Create: `src/app/DesktopApp.test.tsx`
- Create: `src/main.desktop.tsx`
- Create: `src/main.settings.tsx`
- Create: `src/styles/desktop.css`
- Create: `src/types/electron-api.d.ts`
- Create: `scripts/desktop-smoke.sh`
- Modify: `src/main.tsx`
- Modify: `src/features/cat/components/InteractiveCatStage.tsx`
- Modify: `src/features/pets/components/CodexPetStage.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the accepted desktop reference at
  `/Users/cc/Documents/Codex/codex-pet-pause-desktop` and the green GitHub
  `main` baseline.
- Produces: an Electron pet window, settings window, IPC bridge, desktop
  renderer entry, and desktop launch/build scripts without replacing GitHub
  0.2.0 reminder, localization, import, or persistence modules.

- [ ] **Step 1: Copy the desktop entry test before implementation**

Copy only `src/app/DesktopApp.test.tsx` from the accepted desktop reference.
Adapt imports to the GitHub 0.2.0 interfaces without weakening assertions.

- [ ] **Step 2: Run the desktop entry test and verify RED**

Run:

```bash
npm run test:run -- src/app/DesktopApp.test.tsx
```

Expected: FAIL because `DesktopApp.tsx` and the desktop shell are absent.

- [ ] **Step 3: Port the minimal desktop shell**

Use the accepted local files as behavioral reference, but preserve the GitHub
0.2.0 versions of every existing business-domain file. Port the Electron main
and preload processes, renderer entries, desktop styles, Electron API types,
and only the smallest component changes required for native drag and native
context-menu IPC.

The port must retain:

- Transparent frameless always-on-top pet window.
- Pet dragging through `pet:drag-window`.
- Context menu at the pointer through `pet:show-context-menu`.
- Settings window opened from the pet context menu.
- Settings view without a second pet.
- Visibility on all macOS workspaces and full-screen spaces, guarded on other
  platforms.
- Stable `appId` and Windows App User Model ID.
- Existing localStorage, IndexedDB, and `userData` persistence.

Add Electron, Electron Builder, concurrently, and wait-on development
dependencies and the accepted desktop launch/build/package scripts. Do not add
the final cross-platform artifact matrix yet; Task 3 owns that contract.

- [ ] **Step 4: Run desktop and full regression checks**

Run:

```bash
npm run test:run -- src/app/DesktopApp.test.tsx
npm run typecheck
npm run test:run
npm run build
```

Expected: the desktop entry test passes, all 666 existing GitHub 0.2.0 tests
remain green, type checking passes, and the production build succeeds.

- [ ] **Step 5: Commit the desktop shell port**

```bash
git add electron src/app/DesktopApp.tsx src/app/DesktopApp.test.tsx src/main.desktop.tsx src/main.settings.tsx src/main.tsx src/styles/desktop.css src/types/electron-api.d.ts src/features/cat/components/InteractiveCatStage.tsx src/features/pets/components/CodexPetStage.tsx scripts/desktop-smoke.sh package.json package-lock.json
git commit -m "feat: port accepted Electron desktop shell"
```

---

### Task 1: Establish the Release Contract

**Files:**
- Create: `scripts/verify-desktop-release-config.mjs`
- Create: `scripts/verify-desktop-release-config.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `package.json` Electron Builder configuration.
- Produces: `verifyDesktopReleaseConfig(packageJson, fileExists)` returning an array of human-readable validation failures; npm script `test:desktop-release-config`.

- [ ] **Step 1: Write the failing release-contract test**

Create `scripts/verify-desktop-release-config.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDesktopReleaseConfig } from './verify-desktop-release-config.mjs';

const validPackage = {
  build: {
    appId: 'io.elevenlabs.codexpetpause',
    productName: 'Codex Pet Pause',
    mac: {
      icon: 'build/icons/icon.icns',
      target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
      artifactName: 'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
    },
    win: {
      icon: 'build/icons/icon.ico',
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: 'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
    },
    linux: {
      icon: 'build/icons/png',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      artifactName: 'Codex-Pet-Pause-${version}-linux-${arch}.${ext}',
    },
  },
};

test('accepts the approved desktop release contract', () => {
  const failures = verifyDesktopReleaseConfig(validPackage, () => true);
  assert.deepEqual(failures, []);
});

test('rejects an identity, target, or icon regression', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.appId = 'example.changed';
  invalid.build.win.target = [{ target: 'portable', arch: ['x64'] }];
  const failures = verifyDesktopReleaseConfig(invalid, () => false);
  assert.ok(failures.some((failure) => failure.includes('appId')));
  assert.ok(failures.some((failure) => failure.includes('NSIS')));
  assert.ok(failures.some((failure) => failure.includes('icon')));
});
```

- [ ] **Step 2: Run the test and confirm the contract module is missing**

Run:

```bash
node --test scripts/verify-desktop-release-config.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`verify-desktop-release-config.mjs`.

- [ ] **Step 3: Implement the release-contract validator**

Create `scripts/verify-desktop-release-config.mjs` with:

```js
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const expected = {
  appId: 'io.elevenlabs.codexpetpause',
  productName: 'Codex Pet Pause',
  macIcon: 'build/icons/icon.icns',
  winIcon: 'build/icons/icon.ico',
  linuxIcon: 'build/icons/png',
};

function targetsFor(platform) {
  return new Map(
    (platform?.target ?? []).map(({ target, arch }) => [target, arch ?? []]),
  );
}

export function verifyDesktopReleaseConfig(packageJson, fileExists = existsSync) {
  const failures = [];
  const build = packageJson.build ?? {};
  if (build.appId !== expected.appId) failures.push(`appId must be ${expected.appId}`);
  if (build.productName !== expected.productName) failures.push(`productName must be ${expected.productName}`);

  const macTargets = targetsFor(build.mac);
  if (!macTargets.get('dmg')?.includes('arm64') || !macTargets.get('dmg')?.includes('x64')) {
    failures.push('macOS DMG must target arm64 and x64');
  }
  const winTargets = targetsFor(build.win);
  if (!winTargets.get('nsis')?.includes('x64')) failures.push('Windows NSIS must target x64');
  const linuxTargets = targetsFor(build.linux);
  if (!linuxTargets.get('AppImage')?.includes('x64')) failures.push('Linux AppImage must target x64');
  if (!linuxTargets.get('deb')?.includes('x64')) failures.push('Linux DEB must target x64');

  for (const [label, icon] of [
    ['macOS icon', expected.macIcon],
    ['Windows icon', expected.winIcon],
    ['Linux icon', expected.linuxIcon],
  ]) {
    if (!fileExists(icon)) failures.push(`${label} is missing: ${icon}`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const failures = verifyDesktopReleaseConfig(packageJson, (entry) => existsSync(`${root}${entry}`));
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Desktop release configuration is valid.');
}
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test:desktop-release-config": "node --test scripts/verify-desktop-release-config.test.mjs",
    "check:desktop-release-config": "node scripts/verify-desktop-release-config.mjs"
  }
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run test:desktop-release-config
```

Expected: two tests pass.

- [ ] **Step 5: Commit the release contract**

```bash
git add package.json scripts/verify-desktop-release-config.mjs scripts/verify-desktop-release-config.test.mjs
git commit -m "test: define desktop release contract"
```

---

### Task 2: Create the Approved Brand Asset Pipeline

**Files:**
- Create: `build/brand/codex-pet-pause-icon.svg`
- Create: `build/brand/codex-pet-pause-cover.svg`
- Create: `scripts/generate-brand-assets.mjs`
- Create: `scripts/generate-brand-assets.test.mjs`
- Generate: `build/icons/icon.icns`
- Generate: `build/icons/icon.ico`
- Generate: `build/icons/icon.png`
- Generate: `build/icons/png/16x16.png`
- Generate: `build/icons/png/32x32.png`
- Generate: `build/icons/png/48x48.png`
- Generate: `build/icons/png/64x64.png`
- Generate: `build/icons/png/128x128.png`
- Generate: `build/icons/png/256x256.png`
- Generate: `build/icons/png/512x512.png`
- Generate: `build/icons/png/1024x1024.png`
- Generate: `public/icons/pwa-192x192.png`
- Generate: `public/icons/pwa-512x512.png`
- Generate: `docs/assets/codex-pet-pause-desktop-cover.png`
- Modify: `public/favicon.svg`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: approved SVG sources in `build/brand`.
- Produces: `npm run brand:generate`; deterministic native/PWA icon assets and a 1600x900 README cover.

- [ ] **Step 1: Add the asset-generation test**

Create `scripts/generate-brand-assets.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

test('generated brand assets have expected formats and dimensions', async () => {
  const icon = await sharp('build/icons/icon.png').metadata();
  const pwa192 = await sharp('public/icons/pwa-192x192.png').metadata();
  const cover = await sharp('docs/assets/codex-pet-pause-desktop-cover.png').metadata();
  const ico = await readFile('build/icons/icon.ico');
  const icns = await readFile('build/icons/icon.icns');

  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.deepEqual([pwa192.width, pwa192.height], [192, 192]);
  assert.deepEqual([cover.width, cover.height], [1600, 900]);
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
});

```

- [ ] **Step 2: Install image conversion dependencies and verify the test fails**

Run:

```bash
npm install --save-dev sharp png2icons
node --test scripts/generate-brand-assets.test.mjs
```

Expected: FAIL because the approved SVG sources and generated assets do not
exist yet.

- [ ] **Step 3: Create the minimal vector artwork**

Create `build/brand/codex-pet-pause-icon.svg` as a 1024x1024 SVG. Use a
`#563b2b` rounded-square background, a centered `#f6c780` single-line cat with
rounded caps and joins, closed-eye arcs, and no other marks.

Create `build/brand/codex-pet-pause-cover.svg` as a 1600x900 SVG. Use a warm
cream background, the same cat mark, and the exact title `Codex Pet Pause`.
Keep at least 12% empty margin around every edge.

Replace `public/favicon.svg` with the same icon geometry and colors.

- [ ] **Step 4: Implement deterministic asset generation**

Create `scripts/generate-brand-assets.mjs` using:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import png2icons from 'png2icons';
import sharp from 'sharp';

await mkdir('build/icons/png', { recursive: true });
await mkdir('public/icons', { recursive: true });
await mkdir('docs/assets', { recursive: true });

const iconSvg = await readFile('build/brand/codex-pet-pause-icon.svg');
const iconPng = await sharp(iconSvg).resize(1024, 1024).png().toBuffer();
await writeFile('build/icons/icon.png', iconPng);

for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  await sharp(iconPng).resize(size, size).png().toFile(`build/icons/png/${size}x${size}.png`);
}
for (const size of [192, 512]) {
  await sharp(iconPng).resize(size, size).png().toFile(`public/icons/pwa-${size}x${size}.png`);
}

const ico = png2icons.createICO(iconPng, png2icons.BICUBIC, 0, true);
const icns = png2icons.createICNS(iconPng, png2icons.BICUBIC, 0);
if (ico === null || icns === null) throw new Error('Native icon conversion failed');
await writeFile('build/icons/icon.ico', ico);
await writeFile('build/icons/icon.icns', icns);

const coverSvg = await readFile('build/brand/codex-pet-pause-cover.svg');
await sharp(coverSvg).resize(1600, 900).png().toFile('docs/assets/codex-pet-pause-desktop-cover.png');
```

Add these scripts:

```json
{
  "scripts": {
    "brand:generate": "node scripts/generate-brand-assets.mjs",
    "test:brand-assets": "npm run brand:generate && node --test scripts/generate-brand-assets.test.mjs"
  }
}
```

- [ ] **Step 5: Generate and inspect the assets**

Run:

```bash
npm run test:brand-assets
```

Expected: the generated-format test passes. Open `build/icons/icon.png` and
`docs/assets/codex-pet-pause-desktop-cover.png`; confirm the cat remains clear
at 16, 32, and 64 pixels, the icon has no pause symbol or text, and the cover
matches the approved B direction. This visual review is the acceptance check for
artistic requirements that cannot be proved by source-text assertions.

- [ ] **Step 6: Commit the brand assets**

```bash
git add build/brand build/icons public/favicon.svg public/icons docs/assets/codex-pet-pause-desktop-cover.png scripts/generate-brand-assets.mjs scripts/generate-brand-assets.test.mjs package.json package-lock.json
git commit -m "feat: add Codex Pet Pause brand assets"
```

---

### Task 3: Configure Native Packages and Preserve Desktop Identity

**Files:**
- Modify: `package.json`
- Modify: `electron/main.js`
- Test: `scripts/verify-desktop-release-config.test.mjs`

**Interfaces:**
- Consumes: native icon files from Task 2.
- Produces: Electron Builder targets for macOS arm64/x64 DMG, Windows x64 NSIS, and Linux x64 AppImage/DEB.

- [ ] **Step 1: Extend the release-contract test with artifact names**

Add assertions to `verify-desktop-release-config.test.mjs`:

```js
assert.equal(
  validPackage.build.mac.artifactName,
  'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
);
assert.equal(
  validPackage.build.win.artifactName,
  'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
);
assert.equal(
  validPackage.build.linux.artifactName,
  'Codex-Pet-Pause-${version}-linux-${arch}.${ext}',
);
```

Extend `verifyDesktopReleaseConfig` to reject any different artifact pattern.

- [ ] **Step 2: Run the validator test and confirm the current package config fails**

Run:

```bash
npm run test:desktop-release-config
npm run check:desktop-release-config
```

Expected: unit tests pass and the real package check fails because the current
icons and targets do not match the release contract.

- [ ] **Step 3: Update Electron Builder configuration**

Set the `package.json` build block to these platform values:

```json
{
  "build": {
    "appId": "io.elevenlabs.codexpetpause",
    "productName": "Codex Pet Pause",
    "asar": true,
    "files": ["dist/**/*", "electron/**/*", "public/**/*", "package.json"],
    "directories": {
      "buildResources": "build/icons",
      "output": "release"
    },
    "mac": {
      "category": "public.app-category.productivity",
      "icon": "build/icons/icon.icns",
      "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
      "artifactName": "Codex-Pet-Pause-${version}-mac-${arch}.${ext}"
    },
    "win": {
      "icon": "build/icons/icon.ico",
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "artifactName": "Codex-Pet-Pause-${version}-windows-${arch}.${ext}"
    },
    "linux": {
      "icon": "build/icons/png",
      "category": "Utility",
      "target": [
        { "target": "AppImage", "arch": ["x64"] },
        { "target": "deb", "arch": ["x64"] }
      ],
      "artifactName": "Codex-Pet-Pause-${version}-linux-${arch}.${ext}"
    }
  }
}
```

Remove the Windows `portable` target so ordinary users see one recommended
Windows download.

- [ ] **Step 4: Use the generated icon in Electron windows and tray**

Change `resolveAssetPath` in `electron/main.js` to search packaged
`build/icons/png/512x512.png` first, then retain the existing public PWA icon
fallback. Add `build/**/*` to Electron Builder `files` so the runtime icon is
available inside the package.

Keep the existing `app.setAppUserModelId('io.elevenlabs.codexpetpause')` on
Windows and keep the guarded `setVisibleOnAllWorkspaces` call so unsupported
platforms do not fail startup.

- [ ] **Step 5: Verify configuration and build the production bundle**

Run:

```bash
npm run check:desktop-release-config
npm run build
```

Expected: configuration validation prints
`Desktop release configuration is valid.` and Vite exits successfully.

- [ ] **Step 6: Commit package configuration**

```bash
git add package.json electron/main.js
git commit -m "build: configure native desktop packages"
```

---

### Task 4: Build and Publish One GitHub Release

**Files:**
- Modify: `.github/workflows/build-desktop.yml`
- Create: `scripts/verify-desktop-workflow.mjs`
- Create: `scripts/verify-desktop-workflow.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: tagged commits named `v*`, package scripts from Tasks 1-3.
- Produces: CI artifacts on pushes and pull requests; one GitHub Release with all five installers on tags.

- [ ] **Step 1: Write the failing workflow contract test**

Create `scripts/verify-desktop-workflow.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

test('workflow validates, packages every target, and publishes tags', async () => {
  const workflow = await readFile('.github/workflows/build-desktop.yml', 'utf8');
  assert.deepEqual(verifyDesktopWorkflow(workflow), []);
});
```

Create `scripts/verify-desktop-workflow.mjs` exporting
`verifyDesktopWorkflow(workflow)`, where `workflow` is parsed YAML. Validate the
observable release model: `v*` tags trigger the workflow, the package matrix has
the four required IDs and operating systems, each matrix entry declares its
expected public artifact pattern, and the release job depends on the package
job and runs only for tags. The test passes an in-memory valid workflow object
and separately mutates its tag trigger, matrix, and release dependency to prove
the validator rejects each broken behavior. Use the `yaml` package for parsing
the real workflow in the executable entry point.

- [ ] **Step 2: Run the workflow test and confirm current workflow fails**

Run:

```bash
node --test scripts/verify-desktop-workflow.test.mjs
```

Expected: FAIL because tag publication and architecture entries are absent.

- [ ] **Step 3: Replace the workflow with validation, package, and release jobs**

Configure `.github/workflows/build-desktop.yml` with:

- `push` on `main` and tags matching `"v*"`.
- `pull_request`.
- `workflow_dispatch`.
- `permissions: contents: write`.
- A `validate` job on `ubuntu-latest` running `npm ci`,
  `npm run test:desktop-release-config`, `npm run test:brand-assets`,
  `npm run check:desktop-release-config`, `npm run test:run`, and
  `npm run build`.
- An Actionlint container step in the validation job that validates the checked
  in workflow syntax on Ubuntu.
- A `package` matrix with these exact entries:

```yaml
include:
  - id: mac-arm64
    os: macos-latest
    command: npm run desktop:pack:mac -- --arm64
    artifact: release/*-mac-arm64.dmg
  - id: mac-x64
    os: macos-latest
    command: npm run desktop:pack:mac -- --x64
    artifact: release/*-mac-x64.dmg
  - id: windows-x64
    os: windows-latest
    command: npm run desktop:pack:win -- --x64
    artifact: release/*-windows-x64.exe
  - id: linux-x64
    os: ubuntu-latest
    command: npm run desktop:pack:linux -- --x64
    artifact: |
      release/*-linux-x64.AppImage
      release/*-linux-x64.deb
```

Each package job depends on `validate`, runs `npm ci`, invokes the matrix
command, and uploads only `matrix.artifact` with `if-no-files-found: error`.

The `release` job runs only for `refs/tags/v*`, depends on every package job,
downloads all artifacts into `release-assets` with `merge-multiple: true`, and
uses `GH_TOKEN: ${{ github.token }}`:

```bash
if gh release view "$GITHUB_REF_NAME"; then
  gh release upload "$GITHUB_REF_NAME" release-assets/* --clobber
else
  gh release create "$GITHUB_REF_NAME" release-assets/* --generate-notes --title "Codex Pet Pause $GITHUB_REF_NAME"
fi
```

- [ ] **Step 4: Add workflow verification scripts**

Add:

```json
{
  "scripts": {
    "test:desktop-workflow": "node --test scripts/verify-desktop-workflow.test.mjs",
    "check:desktop-workflow": "node scripts/verify-desktop-workflow.mjs"
  }
}
```

Make direct execution of `verify-desktop-workflow.mjs` read the workflow, throw
with joined failures, and print `Desktop release workflow is valid.` on success.

- [ ] **Step 5: Run workflow contract checks**

Run:

```bash
npm run test:desktop-workflow
npm run check:desktop-workflow
```

Expected: the test passes and the direct check prints
`Desktop release workflow is valid.`

- [ ] **Step 6: Commit GitHub release automation**

```bash
git add .github/workflows/build-desktop.yml scripts/verify-desktop-workflow.mjs scripts/verify-desktop-workflow.test.mjs package.json
git commit -m "ci: publish cross-platform desktop releases"
```

---

### Task 5: Document Downloads, Installation, and Persistence

**Files:**
- Modify: `README.md`
- Create or modify: `README.zh-CN.md`
- Create: `docs/DESKTOP-INSTALL.md`
- Create: `docs/DESKTOP-INSTALL.zh-CN.md`

**Interfaces:**
- Consumes: GitHub Release artifact names from Tasks 3-4.
- Produces: English and Simplified Chinese end-user installation instructions.

- [ ] **Step 1: Update README presentation**

Place this cover directly below the README title:

```markdown
![Codex Pet Pause desktop companion](docs/assets/codex-pet-pause-desktop-cover.png)
```

Add a prominent download link to
`https://github.com/ccofallen/codex-pet-pause/releases` before contributor
commands. Keep contributor setup separate from ordinary user installation.
Link English and Chinese installation guides from both READMEs.

- [ ] **Step 2: Write exact unsigned installation instructions**

Create English and Chinese guides covering:

- macOS Apple Silicon versus Intel DMG selection.
- Dragging the app into Applications.
- The unsigned macOS sequence: Control-click the app, choose Open, then confirm
  Open; System Settings > Privacy & Security is the fallback.
- Running the Windows x64 NSIS installer and selecting `More info > Run anyway`
  if SmartScreen appears.
- Marking AppImage executable and launching it.
- Installing DEB with the desktop package manager.
- Local persistence in `localStorage`, `IndexedDB`, and Electron `userData`.
- Updating by installing a newer package over the same application identity.
- Uninstalling the program does not intentionally upload or sync local data.

- [ ] **Step 3: Review the documentation checklist**

Read the rendered English and Chinese documents and confirm each independently
covers the Releases URL, DMG architecture choice, NSIS, AppImage, DEB,
Gatekeeper, SmartScreen, localStorage, IndexedDB, local-only persistence, and
upgrade behavior. Check every relative Markdown link resolves to an existing
repository file.

- [ ] **Step 4: Commit user documentation**

```bash
git add README.md README.zh-CN.md docs/DESKTOP-INSTALL.md docs/DESKTOP-INSTALL.zh-CN.md
git commit -m "docs: add desktop download and install guides"
```

---

### Task 6: Integrate Checks and Prove the Release Candidate

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-release-artifacts.mjs`
- Create: `scripts/verify-release-artifacts.test.mjs`

**Interfaces:**
- Consumes: all release configuration, workflow, generated assets, docs, and the local `release` directory.
- Produces: `npm run check:desktop-release`; `verifyReleaseArtifacts(fileNames, version)` validating the five expected public packages.

- [ ] **Step 1: Write the failing artifact-set test**

Create `scripts/verify-release-artifacts.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReleaseArtifacts } from './verify-release-artifacts.mjs';

test('accepts one complete 0.2.0 installer set', () => {
  const files = [
    'Codex-Pet-Pause-0.2.0-mac-arm64.dmg',
    'Codex-Pet-Pause-0.2.0-mac-x64.dmg',
    'Codex-Pet-Pause-0.2.0-windows-x64.exe',
    'Codex-Pet-Pause-0.2.0-linux-x64.AppImage',
    'Codex-Pet-Pause-0.2.0-linux-x64.deb',
  ];
  assert.deepEqual(verifyReleaseArtifacts(files, '0.2.0'), []);
});

test('reports every missing platform package', () => {
  const failures = verifyReleaseArtifacts([], '0.2.0');
  assert.equal(failures.length, 5);
});
```

- [ ] **Step 2: Run the test and confirm the artifact validator is missing**

Run:

```bash
node --test scripts/verify-release-artifacts.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement artifact-set validation**

Create `verifyReleaseArtifacts(fileNames, version, platform = 'all')` using five
exact regular expressions derived from the filenames in Step 1. `platform`
accepts `all`, `mac`, `windows`, or `linux` and filters the expected set before
validation. The executable entry point accepts a directory argument plus an
optional `--platform mac|windows|linux`, reads the directory's immediate files,
reads the version from `package.json`, and throws with one message per missing
package.

- [ ] **Step 4: Add the integrated release gate**

Add:

```json
{
  "scripts": {
    "test:release-artifacts": "node --test scripts/verify-release-artifacts.test.mjs",
    "check:desktop-release": "npm run test:desktop-release-config && npm run test:brand-assets && npm run test:desktop-workflow && npm run test:release-artifacts && npm run check:desktop-release-config && npm run check:desktop-workflow && npm run typecheck && npm run test:run && npm run build"
  }
}
```

- [ ] **Step 5: Run the complete local release gate**

Run:

```bash
npm run check:desktop-release
```

Expected: every contract test, type check, unit test, and production build exits
with status 0.

- [ ] **Step 6: Build and inspect the two local macOS packages**

Run:

```bash
npm run desktop:pack:mac
node scripts/verify-release-artifacts.mjs release --platform mac
```

Expected: arm64 and x64 DMGs exist with approved filenames. Open the arm64 DMG,
install the app, and verify startup, settings access, one saved setting, one
imported pet, quit/relaunch persistence, and the approved icon in Finder and
the Dock.

- [ ] **Step 7: Commit the integrated release gate**

```bash
git add package.json scripts/verify-release-artifacts.mjs scripts/verify-release-artifacts.test.mjs
git commit -m "test: add desktop release gate"
```

---

### Task 7: Publish Through GitHub and Verify Native Runner Output

**Files:**
- No source-file changes expected after the release candidate commit.

**Interfaces:**
- Consumes: the complete release candidate and GitHub repository admin access.
- Produces: a pushed branch, reviewed pull request, merged release configuration, tag `v0.2.0`, and one public GitHub Release.

- [ ] **Step 1: Push a release branch and open a pull request**

Push branch `feat/cross-platform-desktop-release` and open a pull request titled
`feat: publish cross-platform desktop apps`. Include the release matrix, unsigned
package warning, local verification output, and screenshots of the approved icon
and cover.

- [ ] **Step 2: Verify pull-request checks**

Confirm the validation job and all four matrix entries complete successfully:
`mac-arm64`, `mac-x64`, `windows-x64`, and `linux-x64`. Inspect failed native
packaging logs and fix only evidence-backed platform issues before merging.

- [ ] **Step 3: Merge the pull request**

Merge only after every required check passes and the artifact uploads are
present in the workflow run.

- [ ] **Step 4: Create and push the release tag**

```bash
git tag -a v0.2.0 -m "Codex Pet Pause v0.2.0 desktop release"
git push origin v0.2.0
```

If `v0.2.0` already exists, increment the package version and tag together
instead of moving or replacing the existing tag.

- [ ] **Step 5: Verify the public GitHub Release**

Confirm one release contains exactly:

```text
Codex-Pet-Pause-<version>-mac-arm64.dmg
Codex-Pet-Pause-<version>-mac-x64.dmg
Codex-Pet-Pause-<version>-windows-x64.exe
Codex-Pet-Pause-<version>-linux-x64.AppImage
Codex-Pet-Pause-<version>-linux-x64.deb
```

Download each artifact and compare its file size and checksum to the
corresponding Actions artifact before announcing the release.
