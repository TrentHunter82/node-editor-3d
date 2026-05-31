# HANDOFF — Rosebud 3D Node Editor

Working notes for picking up where the last session left off. Not part of the app;
safe to delete once the open items below are done.

_Last updated: 2026-05-31 (session 2 — lint backlog closed + Live Mode added)_

## Current state (all green)

- **Builds clean:** `npm run build` → exit 0 (only the cosmetic three.js/r3f
  chunk-size warning remains).
- **Lint clean:** `npm run lint` → **0 problems** (was 16 errors + 29 warnings).
- **All tests pass:** `npm test` → **9081/9081** (added `live-mode.test.ts`).
- **Dev server runs:** `npm run dev` (port 5173, auto-increments if taken).
- **`main` HEAD is `0d86233`** locally. NOT pushed this session (HTTPS push held
  for an explicit ask; prior session's pushed commit was `12e68a2`). Run
  `git push` from your terminal, or ask, to publish `de24b10` + `0d86233`.
- See `CLAUDE.md` for architecture, commands, and conventions.

## Session 2 (2026-05-31): lint backlog closed + Live Mode

- **react-hooks/react-compiler lint backlog fully cleared** (`de24b10`), all
  refactored properly (no scoped-disables; stale disables removed). Buckets:
  refs-during-render, impure-during-render, set-state-in-effect, immutability,
  and the preserve-manual-memoization/exhaustive-deps cascade in `App.tsx`.
  Note: fixing a component's first violation can *un-mask* others the React
  Compiler had been bailing on (saw this in `App.tsx` and `Minimap.tsx`) — fix
  iteratively and re-lint.
- **Live Mode feature** (`0d86233`): execute-bar toggle + Settings interval that
  re-runs the graph on a timer (100ms–60s) so `timer`/`http-fetch` update
  hands-free. New `useLiveExecution` hook; `liveMode`/`liveIntervalMs` settings.
- **`CREATIVE-USE-CASES.md`** added — grounded use-case brainstorm + a prioritized
  enhancement list (next picks: copy/export a node's computed value; a
  presentation/"mini-app" view; `http-fetch` method/headers + CORS note; CSV
  nodes; bundle code-splitting to clear the build warning).

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

### 1. Lint cleanup — ✅ DONE (session 2, `de24b10`)
`npm run lint` → 0 problems. The whole backlog (no-explicit-any, react-refresh,
no-unsafe-function-type, rules-of-hooks, and the remaining react-hooks/react-
compiler readiness rules) is cleared, all refactored properly. Lint still isn't
part of `build` (see Nice-to-haves) — add a CI/precommit gate to keep it at 0.

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
