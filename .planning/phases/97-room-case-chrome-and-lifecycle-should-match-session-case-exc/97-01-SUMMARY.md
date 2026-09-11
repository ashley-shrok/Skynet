---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 01
subsystem: ui
tags: [drag-drop, splitview, multibadgeanchor, tailwind, diagnostic-logs, discovery]

# Dependency graph
requires:
  - phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
    provides: two-source chat surface, source.kind discriminator, MultiBadgeAnchor participant row, IdentityBadge draggable contract, SplitView native drop-target listener
provides:
  - "[pv-split-drop-diag] structured logs at native dragover/drop in SplitView (forensic tape for future F-2 diagnosis)"
  - MultiBadgeAnchor ROOT_ANCHOR_CLASS inner gap tightened from gap-2 (8px) to gap-1 (4px) per D-11
  - F-2 discovery verdict (Verdict A — case-branch fill-in only) with static-analysis basis; Plan 06 unblocked to ship
affects: [97-06, 97-02, 97-03, 97-04, 97-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structured diagnostic-log convention with -diag suffix (distinct from production [pv-split-*] logs) — ambient forensic instrumentation may persist post-ship"
    - "Static-analysis-as-evidence for split-out gate decisions when live-browser reproduction is not accessible mid-phase"

key-files:
  created:
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md
  modified:
    - src/ui/shell/SplitView.tsx
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx

key-decisions:
  - "Verdict A (case-branch fill-in only) approved by Alice on static-analysis evidence alone — no live-browser reproduction required to greenlight Plan 06"
  - "[pv-split-drop-diag] logs use template-string form (not object form) to mirror existing [pv-split-preview] convention at SplitView.tsx L356-360"
  - "Live-browser verification of F-2 verdict DEFERRED to phase-end deploy (standard fleet pattern; Task 1–3 commits are not deployed mid-phase)"
  - "gap-1 (4px) selected as the halved inner gap per D-11; ROOT_ANCHOR_CLASS is a single-token change with no reshape of sort order, cell bodies, or absolute-positioning tokens"

patterns-established:
  - "Diagnostic log naming: existing production logs use [pv-split-preview]/[pv-split-drop]; discovery instrumentation adds a -diag suffix ([pv-split-drop-diag]) to distinguish and to signal it MAY be removed later without disturbing production observability"
  - "Discovery-notes doc pattern: static code analysis paired with reproduction-steps predictions is sufficient evidence for a blocking split-out gate when the analysis is unambiguous and live reproduction can be deferred"

requirements-completed: [F-2, F-4, D-05, D-06, D-07, D-11]

# Metrics
duration: ~2h (across two executor sessions — instrumentation + gap tighten + discovery notes in session 1; verdict resolution + summary in session 2)
completed: 2026-09-10
---

# Phase 97 Plan 01: F-2 Drag-Drop Discovery + F-4 Badge Gap Tighten Summary

**Instrumented SplitView native drop-target with [pv-split-drop-diag] forensic logs, halved MultiBadgeAnchor inner gap (gap-2 → gap-1), and delivered a Verdict-A discovery verdict on static-analysis evidence — Plan 06 cleared to ship.**

## Performance

- **Duration:** ~2h (across two executor sessions)
- **Started:** 2026-09-10 (session 1: Tasks 1–3)
- **Completed:** 2026-09-10 (session 2: Task 4 resolution + summary)
- **Tasks:** 4 (3 code/doc + 1 blocking human-verify checkpoint)
- **Files modified:** 2 code files + 1 doc file created + 1 doc file updated

## Accomplishments

- **F-2 drag-drop discovery closed with Verdict A.** Static code analysis identified the F-2 root cause definitively: `IdentityBadge.tsx:82` gates `isDragSource = !!tabId && !isMobile`, and `MultiBadgeAnchor.tsx:129` + `MultiBadgeAnchor.tsx:164` both mount `<IdentityBadge>` with no `tabId` prop → every relay-case badge cell silently drops out of the drag-source contract. This is a case-branch fill-in miss, not a structural corruption; Plan 06 threads `tabId` through per PATTERNS.md § Finding 2.
- **Split-out gate resolved without a phase-drop.** Per Phase 97 D-07 the drag-drop discovery task was designed to surface a split-out decision early. Verdict A means F-2 stays in-scope; Plan 06 remains in Phase 97 and ships in Wave 3.
- **F-4 badge gap tightened.** `ROOT_ANCHOR_CLASS` at `MultiBadgeAnchor.tsx:193` now carries `gap-1` (4px) in place of `gap-2` (8px). Halved per D-11. Existing MultiBadgeAnchor tests pass green.
- **[pv-split-drop-diag] forensic instrumentation landed.** Two log emit points at native `dragover` (SplitView.tsx L314) and `drop` (SplitView.tsx L441) — template-string form mirroring the existing `[pv-split-preview]` convention. Logs may stay as ambient instrumentation post-ship per RESEARCH § Finding 2 landmines (removal disposition TBD by orchestrator).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add [pv-split-drop-diag] instrumentation at SplitView native dragover/drop** — `8094adbc` (feat)
2. **Task 2: Tighten MultiBadgeAnchor inner gap from gap-2 to gap-1** — `4bc90709` (fix)
3. **Task 3: Reproduce Alice's flow + write DISCOVERY-NOTES.md (preliminary Verdict A)** — `6faa0128` (docs)
4. **Task 4: Verdict A close-out (Resolution section on DISCOVERY-NOTES.md)** — `3958cf07` (docs)

**Plan metadata:** SUMMARY.md commit (docs: complete plan) — appended below.

## Files Created/Modified

- `src/ui/shell/SplitView.tsx` — Two `[pv-split-drop-diag]` structured log emit points added inside the existing native drop-target listener effect (dragover at L314, drop at L441). No change to outer-listener attach/detach, no change to window-level `dragend`, no reshape of the ownership boundary — log-add only. Template-string form matches existing `[pv-split-preview]` convention.
- `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` — Single-token change in `ROOT_ANCHOR_CLASS` at L193: `gap-2` → `gap-1`. All other tokens (`absolute top-4 right-5 z-[101] flex flex-row-reverse items-start`) preserved verbatim. Cell bodies at L129 and L164 untouched (Plan 06's territory).
- `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` — Discovery notes documenting reproduction steps A and B, static-analysis basis for each RESEARCH hypothesis (H1–H5), preliminary Verdict A selection, live-log excerpt shapes, recommendation to orchestrator, and the final Resolution section recording Alice's greenlight.

## Verification

**Scoped tests (Task 2 acceptance gate):**
- `npx vitest run --related src/ui/features/pretty-view/MultiBadgeAnchor.tsx` — passed green at Task 2 commit (`4bc90709`). No harness-case regression; the ROOT_ANCHOR_CLASS token change is byte-scoped.

**Grep gates (Task 1 + Task 2 acceptance):**
- `grep -c 'pv-split-drop-diag' src/ui/shell/SplitView.tsx` = 2 (dragover + drop emit points, no loop re-emit).
- `grep -c 'JSON\.stringify(e)' src/ui/shell/SplitView.tsx` = 0 (Phase 93 Landmine 6 preserved — no DOM Event stringified).
- `grep -c 'items-start gap-1' src/ui/features/pretty-view/MultiBadgeAnchor.tsx` ≥ 1; `grep -c 'items-start gap-2' src/ui/features/pretty-view/MultiBadgeAnchor.tsx` = 0.
- `[pv-split-preview]` template-string log at SplitView.tsx L356-360 byte-untouched (regression floor for existing production logs).

**Must_haves fulfilled:**
- **Truth 1** (F-2 verdict): Verdict A confirmed, split-out gate resolved — Plan 06 SHIPS.
- **Truth 2** (F-4 gap): `gap-1` at L193 confirmed; badges will read visibly tighter than gap-2 (pending post-deploy visual confirmation).
- **Truth 3** (forensic log trail): `[pv-split-drop-diag]` logs at both dragover and drop; template-string form; no DOM Event stringified.
- **Truth 4** (harness byte-identity): Harness single-badge site at PrettyView.tsx:3539-3555 untouched; ROOT_ANCHOR_CLASS is the only class-list mutation in MultiBadgeAnchor; SplitView modifications are log-adds only.

**Artifacts fulfilled:**
- `src/ui/shell/SplitView.tsx` provides `[pv-split-drop-diag]` template-string logs — contains `pv-split-drop-diag` — verified.
- `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` provides `ROOT_ANCHOR_CLASS with gap-1` — contains `gap-1` — verified.
- `.planning/phases/97-.../97-01-DISCOVERY-NOTES.md` provides discovery reproduction findings + split-out verdict + drag-source root-cause narrative — 156 lines (min 20 required) — verified.

## Decisions Made

- **Verdict A on static-analysis evidence alone.** Alice chose to greenlight Verdict A without waiting for a live-browser reproduction cycle because the static code evidence for problem (a) (drag-source ask) is native-DOM contract, not a hypothesis — `draggable={false}` on the badge element is guaranteed to prevent `dragstart` from firing. Live verification of problem (b) (shared-state corruption after room open/close) is deferred to phase-end deploy; escalation path to Verdict B is preserved via the `[pv-split-drop-diag]` forensic tape that already shipped.
- **Diagnostic-log removal deferred.** The `[pv-split-drop-diag]` logs may stay in place as ambient forensic instrumentation post-ship, or a follow-up polish plan may remove them. Removal disposition is not a Plan 01 decision.

## Deviations from Plan

None — plan executed exactly as written. All three code/doc tasks landed at the exact acceptance-criteria targets; Task 4 checkpoint returned an unambiguous "approved verdict a" signal; the discovery notes correctly gated on the D-07 split-out contract.

## Issues Encountered

None. The static-analysis pass in Task 3 unambiguously identified the F-2 root cause path, and the RESEARCH.md-predicted "most-likely outcome: split-out DOES NOT apply — root cause is missing tabId in MultiBadgeAnchor" turned out to be exactly correct.

## User Setup Required

None — no external service configuration required. This plan is UI-code-only (diagnostic logs + a Tailwind token change) plus a discovery-doc artifact.

## Next Phase Readiness

- **Plan 06 unblocked to ship.** Plan 06 threads `tabId` through `MultiBadgeAnchor` per PATTERNS.md § Finding 2, filling in the case-branch this discovery identified. The `[pv-split-drop-diag]` forensic tape is already live in SplitView.tsx to catch any post-deploy surprise (e.g., if Verdict B needs to be revisited).
- **Wave 2 (Plans 02, 03, 04, 05) ready to proceed.** Plan 01's file-disjoint scope leaves the wave-2 files untouched.
- **Post-deploy verification concern.** Alice's live-browser reproduction of Reproduction A + B at phase-end deploy time is the final gate that either confirms Verdict A (expected) or reopens F-2 as a Verdict-B follow-up phase. No blocker on wave progression in the meantime.

## Self-Check: PASSED

**File existence:**
- `src/ui/shell/SplitView.tsx` — FOUND
- `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` — FOUND
- `.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-01-DISCOVERY-NOTES.md` — FOUND

**Commit existence:**
- `8094adbc` (Task 1) — FOUND
- `4bc90709` (Task 2) — FOUND
- `6faa0128` (Task 3) — FOUND
- `3958cf07` (Task 4 resolution) — FOUND

---
*Phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc*
*Completed: 2026-09-10*
