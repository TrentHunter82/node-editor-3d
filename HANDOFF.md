# HANDOFF — Rosebud 3D Node Editor

Working notes for picking up where the last session left off. Not part of the app;
safe to delete once the open items below are done.

_Last updated: 2026-06-11 (session 5 wrap — punch list cleared except the ComfyUI
server launch, which is permission-gated; see below)_

## Current state (all green, pushed)

- **Live at https://trenthunter82.github.io/node-editor-3d/** — every push to
  `main` redeploys Pages automatically. (Pages source = "GitHub Actions",
  enabled manually once in repo Settings — don't remove that.)
- **Builds clean:** `npm run build` → exit 0 (chunk-size warning only).
- **Lint clean:** `npm run lint` → 0 problems.
- **All tests pass:** `npm test` → **9216/9216 across 253 files**. The
  `phase34-features` execution-timeout group still flakes on a loaded machine —
  always re-run in isolation before chasing it (CI uses `--retry=2`).

## Session 5 (2026-06-11): punch list cleared

1. **Subgraph share links** — share payload now bundles inner graphs
   recursively (`collectInnerGraphsForExport`); `importWorkflow` remaps graph
   ids so foreign ids can't clobber other tabs (paste was the model), installs
   inner graphs + tabs, and tracks them for undo cleanup. Round-trip verified
   in tests AND live in the browser (encode → #g= → import → enter → execute).
   Bonus fix: nested-subgraph defs (stored on inner GraphData) were invisible
   when executing from an ancestor level — execution now merges them when
   recursing (real pre-existing bug, regression-tested).
2. **Presentation/"mini-app" view** — `PresentationPanel` (panel id
   `presentation`): parameter nodes (no input ports + screen fields) become
   form inputs, display/output nodes become live readouts with JSON/CSV copy.
   Edits re-execute via a debounce that re-arms while the wave animation holds
   `isExecuting` (plain executeGraph calls are swallowed during it). Wired
   into Toolbar, PanelToggleBar ("Present"), SearchPalette.
3. **Copy node value as JSON/CSV** — node context menu items via
   `utils/valueExport.ts` (sinks resolve through the incoming edge; CSV offered
   only for tabular shapes; proper escaping).
4. **Text rendering at scale** — `BakedLabel` + `utils/labelTexture.ts`:
   canvas-baked, refcount-cached label materials replace troika `<Text>` in
   NodeModule (etched title) and NodeLOD (overview labels).
5. **Instanced connection rendering** — `InstancedConnectionLines`: every
   far-LOD connection in ONE LineSegments draw call (vertex colors, bezier
   sampling shared with Pipe via `utils/connectionGeometry.ts`). Far Pipes hide
   unless selected/hovered/labeled/traced/pulsing (those force 'full').
6. **Live-browser verification** (dev server + driven browser): starter graph
   clean, tip-calc template → 101.95, subgraph share-link round-trip → 42,
   image-preview URL propagation, presentation view live-edit (10 → 14), baked
   labels crisp, 200-node graph executes in 6 ms with instanced far lines.
   Found + fixed a real React error: usePanelState wrote the settings store
   inside a setState updater (mid-render update of PanelToggleBar).

## Open item: ComfyUI smoke test (one step left — needs Trent)

Everything is staged; only the server *launch* was blocked (running freshly
cloned third-party code needs explicit user authorization):

- **Fresh ComfyUI installed at `C:\Users\Trent\ComfyUI`** (Windows-native,
  shallow clone), venv at `.venv` with **torch 2.11.0+cu128 — CUDA verified on
  the RTX PRO 6000 Blackwell**. `extra_model_paths.yaml` already dropped in
  (models wired to `D:\models`; `dreamshaper_8.safetensors` is a good fast
  SD1.5 for the test).
- **Launch command:**
  `C:\Users\Trent\ComfyUI\.venv\Scripts\python main.py --listen 127.0.0.1 --port 8188 --enable-cors-header`
  (`--enable-cors-header` so the browser can load `/view` images.)
- **Then in the app:** Settings → Remote Execution → backend "comfyui"
  (default URL `http://127.0.0.1:8188` already matches), add a `comfy-workflow`
  node, paste an API-format workflow (quoted tokens: `"seed": "%seed%"`,
  `"text": "%prompt%"`), execute → image output should land on the node and
  the floating preview.
- This install can become Trent's permanent Windows ComfyUI (the old-PC plan
  in `C:\Users\Trent\From-Old-PC\HANDOFF.md` was WSL; both can coexist —
  user data to migrate is staged there).

## Environment gotchas (read before starting)

- **GitHub auth is HTTPS only** on this PC (SSH fails publickey). Git identity
  set locally. `gh` CLI not installed.
- **PowerShell 5.1**: don't pass commit messages with embedded double quotes
  (native arg quoting breaks); avoid `Get-Content`/`Set-Content` round-trips on
  UTF-8 files (mojibake — use `[System.IO.File]::ReadAllText/WriteAllText`).
- The full vitest suite takes ~15s; perf-test flakes are environmental.
- A `.claude/launch.json` exists in `C:\Users\Trent\.claude\` for the preview
  dev server (runs vite via `node node_modules/vite/bin/vite.js` because the
  preview tool can't spawn npm from a path with spaces).
- See `CLAUDE.md` for architecture, commands, and all conventions.
