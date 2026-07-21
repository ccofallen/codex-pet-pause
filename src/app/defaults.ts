import type { AppSettings } from './model';
import { BUILTIN_PET_ID, DEFAULT_PET_POSITION } from '../features/pets/domain/types';
import type { PresetReminder, PresetReminderType } from '../features/reminders/domain/types';
import type { Locale } from '../i18n/types';

export function createDefaultSettings(now: number, locale: Locale = 'zh-CN'): AppSettings {
  const make = (type: PresetReminderType, intervalMinutes: number): PresetReminder => ({
    id: type,
    kind: 'preset',
    type,
    enabled: false,
    intervalMinutes,
    nextDueAt: now + intervalMinutes * 60_000,
    status: 'disabled',
  });

  return {
    schemaVersion: 4,
    locale,
    onboardingComplete: false,
    theme: 'system',
    soundEnabled: false,
    animationsEnabled: true,
    affinity: 0,
    quietHours: { enabled: false, startMinutes: 1320, endMinutes: 420 },
    runtime: {},
    cat: { name: 'Momo' },
    activePetId: BUILTIN_PET_ID,
    petPosition: DEFAULT_PET_POSITION,
    reminders: [
      make('lookAway', 20),
      make('drinkWater', 45),
      make('standUp', 60),
      make('takeBreak', 90),
    ],
  };
}
