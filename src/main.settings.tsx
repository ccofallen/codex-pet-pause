import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppSnapshot } from './app/AppProvider';
import { createAppController } from './app/appController';
import { ThemeProvider } from './theme/ThemeProvider';
import { SettingsPage } from './features/settings/SettingsPage';
import { createBrowserAudio } from './infrastructure/browserAudio';
import { createIndexedDbHistoryRepository } from './infrastructure/historyRepository';
import { createBrowserNotifications } from './infrastructure/browserNotifications';
import { createIndexedDbPetRepository } from './infrastructure/petRepository';
import { createBrowserSettingsRepository } from './infrastructure/settingsRepository';
import { I18nProvider } from './i18n/I18nProvider';
import { detectPreferredLocale } from './i18n/locale';
import './styles/tokens.css';
import './styles/global.css';

const defaultLocale = detectPreferredLocale(navigator.languages);
const controller = createAppController({
  clock: { now: () => import.meta.env.VITE_NEKO_E2E === '1' ? window.__NEKO_TEST_NOW__ ?? Date.now() : Date.now() },
  settings: createBrowserSettingsRepository(window.localStorage, defaultLocale),
  history: createIndexedDbHistoryRepository(window.indexedDB),
  pets: createIndexedDbPetRepository(window.indexedDB),
  notifications: createBrowserNotifications(),
  audio: createBrowserAudio(undefined, `${import.meta.env.BASE_URL}assets/cat/meow.wav`),
  defaultLocale,
});
const section = new URLSearchParams(window.location.search).get('section') === 'reminders' ? 'reminders' : 'general';

function SettingsRoot() {
  const snapshot = useAppSnapshot();
  return <I18nProvider locale={snapshot.settings.locale}><ThemeProvider mode={snapshot.settings.theme}><main className="settings-page-root"><SettingsPage section={section} /></main></ThemeProvider></I18nProvider>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppProvider controller={controller}><SettingsRoot /></AppProvider></StrictMode>,
);
