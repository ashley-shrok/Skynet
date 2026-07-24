---
phase: quick-260723-bbt
plan: 01
subsystem: pretty-conversations, state-stores
tags:
  - patch-137
  - pretty-conversations
  - active-set
  - ready-dot
  - session-working-store
  - conversation-store
  - ambient-recession
dependency-graph:
  requires:
    - patch #136 (full pretty-view bubble+badge — provides the isWip render slot inverted here)
    - Terminal.tsx isIdle state (patch #13, WS-published idle transitions)
    - conversation-store selectConversation + useSyncExternalStore pattern
  provides:
    - session-working-store module (in-memory per-(host, tmuxSession) working state)
    - conversation-store activeSet + sessionStorage persistence layer
    - PrettyConversationRow ambient-recession branch + ready-dot render slot
    - PrettyConversationsPanel PrettyConversationRowLive micro-component (Rules-of-Hooks-safe per-row store subscription)
  affects:
    - Every row in PrettyConversationsPanel now visually distinguishes engaged (active-set, full bubble) vs ambient (not selected in this session, recessed) rows
    - Rows where the agent is idle (isIdle-published false) AND that Ashley has engaged with show a steady hue-cream "ready" dot
tech-stack:
  added:
    - session-working-store (module-scoped Map<string, boolean|null> + useSyncExternalStore, mirrors conversation-store pattern verbatim)
  patterns:
    - Micro-component wrapper (PrettyConversationRowLive) for Rules-of-Hooks compliance inside .map() callbacks — extracted so useSessionWorking sits at a stable top-level hook site rather than fired-inside-callback
    - sessionStorage-backed Set persistence with silent try/catch fallbacks on hydration + write paths (SSR/JSDOM/quota-exceeded safe)
    - Ambient-vs-full branch selector inline in style construction (isAmbient = !inActiveSet && !isRdp) — avoids new CSS classes; layered under existing hover/selected overlay chain
key-files:
  created:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (DEVIATION — Rule 1 test-mock fix)
    - src/ui/index.css
decisions:
  - Chose the plan's Choice A for ambient recession — conditional inline style object driven by isAmbient, layered via spread under hoverOverlay/selectedOverlay/bodyTransformStyle. No new stylesheet section required.
  - Extracted a PrettyConversationRowLive micro-component for Rules-of-Hooks safety inside .map() (per plan §Task 4 SAFER pattern note).
  - Added a __resetActiveSetForTest() helper — not in the plan, but required for test-isolation because conversation-store lacks a removeFromActiveSet API by design (§3: the set only grows within a session). Rule 3 fix (test infrastructure).
  - Updated existing conversation-store.test.ts Test 12 (reactive emit semantics) from "4 real mutations" to "5" because selectConversation now fires an additional notify() via the addToActiveSet side-effect on a first-time-selected id. Rule 1 fix — existing test breaks because of intentional new patch #137 behavior.
  - Updated PrettyConversationsPanel.test.tsx mocks (added useActiveSet + new useSessionWorking mock) to reflect the panel's expanded store surface. Rule 1 deviation — test file NOT in files_modified budget but 15 existing tests break without it.
  - Test 18's ambient-body-style probe uses regex-based checks (`not.toContain("linear-gradient")` + hsla hairline in box-shadow + `/background:[^;]*0.16/` regex) instead of a literal `hsla(210, 40%, 20%, 0.16)` substring — jsdom's CSSOM normalizes hsla → rgba when applied to the `background` property but preserves hsla in box-shadow context. Matches the existing Test 12 hue-invariant pattern.
metrics:
  duration: "~50 minutes"
  completed: "2026-07-23"
  files_touched: 10
  commits: 1
  tests_added: 12
  tests_updated: 3
---

# Quick Task 260723-bbt: Conversation-List Active-Set + Ready-Dot + Session-Working Store Summary

Wired patch #137 per Ashley's LOCKED 2026-07-23 spec — pretty-conversations rows now visually distinguish engaged (active-set) vs ambient (backgrounded) sessions and telegraph agent-idle-ready-for-input status via a single steady hue-cream dot. Ready-dot renders iff `inActiveSet === true && isWorking === false`; ambient recession applies to non-RDP rows NOT in the active-set. RDP rows are exempt from ambient recession and never render the dot.

## What Changed

### New: session-working-store (2 files, 243 lines)

`src/ui/state/session-working-store.ts` — in-memory `Map<string, boolean|null>` module-scoped store with `publishSessionWorking / useSessionWorking / getSessionWorkingSnapshot / __resetForTest` exports. Mirrors conversation-store's useSyncExternalStore pattern verbatim. No sessionStorage/localStorage — page refresh resets; the next isIdle emit from each mounted Terminal.tsx re-populates. Publishing `null` overwrites (does NOT delete) the key. Multiple keys are independent.

`src/ui/state/session-working-store.test.ts` — 4 Vitest tests: publish→hook round-trip through `true/false/null` proving null OVERWRITES; unknown-key semantics; null-key short-circuit; independent-keys invariant.

### Modified: conversation-store activeSet (2 files, +201 lines)

`src/ui/state/conversation-store.ts`:
- Added `ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set"` constant.
- Added `hydrateActiveSetFromStorage()` — try/catch-wrapped JSON.parse with strict `Array.isArray` + `typeof v === "string"` per-element filter; empty Set fallback on any failure.
- Added `State.activeSet: Set<string>` field, initialized from the hydrate helper on module load.
- Added `addToActiveSet(id)` — idempotent no-op when already present (avoids gratuitous sessionStorage writes); silent try/catch on setItem; new Set reference on real mutation; notify().
- Added `useActiveSet(): ReadonlySet<string>` — useSyncExternalStore returning `state.activeSet`. Mirrors usePinnedIds shape.
- Wired `selectConversation(id)` to call `addToActiveSet(id)` for non-null ids AFTER the stale-guard passes but BEFORE the same-selectedId short-circuit (so re-selecting the currently-selected id still counts as engagement — addToActiveSet is idempotent so this is a cheap no-op).
- Added `__resetActiveSetForTest()` test-only helper for test isolation.

`src/ui/state/conversation-store.test.ts`:
- Added sessionStorage.clear() + __resetActiveSetForTest() to beforeEach.
- Added 3 new tests: `selectConversation → activeSet + sessionStorage`; idempotent-second-call (no duplicate write); module-init hydration via `vi.resetModules()` + dynamic re-import.
- Updated existing Test 12 (reactive emit semantics): expected count 4 → 5 because `selectConversation` on a first-time-selected id now fires two notify() calls (addToActiveSet + selectedId change).

### Modified: Terminal.tsx (13 lines added)

`src/ui/features/terminal/Terminal.tsx`:
- Added `import { publishSessionWorking } from "@/state/session-working-store"`.
- Added ONE useEffect immediately after the existing `isIdle` useState declaration (~line 245) firing on `[isIdle, hostConfig.id, tmuxSessionName]`, emitting `publishSessionWorking(key, isIdle === null ? null : isIdle === false)` where `key = ${hostId}:${tmuxSessionName ?? ""}`. Early-returns when hostId is null.
- NO cleanup function — preserve last-known state across route changes per §1.
- Every other line of Terminal.tsx is byte-identical to pre-patch.

### Modified: PrettyConversationRow (2 files, +400 lines)

`src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:
- Prop rename: `isWip?: boolean` → `isWorking?: boolean | null` (default null); new `inActiveSet?: boolean` (default false).
- Added `isAmbient = !isRdp && !inActiveSet` derivation right after `isRdp`.
- Refactored avatarStyle IIFE with a top-of-function ambient branch — ambient linear-gradient (35-30% saturation), softer border (0.24 alpha), reduced shadow (0 2px 6px), hue-null neutral fallback preserved.
- Refactored baseBodyStyle: `isAmbient ? ambientBase : fullBubbleBase`. Ambient body uses flat `hsla(H, 40%, 20%, 0.16)` (not gradient), 0.14-alpha border, minimal inset + hairline shadow, `backdrop-filter: none`, muted foreground `rgba(251,245,232,0.72)`.
- Refactored hoverOverlay: ambient-hover branch (background + border-color shifts only, NO transform lift, NO shadow boost) replaces the full-bubble hover object when `isAmbient && shouldHover`. Full-bubble hover preserved verbatim for active-set rows.
- Label span: ambient-branch textShadow "none" + fontWeight 500 + className `font-medium` (instead of `font-semibold`). Host icon + host-name color shifts to `rgba(255,235,190,0.45)` under ambient.
- REPLACED the patch #136 WIP-pulse dot render block with the patch #137 ready-dot: renders iff `inActiveSet && isWorking === false` (strict-equality — null and true both suppress). aria-label="ready", data-pv-conv-ready-dot="true", steady (NO animation string). Hue-cream fill `hsla(H, 60%, 80%, 1)` with hue outer glow + warm inset per prototype v4; neutral rgba fallback for hue==null.

`src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`:
- Test 1 (selected-row hue): added `inActiveSet={true}` so the row stays in the full-bubble treatment.
- Test 12 (full-bubble every row): same — added `inActiveSet={true}`.
- Test 13 (renamed + inverted): now covers `inActiveSet+isWorking===false → ready-dot with aria-label="ready"`, asserts `data-pv-conv-ready-dot="true"` + empty `style.animation` + old "working" aria-label absent.
- Test 14 (renamed): RDP row + `inActiveSet+isWorking===false` uses neutral rgba(240,235,224,…) fill (proves neutral-branch fallback).
- Test 15 (NEW): `inActiveSet+isWorking===true` renders NO ready-dot.
- Test 16 (NEW): `inActiveSet+isWorking===null` renders NO ready-dot.
- Test 17 (NEW): `!inActiveSet+isWorking===false` renders NO ready-dot (ambient never shows).
- Test 18 (NEW): `!inActiveSet && !isRdp` row applies ambient body style — regex-based probes because jsdom normalizes hsla→rgba inside `background` values but preserves hsla in box-shadow context.
- Test 18b (NEW): RDP row is EXEMPT from ambient — inActiveSet=false still uses neutral full-bubble treatment (proved via 0 8px 24px drop-shadow signature + rgba(60,65,80,…) baseline).
- Total: 20 tests, all green.

### Modified: PrettyConversationsPanel (2 files)

`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:
- Added `useActiveSet` import from `@/state/conversation-store` and new `useSessionWorking` import from `@/state/session-working-store`.
- Added `sessionWorkingKey(row)` helper — returns `${row.host.id}:${row.targetTmuxSession ?? ""}` when `row.host != null`, else null. Fleet-only-pre-resolution + host-less races resolve to null → useSessionWorking short-circuits → dot suppressed.
- Added `PrettyConversationRowLive` micro-component ABOVE the exported panel — wraps `PrettyConversationRow` with a per-row `useSessionWorking(sessionKey)` call at a stable top-level hook site (Rules-of-Hooks compliance inside `.map()`).
- Hoisted `const activeSet = useActiveSet()` once alongside the existing `useConversations / useSelectedConversationId / usePinnedIds` trio.
- Replaced 3 `<PrettyConversationRow ... isWip={false} />` render sites (pinned map, regular host map, RDP-sentinel map) with `<PrettyConversationRowLive ... inActiveSet={activeSet.has(row.id)} sessionKey={sessionWorkingKey(row)} />`. `isWip={false}` fully removed from panel.
- Replaced stale patch-#136 comment with a short patch-#137 wiring note.

`src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (DEVIATION):
- Added `useActiveSet: () => new Set<string>()` to the conversation-store vi.mock so the new hook resolves under test.
- Added a new `vi.mock("@/state/session-working-store", () => ({ useSessionWorking: () => null }))` so the panel's new store subscription resolves under test.
- These test-mock stubs match the pre-patch-#137 behavior (empty active-set, null working-state → dot never renders) so the 15 existing tests continue to pass without behavioral changes.

### Modified: index.css (29 lines removed)

`src/ui/index.css`:
- Removed the entire patch #136 header comment block (`/* ── Patch #136: pretty-conversations WIP pulse-dot ─── ... */`).
- Removed `@keyframes pv-conv-wip-pulse { ... }` (the pulse animation).
- Removed the `@media (prefers-reduced-motion: reduce) { [data-pv-conv-wip-dot="true"] { ... } }` fallback block.
- Other `@media (prefers-reduced-motion: reduce)` block at line 605 is PRESERVED (unrelated).
- Zero references to `pv-conv-wip-pulse` or `data-pv-conv-wip-dot` remain anywhere in `src/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Testability] Added `__resetActiveSetForTest()` helper**
- **Found during:** Task 2 test scaffolding.
- **Issue:** The plan's Task 2 spec forbids a `removeFromActiveSet` API (activeSet only grows within a session per §3), but conversation-store.test.ts's `beforeEach` needs to reset the module-scoped Set to avoid prior-test id leakage. Without a reset helper, later tests would see activeSet populated from earlier `selectConversation` calls.
- **Fix:** Added a `__resetActiveSetForTest()` test-only export that calls `hydrateActiveSetFromStorage()` (which returns empty when sessionStorage has been cleared) and notifies. Prefixed `__` per the existing test-helper convention (`__subscribeForTest`, `__getSnapshotForTest`, etc.).
- **Files modified:** `src/ui/state/conversation-store.ts` (+8 lines), `src/ui/state/conversation-store.test.ts` (+1 import + 1 call in beforeEach).
- **Commit:** `9450526`.

**2. [Rule 1 - Bug] Updated existing conversation-store.test.ts Test 12 (reactive emit semantics)**
- **Found during:** Task 2 verify step (vitest run).
- **Issue:** Existing Test 12 expected `expect(cb).toHaveBeenCalledTimes(4)` after `updateHostTree + updateOpenTabs + selectConversation + pinConversation`. Patch #137 makes `selectConversation("t1")` on a first-time-selected id fire TWO notify() calls (addToActiveSet's notify + selectedId change's notify), so the correct count is 5.
- **Fix:** Updated the assertion to 5 with an inline comment explaining the patch #137 side-effect chain. Also refreshed the no-op-mutation section's comment for `selectConversation("t1")` (second call — now id is already in activeSet AND already selected → both guards short-circuit → 0 emits, unchanged).
- **Files modified:** `src/ui/state/conversation-store.test.ts` (~10 lines).
- **Commit:** `9450526`.

**3. [Rule 1 - Bug] Updated PrettyConversationsPanel.test.tsx mocks (out-of-budget file)**
- **Found during:** Task 4 verify step (vitest run on panel test suite).
- **Issue:** 15 existing panel tests failed with `No "useActiveSet" export is defined on the "@/state/conversation-store" mock`. Panel's new hook subscriptions (`useActiveSet` + `useSessionWorking`) don't exist in the mocked module surface. This file is NOT in the plan's `files_modified` budget but the failures are directly caused by patch #137's code additions.
- **Fix:** Added `useActiveSet: () => new Set<string>()` to the existing `vi.mock("@/state/conversation-store", ...)` block and added a new `vi.mock("@/state/session-working-store", () => ({ useSessionWorking: () => null }))` block. Both stubs match pre-patch-#137 behavior (empty set → all rows ambient; null → dot never renders) so none of the 15 tests need behavioral updates.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (+16 lines).
- **Scope-budget note:** This is the 10th file touched by the commit (plan called for 9). The alternative — leaving 15 tests broken and committing anyway — would violate the plan's verification block "regression baseline preserved elsewhere." Executor judged the 10th-file fix as strictly in-scope per Rule 1 semantics.
- **Commit:** `9450526`.

**4. [Rule 3 - Test-authoring] Test 18 body-style probe rewritten for jsdom CSSOM normalization**
- **Found during:** Task 3 verify step (vitest run of the new Test 18 at first authoring).
- **Issue:** The plan's Test 18 spec asserted `expect(rawStyle).toContain("hsla(210, 40%, 20%, 0.16)")`. jsdom's CSSOM normalizes `hsla(...)` → `rgba(...)` when applied to the `background` property (but preserves hsla inside `box-shadow` values — same quirk documented in the existing Test 12 comment block).
- **Fix:** Rewrote the probe to use three jsdom-compatible invariants: (a) `not.toContain("linear-gradient")` proves the ambient branch fired (full-bubble is a gradient); (b) `toContain("hsla(210, 60%, 55%, 0.08)")` in box-shadow proves hue-derived; (c) `/background:[^;]*0\.16/` regex catches the 0.16 alpha stop regardless of hsla-vs-rgba representation. Same fix pattern applied to Test 18b's rgba(60,65,80,…) probe — jsdom adds spaces between components, so regex `rgba\(60,\s*65,\s*80/` matches both space-styles.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` (Tests 18 + 18b).
- **Commit:** `9450526`.

### Authentication Gates

None. This patch is entirely UI/state layer; no backend, no auth surface.

## Verification Results

### TypeScript

`npx tsc --noEmit` — zero errors across all 10 modified files.

### Vitest

- **session-working-store.test.ts:** 4/4 pass.
- **conversation-store.test.ts:** 38/38 pass (was 35; +3 new).
- **PrettyConversationRow.test.tsx:** 20/20 pass (was 14; +5 new: Tests 15/16/17/18/18b; Tests 13/14 semantics updated; Tests 1/12 gained explicit `inActiveSet={true}`).
- **PrettyConversationsPanel.test.tsx:** 15/15 pass after mock update (deviation #3).
- **Full-tree:** 521/523 pass. Failing 2 are the pre-existing patch #124 ThumbsUp aria-label residuals in `ComposeBox.test.tsx` (per STATE.md Phase 10 baseline `504/506`; net-delta +17 tests, of which +12 are new patch-#137 tests, the remaining +5 are the previously-quarantined panel tests unblocked by the mock update and the new PrettyConversationRow additions/renames).

### Grep gates

- `grep -rn "isWip" src/` → 0.
- `grep -rn "data-pv-conv-wip-dot" src/` → 0.
- `grep -rn "pv-conv-wip-pulse" src/` → 0.
- `grep -c "data-pv-conv-ready-dot" .../PrettyConversationRow.tsx` → 1.
- `grep -c "publishSessionWorking" .../Terminal.tsx` → 2 (1 import + 1 call).
- `grep -c "useActiveSet()" .../PrettyConversationsPanel.tsx` → 1 (hoisted single subscription).
- `grep -c "useSessionWorking" .../PrettyConversationsPanel.tsx` → 2 (import + call in PrettyConversationRowLive).
- `grep -c "PrettyConversationRowLive" .../PrettyConversationsPanel.tsx` → 5 (1 definition + 3 render sites + 1 header comment mention).
- `grep -c "isWip" .../PrettyConversationsPanel.tsx` → 0.

### Commit

- Branch: `feat/tab-title-from-tmux` (unchanged, no new branch).
- SHA: `9450526`.
- Subject: `feat(pretty-conversations): patch #137 — wire active-set + ready-for-attention dot from session-working store`.
- Files changed in commit: 10 (as counted by `git show HEAD --stat` — the plan's original 9 plus PrettyConversationsPanel.test.tsx deviation #3).
- `Co-Authored-By` trailer: ABSENT (fork commits don't use one).
- No `npm run build`, no `docker compose` invocation, no `git push`.
- `~/.claude/identities/tina/skynet-patches.md` untouched.

## Known Stubs

None. All rendering paths are wired end-to-end.

## Self-Check: PASSED

- [x] `src/ui/state/session-working-store.ts` created and exports verified.
- [x] `src/ui/state/session-working-store.test.ts` created and 4/4 tests pass.
- [x] `src/ui/state/conversation-store.ts` modified (activeSet field + hydrate + mutator + hook + selectConversation wiring).
- [x] `src/ui/state/conversation-store.test.ts` modified (3 new tests + 1 updated + 1 beforeEach helper).
- [x] `src/ui/features/terminal/Terminal.tsx` modified (import + one useEffect adjacent to isIdle useState).
- [x] `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` modified (prop rename, isAmbient derivation, avatarStyle / baseBodyStyle / hoverOverlay / label / ready-dot).
- [x] `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` modified (Test 1/12 patched; Tests 13/14 renamed+inverted; Tests 15/16/17/18/18b added; total 20 pass).
- [x] `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` modified (import + useActiveSet + sessionWorkingKey + PrettyConversationRowLive + 3 render-site swaps).
- [x] `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` modified (deviation #3 — added mocks for useActiveSet + useSessionWorking).
- [x] `src/ui/index.css` modified (wip-pulse header comment + keyframes + reduced-motion fallback removed).
- [x] Commit `9450526` present on `feat/tab-title-from-tmux`.
- [x] tsc --noEmit clean.
- [x] Vitest 521/523 (2 known pre-existing failures preserved).

