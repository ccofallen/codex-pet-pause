import { SpriteRenderer } from '../../pets/sprite/PetSprite';
import { animationRows, type CatAnimation } from './atlas';

interface CatSpriteProps {
  animation: CatAnimation;
  lookDirection?: number | null;
  animate: boolean;
}

export function CatSprite({ animation, lookDirection, animate }: CatSpriteProps) {
  const assetBase = `${import.meta.env.BASE_URL}assets/cat/`;
  return (
    <SpriteRenderer
      atlasUrl={`${assetBase}neko-pause-cat.webp`}
      version={2}
      row={animationRows[animation]}
      lookDirection={lookDirection}
      animate={animate}
      fallbackUrl={`${assetBase}neko-pause-cat-fallback.png`}
      name="cat"
    />
  );
}
