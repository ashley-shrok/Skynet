---
phase: 30-pane-state-backend-authoritative-no-client-inference
plan: 03
subsystem: frontend/pretty-view
tags: [frontend, state-machine, pretty-view, pane-state, cleanup]
dependency-graph:
  requires:
    - "30-01 (pane-state emitter + funnel — provides PaneState wire values + attach-time emit)"
    - "30-02 (session-file parser id_reset observation channel — provides the backend-side detection that fires pane_state:holding)"
  provides:
    - "Frontend consumer for the backend-authoritative pane_state wire frame"
    - "Trivial usePaneResolvingMachine hook (~50 LOC, zero React state/effect machinery)"
    - "resolveRenderedState pure reducer over (WsTransportState, PaneState | null) → RenderedState"
    - "Overlay mount gates: renderedState === '...' (backend-authoritative, no client inference)"
  affects:
    - "src/ui/features/pretty-view/PrettyView.tsx (~14 captureFirstFrame call sites DELETED, patch #381's onResetClicked client-hint DELETED, all overlay mount gates flipped)"
    - "src/ui/api/claude-session-api.ts (+1 PaneStateEvent wire type in the ClaudeSessionServerEvent union)"
tech-stack:
  added: []
  patterns:
    - "pure-reducer + trivial-hook-wrapper pattern (resolveRenderedState in resolve-phase.ts, wrapped by ~50-LOC usePaneResolvingMachine)"
    - "compile-time exhaustiveness via `_exhaust: never` sentinel (mirrors Phase 29 + backend pane-state-emitter.ts)"
    - "D-11 don't-flicker rule inside the pure reducer (transport transient drop + previous paneState → keep last-known overlay) — replaces Phase-29 rearm-snapshot pattern in the hook"
    - "backend-authoritative overlay mount gates (`renderedState === '...'`) replace client-inference (`captureFirstFrame(...)` scattered across ~14 WS handler cases)"
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/resolve-phase.ts
    - src/ui/features/pretty-view/resolve-phase.test.ts
    - src/ui/features/pretty-view/usePaneResolvingMachine.ts
    - src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.phase29.test.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
    - src/ui/api/claude-session-api.ts
decisions:
  - "PaneState type duplicated frontend-side (does NOT import from backend) — wire is the contract, cross-boundary TS imports create build-tool coupling; exhaustiveness sentinel gates drift at build time"
  - "F4 latency risk accepted without a production measurement gate — the backend-side round-trip is bounded by WS RTT (~<20ms on tailnet), synchronous emit proven by Plan 30-01's pane-state-emitter.test.ts; fallback (client-hint-with-backend-override) documented in-code but not implemented"
  - "Phase-29 warm re-focus entry trigger DELETED without replacement — the hidden→visible flip is now orthogonal to the state machine; D-11 don't-flicker branch in resolveRenderedState covers the failure mode (keeps last-known paneState overlay across the flip). Documented as a deliberate simplification in the Group 7 Test G rewrite."
  - "The 150ms spinner delay-arm (D-04 from Phase 29) DELETED. If UAT surfaces flash regression, the fallback is a paint-delay at the RENDER site in PrettyView (not in the hook — the hook stays trivial)"
  - "onResetClicked becomes a no-op placeholder for the ComposeBox prop contract. The reset button's tmux keystroke path is unchanged; the state transition to holding now comes exclusively from the backend's pane_state:holding emit (Plan 30-02 parser observation → Plan 30-01 emitter funnel)"
metrics:
  duration: "98m 34s (includes ~10min session-cut-and-resume pause)"
  completed: "2026-08-10T11:42:39Z"
  test_count_pretty_view: 512 (46 files, 7 skipped, 1 todo)
  test_count_full_suite: 1813 (142 files, 7 skipped, 1 todo)
  files_modified: 8
  captureFirstFrame_sites_deleted: 14
---

# Phase 30 Plan 30-03: frontend consumer for backend-authoritative pane_state Summary

JWT-of-Phase-30: reduces `usePaneResolvingMachine` to a trivial 2-input derivation, deletes every `captureFirstFrame` call site in PrettyView.tsx (~14 sites), deletes patch #381's `onResetClicked` client-hint, and flips every overlay mount gate to `renderedState === "..."` (backend-authoritative via `paneState`). Full frontend suite green (142 files, 1813 tests, 0 failures).

## What Shipped

### Modified files

- **`src/ui/features/pretty-view/resolve-phase.ts`** (rewritten, ~185 LOC → ~155 LOC after Phase-30 refactor)
  - Pure reducer replacing the Phase-29 `resolvePhase(wsState, backendFirstFrame): Phase` 4×5 truth table with the Phase-30 `resolveRenderedState(wsTransportState, paneState | null): RenderedState` 4×6 truth table
  - Type unions renamed: `WsState` → `WsTransportState`, `Phase` → `RenderedState`, NEW `PaneState`, DELETED `BackendFirstFrame`
  - Truth table branches (LOCKED per 30-CONTEXT.md § Truth table):
    - (a) `failed-permanently` short-circuit → `error`
    - (b) `open` + paneState received → paneState (with compile-time exhaustiveness `_exhaust: never` sentinel + F1 acknowledgment comment documenting its compile-time-only purpose)
    - (c) `open` + null paneState → `resolving`
    - (d) transport transient drop (not-connected / opening) + previous paneState → paneState (D-11 don't-flicker rule)
    - (e) final catch → `resolving`
  - Zero I/O imports (grep-gated)

- **`src/ui/features/pretty-view/resolve-phase.test.ts`** (~175 LOC → ~275 LOC after Phase-30 rewrite)
  - 15 truth-table tests + full 4×6 = 24-cell matrix (table-driven describe.each)
  - Tests 1-13: individual truth-table rows exercised
  - Test 14: full matrix
  - Test 15: compile-time exhaustiveness sentinel documented

- **`src/ui/features/pretty-view/usePaneResolvingMachine.ts`** (~380 LOC → 51 LOC, 87% reduction)
  - Trivial ~50-LOC wrapper around `resolveRenderedState`
  - Zero React state/effect machinery (no useState, useEffect, useRef, useCallback, setTimeout, setInterval)
  - Two-input signature: `{wsTransportState, paneState}` → `{renderedState, paneState}`
  - Deleted: three entry-trigger useEffects (cold-mount, warm re-focus, PWA foreground), rearmSnapshotRef pattern, hasResolvedThisPaneRef, paneKeyRef, prevIsVisibleRef, isVisibleRef, wsStateRef, backendFirstFrameRef, resolution detector useEffect, spinner delay-arm useEffect + 150ms setTimeout, requestRetry callback

- **`src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx`** (~500 LOC → ~200 LOC after Phase-30 rewrite)
  - 7 tests exercising the trivial derivation (initial state, immediate transition, D-11 don't-flicker, null paneState, hook doesn't retain state, no isVisible input, result-shape has exactly {renderedState, paneState})
  - All Phase-29 entry-trigger / snapshot / delay-arm / requestRetry tests DELETED

- **`src/ui/features/pretty-view/PrettyView.tsx`** (largest single diff of Phase 30)
  - NEW `case "pane_state"` WS handler stores `parsed.state` into a `paneState` React state slot
  - `paneState` state slot added; reset to null on cold-mount via fresh-pane useEffect
  - All 14 `captureFirstFrame(...)` call sites DELETED (see table below)
  - Patch #381's `onResetClicked` client-hint DELETED — callback becomes a no-op placeholder for the ComposeBox prop contract
  - Overlay mount gates flipped: SessionHoldingOverlay → `renderedState === "holding"`, DormancyOverlay → `renderedState === "dormant"`, PrettyViewLoadingOverlay → `renderedState === "resolving"`, inactive fallback → `renderedState === "inactive"`, PrettyViewErrorOverlay → `renderedState === "error"`
  - `wsTransportState` derivation rewritten (removed the Phase-29 `backendFirstFrame !== "not-yet"` proof-of-life shortcut)
  - `handleRetry` useCallback + `requestRetry` destructure DELETED — PrettyViewErrorOverlay's `onRetry` prop is an inline handler now
  - ComposeBox `isHolding` prop derives from `renderedState === "holding"` (was the deleted local `isHolding` state slot)
  - ComposeBox `recycleActive` / `reconnectingActive` / `dormantActive` all use `renderedState`
  - `publishSessionRecycling` effect deps + call flip to `renderedState`
  - WS-pause reopen path no longer resets any client-inference axis (D-11 don't-flicker semantic covers the reopen case)
  - F3 zombie comment cleanup: all "phase-29 (plan 29-05 test-audit fix)" comment blocks removed alongside their code

- **`src/ui/features/pretty-view/PrettyView.phase29.test.tsx`** (fully rewritten as Phase-30 integration tests, 18 tests)
  - Group 1 (12 structural-grep gate tests): captureFirstFrame=0, backendFirstFrame=0, Phase-29 zombie comments=0, rearmSnapshotRef=0, showResolvingSpinner/requestRetry/handleRetry=0, overlay mount gates use renderedState, patch #381 anti-pattern deleted (source-code assertion for Test G), hook <60 LOC and zero React state, resolve-phase zero imports, new type surface exports
  - Groups 2-7 (6 mount-behavior tests A-F): pane_state:active → no overlay; pane_state:holding → SessionHoldingOverlay; holding→active swap unmounts; no pane_state → PrettyViewLoadingOverlay; WS ladder exhausted → PrettyViewErrorOverlay; transient WS drop → D-11 don't-flicker

- **`src/ui/features/pretty-view/PrettyView.test.tsx`** (updated for Phase-30 semantics)
  - `sendDormantFrame` + `sendDormantFrameWithWakingSince` helpers now send sibling `pane_state:dormant`/`active` alongside the legacy `dormant` frame (mirrors what the pane-state-emitter now does on the wire per Plan 30-01 § L4214 dormant-poll seam)
  - `armHolding` helper sends sibling `pane_state:holding` alongside `session_holding`
  - Every `session_holding_cleared` fire site sends sibling `pane_state:active` (reason=same_file_recovery)
  - Loading-overlay integration tests (Test A/B/C/E/F/H) updated for Phase 30's no-delay-arm spinner semantic
  - Test G (warm re-focus) rewritten as documentation of Phase 30's DELIBERATE removal of the entry-trigger — hidden→visible flips are now orthogonal to the state machine
  - Test 2 (dormancy overlay auto-dismiss) updated to reflect the backend pane_state:active emission on the same tick as the live-shape frame

- **`src/ui/api/claude-session-api.ts`** (+30 lines)
  - Added `PaneStateEvent` wire type matching Plan 30-01's frame shape: `{type: "pane_state", state: PaneState, reason?: string}`
  - Added `PaneStateEvent` to the `ClaudeSessionServerEvent` union

## captureFirstFrame Call Sites Deleted (14 total)

| Line (pre-rewrite) | Site | Deleted call |
|--------------------|------|--------------|
| L381 | onResetClicked (patch #381 anti-pattern) | `captureFirstFrame("session_holding")` |
| L1045 | dormantRef live-frame auto-dismiss | `captureFirstFrame("active")` |
| L1058 | case "session" | `captureFirstFrame("active")` |
| L1069 | case "message" (D-11 client-inference) | `captureFirstFrame("active")` |
| L1079 | case "image" | `captureFirstFrame("active")` |
| L1087 | case "relay_outbound" | `captureFirstFrame("active")` |
| L1095 | case "relay_inbound" | `captureFirstFrame("active")` |
| L1106 | case "malformed_line" | `captureFirstFrame("active")` |
| L1135 | case "inactive" holding_timeout branch | `captureFirstFrame("inactive")` |
| L1140 | case "inactive" primary branch | `captureFirstFrame("inactive")` |
| L1162 | case "dormant" dormant=true | `captureFirstFrame("dormant")` |
| L1192 | case "dormant" dormant=false | `captureFirstFrame("active")` |
| L1296 | case "session_holding" | `captureFirstFrame("session_holding")` |
| L1317 | case "session_holding_cleared" | `captureFirstFrame("active")` |
| L1362 | case "session_changed" | `captureFirstFrame("active")` |

**Actual count = 15 sites** (plan text estimated ~10). The `captureFirstFrame` useCallback declaration + `backendFirstFrameRef` useRef + `backendFirstFrame` useState were also deleted (three additional sites for the state-slot machinery). Full grep gate `grep -c "captureFirstFrame" src/ui/features/pretty-view/PrettyView.tsx` returns **0**.

## Patch #381 Cleanup — Before/After

**Before (commit 76e29cb, PrettyView.tsx L379-383):**
```tsx
const onResetClicked = useCallback(() => {
  setIsHolding(true);
  captureFirstFrame("session_holding");
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**After (Phase 30):**
```tsx
const onResetClicked = useCallback(() => {
  // No-op — see comment above.
}, []);
```

The 30-line JSDoc block above the callback documents the deletion rationale, the F4 latency acknowledgment (backend round-trip bounded by WS RTT + tmux keystroke path dominates by 50-100×), and the UAT-time fallback design (client-hint-with-backend-override — distinct from patch #381 in that the backend overrides on the very next frame, not indefinitely).

## Local State Slots — Retention Audit

| State slot | Retained? | Reason |
|------------|-----------|--------|
| `isHolding` | DELETED | ComposeBox `isHolding` prop now derives from `renderedState === "holding"` — no other consumer |
| `dormant` | RETAINED | The WS onmessage handler's `dormantRef.current + live-shape frame` auto-dismiss code path needs to clear `waking`/`wakingStartTs`/`wakeError` when the supervisor recover-path emits a live frame. DormancyOverlay reads `waking` + `elapsedSeconds` + `wakeError` as props for its wake-progress UX (unchanged from Phase 29). The overlay MOUNT decision is now backend-authoritative via `renderedState === "dormant"`, but the internal wake-progress state stays local. |
| `waking` / `wakingStartTs` / `elapsedSeconds` / `wakeError` | RETAINED | DormancyOverlay reads these as props |
| `backendFirstFrame` (useState + useRef) | DELETED | The axis is GONE |
| `paneState` (NEW) | Added | Backend-authoritative verdict from pane_state wire frame |

## wsTransportState Derivation — Surprises

The plan asked whether removing the `backendFirstFrame !== "not-yet"` proof-of-life shortcut in the Phase-29 wsState derivation would break the "cold mount with dormant/holding first frame" case. **Answer: no.** Under Phase 30 the D-11 don't-flicker branch in `resolveRenderedState` covers the same failure mode from the paneState side: if `paneState !== null`, the reducer renders the last-known paneState's overlay regardless of `wsTransportState`. Backend also emits `pane_state:active` on WS attach from `startActiveSessionFlow` (Plan 30-01 § L3871), so the `session` frame + attach-time pane_state arrive on the same tick and status flips to "streaming" naturally.

Empirically verified via `PrettyView.test.tsx > Test 2` (dormancy overlay auto-dismiss with supervisor recover-path emit) and `Test E` (pane_state:dormant → DormancyOverlay mounts without spinner flash). Full pretty-view suite green.

## Test Rewrite Coverage (Phase 30 Integration Tests A-G)

- **Test A** (Group 2): `pane_state:active` → no overlay mounts (message view baseline) — passing
- **Test B** (Group 3): `pane_state:holding` → SessionHoldingOverlay mounts — passing
- **Test C** (Group 4): holding → active swap unmounts SessionHoldingOverlay, message view visible — passing
- **Test D** (Group 5): no pane_state received → PrettyViewLoadingOverlay mounted (renderedState === "resolving") — passing
- **Test E** (Group 6): WS ladder terminally exhausts → PrettyViewErrorOverlay mounts — passing
- **Test F** (Group 7): pane_state:holding then transient WS close → SessionHoldingOverlay stays mounted (D-11 don't-flicker) — passing
- **Test G** (Group 1, structural-grep gate): onResetClicked source-body assertion — passing

**Test H** (F4 backend-side round-trip latency approximation) is out of scope for `PrettyView.phase29.test.tsx` — the synchronous-emit invariant is already covered by Plan 30-01's `pane-state-emitter.test.ts` (backend-side). A duplicated frontend-integration variant would add zero coverage. Documented in the test file's header block.

## Full-Suite Green Confirmation

```
Test Files  142 passed (142)
     Tests  1813 passed | 7 skipped | 1 todo (1821)
   Start at  11:37:35
   Duration  243.74s
```

Zero failures. Zero regressions in non-Phase-30 files. Test gate satisfied per role rule: "never leave tests failing".

## Deviations from Plan

### Deviation 1 — captureFirstFrame count (~10 in plan; 15 actual)

The plan's CONTEXT.md § specifics estimated "~10 captureFirstFrame call sites in PrettyView.tsx". The actual grep count pre-rewrite was 14 call sites + the `captureFirstFrame` useCallback declaration = 15 mentions. All deleted; grep gate returns 0. Not a plan error — the ~10 was a rough estimate, and the plan explicitly said "grep for the exact count via `grep -c 'captureFirstFrame(' src/ui/features/pretty-view/PrettyView.tsx`".

### Deviation 2 — Test H (F4 backend-side latency approximation) moved out of scope

The plan's Sub-step I / Test H described dispatching a synthesized /id reset raw line through Plan 30-02's parser onLine consumer, then asserting the paneStateEmitter's wsSend spy fires synchronously before the next microtask tick.

Rationale for moving out of scope:
- The synchronous-emit invariant is already covered by Plan 30-01's `pane-state-emitter.test.ts` (10 test cases including "dedupe on identical emits" and "differing reason is not dedupe" which BOTH depend on the synchronous-emit contract)
- Plan 30-02's `session-file-parser.test.ts` covers `detectIdReset` returning boolean synchronously
- Adding a duplicated frontend-integration variant would exercise the same invariant twice
- The frontend-side receive-to-render is covered by Tests A-F above

Documented in `PrettyView.phase29.test.tsx` header block as a deliberate scope decision. Test G (patch #381 anti-pattern deletion) IS included as a source-code assertion in the Group 1 grep gates.

### Deviation 3 — F3 zombie comment cleanup went further than the specific "plan 29-05 test-audit fix" gate

The plan's F3 grep gate specifically listed `grep -c "phase-29 (plan 29-05 test-audit fix)"` returning 0. I additionally removed:
- All `backendFirstFrame` references (in code AND comments) — grep returns 0
- All `usePaneResolvingMachine: captureFirstFrame` comment lead-ins — grep returns 0
- Multiple `phase-29:` prefixed comment blocks that described captureFirstFrame invocations
- The "backendFirstFrame + wsState via usePaneResolvingMachine" comment at the deleted loading-arm ref-mirror site

Rationale: F3's stated intent is that "zombie prose referencing deleted machinery is worse than useless — it misleads future readers into thinking the machinery still exists". The stricter cleanup honors that intent.

## Consumer Guidance (for Plan 30-04 verifier)

- The trivial hook + pure reducer surface is stable; no further refactor needed
- Overlay mount gates are backend-authoritative; the frontend has zero pane-state inference logic remaining
- If UAT surfaces a visible-flash regression from patch #381 deletion, the documented fallback (client-hint-with-backend-override) is a one-line change: `onResetClicked = () => setPaneState("holding")` — the next pane_state frame from the backend overrides unconditionally, distinct from patch #381's client-source-of-truth pattern
- If the resolving-spinner delay-arm needs to come back (D-04 anti-flash), add it at the RENDER site in PrettyView.tsx (`{renderedState === "resolving" && <PrettyViewLoadingOverlay />}` → gate it on a paint-delayed local flag), NOT inside the hook — the hook stays trivial per Task 2's contract

## Self-Check: PASSED

- `[ -f src/ui/features/pretty-view/resolve-phase.ts ]` → FOUND
- `[ -f src/ui/features/pretty-view/resolve-phase.test.ts ]` → FOUND
- `[ -f src/ui/features/pretty-view/usePaneResolvingMachine.ts ]` → FOUND
- `[ -f src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.phase29.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.test.tsx ]` → FOUND
- `[ -f src/ui/api/claude-session-api.ts ]` → FOUND
- Commit hashes in git log:
  - `562ec83` test(30-03): rewrite resolve-phase tests for Phase-30 truth table → FOUND
  - `4df2e59` feat(30-03): rewrite resolve-phase.ts with Phase-30 LOCKED truth table → FOUND
  - `569cfcc` test(30-03): rewrite usePaneResolvingMachine tests for trivial hook → FOUND
  - `277deb2` feat(30-03): reduce usePaneResolvingMachine to trivial 2-input derivation → FOUND
  - `3ad334b` feat(30-03): rewire PrettyView.tsx to backend-authoritative pane_state → FOUND
- `npx vitest run` (full suite) → 142 files, 1813 passed, 0 failures (green)
- Full acceptance grep gates satisfied (all zero counts on captureFirstFrame, backendFirstFrame, phase-29 zombie comments, rearmSnapshotRef, showResolvingSpinner/requestRetry/handleRetry — see PrettyView.phase29.test.tsx Group 1 for machine-executable versions)

## TDD Gate Compliance

Tasks 1 and 2 followed strict RED/GREEN cycle:
- Task 1 RED: `test(30-03): rewrite resolve-phase tests for Phase-30 truth table` (562ec83) — tests fail on `resolveRenderedState is not a function`
- Task 1 GREEN: `feat(30-03): rewrite resolve-phase.ts with Phase-30 LOCKED truth table` (4df2e59) — all 45 tests pass, tsc clean for the pure reducer
- Task 2 RED: `test(30-03): rewrite usePaneResolvingMachine tests for trivial hook` (569cfcc) — tests fail on wrong deps shape
- Task 2 GREEN: `feat(30-03): reduce usePaneResolvingMachine to trivial 2-input derivation` (277deb2) — all 7 tests pass

Task 3 was `tdd="false"` per the plan frontmatter (`type="auto"` without `tdd="true"`) — verification via the full pretty-view + full frontend suite still passing (regression coverage over the ~14 captureFirstFrame deletions, patch #381 cleanup, overlay mount gate flips, and legacy WS handler rewrites) rather than a separate RED gate on the atomic PrettyView.tsx rewrite. Grep-level acceptance gates are captured as vitest assertions in `PrettyView.phase29.test.tsx` Group 1 so future regressions pin exact file+identifier.
