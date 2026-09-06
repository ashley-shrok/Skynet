---
phase: 76-optimistic-bubbles-must-survive-the-wait-when-the-agent-was-
plan: 01
subsystem: pretty-view
tags:
  - dormancy
  - optimistic-bubbles
  - signal-unification
  - phase-62-followup
  - pretty-view
dependency_graph:
  requires:
    - src/backend/claude-session/pv-send-watchdog.ts (MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS_DORMANT — D-05 sizing coupling)
    - src/ui/features/pretty-view/PrettyView.tsx dormantRef (mirror useEffect L2555-2560)
    - src/ui/features/pretty-view/PrettyView.tsx handleOptimisticSend arm site (L1233 — unchanged)
    - Phase 62 Plan 01 (PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000 — reused verbatim)
  provides:
    - Unified dormancy signal: pane_state handler now calls setDormant — dormantRef authoritative from both Signal A and Signal B
    - Test 5c — reconnect-mid-dormancy hydration via Signal B (pane_state:dormant only, no Signal A)
    - D-04 symmetric-surface inventory verified in-commit
    - D-05 backend-constant verification (no drift found)
  affects:
    - src/ui/features/pretty-view/PrettyView.tsx (+39 lines in case "pane_state" block)
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (+107 lines, new Test 5c)
tech_stack:
  added: []
  patterns:
    - "Option (a) signal unification: setDormant called from BOTH case 'dormant' (Signal A) AND case 'pane_state' (Signal B) — strictly additive, zero consumer migration"
    - "ARM-TIME ref read preserved byte-for-byte (dormantRef.current at handleOptimisticSend:1233)"
    - "TDD RED-then-GREEN: test commit 56926ebc before implementation commit 10aa8e10"
    - "Reconnect-mid-dormancy test pattern: ws1 close + vi.advanceTimersByTime(2001) to fire reconnect backoff + ws2 Signal-B-only delivery"
key_files:
  created: []
  modified:
    - path: src/ui/features/pretty-view/PrettyView.tsx
      lines: "~1786-1826 (case 'pane_state' block — added setDormant mirror logic)"
    - path: src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
      lines: "447-553 (Test 5c — reconnect-mid-dormancy scenario)"
decisions:
  - "D-01: Two dormancy signals reconciled by feeding setDormant from BOTH case 'dormant' (Signal A) and case 'pane_state' (Signal B) — dormantRef is now the authoritative unified source"
  - "D-02: Option (a) chosen — strictly additive, zero consumer migration needed; dormantRef stays as single authoritative ref"
  - "D-03: Arm-site read semantic preserved byte-for-byte at PrettyView.tsx:1233"
  - "D-04: Symmetric-surface inventory verified — all 9 entries confirmed with option-(a) dispositions; no consumer left behind"
  - "D-05: Backend constants verified — MARKER_FALLBACK_MS_MIRROR=90_000 and GIVE_UP_MS_DORMANT=120_000 confirmed; no drift; PENDING_SEND_TIMEOUT_MS_DORMANT=220_000 unchanged"
  - "D-08: Awake case unchanged — PENDING_SEND_TIMEOUT_MS_NORMAL=20_000 intact; Test 5 (awake 20s flip) still passes"
  - "pane_state:error deliberately NOT handled — error is WS-transport state, not dormancy assertion (Risk 2 rationale)"
metrics:
  duration_min: 47
  completed_date: "2026-09-06"
  tasks_completed: 2
  files_modified: 2
  commits: 2
  tests_added: 1
requirements:
  - D-01
  - D-02
  - D-03
  - D-04
  - D-05
  - D-08
---

# Phase 76 Plan 01: Signal Unification Summary

**One-liner:** Feed `setDormant` from both `case "dormant"` (Signal A) and `case "pane_state"` (Signal B) so `dormantRef.current` stays authoritative after WS reconnect while dormant — fixes the reconnect-mid-dormancy race Phase 62 deferred.

## What Shipped

### Task 1: RED — Test 5c (commit `56926ebc`)

Added Test 5c immediately after Test 5b in `PrettyView.optimistic-bubbles.test.tsx` (lines 447-553). Test exercises the exact Phase 62 miss scenario:

1. Mount PrettyView; get ws1; establish initial dormancy via BOTH Signal A (`{type:"dormant", dormant:true}`) and Signal B (`{type:"pane_state", state:"dormant"}`)
2. Simulate WS close (`ws1.readyState = 3; ws1.onclose?.()`) + `vi.advanceTimersByTime(2001)` to fire the reconnect backoff setTimeout
3. Get ws2 (fresh WS stub pushed by mock); call `flipToStreaming(ws2)`
4. Deliver ONLY `{type:"pane_state", state:"dormant"}` on ws2 — NO `{type:"dormant"}` re-emit (the race)
5. `typeAndEnter(container, "reconnect-dormant-send-payload")`
6. At T+20001ms: assert `[data-pv-bubble-failed]` is null (220s branch must be armed)
7. At T+220001ms: assert `[data-pv-bubble-failed]` is non-null (widened ceiling fires)

**RED evidence** (from `/tmp/76-01-task1-red.log`):
- Test fails at step 6 assertion: `expected <div data-pv-bubble-failed="true"> to be null`
- Diagnostic log: `dormant=false timeoutMs=20000 arm_reason=client_timeout_20s_normal`
- Confirms: dormantRef.current was false on ws2 when Signal A absent

PrettyView.tsx: zero diff in this commit.

### Task 2: GREEN — setDormant from pane_state handler (commit `10aa8e10`)

In `case "pane_state"` block at PrettyView.tsx:1786+, after `setPaneState(parsed.state)`, added:

```typescript
// Phase 76 Plan 01 — D-01/D-02 signal unification (option a):
// [full explanatory comment referencing D-01, D-02, D-04, root cause]
if (parsed.state === "dormant") {
  console.info(`[diag-dormant-send] pane-state-drove-dormant state=${parsed.state} ...`);
  setDormant(true);
} else if (
  parsed.state === "active" ||
  parsed.state === "holding" ||
  parsed.state === "inactive"
) {
  setDormant(false);
}
// pane_state === "error" — leave dormant unchanged (Risk 2).
```

All other files unchanged: `case "dormant"` at L2147, `handleOptimisticSend` arm site at L1233, `dormantRef` mirror useEffect at L2555-2560, `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000`, `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000`.

## D-04 Symmetric-Surface Inventory (option-a disposition)

| Surface | Line | Current signal source | Option (a) disposition | Reason no migration needed |
|---|---|---|---|---|
| `dormantRef.current` at arm site — LOAD-BEARING | PrettyView.tsx:1233 | Signal A only | AUTOMATIC — now authoritative | `dormantRef` fed from both channels; read line unchanged |
| `dormantRef.current` inside setTimeout `dormant_at_fire` log | PrettyView.tsx:1243 | Signal A only | AUTOMATIC — now authoritative | Same ref, informational-only log now correct |
| `dormantRef.current` in WS onmessage live-frame auto-dismiss gate | PrettyView.tsx:1741 | Signal A only | AUTOMATIC — now authoritative | Same ref; `setDormant(false)` inside block still correct (Risk 1 rationale) |
| `case "dormant"` handler `setDormant(parsed.dormant)` | PrettyView.tsx:2147 | Signal A write site | UNCHANGED — Signal A still writes | Kept as-is; second write path added, not replaced |
| `case "pane_state"` handler | PrettyView.tsx:1761 | Signal B write site (setPaneState only) | MODIFIED — adds setDormant call per D-02 | The change site |
| `dormantRef` mirror useEffect | PrettyView.tsx:2555-2560 | mirror of `dormant` state | UNCHANGED | Mirror mechanism intact; source of `dormant` state is now unified |
| `paneStateRef.current` D-18 transition log dedup | PrettyView.tsx:1783 | Signal B | UNCHANGED | Diagnostic-only, not dormancy-truth-dependent |
| `paneState` → `usePaneResolvingMachine` → ComposeBox mount gate | PrettyView.tsx:3457 | Signal B (via `renderedState`) | UNCHANGED | Already authoritative via Signal B; not the pending-send path |
| `paneState` → `canSend` prop | PrettyView.tsx:3487-3489 | Signal B (via `renderedState`) | UNCHANGED | Already authoritative via Signal B; not the pending-send path |

## D-05 Backend-Constant Verification

Verified `src/backend/claude-session/pv-send-watchdog.ts` lines 83-100:
- `MARKER_FALLBACK_MS_MIRROR = 90_000` — confirmed
- `GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000 = 90_000 + 20_000 + 10_000 = 120_000` — confirmed

PrettyView.tsx header comment (L120-138) correctly states:
- `MARKER_FALLBACK_MS_MIRROR (90_000ms) + GIVE_UP_MS_DORMANT (120_000ms) = 210_000ms + 10s margin = 220_000ms`

**No drift found.** Header comment is accurate. `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` unchanged (D-05 shape decision).

## TDD Evidence

- RED log at `/tmp/76-01-task1-red.log` — failure at `expect(container.querySelector("[data-pv-bubble-failed]")).toBeNull()` at T+20001ms; `dormant=false timeoutMs=20000` confirms wrong branch
- GREEN: `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — 21/21 pass
- Test 5c: PASS (reconnnect-mid-dormancy 220s branch now armed)
- Test 5 (awake 20s flip): PASS — D-08 unchanged
- Test 5b (Signal A path): PASS — Signal A write site preserved

## Test Count Delta

Before: 21 tests in `PrettyView.optimistic-bubbles.test.tsx`
After: 21 tests (Test 5c added; numbering from 1/2/3/3b/3c/4/5/5b/5c/6/7/8/9/10/11/12/12b/14/15/16/17 = 21 total, no Test 13)

## Files Touched with Line Ranges

| File | Lines | Change |
|------|-------|--------|
| `src/ui/features/pretty-view/PrettyView.tsx` | 1786-1826 | Added setDormant mirror logic inside case "pane_state" block (+39 lines) |
| `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` | 447-553 | Added Test 5c reconnect-mid-dormancy scenario (+107 lines) |

## Commit History (TDD RED-then-GREEN)

1. `56926ebc` — `test(76-01): RED — add Test 5c reconnect-mid-dormancy for signal unification`
2. `10aa8e10` — `feat(76-01): GREEN — feed setDormant from pane_state handler (option a) — signal unification per D-01/D-02, closes reconnect-mid-dormancy race deferred by Phase 62`

## Deviations from Plan

None — plan executed exactly as written. Option (a) was the recommended derivation approach; it was implemented as specified. The reconnect test pattern required `vi.advanceTimersByTime(2001)` after `ws1.onclose?.()` to fire the PrettyView reconnect backoff setTimeout (which uses real setTimeout with 0–2000ms full-jitter delay). This was anticipated by the plan's IMPORTANT note: "if the reconnect path does NOT auto-push a new ws, inspect Test 12 pattern and the openClaudeSessionSocket factory." The solution followed from understanding that fake timers require explicit advancement to fire reconnect timers.

## Known Stubs

None — no stubs in files created or modified by this plan.

## Threat Flags

No new threat surface introduced. The `case "pane_state"` handler was already a trusted boundary (backend JSON-parsed frames). The added `setDormant` call branches only on the five already-narrowed `parsed.state` constants. No new attacker-controlled state. Matches STRIDE analysis T-76-01-01 and T-76-01-02 dispositions in plan threat model.

## Self-Check

PASSED — see below.
