import { useEffect, useState, type FormEvent } from 'react';
import { useAppController, useAppSnapshot } from '../../../app/AppProvider';
import type { CatConfig } from '../domain/types';
import { CatSprite } from '../sprite/CatSprite';
import { useI18n } from '../../../i18n/I18nProvider';

export function CatCustomizer() {
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const { t } = useI18n();
  const savedCat = snapshot.settings.cat;
  const [draft, setDraft] = useState<CatConfig>(savedCat);
  const [nameInvalid, setNameInvalid] = useState(false);

  useEffect(() => setDraft(savedCat), [savedCat]);

  const updateName = (name: string): void => {
    setDraft({ name });
    setNameInvalid(false);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const normalizedName = draft.name.trim();
    const nameLength = Array.from(normalizedName).length;
    if (nameLength < 1 || nameLength > 20) {
      setNameInvalid(true);
      return;
    }
    const cat: CatConfig = { name: normalizedName };
    setDraft(cat);
    await controller.saveSettings({ ...controller.getSnapshot().settings, cat });
  };

  const cancel = (): void => {
    setDraft(savedCat);
    setNameInvalid(false);
  };

  return (
    <form className="cat-customizer" onSubmit={(event) => { void save(event); }}>
      <div className="cat-preview" role="img" aria-label={t('onboarding.catPreview')}>
        <CatSprite animation="idle" animate={snapshot.settings.animationsEnabled} />
      </div>
      <div className="cat-customizer-controls">
        <label className="cat-name-field">
          <span>{t('onboarding.catName')}</span>
          <input
            value={draft.name}
            onChange={(event) => updateName(event.target.value)}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? 'cat-name-error' : undefined}
          />
        </label>
        {nameInvalid && <p id="cat-name-error" role="alert">{t('onboarding.error.catName')}</p>}
        <div className="cat-customizer-actions">
          <button type="button" onClick={cancel}>{t('cat.customizer.cancel')}</button>
          <button type="submit">{t('cat.customizer.save')}</button>
        </div>
      </div>
    </form>
  );
}
