import { useEffect, useState } from 'react';
import type { StoredCodexPet } from '../domain/types';
import { PetSprite } from '../sprite/PetSprite';

interface StoredPetPreviewProps {
  pet: StoredCodexPet;
}

export function StoredPetPreview({ pet }: StoredPetPreviewProps) {
  const [atlas, setAtlas] = useState<{ blob: Blob; url: string }>();

  useEffect(() => {
    const url = URL.createObjectURL(pet.spritesheet);
    setAtlas({ blob: pet.spritesheet, url });
    return () => URL.revokeObjectURL(url);
  }, [pet.spritesheet]);

  if (atlas?.blob !== pet.spritesheet) {
    return <span className="cat-sprite-stack" aria-hidden="true" />;
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
