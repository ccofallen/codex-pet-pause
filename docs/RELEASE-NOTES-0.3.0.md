# Codex Pet Pause 0.3.0 release notes

[简体中文](RELEASE-NOTES-0.3.0.zh-CN.md)

Release date: 2026-08-08

## Android floating pet

- Adds the first signed universal pure-JVM/WebView Android package for Android 9+,
  including arm64 devices.
- Keeps the pet in a foreground overlay with explicit notification, overlay, Show Pet,
  Hide Pet, settings, and Quit controls.
- Supports queued and custom reminders, reboot recovery, local pet imports, and the
  sandboxed Petdex handoff.
- Preserves settings, reminders, activity history, and imported pets locally without
  accounts, cloud sync, or telemetry.
- Disables Android cloud and device-transfer backup for app-private data while preserving
  data during same-key in-place APK upgrades.

Follow the [Android installation and permission guide](ANDROID-INSTALL.md) before
sideloading.

## Release assets

The `v0.3.0` GitHub Release is prepared to contain:

- `Codex-Pet-Pause-0.3.0-android-universal.apk`
- `Codex-Pet-Pause-0.3.0-android-universal.apk.sha256`
- `Codex-Pet-Pause-0.3.0-mac-arm64.dmg`
- `Codex-Pet-Pause-0.3.0-mac-x64.dmg`
- `Codex-Pet-Pause-0.3.0-windows-x64.exe`
- `Codex-Pet-Pause-0.3.0-linux-x64.AppImage`
- `Codex-Pet-Pause-0.3.0-linux-x64.deb`

The read-only Android producer builds one universal pure-JVM/WebView APK with no native
`.so` libraries and verifies the pinned release certificate, manifest identity, exact
version, packaged web content, permissions, and SHA-256. The read-only desktop producer
keeps its existing package matrix and asset names. One dependent publisher validates both
complete sets before updating the GitHub Release without deleting unrelated assets.

## Publishing gate

This file is release-candidate documentation, not evidence that `v0.3.0` has been
published. Tagging and GitHub publication remain blocked until automated verification,
independent review, and the physical arm64 device acceptance checklist are complete.

### Universal APK compatibility

The universal Android APK contains no native `.so` libraries. It is a pure JVM/WebView package compatible with arm64 devices and other CPU architectures supported by the Android runtime and system WebView.
