---
phase: 100-stt-chunked-parallel-streaming
plan: "02"
subsystem: backend/voice
tags:
  - stt
  - stitching
  - pure-function
  - wave-1
dependency_graph:
  requires:
    - "@aws-sdk/client-transcribe-streaming (Item type — type-only import)"
  provides:
    - "stitchChunks(chunks, overlapSec): string — importable from ./word-stitcher.js"
    - "longestCommonRun(a, b): number — importable from ./word-stitcher.js"
    - "ChunkResult interface — importable from ./word-stitcher.js"
  affects:
    - "Plan 100-03+ (Wave 2 orchestrator imports stitchChunks + ChunkResult)"
tech_stack:
  added: []
  patterns:
    - "O(N×M) contiguous-run finder for bounded overlap windows"
    - "Chunk-relative to global timestamp adjustment (Pitfall 1 mitigation)"
    - "Empty-Items fallback via side-channel string accumulation (Pitfall 6)"
    - "Sorted merge by StartTime for global ordering preservation"
key_files:
  created:
    - src/backend/voice/word-stitcher.ts
    - src/backend/voice/word-stitcher.test.ts
  modified: []
decisions:
  - "Implemented stitchChunks step-by-step as described in RESEARCH.md § Section 6 with one deviation noted below"
  - "Chose side-channel stringFallbackParts[] over early-return to handle mixed chunks (some with items, some without)"
  - "lcRun > 0 branch keeps all bPronounceItems.slice(lcRun) plus bPunctuationAfterOverlap filtered by overlapEnd; zero-match branch keeps all bItems (hard cut)"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-10"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  tests_added: 20
---

# Phase 100 Plan 02: Word-Stitcher Pure-Function Module Summary

**One-liner:** Longest-common-word-run overlap dedup stitcher using AWS Transcribe Item timestamps, with empty-Items and gap-marker fallbacks.

## What Was Built

Created `src/backend/voice/word-stitcher.ts` — a zero-I/O, zero-logging, single-import pure-function module implementing:

- **`longestCommonRun(a, b)`**: O(N×M) nested scan finds the longest contiguous word run appearing anywhere in array `a` and array `b`. Safe for the bounded overlap window (2–3 s × ~5 words/s ≈ 15 words max per side).

- **`stitchChunks(chunks, overlapSec)`**: Walks adjacent ChunkResult pairs, adjusts chunk-relative Item timestamps to global audio coordinates (Pitfall 1), finds the longest common word run in the overlap window, drops that run from B's contribution, sorts merged items by global StartTime, and reconstructs a transcript string with punctuation-space cleanup.

- **`ChunkResult` interface**: Exported type consumed by the Wave 2 orchestrator. Carries `startOffsetSec`, `endOffsetSec`, `transcript`, and `items` (chunk-relative timestamps).

Created `src/backend/voice/word-stitcher.test.ts` — 20 tests covering all 10 plan behavior cases.

## Test Count

**20 tests added** across 9 `describe` blocks:

| Test | Scenario |
|------|----------|
| 1 | `longestCommonRun` finds run of 2: `["a","b","c","d"]` vs `["c","d","e","f"]` === 2 |
| 2 | `longestCommonRun` returns 0 when no common words |
| 3 | `longestCommonRun` returns 0 for empty arrays |
| 4 | `longestCommonRun` returns 0 when one side empty |
| 5 | `longestCommonRun` finds single-word common run |
| 6 | `longestCommonRun` finds mid-array run |
| 7 | `stitchChunks([])` returns `""` |
| 8 | Single chunk with items: returns transcript verbatim |
| 9 | Single chunk with empty items: returns transcript verbatim |
| 10 | Normal overlap: "the store" deduplicated at seam |
| 11 | Zero-match fallback: hard cut, A + B both present |
| 12 | Empty-Items fallback: string join, no crash |
| 13 | Both chunks empty items: no crash |
| 14 | Gap-marker passthrough: `[...]` appears verbatim in output |
| 15 | Gap-marker at start (chunkA with `[...]`, chunkB with items) |
| 16 | Punctuation filter: commas excluded from run matching; "world" deduplicated |
| 17 | Punctuation cleanup: `/\s+([.,!?;:])/g` removes space before comma in items output |
| 18 | Case-insensitive: "The" / "the" matched as identical |
| 19 | Timestamp ordering: global 5.0 precedes global 8.5 in reconstructed word order |
| 20 | Immutability: input ChunkResult.items are not mutated by offset adjustment |

## Deviation from RESEARCH.md Section 6 Pseudocode

**One deviation:** The RESEARCH pseudocode's hard-cut fallback includes `bItems.filter(it => ...) ≥ seamAt` to keep only items at or after the seam. The implementation instead keeps ALL of `bItems` in the zero-match path (including any bItems that might predate the seam). 

**Justification:** The zero-match fallback is a "best-effort concatenation" — per the plan spec: "a slight seam mismatch is acceptable (this test asserts the fallback fires, not perfect quality)." Keeping all of B preserves the most information. The subsequent `.sort()` by StartTime ensures chronological order. This produces better output quality for the degraded case than silently dropping B's early items.

The normal-path (lcRun > 0) branch differs slightly from the RESEARCH pseudocode's `bTail` / `bKept` variable naming but implements the identical logic: drop first `lcRun` pronunciation items from B, keep remaining pronunciations plus punctuation after the overlap window, sort by global StartTime.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `grep -c "^export function stitchChunks"` == 1 | PASS (1) |
| `grep -c "^export function longestCommonRun"` == 1 | PASS (1) |
| `grep -c "^export interface ChunkResult"` == 1 | PASS (1) |
| `grep -c "^import"` == 1 (AWS SDK type only) | PASS (1) |
| `startOffsetSec` offset add in stitchChunks | PASS (lines 135-136) |
| `Type === "pronunciation"` filter present | PASS (4 matches) |
| `/\s+([.,!?;:])/g` cleanup regex | PASS (line 222) |
| vitest: zero failures | PASS (20/20) |
| `grep -c "it("` >= 10 | PASS (26) |
| `[...]` appears verbatim in gap-marker test | PASS (Test 14) |

## Self-Check

- `src/backend/voice/word-stitcher.ts`: FOUND ✓
- `src/backend/voice/word-stitcher.test.ts`: FOUND ✓
- Commit `b542d787`: FOUND ✓
- `npx tsc --noEmit`: zero errors ✓
- `npx vitest run src/backend/voice/word-stitcher.test.ts`: 20/20 pass ✓

## Self-Check: PASSED

## Handoff Note to Plan 100-03+

`stitchChunks` and `ChunkResult` are importable from `./word-stitcher.js` (ESM `.js` extension per `module: nodenext`). The Wave 2 orchestrator should import:

```typescript
import { stitchChunks, type ChunkResult } from "./word-stitcher.js";
```

The function signature is `stitchChunks(chunks: ChunkResult[], overlapSec: number): string`. Pass the same `overlapSec` value that was used when extracting the chunk boundaries (e.g., 2.5 from D-04). The orchestrator is responsible for populating `ChunkResult.items` from `alt.Items` in each chunk's Transcribe response and setting `startOffsetSec` / `endOffsetSec` from the chunk boundary computation.

## Deviations from Plan

None — plan executed exactly as specified. The one algorithmic deviation (zero-match fallback keeping all of B rather than filtering by seamAt) is within the plan's explicit guidance that "a slight seam mismatch is acceptable" in the fallback case.

## Known Stubs

None. This is a pure algorithmic module with no placeholder values or TODO items.

## Threat Flags

None. Module has no network surfaces, no I/O, no file access, and no new trust boundaries beyond those already declared in the plan's `<threat_model>` (T-100-02-01 through T-100-02-03).
