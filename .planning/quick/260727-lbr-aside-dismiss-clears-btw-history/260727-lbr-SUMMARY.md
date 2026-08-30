---
phase: quick-260727-lbr-aside-dismiss-clears-btw-history
plan: 01
subsystem: backend/claude-session
tags:
  - backend
  - claude-session
  - aside
  - tmux
requires:
  - src/backend/claude-session/claude-session-server.ts (BTW_PROMPT, ASIDE_END_MARKER, injectBtw, __asideShellQuoteForTests, execCommand plumbing)
  - src/backend/ssh/tmux-helper.ts (execCommand)
provides:
  - BTW_CLEAR_HISTORY_KEY compile-time constant
  - dismissBtw two-keystroke helper (replaces sendEscapeToBtw)
  - __dismissBtwForTests internal test seam
affects:
  - Aside dismiss keystroke sequence (backend only)
  - PrettyView.tsx doc-comments (name sweep, no executing-code change)
tech-stack:
  added: []
  patterns:
    - Two-call tmux send-keys with sub-second gap (mirrors patch #152 injectBtw shape)
    - Compile-time keystroke constant so wrong-key UAT is a one-line fix
key-files:
  created: []
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.aside.test.ts
    - src/backend/claude-session/claude-session-server.aside.integration.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "BTW_CLEAR_HISTORY_KEY = 'x' as compile-time constant (per plan spec) — UAT wrong-key fix is a single-line change"
  - "100ms inter-keystroke gap (shorter than injectBtw's 200ms) — dismiss is single-key presses, no paste-buffer flush needed"
  - "Rename sendEscapeToBtw → dismissBtw everywhere (including doc-comments) so `grep -rn sendEscapeToBtw src/` returns zero as the fail-loud tripwire"
  - "Integration test drives the two-keystroke sequence via the execCommand mock directly (no new import of dismissBtw) — matches the existing pattern where the test simulates the dispatch shape and asserts on mock call log"
metrics:
  duration: 8min
  completed: 2026-07-27
  tasks: 2
  files: 4
  tests_before: 648
  tests_after: 653
  tests_delta: +5
requirements:
  - QUICK-ADCH-01
---

# Phase quick-260727-lbr Plan 01: Aside dismiss clears /btw overlay history before Escape (Summary)

One-liner: Replace single-Escape aside dismiss with a two-keystroke `x`-then-Escape sequence so Claude Code's `/btw` overlay clears its in-session history before closing — subsequent asides in the same Claude Code session no longer self-reference prior "please explain" turns.

## What changed

**Root cause (from CONTEXT.md):** Claude Code's `/btw` overlay maintains its own in-overlay history buffer within a single Claude Code session. When Ashley opens an aside, gets an answer, closes it, then opens a second aside on a different topic, the model self-references the first aside's answer — poisoning the second aside. The `/btw` overlay's keybinding for "clear history" is `x`; pressing it before `Escape` gives every new aside a clean slate.

**Fix (backend only, WS frame shape untouched):**
- New exported constant `BTW_CLEAR_HISTORY_KEY = "x"` in `claude-session-server.ts`, sitting next to `BTW_PROMPT` and `ASIDE_END_MARKER`.
- New `dismissBtw(conn, tmuxSession)` function replaces `sendEscapeToBtw`. Body:
  1. `tmux send-keys -t <session> 'x'` (shellQuote-wrapped)
  2. `await new Promise((r) => setTimeout(r, 100))`
  3. `tmux send-keys -t <session> Escape`
  4. Single outer `try/catch` (`sshLogger.info` on failure — log-and-swallow, same posture as the old helper).
- Sole caller — the `aside_dismissed` WS message handler — now `await dismissBtw(...)`.
- `__dismissBtwForTests` re-export mirrors `__injectBtwForTests` (internal test seam).
- PrettyView.tsx doc-comments at lines 231, 305, 633 renamed `sendEscapeToBtw` → `dismissBtw` (comments only; no executing-code change).

## Two-keystroke rationale + 100ms-vs-200ms distinction

The **shape** mirrors patch #152's `injectBtw` two-call workaround (a proven pattern in this codebase against Claude Code v2.1.150's Ink REPL keystroke handling). The **timing** is intentionally different:

- `injectBtw` uses **200ms** because it sends a ~300-char `BTW_PROMPT` paste followed by `Enter`. Ink's paste-buffer needs headroom to flush before `Enter` arrives as a distinct keystroke; otherwise Enter gets absorbed into the paste and the `/btw` overlay never opens.
- `dismissBtw` uses **100ms** because both keystrokes are single-key presses. No paste-buffer flush is needed — 100ms is enough for tmux to deliver the first keystroke to the overlay before the second is queued.

The 100ms number is captured as the literal `100` inside `dismissBtw`; if UAT reveals it's too short (unlikely — dismiss is not on a hot path), bump the literal and re-test. Do NOT copy `injectBtw`'s 200ms without cause; the plan explicitly calls this out as a non-negotiable.

## One-line-fix property of BTW_CLEAR_HISTORY_KEY

If Ashley's UAT reveals `x` isn't the right key (e.g., the overlay actually needs `c`, `Ctrl+L`, or some other keybinding), the fix is a **single-line change**:

```ts
export const BTW_CLEAR_HISTORY_KEY = "x";   // ← flip to correct key
```

Everything else — `dismissBtw` body, the shellQuote wrap, the 100ms gap, the log-and-swallow catch, the WS handler, the WS frame shape, the frontend dismiss handler — stays byte-for-byte. Test 4 in the new unit-test describe block (`aside.test.ts`) locks the current value so a rename to `c` or `Ctrl+L` fails loud and forces a deliberate re-decision (rather than a silent regression when someone touches the constant during unrelated cleanup).

## Test coverage

**5 new unit tests** in `claude-session-server.aside.test.ts` (new describe block titled `"Phase 14 quick 260727-lbr — dismissBtw two-keystroke shape (clear-history + Escape)"`):

1. **Test 1** — `execCommand` called exactly twice; call #1 contains shellQuote-wrapped `BTW_CLEAR_HISTORY_KEY` and does NOT end with `Escape`; call #2 ends with `Escape` and does NOT contain the wrapped clear-history key.
2. **Test 2** — 100ms gap enforced under `vi.useFakeTimers()`: at 99ms, only 1 call; at 100ms, 2 calls. Mirrors the microtask-flush pattern from the injectBtw Test 2.
3. **Test 3A** — log-and-swallow when call #1 rejects; function resolves undefined.
4. **Test 3B** — log-and-swallow when call #2 rejects (first succeeds, second throws); still resolves undefined.
5. **Test 4** — `BTW_CLEAR_HISTORY_KEY === "x"` (locks the constant).

**Integration test update** in `claude-session-server.aside.integration.test.ts` Test B:
- Comments now reference `dismissBtw`.
- The mock is now driven with the real two-keystroke sequence (`'x'` → `setTimeout(100)` → `Escape`) instead of a single `Escape`.
- Assertion replaced: filter all `send-keys` calls out of the mock call log, assert exactly 2, assert order — call #1 has `'x'` and NOT `Escape`; call #2 has `Escape` and NOT `'x'`.
- All other Test B coverage preserved: peer registration, pre-condition expects, `broadcastAsideDismissed(key)` call, step (a) + step (b) assertions covering the atomic BOTH-STEPS peer-state-flip rule (unchanged by this quick).

**Full test suite:** 653/653 passing across 50 files (baseline 648 + 5 new). No pre-existing tests changed behavior.

**Tripwire:** `grep -rn "sendEscapeToBtw" src/` returns zero matches — the old name is fully retired everywhere in `src/` (production code, doc-comments, and tests).

## Deviations from Plan

None — plan executed exactly as written. All plan non-negotiables preserved:
- `BTW_PROMPT`, `ASIDE_END_MARKER`, `injectBtw`, and patch #152's two-call shape all byte-for-byte unchanged.
- No version-based capability check for `BTW_CLEAR_HISTORY_KEY` (compile-time constant per orchestrator spec).
- WS frame shape (`{type:'aside_dismissed', hostId, tmuxSession}`), T-14-02-01 trust posture, and `broadcastAsideDismissed` semantics all untouched.
- No new import of `dismissBtw` in the integration test — it continues to drive `execCommand` directly.
- 100ms setTimeout in integration test step A.2 mirrors the real function's timing but is not a fake-timer test (Task 1's Test 2 owns that gate).

## Commits

- `60c1ded` — feat(quick-260727-lbr-01): dismissBtw two-keystroke shape clears /btw history before Escape
- `5adad8a` — test(quick-260727-lbr-02): integration test asserts ordered dismissBtw two-call shape; PrettyView doc-comment sweep

## Manual UAT (post-merge, not gated by this plan)

Ashley opens an aside in a Claude Code pane, closes it, opens a second aside on a different topic, and confirms the second aside answer no longer self-references the first. If the wrong key was chosen (overlay did NOT clear), flip `BTW_CLEAR_HISTORY_KEY` from `"x"` to the correct key — single-line fix, no other code change needed, tests will fail loud at Test 4 to prompt the re-decision.

## Self-Check: PASSED

Verified before writing this section:
- FOUND: `src/backend/claude-session/claude-session-server.ts` (contains `BTW_CLEAR_HISTORY_KEY`, `dismissBtw`, `__dismissBtwForTests`; no `sendEscapeToBtw`)
- FOUND: `src/backend/claude-session/claude-session-server.aside.test.ts` (new dismissBtw describe block, imports updated)
- FOUND: `src/backend/claude-session/claude-session-server.aside.integration.test.ts` (Test B updated to ordered two-call assertion)
- FOUND: `src/ui/features/pretty-view/PrettyView.tsx` (three doc-comment mentions swept to dismissBtw)
- FOUND: commit `60c1ded` (Task 1)
- FOUND: commit `5adad8a` (Task 2)
- `grep -rn "sendEscapeToBtw" src/` = 0 matches (tripwire holds)
- `npx tsc --noEmit` = clean (both mid-task and post-task)
- Full test suite: 653/653 pass (net +5 vs baseline 648)
