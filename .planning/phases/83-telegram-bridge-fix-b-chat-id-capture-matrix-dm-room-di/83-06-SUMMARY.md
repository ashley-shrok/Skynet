---
phase: 83-telegram-bridge-fix-b
plan: 06
subsystem: telegram-bridge
tags: [telegram, bridge, react, useEffect, polling]
requires: [83-05]
provides:
  - "TelegramTab 3s poll of getTelegramPendingStatus while in pending-start; auto-advance to connected on non-null chatId"
affects:
  - "src/ui/features/pretty-view/TelegramTab.tsx"
  - "src/ui/features/pretty-view/TelegramTab.test.tsx"
tech-stack:
  added: []
  patterns:
    - "useEffect polling with clearInterval + `cancelled` guard for setState-after-unmount race safety"
    - "Discriminated-union dep-array via extracted `pendingBotUsername` local (strict-mode friendly)"
    - "Silent-error swallow (no error-state flip) per CONTEXT § 5 'human gets to it when they get to it'"
    - "Poll-suite fake timers scoped to its own describe block; pre-existing suites keep real timers"
key-files:
  created: []
  modified:
    - "src/ui/features/pretty-view/TelegramTab.tsx (useEffect + import diff, no render changes)"
    - "src/ui/features/pretty-view/TelegramTab.test.tsx (PLL-01..PLL-07 suite + mock extension)"
decisions:
  - "Poll cadence: 3000ms — chosen from CONTEXT § 5's 3-5s range. Lower bound of the range keeps end-to-end round-trip UX under ~4s post-/start."
  - "Silent error handling — poll errors never surface to the user, per CONTEXT § 5's explicit no-timeout rule. Cancel remains the only user-initiated exit from pending-start."
  - "telegramHandle in the connected state receives resp.chatId (a numeric string) — the bridge endpoint returns only chatId, not the @-handle. Matches the plan's must_haves.truths bullet 3 and CONTEXT § 5's practical Y-field choice."
  - "Dep-array shape: [state.status, pendingBotUsername, identityKey, onStateChange]. pendingBotUsername is extracted before the effect as `state.status === 'pending-start' ? state.botUsername : ''` so TSC accepts it under strict discriminated-union narrowing. Alternative ternary-in-deps was in the plan; extracted-local is cleaner and identical semantically."
  - "No manual 'check now' button, no retry counter, no max-retry timeout — per CONTEXT § 5 explicit constraints."
metrics:
  duration: "~20 min"
  completed: "2026-09-07"
  tasks: 1
  files_changed: 2
  loc_added: "~390 (62 src + 331 tests including 7 new tests)"
---

# Phase 83 Plan 06: TelegramTab pending-start poll → connected auto-transition Summary

Closes the end-to-end UX loop for Fix B: after the user pastes their bot token
and lands in the "waiting for /start" pending-start state, TelegramTab now
polls `GET /telegram/status?identityKey=<key>` every 3 seconds and
auto-transitions to "Connected" the moment the bridge reports a non-null
`chatId`. No modal close/reopen required.

## What was built

### `src/ui/features/pretty-view/TelegramTab.tsx`

1. Added `useEffect` to the React import (line 21).
2. Added `getTelegramPendingStatus` to the `../../api/telegram-api` import
   (line 34-39).
3. Inserted a single `useEffect` inside the component body, after the
   `useState` hooks and before `handleSubmitToken` (lines 76-134):
   - Guards `if (state.status !== "pending-start") return;` so no interval
     is created in any other state variant.
   - Extracts `currentBotUsername` from the discriminated-union variant
     via a pre-effect local `pendingBotUsername` — keeps the dep array
     clean and TSC-strict.
   - `setInterval(..., 3000)` fires `tick()` every 3s.
   - `tick()` `await`s `getTelegramPendingStatus(identityKey)`. On
     `{ ok: true, chatId: <non-null> }` calls `onStateChange({ status:
     "connected", botUsername: currentBotUsername, telegramHandle: chatId
     })`. All other responses (chatId null, `{ ok: false, ... }`, or a
     thrown error via the defensive try/catch) are silently ignored.
   - Cleanup: `cancelled = true` + `clearInterval(handle)`. The
     `cancelled` flag guards the two `await`-continuation points inside
     `tick()` against a late-arriving resolution racing against an unmount
     or state transition.
4. **No render-branch changes.** The connected-state render at L292-346
   already reads `state.telegramHandle` — Fix B just feeds it via
   `resp.chatId` during the transition. Pending-start UI (Copy bot link,
   Cancel button, botLink `<a>`) is byte-identical to Phase 79.

### `src/ui/features/pretty-view/TelegramTab.test.tsx`

Extended the vi.mock chain at L23-29 with `getTelegramPendingStatus: vi.fn()`
and imported it. Added a top-level `mockGetTelegramPendingStatus` handle.

The pre-existing `beforeEach` now stubs a default `{ ok: true, chatId: null }`
resolution — required because Test 1 (`unconfigured → submit valid token →
pending-start`) transitions INTO pending-start, which now immediately
schedules an interval. Without a default resolution the setInterval callback
would call `.then` on `undefined` and hang the test suite. Individual PLL
tests override this default with `mockResolvedValueOnce` chains.

A new `describe("Phase 83 Plan 06 — pending-start 3s poll", ...)` block
holds all 7 new tests. Its own `beforeEach` calls
`vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout",
"clearTimeout"] })`; `afterEach` calls `vi.useRealTimers()`. **Fake timers
are scoped to this suite only** — the pre-existing 7 tests continue to run
under real timers so their `waitFor` + microtask flushing keeps working.

### The 7 new tests

| ID     | Case                                                             | Expected                                                                 |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| PLL-01 | Poll fires every 3s in pending-start                             | Called at 3000ms, again at 6000ms, both with `"alexander"`                |
| PLL-02 | Non-null chatId triggers connected transition, then poll stops   | onStateChange called once with the connected shape; no further polls     |
| PLL-03 | Poll errors (`{ ok:false }`) do NOT flip state                   | onStateChange NEVER called; pending-start UI still rendered               |
| PLL-04 | Cleanup on unmount                                               | No polls after `unmount()` even after +6000ms                            |
| PLL-05 | Poll does NOT start in unconfigured/connected/restart-failed/loading/error | mockGetTelegramPendingStatus never called across all 5 states  |
| PLL-06 | identityKey change re-keys the interval                          | Last call after rerender uses `"bravo"`, not `"alexander"`               |
| PLL-07 | 30-second soak post-transition                                   | No further polls even after 30_000ms of advanced time                    |

### Test-suite helper

`async function tick(ms)` wraps `vi.advanceTimersByTime` in `act(async
() => { … })` and drains three microtask hops so the poll's single
`await getTelegramPendingStatus(...)` chain settles before assertions.
Three hops is enough for one Promise resolution + the transition's
onStateChange callback + any React state-update flush.

## Poll cadence — why 3000ms

CONTEXT § 5 gives the 3-5s range. Chose 3000ms:

- Lower bound → tighter round-trip UX. A `/start` sent immediately after
  clicking "Submit" is typically visible on the bridge within
  ~1s (Telegram getUpdates long-poll cycle). Adding our 3s frontend
  interval + up to 30s of Skynet reconcile-loop tick gives a P50
  end-to-end of ~5s, P99 of ~34s. Bumping to 5000ms would push P50 to
  ~7s with no meaningful backend benefit.
- Backend cost is negligible: `GET /telegram/status` reads one DB row
  and returns 20 bytes. At ~5 concurrent identity modals fleet-wide, 3s
  interval is 1.67 QPS — orders of magnitude below any latency floor.

## Silent-error handling — why NO error-state flip

CONTEXT § 5 rule: *"no timeout that flips to error — human gets to it
when they get to it"*. If the bridge is truly wedged (network partition,
bridge container crashed, Synapse admin API down), the user's Cancel
button is always visible in the pending-start UI. Cancel wires to the
existing `handleCancelPending` → `postTelegramDisconnect` recovery flow
(unchanged from Phase 79 Plan 07).

Rationale: Ashley's real workflow is "paste token, go answer the door,
come back in 15 minutes". A 30s timeout flipping the tab to "error" would
be actively harmful — she'd think the flow was broken and re-paste,
potentially generating a duplicate bot registration or hitting Telegram
rate limits.

## Dep-array final shape

```typescript
const pendingBotUsername =
  state.status === "pending-start" ? state.botUsername : "";
useEffect(() => {
  // ... poll body ...
}, [state.status, pendingBotUsername, identityKey, onStateChange]);
```

- `state.status` — primary key: effect runs on entry to pending-start,
  cleanup runs on exit.
- `pendingBotUsername` — captured into `currentBotUsername` inside the
  closure so the transition target has the right value. Extracting via
  ternary BEFORE the effect (rather than inside the deps array) makes
  TSC's discriminated-union narrowing accept it without the
  `state.botUsername` access on non-pending-start variants.
- `identityKey` — a mid-flow identity switch (rare but possible if the
  parent IdentityModal remounts with a different identity) restarts the
  interval with the new key. Verified by PLL-06.
- `onStateChange` — included per exhaustive-deps hygiene; the parent
  IdentityModal passes a stable reference so this never triggers a
  spurious restart in practice.

## React 18 strict-mode notes

No double-invocation issues encountered. The `cancelled` flag pattern
handles React 18 strict-mode's dev-only effect double-fire correctly:
the first-mount effect sets `cancelled = true` in its cleanup before the
second-mount effect starts, so any in-flight `getTelegramPendingStatus`
resolves into a `cancelled` branch and does not call `onStateChange`.

## Deviations from Plan

None substantive — plan executed as written. Two minor grep-count
mismatches from the acceptance criteria worth noting:

1. **`grep -c 'useEffect'` returned 2 (plan expected 1).** Every plan
   that adds `useEffect` to a file inherently incurs the React import
   line PLUS the actual usage. Plan spec was aspirational; the intent
   ("single new effect added") is satisfied — there is exactly one
   `useEffect(...)` call site.
2. **`grep -c 'cancelled'` returned 4 (plan expected 3).** Structural
   minimum is 4: `let cancelled = false;` + `if (cancelled) return;` ×
   2 (before-await, after-await guards) + `cancelled = true;` in
   cleanup. Removing any of these would open a setState-after-unmount
   race. Kept all 4 for correctness.

The other grep-count criteria pass exactly:
- `getTelegramPendingStatus` = 2 ✓ (import + call)
- `setInterval` = 1 ✓
- `clearInterval` = 1 ✓
- `3000` = 1 ✓

## Verification

- `npx vitest run src/ui/features/pretty-view/TelegramTab.test.tsx` →
  14 passed (7 pre-existing + 7 new PLL tests).
- `npx tsc --noEmit -p tsconfig.json` → 0 errors.
- Grep confirms no `console.log`, no `botToken` references inside the
  useEffect body (both live in the existing `handleSubmitToken`, untouched).
- Full test suite NOT run (per scope instructions from orchestrator).

## Commits

| Task | Kind | Hash       | Subject                                                      |
| ---- | ---- | ---------- | ------------------------------------------------------------ |
| 1    | RED  | `b6853fcb` | test(83-06): TelegramTab pending-start poll                  |
| 1    | GRN  | `caabdb72` | feat(83-06): pending-start poll advances to connected on chatId |

## Wave dependency note

Plan 83-05 shipped the backend endpoint + client method at commits
`39b05257` + `a07430bb`. Plan 83-06 wires the client method into the
component's lifecycle. Wave 3 is now complete.

End-to-end Fix B flow (all upstream plans shipped):

1. User pastes bot token → Phase 79 activation → pending-start.
2. **Plan 83-06 poll starts** (this plan).
3. User sends `/start` on Telegram.
4. Bridge poller sees message → writes `/state/<agent>.pending-chat-id`
   sentinel (Plan 83-01).
5. Reconcile loop (Plan 83-03, wired via Plan 83-02) reads sentinel,
   writes `telegram_bot_tokens.telegramChatId`, rewrites registry,
   unlinks sentinel.
6. Plan 83-06 poll's next tick reads the fresh chatId via Plan 83-05's
   `GET /telegram/status` → auto-transition to connected.

Typical wall-clock from step 3 → step 6: **3-6 seconds** at 3s poll cadence.

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/83-telegram-bridge-fix-b-chat-id-capture-matrix-dm-room-di/83-06-SUMMARY.md`
- Commit `b6853fcb` present in `git log`
- Commit `caabdb72` present in `git log`
- `src/ui/features/pretty-view/TelegramTab.tsx` contains `useEffect(` (single call site)
- `src/ui/features/pretty-view/TelegramTab.tsx` contains `getTelegramPendingStatus` (import + call, 2 occurrences)
- `src/ui/features/pretty-view/TelegramTab.tsx` contains `setInterval(` and `clearInterval(`
- `src/ui/features/pretty-view/TelegramTab.test.tsx` contains `describe("Phase 83 Plan 06 — pending-start 3s poll"`
- 14 tests pass under `npx vitest run` on the test file
- `npx tsc --noEmit -p tsconfig.json` exits 0
