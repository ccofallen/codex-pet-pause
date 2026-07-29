import type { Page } from '@playwright/test';

type PresetReminderSeed = {
  kind: 'preset';
  type: 'lookAway' | 'drinkWater' | 'standUp' | 'takeBreak';
  dueAt: number;
  intervalMinutes?: number;
  actionDurationSeconds?: number;
};

type CustomReminderSeed = {
  kind: 'custom';
  id: string;
  label: string;
  enabled: boolean;
  intervalMinutes: number;
  nextDueAt: number;
  status: 'scheduled' | 'due' | 'snoozed' | 'disabled';
  snoozedUntil?: number;
};

type ReminderSeed = PresetReminderSeed | CustomReminderSeed;

interface SeedOptions {
  activePetId?: string;
  locale?: 'zh-CN' | 'en';
  soundEnabled?: boolean;
  theme?: 'light' | 'dark' | 'system';
}

export async function seedApp(
  page: Page,
  now: number,
  reminders: ReminderSeed[],
  options: SeedOptions = {},
): Promise<void> {
  await page.addInitScript(({ timestamp, seededReminders, seededOptions }) => {
    if (localStorage.getItem('neko-pause:settings') !== null) return;
    const intervals = { lookAway: 20, drinkWater: 45, standUp: 60, takeBreak: 90 };
    const presetReminders = seededReminders.filter(
      (item): item is PresetReminderSeed => item.kind === 'preset',
    );
    const customReminders = seededReminders.filter(
      (item): item is CustomReminderSeed => item.kind === 'custom',
    );
    const enabled = new Map(presetReminders.map((item) => [item.type, item]));
    localStorage.setItem('neko-pause:settings', JSON.stringify({
      schemaVersion: 5,
      petSize: 'medium',
      locale: seededOptions.locale ?? 'zh-CN',
      onboardingComplete: true,
      theme: seededOptions.theme ?? 'light',
      soundEnabled: seededOptions.soundEnabled ?? false,
      animationsEnabled: true,
      affinity: 0,
      quietHours: { enabled: false, startMinutes: 1320, endMinutes: 420 },
      runtime: {},
      cat: {
        name: '团子', coat: 'ginger', pattern: 'tabby', eyes: 'bright',
        ears: 'upright', tail: 'curl', accessory: 'scarf',
      },
      activePetId: seededOptions.activePetId ?? 'builtin-cat',
      petPosition: { xRatio: 0.82, yRatio: 0.72 },
      reminders: (Object.keys(intervals) as Array<keyof typeof intervals>).map((type) => {
        const seed = enabled.get(type);
        return {
          id: type,
          kind: 'preset',
          type,
          enabled: seed !== undefined,
          intervalMinutes: seed?.intervalMinutes ?? intervals[type],
          nextDueAt: seed?.dueAt ?? timestamp + intervals[type] * 60_000,
          status: seed === undefined ? 'disabled' : 'scheduled',
          ...(seed?.actionDurationSeconds === undefined
            ? {}
            : { optionalActionDurationSeconds: seed.actionDurationSeconds }),
        };
      }).concat(customReminders),
    }));
  }, { timestamp: now, seededReminders: reminders, seededOptions: options });
}
