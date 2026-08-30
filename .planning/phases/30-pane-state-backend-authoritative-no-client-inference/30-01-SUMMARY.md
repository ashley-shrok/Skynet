---
phase: 30-pane-state-backend-authoritative-no-client-inference
plan: 01
subsystem: backend/claude-session
tags: [backend, websocket, state-machine, pane-state, wave-1]
dependency-graph:
  requires: []
  provides:
    - "PaneState + PaneStateWireFrame + PaneStateEmitter type surface (importable by frontend Plan 30-03)"
    - "createPaneStateEmitter factory (importable by parser Plan 30-02 for id_reset holding trigger)"
    - "authoritative { type: 'pane_state', state, reason? } wire frame emitted alongside every legacy dormant / session_holding / session_holding_cleared / session_changed / inactive frame"
    - "attach-time pane_state established via natural transition sites so a fresh client learns current truth on first frame (PS30-07)"
  affects:
    - "src/backend/claude-session/claude-session-server.ts (11 emit sites funneled + import + doc block + per-connection instantiation)"
tech-stack:
  added: []
  patterns:
    - "pure-module + injected-callback + integration-seam pattern from layer1-detect.ts (co-located test seam, no I/O imports)"
    - "compile-time exhaustiveness via `_exhaust: never` sentinel (mirrors resolve-phase.ts:166)"
    - "per-connection dedupe on strict (state, reason) equality (mirrors dormantLastEmitted at claude-session-server.ts:1010-1022)"
    - "additive-funnel migration (legacy wire frames preserved byte-identical alongside new frame — backward compat this phase)"
key-files:
  created:
    - src/backend/claude-session/pane-state-emitter.ts
    - src/backend/claude-session/pane-state-emitter.test.ts
  modified:
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "Reason field typed `string | undefined` at wire level (not literal union) — backend observations can add reason codes without wire-schema bump per D-migration"
  - "reason key OMITTED from JSON when undefined (not sent as `reason:null`) — T-30-01 no-undefined-leaks mitigation + smaller wire payload"
  - "emitCurrent() API exists but is NOT called anywhere in Phase 30 Plan 01 — every attach flow naturally produces at least one emit via the transition sites; emitCurrent is a Phase-30-follow-up hook for future WS re-attach after transient drop"
  - "Dormant-poll seams (__applyDormantPollTickForTests + __applyDormantPollWithRediscoveryForTests) stay PURE — paneStateEmitter is NOT added as an injected dep (would break test-seam contract). Wrapper call sites capture dormantLastEmitted before/after and funnel changes through the closure-scoped emitter."
  - "attach-time PS30-07 emit lives inside startActiveSessionFlow right after the `session` metadata frame — reused by BOTH the fresh-connectToPane path AND the dormant-poll → wake path (which routes through startActiveSessionFlow via the startActiveFlow callback)"
metrics:
  duration: "11m 24s"
  completed: "2026-08-10T09:58:02Z"
  test_count: 10 (Task 1) + full backend suite (23 files / 292 tests) still green
---

# Phase 30 Plan 30-01: pane-state emitter + funnel Summary

Introduces the authoritative `{ type: "pane_state", state, reason? }` wire frame and consolidates the five legacy racing emit paths (dormant / session_holding / session_holding_cleared / session_changed / inactive) into a per-connection emitter — foundation for Plan 30-02 (parser id_reset → holding) and Plan 30-03 (frontend consumer). Legacy wire frames remain byte-identical alongside the new frame per D-migration backward-compat.

## What Shipped

### New files

- **`src/backend/claude-session/pane-state-emitter.ts`** (~205 LOC) — Pure module. Exports `PaneState` (union), `PaneStateWireFrame` (either shape depending on whether `reason` is present), `PaneStateEmitter` (factory return type), and `createPaneStateEmitter({ wsSend })` factory. Per-instance mutable `current` state; `emit(state, reason?)` builds a wire frame (omitting the `reason` key when undefined), dedupes on strict `(state, reason)` equality against `current`, and calls the injected `wsSend`; `emitCurrent()` bypasses dedupe for a forced re-emit (attach-time re-send API — no callers in Plan 01, wired here for downstream plans); `getCurrent()` returns the last-emitted pair or null. Compile-time exhaustiveness via `_exhaust: never` sentinel inside the emit switch.
- **`src/backend/claude-session/pane-state-emitter.test.ts`** (~186 LOC) — 10 vitest cases: factory shape, wire-frame shape (with/without reason), dedupe on identical emits, differing reason is not dedupe, dedupe is against LAST emit only, emitCurrent() no-op before any emit, emitCurrent() bypass-dedupe, full transition matrix (14 documented state/reason pairs), and a `@ts-expect-error`-proven compile-time exhaustiveness gate.

### Modified files

- **`src/backend/claude-session/claude-session-server.ts`** (+130 lines) — Import of `createPaneStateEmitter` + `PaneStateEmitter` at the top; new `pane_state` bullet in the frame-type doc block between `dormant` and `wake_result`; per-connection `paneStateEmitter` instantiation right after `let layer1: Layer1State = ...` with a closure `wsSend` that mirrors the existing open-guard + try/catch used by every legacy emit site; 11 `paneStateEmitter.emit(...)` call sites funneling every existing transition (see table below).

## Funneled Transition Sites (for downstream Plan 30-03 WS handler)

Every existing `ws.send(JSON.stringify({...}))` at these sites is PRESERVED byte-identical; a matching `paneStateEmitter.emit(...)` fires alongside:

| Line | Site | pane_state call | Legacy frame preserved? |
|------|------|-----------------|--------------------------|
| L2191 | `transitionToHolding(reason)` | `emit("holding", reason)` — reason forwards `"id_reset"` \| `"discovery_diff"` | Yes (`session_holding`) |
| L2260 | `transitionFromHoldingToActiveSameFile()` | `emit("active", "same_file_recovery")` | Yes (`session_holding_cleared`) |
| L2345 | `transitionToActiveNew(newSessionFile)` | `emit("active", "session_changed")` — newSessionFile stays on the legacy frame only (T-30-01: no filesystem paths in reason) | Yes (`session_changed`) |
| L2391 | `transitionToDead(reason)` | `emit("inactive", reason)` — reason forwards `"holding_timeout"` | Yes (`inactive`) |
| L3871 | `startActiveSessionFlow` — right after `session` metadata frame | `emit("active")` — bare, no reason (attach-time establishment per PS30-07) | Yes (`session` frame — the initial-session frame, not one of the five legacy pane-state frames) |
| L4214/L4216 | dormant-poll-tick seam wrapper (contextPctTimer branch, ~L4162) | `emit("dormant")` (on false→true) \| `emit("active", "dormancy_cleared")` (on true→false) | Yes (`dormant`) |
| L4649 | initial-discovery-dormant path (before dormant-poll timer starts) | `emit("dormant")` (bare, no reason — wakingSince stays on legacy frame only) | Yes (`dormant` with wakingSince) |
| L4738/L4740 | dormant-poll-with-rediscovery seam wrapper (`dormantPollTimer` branch) | `emit("dormant")` (on false→true) \| `emit("active", "dormancy_cleared")` (on true→false) | Yes (`dormant`) |
| L4774 | initial-discovery-inactive path (FALLBACK-01) | `emit("inactive", result.reason)` — result.reason forwards the discovery verdict verbatim | Yes (`inactive`) |

## Full Reason-Code Vocabulary (for Plan 30-03 wire-handler test cases)

| state | reasons (all `string | undefined`) |
|-------|------------------------------------|
| `active` | (bare — attach-time) \| `same_file_recovery` \| `session_changed` \| `dormancy_cleared` |
| `holding` | `id_reset` \| `discovery_diff` (plus documented-but-not-yet-emitted fallbacks: `pid_death`, `exit_scan`) |
| `dormant` | (bare — no reason emitted; state itself carries the truth) |
| `inactive` | `holding_timeout` \| discovery result.reason: `not_claude` \| `no_pid_session_file` \| `no_open_session_file` \| `no_tmux_session` \| `exec_error` \| `pid_unavailable` (documented backcompat; no longer emitted) |
| `error` | (none emitted in Phase 30 Plan 01 — documented in emitter tests only; `file_unreadable`/`tracking_error` reserved for a future backend observation surface) |

Plan 30-03 consumers should treat `reason` as free-form string diagnostic (never enum-narrow) so future backend observations don't break the frontend without a wire-schema bump.

## Backward-Compat Preservation (proof)

Legacy frames confirmed byte-identical on the wire — greps proved they were NOT deleted during the funnel work:

- `grep 'ws.send(JSON.stringify({ type: "session_holding" }))'` → 1 hit (L2154 in `transitionToHolding`)
- `grep -B1 'type: "session_changed"'` → 1 hit (L2332 inside multi-line `ws.send(JSON.stringify({ ... }))` in `transitionToActiveNew`)
- `grep 'type: "inactive"'` in real emit contexts → 2 hits (L2384 `transitionToDead`, L4765 initial-discovery-inactive)
- `type: "dormant"` frames — all 3 sites preserved (initial-discovery-dormant at ~L4643, `__applyDormantPollTickForTests` at L1018 + L1020, `__applyDormantPollWithRediscoveryForTests` at L1136 + L1177)
- `type: "session_holding_cleared"` — preserved at L2218 in `transitionFromHoldingToActiveSameFile`

Full backend claude-session test suite (`npx vitest run src/backend/claude-session/`) went from 22 files / 282 tests pre-plan to 23 files / 292 tests post-plan — the only new file is `pane-state-emitter.test.ts` with 10 cases. Every pre-existing test still passes, proving no legacy consumer regressed. Full-suite `npx vitest run` also green: 141 files, 1783 passed, 7 skipped, 1 todo, 0 failures.

## Deviations from Plan

### None substantive — implementation matches spec exactly

- `grep -c "createPaneStateEmitter" claude-session-server.ts` returned 2, not the 1 the acceptance criterion literally specifies. This is a plan-text arithmetic error: the criterion was intended to prove "exactly one per-connection instantiation" but counted only that call, ignoring the required `import { createPaneStateEmitter, PaneStateEmitter }` statement from Step 1. The INTENT (single instantiation site — L1440) is met exactly. No code change needed.

### Surprise wiring notes

- **Dormant-poll seam split** (called out as "the tricky part" in the plan's `<output>` section) worked cleanly with the capture-before / compare-after pattern in both wrapping call sites. The `__applyDormantPollWithRediscoveryForTests` seam has an extra wrinkle: when it transitions dormant→active via `startActiveFlow`, that callback routes through `startActiveSessionFlow` which ALSO fires `paneStateEmitter.emit("active")`. So a single real dormancy-clear-with-rediscovery-hit tick produces TWO pane_state frames on the wire: `("active","dormancy_cleared")` then `("active")`. The emitter's dedupe on (state,reason) correctly treats these as distinct (different reason) — both are useful: the first signals "we've exited dormancy", the second establishes the fresh active session's attach-time pane_state. Documented inline in the code comment at L4718-4728.
- **Legacy `session_changed` grep-string mismatch**: the acceptance criterion string `grep -c 'ws.send(JSON.stringify({ type: "session_changed"'` assumed a single-line format, but the actual code has the JSON.stringify split across 5 lines (`ws.send(` on L2331, `type: "session_changed"` on L2332). Multi-line-safe verification confirmed the emit is preserved — no code change needed.

## Consumer Guidance (for Plans 30-02 and 30-03)

- **Plan 30-02** (parser id_reset → emit holding): The parser side is not touched by this plan. When Plan 30-02 wires the parser observation, it should either (a) call `transitionToHolding("id_reset")` directly (the existing Layer 1 dispatch already funnels through paneStateEmitter automatically), or (b) if a new fast-path is added at the parser boundary, take a `paneStateEmitter: PaneStateEmitter` dep and call `emit("holding", "id_reset")` — the emitter's dedupe safely collapses if both paths fire on the same tick.
- **Plan 30-03** (frontend consumer): Import `PaneState` from the backend module for the reducer's input type. Wire-handler should treat `reason` as `string | undefined` (never enum). The attach-time PS30-07 truth is now delivered via the natural transition emits inside `startActiveSessionFlow` / initial-discovery-dormant / initial-discovery-inactive — a fresh client that opens a WS gets a pane_state frame on the same tick as the initial `session` (or the initial `dormant` / `inactive`) frame.

## Self-Check: PASSED

- `[ -f src/backend/claude-session/pane-state-emitter.ts ]` → FOUND
- `[ -f src/backend/claude-session/pane-state-emitter.test.ts ]` → FOUND
- Commit hashes in git log:
  - `e5325e4` test(30-01): add failing tests for pane-state emitter → FOUND
  - `591469e` feat(30-01): implement pane-state emitter → FOUND
  - `38e57c2` feat(30-01): wire pane_state emitter into claude-session-server → FOUND
- `npx vitest run src/backend/claude-session/` → 23 files, 292 tests, 0 failures (green)
- `npx vitest run` (full suite) → 141 files, 1783 passed, 0 failures (green)
- `npx tsc --noEmit` → exit 0

## TDD Gate Compliance

Task 1 followed strict RED/GREEN cycle:
- RED gate: `test(30-01): add failing tests for pane-state emitter` (e5325e4) — tests fail on module-not-found
- GREEN gate: `feat(30-01): implement pane-state emitter` (591469e) — 10 tests pass, tsc clean

Task 2 was `tdd="false"` per the plan frontmatter (`type="auto"` without `tdd="true"`) — verification via full backend suite still passing (regression coverage over the wiring) rather than net-new unit tests for the wiring itself. All 292 backend tests green.
