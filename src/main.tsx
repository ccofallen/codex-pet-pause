import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createAppController } from './app/appController';
import { AppProvider } from './app/AppProvider';
import { createBrowserAudio } from './infrastructure/browserAudio';
import { createIndexedDbHistoryRepository } from './infrastructure/historyRepository';
import { createBrowserNotifications } from './infrastructure/browserNotifications';
import { createBrowserSettingsRepository } from './infrastructure/settingsRepository';
import { createIndexedDbPetRepository } from './infrastructure/petRepository';
import { registerPwaServiceWorker } from './infrastructure/pwaStatus';
import { detectPreferredLocale } from './i18n/locale';
import { translate } from './i18n/messages';
import './styles/tokens.css';
import './styles/global.css';

if (import.meta.env.PROD) void registerPwaServiceWorker();

const defaultLocale = detectPreferredLocale(navigator.languages);
document.documentElement.lang = defaultLocale;
document.title = translate(defaultLocale, 'document.title');

const controller = createAppController({
  clock: {
    now: () => import.meta.env.VITE_NEKO_E2E === '1'
      ? window.__NEKO_TEST_NOW__ ?? Date.now()
      : Date.now(),
  },
  settings: createBrowserSettingsRepository(window.localStorage, defaultLocale),
  history: createIndexedDbHistoryRepository(window.indexedDB),
  pets: createIndexedDbPetRepository(window.indexedDB),
  notifications: createBrowserNotifications(),
  audio: createBrowserAudio(undefined, `${import.meta.env.BASE_URL}assets/cat/meow.wav`),
  defaultLocale,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider controller={controller}>
      <App />
    </AppProvider>
  </StrictMode>,
);
