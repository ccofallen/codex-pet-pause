import type { AppProviderLifecycle } from './AppProvider';

export type RendererView = 'app' | 'desktop' | 'settings';

export interface RendererRole {
  view: RendererView;
  lifecycle: AppProviderLifecycle;
}

export function deriveRendererRole(
  search: string,
  desktopShellAvailable: boolean,
): RendererRole {
  const query = new URLSearchParams(search);
  const desktop = query.get('mode') === 'desktop';
  const settings = query.get('mode') === 'settings' || query.get('hidePet') === '1';
  const view = desktop ? 'desktop' : settings ? 'settings' : 'app';
  return {
    view,
    lifecycle: desktopShellAvailable && view === 'settings' ? 'passive' : 'authoritative',
  };
}
