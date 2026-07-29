# Petdex Import and Pet Size Design

## Goal

Remove the manual ZIP handoff after downloading a pet from Petdex and add a
persistent small, medium, or large desktop-pet size preference.

## Petdex flow

The pet library opens `https://petdex.dev/` in a sandboxed Electron window with
Node.js disabled. Electron intercepts ZIP downloads, stores each archive in the
application temporary directory, enforces the existing 32 MiB limit, forwards
the bytes to the settings renderer, and deletes the temporary file.

The renderer feeds the ZIP into the existing archive extraction and validation
pipeline. Automatic import stops at the existing preview; saving or replacing a
pet still requires explicit user confirmation.

## Size flow

Settings schema version 5 adds `petSize` with `small`, `medium`, and `large`.
Legacy settings migrate to `medium`. Desktop sizes are 80%, 100%, and 125% of
the existing 140 by 152 pixel pet. Both the built-in cat and imported pets use
the same sizing function for rendering, hit testing, dragging, and reminder
bubble anchoring.

## Security

- The Petdex window has `sandbox: true`, `nodeIntegration: false`, and no preload.
- Only ZIP downloads enter the import bridge.
- Existing ZIP path, count, expanded-size, encryption, atlas, and manifest checks remain authoritative.
- Imported pets are never saved without the existing preview confirmation.
