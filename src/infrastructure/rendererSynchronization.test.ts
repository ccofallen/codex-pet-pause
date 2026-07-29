import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRendererSynchronization } from './rendererSynchronization';

describe('renderer synchronization', () => {
  afterEach(() => {
    delete window.petShell;
  });

  test('uses native Electron IPC when browser channels are unreliable', () => {
    const notifyStateChanged = vi.fn();
    const unsubscribe = vi.fn();
    let receiveNative: (() => void) | undefined;
    window.petShell = {
      notifyStateChanged,
      onStateChanged(callback) {
        receiveNative = callback;
        return unsubscribe;
      },
    };
    const synchronization = createRendererSynchronization();
    const listener = vi.fn();
    synchronization.subscribe(listener);

    synchronization.notify();
    expect(notifyStateChanged).toHaveBeenCalledOnce();
    receiveNative?.();
    expect(listener).toHaveBeenCalledOnce();

    synchronization.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
