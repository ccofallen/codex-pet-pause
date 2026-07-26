import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  Menu,
  screen,
  Tray,
  nativeImage,
  ipcMain,
} from 'electron';

const IS_DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const EDGE_HANDLE_SIZE = 24;
const DOCK_THRESHOLD = 26;
const HANDLE_RESTORE_POLL_MS = 160;
const EDGE_DOCKING_ENABLED = false;
const HAS_TRANSPARENT_WINDOW = true;
const DEFAULT_BOUNDS = {
  width: 360,
  height: 280,
  x: 180,
  y: 180,
};
const STATE_FILE = 'pet-dock-state.json';
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function fileUrlFromAbsolutePath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `file://${normalized}`;
}

const stateFilePath = path.join(app.getPath('userData'), STATE_FILE);

/** @typedef {{x:number,y:number,width:number,height:number}|undefined} DockedBounds */
/** @typedef {{isDocked:boolean,edge:null|"left"|"right"|"top"|"bottom",bounds?:DockedBounds}} DockState */

let petWindow;
let settingsWindow;
let tray;
let dockState = {
  isDocked: false,
  edge: null,
  hiddenBounds: undefined,
  restoredBounds: undefined,
};
let moveDebounce;
let handlePoll;
let isRestoring = false;

function readPersistedState() {
  try {
    const raw = fs.readFileSync(stateFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.width && parsed.height && parsed.width > 0 && parsed.height > 0) {
      return parsed;
    }
  } catch {
    // noop
  }
  return undefined;
}

function persistState(next) {
  try {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(next), 'utf8');
  } catch {
    // noop
  }
}

function resolveWindowUrl(mode) {
  if (IS_DEV) {
    const host = '127.0.0.1';
    const port = process.env.PET_PAUSE_DEV_PORT ?? '5173';
    return `http://${host}:${port}/?mode=${mode}`;
  }
  return `${fileUrlFromAbsolutePath(path.join(CURRENT_DIR, '..', 'dist', 'index.html'))}?mode=${mode}`;
}

function resolveAssetPath(filename) {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icons', 'png', '512x512.png'),
    path.join(CURRENT_DIR, '..', 'build', 'icons', 'png', '512x512.png'),
    path.join(app.getAppPath(), 'public', 'icons', filename),
    path.join(CURRENT_DIR, '..', 'public', 'icons', filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function createTrayIcon() {
  const iconPath = resolveAssetPath('pwa-192x192.png') ?? resolveAssetPath('pwa-512x512.png');
  if (iconPath === undefined) {
    return nativeImage.createEmpty().resize({ width: 16, height: 16 });
  }
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function ensureBoundsInsideDisplay(bounds, displayBounds) {
  return {
    ...bounds,
    x: Math.max(displayBounds.x, Math.min(bounds.x, displayBounds.x + displayBounds.width - bounds.width)),
    y: Math.max(displayBounds.y, Math.min(bounds.y, displayBounds.y + displayBounds.height - bounds.height)),
  };
}

function getDisplayWorkArea(winBounds) {
  const activeDisplay = screen.getDisplayMatching(winBounds);
  return activeDisplay.workArea;
}

function getPrimaryWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function isCursorInHandle(win, point) {
  if (!EDGE_DOCKING_ENABLED) return false;
  if (!dockState.isDocked || dockState.restoredBounds === undefined || win === undefined) {
    return false;
  }
  const bounds = win.getBounds();
  const area = getDisplayWorkArea(bounds);
  if (dockState.edge === 'left') {
    return point.x <= area.x + EDGE_HANDLE_SIZE
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height;
  }
  if (dockState.edge === 'right') {
    return point.x >= area.x + area.width - EDGE_HANDLE_SIZE
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height;
  }
  if (dockState.edge === 'top') {
    return point.y <= area.y + EDGE_HANDLE_SIZE
      && point.x >= bounds.x
      && point.x <= bounds.x + bounds.width;
  }
  if (dockState.edge === 'bottom') {
    return point.y >= area.y + area.height - EDGE_HANDLE_SIZE
      && point.x >= bounds.x
      && point.x <= bounds.x + bounds.width;
  }
  return false;
}

function applyDockedBounds(win, edge, bounds) {
  const area = getDisplayWorkArea(bounds);
  if (edge === 'left') {
    return {
      x: area.x - bounds.width + EDGE_HANDLE_SIZE,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }
  if (edge === 'right') {
    return {
      x: area.x + area.width - EDGE_HANDLE_SIZE,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }
  if (edge === 'top') {
    return {
      x: bounds.x,
      y: area.y - bounds.height + EDGE_HANDLE_SIZE,
      width: bounds.width,
      height: bounds.height,
    };
  }
  return {
    x: bounds.x,
    y: area.y + area.height - EDGE_HANDLE_SIZE,
    width: bounds.width,
    height: bounds.height,
  };
}

function dockToNearestEdge(win, preferredEdge) {
  if (!EDGE_DOCKING_ENABLED) return;
  if (win === undefined) return;
  const bounds = win.getBounds();
  const area = getDisplayWorkArea(bounds);
  const leftDistance = Math.abs(bounds.x - area.x);
  const rightDistance = Math.abs((bounds.x + bounds.width) - (area.x + area.width));
  const topDistance = Math.abs(bounds.y - area.y);
  const bottomDistance = Math.abs((bounds.y + bounds.height) - (area.y + area.height));

  const distances = [
    { edge: 'left', distance: leftDistance },
    { edge: 'right', distance: rightDistance },
    { edge: 'top', distance: topDistance },
    { edge: 'bottom', distance: bottomDistance },
  ];
  const nearest = preferredEdge
    ? distances.find(({ edge }) => edge === preferredEdge)
    : distances.reduce((a, b) => a.distance <= b.distance ? a : b);

  if (nearest === undefined) return;
  const isManualDock = preferredEdge !== undefined && preferredEdge !== null;

  if (!isManualDock && nearest.distance > DOCK_THRESHOLD) {
    dockState.isDocked = false;
    dockState.edge = null;
    dockState.hiddenBounds = undefined;
    return;
  }

  const docked = applyDockedBounds(win, nearest.edge, bounds);
  dockState = {
    isDocked: true,
    edge: nearest.edge,
    hiddenBounds: docked,
    restoredBounds: ensureBoundsInsideDisplay(bounds, area),
  };
  isRestoring = true;
  win.setBounds(docked, true);
  persistState({ ...bounds, x: docked.x, y: docked.y, edge: nearest.edge, isDocked: true });
  isRestoring = false;
  startHandlePoll(win);
}

function restoreFromDock(win) {
  if (!EDGE_DOCKING_ENABLED) return;
  if (!dockState.isDocked || dockState.restoredBounds === undefined) {
    return;
  }
  isRestoring = true;
  win.setBounds(dockState.restoredBounds, true);
  dockState.isDocked = false;
  dockState.edge = null;
  dockState.hiddenBounds = undefined;
  dockState.restoredBounds = undefined;
  persistState({ ...win.getBounds(), isDocked: false, edge: null });
  isRestoring = false;
}

function showPetContextMenu(win, x, y) {
  if (win === undefined || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const cursorPoint = screen.getCursorScreenPoint();
  const safeCursor = Number.isFinite(cursorPoint.x) && Number.isFinite(cursorPoint.y)
    ? {
      x: cursorPoint.x - bounds.x,
      y: cursorPoint.y - bounds.y,
    }
    : {
      x: 0,
      y: 0,
    };
  const safePoint = Number.isFinite(x) && Number.isFinite(y)
    ? {
      x: Math.round(x) - bounds.x,
      y: Math.round(y) - bounds.y,
    }
    : safeCursor;
  const popupX = Math.max(0, Math.min(Math.max(0, bounds.width - 1), Math.round(safePoint.x)));
  const popupY = Math.max(0, Math.min(Math.max(0, bounds.height - 1), Math.round(safePoint.y)));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开设置',
      click: () => {
        openSettingsWindow();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      role: 'quit',
    },
  ]);
  const safePopupOptions = {
    window: win,
    x: popupX,
    y: popupY,
  };
  contextMenu.popup({
    ...safePopupOptions,
  });
}

function moveWindowTo(win, x, y) {
  if (win === undefined || win.isDestroyed()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  win.setPosition(Math.round(x), Math.round(y), false);
}

function startHandlePoll(win) {
  if (!EDGE_DOCKING_ENABLED) return;
  stopHandlePoll();
  handlePoll = setInterval(() => {
    if (win === undefined || win.isDestroyed()) {
      stopHandlePoll();
      return;
    }
    if (!dockState.isDocked) return;
    const point = screen.getCursorScreenPoint();
    if (isCursorInHandle(win, point)) {
      restoreFromDock(win);
    }
  }, HANDLE_RESTORE_POLL_MS);
}

function stopHandlePoll() {
  if (handlePoll === undefined) {
    return;
  }
  clearInterval(handlePoll);
  handlePoll = undefined;
}

function bindMoveEvents(win) {
  if (!EDGE_DOCKING_ENABLED) return;
  win.on('move', () => {
    if (isRestoring) return;
    stopHandlePoll();
    if (moveDebounce !== undefined) clearTimeout(moveDebounce);
    moveDebounce = setTimeout(() => {
      if (!win.isDestroyed()) dockToNearestEdge(win);
    }, 140);
  });
}

function createWindow() {
  const workspace = getPrimaryWorkArea();
  const persisted = readPersistedState();
  const safeInitialX = Number.isFinite(persisted?.x) ? persisted.x : DEFAULT_BOUNDS.x;
  const safeInitialY = Number.isFinite(persisted?.y) ? persisted.y : DEFAULT_BOUNDS.y;
  const windowState = {
    ...DEFAULT_BOUNDS,
    x: safeInitialX,
    y: safeInitialY,
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
  };
  const clampedWindowState = ensureBoundsInsideDisplay(windowState, workspace);

  petWindow = new BrowserWindow({
    width: clampedWindowState.width,
    height: clampedWindowState.height,
    x: clampedWindowState.x,
    y: clampedWindowState.y,
    frame: false,
    transparent: HAS_TRANSPARENT_WINDOW,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    icon: resolveAssetPath('pwa-192x192.png') ?? resolveAssetPath('pwa-512x512.png') ?? undefined,
    backgroundColor: HAS_TRANSPARENT_WINDOW ? '#00000000' : '#1c1c1d',
    resizable: false,
    movable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(CURRENT_DIR, 'preload.js'),
      contextIsolation: true,
    },
  });

  if (typeof petWindow.setVisibleOnAllWorkspaces === 'function') {
    try {
      petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // no-op: some Linux/Windows environments may not support this property.
    }
  }

  if (EDGE_DOCKING_ENABLED) {
    bindMoveEvents(petWindow);
  }

  petWindow.once('ready-to-show', () => {
    petWindow.show();
    if (EDGE_DOCKING_ENABLED && persisted?.isDocked === true && persisted.edge) {
      dockState.isDocked = true;
      dockState.edge = persisted.edge;
      dockState.restoredBounds = {
        width: clampedWindowState.width,
        height: clampedWindowState.height,
        x: clampedWindowState.x,
        y: clampedWindowState.y,
      };
      dockToNearestEdge(petWindow);
    }
  });

  petWindow.loadURL(resolveWindowUrl('desktop'));

  ipcMain.handle('pet:open-settings', () => {
    openSettingsWindow();
  });

  ipcMain.handle('pet:manual-dock', () => {
    if (!EDGE_DOCKING_ENABLED) return;
    dockToNearestEdge(petWindow, 'left');
  });

  ipcMain.on('pet:drag-window', (event, payload) => {
    const safeEvent = event.sender;
    if (safeEvent === undefined) return;
    if (!petWindow || petWindow.webContents.id !== safeEvent.id) return;
    if (!payload || typeof payload !== 'object') return;
    moveWindowTo(petWindow, payload.x, payload.y);
  });

  ipcMain.on('pet:show-context-menu', (event, payload) => {
    const safeEvent = event.sender;
    if (safeEvent === undefined) return;
    if (!petWindow || petWindow.webContents.id !== safeEvent.id) return;
    const safeX = payload?.x;
    const safeY = payload?.y;
    if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) {
      showPetContextMenu(petWindow);
      return;
    }
    showPetContextMenu(petWindow, safeX, safeY);
  });
}

function createTray() {
  const builtInIcon = createTrayIcon();
  tray = new Tray(builtInIcon);
  tray.setToolTip('Codex Pet Pause');
  const template = [
    {
      label: '打开设置',
      click: () => {
        openSettingsWindow();
      },
    },
  ];
  if (EDGE_DOCKING_ENABLED) {
    template.push({
      label: '恢复贴边窗体',
      click: () => {
        if (!petWindow?.isDestroyed()) restoreFromDock(petWindow);
      },
    });
    template.push({
      type: 'separator',
    });
  }
  template.push({
    label: '退出',
    role: 'quit',
  });
  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

function openSettingsWindow() {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1024,
    height: 760,
    title: 'Codex Pet Pause 设置',
    autoHideMenuBar: true,
    icon: resolveAssetPath('pwa-192x192.png') ?? resolveAssetPath('pwa-512x512.png') ?? undefined,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(CURRENT_DIR, 'preload.js'),
    },
  });

  settingsWindow.loadURL(resolveWindowUrl('web&view=settings&hidePet=1'));
  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('io.elevenlabs.codexpetpause');
  }
  createWindow();
  createTray();

  app.on('activate', () => {
    if (petWindow === undefined || petWindow.isDestroyed()) {
      createWindow();
    }
    if (petWindow.isMinimized()) petWindow.restore();
    petWindow.focus();
  });
});

app.on('before-quit', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    stopHandlePoll();
    const bounds = petWindow.getBounds();
    persistState({
      ...bounds,
      edge: null,
      isDocked: false,
    });
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
