import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import type { AppSettings } from '../../app/model';
import { CatSprite } from '../cat/sprite/CatSprite';
import { isPresetReminder } from '../reminders/domain/types';
import { getReminderLabel } from '../reminders/domain/presentation';
import { useI18n } from '../../i18n/I18nProvider';

interface ChoiceGroupProps<T extends string> {
  legend: string;
  name: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({
  legend, name, options, value, onChange,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      {options.map(([option, label]) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function OnboardingFlow() {
  const { locale, t } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const [draft, setDraft] = useState<AppSettings>(() => snapshot.settings);
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState(snapshot.notificationStatus);
  const legends = useRef<Array<HTMLLegendElement | null>>([]);

  const trimmedName = draft.cat.name.trim();
  const nameLength = Array.from(trimmedName).length;
  const presetReminders = draft.reminders.filter(isPresetReminder);
  const enabledReminders = presetReminders.filter((reminder) => reminder.enabled);
  const nameInvalid = nameLength < 1 || nameLength > 20;
  const remindersInvalid = enabledReminders.length === 0;
  const intervalsInvalid = enabledReminders.some((reminder) => (
    !Number.isInteger(reminder.intervalMinutes)
    || reminder.intervalMinutes < 1
    || reminder.intervalMinutes > 720
  ));
  const themeLabels: Record<AppSettings['theme'], string> = {
    light: t('onboarding.theme.light'),
    dark: t('onboarding.theme.dark'),
    system: t('onboarding.theme.system'),
  };
  const notificationMessage = notificationStatus === 'granted'
    ? t('onboarding.notification.granted')
    : notificationStatus === 'denied'
      ? t('onboarding.notification.denied')
      : notificationStatus === 'unavailable'
        ? t('onboarding.notification.unavailable')
        : undefined;

  useEffect(() => {
    legends.current[step]?.focus();
  }, [step]);

  const updateCat = (cat: AppSettings['cat']): void => {
    setDraft((current) => ({ ...current, cat }));
  };

  const updateReminder = (
    id: string,
    update: (reminder: AppSettings['reminders'][number]) => AppSettings['reminders'][number],
  ): void => {
    setDraft((current) => ({
      ...current,
      reminders: current.reminders.map((reminder) => reminder.id === id ? update(reminder) : reminder),
    }));
  };

  const requestNotifications = async (): Promise<void> => {
    setNotificationStatus(await controller.requestNotifications());
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (nameInvalid || remindersInvalid || intervalsInvalid) {
      setShowErrors(true);
      return;
    }
    await controller.saveSettings({
      ...draft,
      cat: { name: trimmedName },
      onboardingComplete: true,
    });
  };

  return (
    <main className="onboarding">
      <span className="onboarding-kicker">{t('onboarding.kicker')}</span>
      <h1 className="onboarding-title">{t('onboarding.title')}</h1>
      <p className="onboarding-intro">{t('onboarding.intro')}</p>
      <p
        className="onboarding-progress"
        role="progressbar"
        aria-label={t('onboarding.progress.ariaLabel')}
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={step + 1}
        aria-live="polite"
        data-step={step + 1}
      >
        {t('onboarding.progress', { step: step + 1, total: 4 })}
      </p>
      <form className="onboarding-form" onSubmit={(event) => { void submit(event); }} noValidate>
        <fieldset className="onboarding-page" hidden={step !== 0}>
          <legend ref={(element) => { legends.current[0] = element; }} tabIndex={-1}>
            {t('onboarding.step.cat')}
          </legend>
          <div className="cat-preview" role="img" aria-label={t('onboarding.catPreview')}>
            <CatSprite animation="idle" animate={snapshot.settings.animationsEnabled} />
          </div>
          <label>
            {t('onboarding.catName')}
            <input
              value={draft.cat.name}
              onChange={(event) => updateCat({ ...draft.cat, name: event.target.value })}
              aria-describedby={showErrors && step === 0 && nameInvalid ? 'cat-name-error' : undefined}
            />
          </label>
          {showErrors && step === 0 && nameInvalid && (
            <p id="cat-name-error">{t('onboarding.error.catName')}</p>
          )}
        </fieldset>

        <fieldset className="onboarding-page" hidden={step !== 1}>
          <legend ref={(element) => { legends.current[1] = element; }} tabIndex={-1}>
            {t('onboarding.step.reminders')}
          </legend>
          {presetReminders.map((reminder) => {
            const label = getReminderLabel(reminder, locale);
            return (
              <div className="reminder-setting" key={reminder.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={reminder.enabled}
                    onChange={(event) => updateReminder(reminder.id, (current) => ({
                      ...current,
                      enabled: event.target.checked,
                      status: event.target.checked ? 'scheduled' : 'disabled',
                    }))}
                  />
                  {t('onboarding.reminder.enable', { label })}
                </label>
                <label>
                  {t('onboarding.reminder.interval', { label })}
                  <input
                    type="number"
                    min={1}
                    max={720}
                    step={1}
                    disabled={!reminder.enabled}
                    value={reminder.intervalMinutes}
                    onChange={(event) => updateReminder(reminder.id, (current) => ({
                      ...current,
                      intervalMinutes: Number(event.target.value),
                    }))}
                  />
                </label>
              </div>
            );
          })}
          {showErrors && step === 1 && remindersInvalid && <p>{t('onboarding.error.reminderRequired')}</p>}
          {showErrors && step === 1 && intervalsInvalid && (
            <p>{t('onboarding.error.interval')}</p>
          )}
        </fieldset>

        <fieldset className="onboarding-page" hidden={step !== 2}>
          <legend ref={(element) => { legends.current[2] = element; }} tabIndex={-1}>
            {t('onboarding.step.preferences')}
          </legend>
          <ChoiceGroup
            legend={t('onboarding.theme')}
            name="theme"
            options={[
              ['light', themeLabels.light],
              ['dark', themeLabels.dark],
              ['system', themeLabels.system],
            ]}
            value={draft.theme}
            onChange={(theme) => setDraft((current) => ({ ...current, theme }))}
          />
          <label>
            <input
              type="checkbox"
              checked={draft.soundEnabled}
              onChange={(event) => setDraft((current) => ({
                ...current,
                soundEnabled: event.target.checked,
              }))}
            />
            {t('onboarding.sound.enable')}
          </label>
          <p>{t('onboarding.notification.guidance')}</p>
          <button type="button" onClick={() => { void requestNotifications(); }}>
            {t('onboarding.notification.enable')}
          </button>
          {notificationMessage !== undefined && (
            <p role="status">{notificationMessage}</p>
          )}
        </fieldset>

        <fieldset className="onboarding-page" hidden={step !== 3}>
          <legend ref={(element) => { legends.current[3] = element; }} tabIndex={-1}>
            {t('onboarding.step.review')}
          </legend>
          <h2>{t('onboarding.review.heading')}</h2>
          <dl>
            <dt>{t('onboarding.review.cat')}</dt>
            <dd>{trimmedName || t('onboarding.review.unnamed')}</dd>
            <dt>{t('onboarding.review.reminders')}</dt>
            <dd>{enabledReminders.length > 0
              ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })
                .format(enabledReminders.map((reminder) => getReminderLabel(reminder, locale)))
              : t('onboarding.review.noneEnabled')}</dd>
            <dt>{t('onboarding.review.theme')}</dt>
            <dd>{themeLabels[draft.theme]}</dd>
            <dt>{t('onboarding.review.sound')}</dt>
            <dd>{draft.soundEnabled ? t('onboarding.review.enabled') : t('onboarding.review.disabled')}</dd>
          </dl>
          {showErrors && step === 3 && (
            <div role="alert">
              {nameInvalid && <p>{t('onboarding.error.catName')}</p>}
              {remindersInvalid && <p>{t('onboarding.error.reminderRequired')}</p>}
              {intervalsInvalid && <p>{t('onboarding.error.interval')}</p>}
            </div>
          )}
        </fieldset>

        <div className="onboarding-actions">
          {step > 0 && (
            <button type="button" onClick={() => setStep((current) => current - 1)}>{t('onboarding.previous')}</button>
          )}
          {step < 3
            ? <button key="next-step" type="button" onClick={() => setStep((current) => current + 1)}>{t('onboarding.next')}</button>
            : <button key="start-companion" type="submit">{t('onboarding.start')}</button>}
        </div>
      </form>
    </main>
  );
}
