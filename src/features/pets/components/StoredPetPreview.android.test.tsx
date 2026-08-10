import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { StoredCodexPet } from '../domain/types';
import { StoredPetPreview } from './StoredPetPreview';

test('renders and releases a compact Android thumbnail without mounting the atlas renderer', () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const thumbnail = new Blob(['tiny'], { type: 'image/png' });
  const pet = {
    id: 'momo', displayName: 'Momo', spriteVersion: 2 as const, spritesheetFilename: 'momo.webp',
    assetKind: 'catalog' as const, thumbnail, importedAt: 10, updatedAt: 20,
  };

  const view = render(<StoredPetPreview pet={pet} />);

  expect(screen.getByTestId('stored-pet-thumbnail')).toHaveAttribute('src', 'blob:thumbnail');
  expect(screen.queryByTestId('pet-sprite')).not.toBeInTheDocument();
  view.unmount();
  expect(createObjectURL).toHaveBeenCalledWith(thumbnail);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
});

test('renders a stable placeholder when native thumbnail generation failed', () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockClear();
  const pet = {
    id: 'momo', displayName: 'Momo', spriteVersion: 2 as const, spritesheetFilename: 'momo.webp',
    assetKind: 'catalog' as const, importedAt: 10, updatedAt: 20,
  };

  render(<StoredPetPreview pet={pet} />);

  expect(screen.getByTestId('stored-pet-placeholder')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(createObjectURL).not.toHaveBeenCalled();
});
