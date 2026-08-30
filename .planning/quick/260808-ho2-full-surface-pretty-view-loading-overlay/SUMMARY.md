---
quick_id: 260808-ho2
slug: full-surface-pretty-view-loading-overlay
date: 2026-08-08
type: execute
bounty: pretty-view-conversation-pick-loading-feedback
status: complete

files_created:
  - src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx
  - src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.test.tsx

files_preserved_byte_untouched:
  - src/ui/features/pretty-view/SessionHoldingOverlay.tsx
  - src/ui/features/pretty-view/DormancyOverlay.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx

tests_added:
  unit: 5
  integration: 8
  total: 13

full_suite: green
typecheck: green

component_name: PrettyViewLoadingOverlay

design_decisions_locked:
  arm_site: fresh-pane paneKey-change reset block (reuses existing cold-vs-warm gate; no new sentinel ref)
  dismiss_trigger: first user-visible WS frame (message | image | relay_inbound | relay_outbound | context_pct | harness_tasks | session) — NOT on ws.onopen alone
  minimum_hold_time: none (arm instantly)
  timeout: 10000ms silent auto-dismiss (no error variant per Ashley's ask)
  mutex_order: "Dormancy > Holding > Loading (encoded as `isBooting && !dormant && !showOverlay` at the mount gate)"
  warm_refocus_arm: false (WS-pause reopen bumps retryKey without changing paneKey, so the reset block is skipped)
---

# quick 260808-ho2 — full-surface pretty-view loading overlay

## What was built

A new `PrettyViewLoadingOverlay` component and its wiring into `PrettyView.tsx` that covers the ~5s window between a fresh pane mount and the first user-visible WS frame arriving. Fixes Ashley's silent-window UX bug (row lights up but pretty-view sits blank for 5s → she re-taps → double-fires).

Component: full-surface scrim + centered glass card with `Loader2` spinner + "Loading…" copy. Mounted inside the chat-region wrapper as a sibling of SessionHoldingOverlay and DormancyOverlay — ComposeBox (peer sibling below the wrapper) stays typeable so Ashley can pre-draft during the boot window (patch #275 posture preserved).

## Wiring (all edits tagged `quick 260808-ho2` for grep-ability)

1. Import `PrettyViewLoadingOverlay`.
2. `isBooting` state + `isBootingRef` (mirrors dormantRef pattern for stale-closure protection inside WS onmessage).
3. `setIsBooting(true)` inside the fresh-pane paneKey-change reset block (sole ARM path).
4. Dismiss block inside `onmessage` — same user-visible frame-type set as the dormant dismiss (so any future addition to the set is a single grep).
5. `setIsBooting(false)` inside `case "dormant":` when `parsed.dormant === true` (belt-and-suspenders for the mount-gate exclusion).
6. `setIsBooting(false)` inside `case "session_holding":`.
7. `isBootingRef` mirror `useEffect` adjacent to the `dormantRef` mirror.
8. 10s timeout `useEffect` adjacent to the patch #122 5-min holding watchdog.
9. Mount JSX immediately after `{dormant && <DormancyOverlay .../>}`, gated `isBooting && !dormant && !showOverlay`.

## Motion-channel deviation

Sibling overlays use STATIC glyphs per patch #72 (WipBubble owns the motion channel for TASK work). This overlay deviates because LOADING is genuinely WORK-in-progress (surface booting) — a spinner is semantically correct here. WipBubble owns motion for TASK work; this overlay owns motion for SURFACE work; the two never co-render (loading overlay is only up before any bubbles render). The deviation is documented in the file header of `PrettyViewLoadingOverlay.tsx` and locked in place by Test 5 in `PrettyViewLoadingOverlay.test.tsx`.

## iOS Safari backdrop-filter hardening

Scrim carries `isolate [transform:translateZ(0)]` verbatim from SessionHoldingOverlay + DormancyOverlay (patch #333 lesson banked in the role file — non-negotiable for any new backdrop-filter surface in this fork). Test 4 in `PrettyViewLoadingOverlay.test.tsx` regression-guards this.

## Deviations from PLAN.md

Only one, technical / test-side: silenced `console.info` in the new test describe block's `beforeEach` via `vi.spyOn(console, 'info').mockImplementation(() => {})`. Test D deliberately triggers the 10s timeout, which fires the `console.info("[pv-loading-overlay] 10s timeout dismiss …")` log. Un-silenced, the RPC forwarding of that log to the vitest reporter (`onUserConsoleLog`) can race with unrelated worker-teardowns under full-suite pressure and surface as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, misleadingly attributed to whichever file the worker happened to be tearing down (observed once against `IdentityModal.test.tsx` in the initial full-suite run). Silencing the log at the test-only layer eliminates the RPC pressure without touching the production diagnostic. Full-suite re-run confirms 0 errors post-fix.

No source-code or design deviations. All six locked design decisions in PLAN.md § Objective are honored verbatim.

## Preservation invariants (verified via `git diff --stat`, all empty)

`SessionHoldingOverlay.tsx`, `DormancyOverlay.tsx`, `ComposeBox.tsx`, `pretty-conversations/*.tsx` — byte-untouched. WebSocket message types and backend — untouched.

## Verification results

- `npx vitest run src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx` — 5/5 pass.
- `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx -t "260808-ho2"` — 8/8 pass.
- `npx vitest run` (full suite) — 131 test files pass, **1610 tests pass**, 6 skipped, **0 errors**.
- `npx tsc --noEmit` — exit 0.
- `git diff --stat` on the four preservation targets — empty.

## Non-goals / deferred (explicit)

- No backend or WS type changes (pure frontend).
- No `ComposeBox.tsx` `*_active` prop for loading (window is short; existing ComposeBox pre-draft path handles it).
- No error variant of the loading overlay (per Ashley — 10s silent dismiss + underlying `status="inactive"`/`"error"` render branches).
- No panel-side change (ARM signal is the paneKey change downstream, not the row-tap upstream).

## Known stubs

None. No hardcoded empty values, placeholder copy, or unwired data flows. The overlay renders a real spinner + real copy; the state machine is fully wired to real WS frame types.
