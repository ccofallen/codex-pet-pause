import { beforeAll, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const appListeners = new Map();
  const windows = [];
  let nextWebContentsId = 1;

  const app = {
    getPath: vi.fn(() => '/tmp/codex-pet-pause-test'),
    getAppPath: vi.fn(() => '/tmp/codex-pet-pause-app'),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn((eventName, listener) => {
      appListeners.set(eventName, listener);
    }),
    setAppUserModelId: vi.fn(),
  };

  const BrowserWindow = vi.fn(function BrowserWindow(options) {
    const listeners = new Map();
    const onceListeners = new Map();
    const window = {
      options,
      destroyed: false,
      minimized: false,
      webContents: {
        id: nextWebContentsId++,
      },
      focus: vi.fn(),
      getBounds: vi.fn(() => ({
        x: options.x ?? 0,
        y: options.y ?? 0,
        width: options.width,
        height: options.height,
      })),
      isDestroyed: vi.fn(() => window.destroyed),
      isMinimized: vi.fn(() => window.minimized),
      loadURL: vi.fn(),
      on: vi.fn((eventName, listener) => {
        listeners.set(eventName, listener);
      }),
      once: vi.fn((eventName, listener) => {
        onceListeners.set(eventName, listener);
      }),
      restore: vi.fn(() => {
        window.minimized = false;
      }),
      setPosition: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      show: vi.fn(),
      listeners,
      onceListeners,
    };
    windows.push(window);
    return window;
  });

  const icon = {
    resize: vi.fn(() => icon),
  };
  const ipcMain = {
    handle: vi.fn(),
    on: vi.fn(),
  };
  const Menu = {
    buildFromTemplate: vi.fn(() => ({
      popup: vi.fn(),
    })),
  };
  const Tray = vi.fn(function Tray() {
    return {
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
    };
  });

  return {
    app,
    appListeners,
    BrowserWindow,
    ipcMain,
    Menu,
    nativeImage: {
      createEmpty: vi.fn(() => icon),
      createFromPath: vi.fn(() => icon),
    },
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
      getPrimaryDisplay: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
    },
    Tray,
    windows,
  };
});

vi.mock('electron', () => electron);

beforeAll(async () => {
  await import('./main.js');
  await Promise.resolve();
});

describe('Electron process lifecycle', () => {
  it('handles window-all-closed without an event argument', () => {
    const windowAllClosed = electron.appListeners.get('window-all-closed');

    expect(windowAllClosed).toBeTypeOf('function');
    expect(() => windowAllClosed()).not.toThrow();
  });

  it('does not call preventDefault for window-all-closed', () => {
    const windowAllClosed = electron.appListeners.get('window-all-closed');
    const preventDefault = vi.fn();

    windowAllClosed({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('registers process IPC once and targets recreated windows safely', () => {
    const activate = electron.appListeners.get('activate');
    const firstPetWindow = electron.windows[0];

    firstPetWindow.destroyed = true;
    activate();
    const secondPetWindow = electron.windows.at(-1);

    secondPetWindow.destroyed = true;
    activate();
    const currentPetWindow = electron.windows.at(-1);

    for (const channel of ['pet:open-settings', 'pet:manual-dock']) {
      const registrations = electron.ipcMain.handle.mock.calls
        .filter(([registeredChannel]) => registeredChannel === channel);
      expect(registrations).toHaveLength(1);
    }
    for (const channel of ['pet:drag-window', 'pet:show-context-menu']) {
      const registrations = electron.ipcMain.on.mock.calls
        .filter(([registeredChannel]) => registeredChannel === channel);
      expect(registrations).toHaveLength(1);
    }

    const dragWindow = electron.ipcMain.on.mock.calls
      .find(([channel]) => channel === 'pet:drag-window')[1];
    dragWindow(
      { sender: currentPetWindow.webContents },
      { x: 50.4, y: 60.6 },
    );
    dragWindow(
      { sender: firstPetWindow.webContents },
      { x: 10, y: 20 },
    );

    expect(currentPetWindow.setPosition).toHaveBeenCalledWith(50, 61, false);
    expect(firstPetWindow.setPosition).not.toHaveBeenCalled();

    const openSettings = electron.ipcMain.handle.mock.calls
      .find(([channel]) => channel === 'pet:open-settings')[1];
    openSettings();
    const firstSettingsWindow = electron.windows.at(-1);
    firstSettingsWindow.listeners.get('closed')();
    openSettings();

    const settingsWindows = electron.windows
      .filter((window) => window.options.title === 'Codex Pet Pause 设置');
    expect(settingsWindows).toHaveLength(2);
  });
});
