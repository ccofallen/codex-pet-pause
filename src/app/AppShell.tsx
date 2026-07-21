import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppSnapshot } from './AppProvider';
import { Dashboard } from '../features/reminders/components/Dashboard';
import { InteractiveCatStage } from '../features/cat/components/InteractiveCatStage';
import { PetLibrary } from '../features/pets/components/PetLibrary';
import { CodexPetStage } from '../features/pets/components/CodexPetStage';
import { InsightsPanel } from '../features/insights/InsightsPanel';
import { SettingsPage } from '../features/settings/SettingsPage';
import { pwaStatus } from '../infrastructure/pwaStatus';
import { CapabilityStatus } from './CapabilityStatus';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { useI18n } from '../i18n/I18nProvider';

type AppView = 'companion' | 'reminders' | 'pet' | 'settings';

export function AppShell() {
  const { t } = useI18n();
  const [activeView, setActiveView] = useState<AppView>('companion');
  const snapshot = useAppSnapshot();
  const pwaSnapshot = useSyncExternalStore(pwaStatus.subscribe, pwaStatus.getSnapshot, pwaStatus.getSnapshot);
  const enabledReminderCount = snapshot.settings.reminders.filter((reminder) => reminder.enabled).length;
  const activeImportedPet = snapshot.pets.find(({ id }) => id === snapshot.settings.activePetId);
  const navigationItems: ReadonlyArray<{ key: AppView; label: string }> = [
    { key: 'companion', label: t('nav.companion') },
    { key: 'reminders', label: t('nav.reminders') },
    { key: 'pet', label: t('nav.pet') },
    { key: 'settings', label: t('nav.settings') },
  ];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeView]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('shell.skipToMain')}</a>
      <header className="app-status">
        <strong>Codex Pet Pause</strong>
        <span>{t('shell.enabledCount', { count: enabledReminderCount })}</span>
      </header>
      <main id="main-content" tabIndex={-1}>
        {activeView === 'companion' && (
          <div className="companion-view">
            <Dashboard />
            <InsightsPanel />
          </div>
        )}
        {activeView === 'reminders' && <SettingsPage section="reminders" />}
        {activeView === 'pet' && (
          <section aria-labelledby="pet-heading">
            <h1 id="pet-heading">{t('shell.petLibrary')}</h1>
            <PetLibrary />
          </section>
        )}
        {activeView === 'settings' && <SettingsPage section="general" />}
      </main>
      <CapabilityStatus
        notificationStatus={snapshot.notificationStatus}
        storageMode={snapshot.storageMode}
        offlineReady={pwaSnapshot.offlineReady}
      />
      <PwaUpdatePrompt />
      {activeImportedPet === undefined
        ? <InteractiveCatStage key={`builtin:${snapshot.settings.activePetId}`} />
        : <CodexPetStage key={`imported:${activeImportedPet.id}`} pet={activeImportedPet} />}
      <nav className="primary-navigation" aria-label={t('nav.primary')}>
        {navigationItems.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-current={activeView === key ? 'page' : undefined}
            onClick={() => setActiveView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
