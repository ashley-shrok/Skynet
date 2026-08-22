---
phase: quick-260822-0vw-recycling-axis-layer1-source
plan: "01"
type: quick
subsystem: fleet-status/recycling-axis
tags: [recycling, layer1, ssh-poll-orchestrator, tdd]
dependency_graph:
  requires: [Phase 53-03, Phase 53-CR]
  provides: [Layer1 recycling arm at t=0 (before .recycled-at sentinel appears)]
  affects: [SessionState.recycling wire axis, PidCacheEntry.layer1RecyclingCached]
tech_stack:
  added: []
  patterns: [OR-composed recycling axis, third-scan-same-buffer, cache-fail-open]
key_files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - Renamed derivedRecycling → derivedSentinelRecycling to disambiguate; composed value is derivedRecyclingComposed (layer1 || sentinel)
  - scanTailForLayer1RecyclingSignal added as third scan on existing tailRaw buffer — ONE exec, THREE scans, no new SSH round-trip
  - PidCacheEntry.recycling continues to cache the sentinel value (not the composed value) so derivedSentinelRecycling cold-start path is unchanged
  - layer1RecyclingCached stores the Layer 1 scan result independently for fail-open preservation across SSH hiccups
metrics:
  duration: "317s (~5.3 min)"
  completed: "2026-08-22T00:49:13Z"
  tasks_completed: 1
  files_modified: 2
---

# Quick 260822-0vw: Layer 1 /id reset OR into Source A Recycling Composition — Summary

**One-liner:** OR-composed `derivedRecyclingComposed = derivedLayer1Recycling || derivedSentinelRecycling` into source A's SessionState.recycling, arming the recycling axis at t=0 (/id reset in JSONL tail) rather than only at t=N (.recycled-at sentinel placed at end of save flow).

## What Was Built

### ssh-poll-orchestrator.ts changes (lines referenced are post-change)

- **Import** (line 44): merged `detectIdReset` into the existing `parseSessionLine` import from `session-file-parser.js`.
- **PidCacheEntry.layer1RecyclingCached** (line 190): new field added immediately after `recycling: boolean`. Caches the Layer 1 tail-scan result per tick; `false` at cold-start; fail-open on SSH hiccup (cache preserved on null tailRaw).
- **scanTailForLayer1RecyclingSignal()** (line 382–421): new pure scanner function. Takes a tail buffer, iterates lines, JSON.parse per line (skip malformed silently), for each `type:"user"` line calls `detectIdReset(parsed)` and remembers the result (last-wins — mirrors `layer1-detect.applyLineToLayer1State` reducer semantics). Returns `true`/`false`/`null` (null = zero parseable user turns = caller preserves cache).
- **Sentinel rename** (line 876): `derivedRecycling` → `derivedSentinelRecycling` for clarity in the composed context.
- **derivedLayer1Recycling init** (line 931): initialized from `cached?.layer1RecyclingCached ?? false` before the tail-scan block.
- **Third scan** (lines 953–958): inside `if (tailRaw !== null && tailRaw.trim() !== "")`, after the two existing scans, calls `scanTailForLayer1RecyclingSignal(tailRaw)`. Updates `derivedLayer1Recycling` if non-null (null = zero user turns = preserve cache).
- **Composition** (line 1053): `const derivedRecyclingComposed: boolean = derivedLayer1Recycling || derivedSentinelRecycling;`
- **SessionState stamp** (line 1078): `recycling: derivedRecyclingComposed` (was `derivedRecycling`).
- **livenessMap.set fresh-publish branch** (lines 1107): added `layer1RecyclingCached: derivedLayer1Recycling` and corrected `recycling: derivedSentinelRecycling`.
- **livenessMap.set same-fingerprint branch** (lines 1122): same additions.

### ssh-poll-orchestrator.test.ts changes

- New describe block `"quick-260822-0vw — Layer 1 /id reset OR composition into source A recycling"` appended at end of file (line 3733+).
- 5 tests covering the OR truth table + fail-open:
  - **QT-260822-0vw-T1-i**: Layer 1 alone (sentinel absent) → `recycling === true`
  - **QT-260822-0vw-T1-ii**: Sentinel alone (no /id reset in tail) → `recycling === true` (regression guard for Phase 53-01)
  - **QT-260822-0vw-T1-iii**: Both signals true → `recycling === true`, single publish (OR is idempotent)
  - **QT-260822-0vw-T1-iv**: Neither signal → `recycling === false`
  - **QT-260822-0vw-T1-v**: SSH failure on tail (null) → fail-open to cold-start cache (`false`), no throw

## Deviations from Plan

None — plan executed exactly as written. The code structure (sentinel rename, third scan placement, composition variable name `derivedRecyclingComposed`) matches the plan specification. The `detectIdReset` count of 5 vs plan's "at least 2" is due to the function appearing in its docblock comment and two internal implementation sites.

## Done Criteria Verification

- `grep -c "QT-260822-0vw-T1-" ...test.ts` → **10** (≥10 required)
- `grep -c "detectIdReset" ...orchestrator.ts` → **5** (≥2 required: import + call site)
- `grep -c "layer1RecyclingCached" ...orchestrator.ts` → **6** (≥4 required: interface + cache read + 2 stamps)
- `npx tsc --noEmit` → **0 errors** on touched files
- All **64 tests** pass (59 pre-existing + 5 new)
- Source B (`pollDormantOnlyIdentities`) untouched — verified via `git diff`
- Zero changes to `wire-protocol.ts`, `session-file-parser.ts`, `layer1-detect.ts`, `pane-state-emitter.ts`, any frontend file

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `6350d21b` | `test(quick-260822-0vw)` | RED: 5 failing tests for Layer 1 /id reset OR into source A recycling |
| `0d7fc4b5` | `feat(quick-260822-0vw)` | GREEN: OR Layer 1 /id reset detector into source A recycling composition |

## Self-Check: PASSED

- Both commits exist in git log: `6350d21b` (test), `0d7fc4b5` (feat) — confirmed
- Modified files exist on disk: `ssh-poll-orchestrator.ts`, `ssh-poll-orchestrator.test.ts` — confirmed
- 64 tests pass, 0 TypeScript errors — confirmed
