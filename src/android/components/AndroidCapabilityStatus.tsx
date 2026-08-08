import { useI18n } from '../../i18n/I18nProvider';
import type { AndroidControlHost } from '../bridge/androidHost';
import { AndroidOnboarding } from './AndroidOnboarding';

export function AndroidCapabilityStatus({ host }: { host?: AndroidControlHost | undefined }) {
  const { t } = useI18n();

  return (
    <section className="android-capability-status" aria-labelledby="android-capability-heading">
      <h2 id="android-capability-heading">{t('android.capability.heading')}</h2>
      <p>{t('android.capability.storage')}</p>
      <p>{t('android.capability.reminders')}</p>
      {host !== undefined && <AndroidOnboarding host={host} />}
    </section>
  );
}
