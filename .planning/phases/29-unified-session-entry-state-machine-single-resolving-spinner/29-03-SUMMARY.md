---
phase: 29
plan: 03
subsystem: ui/pretty-view
tags:
  - phase-29
  - state-machine
  - hook
  - usePaneResolvingMachine
dependency_graph:
  requires:
    - "src/ui/features/pretty-view/resolve-phase.ts (plan 29-01) — pure resolvePhase reducer + WsState/BackendFirstFrame/Phase type unions"
  provides:
    - "src/ui/features/pretty-view/usePaneResolvingMachine.ts exports { usePaneResolvingMachine, UsePaneResolvingMachineDeps, UsePaneResolvingMachineResult }"
  affects:
    - "unblocks plan 29-04 (PrettyView rewire consumes usePaneResolvingMachine as the single source of truth for phase + showSpinner + requestRetry)"
    - "structural-grep anchors 'phase-29: usePaneResolvingMachine — single authoritative pane-entry state machine' + 'phase-29: resolution inputs — wsState + backendFirstFrame ONLY' + 'phase-29: spinner delay-arm (D-04, D-05, D-06) — 150ms; ONLY setTimeout in this file' become the load-bearing anchors for plan 29-04's grep gates"
tech-stack:
  added: []
  patterns:
    - "Composite hook composing 4 sub-patterns from PATTERNS.md §2 (ref-mirror, prevIsVisibleRef edge detector, paneKey sentinel, delay-arm useEffect)"
    - "Input-snapshot gate on the resolution detector (rearmSnapshotRef) — makes entry-triggers observably surface phase='resolving' even when caller-provided inputs are already settled, matching D-10 semantic (only inputs advancing past the snapshot fire the resolve transition)"
    - "TypeScript exhaustive input axes via string-literal unions imported from the pure reducer"
key-files:
  created:
    - "src/ui/features/pretty-view/usePaneResolvingMachine.ts"
    - "src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx"
  modified: []
decisions:
  - "File location: src/ui/features/pretty-view/usePaneResolvingMachine.ts (co-located with PrettyView.tsx + resolve-phase.ts) — planner's Claude's-Discretion pick per plan 29-03 objective"
  - "Anti-flash delay: 150ms (planner default per D-06; UAT will lock a final value in 100-200ms range without changing the hook shape)"
  - "Failed-permanently derivation deferred to plan 29-04 caller — the hook takes wsState as a controlled input parameter, making it testable without WS mocking"
  - "Added rearmSnapshotRef mechanism to the plan's original design: entry-triggers snapshot inputs when re-arming a previously-resolved pane, and the resolution detector requires input divergence from that snapshot before firing the resolve transition. This is a Rule 1 fix (observable behavior did not match plan tests without it — see Deviations)"
  - "Added wsStateRef + backendFirstFrameRef ref-mirrors so the mount-once visibilitychange handler and requestRetry callback can snapshot current inputs without stale-closure hazards (PATTERNS.md §2a application)"
requirements_addressed:
  - PHASE29-REQ-01
  - PHASE29-REQ-03
  - PHASE29-REQ-05 (partial — single setTimeout invariant)
metrics:
  duration: "~12 minutes"
  completed_date: "2026-08-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 29 Plan 03: usePaneResolvingMachine hook Summary

**One-liner:** Created the single authoritative pane-entry state machine hook `usePaneResolvingMachine` that consumes exactly two resolution inputs (wsState + backendFirstFrame), threads all three entry-trigger edges (cold mount, warm hidden→visible re-focus, PWA foreground) into ONE shared re-arm code path, delay-arms the spinner at 150ms, and enforces the two-mode "initial-resolving vs post-resolve steady state" semantic from D-10/D-11/D-12 — with a rearmSnapshotRef mechanism (added as a Rule 1 fix) that makes the three entry-triggers observably surface phase='resolving' even when caller-provided inputs are already settled.

## What Was Built

### Files Created

**`src/ui/features/pretty-view/usePaneResolvingMachine.ts`** (361 lines)

- Anchor comment: `// phase-29: usePaneResolvingMachine — single authoritative pane-entry state machine (SPEC req 1, 3)`
- Multi-paragraph rationale header (~90 lines) covering: WHY (Ashley's flicker diagnosis + racing overlays), WHAT it replaces (~6 local useStates in PrettyView), TWO-MODE SEMANTIC (initial-resolving vs post-resolve steady state per D-10/D-11/D-12), SETTIMEOUT INVARIANT (exactly one — the 150ms delay-arm — per SPEC req 5), and NO WS SUBSCRIPTIONS (controlled inputs via parameters — makes the hook testable without WS mocking).
- Three exported symbols:
  - `interface UsePaneResolvingMachineDeps { hostId, tmuxSession, isVisible, wsState, backendFirstFrame }` (5 fields — no third resolution axis; SPEC req 3)
  - `interface UsePaneResolvingMachineResult { wsState, backendFirstFrame, phase, showSpinner, requestRetry }`
  - `function usePaneResolvingMachine(deps): UsePaneResolvingMachineResult`
- Inline anchor comment directly above the deps interface: `// phase-29: resolution inputs — wsState + backendFirstFrame ONLY (SPEC req 3; no third axis)`
- Delay-arm setTimeout line tagged: `// phase-29: spinner delay-arm (D-04, D-05, D-06) — 150ms; ONLY setTimeout in this file`

**`src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx`** (500 lines)

- Anchor comment: `// phase-29: usePaneResolvingMachine hook behavior tests + structural grep gates`
- 7 describe blocks × 16 total tests (all passing):
  1. Initial mount + spinner delay-arm — 3 tests (initial state, delay-arm at 150ms, instant-resolution never mounts spinner)
  2. Cold-mount entry trigger — 2 tests (hostId change, tmuxSession change)
  3. Warm re-focus entry trigger — 2 tests (isVisible false→true edge, initial-mount no spurious re-arm)
  4. PWA foreground entry trigger — 2 tests (visible-pane path, hidden-pane no re-arm)
  5. Post-resolve steady state — 2 tests (input flip transitions directly, wsState regression D-10 subtlety)
  6. requestRetry callback (D-09) — 2 tests (retry from error, no wall-clock deadline)
  7. Structural grep gates (SPEC req 5) — 3 tests (setTimeout count = 1, no setInterval/requestIdleCallback, resolution-input anchor present)
- Harness: `renderHook` + `act` from `@testing-library/react`; `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`; no WS mocking (hook takes controlled inputs).

### Exact Interface Shapes

**Deps** (SPEC req 3 — exactly 5 fields, exactly 2 of which are resolution inputs):

```typescript
export interface UsePaneResolvingMachineDeps {
  hostId: number | null;
  tmuxSession: string | null;
  isVisible: boolean;              // entry trigger, NOT a resolution input
  wsState: WsState;                 // resolution input #1
  backendFirstFrame: BackendFirstFrame;  // resolution input #2
}
```

**Result** (5 fields):

```typescript
export interface UsePaneResolvingMachineResult {
  wsState: WsState;
  backendFirstFrame: BackendFirstFrame;
  phase: Phase;                     // "resolving" | "active" | "holding" | "dormant" | "inactive" | "error"
  showSpinner: boolean;             // false initially; true 150ms after phase="resolving"; false immediately when phase leaves "resolving"
  requestRetry: () => void;         // D-09 user-gesture retry callback
}
```

### PATTERNS.md §2 Sub-Patterns Composed

The hook composes four sub-patterns from PATTERNS.md §2:

| Sub-pattern | Where it's applied |
|---|---|
| (a) Ref-mirror for stale-closure protection | `isVisibleRef` (mount-once visibilitychange handler); `wsStateRef` + `backendFirstFrameRef` (needed by mount-once visibilitychange handler + requestRetry callback to snapshot inputs) |
| (b) prevIsVisibleRef edge detector | `useRef<boolean>(isVisible)` initialization is load-bearing — prevents spurious false-positive on initial mount with isVisible=true |
| (c) paneKey sentinel | `paneKeyRef` tracks the current pane; a diff on `${hostId}:${tmuxSession ?? ""}` fires the cold-mount entry trigger |
| (d) Delay-arm useEffect (patch #74 template) | Exact shape copied from PrettyView.tsx L1416-1436, retargeted from `isHolding` → `phase === "resolving"` and from 350ms → 150ms |

### Interaction of the Sub-Patterns

All three entry triggers (cold-mount effect on `[paneKey]`, warm re-focus effect on `[isVisible]`, PWA foreground handler with `[]` deps) converge on the exact same three-line code path:

```typescript
if (hasResolvedThisPaneRef.current) {
  rearmSnapshotRef.current = { wsState, backendFirstFrame };
}
hasResolvedThisPaneRef.current = false;
setIsResolving(true);
```

`requestRetry` (D-09) uses the same shape — this is the SPEC req 1 "one shared code path" invariant. Plan 29-04's grep gate on this pattern verifies it.

The delay-arm effect on `[phase]` is independent of the entry triggers — it only cares about whether phase is currently "resolving". When phase leaves "resolving" (either because the resolution detector fired, or because inputs regressed to "opening" post-resolve and resolvePhase returned "resolving" and then flipped back), the cleanup fires and clears the pending timer BEFORE the setTimeout callback fires. Genuinely-instant resolutions never mount the spinner.

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (no errors mentioning usePaneResolvingMachine.ts) |
| `npx vitest run src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx` | 16 passed / 0 failed / 0 skipped |
| Full frontend suite (`npx vitest run`) | 1746 passed / 7 skipped / 0 failed (+16 from this plan; prior baseline after plan 29-02: 1730 passed) |
| `grep -c "setTimeout(" src/ui/features/pretty-view/usePaneResolvingMachine.ts` | 1 (the delay-arm only) |
| `grep -c "setInterval\|requestIdleCallback" src/ui/features/pretty-view/usePaneResolvingMachine.ts` | 0 |
| `grep -c "phase-29:" src/ui/features/pretty-view/usePaneResolvingMachine.ts` | 3 (header anchor + resolution-inputs anchor + delay-arm anchor) |
| `grep -c "^export " src/ui/features/pretty-view/usePaneResolvingMachine.ts` | 3 (2 interfaces + 1 function) |
| Number of `describe(` blocks in the test file | 7 |
| Number of `it(` blocks in the test file | 16 |

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `502f4fb` | feat(29-03): add usePaneResolvingMachine state-machine hook |
| 1 (fix) | `1ff5717` | fix(29-03): gate resolution detector on input-change post-rearm (D-10 observability) |
| 2 | `bd38613` | test(29-03): add behavior tests for usePaneResolvingMachine hook |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Resolution detector fired synchronously in the same act() batch as re-arm setState, hiding the observable "resolving" phase on entry-triggers with pre-settled inputs**

- **Found during:** Task 2 (first test-run — 5 of 16 tests failed on the entry-trigger observability assertions and requestRetry)
- **Issue:** The plan's original design ran the resolution detector on `[isResolving, derivedTerminalPhase]`. When any entry trigger fired (`setIsResolving(true)`) with already-settled inputs (e.g. wsState="open" + backendFirstFrame="active"), the resolution detector immediately fired in the same effect flush inside `act()` and re-flipped `isResolving` to false. The observable phase never surfaced as "resolving" — the test could never assert `expect(result.current.phase).toBe("resolving")` after a cold-mount rerender with settled inputs. In production this masked itself because entry-triggers ARE followed by real WS close+reopen cycles that flip inputs through "opening"/"not-yet" transients, but the design was still fragile and the tests (per plan's explicit acceptance criteria) exercised the isolated entry-trigger mechanism.
- **Fix:** Added a `rearmSnapshotRef: { wsState, backendFirstFrame } | null` that captures inputs at the moment of re-arm on an already-resolved pane. The resolution detector now requires either (a) no snapshot present (initial mount OR post-resolve requestRetry with no snapshot) OR (b) current inputs differ from the snapshot AND derivedTerminalPhase !== "resolving". Snapshot is cleared on successful resolution. Also added `wsStateRef` + `backendFirstFrameRef` ref-mirrors so the mount-once visibilitychange handler and requestRetry callback can capture snapshots without stale-closure hazards (canonical PATTERNS.md §2a application).
- **Files modified:** `src/ui/features/pretty-view/usePaneResolvingMachine.ts`
- **Commit:** `1ff5717`
- **Invariants preserved:** setTimeout count still exactly 1 (the 150ms delay-arm); zero setInterval/requestIdleCallback; three anchor comments intact; all shared-code-path invariants preserved (each entry trigger still does `hasResolvedThisPaneRef.current = false; setIsResolving(true);` — the snapshot capture is a strict addition, not a substitution).

### Notes on the D-10 Subtlety

The plan's Task 2 explicitly called out a subtle case: "post-resolve WS drop returns to resolving via resolvePhase". Test 5.2 exercises this: after resolution, if wsState regresses to "opening", `resolvePhase()` deterministically returns "resolving" and `phase` visibly transitions back to "resolving" — but `hasResolvedThisPaneRef` stays true and the machine does NOT re-arm its internal resolving-mode flag. The observable effect is that when WS recovers and the backend re-emits "active", the phase swaps directly back to "active" without going through the internal re-arm cycle. This is the D-10 spec ("only the three named entry triggers can re-arm resolving") interpreted correctly: it governs the internal machine state, not the visible-phase derivation.

The test asserts this exact sequence and includes an inline comment explaining the semantic for future readers.

### No Design Revision Required

Plan output spec item (e) — "call it out if the 'post-resolve WS drop returns to resolving via resolvePhase' behavior turned out to require design revision" — did NOT trip. The `hasResolvedThisPaneRef` sentinel + the resolvePhase pure reducer together satisfy the D-10 semantic without any design change to the pure reducer.

### No Deviations from Claude's-Discretion Picks

- File location: `src/ui/features/pretty-view/usePaneResolvingMachine.ts` — chosen per plan objective.
- Anti-flash delay: 150ms — chosen per plan default; no adjustment during implementation.
- Failed-permanently derivation: deferred to plan 29-04 caller (hook takes wsState as a controlled input parameter) — chosen per plan objective; no adjustment.

## Threat Flags

None. This plan introduces no new attack surface beyond what was enumerated in the plan's threat register:

- T-29-03-01 (DoS via delay-arm timer leak): Mitigated by the effect cleanup (`return () => clearTimeout(t);`). Verified by test 1.3 ("instant resolution before 150ms elapses never mounts spinner") which exercises the cleanup path.
- T-29-03-02 (Tampering — third resolution axis added silently): Mitigated by the structural-grep gate test in describe block 7 ("hook source lists exactly wsState and backendFirstFrame as resolution inputs") anchored on the planted comment tag.
- T-29-03-03 (Tampering — wall-clock watchdog added post-refactor): Mitigated by the structural-grep gate test in describe block 7 ("hook source contains exactly one setTimeout call") — adding any additional timer fails the count assertion.
- T-29-03-04 (Information disclosure — hook state): Accepted; hook state is per-pane React local state, not persisted or globally accessible.

## Known Stubs

None. The hook is fully wired end-to-end within its remit (a controlled-input state machine). Plan 29-04 will wire the actual WS-derived `wsState` and backend-derived `backendFirstFrame` inputs at the PrettyView site.

## Next Plan

Plan **29-04** — PrettyView rewire. Consumes this hook as `const { phase, showSpinner, requestRetry } = usePaneResolvingMachine({ hostId, tmuxSession, isVisible, wsState, backendFirstFrame });`, derives `wsState` from the existing WS retry-ladder state, derives `backendFirstFrame` from the first backend frame observation, retires the ~6 local useStates listed in CONTEXT.md canonical_refs, deletes the 600000ms holding-timeout watchdog + the 10s loading-overlay auto-dismiss, and rewires all overlay mount gates to `phase === "<terminal-value>"` per SPEC req 6. Structural grep gates in that plan reference the three anchor comments planted in this plan's hook file.

## Self-Check: PASSED

- Files created:
  - `src/ui/features/pretty-view/usePaneResolvingMachine.ts` — FOUND
  - `src/ui/features/pretty-view/usePaneResolvingMachine.test.tsx` — FOUND
- Commits:
  - `502f4fb` (feat 29-03 hook) — FOUND in git log
  - `1ff5717` (fix 29-03 resolution detector) — FOUND in git log
  - `bd38613` (test 29-03 behavior + grep gates) — FOUND in git log
- Full frontend suite: 1746 passed / 7 skipped / 0 failed
- `npx tsc --noEmit`: exit 0
- All plan-level verification greps returned expected counts
- Anchor comments intact (3): main header, resolution-inputs, delay-arm
