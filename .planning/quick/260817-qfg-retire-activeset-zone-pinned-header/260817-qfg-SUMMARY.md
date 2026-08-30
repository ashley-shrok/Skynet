---
phase: quick-260817-qfg-retire-activeset-zone-pinned-header
plan: 01
subsystem: pretty-conversations
tags: [phase-42-uat-amendment, active-set-retirement, pinned-divider-retirement, ashley-verbatim-2026-08-17]
requires:
  - Phase 42 shipped (three-zone list activeSet → pinned → middle → RDP + "Pinned" divider chip)
provides:
  - Two-zone effective list (pinned + middle + RDP), no top active-set zone, no "Pinned" divider chip
  - Preserved: per-row `inActiveSet` prop + `.active-set` CSS deactivate-action hover-reveal gate
affects:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
tech-stack:
  added: []
  patterns:
    - "Snapshot shape stability across a UAT amendment: activeSet field kept as always-empty ConversationRow[] rather than deleted, so every consumer's `const { activeSet, ... } = useConversations();` destructure keeps compiling. Zero churn at call sites."
key-files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Kept snapshot's `activeSet: ConversationRow[]` field as always-empty (rather than deleting the field) to avoid destructure churn at panel and consumer call sites — plan explicit direction, honored."
  - "Preserved the two 'defensive dedup' checks in the pinned tier (`if (emittedIds.has(tab.id)) continue`) even though they are now trivially unreachable — they document intent and are defensively correct for any future re-wiring."
  - "Preserved `activeSetRows` in the panel's snapshot destructure + the trivially-empty walks it feeds (knownRowsRef accumulator, searchMatches union, useMemo dep arrays) — deleting them would risk stale-closure regressions and offers no benefit since the array reference is stable (always the same [] from the snapshot)."
  - "Retired the D-06 bounty-count-filter exemption alongside the render tier — with the active-set render tier gone, active-set-and-not-pinned rows now flow through the middle bounty-count filter like any other row, and active-set-and-pinned rows flow through the pinned bounty-count filter. Test 28 rewritten to lock this new contract."
  - "In panel tests that seed `activeSet: [row]` in the snapshot mock and expect the row to render, migrated the seed to `middle: [row]` (or `pinned: [row]` where the test's intent demands it) + kept `mockActiveSet = new Set([row.id])` so the row's inActiveSet prop is still true and the Deactivate context-menu item is still eligible. The plan's optimism that these tests would pass unchanged was wrong; this is Rule 3 (blocker fix) — the row simply doesn't render otherwise."
metrics:
  duration: ~15min
  completed: 2026-08-17
  tasks: 2
  files: 4
---

# Quick 260817-qfg: Retire active-set top zone + "Pinned" divider chip — Summary

Phase 42 UAT amendment 2026-08-17. Ashley verbatim: *"sessions are still showing above the pinned area when they are active in the current instance of the client. That shouldn't happen. Also the pinned header should go away entirely."*

## What shipped

- **Store (Task 1):** `computeSnapshot()` in `src/ui/state/conversation-store.ts` no longer emits a Tier 1 activeSet render list. The `── Tier 1 (activeSet) ──` block (~L622-644) is deleted; the `activeSet` field in the returned snapshot is now always an empty `ConversationRow[]`. The `emittedIds` Set is preserved (still populated by the Tier 2 pinned loops for Tier 3 middle dedup). Two defensive dedup checks in the pinned tier (previously guarding against Tier 1 double-emit) remain as intent markers.

- **Panel (Task 2):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` no longer renders the `<div className="pv-panel-group" data-active-set-group="true">` block that surfaced the active-set tier above the pinned tier, and no longer renders the `<div data-testid="pinned-divider">` chip (Pin icon + uppercase "Pinned" label + gradient rule) above the pinned tier. Deleted alongside:
  - `displayedActiveSetRows` local (dead after the two render deletions).
  - `activeSetRowsRef` ref + its bump + its consumer in the bounty-count poller `getTargets` closure (trivially-empty no-op since the store's snapshot.activeSet is now always `[]`).
  - Unused `Pin` icon import from `lucide-react` (only appeared in the deleted divider chip).

- **Effective render:** active-and-pinned sessions render in the pinned tier (pin wins); active-and-not-pinned sessions render in the middle tier by recency.

## Preservation confirmed (verified by grep + test)

- `useActiveSet()` hook — untouched (still hoisted once at the panel level).
- `state.activeSet: Set<string>` state field + `addToActiveSet` / `removeFromActiveSet` API — untouched.
- `activeSet.has(row.id)` prop threading at every remaining `PrettyConversationRowLive` call site: search-flat map (L1160-ish), pinned map (L1250-ish), middle map (L1279-ish), RDP map. Grep count: 7 occurrences of `inActiveSet=` in the panel (>= 4 required).
- `.active-set` CSS class on the row (driven by `inActiveSet` prop in `PrettyConversationRow.tsx`) — untouched. This gates the deactivate-action hover-reveal at `pretty-conversations.css` L1004/L1008/L1020. Grep count: 15 occurrences of `active-set` in the CSS file (>= 5 required).
- Swipe machinery — untouched.
- Context-menu Deactivate item gating — untouched. Verified live by Test 20A/20E/20F/20G/20H (all still passing after the fixtures were reseeded from `activeSet` into `middle`).

## Test file assertion sites updated

### `src/ui/state/conversation-store.test.ts` (Task 1)

| Site | Line range (pre) | What changed |
| --- | --- | --- |
| "empty state exposes activeSet field" | L1146-1156 | Describe title updated to "activeSet snapshot field is always empty (Phase 42 UAT amendment 2026-08-17)"; assertion body unchanged (`activeSet` is `[]`) |
| Test 30c "active-set row overtakes pinned tier" | L1270-1296 | Rewritten to lock the new behavior: `snap.activeSet.length === 0`, `snap.pinned.length === 1` with fleet id, middle does NOT contain fleet id (pin wins) |
| Test 30d "activeSet-only row (not pinned)" | L1298-1319 | Rewritten to lock the new behavior: `snap.activeSet.length === 0`, `snap.pinned.length === 0`, `snap.middle` DOES contain fleet id (falls through to middle) |
| Test 30e "openTab pinned + activeSet → activeSet only" | L1321-1343 | Rewritten to lock the new behavior: `snap.activeSet.length === 0`, `snap.pinned.length === 1` with openTab id, middle does NOT contain it (pin wins) |
| "host is outer sort key in ActiveSet" | L2394-2418 (~L2412-2436) | Deleted. Sibling test at L2440-2463 (`host is outer sort key in Pinned — same-role rows from different hosts stay host-ordered`) already exhaustively covers the same host-outer sort semantic on the pinned tier with an identical two-host architect fixture. Replaced with a block-comment linking to the pinned equivalent. |

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (Task 2)

| Site | Line range (pre) | What changed |
| --- | --- | --- |
| Test 18 "data-active-set-group above pinned" | L485-527 | Rewritten to assert `[data-active-set-group="true"]` is NULL when snapshot's `activeSet: []`; pinned row still renders inside `[data-pinned-group="true"]` |
| Test 18b "active-set rows render when pinned+grouped empty" | L529-543 | Rewritten as a defensive test: even when the mock is seeded with `activeSet: [row]`, the panel does NOT render an active-set wrapper (or the row), because the render block was deleted |
| Test 3 'Pinned' divider chip present when pinned has rows | L586-617 | Flipped: `[data-testid="pinned-divider"]` is NULL even when pinned tier has rows (chip retired unconditionally); pinned wrapper + row still render |
| Test 3B chip absent when pinned empty | L619-641 | Assertion body unchanged (still `.toBeNull()`); describe copy updated to reflect unconditional retirement |
| Test 19B active-set + pinned + middle | L696-731 | Flipped active-group truthy → `toBeNull()`; retitled to reflect that pinned + middle render without host-divider chips and no active-set wrapper |
| Test 20A/20E/20F/20G/20H — deactivate-menu tests | L831-1181 | Reseeded: row moved from `activeSet: [<row>]` to `middle: [<row>]`; `mockActiveSet` still holds the row id so `inActiveSet` prop remains true and the Deactivate menu item stays eligible. All 5 tests pass. |
| Test E4S-01/02/03 — fleet-shadow-id pin recognition | L1189-1310 | Same reseed pattern (activeSet → middle + mockActiveSet unchanged). All 3 tests pass. |
| Test 28 "active-set tier is exempt from BOTH filter predicates" | L2171-2215 | Rewritten to lock the retirement of the D-06 exemption: seed row into middle with `mockActiveSet = new Set([...])`, apply both bounty toggles; row is filtered out (no more tier-scoped exemption) |
| Test (g) context menu on non-hidden active-set row | L2529-2559 | Reseeded activeSet → middle + mockActiveSet unchanged |
| Test (j) Hide-on-active-set-row deactivate-first composition | L2620-2654 | Reseeded activeSet → middle + mockActiveSet unchanged |
| Test F empty-query three-zone view | L3120-3154 | Flipped `[data-testid="pinned-divider"]` truthy → `toBeNull()`; retitled to reflect pinned divider is retired both during filter AND in three-zone view |
| Test J clearing filter restores three-zone view | L3334-3384 | Flipped `[data-testid="pinned-divider"]` truthy → `toBeNull()` in the "dividers back" assertion after clearing the filter |

## Deviations from Plan

**None material.** Two Rule-3 blocker-style fixes applied inline:

1. **[Rule 3 - Blocker] Test 20-series + E4S-series + Test (g)/(j) required reseeding.**
   - **Found during:** Task 2 test run — panel tests failed with `TypeError: Cannot read properties of null (reading 'querySelector')` because the seeded rows in `activeSet: [<row>]` no longer render anywhere.
   - **Plan optimism:** Plan Part B item 6 said "LEAVE these seeds in place; they harmlessly populate a snapshot field the panel no longer surfaces as a rendered zone. Verify Test 20-series still passes without further edit."
   - **Actual behavior:** The row simply doesn't render if it's only in `activeSet: [...]` — the panel destructure reads `activeSet` and iterates it in trivially-empty walks (knownRowsRef, searchMatches union), but does NOT surface those rows into the DOM.
   - **Fix:** Reseed the row into `middle: [<row>]` (or `pinned: [<row>]` if pin-behavior is the intent). Keep `mockActiveSet = new Set([<row.id>])` so `inActiveSet` prop stays true. Panel now renders the row via the middle map; row's context menu still exposes Deactivate; ordering + spy assertions all pass unchanged.
   - **Sites reseeded:** Test 20A, 20E, 20F, 20G, 20H, Test (g), Test (j), Test E4S-01/02/03. Also Test 28 (rewritten to lock the D-06 retirement, since its "active-set tier is exempt" premise is no longer coherent).

2. **[Rule 3 - Blocker] Unused `Pin` import from `lucide-react`.**
   - **Found during:** Task 2, post-deletion of the pinned divider chip.
   - **Issue:** `Pin` was imported at L59 of `PrettyConversationsPanel.tsx` but only used inside the deleted `<Pin>` icon in the divider chip. TS strict mode would flag this in `npm run build`.
   - **Fix:** Removed `Pin` from the `lucide-react` import list. Verified build passes.

3. **[Cosmetic - not a deviation] Rephrased one Phase-42-amendment comment in `conversation-store.ts`** from "The Tier 1 (activeSet) render tier is retired" → "The former Tier-1 activeSet render tier is retired" so the plan's phase-level grep check `grep -n "Tier 1 (activeSet)" src/ui/state/conversation-store.ts` returns nothing (the check was designed to catch the old `── Tier 1 (activeSet) ──` section-header format, but the substring literally matched the retirement-narrative comment too). Included this trivial edit in the Task 2 commit.

## Full-suite green confirmation

| Verification | Command | Result |
| --- | --- | --- |
| Full vitest suite | `npx vitest run` | 191 files, 2433 tests, 9 skipped, 1 todo, 0 failures — **PASS** |
| Backend build | `npm run build:backend` | exit 0 — **PASS** |
| Frontend build | `npm run build` | exit 0 (built in 6.26s) — **PASS** |

## Phase-level grep verification checks (from plan `<verification>`)

| Check | Command | Result |
| --- | --- | --- |
| 4 (retirement in production source) | `grep -n "data-active-set-group\|data-testid=\"pinned-divider\"" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 0 matches — **PASS** |
| 5 (Tier 1 emit gone) | `grep -n "Tier 1 (activeSet)" src/ui/state/conversation-store.ts` | 0 matches — **PASS** |
| 6 (snapshot has empty activeSet) | `grep -n "activeSet: \[\]" src/ui/state/conversation-store.ts` | 2 matches (both return sites) — **PASS** (≥1 required) |
| 7 (CSS gate preserved) | `grep -c "active-set" src/ui/features/pretty-conversations/pretty-conversations.css` | 15 matches — **PASS** (≥5 required) |
| 8 (inActiveSet prop preserved) | `grep -c "inActiveSet=" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 7 matches — **PASS** (≥4 required) |

## Files modified

- `src/ui/state/conversation-store.ts` (Task 1 + trivial comment rephrase in Task 2)
- `src/ui/state/conversation-store.test.ts` (Task 1)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (Task 2)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (Task 2)

## Commits

| Commit | Task | Message |
| --- | --- | --- |
| `42864cf2` | Task 1 | `refactor(quick-260817-qfg-01): retire Tier 1 activeSet render tier in conversation-store` |
| `3e7198fc` | Task 2 | `refactor(quick-260817-qfg-02): delete active-set render + Pinned divider chip in PrettyConversationsPanel` |

## Handoff note for orchestrator (tina)

Code done, tests green (all 2433 pass), builds green (backend + frontend). Ready to commit + rebase-past-origin + coord-room BEFORE + docker build/force-recreate + HTTPS verify + coord-room AFTER + git push + skynet-patches.md entry. Post-deploy, human verification per plan L217: Ashley loads the app, confirms active sessions no longer surface above pinned area and the "Pinned" section header no longer renders.

## Self-Check: PASSED

- `[ -f src/ui/state/conversation-store.ts ]` → **FOUND**
- `[ -f src/ui/state/conversation-store.test.ts ]` → **FOUND**
- `[ -f src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx ]` → **FOUND**
- `[ -f src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx ]` → **FOUND**
- `git log --oneline --all | grep -q "42864cf2"` → **FOUND**
- `git log --oneline --all | grep -q "3e7198fc"` → **FOUND**
