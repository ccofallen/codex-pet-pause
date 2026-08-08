import { useEffect, useMemo, useState } from 'react';
import { parseAndroidHostSnapshot, type AndroidHostSnapshot } from '../domain/overlayProtocol';
import {
  AndroidOverlayStage,
  type AndroidOverlayMessageHost,
  type AndroidOverlayOutboundMessage,
} from './AndroidOverlayStage';

interface NativeOverlayBridge {
  postMessage(messageJson: string): void;
}

type NativeOverlayMessage =
  | { type: 'state-changed'; snapshot: unknown }
  | { type: 'pet-tap' }
  | { type: 'show-reminder' }
  | { type: 'close-bubble' }
  | { type: 'open-menu'; side: 'left' | 'right' }
  | { type: 'placement-changed'; side: 'left' | 'right' };

declare global {
  interface Window {
    AndroidOverlay?: NativeOverlayBridge;
  }
}

function isNativeOverlayMessage(value: unknown): value is NativeOverlayMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'state-changed') return 'snapshot' in message;
  if (message.type === 'pet-tap' || message.type === 'show-reminder' || message.type === 'close-bubble') return true;
  return (message.type === 'open-menu' || message.type === 'placement-changed')
    && (message.side === 'left' || message.side === 'right');
}

export function AndroidOverlayApp() {
  const [snapshot, setSnapshot] = useState<AndroidHostSnapshot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const host = useMemo<AndroidOverlayMessageHost>(() => ({
    postMessage(message: AndroidOverlayOutboundMessage) {
      window.AndroidOverlay?.postMessage(JSON.stringify(message));
    },
  }), []);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (!isNativeOverlayMessage(value)) return;
      if (value.type === 'state-changed') {
        try {
          const next = parseAndroidHostSnapshot(value.snapshot);
          setSnapshot(next);
          if (next?.settingsJson !== null && next !== null) {
            const settings = JSON.parse(next.settingsJson) as { reminders?: Array<{ status?: string }> };
            if (!settings.reminders?.some(({ status }) => status === 'due')) setBubbleOpen(false);
          }
        } catch {
          setSnapshot(null);
        }
        return;
      }
      if (value.type === 'show-reminder') {
        setMenuOpen(false);
        setBubbleOpen(true);
        return;
      }
      if (value.type === 'close-bubble') {
        setBubbleOpen(false);
        return;
      }
      if (value.type === 'pet-tap') {
        setMenuOpen(false);
        setBubbleOpen((open) => !open);
        return;
      }
      setSide(value.side);
      if (value.type === 'open-menu') {
        setBubbleOpen(false);
        setMenuOpen(true);
      }
    };
    window.addEventListener('android-overlay-message', onMessage);
    host.postMessage({ type: 'overlay-ready' });
    return () => window.removeEventListener('android-overlay-message', onMessage);
  }, [host]);

  if (snapshot === null || snapshot.settingsJson === null) return null;
  return (
    <AndroidOverlayStage
      snapshot={snapshot}
      host={host}
      menuOpen={menuOpen}
      bubbleOpen={bubbleOpen}
      side={side}
    />
  );
}
