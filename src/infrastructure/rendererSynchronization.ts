export const RENDERER_STATE_SYNC_KEY = 'neko-pause:renderer-state-sync';

const CHANNEL_NAME = 'neko-pause:renderer-state';

interface RendererSyncMessage {
  type: 'state-changed';
  token: string;
}

export interface RendererSynchronization {
  notify(): void;
  subscribe(listener: () => void): () => void;
  close(): void;
}

let tokenSequence = 0;

function nextToken(): string {
  tokenSequence += 1;
  return `${Date.now()}:${tokenSequence}:${Math.random()}`;
}

function isSyncMessage(value: unknown): value is RendererSyncMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RendererSyncMessage>;
  return message.type === 'state-changed' && typeof message.token === 'string';
}

export function createRendererSynchronization(): RendererSynchronization {
  const listeners = new Set<() => void>();
  let closed = false;
  let lastToken: string | undefined;
  let channel: BroadcastChannel | undefined;
  let unsubscribeNative = (): void => undefined;

  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
    }
  } catch {
    channel = undefined;
  }

  const receive = (token?: string): void => {
    if (closed || (token !== undefined && token === lastToken)) return;
    if (token !== undefined) lastToken = token;
    listeners.forEach((listener) => listener());
  };

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== RENDERER_STATE_SYNC_KEY) return;
    receive(event.newValue ?? undefined);
  };

  window.addEventListener('storage', onStorage);
  if (channel !== undefined) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isSyncMessage(event.data)) receive(event.data.token);
    };
  }
  try {
    unsubscribeNative = window.petShell?.onStateChanged?.(() => receive())
      ?? (() => undefined);
  } catch {
    unsubscribeNative = () => undefined;
  }

  return {
    notify(): void {
      if (closed) return;
      const token = nextToken();
      lastToken = token;
      try {
        window.localStorage.setItem(RENDERER_STATE_SYNC_KEY, token);
      } catch {
        // BroadcastChannel remains available when storage signaling is unavailable.
      }
      try {
        channel?.postMessage({ type: 'state-changed', token } satisfies RendererSyncMessage);
      } catch {
        // Storage events remain available when BroadcastChannel delivery fails.
      }
      try {
        window.petShell?.notifyStateChanged?.();
      } catch {
        // Browser synchronization remains available when native IPC delivery fails.
      }
    },

    subscribe(listener): () => void {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close(): void {
      if (closed) return;
      closed = true;
      listeners.clear();
      window.removeEventListener('storage', onStorage);
      unsubscribeNative();
      if (channel !== undefined) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}
