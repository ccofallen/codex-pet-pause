# Android Runtime Performance and Mobile UI Design

## Objective

Make the Android app responsive and stable while keeping reminder state immediately accurate. Reduce the mobile interface to the approved balanced layout without changing desktop behavior.

## Confirmed Problems

- Completing a reminder in the overlay does not immediately refresh the open app page.
- The companion countdown can remain at zero because it continues rendering a stale `nextDueAt`.
- Today's completed activity count can remain stale until a later reload.
- Full pet spritesheets are still transferred and decoded during state hydration, creating avoidable WebView memory pressure.
- The mobile companion and pet pages contain too much explanatory text.
- The pet import help button is stretched into an oval by the general Android button sizing rule.

## Architecture

### Runtime State Channel

Introduce an Android-specific runtime snapshot that contains reminder settings, runtime scheduling state, history data needed by today's summary, affinity, and a monotonically increasing state revision. It must not contain pet ZIP data, spritesheet bytes, or Base64 image data.

The native reminder engine publishes a state-change signal after completing, snoozing, skipping, or otherwise committing a reminder action. The Capacitor plugin forwards this lightweight signal to the app WebView. The app coalesces bursts and loads the newest runtime snapshot once.

Runtime refreshes use generation ordering. A response from an older generation cannot overwrite newer reminder data. A transient refresh failure preserves the last valid display and schedules one coalesced retry.

### Pet Catalog Channel

The Android pet catalog is loaded only while the pet page is active. Catalog entries contain identifiers, display metadata, active state, and lightweight previews. Full spritesheets remain in native app storage and are read directly by the overlay renderer.

Selecting a pet sends only its identifier to a single native transaction. The transaction updates settings and overlay state atomically. A failed transaction leaves the previous pet selected.

Pet previews are bounded and processed serially. Leaving the pet page releases temporary preview URLs, decoded images, and in-flight work. A failed preview displays a per-card placeholder and does not fail the catalog.

### Lifecycle

Second-level display timers run only while the companion page is visible. Returning to the foreground immediately recalculates display time from the latest runtime snapshot. Backgrounding the app cancels nonessential timers and image work.

Desktop, Windows, Linux, macOS, and browser repositories retain their current data paths and UI.

## Reminder Data Flow

1. The user completes an activity from the pet reminder bubble.
2. The native reminder engine commits the activity event and calculates the new `nextDueAt` in one transaction.
3. Native code increments the runtime state revision and publishes a lightweight state-change signal.
4. The app invalidates only its runtime cache and requests the newest runtime snapshot.
5. The companion page replaces the zero countdown with the new interval and updates today's completed total.
6. Multiple rapid signals are coalesced, and stale responses are discarded by generation.

The same flow applies to snooze, skip, settings changes, and other native reminder mutations.

## Mobile UI

### Companion Page

Use the approved balanced layout:

- A compact header shows companion status, current pet name, and affinity.
- The primary card shows the next reminder name and a prominent live countdown.
- After completion, the countdown immediately starts from the newly committed interval.
- Two compact information blocks show today's completed total and the relationship level.
- At most one later reminder is shown.
- Remove the four-category activity list, duplicated runtime messages, and long notification guidance from the normal state.
- If no reminders are enabled, show one short empty-state sentence.
- Permission and storage problems appear only when action is required.

### Pet Page

- Keep the Petdex and manual ZIP import actions equal in width.
- Reduce the import introduction to one sentence.
- Put detailed local-security information behind the help control.
- Render the help control as a fixed `24px` circle using equal dimensions, `aspect-ratio: 1`, and scoped Android overrides so the generic `48px` mobile button rule cannot stretch it.
- Reduce pet preview height, card spacing, and descriptive copy.
- Show the active pet with a short status label.

### Localization

Chinese and English receive equivalent concise copy. Android-specific short copy does not replace the more detailed desktop copy.

## Failure Handling

- Runtime refresh failure keeps the last valid countdown instead of resetting it to zero.
- One coalesced retry is allowed for a transient runtime refresh failure.
- Pet preview failure is isolated to that card.
- Missing or corrupt native pet assets cannot become active.
- Pet selection failure restores the previous UI selection and shows one concise error.
- Preview decoding has explicit concurrency and size limits.
- No full spritesheet data is included in routine runtime events or runtime refresh responses.

## Verification

Automated coverage must prove:

- Completing a reminder updates `nextDueAt`, makes the countdown greater than zero, and continues decrementing.
- Today's completed count updates while the companion page remains open.
- Complete, snooze, and skip event bursts cannot apply stale state.
- Runtime refresh payloads contain no pet Base64.
- Entering and leaving the pet page releases preview resources.
- Multiple large imported pets can be listed and switched repeatedly without ANR or process death.
- Default and imported pets switch in both directions and persist across restart.
- A failed pet switch keeps the previous selection.
- The import help control remains a `24px` circle at supported phone widths.
- Concise Chinese and English layouts work at narrow widths.
- Existing reminder, overlay, drag, hide, Petdex, import, persistence, and desktop tests remain passing.

Before delivery, run the full front-end test suite, TypeScript production build, Android synchronization, Android JVM tests, Android Lint, a clean APK build, and all emulator device tests. Deliver only the APK produced by that verified build.

## Scope Boundaries

- No desktop UI or desktop persistence changes.
- No reminder interval or scheduling-policy changes beyond immediate synchronization of already committed native state.
- No new cloud service, analytics system, or network storage.
- No redesign of the bottom navigation or established primary action placement.
