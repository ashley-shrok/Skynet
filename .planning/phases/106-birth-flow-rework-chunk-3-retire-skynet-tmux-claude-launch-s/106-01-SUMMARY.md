---
phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
plan: 01
subsystem: backend
tags: [sse, ssh, tmux, matrix, birth-flow, supervisor, agent-lifecycle]

# Dependency graph
requires:
  - phase: 05-chunk-1-supervisor-mode-a-retired (commit 5f6efd29)
    provides: agent-supervisor.sh single-behavior scan-disk-for-identities loop (makes the sole-spawner handoff safe — supervisor now reliably notices any identity Skynet writes to disk on its 15s reconcile tick)
  - phase: 06-chunk-2-workspace-path-fallback (commit 6cdff0ab)
    provides: identity-birth.ts substitution of `~/fleet/identities/<name>/workspace/` when body.path is empty (vestigial after this chunk lands but preserved per D-04 — shell-only branch still needs the path field)
  - phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
    provides: `discoverIdentitySessionFile(conn, identityName)` sensor — reused verbatim as the "agent is alive" signal for the new wait-for-supervisor poll
provides:
  - Backend birth orchestrator with tmux + harness invocations retired
  - Bounded wait-for-supervisor poll block (2s cadence, 120s ceiling)
  - Widened BirthEvent.ended type with `reason?: string` on failure paths
  - New BirthDeps.discoverIdentitySessionFile injection point
  - 30s SSE comment-frame keepalive on both birth SSE routes (POST / + POST /retry/:key)
  - Exported sanitizeError helper for wire-parity across birth and retry failure emits
affects: [106-02 (frontend collapse — consumes ended.reason on failure), 106-03 (test rewire — updates existing step:3/4/5 assertions and adds wait-poll coverage), 106-04 (verification + downstream deploy)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSE comment-frame keepalive via setInterval registered post-flushHeaders and torn down in finally"
    - "Bounded wall-clock poll loop using WAIT_FOR_SUPERVISOR_* named constants + await-friendly sleep helper"
    - "Log-forensic wire parity: every ended:false emit carries a sanitized reason string across birth and retry paths"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth.ts
    - src/backend/spawn-requests/worker.ts (Rule 3 auto-fix — BirthDeps widening required matching wire-up)

key-decisions:
  - "sanitizeError helper exported from identity-birth-orchestrator.ts so identity-birth.ts's retry-route wire-parity fix (W-1) can call it directly rather than replicating the 200-char cap + SSH-to-safe-string mapping"
  - "POST /'s outer-catch safety-net emit was ALSO widened to carry reason (D-11 parity extension beyond the plan's explicit scope of retry-route only) — Rule 2 auto-fix for log-forensic completeness"
  - "Local-branch (isLocalHostId=true) wait-for-supervisor block implemented as skip-and-emit-ok per action step 7 — no poll runs; ended:ok:true fires directly. Matches the L1228 pattern where Steps 6/7/8 are also guarded on !useLocal && conn."

patterns-established:
  - "Wire-parity discipline for wire-typed SSE events: when widening a shared BirthEvent variant, EVERY consumer path that emits that variant must be walked and updated in the same plan, not left to leak silently across the wire"
  - "Skynet-side birth completion criterion is now supervisor-observable disk state, not Skynet-driven action — the app writes files and mints the account, then WAITS for the supervisor's visible completion signal (transcript JSONL with /id <name> first-turn) before closing the SSE stream"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12]

# Metrics
duration: ~35min
completed: 2026-09-11
---

# Phase 106 Plan 106-01: birth-flow-supervisor-sole-spawner backend orchestrator reshape — Summary

**Backend birth orchestrator stops opening tmux + launching claude and instead waits (up to 120s, polling every 2s) for agent-supervisor's transcript-file signal that the identity is alive on the target host; both birth SSE routes gain a 30s comment-frame keepalive; every failure emit now carries a sanitized reason string for log-forensic wire parity.**

## Performance

- **Duration:** ~35 min (plan read + reads + edits + build + scoped tests + commit + summary)
- **Started:** 2026-09-11T16:22:00Z (approximate — first tool call)
- **Completed:** 2026-09-11T16:57:00Z
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 3 (2 in-plan + 1 Rule 3 auto-fix)

## Accomplishments

- **Sole-spawner architecture live on the backend.** `tmux new-session` and `startHarnessOnIdentity` are byte-zero in the birth orchestrator (verified by grep). agent-supervisor.sh's 15s reconcile tick becomes the sole party responsible for tmux + claude lifecycle on every managed box; Skynet's job is now: write disk → mint relay → wait for the supervisor's completion signal → close the SSE stream.
- **Bounded wait-for-supervisor poll installed.** `WAIT_FOR_SUPERVISOR_POLL_MS = 2000` and `WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000` are exported named constants; the wait block runs the injected `discoverIdentitySessionFile` sensor every 2s until it returns non-null (→ `ended:ok:true`) or 120s elapses (→ `ended:ok:false` with `reason: "supervisor_wait_timeout"` + structured `databaseLogger.warn` on operation-key `identity_birth_supervisor_wait_timeout`).
- **Q2 no-rollback lock preserved on the timeout path.** The wait-timeout branch does NOT delete the on-disk identity folder, does NOT unlink relay.json, does NOT deactivate the Matrix account. The supervisor may still bring the identity alive after we stopped waiting; log captures the operation-key for post-mortem correlation. Verified against shape file §"What would make it wrong" bullet 4.
- **SSE stream stays warm through the 120s hold.** Both birth SSE routes (POST /identities/birth and POST /identities/birth/retry/:key) now register a 30s `:keepalive\n\n` comment-frame timer immediately after `res.flushHeaders()` and tear it down in `finally` before `res.end()`. 30s cadence protects the wait window from nginx (60s default) and Caddy (30s default) idle-timeouts.
- **Log-forensic wire parity across every failure emit.** BirthEvent's `ended` variant widened with optional `reason?: string`. Populated on: (a) orchestrator's inner runStep catch, (b) runRelayMintAndWrite's runStep catch, (c) orchestrator's outer catch, (d) supervisor-wait timeout, (e) identity-birth.ts retry-route safety-net emit (W-1 fix), (f) identity-birth.ts POST /-route safety-net emit (Rule 2 extension). Frontend ignores the field per D-11; the string exists for backend log-forensics only.

## Task Commits

Each task was committed atomically:

1. **Task 1: retire tmux + harness; add BirthEvent.reason + wait-for-supervisor poll to birthIdentity** — `8626dbc6` (refactor)
2. **Task 2: wire discoverIdentitySessionFile dep + add 30s SSE keepalive in identity-birth.ts** — `934fae06` (feat)

_Executor does not commit metadata — orchestrator handles the final SUMMARY.md + STATE.md commit._

## Files Created/Modified

- `src/backend/database/routes/identity-birth-orchestrator.ts` — retired tmux + harness invocations; added WAIT_FOR_SUPERVISOR_POLL_MS + WAIT_FOR_SUPERVISOR_TIMEOUT_MS constants; widened BirthEvent.ended with optional reason; added BirthDeps.discoverIdentitySessionFile injection point; installed the wait-for-supervisor poll block after the Step 6/7/8 mint sequence (remote branch only per D-06); local branch skips the wait and emits ended:ok:true directly; every ended:false emit now carries reason. Header module comment reflects the new step sequence. Exported sanitizeError for the retry-route wire-parity fix.
- `src/backend/database/routes/identity-birth.ts` — imported discoverIdentitySessionFile from claude-session; wired it into the birth route's BirthDeps; added 30s :keepalive setInterval to both POST / and POST /retry/:key routes with matching clearInterval in each finally; imported sanitizeError; widened POST /-route + retry-route safety-net ended:false emits to carry sanitized reason.
- `src/backend/spawn-requests/worker.ts` — (Rule 3 auto-fix) imported discoverIdentitySessionFile from claude-session and wired it into the worker's BirthDeps assembly — same production import identity-birth.ts uses. Necessary because the spawn-request worker also constructs BirthDeps to invoke birthIdentity; widening the interface without wiring worker.ts would break the backend TypeScript build (`Property 'discoverIdentitySessionFile' is missing in type '{...}'`). Zero behavior change to worker.ts's own flow — the same dep is now available on both paths.

## Exact line ranges (per output spec)

- **identity-birth-orchestrator.ts deletions** (lines refer to the pre-edit file):
  - Line 27: `import { startHarnessOnIdentity } from "./identity-harness-start.js";` — deleted
  - Line 1087: `const escName = shellSingleQuote(opts.name);` — deleted (last remaining reference disappeared with the tmux call)
  - Line 1111 (the tmux exec): `mkdir -p ${escPath} && tmux new-session -d -s ${escName} -c ${escPath} ${TMUX_NEW_SESSION_FLAGS}` → `mkdir -p ${escPath}`
  - Lines 1269-1275 (`await runStep(3, async () => { await startHarnessOnIdentity(...) })`) — deleted
  - Lines 1278-1281 (synthetic step:4/step:5 emit lines) — deleted
  - Lines 1251-1268 (comment block describing Steps 3-5) — replaced with the wait-for-supervisor comment + block

- **identity-birth-orchestrator.ts additions:**
  - New constants block (added around what was line 70): `WAIT_FOR_SUPERVISOR_POLL_MS = 2000` + `WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 120000` with rationale docstrings
  - BirthEvent.ended union widened with optional `reason?: string` field
  - BirthDeps interface widened with `discoverIdentitySessionFile: (conn: SSHClient, identityName: string) => Promise<string | null>` field
  - Module header comment rewritten to reflect new step sequence (steps 1, 2, 6, 7, 8 + wait-for-supervisor block)
  - sanitizeError helper widened to `export function` (was file-local)
  - Wait-for-supervisor poll block installed between the runRelayMintAndWrite call and the ended:ok:true emit — remote-branch-only per D-06 (guarded on `!useLocal && conn`)
  - Outer catch's `emit({ type: "ended", ok: false })` widened to `emit({ type: "ended", ok: false, reason: sanitizeError(e) })`
  - Both runStep catches (birthIdentity inner + runRelayMintAndWrite) widened to include `reason` on the ended:false emit

- **identity-birth.ts additions:**
  - Named import of discoverIdentitySessionFile from ../../claude-session/discover-identity-session-file.js
  - Named import of sanitizeError from ./identity-birth-orchestrator.js
  - 30s setInterval keepalive block registered post-flushHeaders in POST / (~line 337 after edit)
  - 30s setInterval keepalive block registered post-flushHeaders in POST /retry/:key (~line 573 after edit)
  - clearInterval(keepAliveInterval) added to the finally block of POST / before candidate cleanup
  - clearInterval(keepAliveInterval) added to the finally block of POST /retry/:key before conn cleanup
  - discoverIdentitySessionFile wired into the birth route's BirthDeps object literal
  - Retry-route safety-net `emit({ type: "ended", ok: false })` widened to include `reason: sanitizeError(err)` — W-1 fix
  - POST /-route safety-net `emit({ type: "ended", ok: false })` widened to include `reason: sanitizeError(err)` — Rule 2 extension

## Local-branch (isLocalHostId=true) treatment (per output spec)

Implemented as **skip-and-emit-ok** per action step 7. When `isLocalHostId(opts.hostId)` returns true, the wait-for-supervisor block is skipped entirely (guarded on the same `!useLocal && conn` predicate that gates Steps 6/7/8 at L1228 in the pre-edit file). The local branch proceeds directly from Step 2 through the `ended:ok:true` emit with no supervisor-poll runs. Rationale documented inline in the wait block's comment: the exec-user's `~/.claude/projects/` on a local self-birth would need different plumbing than the remote SSH poll uses, and Phase A UAT scope is remote fleet hosts only. This matches the Step 6/7/8 skip pattern already in place.

## Decisions Made

- **sanitizeError export decision.** The plan's action step 6 for Task 2 assumed sanitizeError was already exported from identity-birth-orchestrator.ts ("verify the import exists; add if not"). It was not — the helper was file-local. Rather than replicate the 200-char cap + SSH-to-safe-string mapping in identity-birth.ts, I widened the orchestrator's `function sanitizeError` to `export function sanitizeError` (with a docstring note referencing the Phase 106 + W-1 rationale). Zero behavior change to the orchestrator's own use of the helper.
- **POST /-route safety-net emit widening (Rule 2 extension).** The plan's Task 2 edit 6 explicitly called out the retry-route safety-net emit for W-1 fix (`reason: sanitizeError(err)`). The POST / route's outer-catch safety-net emit at L464 (pre-edit) was the last remaining bare `emit({ type: "ended", ok: false })` on the wire after Task 1's orchestrator widening. Left un-widened, the log-forensic parity argument the plan makes for the retry route would silently break on this parallel path. Widened to match per Rule 2 (missing critical functionality — completeness of the log-forensic wire surface). Documented in commit body.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wire discoverIdentitySessionFile into spawn-requests/worker.ts BirthDeps assembly**
- **Found during:** Task 1 (`npm run build:backend` after widening BirthDeps interface)
- **Issue:** After widening `BirthDeps` in identity-birth-orchestrator.ts to include the new `discoverIdentitySessionFile` field, TypeScript reported `error TS2741: Property 'discoverIdentitySessionFile' is missing in type '{...}' but required in type 'BirthDeps'` at src/backend/spawn-requests/worker.ts:335. The spawn-request worker also constructs a BirthDeps object to invoke birthIdentity on the queue-driven birth path, and any interface widening in the orchestrator requires a matching wire-up on every construction site.
- **Fix:** Imported `discoverIdentitySessionFile` from `../claude-session/discover-identity-session-file.js` and added the same pass-through arrow (`(conn, identityName) => discoverIdentitySessionFile(conn, identityName)`) to worker.ts's `birthDeps` object literal. Same production import identity-birth.ts uses; no wire divergence between the two birth-driver paths.
- **Files modified:** src/backend/spawn-requests/worker.ts
- **Verification:** `npm run build:backend` exits 0 after the fix. No behavior change to worker.ts's own flow — the dep is now available on both paths (SSE-driven and queue-driven birth).
- **Committed in:** 8626dbc6 (Task 1 commit, together with the orchestrator changes since they're a coupled interface widening)

**2. [Rule 2 - Missing Critical] Widen POST /-route safety-net ended:false emit to carry sanitized reason**
- **Found during:** Task 2 acceptance-criteria grep gauntlet (grep found one remaining bare `emit({ type: "ended", ok: false })` after Task 2 edit 6)
- **Issue:** Task 2 edit 6 explicitly called out the retry-route safety-net emit for W-1 wire-parity. The POST / route's outer-catch safety-net emit at (pre-edit) L464 was the last remaining bare `emit({ type: "ended", ok: false })` on the wire — leaving it unwidened would silently break the same log-forensic parity argument the plan makes for the retry route.
- **Fix:** Widened the POST /-route safety-net emit from `emit({ type: "ended", ok: false })` to `emit({ type: "ended", ok: false, reason: sanitizeError(err) })`, matching the retry-route treatment. Kept the existing databaseLogger.error call (unchanged).
- **Files modified:** src/backend/database/routes/identity-birth.ts
- **Verification:** `grep -c 'emit({ type: "ended", ok: false })' src/backend/database/routes/identity-birth.ts` returns 0 (down from 1); backend build stays green.
- **Committed in:** 934fae06 (Task 2 commit, together with the retry-route fix since they're the same D-11 wire-parity motivation)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 2 missing critical)
**Impact on plan:** Both auto-fixes are strictly required for the plan's stated invariants — Rule 3 keeps the backend build green after a shared-interface widening; Rule 2 closes the last bare `ended:false` emit that would have leaked into the wire despite the plan's D-11 log-forensic parity goal. No scope creep — both fixes are within the boundaries the plan set (widen BirthDeps consistently; every ended:false emit carries reason).

## Issues Encountered

- **JSDoc block-comment terminator hazard on the first BirthDeps.discoverIdentitySessionFile docstring.** The initial draft of the field's JSDoc included the literal path fragment `` `~/.claude/projects/*/` `` inside a backtick — but the `*/` inside the backtick was interpreted by TypeScript's parser as the end of the `/** ... */` block comment, cascading into 60+ downstream parse errors ("Property or signature expected", "Module declaration names may only use ' or \" quoted strings", etc.). Resolution: reworded the comment to avoid `*/` inside the docstring — the path fragment is now shown as unbolded text (`~/.claude/projects/` with the "mtime-newest JSONL" phrasing) rather than inside a backtick. Discovered by running `npm run build:backend` after the initial edit and reading the first TS error (line 353) rather than trying to interpret the cascading errors from lines 649+.

## User Setup Required

None — this plan installs zero new npm packages, adds zero new environment variables, and requires zero container/service configuration changes. Downstream deploy motion (per D-22) is orchestrator's remit and happens after the full Phase 106 arc lands.

## Next Phase Readiness

- **Ready for Plan 106-03** (test rewire): existing backend tests are expected to fail on retired step:3/step:4/step:5 assertions and the retired tmux-new-session command wire — 21 test failures across 4 birth test files, all in the retired surface. Plan 106-03 updates those tests and adds new coverage for the wait-for-transcript poll (happy path, timeout path, SSH-error-during-poll case, plus verification that step:6/7/8 still emit for log-forensic purposes per D-12).
- **Wave 1 parallelism preserved.** This plan touched only backend files under `src/backend/database/routes/` (both in-plan) plus `src/backend/spawn-requests/worker.ts` (Rule 3 auto-fix). Plan 106-02 (parallel wave 1) modifies only `src/ui/sidebar/NewSessionDialog.tsx` — no file overlap.
- **Executor remit ends here per D-22.** No push, no deploy, no `docker build`, no `docker compose up` invoked. Container-mutation coordination (coord-room announce, git pull --rebase, full test suite gate, deploy motion) is the orchestrator's remit at ship time for the full Phase 106 arc.

## Verifier double-check callouts

- **Wait-block guard predicate.** The wait-for-supervisor block runs under `if (!useLocal && conn)` — same predicate that guards Steps 6/7/8 (L1228 pre-edit). Verify local-branch tests continue to see `ended:ok:true` with no wait-poll invocations.
- **sanitizeError export non-conflict.** The orchestrator's `sanitizeError` function was file-local before; now `export function sanitizeError`. Verify no downstream consumers were re-declaring or shadowing the name (grep found none, but a fresh scan doesn't hurt).
- **Keepalive frame bytes.** Both `res.write(":keepalive\n\n")` calls use JS string literals with escaped `\n` (real newlines when the string is evaluated). Verify the on-wire bytes are exactly 12 chars: `:keepalive` + LF + LF (per N-6). A simple curl of the endpoint with `-N` should show `:keepalive` on its own line every 30s.
- **Rule 3 auto-fix on worker.ts.** worker.ts's `birthDeps` object now includes `discoverIdentitySessionFile`. The spawn-request worker doesn't have its own wait-for-supervisor test coverage (the plan does not add one); verifier should confirm the worker's existing tests either mock the dep or don't exercise the wait-block path (the worker's own tests were NOT in the Task 1 scoped-test set and were not run — that's a phase-verifier concern, not an executor concern).
- **Frontend `path` field.** BirthOptions.path stays as-declared per W-3 (verified via `grep -c '^  path: string;$'` returns 1). Not removed anywhere.

## Self-Check: PASSED

- File `.planning/phases/106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s/106-01-SUMMARY.md` created (this file).
- Commit `8626dbc6` (Task 1) exists in `git log --oneline`.
- Commit `934fae06` (Task 2) exists in `git log --oneline`.
- `src/backend/database/routes/identity-birth-orchestrator.ts` modified (verified via `git log --stat`).
- `src/backend/database/routes/identity-birth.ts` modified (verified via `git log --stat`).
- `src/backend/spawn-requests/worker.ts` modified (verified via `git log --stat`).
- All 12 Task 1 acceptance-criteria greps return expected values (0/1/≥2 as specified).
- All 6 Task 2 acceptance-criteria greps return expected values (1/≥2/2/2 as specified).
- `npm run build:backend` exits 0.
- Scoped birth vitest suite: 97 passing / 21 failing — all failures are on retired step:3/step:4/step:5 wire, per plan's `<verification>` "EXPECTED to fail in this plan (existing tests assert on step:3/step:4/step:5) — Plan 106-03 updates the tests. Do NOT block plan-close on those failing."

---
*Phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s*
*Completed: 2026-09-11*
