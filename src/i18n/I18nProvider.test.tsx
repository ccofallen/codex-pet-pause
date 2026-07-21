import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { I18nProvider, useI18n } from './I18nProvider';

function Probe() {
  const { t } = useI18n();
  return <p>{t('app.loading')}</p>;
}

test('updates document metadata when the locale changes', () => {
  const rendered = render(<I18nProvider locale="zh-CN"><Probe /></I18nProvider>);
  expect(document.documentElement).toHaveAttribute('lang', 'zh-CN');
  expect(document.title).toBe('Codex Pet Pause · 猫叫音效：elevenlabs.io');
  expect(screen.getByText('正在唤醒宠物…')).toBeVisible();

  rendered.rerender(<I18nProvider locale="en"><Probe /></I18nProvider>);
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  expect(document.title).toBe('Codex Pet Pause · Cat sound: elevenlabs.io');
  expect(screen.getByText('Waking your pet…')).toBeVisible();
});
