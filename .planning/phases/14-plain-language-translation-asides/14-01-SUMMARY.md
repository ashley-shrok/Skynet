---
phase: 14-plain-language-translation-asides
plan: 01
subsystem: backend
tags: [backend, tmux, ssh, pretty-view, aside, tdd]

# Dependency graph
requires:
  - phase: 01-backend-session-tail
    provides: execCommand primitive + shared sshConn per pane WS
  - phase: 02-pretty-session-view-toggle
    provides: terminal.ts shellQuote helper (L123) — canonical pattern mirrored byte-for-byte in this plan
provides:
  - BTW_PROMPT constant (byte-exact /btw prompt from CONTEXT.md § Injection)
  - ASIDE_END_MARKER constant ("Esc to close")
  - shellQuote local helper (byte-identical to terminal.ts L123)
  - injectBtw(conn, tmuxSession) — inject the fixed /btw prompt via execCommand
  - sendEscapeToBtw(conn, tmuxSession) — send Escape to close BTW overlay
  - extractBtwAnswer(paneOutput, marker) — pure string extractor with last-occurrence anchoring
  - __asideShellQuoteForTests — test-only re-export for byte-parity verification
affects:
  - 14-02 (Wave 2: frontend-arm poller + WS event surface — composes all three primitives)
  - 14-03 (WS wire types + AsideBubble render — consumes aside_ready payloads)
  - 14-04+ (dismiss + cross-tab broadcast — consumes sendEscapeToBtw)

# Tech tracking
tech-stack:
  added: []   # No new dependencies. Reuses existing execCommand, SSHClientType, sshLogger.
  patterns:
    - "shellQuote-parity-across-modules — local 2-line helper duplicated (not exported/imported) to preserve terminal.ts § no-new-deps posture; both definitions must stay byte-identical"
    - "test-only re-export via __-prefix — internal test seam that lets siblings verify a private module symbol without duplicating its body"
    - "primitives-first plan-slicing — Wave 1 lands named + testable primitives with no WS wiring; Wave 2 composes them (avoids the poller+primitive-together anti-pattern)"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.aside.test.ts (RED-gate + GREEN-gate tests, 13 cases)
  modified:
    - src/backend/claude-session/claude-session-server.ts (+156 lines; 3 helpers + 2 constants + local shellQuote + test-only re-export)

key-decisions:
  - "shellQuote duplicated (not shared) — 2-line helper mirrored byte-for-byte from terminal.ts L123 rather than promoted to a shared module. Preserves terminal.ts's 'no new deps, no new modules' comment; a future refactor could unify but that's not Phase 14's problem."
  - "Test-only re-export via __asideShellQuoteForTests — lets the test file assert byte-parity with terminal.ts L123 without duplicating the 2-line body in the test."
  - "Void-references (`void injectBtw; void sendEscapeToBtw;`) suppress unused-symbol warnings until Wave 2 wires them into the poller. Zero runtime cost, keeps primitives named and independently testable."
  - "shellQuote used for both TARGET and PAYLOAD in the send-keys command (mirrors terminal.ts L760 Enter precedent), NOT JSON.stringify — plan-checker W2 grep-negative gate enforces this."
  - "extractBtwAnswer uses LAST-occurrence anchoring on BOTH the end marker AND the /btw echo, so prior BTW invocations still visible in the -S -200 scrollback don't spoof the current answer (ASIDE-04)."
  - "extractBtwAnswer regex `/^\\s*(>\\s*)?\\/btw\\b/` allows tmux prompt prefix (e.g. `> `) that Claude Code renders; `\\b` word-boundary prevents matching random substring occurrences."

patterns-established:
  - "Module-scope named-primitive-before-WS-wire — Wave 1 lands the three helpers + constants without touching wss.on(connection) closure; Wave 2 composes."
  - "Log-and-swallow via sshLogger.info in async helpers — matches existing execCommand error-logging posture throughout claude-session-server.ts."
  - "Pure-function contract testing — extractBtwAnswer covered by 5 synthetic paneOutput fixtures (cases A-E) with no I/O mocking required."

requirements-completed: [ASIDE-03, ASIDE-04, ASIDE-10]

# Metrics
duration: ~15min
completed: 2026-07-26
---

# Phase 14 Plan 01: Aside Wave 1 Primitives Summary

**Three module-scope helpers (`injectBtw`, `sendEscapeToBtw`, `extractBtwAnswer`) plus two constants (`BTW_PROMPT`, `ASIDE_END_MARKER`) plus a local `shellQuote` byte-mirror of terminal.ts L123 — the atomic building blocks Wave 2 will compose into the frontend-arm-driven poller + WS event surface, landed via strict TDD RED→GREEN with 13 passing tests.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-26T17:54Z (plan execution start)
- **Completed:** 2026-07-26T18:01Z
- **Tasks:** 2 (both TDD, each RED→GREEN)
- **Files modified:** 2 (1 test file created, 1 source file extended)

## Accomplishments

- All three Wave 1 primitives named + exported + independently testable via mocked/direct call surface
- BTW_PROMPT byte-for-byte matches CONTEXT.md § Injection (including U+2014 em-dash) — verified via explicit vitest assertion
- shellQuote byte-identical to terminal.ts L123 — verified via re-export + parity tests (4 cases: plain, embedded-apostrophe, empty-string, metacharacters)
- extractBtwAnswer handles all five documented behavior cases (A: null on missing marker; B: single-line trimmed; C: multi-line with scrollback last-occurrence-picks-current; D: null on malformed missing /btw echo; E: empty string on zero-body degenerate case)
- Zero WS wiring, zero poller code, zero client-message dispatch changes — pure primitives-only pass per plan scope-fence
- Zero new dependencies, zero new modules

## Task Commits

Each task followed strict TDD RED→GREEN with a commit at each gate:

1. **Task 1 RED**: `b722977` (test) — failing tests for BTW_PROMPT + ASIDE_END_MARKER + shellQuote parity (8 tests fail with symbol-not-exported)
2. **Task 1 GREEN**: `d33ff77` (feat) — implement BTW_PROMPT + ASIDE_END_MARKER + shellQuote + injectBtw + sendEscapeToBtw + test re-export (8/8 pass, tsc clean)
3. **Task 2 RED**: `c247b5c` (test) — failing tests for extractBtwAnswer cases A-E (5 new tests fail with `extractBtwAnswer is not a function`)
4. **Task 2 GREEN**: `ce04015` (feat) — implement extractBtwAnswer with last-occurrence anchoring (13/13 pass, tsc clean)

**Plan metadata:** (pending — added below in a subsequent commit alongside STATE.md + ROADMAP.md updates)

## Files Created/Modified

- **CREATED** `src/backend/claude-session/claude-session-server.aside.test.ts` (146 lines) — 13 vitest cases across 3 describe blocks: module-scope constants (4 tests), shellQuote parity (4 tests), extractBtwAnswer cases A-E (5 tests)
- **MODIFIED** `src/backend/claude-session/claude-session-server.ts` (+156 lines inserted between L106 and the pre-existing `const wss = new WebSocketServer({ port: 30011 })` at L107) — new module-scope block containing all Phase 14 Wave 1 primitives

## Verification Evidence

Plan-verify command block (per 14-01-PLAN.md `<verification>` section):

- `grep -c "BTW_PROMPT" src/backend/claude-session/claude-session-server.ts` = **3** (≥ 3 required: const decl + 2 uses in injectBtw command template + docstring reference in extractBtwAnswer test cases exist in the test file, not source; source count = 3 = decl + 2 uses ✓)
- `grep -c "ASIDE_END_MARKER" src/backend/claude-session/claude-session-server.ts` = **3** (const decl + 2 docstring references)
- `grep -c "extractBtwAnswer" src/backend/claude-session/claude-session-server.ts` = **2** (jsdoc reference + function declaration)
- `grep -q "function injectBtw"` = **OK**
- `grep -q "function sendEscapeToBtw"` = **OK**
- `grep -q "function extractBtwAnswer"` = **OK**
- `grep -q "const shellQuote"` = **OK**
- `grep -q "conn: SSHClientType"` = **OK** (used in both injectBtw and sendEscapeToBtw signatures)
- `grep -q "shellQuote(tmuxSession)"` = **OK**
- `grep -q "shellQuote(BTW_PROMPT)"` = **OK**
- Negative gate: `! grep -q "JSON.stringify(BTW_PROMPT)"` = **OK** (no JSON.stringify anywhere in the new code — shellQuote is the sole quoting mechanism)
- `grep -q "Re-explain whatever's currently going on to me without using code symbols"` = **OK**
- `grep -q "Not a metaphor — explain the actual thing"` = **OK** (U+2014 em-dash verified)
- `npx tsc --noEmit` = **exit 0** (no type errors introduced)
- `npx vitest run src/backend/claude-session/claude-session-server.aside.test.ts` = **13/13 pass** (Test Files 1 passed; Tests 13 passed)

### Import-context confirmation (per plan `<output>` requirement)

- `SSHClientType` already imported at claude-session-server.ts L2 (`import type { Client as SSHClientType } from "ssh2"`) — used verbatim in both injectBtw and sendEscapeToBtw signatures, no re-import needed
- `execCommand` already imported at claude-session-server.ts L11 (`import { execCommand } from "../ssh/tmux-helper.js"`) — reused directly, no new import added
- `sshLogger` already imported at L5 — used for the try/catch log-and-swallow pattern in both helpers

### shellQuote byte-parity confirmation

Both definitions verified via literal `grep -A1`:

```
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;
```

Identical in `src/backend/ssh/terminal.ts` (L123) and `src/backend/claude-session/claude-session-server.ts` (new insertion). If either shifts in a future refactor, they must be updated in lock-step (documented in the source comment above the new helper).

## Decisions Made

See frontmatter `key-decisions` block above. Highlights:

- **Duplicated shellQuote instead of promoting to shared module** — preserves terminal.ts § "no new deps, no new modules" posture, minimal blast radius. Two 2-line definitions with a byte-parity comment above the new one; test-only re-export lets the sibling test assert byte-parity without duplicating the body.
- **Void-references for Wave 2 primitives** — `void injectBtw; void sendEscapeToBtw;` at module scope silences unused-symbol warnings without perturbing runtime behavior. Zero-cost placeholder until 14-02 wires them into the poller.

## Deviations from Plan

None — plan executed exactly as written. Every plan-verify gate passed on first attempt; no auto-fix rules triggered.

Two minor additions beyond the strict letter of the plan action block, both fully within the spirit of the plan:

1. **Added `export` on `extractBtwAnswer` + constants** — the plan's `<behavior>` block said "exported OR module-scope (planner discretion — inline usage from the Wave 2 poller is the only caller)." The test file lives in a sibling module and imports these symbols directly, so they must be exported. The `injectBtw` / `sendEscapeToBtw` async helpers are kept unexported (Wave 2 will call them from the same module).
2. **Added `__asideShellQuoteForTests` test-only re-export** — supports the shellQuote-parity assertion in the test file. Underscore prefix marks it as an internal test seam; no production caller should reference it.

Neither addition constitutes a scope deviation — both are natural consequences of "make the primitives testable in isolation before Wave 2 composes them" (which IS the plan's stated goal).

## Issues Encountered

None. Both TDD cycles were single-attempt RED→GREEN with tsc + vitest clean on the first implementation pass.

## User Setup Required

None. Pure code additions to backend TypeScript; no environment variables, no external services, no infrastructure changes. Wave 2 will introduce the frontend WS message contract; still no user setup required.

## Next Phase Readiness

**Ready for 14-02 (Wave 2).** The three primitives + two constants + local shellQuote are landed, tested, and exported/module-scope as Wave 2 needs them:

- `injectBtw` and `sendEscapeToBtw` are module-scope async functions callable from within `wss.on("connection", ...)` where the pane's `sshConn` and `currentTmuxSession` are already in scope
- `extractBtwAnswer` is a pure exported function; Wave 2's poller can call it with `execCommand(conn, asideCaptureCmd)`'s resolved output plus `ASIDE_END_MARKER`
- `BTW_PROMPT` / `ASIDE_END_MARKER` are exported constants; Wave 2 references them by name (no string duplication)
- shellQuote parity is now guaranteed by the byte-identical local copy — Wave 2's poller command (`tmux capture-pane -p -S -200 -t ${shellQuote(tmuxSession)}`) can safely use the same local helper

No blockers, no concerns, no deferred issues.

## Self-Check: PASSED

- ✓ FOUND: `src/backend/claude-session/claude-session-server.aside.test.ts`
- ✓ FOUND: `src/backend/claude-session/claude-session-server.ts` (existed; verified additions via grep)
- ✓ FOUND commit `b722977` — test(14-01): add failing RED-gate tests for aside Wave 1 primitives
- ✓ FOUND commit `d33ff77` — feat(14-01): add aside Wave 1 primitives (BTW_PROMPT + shellQuote + injectBtw + sendEscapeToBtw)
- ✓ FOUND commit `c247b5c` — test(14-01): add failing tests for extractBtwAnswer (5 cases A-E)
- ✓ FOUND commit `ce04015` — feat(14-01): add extractBtwAnswer pure-string helper (Wave 1 primitive #3)

## TDD Gate Compliance

Plan Task 1 (`tdd="true"`): RED (`b722977`) → GREEN (`d33ff77`) — sequence correct.
Plan Task 2 (`tdd="true"`): RED (`c247b5c`) → GREEN (`ce04015`) — sequence correct.
No REFACTOR commits — implementation was clean on first pass; no cleanup needed.

---
*Phase: 14-plain-language-translation-asides*
*Completed: 2026-07-26*
