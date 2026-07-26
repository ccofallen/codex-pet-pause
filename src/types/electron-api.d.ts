declare global {
  interface Window {
    petShell?: {
      openSettings?: () => void;
      dockNow?: () => void;
      dragWindowTo?: (x: number, y: number) => void;
      showContextMenu?: (x?: number, y?: number) => void;
    };
  }
}

export {};
