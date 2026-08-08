---
quick_id: 260808-ohn
type: execute
wave: 1
completed_date: 2026-08-08
commits:
  - 3b723b3 refactor(claude-session): extract layer 1 detect helpers + reducer to sibling file
  - 3ece6b3 fix(claude-session): layer 1 detects /id reset via tail-state, replaces /exit edge-triggered detector
files_created:
  - src/backend/claude-session/layer1-detect.ts
  - src/backend/claude-session/layer1-detect.test.ts
  - src/backend/claude-session/claude-session-server.layer1.test.ts
files_modified:
  - src/backend/claude-session/claude-session-server.ts
requirements_completed:
  - BOUNTY-session-holding-layer1-detect-id-reset-not-exit
ship_status: not-shipped
---

# Quick 260808-ohn Summary — Layer 1 fast-path recycle detector: /exit → tail-state /id reset

## What changed

Refactored Layer 1 in `src/backend/claude-session/claude-session-server.ts` from an edge-triggered `<command-name>/exit</command-name>` include-scan to a tail-state-derived `/id reset` detector. Extracted the detection logic into a pure sibling module (`layer1-detect.ts`) with unit tests + a co-located integration seam mirroring the existing `__applyRepollResultForTests` pattern.

Concrete edits in `claude-session-server.ts`:

- **onLine (~line 1265–1280)**: Replaced the `!hasSeenExit && changeoverState === "active" && line.includes('"content":"<command-name>/exit</command-name>')` block with `const layer1Action = applyLineToLayer1State(line, layer1, changeoverState); if (arm_holding) transitionToHolding("id_reset"); else if (clear_holding) transitionFromHoldingToActiveSameFile();`.
- **State declaration (~line 1108–1116)**: Deleted `let hasSeenExit = false`; added `let layer1: Layer1State = { mostRecentUserTurnIsIdReset: null }`.
- **Reset sites**: `teardownPane` (~line 1189) and `transitionToActiveNew` (~line 1877) now reset `layer1 = { mostRecentUserTurnIsIdReset: null }` instead of `hasSeenExit = false`.
- **transitionToHolding signature (~line 1800)**: reason union `"exit_marker" | "discovery_diff"` → `"id_reset" | "discovery_diff"`. Doc comment updated.
- **`__RepollHelpersForTests` type (~line 859)**: Same reason union update. `claude-session-server.repoll.test.ts` needed no changes (it never passes `"exit_marker"` as an argument).
- **Imports**: Added `import { applyLineToLayer1State, type Layer1State } from "./layer1-detect.js";` alongside the existing `./session-file-tail.js` import.

New files:

- **`layer1-detect.ts`** (pure module, no I/O imports): exports `isUserTurn`, `isIdResetUserTurn`, `Layer1State`, `Layer1Action`, `applyLineToLayer1State`, plus the integration seam `__applyLayer1LineForTests` + its two supporting types.
- **`layer1-detect.test.ts`**: 28 unit tests covering every case in the plan's `<behavior>` block — positive/negative for both predicates, all reducer transitions (arm/clear/no-op/dead-terminal), and the Ashley-bug regression guard fed line-by-line.
- **`claude-session-server.layer1.test.ts`**: 10 integration tests through `__applyLayer1LineForTests`, covering all 8 acceptance cases from the plan (replay, arm-on-load, Ashley-bug regression guard, historical /exit guard including a 2-exit repro, holding + non-user, dead terminal, live-append arm, live-append clear).

## Why

Ashley's bug: `SessionHoldingOverlay` flashes for a few seconds on every conversation-list revisit of any session whose JSONL contains a historical `/exit` turn (empirically 14 arm+clear pairs in ~1h on session `owGv_6oxMc7Sd5o8kzt3O`; bounty `session-holding-layer1-detect-id-reset-not-exit`).

Root cause: pre-refactor Layer 1 was an edge-triggered scan (`hasSeenExit` per-connection boolean + raw-line `.includes('"content":"<command-name>/exit</command-name>')`). Every WS reconnect calls `teardownPane` → `hasSeenExit` resets → the fresh `-n +1` tail replays every historical `/exit` line → the very first historical `/exit` re-fires `transitionToHolding("exit_marker")` even though no recycle is happening RIGHT NOW.

Fix: replace the edge-triggered detector with a tail-state-derived one. Track `mostRecentUserTurnIsIdReset` as a boolean-or-null, updated on every user turn (uniformly across replay AND live-append). Arm holding IFF `active && mostRecentUserTurnIsIdReset === true`; clear holding IFF `holding && mostRecentUserTurnIsIdReset === false`. Historical `/exit` lines (or historical `/id reset` lines followed by a regular user turn) never arm the overlay because the tail's LAST user turn cancels the arm decision.

Bonus rationale for choosing `/id reset` over `/exit` as the signal: `/id reset` is the ONE Claude Code slash-command that forces a hard session recycle. `/exit` is orthogonal — a session can have historical `/exit` lines without any recycle in flight. `/id reset` is both necessary and sufficient for the overlay's arm decision.

## Verification result

- **`npx tsc --noEmit`**: exit 0 (clean).
- **`npm run build:backend`**: exit 0 (mandatory per STATE.md 2026-07-27 patch #154 lesson — touched a backend file).
- **`npx vitest run`** (full suite): **1594 passed / 6 skipped / 0 failed** across 129 test files (316s). Baseline from STATE.md 2026-08-08 was 1526 / 6 / 0 across 123 files; delta is +6 files / +68 tests / 0 regressions. This refactor contributed +2 files (`layer1-detect.test.ts` = 28 tests, `claude-session-server.layer1.test.ts` = 10 tests = 38 tests); the remaining +4 files / +30 tests are from unrelated work on the branch since the baseline snapshot. No pre-existing flakes surfaced; no memory-pressure timeouts hit (the runs on Test 11 uploads and NewSessionDialog Test G that STATE.md flagged as concurrent-load flakes both passed cleanly in this run).
- **Byte gates**:
  - `grep -n '"exit_marker"' src/backend/claude-session/claude-session-server.ts` → 1 hit (line 854), all in a comment citing the pre-refactor state. **Zero active-code references.**
  - `grep -n 'hasSeenExit' src/backend/claude-session/claude-session-server.ts` → 1 hit (line 1115), in a comment citing the pre-refactor state. **Zero active-code references.**
  - `grep -n "command-name>/exit" src/backend/claude-session/claude-session-server.ts` → 0 hits.
  - `grep -n '"id_reset"' src/backend/claude-session/claude-session-server.ts` → 5 hits (type union, function signature, call site, comments). Plan required at least 2; got 5.

## Deviations

- **None from the plan's specified action list.** Everything landed as spec'd — same file paths, same helper signatures, same TDD split (Task 1 helpers-first with RED-then-GREEN progression, then Task 2 wiring + integration tests). One minor commentary addition: the reducer's "dead-terminal" branch explicitly guards before mutating state, and the `__applyLayer1LineForTests` seam re-reads `state.changeoverState` at dispatch time (not at reducer-return time) so if the injected `transitionToHolding` stub flips changeoverState to "holding", subsequent lines correctly see the new value. That mirrors production behavior — Task 2 Case 1 of the integration tests validates this end-to-end.
- No auth gates, no architectural questions surfaced, no Rule 4 checkpoints hit.

## Ship status

**NOT SHIPPED.** No `npm run build` (Vite/frontend), no docker build, no push, no deploy. Ashley greenlights ship separately per fleet convention (code work does not authorize ship). Backend `tsc -p tsconfig.node.json` was run only to satisfy the STATE.md 2026-07-27 rule that any backend touch must at minimum compile against the backend tsconfig.

## Self-Check

**FILES:**
- `src/backend/claude-session/layer1-detect.ts` → FOUND
- `src/backend/claude-session/layer1-detect.test.ts` → FOUND
- `src/backend/claude-session/claude-session-server.layer1.test.ts` → FOUND
- `src/backend/claude-session/claude-session-server.ts` (modified) → FOUND

**COMMITS:**
- `3b723b3` (Task 1) → FOUND on feat/tab-title-from-tmux
- `3ece6b3` (Task 2) → FOUND on feat/tab-title-from-tmux

## Self-Check: PASSED
