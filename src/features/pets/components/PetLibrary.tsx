import {
  useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppController, useAppSnapshot } from '../../../app/AppProvider';
import { useI18n } from '../../../i18n/I18nProvider';
import type { Translator } from '../../../i18n/messages';
import { CatSprite } from '../../cat/sprite/CatSprite';
import {
  parseCodexPetImport, PetImportError, type PetImportErrorCode,
} from '../domain/importPet';
import { BUILTIN_PET_ID, type StoredCodexPet } from '../domain/types';
import { StoredPetPreview } from './StoredPetPreview';

type ParseImport = (
  manifestFile: File,
  spritesheetFile: File,
  now: number,
) => Promise<StoredCodexPet>;

interface PetLibraryProps {
  parseImport?: ParseImport;
  now?: () => number;
}

const currentTime = (): number => Date.now();

type LibraryError =
  | { kind: 'selection-unsupported' | 'selection-incomplete' | 'selection-duplicate' }
  | { kind: 'import'; code: PetImportErrorCode; details: Readonly<Record<string, string | number>> }
  | { kind: 'import-generic' | 'save' | 'select' | 'delete' };

type LibraryMessage =
  | { kind: 'saved' | 'deleted'; name: string }
  | { kind: 'selected' };

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
  }
}

function libraryErrorMessage(error: LibraryError, t: Translator): string {
  switch (error.kind) {
    case 'selection-unsupported': return t('pet.import.error.unsupportedSelection');
    case 'selection-incomplete': return t('pet.import.error.incompleteSelection');
    case 'selection-duplicate': return t('pet.import.error.duplicateSelection');
    case 'import': return importErrorMessage(error.code, error.details, t);
    case 'import-generic': return t('pet.import.error.generic');
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

export function PetLibrary({ parseImport = parseCodexPetImport, now = currentTime }: PetLibraryProps) {
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
  const [preview, setPreview] = useState<StoredCodexPet>();
  const [petToDelete, setPetToDelete] = useState<StoredCodexPet>();
  const [error, setError] = useState<LibraryError>();
  const [message, setMessage] = useState<LibraryMessage>();
  const [pending, setPending] = useState(false);
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
    setPreview(undefined);
    queueMicrotask(() => importTriggerRef.current?.focus());
  };

  const closeDelete = (): void => {
    if (pending) return;
    setPetToDelete(undefined);
    queueMicrotask(() => deleteTriggerRef.current?.focus());
  };

  const processFiles = async (files: File[]): Promise<void> => {
    const request = importRequestRef.current + 1;
    importRequestRef.current = request;
    setError(undefined);
    setMessage(undefined);
    const manifests = files.filter(({ name }) => name.toLowerCase().endsWith('.json'));
    const atlases = files.filter(({ name }) => name.toLowerCase().endsWith('.webp'));
    if (manifests.length + atlases.length !== files.length) {
      setError({ kind: 'selection-unsupported' });
      return;
    }
    if (manifests.length === 0 || atlases.length === 0) {
      setError({ kind: 'selection-incomplete' });
      return;
    }
    if (manifests.length !== 1 || atlases.length !== 1) {
      setError({ kind: 'selection-duplicate' });
      return;
    }
    try {
      const imported = await parseImport(manifests[0]!, atlases[0]!, now());
      if (request !== importRequestRef.current) return;
      if (imported.id === BUILTIN_PET_ID) {
        setError({ kind: 'import', code: 'reserved-id', details: {} });
        return;
      }
      setPreview(imported);
    } catch (reason) {
      if (request !== importRequestRef.current) return;
      setError(reason instanceof PetImportError
        ? { kind: 'import', code: reason.code, details: reason.details }
        : { kind: 'import-generic' });
    }
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
      await controller.savePet(preview);
      const displayName = preview.displayName;
      setPreview(undefined);
      setMessage({ kind: 'saved', name: displayName });
      queueMicrotask(() => importTriggerRef.current?.focus());
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
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept="application/json,image/webp,.json,.webp"
          aria-label={t('pet.import.chooseFiles')}
          onChange={chooseFiles}
        />
        <button ref={importTriggerRef} type="button" onClick={() => inputRef.current?.click()}>
          {t('pet.import.action')}
        </button>
        <div
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
        </div>
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
  error?: string;
  onClose(): void;
  onSave(): void;
}

function ImportPreviewDialog({
  pet, replacing, pending, error, onClose, onSave,
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
        <h2 id={headingId}>{t('pet.preview.heading')}</h2>
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
