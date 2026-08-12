---
phase: 260812-wu4
plan: "01"
subsystem: claude-session/layer1-detect
tags:
  - claude-session
  - layer1-detect
  - session-holding-overlay
  - id-reset
  - bug-fix
dependency_graph:
  requires: []
  provides:
    - isUserTurn widened to reject harness synthetics
  affects:
    - SessionHoldingOverlay stability after /id reset
tech_stack:
  added: []
  patterns:
    - "Pure line.includes byte-check predicate widening"
key_files:
  modified:
    - src/backend/claude-session/layer1-detect.ts
    - src/backend/claude-session/layer1-detect.test.ts
decisions:
  - "Positive-whitelist `\"content\":[` substring check covers all array-content synthetics (skill-body + future image attachments)"
  - "Separate substring checks for <local-command-caveat> and <local-command-stdout> for clarity"
  - "Test G (tool_result regression dup) omitted — existing test at layer1-detect.test.ts:146 covers it; Tests A-F and H-I added instead"
metrics:
  duration: "~8 minutes"
  completed: "2026-08-12"
  tasks_completed: 1
  tasks_total: 1
---

# Phase 260812-wu4 Plan 01: Tighten isUserTurn to reject harness synthetics — Summary

Widened the `isUserTurn` predicate in `layer1-detect.ts` to reject three categories of harness-synthesized `"type":"user"` JSONL lines that were falsely firing `clear_holding` on the SessionHoldingOverlay right after `/id reset` armed it. Result: the overlay now stays armed through the harness's post-`/id reset` synthetic noise (skill-body injection + `!bash` chatter) until the actual recycle completes and Layer 2's `session_changed` fires the real clear.

## What Was Changed

### `src/backend/claude-session/layer1-detect.ts`

Widened `isUserTurn` (lines 82-87 → now 82-112) with three new rejections:

1. **`"content":[` substring check** — rejects ALL array-content synthetic user turns: skill-body text-block injections after slash commands, image attachments (defensive), and tool_result arrays (redundant with existing check, harmless). Real user typing in Claude Code is ALWAYS `"content":"<string>"`, never array content.

2. **`<local-command-caveat>` substring check** — rejects the harness wrapper synthesized when the user runs a `!bash` command.

3. **`<local-command-stdout>` substring check** — rejects the harness wrapper that feeds `!bash` output back into model context.

The JSDoc was rewritten to explain all four rejection paths (including the pre-existing `tool_result` check) with byte-shape examples and JSONL evidence citations.

**Module invariants preserved:** no I/O imports, no `JSON.parse`, predicate remains pure `line.includes` byte-checks (matching the contract at `layer1-detect.ts:44-48`). `isIdResetUserTurn`, `applyLineToLayer1State`, `__applyLayer1LineForTests`, `Layer1State`, `Layer1Action`, and all other exports are byte-for-byte unchanged.

### `src/backend/claude-session/layer1-detect.test.ts`

Added 8 new tests:

**Fixture builders added:** `skillBodyUserTurnLine`, `localCommandCaveatUserTurnLine`, `localCommandStdoutUserTurnLine`, `imagePartUserTurnLine` — each producing realistic JSONL via `JSON.stringify` on the empirically observed byte-shapes.

**Unit tests appended to `describe("isUserTurn")`:**
- Test A: skill-body injection (array content) → `false`
- Test B: `<local-command-caveat>` wrapper → `false`
- Test C: `<local-command-stdout>` wrapper → `false`
- Test D: defensive image-attachment array → `false`
- Test E: real freeform user typing → `true` (positive path preserved)
- Test F: real `/id reset` envelope (STRING content) → `true` (positive path preserved)

**Integration tests via `__applyLayer1LineForTests` (new describe block):**
- Test H: sequence `[/id reset → skill-body → <local-command-caveat>]` from `active` state → `transitionToHolding` called ONCE, `transitionFromHoldingToActiveSameFile` called ZERO times, final `changeoverState === "holding"`. Proves the production bug is fixed.
- Test I: sequence `[/id reset → real freeform typing]` → `transitionToHolding` called ONCE, `transitionFromHoldingToActiveSameFile` called ONCE, final `changeoverState === "active"`. Proves supersede semantics preserved.

## Empirical Byte-Shape Evidence

JSONL file: `/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tiffany/889ccee9-4ae8-4f2e-b255-f1e1b9663df6.jsonl`

- Line 524: real `/id reset` — `{"type":"user","message":{"role":"user","content":"<command-name>/id</command-name>...<command-args>reset</command-args>"}}`
- Line 525: skill-body injection — `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Base directory..."}]}}`
- Line 549: `<local-command-caveat>` — `{"type":"user","message":{"role":"user","content":"<local-command-caveat>...</local-command-caveat>"}}`
- Line 551: `<local-command-stdout>` — `{"type":"user","message":{"role":"user","content":"<local-command-stdout>...</local-command-stdout>"}}`

## Deviations from Plan

None — plan executed exactly as written. Test G (tool_result regression dup) was omitted as the plan permitted ("OPTIONAL if the executor judges the existing case at line 146 sufficient"); the existing test at `layer1-detect.test.ts:146` was confirmed green.

## Test Suite Results

Full `npx vitest run` from `/home/ubuntu/skynet-tiffany`:

```
Test Files  154 passed (154)
     Tests  1969 passed | 6 skipped | 1 todo (1976)
  Start at  23:46:35
  Duration  539.33s
```

- **+8 new tests** vs baseline (1961 → 1969 pass)
- **0 regressions**
- Exit code: **0**

Tests specifically verified:
- `layer1-detect.test.ts`: 41 passed (36 pre-existing + 8 new, counting fixture imports)
- `claude-session-server.layer1.test.ts`: 23 passed — all green, widening is additive-negative
- `session-file-parser.id-reset.test.ts`: Test 12 round-trip invariant `detectIdReset ⇔ isIdResetUserTurn` stayed green — real `/id reset` fixtures use STRING content, not touched by `"content":[` rejection

TypeScript: `npx tsc --noEmit` — exit 0.

## Module Invariant Verification

- No I/O imports added: confirmed (no `import.*ssh2`, `import.*WebSocket`, `import.*logger`)
- No `JSON.parse` calls added: confirmed
- Predicate remains pure `line.includes` byte-checks

## Commit

`6ce1403` — `fix(layer1-detect): reject skill-body + local-command harness synthetics from isUserTurn`

Two files changed: `src/backend/claude-session/layer1-detect.ts` + `src/backend/claude-session/layer1-detect.test.ts`. Exactly one atomic commit on `feat/tab-title-from-tmux`.

## Fleet Rule Compliance

- NOT pushed
- NOT `docker build`ed
- NOT deployed
- `~/.claude/roles/box-maintainer/skynet-patches.md` untouched
- Orchestrator awaits Ashley greenlight for deploy motion

## Self-Check: PASSED

- `src/backend/claude-session/layer1-detect.ts` — exists, modified
- `src/backend/claude-session/layer1-detect.test.ts` — exists, modified
- Commit `6ce1403` — exists on `feat/tab-title-from-tmux`
- Working tree clean
- Full suite exit 0
