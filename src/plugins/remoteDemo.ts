/**
 * Built-in demo plugin: a node that executes on the active ExecutionBackend
 * (see `utils/remoteExecution.ts`) instead of in the synchronous graph engine.
 *
 * This is the first *tangible* use of the remote-execution seam from the spike.
 * It registers through the normal plugin registry (so it shows up in every node
 * palette automatically) and flags its type as remote, which:
 *   - makes its processor return whatever result is cached on the node
 *     (`remoteCachedResult`), exactly like `http-fetch` reads its cache;
 *   - lets the on-node UI (`RemoteNodeExtras`) and the auto-dispatch hook
 *     (`useRemoteAutoDispatch`) recognise it via `isRemoteNodeType`.
 *
 * With the default `MockExecutionBackend` the whole path runs in-process — no
 * server needed. Swap the backend with `setExecutionBackend` to point a real
 * remote node type at HTTP/WebSocket/GPU-queue transport.
 */
import { registerPlugin, isPluginType } from '../store/pluginStore';
import {
  registerRemoteNodeType,
  remoteCachedResult,
  getExecutionBackend,
  setExecutionBackend,
  MockExecutionBackend,
} from '../utils/remoteExecution';
import type { PluginNodeDef } from '../types';

/** The demo remote node type id. */
export const REMOTE_COMPUTE_TYPE = 'remote-compute';

const remoteComputeDef: PluginNodeDef = {
  type: REMOTE_COMPUTE_TYPE,
  name: 'Remote Compute',
  color: 'teal',
  category: 'Remote',
  inputs: [
    { label: 'A', portType: 'number' },
    { label: 'B', portType: 'number' },
  ],
  outputs: [
    { label: 'Result', portType: 'any' },
    { label: 'Status', portType: 'string' },
    { label: 'Error', portType: 'string' },
  ],
  // Synchronous processor: just surface the cached remote result. The real work
  // happens out-of-band in `dispatchRemoteNode`, which writes the result onto
  // the node and re-runs the graph so this picks it up.
  processor: (node) => remoteCachedResult(node),
};

export interface RegisterBuiltInPluginsOptions {
  /**
   * Give the demo MockExecutionBackend per-step latency so the on-node
   * progress bar is visible (the pristine default resolves on microtasks —
   * the bar snaps to 100% and Cancel never shows). Omit (tests) to leave the
   * active backend untouched.
   */
  demoBackendLatencyMs?: number;
}

/**
 * Register the built-in demo plugins. Idempotent — safe to call from an effect
 * that may run more than once (StrictMode double-mount, HMR).
 */
export function registerBuiltInPlugins(opts: RegisterBuiltInPluginsOptions = {}): void {
  if (!isPluginType(REMOTE_COMPUTE_TYPE)) {
    registerPlugin(remoteComputeDef);
  }
  // A Set add; idempotent regardless of plugin registration state.
  registerRemoteNodeType(REMOTE_COMPUTE_TYPE);

  // Only upgrade the pristine default mock (id 'mock') — never clobber a real
  // backend someone installed, and stay idempotent (the demo backend has its
  // own id, so a second call is a no-op).
  if (opts.demoBackendLatencyMs !== undefined && getExecutionBackend().id === 'mock') {
    setExecutionBackend(
      new MockExecutionBackend({ id: 'mock-demo', latencyMs: opts.demoBackendLatencyMs, steps: 6 }),
    );
  }
}
