import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { AndroidApp } from './AndroidApp';
import { I18nProvider } from '../../i18n/I18nProvider';
import { createFakeDependencies } from '../../test/fakes';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidCapabilities, AndroidControlHost } from '../bridge/androidHost';
import { parseCodexPetImport } from '../../features/pets/domain/importPet';

vi.mock('../../features/pets/domain/importPet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/pets/domain/importPet')>()),
  parseCodexPetImport: vi.fn(async () => ({
    id: 'review-pet', displayName: 'Review Pet', spriteVersion: 2 as const,
    spritesheetFilename: 'review-pet.webp', spritesheet: new Blob(['webp'], { type: 'image/webp' }),
    importedAt: 10, updatedAt: 20,
  })),
}));

vi.mock('../../features/pets/domain/importPetArchive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/pets/domain/importPetArchive')>()),
  extractCodexPetArchive: vi.fn(async () => ({
    manifestFile: new File(['{}'], 'pet.json', { type: 'application/json' }),
    spritesheetFile: new File(['webp'], 'review-pet.webp', { type: 'image/webp' }),
  })),
}));

function deferredValue<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function reviewPet() {
  return {
    id: 'review-pet', displayName: 'Review Pet', spriteVersion: 2 as const,
    spritesheetFilename: 'review-pet.webp', spritesheet: new Blob(['webp'], { type: 'image/webp' }),
    importedAt: 10, updatedAt: 20,
  };
}

function renderAndroidApp(locale: 'zh-CN' | 'en' = 'zh-CN') {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  return render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><AndroidApp /></I18nProvider>
    </AppProvider>,
  );
}

function deniedControlHost(): AndroidControlHost {
  const capabilities: AndroidCapabilities = {
    apiLevel: 35,
    overlayPermission: 'denied',
    notificationPermission: 'deniedCanAsk',
    serviceActive: false,
    petVisible: false,
  };
  return {
    loadSnapshot: async () => null,
    loadRuntimeSnapshot: async () => null,
    clearSettings: async () => undefined,
    replaceHistory: async () => undefined,
    clearHistory: async () => undefined,
    clearPets: async () => undefined,
    saveSettings: async () => undefined,
    appendHistory: async () => undefined,
    pruneHistory: async () => undefined,
    savePet: async () => undefined,
    deletePet: async () => undefined,
    selectPet: async () => undefined,
    openPetdex: async () => undefined,
    pickPetFiles: async () => ({ status: 'cancelled', files: [] }),
    consumePendingArchive: async () => { throw new Error('no pending archive'); },
    completePendingArchive: async () => undefined,
    persistValidatedPet: async () => undefined,
    subscribePetArchives: () => () => undefined,
    subscribe: () => () => undefined,
    getCapabilities: async () => capabilities,
    requestNotifications: async () => capabilities,
    openNotificationSettings: async () => capabilities,
    openOverlaySettings: async () => capabilities,
    startService: async () => capabilities,
    showPet: async () => capabilities,
    hidePet: async () => capabilities,
    quit: async () => capabilities,
    subscribeCapabilities: () => () => undefined,
  };
}

function runningControlHost(): AndroidControlHost {
  const host = deniedControlHost();
  const capabilities: AndroidCapabilities = {
    apiLevel: 35,
    overlayPermission: 'granted',
    notificationPermission: 'granted',
    serviceActive: true,
    petVisible: true,
  };
  host.getCapabilities = async () => capabilities;
  return host;
}

test('keeps only settings saves in the thumb region and Petdex inside the pet surface', async () => {
  renderAndroidApp();

  const actions = await screen.findByTestId('android-thumb-actions');
  expect(within(actions).getByRole('button', { name: '保存设置' })).toBeVisible();
  expect(within(actions).queryByRole('button', { name: '浏览 Petdex 并自动导入' }))
    .not.toBeInTheDocument();
});

test('routes the Petdex action through the native host from the Android pet surface', async () => {
  const user = userEvent.setup();
  const host = deniedControlHost();
  const openPetdex = vi.spyOn(host, 'openPetdex');
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  await user.click(await screen.findByRole('button', { name: '宠物' }));
  await user.click(screen.getByRole('button', { name: '浏览 Petdex 并自动导入' }));

  expect(openPetdex).toHaveBeenCalledOnce();
});

test('opens the pet surface when a Petdex archive arrives outside the pet view', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => {
    archiveListener = listener;
    return () => undefined;
  };
  const consumePendingArchive = vi.fn(async () => ({
    name: 'review-pet.zip', mimeType: 'application/zip' as const, base64: 'UEsDBA==',
  }));
  host.consumePendingArchive = consumePendingArchive;
  host.loadPetCatalog = async () => ({ revision: 1, activePetId: 'builtin-cat', pets: [] });
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: '保存应用设置' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => archiveListener?.({ type: 'pet-archive-ready', token: 'download-1' }));

  expect(await screen.findByRole('heading', { name: '宠物安全预览' })).toBeVisible();
  expect(consumePendingArchive).toHaveBeenCalledWith('download-1');
});

test('acknowledges a committed Petdex save once when navigation unmounts the pet page', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  let resolvePersist!: () => void;
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => {
    archiveListener = listener;
    return () => undefined;
  };
  host.consumePendingArchive = async () => ({
    name: 'review-pet.zip', mimeType: 'application/zip', base64: 'UEsDBA==',
  });
  host.loadPetCatalog = async () => ({ revision: 1, activePetId: 'builtin-cat', pets: [] });
  host.persistValidatedPet = vi.fn(() => new Promise<void>((resolve) => { resolvePersist = resolve; }));
  const completePendingArchive = vi.fn(async () => undefined);
  host.completePendingArchive = completePendingArchive;
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => archiveListener?.({ type: 'pet-archive-ready', token: 'download-save' }));
  await user.click(await screen.findByRole('button', { name: 'Save and use this pet' }));
  await waitFor(() => expect(host.persistValidatedPet).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await act(async () => { resolvePersist(); });

  await waitFor(() => expect(completePendingArchive).toHaveBeenCalledOnce());
  expect(completePendingArchive).toHaveBeenCalledWith('download-save', 'imported');
});

test('keeps a committed import closed and acknowledged when its catalog refresh fails', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => {
    archiveListener = listener;
    return () => undefined;
  };
  host.consumePendingArchive = async () => ({
    name: 'review-pet.zip', mimeType: 'application/zip', base64: 'UEsDBA==',
  });
  host.persistValidatedPet = vi.fn(async () => undefined);
  const completePendingArchive = vi.fn(async () => undefined);
  host.completePendingArchive = completePendingArchive;
  host.loadPetCatalog = vi.fn()
    .mockResolvedValueOnce({ revision: 1, activePetId: 'builtin-cat', pets: [] })
    .mockRejectedValueOnce(new Error('refresh failed'))
    .mockResolvedValueOnce({
      revision: 2,
      activePetId: 'review-pet',
      pets: [{
        id: 'review-pet',
        metadataJson: '{"id":"review-pet","displayName":"Review Pet","spriteVersion":2,"spritesheetFilename":"review-pet.webp","importedAt":10,"updatedAt":20}',
        assetRevision: '0123456789abcdef0123456789abcdef',
        thumbnailBase64: null,
      }],
    });
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => archiveListener?.({ type: 'pet-archive-ready', token: 'download-refresh' }));
  await user.click(await screen.findByRole('button', { name: 'Save and use this pet' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Current pet changed');
  expect(screen.queryByRole('heading', { name: 'Pet security preview' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load the pet library');
  expect(completePendingArchive).toHaveBeenCalledWith('download-refresh', 'imported');

  await user.click(screen.getByRole('button', { name: 'Retry pet library' }));
  expect(await screen.findByLabelText('Review Pet (current)')).toBeInTheDocument();
});

test('prevents a released page with deferred consume work from terminating the remounted claim', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const oldConsume = deferredValue<{ name: string; mimeType: 'application/zip'; base64: string }>();
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => { archiveListener = listener; return () => undefined; };
  host.consumePendingArchive = vi.fn()
    .mockImplementationOnce(() => oldConsume.promise)
    .mockResolvedValueOnce({ name: 'review-pet.zip', mimeType: 'application/zip', base64: 'UEsDBA==' });
  host.completePendingArchive = vi.fn(async () => undefined);
  host.loadPetCatalog = async () => ({ revision: 1, activePetId: 'builtin-cat', pets: [] });
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => archiveListener?.({ type: 'pet-archive-ready', token: 'consume-race' }));
  await waitFor(() => expect(host.consumePendingArchive).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Pet' }));
  expect(await screen.findByRole('heading', { name: 'Pet security preview' })).toBeVisible();
  await act(async () => { oldConsume.resolve({
    name: 'review-pet.zip', mimeType: 'application/zip', base64: 'UEsDBA==',
  }); });

  expect(host.consumePendingArchive).toHaveBeenCalledTimes(2);
  expect(host.completePendingArchive).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Pet security preview' })).toBeVisible();
});

test('prevents deferred parsing from a released page from acknowledging the remounted claim', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const oldParse = deferredValue<ReturnType<typeof reviewPet>>();
  vi.mocked(parseCodexPetImport).mockReset()
    .mockImplementationOnce(() => oldParse.promise)
    .mockResolvedValueOnce(reviewPet());
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => { archiveListener = listener; return () => undefined; };
  host.consumePendingArchive = vi.fn(async () => ({
    name: 'review-pet.zip', mimeType: 'application/zip' as const, base64: 'UEsDBA==',
  }));
  host.completePendingArchive = vi.fn(async () => undefined);
  host.loadPetCatalog = async () => ({ revision: 1, activePetId: 'builtin-cat', pets: [] });
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => archiveListener?.({ type: 'pet-archive-ready', token: 'parse-race' }));
  await waitFor(() => expect(parseCodexPetImport).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Pet' }));
  expect(await screen.findByRole('heading', { name: 'Pet security preview' })).toBeVisible();
  await act(async () => { oldParse.resolve(reviewPet()); });

  expect(parseCodexPetImport).toHaveBeenCalledTimes(2);
  expect(host.completePendingArchive).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Pet security preview' })).toBeVisible();
  vi.mocked(parseCodexPetImport).mockResolvedValue(reviewPet());
});

test('keeps import actions disabled when completing one archive advances to the queued token', async () => {
  let archiveListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const secondConsume = deferredValue<{ name: string; mimeType: 'application/zip'; base64: string }>();
  const host = deniedControlHost();
  host.subscribePetArchives = (listener) => { archiveListener = listener; return () => undefined; };
  host.consumePendingArchive = vi.fn()
    .mockResolvedValueOnce({ name: 'first.zip', mimeType: 'application/zip', base64: 'UEsDBA==' })
    .mockImplementationOnce(() => secondConsume.promise);
  host.completePendingArchive = vi.fn(async () => undefined);
  host.loadPetCatalog = async () => ({ revision: 1, activePetId: 'builtin-cat', pets: [] });
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  await waitFor(() => expect(archiveListener).toBeTypeOf('function'));
  act(() => {
    archiveListener?.({ type: 'pet-archive-ready', token: 'queued-1' });
    archiveListener?.({ type: 'pet-archive-ready', token: 'queued-2' });
  });
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(host.consumePendingArchive).toHaveBeenCalledTimes(2));

  expect(screen.getAllByTestId('android-pet-import-action')
    .every((button) => button.hasAttribute('disabled'))).toBe(true);
});

test('does not render an embedded second pet in Android settings', async () => {
  renderAndroidApp();

  await screen.findByRole('button', { name: '保存应用设置' });

  expect(screen.queryByTestId('interactive-cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
});

test('localizes Android navigation without capability copy in English', async () => {
  renderAndroidApp('en');

  expect(await screen.findByRole('navigation', { name: 'Phone navigation' })).toBeVisible();
  expect(screen.queryByText('Settings and pets are stored securely on this phone.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Browse Petdex and import automatically' }))
    .not.toBeInTheDocument();
});

test('keeps settings navigation and retry available when overlay permission is refused', async () => {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp host={deniedControlHost()} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('navigation', { name: '手机导航' })).toBeVisible();
  expect(screen.getByRole('button', { name: '重新授权' })).toBeVisible();
});

test('waits for native hydration before mounting settings drafts', async () => {
  const persisted = createDefaultSettings(0);
  persisted.theme = 'dark';
  const dependencies = createFakeDependencies({ now: 0 });
  let resolveLoad!: (settings: typeof persisted) => void;
  dependencies.settings.load = () => new Promise<typeof persisted>((resolve) => { resolveLoad = resolve; });
  const controller = createAppController(dependencies);

  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp /></I18nProvider>
    </AppProvider>,
  );

  expect(screen.getByTestId('android-loading')).toBeVisible();
  expect(screen.queryByRole('button', { name: '保存应用设置' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('android-thumb-actions')).not.toBeInTheDocument();

  await act(async () => { resolveLoad(persisted); });

  expect(await screen.findByRole('button', { name: '保存应用设置' })).toBeVisible();
  expect(screen.getByLabelText('夜间')).toBeChecked();
  expect(dependencies.settings.saves).not.toHaveLength(0);
  expect(dependencies.settings.saves.every((settings) => settings.theme === 'dark')).toBe(true);
});

test('submits the visible Android settings form from the thumb action region', async () => {
  const user = userEvent.setup();
  const dependencies = createFakeDependencies({ now: 0 });
  const controller = createAppController(dependencies);
  const saveSettings = vi.spyOn(controller, 'saveSettings');
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp /></I18nProvider>
    </AppProvider>,
  );

  await screen.findByRole('button', { name: '保存应用设置' });
  await user.click(screen.getByLabelText('夜间'));
  const action = within(screen.getByTestId('android-thumb-actions'))
    .getByRole('button', { name: '保存设置' });
  expect(action).toHaveAttribute('type', 'submit');
  expect(action).toHaveAttribute('form', 'android-settings-form');
  await user.click(action);

  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })));
});

test('hides the save action when the active Android view has no settings form', async () => {
  const user = userEvent.setup();
  renderAndroidApp();

  await screen.findByRole('button', { name: '保存应用设置' });
  await user.click(screen.getByRole('button', { name: '宠物' }));

  expect(within(screen.getByTestId('android-thumb-actions'))
    .queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
});

test('owns catalog loading and thumbnail URLs only while the Android pet view is mounted', async () => {
  const user = userEvent.setup();
  const host = deniedControlHost();
  const loadPetCatalog = vi.fn(async () => ({
    revision: 1,
    activePetId: 'momo',
    pets: [{
      id: 'momo',
      metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
      assetRevision: '0123456789abcdef0123456789abcdef',
      thumbnailBase64: 'dGlueQ==',
    }],
  }));
  host.loadPetCatalog = loadPetCatalog;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:momo');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en"><AndroidApp host={host} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('button', { name: 'Save settings' })).toBeVisible();
  expect(loadPetCatalog).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Pet' }));
  expect(await screen.findByTestId('android-pet-thumbnail')).toHaveAttribute('src', 'blob:momo');
  expect(loadPetCatalog).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:momo');
});

test('reserves the complete fixed Android action region without a magic-height shortcut', () => {
  const styles = readFileSync('src/styles/android.css', 'utf8');

  expect(styles).toContain('--android-fixed-region-reserve');
  expect(styles).toContain('var(--android-fixed-region-reserve)');
  expect(styles).toContain('--android-thumb-status-height');
  expect(styles).not.toContain('5.75rem');
});

test('routes the companion tab to the concise Android-only surface', async () => {
  const user = userEvent.setup();
  renderAndroidApp('en');

  await user.click(await screen.findByRole('button', { name: 'Companion' }));

  expect(screen.getByTestId('android-companion')).toBeVisible();
  expect(screen.queryByLabelText("Today's completed activities by category")).not.toBeInTheDocument();
});

test.each([
  ['zh-CN', '隐藏宠物', '退出应用'],
  ['en', 'Hide pet', 'Quit app'],
] as const)('mounts only the compact authorized controls in %s', async (locale, petControl, quitControl) => {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><AndroidApp host={runningControlHost()} /></I18nProvider>
    </AppProvider>,
  );

  const petButton = await screen.findByRole('button', { name: petControl });
  const status = petButton.closest<HTMLElement>('.android-capability-status');

  expect(within(status!).getAllByRole('button')).toHaveLength(2);
  expect(within(status!).getByRole('button', { name: quitControl })).toBeVisible();
  expect(status!.querySelectorAll('p, h2, h3')).toHaveLength(0);
});

test('keeps the authorized Android controls compact and two-column at narrow phone widths', () => {
  const styles = readFileSync('src/styles/android.css', 'utf8');

  expect(styles).toMatch(/\.android-capability-status\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  expect(styles).toMatch(/\.android-onboarding--ready\s*\{[^}]*margin-top:\s*0;[^}]*padding-top:\s*0;[^}]*border-top:\s*0;/s);
  expect(styles).toMatch(/\.android-onboarding--ready\s+\.android-service-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  expect(styles).toMatch(/\.android-onboarding--ready\s+\.android-service-actions\s+button\s*\{[^}]*min-height:\s*48px;/s);
  expect(styles).toContain('.android-onboarding-actions:not(.android-service-actions) { grid-template-columns: minmax(0, 1fr); }');
});
