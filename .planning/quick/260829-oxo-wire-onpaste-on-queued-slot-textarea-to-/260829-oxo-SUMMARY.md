---
phase: quick-260829-oxo
plan: "01"
subsystem: pretty-view/ComposeBox
tags: [paste, queued-slot, attachment, compose-paste]
dependency_graph:
  requires: [quick-260829-nt9]
  provides: [queued-slot-paste-routing]
  affects: [ComposeBox.tsx, ComposeBox.queued-slot-paste.test.tsx]
tech_stack:
  added: []
  patterns: [slot-scoped-useCallback, onPaste-wire, structured-log]
key_files:
  created:
    - src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Used shape (b): slot-scoped handlePasteForSlot inside QueuedRow — leaves primary handlePaste at :497-506 byte-identical"
  - "Threaded onAttachFilesForTarget through QueuedRowProps (option i) — mirrors getStagedAttachmentsForTarget/clearStagedForTarget pattern"
  - "Text-paste fallthrough preserved via files.length > 0 gate — matches primary handlePaste gate exactly"
metrics:
  duration: "~12 minutes"
  completed: "2026-08-29"
  tasks_completed: 2
  files_changed: 2
---

# Phase quick-260829-oxo Plan 01: Wire onPaste on Queued-Slot Textarea Summary

**One-liner:** Slot-scoped `handlePasteForSlot` useCallback in `QueuedRow` routes file pastes to `onAttachFilesForTarget(target, files)` via a new `onPaste` wire on the queued-slot Textarea, closing the silent file-drop gap.

## What Was Built

Closed the queued-slot paste gap where pasting a screenshot (or any file-shaped clipboard payload) into a queued-slot Textarea was silently dropped because the Textarea had no `onPaste` prop.

Three focused changes inside `QueuedRow`, zero touches to the primary path:

1. **`onAttachFilesForTarget` threaded into `QueuedRowProps`** — added to the interface at line 2989, destructured inside `QueuedRow`, and passed at the `<QueuedRow>` call site in the parent (mirrors how `getStagedAttachmentsForTarget` and `clearStagedForTarget` are threaded).

2. **New `handlePasteForSlot` useCallback** — added immediately after `const target = \`queued:${slot.id}\`` in `QueuedRow`. Byte-parallel shape to primary `handlePaste` at :497-506: reads `e.clipboardData?.files`, gates on `files.length > 0`, calls `e.preventDefault()` before `onAttachFilesForTarget?.(target, files)`. Text-only pastes fall through to the browser default (COMPOSE-05 D-58/D-60 rule preserved). Emits `[compose-paste]` structured log on the file-paste branch.

3. **`onPaste={handlePasteForSlot}` wired** on the queued-slot Textarea at ~:3240, placed after `onBlur`.

## Tests

New file: `src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx` (4 tests):
- Test 1: file paste → `onAttachFilesForTarget(slotTarget, [file])`, `onAttachFiles` not called
- Test 2: text-only paste → no attach call, `preventDefault` not called (browser default allowed)
- Test 3: primary paste path unchanged → `onAttachFiles` called, `onAttachFilesForTarget` not called
- Test 4: file paste emits `[compose-paste] target=queued:… files=1` log line

All 72 tests across the 3 scoped files pass. `npx tsc --noEmit` exit 0.

## Commits

| SHA | Type | Description |
|-----|------|-------------|
| c719ffda | RED | test(quick-260829-oxo): add queued-slot paste regression suite (RED) |
| 72420dbb | GREEN | fix(quick-260829-oxo): wire onPaste on queued-slot Textarea to onAttachFilesForTarget (GREEN) |

## Deviations from Plan

None — plan executed exactly as written. The `scheduleAutosave` prop was already in `QueuedRowProps` (listed at :2974 in the interface); only `onAttachFilesForTarget` needed to be added.

**Test 2 status note:** The plan noted Test 2 might fail in RED ("there's currently nothing to fall-through from"). In practice, Test 2 passed in RED — `fireEvent.paste` returning `true` (no `preventDefault` invoked) was the correct pre-fix behavior when no handler was installed. The plan also acknowledged this as a possible outcome ("Test 3 passes from the start"). This is not a deviation; it confirms the fallthrough guarantee already held at RED.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.
