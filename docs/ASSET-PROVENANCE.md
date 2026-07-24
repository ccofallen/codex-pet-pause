# Built-in cat asset provenance

## Visual provenance

The built-in Neko Pause Cat atlas is `public/assets/cat/neko-pause-cat.webp`.

The 2026-07-24 closed-eye restyle used a user-supplied contact sheet only as a
style reference for thick rounded brown/tan closed-eye arcs. No reference cell
or pixel region was copied into the production atlas. The accepted result is a
deterministic masked recolor of the Neko Pause Cat's existing eye geometry.

- Approved atlas SHA-256: `25b40839f320f013a371634d5ac192ea2a9157ef5af4de8a7564bdf1642da1d3`
- The masked comparison changed 1,220 color pixels, with zero changes outside
  the approved masks and zero alpha changes.
- The public regression baseline is
  `e2e/fixtures/neko-pause-cat-atlas-baseline.json`; the browser test verifies
  atlas occupancy, protected-cell hashes, and the approved brown eye arcs.
- The idle fallback PNG remains unchanged because the neutral cell was not
  modified.

## Sound provenance

## Source and attribution

The bundled reminder sound, **“Exploring curious kittens meowing,”** is from [ElevenLabs Sound Effects](https://elevenlabs.io/zh/sound-effects/kittens-meowing). Codex Pet Pause credits ElevenLabs for this sound effect in the application and in both project READMEs.

## Integrity

The approved release asset is `public/assets/cat/meow.wav`.

- Approved SHA-256: e69e2ae9983517b3b72b99060d8f71e8a9c8165732b0abf2da6c7da85b668143

The release check verifies that the shipped sound has this exact checksum.

## Usage note

This sound was obtained from ElevenLabs Sound Effects. Availability of a download does not by itself grant every use: anyone redistributing the sound or using it commercially must ensure that their use is permitted by their ElevenLabs account agreement and the applicable [ElevenLabs terms](https://elevenlabs.io/terms-of-use-eu). Keep the ElevenLabs attribution when required by those terms.
