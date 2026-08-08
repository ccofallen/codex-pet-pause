import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppSnapshot } from './app/AppProvider';
import { createAppController } from './app/appController';
import { AndroidApp } from './android/components/AndroidApp';
import { getAndroidHost } from './android/bridge/androidHost';
import {
  createAndroidHistoryRepository,
  createAndroidPetRepository,
  createAndroidSettingsRepository,
} from './android/infrastructure/androidRepositories';
import { createBrowserAudio } from './infrastructure/browserAudio';
import { createBrowserNotifications } from './infrastructure/browserNotifications';
import { I18nProvider } from './i18n/I18nProvider';
import { detectPreferredLocale } from './i18n/locale';
import { translate } from './i18n/messages';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/tokens.css';
import './styles/global.css';
import './styles/android.css';

const defaultLocale = detectPreferredLocale(navigator.languages);
const host = getAndroidHost();
const controller = createAppController({
  clock: { now: () => Date.now() },
  settings: createAndroidSettingsRepository(host),
  history: createAndroidHistoryRepository(host),
  pets: createAndroidPetRepository(host),
  notifications: createBrowserNotifications(),
  audio: createBrowserAudio(undefined, `${import.meta.env.BASE_URL}assets/cat/meow.wav`),
  defaultLocale,
});

document.documentElement.lang = defaultLocale;
document.title = translate(defaultLocale, 'document.title');

host.subscribe(() => { void controller.hydrate(); });

function AndroidRoot() {
  const snapshot = useAppSnapshot();
  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <ThemeProvider mode={snapshot.settings.theme}><AndroidApp /></ThemeProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider controller={controller}>
      <AndroidRoot />
    </AppProvider>
  </StrictMode>,
);
