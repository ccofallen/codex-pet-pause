import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppSnapshot } from './app/AppProvider';
import { createAppController } from './app/appController';
import { createDefaultSettings } from './app/defaults';
import { AndroidApp } from './android/components/AndroidApp';
import { AndroidDetachedSurfaceApp, isAndroidDetachedSurfaceRoute } from './android/components/AndroidDetachedSurfaceApp';
import { AndroidOverlayApp, isAndroidPetOverlayRoute } from './android/components/AndroidOverlayApp';
import { getAndroidHost } from './android/bridge/androidHost';
import {
  createAndroidAppRepositories,
} from './android/infrastructure/androidRepositories';
import { createAndroidAudio, createAndroidNotifications } from './android/infrastructure/androidPorts';
import { I18nProvider } from './i18n/I18nProvider';
import { detectPreferredLocale } from './i18n/locale';
import { translate } from './i18n/messages';
import { ThemeProvider } from './theme/ThemeProvider';
import { androidAppProviderLifecycle, connectAndroidRuntimeEvents } from './android/domain/androidRuntime';
import {
  createAndroidRuntimeRepository,
} from './android/infrastructure/androidRuntimeRepository';
import './styles/tokens.css';
import './styles/global.css';
import './styles/android.css';
import './styles/android-overlay.css';

const defaultLocale = detectPreferredLocale(navigator.languages);
document.documentElement.lang = defaultLocale;
document.title = translate(defaultLocale, 'document.title');

function AndroidRoot({
  controller,
  host,
  connectRuntime,
}: {
  controller: ReturnType<typeof createAppController>;
  host: ReturnType<typeof getAndroidHost>;
  connectRuntime: () => () => void;
}) {
  useEffect(connectRuntime, [connectRuntime]);
  const snapshot = useAppSnapshot();
  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <ThemeProvider mode={snapshot.settings.theme}><AndroidApp host={host} /></ThemeProvider>
    </I18nProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
const detachedSurfaceMode = isAndroidDetachedSurfaceRoute(window.location.search);
const overlayMode = isAndroidPetOverlayRoute(window.location.search);

if (detachedSurfaceMode) {
  document.documentElement.dataset.androidDetachedSurface = 'true';
  root.render(<StrictMode><AndroidDetachedSurfaceApp /></StrictMode>);
} else if (overlayMode) {
  document.documentElement.dataset.androidOverlay = 'true';
  root.render(<StrictMode><AndroidOverlayApp /></StrictMode>);
} else {
  const host = getAndroidHost();
  const runtimeSnapshots = createAndroidRuntimeRepository(host);
  const repositories = createAndroidAppRepositories(
    host,
    runtimeSnapshots,
    () => createDefaultSettings(Date.now(), defaultLocale),
  );
  const controller = createAppController({
    clock: { now: () => Date.now() },
    settings: repositories.settings,
    history: repositories.history,
    pets: repositories.pets,
    notifications: createAndroidNotifications(),
    audio: createAndroidAudio(),
    defaultLocale,
  });
  const connectRuntime = () => connectAndroidRuntimeEvents({
    subscribe: (listener) => host.subscribe(listener),
    invalidateLegacy: () => undefined,
    invalidateRuntime: (revision) => runtimeSnapshots.invalidate(revision),
    load: () => runtimeSnapshots.load(),
    apply: (state) => controller.applyCommittedRuntimeState(state),
  });
  root.render(
    <StrictMode>
      <AppProvider controller={controller} lifecycle={androidAppProviderLifecycle}>
        <AndroidRoot controller={controller} host={host} connectRuntime={connectRuntime} />
      </AppProvider>
    </StrictMode>,
  );
}
