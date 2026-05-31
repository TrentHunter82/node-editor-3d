# Remote-Execution Seam — Spike

A spike proving the architecture can support **backend-executed nodes** (the
core of a ComfyUI-style direction) without rewriting the synchronous graph
engine. It generalizes the async side-channel pattern that `http-fetch` already
uses into a pluggable **ExecutionBackend**.

## What it proves

A node can be executed *somewhere else* — a server, a GPU job queue, a worker
pool — while the rest of the graph keeps running locally, and the existing
per-node execution state machine (`idle → running → complete/error`) is reused
for live status and progress.

Verified by `src/test/remote-execution.test.ts` (14 tests): backend dispatch,
monotonic progress streaming, custom compute, error normalization, cancellation,
backend swapping, and the end-to-end store action.

## How it works (and why the engine is untouched)

The graph engine is a **synchronous topological evaluation** — processors return
values immediately. `http-fetch` already shows how to do async work inside that
model: its processor returns whatever is cached on the node, and an out-of-band
store action (`fetchNodeData`) does the real fetch, writes the result back onto
the node, and re-runs the graph. The seam generalizes exactly this:

```
            ┌─────────────── synchronous engine ───────────────┐
 graph run →│ remote node's processor → remoteCachedResult(node)│→ outputs
            └───────────────────────────────────────────────────┘
                                  ▲ reads cache
                                  │ writes cache + re-runs
   dispatchRemoteNode(nodeId) ────┼─────────────────────────────────────┐
        │ gather inputs from upstream nodeOutputs                        │
        │ executionStates[node] = 'running'                              │
        ▼                                                                │
   dispatchRemote(req, {onProgress, signal}) ──→ ExecutionBackend.execute┘
        │ onProgress → node.data._remoteProgress (live %)
        │ on resolve → node.data._remoteResult/_remoteStatus/_remoteError
        │ executionStates[node] = 'complete' | 'error'
        └ scheduleAutoExecute → graph re-runs, processor picks up the result
```

## The pieces

- **`src/utils/remoteExecution.ts`** — framework-agnostic core:
  - `ExecutionBackend` interface: `execute(req, onProgress, signal) → Promise<RemoteResult>`.
  - `MockExecutionBackend` — in-process backend that emits progress then resolves
    (the default, so the path runs without a server). `latencyMs: 0` makes tests
    deterministic on microtasks.
  - `dispatchRemote(req, opts)` — runs a node on a backend; normalizes throws and
    cancellation into a `RemoteResult` (always resolves).
  - Registry: `getExecutionBackend` / `setExecutionBackend`, plus
    `registerRemoteNodeType` / `isRemoteNodeType`.
  - `remoteCachedResult(node)` — the synchronous processor body for a remote node.
- **`editorStore`** — `dispatchRemoteNode(nodeId)` / `cancelRemoteNode(nodeId)`:
  the integration that mirrors `fetchNodeData`, wiring progress + result + status
  into the store and supporting supersede/cancel via `AbortController`.

## Plugging in a real backend

```ts
import { setExecutionBackend, type ExecutionBackend } from './utils/remoteExecution';

const serverBackend: ExecutionBackend = {
  id: 'comfy-server',
  async execute(req, onProgress, signal) {
    const ws = openJob(req, signal);              // POST graph node / open WS
    ws.on('progress', p => onProgress(p.value, p.note));
    const out = await ws.done();                  // stream → resolve
    return { status: 'ok', outputs: out.byPort }; // e.g. { 0: imageUrl }
  },
};
setExecutionBackend(serverBackend);
```

A remote node type then just needs its processor to be `remoteCachedResult`, and
something to call `dispatchRemoteNode(id)` when its inputs change (a node button,
or a hook that watches dirty remote nodes — analogous to how Live Mode drives
re-execution).

## What this spike intentionally leaves for production

(Consistent with the assessment in `CREATIVE-USE-CASES.md`.)

1. **A real transport** — HTTP/WebSocket client implementing `ExecutionBackend`,
   plus serializing the graph/node to send (the editor already has
   `serialization.ts`).
2. **Auto-dispatch wiring** — deciding *when* a remote node re-runs (dirty-input
   detection) rather than the explicit `dispatchRemoteNode` call used here.
3. **Rich-media payloads & previews** — pass image/tensor *handles* (URLs) over
   `any`-typed ports and render them on-node / as planes in the 3D scene.
4. **Queue/batch & concurrency limits** — ComfyUI queues prompts; this spike
   dispatches one node at a time per node id (with supersede), no global queue.
5. **First-class port types** — `image` / `latent` / `model` would be added to
   the `PortType` union (plugins can already use arbitrary string port types).

Net: the graph model, typed ports, plugin registry, caching, and now a proven
remote-execution seam are in place. The remaining work is additive layers, not a
re-architecture.
