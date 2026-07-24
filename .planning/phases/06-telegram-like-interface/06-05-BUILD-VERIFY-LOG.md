# Phase 6 Build Verify Log

Timestamp: 2026-07-21T03:11:58Z
Commit: 7a671de656c59608c3eb52dce61dedea80258160 (feat/tab-title-from-tmux)
Scope: Local `npm run build` verification only. Docker image build is Ashley-gated in the main orchestrator context and NOT executed here (Task 4 deploy deferred).

## Step A — Clean build

Command: `cd /home/ubuntu/skynet && npm run build`
Outcome: **✓ built in 13.48s** — no `error TS`, no `[vite]` error markers.

Key output bundles (bytes):
- `dist/assets/AppShell-8k-38r07.js` — **440,553 bytes** (gzip 84.88 kB) — hosts the Phase 6 conversation-store + ConversationsPanel + AppShell tree-reshape + mobile-flow branches
- `dist/assets/Terminal-DLpMILkc.js` — **141,274 bytes** (gzip 37.95 kB) — hosts patch #57 (compose-drafts URL literal ×3) and patch #102 (`pointer: coarse` ×1)
- `dist/assets/index-BCaWn0X1.js` — **333,125 bytes** (gzip 102.17 kB) — hosts `src/main.tsx` including patch #25's `snapshotPendingTab()` module-load call site
- `dist/backend/backend/ssh/terminal.js` — **103,405 bytes** — hosts backend WS bridge with patch #60 (`message_queue_delete_on_send`) + patch #100 (`ssh_input_delayed_enter`)

Warning surfaced (informational, non-blocking): "Some chunks are larger than 1000 kB after minification" — pre-existing Phase 5 baseline warning about `file-preview-vendor` (1.26 MB) + `codemirror` (1.61 MB) + `pdf.worker.min` (1.05 MB) vendor chunks. Not a Phase 6 regression.

## Step B — Phase 6 artifacts survive Vite tree-shake

Vite minifies user-defined identifiers (function names like `ConversationsPanel`, `NewSessionButton`, `useMobileScreen`, `selectConversationDeferred` are mangled). Grep-gate strategy therefore prefers **string literals that survive minification**: i18n keys, empty-state copy, URL-fragment string constants, and SVG icon names.

Occurrence counts against `dist/assets/AppShell-8k-38r07.js` (using `python3 count` for accurate hits inside minified single-line chunks; `grep -c` line-count is unreliable on minified bundles because everything lives on one line):

| Marker | Count | Provenance |
|--------|------:|------------|
| `conversation` (case-insensitive) | 38 | Phase 6 store + ConversationsPanel + ConversationRow + `nav.conversations.*` i18n |
| `nav.conversations` | 24 | i18n key namespace from Plans 06-01, 06-02, 06-03 |
| `newSession` | 10 | 9 nav.newSession* i18n keys + 1 `newSession` label (Plan 06-04) |
| `settingsMenu` | 10 | 10 SETTINGS_MENU_ITEMS registry keys (Plan 06-02) |
| `backToList` | 2 | mobile-view header i18n (Plan 06-03) |
| `mobileView` | 1 | WorkspaceSpec.mobileView field (Plan 06-03) |
| `'mv'` (any quote style) | 1 | URL-fragment key literal (Plan 06-03) |
| `No active conversations` | 1 | empty-state copy (Plan 06-01, en.json) |
| `[\w-]{0,64}` fragments | 2 | SESSION_NAME_PATTERN regex body (Plan 06-04) |

All Phase 6 markers present. No grep gate returned zero.

### NOTE-04 fallback (plan-check callout)

Per plan-check NOTE-04, `tabNodesRef` name is mangled to a mostly-single-letter identifier and cannot be grep-verified by name in dist. The plan's documented fallback — `grep -c 'appendChild' dist/assets/*.js` — combined with the semantic-artifact grep (`ConversationsPanel` proxy = `nav.conversations` at 24 hits) is used instead:

- `appendChild` in `dist/assets/AppShell-8k-38r07.js` = **6** — the DOM-move mechanism from patch #35 is preserved (matches the 6 `appendChild` call sites in AppShell.tsx that support tabNodesRef mounting / re-parenting).
- `ConversationsPanel` proxy via `nav.conversations` = **24** ≥ 1 ✓
- `NewSessionButton` proxy via `newSession` = **10** ≥ 1 (matches 10 i18n keys from Plan 06-04 exactly).

## Step C — Deletions actually landed in dist

Both `TabBar.tsx` and `MobileBottomBar.tsx` were `git rm`'d in Plans 06-02 and 06-03 respectively. Verify they don't sneak back through Vite dead-code inclusion:

| Marker | dist-wide count | Expected | Result |
|--------|----------------:|---------:|:------:|
| `from.*TabBar` import literal (across all `dist/assets/*.js`) | 0 | 0 | ✓ |
| `MobileBottomBar` identifier (across all `dist/assets/*.js`) | 0 | 0 | ✓ |
| `\bTabBar\b` word-boundary (any use, across all `dist/assets/*.js`) | 0 | 0 | ✓ |

Both deletions confirmed. Zero leaks.

## Step D — Load-bearing prior-patch bytes intact

| Patch | Marker | Location | Count | Expected |
|-------|--------|----------|------:|:--------:|
| #25 | `snapshotPendingTab` (module-load call site) | `src/main.tsx` (source) | 2 | ≥ 1 |
| #25 | `consumePendingWorkspace` | `src/ui/AppShell.tsx` (source) | 3 | ≥ 1 |
| #25 | `snapshot` (in `dist/assets/index-BCaWn0X1.js`) | main.tsx bundle | 2 | ≥ 1 |
| #25 | `pending` (in `dist/assets/index-BCaWn0X1.js`) | main.tsx bundle | 9 | ≥ 1 |
| #35 | `appendChild` (DOM-move fallback) in `dist/assets/AppShell-8k-38r07.js` | AppShell chunk | 6 | ≥ 1 (identifier mangled per NOTE-04) |
| #57 | `/compose-drafts` URL literal in `dist/assets/Terminal-DLpMILkc.js` | Terminal chunk | 3 | ≥ 1 |
| #60 | `message_queue_delete_on_send` in `dist/backend/backend/ssh/terminal.js` | backend terminal.js | 1 | ≥ 1 |
| #100 | `ssh_input_delayed_enter` in `dist/backend/backend/ssh/terminal.js` | backend terminal.js | 1 | ≥ 1 |
| #102 | `pointer: coarse` matchMedia string in `dist/assets/Terminal-DLpMILkc.js` | Terminal chunk | 1 | ≥ 1 |

All load-bearing prior-patch bytes intact. Zero regressions to the six prior patches Phase 6 shares territory with.

**Note on patch #25 direct-fragment literals:** the `#tab=` / `&active=` / `&mv=1` literal strings do not appear verbatim in the minified output because tab-url.ts constructs them via URLSearchParams (each key set as a string arg, then `.toString()` produces the final fragment). Grep for `snapshot`/`pending` in the main-bundle chunk is the substitute; both are present.

## Step E — No source-diff creep (scope fence enforcement)

`git diff --stat` returned **empty output** for every scope-fenced surface:

- `src/ui/features/pretty-view/` — ✓ empty
- `src/ui/features/terminal/Terminal.tsx` — ✓ empty
- `src/ui/features/guacamole/` — ✓ empty
- `src/backend/` — ✓ empty
- `docker/nginx.conf` + `docker/nginx-https.conf` — ✓ empty
- `package.json` + `package-lock.json` — ✓ empty (zero new npm dependencies across the entire phase)

Phase 6 is genuinely frontend-only: no backend routes, no docker/nginx changes, no new dependencies.

## Step F — Deletion sanity (source-side)

- `ls src/ui/shell/TabBar.tsx` → `No such file or directory` ✓
- `ls src/ui/shell/MobileBottomBar.tsx` → `No such file or directory` ✓
- `grep -rn "from ['\"]@/shell/TabBar" src/ui | wc -l` → **0** ✓
- `grep -rn "from ['\"]@/shell/MobileBottomBar" src/ui | wc -l` → **0** ✓

Zero dangling imports; source tree is consistent with dist artifact absence.

## Verdict

**CLEAN** — safe for Ashley-gated deploy in the main orchestrator context.

Rationale:
1. Build completes in 13.48s with no errors and no new warnings beyond the pre-existing large-vendor-chunk informational.
2. All Phase 6 frontend surfaces (conversation-store + ConversationsPanel + NewSessionButton + mobile-flow + settings row) shipped into `dist/assets/AppShell-8k-38r07.js` per the i18n + string-literal marker inventory (Step B).
3. Both TG-11-mandated deletions (TabBar.tsx, MobileBottomBar.tsx) actually landed in dist — zero leaks (Step C).
4. All six load-bearing prior patches (#25, #35, #57, #60, #100, #102) verified intact in dist via patch-specific markers (Step D).
5. Scope fence honored — zero source diffs to pretty-view, terminal, guacamole, backend, docker, or package.json (Step E).
6. Source-side deletions consistent with dist absence (Step F).

Deploy remains Ashley-gated per fork discipline (`~/.claude/identities/tina/deploy-runbook.md` — DEADMAN IS MANDATORY, NO EXCEPTIONS; blanket pre-authorization ≠ per-deploy green light). Task 4 in Plan 06-05 is deferred to the main orchestrator context after Ashley reviews UAT checklist + patches-md entry and gives explicit deploy green-light.

---

*Executed 2026-07-21 by Plan 06-05 Task 1 executor (Tasks 1-3 scope only).*
