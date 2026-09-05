# Task — Optimistic session-recycling overlay with 10-min upper bound

Front-run the backend `recycling` axis with a client-side hint gated on reset-dispatch success, with a 10-min self-clear upper bound. Reintroduces the documented client-hint-with-backend-override fallback that Phase 30 (`src/ui/features/pretty-view/PrettyView.tsx:738-767`) explicitly named for exactly this UAT case.

## Domain background — do NOT skip

Repo: `~/skynet-tanya` on branch `feat/tab-title-from-tmux`. Skynet is a Vite/React frontend + Express backend serving a browser-based SSH/RDP + Claude Code manager.

The session-recycling overlay `<SessionHoldingOverlay />` mounts at `src/ui/features/pretty-view/PrettyView.tsx:3069`, currently gated ONLY on `isRecycling` from the fleet-status wire frame (per-pane, via `useSessionIsRecycling(sessionWorkingKey)` at `PrettyView.tsx:1294`).

The wire `recycling` axis is stamped by source B's SSH poll orchestrator (`src/backend/fleet-status/ssh-poll-orchestrator.ts:1081`) which OR-composes three axes:

1. `layer1RecyclingCached` (JSONL tail scan for `/id reset` user turn), OR
2. `.recycle-requested` sentinel present, OR
3. `.recycled-at` sentinel present.

The tail scan catches the JSONL append BEFORE the agent processes it — so the true latency is source-B poll cadence + SSH exec round-trip (~few seconds worst case), not the multi-second agent-processing gap. But even the few-seconds gap is visible to the user.

The user reports the overlay currently only shows AFTER the wire flips, leaving a visible gap between reset-button press and overlay appearance. She wants the overlay optimistic on dispatch success with a 10-min upper bound self-clear if the backend authoritative signal never arrives.

`onResetClicked` in `PrettyView.tsx:768` is currently a **no-op** (Phase 30 stripped patch #381's client-hint anti-pattern). The comment block at `PrettyView.tsx:738-767` explicitly names the correct fallback: "a one-line optimistic hint that the NEXT pane_state frame from the backend overrides unconditionally." This IS that UAT surfacing; we are implementing that fallback shape now, extended with the 10-min upper bound.

## Change 1 — `src/ui/features/pretty-view/ComposeBox.tsx`

Move the `onResetClicked?.()` call currently at line 1771 (inside `fireResetSyncFx`) into `dispatchResetPayload(body)` (currently at ~line 1808), inside the `if (dispatched)` branch — fire it right after `funnel.send(...)` returns true, before `setText("")`.

**Reason**: on a disconnected socket `funnel.send` returns false and we do NOT want to falsely mount the overlay for 10 min.

All other behavior in `fireResetSyncFx` (drain-sweep animation, pulse, arm cancel) stays where it is — those are always-fire visual affordances tied to click. Only the `onResetClicked?.()` line moves.

Update the comment block above `fireResetSyncFx` (lines 1761-1770) to reflect the new invariant: `onResetClicked` fires on dispatch success (not click); visual drain-sweep still fires unconditionally on click.

## Change 2 — `src/ui/features/pretty-view/PrettyView.tsx`

Replace the no-op `onResetClicked` (line 768) and its comment block (lines 738-767) with a real body:

```tsx
const [optimisticRecycling, setOptimisticRecycling] = useState(false);
const optimisticRecyclingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const onResetClicked = useCallback(() => {
  if (optimisticRecyclingTimerRef.current !== null) {
    clearTimeout(optimisticRecyclingTimerRef.current);
  }
  setOptimisticRecycling(true);
  optimisticRecyclingTimerRef.current = setTimeout(() => {
    optimisticRecyclingTimerRef.current = null;
    setOptimisticRecycling(false);
  }, 10 * 60 * 1000);
}, []);

// Cleanup timeout on unmount.
useEffect(() => {
  return () => {
    if (optimisticRecyclingTimerRef.current !== null) {
      clearTimeout(optimisticRecyclingTimerRef.current);
      optimisticRecyclingTimerRef.current = null;
    }
  };
}, []);

// When backend authoritative recycling flips true, clear optimistic slot early —
// the backend has taken over and the overlay stays mounted via `isRecycling`.
useEffect(() => {
  if (isRecycling && optimisticRecyclingTimerRef.current !== null) {
    clearTimeout(optimisticRecyclingTimerRef.current);
    optimisticRecyclingTimerRef.current = null;
    setOptimisticRecycling(false);
  }
}, [isRecycling]);
```

Placement: the `useState` slot and the `useRef` should live near the other pane-scoped state slots around lines 715-736. The `useCallback` replaces the no-op at line 768. The two `useEffect`s can live near the other pane-scoped effects (e.g. adjacent to `useCallback` above, or wherever is natural — the planner/executor should choose per existing patterns in the file).

Compute `const effectiveRecycling = isRecycling || optimisticRecycling;` once. Place it right after the existing `const isRecycling = useSessionIsRecycling(sessionWorkingKey);` at line 1294.

Then update three consumer sites in the same file to use `effectiveRecycling` instead of `isRecycling`:

- Line 3069: `{isRecycling && <SessionHoldingOverlay />}` → `{effectiveRecycling && <SessionHoldingOverlay />}`
- Line 3455: `isHolding={isRecycling}` → `isHolding={effectiveRecycling}`
- Line 3460: `recycleActive={isRecycling}` → `recycleActive={effectiveRecycling}`

**Why both `isHolding` and `recycleActive` need `effectiveRecycling`**: per the comment at `PrettyView.tsx:3037-3049`, these props gate ComposeBox controls (send, reset cell, paperclip, ThumbsUp, Lightbulb, Queue, Mic). If we mount the overlay optimistically, we MUST also disable those controls optimistically, otherwise the user could hammer reset again mid-recycle.

Update the comment block that used to explain "no-op placeholder for the ComposeBox prop contract" to explain: optimistic client-hint reintroduced with 10-min upper bound and backend-override, resolving the UAT gap named at the old comment.

## Change 3 — Tests

Extend existing tests. Do NOT create new files if the case fits in an existing describe block.

**`src/ui/features/pretty-view/PrettyView.session-rotation.test.tsx`** — add three cases:

1. Reset click fires `onResetClicked` → `<SessionHoldingOverlay />` mounts immediately without any wire frame having landed.
2. After optimistic mount, publishing a wire frame with `recycling: true` for the pane's session key → overlay stays mounted; internal state should have the optimistic slot cleared. Verify by then publishing a subsequent wire frame with `recycling: false` — overlay must unmount. (If optimistic were still set, overlay would stay mounted, and this assertion fails.)
3. Optimistic mount without any backend signal → after advancing fake timers by 10 minutes + 1 tick, overlay unmounts.

**`src/ui/features/pretty-view/ComposeBox.tsx` behavior change**: check `ComposeBox.send-funnel.test.tsx` (and adjacent `ComposeBox.*.test.tsx` files if not there) for existing coverage of the funnel-success/fail dispatch paths from reset. If a test already asserts `onResetClicked` fires on click, adjust it to assert it fires on dispatch success only (and add a companion assertion that a failed dispatch does NOT fire it). If no such test exists, add one to the most-appropriate existing ComposeBox test file (send-funnel is the natural home).

## Constraints — READ BEFORE EXECUTING

- **NEVER use worktrees** — fleet rule. Work in the main tree. (GSD `workflow.use_worktrees=false` is already set, but this rule stands regardless.)
- **Do NOT push to origin. Do NOT deploy. Stop at "code done, tests green."** The push-gate is orchestrator-only; do NOT `git push`, do NOT `docker build`, do NOT `docker compose up`. The orchestrator (the box-maintainer identity that spawned this quick task) picks it up from "code committed + tests green" onward.
- **Skip `docker build` and `docker compose` steps** entirely — this is code + tests only.
- **Scoped tests only for the executor's green-gate**: `npx vitest run` on the three touched test files (`PrettyView.session-rotation.test.tsx`, `SessionHoldingOverlay.test.tsx`, `ComposeBox.send-funnel.test.tsx` or wherever the new/moved ComposeBox test lands). Do NOT run the full vitest suite — that's the orchestrator's ship-gate, not the executor's green-gate. If any of the three files fail (existing or new tests), fix inline before considering the change green.
- **Backend typecheck NOT needed** — this change only touches frontend files (`src/ui/**`), no backend files. `npx tsc --noEmit` for the frontend if any type surface changes.
- **Rebase before committing**: `git pull --rebase origin feat/tab-title-from-tmux` before commit if committing on a stale base. The branch just had `9c6beeab`, `e354ecaa`, `49c0680d` land during this session.
- **The `optimisticRecycling` slot is per-pane React state**. Per Ashley's explicit decision this session, we are NOT promoting to `session-working-store` — the transcript-detection path in source B catches the JSONL append within a few seconds, so the "user switches tabs mid-recycle" scenario is small enough to accept losing overlay-across-mount.
- **Commit atomically per GSD conventions**. Suggested single commit message: `feat(pretty-view): optimistic session-recycling overlay with 10-min upper bound`.

## Files (paths, canonical)

- `src/ui/features/pretty-view/ComposeBox.tsx` — modify (Change 1)
- `src/ui/features/pretty-view/PrettyView.tsx` — modify (Change 2)
- `src/ui/features/pretty-view/PrettyView.session-rotation.test.tsx` — extend (Change 3, three new cases)
- `src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx` OR nearest ComposeBox test file — extend (Change 3, one dispatch-success-vs-fail case)

## Reference (do NOT modify, but read for context)

- `src/backend/fleet-status/ssh-poll-orchestrator.ts:1081` — where `isRecycling` on the wire is composed. Confirms the transcript-detection path (`layer1RecyclingCached`) exists and catches JSONL append.
- `src/backend/fleet-status/wire-protocol.ts:184-198` — scope-lock comment on what `recycling` means.
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` — the overlay component being mounted. No changes needed.
- `src/ui/state/session-working-store.ts:1014` — `useSessionIsRecycling` hook. No changes needed.
