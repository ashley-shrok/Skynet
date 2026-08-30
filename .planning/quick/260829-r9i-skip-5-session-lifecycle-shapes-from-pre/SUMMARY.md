---
quick_id: 260829-r9i
slug: skip-5-session-lifecycle-shapes-from-pre
date: 2026-08-29
status: complete
commit: 6e6ca378
---

# Summary — Skip 5 Session-Lifecycle Shapes from Pretty-View Bubbles

## What changed

Two files modified, 177 insertions, 0 deletions.

- **`src/backend/claude-session/session-file-parser.ts`** (+32 lines)
  Added a single guarded block (`if (isUser && imageRefs.length === 0 && typeof content === "string")`)
  immediately after the `empty_content` skip and before the existing `harness_wrapper`
  regex strip (per PLAN.md § Order in the file). Block contains 5 sequential `if`
  statements, each returning `{ kind: "skip", why: "<reason>" }` with a distinct
  reason: `slash_exit`, `slash_id`, `goodbye_echo`, `resume_injection`, `ctrl_c_kill`.
  Predicates match PLAN.md § Skip conditions verbatim, including the ported
  `t.trim().replace(/[\x00-\x1F]/g, "") === ""` shape from
  `ssh-poll-orchestrator.ts:317` for `ctrl_c_kill`.

- **`src/backend/claude-session/session-file-parser.test.ts`** (+145 lines)
  Added a new describe block `parseSessionLine — session-lifecycle noise skips
  (quick-260829-r9i)` at end of file with 8 tests:
  - Tests R9I-1..5: one negative test per new skip reason, each verifying
    `{ kind: "skip", why: "<reason>" }` for a real-JSONL-shaped fixture.
  - Test R9I-6: positive passthrough — resume sentinel quoted inside real prose
    (not at position 0) returns `kind:"message"`.
  - Test R9I-7: positive passthrough — `/gsd:quick` slash-command invocation
    returns `kind:"message"` (only `/id` and `/exit` are skipped).
  - Test R9I-8: positive passthrough — legitimate user prose containing angle
    brackets returns `kind:"message"`.

## Test result

Test Files: 1 passed (1). Tests: 64 passed (64). Duration: 3.48s.
Prior test count was 56 → now 64 (8 new tests, all passing). Zero failures,
exit code 0. Scoped run only: `npx vitest run src/backend/claude-session/session-file-parser.test.ts`.

## Commit

- SHA: `6e6ca378`
- Branch: `feat/tab-title-from-tmux`
- Message: exact text from PLAN.md § Task 3 (no drift).

## Files NOT touched (per PLAN.md § Constraints)

- `~/.claude/roles/box-maintainer/skynet-patches.md` — orchestrator's job at ship time.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — holds the SIMILAR-BUT-DIFFERENT
  `isAshleyRealUserTurn` predicate that intentionally does NOT skip `/id`.
- `src/backend/database/routes/sessions.ts` — same reason as above.

## Working tree state after commit

Only the pre-existing (task-unrelated) modification to
`src/ui/features/pretty-view/IdentityModal.tsx` remains staged as `M` — that
modification was present before this task started and was not touched by the
executor.

## Deviations from PLAN.md

None. Followed PLAN.md exactly:
- 5 skip conditions in the specified order, using the specified predicates and reason strings.
- Block placed BEFORE `harness_wrapper` strip so cheap checks short-circuit first.
- Explicit `typeof content === "string"` guard included (per PLAN.md § Task 1).
- `ctrl_c_kill` uses `content.trim().replace(/[\x00-\x1F]/g, "") === ""` (trim first, then strip control chars).
- 5 negative + 3 positive-passthrough tests per PLAN.md § Task 2.
- Scoped test run only, one atomic commit with the exact message from § Task 3.
