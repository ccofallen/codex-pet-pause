# Codex Pet Pause Cross-Platform Release Design

## Goal

Ship Codex Pet Pause as downloadable desktop applications for macOS, Windows,
and Linux. A user downloads the package for their operating system from GitHub
Releases, installs or opens it, and uses the pet without running terminal
commands. Settings, reminders, activity history, and imported pets remain local
and survive app restarts and upgrades.

## Repository and Release Architecture

The desktop application will be merged into the existing public repository,
`ccofallen/codex-pet-pause`. The existing GitHub Pages web application remains
available from the same repository.

GitHub Actions will use native operating-system runners:

- macOS builds macOS packages.
- Windows builds Windows packages.
- Ubuntu builds Linux packages.

The workflow runs validation before packaging. Tags matching `v*` trigger the
release pipeline. Platform jobs upload their artifacts, and one final job
creates a single GitHub Release containing all successful packages. A failed
validation or platform build prevents publication of an incomplete release.

The initial platform matrix is:

| Platform | Architecture | Package |
| --- | --- | --- |
| macOS | Apple Silicon | DMG |
| macOS | Intel | DMG |
| Windows | x64 | NSIS installer |
| Linux | x64 | AppImage |
| Linux | x64 | DEB |

Artifacts use stable, readable names containing product, version, operating
system, and architecture. Examples:

- `Codex-Pet-Pause-0.2.0-mac-arm64.dmg`
- `Codex-Pet-Pause-0.2.0-mac-x64.dmg`
- `Codex-Pet-Pause-0.2.0-windows-x64.exe`
- `Codex-Pet-Pause-0.2.0-linux-x86_64.AppImage`
- `Codex-Pet-Pause-0.2.0-linux-amd64.deb`

## Signing and Installation

The first public packages are unsigned because Apple Developer and Windows code
signing certificates are not available. The release notes and README will
clearly explain the one-time macOS Gatekeeper and Windows SmartScreen steps.
Linux instructions will cover AppImage executable permission and DEB
installation.

Code signing and automatic updates are outside this release. Automatic updates
will not be added to an unsigned distribution. Users update by downloading and
installing a newer GitHub Release over the existing application.

## Application Identity and Local Data

The existing Electron application ID and product name remain stable:

- Application ID: `io.elevenlabs.codexpetpause`
- Product name: `Codex Pet Pause`

Maintaining the same identity ensures Electron continues using the same user
data directory. The application remains local-first:

- Settings and reminder state remain in local storage.
- Imported pet files remain in IndexedDB.
- Electron window and docking state remain under `app.getPath("userData")`.
- No data is uploaded by the release or installation workflow.

Packaging must include the production web bundle, Electron main and preload
files, public cat assets, sounds, and generated application icons.

## Visual Identity

The selected direction is a minimal single-line cat:

- Deep warm brown rounded-square background.
- Warm gold line drawing of a calm, closed-eye cat.
- One continuous visual language with no pause symbol.
- No text, gradients, extra badges, complex facial details, or decorative
  objects inside the application icon.
- Strong silhouette and line weight at 16, 32, and 64 pixels.

A high-resolution master image will produce:

- macOS ICNS.
- Windows ICO.
- Linux PNG icons at the sizes required by Electron Builder.
- A GitHub/README cover using the same cat, a warm cream field, restrained
  typography, and generous whitespace.

The cover may contain the title `Codex Pet Pause`; the application icon contains
no text. The cover will appear in the README and release presentation but will
not add new decoration to the application interface.

## Build Configuration

Electron Builder remains the packaging system. Its configuration will define
explicit targets, architectures, icons, and artifact names for each platform.
Platform-specific runtime behavior will be reviewed so macOS-only window APIs do
not break Windows or Linux startup.

The GitHub workflow will install the locked dependency tree with `npm ci`, run
the validation commands, build on native runners, retain build logs, and upload
only the intended installer artifacts. Generated update metadata and unpacked
application directories are not public release assets.

## Error Handling

- Missing icon assets fail validation before packaging.
- A failed platform job blocks the final release job.
- The release job verifies that every expected package is present before
  publishing.
- Re-running a failed workflow is safe and does not create duplicate releases.
- Packaging errors remain visible in the corresponding operating-system job
  logs.
- Documentation states that unsupported CPU architectures are not part of this
  initial release.

## Testing and Acceptance

Automated checks cover:

- TypeScript type checking.
- Existing unit and end-to-end tests.
- Production web build.
- Static validation of Electron Builder application identity, platform targets,
  architectures, icon paths, and artifact naming.
- A packaged-app smoke test that verifies required resources exist.
- Native packaging on macOS, Windows, and Ubuntu GitHub runners.

Acceptance requires:

1. The macOS DMGs, Windows installer, Linux AppImage, and Linux DEB all appear in
   one GitHub Release.
2. Each package starts the desktop pet without terminal commands.
3. The settings window opens from the pet context menu.
4. Settings and an imported pet survive quitting, relaunching, and installing a
   newer build with the same application identity.
5. The pet and reminder behavior remain unchanged from the accepted macOS
   version.
6. README installation instructions accurately describe each unsigned package.
7. Application icons use the approved single-line cat design and remain legible
   at taskbar and Dock sizes.

## Scope Exclusions

- Apple notarization and code signing.
- Windows Authenticode signing.
- Automatic in-app updates.
- Microsoft Store, Mac App Store, Snap, Flatpak, and package-manager publishing.
- Windows ARM64 and Linux ARM64 packages.
