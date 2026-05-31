/**
 * Remote-execution seam (spike).
 *
 * Generalizes the async side-channel pattern that `http-fetch` already uses
 * (processor returns a cached result; an out-of-band dispatcher does the async
 * work, writes the result back onto the node, then re-runs the graph) into a
 * pluggable **ExecutionBackend**. This is the foundation for a ComfyUI-style
 * direction where some nodes execute on a server (GPU jobs, long-running tasks)
 * while the rest execute locally — the synchronous graph engine is untouched.
 *
 * How it fits the existing engine:
 *  - A remote node's *processor* stays synchronous and just returns whatever
 *    result is currently cached on the node (`remoteCachedResult`).
 *  - `dispatchRemote` runs the node on the active backend, streaming progress,
 *    and resolves with the result. The store action that calls it writes the
 *    result onto the node and schedules a re-run, exactly like `fetchNodeData`.
 *  - The default backend is an in-process mock so the whole path is runnable
 *    and testable without a server; swap it with `setExecutionBackend`.
 */

/** A request to execute one node remotely. */
export interface RemoteRequest {
  nodeId: string;
  /** Node type (built-in union member or a plugin type string). */
  nodeType: string;
  /** Resolved input values, keyed by input port index. */
  inputs: Record<number, unknown>;
  /** A snapshot of the node's `data` (params/config the backend may need). */
  data: Record<string, unknown>;
}

/** The result of a remote execution. `outputs` is keyed by output port index. */
export interface RemoteResult {
  status: 'ok' | 'error';
  outputs: Record<number, unknown>;
  error?: string;
}

/** Progress callback: `progress` is 0..1; `message` is an optional status line. */
export type RemoteProgressFn = (progress: number, message?: string) => void;

/**
 * A pluggable execution backend. Implementations dispatch a node somewhere
 * (HTTP, WebSocket, worker pool, in-process mock) and report progress as the
 * job runs. `execute` should reject (or honour `signal`) on cancellation.
 */
export interface ExecutionBackend {
  readonly id: string;
  execute(
    req: RemoteRequest,
    onProgress: RemoteProgressFn,
    signal?: AbortSignal,
  ): Promise<RemoteResult>;
}

// ── Abort helpers ──────────────────────────────────────────────────────────

function makeAbortError(): Error {
  const e = new Error('Remote execution cancelled');
  e.name = 'AbortError';
  return e;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

// ── Mock backend ─────────────────────────────────────────────────────────

export interface MockBackendOptions {
  id?: string;
  /** Number of progress steps emitted before resolving (default 4). */
  steps?: number;
  /** Delay per step in ms. 0 (default) resolves on microtasks — fast & deterministic for tests. */
  latencyMs?: number;
  /** Force a failure result; `true` uses a default message, a string uses it verbatim. */
  fail?: boolean | string;
  /** Maps inputs → outputs. Defaults to summing numeric inputs into output 0. */
  compute?: (inputs: Record<number, unknown>, req: RemoteRequest) => Record<number, unknown>;
}

/** Default compute: sum the numeric inputs into output 0, tag the source in output 1. */
function defaultCompute(inputs: Record<number, unknown>, req: RemoteRequest): Record<number, unknown> {
  let sum = 0;
  for (const v of Object.values(inputs)) {
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return { 0: sum, 1: `computed remotely (${req.nodeType})` };
}

/**
 * In-process backend that simulates an async remote job: emits a few progress
 * ticks, then resolves with a computed result. Used as the default backend so
 * the seam works end-to-end without a server.
 */
export class MockExecutionBackend implements ExecutionBackend {
  readonly id: string;
  private readonly steps: number;
  private readonly latencyMs: number;
  private readonly fail: boolean | string;
  private readonly compute: (inputs: Record<number, unknown>, req: RemoteRequest) => Record<number, unknown>;

  constructor(opts: MockBackendOptions = {}) {
    this.id = opts.id ?? 'mock';
    this.steps = Math.max(1, opts.steps ?? 4);
    this.latencyMs = Math.max(0, opts.latencyMs ?? 0);
    this.fail = opts.fail ?? false;
    this.compute = opts.compute ?? defaultCompute;
  }

  private wait(): Promise<void> {
    return this.latencyMs > 0
      ? new Promise(resolve => setTimeout(resolve, this.latencyMs))
      : Promise.resolve();
  }

  async execute(req: RemoteRequest, onProgress: RemoteProgressFn, signal?: AbortSignal): Promise<RemoteResult> {
    if (signal?.aborted) throw makeAbortError();
    for (let i = 1; i <= this.steps; i++) {
      await this.wait();
      if (signal?.aborted) throw makeAbortError();
      onProgress(i / this.steps, `step ${i}/${this.steps}`);
    }
    if (this.fail) {
      return { status: 'error', outputs: {}, error: typeof this.fail === 'string' ? this.fail : 'mock backend failure' };
    }
    return { status: 'ok', outputs: this.compute(req.inputs, req) };
  }
}

// ── Backend registry ───────────────────────────────────────────────────────

let currentBackend: ExecutionBackend = new MockExecutionBackend();

/** The backend remote dispatches currently use. */
export function getExecutionBackend(): ExecutionBackend {
  return currentBackend;
}

/** Swap the active backend (e.g. an HTTP/WebSocket client pointing at a server). */
export function setExecutionBackend(backend: ExecutionBackend): void {
  currentBackend = backend;
}

// Node types flagged to execute remotely. A real integration would also gate on
// per-node config; this set is the simplest registry for the spike.
const remoteNodeTypes = new Set<string>();

export function registerRemoteNodeType(type: string): void {
  remoteNodeTypes.add(type);
}

export function unregisterRemoteNodeType(type: string): void {
  remoteNodeTypes.delete(type);
}

export function isRemoteNodeType(type: string): boolean {
  return remoteNodeTypes.has(type);
}

/** Test hook: restore the default mock backend and clear remote-type registrations. */
export function _resetRemoteExecution(): void {
  currentBackend = new MockExecutionBackend();
  remoteNodeTypes.clear();
}

// ── Dispatch ─────────────────────────────────────────────────────────────

export interface DispatchOptions {
  onProgress?: RemoteProgressFn;
  signal?: AbortSignal;
  /** Override the backend for this dispatch (defaults to the active backend). */
  backend?: ExecutionBackend;
}

/**
 * Run one node on a backend, normalizing thrown errors and cancellation into a
 * `RemoteResult` so callers never have to try/catch. Always resolves.
 */
export async function dispatchRemote(req: RemoteRequest, opts: DispatchOptions = {}): Promise<RemoteResult> {
  const backend = opts.backend ?? currentBackend;
  try {
    return await backend.execute(req, opts.onProgress ?? (() => {}), opts.signal);
  } catch (err) {
    if (isAbortError(err)) return { status: 'error', outputs: {}, error: 'cancelled' };
    return { status: 'error', outputs: {}, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Processor helper ───────────────────────────────────────────────────────

/** The keys a remote dispatch writes onto a node's `data`. */
export const REMOTE_RESULT_KEY = '_remoteResult';
export const REMOTE_STATUS_KEY = '_remoteStatus';
export const REMOTE_ERROR_KEY = '_remoteError';
export const REMOTE_PROGRESS_KEY = '_remoteProgress';

/**
 * Synchronous processor body for a remote node: return the result currently
 * cached on the node. Output 0 = result payload, 1 = status string, 2 = error.
 * Mirrors the `http-fetch` processor's read-the-cache shape.
 */
export function remoteCachedResult(node: { data: Record<string, unknown> }): Record<number, unknown> {
  const cached = node.data[REMOTE_RESULT_KEY] ?? null;
  const status = typeof node.data[REMOTE_STATUS_KEY] === 'string' ? node.data[REMOTE_STATUS_KEY] : 'idle';
  const error = typeof node.data[REMOTE_ERROR_KEY] === 'string' ? node.data[REMOTE_ERROR_KEY] : '';
  return { 0: cached, 1: status, 2: error };
}
