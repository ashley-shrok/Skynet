---
phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
plan: 02
subsystem: ui
tags: [react, sse, birth-flow, modal-lock, spinner-in-button, sole-spawner]

# Dependency graph
requires:
  - phase: 20 (Plan 06)
    provides: The 5-step BirthProgress checklist + SSE consumer (now collapsed by this plan)
  - phase: 88 (Plan 02)
    provides: shellOnly/identityMode local-state rename + isAdmin gates preserved untouched here
  - phase: 106 (Plan 01, sibling in Wave 1)
    provides: The backend timeout-alerting SSE `ended:ok:false` event that this plan's new failure surface consumes
provides:
  - "Spinner-in-Create-button UX for identity-mode birth in NewSessionDialog"
  - "Modal fully locked from Create click to birth resolution (D-15)"
  - "Single generic `window.alert(\"agent creation failed\")` failure surface (D-17) — replaces per-step failure blurbs"
  - "Frontend SSE consumer that discards `step` events and only branches on terminal `ended` (D-12)"
affects: [106-03 (integration tests), 106-04 (test-suite refresh for the frontend axis), all future identity-birth UX work]

# Tech tracking
tech-stack:
  added: []  # no new deps; reuses existing Loader2 from lucide-react
  patterns:
    - "Modal close lock via `onOpenChange={(next) => { if (!next && !gate) onClose(); }}` — pattern generalizable to any long-running-op modal in this codebase"
    - "Button label ↔ Loader2 spinner swap for in-flight submits (no separate progress region)"

key-files:
  created: []
  modified:
    - "src/ui/sidebar/NewSessionDialog.tsx (1345 → 1244 lines, net -101; 94 insertions, 195 deletions)"

key-decisions:
  - "Cancel button rendered ALWAYS with `disabled={birthing}` (per spec) — chose not to hide, to avoid visual jump-vanish during the spin"
  - "Loader2 sizing = size-4 (per plan spec) — matches Button's default text-line-height affordance"
  - "abortControllerRef + component-unmount cleanup effect preserved intact — page navigation (tab close, route change) still cancels the SSE stream even though direct modal close is blocked while birthing"
  - "Comment prose rewritten to avoid the deleted-symbol names (BirthProgress / BIRTH_STEP_LABELS / etc) verbatim so the plan's grep-based source assertions return 0 for those identifiers"

patterns-established:
  - "Long-running-op modal lock: Dialog.onOpenChange no-ops when a boolean gate is true, Cancel button visually inert via disabled attribute"
  - "Loader2 in-button replacement for text label during in-flight async submits"

requirements-completed: [D-13, D-14, D-15, D-16, D-17, D-18, D-19]

# Metrics
duration: ~6m 17s (377s)
completed: 2026-09-11
---

# Phase 106 Plan 106-02: Collapse birth checklist to spinner-in-button UX Summary

**Deleted the 5-step BirthProgress inline component + associated step-state tables/types and replaced them with a Loader2-in-Create-button UX, a fully locked modal during birth, and a single generic `window.alert("agent creation failed")` failure surface — matching what the sole-spawner backend can actually observe now that the agent-supervisor (not Skynet) runs tmux+claude.**

## Performance

- **Duration:** ~6m 17s (377s)
- **Started:** 2026-09-11T16:45:48Z
- **Completed:** 2026-09-11T16:52:05Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments

- Deleted the entire 5-step birth checklist scaffolding: the step-labels table, the per-step failure blurb table, the per-step state type + initial-state table, and the inline sub-component that rendered the ticking list (D-13/D-19).
- Introduced a Loader2 spinner as the Create button's label while `birthing===true` (D-14). No more "Creating..." string.
- Locked the modal fully from Create click to birth resolution via two coordinated gates (D-15): (a) the Dialog's `onOpenChange` handler no-ops when `birthing===true`, blocking X-button / Esc / backdrop-click; (b) the Cancel button remains rendered but disabled, preventing visual jump-vanish while preserving the "modal is inert" affordance.
- Collapsed the failure surface to a single generic `window.alert("agent creation failed")` (D-17) fired from both branches — `ended:ok:false` AND the outer catch (stream throw / network / abort). The alert is followed by immediate `onClose()`. No fields preserved; user re-opens fresh.
- Preserved the D-18 success chain unchanged: `refreshIdentities() → onCreate({...identityMode:true, name}) → setBirthing(false) → onClose()`.
- Preserved `AppShell.tsx:2236` `onCreateSession` handler byte-untouched per D-16 (auto-route mechanic already correct: `openTab(..., { allowCreateTmux: false })` + `selectConversationDeferred`).
- Preserved the shell-only branch byte-behavior-identical: `identityMode: false` payload, same fields, same submit path, same close-on-submit.
- Preserved `abortControllerRef` + the component-unmount cleanup effect intact so page navigation (tab close, route change) still terminates the SSE stream gracefully even though direct modal close is blocked during birthing.
- Pruned no-longer-used lucide-react icon imports (Check/XCircle/Circle removed; Search/Loader2 kept).

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete BirthProgress + step-checklist state; add spinner-in-button + modal lock + alert-on-failure** — `19997f13` (refactor)

_No metadata commit yet — this plan is one of two Wave 1 partners, so the plan-close metadata commit is deferred to the orchestrator's post-wave step._

## Files Created/Modified

- `src/ui/sidebar/NewSessionDialog.tsx` — Refactored the identity-mode birth branch: removed the 5-step checklist scaffolding (BirthProgress inline component + labels/blurbs/state tables + related state hooks + resetBirthProgress helper + anyStepActive/showBirthProgress derivations + the render block), replaced the Create button's text label with a Loader2 spinner during birthing, added modal close-lock via `onOpenChange` gate, and collapsed the SSE consumer's terminal handling to a single generic alert on any failure. Shell-only branch untouched; `abortControllerRef` + unmount cleanup preserved.

## Decisions Made

- **Cancel button treatment:** Chose `disabled={birthing}` (rendered-always) per plan spec, not hidden-during-birthing. Rationale: mirrors the form-field disabled pattern and avoids visual jump-vanish. The Dialog's `onOpenChange` handler is the actual close-lock gate; the disabled attribute is the visual affordance side. **(Spec-compliant, no deviation.)**
- **Loader2 sizing:** `size-4` per plan spec (not `size-3.5` which the deleted per-step icons used in a different context). `size-4` matches the Button component's default text-line-height affordance. **(Spec-compliant.)**
- **abortControllerRef + unmount cleanup effect:** KEPT intact per plan warning N-3. Even with the modal-close-lock in place, a page-level navigation (tab close, route change) still needs the SSE stream to terminate gracefully — the ref's cleanup effect handles that. Deleting the ref would introduce a subtle background-fetch leak in the navigation-away edge case.
- **Comment prose rewrite:** The block-level and inline comments referencing the deleted identifiers were rewritten to describe the change in prose without using the identifier names verbatim (e.g. "per-step birth checklist" instead of "BirthProgress checklist"). Reason: the plan's automated verify block uses `grep -c '<identifier>' | grep -q '^0$'` — comment mentions would defeat the assertions.
- **Cross-scope backend TS error acknowledgment:** During `npm run build`, backend TS errors surfaced in `src/backend/database/routes/identity-birth-orchestrator.ts` (unmodified by me — it's the Wave 1 sibling plan 106-01's in-flight work). Verified via `git diff --name-only HEAD` before commit that my staged diff contains only `src/ui/sidebar/NewSessionDialog.tsx`. `npx vite build` (frontend-only) passes exit=0; the backend `tsc` step will resolve once 106-01 finishes its work.

## Deviations from Plan

**None — plan executed exactly as written.**

No Rule 1 / Rule 2 / Rule 3 auto-fixes triggered. All eight action edits landed as specified with the specified sizing (Loader2 `size-4`), the specified Cancel treatment (`disabled` not hidden), and the specified failure-surface behavior (alert + onClose on both failure branches).

## Issues Encountered

- **Backend TS errors surfaced during full `npm run build`.** Errors are in `src/backend/database/routes/identity-birth-orchestrator.ts` — a file NOT touched by this plan. This file is being modified concurrently by the sibling Wave 1 plan (106-01, backend). Per the plan header: *"Wave 1 (parallel with 106-01, no file overlap — 106-01 touches backend only, 106-02 touches frontend only)"*. My scope is frontend only; the backend build will pass once 106-01 finishes. `npx vite build` alone (frontend) passes cleanly with exit=0.
- **7 tests in `src/ui/sidebar/NewSessionDialog.test.tsx` now fail** — expected and documented in the plan verification block line 182: *"Existing frontend tests EXPECTED to fail in this plan (they assert on BirthProgress rendering) — Plan 106-04 updates the tests. Do NOT block plan-close on those failing."* The failing tests all assert on `data-status="failed"` rows, per-step blurbs, or the "failed birth keeps modal open" pre-phase semantic. The other three test files (`NewSessionDialog.chain.test.tsx`, `NewSessionDialog.role-dropdown.test.tsx`, `NewSessionDialog.task-input.test.tsx`) all pass (68 passing across all four files; 7 failing all in the pre-phase birth-progress test file).

## Verification Evidence

**Automated source assertions** (from Task 1 `<automated>` block):

```
grep -c "BirthProgress"          → 0 ✓
grep -c "BIRTH_STEP_LABELS"      → 0 ✓
grep -c "BIRTH_STEP_BLURBS"      → 0 ✓
grep -c "BirthStepState"         → 0 ✓
grep -c "INITIAL_BIRTH_PROGRESS" → 0 ✓
grep -c "birthFailedStep"        → 0 ✓
grep -c "birthProgress"          → 0 ✓
grep -c "setBirthProgress"       → 0 ✓
grep -c "resetBirthProgress"     → 0 ✓
grep -c 'evt.type === "step"'    → 0 ✓
grep -c 'window.alert("agent creation failed")' → 5 (≥2 required — 3 in comment prose + 2 call sites) ✓
grep -c "Loader2"                → 2 (import + Create button render) ✓
grep -c "refreshIdentities"      → 3 (import + call + comment) — D-18 preserved ✓
grep -c "!birthing"              → 2 (Dialog onOpenChange lock + a defensive check) — D-15 close-lock present ✓
grep -c 'const \[birthing, setBirthing\]' → 1 (survivor state per D-15) ✓
grep -c 'identityMode: false'    → 3 (1 in the type union at :165, 1 in a comment at :1214, 1 in the shell-only submit branch at :1223) — shell-only branch untouched ✓
```

**Non-touch invariant:** `git diff HEAD~1 HEAD --stat src/ui/AppShell.tsx` returns empty (AppShell.tsx byte-untouched, D-16). ✓

**Frontend TypeScript:** `npx tsc --noEmit` exits 0. ✓

**Frontend build:** `npx vite build` exits 0 (2.62s). ✓

**Backend build:** `npm run build` exits 2 due to backend TS errors in `identity-birth-orchestrator.ts` — that file is out of scope for this plan (Wave 1 sibling 106-01's territory).

**Scoped tests:** `npx vitest run src/ui/sidebar/NewSessionDialog{.test,.chain.test,.role-dropdown.test,.task-input.test}.tsx` — 4 files, 75 total tests, 68 pass, 7 fail. All 7 failures in `NewSessionDialog.test.tsx` assert on removed BirthProgress rendering (BB / CC / EE / FF / W / X / Z) — expected per plan verification note; Plan 106-04 refreshes the test suite.

**Post-commit deletion check:** `git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty (no files deleted).

## Next Phase Readiness

- **For Plan 106-03 (integration tests):** The new frontend shape is committed and stable. Integration tests can exercise the end-to-end birth-flow with the new SSE contract (only `ended` events matter frontend-side; failure branch fires the generic alert).
- **For Plan 106-04 (test-suite refresh):** The 7 failing tests in `NewSessionDialog.test.tsx` are the exact set that Plan 106-04 needs to update. Suggested assertions to add per D-21: (a) `disabled={true}` on Cancel button while birthing, (b) `<Loader2>` renders inside the Create button while birthing, (c) `window.alert` fires with `"agent creation failed"` on both `ended:ok:false` and outer-catch paths, (d) Dialog's `onOpenChange` no-ops when `birthing===true`.

## Verifier Notes / Things to Double-Check

- **AppShell.tsx byte-untouched:** already asserted — `git diff HEAD~1 HEAD --stat src/ui/AppShell.tsx` returns empty. Verifier can re-check with the same command.
- **Shell-only branch byte-identical:** the `identityMode: false` submit branch at `src/ui/sidebar/NewSessionDialog.tsx:1219-1224` is unchanged. Verifier can `git diff HEAD~1 HEAD src/ui/sidebar/NewSessionDialog.tsx | grep -A 3 -B 3 "identityMode: false"` — should show only surrounding context, no `-` or `+` on the payload lines.
- **`window.alert` count of 5:** three occurrences are in explanatory comments (line 195, 585, 753 of the current file), two are actual call sites (lines 692, 702). This is correct.
- **`refreshIdentities` count of 3:** one import (line 111), one call (line 665, inside handleBirth success path), one mention in the D-18 preservation comment. Order preserved: `await refreshIdentities()` fires BEFORE `onCreate()` per D-18.
- **Backend TS error mention:** the sibling Wave 1 plan (106-01) is modifying `src/backend/database/routes/identity-birth-orchestrator.ts` concurrently — if the verifier runs `npm run build` after both plans land, backend TS should also pass. Frontend-only build via `npx vite build` was clean at commit time.
- **`!birthing` count of 2:** one in the pre-existing `canOpen` gate at line 740 (disables Create button during birth — unchanged from pre-phase), one in the new Dialog `onOpenChange` handler at line 809 (the D-15 modal-close lock).

## Self-Check: PASSED

- **File exists check:** `.planning/phases/106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s/106-02-SUMMARY.md` FOUND (this file).
- **Commit exists check:** `git log --oneline` → `19997f13 refactor(106-02): collapse birth checklist to spinner-in-button + modal lock + alert-on-failure` FOUND.
- **Modified file exists check:** `src/ui/sidebar/NewSessionDialog.tsx` FOUND (1244 lines, was 1345).

---
*Phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s*
*Completed: 2026-09-11*
