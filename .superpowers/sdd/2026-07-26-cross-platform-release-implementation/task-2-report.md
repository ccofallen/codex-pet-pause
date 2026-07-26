# Task 2 Report: Approved Brand Asset Pipeline

## Status

Implemented the approved direction B brand asset pipeline without changing any
desktop package targets. The repository now has vector-native icon and cover
sources, deterministic native/PWA asset generation, automated format and
dimension coverage, and committed generated deliverables.

## Dependency Installation

Installed the required image conversion packages as development dependencies:

- `sharp@0.35.3`
- `png2icons@2.0.1`

Command:

```text
npm install --save-dev sharp png2icons
```

The install added 7 packages, changed 3 packages, and updated `package.json` and
`package-lock.json`.

## Asset-Generation Test Evidence

### RED

The test was added before the generator. Running:

```text
node --test scripts/generate-brand-assets.test.mjs
```

failed as intended with:

```text
Input file is missing: build/icons/icon.png
tests 1
pass 0
fail 1
```

This demonstrated that the test depended on generated output rather than
passing against pre-existing files.

### GREEN

After implementing the SVG sources and generator, running:

```text
npm run test:brand-assets
```

completed generation and passed:

```text
tests 1
pass 1
fail 0
```

Additional verification inspected every generated PNG with `sharp` and
confirmed:

- Native icon PNG: `1024x1024`
- PNG icon set: `16`, `32`, `48`, `64`, `128`, `256`, `512`, and `1024`
- PWA icons: `192x192` and `512x512`
- Cover PNG: `1600x900`
- ICO header bytes: `00 00 01 00`
- ICNS header text: `icns`

Two consecutive generator runs produced identical SHA-256 hashes for all 14
generated deliverables. `git diff --check` also passed.

## Files

### Vector sources

- `build/brand/codex-pet-pause-icon.svg`
- `build/brand/codex-pet-pause-cover.svg`
- `public/favicon.svg`

### Pipeline and tests

- `scripts/generate-brand-assets.mjs`
- `scripts/generate-brand-assets.test.mjs`
- `package.json`
- `package-lock.json`

### Generated native assets

- `build/icons/icon.icns`
- `build/icons/icon.ico`
- `build/icons/icon.png`
- `build/icons/png/16x16.png`
- `build/icons/png/32x32.png`
- `build/icons/png/48x48.png`
- `build/icons/png/64x64.png`
- `build/icons/png/128x128.png`
- `build/icons/png/256x256.png`
- `build/icons/png/512x512.png`
- `build/icons/png/1024x1024.png`

### Generated PWA and documentation assets

- `public/icons/pwa-192x192.png`
- `public/icons/pwa-512x512.png`
- `docs/assets/codex-pet-pause-desktop-cover.png`

## Visual Design Rationale

The icon follows approved direction B with a `#563b2b` deep warm-brown rounded
square and a centered `#f6c780` warm-gold cat. The cat is reduced to one
continuous head outline and two closed-eye arcs. Rounded caps and joins soften
the geometry and communicate calm without adding a pause symbol, lettering,
facial clutter, or secondary marks.

The cover repeats the same mark on a warm cream `#f8eddb` field and uses the
exact title `Codex Pet Pause`. A centered, vertically stacked composition gives
the icon and title generous breathing room; every element remains beyond the
required 12% edge margin.

## Visual Acceptance Review

The generated `1024x1024` icon and `1600x900` cover were opened and inspected.
The icon contains no text or pause symbol. The cover matches the warm brown,
warm gold, and cream direction and contains the exact title.

The `16x16`, `32x32`, and `64x64` icon files were enlarged with nearest-neighbor
sampling for pixel-level review. The cat silhouette and paired closed eyes
remain distinguishable at all three sizes, with expected antialiasing at the
smallest size.

## Self-Review

- Confirmed all brief-listed source and generated files are present.
- Confirmed the generator creates required directories recursively.
- Confirmed native conversion rejects null ICO or ICNS results.
- Confirmed all requested PNG dimensions and native file signatures.
- Confirmed repeat generation is byte-stable for every generated deliverable.
- Confirmed the favicon uses the same geometry and colors as the icon source.
- Confirmed package scripts add only `brand:generate` and `test:brand-assets`.
- Confirmed desktop package targets and builder configuration were not changed.
- Confirmed no pause symbol or icon text was introduced.
- Confirmed `git diff --check` reports no whitespace errors.

## Concerns

`npm install` reported 31 audit findings in the complete dependency tree: 30
high and 1 critical. Remediation was not attempted because it is outside Task 2
and may require unrelated or breaking dependency changes. No asset-generation
failure or warning was observed.

## Fix Round 1

### P1: Deterministic Cover Title

Replaced the host-rendered SVG `<text>` element with committed SVG path
geometry shaped from Georgia Bold. The conversion retained the approved `96px`
wordmark, `-2` tracking, baseline at `y=686`, and centered placement:

```text
width=777.375 startX=411.312
```

The source no longer requires a font at generation time. The path group keeps
`aria-label="Codex Pet Pause"` so the exact title remains identified in the
vector source. The regenerated cover was opened and visually inspected; the
wordmark remains readable as `Codex Pet Pause` and preserves the approved
appearance and margins.

### P2: Generated-File Test Coverage

Strengthened `scripts/generate-brand-assets.test.mjs` to exercise generated
files directly:

- Validates PNG format and dimensions for all Linux sizes: `16`, `32`, `48`,
  `64`, `128`, `256`, `512`, and `1024`.
- Validates both PWA PNGs at `192x192` and `512x512`.
- Parses the ICO directory, validates all nine entry bounds and dimensions, and
  decodes every embedded PNG with `sharp`.
- Parses all ICNS chunks, validates chunk bounds and uniqueness, requires all
  eight modern PNG representations, and decodes each representation with
  `sharp` at its expected size.

### Negative Payload Test Evidence

The first ICO image payload was intentionally corrupted in the generated
`build/icons/icon.ico` file before running the strengthened test. The generated
file test rejected the unusable embedded representation:

```text
$ node --test scripts/generate-brand-assets.test.mjs
TAP version 13
# Subtest: generated brand assets have expected formats and dimensions
not ok 1 - generated brand assets have expected formats and dimensions
  ---
  error: 'Input buffer contains unsupported image format'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
```

The corrupted file was restored before clean regeneration.

### Final Test Evidence

Command:

```text
npm run test:brand-assets
```

Output:

```text
> codex-pet-pause@0.2.0 test:brand-assets
> npm run brand:generate && node --test scripts/generate-brand-assets.test.mjs

> codex-pet-pause@0.2.0 brand:generate
> node scripts/generate-brand-assets.mjs

TAP version 13
# Subtest: generated brand assets have expected formats and dimensions
ok 1 - generated brand assets have expected formats and dimensions
  ---
  duration_ms: 5.936084
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 60.75625
```

Repeated-generation command:

```text
shasum -a 256 "${assets[@]}" > /tmp/task-2-fix-assets-before.sha256
npm run brand:generate
shasum -a 256 "${assets[@]}" > /tmp/task-2-fix-assets-after.sha256
cmp /tmp/task-2-fix-assets-before.sha256 /tmp/task-2-fix-assets-after.sha256
```

Output:

```text
> codex-pet-pause@0.2.0 brand:generate
> node scripts/generate-brand-assets.mjs

PASS: all 14 generated asset hashes are identical across consecutive runs
```

Diff hygiene:

```text
$ git diff --check
PASS: git diff --check
```

Package targets and desktop builder configuration were not changed.
