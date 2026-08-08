import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { AppProvider } from '../../../app/AppProvider';
import { createAppController } from '../../../app/appController';
import { createDefaultSettings } from '../../../app/defaults';
import { createFakeDependencies } from '../../../test/fakes';
import { MURK_TEST_PET } from '../../../test/petFixtures';
import { BUILTIN_PET_ID, type StoredCodexPet } from '../domain/types';
import { PetLibrary } from './PetLibrary';
import { StoredPetPreview } from './StoredPetPreview';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Locale } from '../../../i18n/types';
import { PetImportError } from '../domain/importPet';
import type { CodexPetFilePair } from '../domain/importPetArchive';
import type { AndroidPetImport, AndroidPetImportEvent } from '../../../android/infrastructure/androidPetImport';

const manifestFile = new File([JSON.stringify({
  id: 'murk', displayName: 'Murk', spriteVersionNumber: 2,
  spritesheetPath: 'spritesheet.webp',
})], 'pet.json', { type: 'application/json' });
const atlasFile = new File(['atlas'], 'spritesheet.webp', { type: 'image/webp' });
const zipFile = new File(['zip'], 'murk.zip', { type: 'application/zip' });
const GLOBAL_CSS = readFileSync('src/styles/global.css', 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderLibrary(options: {
  pets?: StoredCodexPet[];
  activePetId?: string;
  parseImport?: () => Promise<StoredCodexPet>;
  extractArchive?: (archiveFile: File) => Promise<CodexPetFilePair>;
  strictMode?: boolean;
  locale?: Locale;
  androidImport?: AndroidPetImport;
} = {}) {
  const locale = options.locale ?? 'zh-CN';
  const settings = createDefaultSettings(123, locale);
  settings.activePetId = options.activePetId ?? BUILTIN_PET_ID;
  const deps = createFakeDependencies({ now: 123, settings });
  for (const pet of options.pets ?? []) deps.pets.values.set(pet.id, pet);
  const controller = createAppController(deps);
  await controller.hydrate();
  const parseImport = vi.fn(options.parseImport ?? (async () => MURK_TEST_PET));
  const extractArchive = vi.fn(options.extractArchive ?? (async () => ({
    manifestFile,
    spritesheetFile: atlasFile,
  })));
  const library = (currentLocale: Locale) => (
    <AppProvider controller={controller}>
      <I18nProvider locale={currentLocale}>
        <PetLibrary
          parseImport={parseImport}
          extractArchive={extractArchive}
          now={() => 123}
          {...(options.androidImport === undefined ? {} : { androidImport: options.androidImport })}
        />
      </I18nProvider>
    </AppProvider>
  );
  const view = library(locale);
  const result = render(options.strictMode ? <StrictMode>{view}</StrictMode> : view);
  return {
    ...result,
    controller,
    deps,
    parseImport,
    extractArchive,
    rerenderLocale: (nextLocale: Locale) => result.rerender(library(nextLocale)),
  };
}

function fakeAndroidImport(overrides: Partial<AndroidPetImport> = {}): AndroidPetImport {
  return {
    openPetdex: async () => undefined,
    pickFiles: async () => [],
    consumePendingArchive: async () => zipFile,
    completePendingArchive: async () => undefined,
    persistValidatedPet: async () => undefined,
    subscribe: () => () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.petShell;
});

test('previews and saves a valid pair only after confirmation', async () => {
  const user = userEvent.setup();
  const { controller } = await renderLibrary();

  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);

  const dialog = await screen.findByRole('dialog', { name: '导入宠物预览' });
  expect(dialog).toHaveTextContent('Murk');
  expect(within(dialog).queryByText(/Codex v[12]/)).not.toBeInTheDocument();
  expect(controller.getSnapshot().pets).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '保存到宠物库' }));
  expect(controller.getSnapshot().pets).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Murk 已保存到宠物库');
});

test('accepts an exact manifest and atlas pair by drag and drop', async () => {
  await renderLibrary();
  fireEvent.drop(screen.getByRole('button', { name: '拖放 Codex 宠物文件' }), {
    dataTransfer: { files: [manifestFile, atlasFile] },
  });
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' })).toHaveTextContent('Murk');
});

test('extracts one ZIP and opens the existing preview', async () => {
  const extractArchive = vi.fn(async () => ({
    manifestFile,
    spritesheetFile: atlasFile,
  }));
  const { parseImport } = await renderLibrary({ extractArchive });

  await userEvent.setup().upload(
    screen.getByLabelText('选择 Codex 宠物文件'),
    zipFile,
  );

  expect(extractArchive).toHaveBeenCalledWith(zipFile);
  expect(parseImport).toHaveBeenCalledWith(manifestFile, atlasFile, 123);
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' }))
    .toHaveTextContent('Murk');
});

test('opens Petdex in the desktop shell and previews an intercepted ZIP', async () => {
  let receiveImport!: (event:
    | { type: 'archive'; name: string; bytes: ArrayBuffer }
    | { type: 'error' }
  ) => void;
  const openPetdex = vi.fn(async () => undefined);
  window.petShell = {
    openPetdex,
    onPetdexImport: (callback) => {
      receiveImport = callback;
      return () => undefined;
    },
  };
  const { extractArchive } = await renderLibrary();

  const petdexButton = screen.getByRole('button', { name: '浏览 Petdex 并自动导入' });
  const manualImportButton = screen.getByRole('button', { name: '导入 Codex 宠物' });
  expect(petdexButton.parentElement).toBe(manualImportButton.parentElement);
  expect(petdexButton.parentElement).toHaveClass('pet-import-actions');
  expect(petdexButton.compareDocumentPosition(manualImportButton)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await userEvent.setup().click(petdexButton);
  expect(openPetdex).toHaveBeenCalledOnce();

  await act(async () => receiveImport({
    type: 'archive',
    name: 'murk.zip',
    bytes: new TextEncoder().encode('zip').buffer,
  }));

  expect(extractArchive).toHaveBeenCalledWith(expect.objectContaining({ name: 'murk.zip' }));
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' })).toHaveTextContent('Murk');
});

test('opens the Android security preview as soon as a Petdex download completes', async () => {
  let listener: ((event: AndroidPetImportEvent) => void) | undefined;
  const consumePendingArchive = vi.fn(async () => zipFile);
  await renderLibrary({
    androidImport: fakeAndroidImport({
      consumePendingArchive,
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    }),
  });

  await act(async () => listener?.({ type: 'pet-archive-ready', token: 'download-1' }));

  expect(consumePendingArchive).toHaveBeenCalledWith('download-1');
  expect(await screen.findByRole('dialog', { name: '宠物安全预览' })).toHaveTextContent('Murk');
});

test('keeps a claimed Petdex archive until preview cancellation explicitly advances the queue', async () => {
  let listener: ((event: AndroidPetImportEvent) => void) | undefined;
  const completePendingArchive = vi.fn(async () => undefined);
  await renderLibrary({
    androidImport: fakeAndroidImport({
      completePendingArchive,
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    }),
  });

  await act(async () => listener?.({ type: 'pet-archive-ready', token: 'download-1' }));
  expect(await screen.findByRole('dialog', { name: '宠物安全预览' })).toBeVisible();
  expect(completePendingArchive).not.toHaveBeenCalled();

  await userEvent.setup().click(screen.getByRole('button', { name: '取消' }));
  expect(completePendingArchive).toHaveBeenCalledWith('download-1', 'cancelled');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('acknowledges rejected Petdex validation and retries a failed native claim without deletion', async () => {
  let rejectedListener: ((event: AndroidPetImportEvent) => void) | undefined;
  const rejectedCompletion = vi.fn(async () => undefined);
  await renderLibrary({
    extractArchive: async () => { throw new Error('invalid archive'); },
    androidImport: fakeAndroidImport({
      completePendingArchive: rejectedCompletion,
      subscribe: (listener) => {
        rejectedListener = listener;
        return () => undefined;
      },
    }),
  });
  await act(async () => rejectedListener?.({ type: 'pet-archive-ready', token: 'bad-download' }));
  await waitFor(() => expect(rejectedCompletion).toHaveBeenCalledWith('bad-download', 'rejected'));

  cleanup();
  let retryListener: ((event: AndroidPetImportEvent) => void) | undefined;
  const retryCompletion = vi.fn(async () => undefined);
  await renderLibrary({
    androidImport: fakeAndroidImport({
      consumePendingArchive: async () => { throw new Error('temporary read failure'); },
      completePendingArchive: retryCompletion,
      subscribe: (listener) => {
        retryListener = listener;
        return () => undefined;
      },
    }),
  });
  await act(async () => retryListener?.({ type: 'pet-archive-ready', token: 'retry-download' }));
  await waitFor(() => expect(retryCompletion).toHaveBeenCalledWith('retry-download', 'retry'));
  expect(screen.getByRole('alert')).toHaveTextContent('无法从 Petdex 获取这个宠物，请重试');
});

test('closes a Petdex preview after committed activation and acknowledges it as imported', async () => {
  let listener: ((event: AndroidPetImportEvent) => void) | undefined;
  const persistValidatedPet = vi.fn(async () => undefined);
  const completePendingArchive = vi.fn(async () => undefined);
  await renderLibrary({
    androidImport: fakeAndroidImport({
      persistValidatedPet,
      completePendingArchive,
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    }),
  });
  await act(async () => listener?.({ type: 'pet-archive-ready', token: 'download-1' }));
  await screen.findByRole('dialog', { name: '宠物安全预览' });

  await userEvent.setup().click(screen.getByRole('button', { name: '保存并使用这个宠物' }));

  expect(persistValidatedPet).toHaveBeenCalledWith(MURK_TEST_PET);
  expect(completePendingArchive).toHaveBeenCalledWith('download-1', 'imported');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('当前宠物已切换');
});

test('places Android manual import below Petdex with equal full-width actions', async () => {
  await renderLibrary({ androidImport: fakeAndroidImport() });

  const buttons = screen.getAllByTestId('android-pet-import-action');
  expect(buttons.map((button) => button.textContent)).toEqual([
    '浏览 Petdex 并自动导入',
    '导入 Codex 宠物',
  ]);
  expect(buttons.every((button) => button.classList.contains('android-pet-import-action'))).toBe(true);
  expect(buttons[0]?.parentElement).toBe(buttons[1]?.parentElement);
  expect(buttons[0]?.parentElement).toHaveClass('android-pet-import-actions');
  expect(screen.queryByRole('button', { name: '拖放 Codex 宠物文件' })).not.toBeInTheDocument();
});

test('uses the Android system picker for the independent JSON and WebP workflow', async () => {
  const pickFiles = vi.fn(async () => [manifestFile, atlasFile]);
  await renderLibrary({ androidImport: fakeAndroidImport({ pickFiles }) });

  await userEvent.setup().click(screen.getByRole('button', { name: '导入 Codex 宠物' }));

  expect(pickFiles).toHaveBeenCalledOnce();
  expect(await screen.findByRole('dialog', { name: '宠物安全预览' })).toHaveTextContent('Murk');
});

test('keeps Android picker cancellation silent and leaves the active pet unchanged', async () => {
  const { controller } = await renderLibrary({ androidImport: fakeAndroidImport() });

  await userEvent.setup().click(screen.getByRole('button', { name: '导入 Codex 宠物' }));

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(controller.getSnapshot().settings.activePetId).toBe(BUILTIN_PET_ID);
});

test('requires Android preview confirmation before persisting and activating the pet', async () => {
  const persistValidatedPet = vi.fn(async () => undefined);
  await renderLibrary({
    androidImport: fakeAndroidImport({
      pickFiles: async () => [manifestFile, atlasFile],
      persistValidatedPet,
    }),
  });

  await userEvent.setup().click(screen.getByRole('button', { name: '导入 Codex 宠物' }));
  await screen.findByRole('dialog', { name: '宠物安全预览' });
  expect(persistValidatedPet).not.toHaveBeenCalled();

  await userEvent.setup().click(screen.getByRole('button', { name: '保存并使用这个宠物' }));
  expect(persistValidatedPet).toHaveBeenCalledWith(MURK_TEST_PET);
});

test('localizes an Android Petdex launch failure without exposing native details', async () => {
  await renderLibrary({
    locale: 'en',
    androidImport: fakeAndroidImport({
      openPetdex: async () => { throw new Error('private Android activity trace'); },
    }),
  });

  await userEvent.setup().click(screen.getByRole('button', {
    name: 'Browse Petdex and import automatically',
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not get this pet from Petdex. Try again.',
  );
  expect(screen.queryByText(/private Android activity trace/)).not.toBeInTheDocument();
});

test('accepts one ZIP by drag and drop', async () => {
  const extractArchive = vi.fn(async () => ({
    manifestFile,
    spritesheetFile: atlasFile,
  }));
  await renderLibrary({ extractArchive });
  fireEvent.drop(screen.getByRole('button', { name: '拖放 Codex 宠物文件' }), {
    dataTransfer: { files: [zipFile] },
  });
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' })).toBeVisible();
});

test('rejects mixed ZIP and loose files before extraction', async () => {
  const extractArchive = vi.fn();
  await renderLibrary({ extractArchive });
  fireEvent.change(screen.getByLabelText('选择 Codex 宠物文件'), {
    target: { files: [zipFile, manifestFile, atlasFile] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('不能同时选择 ZIP 和散装文件');
  expect(extractArchive).not.toHaveBeenCalled();
});

test('rejects more than one ZIP before extraction', async () => {
  const extractArchive = vi.fn();
  await renderLibrary({ extractArchive });
  fireEvent.change(screen.getByLabelText('选择 Codex 宠物文件'), {
    target: { files: [zipFile, new File(['zip'], 'luna.zip', { type: 'application/zip' })] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('每次只能选择一个 ZIP');
  expect(extractArchive).not.toHaveBeenCalled();
});

test('localizes an encrypted archive failure', async () => {
  await renderLibrary({
    locale: 'en',
    extractArchive: async () => {
      throw new PetImportError('archive-encrypted');
    },
  });
  await userEvent.setup().upload(screen.getByLabelText('Choose Codex pet files'), zipFile);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Encrypted ZIP files are not supported.',
  );
});

test('reports incomplete, duplicate, and invalid file pairs without parsing', async () => {
  const user = userEvent.setup();
  const { parseImport } = await renderLibrary();
  const input = screen.getByLabelText('选择 Codex 宠物文件');

  await user.upload(input, manifestFile);
  expect(screen.getByRole('alert')).toHaveTextContent('请选择一个 JSON 清单和一个 WebP 图集');
  await user.upload(input, [manifestFile, new File(['x'], 'other.json', { type: 'application/json' }), atlasFile]);
  expect(screen.getByRole('alert')).toHaveTextContent('只能选择一个 JSON 清单和一个 WebP 图集');
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'pet.txt', { type: 'text/plain' }), atlasFile] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('仅支持 .zip、.json 和 .webp 文件');
  expect(parseImport).not.toHaveBeenCalled();
});

test('shows parser validation messages and permits retry', async () => {
  const user = userEvent.setup();
  const parseImport = vi.fn()
    .mockRejectedValueOnce(new PetImportError('atlas-name-mismatch', {
      expectedFilename: 'spritesheet.webp',
    }))
    .mockResolvedValueOnce(MURK_TEST_PET);
  await renderLibrary({ parseImport });
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  await user.upload(input, [manifestFile, atlasFile]);
  expect(await screen.findByRole('alert')).toHaveTextContent('宠物图集文件名与清单不匹配');
  await user.upload(input, [manifestFile, atlasFile]);
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' })).toBeVisible();
});

test('uses a localized generic import failure without exposing unknown exception text', async () => {
  const user = userEvent.setup();
  await renderLibrary({ locale: 'en', parseImport: async () => { throw new Error('private codec trace'); } });
  await user.upload(screen.getByLabelText('Choose Codex pet files'), [manifestFile, atlasFile]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not import the pet files. Try again.');
  expect(screen.queryByText(/private codec trace/)).not.toBeInTheDocument();
});

test('a slow ZIP extraction cannot replace a newer loose-file preview', async () => {
  const user = userEvent.setup();
  const firstExtraction = deferred<CodexPetFilePair>();
  const parseImport = vi.fn()
    .mockResolvedValueOnce({ ...MURK_TEST_PET, id: 'luna', displayName: 'Luna' })
    .mockResolvedValueOnce(MURK_TEST_PET);
  const { extractArchive } = await renderLibrary({
    extractArchive: () => firstExtraction.promise,
    parseImport,
  });
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  await user.upload(input, zipFile);
  await user.upload(input, [manifestFile, atlasFile]);
  expect(await screen.findByRole('dialog', { name: '导入宠物预览' })).toHaveTextContent('Luna');
  await act(async () => firstExtraction.resolve({ manifestFile, spritesheetFile: atlasFile }));
  expect(screen.getByRole('dialog', { name: '导入宠物预览' })).toHaveTextContent('Luna');
  expect(screen.queryByText('Murk')).not.toBeInTheDocument();
  expect(extractArchive).toHaveBeenCalledOnce();
  expect(parseImport).toHaveBeenCalledOnce();
});

test('a slow ZIP extraction cannot replace a newer ZIP preview', async () => {
  const user = userEvent.setup();
  const firstExtraction = deferred<CodexPetFilePair>();
  const secondManifest = new File(['{}'], 'luna.json', { type: 'application/json' });
  const secondAtlas = new File(['atlas'], 'luna.webp', { type: 'image/webp' });
  const extractArchive = vi.fn()
    .mockReturnValueOnce(firstExtraction.promise)
    .mockResolvedValueOnce({ manifestFile: secondManifest, spritesheetFile: secondAtlas });
  const parseImport = vi.fn().mockResolvedValueOnce({
    ...MURK_TEST_PET,
    id: 'luna',
    displayName: 'Luna',
  });
  await renderLibrary({ extractArchive, parseImport });
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  await user.upload(input, zipFile);
  await user.upload(input, new File(['zip'], 'luna.zip', { type: 'application/zip' }));
  await screen.findByRole('dialog', { name: '导入宠物预览' });
  await act(async () => firstExtraction.resolve({ manifestFile, spritesheetFile: atlasFile }));
  expect(screen.getByRole('dialog', { name: '导入宠物预览' })).toHaveTextContent('Luna');
  expect(screen.queryByText('Murk')).not.toBeInTheDocument();
  expect(extractArchive).toHaveBeenCalledTimes(2);
  expect(parseImport).toHaveBeenCalledOnce();
});

test('cancel invalidates an import that is still decoding', async () => {
  const user = userEvent.setup();
  const pending = deferred<StoredCodexPet>();
  const parseImport = vi.fn()
    .mockResolvedValueOnce(MURK_TEST_PET)
    .mockReturnValueOnce(pending.promise);
  await renderLibrary({ parseImport });
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  await user.upload(input, [manifestFile, atlasFile]);
  await screen.findByRole('dialog', { name: '导入宠物预览' });
  await user.upload(input, [manifestFile, atlasFile]);
  await user.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => pending.resolve({ ...MURK_TEST_PET, id: 'luna', displayName: 'Luna' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('save invalidates an import that is still decoding', async () => {
  const user = userEvent.setup();
  const pending = deferred<StoredCodexPet>();
  const parseImport = vi.fn()
    .mockResolvedValueOnce(MURK_TEST_PET)
    .mockReturnValueOnce(pending.promise);
  const { controller } = await renderLibrary({ parseImport });
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  await user.upload(input, [manifestFile, atlasFile]);
  await screen.findByRole('dialog', { name: '导入宠物预览' });
  await user.upload(input, [manifestFile, atlasFile]);
  await user.click(screen.getByRole('button', { name: '保存到宠物库' }));
  expect(controller.getSnapshot().pets).toHaveLength(1);
  await act(async () => pending.resolve({ ...MURK_TEST_PET, id: 'luna', displayName: 'Luna' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('rejects a reserved built-in ID returned by an injected parser', async () => {
  const user = userEvent.setup();
  const { controller } = await renderLibrary({
    parseImport: async () => ({ ...MURK_TEST_PET, id: BUILTIN_PET_ID, displayName: 'Impostor' }),
  });
  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
  expect(await screen.findByRole('alert')).toHaveTextContent('宠物 ID “builtin-cat” 为系统保留 ID');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(controller.getSnapshot().pets).toHaveLength(0);
  expect(screen.queryByRole('article', { name: 'Impostor' })).not.toBeInTheDocument();
});

test('cancels a preview, restores focus to the import trigger, and saves nothing', async () => {
  const user = userEvent.setup();
  const { controller } = await renderLibrary();
  const trigger = screen.getByRole('button', { name: '导入 Codex 宠物' });
  await user.click(trigger);
  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
  await screen.findByRole('dialog', { name: '导入宠物预览' });
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(controller.getSnapshot().pets).toHaveLength(0);
});

test('requires an explicit same-ID update confirmation', async () => {
  const user = userEvent.setup();
  await renderLibrary({ pets: [MURK_TEST_PET] });
  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
  const dialog = await screen.findByRole('dialog', { name: '导入宠物预览' });
  expect(dialog).toHaveTextContent('将更新现有宠物');
  expect(within(dialog).getByRole('button', { name: '更新此宠物' })).toBeVisible();
  expect(within(dialog).queryByRole('button', { name: '保存到宠物库' })).not.toBeInTheDocument();
});

test('renders active cards, switches pets, and never offers deletion for the built-in pet', async () => {
  const user = userEvent.setup();
  const { controller } = await renderLibrary({ pets: [MURK_TEST_PET] });
  const builtIn = screen.getByRole('article', { name: 'Momo（当前）' });
  const murk = screen.getByRole('article', { name: 'Murk' });
  expect(within(builtIn).queryByText(/Codex v[12]/)).not.toBeInTheDocument();
  expect(within(builtIn).queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  expect(within(murk).getByText('Moon ghost')).toBeVisible();
  expect(within(murk).queryByText(/Codex v[12]/)).not.toBeInTheDocument();

  await user.click(within(murk).getByRole('button', { name: '使用 Murk' }));
  expect(controller.getSnapshot().settings.activePetId).toBe('murk');
  expect(screen.getByRole('article', { name: 'Murk（当前）' })).toBeVisible();
});

test('renders the complete empty import library in English and preserves imported text', async () => {
  const imported: StoredCodexPet = {
    ...MURK_TEST_PET,
    id: 'moon-shadow',
    displayName: '月影',
    description: '安静的伙伴',
  };
  await renderLibrary({ locale: 'en', pets: [imported] });

  expect(screen.getByRole('heading', { name: 'Import a Codex pet' })).toBeVisible();
  expect(screen.getByLabelText('Choose Codex pet files')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Drop Codex pet files' })).toHaveTextContent(
    'Drop one ZIP or the matching two files here, or press Enter to choose files',
  );
  expect(screen.getByRole('article', { name: '月影' })).toHaveTextContent('安静的伙伴');
  expect(screen.getByRole('button', { name: 'Use 月影' })).toHaveTextContent('Use this pet');
  expect(screen.queryByText(/Codex v[12]/)).not.toBeInTheDocument();
});

test('shows an English empty state when no imported pets are saved', async () => {
  await renderLibrary({ locale: 'en' });
  expect(screen.getByText('No imported pets yet.')).toBeVisible();
});

test('keeps an open import preview and focus across a locale rerender', async () => {
  const user = userEvent.setup();
  const imported = { ...MURK_TEST_PET, displayName: '月影', description: '安静的伙伴' };
  const { rerenderLocale } = await renderLibrary({ parseImport: async () => imported });
  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
  const cancel = await screen.findByRole('button', { name: '取消' });
  expect(cancel).toHaveFocus();

  rerenderLocale('en');

  const dialog = screen.getByRole('dialog', { name: 'Import pet preview' });
  expect(dialog).toHaveTextContent('月影');
  expect(dialog).toHaveTextContent('安静的伙伴');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancel);
  expect(cancel).toHaveFocus();
});

test('discloses neutral import help without activating file selection', async () => {
  const user = userEvent.setup();
  await renderLibrary();
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  const inputClick = vi.spyOn(input, 'click');
  const help = screen.getByRole('button', { name: '查看 Codex 宠物文件提示' });
  const importTrigger = screen.getByRole('button', { name: '导入 Codex 宠物' });

  expect(help).toHaveAttribute('aria-expanded', 'false');
  const disclosureId = help.getAttribute('aria-controls');
  expect(disclosureId).toBeTruthy();
  expect(document.getElementById(disclosureId!)).toBeInTheDocument();
  help.focus();
  await user.click(help);
  expect(inputClick).not.toHaveBeenCalled();
  expect(help).toHaveAttribute('aria-expanded', 'true');
  expect(help).toHaveFocus();
  const disclosure = screen.getByText(/下载的 Codex 宠物可能已经是 ZIP 文件/);
  expect(disclosure).toBeVisible();
  expect(disclosure).toHaveTextContent(
    '下载的 Codex 宠物可能已经是 ZIP 文件。散装文件通常位于 .codex/pets/<宠物名>/。请选择同一目录中的 pet.json 和 spritesheet.webp。也可以前往 Petdex 或其他提供 Codex 宠物资源的网站查找。',
  );
  const petdex = screen.getByRole('link', { name: 'Petdex' });
  expect(petdex).toHaveAttribute('href', 'https://petdex.dev/');
  expect(petdex).toHaveAttribute('target', '_blank');
  expect(petdex).toHaveAttribute('rel', 'noreferrer noopener');

  await user.click(help);
  expect(help).toHaveAttribute('aria-expanded', 'false');
  await user.click(help);
  await user.keyboard('{Escape}');
  expect(help).toHaveAttribute('aria-expanded', 'false');
  expect(help).toHaveFocus();

  await user.click(help);
  fireEvent.pointerDown(importTrigger);
  expect(help).toHaveAttribute('aria-expanded', 'false');
  expect(help).toHaveFocus();
  expect(inputClick).not.toHaveBeenCalled();
});

test('places import help after the device-save sentence', async () => {
  await renderLibrary();
  const help = screen.getByRole('button', { name: '查看 Codex 宠物文件提示' });
  const firstRow = screen.getByText(/确认预览后才会保存到这台设备/);
  const note = firstRow.parentElement;
  const disclosure = document.getElementById(help.getAttribute('aria-controls')!);

  expect(note).toHaveClass('pet-import-save-note');
  expect(firstRow).toHaveClass('pet-import-save-note-row');
  expect(firstRow).toContainElement(help);
  expect(disclosure).toHaveClass('pet-import-help-disclosure');
  expect(disclosure?.parentElement).toBe(note);
  expect(firstRow).not.toContainElement(disclosure);
  expect(screen.getByRole('heading', { name: '导入 Codex 宠物' }).parentElement).not.toContainElement(help);
});

test('keeps import help on a full next row at normal and narrow widths', () => {
  const saveNoteRule = GLOBAL_CSS.match(/\.pet-import-save-note\s*\{([^}]*)\}/s)?.[1] ?? '';
  const firstRowRule = GLOBAL_CSS.match(/\.pet-import-save-note-row\s*\{([^}]*)\}/s)?.[1] ?? '';
  const disclosureRule = GLOBAL_CSS.match(/\.pet-import-help-disclosure\s*\{([^}]*)\}/s)?.[1] ?? '';
  const hiddenDisclosureRule = GLOBAL_CSS.match(
    /\.pet-import-help-disclosure\[hidden\]\s*\{([^}]*)\}/s,
  )?.[1] ?? '';

  expect(saveNoteRule).toMatch(/display:\s*grid/);
  expect(firstRowRule).toMatch(/display:\s*flex/);
  expect(disclosureRule).toMatch(/display:\s*block/);
  expect(disclosureRule).toMatch(/width:\s*100%/);
  expect(hiddenDisclosureRule).toMatch(/display:\s*none/);
});

test('localizes import help and keeps it after the device-save sentence', async () => {
  const user = userEvent.setup();
  await renderLibrary({ locale: 'en' });
  const help = screen.getByRole('button', { name: 'More information about Codex pet files' });
  const sentence = screen.getByText(/saved on this device only after you confirm the preview/);
  expect(sentence).toContainElement(help);
  await user.click(help);
  expect(screen.getByText(/\.codex\/pets\/<pet-name>\//)).toHaveTextContent('petdex.dev or other sites');
});

test('restores help-button focus when Escape closes help from its link', async () => {
  const user = userEvent.setup();
  await renderLibrary();
  const help = screen.getByRole('button', { name: '查看 Codex 宠物文件提示' });

  await user.click(help);
  const petdex = screen.getByRole('link', { name: 'Petdex' });
  petdex.focus();
  expect(petdex).toHaveFocus();
  await user.keyboard('{Escape}');

  expect(help).toHaveAttribute('aria-expanded', 'false');
  expect(help).toHaveFocus();
});

test('closes import help when focus leaves it without stealing outside focus', async () => {
  const user = userEvent.setup();
  await renderLibrary();
  const help = screen.getByRole('button', { name: '查看 Codex 宠物文件提示' });
  const outside = screen.getByRole('button', { name: '导入 Codex 宠物' });

  await user.click(help);
  screen.getByRole('link', { name: 'Petdex' }).focus();
  act(() => outside.focus());

  expect(help).toHaveAttribute('aria-expanded', 'false');
  expect(outside).toHaveFocus();
});

test('gives each pet library a unique import-help disclosure relationship', async () => {
  await renderLibrary();
  await renderLibrary();
  const helps = screen.getAllByRole('button', { name: '查看 Codex 宠物文件提示' });
  const controlIds = helps.map((help) => help.getAttribute('aria-controls'));

  expect(controlIds.every(Boolean)).toBe(true);
  expect(new Set(controlIds).size).toBe(helps.length);
  for (const controlId of controlIds) {
    const matchingElements = Array.from(document.querySelectorAll<HTMLElement>('[id]'))
      .filter(({ id }) => id === controlId);
    expect(matchingElements).toHaveLength(1);
  }
});

test('cleans up outside-focus listeners under StrictMode', async () => {
  const user = userEvent.setup();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const { unmount } = await renderLibrary({ strictMode: true });

  await user.click(screen.getByRole('button', { name: '查看 Codex 宠物文件提示' }));
  const focusListeners = add.mock.calls.filter(([type]) => type === 'focusin').length;
  expect(focusListeners).toBeGreaterThan(0);
  unmount();

  expect(remove.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(focusListeners);
});

test('deletes inactive pets and falls back to the built-in pet when deleting the active pet', async () => {
  const user = userEvent.setup();
  const luna = { ...MURK_TEST_PET, id: 'luna', displayName: 'Luna' };
  const { controller } = await renderLibrary({
    pets: [MURK_TEST_PET, luna], activePetId: MURK_TEST_PET.id,
  });
  await user.click(within(screen.getByRole('article', { name: 'Luna' })).getByRole('button', { name: '删除 Luna' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(controller.getSnapshot().pets.map(({ id }) => id)).toEqual(['murk']);
  expect(controller.getSnapshot().settings.activePetId).toBe('murk');
  expect(screen.getByRole('button', { name: '导入 Codex 宠物' })).toHaveFocus();
  await user.click(within(screen.getByRole('article', { name: 'Murk（当前）' })).getByRole('button', { name: '删除 Murk' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(controller.getSnapshot().pets).toHaveLength(0);
  expect(controller.getSnapshot().settings.activePetId).toBe(BUILTIN_PET_ID);
  expect(screen.getByRole('article', { name: 'Momo（当前）' })).toBeVisible();
});

test('keeps an open delete confirmation and focus across a locale rerender', async () => {
  const user = userEvent.setup();
  const imported = { ...MURK_TEST_PET, displayName: '月影', description: '安静的伙伴' };
  const { rerenderLocale } = await renderLibrary({ pets: [imported] });
  const trigger = screen.getByRole('button', { name: '删除 月影' });
  await user.click(trigger);
  const cancel = screen.getByRole('button', { name: '取消' });
  expect(cancel).toHaveFocus();

  rerenderLocale('en');

  expect(screen.getByRole('dialog', { name: 'Delete 月影?' })).toHaveTextContent('安静的伙伴');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancel);
  expect(cancel).toHaveFocus();
  await user.click(cancel);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

describe('persistence failures', () => {
  test('keeps the preview open when saving fails', async () => {
    const user = userEvent.setup();
    const { deps } = await renderLibrary();
    deps.pets.putFailure = true;
    await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
    await user.click(await screen.findByRole('button', { name: '保存到宠物库' }));
    expect(screen.getByRole('dialog', { name: '导入宠物预览' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('无法保存宠物，请重试');
    expect(screen.getByRole('button', { name: '保存到宠物库' })).toHaveFocus();
  });

  test('reports selection and deletion failures', async () => {
    const user = userEvent.setup();
    const { deps } = await renderLibrary({ pets: [MURK_TEST_PET] });
    deps.settings.saveFailure = true;
    await user.click(within(screen.getByRole('article', { name: 'Murk' })).getByRole('button', { name: '使用 Murk' }));
    expect(screen.getByRole('alert')).toHaveTextContent('无法切换宠物，请重试');
    deps.settings.saveFailure = false;
    deps.pets.deleteFailure = true;
    await user.click(within(screen.getByRole('article', { name: 'Murk（当前）' })).getByRole('button', { name: '删除 Murk' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('alert')).toHaveTextContent('无法删除宠物，请重试');
  });
});

test('traps modal focus, closes with Escape, and restores the import trigger', async () => {
  const user = userEvent.setup();
  await renderLibrary();
  const trigger = screen.getByRole('button', { name: '导入 Codex 宠物' });
  await user.upload(screen.getByLabelText('选择 Codex 宠物文件'), [manifestFile, atlasFile]);
  const dialog = await screen.findByRole('dialog', { name: '导入宠物预览' });
  expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: '保存到宠物库' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('activates the drop zone from the keyboard', async () => {
  const user = userEvent.setup();
  await renderLibrary();
  const input = screen.getByLabelText('选择 Codex 宠物文件');
  const click = vi.spyOn(input, 'click');
  screen.getByRole('button', { name: '拖放 Codex 宠物文件' }).focus();
  await user.keyboard('{Enter}');
  expect(click).toHaveBeenCalledOnce();
});

test('creates one object URL for a stored pet and revokes it on change and unmount', () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const { rerender, unmount } = render(<StoredPetPreview pet={MURK_TEST_PET} />);
  expect(screen.getByTestId('pet-atlas-loader')).toHaveAttribute('src', 'blob:first');
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const next = { ...MURK_TEST_PET, spritesheet: new Blob(['next'], { type: 'image/webp' }) };
  rerender(<StoredPetPreview pet={next} />);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
});

test('revokes every object URL created under StrictMode after unmount', async () => {
  let sequence = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:strict-${sequence += 1}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url));
  const { unmount } = render(
    <StrictMode><StoredPetPreview pet={MURK_TEST_PET} /></StrictMode>,
  );
  await waitFor(() => expect(screen.getByTestId('pet-atlas-loader')).toBeInTheDocument());
  unmount();
  expect(created.length).toBeGreaterThan(0);
  expect(revoked.sort()).toEqual(created.sort());
});

test('selection buttons identify the pet in their accessible names', async () => {
  const luna = { ...MURK_TEST_PET, id: 'luna', displayName: 'Luna' };
  await renderLibrary({ pets: [MURK_TEST_PET, luna] });
  expect(screen.getByRole('button', { name: '使用 Murk' })).toHaveTextContent('使用这个宠物');
  expect(screen.getByRole('button', { name: '使用 Luna' })).toHaveTextContent('使用这个宠物');
});
