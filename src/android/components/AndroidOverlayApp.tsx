import { useEffect, useMemo, useState } from 'react';
import { parseAndroidHostSnapshot, type AndroidHostSnapshot } from '../domain/overlayProtocol';
import {
  AndroidOverlayStage,
  type AndroidPetInteraction,
} from './AndroidOverlayStage';

interface NativeOverlayBridge {
  postMessage(messageJson: string): void;
}

type NativeOverlayMessage =
  | { type: 'state-changed'; snapshot: unknown }
  | { type: 'pet-tap' }
  | { type: 'pet-drag-start' | 'pet-drag-move'; facing: 'left' | 'right' }
  | { type: 'pet-drag-end' }
  | { type: 'placement-changed'; side: 'left' | 'right' };

type AndroidPetOutboundMessage = { type: 'overlay-ready' };

let overlayReadySent = false;

declare global {
  interface Window {
    AndroidOverlay?: NativeOverlayBridge;
  }
}

function isNativeOverlayMessage(value: unknown): value is NativeOverlayMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'state-changed') return 'snapshot' in message;
  if (message.type === 'pet-tap' || message.type === 'pet-drag-end') return true;
  if (message.type === 'pet-drag-start' || message.type === 'pet-drag-move') {
    return message.facing === 'left' || message.facing === 'right';
  }
  return message.type === 'placement-changed'
    && (message.side === 'left' || message.side === 'right');
}

export function isAndroidPetOverlayRoute(search: string): boolean {
  const overlay = new URLSearchParams(search).get('overlay');
  return overlay === 'pet' || overlay === '1';
}

export function AndroidOverlayApp() {
  const [snapshot, setSnapshot] = useState<AndroidHostSnapshot | null>(null);
  const [interaction, setInteraction] = useState<AndroidPetInteraction>({ type: 'idle', sequence: 0 });
  const host = useMemo(() => ({
    postMessage(message: AndroidPetOutboundMessage) {
      window.AndroidOverlay?.postMessage(JSON.stringify(message));
    },
  }), []);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (!isNativeOverlayMessage(value)) return;
      if (value.type === 'state-changed') {
        try {
          setSnapshot(parseAndroidHostSnapshot(value.snapshot));
        } catch {
          // Keep the last valid pet snapshot when native sends malformed or unsupported state.
        }
        return;
      }
      if (value.type === 'pet-tap') {
        setInteraction((current) => ({ type: 'tap', sequence: current.sequence + 1 }));
        return;
      }
      if (value.type === 'pet-drag-start' || value.type === 'pet-drag-move') {
        setInteraction((current) => ({ type: 'drag', facing: value.facing, sequence: current.sequence + 1 }));
        return;
      }
      if (value.type === 'pet-drag-end') {
        setInteraction((current) => ({ type: 'idle', sequence: current.sequence + 1 }));
      }
    };
    window.addEventListener('android-overlay-message', onMessage);
    if (!overlayReadySent) {
      overlayReadySent = true;
      host.postMessage({ type: 'overlay-ready' });
    }
    return () => window.removeEventListener('android-overlay-message', onMessage);
  }, [host]);

  useEffect(() => {
    if (interaction.type !== 'tap') return undefined;
    const timer = window.setTimeout(() => {
      setInteraction((current) => current.type === 'tap'
        ? { type: 'idle', sequence: current.sequence + 1 }
        : current);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [interaction]);

  if (snapshot === null || snapshot.settingsJson === null) return null;
  return <AndroidOverlayStage snapshot={snapshot} interaction={interaction} />;
}
