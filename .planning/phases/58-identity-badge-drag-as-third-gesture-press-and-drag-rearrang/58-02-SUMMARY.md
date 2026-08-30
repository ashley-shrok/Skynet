---
phase: 58-identity-badge-drag-as-third-gesture-press-and-drag-rearrang
plan: 02
subsystem: pretty-conversations/drop-target + shell/badge-plumbing
tags: [drag-drop, drop-target, tabid-validation, splittree-reconcile, structured-logging, phase-56-rearrange-integration]
dependency_graph:
  requires:
    - Phase 58 Plan 01 IdentityBadge dragstart wire contract (application/x-skynet-badge = JSON.stringify({tabId}); text/plain = tabId; effectAllowed = "move")
    - Phase 56 Plan 02 setSplitTree((prev) => removeLeaf(prev, id)) reconcile inside doCloseTab (AppShell.tsx:1498 — assertion-only, no code change per PV58-DOCLOSETAB-TREE-RECONCILE)
    - Phase 56 Plan 02 openSessionInTree text/plain branch at SplitView.tsx Pane onDrop (the badge dragstart writes text/plain=tabId that this branch reads — no code change, load-bearing wire assertion via Test I)
  provides:
    - PrettyConversationsPanel as HTML5 drop target for badge-close on the outermost <div data-testid="pretty-conversations-panel"> (onDragOver type-gate + onDrop with 6-step validation gauntlet)
    - onCloseSession(tabId: string) + openTabIds: readonly string[] props on PrettyConversationsPanel (openTabIds is the security validation source per T-58-02-01)
    - "[convlist-drop] close tabId=<x>" structured log line on successful drop-close (T-58-02-04 mitigation)
    - AppShell wire: onCloseSession={closeTab} + openTabIds={tabs.map((t) => t.id)} at the PrettyConversationsPanel render site (~L1868)
    - IdentitySessionPane threads tabId={tabId} to terminal-mode IdentityBadge mount (:376) AND tabId={tabId} to PrettyView mount (:232) — both surfaces now render draggable=true badges
    - PrettyView accepts optional tabId?: string prop and forwards to its inner IdentityBadge mount (:2927) — pretty-view surface badge activates as drag source
    - Integration test suite (Tests A-I) proving: badge drop closes tab, non-badge drops fall through, tabId validation guard fires, malformed payloads silent-drop, structured log emits, dragstart writes the Phase 56 Pane wire contract
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (drop handlers + new props)
    - src/ui/AppShell.tsx (wire onCloseSession + openTabIds)
    - src/ui/shell/IdentitySessionPane.tsx (tabId plumb to IdentityBadge + PrettyView)
    - src/ui/features/pretty-view/PrettyView.tsx (tabId prop + forward to inner IdentityBadge)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (Tests A-G + H + I)
    - Downstream: parent bounty `bring-back-split-view` moves to closable state on Ashley UAT
tech_stack:
  added: []
  patterns:
    - Panel-level HTML5 drop target with MIME-discriminator type-gate on dragover (preventDefault ONLY when the discriminator MIME is present — non-badge drops fall through preserving browser default not-a-drop-target semantic per T-58-02-06)
    - Six-step validation gauntlet on drop (read raw → try/catch JSON.parse → shape-check tabId string → openTabIds validation guard → preventDefault → structured log → invoke callback)
    - Optional props (onCloseSession + openTabIds default = []) so pre-Phase-58 callers and tests without drop wiring render safely — absent handler + empty allow-list = silent no-op on any drop
    - Explicit-field structured logging (no JSON.stringify(event)) per fleet directive Ashley 2026-08-11
    - Assertion-only reconcile verification: the setSplitTree((prev) => removeLeaf(prev, id)) at AppShell.tsx:1498 (PRE-EXISTING code from Phase 56 Plan 02) satisfies PV58-DOCLOSETAB-TREE-RECONCILE without new code — Task 2 grep-asserts the line remains present
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (+95 lines: 2 new props + 2 handlers + wire on outermost div)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (+345 lines: Phase 58 describe block with Tests A-G + Test H integration + Test I dragstart-payload-shape describe)
    - src/ui/AppShell.tsx (+10 lines: onCloseSession + openTabIds at PrettyConversationsPanel render + inline rationale comment)
    - src/ui/shell/IdentitySessionPane.tsx (+15 lines net: tabId={tabId} on terminal-mode IdentityBadge; tabId={tabId} on PrettyView mount)
    - src/ui/features/pretty-view/PrettyView.tsx (+10 lines: tabId?: string prop declaration + destructure + forward to inner IdentityBadge)
decisions:
  - Both new PrettyConversationsPanel props (onCloseSession + openTabIds) are OPTIONAL. Rationale — badge-drop-close is a fresh add; the panel must not regress when unwired, and the 92 pre-existing tests all render without these props. Absent handler → silent no-op after validation; empty openTabIds (default []) → every drop silent-dropped by the T-58-02-01 guard. This is the safe default per security_config.
  - handlePanelDragOver reads `e.dataTransfer?.types` and uses `Array.from(types).indexOf(...)` instead of `types.includes(...)` — the DOMStringList that browsers return from a real DataTransfer.types is NOT an Array and lacks .includes on older engines; jsdom's test-stub is a plain Array but production must handle both. `Array.from` normalizes both cases in one code path.
  - handlePanelDrop uses `readonly string[].includes(tabId)` for the T-58-02-01 validation — readonly arrays support .includes natively.
  - Test I lives in its OWN describe block (not the main Phase 58 conv-list describe) because it renders IdentityBadge (imports the real component) rather than PrettyConversationsPanel — different render surface, different beforeEach mock seeding (identity must be present in mockIdentitiesByKey so IdentityBadge does not short-circuit to null). Test H stays in the main describe because it renders the panel like A-G.
  - IdentitySessionPane reuses the existing local const `tabId` at L103 (`const tabId = tab.id`) for BOTH the IdentityBadge mount AND the PrettyView mount — consistent naming, one source of truth. Plan called this out explicitly ("reuse the const for consistency").
  - AppShell threads `tabs.map((t) => t.id)` inline (no memoization). `tabs` re-renders on every tab open/close/select anyway; adding useMemo would be micro-optimization theater without measurable benefit, and the panel's drop handler is only invoked on user-drop events (not per-render).
  - No changes to doCloseTab / closeTab / removeLeaf / openSessionInTree / SplitView.tsx / PrettyConversationRow.tsx / split-tree.ts / split-tree-url.ts. All the tree-mutation + Pane-onDrop + row-drag machinery is Phase 56 territory and stays as-is per phase scope-lock.
metrics:
  duration_minutes: 15
  completed_at: 2026-08-28T23:42:00Z
  tests_added: 9  # A + B + C + D + E + F + G + H + I
  tests_total_in_file: 101  # 92 pre-existing + 9 Phase 58
  tests_passing_scoped: 140  # 101 PrettyConversationsPanel + 13 IdentityBadge + 26 SplitView
  files_touched: 5
  loc_added_source: 130  # non-test (panel + AppShell + IdentitySessionPane + PrettyView)
  loc_added_tests: 345
requirements:
  - PV58-CONVLIST-DROP-TARGET-CLOSE
  - PV58-BADGE-DROP-ON-PANE-REARRANGE-INTEGRATION
  - PV58-DOCLOSETAB-TREE-RECONCILE
  - PV58-STRUCTURED-LOGGING
---

# Phase 58 Plan 02: Conv-list drop target + AppShell plumb + integration Summary

**One-liner:** Wires PrettyConversationsPanel as a panel-level HTML5 drop target that closes the tab when an IdentityBadge (Plan 58-01 wire) is dropped onto the conv-list — with a 6-step validation gauntlet (MIME discriminator + safe JSON parse + tabId shape check + openTabIds security guard per T-58-02-01 + preventDefault + `[convlist-drop] close tabId=<x>` structured log per T-58-02-04) — plus threads tabId through both IdentityBadge mount sites (IdentitySessionPane terminal-mode surface + PrettyView pretty-view surface) so real badges become drag sources at both surfaces, plus wires AppShell's existing closeTab function as the panel's onCloseSession prop (letting the pre-existing setSplitTree removeLeaf reconcile at AppShell.tsx:1498 automatically fire on badge-drop-close, satisfying PV58-DOCLOSETAB-TREE-RECONCILE without a single new production line). On ship, the parent bounty `bring-back-split-view` closes.

## What shipped

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (+95 lines)

- Two new optional props on the panel signature:
  - `onCloseSession?: (tabId: string) => void` — receives the VALIDATED tabId (after passing the openTabIds guard) from a badge dropped on the outermost `<div data-testid="pretty-conversations-panel">`. AppShell wires this to `closeTab`, which routes through `doCloseTab` at AppShell.tsx:1448 — that function already fires the setSplitTree removeLeaf reconcile at L1498 (existing Phase 56 code, unchanged) so PV58-DOCLOSETAB-TREE-RECONCILE is satisfied automatically without new code.
  - `openTabIds?: readonly string[]` — validation source for the drop handler (per security_config / threat T-58-02-01). Defaults to `[]` so tests and any non-AppShell caller default to "no tab is open" and every drop is a silent no-op. AppShell passes `tabs.map((t) => t.id)`.
- New `handlePanelDragOver` handler. Reads `e.dataTransfer?.types`, and ONLY if the array contains `"application/x-skynet-badge"` calls `e.preventDefault()`. Non-badge drags (row drags, OS file drags, any other future rich payload without the discriminator MIME) fall through without preventDefault, preserving the browser's default not-a-drop-target semantic per T-58-02-06. Uses `Array.from(types).indexOf(...) !== -1` instead of `.includes()` so both jsdom test-stub Arrays and real-browser DOMStringLists work in one code path.
- New `handlePanelDrop` handler — 6-step validation gauntlet:
  1. Read `raw = e.dataTransfer?.getData("application/x-skynet-badge")`. Empty string = not a badge drop → return early.
  2. `JSON.parse(raw)` inside a try/catch. Parse error → return early (T-58-02-02 malformed payload defense).
  3. Type-narrow parsed to `{tabId: string}` and reject non-object / missing / non-string / empty-string tabId.
  4. Guard: `openTabIds.includes(tabId)` — miss → return early (T-58-02-01 spoofing defense).
  5. `e.preventDefault()` — signals the drop is handled.
  6. `console.info(`[convlist-drop] close tabId=${tabId}`)` — explicit-field structured log (T-58-02-04 mitigation, PV58-STRUCTURED-LOGGING).
  7. `onCloseSession?.(tabId)` — optional-call so tests without the prop don't throw.
- Both handlers attached to the outermost panel `<div>` at ~L1264-1272 via `onDragOver={handlePanelDragOver}` + `onDrop={handlePanelDrop}`. Zero changes to any existing prop, handler, or child render.

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (+345 lines)

Two new describe blocks appended to the end of the 92-test file:

**`describe("PrettyConversationsPanel: Phase 58 — conv-list drop target for badge close", ...)` (Tests A-H)**

- **Test A** — Valid badge payload (`application/x-skynet-badge` = `JSON.stringify({tabId:"tab-tina-42"})`) with tabId in `openTabIds` calls `onCloseSession("tab-tina-42")` exactly once.
- **Test B** — Row-drag payload (`application/x-skynet-row` set + `text/plain` set, but NO `application/x-skynet-badge`) does NOT call `onCloseSession`. Discriminator MIME is required.
- **Test C** — Only `text/plain` set (ambiguous single-MIME payload) does NOT call `onCloseSession`. Belt-and-suspenders against future rich-payload sources.
- **Test D** — dragover type-gate: `fireEvent.dragOver` with `application/x-skynet-row`-only types returns `true` (defaultPrevented=false, not captured); with `application/x-skynet-badge` types returns `false` (preventDefault was called). Row drags fall through, badge drags are captured.
- **Test E** — Badge payload with tabId `"tab-mallory-999"` NOT in `openTabIds=["tab-alice-1"]` is silently dropped (no `onCloseSession` call, no throw). Validates the T-58-02-01 spoofing guard.
- **Test F** — Successful badge drop emits exactly one `console.info` call starting with `"[convlist-drop] "` and containing `"tabId=tab-tina-42"`. Validates T-58-02-04 structured logging.
- **Test G** — Badge payload `"{not valid json"` is silently dropped (no throw, no `onCloseSession`). Validates T-58-02-02 JSON.parse safety.
- **Test H (integration)** — Panel drop → `onCloseSession` wire contract: `mockCloseTab` is called exactly once with `"tab-tina-42"` when the panel receives a valid badge drop. Inline comment documents that the tree-reconcile side (`setSplitTree((prev) => removeLeaf(prev, id))` at AppShell.tsx:1498) is COVERED BY EXISTING CODE — no separate assertion in this scoped panel test, per PV58-DOCLOSETAB-TREE-RECONCILE being assertion-only.

**`describe("PrettyConversationsPanel: Phase 58 Plan 02 — Test I (integration): ...", ...)` (Test I)**

- **Test I** — Renders `IdentityBadge` directly (inline `import { IdentityBadge } from "@/features/terminal/IdentityBadge"` after the panel describe blocks) with `tabId="tab-alice-1"`. Fires dragstart with a Map-backed DataTransfer stub. Asserts three properties: `text/plain === "tab-alice-1"` (the load-bearing "the badge is a valid drag source for the Phase 56 Pane onDrop text/plain branch" assertion — this is the payload SplitView.tsx:340 reads via `openSessionInTree(tabId, path, edge)`), `application/x-skynet-badge` parses to `{tabId:"tab-alice-1"}` (belt-and-suspenders — same payload is also the discriminator for the conv-list drop target), and `effectAllowed === "move"` (matches conv-list row convention). Own describe block because it renders IdentityBadge (needs identity seeded in `mockIdentitiesByKey`) rather than PrettyConversationsPanel.

Both describe blocks use the same Map-backed `makeConvListDataTransferStub` helper (mirrors the pattern from IdentityBadge.test.tsx Plan 58-01). Test I's own beforeEach seeds `mockIdentitiesByKey` with a full identity object so IdentityBadge doesn't short-circuit to `null`, and afterEach clears it back to empty Map for downstream tests. `setDesktopViewportForBadgeTest` inline helper mocks `window.matchMedia` + `window.innerWidth` to force `useIsMobile()=false` so the badge activates as a drag source.

### `src/ui/AppShell.tsx` (+10 lines)

Two new props added inline at the `<PrettyConversationsPanel …/>` render site (~L1868), immediately after `visibleInSplitTreeTabIds`:

```
onCloseSession={closeTab}
openTabIds={tabs.map((t) => t.id)}
```

Preceded by an inline comment block documenting PV58-CONVLIST-DROP-TARGET-CLOSE + PV58-DOCLOSETAB-TREE-RECONCILE — noting that closeTab already reconciles splitTree via removeLeaf inside doCloseTab (AppShell.tsx:1498) so no additional wiring is needed. Zero changes to `doCloseTab`, `closeTab`, or the removeLeaf reconcile line at L1498 (verified via grep + read).

### `src/ui/shell/IdentitySessionPane.tsx` (+15 lines net)

Two mount sites gain `tabId` threading:

1. **IdentityBadge mount at :376 (terminal-mode surface)** — gains `tabId={tabId}` (reuses the existing local const `tabId = tab.id` at L103). Inline comment references Plan 58-01 wire + the drag/drop consumers (Phase 56 Pane onDrop for rearrange, Phase 58 Plan 02 conv-list onDrop for close).
2. **PrettyView mount at :232 (pretty-view surface — always mounted)** — gains `tabId={tabId}`. Inline comment explains that without this thread, the pretty-view-mounted badge would render `draggable=false` (Plan 58-01 gate `!!tabId && !isMobile`) and only the terminal-mode surface badge would be a valid drag source.

Zero changes to any other prop, effect, ref, or handler in the file.

### `src/ui/features/pretty-view/PrettyView.tsx` (+10 lines)

Three surgical edits, all additive:

1. **PrettyViewProps interface** — added optional `tabId?: string` at the end of the interface with an inline comment explaining Phase 58 Plan 02 forwarding contract + backwards-compat rationale.
2. **Component destructure** — added `tabId` at the end of the destructure block at L414-428.
3. **IdentityBadge mount at :2927** — added `tabId={tabId}` prop.

Zero changes to WS setup, message dedup, load-more machinery, or any other PrettyView-internal state. The prop threads through as a leaf-level forward with no intermediate consumer.

## Deviations from Plan

**None material.** Plan executed exactly as written across two tasks + three atomic commits (Task 1 RED + Task 1 GREEN + Task 2 combined). Two micro-adjustments that didn't require plan changes:

1. **`handlePanelDragOver` uses `Array.from(types).indexOf(...) !== -1` instead of the plan's implied `types.includes(...)`.** Real-browser DataTransfer.types is a DOMStringList — some engines don't have `.includes()` on that type. jsdom test-stubs return plain Arrays. `Array.from` normalizes both. Same information, safer implementation.
2. **Test I lives in its own describe block, not the main Phase 58 conv-list describe.** Plan said "extend the existing Phase 58 describe block" for Tests H + I. Test H fits — it renders the panel. Test I renders IdentityBadge directly (needs a seeded identity in `mockIdentitiesByKey` that would violate the other tests' beforeEach expectations). Split into a sibling describe with its own beforeEach so Tests A-H stay clean. Semantic property under test preserved unchanged; only physical placement differs.

Neither is a scope deviation.

## Threat Flags

**None new.** All new surface at this layer implements the plan's declared threat model exactly:

- **T-58-02-01 (Spoofing/Elevation)** — mitigated by openTabIds validation guard at drop-handler step 4. Test E proves an unknown tabId is silently dropped.
- **T-58-02-02 (Tampering — malformed JSON)** — mitigated by try/catch around JSON.parse at drop-handler step 2. Test G proves malformed payload is silently dropped without throwing.
- **T-58-02-03 (DoS via drop flood)** — accepted; local-only user gesture, no amplification.
- **T-58-02-04 (Repudiation — missing telemetry)** — mitigated by `[convlist-drop] close tabId=<x>` explicit-field structured log at drop-handler step 6. Test F proves single-log emission.
- **T-58-02-05 (Info disclosure via log)** — accepted; tabId is not PII.
- **T-58-02-06 (Non-badge drops block default browser behavior)** — mitigated by dragover type-gate that only calls preventDefault when the discriminator MIME is present. Test D proves row-drag dragover leaves defaultPrevented=false.
- **T-58-02-07 (Stale leaf in splitTree)** — mitigated by pre-existing AppShell.tsx:1498 `setSplitTree((prev) => removeLeaf(prev, id))` inside doCloseTab. Task 2 grep-verifies the line remains present after this plan; no new production code needed (assertion-only per PV58-DOCLOSETAB-TREE-RECONCILE).

## Verification

```
$ npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/ui/features/terminal/IdentityBadge.test.tsx src/ui/shell/SplitView.test.tsx
 Test Files  3 passed (3)
      Tests  140 passed (140)

$ npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx src/ui/shell/IdentitySessionPane.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx
 Test Files  5 passed (5)
      Tests  56 passed | 1 skipped | 1 todo (58)

$ npx tsc --noEmit 2>&1 | grep -c "error TS"
0

$ grep -c 'onCloseSession' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
4    # prop declaration + destructure + prose comment + call site

$ grep -c 'openTabIds' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
6    # prop declaration + destructure + validation guard + prose

$ grep -c 'application/x-skynet-badge' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
4    # dragover type-gate + drop getData read + prose comments

$ grep -c 'application/x-skynet-row' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
0    # plan does NOT reference row MIME — row-drops fall through by ABSENCE of badge MIME

$ grep -c 'convlist-drop' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
1    # single [convlist-drop] structured log line

$ grep -c 'onCloseSession={closeTab}' src/ui/AppShell.tsx
1

$ grep -c 'openTabIds={tabs\.map' src/ui/AppShell.tsx
1

$ grep -c 'tabId={tabId}\|tabId={tab\.id}' src/ui/shell/IdentitySessionPane.tsx
2    # IdentityBadge + PrettyView mounts

$ grep -c 'tabId={tabId}' src/ui/features/pretty-view/PrettyView.tsx
1    # IdentityBadge mount at :2927

$ grep -c 'tabId?: string' src/ui/features/pretty-view/PrettyView.tsx
1    # PrettyViewProps interface

$ grep -n 'setSplitTree((prev) => removeLeaf(prev, id))' src/ui/AppShell.tsx
1498:      setSplitTree((prev) => removeLeaf(prev, id));   # PV58-DOCLOSETAB-TREE-RECONCILE preserved

$ git diff --stat fb65c2a1^..HEAD src/
 src/ui/AppShell.tsx                                |  10 +
 src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx | 345 +++
 src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx      |  95 +++
 src/ui/features/pretty-view/PrettyView.tsx         |  10 +
 src/ui/shell/IdentitySessionPane.tsx               |  15 +-
 5 files changed, 474 insertions(+), 1 deletion(-)

$ git diff --stat src/ui/lib/split-tree.ts src/ui/shell/SplitView.tsx src/ui/features/pretty-conversations/PrettyConversationRow.tsx src/ui/lib/split-tree-url.ts
    # empty — all four files UNTOUCHED per phase scope-lock
```

All acceptance criteria pass across both tasks. All 9 Phase 58 tests green (7 conv-list drop-target A-G + integration H + dragstart-payload-shape I). Plan 58-01's 13/13 IdentityBadge tests continue to pass (regression gate). Phase 57's 26/26 SplitView tests continue to pass (regression gate). 56/58 consumer-transitive tests pass (1 pre-existing skip + 1 pre-existing todo). Full scoped run: 140/140 passing across the three target files + 56/58 across transitive consumers. TypeScript compiles clean.

## Commits

- `fb65c2a1` — `test(58-02): add failing tests for conv-list panel drop target (Phase 58 A-G)` — RED gate
- `d91089ec` — `feat(58-02): PrettyConversationsPanel panel-level drop target for badge close + tabId validation (PV58-CONVLIST-DROP-TARGET-CLOSE, PV58-STRUCTURED-LOGGING)` — GREEN gate for Task 1
- `7395091c` — `feat(58-02): wire badge tabId at mount sites + AppShell onCloseSession + integration tests (PV58-BADGE-DROP-ON-PANE-REARRANGE-INTEGRATION, PV58-DOCLOSETAB-TREE-RECONCILE)` — Task 2 (single commit for tabId plumb + AppShell wire + Tests H + I per plan directive "single commit for the whole task")

## What's next

Phase 58 code-complete. Both plans (58-01 badge drag source + 58-02 conv-list drop target + tabId plumb) shipped. Parent bounty `bring-back-split-view` moves to closable state on Ashley UAT:

1. **Rearrange test** — Drag a badge from Pane A's edge onto Pane B's edge in a multi-session split tree. Confirm the source cell collapses (removeLeaf) and the target cell splits (insertAtEdge). Wire path: Plan 58-01 dragstart writes `text/plain=tabId` → Phase 56 Pane onDrop reads it → `openSessionInTree(tabId, path, edge)` → `removeLeaf` collapses source → `insertAtEdge` plants at target edge.
2. **Close test** — Drag a badge onto the conv-list. Confirm the session closes and the split tree reconciles (no stale leaf in URL-encoded layout). Wire path: Plan 58-01 dragstart writes `application/x-skynet-badge=JSON.stringify({tabId})` → Plan 58-02 conv-list panel `handlePanelDrop` validates against `openTabIds` → `onCloseSession(tabId)` → AppShell's `closeTab` → `doCloseTab` → `setSplitTree((prev) => removeLeaf(prev, id))` at L1498 automatically reconciles (existing Phase 56 code, unchanged).
3. **Gesture-coexistence test** — Confirm short-click on badge still opens IdentityModal (Test E of Plan 58-01) and long-press still toggles pretty ↔ terminal mode (Test F of Plan 58-01) after drag is enabled. Native HTML5 drag threshold (~5px) is the disambiguator.
4. **Mobile gate test** — Confirm on mobile viewport the badge is draggable=false (SplitView is desktop-only per AppShell.tsx:2372).
5. **Structured logging spot-check** — Devtools console filter for `[badge-drag]` (dragstart) + `[convlist-drop]` (close). Both should emit exactly once per gesture with explicit `tabId=<x>` fields.

Post-UAT, orchestrator handles ship (executor scope stops at code + commit + scoped tests green per fleet directive Ashley 2026-08-08). On ship, close bounty `bring-back-split-view` (status → done, archive).

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — MODIFIED (verified via `git log --oneline -3 -- src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` shows commit d91089ec)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — MODIFIED (verified via commits fb65c2a1 + 7395091c)
- `src/ui/AppShell.tsx` — MODIFIED (verified via commit 7395091c)
- `src/ui/shell/IdentitySessionPane.tsx` — MODIFIED (verified via commit 7395091c)
- `src/ui/features/pretty-view/PrettyView.tsx` — MODIFIED (verified via commit 7395091c)
- Commit `fb65c2a1` — FOUND (RED gate)
- Commit `d91089ec` — FOUND (Task 1 GREEN)
- Commit `7395091c` — FOUND (Task 2)
- All 9 Phase 58 tests pass at HEAD; all 140/140 scoped tests pass; 56/58 transitive consumer tests pass (0 new failures)
- TypeScript compiles clean at HEAD (0 error TS)
- All grep gauntlet acceptance criteria satisfied across both tasks
- Scope-locked files (split-tree.ts, SplitView.tsx, PrettyConversationRow.tsx, split-tree-url.ts) confirmed UNTOUCHED via `git diff --stat`
- AppShell.tsx:1498 `setSplitTree((prev) => removeLeaf(prev, id))` reconcile line confirmed PRESENT and UNCHANGED via grep -n
