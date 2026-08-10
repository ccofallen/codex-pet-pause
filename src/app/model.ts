import type { CatConfig, CatIntent } from '../features/cat/domain/types';
import type { ListedCodexPet, PetPosition } from '../features/pets/domain/types';
import type { PresetReminderType, Reminder, SchedulerState } from '../features/reminders/domain/types';
import type { Locale } from '../i18n/types';

export type ThemeMode = 'light' | 'dark' | 'system';
export type PetSizePreference = 'small' | 'medium' | 'large';

export interface QuietHours {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
}

export interface RuntimeState {
  pausedAt?: number | undefined;
  pausedUntil?: number | undefined;
  quietStartedAt?: number | undefined;
}

export interface AppSettings {
  schemaVersion: 5;
  locale: Locale;
  onboardingComplete: boolean;
  theme: ThemeMode;
  petSize: PetSizePreference;
  soundEnabled: boolean;
  animationsEnabled: boolean;
  affinity: number;
  quietHours: QuietHours;
  runtime: RuntimeState;
  cat: CatConfig;
  activePetId: string;
  petPosition: PetPosition;
  reminders: Reminder[];
}

export type ActivityAction = 'completed' | 'snoozed' | 'skipped';

export interface ActivityEvent {
  id: string;
  reminderId?: string;
  reminderLabel?: string;
  reminderType?: PresetReminderType;
  action: ActivityAction;
  occurredAt: number;
}

export type NotificationStatus = 'default' | 'granted' | 'denied' | 'unavailable';

export interface AppSnapshot {
  ready: boolean;
  settings: AppSettings;
  scheduler: SchedulerState;
  storageMode: 'persistent' | 'temporary';
  notificationStatus: NotificationStatus;
  pets: ListedCodexPet[];
  petLibraryError?: 'load-failed' | 'write-failed';
  catIntent?: CatIntent | undefined;
  catIntentEventId?: string | undefined;
  nonBlockingError?: 'history-write-failed' | 'settings-write-failed' | undefined;
  historyRevision?: number | undefined;
}
