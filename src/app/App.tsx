import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AppShell } from './AppShell';
import { useAppSnapshot } from './AppProvider';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';

function LoadingApp() {
  const { t } = useI18n();
  return <main aria-busy="true"><p>{t('app.loading')}</p></main>;
}

export function App() {
  const snapshot = useAppSnapshot();
  if (!snapshot.ready) {
    return <I18nProvider locale={snapshot.settings.locale}><LoadingApp /></I18nProvider>;
  }

  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <ThemeProvider mode={snapshot.settings.theme}>
        {snapshot.settings.onboardingComplete ? <AppShell /> : <OnboardingFlow />}
      </ThemeProvider>
    </I18nProvider>
  );
}
