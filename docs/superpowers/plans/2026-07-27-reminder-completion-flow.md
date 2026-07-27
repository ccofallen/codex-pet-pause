# Reminder Completion Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a completed pet reminder advance directly to the next queued reminder or close immediately when the queue is empty.

**Architecture:** `ActionCard` will expose an optional `onCompleted` callback that runs only after `controller.complete` succeeds. `CatReminderBubble` will use that callback to clear the action layer and inspect the controller's fresh queue snapshot, preserving the existing standalone confirmation behavior for every caller that omits the callback.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- Do not render a completed-status layer inside the pet reminder bubble.
- A queued successor must open at its first-level due actions.
- The final completion must close the bubble and return focus to the pet.
- A rejected completion must keep the current action available for retry.
- Completion must remain single-flight.
- Do not change standalone `ActionCard` behavior when `onCompleted` is omitted.

---

### Task 1: Successful-completion callback

**Files:**
- Modify: `src/features/reminders/components/ActionCard.tsx`
- Test: `src/features/reminders/components/ActionCard.test.tsx`

**Interfaces:**
- Consumes: `controller.complete(reminder.id): Promise<void>`
- Produces: optional prop `onCompleted?: (() => void) | undefined`

- [ ] **Step 1: Write the failing callback tests**

Add a render helper that accepts `onCompleted`, then cover success and rejection:

```tsx
test('hands successful completion to its host without rendering confirmation', async () => {
  const onCompleted = vi.fn();
  const controller = createAppController(createFakeDependencies({ now: NOW }));
  controller.complete = vi.fn(async () => undefined);
  render(actionView(controller, reminder, 'zh-CN', onCompleted));

  fireEvent.click(screen.getByRole('button', { name: '完成了' }));

  await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('does not notify its host when completion fails', async () => {
  const onCompleted = vi.fn();
  const controller = createAppController(createFakeDependencies({ now: NOW }));
  controller.complete = vi.fn(async () => { throw new Error('save failed'); });
  render(actionView(controller, reminder, 'zh-CN', onCompleted));

  fireEvent.click(screen.getByRole('button', { name: '完成了' }));

  await waitFor(() => expect(screen.getByRole('button', { name: '完成了' })).toBeEnabled());
  expect(onCompleted).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run test:run -- src/features/reminders/components/ActionCard.test.tsx
```

Expected: FAIL because `ActionCard` does not accept or invoke `onCompleted`.

- [ ] **Step 3: Implement the minimal callback**

Extend `ActionCardProps` and the successful branch:

```tsx
interface ActionCardProps {
  reminder: Reminder;
  countdownEndsAt?: number | undefined;
  onCountdownStarted?: ((endsAt: number) => void) | undefined;
  onCompleted?: (() => void) | undefined;
  completionAction?: {
    label: string;
    onActivate: () => void;
  };
}

await controller.complete(reminder.id);
if (onCompleted === undefined) setCompleted(true);
else onCompleted();
```

Do not invoke the callback from `catch` or `finally`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npm run test:run -- src/features/reminders/components/ActionCard.test.tsx
```

Expected: all `ActionCard` tests pass.

- [ ] **Step 5: Commit the callback unit**

```bash
git add src/features/reminders/components/ActionCard.tsx src/features/reminders/components/ActionCard.test.tsx
git commit -m "feat: expose successful reminder completion"
```

### Task 2: Direct pet reminder transition

**Files:**
- Modify: `src/features/cat/components/CatReminderBubble.tsx`
- Test: `src/features/cat/components/CatReminderBubble.test.tsx`

**Interfaces:**
- Consumes: `ActionCard` prop `onCompleted?: (() => void) | undefined`
- Consumes: `controller.getSnapshot().scheduler.dueQueue`
- Produces: direct queue advancement or `onRequestClose()`

- [ ] **Step 1: Replace the third-layer tests with failing direct-flow tests**

Keep the existing stateful queue controller and assert the desired visible behavior:

```tsx
test('advances directly to the next queued reminder after completion', async () => {
  const user = userEvent.setup();
  const controller = statefulQueueController();
  renderBubble({ controller });
  await user.click(screen.getByRole('button', { name: '现在做' }));

  await user.click(screen.getByRole('button', { name: '完成了' }));

  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveAccessibleName('喝水提醒');
  expect(screen.getByRole('button', { name: '现在做' })).toHaveFocus();
});

test('closes immediately after completing the final queued reminder', async () => {
  const user = userEvent.setup();
  const onRequestClose = vi.fn();
  const controller = statefulQueueController([reminder('lookAway', 20)]);
  renderBubble({ controller, onRequestClose });
  await user.click(screen.getByRole('button', { name: '现在做' }));

  await user.click(screen.getByRole('button', { name: '完成了' }));

  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '猫咪' })).toHaveFocus();
});
```

Update the single-flight test to expect the bubble transition after its controlled promise resolves instead of expecting a status element.

- [ ] **Step 2: Run the bubble tests and verify RED**

Run:

```bash
npm run test:run -- src/features/cat/components/CatReminderBubble.test.tsx
```

Expected: FAIL because the current implementation renders a status layer and explicit continuation control.

- [ ] **Step 3: Implement direct transition and close**

Remove `nextReminderIsWaiting`, `leaveCompletedAction`, and `completionAction`. Supply:

```tsx
onCompleted={() => {
  setActionOpen(false);
  setActionReminder(undefined);
  setActionOccurrenceKey(undefined);
  setCountdown(undefined);
  setSnoozeOpen(false);
  if (controller.getSnapshot().scheduler.dueQueue.length === 0) {
    onRequestClose();
    returnFocusRef.current?.focus();
  }
}}
```

When a successor remains, clearing `actionOpen` makes `displayedReminder` follow the queue head and the existing focus effect selects its first action.

- [ ] **Step 4: Run both component suites and verify GREEN**

Run:

```bash
npm run test:run -- \
  src/features/reminders/components/ActionCard.test.tsx \
  src/features/cat/components/CatReminderBubble.test.tsx
```

Expected: both files pass with no unhandled rejection or React `act` warning.

- [ ] **Step 5: Commit the pet flow**

```bash
git add src/features/cat/components/CatReminderBubble.tsx src/features/cat/components/CatReminderBubble.test.tsx
git commit -m "fix: close completed pet reminder layers"
```

### Task 3: Release verification and PR update

**Files:**
- No production files
- Existing PR: `#3`

**Interfaces:**
- Consumes: the two committed component changes
- Produces: verified `0.2.1` branch state ready for GitHub native packaging

- [ ] **Step 1: Run the complete desktop release gate**

Run:

```bash
npm run check:desktop-release
```

Expected:

- release configuration, workflow, Electron, signing, artifact, tag, and packaged-resource tests pass
- all Vitest application tests pass
- all 40 Playwright tests pass
- web and desktop production builds pass

- [ ] **Step 2: Push the implementation commits**

```bash
git push origin feat/cross-platform-desktop-release
```

- [ ] **Step 3: Wait for PR `#3` CI**

Confirm the `Build Desktop` pull-request run completes successfully before merging.

- [ ] **Step 4: Merge and publish `v0.2.1`**

Merge PR `#3`, create annotated tag `v0.2.1` on the resulting `main` commit, and push the tag.

- [ ] **Step 5: Verify native release artifacts**

Confirm all package jobs and the release job pass, then verify the public Release contains exactly:

```text
Codex-Pet-Pause-0.2.1-mac-arm64.dmg
Codex-Pet-Pause-0.2.1-mac-x64.dmg
Codex-Pet-Pause-0.2.1-windows-x64.exe
Codex-Pet-Pause-0.2.1-linux-x64.AppImage
Codex-Pet-Pause-0.2.1-linux-x64.deb
```
