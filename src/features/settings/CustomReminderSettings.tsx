import {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import {
  addCustomReminder,
  deleteCustomReminder,
  editCustomReminder,
  newCustomReminderId,
  setCustomReminderEnabled,
  validateCustomReminderInput,
  type CustomReminderValidationCode,
} from '../reminders/domain/customReminders';
import { createCustomReminder } from '../reminders/domain/scheduler';
import type { CustomReminder, SchedulerState } from '../reminders/domain/types';
import { useI18n } from '../../i18n/I18nProvider';

interface CustomReminderSettingsProps {
  now: () => number;
}

interface ReminderDraft {
  label: string;
  interval: string;
}

interface DeleteTarget {
  id: string;
  label: string;
}

type CustomReminderErrorCode = CustomReminderValidationCode | 'save-failed' | 'delete-failed';

const draftFromReminder = (reminder: CustomReminder): ReminderDraft => ({
  label: reminder.label,
  interval: String(reminder.intervalMinutes),
});

export function CustomReminderSettings({ now }: CustomReminderSettingsProps) {
  const { t } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const customReminders = snapshot.settings.reminders.filter(
    (reminder): reminder is CustomReminder => reminder.kind === 'custom',
  );
  const [drafts, setDrafts] = useState<Record<string, ReminderDraft>>(() => Object.fromEntries(
    customReminders.map((reminder) => [reminder.id, draftFromReminder(reminder)]),
  ));
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<ReminderDraft>({ label: '', interval: '' });
  const [addEnabled, setAddEnabled] = useState(false);
  const [addError, setAddError] = useState<CustomReminderErrorCode>();
  const [cardErrors, setCardErrors] = useState<Record<string, CustomReminderErrorCode | undefined>>({});
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const inFlightRef = useRef(false);
  const failedAddIdRef = useRef<string | undefined>(undefined);
  const failedToggleIntentsRef = useRef(new Map<string, boolean>());
  const deleteTriggersRef = useRef(new Map<string, HTMLButtonElement>());
  const addReminderRef = useRef<HTMLButtonElement>(null);
  const restoreFocusIdRef = useRef<string | undefined>(undefined);

  const errorMessage = (code: CustomReminderErrorCode): string => {
    switch (code) {
      case 'name-required': return t('settings.custom.error.nameRequired');
      case 'name-too-long': return t('settings.custom.error.nameTooLong');
      case 'interval-invalid': return t('settings.custom.error.interval');
      case 'delete-failed': return t('settings.custom.error.deleteFailed');
      case 'save-failed': return t('settings.custom.error.saveFailed');
    }
  };

  useLayoutEffect(() => {
    if (pending || deleteTarget !== undefined) return;
    const id = restoreFocusIdRef.current;
    if (id === undefined) return;
    restoreFocusIdRef.current = undefined;
    const trigger = deleteTriggersRef.current.get(id);
    if (trigger?.isConnected) trigger.focus();
    else addReminderRef.current?.focus();
  }, [deleteTarget, pending]);

  const beginMutation = (): boolean => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    return true;
  };

  const finishMutation = (): void => {
    inFlightRef.current = false;
    setPending(false);
  };

  const saveScheduler = async (scheduler: SchedulerState): Promise<void> => {
    const current = controller.getSnapshot().settings;
    await controller.saveSettings({ ...current, reminders: scheduler.reminders });
    const result = controller.getSnapshot();
    if (result.storageMode === 'temporary' || result.nonBlockingError === 'settings-write-failed') {
      throw new Error('settings-write-failed');
    }
  };

  const updateDraft = (id: string, patch: Partial<ReminderDraft>): void => {
    setDrafts((current) => {
      const reminder = customReminders.find((item) => item.id === id);
      const existing = current[id] ?? (reminder === undefined ? { label: '', interval: '' } : draftFromReminder(reminder));
      return { ...current, [id]: { ...existing, ...patch } };
    });
  };

  const syncAffectedDraft = (id: string): void => {
    const saved = controller.getSnapshot().settings.reminders.find(
      (reminder): reminder is CustomReminder => reminder.id === id && reminder.kind === 'custom',
    );
    if (saved !== undefined) {
      setDrafts((current) => ({ ...current, [id]: draftFromReminder(saved) }));
    }
  };

  const addReminder = async (): Promise<void> => {
    const validated = validateCustomReminderInput(addDraft);
    if ('error' in validated) {
      setAddError(validated.error);
      return;
    }
    if (!beginMutation()) return;
    setAddError(undefined);
    let attemptedId = failedAddIdRef.current;
    try {
      const current = controller.getSnapshot().scheduler;
      const attemptedAt = now();
      attemptedId ??= newCustomReminderId(attemptedAt);
      const existing = current.reminders.find((item) => item.id === attemptedId);
      let next: SchedulerState;
      if (existing === undefined) {
        next = addCustomReminder(current, createCustomReminder(
          attemptedId,
          validated.value.label,
          validated.value.intervalMinutes,
          attemptedAt,
          addEnabled,
        ));
      } else {
        const reminders = editCustomReminder(current.reminders, attemptedId, validated.value, attemptedAt);
        next = { ...current, reminders };
        const edited = reminders.find((item) => item.id === attemptedId)!;
        if (edited.enabled !== addEnabled) {
          next = setCustomReminderEnabled(next, attemptedId, addEnabled, attemptedAt);
        }
      }
      await saveScheduler(next);
      failedAddIdRef.current = undefined;
      syncAffectedDraft(attemptedId);
      setAddDraft({ label: '', interval: '' });
      setAddEnabled(false);
      setAddOpen(false);
    } catch {
      failedAddIdRef.current = attemptedId;
      setAddError('save-failed');
    } finally {
      finishMutation();
    }
  };

  const saveEdit = async (id: string, reminder: CustomReminder): Promise<void> => {
    const draft = drafts[id] ?? draftFromReminder(reminder);
    const validated = validateCustomReminderInput(draft);
    if ('error' in validated) {
      setCardErrors((current) => ({ ...current, [id]: validated.error }));
      return;
    }
    if (!beginMutation()) return;
    setCardErrors((current) => ({ ...current, [id]: undefined }));
    try {
      const current = controller.getSnapshot().scheduler;
      const reminders = editCustomReminder(current.reminders, id, validated.value, now());
      await saveScheduler({ ...current, reminders });
      syncAffectedDraft(id);
    } catch {
      setCardErrors((current) => ({ ...current, [id]: 'save-failed' }));
    } finally {
      finishMutation();
    }
  };

  const toggleEnabled = async (reminder: CustomReminder): Promise<void> => {
    if (!beginMutation()) return;
    setCardErrors((current) => ({ ...current, [reminder.id]: undefined }));
    const enabled = failedToggleIntentsRef.current.get(reminder.id) ?? !reminder.enabled;
    try {
      const current = controller.getSnapshot().scheduler;
      const currentReminder = current.reminders.find((item) => item.id === reminder.id);
      const next = currentReminder?.enabled === enabled
        ? current
        : setCustomReminderEnabled(current, reminder.id, enabled, now());
      await saveScheduler(next);
      failedToggleIntentsRef.current.delete(reminder.id);
      syncAffectedDraft(reminder.id);
    } catch {
      failedToggleIntentsRef.current.set(reminder.id, enabled);
      setCardErrors((current) => ({ ...current, [reminder.id]: 'save-failed' }));
    } finally {
      finishMutation();
    }
  };

  const closeDelete = (): void => {
    if (pending || deleteTarget === undefined) return;
    const id = deleteTarget.id;
    setDeleteTarget(undefined);
    restoreFocusIdRef.current = id;
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || !beginMutation()) return;
    const { id } = deleteTarget;
    setCardErrors((current) => ({ ...current, [id]: undefined }));
    try {
      const current = controller.getSnapshot().scheduler;
      const next = current.reminders.some((item) => item.id === id)
        ? deleteCustomReminder(current, id)
        : current;
      await saveScheduler(next);
      setDrafts((currentDrafts) => {
        const { [id]: _deleted, ...remaining } = currentDrafts;
        return remaining;
      });
      setDeleteTarget(undefined);
      restoreFocusIdRef.current = id;
    } catch {
      setCardErrors((current) => ({ ...current, [id]: 'delete-failed' }));
    } finally {
      finishMutation();
    }
  };

  return (
    <section className="custom-reminder-settings" aria-labelledby="custom-reminders-heading">
      <div className="custom-reminder-heading">
        <div>
          <h2 id="custom-reminders-heading">{t('settings.custom.heading')}</h2>
          <p>{t('settings.custom.description')}</p>
        </div>
        <button
          ref={addReminderRef}
          type="button"
          disabled={pending || customReminders.length >= 20}
          onClick={() => { setAddOpen(true); setAddError(undefined); }}
        >{t('settings.custom.add')}</button>
      </div>

      {addOpen && (
        <fieldset className="settings-card custom-reminder-card">
          <legend>{t('settings.custom.addHeading')}</legend>
          <label>{t('settings.custom.name')}<input value={addDraft.label} onChange={(event) => setAddDraft((current) => ({ ...current, label: event.target.value }))} /></label>
          <label>{t('settings.custom.interval')}<input inputMode="numeric" value={addDraft.interval} onChange={(event) => setAddDraft((current) => ({ ...current, interval: event.target.value }))} /></label>
          <label><input type="checkbox" checked={addEnabled} onChange={(event) => setAddEnabled(event.target.checked)} />{t('settings.custom.enableNow')}</label>
          {addError !== undefined && <p className="settings-error" role="alert">{errorMessage(addError)}</p>}
          <div className="custom-reminder-actions">
            <button type="button" disabled={pending} onClick={() => void addReminder()}>{t('settings.custom.saveAdd')}</button>
            <button type="button" disabled={pending} onClick={() => {
              failedAddIdRef.current = undefined;
              setAddOpen(false);
              setAddError(undefined);
            }}>{t('settings.custom.cancelAdd')}</button>
          </div>
        </fieldset>
      )}

      <div className="custom-reminder-grid">
        {customReminders.map((reminder) => {
          const draft = drafts[reminder.id] ?? draftFromReminder(reminder);
          return (
            <fieldset className="settings-card custom-reminder-card" key={reminder.id}>
              <legend>{reminder.label}</legend>
              <label><input type="checkbox" checked={reminder.enabled} disabled={pending} onChange={() => void toggleEnabled(reminder)} />{t('settings.custom.enable', { label: reminder.label })}</label>
              <label>{t('settings.custom.name')}<input value={draft.label} disabled={pending} onChange={(event) => updateDraft(reminder.id, { label: event.target.value })} /></label>
              <label>{t('settings.custom.interval')}<input inputMode="numeric" value={draft.interval} disabled={pending} onChange={(event) => updateDraft(reminder.id, { interval: event.target.value })} /></label>
              {cardErrors[reminder.id] !== undefined && <p className="settings-error" role="alert">{errorMessage(cardErrors[reminder.id]!)}</p>}
              <div className="custom-reminder-actions">
                <button type="button" disabled={pending} onClick={() => void saveEdit(reminder.id, reminder)}>{t('settings.custom.saveEdit')}</button>
                <button
                  ref={(node) => {
                    if (node === null) deleteTriggersRef.current.delete(reminder.id);
                    else deleteTriggersRef.current.set(reminder.id, node);
                  }}
                  type="button"
                  disabled={pending}
                  onClick={() => setDeleteTarget({ id: reminder.id, label: reminder.label })}
                >{t('settings.custom.delete', { label: reminder.label })}</button>
              </div>
            </fieldset>
          );
        })}
      </div>

      {deleteTarget !== undefined && (
        <DeleteReminderDialog
          label={deleteTarget.label}
          pending={pending}
          {...(cardErrors[deleteTarget.id] === undefined ? {} : { error: errorMessage(cardErrors[deleteTarget.id]!) })}
          onClose={closeDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

interface DeleteReminderDialogProps {
  label: string;
  pending: boolean;
  error?: string | undefined;
  onClose(): void;
  onConfirm(): void;
}

function DeleteReminderDialog({ label, pending, error, onClose, onConfirm }: DeleteReminderDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell === null) return undefined;
    const wasInert = shell.hasAttribute('inert');
    shell.setAttribute('inert', '');
    return () => {
      if (wasInert) shell.setAttribute('inert', '');
      else shell.removeAttribute('inert');
    };
  }, []);

  useEffect(() => {
    if (pending) dialogRef.current?.focus();
    else cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      if (activeIndex === -1) {
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
        return;
      }
      const nextIndex = event.shiftKey
        ? (activeIndex - 1 + focusable.length) % focusable.length
        : (activeIndex + 1) % focusable.length;
      focusable[nextIndex]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, onClose]);

  return createPortal(
    <div className="modal-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-delete-heading">
        <h2 id="custom-delete-heading">{t('settings.custom.deleteHeading', { label })}</h2>
        <p>{t('settings.custom.deleteDescription')}</p>
        {error !== undefined && <p className="settings-error" role="alert">{error}</p>}
        <div className="button-row">
          <button ref={cancelRef} type="button" disabled={pending} onClick={onClose}>{t('settings.reset.cancel')}</button>
          <button type="button" disabled={pending} onClick={onConfirm}>{pending ? t('settings.custom.deleting') : t('settings.custom.deleteConfirm')}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
