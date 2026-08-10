import type { AndroidControlHost } from '../bridge/androidHost';
import { AndroidOnboarding } from './AndroidOnboarding';

export function AndroidCapabilityStatus({ host }: { host?: AndroidControlHost | undefined }) {
  if (host === undefined) return null;

  return <section className="android-capability-status"><AndroidOnboarding host={host} /></section>;
}
