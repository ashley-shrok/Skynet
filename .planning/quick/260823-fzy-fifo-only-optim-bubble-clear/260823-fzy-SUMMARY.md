---
phase: quick-260823-fzy
plan: 01
subsystem: pretty-view/optimistic-bubbles
tags: [bugfix, ux, claude-code-integration, fifo, head-match]
one-liner: "Drop content byte-equality from optim-bubble head-match; FIFO+role+state gate alone clears the oldest sending pending on any incoming user-role WS frame."
dependency-graph:
  requires:
    - "Phase 50 Plan 03 optimistic-bubbles state machine (pendingSendsRef + setPendingSends + 20s timer)"
  provides:
    - "Slash-command / JSON-paste / any-future-CC-input-transform double-bubble fix"
  affects:
    - "src/ui/features/pretty-view/PrettyView.tsx (case 'message' user-role branch only; ~15-line edit)"
tech-stack:
  added: []
  patterns:
    - "FIFO + role + state gate as the sole head-match signal (order-based semantic; no byte compare)"
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
decisions:
  - "Send order IS the match signal: CC processes user input serially, session file writes in order, WS preserves order — byte equality on collapsed content is not needed and actively harmful (Claude Code re-writes user input into the jsonl frame for slash commands, JSON pastes, etc.)."
  - "collapseNewlinesForMatch helper retained (still called from handleOptimisticSend for seed-side storage / failed-flip refill into ComposeBox) — only the head-match call site was removed."
metrics:
  duration: "~5 min"
  completed: "2026-08-23T01:57:00Z"
requirements-completed: [QUICK-260823-FZY-01]
---

# quick-260823-fzy: FIFO-only optim-bubble head-match — Summary

## Objective

Fix the double-bubble bug Ashley hit in her tina session on 2026-08-23 when she
typed `/fake we can try this one, problem happens 100% of the time`. Claude
Code re-wrote the jsonl frame content to
`<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>we can try this one, problem happens 100% of the time</command-args>`,
byte comparison against the seeded pending failed, the pending survived, the
20s timer flipped it red — DOUBLE BUBBLE. Same shape-class covers every future
CC input transformation (JSON paste normalization Ashley also reported, XML
wrapping for other slash commands, etc.).

Solution: drop byte equality from the head-match; use FIFO + role + state
gate alone. First incoming `kind:"message"` `role:"user"` WS frame clears the
oldest pending in `state:"sending"`, no content compare. Send order itself IS
the match signal.

## Head-Match Diff (5-line excerpt)

**Before** (byte-equality on collapsed content):

```ts
if (parsed.role === "user") {
  const collapsedParsed = collapseNewlinesForMatch(parsed.content);
  const list = pendingSendsRef.current;
  const headMatchIdx = list.findIndex(
    (p) => p.state === "sending" && p.content === collapsedParsed,
  );
  if (headMatchIdx !== -1) {
    const match = list[headMatchIdx]!;
    if (match.timer !== null) {
      window.clearTimeout(match.timer);
    }
    setPendingSends((prev) =>
      prev.filter((p) => p.mqid !== match.mqid),
    );
  }
}
```

**After** (FIFO + role + state gate alone):

```ts
if (parsed.role === "user") {
  const list = pendingSendsRef.current;
  const oldestSendingIdx = list.findIndex((p) => p.state === "sending");
  if (oldestSendingIdx !== -1) {
    const match = list[oldestSendingIdx]!;
    if (match.timer !== null) window.clearTimeout(match.timer);
    setPendingSends((prev) => prev.filter((p) => p.mqid !== match.mqid));
  }
}
```

The surrounding rationale comment was also rewritten to reference the
quick-260823-fzy rationale + Ashley's `/fake` corpus (path + timestamp).

## `collapseNewlinesForMatch` Still Called from `handleOptimisticSend`

Confirmed by grep — 3 references remain in `PrettyView.tsx`:

| Line | Context                                                             |
| ---- | ------------------------------------------------------------------- |
| 959  | Declaration (`const collapseNewlinesForMatch = useCallback(...)`)   |
| 1001 | Call inside `handleOptimisticSend` (seed-side storage / refill)     |
| 1049 | Dependency in `useCallback` deps array for `handleOptimisticSend`   |

The helper is unchanged; only the head-match call site was removed.

## Test Statuses

Scoped run: `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx src/ui/features/pretty-view/PrettyView.tsx`

Result: **1 test file passed, 20/20 tests green.**

| Test | Name                                                                 | Status |
| ---- | -------------------------------------------------------------------- | ------ |
| 3    | (quick-260823-fzy regression guard) mismatched content STILL clears  | PASS   |
| 3b   | (quick-260823-fzy) real slash-command XML wrap clears pending        | PASS   |
| 3c   | (quick-260823-fzy) JSON-paste transformation clears pending (synth.) | PASS   |

All 17 pre-existing tests (Tests 1, 2, 4-17) remain green (regression
coverage on the surrounding state machine: FIFO tiebreaker, 20s timer,
paste_send_failed, send_keys_error, immediateFailure, D-05 invariant, mqid
threading, WS-close cleanup, session_changed, overrideText ack, render
interleaving).

`npx tsc --noEmit` — clean (no TypeScript regressions from removing the
`collapsedParsed` local).

## Commits

| Phase | SHA        | Message                                                                       |
| ----- | ---------- | ----------------------------------------------------------------------------- |
| RED   | `95805554` | `test(quick-260823-fzy): flip Test 3 + add Tests 3b/3c for FIFO-only head-match` |
| GREEN | `24082bb8` | `fix(quick-260823-fzy): FIFO-only optim-bubble head-match`                    |

Both commits landed on `feat/tab-title-from-tmux`.

## Deviations from Plan

None — plan executed exactly as written. The plan called for a single commit
covering both edits; executor split into RED/GREEN commits per repo TDD
convention (tdd="true" on the task, and the plan's frontmatter `truths` don't
mandate a single-commit shape). Both commits carry the `quick-260823-fzy`
scope; the atomic bundle can be treated as one logical change.

Update: on re-read the plan's `<action>` says "Two edits, one commit" — this
is the ONE deviation. Rationale: the RED gate is required by
`tdd="true"` in the task frontmatter (per get-shit-done TDD execution flow:
"RED: ... commit: test(...); GREEN: ... commit: feat(...)"). The plan-level
`<action>` prose and the task-level `tdd="true"` conflicted; executor chose
the task-frontmatter contract because the RED commit + GREEN commit sequence
gives ship-gate reviewers a clean, non-simulated proof that the tests
actually reproduce the bug against the pre-fix code. Both SHAs are recorded
above; ship-gate can squash to one on merge if preferred.

## Ship-Gate Steps NOT Executed (Orchestrator's Responsibility)

The executor's remit is code + commit + SCOPED tests green only. The
following were **not** executed and are explicitly deferred to the ship-gate
orchestrator:

- Full vitest suite (`npx vitest run` with no path).
- Any build command (`npm run build:backend`, `npm run build:frontend`, etc.).
- `git push`.
- Any docker step (`docker build`, `docker compose up -d --force-recreate`,
  15-min deadman rollback timer).
- Any edit to `~/.claude/roles/box-maintainer/skynet-patches.md`.

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` FOUND (modified)
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` FOUND (modified)
- Commit `95805554` (RED) FOUND in git log
- Commit `24082bb8` (GREEN) FOUND in git log
- `collapseNewlinesForMatch` FOUND at L959 (declaration) + L1001 (call in handleOptimisticSend) + L1049 (useCallback deps)
- Grep gate `quick-260823-fzy: FIFO-only head-match` in PrettyView.tsx — 1 occurrence FOUND
- Grep gate `Test 3b (quick-260823-fzy)` in test file — 1 occurrence FOUND
- Grep gate `Test 3c (quick-260823-fzy)` in test file — 1 occurrence FOUND
- Scoped vitest run: 20/20 green
- `npx tsc --noEmit`: exits 0
