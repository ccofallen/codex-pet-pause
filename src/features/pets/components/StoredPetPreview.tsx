import { useEffect, useState } from 'react';
import type { ListedCodexPet } from '../domain/types';
import { PetSprite } from '../sprite/PetSprite';

interface StoredPetPreviewProps {
  pet: ListedCodexPet;
}

export function StoredPetPreview({ pet }: StoredPetPreviewProps) {
  const [atlas, setAtlas] = useState<{ blob: Blob; url: string }>();
  const preview = pet.assetKind === 'catalog' ? pet.thumbnail : pet.spritesheet;

  useEffect(() => {
    if (preview === undefined) {
      setAtlas(undefined);
      return undefined;
    }
    const url = URL.createObjectURL(preview);
    setAtlas({ blob: preview, url });
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  if (preview === undefined) {
    return <span data-testid="stored-pet-placeholder" className="cat-sprite-stack" aria-hidden="true" />;
  }

  if (atlas?.blob !== preview) {
    return <span className="cat-sprite-stack" aria-hidden="true" />;
  }

  if (pet.assetKind === 'catalog') {
    return <img data-testid="stored-pet-thumbnail" className="stored-pet-thumbnail" src={atlas.url} alt="" />;
  }

  return (
    <PetSprite
      atlasUrl={atlas.url}
      version={pet.spriteVersion}
      animation="idle"
      animate={false}
      frameMetadata={pet.frameMetadata}
    />
  );
}
