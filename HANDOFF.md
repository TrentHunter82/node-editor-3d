# HANDOFF — Rosebud 3D Node Editor

Working notes for picking up where the last session left off. Not part of the app;
safe to delete once the open items below are done.

_Last updated: 2026-05-31_

## Current state (all green)

- **Builds clean:** `npm run build` → exit 0.
- **All tests pass:** `npm test` → 9075/9075.
- **Dev server runs:** `npm run dev` (port 5173, auto-increments if taken).
- **`main` is up to date** at commit `12e68a2` (pushed to
  `github.com/TrentHunter82/node-editor-3d` over HTTPS).
- See `CLAUDE.md` for architecture, commands, and conventions.

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

### 1. Lint cleanup (~47 errors, all in `src/`) — DEFERRED, not started
`npm run lint` is the source of truth. These are advisory (don't fail the build).
Deferred because the earlier session's tool channel was corrupting file reads and
editing ~47 sites blind was too risky. Buckets:

- **`@typescript-eslint/no-explicit-any`** (~23) — store generics & R3F props:
  `store/editorStore.ts` (L774, L1355), `store/slices/{checkpoint,subgraph,template,undo}Slice.ts`,
  `components/connections/Pipe.tsx`, `PendingPipe.tsx`. Mostly intentional; either
  type properly or scoped-disable with a rationale.
- **`react-hooks/*` (refs / purity / set-state-in-effect / rules-of-hooks)** (~16)
  — new React-19-compiler-readiness rules from `eslint-plugin-react-hooks` v7.
  Flags working patterns: `Date.now()` during render in `NodeEffects.tsx`,
  ref access during render in `NodeGraph.tsx`/`App.tsx`/`InstancedPorts.tsx`,
  `setState` in effects across several panels, and a conditional `useEffect` in
  `components/ui/menus/PortReleaseMenu.tsx` (L141 — the early `return null` guards
  at L23/L38 sit before a hook → genuine rules-of-hooks issue worth fixing).
- **`react-refresh/only-export-components`** (~9) — files exporting a component +
  a helper (breaks HMR): `NodeScreen.tsx`, `BoxSelection.tsx`,
  `GroupBoundingBox.tsx`, `NodeProfilingOverlay.tsx`. Fix by moving helpers to
  their own modules.
- **`no-unsafe-function-type`** (~5) — `Function` type in
  `utils/executionProcessors.ts` (expression cache). Replace with a precise
  `(...args: unknown[]) => unknown` signature.

Recommended approach: do it in a stable session, one rule-bucket at a time, run
`npm test` + `npm run build` after each bucket. The `PortReleaseMenu` rules-of-hooks
one is the only one that hints at a latent runtime bug — prioritize it.

### 2. Bundle code-splitting — NOT started
Build warns: `three` (719 kB), `r3f` (522 kB), `index` (614 kB) chunks > 500 kB.
Cosmetic, but worth `manualChunks` tuning in `vite.config.ts` if load time matters.

### 3. Nice-to-haves observed
- No CI. A GitHub Action running `npm run build && npm test` on push would catch
  regressions like the ones fixed this session.
- Lint isn't part of `build`, so lint errors accumulate silently.

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
