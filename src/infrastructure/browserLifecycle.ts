import { getNextSchedulerWakeAt, type AppController } from '../app/appController';

const SAFETY_INTERVAL_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

type LifecycleController = Pick<
  AppController,
  'getSnapshot' | 'subscribe' | 'reconcileNow'
>;

export function startBrowserLifecycle(controller: LifecycleController): () => void {
  let stopped = false;
  let reconciling = false;
  let pending = false;
  let exactTimer: number | undefined;

  const clearExactTimer = () => {
    if (exactTimer !== undefined) window.clearTimeout(exactTimer);
    exactTimer = undefined;
  };

  const scheduleExactWake = () => {
    clearExactTimer();
    if (stopped) return;
    const now = Date.now();
    const wakeAt = getNextSchedulerWakeAt(controller.getSnapshot(), now);
    if (wakeAt === undefined) return;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, Math.ceil(wakeAt - now)));
    exactTimer = window.setTimeout(() => runReconcile(), delay);
  };

  const runReconcile = () => {
    if (stopped) return;
    if (reconciling) {
      pending = true;
      return;
    }
    reconciling = true;
    clearExactTimer();
    void controller.reconcileNow().catch(() => undefined).finally(() => {
      reconciling = false;
      if (stopped) return;
      if (pending) {
        pending = false;
        runReconcile();
      } else {
        scheduleExactWake();
      }
    });
  };

  const unsubscribe = controller.subscribe(scheduleExactWake);
  const safetyTimer = window.setInterval(runReconcile, SAFETY_INTERVAL_MS);
  window.addEventListener('focus', runReconcile);
  document.addEventListener('visibilitychange', runReconcile);
  scheduleExactWake();

  return () => {
    stopped = true;
    clearExactTimer();
    window.clearInterval(safetyTimer);
    unsubscribe();
    window.removeEventListener('focus', runReconcile);
    document.removeEventListener('visibilitychange', runReconcile);
  };
}
