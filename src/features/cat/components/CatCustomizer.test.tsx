import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { createAppController } from '../../../app/appController';
import { AppProvider } from '../../../app/AppProvider';
import { createDefaultSettings } from '../../../app/defaults';
import { createFakeDependencies } from '../../../test/fakes';
import { CatCustomizer } from './CatCustomizer';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Locale } from '../../../i18n/types';

async function renderCustomizer(locale: Locale = 'zh-CN') {
  const settings = { ...createDefaultSettings(0, locale), onboardingComplete: true };
  const dependencies = createFakeDependencies({ now: 0, settings });
  const controller = createAppController(dependencies);
  await controller.hydrate();
  const saveSettings = vi.spyOn(controller, 'saveSettings');
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><CatCustomizer /></I18nProvider>
    </AppProvider>,
  );
  return { user: userEvent.setup(), controller, saveSettings };
}

describe('CatCustomizer', () => {
  test('renders and validates the cat customizer in English', async () => {
    const { user, saveSettings } = await renderCustomizer('en');
    const name = screen.getByRole('textbox', { name: 'Cat name' });
    expect(screen.getByLabelText('Cat preview')).toContainElement(screen.getByTestId('cat-sprite'));
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save cat' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name between 1 and 20 characters');
    await user.type(name, 'Momo');
    await user.click(screen.getByRole('button', { name: 'Save cat' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ cat: { name: 'Momo' } }));
  });

  test('shows a sprite without appearance options and saves a name-only cat', async () => {
    const { user, saveSettings } = await renderCustomizer();
    const name = screen.getByRole('textbox', { name: '猫咪名字' });

    expect(screen.getByLabelText('猫咪预览')).toContainElement(screen.getByTestId('cat-sprite'));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    await user.clear(name);
    await user.type(name, '  豆包  ');
    expect(saveSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '保存猫咪' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cat: { name: '豆包' },
    }));
  });

  test('cancels an unsaved draft without polluting controller settings', async () => {
    const { user, controller, saveSettings } = await renderCustomizer();
    const name = screen.getByRole('textbox', { name: '猫咪名字' });

    await user.clear(name);
    await user.type(name, '豆包');
    await user.click(screen.getByRole('button', { name: '取消更改' }));

    expect(name).toHaveValue('Momo');
    expect(controller.getSnapshot().settings.cat.name).toBe('Momo');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  test('validates the Unicode-trimmed name from 1 through 20 code points', async () => {
    const { user, saveSettings } = await renderCustomizer();
    const name = screen.getByRole('textbox', { name: '猫咪名字' });

    await user.clear(name);
    await user.type(name, '   ');
    await user.click(screen.getByRole('button', { name: '保存猫咪' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1–20 个字符');
    expect(saveSettings).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, '🐱'.repeat(20));
    await user.click(screen.getByRole('button', { name: '保存猫咪' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cat: { name: '🐱'.repeat(20) },
    }));

    saveSettings.mockClear();
    await user.clear(name);
    await user.type(name, '🐱'.repeat(21));
    await user.click(screen.getByRole('button', { name: '保存猫咪' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1–20 个字符');
    expect(saveSettings).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, '  豆包  ');
    await user.click(screen.getByRole('button', { name: '保存猫咪' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      cat: { name: '豆包' },
    }));
  });
});
