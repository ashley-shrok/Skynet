---
phase: quick-260829-nt9
plan: 01
subsystem: compose-upload
tags: [attachment, queued-slot, tdd, data-loss-fix]
dependency_graph:
  requires: [quick-260823-8ji, quick-260803-05i]
  provides: [queued-slot-attachment-send]
  affects: [ComposeBox, PrettyView, use-pretty-view-uploads]
tech_stack:
  added: []
  patterns: [target-aware-staging, async-closure-outcome-await, failure-preservation]
key_files:
  created:
    - src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx
  modified:
    - src/ui/features/pretty-view/use-pretty-view-uploads.ts
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "Widened onSendWithAttachments prop to (caption, target?) rather than adding a new onSendQueuedSlotWithAttachments — single prop, backward-compatible default"
  - "Slot IDs are auto-generated UUIDs; test captures data-slot-id from DOM after render rather than hardcoding"
  - "fireNextQueued attachment branch uses async IIFE inside useCallback returning void — outer signature unchanged"
metrics:
  duration: ~18 minutes
  completed: 2026-08-29
---

# Quick 260829-nt9: Fix Queued-Slot Send Silently Drops Attachments — Summary

One-liner: Target-aware startBatch + 3 attachment branches in ComposeBox closes 100%-reproducible data-loss bug where attachments staged into queued slots were silently discarded on every send path.

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| `a8fe913a` | `test(quick-260829-nt9): add queued-slot attachment send regression suite (RED)` | ComposeBox.queued-attachment.test.tsx (new, 6 tests) |
| `dbbc7438` | `fix(quick-260829-nt9): route queued-slot sends through onSendWithAttachments with target-aware startBatch (GREEN)` | use-pretty-view-uploads.ts, ComposeBox.tsx, PrettyView.tsx |

## Scoped Test Outcome

```
npx vitest run src/ui/features/pretty-view/ComposeBox src/ui/features/pretty-view/use-pretty-view-uploads
Test Files  11 passed (11)
Tests       174 passed (174)
Exit code   0
```

All 6 new regression tests pass. All 168 pre-existing tests continue to pass.

## TypeScript Check

```
npx tsc --noEmit
Exit code: 0
(no output — zero errors)
```

## What Was Fixed

Three send entry points in `ComposeBox.tsx` previously routed through the text-only `onSend(payload)` path and silently discarded staged attachments living under target `queued:${slotId}`:

1. **`handleQueueSlotSend` at :1312** — manual slot Send button click
2. **`fireNextQueued` at :1113** — cadence auto-send (idle watchdog fires)
3. **`handleVoiceSend` slot branch at :1601** — voice-driven slot send

Each site now has an attachment branch inserted before the existing text-only path, mirroring the byte-identical pattern already shipped in primary `handleSend` at :1384-1415 (quick-260823-8ji). The primary `handleSend` block was NOT touched.

## Production Changes

### `use-pretty-view-uploads.ts`
- `startBatch(caption, target?: string)` — `target` param added, defaults to `"primary"`. `activeTarget = target ?? "primary"` replaces hardcoded `"primary"` at the attachment read site.
- Same widening on `retryBatch(target?: string)` and `resetBatch(target?: string)`.
- Interface `UsePrettyViewUploadsReturn` updated to reflect widened signatures.
- Comment at `upload_progress` handler updated to note known limitation (see below).

### `PrettyView.tsx`
- `onSendWithAttachments` inline arrow widened from `async (caption)` to `async (caption, target)`.
- `uploads.startBatch(caption, target)` — target forwarded.

### `ComposeBox.tsx`
- `onSendWithAttachments?: (caption: string, target?: string) => Promise<BatchOutcome>` — prop type widened.
- `handleQueueSlotSend`: attachment branch checks `getStagedAttachmentsForTarget?.("queued:" + slotId)?.length > 0`, runs async closure, awaits `onSendWithAttachments!(captionPayload, slotTarget)`.
- `fireNextQueued`: attachment branch for non-primary head slots with staged attachments; `useCallback` deps array extended with the new closure captures.
- `handleVoiceSend` slot branch: attachment check + async closure before existing `onSend(payload)` text-only path.

## Failure Preservation Posture

All three new branches mirror quick-260823-8ji's `outcome.ok=false` behavior:
- `outcome.reason === "superseded"` → silent return (no UI state stomp)
- Any other failure → `setErrorMessage(getBatchFailureUserMessage(reason))` + slot + chips PRESERVED (no filter, no `clearStagedForTarget`)

## Deviations from Plan

None significant. One minor adaptation:

**[Rule 2 - Defensive] Dynamic slot ID capture in tests:** The plan described tests with `target="queued:slot-a"` but ComposeBox generates UUID slot IDs. Tests capture the auto-generated ID via `document.querySelector("[data-slot-id]").getAttribute("data-slot-id")` after rendering and use it for mock configuration. This is the correct approach — hardcoding IDs would require patching ComposeBox's ID generator.

## Known Limitation (Carried Forward)

`handleServerEvent`'s chip-mutation branches (`upload_progress`, `upload_complete`, `upload_failed` at L387/L401/L427) still hardcode `setAttachments("primary", ...)`. The batchId gate at L378 ensures cross-target isolation: each per-slot batch is managed by its own hook instance, so events for THAT batch arrive on THAT instance. The net cosmetic effect: queued-slot attachment chips won't animate a progress ring during upload — they go staged→gone at `outcome.ok` time via `clearStagedForTarget`.

**Follow-up bounty candidate:** `queued-slot-attachment-chips-lack-progress-ring`

## Ship Posture

HEAD LOCAL on `feat/tab-title-from-tmux`. NOT pushed, NOT deployed. Bundle at ship time with queued stack:
- fh3 (`aee16c8f`)
- ih3 (`5b3ff27a` / `f375fa2f`)
- mbp (`ee88877c`)
- n5z (`ba5c7944`)

on Ashley greenlight.

## Self-Check

- [x] `src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx` exists: FOUND
- [x] `src/ui/features/pretty-view/use-pretty-view-uploads.ts` has `target ?? "primary"` in startBatch/retryBatch/resetBatch: FOUND (3 occurrences)
- [x] `src/ui/features/pretty-view/PrettyView.tsx` has `uploads.startBatch(caption, target)`: FOUND
- [x] `src/ui/features/pretty-view/ComposeBox.tsx` has 3 `getStagedAttachmentsForTarget?.(slotTarget)` calls: FOUND (L1133, L1373, L1621)
- [x] Commit `a8fe913a` exists: FOUND (RED test commit)
- [x] Commit `dbbc7438` exists: FOUND (GREEN production commit)
- [x] Scoped vitest: 174 tests, 11 files, exit 0
- [x] `npx tsc --noEmit`: exit 0

## Self-Check: PASSED
