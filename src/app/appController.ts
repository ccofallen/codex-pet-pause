import { createDefaultSettings } from './defaults';
import type {
  ActivityAction, ActivityEvent, AppSettings, AppSnapshot, QuietHours, RuntimeState,
} from './model';
import {
  completeReminder,
  pauseScheduler,
  reconcile,
  skipReminder,
  snoozeReminder,
} from '../features/reminders/domain/scheduler';
import { isPresetReminder } from '../features/reminders/domain/types';
import type { PresetReminderType, Reminder, SchedulerState } from '../features/reminders/domain/types';
import { addAffinity } from '../features/cat/domain/affinity';
import type { CatIntent } from '../features/cat/domain/types';
import type { HistoryRepository } from '../infrastructure/historyRepository';
import type { SettingsRepository } from '../infrastructure/settingsRepository';
import type { PetRepository } from '../infrastructure/petRepository';
import { BUILTIN_PET_ID, DEFAULT_PET_POSITION } from '../features/pets/domain/types';
import type { PetPosition, StoredCodexPet } from '../features/pets/domain/types';
import {
  createReminderNotification,
  getReminderLabel,
  type NotificationPayload,
} from '../features/reminders/domain/presentation';
import type { Locale } from '../i18n/types';

export interface Clock {
  now(): number;
}

export interface NotificationPort {
  status(): AppSnapshot['notificationStatus'];
  request(): Promise<AppSnapshot['notificationStatus']>;
  notify(payload: NotificationPayload): Promise<void>;
}

export interface AudioPort {
  play(): Promise<void>;
}

export interface ControllerDependencies {
  clock: Clock;
  settings: SettingsRepository;
  history: HistoryRepository;
  pets: PetRepository;
  notifications: NotificationPort;
  audio: AudioPort;
  defaultLocale?: Locale;
}

export interface AppController {
  getSnapshot(): AppSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<void>;
  applyCommittedState?(state: Pick<AppSnapshot, 'settings' | 'pets'>): void;
  reconcileNow(): Promise<void>;
  complete(id: string): Promise<void>;
  snooze(id: string, minutes: 5 | 10 | 15): Promise<void>;
  skip(id: string): Promise<void>;
  pause(minutes: 30 | 60 | 120): Promise<void>;
  resumePause(): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  saveSettings(settings: AppSettings): Promise<void>;
  savePet(pet: StoredCodexPet): Promise<void>;
  deletePet(id: string): Promise<void>;
  selectPet(id: string): Promise<void>;
  savePetPosition(position: PetPosition): Promise<void>;
  requestNotifications(): Promise<AppSnapshot['notificationStatus']>;
  listHistorySince(timestamp: number): Promise<ActivityEvent[]>;
  clearAll(): Promise<void>;
}

export const isQuietAt = (timestamp: number, quiet: QuietHours): boolean => {
  return activeQuietWindow(timestamp, quiet) !== undefined;
};

interface TimeInterval {
  start: number;
  end: number;
}

const minute = 60_000;
const maxQuietWindowMinutes = 3 * 24 * 60;

function localMinuteAt(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function isQuietMinuteAt(timestamp: number, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const localMinute = localMinuteAt(timestamp);
  return quiet.startMinutes < quiet.endMinutes
    ? localMinute >= quiet.startMinutes && localMinute < quiet.endMinutes
    : localMinute >= quiet.startMinutes || localMinute < quiet.endMinutes;
}

function realMinuteFloor(timestamp: number): number {
  const date = new Date(timestamp);
  return timestamp - date.getSeconds() * 1_000 - date.getMilliseconds();
}

function activeQuietWindow(timestamp: number, quiet: QuietHours): TimeInterval | undefined {
  if (!isQuietMinuteAt(timestamp, quiet)) return undefined;
  let start = realMinuteFloor(timestamp);
  let end = start + minute;
  for (let index = 0; index < maxQuietWindowMinutes; index += 1) {
    if (!isQuietMinuteAt(start - 1, quiet)) break;
    start -= minute;
  }
  for (let index = 0; index < maxQuietWindowMinutes; index += 1) {
    if (!isQuietMinuteAt(end, quiet)) break;
    end += minute;
  }
  return { start, end };
}

export function isCurrentQuietRuntime(
  startedAt: number,
  now: number,
  quiet: QuietHours,
): boolean {
  const currentWindow = activeQuietWindow(now, quiet);
  return currentWindow !== undefined
    && Number.isFinite(startedAt)
    && startedAt <= now
    && startedAt >= currentWindow.start
    && startedAt < currentWindow.end;
}

export function getNextSchedulerWakeAt(
  snapshot: AppSnapshot,
  now: number,
): number | undefined {
  const { scheduler } = snapshot;
  const suppressionBoundaries: number[] = [];

  if (scheduler.pausedAt !== undefined) {
    const pauseEnd = scheduler.pausedUntil;
    if (pauseEnd === undefined || !Number.isFinite(pauseEnd)) return now;
    suppressionBoundaries.push(Math.max(now, pauseEnd));
  }

  if (scheduler.quietStartedAt !== undefined) {
    const quietWindow = activeQuietWindow(now, snapshot.settings.quietHours);
    if (quietWindow === undefined
      || !isCurrentQuietRuntime(
        scheduler.quietStartedAt,
        now,
        snapshot.settings.quietHours,
      )) return now;
    suppressionBoundaries.push(Math.max(now, quietWindow.end));
  }

  if (suppressionBoundaries.length > 0) return Math.min(...suppressionBoundaries);

  const queued = new Set(scheduler.dueQueue.map(({ reminderId }) => reminderId));
  const wakeTimes = scheduler.reminders
    .filter((reminder) => reminder.enabled && !queued.has(reminder.id))
    .map((reminder) => reminder.snoozedUntil ?? reminder.nextDueAt)
    .filter(Number.isFinite);

  return wakeTimes.length === 0 ? undefined : Math.min(...wakeTimes);
}

function effectiveSuppressionRestartAt(
  state: Pick<SchedulerState, 'pausedAt' | 'pausedUntil' | 'quietStartedAt'>,
  now: number,
  quiet: QuietHours,
): number {
  const activeStarts: number[] = [];
  if (state.pausedAt !== undefined
    && state.pausedUntil !== undefined
    && Number.isFinite(state.pausedAt)
    && Number.isFinite(state.pausedUntil)
    && state.pausedAt <= now
    && state.pausedUntil > now) {
    activeStarts.push(state.pausedAt);
  }
  if (state.quietStartedAt !== undefined
    && isCurrentQuietRuntime(state.quietStartedAt, now, quiet)) {
    activeStarts.push(state.quietStartedAt);
  }
  return activeStarts.length > 0 ? Math.min(...activeStarts) : now;
}

function quietEndForEffectiveStart(start: number, quiet: QuietHours): number {
  return activeQuietWindow(start, quiet)?.end ?? start;
}

function recurringQuietWindowsBetween(
  lastObservedAt: number,
  now: number,
  quiet: QuietHours,
): TimeInterval[] {
  if (!quiet.enabled || now < lastObservedAt) return [];
  const scanStartDate = new Date(lastObservedAt);
  scanStartDate.setHours(0, 0, 0, 0);
  scanStartDate.setDate(scanStartDate.getDate() - 1);
  let cursor = scanStartDate.getTime();
  const windows = new Map<number, TimeInterval>();
  while (cursor <= now) {
    const interval = activeQuietWindow(cursor, quiet);
    if (interval === undefined) {
      cursor += minute;
      continue;
    }
    if (interval.end > lastObservedAt && interval.start <= now) windows.set(interval.start, interval);
    cursor = Math.max(cursor + minute, interval.end);
  }
  return [...windows.values()];
}

function intervalUnionDuration(intervals: TimeInterval[]): number {
  const sorted = intervals
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start);
  const first = sorted[0];
  if (first === undefined) return 0;
  let start = first.start;
  let end = first.end;
  let duration = 0;
  for (const interval of sorted.slice(1)) {
    if (interval.start <= end) {
      end = Math.max(end, interval.end);
    } else {
      duration += end - start;
      start = interval.start;
      end = interval.end;
    }
  }
  return duration + end - start;
}

function intervalIntersections(
  intervals: TimeInterval[],
  coveringIntervals: TimeInterval[],
): TimeInterval[] {
  return intervals.flatMap((interval) => coveringIntervals.flatMap((covering) => {
    const start = Math.max(interval.start, covering.start);
    const end = Math.min(interval.end, covering.end);
    return end > start ? [{ start, end }] : [];
  }));
}

function shiftReminderDueTimes(state: SchedulerState, milliseconds: number): SchedulerState {
  if (milliseconds === 0) return state;
  return {
    ...state,
    reminders: state.reminders.map((reminder) => ({
      ...reminder,
      nextDueAt: reminder.nextDueAt + milliseconds,
    })),
  };
}

function schedulerFrom(settings: AppSettings, dueQueue: SchedulerState['dueQueue'] = []): SchedulerState {
  return {
    reminders: settings.reminders,
    dueQueue,
    ...settings.runtime,
  };
}

function runtimeFrom(scheduler: SchedulerState): RuntimeState {
  return {
    pausedAt: scheduler.pausedAt,
    pausedUntil: scheduler.pausedUntil,
    quietStartedAt: scheduler.quietStartedAt,
  };
}

function syncedSettings(settings: AppSettings, scheduler: SchedulerState): AppSettings {
  return {
    ...settings,
    reminders: scheduler.reminders,
    runtime: runtimeFrom(scheduler),
  };
}

const completionIntents: Record<PresetReminderType, CatIntent> = {
  lookAway: 'lookAway',
  drinkWater: 'drink',
  standUp: 'stretch',
  takeBreak: 'celebrate',
};

function quietHoursEqual(left: QuietHours, right: QuietHours): boolean {
  return left.enabled === right.enabled
    && left.startMinutes === right.startMinutes
    && left.endMinutes === right.endMinutes;
}

interface AdvanceSuppressionOptions {
  manualResume?: boolean;
  closeQuietAtNow?: boolean;
  reconcileWhenClear?: boolean;
}

function advanceSuppressionIntervals(
  state: SchedulerState,
  lastObservedAt: number,
  now: number,
  quiet: QuietHours,
  options: AdvanceSuppressionOptions = {},
): SchedulerState {
  const closedIntervals: TimeInterval[] = [];
  const activeIntervals: TimeInterval[] = [];
  const currentQuietWindow = activeQuietWindow(now, quiet);
  const quietWindows = new Map<number, TimeInterval>();
  recurringQuietWindowsBetween(lastObservedAt, now, quiet)
    .forEach((interval) => quietWindows.set(interval.start, interval));
  if (state.quietStartedAt !== undefined) {
    for (const interval of quietWindows.values()) {
      if (state.quietStartedAt >= interval.start && state.quietStartedAt < interval.end) {
        quietWindows.delete(interval.start);
      }
    }
    quietWindows.set(state.quietStartedAt, {
      start: state.quietStartedAt,
      end: quiet.enabled ? quietEndForEffectiveStart(state.quietStartedAt, quiet) : now,
    });
  }
  const effectiveCurrentQuiet = state.quietStartedAt !== undefined
    && currentQuietWindow !== undefined
    && state.quietStartedAt >= currentQuietWindow.start
    && state.quietStartedAt < currentQuietWindow.end
    ? { start: state.quietStartedAt, end: currentQuietWindow.end }
    : currentQuietWindow;
  for (const interval of quietWindows.values()) {
    if (effectiveCurrentQuiet?.start === interval.start && !options.closeQuietAtNow) {
      activeIntervals.push(effectiveCurrentQuiet);
    } else if (effectiveCurrentQuiet?.start === interval.start && options.closeQuietAtNow) {
      closedIntervals.push({ start: interval.start, end: now });
    } else if (interval.end <= now) {
      closedIntervals.push(interval);
    } else if (state.quietStartedAt === interval.start) {
      closedIntervals.push({ start: interval.start, end: now });
    }
  }
  const quietStartedAt = options.closeQuietAtNow ? undefined : effectiveCurrentQuiet?.start;

  let pausedAt = state.pausedAt;
  let pausedUntil = state.pausedUntil;
  if (pausedAt !== undefined) {
    const shouldClose = options.manualResume || (pausedUntil !== undefined && now >= pausedUntil);
    if (shouldClose) {
      closedIntervals.push({
        start: pausedAt,
        end: Math.max(pausedAt, Math.min(now, pausedUntil ?? now)),
      });
      pausedAt = undefined;
      pausedUntil = undefined;
    } else if (pausedUntil !== undefined) {
      activeIntervals.push({ start: pausedAt, end: pausedUntil });
    }
  }

  const closedDuration = intervalUnionDuration(closedIntervals);
  const coveredDuration = intervalUnionDuration(intervalIntersections(closedIntervals, activeIntervals));
  const shifted = shiftReminderDueTimes(state, closedDuration - coveredDuration);
  const next: SchedulerState = {
    ...shifted,
    pausedAt,
    pausedUntil,
    quietStartedAt,
  };
  return activeIntervals.length > 0 || options.reconcileWhenClear === false ? next : reconcile(next, now);
}

function mergeSettledReminderTimes(
  draft: AppSettings['reminders'],
  before: SchedulerState['reminders'],
  settled: SchedulerState['reminders'],
): AppSettings['reminders'] {
  return draft.map((reminder) => {
    const previous = before.find((item) => item.id === reminder.id);
    const current = settled.find((item) => item.id === reminder.id);
    if (previous === undefined || current === undefined) return reminder;
    const restarted = (!previous.enabled && reminder.enabled)
      || (previous.enabled && reminder.enabled
        && previous.intervalMinutes !== reminder.intervalMinutes);
    if (restarted) return reminder;
    return reminder.nextDueAt === previous.nextDueAt
      ? { ...reminder, nextDueAt: current.nextDueAt }
      : reminder;
  });
}

let fallbackEventSequence = 0;

function eventId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackEventSequence += 1;
  return `${now}-${fallbackEventSequence}`;
}

function isStoredCodexPet(value: unknown): value is StoredCodexPet {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredCodexPet>;
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && typeof candidate.displayName === 'string'
    && candidate.displayName.length > 0
    && (candidate.description === undefined || typeof candidate.description === 'string')
    && (candidate.spriteVersion === 1 || candidate.spriteVersion === 2)
    && typeof candidate.spritesheetFilename === 'string'
    && candidate.spritesheetFilename.length > 0
    && candidate.spritesheet instanceof Blob
    && typeof candidate.importedAt === 'number'
    && Number.isFinite(candidate.importedAt)
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt);
}

export function createAppController(deps: ControllerDependencies): AppController {
  const defaultLocale = deps.defaultLocale ?? 'zh-CN';
  const initialSettings = createDefaultSettings(deps.clock.now(), defaultLocale);
  let lastSuppressionObservation = deps.clock.now();
  let snapshot: AppSnapshot = {
    ready: false,
    settings: initialSettings,
    scheduler: schedulerFrom(initialSettings),
    storageMode: 'persistent',
    notificationStatus: deps.notifications.status(),
    pets: [],
  };
  const listeners = new Set<() => void>();
  let settingsRevision = 0;

  const publish = (next: AppSnapshot): void => {
    if (next.settings !== snapshot.settings) settingsRevision += 1;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const reportPersistenceFailure = (
    nonBlockingError: NonNullable<AppSnapshot['nonBlockingError']>,
  ): void => {
    publish({
      ...snapshot,
      ...(nonBlockingError === 'settings-write-failed' ? { storageMode: 'temporary' as const } : {}),
      nonBlockingError,
    });
  };

  const recoverSettingsPersistence = (): void => {
    if (snapshot.nonBlockingError === 'settings-write-failed') {
      const { nonBlockingError: _error, ...recovered } = snapshot;
      publish({ ...recovered, storageMode: 'persistent' });
    }
  };

  const writeCurrentSettings = async (
    project: (settings: AppSettings) => AppSettings = (settings) => settings,
    commit?: (settings: AppSettings) => void,
  ): Promise<void> => {
    while (true) {
      const revision = settingsRevision;
      const settings = project(snapshot.settings);
      try {
        await deps.settings.save(settings);
      } catch (error) {
        if (revision !== settingsRevision) continue;
        throw error;
      }
      if (revision === settingsRevision) {
        commit?.(settings);
        return;
      }
    }
  };

  const persistSettingsOrThrow = async (
    project?: (settings: AppSettings) => AppSettings,
    commit?: (settings: AppSettings) => void,
  ): Promise<void> => {
    try {
      await writeCurrentSettings(project, commit);
      recoverSettingsPersistence();
    } catch (error) {
      reportPersistenceFailure('settings-write-failed');
      throw error;
    }
  };

  const persistSettings = async (): Promise<void> => {
    await persistSettingsOrThrow().catch(() => undefined);
  };

  const appendHistory = async (event: ActivityEvent): Promise<void> => {
    try {
      await deps.history.append(event);
      publish({ ...snapshot, historyRevision: (snapshot.historyRevision ?? 0) + 1 });
    } catch {
      reportPersistenceFailure('history-write-failed');
    }
  };

  const publishScheduler = (
    scheduler: SchedulerState,
    settings: AppSettings = snapshot.settings,
  ): void => {
    publish({
      ...snapshot,
      scheduler,
      settings: syncedSettings(settings, scheduler),
    });
  };

  const publishPetWriteFailure = (): void => {
    publish({ ...snapshot, petLibraryError: 'write-failed' });
  };

  const sortedPets = (pets: StoredCodexPet[]): StoredCodexPet[] => pets
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  const performReminderAction = async (
    id: string,
    action: ActivityAction,
    transition: (state: SchedulerState, now: number) => SchedulerState,
  ): Promise<void> => {
    const now = deps.clock.now();
    const reminder = snapshot.scheduler.reminders.find((item) => item.id === id);
    if (!reminder) throw new RangeError(`Unknown reminder: ${id}`);
    const event: ActivityEvent = {
      id: eventId(now),
      reminderId: reminder.id,
      reminderLabel: getReminderLabel(reminder),
      ...(isPresetReminder(reminder) ? { reminderType: reminder.type } : {}),
      action,
      occurredAt: now,
    };
    const scheduler = transition(snapshot.scheduler, now);
    const settings = action === 'completed'
      ? { ...snapshot.settings, affinity: addAffinity(snapshot.settings.affinity) }
      : snapshot.settings;
    if (action === 'completed') {
      if (isPresetReminder(reminder)) {
        publish({
          ...snapshot,
          scheduler,
          settings: syncedSettings(settings, scheduler),
          catIntent: completionIntents[reminder.type],
          catIntentEventId: event.id,
        });
      } else {
        const { catIntent: _catIntent, catIntentEventId: _catIntentEventId, ...withoutIntent } = snapshot;
        publish({
          ...withoutIntent,
          scheduler,
          settings: syncedSettings(settings, scheduler),
        });
      }
    } else {
      publishScheduler(scheduler, settings);
    }
    await persistSettings();
    await appendHistory(event);
  };

  return {
    getSnapshot(): AppSnapshot {
      return snapshot;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    applyCommittedState({ settings, pets }): void {
      const { petLibraryError: _petLibraryError, ...current } = snapshot;
      publish({
        ...current,
        settings,
        scheduler: schedulerFrom(settings, snapshot.scheduler.dueQueue),
        pets: sortedPets([...pets]),
        storageMode: 'persistent',
      });
    },

    async hydrate(): Promise<void> {
      const now = deps.clock.now();
      let settings: AppSettings;
      let storageMode: AppSnapshot['storageMode'] = 'persistent';
      let nonBlockingError: AppSnapshot['nonBlockingError'];
      try {
        settings = await deps.settings.load() ?? createDefaultSettings(now, defaultLocale);
      } catch {
        settings = createDefaultSettings(now, defaultLocale);
        storageMode = 'temporary';
      }
      const [petsResult, historyResult] = await Promise.allSettled([
        deps.pets.list(),
        deps.history.prune(now),
      ]);
      if (historyResult.status === 'rejected') {
        nonBlockingError = 'history-write-failed';
      }
      const pets = petsResult.status === 'fulfilled'
        ? petsResult.value.filter(isStoredCodexPet)
        : [];
      const hasCorruptPets = petsResult.status === 'fulfilled'
        && pets.length !== petsResult.value.length;
      const petLibraryError = petsResult.status === 'rejected' || hasCorruptPets
        ? 'load-failed' as const
        : undefined;
      const selectedPetExists = settings.activePetId === BUILTIN_PET_ID
        || pets.some(({ id }) => id === settings.activePetId);
      if (!selectedPetExists || petsResult.status === 'rejected') {
        settings = { ...settings, activePetId: BUILTIN_PET_ID };
      }
      if (!selectedPetExists && petsResult.status === 'fulfilled') {
        try {
          await deps.settings.save(settings);
        } catch {
          storageMode = 'temporary';
          nonBlockingError = 'settings-write-failed';
        }
      }
      lastSuppressionObservation = now;
      publish({
        ready: true,
        settings,
        scheduler: schedulerFrom(settings),
        storageMode,
        notificationStatus: deps.notifications.status(),
        pets: sortedPets(pets),
        ...(petLibraryError === undefined ? {} : { petLibraryError }),
        ...(nonBlockingError === undefined ? {} : { nonBlockingError }),
      });
    },

    async reconcileNow(): Promise<void> {
      const now = deps.clock.now();
      const queueWasEmpty = snapshot.scheduler.dueQueue.length === 0;
      const previousQueueIds = new Set(snapshot.scheduler.dueQueue.map((item) => item.reminderId));
      const scheduler = advanceSuppressionIntervals(
        snapshot.scheduler,
        lastSuppressionObservation,
        now,
        snapshot.settings.quietHours,
      );
      lastSuppressionObservation = now;
      const addedReminderIds = new Set(
        scheduler.dueQueue
          .filter((item) => !previousQueueIds.has(item.reminderId))
          .map((item) => item.reminderId),
      );
      const addedReminders = scheduler.reminders.filter((item) => addedReminderIds.has(item.id));
      publishScheduler(scheduler);
      await persistSettings();
      if (!queueWasEmpty || scheduler.dueQueue.length === 0) return;
      if (addedReminders.length > 0) {
        await deps.notifications.notify(
          createReminderNotification(addedReminders, snapshot.settings.locale),
        ).catch(() => undefined);
      }
      if (snapshot.settings.soundEnabled && snapshot.settings.activePetId === BUILTIN_PET_ID) {
        await deps.audio.play().catch(() => undefined);
      }
    },

    async complete(id): Promise<void> {
      await performReminderAction(id, 'completed', (state, now) => completeReminder(state, id, now));
    },

    async snooze(id, minutes): Promise<void> {
      await performReminderAction(id, 'snoozed', (state, now) => snoozeReminder(state, id, minutes, now));
    },

    async skip(id): Promise<void> {
      await performReminderAction(id, 'skipped', (state, now) => skipReminder(state, id, now));
    },

    async pause(minutes): Promise<void> {
      const now = deps.clock.now();
      const settled = advanceSuppressionIntervals(
        snapshot.scheduler,
        lastSuppressionObservation,
        now,
        snapshot.settings.quietHours,
        { reconcileWhenClear: false },
      );
      lastSuppressionObservation = now;
      if (settled.pausedAt !== undefined
        && settled.pausedUntil !== undefined
        && settled.pausedUntil > now) {
        publishScheduler(settled);
        await persistSettings();
        return;
      }
      publishScheduler(pauseScheduler(settled, now, minutes));
      await persistSettings();
    },

    async resumePause(): Promise<void> {
      const now = deps.clock.now();
      publishScheduler(advanceSuppressionIntervals(
        snapshot.scheduler,
        lastSuppressionObservation,
        now,
        snapshot.settings.quietHours,
        { manualResume: true, reconcileWhenClear: false },
      ));
      lastSuppressionObservation = now;
      await persistSettings();
    },

    async setLocale(locale): Promise<void> {
      if (snapshot.settings.locale === locale) return;
      publish({ ...snapshot, settings: { ...snapshot.settings, locale } });
      await persistSettings();
    },

    async saveSettings(settings): Promise<void> {
      const now = deps.clock.now();
      const completingOnboarding = !snapshot.settings.onboardingComplete
        && settings.onboardingComplete;
      const effectiveSettings: AppSettings = completingOnboarding
        ? {
          ...settings,
          reminders: settings.reminders.map((reminder) => reminder.enabled
            ? {
              ...reminder,
              status: 'scheduled',
              snoozedUntil: undefined,
              nextDueAt: now + reminder.intervalMinutes * minute,
            }
            : { ...reminder, status: 'disabled', snoozedUntil: undefined }),
        }
        : settings;
      const quietChanged = !quietHoursEqual(
        snapshot.settings.quietHours,
        effectiveSettings.quietHours,
      );
      const settled = advanceSuppressionIntervals(
        snapshot.scheduler,
        lastSuppressionObservation,
        now,
        snapshot.settings.quietHours,
        { closeQuietAtNow: quietChanged, reconcileWhenClear: false },
      );
      lastSuppressionObservation = now;
      const mergedReminders = mergeSettledReminderTimes(
        effectiveSettings.reminders,
        snapshot.scheduler.reminders,
        settled.reminders,
      );
      const quietStartedAt = quietChanged
        && activeQuietWindow(now, effectiveSettings.quietHours) !== undefined
        ? now
        : settled.quietStartedAt;
      const restartAt = completingOnboarding
        ? effectiveSuppressionRestartAt(
          { ...settled, quietStartedAt },
          now,
          effectiveSettings.quietHours,
        )
        : now;
      const reminders = completingOnboarding
        ? mergedReminders.map((reminder) => reminder.enabled
          ? {
            ...reminder,
            nextDueAt: restartAt + reminder.intervalMinutes * minute,
          }
          : reminder)
        : mergedReminders;
      const dueReminderIds = new Set(
        reminders.filter((item) => item.enabled && item.status === 'due').map((item) => item.id),
      );
      const scheduler: SchedulerState = {
        ...settled,
        reminders,
        dueQueue: settled.dueQueue.filter((item) => dueReminderIds.has(item.reminderId)),
        quietStartedAt,
      };
      const nextSettings = syncedSettings(effectiveSettings, scheduler);
      publish({ ...snapshot, settings: nextSettings, scheduler });
      await persistSettings();
    },

    async savePet(pet): Promise<void> {
      const existing = snapshot.pets.find(({ id }) => id === pet.id);
      const stored = existing === undefined ? pet : { ...pet, importedAt: existing.importedAt };
      try {
        await deps.pets.put(stored);
      } catch (error) {
        publishPetWriteFailure();
        throw error;
      }
      const pets = sortedPets([
        ...snapshot.pets.filter(({ id }) => id !== stored.id),
        stored,
      ]);
      const { petLibraryError: _error, ...rest } = snapshot;
      publish({ ...rest, pets });
    },

    async deletePet(id): Promise<void> {
      const previousRecord = snapshot.pets.find((pet) => pet.id === id);
      if (previousRecord === undefined) return;
      try {
        await deps.pets.delete(id);
      } catch (error) {
        publishPetWriteFailure();
        throw error;
      }
      const pets = snapshot.pets.filter((pet) => pet.id !== id);
      if (snapshot.settings.activePetId !== id) {
        const { petLibraryError: _error, ...rest } = snapshot;
        publish({ ...rest, pets });
        return;
      }
      try {
        await persistSettingsOrThrow((settings) => ({
          ...settings,
          activePetId: BUILTIN_PET_ID,
        }), (settings) => {
          const { petLibraryError: _error, ...rest } = snapshot;
          publish({
            ...rest,
            settings,
            pets: snapshot.pets.filter((pet) => pet.id !== id),
          });
        });
      } catch (settingsError) {
        try {
          await deps.pets.put(previousRecord);
        } catch {
          publish({
            ...snapshot,
            settings: { ...snapshot.settings, activePetId: BUILTIN_PET_ID },
            pets: snapshot.pets.filter((pet) => pet.id !== id),
            petLibraryError: 'write-failed',
          });
        }
        throw settingsError;
      }
    },

    async selectPet(id): Promise<void> {
      if (id !== BUILTIN_PET_ID && !snapshot.pets.some((pet) => pet.id === id)) {
        throw new RangeError(`Unknown pet: ${id}`);
      }
      publish({ ...snapshot, settings: { ...snapshot.settings, activePetId: id } });
      await persistSettingsOrThrow();
    },

    async savePetPosition(position): Promise<void> {
      const normalize = (value: number, fallback: number): number => Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : fallback;
      const petPosition = {
        xRatio: normalize(position.xRatio, DEFAULT_PET_POSITION.xRatio),
        yRatio: normalize(position.yRatio, DEFAULT_PET_POSITION.yRatio),
      };
      const settings = { ...snapshot.settings, petPosition };
      publish({ ...snapshot, settings });
      await persistSettings();
    },

    async requestNotifications(): Promise<AppSnapshot['notificationStatus']> {
      const notificationStatus = await deps.notifications.request();
      publish({ ...snapshot, notificationStatus });
      return notificationStatus;
    },

    async listHistorySince(timestamp): Promise<ActivityEvent[]> {
      return deps.history.listSince(timestamp);
    },

    async clearAll(): Promise<void> {
      const results = await Promise.allSettled([
        deps.settings.clear(),
        deps.history.clear(),
        deps.pets.clear(),
      ]);
      if (results.some(({ status }) => status === 'rejected')) {
        const reasons = results.flatMap((result) => result.status === 'rejected'
          ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
          : []);
        throw new Error(`local data clear failed: ${reasons.join('; ')}`);
      }
      const now = deps.clock.now();
      const settings = createDefaultSettings(now, defaultLocale);
      lastSuppressionObservation = now;
      publish({
        ready: true,
        settings,
        scheduler: schedulerFrom(settings),
        storageMode: 'persistent',
        notificationStatus: deps.notifications.status(),
        pets: [],
      });
    },
  };
}
