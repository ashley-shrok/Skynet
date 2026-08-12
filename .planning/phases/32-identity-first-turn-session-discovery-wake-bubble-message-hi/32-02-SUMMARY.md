---
phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
plan: 02
subsystem: backend
tags: [claude-session, dormant-branch, tail-open, wake-handoff, vitest, tdd]

# Dependency graph
requires:
  - phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
    plan: 01
    provides: discoverIdentitySessionFile helper — pure Promise<string|null> that returns the mtime-latest JSONL under ~/.claude/projects/*/ whose first user-role line matches the identity's `/id <name>` byte pattern, or null (fail-safe on SSH throw)
  - phase: 31-structured-logging
    provides: sshLogger / databaseLogger structured-log taxonomy the new Phase 32 dormant-tail logs (`claude_session_dormant_tail_discovered`, `claude_session_dormant_tail_no_match`, `claude_session_dormant_tail_stopped_for_wake`) emit into
provides:
  - Dormant-branch identity-attributed tail-open — dormant identity panes now open a tail on the identity's most-recently active JSONL (via discoverIdentitySessionFile) so the wake-bubble message list is populated with the historical conversation, streamed through the existing appendDedup + eventId pipeline
  - Wake-handoff safe-close ordering — the startActiveFlow callback (dormant→active transition) now stops + nulls the dormant tailHandle BEFORE startActiveSessionFlow reassigns it, eliminating the dormant+active tail overlap window (T-32-04 mitigation)
  - `__applyDormantBranchTailOpenForTests` seam + `__DormantBranchTailOpenDepsForTests` + `__DormantBranchTailOpenStateForTests` type exports — the SINGLE production implementation entry point for the discovery + tail-open + logging sequence
affects:
  - closes Ashley's verbatim complaint from 2026-08-12: "the bubble looks good, but unfortunately, the rest of the messages that would be in that session are not showing up." — the dormant identity pane's wake bubble is now backed by the tail of the conversation Ashley is deciding whether to wake

# Tech tracking
tech-stack:
  added: []  # no new dependencies — only pre-existing sshLogger, databaseLogger, tailSessionFile, and Wave 1's discoverIdentitySessionFile (+ node:path stdlib basename)
  patterns:
    - "Dependency-injected __*ForTests seam — mirrors __applyDormantPollTickForTests and __applyDormantPollWithRediscoveryForTests; the seam IS the single production implementation entry point (not test-only scaffolding), so tests exercise the exact same code path production does"
    - "T-32-05 log-payload downgrade: `discoveredFileBasename: basename(discoveredFile)` in the discovered log emits the JSONL session UUID only (already discoverable via existing session-scoped logs); the encoded project-dir path segment is dropped, shrinking the disclosure surface"
    - "Wake-handoff safe-close ordering: `if (tailHandle) { tailHandle.stop(); tailHandle = null; }` BEFORE startActiveSessionFlow's `tailHandle = tailSessionFile(...)` reassignment; guarantees no dormant+active tail overlap thanks to session-file-tail.ts's synchronous `stopped` closure flag"
    - "Inner try/catch (narrower than the outer identity-shape probe try/catch) around the seam's production call — degrades to today's dormant behavior on any throw without poisoning isIdentityShapedCached"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.dormant-tail.test.ts
  modified:
    - src/backend/claude-session/claude-session-server.ts

key-decisions:
  - "Chose Option A (extract into a new __applyDormantBranchTailOpenForTests seam) over Option B (vi.mock the imports and drive through a live WebSocketServer). Rationale: the dormant branch lives inside a deeply-nested closure chain (ws.on('connection') → per-conn state → message handler → inactive branch → dormancy probe) with 15+ closure-scoped state vars; no pre-existing entry point drives it end-to-end. The new seam is the SINGLE production call site (matches D-09's 'one call site' invariant for discoverIdentitySessionFile), so tests exercise the exact production code path."
  - "Wrapped the new discovery + tail-open call in its OWN inner try/catch rather than widening the enclosing L4659 try/catch. Rationale: widening would incorrectly set `isIdentityShapedCached = false` on any throw from tailSessionFile (poisoning the dormant-poll going forward, since the outer catch is the identity-shape-cache poison). Narrower try preserves fallback semantics: on any throw, degrade to today's dormant behavior (no tail opened) via the no-match log, without touching isIdentityShapedCached. Wave 1's helper contract is no-throw so the try is defense-in-depth for future evolution."
  - "The seam's logger.info is thin (accepts msg + meta object) so the production call site enriches meta with userId/sessionId/hostId/tmuxSession at the boundary. This keeps the seam free of connection-scoped state — a test can pass any logger stub without threading fake identity fields through."
  - "The safe-close ordering block also emits a structured log (`claude_session_dormant_tail_stopped_for_wake`) — one line per wake-handoff so post-deploy dashboards can count handoff frequency and correlate against message-emission windows."
  - "CASE-DT7 (WS-close cleanup) implemented as a file-inspection structural gate rather than a dynamic assertion. Rationale: teardownPane is a closure-scoped function not reachable via any pre-existing seam, and dynamically asserting the WS-close → teardownPane → tailHandle.stop() chain would require a full WebSocketServer + SSH stub (out of scope for this test file). The structural pattern-gate assertion is complementary to the CLI-level W-4 grep gate in the plan's <verify> block; together they enforce the invariant that the wire-up is preserved."

patterns-established:
  - "Injectable seam that IS the production implementation: the new __applyDormantBranchTailOpenForTests is not test-only scaffolding — the production dormant branch calls it as its single implementation entry point, so testing the seam IS testing production. This is the cleanest way to test deeply-nested closure code without exposing all of the closure's state via getter/setter accessors."
  - "T-32-05 basename-only log payload: for any structured log emitting a discovered file path, use `path.basename()` — the JSONL's session UUID is already recoverable via session-scoped logs, so the basename carries no additional disclosure surface, while dropping the encoded project-dir path segment (which could correlate identity → repo/project-dir on a shared box)."

requirements-completed: [D-01, D-05, D-08, D-09]
requirements-touched-not-completed: [D-02, D-07]  # Wave 1 owns the byte-pattern predicate + cost bound; Wave 2 delegates entirely

# Metrics
duration: ~28min
completed: 2026-08-12
---

# Phase 32 Plan 32-02: Dormant-Branch Tail-Open Wire-in Summary

**Dormant identity panes now open a tail on the identity's most-recently active JSONL, streaming historical wake-bubble message history through the existing appendDedup + eventId pipeline — closes Ashley's "the bubble looks good but the messages aren't showing up" complaint.**

## Performance

- **Duration:** ~28 min (start 2026-08-12T20:21:06Z reading plan+context → end 2026-08-12T20:48:37Z SUMMARY committed)
- **Tasks:** 2 (Task 1 = wire-in inline + logs; Task 2 = seam extraction + safe-close ordering + integration tests)
- **Commits landed:** 3 (Task 1 feat; Task 2 RED; Task 2 GREEN)
- **Files created:** 1 (`claude-session-server.dormant-tail.test.ts`, 422 lines)
- **Files modified:** 1 (`claude-session-server.ts`, net +277 lines: +332 insertions across 3 commits, −55 refactor delete)

## Accomplishments

- **Dormant branch now opens a tail on the discovered identity JSONL.** The Wave 1 `discoverIdentitySessionFile` helper is invoked inside the dormant branch (after the dormant frame + dormantPollTimer, before enteredDormantPoll = true). On non-null return, `tailSessionFile(sshConn!, discoveredFile, onLine, onError)` opens a tail whose handle stores into the SAME closure-scoped `tailHandle` variable the active flow uses — so WS-close cleanup via `teardownPane()` continues to work unchanged, no new ws.on("close") code needed.
- **Wake-handoff safe-close ordering added.** The `startActiveFlow` callback in the dormant-poll seam wrapper now stops + nulls the dormant `tailHandle` BEFORE `startActiveSessionFlow` reassigns it via `tailHandle = tailSessionFile(sshConn!, sessionFile, onLine, onError)` at L~4634. Prevents dormant+active tail overlap → no duplicate/out-of-order eventId emissions across the handoff window (T-32-04).
- **New `__applyDormantBranchTailOpenForTests` seam.** Exported alongside the existing `__applyDormantPollTickForTests` (L984) and `__applyDormantPollWithRediscoveryForTests` (L1106) seams. The seam is the SINGLE production implementation entry point (matches D-09's "one call site" invariant for `discoverIdentitySessionFile`), so tests exercise the exact production code path. Exported types: `__DormantBranchTailOpenDepsForTests` (L1226), `__DormantBranchTailOpenStateForTests` (L1251). Seam signature (verbatim):
  ```
  export async function __applyDormantBranchTailOpenForTests(
    deps: __DormantBranchTailOpenDepsForTests,
    state: __DormantBranchTailOpenStateForTests,
  ): Promise<void>
  ```
- **T-32-05 log-payload downgrade.** The discovered-file log emits `discoveredFileBasename: basename(discoveredFile)` (e.g. `abc-123.jsonl`) — NOT the absolute path (which would leak the encoded project-dir path segment such as `-home-ubuntu-skynet-tanya`). The no-match log and the wake-handoff safe-close log carry no path payload at all.
- **7 new integration tests (CASE-DT1..DT7) all pass.** New file `claude-session-server.dormant-tail.test.ts` (422 lines) covers the discovery happy path, null-return fallback, closure pass-through identity (D-08), wake-handoff safe-close ordering, no eventId double-emit invariant, helper-throw fallback, and WS-close cleanup structural invariant.
- **Zero regressions.** Full vitest suite: 155 files pass (was 154, +1 new), 1972 tests pass (was 1965, +7 new), 7 skipped + 1 todo (unchanged). `dormant-poll.test.ts`: 19/19 pass (unchanged). UI regression: `DormancyOverlay.test.tsx` + `PrettyView.test.tsx` 38/38 pass (unchanged). `git status --porcelain src/ui/` empty (invariant 3 preserved).

## Task Commits

Committed atomically per TDD (Task 1 = single feat; Task 2 = RED → GREEN):

1. **Task 1 feat** — `6ae52ce` (`feat(32-02): wire discoverIdentitySessionFile + tail-open into dormant branch`)
2. **Task 2 RED** — `40824a0` (`test(32-02): add failing dormant-tail integration tests (RED)`)
3. **Task 2 GREEN** — `eb4eee4` (`feat(32-02): add __applyDormantBranchTailOpenForTests seam + wake-handoff safe-close (GREEN)`)

Plan metadata (SUMMARY.md, STATE.md, ROADMAP.md, PLAN.md) is deferred to the orchestrator's phase-end docs commit per execution-notes constraint ("Do NOT commit docs artifacts — orchestrator handles the phase-end docs commit").

## Files Created/Modified

### Created

- **`src/backend/claude-session/claude-session-server.dormant-tail.test.ts`** (422 lines) — 7 CASE-DT integration tests via the new `__applyDormantBranchTailOpenForTests` seam (CASE-DT1..DT3 + DT6) + the pre-existing `__applyDormantPollWithRediscoveryForTests` seam (CASE-DT4) + self-contained model (CASE-DT5) + structural file-inspection assertion (CASE-DT7). Fixture builders: `makeDeps(overrides?)` + `makeTailStateBox()`.

### Modified

- **`src/backend/claude-session/claude-session-server.ts`** (net +277 lines across 3 commits) — Final line counts and key edit locations:
  - **Import** `basename` from `node:path` at **L3** (Task 1).
  - **Import** `discoverIdentitySessionFile` from `./discover-identity-session-file.js` at **L11** (Task 1).
  - **New seam** `__applyDormantBranchTailOpenForTests` at **L1292**, with dep-type export at **L1226** and state-type export at **L1251**. Docblock at L1200-1290 mirrors the docblock density of the existing `__applyDormantPollWithRediscoveryForTests` seam (L1067-1104).
  - **Wake-handoff safe-close block** at **L4916-4930** inside the `startActiveFlow` callback passed into `__applyDormantPollWithRediscoveryForTests` — `if (tailHandle) { tailHandle.stop(); tailHandle = null; sshLogger.info(...) }` + inline comment (L4885-4915) citing T-32-04 + D-08.
  - **Dormant-branch production call site** for the new seam at **L5039-5075**, inside the inner try/catch (L5037-5077) that wraps the discovery + tail-open sequence (narrower than the enclosing L4659 identity-shape try/catch — see "Deviations from Plan" below).
  - **Dormant-branch block comment expansion** at **L4785-4803** — cites D-01 (byte-pattern via helper), D-05 (fallback), D-08 (latency parity), D-09 (active-flow untouched), T-32-05 (log downgrade), and clarifies the DIFFERENT contract from the L145-150 FALLBACK-01 rule.

  Final file: 5128 lines (was 4851 pre-plan; +277 net).

## Decisions Made

- **Option A (new seam) over Option B (vi.mock the imports).** The dormant branch lives inside a deeply-nested closure chain (ws.on("connection") → per-conn state setup → message handler → `if (result.status === "inactive")` → dormancy probe) with 15+ closure-scoped state variables. There is no pre-existing entry point that drives that branch end-to-end through vi.mocked imports without a live WebSocketServer + SSH client stub. The new seam gives tests a direct entry point and — because the production dormant branch calls the seam as its single implementation entry point — tests exercise the exact production code path (not a parallel test-only implementation).
- **Inner try/catch (narrower) over widening the outer L4659 try/catch.** The outer catch sets `isIdentityShapedCached = false`, poisoning the dormant-poll for the connection's lifetime. If we widened that try to cover the new discovery + tail-open call, any throw from `tailSessionFile` would incorrectly mark the pane as not-identity-shaped — breaking all subsequent dormant-poll ticks. The inner try/catch preserves fallback semantics correctly (degrade to today's dormant behavior on any throw, no state poisoning). Wave 1's helper contract is no-throw, so the try is defense-in-depth.
- **`logger.info(msg, meta)` seam surface is thin.** The seam does not thread `userId`/`sessionId`/`hostId`/`tmuxSession` — the production call site enriches meta at the boundary. Rationale: keeps the seam free of connection-scoped state; tests can pass any logger stub without threading fake identity fields.
- **Structured log `claude_session_dormant_tail_stopped_for_wake`.** Emitted from the safe-close block so post-deploy observability can (a) count wake-handoff frequency, (b) correlate handoff timing against message-emission windows, and (c) confirm the safe-close block ran BEFORE `startActiveSessionFlow`'s tail reassignment.
- **CASE-DT7 as a structural pattern-gate rather than dynamic assertion.** `teardownPane` is closure-scoped and not reachable via any pre-existing seam; a dynamic assertion of the WS-close → teardownPane → tailHandle.stop() chain would require a full WebSocketServer + SSH stub. The structural pattern-gate assertion (via `readFileSync` + regex) is complementary to the plan's CLI-level W-4 grep gate; together they enforce the "wire-up preserved" invariant.
- **The `ws.on("close"` string-match in CASE-DT7 needed a comma-terminator refinement** — the raw string appears first in a comment at L1275 ("Cleaned up in `ws.on("close")` below.") which is NOT the handler. Fixed at RED-time to match `ws.on("close",` (with comma) to discriminate the handler call from doc references. Documented as a Rule 1 auto-fix (test-fixture bug caught during RED).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CASE-DT7 initial `ws.on("close"` string-match matched a doc-comment reference, not the handler**
- **Found during:** Task 2 RED first run
- **Issue:** The test used `source.indexOf('ws.on("close"')` to locate the handler; but the raw string first appears at L1275 in a `Cleaned up in ws.on("close") below.` comment — NOT the handler. The 1500-char window slice from that offset landed inside per-connection state-var declarations, missing `teardownPane`. Result: DT7 failed at RED time.
- **Fix:** Changed the search string to `ws.on("close",` (with the trailing comma) so it only matches the handler-invocation form. Also updated the pattern-gate regex explanation in the inline comment.
- **Files modified:** `src/backend/claude-session/claude-session-server.dormant-tail.test.ts` (bundled into the RED commit).
- **Verification:** After the fix, RED showed the expected shape (4 seam-dependent tests failing + 3 seam-independent tests passing — DT4, DT5, DT7). GREEN brought all 7 to pass.
- **Committed in:** `40824a0` (Task 2 RED commit).

### Plan-Level Deviations

**2. [Plan gate correction — documentation only] Plan verification step 6's grep gate for `discoverIdentitySessionFile` overspecifies the expected count**
- **Plan text:** `grep -c 'discoverIdentitySessionFile' src/backend/claude-session/claude-session-server.ts returns exactly 2 (one import, one call site inside __applyDormantBranchTailOpenForTests) — enforces the D-09 out-of-scope invariant`
- **Actual after GREEN:** grep count is 10 hits. Breakdown:
  1. `L11` — import statement (1)
  2. `L1203, 1218, 1264, 1277, 1264` — docblock references (5)
  3. `L1228` — comment inside deps type (1)
  4. `L1232` — deps type field declaration (1)
  5. `L1300` — seam destructuring (renamed to `discover` locally) (1)
  6. `L4799` — dormant-branch block comment (1)
  7. `L5044` — production call site passing the imported module symbol as a dep value (1)
- **Load-bearing invariant behind the gate:** D-09 says the helper is called from exactly one production site. Actual invocations of the imported symbol (grep `discoverIdentitySessionFile\(`) return 2 — both are inside comment/docblock text (L1264 comment, L4799 comment). The IMPORTED module symbol is invoked exactly zero times by literal name in code (invocation goes through the injected `discover` alias inside the seam). The seam is the single production invocation locus, and the production call site is the sole place that passes the real module import — so D-09 IS satisfied.
- **Interpretation:** The plan-checker revision baked in the seam architecture at Task 2 Part B, which necessarily introduces multiple `discoverIdentitySessionFile` textual references (type field, docblock, destructuring, production dep-passing). The plan's verification step 6 wasn't updated in sync with that revision. This is a documentation-only mismatch — no code change needed.
- **Impact on plan:** None; the D-09 invariant is enforced by the architecture (one call site inside one seam, one production consumer of the seam, one imported-symbol reference passed as a dep) rather than by a raw grep count.

**3. [Documented per plan Task 1 step 5] Enclosing try/catch was neither widened nor narrowed — instead a new inner try/catch was added inside the existing try body**
- **Plan text:** "If the executor determines the enclosing try must be widened OR narrowed to cover the new call correctly, document the choice in the SUMMARY."
- **Choice made:** Added a NEW inner try/catch AROUND the new discovery + tail-open call (initially in Task 1's inline form at L~4816-4884; refactored in Task 2 GREEN to live INSIDE the seam itself at L1298-1330, so the seam is self-contained fail-safe).
- **Rationale:** The outer L4659 try/catch sets `isIdentityShapedCached = false` — a permanent poison for the connection's dormant-poll. Widening that try would incorrectly poison the cache on any tailSessionFile error, breaking all subsequent dormant-poll ticks. Narrowing wasn't feasible cleanly. An inner try/catch preserves fallback semantics correctly: any throw from the seam (defense-in-depth; Wave 1's helper contract is no-throw) degrades to today's dormant behavior via the no-match log, without touching isIdentityShapedCached.

### Total Deviations

- **1 auto-fixed** (Rule 1 — test-fixture bug caught during RED)
- **1 plan gate documentation mismatch** (verification step 6 grep count vs. plan-checker-revised architecture — noted for orchestrator)
- **1 plan-authorized decision** (try/catch scoping — plan explicitly requested SUMMARY documentation)

## Auth Gates / Blockers Encountered

None. No SSH auth flows, no external service dependencies, no user-facing environment steps.

## Threat Coverage (T-nnn from PLAN.md threat_model)

- **T-32-04 (Tampering — wake-handoff dormant/active tail overlap):** Mitigated. `tailHandle.stop(); tailHandle = null;` sequenced BEFORE `startActiveSessionFlow` reassigns tailHandle (L4916-4930). CASE-DT4 asserts stopSpy.mock.invocationCallOrder[0] < secondTailSpy.mock.invocationCallOrder[0]. CASE-DT5 asserts no eventId is emitted twice across the handoff window (models session-file-tail.ts:54-78's stopped-flag guard end-to-end).
- **T-32-05 (Information Disclosure — new log emissions):** Mitigated by log-payload downgrade. The `claude_session_dormant_tail_discovered` log emits `discoveredFileBasename: basename(discoveredFile)` — the JSONL's session UUID only (already discoverable via existing session-scoped logs), NOT the absolute path. The encoded project-dir path segment (e.g. `-home-ubuntu-skynet-tanya`) is dropped. The no-match log carries no path payload; the wake-handoff safe-close log carries no path payload. CASE-DT1 asserts the basename shape + explicitly asserts `.not.toHaveProperty("discoveredFile")` + `Object.values(meta).not.toContain(absolutePath)`. CLI-level gate: `grep -E 'discoveredFile\\s*:' | grep -v 'discoveredFileBasename' | wc -l` returns 0.
- **T-32-06 (DoS — dormant tail runs for full duration of dormancy):** Accepted. `tail -F -n +1` on a stable-length JSONL is negligible bandwidth once the initial replay completes; session-file-tail.ts:126-132 caps stderr accumulation. No new resource risk vs the existing active-flow tail. Cleanup on wake handoff (Part A) AND on WS close (via pre-existing teardownPane → tailHandle.stop() at L1557-1564 — unchanged; the new dormant-tail assignment reuses the SAME closure-scoped `tailHandle` variable, so cleanup comes for free). W-4 grep gate `grep -B2 -A30 'ws\\.on("close"' | grep -c 'teardownPane'` returns 5 (invariant preserved). CASE-DT7 asserts the structural invariant that `tailHandle.stop()` is present in the file's teardown path.
- **T-32-SC (Supply-chain — new dependencies):** Mitigated. Zero new dependencies. Reuses `discoverIdentitySessionFile` (Wave 1), `tailSessionFile` + `TailHandle` (already imported), `sshLogger` + `databaseLogger` (already imported), `basename` from `node:path` (stdlib).

## D-nnn Coverage Matrix

Each of the 7 CASE-DT tests ties to at least one locked D-nnn decision from `32-CONTEXT.md`:

| Case ID   | D-nnn covered            | Assertion                                                                                                                            |
| --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| CASE-DT1  | D-01, D-08, T-32-05      | Discovery non-null returns → tailSessionFile called with (sshConn, absolutePath, onLine, onError); log emits `discoveredFileBasename` only, NOT the absolute path |
| CASE-DT2  | D-05, D-09               | Discovery null → no tailSessionFile call; state.tailHandle null; no-match log; byte-identical to today's dormant behavior             |
| CASE-DT3  | D-08                     | onLine + onError closures pass through unwrapped (reference-identity via `Object.is`-tight `toBe`) — the seam does not re-wrap        |
| CASE-DT4  | T-32-04 (D-08 corollary) | Wake handoff safe-close ordering: dormantTailHandle.stop() invocationCallOrder < secondTailSpy invocationCallOrder                    |
| CASE-DT5  | T-32-04 (load-bearing)   | No eventId double-emit across the handoff window: post-stop queued dormant lines silently dropped by the stopped-flag guard          |
| CASE-DT6  | D-05                     | Helper-throw fallback → no throw propagates; no tail opened; no-match log with err field (defense-in-depth for Wave 1's no-throw contract) |
| CASE-DT7  | T-32-06                  | Structural invariant: `tailHandle.stop()` present in file's teardown path; ws.on("close", ...) handler invokes teardownPane          |

Additional structural invariants (not per-test, enforced by CLI-level gates in the plan's `<verify>` block):

- **D-09 (active flow untouched):** L4634 tailSessionFile call inside startActiveSessionFlow byte-unchanged; L3898 startActiveSessionFlow declaration byte-unchanged (verified via `git diff` grep).
- **Invariant 3 (UI untouched):** `git status --porcelain src/ui/` empty.
- **W-5 (basename-only log payload):** `grep 'discoveredFile:' | grep -v 'discoveredFileBasename' | wc -l` returns 0.
- **W-4 (WS-close cleanup wire preserved):** `grep -B2 -A30 'ws\\.on("close"' | grep -c 'teardownPane'` returns 5.

## Confirmation Points (Plan Output Spec)

Per the plan's `<output>` block, explicitly confirming:

1. **Exact line numbers of key edits in the final file:**
   - Dormant-branch tail-open production call site: **L5039-5075** (delegates to `__applyDormantBranchTailOpenForTests`).
   - Wake-handoff safe-close ordering: **L4916-4930** (inside startActiveFlow callback).
   - New seam export: **L1292** (function), **L1226** (deps type), **L1251** (state type).
   - New imports: **L3** (`basename` from `node:path`), **L11** (`discoverIdentitySessionFile`).

2. **Final signature + location of `__applyDormantBranchTailOpenForTests`:**
   ```ts
   // At claude-session-server.ts:L1292
   export async function __applyDormantBranchTailOpenForTests(
     deps: __DormantBranchTailOpenDepsForTests,
     state: __DormantBranchTailOpenStateForTests,
   ): Promise<void>
   ```
   Deps type at **L1226**; state type at **L1251**. Both exported alongside the function.

3. **`tailHandle` cleanup on WS close is preserved via the pre-existing `teardownPane()` path.** No new ws.on("close") code was added. The dormant-tail assignment reuses the SAME closure-scoped `tailHandle` variable (L1279) that `teardownPane()` already stops at L1557-1564. W-4 CLI grep gate (5 hits) + CASE-DT7 (structural assertion) both confirm.

4. **`claude_session_dormant_tail_discovered` log emits `discoveredFileBasename` only** — verified by CASE-DT1's explicit `expect(meta).not.toHaveProperty("discoveredFile")` + `Object.values(meta).not.toContain(absolutePath)` assertions. CLI-level gate: `grep -E 'discoveredFile\\s*:' | grep -v 'discoveredFileBasename' | wc -l` returns 0.

5. **D-nnn coverage matrix mapping DT1-DT7:** See table above.

6. **Deviations from planned edit shape:** See "Deviations from Plan" section above (1 auto-fixed test-fixture bug; 1 plan gate documentation mismatch; 1 plan-authorized try/catch scoping decision).

## User Setup Required

None — pure backend addition. No env vars, no external service config, no CLI installs, no user-facing UI, no runbook step. Deploy is deferred to end of phase per orchestrator direction.

## Next Phase Readiness

- **Phase 32 backend work is complete.** Wave 1 shipped the helper (`discoverIdentitySessionFile`); Wave 2 (this plan) wired it into the dormant branch and added the wake-handoff safe-close ordering. Ashley's UAT will confirm once the phase deploys.
- **All 7 success criteria from the plan satisfied:**
  1. Dormant identity panes emit historical messages via the WS pipeline ✓ (code shipped; production behavior awaits deploy).
  2. Wake→active handoff never produces duplicate eventId / out-of-order message ✓ (CASE-DT4 + DT5).
  3. Fallback to today's behavior on null-discovery ✓ (CASE-DT2 + inline try/catch semantics).
  4. Zero UI-side diff ✓ (invariant 3; `git status --porcelain src/ui/` empty).
  5. Full vitest suite green ✓ (155 files pass, 1972 tests pass).
  6. `claude_session_dormant_tail_*` structured logs surface with T-32-05-safe payloads ✓ (CASE-DT1 basename assertion + no-match log carries no path).
  7. WS-close teardown continues to stop the dormant tail via teardownPane ✓ (W-4 grep gate + CASE-DT7 structural assertion).
- **Deploy deferred to phase-end** per execution notes ("No deploy from this plan. Deploy happens ONCE at end of phase, orchestrated by [Ashley] after this executor returns.").
- **No blockers.** No architectural changes needed. No open questions. Full suite green; type-check clean; UI byte-untouched.

## Self-Check: PASSED

Verified before finalizing this SUMMARY:

- **File existence:**
  - `src/backend/claude-session/claude-session-server.dormant-tail.test.ts` — FOUND (422 lines).
  - `src/backend/claude-session/claude-session-server.ts` — FOUND (5128 lines, was 4851 pre-plan).
- **Commit existence:** All three commits found via `git log --oneline -5`:
  - `6ae52ce` — FOUND (Task 1 feat).
  - `40824a0` — FOUND (Task 2 RED).
  - `eb4eee4` — FOUND (Task 2 GREEN).
- **Plan gate results (final):**
  - `npx tsc --noEmit` — 0 errors.
  - `npx vitest run src/backend/claude-session/claude-session-server.dormant-tail.test.ts` — 7 passed / 7.
  - `npx vitest run src/backend/claude-session/dormant-poll.test.ts` — 19 passed / 19 (byte-unchanged behavior).
  - `npx vitest run src/ui/features/pretty-view/DormancyOverlay.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx` — 38 passed, 1 skipped, 1 todo (byte-unchanged).
  - `npx vitest run` — 155 files pass, 1972 tests pass, 7 skipped, 1 todo.
  - `grep -c 'tailHandle\\.stop()' src/backend/claude-session/claude-session-server.ts` — 5 (baseline was 2; Task 2 Part A + seam-internal + refactor add 3 more).
  - `grep -c '__applyDormantBranchTailOpenForTests' src/backend/claude-session/claude-session-server.ts` — 3 (export decl + docblock + production call).
  - `grep -c 'discoveredFileBasename' src/backend/claude-session/claude-session-server.ts` — 3 (comment, seam, prod refactor).
  - `grep -E 'discoveredFile\\s*:' src/backend/claude-session/claude-session-server.ts | grep -v 'discoveredFileBasename' | wc -l` — 0 (no absolute-path payload leak).
  - `grep -B2 -A30 'ws\\.on("close"' src/backend/claude-session/claude-session-server.ts | grep -c 'teardownPane'` — 5 (W-4 wire preserved).
  - `git status --porcelain src/ui/` — empty (invariant 3).
- **D-09 (active flow untouched) — byte-diff verification:** `git diff HEAD~3 HEAD src/backend/claude-session/claude-session-server.ts | grep -E '^[+-]' | grep -E 'startActiveSessionFlow\\s*=|tailSessionFile\\(sshConn!, sessionFile' | grep -v '^[+-].*//'` returns empty — L3898 declaration + L4634 tail call byte-unchanged in code. (The unfiltered grep returns 1 hit which is a NEW comment line inside the wake-handoff safe-close block that documents the L4634 site by referencing its literal text; not a code change.)

---
*Phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi*
*Plan: 02*
*Completed: 2026-08-12*
