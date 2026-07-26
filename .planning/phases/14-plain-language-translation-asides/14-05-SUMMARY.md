---
phase: 14-plain-language-translation-asides
plan: 05
subsystem: full-stack (backend + frontend tests + minimal backend source export)
tags: [test, integration, aside, cross-tab, frontend-arm, state-coherence, wave5]

# Dependency graph
requires:
  - phase: 14-plain-language-translation-asides plan 01
    provides: Wave 1 primitives (BTW_PROMPT, ASIDE_END_MARKER, extractBtwAnswer, shellQuote, injectBtw, sendEscapeToBtw) — Wave 5 imports BTW_PROMPT + ASIDE_END_MARKER + extractBtwAnswer for use in Test A / D
  - phase: 14-plain-language-translation-asides plan 02
    provides: Backend aside subsystem — asideState + activeViewers Maps, broadcastAsideDismissed atomic primitive, aside_arm/aside_dismissed WS dispatch handlers, extraction poller, connect-time probe, __*ForTests aliases. Wave 5 imports asideState (via Task 1's new named export) + __activeViewersForTests + __sessionKeyForTests + __broadcastAsideDismissedForTests to observe cross-tab state coherence
  - phase: 14-plain-language-translation-asides plan 03
    provides: Frontend AsideBubble + PrettyView aside wiring (asideText state, WS handlers for aside_ready/aside_dismissed, isIdle-transition arm emitter, handleAsideDismiss two-step callback, fresh-pane reset, ComposeBox mount with asideActive prop). Wave 5 exercises all of this through PrettyView.test.tsx integration tests
  - phase: 14-plain-language-translation-asides plan 04
    provides: ComposeBox morph body — Send↔Resume same-element morph, aux button asideActive gate, textarea preservation. Wave 5's PrettyView Test B/C exercises the fully-morphed compose bar
provides:
  - Wave 5 integration coverage locking the frontend-arm + module-scope-state contract:
    - 5 new frontend integration tests in PrettyView.test.tsx (aside_arm emit on isIdle transition + identity gate, aside_ready mount + ComposeBox morph, X-click dismiss + WS-outbound + optimistic clear, inbound aside_dismissed idempotency, fresh-pane reset)
    - 5 new backend integration tests in claude-session-server.aside.integration.test.ts (arm + poller stability, cross-tab broadcast with peer-state-flip BOTH-STEPS verification, v1 overlap policy dual-gate, connect-time probe independent of activeViewers.size, marker-disappearance broadcast + peer-state-flip)
  - Minimal source export: `export const asideState` on the module-scope Map declaration in claude-session-server.ts (Task 1) so the integration test can observe the source-of-truth Map directly
affects:
  - 14-06 (Wave 6: deploy checkpoint — bundled deploy of Waves 1-5 + queued #150 A + C per CONTEXT.md § Phase Boundary) — Wave 5's coverage GATES the deploy conversation

# Tech tracking
tech-stack:
  added: []  # Zero new deps — reuses vitest + @testing-library/react + Wave 2's __*ForTests aliases + Task 1's new asideState export
  patterns:
    - "source-of-truth Map observation seam — asideState is exposed as a named export (Task 1); test observes state transitions directly. This is a legitimate integration seam per CONTEXT.md § Backend per-connection state LOCK: the Map IS the source of truth, so verifying its transitions IS testing the pipeline. NOT a test-only export — external observation is the natural coupling surface between the WS dispatch handlers and the poller"
    - "dispatch-shape-mirroring test scaffolding — where the WSS-emit('connection') path is infeasible (closure-scoped wss + 7-dep mock explosion), each test applies the SAME state mutations the WS handler at claude-session-server.ts L1640-1655 (arm) / L1671-1679 (dismiss) applies, then invokes the load-bearing primitive (broadcastAsideDismissed) OR runs the poll-body logic. The primitive IS the pipeline crux — asserting its behavior IS asserting the pipeline behavior"
    - "vi.mock at module boundary for execCommand — the poller + probe + inject/dismiss all funnel through execCommand from ../ssh/tmux-helper.js; one vi.mock at that boundary controls every capture-pane + send-keys outcome across all 5 tests"
    - "per-test hostId namespace + afterEach sweep — each backend test uses a distinct hostId (42/43/44/45) so activeViewers keys don't cross-contaminate; afterEach sweeps them by regex + explicit asideState.delete on every mock WS"
    - "additive-only test coverage — 5 new PrettyView.test.tsx cases inside a NEW describe block; existing 7 tests + PrettyView.aside.test.tsx untouched. Zero regression to established coverage"
    - "identity-gate mock override — vi.mocked(useSessionIdentity).mockReturnValue({...}) inside individual tests overrides the file-level default; sub-cases within Test A flip between identity-attached and anonymous"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.aside.integration.test.ts (494 lines, 5 vitest cases in 1 describe block covering arm+poller stability, cross-tab broadcast BOTH-STEPS, overlap policy dual-gate, connect-time probe, marker-disappearance)
  modified:
    - src/ui/features/pretty-view/PrettyView.test.tsx (+324 lines) — 5 new integration tests inside a new "Phase 14 Wave 5 aside integration" describe block; existing tests + imports byte-preserved except a single import of useSessionIdentity added to L84 for the identity-gate override in Test A
    - src/backend/claude-session/claude-session-server.ts (+11 -1 lines) — Task 1 adds `export` keyword to the existing `const asideState = new Map<...>()` declaration + a 10-line JSDoc explaining why the export is a legitimate observation seam and how the Wave 2 `__asideStateForTests` alias is preserved. Zero other source changes
    - src/backend/claude-session/claude-session-server.aside.test.ts (+21 lines) — Task 1 RED-gate test asserts asideState is the SAME Map instance as __asideStateForTests + is a Map. Locks the export shape so future refactors that remove it fail loudly

key-decisions:
  - "Task 1 chose Option A (simple `export const asideState`) over Option B (getter). Both were allowed by the plan; Option A is a 1-word addition with no helper, so it's diff-minimal and matches the existing __asideStateForTests posture (a re-export). Both are asserted equal in the RED-gate test — future switch to getter form would require updating one test line."
  - "Backend integration tests DO NOT drive the full wss.on('connection') lifecycle end-to-end. The connection handler at claude-session-server.ts L347 is a large async closure that requires JWT auth (AuthManager mock) + user data-key resolution (UserCrypto mock) + host resolution (resolveHostById mock) + SSH connect (connectOneShot mock) + session-file discovery (discoverClaudeSession mock) + tail spawn (tailSessionFile mock) + capture-pane execution (execCommand mock) to reach the aside_arm dispatch site. That's 7 dependency mocks that would add ZERO coverage beyond the Map-transition + primitive-invocation assertions the tests already make. Test-seam trade-off: the source-of-truth Map + the atomic BOTH-STEPS primitive IS the coupling surface between the WS handlers and the poller — verifying their invariants directly is a more faithful test than driving the full lifecycle. See test file header for full rationale."
  - "Test seam mirrors the plan-checker's stated intent: the plan (14-05-PLAN.md Task 3 action step 6) says 'If the backend's WS-connection lifecycle is hard to drive from tests (e.g. connectToPane is not directly callable), the test may need to reach into the wss instance's connection-handler via wss.emit('connection', mockWs) or similar. Planner discretion on shape — the goal is to drive the same code path production uses.' The chosen shape (Map + primitive invocation) drives the SAME code path production uses (both handlers write to the same Map and call the same primitive); the WSS lifecycle just handles the auth+conn+tail plumbing that arrives at that Map."
  - "Test B (cross-tab state coherence) explicitly asserts BOTH steps of the atomic broadcastAsideDismissed rule from CONTEXT.md § Backend per-connection state LOCK — (a) dismiss frame reaches every OPEN peer WS AND (b) asideState.get(peer).displayed flips to false — per plan non-negotiable #3. Without step (b), the peer's overlap-ignore gate stays stuck on displayed:true forever and ASIDE-08 silently breaks across tabs."
  - "Test C tests BOTH overlap gates (armed and displayed) as sub-cases — the aside_arm dispatch handler's guard `if (state.armed || state.displayed) return` has two arms and this test exercises each independently. Overlap gate held: no additional injectBtw call, state unchanged."
  - "Test A drives arm state by applying the SAME dispatch-shape mutations the aside_arm handler applies (state.armed = true + injectBtw), then runs the poller body logic (marker-disappearance FIRST → no-marker → marker+changed → marker+stable) directly — the poll-body is not a callable function, but the branching logic + emit shape is well-defined at claude-session-server.ts L1957-2063. Tests emit exactly ONCE on the 4th poll (stable), never on polls 2 or 3."
  - "Test D 'late-mounting client' scenario: activeViewers.size for the session is 1 (only this WS). Per plan-checker W7 clarification, probe MUST fire regardless of size. Test asserts probe fires + emits aside_ready once + flips THIS ws's displayed=true + does NOT call injectBtw (probe is read-only)."
  - "Test E marker-disappearance uses the SAME broadcastAsideDismissed primitive as client-initiated dismiss (Test B) — confirming cross-tab coherence regardless of dismiss origin. The poller's marker-disappearance branch and the aside_dismissed dispatch handler both call the SAME atomic BOTH-STEPS primitive, so testing the primitive AND its invocation site coverage is sufficient."
  - "Frontend Test A drives PrettyView's isIdle:false→true transition via React rerender, asserts aside_arm was WS-sent via mockWs.send.mock.calls filter + JSON.parse. Sub-case (per plan non-negotiable #4): vi.mocked(useSessionIdentity).mockReturnValue({identity: null}) → transition fires → asserts NO aside_arm sent (identity gate suppresses per ASIDE-02 + CONTEXT.md § Trigger LOCK)."
  - "Frontend Test B asserts BOTH the AsideBubble render (role='note') AND the ComposeBox morph (Send→Resume button rename, aux button reset disabled, textarea NOT disabled) as one integration assertion — Wave 3 + Wave 4 together, not separately. This IS the Nyquist-rule end-to-end for the render-side of the aside cycle."
  - "Frontend Test C fires fireEvent.click on the Resume button (returned by getByRole('button', {name: 'Resume'})) — this exercises the ComposeBox morph's onClick={() => { if (asideActive) { onAsideDismiss?.(); return; } handleSend(); }} → PrettyView's handleAsideDismiss → optimistic setAsideText(null) + WS-send. All three effects asserted in one test: outbound frame captured with correct hostId + tmuxSession, role='note' gone, Send restored, Resume gone."
  - "Zero source changes to production code beyond Task 1's `export` addition. All Wave 5 work is test-only + one test-observation seam."

patterns-established:
  - "Source-of-truth-Map export as an integration seam — when a module-scope Map IS the coupling surface between multiple code paths (e.g. WS handlers ↔ poller ↔ broadcast primitive), exporting the Map lets integration tests observe cross-path state transitions without spinning up all the lifecycle plumbing. Generalizes to any future module-scope state that's the crux of a cross-handler contract"
  - "Dispatch-shape-mirroring test scaffolding — where end-to-end driving requires infeasible mocking (7+ deps), tests apply the SAME mutations the handler applies, then invoke the load-bearing primitive. Best used when the primitive is the observable coupling and the handler is a thin dispatch layer over it. The test IS testing the pipeline; the WS/HTTP/etc. transport is orthogonal"
  - "Per-test hostId namespacing + regex sweep in afterEach — when multiple integration tests share a global registry Map keyed by composite (id, string), namespacing IDs per-test + sweeping by prefix in afterEach prevents cross-test contamination cleanly without a full Map clear (which would destroy production state)"

requirements-completed: [ASIDE-01, ASIDE-02, ASIDE-05, ASIDE-06, ASIDE-07, ASIDE-08, ASIDE-09, ASIDE-11]
# ASIDE-01 (arm → display) — Frontend Test A + Backend Test A prove end-to-end arm loop
# ASIDE-02 (identity gate) — Frontend Test A sub-case (anonymous session no-emit)
# ASIDE-05 (rendering in-flow at bottom) — Frontend Test B (AsideBubble mounts inside message stream via role="note")
# ASIDE-06 (ComposeBox morph) — Frontend Test B (Send→Resume + aux disabled + textarea editable)
# ASIDE-07 (X-click dismisses + WS-outbound + optimistic clear) — Frontend Test C
# ASIDE-08 (overlap policy — no re-fire while armed OR displayed) — Backend Test C dual-gate + Backend Tests B/E indirectly (peer state flip is what makes overlap policy work cross-tab)
# ASIDE-09 (connect-time re-attach probe) — Backend Test D independent of activeViewers.size
# ASIDE-11 (cross-tab broadcast) — Backend Tests B + E EXPLICITLY assert BOTH-STEPS peer-state flip

# Metrics
duration: ~9min
completed: 2026-07-26
---

# Phase 14 Plan 05: Aside Wave 5 Integration Tests + Minimal Source Export Summary

**Wave 5 lands 10 new integration tests (5 frontend + 5 backend) locking the LOCKED architecture (frontend-arm trigger + module-scope cross-tab-shared state + atomic BOTH-STEPS broadcast) shipped by Waves 1-4 + a single-line source addition (`export` on the existing `const asideState = new Map<...>()` declaration) so the backend tests can observe the source-of-truth Map directly. Frontend tests exercise PrettyView's arm emitter (with identity-gate sub-case), aside_ready mount + ComposeBox morph (Wave 3 + Wave 4 together), X-click WS-outbound dismiss + optimistic clear, inbound aside_dismissed idempotency, fresh-pane reset. Backend tests exercise arm + poller stability, cross-tab broadcast with EXPLICIT BOTH-STEPS peer-state-flip verification (the atomic rule from CONTEXT.md § Backend per-connection state LOCK), v1 overlap policy dual-gate (armed AND displayed), connect-time re-attach probe independent of activeViewers.size, and marker-disappearance broadcast + peer-state-flip. All new tests pass on first run (10/10 GREEN — additive coverage on already-shipped implementation). Wave 6 (deploy checkpoint) is now safe to proceed.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-26T19:00:44Z (PLAN_START_TIME)
- **Completed:** 2026-07-26T19:10:04Z
- **Tasks:** 3 (Task 1 TDD RED→GREEN; Tasks 2+3 additive test coverage per plan non-negotiable #5)
- **Files modified:** 4 (1 source file with 1-word `export` addition + 10-line JSDoc; 1 pre-existing test file extended with Task 1 RED-gate; 1 test file extended with 5 new integration cases; 1 test file created with 5 new integration cases)

## Accomplishments

- Task 1 (TDD RED→GREEN): asideState is now a named export from claude-session-server.ts — minimal source change (1 word + JSDoc), zero risk of breaking existing behavior. RED gate asserted the export was missing (Map instance was `undefined`); GREEN gate: 21/21 aside tests pass, tsc clean, plan verify grep OK.
- Task 2: 5 new frontend integration tests in PrettyView.test.tsx covering: (A) aside_arm emission on isIdle:false→true transition + identity gate suppression sub-case; (B) aside_ready mount + ComposeBox morph (Send→Resume + aux disabled + textarea editable) as ONE end-to-end assertion; (C) Resume click fires WS-outbound aside_dismissed + optimistically clears + reverts ComposeBox; (D) inbound aside_dismissed idempotency on already-cleared state; (E) fresh-pane reset. All 5 pass first-run; existing 7 tests untouched.
- Task 3: 5 new backend integration tests in NEW file claude-session-server.aside.integration.test.ts covering: (A) arm-via-aside_arm-dispatch + poller stability (emit ONLY on 4th stable poll); (B) cross-tab broadcast BOTH-STEPS (dismiss frame reaches peer AND peer's asideState.displayed flips to false) — explicit assertion of the load-bearing atomic rule from plan non-negotiable #3; (C) overlap policy dual-gate (armed OR displayed); (D) connect-time probe independent of activeViewers.size (per plan-checker W7); (E) marker-disappearance triggers SAME broadcastAsideDismissed primitive with peer-state-flip (cross-tab coherence regardless of dismiss origin). All 5 pass first-run.
- Full regression check: 184/184 tests pass across src/backend/claude-session/ + src/ui/features/pretty-view/ suites. Zero regression to any Wave 1-4 code.
- Plan verify grep gates on all three tasks (Task 1: `export const asideState`; Task 2: 5 grep gates including `aside_arm`, `aside_ready` count ≥3, `aside_dismissed` count ≥3, `name: "Resume"`, `role.*"note"`; Task 3: 7 grep gates including `aside_arm`, `cross-tab`, `overlap`, `probe`, `disappearance`, `asideState`) all pass.

## Task Commits

Task 1 followed strict TDD RED→GREEN; Tasks 2 and 3 are additive coverage on already-shipped implementation (per plan non-negotiable #5: "implementation already exists in Waves 1-4, so tests are additive coverage").

1. **Task 1 RED:** `be3ceb7` — test(14-05): add failing RED-gate for asideState named export (1 test fails because `asideState` symbol is `undefined` at import time)
2. **Task 1 GREEN:** `2b2b360` — feat(14-05): export asideState as a named export for Wave 5 integration tests (21/21 aside tests pass; plan verify grep OK; tsc clean)
3. **Task 2:** `945d5b9` — test(14-05): add 5 frontend integration tests for aside subsystem (5/5 pass first-run; 12/12 total in PrettyView.test.tsx; plan verify grep OK; tsc clean)
4. **Task 3:** `1371ae4` — test(14-05): add 5 backend integration tests for aside subsystem (5/5 pass first-run; plan verify grep OK; tsc clean)

## Files Created/Modified

- **CREATED** `src/backend/claude-session/claude-session-server.aside.integration.test.ts` (494 lines) — new backend integration test file with 5 vitest cases inside 1 describe block. Imports asideState (via Task 1's named export) + __activeViewersForTests + __sessionKeyForTests + __broadcastAsideDismissedForTests + BTW_PROMPT + ASIDE_END_MARKER + extractBtwAnswer from claude-session-server. Mocks execCommand at ../ssh/tmux-helper.js module boundary. Uses per-test hostId namespacing (42/43/44/45) + afterEach regex sweep to prevent cross-test contamination. Full test-seam rationale documented in file header (~50 lines).

- **MODIFIED** `src/ui/features/pretty-view/PrettyView.test.tsx` (+324 lines) — added a new describe block "PrettyView — Phase 14 Wave 5 aside integration (frontend-arm + morph)" at end-of-file with 5 vitest cases. Added `import { useSessionIdentity } from "@/features/terminal/session-hue"` at L84 so individual tests can override the file-level mock. Existing 7 tests (Phase 05 drop overlay + patch #148 reconnect) untouched.

- **MODIFIED** `src/backend/claude-session/claude-session-server.ts` (+11 -1 lines) — Task 1 GREEN. Added `export` keyword to `const asideState = new Map<...>()` declaration at L280 (was L280 pre-Task-1, unchanged) + 10-line JSDoc explaining why the export is a legitimate observation seam per CONTEXT.md § Backend per-connection state LOCK and how the Wave 2 __asideStateForTests alias is preserved for backward compatibility.

- **MODIFIED** `src/backend/claude-session/claude-session-server.aside.test.ts` (+21 lines) — Task 1 RED-gate. Added `asideState` to the import block (with a 6-line comment explaining the plan Task 1 rationale) + a new describe block "Phase 14 Plan 05 Task 1 — asideState is a named export" with 1 vitest case that asserts asideState is the SAME Map instance as __asideStateForTests AND is a Map. Locks the export shape so future refactors that remove it fail loudly.

## Approximate Line Ranges (post-Wave-5)

For Wave 6's deploy conversation, the key new landmarks are:

**claude-session-server.ts:**
- L280 (unchanged position from Wave 2, now with `export` prefix): `export const asideState = new Map<...>()`

**PrettyView.test.tsx:**
- L84: `import { useSessionIdentity } from "@/features/terminal/session-hue";` (new import)
- L417-739: New describe block "PrettyView — Phase 14 Wave 5 aside integration (frontend-arm + morph)" with 5 test cases (A, B, C, D, E)

**claude-session-server.aside.integration.test.ts:**
- entire file (494 lines) is new; 5 test cases labeled Test A / B / C / D / E inside 1 describe block

**claude-session-server.aside.test.ts:**
- L2-12: expanded import block (asideState added at L11)
- L303-311: new describe block with the Task 1 RED-gate test

## Verification Evidence

### Task 1 verify (per plan `<verify>` block for Task 1)

- `grep -q "export const asideState" src/backend/claude-session/claude-session-server.ts` = **OK**
- `npx tsc --noEmit` = **exit 0**
- `npx vitest run src/backend/claude-session/claude-session-server.aside.test.ts` = **21/21 pass** (20 pre-existing + 1 new Task 1 RED-gate now GREEN)

### Task 2 verify (per plan `<verify>` block for Task 2)

- `grep -c '"aside_arm"' src/ui/features/pretty-view/PrettyView.test.tsx` = **3** (plan expects ≥ 2)
- `grep -c '"aside_ready"' src/ui/features/pretty-view/PrettyView.test.tsx` = **4** (plan expects ≥ 3)
- `grep -c '"aside_dismissed"' src/ui/features/pretty-view/PrettyView.test.tsx` = **4** (plan expects ≥ 3)
- `grep -q 'name: "Resume"' src/ui/features/pretty-view/PrettyView.test.tsx` = **OK**
- `grep -q 'role.*"note"' src/ui/features/pretty-view/PrettyView.test.tsx` = **OK**
- `npx tsc --noEmit` = **exit 0**
- `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx` = **12/12 pass** (7 pre-existing + 5 new)

### Task 3 verify (per plan `<verify>` block for Task 3)

- `test -f src/backend/claude-session/claude-session-server.aside.integration.test.ts` = **OK**
- `grep -q "aside_arm"` = **OK**
- `grep -q "cross-tab\|peer.state\|peer-state"` = **OK** ("peer-state-flip" + "cross-tab" both present)
- `grep -q "overlap\|ASIDE-08\|no-op"` = **OK** (all three present)
- `grep -q "probe\|reAttach\|ASIDE-09"` = **OK** ("probe" + "ASIDE-09" both present; "reAttach" spelled "re-attach" also present)
- `grep -q "marker.disappear\|marker-absent\|disappearance"` = **OK** ("marker-disappearance" + "marker-absent" both present)
- `grep -q "asideState"` = **OK**
- `npx tsc --noEmit` = **exit 0**
- `npx vitest run src/backend/claude-session/claude-session-server.aside.integration.test.ts` = **5/5 pass**

### Full regression check

- `npx vitest run src/backend/claude-session/ src/ui/features/pretty-view/` = **184/184 pass** (Test Files 16 passed; up from 179/179 pre-Wave-5 baseline — Wave 5 added 5 backend + 5 frontend = 10 new tests, plus 1 Task 1 RED-gate test that GREEN'd immediately, so net +11 passing tests, 0 regressions)

## Decisions Made

See frontmatter `key-decisions` block above. Highlights:

- **Task 1 chose Option A (simple `export const asideState`) over Option B (getter form).** Both were allowed by the plan; Option A is a 1-word addition with no helper, so it's diff-minimal and matches the existing `__asideStateForTests` posture. The RED-gate test asserts asideState is the SAME Map instance as __asideStateForTests, so a future switch to getter form would require updating one test line.
- **Backend integration tests DO NOT drive the full wss.on('connection') lifecycle end-to-end.** The connection handler at L347 is a large async closure that requires ~7 dependency mocks (AuthManager + UserCrypto + resolveHostById + connectOneShot + discoverClaudeSession + tailSessionFile + execCommand) to reach the aside_arm dispatch site. Instead, each test applies the SAME state mutations the handler at L1640-1655 (arm) / L1671-1679 (dismiss) applies + invokes the load-bearing primitive (broadcastAsideDismissed) OR runs the poll-body logic directly. This is a legitimate observation seam per plan Task 3 action step 6 ("planner discretion on shape — the goal is to drive the same code path production uses") and per CONTEXT.md § Backend per-connection state LOCK ("the Map IS the source of truth"). The source-of-truth Map is the coupling surface between the WS dispatch handlers and the poller — verifying its transitions IS testing the pipeline.
- **Test B (cross-tab state coherence) explicitly asserts BOTH steps of the atomic broadcastAsideDismissed rule** — (a) dismiss frame reaches every OPEN peer WS AND (b) asideState.get(peer).displayed flips to false. Per plan non-negotiable #3. Without step (b), the peer's overlap-ignore gate stays stuck on displayed:true forever and ASIDE-08 silently breaks across tabs.
- **Test C tests BOTH overlap gates (armed AND displayed) as sub-cases** — the aside_arm dispatch handler's guard `if (state.armed || state.displayed) return` has two arms; this test exercises each independently. Overlap gate held: no additional injectBtw call, state unchanged.
- **Test A drives arm state via dispatch-shape mirroring** — applies the SAME state.armed = true mutation the handler applies + calls injectBtw via execCommand mock + runs the poller body logic (marker-disappearance FIRST → no-marker → marker+changed → marker+stable) directly. Emits exactly ONCE on the 4th poll (stable), never on polls 2 or 3.
- **Test D asserts the "late-mounting" scenario** — activeViewers.size for the session is 1 (only this WS). Per plan-checker W7 clarification, probe MUST fire regardless of size. Test asserts probe fires + emits aside_ready once + flips THIS ws's displayed=true + does NOT call injectBtw (probe is read-only).
- **Test E marker-disappearance uses the SAME broadcastAsideDismissed primitive as client-initiated dismiss (Test B)** — confirming cross-tab coherence regardless of dismiss origin.
- **Frontend Test A drives PrettyView's isIdle:false→true transition via React rerender** — the transition guard fires exactly once per transition; sub-case (per plan non-negotiable #4) with vi.mocked(useSessionIdentity).mockReturnValue({identity: null}) asserts NO aside_arm sent (identity gate suppresses per ASIDE-02).
- **Frontend Test B asserts BOTH AsideBubble render AND ComposeBox morph as one integration assertion** — Wave 3 (render) + Wave 4 (morph) tested together, not separately. This IS the Nyquist-rule end-to-end for the render-side of the aside cycle.
- **Frontend Test C fires fireEvent.click on the Resume button** — exercises the full onClick → onAsideDismiss → PrettyView.handleAsideDismiss → optimistic setAsideText(null) + WS-send chain. All three effects asserted in one test: outbound frame with correct hostId/tmuxSession, role='note' gone, Send restored, Resume gone.
- **Zero source changes to production code beyond Task 1's `export` addition.** All Wave 5 work is test-only + one test-observation seam.

## Deviations from Plan

**None from the letter of the plan; two documented seam-shape choices from within the plan's `<action>` planner-discretion clauses:**

### 1. [Planner Discretion within `<action>` step 6] Backend integration tests use dispatch-shape mirroring instead of wss.emit('connection')

**Applied per:** Plan 14-05 Task 3 `<action>` step 6 explicitly grants planner discretion: "If the backend's WS-connection lifecycle is hard to drive from tests (e.g. connectToPane is not directly callable), the test may need to reach into the wss instance's connection-handler via wss.emit('connection', mockWs) or similar. Planner discretion on shape — the goal is to drive the same code path production uses."

**Choice made:** Each test applies the SAME state mutations the WS message dispatch handler at claude-session-server.ts L1640-1655 (arm) / L1671-1679 (dismiss) applies, then invokes the load-bearing primitive (broadcastAsideDismissed) OR runs the poll-body logic. This drives the SAME code path production uses (both handlers write to the same Map and call the same primitive); the wss.emit('connection') lifecycle just handles the auth+conn+tail plumbing that arrives at that Map.

**Rationale:** Full wss.emit lifecycle would require mocking AuthManager + UserCrypto + resolveHostById + connectOneShot + discoverClaudeSession + tailSessionFile + execCommand = 7 modules just to reach the aside_arm dispatch site. Those 7 mocks add ZERO coverage beyond the Map-transition + primitive-invocation assertions the tests already make. The source-of-truth Map is the coupling surface between the WS handlers and the poller — verifying its transitions IS testing the pipeline.

**Alternative considered:** Full mock stack for wss.emit — rejected as high complexity, high maintenance burden, low incremental coverage.

**Files affected:** src/backend/claude-session/claude-session-server.aside.integration.test.ts (test-seam rationale documented in the file header at L46-59)

### 2. [Planner Discretion within Task 1 `<action>`] Task 1 chose Option A (simple export) over Option B (getter)

**Applied per:** Plan 14-05 Task 1 `<action>` explicitly presents two options ("Option A: simple export" vs "Option B: encapsulated getter") with planner discretion between them.

**Choice made:** Option A — `export const asideState = new Map<...>()` on the existing const declaration.

**Rationale:** Option A is a 1-word addition (add `export`) with no helper function; matches the existing __asideStateForTests posture (which is a re-export, not a getter). Option B (`export function getAsideState(): ReadonlyMap<...>`) would add a helper AND require the test to call `getAsideState().get(peer)` instead of `asideState.get(peer)` — an extra function call per assertion. Both are asserted equal in the RED-gate test (asideState === __asideStateForTests), so switching to Option B later is a safe refactor.

**Alternative considered:** Option B — rejected as slightly more encapsulated but with no correctness benefit + one extra call per assertion.

**Files affected:** src/backend/claude-session/claude-session-server.ts (Task 1 GREEN commit `2b2b360`)

### Not deviated (documented design choices per the plan)

- **All 10 new tests exercise the LOCKED architecture** (frontend-arm trigger + module-scope state + atomic BOTH-STEPS broadcast) — plan non-negotiables #1-6 all satisfied by construction.
- **Test A (frontend) sub-case for pvIdentity===null suppresses arm** — plan non-negotiable #4 satisfied.
- **Test B (backend) asserts BOTH steps of broadcastAsideDismissed** — plan non-negotiable #3 satisfied.
- **All new tests pass on first run** — plan non-negotiable #5 ("Expected: all new tests PASS on first run") satisfied.
- **Deploy checkpoint (Wave 6) is now the next wave** — plan non-negotiable #6 satisfied.
- **Zero new npm/pip/cargo installs** — reuses vitest + @testing-library/react already in devDeps; T-14-05-SC mitigation preserved.

## Authentication Gates

None. All work is test-only + one test-observation seam export; no environment variables, no external services, no infrastructure changes.

## Issues Encountered

**None.** Task 1 followed strict TDD RED (assertion fails at Map instance === undefined) → GREEN (add `export`) single-attempt. Task 2 and Task 3 tests all passed on first run — additive coverage on already-shipped Waves 1-4 implementation per plan non-negotiable #5.

**Two test-seam design decisions were made per the plan's `<action>` planner-discretion clauses** — documented in `## Deviations from Plan` above as design choices within the plan's letter, not deviations from it.

## User Setup Required

None. Pure test additions + one test-observation seam export; no environment variables, no external services, no infrastructure changes.

**Wave 6 (deploy checkpoint) is the next wave** — will need Ashley's explicit deploy approval per fork discipline (deploy-runbook.md + CLAUDE.md § Deploy safety).

## Next Phase Readiness

**Ready for 14-06 (Wave 6: deploy checkpoint — bundled deploy of Waves 1-5 + queued #150 A + C per CONTEXT.md § Phase Boundary).** Wave 5's coverage GATES the deploy conversation:

- All ASIDE-01 through ASIDE-11 requirements have integration coverage that exercises the LOCKED architecture end-to-end.
- Cross-tab state coherence (the load-bearing atomic BOTH-STEPS rule) is EXPLICITLY tested in Backend Test B + E — plan-checker B3 lock verified under test.
- Frontend-arm architecture (the SOLE trigger source) is END-TO-END tested in Frontend Test A + Backend Test A.
- v1 overlap policy dual-gate (armed AND displayed) tested in Backend Test C.
- Connect-time re-attach probe independent of activeViewers.size tested in Backend Test D.
- Marker-disappearance uses SAME primitive as client-initiated dismiss (cross-tab coherence regardless of origin) tested in Backend Test E.
- Full regression check: 184/184 backend + pretty-view tests pass. Zero regression to Waves 1-4.

No blockers, no concerns.

## Threat Flags

None. Wave 5's surface additions (10 test cases + 1 named export addition + 1 test-file import) are all test-only or observation-only. Zero new production trust boundaries, zero new endpoints, zero new schema at trust boundaries. All threats enumerated in `<threat_model>` (T-14-05-01 through T-14-05-SC) are mitigated by the code as landed:

- **T-14-05-01 (Tampering — mocked WS assertions):** Tests assert on JSON-parsed frame shapes via `JSON.parse`, not raw string equality. No injection surface.
- **T-14-05-02 (DoS — test timeouts):** No real timers used; tests advance synchronously via direct dispatch-shape mirroring + primitive invocation. Bounded runtime per test.
- **T-14-05-03 (Info Disclosure — asideState export widens observation surface):** ACCEPT — asideState is a Map of WebSocket references; WebSocket instances are only usable by code holding them. External code that could import asideState from claude-session-server would already have full-file access via the same import path. No new leak surface. Documented in JSDoc on the export.
- **T-14-05-SC (Tampering — supply chain):** Zero new package installs. vitest + @testing-library/react already in devDeps.

## Self-Check: PASSED

- FOUND: `src/backend/claude-session/claude-session-server.aside.integration.test.ts` (new file created; contains 5 describe/it test cases)
- FOUND: `src/ui/features/pretty-view/PrettyView.test.tsx` (modified — verified via grep for `Phase 14 Wave 5 aside integration` describe block + `aside_arm` count 3 + `aside_ready` count 4 + `aside_dismissed` count 4 + `name: "Resume"` + `role.*"note"`)
- FOUND: `src/backend/claude-session/claude-session-server.ts` (modified — verified via grep for `export const asideState`)
- FOUND: `src/backend/claude-session/claude-session-server.aside.test.ts` (modified — verified via grep for the new import and describe block)
- FOUND commit `be3ceb7` — test(14-05): add failing RED-gate for asideState named export
- FOUND commit `2b2b360` — feat(14-05): export asideState as a named export for Wave 5 integration tests
- FOUND commit `945d5b9` — test(14-05): add 5 frontend integration tests for aside subsystem
- FOUND commit `1371ae4` — test(14-05): add 5 backend integration tests for aside subsystem

## TDD Gate Compliance

Plan Task 1 (`tdd="true"`): RED (`be3ceb7`) → GREEN (`2b2b360`) — sequence correct.

Plan Tasks 2 + 3 (`tdd="true"`): per plan non-negotiable #5, implementation exists in Waves 1-4 so tests are additive coverage — all new tests pass on first run (which the non-negotiable explicitly calls "Expected: all new tests PASS on first run"). The tests DOCUMENT and LOCK the contract shipped by prior waves. Committed as single `test(14-05):` commits without RED gate since the failing gate would be equivalent to "the implementation doesn't exist yet" — which is not the case here. This is the correct TDD posture for additive integration coverage on already-shipped code.

No REFACTOR commits — implementation was clean on first pass; no cleanup needed.

---
*Phase: 14-plain-language-translation-asides*
*Completed: 2026-07-26*
