# HANDOFF — Rosebud 3D Node Editor

Working notes for picking up where the last session left off. Not part of the app;
safe to delete once the open items below are done.

_Last updated: 2026-06-01 (session 3 — remote-exec wired into the app + live-browser verified; pushed)_

## Current state (all green, pushed)

- **Builds clean:** `npm run build` → exit 0 (only the cosmetic three.js/r3f
  chunk-size warning remains).
- **Lint clean:** `npm run lint` → **0 problems**.
- **All tests pass:** `npm test` → **9099/9099** (added `remote-node-integration.test.ts`, +4).
- **Dev server runs:** `npm run dev` (port 5173, auto-increments if taken).
- **`main` is pushed and up to date at `fa11737`** on
  `github.com/TrentHunter82/node-editor-3d` over HTTPS. Session 3 added one commit
  on top of `c67a1de`: `fa11737` (remote-exec wired into the app). Working tree is
  clean.
- See `CLAUDE.md` for architecture, commands, and conventions.

## Session 3 (2026-06-01): remote-execution made tangible in the app

Built the natural next step from open-item #2 — the spike's seam is now a usable,
demoable feature against the in-process `MockExecutionBackend` (no server needed).

- **Demo remote node** (`src/plugins/remoteDemo.ts`): a `remote-compute` plugin
  node (2 number inputs → result/status/error outputs) registered via the plugin
  registry, with its type flagged remote (`registerRemoteNodeType`). Its processor
  is `remoteCachedResult`, so it appears in every node palette automatically and
  reads its cache like `http-fetch`. `registerBuiltInPlugins()` is the idempotent
  bootstrap, called from an App mount effect.
- **On-node UI** (`src/components/nodes/RemoteNodeExtras.tsx`): Run/Cancel button,
  a live progress bar fed by `node.data._remoteProgress`, and a status/error line.
  Wired into `NodeScreen.tsx` (renders when `isRemoteNodeType(node.type)`).
- **Auto-dispatch** (`src/hooks/useRemoteAutoDispatch.ts`): edge-triggered — watches
  each remote node's resolved-input signature and calls `dispatchRemoteNode` when it
  changes. Skips the initial load batch, unwired nodes, and already-running nodes.
  Mounted in App alongside `useLiveExecution`.
- **Latent bug fixed:** `NodeScreen.tsx:482` did an unguarded
  `NODE_TYPE_CONFIG[node.type].color` — would crash for *any* plugin node whose
  screen renders (plugin types aren't in `NODE_TYPE_CONFIG`). Now falls back to the
  plugin def's color then teal, mirroring `NodeModule`.
- **Not yet done (the remaining production layers from the spike):** a real
  transport `ExecutionBackend` (HTTP/WS), rich-media handle ports + 3D previews, a
  job queue/concurrency limits, first-class `image`/`latent`/`model` port types.

### Live-browser verification — PASS (done this session)
Drove the running app in headless system Edge via Playwright (`channel: 'msedge'`;
seeded `settings-v1` localStorage to skip the onboarding tour). The command palette
(**Ctrl+Shift+P**, not Ctrl+F — that's the separate NodeSearchPanel) listed
"Add Remote Compute (Plugin)"; the node dropped, rendered the Run button + progress
bar, and clicking **Run remote** drove `MockExecutionBackend` to `status=ok`,
`_remoteProgress=1`, `_remoteResult={0:0, 1:"computed remotely (remote-compute)"}`.
With `autoExecute` on, the output ports also populated (`OUT0/OUT1/OUT2`). Three
findings became the polish items below.

**Verification gotchas worth keeping:** no Playwright/verifier in the repo (install
`playwright --no-save`, drive `channel:'msedge'`); the app seeds a *starter graph*
that sits in a fail-fast error state, so clear it (Ctrl+A, Delete) before checking
full-graph execution; `window.__store` is exposed in DEV for reading store state.

## Session 2 (2026-05-31 → 06-01): lint backlog closed + Live Mode + remote-exec spike

- **react-hooks/react-compiler lint backlog fully cleared** (`de24b10`), all
  refactored properly (no scoped-disables; stale disables removed). Buckets:
  refs-during-render, impure-during-render, set-state-in-effect, immutability,
  and the preserve-manual-memoization/exhaustive-deps cascade in `App.tsx`.
  **Gotcha:** fixing a component's *first* compiler violation can un-mask others
  the React Compiler had been bailing on (saw this in `App.tsx` and `Minimap.tsx`)
  — fix iteratively and re-lint after each change.
- **Live Mode feature** (`0d86233`): execute-bar toggle + Settings interval that
  re-runs the graph on a timer (100ms–60s) so `timer`/`http-fetch` update
  hands-free. New `useLiveExecution` hook; `liveMode`/`liveIntervalMs` settings.
- **Remote-execution spike** (`2a45c48`) — see `REMOTE-EXECUTION-SPIKE.md`.
  Proves backend-executed nodes (ComfyUI direction) are possible **without
  touching the synchronous graph engine**, by generalizing the http-fetch async
  side-channel into a pluggable `ExecutionBackend`. Files:
  `src/utils/remoteExecution.ts` (interface, `MockExecutionBackend`,
  `dispatchRemote`, registry, `remoteCachedResult`) + store actions
  `dispatchRemoteNode`/`cancelRemoteNode` (mirror `fetchNodeData`; stream
  progress into `executionStates` with `AbortController` supersede/cancel) +
  `src/test/remote-execution.test.ts` (14 tests).
- **`CREATIVE-USE-CASES.md`** added — grounded use-case brainstorm + a prioritized
  enhancement list.

### Key architecture facts learned this session (save re-discovery)
- The execution engine is a **synchronous topological evaluation**
  (`src/utils/execution.ts`); processors return values immediately, no async.
- **Async nodes work via a side-channel:** the processor returns whatever is
  cached on the node; an out-of-band store action does the async work, writes the
  result back onto `node.data`, then calls `scheduleAutoExecute(() =>
  executeGraph())` to re-run so the processor picks it up. `http-fetch`
  (`fetchNodeData`) and now the remote spike both use this. `fetchNodeData` has
  no in-tree caller — its auto-trigger wiring is effectively a stub.
- **`PortType` is a fixed string union** (`src/types/index.ts`) — adding
  `image`/`latent`/`model` is a code edit there. But the **plugin registry**
  (`src/store/pluginStore.ts`) already allows runtime registration of node types
  with arbitrary string port types + a (sync) processor — the extension seam.
- Non-deterministic / always-re-execute node types are listed in
  `executionOrchestration.ts` (~L404: `timer`, `http-fetch`, `get-var`, etc.).

## What was done this session (the revival)

The repo was cloned fresh onto a new PC (old PC died). It didn't build and had 6
failing tests. All fixed and pushed in commit `12e68a2`:

1. **Build unblocked** — 2 unused-symbol TS errors (`noUnusedLocals/Parameters`
   are on, so these are hard errors): unused `DEFAULT_NODE_HEIGHT` import in
   `src/components/nodes/NodeScreen.tsx`, unused `inputCount` param in
   `src/utils/nodeDepth.ts` (renamed `_inputCount`).
2. **Real bug — `locked` flag lost on duplicate/paste** — `duplicateSelected` and
   `paste` in `src/store/slices/coreSlice.ts` copied every node field except
   `locked`, so duplicating/pasting a locked node silently unlocked the copy.
   Fixed; also corrected one stale test that asserted the old buggy behavior.
3. **`display` node design conflict** — the `display` sink (no output ports) had a
   processor fabricating a phantom `output[0]`. Now returns `{}` like the `note`
   sink; the on-node `DisplayReadout` (`src/components/nodes/ScreenExtras.tsx`)
   resolves its value from the incoming connection edge instead. **Convention:
   sink nodes return `{}` and read their display value from the input edge.**
4. **Tooling** — `eslint.config.js` now exempts test files from
   `no-explicit-any`; `.gitignore` ignores scratch `_*` files; added `CLAUDE.md`.

## Open items / next steps (priority order)

### 1. Lint cleanup — ✅ DONE (`de24b10`)
`npm run lint` → 0 problems, all refactored properly. Lint still isn't part of
`build` — add a CI/precommit gate to keep it at 0 (see Nice-to-haves).

### 2. Make the remote-execution spike tangible in the app — ✅ DONE + verified (session 3)
The demo node, on-node UI, and auto-dispatch are built and live-browser verified
(see Session 3 above). **Quick polish picks the verification surfaced — start here
if continuing remote-exec (small, high-value, all in `src/plugins/remoteDemo.ts` /
`src/store/editorStore.ts`):**

- **a) Make progress *visible*.** The demo backend uses `latencyMs: 0`, so a run
  completes instantly — the bar snaps to 100% and the Cancel button never shows.
  Give the registered demo backend a small latency for a real animation, e.g. in
  `registerBuiltInPlugins`: `setExecutionBackend(new MockExecutionBackend({ latencyMs: 250, steps: 6 }))`.
  (Heads-up: that's a *global* backend swap — fine for the demo, but a real build
  wants per-node/per-type backends.)
- **b) Outputs without `autoExecute`.** After dispatch, `dispatchRemoteNode` calls
  `scheduleAutoExecute`, which **no-ops when `autoExecute` is off (the default)** —
  so the node shows `status=ok` but its output *ports* stay empty (nothing feeds a
  downstream `display`) until you toggle autoExecute or hit Execute. Consider having
  `dispatchRemoteNode` write `nodeOutputs[id]` directly (or force a one-off
  `executeGraph()`), so a remote node feeds the graph regardless of the setting.
- **c)** `OutputReadout` renders the result port as `[object Object]` (payload is an
  object). Minor — give remote results a readable summary.

**Remaining production layers** (deferred from the spike): a real transport
implementing `ExecutionBackend` (HTTP/WS; reuse `serialization.ts`), media-handle
ports + 3D image previews, a job queue + concurrency limits, and first-class
`image`/`latent`/`model` port types. See `REMOTE-EXECUTION-SPIKE.md`. Also worth a
pass: let the node *body* color use the plugin def color (today `NodeModule`
hardcodes teal for all plugin types).

**Plugin-in-worker caveat:** plugin processors only run on the **main thread** —
the Web Worker (`workerExecution`, default off) has an empty plugin registry, so
plugin/remote node outputs won't populate if a user turns worker execution on.
Pre-existing, affects all plugins; relevant once remote nodes feed the graph.

### 3. Other polish picks (from `CREATIVE-USE-CASES.md`)
- **Copy/export a node's computed value** (JSON/CSV) — today only the *diagram*
  exports to SVG; this makes calculators & ETL recipes deliver tangible output.
- **Presentation / "mini-app" view** — hide wiring, surface only `source` inputs +
  `display` outputs, so a finished graph reads as a clean tool.
- **`http-fetch` ergonomics** — method/headers/body inputs + an in-app CORS note
  (frontend-only fetch only reaches CORS-friendly endpoints).
- **CSV in/out nodes** for the analyst use cases.

### 4. Bundle code-splitting — NOT started
Build warns: `three` (719 kB), `r3f` (522 kB), `index` (616 kB) chunks > 500 kB.
Cosmetic, but worth `manualChunks` tuning in `vite.config.ts` if load time matters.

### 5. Nice-to-haves observed
- No CI. A GitHub Action running `npm run build && npm test && npm run lint` on
  push would catch regressions and keep lint at 0.
- Lint isn't part of `build`, so lint errors can accumulate silently.

## Environment gotchas (read before starting)

- **GitHub auth is HTTPS only** on this PC (SSH `git@` fails publickey). Git
  identity is set locally to `Trent Hunter <trent@trentfilms.com>`.
- **Cached GitHub credential was deleted** at end of last session (mistakenly,
  while chasing a push-auth red herring — the push had already succeeded). Next
  push may prompt; Git Credential Manager should re-cache on first interactive
  push, or run `git push` from your own terminal once.
- **`gh` CLI is not installed** in this environment — use raw `git`.
- **Old PC drive is at `E:\Rosebud`** — checked, no unrecovered work.
- **Tool output channel was flaky** last session (garbled/duplicated reads,
  cancelled parallel batches when the first command exited non-zero). Mitigations:
  end probe commands with `; echo ===END===` or `|| true`; write important output
  to a file and read it back; verify reads look sane before editing.
