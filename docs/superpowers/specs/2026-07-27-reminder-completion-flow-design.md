# Reminder Completion Flow Design

## Goal

Remove the extra completion-confirmation layer from the desktop pet reminder flow.
Completing a reminder should either advance directly to the next queued reminder or
close the reminder bubble when the queue is empty.

## Behavior

- The user opens a due reminder from the pet and chooses "Do it now."
- The action card keeps countdown and completion controls unchanged.
- Clicking "Complete" remains single-flight while the controller command is pending.
- After a successful completion:
  - If another reminder is queued, the bubble immediately shows that reminder's
    first-level due actions.
  - If the queue is empty, the bubble closes and focus returns to the pet.
- The flow never renders a completed-status layer, a "Continue" button, or a
  "Close" button inside the pet reminder bubble.
- If completion fails, the current action remains visible and the completion button
  becomes available for retry.

## Component Boundary

`ActionCard` will accept an optional successful-completion callback. When supplied,
it invokes the callback after `controller.complete` resolves instead of entering its
local completed-status state. Existing callers that omit the callback retain the
current completion confirmation.

`CatReminderBubble` will supply that callback, clear its action state, inspect the
controller's fresh queue snapshot, and either reveal the next reminder or request
that the bubble close.

## Accessibility

- Advancing the queue focuses the next reminder's first action.
- Closing the final reminder returns focus to the pet.
- A pending completion remains disabled to prevent duplicate commands.

## Tests

- A single completed reminder closes immediately without rendering a status layer.
- A completed reminder with a queued successor advances directly to the successor.
- A rejected completion keeps the current action available for retry.
- Existing single-flight completion behavior remains covered.
