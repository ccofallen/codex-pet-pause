import { useMemo, useState } from 'react';
import { useAppSnapshot } from '../../app/AppProvider';
import { InsightsPanel } from '../../features/insights/InsightsPanel';
import { PetLibrary } from '../../features/pets/components/PetLibrary';
import { Dashboard } from '../../features/reminders/components/Dashboard';
import { SettingsPage } from '../../features/settings/SettingsPage';
import { useI18n } from '../../i18n/I18nProvider';
import type { AndroidControlHost } from '../bridge/androidHost';
import { AndroidCapabilityStatus } from './AndroidCapabilityStatus';
import { createAndroidPetImport } from '../infrastructure/androidPetImport';

type AndroidView = 'companion' | 'reminders' | 'pet' | 'settings';

const navigation: readonly { view: AndroidView; label: 'nav.companion' | 'nav.reminders' | 'nav.pet' | 'nav.settings' }[] = [
  { view: 'companion', label: 'nav.companion' },
  { view: 'reminders', label: 'nav.reminders' },
  { view: 'pet', label: 'nav.pet' },
  { view: 'settings', label: 'nav.settings' },
];

export function AndroidApp({ host }: { host?: AndroidControlHost }) {
  const { t } = useI18n();
  const snapshot = useAppSnapshot();
  const [view, setView] = useState<AndroidView>('settings');
  const petImport = useMemo(() => host === undefined
    ? undefined
    : createAndroidPetImport(host), [host]);

  if (!snapshot.ready) {
    return (
      <div data-app-host="android" className="android-app-shell">
        <main data-testid="android-loading" className="android-scroll-content android-loading" aria-busy="true">
          <p>{t('app.loading')}</p>
        </main>
      </div>
    );
  }

  const settingsFormId = view === 'settings'
    ? 'android-settings-form'
    : view === 'reminders'
      ? 'android-reminders-form'
      : undefined;

  const renderView = () => {
    switch (view) {
      case 'companion': return <><Dashboard /><InsightsPanel /></>;
      case 'reminders': return <SettingsPage section="reminders" formId="android-reminders-form" />;
      case 'pet': return <PetLibrary {...(petImport === undefined ? {} : { androidImport: petImport })} />;
      case 'settings': return <SettingsPage section="general" formId="android-settings-form" />;
    }
  };

  return (
    <div
      data-app-host="android"
      data-has-thumb-actions={settingsFormId !== undefined}
      className="android-app-shell"
    >
      <main id="android-main-content" className="android-scroll-content">
        <AndroidCapabilityStatus host={host} />
        {renderView()}
      </main>
      <div
        data-testid="android-thumb-actions"
        className="android-thumb-actions"
        hidden={settingsFormId === undefined}
      >
        {settingsFormId !== undefined && (
          <button type="submit" form={settingsFormId}>{t('android.action.saveSettings')}</button>
        )}
      </div>
      <nav className="android-bottom-navigation" aria-label={t('android.navigation')}>
        {navigation.map(({ view: nextView, label }) => (
          <button
            key={nextView}
            type="button"
            aria-current={view === nextView ? 'page' : undefined}
            onClick={() => setView(nextView)}
          >
            {t(label)}
          </button>
        ))}
      </nav>
    </div>
  );
}
