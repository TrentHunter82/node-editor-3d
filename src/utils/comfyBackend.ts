/**
 * ComfyUI ExecutionBackend — a real transport for the remote-execution seam.
 *
 * Speaks the standard ComfyUI server API:
 *   POST /prompt                {prompt, client_id}        → {prompt_id}
 *   WS   /ws?clientId=…         progress / executing events (progress display)
 *   GET  /history/<prompt_id>   completed job outputs
 *   GET  /view?filename=…       image bytes (we emit URLs, not bytes)
 *   POST /interrupt             cancel the running job
 *
 * Completion is detected by polling /history (robust against missed WS
 * messages); the WebSocket — when available — feeds live progress and
 * short-circuits the poll wait the moment the job finishes. `fetchFn`,
 * `wsFactory`, and the poll interval are injectable so the whole backend is
 * unit-testable without a server.
 *
 * The workflow comes from the node: `req.data.workflow` is an API-format
 * workflow JSON string (ComfyUI's "Save (API format)") with optional tokens —
 * `%prompt%`, `%seed%`, `%in0%`…`%inN%` — substituted from the node's resolved
 * inputs before submission.
 */
import type { ExecutionBackend, RemoteRequest, RemoteResult, RemoteProgressFn } from './remoteExecution';

// ── Minimal WebSocket surface (injectable for tests) ───────────────────────

export interface WebSocketLike {
  addEventListener(type: 'message' | 'error' | 'close' | 'open', listener: (ev: { data?: unknown }) => void): void;
  close(): void;
}

export type WsFactory = (url: string) => WebSocketLike;

// ── ComfyUI history shapes (the subset we read) ────────────────────────────

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: ComfyImageRef[] } & Record<string, unknown>>;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface ComfyUIBackendOptions {
  /** Server base URL, e.g. `http://127.0.0.1:8188` (no trailing slash needed). */
  baseUrl: string;
  clientId?: string;
  fetchFn?: typeof fetch;
  /** WebSocket factory; pass `null` to disable WS and rely on polling only. */
  wsFactory?: WsFactory | null;
  /** /history poll cadence (default 500ms). */
  pollIntervalMs?: number;
  /** Overall job timeout (default 10 minutes — GPU jobs can be slow). */
  timeoutMs?: number;
}

// ── Workflow token substitution ────────────────────────────────────────────

/**
 * Substitute `%prompt%`, `%seed%`, and `%inN%` tokens in an API-format
 * workflow JSON string with the node's resolved input values.
 *
 * Two forms are handled:
 *  - A *quoted* token (`"seed": "%seed%"`) is replaced wholesale with the
 *    JSON encoding of the value, so numbers stay numbers.
 *  - A token *inside* a longer string (`"text": "photo of %prompt%, 4k"`)
 *    is replaced with the JSON-escaped text content.
 */
export function substituteWorkflowTokens(
  workflowJson: string,
  inputs: Record<number, unknown>,
): string {
  const tokens: Record<string, unknown> = {
    prompt: inputs[0] ?? '',
    seed: typeof inputs[1] === 'number' ? inputs[1] : Math.floor(Math.random() * 1e15),
  };
  for (const [k, v] of Object.entries(inputs)) {
    tokens[`in${k}`] = v;
  }

  let out = workflowJson;
  for (const [name, value] of Object.entries(tokens)) {
    const quoted = `"%${name}%"`;
    if (out.includes(quoted)) {
      out = out.split(quoted).join(JSON.stringify(value));
    }
    const bare = `%${name}%`;
    if (out.includes(bare)) {
      // Escape for in-string substitution: JSON-encode then strip the quotes
      const escaped = JSON.stringify(String(value ?? '')).slice(1, -1);
      out = out.split(bare).join(escaped);
    }
  }
  return out;
}

/** Build the prompt object for a request (parse + substitute). Throws with a friendly message. */
export function buildComfyPrompt(req: RemoteRequest): Record<string, unknown> {
  const wf = req.data.workflow;
  if (typeof wf !== 'string' || wf.trim().length === 0) {
    throw new Error(
      'No workflow configured — paste an API-format workflow JSON (ComfyUI: "Save (API format)") into the node\'s workflow field. Use %prompt% and %seed% tokens to bind inputs.',
    );
  }
  const substituted = substituteWorkflowTokens(wf, req.inputs);
  try {
    return JSON.parse(substituted) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Workflow is not valid JSON after token substitution: ${(e as Error).message}`);
  }
}

/** Collect image URLs from a history entry, in workflow-node order. */
export function collectImageUrls(entry: ComfyHistoryEntry, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const nodeOutput of Object.values(entry.outputs ?? {})) {
    for (const img of nodeOutput.images ?? []) {
      const params = new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder ?? '',
        type: img.type ?? 'output',
      });
      urls.push(`${baseUrl}/view?${params.toString()}`);
    }
  }
  return urls;
}

// ── Backend ────────────────────────────────────────────────────────────────

function sleepUntil(ms: number, wake: { promise: Promise<void> }): Promise<void> {
  return Promise.race([
    new Promise<void>(resolve => setTimeout(resolve, ms)),
    wake.promise,
  ]);
}

export class ComfyUIBackend implements ExecutionBackend {
  readonly id = 'comfyui';
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly wsFactory: WsFactory | null;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(opts: ComfyUIBackendOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.clientId = opts.clientId ?? `rosebud-${Math.random().toString(36).slice(2, 10)}`;
    this.fetchFn = opts.fetchFn ?? ((...args) => fetch(...args));
    this.wsFactory =
      opts.wsFactory !== undefined
        ? opts.wsFactory
        : typeof WebSocket !== 'undefined'
          ? (url: string) => new WebSocket(url) as unknown as WebSocketLike
          : null;
    this.pollIntervalMs = Math.max(50, opts.pollIntervalMs ?? 500);
    this.timeoutMs = Math.max(1000, opts.timeoutMs ?? 10 * 60 * 1000);
  }

  async execute(req: RemoteRequest, onProgress: RemoteProgressFn, signal?: AbortSignal): Promise<RemoteResult> {
    const prompt = buildComfyPrompt(req); // throws a friendly error if unconfigured

    // Open the WS *before* submitting so no progress events are missed.
    let ws: WebSocketLike | null = null;
    let wakeResolve: () => void = () => {};
    const wake = { promise: new Promise<void>(resolve => { wakeResolve = resolve; }) };
    let promptId = '';

    if (this.wsFactory) {
      try {
        const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(this.clientId)}`;
        ws = this.wsFactory(wsUrl);
        ws.addEventListener('message', (ev) => {
          if (typeof ev.data !== 'string') return; // binary preview frames — ignore
          try {
            const msg = JSON.parse(ev.data) as { type?: string; data?: Record<string, unknown> };
            const d = msg.data ?? {};
            if (promptId && d.prompt_id && d.prompt_id !== promptId) return;
            if (msg.type === 'progress' && typeof d.value === 'number' && typeof d.max === 'number' && d.max > 0) {
              onProgress(Math.min(0.99, d.value / d.max), `step ${d.value}/${d.max}`);
            } else if (msg.type === 'executing' && d.node === null) {
              wakeResolve(); // job finished — check history immediately
            } else if (msg.type === 'execution_error') {
              wakeResolve();
            }
          } catch { /* non-JSON frame — ignore */ }
        });
        ws.addEventListener('error', () => { /* polling covers completion */ });
      } catch {
        ws = null; // WS unavailable — polling covers everything
      }
    }

    try {
      // Submit the job
      const submit = await this.fetchFn(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: this.clientId }),
        signal,
      });
      if (!submit.ok) {
        const body = await submit.text().catch(() => '');
        throw new Error(`ComfyUI rejected the workflow (HTTP ${submit.status})${body ? `: ${body.slice(0, 300)}` : ''}`);
      }
      const submitJson = (await submit.json()) as { prompt_id?: string; error?: unknown };
      if (!submitJson.prompt_id) {
        throw new Error(`ComfyUI returned no prompt_id${submitJson.error ? `: ${JSON.stringify(submitJson.error).slice(0, 300)}` : ''}`);
      }
      promptId = submitJson.prompt_id;
      onProgress(0.01, 'queued');

      // Wait for completion: poll /history, with the WS short-circuiting the wait
      const deadline = Date.now() + this.timeoutMs;
      for (;;) {
        if (signal?.aborted) {
          void this.fetchFn(`${this.baseUrl}/interrupt`, { method: 'POST' }).catch(() => {});
          const e = new Error('Remote execution cancelled');
          e.name = 'AbortError';
          throw e;
        }
        if (Date.now() > deadline) {
          throw new Error(`ComfyUI job timed out after ${Math.round(this.timeoutMs / 1000)}s`);
        }

        const hist = await this.fetchFn(`${this.baseUrl}/history/${promptId}`, { signal });
        if (hist.ok) {
          const histJson = (await hist.json()) as Record<string, ComfyHistoryEntry>;
          const entry = histJson[promptId];
          if (entry && (entry.status?.completed || Object.keys(entry.outputs ?? {}).length > 0)) {
            if (entry.status && entry.status.completed === false && entry.status.status_str === 'error') {
              throw new Error(`ComfyUI execution failed: ${entry.status.status_str}`);
            }
            const urls = collectImageUrls(entry, this.baseUrl);
            onProgress(1, 'done');
            return {
              status: 'ok',
              outputs: { 0: urls[0] ?? null, 1: urls },
            };
          }
        }
        await sleepUntil(this.pollIntervalMs, wake);
        // Re-arm the wake promise so later WS events can short-circuit again
        wake.promise = new Promise<void>(resolve => { wakeResolve = resolve; });
      }
    } finally {
      ws?.close();
    }
  }
}
