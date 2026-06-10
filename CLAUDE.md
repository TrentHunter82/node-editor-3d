# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rosebud — 3D Node Editor**: a visual data-flow node editor rendered in 3D with
React Three Fiber. Users build graphs by connecting ~86 built-in node types on a
3D workspace with orbital camera controls and live execution. Frontend-only (no
backend); persistence is local via IndexedDB. Part of the **Latent Underground**
ecosystem.

## Commands

```bash
npm install
npm run dev            # Vite dev server (port 5173, auto-increments if taken)
npm run build          # tsc -b (project refs) THEN vite build -> dist/
npm test               # vitest run (all 249 test files)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest run --coverage (v8)
npm run lint           # eslint . (includes import/no-cycle for app code)

# Run a single test file
npx vitest run src/test/phase26-e2e.test.ts
# Run tests matching a name
npx vitest run -t "locked field preserved"
```

Node 18+ / verified on Node 22. `npm run build` typechecks via `tsc -b` first —
TS errors fail the build (config is strict: `noUnusedLocals` + `noUnusedParameters`
are on, so any unused import/var/param is a hard error, not a warning).

## Architecture

- **Rendering split (App.tsx):** one R3F `<Canvas frameloop="demand">` holds the
  3D scene (`SceneSetup`, `NodeGraph`, `ConnectionGraph`, `GridFloor`,
  post-processing); a sibling `<div data-ui-panel>` holds all 2D HTML UI (toolbar,
  panels, menus). `frameloop="demand"` means the scene only re-renders on
  invalidation — keep that in mind when adding animations.
- **State = one Zustand store composed of slices.** `src/store/editorStore.ts`
  combines slices from `src/store/slices/` (core, node, connection, selection,
  execution, group, layout, subgraph, template, checkpoint, customNode,
  persistence, undo, graph). Plus standalone stores: `settingsStore`,
  `workspaceStore`, `pluginStore`. Components subscribe with selectors
  (`useEditorStore(s => s.foo)`); non-React code reads `useEditorStore.getState()`.
- **Node type system is data-driven (`src/types/index.ts`).** `NodeType` is a
  string union; `NODE_TYPE_CONFIG` maps each type → its color + input/output
  `PortConfig[]`; `NODE_CATEGORIES` groups them; `PORT_TYPE_COLORS` colors ports
  by `PortType`. Adding a node type means updating these tables, adding a processor
  (see below), and usually a screen-field entry in `components/nodes/nodeFields.ts`.
- **Execution engine** lives in `src/utils/` (`execution.ts`,
  `executionOrchestration.ts`, `executionProcessors.ts`) and runs in a Web Worker
  (`src/workers/execution.worker.ts`, managed by `executionWorkerManager.ts`) with
  a main-thread fallback. Processors are keyed by `NodeType` in
  `executionProcessors.ts` and return `{ [outputIndex]: value }`. Execution is
  topologically sorted; supports caching, profiling metrics, timeouts, and
  `fail-fast`/`continue` error strategies.
- **Panels are lazy-loaded** via `React.lazy` in App.tsx and gated on open state.
  Panel open/closed state persists through `settingsStore.openPanels`. Panels are
  imperatively opened through `window.__openXxx` globals wired up in an App.tsx
  effect (also how `SearchPalette`/command palette triggers them).
- **Geometry helpers** (`utils/nodeBounds.ts`, `portPositions.ts`, `nodeDepth.ts`,
  `spatialIndex.ts`) compute AABBs, port world positions, and minimum node depth.
  `nodeDepth.ts` is deliberately split out to break a circular dep between
  `NodeScreen.tsx` and `nodeSlice.ts` — don't re-merge it.

## Testing

Vitest + Testing Library, jsdom env, `fake-indexeddb` for persistence tests.
~9170 tests across 249 files (unit/integration/perf/regression, many named
`phaseNN-*`). Performance tests assert wall-clock budgets, so they can be flaky
on a loaded machine — re-run a perf file in isolation before trusting a failure.
(CI runs vitest with `--retry=2` for the same reason.)

## Conventions worth knowing

- **Sink nodes (`note`, `display`) return `{}` from their processor** — they have
  no output ports, so they produce no `nodeOutputs` entry. The `display` node's
  on-node `DisplayReadout` shows its value by resolving the *incoming* connection
  (find the edge into input 0, read the source node's output), NOT by having the
  processor echo the input to a phantom output[0]. Keep new sink nodes consistent.
- **Undo snapshots share references** (`undoSlice.takeSnapshot`) — the store is
  immer-managed with autoFreeze, so snapshots are O(1) ref captures, NOT deep
  clones. Never mutate store state in place outside `set()` (immer would throw
  anyway); test harnesses must emulate copy-on-write when mutating mock state.
- **Validation severity is message-based**: messages containing `(warning)` are
  warnings (yellow), everything else is an error (red). Unconnected inputs with
  a `defaultValue` are warnings; default-less ones are errors.
- **`image` port type carries URL strings.** Compatible with `string` both ways.
  Any node with an image-typed *output* gets a floating preview plane
  (`NodeImagePreview`) when the output holds a URL.
- **Remote execution** (`utils/remoteExecution.ts`): nodes flagged via
  `registerRemoteNodeType` execute out-of-band on the active `ExecutionBackend`
  through a FIFO queue (`dispatchRemoteQueued`, default 2 concurrent).
  `utils/comfyBackend.ts` is the real transport (ComfyUI server). Plugin defs
  can declare `screenFields` for editable data fields on the node screen.
- **Async results re-run the graph regardless of autoExecute** via
  `scheduleResultPropagation` (http-fetch + remote dispatches) — otherwise
  outputs sit cached on the node while ports stay empty.
- **http-fetch only fetches via `useHttpFetchAutoDispatch`** (edge-triggered on
  resolved url/trigger inputs, 1s per-node cooldown to prevent fetch loops).
- **Storage format changes** go through `utils/storageMigrations.ts`: bump
  `CURRENT_STORAGE_VERSION`, add one registry entry. Loading future-version
  data fails loudly and leaves the bytes untouched.
- **Worker execution auto-falls-back to main thread when the graph contains
  plugin nodes** (their processors are closures and can't reach the worker).

## Revival fixes (2026-05-31)

The initial clone didn't build and had 6 failing tests; all resolved:

- Build was blocked by 2 unused-symbol TS errors (`noUnusedLocals/Parameters` are
  on) — fixed in `NodeScreen.tsx` and `utils/nodeDepth.ts`.
- Real bug: `duplicateSelected` / `paste` in `coreSlice.ts` didn't copy the node
  `locked` flag — fixed (and one stale test that asserted the old behavior).
- `display` node test-vs-design conflict — fixed by making the processor a proper
  sink (`{}`) and reworking `DisplayReadout` to read the incoming edge (see above).
- Build emits a chunk-size warning (three.js/r3f bundles > 500 kB) — cosmetic.
