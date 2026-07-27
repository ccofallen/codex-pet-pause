# Task 5 Report: Document Downloads, Installation, and Persistence

## Status

Complete. Documentation commit: `c8a544d` (`docs: add desktop download and install guides`).

## Checklist evidence

- [x] Both READMEs place the approved desktop cover directly below the title.
- [x] Both READMEs place the GitHub Releases download link and desktop guide links before contributor setup commands.
- [x] English and Simplified Chinese guides have bilingual navigation back to their README and across to the other guide.
- [x] English guide covers Apple Silicon versus Intel DMG selection, dragging the app into `Applications`, the unsigned Gatekeeper Control-click > Open > Open sequence, and the System Settings > Privacy & Security fallback.
- [x] English guide covers the Windows x64 NSIS installer, SmartScreen `More info > Run anyway`, executable AppImage setup and launch, DEB installation through the desktop package manager, `localStorage`, `IndexedDB`, Electron `userData`, same-identity upgrades, and local-only uninstall behavior.
- [x] Simplified Chinese guide independently covers the same macOS, Windows, Linux, persistence, upgrade, and uninstall requirements in Chinese while retaining the relevant package and system labels.
- [x] Existing feature, privacy, deployment, contribution, acknowledgement, and license documentation was preserved.
- [x] No brittle prose-token tests were added.

## Link checks

Command run against `README.md`, `README.zh-CN.md`, `docs/DESKTOP-INSTALL.md`, and `docs/DESKTOP-INSTALL.zh-CN.md`:

```text
checked 20 relative Markdown links
all relative Markdown links resolve
```

`git diff --check` also completed without output or errors.

## Files

- Modified `README.md`.
- Modified `README.zh-CN.md`.
- Created `docs/DESKTOP-INSTALL.md`.
- Created `docs/DESKTOP-INSTALL.zh-CN.md`.

## Self-review

- Ordinary-user download and installation guidance appears before contributor commands.
- The guides explicitly identify the initial packages as unsigned and do not imply automatic updates or signing.
- Upgrade instructions preserve the existing application identity and tell users not to delete existing app data.
- Persistence wording distinguishes renderer `localStorage` and `IndexedDB` from Electron `app.getPath("userData")` state.
- The final English and Chinese documents were read through independently after editing.

## Concerns

- The first public packages remain unsigned by design, so Gatekeeper and SmartScreen prompts may appear.
- The guides use `0.2.0` in example artifact names from the release specification; users should select the matching version shown on the Releases page.

## Fix round 1 verification

- Corrected Linux examples in both guides to match `package.json` and the Electron arch macro: `Codex-Pet-Pause-<version>-linux-x64.AppImage` and `Codex-Pet-Pause-<version>-linux-x64.deb`.
- Re-read both desktop guides and confirmed no `x86_64` or `amd64` Linux artifact examples remain.
- Re-checked relative Markdown links in both desktop guides: all resolved.
- `git diff --check` completed without output or errors.
