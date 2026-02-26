/**
 * Manages the lifecycle of the execution Web Worker and provides a
 * Promise-based API for sending execution requests and receiving results.
 *
 * The worker is lazily instantiated on first use and can be terminated
 * explicitly. If Workers are not supported (e.g., SSR or very old browsers),
 * `getExecutionWorker()` returns null and callers should fall back to
 * main-thread execution.
 */
import type { ExecuteMessage, WorkerResponse, ExecuteResultMessage } from './execution.worker';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: (value: ExecuteResultMessage) => void; reject: (reason: Error) => void }>();
const watchdogs = new Map<number, ReturnType<typeof setTimeout>>();

/** Grace period added to maxExecutionMs for the watchdog timer (ms). */
const WATCHDOG_GRACE_MS = 2000;

/** Timeout for health-check ping/pong (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Pending health-check resolvers keyed by message id. */
const healthChecks = new Map<number, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/**
 * Lazily create and return the execution worker.
 * Returns `null` if Workers cannot be instantiated (graceful fallback).
 */
export function getExecutionWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(
      new URL('./execution.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id } = event.data;

      // Handle health-check pong responses
      if (event.data.type === 'pong') {
        const hc = healthChecks.get(id);
        if (hc) { clearTimeout(hc.timer); healthChecks.delete(id); hc.resolve(true); }
        return;
      }

      // Clear watchdog timer for this request
      const wd = watchdogs.get(id);
      if (wd) { clearTimeout(wd); watchdogs.delete(id); }

      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);

      if (event.data.type === 'result') {
        p.resolve(event.data);
      } else {
        p.reject(new Error(event.data.message));
      }
    };

    worker.onerror = (err) => {
      // Reject all outstanding requests and destroy the broken worker
      for (const [, p] of pending) {
        p.reject(new Error('Worker error: ' + err.message));
      }
      pending.clear();
      terminateExecutionWorker();
    };

    return worker;
  } catch {
    // Worker construction failed — environment doesn't support it
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execution API
// ---------------------------------------------------------------------------

/**
 * Send an execution request to the worker and return a Promise that resolves
 * with the execution result.
 *
 * @param payload  All fields of an `ExecuteMessage` except `type` and `id`
 *                 (those are filled in automatically).
 */
export function executeInWorker(
  payload: Omit<ExecuteMessage, 'type' | 'id'>,
): Promise<ExecuteResultMessage> {
  const w = getExecutionWorker();
  if (!w) return Promise.reject(new Error('Worker not available'));

  const id = ++messageId;

  return new Promise<ExecuteResultMessage>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...payload, type: 'execute', id } satisfies ExecuteMessage);

    // Set up watchdog timer: if the worker doesn't respond within
    // maxExecutionMs + grace period, forcefully terminate it.
    const timeoutMs = payload.maxExecutionMs;
    if (timeoutMs && timeoutMs > 0) {
      const wd = setTimeout(() => {
        watchdogs.delete(id);
        if (pending.has(id)) {
          // Worker hasn't responded — force terminate and recreate
          terminateExecutionWorker();
        }
      }, timeoutMs + WATCHDOG_GRACE_MS);
      watchdogs.set(id, wd);
    }
  });
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Send a ping to the worker and wait for a pong response.
 * Resolves `true` if the worker responds within the timeout, `false` otherwise.
 * If the worker is unresponsive, it is terminated and will be recreated on next use.
 */
export function checkWorkerHealth(): Promise<boolean> {
  const w = getExecutionWorker();
  if (!w) return Promise.resolve(false);

  const id = ++messageId;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      healthChecks.delete(id);
      // Worker is unresponsive — terminate and recreate on next use
      terminateExecutionWorker();
      resolve(false);
    }, HEALTH_CHECK_TIMEOUT_MS);

    healthChecks.set(id, { resolve, timer });
    w.postMessage({ type: 'ping', id });
  });
}

// ---------------------------------------------------------------------------
// Background health monitor
// ---------------------------------------------------------------------------

/** Interval handle for the periodic health monitor. */
let healthMonitorInterval: ReturnType<typeof setInterval> | null = null;

/** How often to ping the worker (ms). */
const HEALTH_MONITOR_INTERVAL_MS = 30_000;

/**
 * Start a periodic background health monitor.
 * Sends a ping every 30s and terminates the worker if no pong within 5s.
 * Automatically restarts when the worker is next needed via lazy instantiation.
 * Idempotent — calling multiple times reuses the existing monitor.
 */
export function startHealthMonitor(): void {
  if (healthMonitorInterval) return;
  healthMonitorInterval = setInterval(() => {
    // Only check if the worker has been instantiated
    if (!worker) return;
    checkWorkerHealth(); // Handles termination on timeout
  }, HEALTH_MONITOR_INTERVAL_MS);
}

/** Stop the background health monitor. */
export function stopHealthMonitor(): void {
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
    healthMonitorInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Terminate the worker and reject any pending requests. */
export function terminateExecutionWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // Stop the health monitor since the worker is gone
  stopHealthMonitor();
  // Clear all watchdog timers
  for (const [, wd] of watchdogs) {
    clearTimeout(wd);
  }
  watchdogs.clear();
  // Reject all pending requests
  for (const [, p] of pending) {
    p.reject(new Error('Worker terminated'));
  }
  pending.clear();
  // Resolve all pending health checks as failed
  for (const [, hc] of healthChecks) {
    clearTimeout(hc.timer);
    hc.resolve(false);
  }
  healthChecks.clear();
}
