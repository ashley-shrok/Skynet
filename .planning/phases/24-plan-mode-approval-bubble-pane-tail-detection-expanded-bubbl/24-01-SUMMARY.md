---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
plan: 01
subsystem: backend-parser
tags: [plan-mode, ink, pane-scrape, vitest, pure-helper, claude-code]

# Dependency graph
requires:
  - phase: quick-260802-rps
    provides: original plan-pending-parser.ts (fingerprint strings were wrong for the pinned fleet Ink variant — this plan corrects them)
provides:
  - "isPlanPending: pinned-fleet-Ink-variant plan-approval detection that ACTUALLY fires against live panes"
  - "parsePlanFilePath: pure text extraction of the tilde-relative plan file path from the prompt footer (feeds Plan 02's SFTP fetch)"
  - "vitest suite driving both helpers with 11 synthetic-pane cases (5 isPlanPending + 6 parsePlanFilePath)"
affects: [24-02-plan-file-sftp-fetch, 24-03-claude-session-server-ws-frame-extension, 24-04-plan-pending-bubble-expansion, 24-05-composebox-plan-pending-disable]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-helper posture (zero imports, zero I/O, single-file two-export shape) — parser file grew from 1 export to 2 exports (`isPlanPending` + `parsePlanFilePath`), mirroring how context-pct-parser.ts is structured (single-file pure-helper); test file matches context-pct-parser.test.ts convention verbatim"
    - "Two-condition fingerprint shape preserved (bottom-slice marker AND header-anywhere) — only the anchor strings and the count of header variants changed; slice-size bound (30 lines) preserved"

key-files:
  created: []
  modified:
    - "src/backend/claude-session/plan-pending-parser.ts (fingerprint strings corrected to pinned fleet Ink variant; parsePlanFilePath added as a second named export)"
    - "src/backend/claude-session/plan-pending-parser.test.ts (fixtures rewritten to pinned variant; parsePlanFilePath describe block added with 6 it-cases)"

key-decisions:
  - "Fingerprint SHAPE (bottom-slice marker AND header-anywhere) preserved verbatim; only the two anchor strings and the count of header variants changed — single-variant per Ashley's pinned-fleet lock 2026-08-04"
  - "parsePlanFilePath keeps parser-layer slug-charset check ([a-z0-9-]+) as a first-pass sanity filter; full path validation (traversal, backticks, quotes, absolute-outside-plans) is delegated to the SFTP-fetch caller in Plan 02 per the CONTEXT § Path validation security-boundary decision (defense-in-depth per T-24-01-01)"
  - "Regex uses the middle-dot `·` (U+00B7) verbatim from Amelia's pane 2026-08-04, with `\\s+` around it to tolerate minor Ink whitespace drift while still requiring the U+00B7 separator to be present"
  - "Docblock rewritten to describe the NEW pinned-variant strings verbatim while omitting the old strings by name (Task 1 verify grep enforces zero occurrences of the old strings in the file)"

patterns-established:
  - "Two-export pure-helper file: single-file helpers can multiplex related pane-scrape logic (`isPlanPending` + `parsePlanFilePath`) without splitting to a second file when both operate on the same pane text and share the same posture (zero imports, zero I/O)"
  - "Pinned-fleet-variant naming convention in docblock: FINGERPRINT section names the exact variant (pinned fleet Ink) and includes a `Live confirmation on <workstation> <date>` sentence for future revalidation"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-08-04
---

# Phase 24 Plan 01: plan-pending-parser fix + parsePlanFilePath Summary

**Fingerprint strings in `plan-pending-parser.ts` swapped from the dead-since-260802-rps pre-fleet variant to the pinned fleet Ink variant (`Claude has written up a plan and is ready to execute. Would you like to proceed?` + `shift+tab to approve with this feedback`); added `parsePlanFilePath` pure-helper for prompt-footer path extraction; vitest suite grew 6 → 11.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-08-04T20:02:01Z
- **Completed:** 2026-08-04T20:05:16Z
- **Tasks:** 2 (both auto, both tdd)
- **Files modified:** 2

## Accomplishments
- `isPlanPending` now actually detects the live fleet Ink plan-approval prompt (was silently returning `false` on every pane since quick 260802-rps landed 2 days ago — Ashley's own pane wouldn't have triggered PlanPendingBubble regardless of how many plans she was reviewing).
- `parsePlanFilePath` added as a second named export in the same file, extracting the tilde-relative plan-file path from the prompt footer (`ctrl-g to edit in  Vim  · ~/.claude/plans/<slug>.md`); returns `null` on missing footer, uppercase-slug, slash-in-slug, backtick-in-slug, and non-`.md` extension.
- vitest suite expanded from 6 → 11 tests: 5 for `isPlanPending` (1 positive pinned-variant + 4 preserved negatives, with prose-quote fixture updated to paraphrase the new header) + 6 for `parsePlanFilePath` (happy path + 5 rejection cases).

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix isPlanPending fingerprint + add parsePlanFilePath** — `91e6797` (fix)
2. **Task 2: Update fixtures + add parsePlanFilePath cases** — `34cebfc` (test)

**Plan metadata:** _(added below as final commit — see State Updates section)_

_Note: Both tasks marked `tdd="true"`. Because the plan's Task 1 rewrites the SOURCE and Task 2 rewrites the TESTS, the RED gate for Task 1 was observed by running the existing tests after Task 1's source change — the 2 old positive `isPlanPending` fixtures failed (as expected, since they targeted obsolete strings), proving the source change altered behavior. Task 2 then rewrote the tests to match the new source, restoring GREEN. This is a two-file TDD cycle rather than a per-task RED/GREEN/REFACTOR triad._

## Files Created/Modified
- `src/backend/claude-session/plan-pending-parser.ts` — Fingerprint strings corrected to pinned fleet Ink variant (`Claude has written up a plan and is ready to execute. Would you like to proceed?` header + `shift+tab to approve with this feedback` bottom-slice marker); OR-branch across two header variants collapsed to a single-header check per pinned-single-variant lock; new `parsePlanFilePath` pure-helper added as a second named export; docblock rewritten (WHY-A-PANE-SCRAPE-INSTEAD-OF-THE-JSONL section preserved verbatim; FINGERPRINT section rewritten; parsePlanFilePath JSDoc added).
- `src/backend/claude-session/plan-pending-parser.test.ts` — Import extended to pull in `parsePlanFilePath`; positive `isPlanPending` fixture rewritten from the two `--dangerously-skip-permissions` / default fixtures to a single pinned-variant fixture; prose-quote negative rewritten to paraphrase the new header; empty/whitespace + random-terminal negatives preserved byte-for-byte; new `describe("parsePlanFilePath — footer path extraction (Phase 24 Plan 01)", ...)` block with 6 it-cases.

## Decisions Made
- **Fingerprint SHAPE preserved, strings changed.** The two-condition (bottom-slice marker AND header-anywhere) shape is the docblock's load-bearing anti-false-positive design; only the anchor strings and the count of header variants (2 → 1) needed to change for pinned-fleet-single-variant.
- **Slug charset regex at parser layer.** Even though the CONTEXT decision says "Path validation lives in the SFTP-fetch code path, NOT in the parser," the parser's regex still applies `[a-z0-9-]+` as a first-pass sanity filter. This is defense-in-depth per T-24-01-01: the SFTP-fetch caller (Plan 02) re-validates the full resolved path; the parser regex just refuses obviously-malformed footer lines at extraction time. The parser JSDoc calls out that this is a sanity filter, not the security boundary.
- **Middle-dot `·` (U+00B7) required literally in the regex.** The footer format is verbatim from Amelia's pane 2026-08-04; the regex uses `\\s+·\\s+` to tolerate minor Ink whitespace drift on either side of the separator while still requiring the U+00B7 character itself to be present. If Ink ever changes the separator, this will fall through to `null` and the SFTP fetch will be skipped (bubble still mounts on presence detection alone, matching the CONTEXT decision "detection presence is authoritative — a missing path just means content-fetch skips").
- **Docblock removes old strings by name.** Task 1's fourth automated verify grep enforces zero occurrences of `No, keep planning` / `Here is Claude's plan:` / `Ready to code?` anywhere in the file, including comments. Docblock prose rewritten to describe the old fingerprint indirectly ("the reject-option label and two header variants from an OLD Ink revision") so the file passes the grep gate.

## Deviations from Plan

### Rule 3 — Blocking (tooling nit)

**1. `vitest --reporter=basic` flag not supported in vitest v4.1.8**
- **Found during:** Task 2 verification (running the plan's automated verify command)
- **Issue:** The plan's `<automated>` block specifies `npx vitest run … --reporter=basic 2>&1 | tail -20`. `basic` is not a valid reporter in vitest v4.x — the command exits non-zero with a "Cannot find package '@vitest/reporter-basic'" style error, which would false-fail the verify gate.
- **Fix:** Dropped the `--reporter=basic` flag; used the default reporter, which prints `Test Files  1 passed (1)` / `Tests  11 passed (11)`. The gate's intent is "vitest exits 0" and that's what got verified.
- **Files modified:** None (verify-command deviation, not source).
- **Verification:** `npx vitest run src/backend/claude-session/plan-pending-parser.test.ts` prints `Tests  11 passed (11)` and exits 0.
- **Committed in:** n/a (no source change).

---

**Total deviations:** 1 (Rule 3, tooling — verify-command flag drift, no source impact)
**Impact on plan:** Zero scope creep, zero behavior change. The verify gate's intent ("vitest exits 0") is preserved; only the specific CLI flag was dropped because it's not supported in this vitest version.

## Issues Encountered
None material. The two-file TDD ordering (Task 1 changes source and breaks the tests, Task 2 rewrites tests to match) was slightly awkward for RED/GREEN gating — the standard per-task RED-then-GREEN doesn't cleanly apply when the RED and GREEN live in separate tasks — but the effective TDD cycle is still there: pre-Task-1 tests passed → post-Task-1 tests failed (RED observed) → post-Task-2 tests passed (GREEN). Documented in the Task Commits section above.

## Next Phase Readiness
- Plan 02 (SFTP side-channel fetch) can now consume both `isPlanPending` and `parsePlanFilePath` from `./plan-pending-parser.js` — the file exports the exact two-function shape that Plan 03 (WS frame extension) will drive from `claude-session-server.ts`'s setInterval pane-scrape.
- No blockers for downstream plans.

## Self-Check: PASSED

- `src/backend/claude-session/plan-pending-parser.ts` — FOUND (modified, contains both `isPlanPending` and `parsePlanFilePath`).
- `src/backend/claude-session/plan-pending-parser.test.ts` — FOUND (modified, 11 tests all passing).
- Commit `91e6797` — FOUND (Task 1: fix).
- Commit `34cebfc` — FOUND (Task 2: test).

---
*Phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl*
*Completed: 2026-08-04*
