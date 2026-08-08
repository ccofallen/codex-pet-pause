# Install Codex Pet Pause on Android

[简体中文](ANDROID-INSTALL.zh-CN.md)

## Requirements

- Android 9 or newer.
- A supported Android phone, including arm64 devices.
- Permission to install an APK from the browser or file manager you use for the download.

## Download and verify

Open the [Codex Pet Pause GitHub Releases page](https://github.com/ccofallen/codex-pet-pause/releases)
and download these two files from the same `v0.3.0` release:

- `Codex-Pet-Pause-0.3.0-android-universal.apk`
- `Codex-Pet-Pause-0.3.0-android-universal.apk.sha256`

Verify the checksum before installation:

```bash
sha256sum -c Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
```

On macOS:

```bash
shasum -a 256 Codex-Pet-Pause-0.3.0-android-universal.apk
cat Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
```

The two hexadecimal values must match exactly.

## Sideload the APK

1. Open the APK from Downloads or your file manager.
2. If Android blocks the installation, open the offered **Install unknown apps**
   screen and allow this source. This grants permission only to the browser or
   file manager you selected.
3. Return to the APK and choose **Install**.
4. Disable **Allow from this source** again afterward if you do not routinely
   sideload apps.

Android may show a Play Protect review because the APK is installed outside Google
Play. Confirm that the filename and SHA-256 match the GitHub Release before continuing.

## First launch and permissions

Codex Pet Pause asks in context rather than requesting every permission at startup:

1. Allow notifications on Android 13 or newer. Notifications carry reminder and
   foreground-service controls.
2. Choose **Enable floating pet** and read the explanation.
3. Open Android's **Display over other apps** screen and allow Codex Pet Pause.
4. Return to the app. It checks the permission again before starting the floating pet.

Refusing either permission keeps settings usable. Use **Retry permission** later.
If overlay permission is revoked, the pet is removed from other apps until permission
is restored.

## Persistent notification and pet controls

Android requires a persistent notification while the floating-pet service is active.
This is expected and makes background operation visible. Use the app and notification
controls to **Show Pet**, **Hide Pet**, open settings, or **Quit**. Quit stops the
service and removes both the overlay and its persistent notification.

Do not force-stop the app if you want reminders and reboot recovery to continue.

## Local data, upgrades, and backups

Settings, reminders, activity history, and imported pets stay on the phone. Codex Pet
Pause has no account, cloud sync, or telemetry. Installing a newer APK from this
repository over the existing app preserves local data when it is signed with the same
release key. Do not uninstall first unless you intend to delete local app data.

Android backup and device-transfer backup are disabled for Codex Pet Pause, so the app's
private settings, history, reminders, and imported pets are not copied to a cloud backup
or restored onto another device. This local-only policy does not prevent an in-place APK
upgrade from preserving data; uninstalling the app still deletes its private data.

Android APK updates are delivered through
[GitHub Releases](https://github.com/ccofallen/codex-pet-pause/releases); there is no
silent in-app updater. Download the newer APK and verify its checksum before installing
it over the current version.

## Battery and background guidance

Some manufacturers stop background services aggressively. If reminders arrive late or
the pet disappears:

- Remove battery restrictions for Codex Pet Pause or select **Unrestricted** battery use.
- Allow background activity and auto-start where the device offers those controls.
- Keep notifications enabled and do not swipe away or disable the persistent service
  notification.
- Reopen the app after a system update and confirm overlay permission remains granted.

Menu names differ between Android vendors. Search system settings for **Battery
optimization**, **Background activity**, **Auto-start**, or **Display over other apps**.

## Troubleshooting

- **The APK will not install:** confirm the device runs Android 9 or newer, then
  redownload both files and verify SHA-256.
- **The pet is visible only inside settings:** grant **Display over other apps**, return
  to Codex Pet Pause, and choose Show Pet.
- **No reminders appear:** enable notifications, check Do Not Disturb, and review the
  battery guidance above.
- **The old version remains:** install the newer signed APK without uninstalling. If
  Android reports a signature conflict, stop and obtain the APK from the official
  GitHub Release.

## Maintainer signing setup

Release builds fail closed when signing configuration is missing. Debug builds remain
available with `npm run android:apk:debug`.

The local keystore and credentials belong only in the gitignored `.signing/` directory.
If no key exists, generate a long-lived key without printing either password:

```bash
umask 077
mkdir -p .signing
STORE_PASSWORD="$(openssl rand -base64 48 | tr -d '\n')"
KEY_PASSWORD="$(openssl rand -base64 48 | tr -d '\n')"
KEY_ALIAS="codex-pet-pause-release"
keytool -genkeypair \
  -keystore .signing/codex-pet-pause-release.jks \
  -storetype JKS \
  -storepass "$STORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -sigalg SHA256withRSA \
  -validity 36500 \
  -dname "CN=Codex Pet Pause, OU=Release, O=Codex Pet Pause, L=London, ST=England, C=GB"
cat > .signing/signing.properties <<EOF
storeFile=$(pwd)/.signing/codex-pet-pause-release.jks
storePassword=$STORE_PASSWORD
keyAlias=$KEY_ALIAS
keyPassword=$KEY_PASSWORD
EOF
chmod 600 .signing/codex-pet-pause-release.jks .signing/signing.properties
unset STORE_PASSWORD KEY_PASSWORD KEY_ALIAS
```

Back up both files to an encrypted, access-controlled location before publishing.
Losing the keystore or credentials makes it impossible to ship an in-place update
signed as the same Android app. Never commit either file or paste credentials into
issues, logs, workflow YAML, or release notes.

With the documented Java and Android SDK environment active, build and verify locally:

```bash
npm ci
npm run android:apk:release
mkdir -p .artifacts/android
cp android/app/build/outputs/apk/release/app-release.apk \
  .artifacts/android/Codex-Pet-Pause-0.3.0-android-universal.apk
(
  cd .artifacts/android
  shasum -a 256 Codex-Pet-Pause-0.3.0-android-universal.apk \
    > Codex-Pet-Pause-0.3.0-android-universal.apk.sha256
)
npm run check:android-release
```

When authenticated to the authorized repository, set the four GitHub Actions secrets
directly from the ignored files without displaying their values:

```bash
base64 < .signing/codex-pet-pause-release.jks \
  | gh secret set ANDROID_KEYSTORE_BASE64
sed -n 's/^keyAlias=//p' .signing/signing.properties \
  | gh secret set ANDROID_KEY_ALIAS
sed -n 's/^keyPassword=//p' .signing/signing.properties \
  | gh secret set ANDROID_KEY_PASSWORD
sed -n 's/^storePassword=//p' .signing/signing.properties \
  | gh secret set ANDROID_STORE_PASSWORD
```

Pushing `v0.3.0` starts one coordinated release workflow. It calls read-only Android and
desktop artifact producers, validates the universal APK/checksum and every macOS arm64,
macOS x64, Windows x64, Linux AppImage, and Linux deb asset, then allows one publisher job
to update the GitHub Release. The publisher preserves unrelated existing assets and is the
only job with `contents: write`. Do not create the tag until all automated gates,
independent review, and physical-device acceptance are complete.

### Universal APK compatibility

The universal Android APK contains no native `.so` libraries. It is a pure JVM/WebView package compatible with arm64 devices and other CPU architectures supported by the Android runtime and system WebView.
