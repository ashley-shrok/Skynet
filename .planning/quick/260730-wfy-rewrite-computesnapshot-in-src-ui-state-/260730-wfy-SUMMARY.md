---
phase: 260730-wfy-rewrite-computesnapshot
plan: "01"
type: quick
tags: [conversation-store, sorting, localeCompare, ui-state]
key-files:
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
decisions:
  - "Used module-scoped compareByLabel const (localeCompare numeric+base) referenced by all four sort sites"
  - "Tier 3 host ORDER left unchanged (hostTree walk order); only rows within each bucket sorted"
  - "Sort is in-place (.sort()) after population, before emission/push"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-30"
  tasks_completed: 3
  files_modified: 2
---

# Phase 260730-wfy Plan 01: Rewrite computeSnapshot alphabetical sort Summary

Alphabetical `row.label` sort added to all four row buckets in `computeSnapshot` (Tier 1 activeSet, Tier 2 pinned, each Tier 3 per-host bucket, Tier 3 RDP sentinel bucket) using a shared `compareByLabel` comparator (`localeCompare` with `{ numeric: true, sensitivity: "base" }`). Host ORDER in Tier 3 is unchanged.

## Commits

| Hash | Description |
|------|-------------|
| 332aed5 | feat(260730-wfy-01): add alphabetical row sort to computeSnapshot tiers + update header comment |
| b508312 | feat(260730-wfy-01): update tier-order test expectations to alphabetical + add pinned regression test |

## Full-Suite Vitest Summary (verbatim)

```
 Test Files  77 passed (77)
      Tests  875 passed | 6 skipped (881)
   Start at  23:29:46
   Duration  115.69s (transform 4.70s, setup 1.92s, import 27.56s, tests 17.83s, environment 48.83s)
```

No unexpected FAIL/failed/✗/Unhandled Rejection matches in the full-suite log. The "failed" strings that appear are inside test descriptions (`upload_failed`, `failed attempts`, `fetch failed`, `aside injectBtw failed`) and expected log messages — not runner failures.

## Build Verification

- `npx tsc --noEmit`: EXIT 0
- `npm run build:backend`: EXIT 0
- `npm run build`: EXIT 0
- Targeted vitest (conversation-store + PrettyConversationsPanel): EXIT 0 — 101 passed
- Full vitest suite: EXIT 0 — 875 passed / 6 skipped / 0 failed

## grep -nE 'activeSet\[|pinned\[|grouped\[' src/ui/state/conversation-store.test.ts — Hit-by-hit Analysis

| Line | Hit | Updated? | Reason |
|------|-----|----------|--------|
| 183 | `grouped[1].rows.map(...)` toEqual `["t2","t3"]` | NO | t2 and t3 both have label `terminal:bravo` — tie, stable order preserved |
| 189 | `grouped[1].rows.map(...)` toEqual `["t3"]` | NO | Single row in bucket |
| 196 | `grouped[1].rows.map(...)` toEqual `["t2","t3"]` | NO | Same-label tie, order preserved |
| 220 | `grouped[0].hostId` toBe `"hA1"` | NO | Asserts hostId, not row order |
| 221 | `grouped[0].rows.map(...)` toEqual `["t3"]` | NO | Single row in bucket |
| 256 | `grouped[0].rows.map(...)` toEqual `["t1"]` | NO | Single row in bucket |
| 391 | `grouped[0].rows[0]` (identity read) | NO | Single row — shape assertion, not ordering |
| 410 | `grouped[0].rows[0]` (shape assertion) | NO | Single row |
| 747 | `grouped[0].hostId` toBe `"1"` | NO | Asserts hostId |
| 748 | `grouped[0].rows.length` toBe 1 | NO | Asserts length |
| 749 | `grouped[0].rows[0]` (identity read) | NO | Single row |
| 779 | `grouped[0].rows.length` toBe 1 | NO | Asserts length |
| 780 | `grouped[0].rows[0]` (identity read) | NO | Single row |
| 815 | `grouped[0].hostId` toBe `"1"` | NO | Asserts hostId |
| 816 | `grouped[0].rows.map(...)` toEqual `["t1","fleet::1::scratch"]` | **YES** | t1 label=`terminal:hostA`, scratch label=`scratch`; "scratch"<"terminal:hostA" → `["fleet::1::scratch","t1"]` |
| 820 | `grouped[0].rows[1]` (scratchRow) | **YES** | Index updated from [1] to [0] since scratch is now first |
| 850 | `grouped[0].rows.map(...)` toEqual `["t1","fleet::1::work"]` | NO | t1 label=`hostA`, work label=`work`; "hostA"<"work" → same order |
| 910 | `grouped[0].hostName` toBe `"hostA-fallback-name"` | NO | Asserts hostName |
| 911 | `grouped[0].rows.length` toBe 1 | NO | Asserts length |
| 912 | `grouped[0].rows[0]` (identity read) | NO | Single row |
| 986 | `grouped[0].rows[0].id` toBe `"fleet::1::work"` | NO | Single fleet session in bucket |
| 999 | `pinned[0].id` toBe `"fleet::1::work"` | NO | Single pinned row |
| 1023 | `pinned[0].id` toBe `"fleet::1::work"` | NO | Single pinned row |
| 1024 | `pinned[0]` fleetOnly assertion | NO | Single pinned row shape |
| 1026 | Comment line | NO | Not an assertion |
| 1049 | `activeSet[0].id` toBe `"fleet::1::work"` | NO | Single active-set row |
| 1074 | `activeSet[0].id` toBe `"fleet::1::work"` | NO | Single active-set row |
| 1095 | `activeSet[0].id` toBe `"t1"` | NO | Single active-set row |

**Updated:** Lines 816, 820 (Test 25 — union rendering)
**Left unchanged:** All other 26 hits — single-row buckets, same-label ties, or non-ordering assertions (hostId/hostName/length/membership)

## New Regression Test Added

`describe("conversation-store (quick-260730-wfy): pinned tier alphabetical ordering")` — test title: `"pinned tier is alphabetically sorted by row.label regardless of source"`.

Constructs two openTabs with labels `["z","m"]` and two fleet sessions with labels `["a","n"]`, marks all four pinned, asserts `snap.pinned.map((r) => r.label)` deep-equals `["a","m","n","z"]`.

FAILS against pre-change store (source order `["z","m","a","n"]`), PASSES against post-change store.

## Deviations from Plan

None — plan executed exactly as written.

## File Boundary Compliance

No files outside `~/skynet/` were touched. No changes to `~/.claude/identities/tina/**` or `skynet-patches.md`.

## Self-Check: PASSED

- `src/ui/state/conversation-store.ts` — modified, contains `localeCompare`, commit 332aed5 verified
- `src/ui/state/conversation-store.test.ts` — modified, contains new regression test, commit b508312 verified
- All 5 verification commands exited 0
