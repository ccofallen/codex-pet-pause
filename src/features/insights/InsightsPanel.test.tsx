import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { createDefaultSettings } from '../../app/defaults';
import type { ActivityEvent } from '../../app/model';
import { createFakeDependencies } from '../../test/fakes';
import {
  InsightsPanel, localMidnight, nextLocalMidnight, summarizeToday,
} from './InsightsPanel';
import { I18nProvider } from '../../i18n/I18nProvider';

const NOW = new Date(2026, 6, 11, 15, 30).getTime();
const event = (action: ActivityEvent['action'], occurredAt: number, reminderType: ActivityEvent['reminderType'] = 'drinkWater'): ActivityEvent => ({
  id: `${action}-${occurredAt}-${reminderType}`, action, occurredAt, reminderType,
});

function insightsView(
  controller: ReturnType<typeof createAppController>,
  locale: 'zh-CN' | 'en' = 'zh-CN',
) {
  return (
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><InsightsPanel now={() => new Date(NOW)} /></I18nProvider>
    </AppProvider>
  );
}

afterEach(() => vi.useRealTimers());

test('nextLocalMidnight advances by local calendar date rather than fixed milliseconds', () => {
  const next = new Date(nextLocalMidnight(new Date(2026, 9, 25, 12, 30)));
  expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()])
    .toEqual([2026, 9, 26, 0, 0]);
});

test('localMidnight uses calendar construction and filters repository over-return to completed local-day events', async () => {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.affinity = 32;
  const deps = createFakeDependencies({ now: NOW, settings });
  const midnight = localMidnight(new Date(NOW));
  deps.history.events.push(
    event('completed', midnight + 1_000),
    event('skipped', midnight + 2_000),
    event('completed', midnight - 1_000, 'standUp'),
  );
  deps.history.listSince = vi.fn(async () => [...deps.history.events]);
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller));

  expect(await screen.findByText('今天完成 1 次健康活动')).toBeVisible();
  expect(screen.getByText('喝水 1 次')).toBeVisible();
  expect(screen.getByText('亲密度 32 · 亲近')).toBeVisible();
  expect(deps.history.listSince).toHaveBeenCalledWith(midnight);
  expect(summarizeToday(deps.history.events, new Date(NOW))).toHaveLength(1);
});

test('filters invalid times and non-completions while retaining uncategorized completions', () => {
  const midnight = localMidnight(new Date(NOW));
  const corrupt = [
    event('completed', midnight, 'lookAway'),
    event('completed', NOW, 'standUp'),
    event('completed', NOW + 1),
    event('completed', Number.NaN),
    { ...event('completed', NOW), reminderType: 'unknown' },
    event('skipped', NOW, 'drinkWater'),
  ] as ActivityEvent[];
  expect(summarizeToday(corrupt, new Date(NOW)).map(({ reminderType }) => reminderType))
    .toEqual(['lookAway', 'standUp', 'unknown']);
});

test('reloads counts after a successful completed-history append', async () => {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.reminders[0] = { ...settings.reminders[0]!, enabled: true, status: 'scheduled' };
  const deps = createFakeDependencies({ now: NOW, settings });
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller));
  expect(await screen.findByText('今天完成 0 次健康活动')).toBeVisible();
  await controller.complete('lookAway');
  expect(await screen.findByText('今天完成 1 次健康活动')).toBeVisible();
  expect(screen.getByText('目视远方 1 次')).toBeVisible();
});

test('a native runtime history revision updates today total while mounted', async () => {
  const deps = createFakeDependencies({ now: NOW });
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller, 'en'));
  expect(await screen.findByText('0 healthy activities completed today')).toBeVisible();

  deps.history.events.push(event('completed', NOW, 'lookAway'));
  act(() => controller.applyCommittedRuntimeState({
    revision: 1,
    settings: controller.getSnapshot().settings,
  }));

  expect(await screen.findByText('1 healthy activity completed today')).toBeVisible();
  expect(screen.getByText('Look into the distance: 1')).toBeVisible();
});

test('includes custom completions in the total without adding a preset category count', async () => {
  const deps = createFakeDependencies({ now: NOW });
  deps.history.events.push({
    id: 'custom-completed',
    reminderId: 'custom-medicine',
    reminderLabel: '吃药',
    action: 'completed',
    occurredAt: NOW,
  });
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller));

  expect(await screen.findByText('今天完成 1 次健康活动')).toBeVisible();
  for (const label of ['目视远方', '喝水', '起身活动', '完整休息']) {
    expect(screen.getByText(`${label} 0 次`)).toBeVisible();
  }
});

test('reloads at the next local calendar midnight', async () => {
  vi.useFakeTimers();
  const beforeMidnight = new Date(2026, 6, 11, 23, 59, 59, 900);
  vi.setSystemTime(beforeMidnight);
  const deps = createFakeDependencies({ now: beforeMidnight.getTime() });
  deps.history.events.push(event('completed', beforeMidnight.getTime()));
  const list = vi.spyOn(deps.history, 'listSince');
  const controller = createAppController(deps);
  await controller.hydrate();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><InsightsPanel /></I18nProvider>
    </AppProvider>,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText('今天完成 1 次健康活动')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.getByText('今天完成 0 次健康活动')).toBeVisible();
});

test('updates affinity from the live snapshot', async () => {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.reminders[0] = { ...settings.reminders[0]!, enabled: true, status: 'scheduled' };
  const deps = createFakeDependencies({ now: NOW, settings });
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller));
  expect(await screen.findByText('亲密度 0 · 初识')).toBeVisible();
  await controller.complete('lookAway');
  expect(await screen.findByText('亲密度 1 · 初识')).toBeVisible();
});

test('shows a kind recoverable error when reading history fails', async () => {
  const deps = createFakeDependencies({ now: NOW });
  deps.history.listSince = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce([]);
  const controller = createAppController(deps);
  await controller.hydrate();
  const user = (await import('@testing-library/user-event')).default.setup();
  render(insightsView(controller));
  expect(await screen.findByText('暂时无法读取今天的记录，你的提醒仍会正常运行。')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '重试今日记录' }));
  expect(await screen.findByText('今天完成 0 次健康活动')).toBeVisible();
});

test('ignores stale async results and post-unmount completion', async () => {
  let resolve!: (events: ActivityEvent[]) => void;
  const deps = createFakeDependencies({ now: NOW });
  deps.history.listSince = vi.fn(() => new Promise<ActivityEvent[]>((done) => { resolve = done; }));
  const controller = createAppController(deps);
  await controller.hydrate();
  const view = render(insightsView(controller));
  view.unmount();
  resolve([event('completed', NOW)]);
  await waitFor(() => expect(screen.queryByText('今天完成 1 次健康活动')).not.toBeInTheDocument());
});

test('localizes history counts and affinity in English', async () => {
  const settings = createDefaultSettings(NOW, 'en');
  settings.affinity = 32;
  const deps = createFakeDependencies({ now: NOW, settings });
  deps.history.events.push(event('completed', NOW));
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller, 'en'));

  expect(await screen.findByRole('heading', { name: 'Today' })).toBeVisible();
  expect(screen.getByText('1 healthy activity completed today')).toBeVisible();
  expect(screen.getByText('Drink water: 1')).toBeVisible();
  expect(screen.getByText('Affinity 32 · Close')).toBeVisible();
});

test('localizes unavailable history and retry action in English', async () => {
  const deps = createFakeDependencies({ now: NOW });
  deps.history.listSince = vi.fn().mockRejectedValue(new Error('nope'));
  const controller = createAppController(deps);
  await controller.hydrate();
  render(insightsView(controller, 'en'));

  expect(await screen.findByText('Today’s history is unavailable. Your reminders will keep working.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry today’s history' })).toBeVisible();
});
