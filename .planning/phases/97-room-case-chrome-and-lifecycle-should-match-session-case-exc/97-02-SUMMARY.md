---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 02
subsystem: ui/pretty-view
tags: [ui, relay, veil, adapter, phase-97-finding-1]
requires:
  - Phase 93 Slice 3 (useRelayAdapter with history_batch handler)
  - Phase 93 Slice 6 (ChatSurfaceErrorState overlay pattern — coexistence discipline)
provides:
  - ChatSurfaceAdapterState.isMessagesLoaded (optional field on the adapter contract)
  - Relay adapter flips isMessagesLoaded=true on first history_batch frame
  - PrettyView peer veil-arm effect for the relay case (case-gated on source.kind)
affects:
  - src/ui/features/pretty-view/sources/chat-surface-source.ts
  - src/ui/features/pretty-view/sources/use-relay-adapter.ts
  - src/ui/features/pretty-view/sources/use-harness-adapter.ts
  - src/ui/features/pretty-view/PrettyView.tsx
tech-stack:
  added: []
  patterns:
    - "Data-over-configuration (Phase 93 D-17): veil signal flows adapter → surface as an optional field, NOT a case-branch on rendering."
    - "source.kind === 'harness' | 'relay' as the sole case discriminator (Phase 93 D-08)."
    - "Peer effects sharing a single setState (showResolvingSpinner) — mirrors the pattern used across PrettyView's overlays where multiple triggers write to one visibility slot."
key-files:
  created:
    - src/ui/features/pretty-view/PrettyView.relay-veil.test.tsx
  modified:
    - src/ui/features/pretty-view/sources/chat-surface-source.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.ts
    - src/ui/features/pretty-view/sources/use-harness-adapter.ts
    - src/ui/features/pretty-view/sources/use-relay-adapter.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "Signal choice: history_batch frame, NOT session frame (Phase 97 D-04). session fires on WS-auth pass — too early. history_batch fires when backend has read the room's history."
  - "Frame arrival is the signal, NOT events.length. Empty rooms must dismiss too; a history_batch with events:[] flips isMessagesLoaded=true (Phase 97 D-03 landmine)."
  - "Peer effect (Path A / data-driven) chosen over case-branched veil mount gate (Path B). The mount gate at L3782 stays case-agnostic; both effects arm the same showResolvingSpinner slot."
  - "No reset for isMessagesLoaded on reconnect — mirrors setIsReady discipline (no isReady=false reset anywhere in use-relay-adapter). Adding a defensive reset would flash the veil on fast WS reconnects."
  - "Harness inert shim defaults isMessagesLoaded: true. The harness case never reads the field (peer effect gates on source.kind === 'relay'), but true is the semantically correct 'no relay-veil signal to worry about' default."
metrics:
  duration_minutes: 8
  completed: 2026-09-10
---

# Phase 97 Plan 02: Loading-veil signal Summary

**One-liner:** Ships F-1 by wiring the relay-case loading veil to dismiss on the first `history_batch` frame — extends the adapter contract with `isMessagesLoaded?: boolean`, flips it in the relay adapter's history_batch branch, and adds a peer veil-arm effect in PrettyView that mirrors the harness path's 400ms delay-arm.

## What Was Built

Two tasks, two commits, both TDD (write failing test → verify RED → implement → verify GREEN).

### Task 1 — Adapter contract extension + relay adapter flip (commit `45542bc1`)

- `chat-surface-source.ts`: `ChatSurfaceAdapterState` gains an optional `isMessagesLoaded?: boolean` field with a JSDoc that explains why it's distinct from `isReady` (session vs history_batch) and why the frame arrival is the signal (not `events.length > 0`).
- `use-harness-adapter.ts`: `INERT_STATE` defaults `isMessagesLoaded: true`. Never read in the harness case (peer effect in PrettyView gates on `source.kind === "relay"`) — defensive default.
- `use-relay-adapter.ts`:
  - New `const [isMessagesLoaded, setIsMessagesLoaded] = useState<boolean>(false);` at L228, **above** the `if (source === null) return IDLE_STATE;` early-return at L663 (rules-of-hooks preserved per Phase 93 Landmine 5).
  - Flip site: inside `case "history_batch":`, after `setIsReady(true);`, unconditional on `parsed.events.length` (empty rooms dismiss too).
  - `IDLE_STATE` singleton defaults `isMessagesLoaded: false` — matches "not yet loaded" for the null-source case.
  - `memoizedActiveState` useMemo carries `isMessagesLoaded` in **both** the returned object AND the deps array (Phase 93 Landmine 4).
- **No reset site added.** Confirmed via `grep -n 'setIsReady' use-relay-adapter.ts` — the file has ONE `setIsReady(false)` — actually zero: `setIsReady` appears at declaration L207 and two `setIsReady(true)` flips at L436 and L445. No reset ever runs. Mirrored exactly — no `setIsMessagesLoaded(false)` reset added. This preserves the intended semantics: state persists across reconnect-ladder retryKey re-runs, and the veil dismisses again on the fresh WS's next history_batch. Adding a defensive reset would flash the veil on fast reconnects.
- 6 new tests in `use-relay-adapter.test.ts` (Tests 18-23): initial state, empty-room dismiss, populated-room dismiss, session-alone does NOT flip, memoization stability, harness inert shim default. RED confirmed (6/24 failing on `undefined === false`), GREEN after wire-up (24/24 passing).

### Task 2 — PrettyView peer veil-arm effect for relay case (commit `015f0bf3`)

Two changes in `PrettyView.tsx`:

- **Change 1** — existing harness veil-arm effect (previously `useEffect(() => { if (renderedState !== "resolving") ... }, [renderedState]);` at L2002-2013) is now guarded with `if (source.kind !== "harness") return;` at line **L2011**. NULL change for existing harness mounts (source.kind === "harness" in every harness call site), NO-OP for relay mounts.
- **Change 2** — new peer effect at lines **L2028-L2043**. Guard: `if (source.kind !== "relay") return;` at L2032. Dismiss branch: `if (chatSurfaceAdapter.isMessagesLoaded === true) { setShowResolvingSpinner(false); return; }`. Arm branch: 400ms `setTimeout(() => setShowResolvingSpinner(true), 400)` with matching cleanup — same flash-suppression treatment as harness path. Deps: `[source.kind, chatSurfaceAdapter.isMessagesLoaded]`.

Both effects write to the same `showResolvingSpinner` state. The veil mount gate at L3782 (`{showResolvingSpinner && <PrettyViewLoadingOverlay />}`) is unchanged and case-agnostic.

5 new tests in `PrettyView.relay-veil.test.tsx`:
- Test 1: relay + isMessagesLoaded=false + 400ms elapse → overlay present.
- Test 2: relay + isMessagesLoaded=true → overlay dismissed (this was the RED case — the shipped bug this plan fixes).
- Test 3: relay + <400ms → overlay suppressed (flash-suppression).
- Test 4: harness + renderedState="resolving" + 400ms → overlay present (D-01 regression floor).
- Test 5: harness case ignores isMessagesLoaded=false on the inert shim (relay peer effect stays gated).

RED first (1/5 — Test 2 exposed the shipped bug). GREEN after (5/5).

## Confirmation: Empty Rooms Dismiss the Veil (Test Evidence)

`use-relay-adapter.test.ts` Test 19:

```typescript
it("Test 19 (Phase 97 Finding 1 — empty-room dismiss): history_batch with events:[] flips isMessagesLoaded to true", () => {
  const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
  expect(result.current.isMessagesLoaded).toBe(false);
  act(() => {
    instances[0].simulateOpen();
    instances[0].simulateFrame({
      type: "history_batch",
      events: [],
      hasMore: false,
    });
  });
  expect(result.current.isMessagesLoaded).toBe(true);
});
```

**Test passes** — a `history_batch` frame with `events: []` fires the flip. Combined with the peer effect's `if (chatSurfaceAdapter.isMessagesLoaded === true) { setShowResolvingSpinner(false); return; }` branch, an empty room's veil dismisses on frame arrival regardless of message count. This addresses Phase 97 D-03's landmine directly: "Do NOT gate on `chatSurfaceAdapter.messages.length > 0` — an empty room's veil would stay up."

## Line Numbers of the Two Peer Effects in PrettyView.tsx

- **Harness veil-arm effect (existing, now case-guarded):** L2002-L2023. Guard added at **L2011** (`if (source.kind !== "harness") return;`).
- **Relay veil-arm effect (new peer):** L2025-L2043. Guard at **L2032** (`if (source.kind !== "relay") return;`). Dismiss branch at L2033. Arm branch at L2036-L2038. Deps at L2043.

Both effects live consecutively; the harness effect precedes the relay effect. The veil mount JSX (`{showResolvingSpinner && <PrettyViewLoadingOverlay />}`) at L3800 is unchanged (was L3782 pre-change; shifted by +18 due to inserted comment + peer effect).

## Reset-on-Reopen Discipline: Mirrored Exactly

- **Question from plan:** "trace the existing reset site for `setIsReady(false)`. Wherever that reset lives ... add an adjacent `setIsMessagesLoaded(false)`. If NO existing reset for isReady is found, do NOT add a defensive reset."
- **Result of trace:** `grep -n 'setIsReady' src/ui/features/pretty-view/sources/use-relay-adapter.ts` returns three lines (L207 declaration, L436 flip on `session`, L445 flip on `history_batch`). **No `setIsReady(false)` call exists** — the state persists across reconnect-ladder re-runs via retryKey.
- **Mirror applied:** No `setIsMessagesLoaded(false)` reset added. State persists across `retryKey`-triggered re-runs; the veil dismisses again on the fresh WS's next `history_batch` frame. This preserves the "no flash on fast reconnect" invariant (matches the 400ms delay-arm's purpose).

## Deviations from Plan

None. Plan executed exactly as written — all Task 1 and Task 2 grep gates + acceptance criteria satisfied. TDD ordering discipline followed (RED verified before GREEN for both tasks). No auth gates. No architectural surprises.

**One environmental note (not a plan deviation):** `npx vitest run --related <files>` (referenced in the plan's `<verify><automated>` blocks) is not supported by this project's vitest v4.1.8 — the flag was removed. Substituted with direct path targeting (`npx vitest run <path-to-test.ts>`) which is the equivalent scoped mechanism for this vitest version. All acceptance criteria that depended on `--related` were verified via direct path runs.

## Verification Results

- Task 1 grep gates: **all pass** (interface field / harness inert / relay useState / useMemo deps + object / IDLE_STATE / no session-branch flip / useState line 228 < early-return line 663).
- Task 2 grep gates: **all pass** (harness guard present / relay guard present / isMessagesLoaded === true dismiss / two 400ms occurrences / test file created / veil mount JSX unchanged single occurrence).
- Scoped Vitest runs:
  - `use-relay-adapter.test.ts`: 24/24 passed (18 pre-existing + 6 new).
  - `PrettyView.relay-veil.test.tsx`: 5/5 passed (all new).
  - Regression floor `PrettyView.relay-source.test.tsx + PrettyView.test.tsx`: 46 passed, 1 skipped, 1 todo (unchanged from pre-plan).
- `npx tsc --noEmit`: **clean** (zero errors project-wide).

## Threat Flags

None. The plan's threat register (T-97-02-01, T-97-02-02, T-97-02-SC) is mitigated as designed:
- **T-97-02-01** (veil stuck if history_batch never arrives): the existing `ChatSurfaceErrorState` overlay handles the WS error path — on `chatSurfaceAdapter.error !== null` the error scrim renders above the message list; the veil and error scrims coexist as overlays per Phase 93 Landmine 7.
- **T-97-02-02** (harness case tampering): new peer effect gates on `source.kind === "relay"`; harness effect gates on `source.kind === "harness"`. Verified via 46-test regression floor (harness case snapshots + relay-source integration tests all pass unchanged).
- **T-97-02-SC** (package installs): no new packages. Zero surface.

No new trust boundaries introduced. `isMessagesLoaded` is client-side derived state; the flip observes an existing WS frame (already zod-parsed by Phase 93's `RelayRoomServerEvent` schema) — no new parsing.

## Self-Check: PASSED

- `src/ui/features/pretty-view/sources/chat-surface-source.ts` — modified (`isMessagesLoaded?: boolean` present).
- `src/ui/features/pretty-view/sources/use-harness-adapter.ts` — modified (`isMessagesLoaded: true` in INERT_STATE).
- `src/ui/features/pretty-view/sources/use-relay-adapter.ts` — modified (useState, flip, memo deps, IDLE_STATE).
- `src/ui/features/pretty-view/sources/use-relay-adapter.test.ts` — modified (6 new tests).
- `src/ui/features/pretty-view/PrettyView.tsx` — modified (harness case-guard + new peer effect).
- `src/ui/features/pretty-view/PrettyView.relay-veil.test.tsx` — created (5 tests).
- Commit `45542bc1` — present in `git log --oneline` (Task 1).
- Commit `015f0bf3` — present in `git log --oneline` (Task 2).
