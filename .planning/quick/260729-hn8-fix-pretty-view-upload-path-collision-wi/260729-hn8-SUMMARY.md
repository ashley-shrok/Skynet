---
phase: 260729-hn8
plan: "01"
subsystem: backend/ssh
tags: [bug-fix, upload, sftp, collision, patch-186]
dependency_graph:
  requires: []
  provides: [batch-local-path-deduplication]
  affects: [src/backend/ssh/pretty-view-upload.ts]
tech_stack:
  added: []
  patterns: [Set-based reservation, batch-local state, sftp collision avoidance]
key_files:
  modified:
    - src/backend/ssh/pretty-view-upload.ts
    - src/backend/ssh/pretty-view-upload.test.ts
decisions:
  - "Thread reservedFinalPaths Set through resolveNonCollidingFinal rather than tracking claimed paths at batch level only — keeps the resolution logic self-contained"
  - "Check reserved.has() alongside sftpStat so disk-side and batch-local collision avoidance compose additively (Test 8 still proves disk path)"
metrics:
  duration: 147s
  completed: "2026-07-29"
---

# Quick Task 260729-hn8: Fix Pretty-View Batch-Local Upload Path Collision Summary

## One-liner

Threaded a batch-local `reservedFinalPaths: Set<string>` through `resolveNonCollidingFinal` to prevent two identically-named clipboard images pasted in the same batch from resolving to the same `finalPath` and silently overwriting each other at `sftpRename`.

## What Was Built

**Root cause:** `resolveNonCollidingFinal` only probed the disk via `sftpStat`. When two `image.png` files are uploaded in the same batch, both stat calls return "not exists" for the same candidate before either `sftpRename` fires — so both get assigned the identical `finalPath` and the second rename silently overwrites the first.

**Fix in `pretty-view-upload.ts`:**
- `resolveNonCollidingFinal` gained a third parameter `reserved: Set<string>`. The body now checks `!reserved.has(c)` alongside `!s.exists` for every candidate (base and all `-N` suffixes).
- `handleUploadStart` declares `const reservedFinalPaths = new Set<string>()` once per batch (before the per-file loop).
- After each successful `resolveNonCollidingFinal` call, `reservedFinalPaths.add(finalPath)` claims the path so the next file in the loop sees it as unavailable.

**New tests in `pretty-view-upload.test.ts`:**
- `Test 8b`: two files named `image.png` in one batch → `sftp.rename` called twice with distinct `to` args (`143211-image.png` and `143211-image-2.png`); `ready_to_inject` lists both with distinct `landingPath` values.
- `Test 8c`: three files named `image.png` → `to` args are the set `{143211-image.png, 143211-image-2.png, 143211-image-3.png}` (order-independent).
- `Test 8` (disk-collision, pre-existing file on box) still passes unchanged — fix is additive.

## Verification Results

- `npm run build:backend` — EXIT 0
- `npm run build` — EXIT 0
- `npx vitest run src/backend/ssh/pretty-view-upload.test.ts` — EXIT 0, 15/15 passed (12 existing + 2 new describe blocks with 1 test each + Test 8c has 1 test = 3 new, total 15)

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Thread reservedFinalPaths + add Tests 8b/8c | 2af0d63 | src/backend/ssh/pretty-view-upload.ts, src/backend/ssh/pretty-view-upload.test.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. The fix adds no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- `src/backend/ssh/pretty-view-upload.ts` exists and contains 3 `reservedFinalPaths` hits
- `src/backend/ssh/pretty-view-upload.test.ts` exists and contains 2 `Test 8[bc]` hits
- Commit `2af0d63` exists on `feat/tab-title-from-tmux`
- Both builds green, 15/15 vitest tests pass
