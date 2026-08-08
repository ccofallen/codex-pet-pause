import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppSnapshot } from './app/AppProvider';
import { createAppController } from './app/appController';
import { AndroidApp } from './android/components/AndroidApp';
import { AndroidOverlayApp } from './android/components/AndroidOverlayApp';
import { getAndroidHost } from './android/bridge/androidHost';
import {
  createAndroidHistoryRepository,
  createAndroidPetRepository,
  createAndroidSettingsRepository,
} from './android/infrastructure/androidRepositories';
import { createAndroidAudio, createAndroidNotifications } from './android/infrastructure/androidPorts';
import { I18nProvider } from './i18n/I18nProvider';
import { detectPreferredLocale } from './i18n/locale';
import { translate } from './i18n/messages';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/tokens.css';
import './styles/global.css';
import './styles/android.css';
import './styles/android-overlay.css';

const defaultLocale = detectPreferredLocale(navigator.languages);
document.documentElement.lang = defaultLocale;
document.title = translate(defaultLocale, 'document.title');

function AndroidRoot({ controller }: { controller: ReturnType<typeof createAppController> }) {
  const snapshot = useAppSnapshot();
  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <ThemeProvider mode={snapshot.settings.theme}><AndroidApp /></ThemeProvider>
    </I18nProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
const overlayMode = new URLSearchParams(window.location.search).get('overlay') === '1';

if (overlayMode) {
  document.documentElement.dataset.androidOverlay = 'true';
  root.render(<StrictMode><AndroidOverlayApp /></StrictMode>);
} else {
  const host = getAndroidHost();
  const controller = createAppController({
    clock: { now: () => Date.now() },
    settings: createAndroidSettingsRepository(host),
    history: createAndroidHistoryRepository(host),
    pets: createAndroidPetRepository(host),
    notifications: createAndroidNotifications(),
    audio: createAndroidAudio(),
    defaultLocale,
  });
  host.subscribe(() => { void controller.hydrate(); });
  root.render(
    <StrictMode>
      <AppProvider controller={controller}>
        <AndroidRoot controller={controller} />
      </AppProvider>
    </StrictMode>,
  );
}
