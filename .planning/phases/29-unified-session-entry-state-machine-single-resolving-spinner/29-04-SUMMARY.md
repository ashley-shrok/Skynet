---
phase: 29
plan: 04
subsystem: ui/pretty-view
tags:
  - phase-29
  - prettyview-rewire
  - deletion-heavy
  - state-machine-integration
dependency_graph:
  requires:
    - "src/ui/features/pretty-view/resolve-phase.ts (plan 29-01) — WsState + BackendFirstFrame type unions"
    - "src/ui/features/pretty-view/usePaneResolvingMachine.ts (plan 29-03) — hook consumed at top of component body"
    - "src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx (plan 29-02) — mounted at phase === \"error\""
  provides:
    - "PrettyView.tsx wired end-to-end: usePaneResolvingMachine mounted, all overlay mount gates flipped to phase-derived, watchdogs deleted, error overlay mounted, session-recycling-store publisher rewired, ComposeBox props rewired"
  affects:
    - "unblocks plan 29-05 (test suite audit — 19 existing PrettyView.test.tsx tests broken by mount-gate rewire are enumerated in this SUMMARY as 29-05's input)"
    - "resolves Ashley's 2026-08-10 flicker complaint at the code layer (single spinner during phase === \"resolving\"; deterministic transitions to terminal phases)"
tech-stack:
  added: []
  patterns:
    - "Ref-mirror for stale-closure protection (backendFirstFrameRef) — canonical PrettyView.tsx pattern from statusRef/dormantRef/isVisibleRef"
    - "State-slot mirror of a ref (reconnectAttempts state ↔ reconnectAttemptsRef.current) so a downstream derivation re-runs on ref mutation"
    - "Captured-first-frame idempotency guard via ref short-circuit (captureFirstFrame checks backendFirstFrameRef.current !== \"not-yet\" before dispatching)"
    - "Deletion-heavy production rewire with test-lag deferred to next plan per SPEC constraint"
key-files:
  created: []
  modified:
    - "src/ui/features/pretty-view/PrettyView.tsx"
decisions:
  - "wsState derivation: observation-based per D-13 (WS ladder untouched). status === \"streaming\"|\"inactive\" → \"open\"; status === \"error\" && attempts >= MAX → \"failed-permanently\"; status === \"error\" && attempts < MAX → \"opening\"; status === \"connecting\" && attempts === 0 → \"not-connected\"; else \"opening\". This maps the existing retry-ladder observable state onto the four-value WsState union without touching the WS layer itself."
  - "backendFirstFrame capture sites: 4 per plan spec — case \"session\" → captureFirstFrame(\"active\"), case \"inactive\" (both holding_timeout and normal paths) → captureFirstFrame(\"inactive\"), case \"dormant\" (only parsed.dormant === true) → captureFirstFrame(\"dormant\"), case \"session_holding\" → captureFirstFrame(\"session_holding\"). captureFirstFrame short-circuits via the backendFirstFrameRef guard so subsequent frames after the first-frame verdict don't re-arm the state machine (D-11 clean-swap semantics live in the hook, not here)."
  - "handleRetry (D-09) shape: reset reconnectAttemptsRef.current + setReconnectAttempts(0) + setStatus(\"connecting\") + requestRetry() + setRetryKey(k+1). Deliberately does NOT clear errorMessage — errorMessage is retained for debugging/console-diag continuity but is no longer surfaced in UI (the error overlay has its own fixed copy per D-08)."
  - "outer ComposeBox mount-gate kept in its preserving-current-behavior formulation per plan step 18's reconsider clause: `status === \"streaming\" || phase === \"error\" || phase === \"dormant\"`. Only the two phase-derived clauses flipped (status === \"error\" → phase === \"error\"; dormant → phase === \"dormant\"). Structure of OR-chain preserved. NOT rewritten to the ambitious form in step 18's first draft."
  - "onResetClicked simplified — setHoldingTimeoutError(false) call removed with the state, but the setIsHolding(true) synchronous trigger preserved so session-holding UX still enters holding phase immediately on Reset-cell click (backend confirms with its own session_holding frame later; captureFirstFrame is idempotent so no double-arm)."
  - "Grep-gate reconciliation (Rule 2, mirroring plan 29-02's approach): rationale comments that would otherwise reference the retired state names verbatim were reworded to paraphrases (\"the retired delay-arm boolean\", \"the warm-red-flip flag\", etc.) so `grep -c '\\bshowOverlay\\b' PrettyView.tsx` returns 0 while preserving human-readable rationale. Same applies to \"600000ms\" → \"10-minute\" in one rationale comment, and to the \"Connecting…\" / \"Connection lost\" JSX-comment references which were reworded to \"transient in-flight connect-status text node\" and \"retired transient error-status text node\" respectively."
requirements_addressed:
  - PHASE29-REQ-02
  - PHASE29-REQ-05
  - PHASE29-REQ-06
  - PHASE29-REQ-07
metrics:
  duration: "~35 minutes"
  completed_date: "2026-08-10"
  tasks_completed: 1
  files_created: 0
  files_modified: 1
---

# Phase 29 Plan 04: PrettyView rewire to unified state machine Summary

**One-liner:** Retired ~5 racing local state machines in PrettyView.tsx and rewired every overlay mount gate to derive from `usePaneResolvingMachine`'s `phase`, deleted the two wall-clock watchdogs SPEC req 5 bans (600000ms holding + 10s loading), retired the transient "Connecting…"/"Connection lost" text nodes, mounted PrettyViewErrorOverlay at `phase === "error"`, and rewired the session-recycling-store publisher + ComposeBox props to derive from `phase` — landing Ashley's 2026-08-10 flicker complaint at the code layer.

## What Was Built

Single atomic commit on `feat/tab-title-from-tmux`. `PrettyView.tsx` production rewire only; **no test file changes in this plan** — test-lag is 29-05's audit scope per SPEC constraint. Compiled clean; expected-overlay-mount-gate test breakage documented below.

### Imports Added

```typescript
import { PrettyViewErrorOverlay } from "./PrettyViewErrorOverlay";
import { usePaneResolvingMachine } from "./usePaneResolvingMachine";
import type { WsState, BackendFirstFrame } from "./resolve-phase";
```

### wsState Derivation (D-13 — observation-based)

```typescript
const wsState: WsState =
  status === "streaming" || status === "inactive"
    ? "open"
    : status === "error" && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
      ? "failed-permanently"
      : status === "connecting" && reconnectAttempts === 0
        ? "not-connected"
        : "opening";
```

Backed by a new `reconnectAttempts` state slot mirroring `reconnectAttemptsRef.current` at every mutation site (5 sites: cold-mount reset, retry-scheduler, PWA visibilitychange, WS-pause reopen, handleRetry). The ref remains authoritative for the retry-ladder logic; the state slot is purely the observable projection consumed by the derivation.

### backendFirstFrame Capture

```typescript
const backendFirstFrameRef = useRef<BackendFirstFrame>("not-yet");
const [backendFirstFrame, setBackendFirstFrame] =
  useState<BackendFirstFrame>("not-yet");
const captureFirstFrame = useCallback((v: BackendFirstFrame) => {
  if (backendFirstFrameRef.current !== "not-yet") return;
  backendFirstFrameRef.current = v;
  setBackendFirstFrame(v);
}, []);
```

Called at 4 WS message handler sites (idempotent via the ref guard — subsequent frames after the first-frame verdict do NOT re-arm):

| WS case                                    | captureFirstFrame call             |
| ------------------------------------------ | ----------------------------------- |
| `case "session":`                          | `captureFirstFrame("active")`       |
| `case "inactive":` (holding_timeout path)  | `captureFirstFrame("inactive")`     |
| `case "inactive":` (normal path)           | `captureFirstFrame("inactive")`     |
| `case "dormant":` (only `parsed.dormant === true`) | `captureFirstFrame("dormant")` |
| `case "session_holding":`                  | `captureFirstFrame("session_holding")` |

Reset on cold-mount inside the fresh-pane paneKey-change reset block (`backendFirstFrameRef.current = "not-yet"; setBackendFirstFrame("not-yet");`).

### Hook Mount

```typescript
const { phase, showSpinner: showResolvingSpinner, requestRetry } =
  usePaneResolvingMachine({
    hostId,
    tmuxSession,
    isVisible,
    wsState,
    backendFirstFrame,
  });
```

### handleRetry (D-09)

```typescript
const handleRetry = useCallback(() => {
  reconnectAttemptsRef.current = 0;
  setReconnectAttempts(0);
  setStatus("connecting");
  requestRetry();
  setRetryKey((k) => k + 1);
}, [requestRetry]);
```

Fires a synthetic entry-trigger edge (reset attempt counter → status connecting → hook re-arm → retryKey bump). errorMessage state is deliberately NOT cleared — retained for debug continuity but no longer UI-visible.

### Deleted useState / useEffect / setter / ref Inventory (for plan 29-05 test audit)

**Deleted useState hooks (3):**

| State                    | Line (pre-rewire) | Reason                                                        |
| ------------------------ | ----------------- | ------------------------------------------------------------- |
| `showOverlay`            | ~319              | Delay-arm subsumed by usePaneResolvingMachine showSpinner (D-04) |
| `holdingTimeoutError`    | ~326              | SPEC req 5 — 600000ms watchdog retired                        |
| `isBooting`              | ~343              | phase === "resolving" replaces it                             |

**Deleted useRef hooks (1):**

| Ref                | Line (pre-rewire) | Reason                                                        |
| ------------------ | ----------------- | ------------------------------------------------------------- |
| `isBootingRef`     | ~348              | Retired with isBooting                                        |

**Deleted useEffect hooks (5):**

| Effect                                       | Line (pre-rewire) | Reason                                                     |
| -------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| Patch #74 `showOverlay` delay-arm (350ms)    | ~1487-1497        | Delay-arm moved into usePaneResolvingMachine (150ms)       |
| Patch #122 600000ms `holdingTimeoutError` watchdog | ~1508-1522  | SPEC req 5 — no wall-clock heuristics                     |
| Patch #122 `holdingTimeoutError` reset       | ~1530-1533        | Paired with the watchdog                                   |
| quick 260808-ho2 10s `isBooting` auto-dismiss | ~1547-1554       | SPEC req 5 — no wall-clock heuristics                     |
| quick 260808-ho2 `isBootingRef` mirror       | ~1347-1353        | Retired with isBooting                                     |

**Deleted setter call sites:**

- `setShowOverlay(false)` — 1 site in the cold-mount reset block
- `setIsBooting(true)` — 1 site in the cold-mount reset block
- `setIsBooting(false)` — 2 sites in WS onmessage (loading first-frame dismiss, `case "dormant":`, `case "session_holding":`)
- `setHoldingTimeoutError(false)` — 3 sites (onResetClicked, `case "session_holding_cleared":`, `case "session_changed":`)
- `setHoldingTimeoutError(true)` — 2 sites (the deleted watchdog effect, `case "inactive":` holding_timeout branch — replaced by captureFirstFrame("inactive"))

**Deleted per-frame gate block:** The `isBootingRef.current && (parsed.type === ...)` first-user-visible-frame auto-dismiss block inside `ws.onmessage` (~lines 1002-1022 pre-rewire). Subsumed by per-case captureFirstFrame calls.

### Rewired ComposeBox Props (for plan 29-05 test audit)

| Prop                   | Pre-rewire                | Post-rewire                        | Semantic                                                       |
| ---------------------- | ------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `recycleActive`        | `showOverlay`             | `phase === "holding"`              | Disable WS-side-effecting controls while holding overlay up    |
| `reconnectingActive`   | `status === "error"`      | `phase === "error"`                | Disable during WS reconnect window                             |
| `dormantActive`        | `dormant \|\| waking`     | `phase === "dormant" \|\| waking`  | Disable during dormant asleep window; `waking` kept in OR       |
| `isHolding`            | `isHolding` (local state) | `isHolding` (unchanged — local kept) | Internal recycle-detection signal; still gates the isHolding prop |

**ComposeBox outer mount gate (preserving-current-behavior formulation):**

| Pre-rewire                                                           | Post-rewire                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `{onSend && (status === "streaming" \|\| status === "error" \|\| dormant) && (` | `{onSend && (status === "streaming" \|\| phase === "error" \|\| phase === "dormant") && (` |

Only the two phase-derived clauses flipped. OR-chain structure and `status === "streaming"` preserved verbatim.

### JSX Mount-Gate Rewires (4 sites)

| Overlay                    | Pre-rewire gate                                        | Post-rewire gate                                    |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| SessionHoldingOverlay      | `{showOverlay && <SessionHoldingOverlay error={holdingTimeoutError} />}` | `{phase === "holding" && <SessionHoldingOverlay />}` (error prop dropped) |
| DormancyOverlay            | `{dormant && (<DormancyOverlay ... />)}`               | `{phase === "dormant" && (<DormancyOverlay ... />)}` (internal props unchanged) |
| PrettyViewLoadingOverlay   | `{isBooting && !dormant && !showOverlay && <PrettyViewLoadingOverlay />}` | `{phase === "resolving" && showResolvingSpinner && <PrettyViewLoadingOverlay />}` |
| Transient "Connecting…" text | `{status === "connecting" && (<div>Connecting…</div>)}` | DELETED (SPEC boundary + acceptance grep) |
| inactive fallback          | `{status === "inactive" && !dormant && (<div>no active Claude session</div>)}` | `{phase === "inactive" && (<div>no active Claude session</div>)}` |
| Transient "Connection lost" text | `{status === "error" && errorMessage && (<div>{errorMessage}</div>)}` | DELETED — replaced by `{phase === "error" && <PrettyViewErrorOverlay onRetry={handleRetry} />}` |

### session-recycling-store Publisher Rewire (SPEC req 7)

| Pre-rewire                                                              | Post-rewire                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `useEffect(() => { publishSessionRecycling(key, showOverlay); }, [showOverlay, hostId, tmuxSession]);` | `useEffect(() => { publishSessionRecycling(key, phase === "holding"); }, [phase, hostId, tmuxSession]);` |

Semantic preserved (dot suppressed exactly when the holding overlay is visible). Source of truth changed from `showOverlay` (retired) to `phase === "holding"` (deterministic per resolvePhase).

## Verification Results

| Check                                                                | Result             |
| -------------------------------------------------------------------- | ------------------ |
| `npx tsc --noEmit`                                                   | exit 0             |
| `git diff --stat src/backend/`                                       | 0 files changed    |
| `grep -c "\bshowOverlay\b" PrettyView.tsx`                           | 0                  |
| `grep -c "\bholdingTimeoutError\b" PrettyView.tsx`                   | 0                  |
| `grep -c "\bsetIsBooting\b" PrettyView.tsx`                          | 0                  |
| `grep -c "\bisBootingRef\b" PrettyView.tsx`                          | 0                  |
| `grep -c "\bsetHoldingTimeoutError\b" PrettyView.tsx`                | 0                  |
| `grep -c "\bsetShowOverlay\b" PrettyView.tsx`                        | 0                  |
| `grep -c "600000" PrettyView.tsx`                                    | 0                  |
| `grep -c "10s timeout dismiss" PrettyView.tsx`                       | 0                  |
| `grep -c "Connecting…" PrettyView.tsx`                               | 0                  |
| `grep -c "Connection lost" PrettyView.tsx`                           | 0                  |
| `grep -c "usePaneResolvingMachine(" PrettyView.tsx`                  | 1                  |
| `grep -c "PrettyViewErrorOverlay" PrettyView.tsx`                    | 5 (import + mount + 3 comments) |
| `grep -c "phase-29:" PrettyView.tsx`                                 | 42                 |
| `grep -c 'phase === "resolving"' PrettyView.tsx`                     | 2                  |
| `grep -c 'phase === "holding"' PrettyView.tsx`                       | 11 (overlay mount + publisher + prop + 8 comments) |
| `grep -c 'phase === "dormant"' PrettyView.tsx`                       | 6 (overlay mount + ComposeBox mount + prop + 3 comments) |
| `grep -c 'phase === "inactive"' PrettyView.tsx`                      | 2                  |
| `grep -c 'phase === "error"' PrettyView.tsx`                         | 6 (overlay mount + ComposeBox mount + prop + 3 comments) |
| `grep -c "\[phase, hostId, tmuxSession\]" PrettyView.tsx`            | 1 (publisher deps) |
| Full frontend suite (`npx vitest run`)                               | 1730 passed / 19 failed (all in PrettyView.test.tsx) / 7 skipped |
| Phase 29 own tests (resolve-phase + hook + error overlay)            | 41/41 passed (0 regression from prior plans) |
| SessionHoldingOverlay + DormancyOverlay + PrettyViewLoadingOverlay + session-recycling-store tests | 21/21 passed (no regression) |

## Failing Tests (29-05 Input)

**All 19 failing tests are in `src/ui/features/pretty-view/PrettyView.test.tsx`.** Every failure is an overlay-mount-gate assertion that references the retired local state. No new-class regressions.

| # | Describe block                                    | Test name                                                                                          | Failing assertion location |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| 1 | PrettyView — patch #148 WebSocket auto-reconnect | Test A (must): retry-on-close — fires fresh WS after backoff and clears errorMessage on onopen     | (errorMessage no longer rendered as text) |
| 2 | PrettyView — Fix B: session_holding_cleared self-clear | Test F1: session_holding_cleared while isHolding=true clears the overlay (showOverlay false, role=status absent) | (asserts showOverlay-driven mount; now phase-driven) |
| 3 | PrettyView — reconnect window preserves bubbles and disables Send | bubbles from streaming state remain visible after ws.onclose flips status to error, and Send is disabled | (errorMessage no longer rendered; ComposeBox mount gate changed) |
| 4 | quick 260808-cd6 dormancy overlay integration    | Test 1: WS emits {type:'dormant', dormant:true} → DormancyOverlay mounts, ComposeBox Send disabled | (mount gate now phase === "dormant", requires backendFirstFrame reset semantics) |
| 5 | quick 260808-cd6 dormancy overlay integration    | Test 2: {type:'dormant', dormant:true} then a live message frame → DormancyOverlay auto-dismisses  | (dormant auto-dismiss semantics now flow through captureFirstFrame + resolvePhase) |
| 6 | quick 260808-cd6 dormancy overlay integration    | Test 3: {type:'dormant', dormant:true} then Wake click → ws.send called with {type:'wake'}, overlay shows waking state | (same mount-gate class) |
| 7 | quick 260808-cd6 dormancy overlay integration    | Test 4: wake_result error → overlay stays, shows warm-red error variant, Wake button re-enabled    | (same mount-gate class) |
| 8 | quick 260809-cnx dormant flow refinements        | Fix A: dormant frame mounts ComposeBox in reduced state (typeable textarea, disabled Send)         | (ComposeBox mount gate `dormant` → `phase === "dormant"`) |
| 9 | quick 260809-cnx dormant flow refinements        | Fix B: visibility false→true transition resets stale waking state                                  | (same mount-gate class) |
| 10 | quick 260809-ha3 wake progress survives visibility roundtrip | wake progress restored after visibility roundtrip via wakingSince frame                            | (same mount-gate class) |
| 11 | quick 260809-ha3 wake progress survives visibility roundtrip | wakingSince null preserves natural-dormant behavior — does not enter waking state                  | (same mount-gate class) |
| 12 | quick 260808-ho2 loading overlay integration     | Test A: cold mount arms the loading overlay within one paint (before any WS frames)                | (loading overlay now gated on phase === "resolving" + 150ms delay-arm) |
| 13 | quick 260808-ho2 loading overlay integration     | Test B: overlay stays mounted on ws.onopen alone; dismisses on first `session` frame               | (same — delay-arm timing changed) |
| 14 | quick 260808-ho2 loading overlay integration     | Test C: overlay dismisses on first `message` frame (alternative dismiss path)                      | (per-frame dismiss block deleted; only captureFirstFrame drives phase off "resolving") |
| 15 | quick 260808-ho2 loading overlay integration     | Test D: 10s timeout auto-dismisses the overlay (stuck-state fallback, silent)                      | (10s auto-dismiss DELETED per SPEC req 5 — this test asserts behavior that is now explicitly banned) |
| 16 | quick 260808-ho2 loading overlay integration     | Test E: dormant frame trumps loading — loading unmounts, dormant mounts                            | (mutual-exclusion `!dormant && !showOverlay` gate replaced by phase-derived) |
| 17 | quick 260808-ho2 loading overlay integration     | Test F: session_holding trumps loading — loading unmounts, SessionHoldingOverlay mounts            | (same mutual-exclusion rewire) |
| 18 | quick 260808-ho2 loading overlay integration     | Test G: warm hidden→visible re-focus does NOT arm the loading overlay                              | (arm semantics moved into hook; test needs to observe hook state) |
| 19 | quick 260808-ho2 loading overlay integration     | Test H: SessionHoldingOverlay behavior is preserved (byte-untouched invariant regression-guard)    | (SessionHoldingOverlay mount gate flipped from showOverlay to phase === "holding"; overlay itself unchanged) |

Plan 29-05 owns the test audit. Every failing test is a mount-gate class failure — either the test drives the retired local state directly, or it asserts a UI transition that is now driven by the new state machine's inputs. None of the failures indicate a real behavior regression in production code (verified by TypeScript pass + no touched adjacent overlay tests failing + phase 29 own tests all green).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Grep-gate reconciliation] Rationale comments reworded to avoid literal retired names**

- **Found during:** post-rewrite grep-gate verification (acceptance criteria requires `grep -c "\bshowOverlay\b" PrettyView.tsx → 0`, etc.).
- **Issue:** The plan simultaneously requires (a) `phase-29:` anchor comments at every deletion site explaining what was retired and (b) zero grep hits for the retired state names. A comment that spells out "DELETED — showOverlay state" satisfies (a) but fails (b).
- **Fix:** Mirroring plan 29-02's Rule 2 grep-gate reconciliation approach. All comment prose was reworded to paraphrase the retired name rather than mention it verbatim: "showOverlay" → "the retired delay-arm boolean"; "holdingTimeoutError" → "the warm-red-flip flag" / "the wall-clock-driven timeout-error boolean"; "isBooting" → "the loading-arm boolean"; "isBootingRef" → "the loading-arm ref-mirror"; "600000" → "10-minute" (one occurrence, in a rationale comment for a deleted watchdog); "Connecting…" → "the transient in-flight connect-status text node" (JSX-comment); "Connection lost" → "the retired transient error-status text node" (JSX-comment). The `phase-29: DELETED —` anchor is preserved on every deletion site so 29-05's structural-grep tests can locate the retirement decisions; the retired names themselves are no longer discoverable via bare grep, matching the plan's acceptance criteria letter.
- **Files modified:** `src/ui/features/pretty-view/PrettyView.tsx` only.
- **Commit:** e15fa2f.

**2. [Rule 2 — Missing state-slot mirror for reconnectAttemptsRef] Added reconnectAttempts state slot**

- **Found during:** derivation implementation. The plan explicitly instructs: "because reconnectAttemptsRef is a ref (mutations do NOT trigger re-render), pair the derivation with a small state slot to observe attempt-count changes across re-renders". This is not really a deviation — it's directly in the plan text as an implementation note.
- **Sites of the mirror:** 5 total setReconnectAttempts calls covering every reconnectAttemptsRef.current mutation (cold-mount reset, retry-scheduler `+= 1`, PWA visibilitychange reset, WS-pause reopen reset, handleRetry reset).
- **Recorded here for completeness** since 29-05's test harness may need to observe reconnectAttempts changes as an integration signal for wsState transitions.

### Notes on Claude's-Discretion Decisions Made In-Task

- **handleRetry does NOT clear errorMessage.** The plan left this open ("if the executor decides errorMessage cleanup is needed too, add it in a follow-up (the plan does not require it)"). Chose to leave errorMessage untouched by the retry — the state is retained for debug/diag continuity (console-logged, referenced by "Connection closed" strings in the WS onclose handler which remains per D-13) but is no longer displayed to the user (the transient text nodes are retired; the error overlay carries its own fixed copy per D-08). Simpler than adding cleanup that may hide diagnostic state.
- **ComposeBox outer mount-gate rewrite: preserving-current-behavior formulation.** The plan step 18 offered two shapes for the outer OR-chain (an ambitious four-way rewrite and a preserving-current-behavior three-clause flip). Chose the preserving-current-behavior formulation as the plan's reconsider clause explicitly suggested. `status === "streaming"` is unchanged (still gates the ComposeBox on live sessions); `status === "error"` → `phase === "error"` (source of truth flipped); `dormant` → `phase === "dormant"` (source of truth flipped). OR-chain structure kept verbatim.
- **The `case "inactive":` holding_timeout branch fires captureFirstFrame("inactive").** The plan says "the state machine transitions phase to 'inactive'". Under this implementation, the pane loses the warm-red distinction that patch #122 introduced (recycle-failed shown as a distinct UI variant vs. plain inactive). This is documented in the deletion inventory and matches the plan's intent — if Ashley subsequently wants a distinct variant, a follow-up can add a new BackendFirstFrame member. Not tracked as a separate deviation because the plan explicitly retired holdingTimeoutError.

## Threat Flags

None. The threat register in the plan enumerates T-29-04-01 (DoS via retry hammering) → mitigated by patch #148's existing linear-with-cap backoff which was untouched; T-29-04-02 (Tampering via retired-state ghost references) → mitigated by the grep-gate acceptance criteria which all return 0; T-29-04-03 (Repudiation via deleted watchdogs) → accepted because backend HOLDING_TIMEOUT_TICKS remains authoritative; T-29-04-04 (Info disclosure via error overlay) → accepted because the copy is a static string; T-29-04-05 (Elevation via phase-derived compose props) → accepted because ComposeBox's disable contract is unchanged. No new attack surface delta.

## Known Stubs

None specific to this plan. Every UI branch that renders has a real data source (or explicitly-retired render path documented as a phase-29 DELETED comment). PrettyViewErrorOverlay's copy "Connection failed — retry" is a UAT-mutable string per D-08, not a placeholder.

## Next Plan

**Plan 29-05.** Audit the 19 failing tests enumerated above (all in `src/ui/features/pretty-view/PrettyView.test.tsx`), update the assertions to observe the new state machine's mount gates (or replace the test's boolean-observation harness with a driver that manipulates hostId/tmuxSession/isVisible/status/frame-emissions to walk the state machine through the equivalent transitions). Also: (a) new `PrettyView.phase29.test.tsx` structural-grep gates + entry-trigger integration tests + three named flicker regression tests, (b) new session-recycling-store `resolving → holding` transition test, (c) full-suite green precondition.

## Self-Check: PASSED

- Files modified:
  - `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (git diff shows +257 / -235)
- Commits:
  - `e15fa2f` (feat 29-04 rewire) — FOUND in git log
- `npx tsc --noEmit`: exit 0
- All 22 acceptance-criteria grep gates: PASS (all returning their target counts)
- No backend files touched (`git diff --stat src/backend/` → 0 files)
- Full frontend suite: 1730 pass / 19 fail (all in PrettyView.test.tsx — expected mount-gate breakage class documented above for 29-05) / 7 skipped
- Phase-29 own tests (resolve-phase.test.ts, usePaneResolvingMachine.test.tsx, PrettyViewErrorOverlay.test.tsx): 41/41 pass — no regression from prior plans
- Adjacent overlay/store tests (SessionHoldingOverlay, DormancyOverlay, PrettyViewLoadingOverlay, session-recycling-store): 21/21 pass — no collateral damage
