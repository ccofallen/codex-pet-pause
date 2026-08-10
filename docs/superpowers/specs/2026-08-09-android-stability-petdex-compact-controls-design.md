# Android stability, Petdex assets, and compact controls design

## Scope

This update changes only the Android host and Android-specific React presentation. Electron desktop and normal web behavior remain unchanged.

The update addresses three user-visible failures:

- Settings operations, especially pet-size changes, can stall or crash the app.
- Petdex opens, but its pet images are blocked.
- The top capability card contains excessive text and occupies too much vertical space.

It also adds bounded WebView renderer recovery so a renderer failure does not terminate the entire Android app without recovery.

## Evidence and root causes

1. A committed settings mutation currently publishes an in-process overlay refresh and always sends a second `STATE_CHANGED` service command. A size change therefore reloads state, sends renderer state, and resizes the overlay twice.
2. Petdex serves pet previews and sprites from the official `https://assets.petdex.dev` origin. The current subresource policy accepts only `https://petdex.dev`, returning a local `403` for every official pet image.
3. Petdex uses `LOAD_NO_CACHE`, forcing repeated network transfer and image decode.
4. Petdex, the Capacitor UI, and the overlay WebView currently share the application process. Petdex also installs process-global Service Worker restrictions. A heavy or failed Petdex renderer can therefore affect the main app process.
5. The normal capability surface renders headings, storage/reminder explanations, status copy, background copy, and two actions when the user only needs the actions.

## Architecture

### 1. Single overlay refresh per mutation

`PetOverlayStateRefreshBus.publish()` remains the fast in-process path and its listener count becomes authoritative:

- If at least one overlay-service listener receives the event, do not send `STATE_CHANGED`.
- If no listener exists, use the existing service-command retrier as the process/lifecycle fallback.
- Preserve warning behavior if the fallback command cannot be delivered.

This keeps service recovery intact while removing duplicate resize/state work during normal operation.

### 2. Petdex process isolation

Run `PetdexActivity` in the private `:petdex` process. Before creating its WebView on API 28+, configure the `petdex` WebView data-directory suffix.

The archive handoff remains filesystem-based:

- Petdex writes the completed ZIP to the existing private pending-archive directory using temporary-file publication.
- It launches the existing single-task `MainActivity` after publication.
- The main process discovers and announces the pending archive on resume.

No exported component, public file, broad intent filter, or cross-process JavaScript bridge is added.

### 3. Petdex request policy

Navigation and subresources use separate policies:

- Main-frame pages: exact HTTPS `petdex.dev` origin only.
- Official pet assets: exact HTTPS `assets.petdex.dev` origin, subresources only.
- ZIP downloads: keep the existing MIME, filename, size, redirect, path, and origin checks.
- All file/content/http/mixed-content and deceptive sibling-domain requests remain blocked.

Use normal WebView cache behavior for approved HTTPS page and asset requests. The isolated Petdex process prevents its Service Worker restrictions and cache lifecycle from affecting the main Capacitor WebView.

Third-party profile-avatar hosts are not added to the allowlist. Pet previews and sprites must render; optional external author avatars may remain absent rather than expanding the trust boundary.

### 4. Renderer failure containment

- Petdex: handle `onRenderProcessGone`, destroy the unusable WebView, close only Petdex, and allow the user to reopen it.
- Overlay: report renderer loss to `PetOverlayService`, remove the dead overlay view, and recreate it once when the pet should remain visible.
- Main Capacitor UI: register a Capacitor `WebViewListener`; when its renderer exits, finish and restart `MainActivity` once through the normal launch path instead of allowing the process to terminate from an unhandled renderer loss.

Recovery must be generation/instance guarded so repeated callbacks do not create duplicate activities or overlay WebViews.

## Android top controls

When overlay permission setup is complete, the top area contains only two compact buttons:

- `Hide pet` / `Show pet`
- `Quit app`

The buttons retain localized text labels and a minimum 48px touch target. Remove the capability heading, storage text, reminder text, visibility status, settings-close text, and background-running note from the normal state. Remove the large card surface and excess vertical padding.

Permission onboarding remains unchanged in meaning and may show the instructions required to grant notification or overlay access. A real operation failure may show a compact alert; normal operation shows no explanatory copy.

## Failure handling

- A blocked Petdex subresource fails closed with the existing empty `403` response.
- Petdex renderer loss closes only Petdex; it does not delete a completed pending archive.
- Main/overlay renderer recovery is attempted once per renderer instance. A second failure waits for a new user launch instead of looping.
- Overlay refresh fallback warnings remain non-destructive; committed settings remain authoritative.

## Tests and acceptance criteria

### Focused tests

- Overlay refresh bus with a live listener results in one refresh and no service fallback command.
- No-listener refresh still invokes the service command and retry behavior.
- Pet-size save causes one overlay state refresh and one bounds update.
- Petdex main-frame navigation still rejects `assets.petdex.dev`, while subresource requests from that exact origin are allowed.
- HTTP, sibling domains, user-info URLs, nonstandard ports, and unrelated origins remain blocked.
- Petdex activity uses the isolated process and WebView data-directory suffix.
- Renderer-loss handlers are single-shot and dispose unusable WebViews.
- Normal Android capability state renders exactly the two localized controls and no explanatory text.
- Permission onboarding still renders required instructions.

### Device verification

- Repeatedly cycle small, medium, and large pet sizes for at least 30 saves without ANR, renderer crash, duplicate overlay refresh, or process death.
- Open Petdex and verify official pet previews render.
- Download a ZIP, return to the main process, preview it, import it, and activate it.
- Repeatedly open/close Petdex and switch app pages while monitoring logcat and PSS; no monotonic memory growth or uncaught renderer termination is accepted.
- Confirm the top normal-state area contains only the two requested controls on narrow and standard phone widths.
- Run full TypeScript, Android unit, lint, assembly, and instrumented suites before producing a new non-overwriting APK.
