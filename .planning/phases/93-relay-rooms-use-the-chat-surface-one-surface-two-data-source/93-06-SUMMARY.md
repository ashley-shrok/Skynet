# Phase 93 Slice 6 — post-close polish pass

**Date:** 2026-09-09
**Trigger:** Unbiased general-purpose code review pass after `/close` returned `closed-with-misses` for Phase 93. Reviewer surfaced 4 Warnings + 5 Info findings + the outstanding error-screen reshape ask from Alice's `/close` divergence adjudication. Alice greenlit fixing inline before ship.

## Findings addressed

### Warnings (all fixed)

- **Warning 1 — Send button disabled in relay mode.** `canSend` in `PrettyView.tsx:4169-4173` derived exclusively from harness-only `status` / `renderedState` state. In relay mode, harness ingestion is gated off so `status` never left `"connecting"` — `canSend={false}` always. Send button rendered visually disabled; Enter-to-send bypassed the gate (which is why the relay-source tests didn't catch it). Fix: `canSend={source.kind === "relay" || status === "streaming" || renderedState === "dormant" || renderedState === "active"}`. Regression floor for the Send-button behaviour in relay rooms.
- **Warning 2 — Log spam in error state.** Structured log fired inside a JSX IIFE gated on `chatSurfaceAdapter.error !== null` — meant every render while error was active re-logged the same event. React strict-mode double-fired. Fix: moved to a `useEffect` gated on `[source, chatSurfaceAdapter.error]` — fires only on transition into a new error value, then stays quiet. D-08 discipline (relay-narrowed field reads inline with `source.kind === "relay"` narrowing on the same line) preserved.
- **Warning 3 — Fresh object per render defeated memoization.** `useRelayAdapter` returned a fresh object literal + fresh `messages` array every render. Consumers (React.memo boundaries, `handleComposeSend` useCallback deps that include the adapter) got a new reference each render → memoization defeated across the compose subtree in relay mode. Fix: `useMemo` on the mapped messages (keyed on `history`) + `useMemo` on the returned object. **Corollary — rules-of-hooks fix (Pitfall 2):** the two `useMemo` calls MUST sit BEFORE the `if (source === null) return IDLE_STATE;` early-return, or React throws "Rendered more hooks than during previous render" on the harness→relay kind-flip. Caught by `chat-surface-source.test.ts` Test 3 (hook-count stability); the initial fix landed the useMemos after the early-return and had to be restructured.
- **Warning 4 — reconnectAttempts never reset on successful open.** After the 5-attempt cap fires the ladder was permanently exhausted; a healthy WS that later dropped hours in never reconnected. Inherited byte-for-behavior from the retired standalone hook via Slice 3's D-10 move-as-blob port. Fix: one-line `reconnectAttemptsRef.current = 0` at the top of the successful `onopen` callback.

### Info-5 (fixed — was actually a real UX bug)

- **Info-5 — Double optimistic bubble + red-at-20s in relay rooms.** PrettyView unconditionally passed `onOptimisticSend={handleOptimisticSend}` to ComposeBox, which seeded local `pendingSends` state on every send regardless of mode. In relay mode, the harness ingestion effect (which head-matches local pending) is gated off — so local pending never resolves. Meanwhile the relay adapter's own optimistic-tracking (per Pitfall 4 mqid echo correlation) produces its own bubble in `adapter.messages`. Net: **double bubble on send in relay rooms** (local pending + adapter optimistic), local one **flips red at 20s** when its timer fires. Real UX regression, not just state accumulation. Fix: `onOptimisticSend={source.kind === "relay" ? undefined : handleOptimisticSend}`. Adapter owns relay-case optimistic bubbles per D-14; hook-level Test 5 in `use-relay-adapter.test.ts` covers the correlation end-to-end. Composed-level Slice 5 tests (Tests 1-5 in `PrettyView.optimistic-bubbles.test.tsx`) were LOCKING IN this bug's behavior — rewritten to assert the correct behavior (no local pending in relay, adapter owns).

### Error-screen reshape from `/close` (fixed — Alice's ask)

- **`/close` finding — new-type error screen.** Alice's criterion at close: matches existing overlays = endorsed drift; new-type screen = unsanctioned. The old `ChatSurfaceErrorState` was structurally a new-type screen (no scrim, no z-band overlay layer, no glyph, different card gradient/padding/gap, replaced the message list in-flow via `flex-1`) — Alice wanted the same scrim + centered glass card + static glyph + z-band pattern that `PrettyViewErrorOverlay` + `SessionHoldingOverlay` share. Fix: reshaped `ChatSurfaceErrorState.tsx` to mirror `PrettyViewErrorOverlay`'s scrim geometry verbatim (`absolute inset-0 z-[99]` + `backdrop-blur-md bg-black/40` + iOS-Safari hardening + `animate-in fade-in`) + warm-red card gradient + static `RefreshCcw` glyph. Copy stays "This conversation is no longer available." + optional subline. No Retry button (nothing to retry — distinguishes from `PrettyViewErrorOverlay` which is a recoverable-WS-failure). `role="status"` (informational — matches the terminal-informational nature). Mount changed from in-place-replacement to overlay-alongside-message-list.
- **Corollary — test migration.** `PrettyView.relay-source.test.tsx` Test 6 previously asserted "message list NOT rendered when error shows" (in-place-replacement semantics). Rewritten to assert overlay semantics: error-state's scrim covers the message list via `absolute inset-0 z-[99]` rather than replacing it.
- **Added lock-in tests.** `ChatSurfaceErrorState.test.tsx` Test 8b (scrim tokens present) + Test 8c (static warm-red glyph, motion-channel guardrail — no `animate-spin`).

## Commits

- `18f3c25b` fix(93-06): reset reconnect-attempts on WS open + memoize adapter return (Warnings 3+4)
- `<hash-b>` fix(93-06): canSend include relay + suppress local pendingSends in relay (Warning 1 + Info-5)
- `<hash-c>` fix(93-06): reshape ChatSurfaceErrorState to overlay pattern + move relay-error log to useEffect + rules-of-hooks fix on adapter memoization (Warning 2 + Alice error-screen ask + test-migration for Info-5)

## Verification

- `npx tsc --noEmit` clean.
- Scoped tests green: `npx vitest run src/ui/features/pretty-view/ src/ui/shell/tabUtils.test.tsx` — 1072 passed, 11 skipped, 1 todo across 93 test files.
- Harness case regression floor: 1000+ pre-existing pretty-view tests remain green unchanged.
- `data-testid` shape preserved for adjacent test surfaces (`chat-surface-error-state`, `chat-surface-error-title`, `chat-surface-error-subline`).

## What still awaits

- `/close`'s Close-Out section on the (now-archived) shape file already logged the reshape as a follow-up disposition `new-shape`. That's now satisfied inline; when the next `/close` variant runs (or a formal re-close is filed), disposition should flip to `resolved-inline`.
- Ship motion is still gated on Alice's greenlight (fleet rule — deploy-window boundary at `git push`).

## Info items NOT addressed (deliberately)

- **Info items 1-4 from the code review** — module-scoped fleet cache, unconditionally exported test reset, minor type-nulls, empty-mxid timing edge. All flagged as "worth knowing" not "worth fixing"; the reviewer explicitly said non-blocking. Deferred for follow-up bounty consideration, not this slice's scope.
