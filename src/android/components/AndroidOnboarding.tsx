import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { AndroidCapabilities, AndroidControlHost } from '../bridge/androidHost';

interface AndroidOnboardingProps {
  host: AndroidControlHost;
}

export function AndroidOnboarding({ host }: AndroidOnboardingProps) {
  const { t } = useI18n();
  const [capabilities, setCapabilities] = useState<AndroidCapabilities | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const startPending = useRef(false);
  const autoStartAllowed = useRef(true);

  const apply = useCallback((next: AndroidCapabilities) => {
    setCapabilities(next);
    setFailed(false);
  }, []);

  useEffect(() => {
    let active = true;
    void host.getCapabilities()
      .then((next) => { if (active) apply(next); })
      .catch(() => { if (active) setFailed(true); });
    const unsubscribe = host.subscribeCapabilities(({ capabilities: next }) => {
      if (active) apply(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [apply, host]);

  useEffect(() => {
    if (capabilities?.overlayPermission !== 'granted'
      || capabilities.serviceActive
      || startPending.current
      || !autoStartAllowed.current) return;
    startPending.current = true;
    setBusy(true);
    void host.startService()
      .then(apply)
      .catch(() => setFailed(true))
      .finally(() => {
        startPending.current = false;
        setBusy(false);
      });
  }, [apply, capabilities, host]);

  const run = async (operation: () => Promise<AndroidCapabilities>): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      apply(await operation());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (capabilities === null) {
    return <div className="android-onboarding" aria-live="polite"><p>{t('android.onboarding.loading')}</p></div>;
  }

  const notificationNeedsFirstRequest = capabilities.notificationPermission === 'denied'
    && !capabilities.notificationRequestAttempted;
  const notificationDenied = capabilities.notificationPermission === 'denied';

  return (
    <div className="android-onboarding">
      {capabilities.overlayPermission === 'denied' ? (
        <>
          <p>{t('android.onboarding.permissionDeniedUsable')}</p>
          {!setupOpen ? (
            <button type="button" disabled={busy} onClick={() => setSetupOpen(true)}>
              {capabilities.notificationPermission !== 'notRequired'
                && capabilities.notificationRequestAttempted
                ? t('android.onboarding.retryOverlay')
                : t('android.onboarding.enable')}
            </button>
          ) : notificationNeedsFirstRequest ? (
            <div className="android-onboarding-step">
              <h3>{t('android.onboarding.notificationHeading')}</h3>
              <p>{t('android.onboarding.notificationBody')}</p>
              <button type="button" disabled={busy} onClick={() => void run(host.requestNotifications)}>
                {t('android.onboarding.allowNotifications')}
              </button>
            </div>
          ) : (
            <div className="android-onboarding-step">
              <h3>{t('android.onboarding.overlayHeading')}</h3>
              <p>{t('android.onboarding.overlayBody')}</p>
              {notificationDenied && (
                <p className="android-permission-warning">{t('android.onboarding.notificationDenied')}</p>
              )}
              <div className="android-onboarding-actions">
                {notificationDenied && (
                  <button type="button" disabled={busy} onClick={() => void run(host.requestNotifications)}>
                    {t('android.onboarding.retryNotifications')}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void run(host.openOverlaySettings)}>
                  {t('android.onboarding.openOverlaySettings')}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p aria-live="polite">
            {capabilities.petVisible
              ? t('android.onboarding.statusVisible')
              : capabilities.serviceActive
                ? t('android.onboarding.statusHidden')
                : t('android.onboarding.statusStarting')}
          </p>
          <p>{t('android.onboarding.settingsClose')}</p>
          {notificationDenied && (
            <div className="android-notification-retry">
              <p>{t('android.onboarding.notificationDenied')}</p>
              <button type="button" disabled={busy} onClick={() => void run(host.requestNotifications)}>
                {t('android.onboarding.retryNotifications')}
              </button>
            </div>
          )}
          <div className="android-onboarding-actions android-service-actions">
            {capabilities.petVisible ? (
              <button type="button" disabled={busy} onClick={() => void run(host.hidePet)}>
                {t('android.onboarding.hidePet')}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void run(host.showPet)}>
                {t('android.onboarding.showPet')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                autoStartAllowed.current = false;
                void run(host.quit);
              }}
            >
              {t('android.onboarding.quit')}
            </button>
          </div>
        </>
      )}
      <p className="android-background-note">{t('android.onboarding.background')}</p>
      {failed && <p role="alert">{t('android.onboarding.error')}</p>}
    </div>
  );
}
