---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 06
subsystem: drag-source
tags: [drag-source, relay, tabid-threading, d-05, d-18, phase-93-slice-2, uat-blocker]
requires:
  - src/ui/features/terminal/IdentityBadge.tsx (Phase 58 Plan 01 drag-source contract; pre-existing, byte-untouched)
  - src/ui/features/pretty-view/MultiBadgeAnchor.tsx (Phase 93 Slice 2 relay-case anchor; existed before, now widened)
  - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (Phase 93 Slice 2 Task 1 meter appendage; existed before, now widened)
  - Plan 97-01 Task 4 verdict "approved verdict a" (case-branch fill-in ships; structural reshape not required)
provides:
  - Relay-case per-participant IdentityBadges as drag SOURCES carrying the ROOM tab's tabId
  - MultiBadgeAnchorProps.tabId (optional) — passed to every rendered IdentityBadge
  - AgentBadgeWithMeterProps.tabId (optional) — pass-through to inner IdentityBadge
  - dataTransfer payload contract parity between harness single-badge case and relay multi-badge case (both fire IdentityBadge.tsx:200-244's `text/plain` + `application/x-skynet-badge` write once `tabId` is present)
affects:
  - SplitView drop-target listener (SplitView.tsx L297 / L558 / L441) now receives valid drag payloads from relay-case badges — D-05 direction "room-showing surface as drag source" is enabled end-to-end
  - Any future consumer of MultiBadgeAnchor gets tabId threading for free (opt-in via prop)
tech-stack:
  added: []
  patterns:
    - Optional-prop threading through subcomponent tree (HumanBadgeCell + AgentBadgeCell → IdentityBadge; AgentBadgeCell → AgentBadgeWithMeter → IdentityBadge)
    - Spy-mock IdentityBadge with DOM-marker attributes (data-tabid, data-has-onclick) for prop-inspection tests
    - Mirroring harness pattern verbatim (PrettyView.tsx L3575 → L3605)
    - D-18 explicit non-supply: no onClick prop on IdentityBadge in MultiBadgeAnchor branch (click contract stays inert)
key-files:
  created:
    - src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx
  modified:
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx
    - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - Verdict A confirmed (Plan 97-01 Resolution 2026-09-10) — case-branch fill-in only, no SplitView reshape
  - Zero-touch IdentityBadge primitive (Phase 93 Slice 2 scope discipline preserved)
  - D-18 badge-click no-op preserved by not supplying onClick, orthogonal to drag-source enablement
  - Existing `[badge-drag]` structured log at IdentityBadge.tsx:240 emits naturally; no new logs added per plan-checker INFO-1
metrics:
  duration: 5m
  completed: 2026-09-10T02:44:38Z
  tasks_completed: 2
  files_touched: 4
  tests_added: 5
---

# Phase 97 Plan 06: MultiBadgeAnchor tabId Drag-Source Threading Summary

**One-liner:** F-2's drag-source half shipped — MultiBadgeAnchor now threads the enclosing relay tab's `tabId` through `HumanBadgeCell` + `AgentBadgeCell` + `AgentBadgeWithMeter` into every rendered `IdentityBadge`, flipping `isDragSource` from false to true so per-participant badges in a relay room become native HTML5 drag sources carrying the ROOM tab's tabId in dataTransfer, mirroring the harness single-badge contract at `PrettyView.tsx:3575` verbatim.

## What Shipped

Two tasks — Task 1 was a precondition-check gate (no code); Task 2 was a single TDD RED/GREEN cycle that touched three production files + one new test file, two atomic commits total on `feat/tab-title-from-tmux`:

| Commit | Type | Description |
|--------|------|-------------|
| `f0eb01b7` | test(97-06) | RED — 5 new drag-source tests in `MultiBadgeAnchor.drag-source.test.tsx` (Test 1 threads tabId to every badge; Test 2 pre-plan regression floor; Test 3 mixed HumanBadgeCell + AgentBadgeCell fallback + AgentBadgeWithMeter branches; Test 4 D-18 preservation — no onClick ever supplied; Test 5 AgentBadgeWithMeter integration shape). 3/5 fail as expected (the two negative-case tests pass since pre-plan state has no tabId anywhere). |
| `472616ff` | feat(97-06) | GREEN — `MultiBadgeAnchorProps` + `AgentBadgeWithMeterProps` widened with optional `tabId?: string`; both cell subcomponents accept + thread it; PrettyView.tsx relay-case mount passes `tabId={tabId}`. All 32 scoped tests (5 new + 10 MultiBadgeAnchor + 17 AgentBadgeWithMeter) pass green; `npx tsc --noEmit` clean project-wide. |

### Task 1 — precondition gate

Read `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md`; verified the Resolution section (2026-09-10) contains the literal strings `VERDICT A` and `Plan 06 SHIPS`. Resolution excerpt confirming:

> **Verdict:** **A — case-branch fill-in only. Plan 06 SHIPS as planned.**
> **Approved by:** Ashley (thumbs up on the orchestrator's Task 4 checkpoint report; resume signal verbatim `"approved verdict a"`).

Gate passed. No commit for Task 1 (per plan action text: only commit a no-op summary if precondition fails).

### Task 2 — three-file prop-threading

**File 1: `src/ui/features/pretty-view/MultiBadgeAnchor.tsx`**

- `MultiBadgeAnchorProps` widened at L97-109 with new optional prop:
  ```ts
  /**
   * Phase 97 Finding 2: the enclosing relay tab's tabId. Threaded to every
   * per-participant IdentityBadge child so each badge becomes a drag SOURCE
   * carrying the ROOM tab's tabId (dragging any badge drags the whole room
   * tab, per D-05). Undefined → badges are not drag-sourceable (parity with
   * pre-Phase-97 behavior). D-18 preserved: onClick is separately
   * not-supplied by MultiBadgeAnchor, so click remains inert; only
   * drag-source is enabled by tabId presence. The isMobile gate at
   * IdentityBadge.tsx:82 still applies (mobile stays non-draggable).
   */
  tabId?: string;
  ```

- `HumanBadgeCell` signature widened to accept `tabId?: string`; the single `<IdentityBadge identityKey={identityKey} />` mount at (formerly) L134 is now `<IdentityBadge identityKey={identityKey} tabId={tabId} />`.

- `AgentBadgeCell` signature widened to accept `tabId?: string`; the fallback branch's IdentityBadge (when hostId is undefined) now passes `tabId={tabId}`; the `<AgentBadgeWithMeter>` mount in the primary branch also passes `tabId={tabId}` as a pass-through.

- `MultiBadgeAnchor` render body destructures `tabId` from props and passes it to both `<AgentBadgeCell>` and `<HumanBadgeCell>` invocations. No other changes to the render body (`ROOT_ANCHOR_CLASS`, sort discipline, loading placeholder, self-exclusion filter, `flex-row-reverse` layout — all untouched).

**File 2: `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx`**

- `AgentBadgeWithMeterProps` widened at L80-102 with optional `tabId?: string`.

- Function signature at L100-106 destructures `tabId`.

- The inner `<IdentityBadge identityKey={identityKey} />` mount (formerly bare at L186; now L192 after doc-comment addition) becomes `<IdentityBadge identityKey={identityKey} tabId={tabId} />`.

- The drawer wrapper (Phase 97 Plan 04's output — `data-drawer="true"`, `-mt-2`, `pt-[10px]`, `zIndex: 1`), meter well, reset button, segment strip, and band computation are all byte-untouched.

**File 3: `src/ui/features/pretty-view/PrettyView.tsx`**

- Single one-line addition at the relay-case `MultiBadgeAnchor` mount (L3597-3606). Before:
  ```tsx
  {source.kind === "relay" && (
    <MultiBadgeAnchor
      participants={...}
      viewingUserMxid={viewingUserMxid ?? ""}
      fleetIdentityHosts={fleetIdentityHosts}
      isReady={chatSurfaceAdapter.isReady}
    />
  )}
  ```
  After:
  ```tsx
  {source.kind === "relay" && (
    <MultiBadgeAnchor
      participants={...}
      viewingUserMxid={viewingUserMxid ?? ""}
      fleetIdentityHosts={fleetIdentityHosts}
      isReady={chatSurfaceAdapter.isReady}
      tabId={tabId}
    />
  )}
  ```

- Harness single-badge site at L3569-3586 is byte-untouched; its pre-existing `tabId={tabId}` at L3575 is the mirror this plan copied.

**File 4: `src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx` (new)**

Five tests covering the F-2 fix contract. Spy-mock pattern: `vi.mock("@/features/terminal/IdentityBadge")` renders a stub that emits `data-tabid` + `data-has-onclick` DOM attributes AND records prop objects via a `vi.fn()` spy for assertion. Tests exercise a mixed-participant scenario (1 human + 2 mapped agents + 1 unmapped agent → 4 badges across all three subcomponent branches: HumanBadgeCell body, AgentBadgeCell fallback, AgentBadgeCell primary → AgentBadgeWithMeter passthrough).

## Verification

### Grep gates (all green)

| Gate | Result |
|------|--------|
| `MultiBadgeAnchorProps.tabId?: string` present | 3 matches (comment + prop-decl + comment refs elsewhere) |
| `AgentBadgeWithMeterProps.tabId?: string` present | 1 match (prop-decl) |
| `<IdentityBadge identityKey={identityKey} tabId={tabId} />` in MultiBadgeAnchor.tsx | 2 (HumanBadgeCell + AgentBadgeCell fallback) — meets `>= 2` gate |
| Same pattern in AgentBadgeWithMeter.tsx | 1 (meter-cell inner badge) |
| `tabId={tabId}` total occurrences in MultiBadgeAnchor.tsx | 5 (2 IdentityBadge + 1 AgentBadgeWithMeter + 2 subcomponent invocations at render body) |
| `tabId={tabId}` in PrettyView.tsx | 2 (harness L3575 unchanged + new relay-case L3605) |
| `git diff --name-only src/ui/features/terminal/IdentityBadge.tsx` | empty (untouched) |
| `onClick=` on IdentityBadge in MultiBadgeAnchor.tsx | 0 code refs (only 2 comment mentions — D-18 preserved) |
| `MultiBadgeAnchor.drag-source.test.tsx` exists | yes |

### Test suite (all green)

```
$ npx vitest run \
    src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx \
    src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx \
    src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx

Test Files  3 passed (3)
     Tests  32 passed (32)
```

- 5 new drag-source tests (Test 1-5 of Task 2's `<behavior>` block) all pass.
- 10 pre-existing MultiBadgeAnchor tests (sort discipline, self-exclusion, position classes, loading/empty/ready discrimination) still pass — no regression to Phase 93 Slice 2 Task 2 contract.
- 17 pre-existing AgentBadgeWithMeter tests (meter render, band computation, reset dispatch, drawer wrapper) still pass — no regression to Phase 93 Slice 2 Task 1 or Phase 97 Plan 04 drawer chrome.

### Project-wide TypeScript

```
$ npx tsc --noEmit
(exit 0, zero output)
```

Project-wide clean. No new errors introduced by the prop widening.

## Deviations from Plan

**None** — plan executed exactly as written. The action block was precise enough to apply mechanically; no auto-fix rules (Rule 1/2/3) fired; no architectural checkpoints (Rule 4) reached.

The plan's proposed test-file skeleton was expanded slightly:
- Test 3 (mixed participant list) uses a 4-badge scenario (1 human + 2 mapped agents + 1 unmapped agent) so the AgentBadgeCell **fallback** branch (unmapped agent) is exercised alongside the primary AgentBadgeWithMeter branch — the plan's `<behavior>` said "1 human + 1 agent with meter + 1 agent without meter/fallback branch" which is exactly this shape.
- Test 5 was added as an integration-shape check on the AgentBadgeWithMeter branch specifically (D-05 room-drag source parity), matching the plan's Test 5 description.

## Threat Flags

None. The threat register (T-97-06-01 through T-97-06-SC in the plan frontmatter) is fully mitigated:

- **T-97-06-01 (harness contract tampering)** — PrettyView.tsx L3569-3586 harness site byte-untouched (grep-verified; only the relay-case L3597-3606 block gained `tabId={tabId}`).
- **T-97-06-02 (IdentityBadge primitive tampering)** — `git diff --name-only src/ui/features/terminal/IdentityBadge.tsx` returns empty.
- **T-97-06-03 (drag-source elevation)** — accepted per plan; drag source is client-local and the drop routes through `onOpenSessionInTree` which validates tabId existence in the local tab set.
- **T-97-06-SC (supply chain)** — no package installs.

## Known Stubs

None. The `tabId` prop is threaded end-to-end from PrettyView down to every IdentityBadge; there are no "empty prop passed for future wiring" scenarios. The pre-plan behavior (tabId undefined → non-draggable) is now the fallback for callers that don't supply it — a legitimate opt-in shape, not a stub.

## Post-Ship Live-Browser Verification (deferred to phase-end deploy)

Per Plan 97-01 Resolution: "Live-browser verification: DEFERRED to phase-end deploy (standard fleet pattern — no deploy happens mid-phase; Task 1–3 commits are not live in Ashley's environment)."

At phase-end deploy, the confirmatory reproduction Ashley will run:

1. Open a plain terminal session.
2. Open a relay room in a second tab.
3. From the relay-room tab, drag any participant's IdentityBadge onto an empty split slot on the plain terminal Pane.
4. **Expected:** the relay room opens in that split slot (D-05 drag-source direction).
5. **Expected structured log tape (visible in DevTools console with filter `badge-drag` or `pv-split-drop`):**
    ```
    [badge-drag] operation=drag_start tabId=<relay-tab-id> hasIdentity=true
    [pv-split-drop-diag] phase=dragover pane path=[...] zone=... clientX=... clientY=...
    [pv-split-drop] center-drop dispatch=... sourceTabId=<relay-tab-id> targetTabId=<plain-tab-id>
    ```
    The existing `[badge-drag]` log at `IdentityBadge.tsx:240` emits naturally once `dragstart` fires; no new logs were added by this plan (plan-checker INFO-1 satisfied).
6. **D-18 confirmation:** click (not drag) a participant badge — nothing happens. No IdentityModal, no navigation, no dispatch. Click contract stays inert in the relay case.

If the live reproduction contradicts the Verdict A prediction (drag not initiating despite tabId now threaded, OR plain-session split failing after a room open/close cycle), the `[pv-split-drop-diag]` instrumentation added by Plan 97-01 gives a forensic tape to walk H1/H2/H4/H5. Escalation path in that case is Verdict B (open a follow-up phase for F-2 structural reshape via `/open`).

## Files Touched (summary)

| File | Change | Lines |
|------|--------|-------|
| `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` | Added `tabId?: string` prop + threaded through both cell subcomponents + both IdentityBadge mounts + AgentBadgeWithMeter mount | +19 / -3 |
| `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` | Added `tabId?: string` prop + destructured + threaded to inner IdentityBadge | +12 / -2 |
| `src/ui/features/pretty-view/PrettyView.tsx` | Added single `tabId={tabId}` prop on relay-case MultiBadgeAnchor mount | +1 / 0 |
| `src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx` | New test file — 5 tests covering RED/GREEN contract + D-18 preservation | +320 / 0 |

Net: 3 production files (all in wave-3 territory as expected: MultiBadgeAnchor shared with Plan 01 F-4 gap, AgentBadgeWithMeter shared with Plan 04 drawer chrome, PrettyView shared with Plans 02+03 veil+identityName) + 1 new test file. Wave-3 sequential execution avoided all cross-plan file conflicts.

## Self-Check: PASSED

Verified all claims in this summary:

- Created file exists: `src/ui/features/pretty-view/MultiBadgeAnchor.drag-source.test.tsx` (present in tree).
- Modified files touched (git status clean, no other paths dirty).
- Commits exist:
  - `f0eb01b7` (test RED) — `git log --oneline | grep f0eb01b7` returns match.
  - `472616ff` (feat GREEN) — `git log --oneline | grep 472616ff` returns match.
- IdentityBadge primitive untouched: `git diff feat/tab-title-from-tmux~2 -- src/ui/features/terminal/IdentityBadge.tsx` is empty.
- Scoped vitest run reported `Test Files  3 passed (3) | Tests  32 passed (32)`.
- `npx tsc --noEmit` exited 0 with zero output.
- Harness single-badge site at PrettyView.tsx:3569-3586 unchanged (its `tabId={tabId}` at L3575 was pre-existing; the new addition is at L3605 in the relay case).
