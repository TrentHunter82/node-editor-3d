# HANDOFF — Rosebud 3D Node Editor

Working notes for picking up where the last session left off. Not part of the app;
safe to delete once the open items below are done.

_Last updated: 2026-06-10 (session 4 — "all 4 phases" world-class build-out; 16 commits, NOT yet pushed)_

## Current state (all green, NOT pushed)

- **Builds clean:** `npm run build` → exit 0 (chunk-size warning only).
- **Lint clean:** `npm run lint` → 0 problems (now includes `import/no-cycle`).
- **All tests pass:** `npm test` → **9170/9170 across 249 files.** One or two
  wall-clock perf tests (`phase34-features` execution-timeout group) flake on a
  loaded machine — always re-run in isolation before chasing them. CI uses
  `--retry=2` for this.
- **16 local commits ahead of `origin/main`** (`35c045e`…). **The push was
  blocked by the environment's permission gate** (pushing to main triggers the
  new Pages deploy). First push will: run CI, deploy to GitHub Pages
  (`configure-pages` with `enablement: true` creates the site), and publish at
  `https://trenthunter82.github.io/node-editor-3d/`.

## Session 4 (2026-06-10): the four-phase build-out

**Phase 1 — Ship it**
- Starter graph is now connected + executes on first run (no more red-error
  first impression). Validation downgrades unconnected-but-defaulted inputs to
  warnings.
- 5 built-in example templates (`utils/builtinTemplates.ts`, Examples section
  in Template Library). All fully wired; tests assert zero error-level issues.
- **http-fetch actually fetches now** — `fetchNodeData` had no caller.
  `useHttpFetchAutoDispatch` fires it edge-triggered (1s per-node cooldown).
- URL sharing: Share button → gzip+base64url graph in `#g=` hash; App imports
  on load. Subgraph internals NOT included (v1 limitation, warned in toast).
- CI workflow (`.github/workflows/ci.yml`): build+lint+test, deploy to Pages
  on main pushes (`VITE_BASE=/node-editor-3d/`; worker URL verified prefixed).

**Phase 2 — Feel fast**
- Geometry cache quantizes dims to 0.05 (resize drags no longer mint 1000s of
  RoundedBoxGeometries).
- `postProcessing` setting gates Bloom/Vignette.
- validateGraph + applyResults preserve referential identity for unchanged
  entries (no more all-node re-render storms per validation/execution).
- **O(1) undo snapshots** — `takeSnapshot` shares refs instead of
  structuredClone (immer autoFreeze makes this safe). addNode went 1.94 →
  0.17 ms/node at 800 nodes; the test suite itself got ~25% faster.

**Phase 3 — The bet (ComfyUI)**
- Remote polish: demo backend has visible latency (app only), results
  propagate without autoExecute (`scheduleResultPropagation`), object outputs
  render as compact JSON.
- **`utils/comfyBackend.ts`**: real ExecutionBackend speaking the ComfyUI API
  (POST /prompt, WS progress, /history polling with WS short-circuit, /view
  image URLs, /interrupt on cancel). Injectable fetch/WS — 15 unit tests.
- **`comfy-workflow` plugin node**: paste API-format workflow JSON
  (`%prompt%`/`%seed%`/`%inN%` tokens). Settings → Remote Execution selects
  demo/ComfyUI backend + server URL + max concurrent jobs.
- `image` port type (URL payloads, string-compatible) + `NodeImagePreview`
  (billboard plane above nodes) + built-in `image-preview` node (union now 94
  types — counts asserted in ~10 test files; grep for `94` when adding more).
- FIFO remote job queue (`dispatchRemoteQueued`, default 2 concurrent,
  queued #N shown on-node, abort-while-queued supported).

**Phase 4 — Scale & harden**
- NodeScreen Html overlays cull beyond 18 units from camera (selected nodes
  exempt) — the biggest per-node cost at scale.
- `utils/storageMigrations.ts`: formal version registry; future-version data
  fails loudly, bytes untouched.
- Worker execution falls back to main thread when plugin nodes present
  (worker registry is empty — was silently producing no outputs).
- `import/no-cycle` lint (verified it actually resolves TS imports by probing
  with a deliberate cycle — needs `import/parsers` setting, see eslint.config).

## Open items / next steps

1. **PUSH.** `git push origin main` from a terminal (interactive — credential
   manager may prompt; HTTPS only on this PC). Then check the Actions run and
   the Pages URL. Repo Settings → Pages should show "GitHub Actions" source
   (the workflow tries to enable it automatically).
2. **Live-browser verification** of the new features (no Playwright in repo;
   `npm i -D playwright --no-save`, drive `channel:'msedge'`). Worth checking:
   starter graph renders clean, template instantiation, share-link round-trip,
   image-preview node with a real URL, comfy-workflow against a local ComfyUI.
3. **Real ComfyUI smoke test** — Trent has local ComfyUI installs
   (`C:\Users\Trent\From-Old-PC\`, models at `D:\models`). Settings → Remote
   Execution → ComfyUI; needs `--enable-cors-header` on the ComfyUI server if
   the browser blocks /view image loads.
4. **Share links for subgraph-containing graphs** — needs inner-graph bundling
   + id remapping on import (clipboard code in coreSlice paste is the model).
5. **Text rendering at scale** (pre-baked label textures) and **instanced
   connection rendering** — the remaining items for the 1000-node target.
6. **Presentation/"mini-app" view** and **copy node value as JSON/CSV** —
   highest-leverage UX items from CREATIVE-USE-CASES.md not yet built.

## Environment gotchas (read before starting)

- **GitHub auth is HTTPS only** on this PC (SSH fails publickey). Git identity
  set locally. `gh` CLI not installed.
- **PowerShell 5.1**: don't pass commit messages with embedded double quotes
  (native arg quoting breaks); avoid `Get-Content`/`Set-Content` round-trips on
  UTF-8 files (mojibake — use `[System.IO.File]::ReadAllText/WriteAllText`).
- The full vitest suite takes ~15s; perf-test flakes are environmental.
- See `CLAUDE.md` for architecture, commands, and all conventions.
