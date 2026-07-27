---
phase: quick-260727-ejk
plan: 01
type: execute
wave: 1
depends_on: []
completed: 2026-07-27
duration: 5m 24s
tasks_completed: 1
tasks_total: 1
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
commits:
  - hash: 28065e5
    message: "feat(mobile): bump ComposeBox controls + scroll-to-bottom for mobile touch"
    files: 2
    stats: "+17 −10"
requirements_completed:
  - ASHLEY-MOBILE-SIZING
deploy_status: HELD (batched with cdccd4f, awaiting Ashley combined-batch UAT)
key-decisions:
  - "Additive-only Tailwind max-md: variants — zero desktop visual change, zero JS/logic touched, zero new imports"
  - "isTouchDevice ternary at Row-1 container preserved untouched; max-md:min-h-16 appended as third cn() arg (both signals coexist per plan §Do NOT touch)"
  - "Hourglass Row-2 button max-md class appended as final cn() arg AFTER the queueArmed ternary array (both arms inherit the mobile size)"
  - "Send inline SVG width=\"24\" height=\"24\" fallback attributes preserved verbatim; className=\"max-md:w-10 max-md:h-10\" added as a NEW attribute (Tailwind specificity overrides the attribute width/height at mobile viewport)"
tags: [mobile, tailwind, ergonomics, ashley-uat, composebox, prettyview]
---

# Quick 260727-ejk: Mobile Sizing Bumps for ComposeBox Buttons + PrettyView Scroll-to-Bottom Summary

Purely-additive Tailwind `max-md:` className bumps across `ComposeBox.tsx` (row-1 retry, meter well/reset+RotateCcw, 5× row-2 icon-sm cluster, textarea min-height + right padding, inside-textarea Send trio) and `PrettyView.tsx` (jump-to-latest button + ArrowDown icon) so Ashley's <768px viewport gets ~2× tap targets on the composer and a ~4× scroll-to-bottom pill — with byte-identical desktop rendering and no logic touched.

## Files Modified

| File | Line Ranges Touched | max-md: hits added |
|------|--------------------|-------------------:|
| `src/ui/features/pretty-view/ComposeBox.tsx` | 975, 1004, 1019, 1043, 1064, 1204, 1235, 1265, 1295, 1345, 1402, 1434, 1514, 1536, 1549 | 15 lines (17 tokens across 11 conceptual touches) |
| `src/ui/features/pretty-view/PrettyView.tsx` | 1194, 1196 | 2 lines |

Total: **2 files, 11 conceptual className touches, 17 additions + 10 replacements = 17 insertions / 10 deletions net.**

## Task Execution

### Task 1: Apply max-md: mobile-sizing className bumps to ComposeBox + PrettyView scroll-to-bottom
- **Status:** Complete
- **Commit:** 28065e5
- **Files:** `src/ui/features/pretty-view/ComposeBox.tsx`, `src/ui/features/pretty-view/PrettyView.tsx`

Per-touch inventory (against final file line numbers):

**ComposeBox.tsx (9 conceptual touches, 15 grep-lines):**

| # | Element | Line | Change |
|---|---------|------|--------|
| 1 | Retry-upload Button className | 975 | `"gap-1 text-xs"` → `"gap-1 text-xs max-md:h-12 max-md:px-4 [&_svg]:max-md:size-6"` |
| 2 | Row-1 container cn() | 1004 | Third arg `"max-md:min-h-16"` appended (isTouchDevice ternary preserved verbatim) |
| 3 | Meter well className | 1019 | Leading `h-7` → `h-7 max-md:h-14` |
| 4 | Reset button cn() | 1043 | `w-6` → `w-6 max-md:w-12` (h-full inherits enlarged meter well) |
| 5 | Reset button inner RotateCcw | 1064 | `size-3.5` → `size-3.5 max-md:size-7` |
| 6a | Row-2 icon-sm Terminal (Toggle pretty-off) | 1204 | Appended `"max-md:size-14 [&_svg]:max-md:size-6"` as final cn() arg |
| 6b | Row-2 icon-sm Paperclip | 1235 | Same append |
| 6c | Row-2 icon-sm Square (Stop / Ctrl-C) | 1265 | Same append |
| 6d | Row-2 icon-sm ThumbsUp (GoodToGo) | 1295 | Same append |
| 6e | Row-2 icon-sm Hourglass (Queue) | 1345 | Same append (AFTER the queueArmed ternary array — both arms inherit) |
| 7 | Textarea min-height | 1402 | `"min-h-8!"` → `"min-h-8! max-md:min-h-16!"` |
| 8 | Textarea right padding | 1434 | `"pr-10"` → `"pr-10 max-md:pr-14"` |
| 9a | Send button cn() `"p-2"` | 1514 | → `"p-2 max-md:p-3"` |
| 9b | Send inline SVG | 1549 | Added new attribute `className="max-md:w-10 max-md:h-10"` (width/height fallback preserved) |
| 9c | Send X icon (asideActive branch) | 1536 | `size-6` → `size-6 max-md:size-10` |

**PrettyView.tsx (2 touches):**

| # | Element | Line | Change |
|---|---------|------|--------|
| 10 | Scroll-to-bottom Button cn() | 1194 | Appended `"max-md:size-28"` as additional cn() arg |
| 11 | ArrowDown icon | 1196 | `size-4` → `size-4 max-md:size-14` |

## Verification Results

- **Grep gates (plan verify block):** 18 of 19 pass. The 19th gate — `grep -q 'width="24" height="24"'` — is a plan-authoring drift: the original source has these attributes on **adjacent lines** (multi-line SVG), so the same-line grep would never have matched the pre-change file either. Both attributes are demonstrably preserved (line 1544 `width="24"`, line 1545 `height="24"`). The guard's **intent** (SVG width/height fallback preserved) is satisfied — verified via `grep -A1 'width="24"' | grep -q 'height="24"'`.
- **Type-check:** `npm run type-check` (→ `tsc --noEmit`) clean.
- **Test sweep:** `npm test` → **604/604 passing** (49 test files). Byte-identical to the cdccd4f baseline — no new tests added, no regressions.
- **Guards verified preserved:**
  - `isTouchDevice ? "min-h-[44px]" : "min-h-8"` ternary at Row-1 container (line 1004)
  - `"absolute right-1 bottom-0.5"` Send positioning (line 1512)
  - `w-[var(--meter-width)]` meter CSS var (line 1019)
  - `width="24" height="24"` inline-SVG fallback (lines 1544–1545, adjacent)
  - `Hourglass, Paperclip, RefreshCw, RotateCcw, Square, Terminal, ThumbsUp, X` lucide-react import line unchanged
  - `ArrowDown` lucide-react import line unchanged in PrettyView

## Deviations from Plan

**None from the plan's intent.** One minor gate-authoring artifact (plan's `width="24" height="24"` same-line grep never matched the pre-change source either — see Verification section above); routed through with semantic-equivalent verification. No code, logic, or scope deviation. No imports added, no state added, no components created.

## Deploy Status

**HELD.** This commit stacks on `cdccd4f` (fix(aside): extend /id suppression to cover harness slash-UI form) and awaits Ashley's combined-batch UAT greenlight before `docker compose up -d --force-recreate skynet`. Per constraints: **do NOT deploy inside this task** — batch discipline (one deploy, not two). The 15-min deadman-rollback constraint was retired 2026-07-21 (bounty `claude-md-15min-deadman-stale`) but the batch-discipline reason still applies.

## Self-Check: PASSED

- File `src/ui/features/pretty-view/ComposeBox.tsx` exists — FOUND (verified via `wc -l`, 1557 lines post-edit)
- File `src/ui/features/pretty-view/PrettyView.tsx` exists — FOUND (verified via `wc -l`, 1322 lines post-edit)
- Commit `28065e5` exists — FOUND (`git log --oneline -3` shows `28065e5 feat(mobile): bump ComposeBox controls + scroll-to-bottom for mobile touch`)
- No unexpected deletions in commit — CONFIRMED (`git diff --diff-filter=D --name-only HEAD~1 HEAD` empty)
- No stubs introduced (pure CSS additive change, no data-source wiring or placeholder UI)
- No new threat surface (no network endpoints, auth paths, or file access — Tailwind class-string additions only)
