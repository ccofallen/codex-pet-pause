import { useSyncExternalStore } from 'react';
import type { NotificationStatus } from './model';
import { pwaStatus } from '../infrastructure/pwaStatus';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  notificationStatus: NotificationStatus;
  storageMode: 'persistent' | 'temporary';
  offlineReady: boolean;
  desktopShellAvailable: boolean;
}

function subscribeToVisibility(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

function getVisibility(): DocumentVisibilityState {
  return typeof document === 'undefined' ? 'visible' : document.visibilityState;
}

export function CapabilityStatus({ notificationStatus, storageMode, offlineReady, desktopShellAvailable }: Props) {
  const { t } = useI18n();
  const visibility = useSyncExternalStore(subscribeToVisibility, getVisibility, () => 'visible');
  const pwaSnapshot = useSyncExternalStore(pwaStatus.subscribe, pwaStatus.getSnapshot, pwaStatus.getSnapshot);
  const offlineRegistrationFailed = !offlineReady && pwaSnapshot.registrationError !== undefined;
  const notificationWarning = notificationStatus === 'denied'
    ? t('capability.notification.denied')
    : notificationStatus === 'unavailable'
      ? t('capability.notification.unavailable')
      : undefined;

  return (
    <aside className="capability-status" aria-label={t('capability.ariaLabel')}>
      {notificationWarning !== undefined && <p>{notificationWarning}</p>}
      {storageMode === 'temporary' && <p>{t('capability.storage.temporary')}</p>}
      {!desktopShellAvailable && !offlineReady && (
        <p>{offlineRegistrationFailed ? t('pwa.error.registrationUnavailable') : t('capability.offline.preparing')}</p>
      )}
      {!desktopShellAvailable && (
        <p>{visibility === 'hidden' ? t('capability.visibility.hidden') : t('capability.visibility.visible')}</p>
      )}
      <p>{t(desktopShellAvailable ? 'capability.desktopBackground' : 'capability.closedWarning')}</p>
    </aside>
  );
}
