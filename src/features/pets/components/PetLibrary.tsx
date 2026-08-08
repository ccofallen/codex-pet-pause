import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type ChangeEvent, type DragEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppController, useAppSnapshot } from '../../../app/AppProvider';
import { useI18n } from '../../../i18n/I18nProvider';
import type { Translator } from '../../../i18n/messages';
import { CatSprite } from '../../cat/sprite/CatSprite';
import {
  parseCodexPetImport, PetImportError, type PetImportErrorCode,
} from '../domain/importPet';
import {
  extractCodexPetArchive, type CodexPetFilePair,
} from '../domain/importPetArchive';
import { BUILTIN_PET_ID, type StoredCodexPet } from '../domain/types';
import { StoredPetPreview } from './StoredPetPreview';
import type { AndroidPetImport } from '../../../android/infrastructure/androidPetImport';

type ParseImport = (
  manifestFile: File,
  spritesheetFile: File,
  now: number,
) => Promise<StoredCodexPet>;

type ExtractArchive = (archiveFile: File) => Promise<CodexPetFilePair>;

interface PetLibraryProps {
  parseImport?: ParseImport;
  extractArchive?: ExtractArchive;
  now?: () => number;
  androidImport?: AndroidPetImport;
}

const currentTime = (): number => Date.now();

type LibraryError =
  | { kind: 'selection-unsupported' | 'selection-incomplete' | 'selection-duplicate' }
  | { kind: 'import'; code: PetImportErrorCode; details: Readonly<Record<string, string | number>> }
  | { kind: 'import-generic' | 'petdex-download' | 'save' | 'select' | 'delete' };

type LibraryMessage =
  | { kind: 'saved' | 'deleted'; name: string }
  | { kind: 'selected' };

type PreviewSource = { kind: 'manual' } | { kind: 'petdex'; token: string };
interface ImportPreviewState {
  pet: StoredCodexPet;
  source: PreviewSource;
}

function importErrorMessage(
  code: PetImportErrorCode,
  details: Readonly<Record<string, string | number>>,
  t: Translator,
): string {
  switch (code) {
    case 'manifest-not-object': return t('pet.import.error.manifestNotObject');
    case 'unsafe-id': return t('pet.import.error.unsafeId');
    case 'reserved-id': return t('pet.import.error.reservedId');
    case 'name-required': return t('pet.import.error.nameRequired');
    case 'name-too-long': return t('pet.import.error.nameTooLong');
    case 'description-invalid': return t('pet.import.error.descriptionInvalid');
    case 'description-too-long': return t('pet.import.error.descriptionTooLong');
    case 'unsupported-version': return t('pet.import.error.unsupportedVersion');
    case 'spritesheet-path-missing': return t('pet.import.error.spritesheetPathMissing');
    case 'manifest-file-invalid': return t('pet.import.error.manifestFileInvalid');
    case 'manifest-too-large': return t('pet.import.error.manifestTooLarge');
    case 'atlas-file-invalid': return t('pet.import.error.atlasFileInvalid');
    case 'atlas-too-large': return t('pet.import.error.atlasTooLarge');
    case 'manifest-json-invalid': return t('pet.import.error.manifestJsonInvalid');
    case 'spritesheet-path-invalid': return t('pet.import.error.spritesheetPathInvalid');
    case 'atlas-name-mismatch': return t('pet.import.error.atlasNameMismatch', {
      expectedFilename: String(details.expectedFilename ?? 'spritesheet.webp'),
    });
    case 'atlas-decode-failed': return t('pet.import.error.atlasDecodeFailed');
    case 'atlas-dimensions-invalid': return t('pet.import.error.atlasDimensionsInvalid', {
      version: Number(details.version ?? 1),
      expectedWidth: Number(details.expectedWidth ?? 1536),
      expectedHeight: Number(details.expectedHeight ?? 1872),
    });
    case 'atlas-idle-empty': return t('pet.import.error.atlasIdleEmpty');
    case 'archive-selection-mixed': return t('pet.import.error.archiveSelectionMixed');
    case 'archive-selection-multiple': return t('pet.import.error.archiveSelectionMultiple');
    case 'archive-too-large': return t('pet.import.error.archiveTooLarge');
    case 'archive-invalid': return t('pet.import.error.archiveInvalid');
    case 'archive-encrypted': return t('pet.import.error.archiveEncrypted');
    case 'archive-path-unsafe': return t('pet.import.error.archivePathUnsafe');
    case 'archive-entry-limit': return t('pet.import.error.archiveEntryLimit');
    case 'archive-expanded-too-large': return t('pet.import.error.archiveExpandedTooLarge');
    case 'archive-files-missing': return t('pet.import.error.archiveFilesMissing');
    case 'archive-multiple-manifests': return t('pet.import.error.archiveMultipleManifests');
    case 'archive-atlas-ambiguous': return t('pet.import.error.archiveAtlasAmbiguous');
  }
}

function libraryErrorMessage(error: LibraryError, t: Translator): string {
  switch (error.kind) {
    case 'selection-unsupported': return t('pet.import.error.unsupportedSelection');
    case 'selection-incomplete': return t('pet.import.error.incompleteSelection');
    case 'selection-duplicate': return t('pet.import.error.duplicateSelection');
    case 'import': return importErrorMessage(error.code, error.details, t);
    case 'import-generic': return t('pet.import.error.generic');
    case 'petdex-download': return t('pet.import.error.petdexDownload');
    case 'save': return t('pet.library.saveFailed');
    case 'select': return t('pet.library.selectFailed');
    case 'delete': return t('pet.library.deleteFailed');
  }
}

function libraryStatusMessage(message: LibraryMessage, t: Translator): string {
  switch (message.kind) {
    case 'saved': return t('pet.library.saved', { name: message.name });
    case 'deleted': return t('pet.library.deleted', { name: message.name });
    case 'selected': return t('pet.library.selected');
  }
}

export function PetLibrary({
  parseImport = parseCodexPetImport,
  extractArchive = extractCodexPetArchive,
  now = currentTime,
  androidImport,
}: PetLibraryProps) {
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importHelpRef = useRef<HTMLDivElement>(null);
  const importHelpButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const importRequestRef = useRef(0);
  const importHelpId = useId();
  const importHeadingId = useId();
  const [previewState, setPreviewState] = useState<ImportPreviewState>();
  const preview = previewState?.pet;
  const [petToDelete, setPetToDelete] = useState<StoredCodexPet>();
  const [error, setError] = useState<LibraryError>();
  const [message, setMessage] = useState<LibraryMessage>();
  const [pending, setPending] = useState(false);
  const [petdexActive, setPetdexActive] = useState(false);
  const [importHelpOpen, setImportHelpOpen] = useState(false);

  useEffect(() => () => {
    importRequestRef.current += 1;
  }, []);

  useEffect(() => {
    if (!importHelpOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setImportHelpOpen(false);
        queueMicrotask(() => importHelpButtonRef.current?.focus());
      }
    };
    const closeOutside = (event: Event): void => {
      if (!importHelpRef.current?.contains(event.target as Node)) setImportHelpOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [importHelpOpen]);

  const closePreview = (): void => {
    if (pending) return;
    importRequestRef.current += 1;
    const source = previewState?.source;
    setPreviewState(undefined);
    if (source?.kind === 'petdex' && androidImport !== undefined) {
      void androidImport.completePendingArchive(source.token, 'cancelled')
        .catch(() => setError({ kind: 'petdex-download' }))
        .finally(() => setPetdexActive(false));
    }
    queueMicrotask(() => importTriggerRef.current?.focus());
  };

  const closeDelete = (): void => {
    if (pending) return;
    setPetToDelete(undefined);
    queueMicrotask(() => deleteTriggerRef.current?.focus());
  };

  const processFiles = useCallback(async (
    files: File[],
    source: PreviewSource = { kind: 'manual' },
  ): Promise<'preview' | 'rejected' | 'stale'> => {
    const request = importRequestRef.current + 1;
    importRequestRef.current = request;
    setError(undefined);
    setMessage(undefined);
    const archives = files.filter(({ name }) => name.toLowerCase().endsWith('.zip'));
    const manifests = files.filter(({ name }) => name.toLowerCase().endsWith('.json'));
    const atlases = files.filter(({ name }) => name.toLowerCase().endsWith('.webp'));

    try {
      let manifestFile: File;
      let spritesheetFile: File;

      if (archives.length > 0) {
        if (manifests.length > 0 || atlases.length > 0) {
          throw new PetImportError('archive-selection-mixed');
        }
        if (files.length !== 1 || archives.length !== 1) {
          throw new PetImportError('archive-selection-multiple');
        }
        ({ manifestFile, spritesheetFile } = await extractArchive(archives[0]!));
        if (request !== importRequestRef.current) return 'stale';
      } else {
        if (manifests.length + atlases.length !== files.length) {
          setError({ kind: 'selection-unsupported' });
          return 'rejected';
        }
        if (manifests.length === 0 || atlases.length === 0) {
          setError({ kind: 'selection-incomplete' });
          return 'rejected';
        }
        if (manifests.length !== 1 || atlases.length !== 1) {
          setError({ kind: 'selection-duplicate' });
          return 'rejected';
        }
        manifestFile = manifests[0]!;
        spritesheetFile = atlases[0]!;
      }

      const imported = await parseImport(manifestFile!, spritesheetFile!, now());
      if (request !== importRequestRef.current) return 'stale';
      if (imported.id === BUILTIN_PET_ID) {
        setError({ kind: 'import', code: 'reserved-id', details: {} });
        return 'rejected';
      }
      setPreviewState({ pet: imported, source });
      return 'preview';
    } catch (reason) {
      if (request !== importRequestRef.current) return 'stale';
      setError(reason instanceof PetImportError
        ? { kind: 'import', code: reason.code, details: reason.details }
        : { kind: 'import-generic' });
      return 'rejected';
    }
  }, [extractArchive, now, parseImport]);

  useEffect(() => {
    if (androidImport !== undefined) {
      return androidImport.subscribe(({ token }) => {
        setPetdexActive(true);
        setError(undefined);
        setMessage(undefined);
        void (async () => {
          let archive: File;
          try {
            archive = await androidImport.consumePendingArchive(token);
          } catch {
            setError({ kind: 'petdex-download' });
            await androidImport.completePendingArchive(token, 'retry').catch(() => undefined);
            setPetdexActive(false);
            return;
          }
          const result = await processFiles([archive], { kind: 'petdex', token });
          if (result === 'preview') return;
          await androidImport.completePendingArchive(
            token,
            result === 'rejected' ? 'rejected' : 'retry',
          ).catch(() => undefined);
          setPetdexActive(false);
        })();
      });
    }
    return window.petShell?.onPetdexImport?.((event) => {
      if (event.type === 'error') {
        setError({ kind: 'petdex-download' });
        return;
      }
      const archive = new File([event.bytes], event.name, { type: 'application/zip' });
      void processFiles([archive]);
    });
  }, [androidImport, processFiles]);

  const openPetdex = (): void => {
    if (androidImport !== undefined && (pending || petdexActive)) return;
    setError(undefined);
    setMessage(undefined);
    if (androidImport !== undefined) {
      void androidImport.openPetdex().catch(() => setError({ kind: 'petdex-download' }));
      return;
    }
    if (window.petShell?.openPetdex !== undefined) {
      void window.petShell.openPetdex();
      return;
    }
    window.open('https://petdex.dev/', '_blank', 'noopener,noreferrer');
  };

  const chooseAndroidFiles = (): void => {
    if (androidImport === undefined || pending || petdexActive) return;
    const request = importRequestRef.current + 1;
    importRequestRef.current = request;
    setError(undefined);
    setMessage(undefined);
    void androidImport.pickFiles().then((files) => {
      if (request !== importRequestRef.current || files.length === 0) return;
      void processFiles(files);
    }).catch(() => {
      if (request === importRequestRef.current) setError({ kind: 'import-generic' });
    });
  };

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void processFiles(files);
  };

  const savePreview = async (): Promise<void> => {
    if (preview === undefined || pending) return;
    importRequestRef.current += 1;
    setPending(true);
    setError(undefined);
    try {
      const source = previewState?.source;
      if (androidImport === undefined) {
        await controller.savePet(preview);
      } else {
        const existing = snapshot.pets.find(({ id }) => id === preview.id);
        await androidImport.persistValidatedPet(existing === undefined
          ? preview
          : { ...preview, importedAt: existing.importedAt });
      }
      const displayName = preview.displayName;
      setPreviewState(undefined);
      setMessage(androidImport === undefined
        ? { kind: 'saved', name: displayName }
        : { kind: 'selected' });
      queueMicrotask(() => importTriggerRef.current?.focus());
      if (source?.kind === 'petdex' && androidImport !== undefined) {
        try {
          await androidImport.completePendingArchive(source.token, 'imported');
        } catch (reason) {
          console.warn('Committed Android pet archive acknowledgement will retry later', reason);
        } finally {
          setPetdexActive(false);
        }
      }
    } catch {
      setError({ kind: 'save' });
    } finally {
      setPending(false);
    }
  };

  const selectPet = async (id: string): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await controller.selectPet(id);
      setMessage({ kind: 'selected' });
    } catch {
      setError({ kind: 'select' });
    } finally {
      setPending(false);
    }
  };

  const deletePet = async (): Promise<void> => {
    if (petToDelete === undefined || pending) return;
    const pet = petToDelete;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await controller.deletePet(pet.id);
      setPetToDelete(undefined);
      setMessage({ kind: 'deleted', name: pet.displayName });
      queueMicrotask(() => importTriggerRef.current?.focus());
    } catch {
      setError({ kind: 'delete' });
    } finally {
      setPending(false);
    }
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    void processFiles(Array.from(event.dataTransfer.files));
  };

  const helpControl = (
    <button
      ref={importHelpButtonRef}
      className="pet-import-help-button"
      type="button"
      aria-label={t('pet.import.moreInformation')}
      aria-expanded={importHelpOpen}
      aria-controls={importHelpId}
      onClick={() => setImportHelpOpen((open) => !open)}
    >
      <span aria-hidden="true">!</span>
    </button>
  );

  return (
    <div className="pet-library">
      <section className="pet-import" aria-labelledby={importHeadingId}>
        <div className="pet-import-intro">
          <div className="pet-import-heading">
            <h2 id={importHeadingId}>{t('pet.import.heading')}</h2>
          </div>
          <p className="pet-import-description">{t('pet.import.instructions')}</p>
          <div ref={importHelpRef} className="pet-import-save-note">
            <p className="pet-import-save-note-row">
              {t('pet.import.deviceSaveNote')} {helpControl}
            </p>
            <p id={importHelpId} className="pet-import-help-disclosure" hidden={!importHelpOpen}>
              {t('pet.import.helpBeforeSite')}{' '}
              <a href="https://petdex.dev/" target="_blank" rel="noreferrer noopener">
                {t('pet.import.helpSite')}
              </a>{' '}
              {t('pet.import.helpAfterSite')}
            </p>
          </div>
        </div>
        {androidImport === undefined && <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept="application/zip,application/x-zip-compressed,application/json,image/webp,.zip,.json,.webp"
          aria-label={t('pet.import.chooseFiles')}
          onChange={chooseFiles}
        />}
        <div className={androidImport === undefined
          ? 'pet-import-actions'
          : 'pet-import-actions android-pet-import-actions'}>
          <button
            className={androidImport === undefined ? undefined : 'android-pet-import-action'}
            data-testid={androidImport === undefined ? undefined : 'android-pet-import-action'}
            type="button"
            disabled={androidImport !== undefined && (pending || petdexActive)}
            onClick={openPetdex}
          >
            {t('pet.import.petdexAction')}
          </button>
          <button
            ref={importTriggerRef}
            className={androidImport === undefined ? undefined : 'android-pet-import-action'}
            data-testid={androidImport === undefined ? undefined : 'android-pet-import-action'}
            type="button"
            disabled={androidImport !== undefined && (pending || petdexActive)}
            onClick={androidImport === undefined ? () => inputRef.current?.click() : chooseAndroidFiles}
          >
            {t('pet.import.action')}
          </button>
          <p className="pet-import-description">{t('pet.import.petdexHint')}</p>
        </div>
        {androidImport === undefined && <div
          className="pet-drop-zone"
          role="button"
          tabIndex={0}
          aria-label={t('pet.import.dropLabel')}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFiles}
        >
          {t('pet.import.dropInstructions')}
        </div>}
      </section>

      {error !== undefined && preview === undefined && petToDelete === undefined && (
        <p className="settings-error" role="alert">{libraryErrorMessage(error, t)}</p>
      )}
      {message !== undefined && <p role="status">{libraryStatusMessage(message, t)}</p>}

      <div className="pet-card-grid">
        <PetCard
          name={snapshot.settings.cat.name}
          description={t('pet.library.builtinDescription')}
          active={snapshot.settings.activePetId === BUILTIN_PET_ID}
          pending={pending}
          preview={<CatSprite animation="idle" animate={false} />}
          onSelect={() => void selectPet(BUILTIN_PET_ID)}
        />
        {snapshot.pets.map((pet) => (
          <PetCard
            key={pet.id}
            name={pet.displayName}
            description={pet.description ?? t('pet.library.importedDescription')}
            active={snapshot.settings.activePetId === pet.id}
            pending={pending}
            preview={<StoredPetPreview pet={pet} />}
            onSelect={() => void selectPet(pet.id)}
            onDelete={(trigger) => {
              deleteTriggerRef.current = trigger;
              setError(undefined);
              setMessage(undefined);
              setPetToDelete(pet);
            }}
          />
        ))}
      </div>

      {snapshot.pets.length === 0 && <p className="pet-library-empty">{t('pet.import.empty')}</p>}

      {preview !== undefined && (
        <ImportPreviewDialog
          pet={preview}
          replacing={snapshot.pets.some(({ id }) => id === preview.id)}
          pending={pending}
          nativeActivation={androidImport !== undefined}
          {...(error === undefined ? {} : { error: libraryErrorMessage(error, t) })}
          onClose={closePreview}
          onSave={() => void savePreview()}
        />
      )}
      {petToDelete !== undefined && (
        <DeletePetDialog
          pet={petToDelete}
          pending={pending}
          {...(error?.kind === 'delete' ? { error: libraryErrorMessage(error, t) } : {})}
          onClose={closeDelete}
          onDelete={() => void deletePet()}
        />
      )}
    </div>
  );
}

interface PetCardProps {
  name: string;
  description: string;
  active: boolean;
  pending: boolean;
  preview: ReactNode;
  onSelect(): void;
  onDelete?: (trigger: HTMLButtonElement) => void;
}

function PetCard({
  name, description, active, pending, preview, onSelect, onDelete,
}: PetCardProps) {
  const { t } = useI18n();
  return (
    <article
      className="pet-card"
      data-active={active || undefined}
      aria-label={t('pet.library.cardLabel', { name, active })}
    >
      <div className="pet-card-preview">{preview}</div>
      <div className="pet-card-heading">
        <h2>{name}</h2>
      </div>
      <p>{description}</p>
      {active ? <p className="pet-current" aria-label={t('pet.library.currentLabel')}>{t('pet.library.current')}</p> : (
        <button type="button" aria-label={t('pet.library.useLabel', { name })} disabled={pending} onClick={onSelect}>
          {t('pet.library.use')}
        </button>
      )}
      {onDelete !== undefined && (
        <button
          className="pet-delete"
          type="button"
          disabled={pending}
          onClick={(event) => onDelete(event.currentTarget)}
        >
          {t('pet.library.delete', { name })}
        </button>
      )}
    </article>
  );
}

interface ImportPreviewDialogProps {
  pet: StoredCodexPet;
  replacing: boolean;
  pending: boolean;
  nativeActivation: boolean;
  error?: string;
  onClose(): void;
  onSave(): void;
}

function ImportPreviewDialog({
  pet, replacing, pending, nativeActivation, error, onClose, onSave,
}: ImportPreviewDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(false);
  const headingId = useId();

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell === null) return undefined;
    const wasInert = shell.hasAttribute('inert');
    shell.setAttribute('inert', '');
    return () => {
      if (wasInert) shell.setAttribute('inert', '');
      else shell.removeAttribute('inert');
    };
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pending) {
      wasPendingRef.current = true;
      dialogRef.current?.focus();
    } else if (wasPendingRef.current) {
      wasPendingRef.current = false;
      saveRef.current?.focus();
    }
  }, [pending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      if (activeIndex === -1) {
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      } else {
        const next = event.shiftKey
          ? (activeIndex - 1 + focusable.length) % focusable.length
          : (activeIndex + 1) % focusable.length;
        focusable[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, onClose]);

  return createPortal(
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="pet-preview-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>{t(nativeActivation
          ? 'android.petImport.previewHeading'
          : 'pet.preview.heading')}</h2>
        <div className="pet-dialog-preview"><StoredPetPreview pet={pet} /></div>
        <h3>{pet.displayName}</h3>
        <p>{pet.description ?? t('pet.library.noDescription')}</p>
        {replacing && <p className="pet-update-warning">{t('pet.preview.replaceWarning')}</p>}
        {error !== undefined && <p className="settings-error" role="alert">{error}</p>}
        <div className="button-row">
          <button ref={cancelRef} type="button" disabled={pending} onClick={onClose}>{t('common.cancel')}</button>
          <button ref={saveRef} type="button" disabled={pending} onClick={onSave}>
            {pending
              ? t('pet.preview.saving')
              : nativeActivation
                ? t(replacing ? 'android.petImport.update' : 'android.petImport.confirm')
                : replacing ? t('pet.preview.update') : t('pet.preview.save')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

interface DeletePetDialogProps {
  pet: StoredCodexPet;
  pending: boolean;
  error?: string;
  onClose(): void;
  onDelete(): void;
}

function DeletePetDialog({ pet, pending, error, onClose, onDelete }: DeletePetDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(false);
  const headingId = useId();

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell === null) return undefined;
    const wasInert = shell.hasAttribute('inert');
    shell.setAttribute('inert', '');
    return () => {
      if (wasInert) shell.setAttribute('inert', '');
      else shell.removeAttribute('inert');
    };
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pending) {
      wasPendingRef.current = true;
      dialogRef.current?.focus();
    } else if (wasPendingRef.current) {
      wasPendingRef.current = false;
      deleteRef.current?.focus();
    }
  }, [pending]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      if (activeIndex === -1) {
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      } else {
        const next = event.shiftKey
          ? (activeIndex - 1 + focusable.length) % focusable.length
          : (activeIndex + 1) % focusable.length;
        focusable[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, onClose]);

  return createPortal(
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="pet-preview-dialog pet-delete-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>{t('pet.delete.heading', { name: pet.displayName })}</h2>
        <p>{pet.description ?? t('pet.library.importedDescription')}</p>
        <p>{t('pet.delete.description')}</p>
        {error !== undefined && <p className="settings-error" role="alert">{error}</p>}
        <div className="button-row">
          <button ref={cancelRef} type="button" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button ref={deleteRef} type="button" disabled={pending} onClick={onDelete}>
            {pending ? t('pet.delete.deleting') : t('pet.delete.confirm')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
