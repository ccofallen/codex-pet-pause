import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from '../../cat/sprite/useReducedMotion';
import type {
  PetFrameMetadata, SpriteVersion, StandardPetAnimation,
} from '../domain/types';
import {
  getLookCell, isLookDirectionVisible, resolveAnimationRow, spritePosition,
} from './atlas';

interface PetSpriteProps {
  atlasUrl: string;
  version: SpriteVersion;
  animation: StandardPetAnimation;
  lookDirection?: number | null;
  animate: boolean;
  fallbackUrl?: string;
  frameMetadata?: PetFrameMetadata | undefined;
}

interface SpriteRendererProps {
  atlasUrl: string;
  version: SpriteVersion;
  row: { row: number; durations: readonly number[]; columns?: readonly number[] };
  lookDirection?: number | null | undefined;
  animate: boolean;
  fallbackUrl?: string | undefined;
  name: 'pet' | 'cat';
}

export function SpriteRenderer({
  atlasUrl,
  version,
  row,
  lookDirection,
  animate,
  fallbackUrl,
  name,
}: SpriteRendererProps) {
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animate && !reducedMotion;
  const columns = row.columns ?? row.durations.map((_, column) => column);
  const effectiveLookDirection = version === 2 ? lookDirection : null;
  const frameTransition = useMemo(
    () => ({}),
    [atlasUrl, effectiveLookDirection, row, shouldAnimate, version],
  );
  const [frameState, setFrameState] = useState(() => ({ transition: frameTransition, frame: 0 }));
  const [atlasState, setAtlasState] = useState<{
    atlasUrl: string;
    status: 'loading' | 'loaded' | 'failed';
  }>(() => ({ atlasUrl, status: 'loading' }));
  const frame = frameState.transition === frameTransition ? frameState.frame : 0;
  const atlasStatus = atlasState.atlasUrl === atlasUrl ? atlasState.status : 'loading';

  useEffect(() => setFrameState({ transition: frameTransition, frame: 0 }), [frameTransition]);
  useEffect(() => setAtlasState({ atlasUrl, status: 'loading' }), [atlasUrl]);
  useEffect(() => {
    if (!shouldAnimate || effectiveLookDirection !== undefined && effectiveLookDirection !== null) {
      return undefined;
    }
    const timeout = window.setTimeout(
      () => setFrameState({
        transition: frameTransition,
        frame: (frame + 1) % row.durations.length,
      }),
      row.durations[frame]!,
    );
    return () => window.clearTimeout(timeout);
  }, [effectiveLookDirection, frame, frameTransition, row, shouldAnimate]);

  const cell = effectiveLookDirection === undefined || effectiveLookDirection === null
    ? { row: row.row, column: columns[shouldAnimate ? frame : 0] ?? 0 }
    : getLookCell(effectiveLookDirection);
  const position = useMemo(
    () => spritePosition(cell, version),
    [cell.column, cell.row, version],
  );

  return (
    <span className="cat-sprite-stack" aria-hidden="true">
      <img
        className="cat-sprite-atlas-loader"
        data-testid={`${name}-atlas-loader`}
        src={atlasUrl}
        alt=""
        onLoad={() => setAtlasState({ atlasUrl, status: 'loaded' })}
        onError={() => setAtlasState({ atlasUrl, status: 'failed' })}
      />
      {fallbackUrl && atlasStatus !== 'loaded' && (
        <img
          className="cat-sprite-fallback"
          data-testid={`${name}-sprite-fallback`}
          src={fallbackUrl}
          alt=""
        />
      )}
      <span
        className="cat-sprite"
        data-testid={`${name}-sprite`}
        data-atlas-status={atlasStatus}
        data-row={cell.row}
        data-column={cell.column}
        style={{
          backgroundImage: `url("${atlasUrl}")`,
          backgroundPosition: `${position.x}% ${position.y}%`,
          backgroundSize: `800% ${version === 1 ? 900 : 1100}%`,
        }}
      />
    </span>
  );
}

export function PetSprite({
  atlasUrl,
  version,
  animation,
  lookDirection,
  animate,
  fallbackUrl,
  frameMetadata,
}: PetSpriteProps) {
  const unavailableLookDirection = version === 2
    && lookDirection !== undefined
    && lookDirection !== null
    && !isLookDirectionVisible(lookDirection, frameMetadata);
  const row = useMemo(
    () => resolveAnimationRow(unavailableLookDirection ? 'idle' : animation, frameMetadata),
    [animation, frameMetadata, unavailableLookDirection],
  );

  return (
    <SpriteRenderer
      atlasUrl={atlasUrl}
      version={version}
      row={row}
      lookDirection={unavailableLookDirection ? null : lookDirection}
      animate={animate}
      fallbackUrl={fallbackUrl}
      name="pet"
    />
  );
}
