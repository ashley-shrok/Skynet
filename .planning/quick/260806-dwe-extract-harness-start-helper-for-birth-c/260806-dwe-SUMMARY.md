---
phase: quick-260806-dwe
plan: 01
subsystem: identity-lifecycle
tags: [refactor, dry, birth-parity, clone-fix, ux-signal]
requires: [identity-birth-orchestrator, identity-clone]
provides: [identity-harness-start]
affects: [birth, clone, CloneAgentDialog]
tech-stack:
  added: []
  patterns: [dependency-injection (exec closure), sequence-extraction, shared-module]
key-files:
  created:
    - src/backend/database/routes/identity-harness-start.ts
    - src/backend/database/routes/identity-harness-start.test.ts
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-clone.ts
    - src/backend/database/routes/identity-clone.test.ts
    - src/ui/sidebar/CloneAgentDialog.tsx
    - src/ui/sidebar/CloneAgentDialog.test.tsx
decisions:
  - Approach A (single runStep(3) wrapping helper + synthetic step 4/5 emits) worked on first try — no need for Approach B (per-step callback)
  - Constants (CLAUDE_LAUNCH_CMD_PREFIX / STEP_3_SLEEP_MS / ENTER_TRAIN_COUNT / ENTER_TRAIN_SPACING_MS) IMPORTED from birth into helper — birth stays source of truth for Nelly-tuned values, no duplication
  - Local helpers (shellSingleQuote, sleep) COPIED into helper module rather than exported from birth — < 10 lines each, keeping helper standalone is cheaper than the shared-utility abstraction
  - "Preparing session…" subtext is a plain <span role="status"> rather than a spinner glyph — button label ("Creating...") is already the primary spinner-equivalent
metrics:
  duration: 15m
  completed: 2026-08-06
---

# Phase quick-260806-dwe Plan 01: Extract Harness-Start Helper Summary

Extracted birth's steps 3-5 (post-tmux Claude-harness bootstrap) into `identity-harness-start.ts`, rewired birth to delegate to the helper, wired clone to call it after `tmux new-session`, and added a "Preparing session…" subtext to CloneAgentDialog so the modal doesn't feel hung during the ~25s wait — closes patch #321's UAT gap where clone's auto-route landed in a bare tmux with pretty-view rendering "no active Claude session".

## What Shipped

### Backend: New shared helper (`identity-harness-start.ts`, 171 lines + 271-line test)

`startHarnessOnIdentity({exec, name, remotePath})` runs the 11-command tmux sequence:

1. `node -e '<one-liner setting hasTrustDialogAccepted=true>' '<remotePath>'` — trust-flag pre-write
2. `tmux send-keys -t <name> -l '<claude launch cmd>'` — literal-mode so env-vars aren't pre-expanded
3. `tmux send-keys -t <name> Enter` — separate Enter (Nelly §1(e))
4. sleep 2000ms (STEP_3_SLEEP_MS) — let Claude REPL come up
5. Loop × 7: `tmux send-keys -t <name> Enter` + sleep 3000ms (last iteration has no post-sleep)
6. `tmux send-keys -t <name> -l '/id <name>'`
7. `tmux send-keys -t <name> Enter`

Total: 11 exec calls, ~25s wall-clock. Constants IMPORTED from birth-orchestrator so birth stays the authoritative source for Nelly-tuned values. Local helpers (`shellSingleQuote`, `sleep`) copied into helper to keep the module standalone.

### Backend: Birth rewired (`identity-birth-orchestrator.ts`, -65 / +28 lines net)

Steps 3-5 body deleted; replaced with a single `runStep(3, () => startHarnessOnIdentity({exec, name: opts.name, remotePath: escPath}))` call, followed by four synthetic `emit()` calls for step 4/5 started+completed. This preserves the SSE 5-event contract that the frontend's BirthProgress checklist depends on. Failure attribution shifts slightly: a rejection during the Enter-train or /id would now surface as step:3:failed instead of step:4/5:failed, but the frontend's failure UX just shows "step failed at N" with no per-step recovery, so the observable behavior is unchanged. Test 14 (which asserts step 3 for a claude-launch failure) continues to pass unmodified.

### Backend: Clone wired (`identity-clone.ts`, +18 lines)

Added `await startHarnessOnIdentity({exec: (cmd) => execWithTimeout(conn!, cmd), name: newName, remotePath: escWorkingPath})` immediately after the `mkdir + tmux new-session` exec, inside the same try/catch. Endpoint response shape unchanged (still 201 + `publicIdentity(newRow)`). If the helper rejects, the outer catch returns 502 "SSH exec failed" — same class as an mkdir failure, so no new frontend error-shape surface. Ordering invariant preserved: harness-start runs BEFORE `$HOME` resolution / SFTP identity-file write / DB insert.

### Frontend: CloneAgentDialog "Preparing session…" (`CloneAgentDialog.tsx`, +20 lines)

Added `role="status" aria-live="polite"` span rendering "Preparing session… (this can take ~25s while the new agent's Claude harness starts up)" while `submitting === true`. Positioned BEFORE the submitError span so on failure the error text is what remains visible. Button label ("Creating..." — patch #320 copy) untouched.

## Files Touched

| File | Delta | Purpose |
|------|-------|---------|
| `src/backend/database/routes/identity-harness-start.ts` | **+171** (new) | Shared helper exporting `startHarnessOnIdentity` |
| `src/backend/database/routes/identity-harness-start.test.ts` | **+271** (new) | 13 tests: A-I from PLAN + 4 constant sanity |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | -65 / +28 (**net -37**) | Delegate steps 3-5 to helper |
| `src/backend/database/routes/identity-clone.ts` | +18 | Call helper after tmux new-session |
| `src/backend/database/routes/identity-clone.test.ts` | +78 | Extended Test 8 (call-order) + new Test 18 (harness rejection → 502) |
| `src/ui/sidebar/CloneAgentDialog.tsx` | +20 | "Preparing session…" status subtext |
| `src/ui/sidebar/CloneAgentDialog.test.tsx` | +49 | New Test 25 (subtext appears/clears with submitting) |
| **Total** | **+635 / -65** | |

## Behavioral Parity Confirmation

| Test suite | Before | After | Delta |
|------------|--------|-------|-------|
| identity-birth-orchestrator.test.ts | 31 passing | 31 passing | 0 (all preserved unmodified) |
| identity-birth-orchestrator.role-frontmatter.test.ts | passing | passing | 0 |
| identity-birth.test.ts | passing | passing | 0 |
| identity-clone.test.ts | 17 passing | 18 passing | +1 (new Test 18: harness rejection → 502) |
| identity-harness-start.test.ts | did not exist | 13 passing | +13 (A-I + 4 constant sanity) |
| CloneAgentDialog.test.tsx | 10 passing | 11 passing | +1 (new Test 25: preparing-session UX) |
| **Full suite** | **~1465** | **1480 passed, 6 skipped** | **+15 tests, 0 regressions** |

Full-suite command: `npx vitest run` → 121 files, 1480 tests pass, 6 skipped, 0 failed. Duration 272s.

Backend + frontend builds green: `npm run build:backend && npm run build` → exit 0.

## Verification Greps (all pass)

```
grep -c "startHarnessOnIdentity" identity-harness-start.ts          # 1 (export)
grep -c "startHarnessOnIdentity" identity-birth-orchestrator.ts     # 2 (import + call)
grep -c "startHarnessOnIdentity" identity-clone.ts                  # 2 (import + call)
grep -c "Preparing session" CloneAgentDialog.tsx                    # 1
grep -c "for.*ENTER_TRAIN_COUNT" identity-birth-orchestrator.ts     # 0 (loop moved to helper)
grep -cE "^export const (CLAUDE_LAUNCH_CMD_PREFIX|STEP_3_SLEEP_MS|
         ENTER_TRAIN_COUNT|ENTER_TRAIN_SPACING_MS)" identity-birth-orchestrator.ts  # 4
```

## Commits

- `151c94d` — `feat(identity-harness-start): extract post-tmux Claude-harness bootstrap into shared helper [260806-dwe]`
- `162afc0` — `refactor(identity-birth-orchestrator): delegate steps 3-5 to startHarnessOnIdentity helper [260806-dwe]`
- `9f05739` — `feat(identity-clone): launch Claude harness after tmux new-session + preparing-session UX [260806-dwe]`

## Deviations from Plan

**Test D expectation correction (self-caught during RED-to-GREEN cycle):** The plan's Test D was written as "EXACTLY 8 non-literal Enters fire" but I initially wrote it as a whole-sequence total assertion. The sequence actually has 9 non-literal Enters total: 1 post-launch + 7 train + 1 final Enter after /id. Corrected the assertion to filter by WINDOW (from post-launch Enter through the call before /id), which yields exactly 8 (matching plan's intent), and added a separate whole-sequence assertion for 9. No functional impact — the helper's actual sequence matches the plan verbatim.

**Test 25 assertion helper (minor):** Plan called for `.toBeInTheDocument()` but the project doesn't have `@testing-library/jest-dom` installed. Switched to `.toBeTruthy()` — same semantics for our purposes (the element either exists in the DOM or throws from `getByText`), matches the pattern used elsewhere in CloneAgentDialog.test.tsx (Test 22 uses `expect(...).toBeTruthy()`).

**Approach selection:** Plan documented both Approach A (synthetic step 4/5 emits) and Approach B (per-step callback) with A as preferred. Approach A worked on first try — all 31 birth-orchestrator tests passed unmodified after the rewire. No fallback to Approach B needed.

## Self-Check: PASSED

- `src/backend/database/routes/identity-harness-start.ts` — FOUND
- `src/backend/database/routes/identity-harness-start.test.ts` — FOUND
- `.planning/quick/260806-dwe-extract-harness-start-helper-for-birth-c/260806-dwe-SUMMARY.md` — FOUND (this file)
- Commit `151c94d` — FOUND
- Commit `162afc0` — FOUND
- Commit `9f05739` — FOUND

## Follow-ups

None expected. Patch numbering + skynet-patches.md entry + bounty JSON are orchestrator responsibilities per constraints.
