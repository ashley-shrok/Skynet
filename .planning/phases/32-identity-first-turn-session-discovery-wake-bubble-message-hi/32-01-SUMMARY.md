---
phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
plan: 01
subsystem: backend
tags: [claude-session, jsonl, ssh, tmux, discovery, vitest, tdd]

# Dependency graph
requires:
  - phase: 31-structured-logging
    provides: sshLogger / databaseLogger structured-log taxonomy the Wave 2 caller will emit into
provides:
  - discoverIdentitySessionFile(conn, name) — pure Promise helper that returns the mtime-latest absolute JSONL path under ~/.claude/projects/*/ whose first user-role line matches the identity-first-turn `/id <name>` byte pattern, or null
  - __matchesIdentityFirstTurnForTests — the pure byte-pattern predicate exported under the __forTests convention for unit isolation
  - DISCOVERY_EXEC_TIMEOUT_MS constant (3000ms; sibling of the same-named constant in session-file-discovery.ts, re-declared to preserve module independence per D-09)
affects:
  - Phase 32 Wave 2 (dormant-branch wiring in claude-session-server.ts) — consumes the helper's return value to open a tail on the discovered JSONL and stream wake-bubble message history through the existing session pipeline
  - Any future phase that needs identity-attribution more reliable than the pane-based mtime chain (D-06 use case; explicitly out of scope in Phase 32 per D-09)

# Tech tracking
tech-stack:
  added: []  # no new dependencies — only pre-existing ssh2 type + execCommand + vitest
  patterns:
    - "One-round-trip shell script + JS-side byte-pattern predicate (D-07 cost bound + T-32-01 injection defense-in-depth: identity name never flows into a shell grep pattern, only into a single-quote-wrapped shell literal)"
    - "RECORD_SEPARATOR sentinel (---GSDR-32---) for parsing multi-file shell stdout into per-file records — enables one exec channel instead of N"
    - "Sibling-module design: does NOT import from layer1-detect.ts or session-file-discovery.ts even though byte-pattern semantics overlap — preserves independent evolution per D-09"
    - "__forTests export convention (mirrors layer1-detect.ts:199 and claude-session-server.ts:__applyDormantPollWithRediscoveryForTests) — pure predicate + module-scope vi.mock for the execCommand seam"

key-files:
  created:
    - src/backend/claude-session/discover-identity-session-file.ts
    - src/backend/claude-session/discover-identity-session-file.test.ts
  modified: []  # zero diff to any sibling file per D-09 out-of-scope enforcement

key-decisions:
  - "Chose single-round-trip shell script over N-per-file exec calls — one timeout, one stdout to parse, one failure surface (D-07 explicitly leaves this to executor discretion; single round-trip won on testability + fewer failure surfaces)"
  - "Re-declared DISCOVERY_EXEC_TIMEOUT_MS locally instead of importing from session-file-discovery.ts — keeps this module free of any coupling to the active-flow discovery module (D-09 evolution independence)"
  - "Defensive re-sort of records in JS after the shell's `sort -rn` — belt-and-suspenders against locale/collation drift; O(n log n) on a set bounded by D-07 (~dozens of files) is negligible"
  - "Empty first-user-role line for files with no user turn in the first 4096 bytes emits an empty placeholder in the record stream — parser treats empty firstUserLine as a non-match without throwing (fail-safe)"

patterns-established:
  - "RECORD_SEPARATOR sentinel pattern: when a shell script emits multi-record output over one exec channel, use a distinctive line-terminator sentinel (`---GSDR-<phase>---`) to split the stream in JS. Extends the existing `---HOME---` delimiter pattern from session-file-discovery.ts:170"
  - "Byte-pattern predicate isolation: the identity name IS the only variable input to the byte-pattern check, but it is applied ENTIRELY in JS (not as a shell grep pattern) — this keeps the predicate unit-testable in isolation AND removes an injection surface (T-32-01)"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07]

# Metrics
duration: ~13min
completed: 2026-08-12
---

# Phase 32 Plan 01: Identity-First-Turn Session Discovery Helper Summary

**Pure `discoverIdentitySessionFile(conn, name)` helper + 22 vitest cases — locates the mtime-latest JSONL under `~/.claude/projects/*/` whose first user-role line matches the `/id <name>` byte pattern with strict partial-name refusal (`tiff<` MUST NOT match `tiffany`).**

## Performance

- **Duration:** ~13 min (RED commit 18:41:31 UTC → GREEN commit 18:50:57 UTC = 9m 26s active TDD; +~3 min post-resume for verification and SUMMARY authoring)
- **Started:** 2026-08-12T18:35:00Z (approx — reading plan + context + shape references)
- **Completed:** 2026-08-12T18:54:00Z (approx — SUMMARY written)
- **Tasks:** 2 (Task 1 = predicate + helper module; Task 2 = full vitest coverage)
- **Files modified:** 2 (both new)

## Accomplishments

- **Two pure exports shipped:** `discoverIdentitySessionFile(conn: Client, identityName: string): Promise<string | null>` and `__matchesIdentityFirstTurnForTests(line: string, identityName: string): boolean` (plus `DISCOVERY_EXEC_TIMEOUT_MS`).
- **22 vitest cases, all green:** 7 predicate cases (CASE-P1..P7 — happy path, two partial-name-refusal cases, four delimiter sub-cases, tool_result exclusion, non-user turn refusal, missing /id command-name, wrong identity in args) + 10 helper cases + 2 script-shape assertions (CASE-H1..H8 — happy path, mtime tiebreak, no-match null, throwaway skip x2, later-line ignore, empty stdout tolerance, SSH throw null fail-safe, partial-name refusal end-to-end, single-quote-wrap and `~/.claude/projects/`+`find`+`.jsonl` assertions on the exec call-shape).
- **Full backend + frontend suite green:** 154 test files, 1965 tests pass, 7 skipped + 1 todo (both pre-existing); zero regressions from this plan.
- **All 6 plan success criteria satisfied:** two new files exist; zero diff to `claude-session-server.ts` / `layer1-detect.ts` / `session-file-discovery.ts` (D-09 out-of-scope); `src/ui/` byte-untouched (invariant 3); all 22 tests pass + full suite green; both symbols importable via `./discover-identity-session-file.js`; zero `JSON.parse` calls in the module (grep-verified — all three matches are in docblock text, not code).

## Task Commits

Each task was committed atomically per TDD (RED → GREEN):

1. **Task 2 RED (write failing test file first per TDD ordering)** — `2cf837f` (test: add failing vitest for discover-identity-session-file (RED))
2. **Task 1 GREEN (implement helper module + one test fixture fix)** — `650f8df` (feat: implement discoverIdentitySessionFile helper (GREEN))

_Note: TDD ordering inverted the plan's task-number ordering (Task 1 module first, Task 2 tests second) — I wrote the test file first so the RED gate would fire on a missing module import, then wrote the module to satisfy the tests. Both tasks landed in exactly two commits; no separate REFACTOR commit needed (implementation was clean on first pass). The single test file modification bundled into the GREEN commit was a fixture correction — see "Deviations from Plan" below._

**Plan metadata:** deferred to phase-end orchestrator commit per execution-notes constraint ("Do NOT commit docs artifacts — orchestrator handles that").

## Files Created/Modified

- `src/backend/claude-session/discover-identity-session-file.ts` (328 lines) — Pure helper module. Exports `discoverIdentitySessionFile`, `__matchesIdentityFirstTurnForTests`, `DISCOVERY_EXEC_TIMEOUT_MS`. Sibling of `layer1-detect.ts`; no imports from other `claude-session/` files; imports only `Client` type from `ssh2` and `execCommand` from `../ssh/tmux-helper.js`. Emits zero log lines (caller's responsibility per Phase 32 invariant 5 + T-32-02). Fail-safe: SSH throw / timeout / empty stdout / no match all return `null`, no throw propagates.
- `src/backend/claude-session/discover-identity-session-file.test.ts` (461 lines) — 22 vitest cases via module-scope `vi.mock("../ssh/tmux-helper.js")` seam. Fixture builder `firstUserTurnLine(identity, {delimiter})` synthesizes empirical-shape JSONL lines; `synthesizeExecStdout(candidates)` mirrors the production shell script's output contract (`MTIME\tPATH\n<first-user-line>\n---GSDR-32---\n` per file, mtime-desc order).

## Decisions Made

- **One-round-trip shell script chosen** (D-07 left this to executor discretion; both approaches meet cost budget). Rationale: fewer failure surfaces (one exec, one timeout, one stdout to parse), simpler to mock in tests (single `vi.fn` implementation), tighter round-trip cost when discovery happens on wake-bubble poll cadence. The alternative (N-per-file exec, one for enumeration + one head per file) would multiply timeout budget management by N.
- **Empirical stdout shape (per Task output spec):** `MTIME\tPATH\n<first-user-role-line>\n---GSDR-32---\n` repeating per file, mtime-descending. Each record has three lines: header (mtime + tab + path), first user-role line (or empty if the file's first 4096 bytes had no `"role":"user"` line), and the sentinel. Parser splits on `\n---GSDR-32---` and processes each chunk.
- **DISCOVERY_EXEC_TIMEOUT_MS re-declared locally** (not imported from `session-file-discovery.ts`) — plan Task 1 action step 3 left this to executor choice with the requirement to document it. Choice: re-declare + cross-reference comment. Rationale: D-09 preservation — this module MUST NOT couple to `session-file-discovery.ts`'s evolution.
- **Belt-and-suspenders re-sort in JS** even though shell already `sort -rn`s — defensive against locale/collation drift on any host that ever ships a shell whose `sort -rn` breaks on float-valued mtimes. O(n log n) on a set bounded by D-07 is free.
- **Defensively forgiving parser** — malformed final record (no `\t` in header, missing newline, non-finite mtime) is silently dropped instead of throwing. Better to miss one candidate than to crash the dormant branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture's `\r` delimiter case was JSON-escaped instead of raw-CR byte**
- **Found during:** Task 2 (first GREEN run — 21/22 tests passed, one failed)
- **Issue:** The `firstUserTurnLine` fixture builder wraps content in `JSON.stringify`, which converts a JavaScript `"\r"` string character into the two-byte escape sequence `\r` (backslash + r) inside the serialized JSONL line. This meant the `\r`-delimiter test case was actually testing whether the predicate accepted `\` (backslash) as a delimiter — which it correctly does NOT.
- **Fix:** For the `\r` delimiter test case only, constructed the JSONL line by hand (string concatenation, not `JSON.stringify`) so a raw 0x0D byte literally sits immediately after the identity name. Added an inline comment explaining that this shape is unusual in practice (`JSON.stringify` never emits raw CR inside content) but the D-01 spec lists `\r` as an allowed delimiter for defensive completeness (line-ending edge cases where the raw line buffer includes CR before LF). Also updated the fixture builder's `\r` branch to note the escaping caveat.
- **Files modified:** src/backend/claude-session/discover-identity-session-file.test.ts (bundled into the GREEN commit)
- **Verification:** `npx vitest run src/backend/claude-session/discover-identity-session-file.test.ts` reports 22/22 passing after the fix; full suite still green.
- **Committed in:** 650f8df (Task 1/2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test fixture bug)
**Impact on plan:** Fixture-only correction, zero production impact. Actually improves fidelity — the fixed test now verifies the predicate on a RAW CR byte (which is what D-01 actually specifies), whereas the original would have silently green-lit a bug where the predicate accepted `\` (backslash) as a delimiter.

## Issues Encountered

None. The one-round-trip shell script strategy worked on first design; the byte-pattern predicate was correct on first write. The only iteration was the fixture correction documented above.

## Threat Coverage (T-nnn from PLAN.md)

- **T-32-01 (Injection):** Mitigated. `shellSingleQuote()` wraps the identity name; the name is interpolated ONLY as a shell literal (`IDENTITY='<name>';`), never into a `grep` pattern. Byte-pattern check runs entirely in JS on the already-parsed shell stdout. Verified by the "single-quote-wraps the identity name" assertion in the helper test suite.
- **T-32-02 (Info Disclosure via logs):** Mitigated by design. Module emits zero log lines. Grep-verified: no `logger` / `console.log` / `sshLogger` imports in the module. Caller (Wave 2) owns log emission per Phase 32 invariant 5.
- **T-32-03 (DoS via long-running find):** Mitigated. `DISCOVERY_EXEC_TIMEOUT_MS = 3000` provides a hard ceiling; the `head -c 4096 | grep -m 1` per file early-bails within ~1KB for realistic JSONLs; `find -maxdepth 2` prevents pathological deep-tree scans.
- **T-32-SC (Supply-chain):** Mitigated. No new dependencies added. Only pre-existing imports (`ssh2` Client type, `execCommand` from `../ssh/tmux-helper.js`, `vitest`).

## D-nnn Coverage Matrix

Each vitest case ties to at least one locked decision from `32-CONTEXT.md`:

| Case ID | D-nnn covered | Assertion |
|---------|---------------|-----------|
| CASE-P1 | D-01 | Happy-path byte-pattern match returns true for `<command-args>tanya<` when identity is `tanya` |
| CASE-P2a | D-01 | Partial-name refusal: `<command-args>tiff<` MUST NOT match identity `tiffany` |
| CASE-P2b | D-01 | Partial-name refusal (mirror): `<command-args>tiffany<` MUST NOT match identity `tiff` |
| CASE-P3a | D-01 | Delimiter `<` (empirical case) accepted |
| CASE-P3b | D-01 | Delimiter ` ` (space) accepted (multi-token args) |
| CASE-P3c | D-01 | Delimiter `\r` (raw CR byte) accepted (Windows-line-ending edge) |
| CASE-P3d | D-01 | Delimiter EOL (line ends immediately after identity name) accepted |
| CASE-P4 | D-01 | Tool_result user turn refused (agent-side synthetic) |
| CASE-P5 | D-01 | Assistant-role turn refused even when quoting the full /id byte pattern |
| CASE-P6 | D-01 | Missing `<command-name>/id</command-name>` → refused |
| CASE-P7 | D-01 | Wrong identity in args → refused |
| CASE-H1 | D-01, D-07 | Happy-path single match returns absolute path (also asserts one round-trip via mock call count) |
| CASE-H2 | D-03 | Multi-match returns mtime-latest path (tiebreak: 1000, 2000, 1500 → 2000 wins) |
| CASE-H3 | D-05 | No matches returns null, no throw (cold-start fallback) |
| CASE-H4a | D-02, D-04 | File whose first user-role line matches → matches (throwaway assistant bootstrap tolerated) |
| CASE-H4b | D-02, D-04 | File whose first user-role line is a plain user turn (no /id) → no match (throwaway excluded by construction) |
| CASE-H5 | D-02 | Later-in-file `/id` mention NOT matched — only first user-role line is inspected |
| CASE-H6 | D-05 | Empty projects dir tolerated → null (cold-start) |
| CASE-H7 | D-05 | SSH throw → null, no throw propagates (fail-safe) |
| CASE-H8 | D-01 | Partial-name refusal end-to-end via the helper (predicate delegation verified) |
| script-shape | D-07 | `execCommand` called exactly once; command string contains `~/.claude/projects/` + `find`/`.jsonl` (single-round-trip enumeration verified) |
| shell-escape | T-32-01 | Identity name (when it appears in the shell script) is single-quote-wrapped |

**D-06** (stronger identity attribution than pane-based mechanism) and **D-08** (recycle-boundary latency parity) are conceptual invariants; their behavior guarantees fall out of D-01 + D-02 + D-03 (documented in 32-CONTEXT.md) and are not directly test-assertable at this scope. Both were declared in the plan's Task 2 action block as intentionally out-of-scope for direct assertion at this layer.

## User Setup Required

None — pure backend addition. No environment variables, no external service configuration, no CLI installs, no user-facing UI.

## Next Phase Readiness

- **Wave 2 (plan 32-02) is unblocked.** The dormant-branch wiring can now import `discoverIdentitySessionFile` from `./discover-identity-session-file.js` and drop it in at `claude-session-server.ts:4675-4799` (immediately after `dormantPollTimer = setInterval(...)`, before `enteredDormantPoll = true;`). The return-value contract is:
  - `Promise<string | null>` where string is an absolute path suitable to pass directly into `tailSessionFile(conn, absolutePath, onLine, onError)` (see `session-file-tail.ts:35` signature).
  - `null` return means "no discovery" — Wave 2 must fall back to today's behavior (dormant frame only, no tail opened) per invariant 1 in 32-CONTEXT.md.
  - Wave 2 owns the structured log emission on both the happy-path discovery AND the null-return fallback (per Phase 31 `[session]`/`[ws]` prefix taxonomy).
- **No blockers.** No concerns. Full suite is green; type-check clean; UI byte-untouched.
- **Deploy deferred to phase-end** per execution notes ("Do NOT deploy from this plan — deploy happens once at end of phase (after Wave 2 lands)").

## Self-Check: PASSED

Verified before writing this SUMMARY:

- `src/backend/claude-session/discover-identity-session-file.ts` — FOUND
- `src/backend/claude-session/discover-identity-session-file.test.ts` — FOUND
- Commit `2cf837f` (RED) — FOUND in `git log --all`
- Commit `650f8df` (GREEN) — FOUND in `git log --all`
- `src/backend/claude-session/claude-session-server.ts` — zero diff vs plan-start (D-09 preserved)
- `src/backend/claude-session/layer1-detect.ts` — zero diff vs plan-start (D-09 preserved)
- `src/backend/claude-session/session-file-discovery.ts` — zero diff vs plan-start (D-09 preserved)
- `src/ui/features/pretty-view/` — working-tree clean; `src/ui/` — zero committed diff vs plan-start (invariant 3)
- `discoverIdentitySessionFile` + `__matchesIdentityFirstTurnForTests` — both `export`ed in module (verified by grep)
- Zero `JSON.parse` in module (three grep matches are all inside docblock text at lines 24, 33, 118 — comment prose, not code)
- Full backend + frontend vitest suite: 154 files pass, 1965 tests pass (7 skipped + 1 todo pre-existing) — zero regressions

---
*Phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi*
*Plan: 01*
*Completed: 2026-08-12*
