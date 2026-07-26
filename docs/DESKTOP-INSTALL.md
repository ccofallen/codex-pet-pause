# Codex Pet Pause desktop download and installation

[README](../README.md) | [简体中文](DESKTOP-INSTALL.zh-CN.md)

Download the desktop companion from the [Codex Pet Pause GitHub Releases
page](https://github.com/ccofallen/codex-pet-pause/releases). The first public
packages are unsigned. Choose the package for your operating system and
architecture, then follow the matching instructions below.

## macOS

### Choose the right DMG

- Apple Silicon Macs (M1, M2, M3, M4, or later) should download the file ending
  in `-mac-arm64.dmg`, for example `Codex-Pet-Pause-0.2.0-mac-arm64.dmg`.
- Intel Macs should download the file ending in `-mac-x64.dmg`, for example
  `Codex-Pet-Pause-0.2.0-mac-x64.dmg`.

If you are not sure which Mac you have, open Apple menu > About This Mac. The
chip or processor information identifies Apple Silicon versus Intel.

### Install and open

1. Open the downloaded DMG.
2. Drag `Codex Pet Pause` into the `Applications` folder shown in the DMG
   window, then eject the DMG if you no longer need it.
3. The first package is unsigned, so macOS Gatekeeper may block a normal
   double-click. In Finder, open `Applications`, Control-click `Codex Pet
   Pause`, choose **Open**, and then choose **Open** again in the confirmation
   dialog.
4. If macOS still blocks the app, open **System Settings > Privacy &
   Security**, find the message about `Codex Pet Pause`, and choose **Open
   Anyway**. Authenticate if macOS asks, then confirm **Open**.

The Gatekeeper confirmation is normally needed only for the first launch of
this unsigned build.

## Windows

Download the x64 NSIS installer, whose name ends in `-windows-x64.exe`, for
example `Codex-Pet-Pause-0.2.0-windows-x64.exe`. Run the installer and follow
its prompts to install and launch Codex Pet Pause.

Because the installer is unsigned, Windows SmartScreen may show “Windows
protected your PC.” If you trust the file you downloaded from the GitHub
Release page, choose **More info > Run anyway**, then continue the installer.

## Linux

The Linux packages target x64. Choose either the portable AppImage or the DEB
package.

### AppImage

Download the file ending in `.AppImage`, such as
`Codex-Pet-Pause-0.2.0-linux-x64.AppImage`. Before the first launch, mark it
as executable using one of these methods:

- In your file manager, open the file's Properties, enable **Allow executing
  file as program** (wording varies by desktop), and close Properties.
- In a terminal, run `chmod +x Codex-Pet-Pause-0.2.0-linux-x64.AppImage` in
  the directory containing the file.

Then double-click the AppImage or launch it from your file manager.

### DEB

Download the file ending in `.deb`, such as
`Codex-Pet-Pause-0.2.0-linux-x64.deb`. Open it with your desktop package
manager, choose **Install**, and enter your password if requested. Launch
Codex Pet Pause from your applications menu after installation.

## Local data, updates, and removal

Codex Pet Pause is local-first. In the desktop app, the web UI stores settings
and reminder state in `localStorage`; imported pets and activity history are
stored in `IndexedDB`. Electron stores window and docking state under its
`app.getPath("userData")` directory. These are local application data stores,
not an account or cloud service.

The release and installation workflow does not upload or sync this data. There
are no automatic updates in this unsigned distribution. To update, download a
newer package from the [GitHub Releases page](https://github.com/ccofallen/codex-pet-pause/releases)
and install it over the existing Codex Pet Pause application, preserving the
same application identity. Do not delete the existing app data while updating.

Uninstalling the program does not intentionally upload or sync local data.
Uninstallation removes the installed program; local data may remain in the
operating system's app-data location, depending on the platform and package
manager. Remove that local app data separately only if you also want to erase
it.
