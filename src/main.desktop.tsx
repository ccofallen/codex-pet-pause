import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/AppProvider';
import { DesktopApp } from './app/DesktopApp';
import { createAppController } from './app/appController';
import { createBrowserAudio } from './infrastructure/browserAudio';
import { createIndexedDbHistoryRepository } from './infrastructure/historyRepository';
import { createBrowserNotifications } from './infrastructure/browserNotifications';
import { createIndexedDbPetRepository } from './infrastructure/petRepository';
import { createBrowserSettingsRepository } from './infrastructure/settingsRepository';
import { detectPreferredLocale } from './i18n/locale';
import './styles/tokens.css';
import './styles/global.css';
import './styles/desktop.css';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppProvider controller={controller}><DesktopApp /></AppProvider></StrictMode>,
);
