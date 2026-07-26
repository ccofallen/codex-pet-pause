import { act, fireEvent, render, screen } from '@testing-library/react';
import { createAppController } from './appController';
import { AppProvider } from './AppProvider';
import { DesktopApp } from './DesktopApp';
import type { StoredCodexPet } from '../features/pets/domain/types';
import { createFakeDependencies } from '../test/fakes';
import { createDefaultSettings } from './defaults';
import { expect, test, vi } from 'vitest';

test('renders desktop shell with builtin cat by default', async () => {
  const controller = createAppController(createFakeDependencies({ now: 1 }));
  render(<AppProvider controller={controller}><DesktopApp /></AppProvider>);
  await act(async () => {
    await controller.hydrate();
    await controller.reconcileNow();
  });

  expect(screen.getByTestId('cat-stage')).toHaveAccessibleName('摸摸 Momo');
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
});

test('opens desktop context menu on right click', async () => {
  const showContextMenu = vi.fn();
  window.petShell = { showContextMenu, dragWindowTo: vi.fn() };

  const controller = createAppController(createFakeDependencies({ now: 1 }));
  render(<AppProvider controller={controller}><DesktopApp /></AppProvider>);
  await act(async () => {
    await controller.hydrate();
    await controller.reconcileNow();
  });

  const cat = await screen.findByRole('button', { name: '摸摸 Momo' });
  fireEvent.contextMenu(cat, { screenX: 640, screenY: 360 });
  expect(showContextMenu).toHaveBeenCalledOnce();
  expect(showContextMenu).toHaveBeenCalledWith(640, 360);
  delete window.petShell;
});

test('switches from builtin cat to imported pet stage after setting the active pet', async () => {
  const settings = createDefaultSettings(1);
  const imported: StoredCodexPet = {
    id: 'work-blue-cat',
    displayName: '工作蓝猫',
    spriteVersion: 1,
    spritesheetFilename: 'spritesheet.webp',
    spritesheet: new Blob(['atlas'], { type: 'image/webp' }),
    importedAt: 1,
    updatedAt: 1,
  };
  settings.activePetId = imported.id;
  const dependencies = createFakeDependencies({ now: 1, settings });
  dependencies.pets.values.set(imported.id, imported);
  const controller = createAppController(dependencies);
  render(<AppProvider controller={controller}><DesktopApp /></AppProvider>);
  await act(async () => {
    await controller.hydrate();
    await controller.reconcileNow();
  });

  expect(screen.getByTestId('pet-stage')).toHaveAccessibleName('摸摸 工作蓝猫');
  expect(screen.queryByTestId('cat-stage')).not.toBeInTheDocument();
});
