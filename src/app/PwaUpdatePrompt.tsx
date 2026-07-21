import { useSyncExternalStore } from 'react';
import { pwaStatus, type PwaStatusStore } from '../infrastructure/pwaStatus';
import { useI18n } from '../i18n/I18nProvider';

interface PwaUpdatePromptProps {
  store?: PwaStatusStore;
}

export function PwaUpdatePrompt({ store = pwaStatus }: PwaUpdatePromptProps) {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (!snapshot.updateAvailable) return null;

  const errorMessageKey = {
    'update-unavailable': 'pwa.error.updateUnavailable',
    'update-failed': 'pwa.error.updateFailed',
    'registration-unavailable': 'pwa.error.registrationUnavailable',
  } as const;
  const updateError = snapshot.updateError === undefined ? undefined : t(errorMessageKey[snapshot.updateError]);

  return (
    <aside className="pwa-update-prompt" role="status" aria-label={t('pwa.update.ariaLabel')}>
      <strong>{t('pwa.update.available')}</strong>
      {updateError !== undefined && <p role="alert">{updateError}</p>}
      <div className="button-row">
        <button type="button" disabled={snapshot.updating} onClick={() => void store.applyUpdate()}>
          {snapshot.updating ? t('pwa.update.updating') : t('pwa.update.action')}
        </button>
        <button type="button" disabled={snapshot.updating} onClick={() => store.dismissUpdate()}>{t('pwa.update.later')}</button>
      </div>
    </aside>
  );
}
