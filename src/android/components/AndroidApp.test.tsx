import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { AndroidApp } from './AndroidApp';
import { I18nProvider } from '../../i18n/I18nProvider';
import { createFakeDependencies } from '../../test/fakes';

function renderAndroidApp(locale: 'zh-CN' | 'en' = 'zh-CN') {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  return render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><AndroidApp /></I18nProvider>
    </AppProvider>,
  );
}

test('keeps the save and Petdex actions in the mobile thumb action region', () => {
  renderAndroidApp();

  const actions = screen.getByTestId('android-thumb-actions');
  expect(within(actions).getByRole('button', { name: '保存设置' })).toBeVisible();
  expect(within(actions).getByRole('button', { name: '浏览 Petdex 并自动导入' })).toBeVisible();
});

test('does not render an embedded second pet in Android settings', () => {
  renderAndroidApp();

  expect(screen.queryByTestId('interactive-cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
});

test('localizes Android navigation and capability status in English', () => {
  renderAndroidApp('en');

  expect(screen.getByRole('navigation', { name: 'Phone navigation' })).toBeVisible();
  expect(screen.getByText('Settings and pets are stored securely on this phone.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Browse Petdex and import automatically' })).toBeVisible();
});
