declare global {
  interface Window {
    petShell?: {
      openSettings?: () => void;
      openPetdex?: () => Promise<void>;
      onPetdexImport?: (callback: (event:
        | { type: 'archive'; name: string; bytes: ArrayBuffer }
        | { type: 'error' }
      ) => void) => () => void;
      notifyStateChanged?: () => void;
      onStateChanged?: (callback: () => void) => () => void;
      dockNow?: () => void;
      dragWindowTo?: (x: number, y: number) => void;
      showContextMenu?: (x?: number, y?: number) => void;
    };
  }
}

export {};
