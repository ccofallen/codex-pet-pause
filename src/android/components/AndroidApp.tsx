import { useState } from 'react';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import { InsightsPanel } from '../../features/insights/InsightsPanel';
import { PetLibrary } from '../../features/pets/components/PetLibrary';
import { Dashboard } from '../../features/reminders/components/Dashboard';
import { SettingsPage } from '../../features/settings/SettingsPage';
import { useI18n } from '../../i18n/I18nProvider';
import { AndroidCapabilityStatus } from './AndroidCapabilityStatus';

type AndroidView = 'companion' | 'reminders' | 'pet' | 'settings';

const navigation: readonly { view: AndroidView; label: 'nav.companion' | 'nav.reminders' | 'nav.pet' | 'nav.settings' }[] = [
  { view: 'companion', label: 'nav.companion' },
  { view: 'reminders', label: 'nav.reminders' },
  { view: 'pet', label: 'nav.pet' },
  { view: 'settings', label: 'nav.settings' },
];

export function AndroidApp() {
  const { t } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const [view, setView] = useState<AndroidView>('settings');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const saveSettings = async (): Promise<void> => {
    if (saveState === 'saving') return;
    setSaveState('saving');
    try {
      await controller.saveSettings(snapshot.settings);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  };

  const openPetdex = (): void => {
    window.open('https://petdex.dev/', '_blank', 'noopener,noreferrer');
  };

  const renderView = () => {
    switch (view) {
      case 'companion': return <><Dashboard /><InsightsPanel /></>;
      case 'reminders': return <SettingsPage section="reminders" />;
      case 'pet': return <PetLibrary />;
      case 'settings': return <SettingsPage section="general" />;
    }
  };

  return (
    <div data-app-host="android" className="android-app-shell">
      <main id="android-main-content" className="android-scroll-content">
        <AndroidCapabilityStatus />
        {renderView()}
      </main>
      <div data-testid="android-thumb-actions" className="android-thumb-actions" aria-live="polite">
        {(view === 'settings' || view === 'reminders') && (
          <button type="button" onClick={() => void saveSettings()} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? t('android.action.savingSettings') : t('android.action.saveSettings')}
          </button>
        )}
        {(view === 'settings' || view === 'pet') && (
          <button type="button" onClick={openPetdex}>{t('pet.import.petdexAction')}</button>
        )}
        {saveState === 'saved' && <p role="status">{t('android.action.settingsSaved')}</p>}
        {saveState === 'failed' && <p role="status">{t('android.action.settingsSaveFailed')}</p>}
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
