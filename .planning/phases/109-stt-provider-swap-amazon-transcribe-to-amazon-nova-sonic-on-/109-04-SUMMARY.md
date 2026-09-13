---
phase: 109-stt-provider-swap-amazon-transcribe-to-amazon-nova-sonic-on
plan: "04"
subsystem: voice/stt
tags:
  - deletion
  - cleanup
  - phase-100-retirement
  - transcribe-adapter
dependency_graph:
  requires:
    - 109-03
  provides:
    - D-DELETE
    - D-REWIRE (completion)
  affects: []
tech_stack:
  added: []
  patterns:
    - mechanical-file-deletion
key_files:
  created: []
  modified: []
  deleted:
    - src/backend/voice/transcribe-adapter.ts
    - src/backend/voice/transcribe-adapter.test.ts
    - src/backend/voice/transcribe-adapter.integration.test.ts
    - src/backend/voice/transcribe-orchestrator.ts
    - src/backend/voice/transcribe-orchestrator.test.ts
    - src/backend/voice/audio-chunker.ts
    - src/backend/voice/audio-chunker.test.ts
    - src/backend/voice/word-stitcher.ts
    - src/backend/voice/word-stitcher.test.ts
    - src/backend/voice/semaphore.ts
    - src/backend/voice/semaphore.test.ts
decisions:
  - "Used `git rm` (not plain `rm`) since the working tree is a git repo — all deletions landed in one clean staged set before commit."
  - "All references in surviving files (audio-transcode.ts, nova-sonic-adapter.ts, aws-errors.ts) to deleted symbols were in JSDoc comments only — no live import statements, no fixup needed."
metrics:
  duration: "~6 minutes"
  completed: "2026-09-13"
  tasks_completed: 1
  tasks_total: 1
  files_deleted: 11
  lines_deleted: 2835
---

# Phase 109 Plan 04: Delete Phase 100 Subsystem + Transcribe Adapter Summary

Delete 11 dead files (Phase 100 chunked-parallel orchestrator + Amazon Transcribe streaming adapter + all their test siblings) after Plan 03 severed the last live import in voice.ts.

## What Was Done

Deleted the entire Phase 100 STT subsystem and the Amazon Transcribe streaming adapter in a single atomic commit (`bf308556`):

- **transcribe-adapter.ts + .test.ts + .integration.test.ts** — Amazon Transcribe streaming adapter (3 files, ~600 lines)
- **transcribe-orchestrator.ts + .test.ts** — Phase 100 chunked-parallel orchestrator
- **audio-chunker.ts + .test.ts** — silence-boundary FLAC slicer
- **word-stitcher.ts + .test.ts** — word-level result stitcher
- **semaphore.ts + .test.ts** — voice-scoped concurrency cap for the Phase 100 orchestrator

Net: 11 files, 2835 lines deleted.

## Pre-deletion Verification

Ran `grep -rn "transcribe-adapter|transcribe-orchestrator|audio-chunker|word-stitcher|voice/semaphore|transcribeBuffer|..."` across `src/` before deleting. Every match was either:

- Self-reference inside a file being deleted (expected), OR
- A JSDoc comment in a surviving file (`audio-transcode.ts` lines 16/66/85/137/169, `nova-sonic-adapter.ts` line 27, `aws-errors.ts` line 13)

Zero live import statements remained in non-deleted files. Safe to delete.

## Post-deletion Gates — All GREEN

| Gate | Result |
|------|--------|
| Stale-import grep (post-delete) | 0 matches |
| `npx tsc --noEmit` | Exit 0 |
| `npm run build:backend` | Exit 0 |
| `npm run build` (frontend) | Exit 0, 2528 modules |
| `npx vitest run src/backend/voice/ src/backend/database/routes/voice.test.ts` | 174 passed, 1 skipped |

## Guardrail Files Confirmed Present

- `src/backend/voice/chunk-and-stitch.ts` — TTS text-packing for polly-adapter (stays)
- `src/backend/ssh/host-semaphore-registry.ts` — SSH concurrency semaphore (different, stays)
- `src/backend/voice/audio-transcode.ts` — webmToPcm16k + ffmpeg helpers (stays)
- `src/backend/voice/nova-sonic-adapter.ts` — new STT adapter (stays)
- `src/backend/voice/aws-errors.ts` — shared error handler (stays)
- `src/backend/voice/polly-adapter.ts` — TTS path (stays)

## Commits

| Hash | Message |
|------|---------|
| `bf308556` | `plan(109-04): delete Phase 100 subsystem + transcribe-adapter` |

## Deviations from Plan

None — plan executed exactly as written. All references in surviving files were comments only; no live import fixups were needed.

## Known Stubs

None.

## Threat Flags

None — this plan only deletes files, introduces no new surface.

## Self-Check: PASSED

- All 11 target files confirmed absent on disk.
- All 6 guardrail files confirmed present.
- Commit `bf308556` exists in `git log`.
- `tsc --noEmit`, `build:backend`, `build`, and scoped vitest all exited 0.
