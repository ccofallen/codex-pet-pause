import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProvider, useAppSnapshot } from './app/AppProvider';
import { DesktopApp } from './app/DesktopApp';
import { createAppController } from './app/appController';
import { deriveRendererRole } from './app/rendererRole';
import { ThemeProvider } from './theme/ThemeProvider';
import { SettingsPage } from './features/settings/SettingsPage';
import { createBrowserAudio } from './infrastructure/browserAudio';
import { createIndexedDbHistoryRepository } from './infrastructure/historyRepository';
import { createBrowserNotifications } from './infrastructure/browserNotifications';
import { createIndexedDbPetRepository } from './infrastructure/petRepository';
import { createRendererSettingsRepository } from './infrastructure/rendererSettingsRepository';
import { registerPwaServiceWorker } from './infrastructure/pwaStatus';
import { I18nProvider } from './i18n/I18nProvider';
import { detectPreferredLocale } from './i18n/locale';
import { translate } from './i18n/messages';
import './styles/tokens.css';
import './styles/global.css';

if (import.meta.env.PROD) void registerPwaServiceWorker();

const query = new URLSearchParams(window.location.search);
const rendererRole = deriveRendererRole(window.location.search, window.petShell !== undefined);
const isDesktopMode = rendererRole.view === 'desktop';
const isSettingsMode = rendererRole.view === 'settings';
const section = query.get('view') === 'reminders' || query.get('section') === 'reminders' ? 'reminders' : 'general';
const defaultLocale = detectPreferredLocale(navigator.languages);
document.documentElement.lang = defaultLocale;
document.title = translate(defaultLocale, 'document.title');

if (isDesktopMode) {
  const appRoot = document.getElementById('root');
  document.documentElement.dataset.petDesktop = '1';
  document.body.dataset.petDesktop = '1';
  if (appRoot) appRoot.dataset.petDesktop = '1';
  document.documentElement.style.minWidth = '0px';
  document.body.style.minWidth = '0px';
  document.documentElement.style.minHeight = '0px';
  document.body.style.minHeight = '0px';
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  void import('./styles/desktop.css');
}

const controller = createAppController({
  clock: { now: () => import.meta.env.VITE_NEKO_E2E === '1' ? window.__NEKO_TEST_NOW__ ?? Date.now() : Date.now() },
  settings: createRendererSettingsRepository({
    storage: window.localStorage,
    defaultLocale,
    desktopShellAvailable: window.petShell !== undefined,
    lifecycle: rendererRole.lifecycle,
  }),
  history: createIndexedDbHistoryRepository(window.indexedDB),
  pets: createIndexedDbPetRepository(window.indexedDB),
  notifications: createBrowserNotifications(),
  audio: createBrowserAudio(undefined, `${import.meta.env.BASE_URL}assets/cat/meow.wav`),
  defaultLocale,
});

function SettingsRoot() {
  const snapshot = useAppSnapshot();
  return <I18nProvider locale={snapshot.settings.locale}><ThemeProvider mode={snapshot.settings.theme}><main className="settings-page-root"><SettingsPage section={section} /></main></ThemeProvider></I18nProvider>;
}

function RendererApp() {
  return isDesktopMode ? <DesktopApp /> : isSettingsMode ? <SettingsRoot /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider
      controller={controller}
      lifecycle={rendererRole.lifecycle}
    >
      <RendererApp />
    </AppProvider>
  </StrictMode>,
);
