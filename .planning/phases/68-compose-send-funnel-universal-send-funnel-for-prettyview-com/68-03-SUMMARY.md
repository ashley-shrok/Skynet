---
phase: 68-compose-send-funnel
plan: "03"
subsystem: pretty-view/compose
tags: [test, send-funnel, optimistic-bubbles, render-blacklist, phase-68, d-06]
dependency_graph:
  requires: [68-02]
  provides: [per-trigger-locking-tests, reset-wake-hypothesis-verification, d06-satisfied]
  affects: [ComposeBox.send-funnel.test.tsx]
tech_stack:
  added: []
  patterns: [onRegisterSendInput capture pattern for WS-frame shape testing]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx
decisions:
  - "Used aria-label='Reset context window' for reset button selector — no data-testid needed (stable existing selector)"
  - "Test 5 captures sendInput via onRegisterSendInput prop to route through ws.send — exact production send chain reproduction without mocking internals"
  - "customOnSend in Test 5 calls both onSendMock (for standard assertions) and capturedSendInput (for WS frame emission)"
  - "Test 2 uses vi.mocked(getComposeDraft).mockResolvedValueOnce to seed the slot before mount — same hydration path as production"
metrics:
  duration: ~25 min
  completed: "2026-09-02"
  tasks_completed: 2
  files_modified: 1
  files_created: 0
---

# Phase 68 Plan 03: Per-Trigger Locking Tests Summary

Added Tests 2-5 to `ComposeBox.send-funnel.test.tsx`, growing the file from 1 to 5 tests — one per user-driven send affordance; D-06 now fully satisfied. Test 5 verified the CONTEXT.md reset-wake hypothesis: the post-68-02 reset send carries `messageQueueItemId` in the outgoing WS frame.

## What Shipped

### Final test count: 5/5 passing

| Test | Trigger | Key assertions |
|------|---------|---------------|
| Test 1 (Plan 68-01) | Main textarea Enter | 1 pending bubble, mqid shape, onSend (payload, mqid) |
| Test 2 | Queue-slot Send button | 1 pending bubble with slot text, slot removed from DOM, onSend (payload, mqid) |
| Test 3 | Thumbs-up button | button.disabled===false (D-05), bubble shows 👍 not "thumbs up" (D-02), onSend receives "thumbs up" |
| Test 4 | Recap button | button.disabled===false (D-05), bubble text === /explain string (no override), onSend with same string |
| Test 5 | Reset button | countPendingBubbles===0 (render-blacklist), onSend with /id reset + mqid, WS inputFrame.messageQueueItemId === capturedMqid |

### Test 5 WS-shape assertion — reset-wake hypothesis VERIFIED

Test 5 uses `onRegisterSendInput` prop to capture PrettyView's internal `sendInput` callback, then wires a custom `onSend` that calls `capturedSendInput(text, mqid)` to emit the actual WS frame to the stub's `ws.send`. The test then parses `ws.send.mock.calls`, locates the frame where `type === "input"` and `data.startsWith("/id reset")`, and asserts `inputFrame.messageQueueItemId === onSendMqidCapture`.

**Result: VERIFIED.** The post-68-02 reset WS frame carries `messageQueueItemId`. The CONTEXT.md hypothesis is confirmed in-process: routing reset through the funnel ensures the pretty-view submit shape the Phase 56 backend wake gate keys on.

### data-testid for reset button

**Not added.** The reset button already has a stable `aria-label="Reset context window"` selector. The plan's conditional data-testid was unnecessary. Zero changes to `ComposeBox.tsx`.

### DOM-affordance discovery notes

| Affordance | Selector used | Notes |
|------------|--------------|-------|
| Queue-slot send button | `[data-slot-id="s1"] button[aria-label="Send queued message"]` | Scoped to the slot container via `data-slot-id` attribute |
| Thumbs-up button | `button[aria-label="Send 'thumbs up'"]` | Exact aria-label match from ComposeBox L2469 |
| Recap button | `button[aria-label="Recap the current situation"]` | Exact aria-label match from ComposeBox L2502 |
| Reset button | `button[aria-label="Reset context window"]` | Exact aria-label match from ComposeBox L2248 |

### Test 2 queue-slot seeding

Seeded via `vi.mocked(getComposeDraft).mockResolvedValueOnce({ body: "", queueSlots: [{ id: "s1", text: "slot payload" }] })` before mount. The ComposeBox mount effect picks up the mocked return and hydrates `queueSlots` state — same path as production hydration from the server.

### Vitest execution times (from passing run)

| Test | Duration |
|------|----------|
| Test 1 | baseline (~1.3s body) |
| Test 2 | ~2200ms (waitFor slot hydration + slot removal) |
| Test 3 | ~1300ms |
| Test 4 | ~1300ms |
| Test 5 | ~650ms |
| Full file | ~3.4s body / 62s total (transform + import shared across 5) |

## Deviations from Plan

### Architecture deviation (non-blocking): Test 5 WS-frame verification approach

**Original plan assumption:** `getCurrentWs().send.mock.calls` would contain the `{type:"input", ...}` frame directly after `onSend` is called.

**What actually happens:** The test's `onSend` prop is `onSendMock` — PrettyView's `handleComposeSend` calls this prop, which is the mocked function, NOT `sendInput`. The WS frame is sent via `sendInput` only when the production `IdentitySessionPane.onSend` routes to `pvSendInputRef.current(text, mqid)`. In the test with standalone PrettyView, the `onSend` mock intercepts before `sendInput` is ever called.

**Fix applied (Rule 3 — blocking issue):** Captured PrettyView's `sendInput` via the `onRegisterSendInput` prop (a standard PrettyView affordance for Terminal.tsx registration). Provided a custom `onSend` that calls `capturedSendInput(text, mqid)` after recording the call — reproducing the full production send chain. This is more correct than the original plan's assumption: it tests the exact WS frame shape that PrettyView emits in production.

**Impact:** Test 5 is strictly stronger than originally designed — it exercises the full `handleComposeSend → onSend → sendInput → ws.send` chain, not just `onSend` assertion.

## Verification Results

- `npx vitest run ComposeBox.send-funnel.test.tsx` — **5/5 passed** (0 failed)
- `npx vitest run ComposeBox.test.tsx ComposeBox.send-funnel.test.tsx PrettyView.optimistic-bubbles.test.tsx PrettyView.compose-send.test.tsx` — **95/95 passed** (4 files)
- `npx tsc --noEmit` — **0 errors**

## Grep Audit (acceptance criteria)

- `grep -c 'it("Test [12345]:' ComposeBox.send-funnel.test.tsx` → **5**
- `grep -c '"thumbs up"' ComposeBox.send-funnel.test.tsx` → **3** (>=2 required: aria-label selector, `toBe("thumbs up")`, `not.toContain("thumbs up")`)
- `grep -cE '\.disabled\)\.toBe\(false\)' ComposeBox.send-funnel.test.tsx` → **4** (>=2 required; Tests 3+4+2+5 all assert disabled===false)
- `grep -c "messageQueueItemId" ComposeBox.send-funnel.test.tsx` → **5** (>=1 required; Test 5 WS-frame parse uses it)
- `grep -c 'data-testid="pv-compose-reset"' ComposeBox.tsx` → **0** (no data-testid added; aria-label used instead)
- `git diff package.json package-lock.json | wc -l` → **0** (T-68-SC verified)

## Known Stubs

None. All 5 tests are fully exercising live behavior.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes. The `onRegisterSendInput` capture in Test 5 is a test-only registration of an already-existing PrettyView prop; it does not alter ComposeBox.tsx or PrettyView.tsx behavior.

T-68-09: No `data-testid` was added to ComposeBox.tsx — the stable `aria-label` on the reset button was sufficient. T-68-09 does not apply.
T-68-10: Test 5's triple-conjunction filter (`type === "input" && data.startsWith("/id reset")`) confirmed to select exactly one frame in a test that fires reset exactly once. `expect(inputFrame).toBeDefined()` precedes the `messageQueueItemId` deref.
T-68-11: Emoji in Test 3 is the literal U+1F44D codepoint copied from the ComposeBox.tsx source ("👍") — no mojibake risk.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 + Task 2 (Tests 2-5) | `89c2ec5a` | test(68-03): add Tests 2-5 to ComposeBox.send-funnel.test.tsx — queue-slot, thumbs-up, recap, reset |

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx` — modified (202 lines added, 5 tests total)
- Commit `89c2ec5a` — present in git log
- All 5 test names present in file: `grep -c 'it("Test [12345]:' ...` = 5
- `messageQueueItemId` assertion present: `grep -c "messageQueueItemId" ...` = 5
- TypeScript clean: `npx tsc --noEmit` = 0 errors
