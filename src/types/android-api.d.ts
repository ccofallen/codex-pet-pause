import type { AndroidHost } from '../android/bridge/androidHost';

declare global {
  interface Window {
    androidHost?: AndroidHost;
  }
}

export {};
