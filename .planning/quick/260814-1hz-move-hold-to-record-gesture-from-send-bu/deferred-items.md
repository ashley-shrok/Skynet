# Deferred Items — Quick 260814-1hz

Items discovered during execution that are OUT OF SCOPE for this quick task
(per SCOPE BOUNDARY rule: only auto-fix issues DIRECTLY caused by the current
task's changes). Logged here for future work.

## Pre-existing test failure (unrelated)

- **`src/ui/features/pretty-view/IdentityModal.test.tsx > IdentityModal — title
  + avatar edit (quick 260731-1c8) > 1: edit-title happy path`**
  - Test times out at the 5000ms vitest default (fails at ~5-6s).
  - Reproduces on isolation (`npx vitest run
    src/ui/features/pretty-view/IdentityModal.test.tsx`) with only this
    single test failing (5/6 pass).
  - Files touched by this quick task (`ComposeBox.tsx`, `MicButton.tsx`) do
    NOT touch IdentityModal or any of its dependencies — the failure is
    pre-existing and unrelated to Quick 260814-1hz.
  - Likely fix: raise the test's `testTimeout` value or reduce a synthetic
    wait inside the test setup. Investigate under its own bounty.

## Re-arm limitation of `useVoiceRecording` (documented, not fixed)

Observed while executing Task 4 (Test 10 Case A):

When a hold gesture is released AFTER `getUserMedia` has already resolved
(i.e., cancel takes the real-teardown branch rather than the fast
pending-cancel branch), the hook's `onShortTap` fires `beginRecord()`
synchronously after `await voice.cancel()` completes. Inside
`voice.start()`, the `stateRef.current !== "idle"` guard blocks the re-arm
because `stateRef` is synced from `state` via a `useEffect` that runs on
the NEXT render tick — not synchronously inside `setState("idle")`.

Real-world impact: negligible. `getUserMedia` in production takes
significantly longer than 249ms (the fake-timer boundary that surfaced
this), so the fast pending-cancel branch is the norm; re-arm works there
via the `pendingCancelRef` reset at the top of `voice.start()`.

Constraint: the plan explicitly forbade touching
`src/ui/features/pretty-view/useVoiceRecording.ts`, so this was documented
in the test comment rather than fixed. If Ashley wants short-tap-after-
resolve to reliably re-arm on iOS Safari (rare but possible on slow
networks), the fix is a synchronous `stateRef.current = "idle"` write
inside `cancel()` immediately after the `setState("idle")` at
`useVoiceRecording.ts:535` (mirrors the pattern already in place for the
starting-no-recorder branch at L505-506).
