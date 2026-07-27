import { memo } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { InteractiveCatStage } from '../features/cat/components/InteractiveCatStage';
import { CodexPetStage } from '../features/pets/components/CodexPetStage';
import { useAppSnapshot } from './AppProvider';

export const DesktopApp = memo(function DesktopApp() {
  const snapshot = useAppSnapshot();
  const activeImportedPet = snapshot.pets.find(({ id }) => id === snapshot.settings.activePetId);

  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <ThemeProvider mode={snapshot.settings.theme}>
        <div className="desktop-pet-root">
          {activeImportedPet === undefined
            ? <InteractiveCatStage key={`builtin:${snapshot.settings.activePetId}`} />
            : <CodexPetStage key={`imported:${activeImportedPet.id}`} pet={activeImportedPet} />}
        </div>
      </ThemeProvider>
    </I18nProvider>
  );
});
