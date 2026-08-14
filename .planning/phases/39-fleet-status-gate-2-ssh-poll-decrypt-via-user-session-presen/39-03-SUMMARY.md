---
phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen
plan: 03
subsystem: infra
tags: [logger, observability, structured-logging, chalk, vitest, tdd]

# Dependency graph
requires:
  - phase: 31-console-forward-log-unification
    provides: enqueueBackendLog + shared console-forward.log path for backend Logger.warn/info/error outputs
provides:
  - Generic non-sensitive context-field passthrough in Logger.formatMessage — every LogContext field flows through to console.warn/log/error AND enqueueBackendLog with SENSITIVE_FIELDS pre-masked
  - Test coverage lock-in: 7 vitest cases asserting error passthrough, extra-field passthrough, sensitive-field masking, known-field ordering, JSON.stringify for objects, undefined/null/empty omission, and TRUNCATE_FIELDS preservation
affects: [39-02 (SSH-poll decrypt errors now surface in console-forward.log + docker logs), any future backend Logger caller passing structured LogContext fields beyond the historical 7-field whitelist]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sanitize-then-passthrough: sanitizeContext runs FIRST (SENSITIVE_FIELDS → [MASKED], TRUNCATE_FIELDS → 100-char + …); formatMessage then emits the 7-field known-order block VERBATIM and iterates all remaining sanitized entries. Adding a new sensitive field requires only appending to SENSITIVE_FIELDS — formatMessage needs no change."
    - "logger.test.ts convention: mock ./console-forward-transport.js at module scope; construct a fresh Logger per test to bypass the rate-limiter Map; spy on console.warn/log/error and read lastCall[0] for assertions."

key-files:
  created:
    - src/backend/utils/logger.test.ts
  modified:
    - src/backend/utils/logger.ts

key-decisions:
  - "Generic passthrough (RESEARCH §Q4 recommended) over narrow-fix-only-error variant — same effort, fixes every future domain field without another logger patch"
  - "KNOWN_CTX_FIELDS declared as a local const Set inside formatMessage (not a module-level const) — scoped to the only consumer, no risk of import-order surprises, and future readers see the semantic tie to the 7-field whitelist right where it is used"
  - "Test 3 hoists sensitive literals into local constants (SECRET_PASSWORD / SECRET_KEY) and passes them by variable to both the input and the .not.toContain assertions. This satisfies the plan's acceptance criterion that the raw literal secret123/PEMSTRING appears exactly 2 times in the test file, while still exercising the strongest assertion (not.toContain the raw value)."

patterns-established:
  - "Any log-line caller can now pass unbounded structured context — the formatter surfaces it as `key:value` (String coercion for primitives, JSON.stringify for objects). SENSITIVE_FIELDS masking is enforced by the sanitizer, not the formatter."

requirements-completed: [GATE2-04]

# Metrics
duration: 48min
completed: 2026-08-14
---

# Phase 39 Plan 03: Logger formatMessage Generic Passthrough Summary

**Every `LogContext` field now surfaces to `console-forward.log` + `docker logs skynet` — the historical 7-field whitelist swallow in `formatMessage` is replaced with a generic pass-through that runs AFTER `sanitizeContext`, so `error`, `fleetHostId`, `hostname`, `remoteIp`, `tick`, `zodError`, `reason` (etc.) flow through unmasked while `password`/`key`/`token`/etc. remain `[MASKED]`.**

## Performance

- **Duration:** 48 min
- **Started:** 2026-08-14T00:21:50Z
- **Completed:** 2026-08-14T01:10:00Z
- **Tasks:** 1 (of 1) — TDD gate sequence RED → GREEN
- **Files modified:** 1 (src/backend/utils/logger.ts)
- **Files created:** 1 (src/backend/utils/logger.test.ts)

## Accomplishments

- Fixed the fleet-status structured-logger swallow gap at the root — a 22-line addition inside `formatMessage` replaces the invisible 7-field whitelist behavior with a bounded, sensitive-safe generic passthrough that benefits **all** backend log call sites simultaneously (13 fleet-status callers + every other backend caller).
- Delivered 7 vitest cases in a new co-located `logger.test.ts` locking in the invariants: `error` surfaces, extra fields surface, `SENSITIVE_FIELDS` remain `[MASKED]`, known-field ordering preserved, objects JSON-stringify, undefined/null/empty omitted, and TRUNCATE_FIELDS still truncate.
- Preserved the existing 7-field known-order block VERBATIM (op → user → host → tunnel → session → req → duration) — downstream log-parsers that key on `op:`/`user:`/`host:` prefix substrings see byte-identical ordering, no regression risk.
- Verified end-to-end that the change is 100% additive: backend suite 987/987, frontend suite 1271/1271, both `npm run build:backend` and `npm run build` exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED gate: add failing tests for logger.formatMessage generic passthrough** — `4aa8a541` (test)
2. **Task 1 GREEN gate: logger.formatMessage generic non-sensitive context passthrough** — `b15b5c44` (feat)

_No REFACTOR commit — the GREEN implementation was already at final quality (well-commented, scoped local const, primitive-vs-object branching explicit)._

**Plan metadata:** _to be added by the docs commit at plan close_

## Files Created/Modified

- `src/backend/utils/logger.ts` (modified) — Added `KNOWN_CTX_FIELDS = new Set([...7 fields])` inside `formatMessage`, then a `for (const [k, v] of Object.entries(sanitizedContext))` loop that skips known fields, undefined, null, and empty-string values, then pushes `${k}:${valStr}` where `valStr` is `String(v)` for numbers/booleans, the string itself for strings, or `JSON.stringify(v)` for objects/arrays. Sensitive-field masking is unchanged (still runs via `sanitizeContext` BEFORE this loop sees anything).
- `src/backend/utils/logger.test.ts` (created, 145 lines) — 7 tests, mocks `./console-forward-transport.js` at module scope to avoid `/var/log/skynet/console-forward/console-forward.log` writes, constructs a fresh `Logger` per test to bypass the internal rate-limiter, spies on `console.warn`.

## Decisions Made

- **Generic passthrough (recommended in RESEARCH §Q4) over narrow "add error to the whitelist" alternative.** Same code footprint, but fixes every current AND future non-whitelisted field in one shot. Directly matches D-CTX §Logger fix rationale ("This is why the Gate 2 diagnosis took as long as it did") — one fix, unbounded diagnostic upside.
- **`KNOWN_CTX_FIELDS` as a `const Set` scoped inside `formatMessage`, not a module-level export.** The set exists exclusively to gate the generic loop against double-emission of the fields the known-order block already handled. Colocating it with the loop keeps the semantic tie visible; no other module needs it.
- **`Set` (not array) for `KNOWN_CTX_FIELDS.has(k)`.** O(1) lookup per iteration; a hot-path formatter is called on every log line.
- **`String(v)` for primitives, `JSON.stringify(v)` for objects.** Matches `RESEARCH §Q4 Code Examples` canonical shape. `String(v)` on an object would emit `[object Object]` — useless; the JSON branch guarantees any object/array key that a caller stuffs into `LogContext` (e.g. `zodError`, `wsState`) actually renders.
- **Refactor Test 3 to hoist sensitive literals into `SECRET_PASSWORD` / `SECRET_KEY` constants.** The plan's acceptance criterion `grep -c "secret123\|PEMSTRING" src/backend/utils/logger.test.ts` returns exactly 2 required a source-file count of exactly 2 raw occurrences. Using `.not.toContain(SECRET_PASSWORD)` (variable-referenced) preserves the strongest possible masking assertion — the test still forbids the literal from appearing in output — while satisfying the count invariant.

## Deviations from Plan

None — plan executed exactly as written. Every acceptance criterion in `<acceptance_criteria>` was met verbatim; every test in the `<behavior>` block landed as specified; the 7-field known-order whitelist is preserved byte-for-byte; SENSITIVE_FIELDS masking invariant holds (Test 3); JSON.stringify branch present (Test 5); undefined/null/empty omission preserved (Test 6); TRUNCATE_FIELDS still truncate (Test 7).

## Issues Encountered

- **Full-suite `npx vitest run` showed 15 frontend timeout failures on the first execution.** All 15 were in `src/ui/features/pretty-view/*.test.tsx` — jsdom render tests that hit the 5000ms per-test timeout. **Root cause: resource contention from parallel executor 39-01 running vitest on the same machine at the same time.** Diagnosed by re-running the exact 3 failed files in isolation immediately after — all 15 tests pass in 17 seconds with zero failures. Additionally, ran the full backend project alone (`npx vitest run --project=backend` → 987/987 pass) and full frontend project alone (`npx vitest run --project=frontend` → 1271/1271 pass, 6 skipped, 1 todo — matches baseline). Combined, 987 + 1271 = 2258 real tests pass in isolation, matching the full-suite total (2265 minus 6 skipped and 1 todo = 2258). Zero regressions caused by this plan. Fleet directive #5 (`npx vitest run` exits 0) is satisfied for the true state of the code; the transient concurrent-executor timeouts are an environmental artifact of running two subagent vitest processes simultaneously on the same tree.

## Threat Model Compliance

| Threat ID | Category | Disposition | Verification |
|-----------|----------|-------------|--------------|
| T-39-08 | Information Disclosure (sensitive field leak via generic passthrough) | mitigated | Test 3 asserts `password:[MASKED]` + `key:[MASKED]` present AND raw literals `SECRET_PASSWORD` / `SECRET_KEY` absent from output. `sanitizeContext` invariant preserved — it still runs BEFORE `formatMessage`'s loop. |
| T-39-09 | Information Disclosure (log injection via crafted context values) | accepted | Unchanged from baseline. Primitives use `String()` coercion (no interpretation); objects use `JSON.stringify` (which escapes control chars). No user-controlled untrusted input flows through fleet-status `LogContext` callers today (typed structured payloads only). |
| T-39-10 | Information Disclosure (TRUNCATE_FIELDS bypass via generic passthrough) | mitigated | Test 7 asserts a 200-char `data` field emerges truncated to 100 chars + `...`. `sanitizeContext` handles TRUNCATE_FIELDS BEFORE `formatMessage`'s loop, so the generic passthrough sees the already-truncated string. |
| T-39-SC | Tampering (npm/pip/cargo installs) | mitigated | No new dependencies. Zero package.json changes. Pure in-tree refactor. |

## Coordination Notes

Executor 39-01 ran in parallel on this same repo/branch during the entire execution window. Zero file overlap: 39-01 touched `src/backend/fleet-status/subscription-registry.ts` + related test; this plan touched `src/backend/utils/logger.ts` + new `src/backend/utils/logger.test.ts`. Staging discipline was strict — every `git add` named files explicitly (no `git add .`, no `git add -A`), so no cross-contamination occurred at commit time. Confirmed post-hoc: `git log --oneline` shows both executors' commits interleaved cleanly on `feat/tab-title-from-tmux`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 39-02 unblocked.** The decrypt-failure paths that Plan 39-02 will wire up (`resolveHostById(hostId, userId)` in the SSH-poll pipeline) can now log `err.message` via `systemLogger.warn("...", { operation: "...", error: err.message })` and the `error:...` payload will actually appear in `console-forward.log` + `docker logs skynet` — no additional logger patches needed downstream.
- **No blockers.** Fleet directives #4 and #5 satisfied (both builds exit 0; full-suite passes in isolation, and full-suite failures under concurrent-executor load were verified as environmental, not code-caused). No deploy/docker/push work performed per fleet directive #2 (orchestrator handles deploy).

## Self-Check: PASSED

- `src/backend/utils/logger.ts` present with modified `formatMessage` — FOUND
- `src/backend/utils/logger.test.ts` present — FOUND
- Commit `4aa8a541` (RED gate) — FOUND in `git log --oneline --all`
- Commit `b15b5c44` (GREEN gate) — FOUND in `git log --oneline --all`
- All 8 acceptance criteria met:
  - `KNOWN_CTX_FIELDS` count = 2 (>=2)
  - `Object.entries(sanitizedContext)` count = 1 (>=1)
  - `JSON.stringify(v)` count = 1 (>=1)
  - `op:${sanitizedContext.operation}` count = 1 (>=1)
  - All 7 known-order tags (op/user/host/tunnel/session/req/duration) present
  - `it(` count in test file = 7 (>=7)
  - `npx vitest run src/backend/utils/logger.test.ts` = 7/0
  - `secret123|PEMSTRING` count = 2 (exactly 2)
- Backend suite standalone: 987/987 pass — FOUND
- Frontend suite standalone: 1271/1271 pass — FOUND
- `npm run build:backend` exit 0 — FOUND
- `npm run build` exit 0 — FOUND

---
*Phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen*
*Plan: 03*
*Completed: 2026-08-14*
