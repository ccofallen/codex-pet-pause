# Codex Pet Pause 0.3.0 release notes

[简体中文](RELEASE-NOTES-0.3.0.zh-CN.md)

Release date: 2026-08-08

## Android floating pet

- Adds the first signed Android package for Android 9+ arm64 phones.
- Keeps the pet in a foreground overlay with explicit notification, overlay, Show Pet,
  Hide Pet, settings, and Quit controls.
- Supports queued and custom reminders, reboot recovery, local pet imports, and the
  sandboxed Petdex handoff.
- Preserves settings, reminders, activity history, and imported pets locally without
  accounts, cloud sync, or telemetry.

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

The Android workflow builds one universal pure-JVM/WebView APK with no native `.so`
libraries, verifies the release certificate, manifest identity and version, packaged web
content, permissions, and SHA-256,
then uploads only the APK and checksum. Desktop workflow matrices, package commands,
architectures, and asset names remain unchanged.

## Publishing gate

This file is release-candidate documentation, not evidence that `v0.3.0` has been
published. Tagging and GitHub publication remain blocked until automated verification,
independent review, and the physical arm64 device acceptance checklist are complete.

### Universal APK compatibility

The universal Android APK contains no native `.so` libraries. It is a pure JVM/WebView package compatible with arm64 devices and other CPU architectures supported by the Android runtime and system WebView.
