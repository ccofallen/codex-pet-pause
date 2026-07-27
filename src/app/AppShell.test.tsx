import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { createAppController } from './appController';
import { AppProvider } from './AppProvider';
import { AppShell } from './AppShell';
import { I18nProvider } from '../i18n/I18nProvider';
import { createFakeDependencies } from '../test/fakes';
import type { StoredCodexPet } from '../features/pets/domain/types';

function shellView(controller: ReturnType<typeof createAppController>, locale: 'zh-CN' | 'en') {
  return (
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><AppShell /></I18nProvider>
    </AppProvider>
  );
}

function renderShell(controller: ReturnType<typeof createAppController>, locale: 'zh-CN' | 'en' = 'zh-CN') {
  return render(shellView(controller, locale));
}

test('localizes navigation and preserves the active view across locale changes', async () => {
  const user = userEvent.setup();
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const view = renderShell(controller);
  await user.click(screen.getByRole('button', { name: '提醒' }));

  view.rerender(shellView(controller, 'en'));

  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  expect(screen.getByText('0 reminders enabled')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reminders' })).toHaveAttribute('aria-current', 'page');
});

test('provides a skip link, status area, and navigation between four focused views', async () => {
  const user = userEvent.setup();
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  renderShell(controller);

  expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#main-content');
  expect(screen.getByRole('banner')).toHaveTextContent('Codex Pet Pause');
  const navigation = screen.getByRole('navigation', { name: '主要导航' });
  expect(navigation).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '陪伴' })).toHaveAttribute('aria-current', 'page');
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });

  await user.click(screen.getByRole('button', { name: '提醒' }));
  expect(screen.getByRole('heading', { name: '提醒' })).toBeVisible();
  expect(screen.getByRole('button', { name: '保存提醒设置' })).toBeVisible();
  expect(screen.getByRole('button', { name: '提醒' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: '摸摸 Momo' })).toBe(cat);
  await user.click(screen.getByRole('button', { name: '宠物' }));
  expect(screen.getByRole('heading', { name: '宠物库' })).toBeVisible();
  expect(screen.getByRole('button', { name: '导入 Codex 宠物' })).toBeVisible();
  expect(screen.getByRole('button', { name: '摸摸 Momo' })).toBe(cat);
  await user.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('heading', { name: '设置' })).toBeVisible();
  expect(screen.getByRole('button', { name: '保存应用设置' })).toBeVisible();
  expect(screen.getByRole('button', { name: '摸摸 Momo' })).toBe(cat);
});

test('desktop settings route keeps the full shell, opens settings, and hides the duplicate pet', () => {
  window.history.replaceState({}, '', '/?mode=web&view=settings&hidePet=1');
  const controller = createAppController(createFakeDependencies({ now: 0 }));

  renderShell(controller);

  expect(screen.getByRole('navigation', { name: '主要导航' })).toBeVisible();
  expect(screen.getByRole('button', { name: '设置' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { name: '设置' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '摸摸 Momo' })).not.toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});

test('hosted settings show desktop background guidance instead of browser-close warning', () => {
  const originalPetShell = window.petShell;
  Object.defineProperty(window, 'petShell', { configurable: true, value: {} });
  window.history.replaceState({}, '', '/?mode=web&view=settings&hidePet=1');
  const controller = createAppController(createFakeDependencies({ now: 0 }));

  try {
    renderShell(controller);

    expect(screen.getByText('桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。')).toBeVisible();
    expect(screen.queryByText('关闭网页或浏览器后，提醒不会继续运行。')).not.toBeInTheDocument();
  } finally {
    Object.defineProperty(window, 'petShell', { configurable: true, value: originalPetShell });
    window.history.replaceState({}, '', '/');
  }
});

test('returns the viewport to the top when the shell opens and views change', async () => {
  const user = userEvent.setup();
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  renderShell(controller);

  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  scrollTo.mockClear();
  await user.click(screen.getByRole('button', { name: '提醒' }));
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  scrollTo.mockRestore();
});

test('combines dashboard and today insights on the companion page', async () => {
  const settings = (await import('./defaults')).createDefaultSettings(0);
  settings.onboardingComplete = true;
  const controller = createAppController(createFakeDependencies({ now: 0, settings }));
  await controller.hydrate();
  renderShell(controller);
  expect(screen.getByRole('heading', { name: `${settings.cat.name} 在陪你` })).toBeVisible();
  expect(await screen.findByRole('heading', { name: '今天' })).toBeVisible();
});

test('opens a due reminder from the cat after navigating away from companion', async () => {
  const user = userEvent.setup();
  const settings = (await import('./defaults')).createDefaultSettings(0);
  settings.onboardingComplete = true;
  settings.reminders[1] = {
    ...settings.reminders[1]!,
    enabled: true,
    status: 'scheduled',
    nextDueAt: 1,
  };
  const controller = createAppController(createFakeDependencies({ now: 2, settings }));
  renderShell(controller);
  await act(async () => controller.hydrate());
  await act(async () => controller.reconcileNow());

  await user.click(screen.getByRole('button', { name: '设置' }));
  const settingsHeading = screen.getByRole('heading', { name: '设置' });
  expect(settingsHeading).toBeVisible();
  const shell = document.querySelector<HTMLElement>('.app-shell')!;
  const main = screen.getByRole('main');
  const navigation = screen.getByRole('navigation', { name: '主要导航' });
  const companionNavigation = screen.getByRole('button', { name: '陪伴' });
  const resetOpener = screen.getByRole('button', { name: '清除全部本地数据' });
  const cat = screen.getByRole('button', { name: 'Momo 有一项提醒，打开' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(cat);
  const dialog = screen.getByRole('dialog', { name: '喝水提醒' });
  expect(dialog).toBeVisible();
  expect(main).toHaveAttribute('inert');
  expect(navigation).toHaveAttribute('inert');
  expect([...shell.children]
    .filter((surface) => surface !== cat && surface !== dialog)
    .every((surface) => surface.hasAttribute('inert'))).toBe(true);
  expect(cat).not.toHaveAttribute('inert');
  expect(dialog).not.toHaveAttribute('inert');

  for (let step = 0; step < 4; step += 1) await user.tab();
  expect(companionNavigation).not.toHaveFocus();
  expect(resetOpener).not.toHaveFocus();
  expect(settingsHeading).toBeVisible();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);

  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(main).not.toHaveAttribute('inert');
  expect(navigation).not.toHaveAttribute('inert');
  await user.click(companionNavigation);
  expect(screen.getByRole('heading', { name: 'Momo 在陪你' })).toBeVisible();
});

test('portals reset above and isolates the globally mounted cat and navigation', async () => {
  const user = userEvent.setup();
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  renderShell(controller);
  await user.click(screen.getByRole('button', { name: '设置' }));
  const shell = document.querySelector<HTMLElement>('.app-shell')!;
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const navigation = screen.getByRole('navigation', { name: '主要导航' });

  await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));

  const dialog = screen.getByRole('dialog', { name: '删除本机数据？' });
  expect(shell).toHaveAttribute('inert');
  expect(shell).not.toContainElement(dialog);
  expect(cat.closest('[inert]')).toBe(shell);
  expect(navigation.closest('[inert]')).toBe(shell);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  for (let step = 0; step < 4; step += 1) {
    await user.tab();
    expect(shell).not.toContainElement(document.activeElement as HTMLElement);
  }

  await user.keyboard('{Escape}');

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(shell).not.toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: '摸摸 Momo' })).toBe(cat);
  expect(screen.getByRole('navigation', { name: '主要导航' })).toBe(navigation);
});

test('selects the fixed Codex stage only while an imported pet is active', async () => {
  const settings = (await import('./defaults')).createDefaultSettings(0);
  const pet: StoredCodexPet = {
    id: 'murk',
    displayName: 'Murk',
    spriteVersion: 2,
    spritesheetFilename: 'murk.png',
    spritesheet: new Blob(['atlas'], { type: 'image/png' }),
    importedAt: 0,
    updatedAt: 0,
  };
  settings.activePetId = pet.id;
  const dependencies = createFakeDependencies({ now: 0, settings });
  dependencies.pets.values.set(pet.id, pet);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:active'),
    revokeObjectURL: vi.fn(),
  });
  const controller = createAppController(dependencies);
  await controller.hydrate();
  const view = renderShell(controller);

  expect(screen.getByTestId('pet-stage')).toHaveAccessibleName('摸摸 Murk');
  expect(screen.queryByTestId('cat-stage')).not.toBeInTheDocument();

  const builtinController = createAppController(createFakeDependencies({ now: 0 }));
  await builtinController.hydrate();
  view.rerender(
    <AppProvider controller={builtinController}>
      <I18nProvider locale={builtinController.getSnapshot().settings.locale}><AppShell /></I18nProvider>
    </AppProvider>,
  );
  expect(screen.getByTestId('cat-stage')).toHaveAccessibleName('摸摸 Momo');
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:active');
  vi.unstubAllGlobals();
});
