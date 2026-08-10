import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { createDefaultSettings } from '../../app/defaults';
import type { ActivityEvent } from '../../app/model';
import { I18nProvider } from '../../i18n/I18nProvider';
import { createFakeDependencies } from '../../test/fakes';
import { MURK_TEST_PET } from '../../test/petFixtures';
import { AndroidApp } from './AndroidApp';

const NOW = new Date(2026, 7, 9, 12, 0).getTime();
const ANDROID_CSS = readFileSync('src/styles/android.css', 'utf8');

interface CompanionOptions {
  events?: ActivityEvent[];
  locale?: 'zh-CN' | 'en';
  clockNow?: number;
  petName?: string;
}

async function renderCompanion(input: ActivityEvent[] | CompanionOptions = {}) {
  const options = Array.isArray(input) ? { events: input } : input;
  const locale = options.locale ?? 'en';
  const clockNow = options.clockNow ?? NOW;
  const settings = createDefaultSettings(clockNow, locale);
  settings.onboardingComplete = true;
  settings.affinity = 32;
  settings.reminders = settings.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: clockNow + (index + 1) * 60_000,
  }));
  if (options.petName !== undefined) settings.activePetId = MURK_TEST_PET.id;
  const deps = createFakeDependencies({ now: clockNow, settings });
  if (options.petName !== undefined) {
    deps.pets.values.set(MURK_TEST_PET.id, {
      ...MURK_TEST_PET,
      displayName: options.petName,
    });
  }
  deps.history.events.push(...(options.events ?? []));
  const controller = createAppController(deps);
  await controller.hydrate();
  render(
    <AppProvider controller={controller} lifecycle="passive">
      <I18nProvider locale={locale}><AndroidApp /></I18nProvider>
    </AppProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Companion' : '陪伴' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { controller, deps };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('renders the balanced Android companion hierarchy with only one later reminder', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await renderCompanion([{
    id: 'done-1', action: 'completed', reminderType: 'drinkWater', occurredAt: NOW,
  }]);

  const companion = screen.getByTestId('android-companion');
  expect(companion).toHaveTextContent('Companion');
  expect(companion).toHaveTextContent('Current pet');
  expect(companion).toHaveTextContent('Momo');
  expect(companion).toHaveTextContent('Affinity 32');
  expect(within(companion).getByTestId('android-next-reminder')).toHaveTextContent('Next reminder');
  expect(within(companion).getByTestId('android-today-summary')).toHaveTextContent('1 done');
  expect(within(companion).getByTestId('android-relationship-summary')).toHaveTextContent('Close · 32');
  expect(within(companion).getAllByTestId('android-later-reminder')).toHaveLength(1);
  expect(screen.queryByLabelText("Today's completed activities by category")).not.toBeInTheDocument();
  expect(screen.queryByTestId('notification-guidance')).not.toBeInTheDocument();
});

test('restarts a committed next-reminder deadline and keeps the mounted countdown moving', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const { controller } = await renderCompanion();
  const settings = controller.getSnapshot().settings;
  const reminders = settings.reminders.map((reminder, index) => ({
    ...reminder,
    nextDueAt: NOW + (index + 2) * 60_000,
  }));

  act(() => controller.applyCommittedRuntimeState({
    revision: 1,
    settings: { ...settings, reminders },
  }));
  const countdown = screen.getByTestId('android-next-countdown');
  expect(countdown).toHaveTextContent('2 minutes');
  expect(countdown).not.toHaveAttribute('aria-live');

  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByTestId('android-next-countdown')).toHaveTextContent('1 minute 59 seconds');
});

test("updates today's total from a committed history revision without remounting", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const { controller, deps } = await renderCompanion();
  expect(screen.getByTestId('android-today-summary')).toHaveTextContent('0 done');

  deps.history.events.push({
    id: 'done-2', action: 'completed', reminderType: 'lookAway', occurredAt: NOW,
  });
  act(() => controller.applyCommittedRuntimeState({
    revision: 2,
    settings: controller.getSnapshot().settings,
  }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(screen.getByTestId('android-today-summary')).toHaveTextContent('1 done');
});

test("reloads today's total at the next local midnight while visible", async () => {
  vi.useFakeTimers();
  const beforeMidnight = new Date(2026, 7, 9, 23, 59, 59, 900).getTime();
  vi.setSystemTime(beforeMidnight);
  await renderCompanion({
    clockNow: beforeMidnight,
    events: [{
      id: 'before-midnight',
      action: 'completed',
      reminderType: 'drinkWater',
      occurredAt: beforeMidnight - 1_000,
    }],
  });
  expect(screen.getByTestId('android-today-summary')).toHaveTextContent('1 done');

  await act(async () => { await vi.advanceTimersByTimeAsync(100); });

  expect(screen.getByTestId('android-today-summary')).toHaveTextContent('0 done');
});

test.each([
  ['en', 'Companion', 'Current pet'],
  ['zh-CN', '陪伴', '当前宠物'],
] as const)('wraps a long unbroken pet name in the narrow %s layout', async (
  locale,
  companionLabel,
  currentPetLabel,
) => {
  vi.stubGlobal('innerWidth', 320);
  const style = document.createElement('style');
  style.textContent = ANDROID_CSS;
  document.head.append(style);
  const petName = 'MoonlightCompanionWithAnExtremelyLongUnbrokenDisplayName';

  try {
    await renderCompanion({ locale, petName });
    const companion = screen.getByRole('region', { name: companionLabel });
    const heading = within(companion).getByRole('heading', { name: petName });

    expect(companion).toHaveTextContent(currentPetLabel);
    expect(getComputedStyle(heading.parentElement!).minWidth).toBe('0');
    expect(getComputedStyle(heading).overflowWrap).toBe('anywhere');
  } finally {
    style.remove();
  }
});
