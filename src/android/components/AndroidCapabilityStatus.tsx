import { useI18n } from '../../i18n/I18nProvider';

export function AndroidCapabilityStatus() {
  const { t } = useI18n();

  return (
    <section className="android-capability-status" aria-labelledby="android-capability-heading">
      <h2 id="android-capability-heading">{t('android.capability.heading')}</h2>
      <p>{t('android.capability.storage')}</p>
      <p>{t('android.capability.reminders')}</p>
    </section>
  );
}
