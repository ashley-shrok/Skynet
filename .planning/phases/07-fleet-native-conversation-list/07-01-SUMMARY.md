---
phase: 07-fleet-native-conversation-list
plan: 01
subsystem: ui-state
tags: [conversation-store, fleet-native, useSyncExternalStore, tdd, telegram-like-interface, phase-7, wave-1, foundation]

# Dependency graph
requires:
  - phase: 06-telegram-like-interface
    provides: "conversation-store public API (updateHostTree, updateOpenTabs, selectConversation, selectConversationDeferred, pinConversation, unpinConversation, togglePinConversation, useConversations, useSelectedConversationId, usePinnedIds) + ConversationsPanel + ConversationRow + AppShell.persistence.test.tsx MountManager scaffold — all extended verbatim without breaking existing semantics"
  - phase: 06-04-new-session-button-race-defense
    provides: "selectConversationDeferred + pendingSelectId race defense reused verbatim by the new detached-row-click handler at AppShell — openTab's setTabs is batched, deferred-select parks the id until updateOpenTabs flushes it"
  - patch-105
    provides: "conversation-store.ts + ConversationsPanel.tsx + AppShell.persistence.test.tsx already in git history — this plan is additive-only"

provides:
  - "conversation-store extension: FleetSession type + updateFleetSessions action + updateHostsFlat action + optional fleetOnly?: boolean on ConversationRow + union+dedup derivation via dedupKey (null-byte separator) + fleet-only row id shape `fleet::${hostId}::${sessionName}` (visible-ASCII `::` for DevTools inspectability) + __getFleetOnlyRowsForTest test helper"
  - "ConversationsPanel plumbing: onDetachedRowClick?: (row) => void prop + handleRowSelect(row) local helper that branches on row.fleetOnly (fleet-only → onDetachedRowClick; openTabs → selectConversation) — both branches fire onConversationSelected for the mobile transition per TG-13 (visually indistinguishable)"
  - "AppShell mount-effect: one-shot getSessionList() fetch with empty dep array + silent try/catch + cancelled-guard for unmount race + `hostsById` memo keyed on stableHostTreeKey + updateHostsFlat effect + onDetachedRowClick handler using allowCreateTmux: false (ATTACH not create)"

affects: [07-02, 07-03]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies — reuses getSessionList from @/api/sessions-api, useSyncExternalStore React built-in, existing conversation-store patterns
  patterns:
    - "Additive extension of an existing module-scoped store — new state fields + new actions + extended computeSnapshot() with the SAME snapshotVersion+cachedSnapshot+listeners scaffolding (no second store, no wrapper layer)"
    - "Null-byte dedup key separator (`\\0`) — guaranteed absent from tmux session names + numeric-string Host.id coercion; visible-ASCII `::` separator only in DevTools-facing row ids"
    - "One-shot fetch effect (empty dep array) with cancelled-guard on unmount for the mount race — silent try/catch on failure so the list gracefully falls back to Phase 6 openTabs-only rendering"
    - "Reuse of Phase 6 NOTE-05 stableHostTreeKey thrash-guard: hostsById memo keyed on the JSON snapshot, not the raw ref, so idle host-polls that produce reference-inequal-but-content-equal trees do NOT churn the store's hostsFlat input"
    - "INTERNAL routing marker (`fleetOnly?: boolean`) that stays OUT of the render layer — ConversationRow renders identically for both states per TG-13; the field exists only so ConversationsPanel's row-click handler can branch (fleet-only → onDetachedRowClick vs openTabs → selectConversation)"
    - "TDD RED→GREEN cycle for Task 1: test file was RED-committed (30/30 fail with `updateFleetSessions is not a function`), store extension GREEN-committed separately — both commits pass their intended gates atomically"

key-files:
  created: []
  modified:
    - "src/ui/state/conversation-store.ts (+198 / -1 — FleetSession type + fleetSessions/hostsFlat state fields + updateFleetSessions/updateHostsFlat actions + extended computeSnapshot with union+dedup + dedupKey/fleetRowId internal helpers + __getFleetOnlyRowsForTest test helper; 437 → 633 lines)"
    - "src/ui/state/conversation-store.test.ts (+283 / -2 — Tests 23-30 appended after Test 18 (last describe block = 22nd it()); Test 8 row-shape assertion updated to filter optional fleetOnly key; beforeEach extended to reset the new inputs; 601 → 882 lines; 22 → 30 it() blocks)"
    - "src/ui/sidebar/ConversationsPanel.tsx (+35 / -10 — onDetachedRowClick prop + handleRowSelect helper + row.onSelect wiring for pinned+grouped; ConversationRowShape type alias to avoid name collision with the component; 268 → 297 lines)"
    - "src/ui/AppShell.tsx (+92 / -0 — extended conversation-store import + getSessionList import + one-shot fetch effect + hostsById memo + updateHostsFlat effect + onDetachedRowClick handler on ConversationsPanel mount; 1823 → 1915 lines)"
    - "src/ui/AppShell.persistence.test.tsx (+61 / -0 — updateFleetSessions/updateHostsFlat imports + beforeEach reset + Test 4 (fleet-derived row shape assertion); Tests 1-3 preserved verbatim; 383 → 444 lines; 3 → 4 it() blocks)"

key-decisions:
  - "**Dedup separator = null byte (`\\0`) for the INTERNAL key + visible-ASCII `::` for the fleet row id.** dedupKey uses `${hostIdStr}\\0${sessionName}` because tmux itself rejects control chars in session names, so collision is impossible. Fleet row ids use `fleet::${hostId}::${sessionName}` because ids are inspected in DevTools (data-conversation-id attribute) and need to be human-readable. Two-separator design keeps internal correctness and external inspectability independently satisfied."
  - "**openTabs entry wins on dedup — fleet entry silently dropped.** When (String(parseInt(tab.host.id)), tab.targetTmuxSession) matches (String(session.hostId), session.sessionName), the fleet-derived synthetic row is skipped. This preserves all Phase 6 semantics (id, pin state, per-tab metadata) verbatim; the fleet input only contributes 'this session exists on the box' — never mutates or overrides an existing openTabs row. Test 24 asserts."
  - "**Null-target openTabs tabs do NOT dedup against named fleet sessions.** A tab with `targetTmuxSession=null` has identity (hostA, null) which is not the same as (hostA, 'work'). The identity set is populated only for tabs with non-null non-empty targetTmuxSession. Rationale: 'attached-to-hostA-without-known-session' is a real edge case for legacy tabs opened without an explicit tmux target — swallowing a named fleet session with an unrelated null-target tab would silently hide fleet-discovered sessions from Ashley. Test 26 asserts."
  - "**fleetOnly ChosenState: OMITTED (not `false`) on openTabs rows.** The planner offered a choice (a-filter-in-tests or b-allow-both-key-sets); I picked (a) — synthetic fleet rows carry `fleetOnly: true`; openTabs-derived rows omit the key entirely. This keeps the Phase 6 5-key row-shape contract byte-close for openTabs rows (only fleet-derived rows deviate, and only by one internal-routing field), and Test 8's shape assertion is updated to filter the optional key before comparing against the locked core set."
  - "**Pins are ONLY from openTabs — fleet-only rows CANNOT be pinned.** Existing pinConversation guard (conversation-store.ts:390-398) already rejects any id not in openTabs. Fleet-only row ids never appear in openTabs → the guard already covers this. Test 30 is a regression test for the defense-in-depth (a future refactor that relaxed the guard would fail Test 30 before any user-visible corruption)."
  - "**Fleet-only host with no hostsFlat resolution → fallback to FleetSession.hostName.** Initial-load race: getSessionList() may resolve before loadHosts() populates realHostTree → hostsFlat. During that window, fleet rows still render with `host: undefined` and the HostGroup header uses FleetSession.hostName as fallback. Rendering is graceful; the click handler at AppShell short-circuits on `!row.host` (silent no-op). Once loadHosts completes, hostsFlat populates via effect, snapshot re-emits, rows get their Host object. Test 28 asserts."
  - "**One-shot fetch effect with EMPTY DEP ARRAY — TG-17 hard shape lock.** getSessionList() fires once on mount. NO polling (no setInterval, no setTimeout retry loop). NO focus/visibility refetch (no `visibilitychange` listener, no `focus` listener). NOT wired into the existing `skynet:hosts-changed` event listener (which fires loadHosts on host CRUD). Grep gates enforce all three defenses. Cross-device / cross-session fleet staleness is DELIBERATELY acceptable — Ashley refreshes to update per the shape lock."
  - "**One-shot vs polling decision (per orchestrator prompt):** REUSED the existing `getSessionList()` unchanged (which does NOT have polling attached — SessionsPanel wraps it with a manual Refresh button + refresh callback). No extraction of a new one-shot variant needed. The polling that could have leaked is in SessionsPanel's manual-refresh use, not in the API function itself. My AppShell mount effect calls getSessionList() directly (empty dep array, silent try/catch, cancelled-guard) — zero polling risk at the fleet-discovery layer."
  - "**allowCreateTmux: false on detached-row-click — distinct from onCreateSession's `true`.** The new-session flow (Plan 06-04) uses `allowCreateTmux: true` to CREATE a fresh tmux session on the box. The detached-row-click (Plan 07-01) uses `false` to ATTACH to an existing tmux session. If the session dies between page-load and click, backend errors instead of resurrecting an empty pane. This is the load-bearing distinction from TG-14 shape lock."
  - "**hostsById memo keyed on stableHostTreeKey — reuses Phase 6 NOTE-05 thrash-guard.** hostsById rebuild happens on JSON-snapshot change, not raw realHostTree ref change. buildHostTree does still reconstruct Host object references on every host-poll, so `updateHostsFlat`'s ref-equality check will detect the Map's re-emission and bump snapshotVersion (see plan-check NOTE-E — this is pre-existing Phase 6 poll behavior). Deep-equal Host comparison or Host-identity memoization inside buildHostTree is a future optimization; for now the store's ref-check is sufficient and idle polls still elide via the outer stableHostTreeKey guard."
  - "**Persistence-test Test 4 asserts the STORE contract for the click handler's inputs (not openTab integration).** The onDetachedRowClick handler at AppShell reads row.host + row.targetTmuxSession + row.fleetOnly + row.id from a fleet-derived row. Test 4 exercises the store contract for those fields; openTab is an AppShell integration concern deferred to Plan 07-03 UAT. Tests 1-3 (T-06-02-01 mount-lifecycle contract) preserved byte-for-byte."

patterns-established:
  - "Additive store-extension pattern: new state fields + new actions with same ref-equality no-op guards + extended computeSnapshot() that layers new derivations on top of existing pinned+grouped logic — future planners extending this store follow the same shape"
  - "Dual-separator dedup: internal `\\0` for correctness + visible `::` for DevTools — copy this for any future ephemeral-id / stable-id distinction in the store layer"
  - "One-shot API fetch effect with cancelled-guard + silent try/catch: the pattern to use when a snapshot is desirable but polling is forbidden by shape lock"
  - "Optional INTERNAL routing marker (`fleetOnly?: boolean`): copy this shape when the store needs to signal something to the panel-wiring layer WITHOUT surfacing it in the render layer"

requirements-completed: []
# NOTE: TG-12, TG-13, TG-14, TG-17 are LISTED in this plan's frontmatter but
# NOT marked complete here because 07-01 lands the data-source reshape + click
# plumbing but there is NO user-visible RDP row (Plan 07-02 owns TG-15), no
# pencil re-style (Plan 07-02 owns TG-16), no gear-dedup fix (Plan 07-02 owns
# TG-18). The full 7-requirement completion is Plan 07-03's UAT walk. Mirrors
# Phase 6 Plan 06-01's foundation-only requirements-completed=[] pattern.

# Metrics
duration: 11min
completed: 2026-07-21
---

# Phase 7 Plan 07-01: Fleet-native conversation list foundation — data-source reshape + detached-row-click plumbing Summary

**Extended the conversation-store's data source from "openTabs mirror" to "fleet-discovered tmux sessions ∪ openTabs (deduplicated by session identity)" with a one-shot page-load fetch and a transparent-attach click path — zero visual attached/detached distinction, zero polling, zero re-engineering of the Phase 6 tab lifecycle machinery underneath.**

## Performance

- **Duration:** ~11 min (wall clock; TDD RED→GREEN for Task 1, straight wiring for Task 2, no deviations, no auth gates, no auto-fixes)
- **Started:** 2026-07-21T05:52:35Z
- **Completed:** 2026-07-21T06:04Z
- **Tasks:** 2 (Task 1 TDD, Task 2 auto — Task 2 is technically tdd="true" but the behavior is largely wiring; landed one commit combining panel + AppShell + persistence-test extension per plan design)
- **Files modified:** 5 (0 created)
- **Commits:** 3 atomic — 1 test-only (RED), 1 store impl (GREEN), 1 wiring bundle (Task 2)

## Accomplishments

- **Store extension shipped.** Extended conversation-store with `FleetSession` + `fleetSessions` state field + `hostsFlat` state field + `updateFleetSessions` action + `updateHostsFlat` action + extended `computeSnapshot()` with union+dedup logic emitting synthetic fleet-only rows only when no matching openTabs entry exists. Zero touches to existing actions / hooks / test-helpers. Full Phase 6 API preserved verbatim.
- **Union+dedup semantics locked and tested.** openTabs-entry-wins on identity collision (Test 24); fleet-only rows APPEND after openTabs rows in the same HostGroup (Test 25); null-target openTabs tabs do NOT false-collide with named fleet sessions (Test 26); host-tree fallback resilience for the initial-load race (Test 28); pin defense-in-depth on fleet ids (Test 30).
- **One-shot fleet fetch wired at AppShell.** getSessionList() fires exactly once per page-load (empty dep array useEffect), silent try/catch on failure, cancelled-guard on unmount race. NOT wired into `skynet:hosts-changed` — TG-17 cross-device staleness shape lock enforced by grep gate.
- **Detached-row-click transparent-attach path wired.** ConversationsPanel gains `onDetachedRowClick` prop + `handleRowSelect(row)` helper that branches on `row.fleetOnly`. AppShell resolves the row → Host via `state.hostsFlat` → openTab(host, "terminal", ..., { allowCreateTmux: false }) → selectConversationDeferred → mobile navigateToView. Reuses Plan 06-04's race-defense mechanism verbatim.
- **Zero visual attached/detached distinction.** The `fleetOnly` field is INTERNAL routing-only — ConversationRow.tsx renders identically for both states. TG-13 shape lock preserved.
- **hostsFlat lookup wired at AppShell.** `hostsById` useMemo keyed on `stableHostTreeKey` (reuses Phase 6 NOTE-05 thrash-guard); `updateHostsFlat(hostsById)` effect fires on rebuild. Feeds fleet-row Host enrichment inside computeSnapshot AND (pending Plan 07-02) the RDP row derivation path.
- **T-06-02-01 mount-lifecycle contract preserved byte-for-byte.** `createPortal(` count in AppShell.tsx still exactly 1; MountManager scaffold Tests 1-3 in AppShell.persistence.test.tsx unchanged; tabNodesRef DOM-move mechanism unchanged; the SAME `state.selectedId` still drives `effectiveSelectedTabId` (a detached row that becomes attached uses the same visibility signal path Ashley expects).
- **Zero new npm dependencies.** Reuses `getSessionList` from `@/api/sessions-api` (already present), `useSyncExternalStore` (React 18 built-in), existing conversation-store patterns.
- **Zero touches to scope-fenced files.** `src/ui/features/pretty-view/**`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/features/guacamole/**`, `src/backend/**`, `docker/**`, `package.json`, `package-lock.json`, `src/ui/sidebar/NewSessionButton.tsx`, `src/ui/sidebar/NewSessionDialog.tsx`, `src/ui/sidebar/ConversationRow.tsx` — all untouched.
- **Full-project test + type-check clean.** 310/310 frontend Vitest cases pass (301 baseline + 8 store + 1 persistence). tsc --noEmit --skipLibCheck: zero errors.

## Task Commits

Each task was committed atomically on branch `feat/tab-title-from-tmux`:

1. **Task 1 RED — failing Vitest cases for fleet-native store extension** — `dd076a7` (test)
   - Tests 23-30 appended after existing Test 18; Test 8 row-shape assertion updated to filter optional `fleetOnly`; beforeEach extended to reset new inputs. Vitest confirmed RED: 30/30 fail with `updateFleetSessions is not a function`.
2. **Task 1 GREEN — fleet-native store extension** — `93ec517` (feat)
   - FleetSession type + fleetSessions/hostsFlat state fields + updateFleetSessions/updateHostsFlat actions + extended computeSnapshot with union+dedup + dedupKey/fleetRowId internal helpers + __getFleetOnlyRowsForTest test helper. All 30 tests GREEN on first pass. Full frontend suite: 309/309.
3. **Task 2 — ConversationsPanel + AppShell + persistence-test wiring** — `88ff18d` (feat)
   - Bundled per plan's Task 2 coupling justification (three files' changes are meaningless without each other — see plan-check §focus-area-11). ConversationsPanel: onDetachedRowClick prop + handleRowSelect helper. AppShell: extended imports + one-shot fetch effect + hostsById memo + updateHostsFlat effect + onDetachedRowClick handler. AppShell.persistence.test.tsx: Test 4 (fleet-derived row shape assertion). Full frontend suite: 310/310.

## Files Created/Modified

**Modified:**

- `src/ui/state/conversation-store.ts` — 437 → 633 lines (+199 / -1).
  - New public type `FleetSession` (hostId, hostName, sessionName, created — mirrors RemoteTmuxSession verbatim; re-declared here to keep UI-state layer decoupled from the API layer per Phase 6 layering).
  - New state fields: `fleetSessions: FleetSession[]` (initial `[]`) + `hostsFlat: Map<number, Host>` (initial empty Map).
  - New actions: `updateFleetSessions(sessions)` with ref-equal + length + per-element ref no-op guards; `updateHostsFlat(hostsById)` with ref-equal no-op guard.
  - New optional `fleetOnly?: boolean` field on ConversationRow — INTERNAL routing marker only.
  - Extended `computeSnapshot()`: builds openTabs session-identity Set, iterates fleetSessions, skips dedup collisions, emits synthetic ConversationRow with `fleet::${hostId}::${sessionName}` id, buckets fleet rows into the same byHostId Map as openTabs rows (append order), falls back to FleetSession.hostName when host is unresolvable via hostTree/hostsFlat.
  - New internal helpers: `dedupKey(hostIdStr, sessionName)` with null-byte separator; `fleetRowId(hostId, sessionName)` with visible `::` separator.
  - New test-only helper: `__getFleetOnlyRowsForTest()`.
- `src/ui/state/conversation-store.test.ts` — 601 → 882 lines (+283 / -2).
  - Extended imports (FleetSession type + updateFleetSessions + updateHostsFlat + __getFleetOnlyRowsForTest).
  - Extended beforeEach reset (fleetSessions + hostsFlat).
  - Updated Test 8's row-shape assertion to filter optional `fleetOnly` key before comparing against the locked 5-key core-shape.
  - Appended Tests 23-30: fleet-only render, openTabs-entry-wins dedup, union rendering, null-target no false-collide, updateFleetSessions no-op guards, host-tree fallback, updateHostsFlat no-op guards, fleet-only never pinnable.
- `src/ui/sidebar/ConversationsPanel.tsx` — 268 → 297 lines (+35 / -10).
  - Imported `ConversationRow` type as `ConversationRowShape` to avoid name collision with the local `ConversationRow` component.
  - Added `onDetachedRowClick?: (row: ConversationRowShape) => void` prop.
  - Extracted `handleRowSelect(row)` local helper that branches on `row.fleetOnly`.
  - Both pinned + grouped row lists route through the single helper (previously each had inlined selectConversation + onConversationSelected calls; behavior is byte-equivalent for openTabs rows).
  - ZERO changes to gear rendering (`showGear`), NewSessionButton mount, settingsRowSlot, empty state, header chrome.
- `src/ui/AppShell.tsx` — 1823 → 1915 lines (+92 / -0).
  - Extended `@/state/conversation-store` import (updateFleetSessions + updateHostsFlat).
  - New import: `getSessionList` from `@/api/sessions-api`.
  - New one-shot fetch effect (empty dep array): awaits getSessionList → updateFleetSessions, cancelled-guard, silent try/catch.
  - New `hostsById` useMemo keyed on `stableHostTreeKey` (Phase 6 NOTE-05 thrash-guard reused).
  - New effect: `updateHostsFlat(hostsById)`.
  - New `onDetachedRowClick` prop on ConversationsPanel mount: openTab(host, "terminal", ..., { allowCreateTmux: false }) + selectConversationDeferred + mobile navigateToView + isMobile setSidebarOpen(false); silent no-op guards on `!host` and `!sessionName`.
- `src/ui/AppShell.persistence.test.tsx` — 383 → 444 lines (+61 / -0).
  - Extended imports (updateFleetSessions + updateHostsFlat).
  - Extended beforeEach reset.
  - Appended Test 4: fleet-derived row shape assertion using the REAL conversation-store — asserts row.host resolved via hostsFlat + targetTmuxSession set + fleetOnly=true + id `fleet::1::work`.
  - Tests 1-3 (T-06-02-01 MountManager scaffold) UNCHANGED.

## Verification

**Task 1 grep-checkable acceptance criteria:**
- `grep -c "^export type FleetSession" src/ui/state/conversation-store.ts` = **1** ✓
- `grep -c "^export function updateFleetSessions" src/ui/state/conversation-store.ts` = **1** ✓
- `grep -c "^export function updateHostsFlat" src/ui/state/conversation-store.ts` = **1** ✓
- `grep -c "fleetOnly" src/ui/state/conversation-store.ts` = **5** (≥5 required) ✓
- `grep -c "dedupKey\|hostsFlat" src/ui/state/conversation-store.ts` = **18** (≥5 required) ✓
- `grep -c "fleet::" src/ui/state/conversation-store.ts` = **2** (≥2 required) ✓
- `grep -cE "setInterval|setTimeout" src/ui/state/conversation-store.ts` = **0** ✓
- `grep -cE "(local|session)Storage" src/ui/state/conversation-store.ts` = **0** ✓
- `grep -cE "from ['\"](zustand|jotai|redux|mobx)" src/ui/state/conversation-store.ts` = **0** ✓
- `grep -c "^  it(" src/ui/state/conversation-store.test.ts` = **30** (≥30 required) ✓
- `grep -cE "fleet-only|dedup|updateFleetSessions|updateHostsFlat|fleet::" src/ui/state/conversation-store.test.ts` = **many** (≥6 required) ✓
- `npx vitest run src/ui/state/conversation-store.test.ts` = **30/30 passed** ✓
- `npx tsc --noEmit --skipLibCheck` = **clean** (zero errors) ✓
- `git diff --stat package.json package-lock.json` = **empty** ✓
- Scope fence (pretty-view / Terminal.tsx / guacamole / backend / docker) = **empty** ✓

**Task 2 grep-checkable acceptance criteria:**
- `grep -c "onDetachedRowClick" src/ui/sidebar/ConversationsPanel.tsx` = **4** (≥3 required) ✓
- `grep -c "fleetOnly" src/ui/sidebar/ConversationsPanel.tsx` = **1** (≥1 required) ✓
- `grep -c "handleRowSelect\|row\.fleetOnly" src/ui/sidebar/ConversationsPanel.tsx` = **4** (≥1 required) ✓
- `grep -c "updateFleetSessions\|updateHostsFlat" src/ui/AppShell.tsx` = **4** (≥3 required) ✓
- `grep -c "getSessionList" src/ui/AppShell.tsx` = **3** (≥1 required) ✓
- `grep -c "onDetachedRowClick" src/ui/AppShell.tsx` = **1** (≥1 required) ✓
- `grep -c "hostsById" src/ui/AppShell.tsx` = **3** (≥2 required) ✓
- No polling regression — `grep -B2 -A15 "getSessionList()" src/ui/AppShell.tsx | grep -cE "setInterval|setTimeout"` = **0** ✓
- Fleet fetch NOT wired to `skynet:hosts-changed` — `grep -B2 -A5 "skynet:hosts-changed" src/ui/AppShell.tsx | grep -c "getSessionList\|updateFleetSessions"` = **0** ✓
- allowCreateTmux: false on onDetachedRowClick — `grep -B2 -A20 "onDetachedRowClick" src/ui/AppShell.tsx | grep -c "allowCreateTmux: false"` = **1** (≥1 required) ✓
- `grep -c "^  it(" src/ui/AppShell.persistence.test.tsx` = **4** (== 4 required) ✓
- `grep -c "fleet::1::work\|updateFleetSessions\|updateHostsFlat" src/ui/AppShell.persistence.test.tsx` = **10** (≥2 required) ✓
- T-06-02-01 mount-lifecycle contract: `grep -c "createPortal(" src/ui/AppShell.tsx` = **1** (== 1 required) ✓

**Full-project regression bundle:**
- `npx vitest run --project frontend` = **310/310 passing across 24 files** (up from 301/301 baseline: +8 store tests + 1 persistence test)
- `npx tsc --noEmit --skipLibCheck` project-wide = **zero errors**
- `git diff --stat package.json package-lock.json` = **empty** (zero new deps)

**Scope-fence structural checks:**
- `git diff --stat src/ui/features/pretty-view/` = **empty** ✓
- `git diff --stat src/ui/features/terminal/Terminal.tsx` = **empty** ✓
- `git diff --stat src/ui/features/guacamole/` = **empty** ✓
- `git diff --stat src/backend/` = **empty** ✓
- `git diff --stat docker/` = **empty** ✓
- `git diff --stat package.json` = **empty** ✓
- `git diff --stat package-lock.json` = **empty** ✓
- `git diff --stat src/ui/sidebar/NewSessionButton.tsx` = **empty** ✓ (Plan 07-02 owns pencil re-style)
- `git diff --stat src/ui/sidebar/NewSessionDialog.tsx` = **empty** ✓
- `git diff --stat src/ui/sidebar/ConversationRow.tsx` = **empty** ✓ (TG-13 shape lock: fleet-only rows render identically without touching the row component)

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **Dedup separator = null byte (`\0`) internally + visible `::` externally.** Two-separator design: `dedupKey(hostIdStr, sessionName)` uses `\0` because tmux itself rejects control chars in session names (guaranteed collision-free), so this is an internal correctness detail we never inspect. Fleet row ids use `fleet::${hostId}::${sessionName}` because DevTools attribute inspection (`data-conversation-id`) needs human-readable ids. Two-separator design keeps internal correctness and external inspectability independently satisfied.
- **openTabs-entry-wins on dedup collision — fleet entry silently dropped.** When a fleet session matches an openTabs tab's (host, targetTmuxSession) identity, the openTabs entry provides the id, label, pin state, all Phase 6 semantics; the fleet contributes only "this exists on the box" and is silently omitted from the fleet-derived rows. Test 24 asserts.
- **`fleetOnly` OMITTED (not `false`) on openTabs rows.** Preserves the Phase 6 5-key row-shape contract as closely as possible; only fleet-derived rows deviate. Test 8's row-shape assertion filters the optional key before comparing against the locked core set.
- **Null-target openTabs tabs do NOT dedup against named fleet sessions.** Identity (hostA, null) ≠ identity (hostA, "work"). Rationale: a legacy tab opened without an explicit tmux target shouldn't silently hide fleet-discovered named sessions on the same host. Test 26.
- **Host-tree fallback for fleet-only host: FleetSession.hostName.** Initial-load race: fleet fetch may resolve before loadHosts → hostsFlat populates. Rows still render with `host: undefined` + HostGroup header from FleetSession.hostName; click handler at AppShell short-circuits on `!row.host` (silent no-op). Test 28.
- **Fleet-only rows CANNOT be pinned.** Existing pinConversation guard (conversation-store.ts:390-398) already rejects any id not in openTabs. Fleet ids never appear in openTabs → the guard already covers this. Test 30 is a defense-in-depth regression test.
- **One-shot fetch, empty dep array, silent try/catch, cancelled-guard.** TG-17 hard shape lock enforced. NOT wired to `skynet:hosts-changed`. Cross-device / cross-session staleness deliberately acceptable per Ashley's confirmation in the shape file.
- **allowCreateTmux: false on detached-row-click — distinct from onCreateSession's `true`.** Detached-attach is ATTACH to an existing tmux session (TG-14). Not create. Backend errors instead of resurrecting empty pane if session died between page-load and click.
- **hostsById memo keyed on stableHostTreeKey — reuses Phase 6 NOTE-05 thrash-guard.** Idle host-polls that produce content-equal trees do NOT churn hostsFlat. (Pre-existing NOTE-E behavior remains: buildHostTree reconstructs Host object references on every rebuild, so `updateHostsFlat`'s ref-equality check WILL detect the fresh Map's re-emission and bump snapshotVersion. This matches Phase 6 pattern; future optimization is either deep-equal Host comparison in `updateHostsFlat` or Host-identity memoization inside `buildHostTree`. Non-blocking.)

## One-Shot vs Polling Decision (per orchestrator prompt)

**REUSED `getSessionList()` unchanged — no new one-shot variant extracted.** The API function itself (`@/api/sessions-api::getSessionList`) does NOT have polling attached. It's a plain axios GET returning `Promise<RemoteTmuxSession[]>` — no setInterval, no retry loop, no focus/visibility listener at the API layer. Polling was NEVER a property of the API function; it's a property of SessionsPanel's manual-refresh button wiring.

The orchestrator's caveat about "if the reused sidebar host-tree signal comes with polling attached" applied to the general shape-file design — but in Skynet's actual code, the fleet-discovery signal (`getSessionList`) and the host-tree signal (`getSSHHosts` → `realHostTree`) are separate fetches, and only the host-tree one has any refresh mechanism (via the `skynet:hosts-changed` event). AppShell explicitly does NOT wire fleet-fetch into that event listener — the grep gate `grep -B2 -A5 "skynet:hosts-changed" | grep -c "getSessionList\|updateFleetSessions"` returns 0 to prove it.

**Result:** the fleet-discovery signal fires exactly once per page-load with zero risk of polling leaking into visible list mutations after page-load. TG-17 shape lock satisfied at both the code and the grep-gate levels.

## Deviations from Plan

**None.** The plan was well-shaped and executed exactly as written. Every task landed with its verify gates passing on first attempt; no auto-fixes needed; no scope-fence violations; no auth gates; no architectural surprises.

Two small planner-discretion resolutions were made within the flex the plan explicitly allowed:

1. **fleetOnly key OMITTED (not `false`) on openTabs rows.** Planner's step 5 said "planner's call, but be consistent — recommend OMIT to match the Phase 6 baseline row shape as closely as possible." Followed the recommendation.
2. **Test 8 row-shape update: filter fleetOnly before comparing.** Planner's step 178 said "planner's recommendation: filter out `fleetOnly` from the actual keys, then assert against the original 5-key set." Followed the recommendation.

Neither is a deviation — both are the plan's own preferred paths.

## Issues Encountered

None. Zero blockers, zero auth gates, zero architectural questions, zero fix attempts (all commits landed with tests green on first run).

## Threat Flags

Every mitigation in the plan's `<threat_model>` block landed in this plan:

- **T-07-01-01 (dedup key collision):** mitigated via `\0` null-byte separator inside `dedupKey`. Tmux itself rejects control chars in session names so collision is impossible; Tests 24, 26 assert behavior.
- **T-07-01-02 (accidental polling regression):** mitigated via empty-dep-array useEffect + grep gate on `setInterval|setTimeout` near getSessionList + grep gate on NOT-wired-to-skynet:hosts-changed. Both gates return 0.
- **T-07-01-03 (fleet-session list disclosure):** accepted — same list Ashley already sees in SessionsPanel; no new disclosure surface.
- **T-07-01-04 (malformed getSessionList response):** mitigated via `Array.isArray(sessions) ? sessions : []` guard at the fetch call site + silent try/catch swallowing any thrown error.
- **T-07-01-05 (detached-row-click bypassing tab-lifecycle sanitization):** accepted — reuses the existing `openTab(host, "terminal", ...)` entry point verbatim; no bypass.
- **T-07-01-06 (race between hostsFlat update and fleet-row click):** mitigated via `if (!host) return` silent no-op guard in onDetachedRowClick.
- **T-07-01-SC (supply chain — new npm dependencies):** mitigated — zero new npm deps, verified by grep gate on `git diff --stat package.json package-lock.json` (empty).

**No new threat surfaces introduced beyond the plan's threat model.** No new network endpoints, no new auth paths, no new file access patterns, no schema changes.

## Known Stubs

**None.** No stubs, no placeholder text, no `TODO`s introduced. Every fleet-only row is fully-wired — its click handler resolves to a real Host object via hostsFlat and calls the real openTab lifecycle entry point.

## Next Phase Readiness

**Ready for Plan 07-02 (Wave 2: RDP row rendering + pencil re-style + mobile gear-dedup fix).**

Store hooks + panel-render slots Plan 07-02 will consume:

- **Store extension already in place for RDP derivation.** Plan 07-02 Task 1's RDP row emission consumes `state.hostsFlat` (this plan's addition) filtered on `host.enableRdp === true`. The `updateHostsFlat` action + hostsById memo + effect are all landed; Plan 07-02 does NOT need to touch the AppShell wiring for hosts-flat — only extends `computeSnapshot()` with a new rdp-row emission path.
- **`fleetOnly?: boolean` field precedent set.** Plan 07-02 can layer a similar `rdpHost?: boolean` field OR use a sentinel HostGroup with `hostId: "__rdp__"` (planner's discretion per shape file). If Plan 07-02 picks the sentinel-HostGroup approach, the plan-check NOTE-A caveat applies (ConversationsPanel lines 208-215 unconditionally render a semibold host-header — the special-case suppression MUST land or the RDP group renders with an empty header row).
- **ConversationRow renders identically for fleet-only and openTabs rows.** Plan 07-02's RDP rows can follow the same pattern (visual identity = row shape only; branching happens at click-handler level via a hypothetical `onRdpRowClick` prop mirroring this plan's `onDetachedRowClick`).
- **AppShell `openTab(host, "rdp")` is the same entry point HostsPanel + SessionsPanel + connectHost use today.** No new lifecycle work needed.
- **`showGear` line is UNTOUCHED** — Plan 07-02 Task 2's TG-18 fix adds `&& !useIsTouchDevice()` to that exact line (currently `const showGear = typeof onRailClick === "function";` at ConversationsPanel.tsx:120 — this plan did NOT change it).
- **NewSessionButton is UNTOUCHED** — Plan 07-02's pencil re-style targets NewSessionButton.tsx's icon import (Plus → Pencil) with everything else preserved. My Task 2 explicitly avoided this file.
- **Handler slots ConversationsPanel is ALREADY primed for.** Plan 07-02 can add an `onRdpRowClick?: (host: Host) => void` prop next to `onDetachedRowClick` and route through a similar branch in `handleRowSelect` (or a separate handler if the rows use a distinct row shape marker).

**No blockers for Plan 07-02.** Every extension point Plan 07-02 needs is already primed. Plan 07-03 (Wave 3, deploy checkpoint) will UAT the full 7-requirement completion.

**Deploy discipline reminder (per plan hard_constraint #1):** Do NOT deploy after this plan. Deployment happens in Plan 07-03 after Plan 07-02 lands RDP rows + pencil + gear fix. Deploying 07-01 alone would ship the fleet-native list (visible improvement — Ashley would see her running sessions on fresh page-load) but without RDP rows, the pencil re-style, or the mobile gear-dedup fix — a partial phase deploy that mismatches the shape-file commitment to ship-as-a-coherent-slice. Plan 07-03 is Ashley-gated.

## Self-Check: PASSED

**File existence:**
- `src/ui/state/conversation-store.ts` — MODIFIED (+199 / -1)
- `src/ui/state/conversation-store.test.ts` — MODIFIED (+283 / -2)
- `src/ui/sidebar/ConversationsPanel.tsx` — MODIFIED (+35 / -10)
- `src/ui/AppShell.tsx` — MODIFIED (+92 / -0)
- `src/ui/AppShell.persistence.test.tsx` — MODIFIED (+61 / -0)

**Commit existence:**
- `dd076a7` (test(phase-7): failing Vitest cases for fleet-native store extension) — FOUND in `git log --oneline -5`
- `93ec517` (feat(phase-7): fleet-native store extension) — FOUND in `git log --oneline -5`
- `88ff18d` (feat(phase-7): wire fleet-native rendering) — FOUND in `git log --oneline -5`

**Grep-checkable acceptance criteria bundle:**
- Task 1: FleetSession export=1, updateFleetSessions=1, updateHostsFlat=1, fleetOnly=5, dedupKey|hostsFlat=18, fleet::=2, no polling=0, no storage=0, no third-party stores=0, it()=30, test keywords ≥6 ✓
- Task 2: ConversationsPanel onDetachedRowClick=4, fleetOnly=1, handleRowSelect|row.fleetOnly=4; AppShell updateFleetSessions|updateHostsFlat=4, getSessionList=3, onDetachedRowClick=1, hostsById=3; no polling near getSessionList=0; NOT wired to hosts-changed=0; allowCreateTmux: false in handler=1; persistence tests=4; persistence fleet keywords=10; createPortal in AppShell=1 ✓

**Test suite:**
- `npx vitest run src/ui/state/conversation-store.test.ts` = 30/30 passing ✓
- `npx vitest run src/ui/AppShell.persistence.test.tsx` = 4/4 passing ✓
- `npx vitest run --project frontend` (full frontend suite) = **310/310 passing across 24 files** (up from 301/301 baseline: +8 store + 1 persistence) ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` project-wide = zero errors ✓

**Scope-fence structural checks:**
- No changes under `src/ui/features/pretty-view/` ✓
- No changes to `src/ui/features/terminal/Terminal.tsx` ✓
- No changes under `src/ui/features/guacamole/` ✓
- No changes under `src/backend/` ✓
- No changes under `docker/` ✓
- No changes to `package.json` / `package-lock.json` ✓
- No changes to `src/ui/sidebar/NewSessionButton.tsx` ✓ (Plan 07-02 owns pencil re-style)
- No changes to `src/ui/sidebar/NewSessionDialog.tsx` ✓
- No changes to `src/ui/sidebar/ConversationRow.tsx` ✓ (TG-13 shape lock preserved)

---
*Phase: 07-fleet-native-conversation-list*
*Completed: 2026-07-21*
