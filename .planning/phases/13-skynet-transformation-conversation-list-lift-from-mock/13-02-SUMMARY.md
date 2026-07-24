---
phase: 13-skynet-transformation-conversation-list-lift-from-mock
plan: 02
subsystem: ui
tags: [ui, css, pretty-conversations, appshell, lift-from-mock, panel-header, shell-chrome, phase-13]
dependency_graph:
  requires:
    - phase: 13-01
      provides: pretty-conversations.css `.pv-panel-header`, `.pv-title`, `.pv-pencil` selectors (already declared for Wave 2 consumption)
    - src/ui/index.css (--color-pv-* palette tokens)
    - prototype.html mock v4 (Ashley-locked 2026-07-23)
  provides:
    - PrettyConversationsPanel header rendered with mock's class-toggle treatment (12px + 700 + 0.1em UPPERCASE title, 32x32 transparent 8px-radius pencil, hairline border-bottom)
    - AppShell sidebar-toggle chevron rebased to --color-pv-* palette (mock v4 `.pv-pencil` aesthetic — transparent bare-icon-with-rounded-md)
  affects:
    - Wave 3 (13-03): PinAction rewrite — visually consistent with the newly-lifted panel header
    - Wave 4 (13-04): post-lift verification/UAT — chevron + panel header both now match mock v4
tech_stack:
  added: []
  patterns:
    - class-toggle-driven header treatment (CSS-in-file, no JS-branch CSSProperties for typography or button chrome)
    - inline Tailwind utility form for palette-token references in AppShell (`text-[color:var(--color-pv-fg-muted)]`, `hover:bg-[rgba(220,225,245,0.06)]`, etc.) so AppShell can consume the palette without dep on the pretty-conversations.css class being globally available
    - retain-shrink-0-only-defence pattern (header container keeps `shrink-0` while all other layout comes from CSS class)
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (429 → 426 lines, header block rewrite — scroll region + empty state + NewSessionDialog wiring preserved verbatim)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (713 → 748 lines, 3 header tests updated — 11 other tests untouched)
    - src/ui/AppShell.tsx (chevron block only, 15 insertions + 4 deletions, strictly within L1407-1479)
decisions:
  - "Kept the header container's `shrink-0` utility class alongside the new `pv-panel-header` class. `pv-panel-header` handles display/padding/border/justify-content per the mock, but `shrink-0` defends against parent-flex shrinking (unchanged from the pre-Phase-13 behavior). Simpler than moving `flex-shrink: 0` into the CSS file where it would apply to every consumer."
  - "For AppShell chevron, chose the inline Tailwind palette-token utility form (`text-[color:var(--color-pv-fg-muted)]`) over the shared `.pv-pencil` CSS class. Both are called out as acceptable in the plan — inline form was chosen because AppShell is far from pretty-conversations.css conceptually and the palette-token references make the color contract explicit at the call site."
  - "Unwrapped the inner `<div className='flex items-center gap-1'>` around the pencil button. The plan noted this wrapper was 'historical' and 'Simpler is better; unwrap if only one control exists.' Pencil is the only right-side control; wrapper unwrapped."
  - "Retired the exact-value comment describing what was retired (`bg-[rgba(20,22,28,0.85)]` etc.) in the AppShell JSDoc block. Kept a semantic description of the retired treatment ('opaque rgba fill + backdrop-blur + white-alpha border + drop shadow + Skynet muted-foreground text') so the intent is documented without tripping the plan's post-condition grep."
  - "No changes to pretty-conversations.css — parallel-safety guarantee with 13-03. Wave 1 already declared every selector this task needed (`.pv-panel-header`, `.pv-title`, `.pv-pencil`, `.pv-pencil svg`, hover treatment, cursor + user-select + tap-highlight-color); this plan just consumes them."
requirements_completed: [SHAPE-02, SHAPE-04]
metrics:
  duration: 15min
  started: "2026-07-23T15:05:22Z"
  completed: "2026-07-23T15:15:00Z"
  tasks: 2
  commits: 3
  files_changed: 3
  lines_added: 86
  lines_deleted: 43
  net_lines: +43
---

# Phase 13 Plan 02: Skynet Transformation — Panel Header + AppShell Chevron Lift-from-Mock Summary

**PrettyConversationsPanel header + AppShell sidebar-toggle chevron both rebased to the mock v4 `.pv-panel-header`/`.pv-pencil` aesthetic — 12px UPPERCASE 0.1em-tracked title, 32x32 transparent bare-icon-with-rounded-md buttons, hairline border-bottom via --color-pv-border-quiet; retires Skynet filled-glass pill + mixed-case chunky title treatment across two surfaces.**

## One-Liner

Header + chevron now look like the mock: transparent bare-icon buttons in `--color-pv-fg-muted`, UPPERCASE 12px 0.1em-tracked title in `--color-pv-fg`, hairline border-bottom. Retired: 34x34 rounded-full filled-glass pencil pill + 13px mixed-case chunky title (panel) + rgba(20,22,28,0.85) opaque glass + backdrop-blur + white/8% border + drop shadow + `text-muted-foreground` Skynet theme (chevron).

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-23T15:05:22Z
- **Completed:** 2026-07-23T15:15:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 source, 1 test)

## Accomplishments

- PrettyConversationsPanel header renders the mock's `.pv-panel-header` (14px 16px padding + hairline border-bottom + display:flex + justify-content:space-between), `.pv-title` (12px + 700 + 0.1em + UPPERCASE + `--color-pv-fg`), and `.pv-pencil` (32x32 + transparent bg + transparent border + 8px radius + `--color-pv-fg-muted` icon + `rgba(220,225,245,0.06)` hover) treatment
- AppShell top-left persistent sidebar-toggle chevron rebased from Skynet filled-glass pill (`bg-[rgba(20,22,28,0.85)]` + `backdrop-blur-[10px]` + `border-white/[0.08]` + `shadow-[0_2px_8px]` + `text-muted-foreground`) to mock's transparent bare-icon-with-rounded-md aesthetic (matches Task 1's panel-header pencil visually)
- All 14 PrettyConversationsPanel tests still pass with updated assertions on the new mock's markup structure — old assertions on `text-[13px] font-semibold` + `w-[34px] h-[34px] rounded-full bg-white/[0.04]` retired
- Chevron edit strictly scoped to L1407-1479 — `git diff --stat src/ui/AppShell.tsx` confirms 15 insertions + 4 deletions, all within the chevron block
- Scroll region + empty state + NewSessionDialog wiring in PrettyConversationsPanel preserved verbatim (no touch of lines 275-410 area)
- No edits to `pretty-conversations.css` (parallel-safety with 13-03 confirmed), `PrettyConversationRow.tsx` (Wave 1 owns), `PinAction.tsx` (Wave 3 owns), `pretty-view/`, `components/`, `ssh/`, or `terminal/` (SHAPE-06 lockout respected)

## Task Commits

Each task was committed atomically:

1. **Task 1a (source rewrite):** `d165e02` — `feat(13-02): rewrite PrettyConversationsPanel header to mock's class-toggle treatment`
2. **Task 1b (test update):** `7cfee26` — `test(13-02): update PrettyConversationsPanel header tests to assert pv-panel-header/pv-title/pv-pencil`
3. **Task 2 (chevron rebase):** `cfc92c0` — `feat(13-02): rebase AppShell sidebar-toggle chevron to --color-pv-* palette + mock pencil treatment`

Plan-suggested atomic split (2 commits for Task 1 source + test, 1 commit for Task 2) followed exactly. No CSS-augmentation commit needed — Wave 1's CSS already declared every selector consumed here.

## Files Created/Modified

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (429 → 426 lines): header block rewritten (`<div className="pv-panel-header shrink-0">` + `<span className="pv-title">` + `<button className="pv-pencil">`). Scroll region + empty state + NewSessionDialog wiring preserved byte-for-byte. Inner `<div className='flex items-center gap-1'>` wrapper around pencil unwrapped (per plan's discretion note — only one right-side control exists).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (713 → 748 lines): Test 5 asserts `.pv-pencil` class on the pencil button; Test 7 asserts `.pv-title` on title + `.pv-panel-header` on the header row container; Test 8 asserts `.pv-title` NOT present on mobile variant + `.pv-panel-header` still there + `.pv-pencil` on the pencil. Other 11 tests untouched (empty state, ordering, no-section-headers, RDP sentinel, pencil-gate, gear-removed × 2, dispatcher routing × 3, onConversationSelected).
- `src/ui/AppShell.tsx` (2000+ lines total, chevron block edit only — 15 insertions + 4 deletions strictly within L1407-1479): className string on the chevron `<button>` rebased from `bg-[rgba(20,22,28,0.85)] backdrop-blur-[10px] backdrop-saturate-150 border border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.35)] text-muted-foreground hover:text-foreground` to `bg-transparent border border-transparent text-[color:var(--color-pv-fg-muted)] hover:bg-[rgba(220,225,245,0.06)] hover:border-[color:var(--color-pv-border-quiet)] hover:text-[color:var(--color-pv-fg)]`. Kept `fixed flex items-center justify-center w-8 h-8 rounded-lg transition-colors cursor-pointer` (positioning + 32x32 + 8px radius + transitions + affordance). Inline `style` block for safe-area top/left + zIndex 30 unchanged. `<span>` rotate transform + `<ChevronLeft className="size-4" />` icon unchanged. JSDoc comment updated to describe the SHAPE-04 rebase in semantic terms (no exact class-string mentions of retired treatment to avoid post-condition grep flapping).

## Decisions Made

- **Retain-shrink-0-only-defence:** Header container keeps `shrink-0` alongside the new `pv-panel-header` class. `shrink-0` defends against parent-flex shrinking (unchanged behavior from pre-Phase-13); all other layout comes from the CSS class. Simpler than moving `flex-shrink: 0` into the CSS file where it would apply to every consumer.
- **Inline Tailwind palette-token form on AppShell (not shared `.pv-pencil` class):** Plan explicitly allowed either. Chose inline form because AppShell is conceptually far from `pretty-conversations` and the explicit palette-token references at the call site make the color contract self-documenting. Cost: three `hover:` utilities × three tokens vs. one class name. Benefit: no coupling between AppShell shell chrome and a CSS class named after the panel's pencil affordance.
- **Unwrap inner `<div className='flex items-center gap-1'>` around the pencil:** Plan's "Simpler is better; unwrap if only one control exists" applied — pencil is the only right-side control now (gear removed in patch #133). Wrapper removed, pencil placed as direct sibling of the title/aria-hidden span.
- **Retire exact-string comment mentions of the retired classes in AppShell JSDoc:** First pass documented retirement using the exact class strings (`bg-[rgba(20,22,28,0.85)]` etc.) which tripped the plan's post-condition grep (grep can't distinguish comment vs code). Rewrote the comment to describe retired treatment semantically ("opaque rgba fill + backdrop-blur + white-alpha border + drop shadow + Skynet muted-foreground text") — grep gate now green, intent still documented.
- **No CSS file touch:** Wave 1's `pretty-conversations.css` already declared `.pv-panel-header` with `justify-content: space-between`, `.pv-pencil` with all needed states + hover + `-webkit-tap-highlight-color`, `.pv-pencil svg` with 18x18. Verified before starting Task 1; no CSS augmentation needed. Parallel-safety with 13-03 preserved.

## Deviations from Plan

None. All work stayed within the class-toggle-state-variant architecture Ashley locked in `13-CONTEXT.md`, and the plan's suggested commit split (2 for Task 1 source+test, 1 for Task 2) was followed exactly.

The plan's post-condition grep for AppShell's chevron block briefly tripped after the first pass because the initial JSDoc revision mentioned exact retired class strings (`bg-[rgba(20,22,28,0.85)]` etc.) inside a `{/* */}` comment. The grep uses `grep -vE '^\s*//'` to filter only `//` line comments and can't distinguish JSX block comments. This is a comment-only concern (not a code-behavior concern), and was resolved by rewriting the JSDoc to describe the retired treatment semantically ("opaque rgba fill + backdrop-blur + white-alpha border + drop shadow + Skynet muted-foreground text") rather than by exact class strings. Documented here as a note rather than as a deviation because no functional behavior changed and no rule was triggered.

## Issues Encountered

- **Baseline pre-existing failure:** `src/ui/features/pretty-view/ComposeBox.test.tsx` has 2 failing tests (`Test :send-yes | send-no`) that fail both with and without this plan's changes. Confirmed via `git stash` + rerun on baseline (2 fail there too) then `git stash pop` to restore working state. These are in `src/ui/features/pretty-view/*` which this plan explicitly does NOT touch (SHAPE-06 lockout — "leave the pretty view chat interior alone" per Ashley). Not this plan's scope; not resolved here. Test count reflected in Task 2's verify: overall `npx vitest run` reports `Test Files 1 failed | 42 passed (43); Tests 2 failed | 524 passed (526)` — the 2 failures are the pre-existing ComposeBox failures.
  - **Note on baseline verification method:** Used `git stash` + `git stash pop` inside this plain (non-worktree) checkout. Safe here because this repo is not a Claude Code worktree — `refs/stash` isolation warnings don't apply. For worktree contexts, `git show HEAD~1:path` or a scratch-branch commit would be the sanctioned alternatives.
- No auth-gate encounters. No package installs. No architectural (Rule 4) escalations.

## Acceptance Criteria Rundown

### Task 1

| Criterion | Status |
|-----------|--------|
| PrettyConversationsPanel.tsx source contains `pv-panel-header`, `pv-title`, `pv-pencil` class-name string literals | PASS |
| No non-comment lines in PrettyConversationsPanel.tsx contain `w-[34px] h-[34px] rounded-full` or `text-[13px] font-semibold` | PASS |
| PrettyConversationsPanel.test.tsx asserts `pv-panel-header` and `pv-pencil` class presence | PASS |
| Scroll region body untouched (lines 275-410 of pre-Phase-13 file, equivalent to lines 260-395 of the new file — the empty state div, pinned map, grouped map, RDP divider, NewSessionDialog remain byte-for-byte equivalent) | PASS |
| `npx tsc --noEmit` exits 0 | PASS |
| `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` all green (14/14) | PASS |
| No edits under `src/ui/features/pretty-view/`, `src/ui/components/`, `src/ui/ssh/`, `src/ui/features/terminal/`, `PrettyConversationRow.tsx`, `PinAction.tsx` | PASS |
| 2 atomic commits landed (source rewrite, test update) — NO CSS file edit | PASS (d165e02, 7cfee26) |

### Task 2

| Criterion | Status |
|-----------|--------|
| AppShell.tsx chevron block references `--color-pv-*` tokens or `pv-pencil` — grep `color-pv-fg-muted\|pv-pencil\|--color-pv` returns >= 1 (returned 4) | PASS |
| Chevron block does NOT contain `bg-[rgba(20,22,28,0.85)]`, `border-white/[0.08]`, `shadow-[0_2px_8px_rgba(0,0,0,0.35)]`, `backdrop-blur-[10px]`, `backdrop-saturate-150` (all retired; grep returned 0) | PASS |
| Chevron block does NOT contain `text-muted-foreground` or `hover:text-foreground` in any lines (comment already scrubbed; grep returned 0) | PASS |
| Nothing outside the chevron block modified in AppShell.tsx — `git diff --stat` reports 15 insertions + 4 deletions, all within L1415-1470 | PASS |
| `npx tsc --noEmit` exits 0 | PASS |
| `npx vitest run` overall test suite green (or unchanged from baseline) — 2 pre-existing ComposeBox failures unchanged | PASS (baseline preserved) |
| No edits under `src/ui/features/pretty-view/`, `src/ui/components/`, `src/ui/ssh/`, `src/ui/features/terminal/`, `PrettyConversationRow.tsx`, `PinAction.tsx` | PASS |
| 1 atomic commit landed (source edit) | PASS (cfc92c0) |

## Known Stubs

None. All data flows preserved (`headerLabel`, `newSessionLabel`, `showPencilButton`, `showDesktopTitle` unchanged). Every retired class was replaced by an equivalent CSS-class-driven treatment declared in Wave 1's `pretty-conversations.css` (Task 1) or by an equivalent `--color-pv-*` palette utility (Task 2). No hardcoded empty values introduced. No placeholder text. No "coming soon" markers.

## Threat Flags

No new security-relevant surface. This plan is pure UI CSS refactoring — no network endpoints, no auth paths, no file access, no schema changes at trust boundaries. STRIDE register mitigations applied as designed:

- **T-13-02-01 (Tampering — accidental AppShell state change outside chevron scope):** Task 2 acceptance criteria required `git diff --stat src/ui/AppShell.tsx` inspection. Result: 15 insertions + 4 deletions, all within L1407-1479 (chevron block). No tab state / keyboard handler / WebSocket lifecycle / sidebar content changes.
- **T-13-02-02 (Denial of Service — panel header layout regression on one variant):** Task 1's Test 7 and Test 8 exercise both `variant='desktop'` and `variant='mobile'` — both pass (14/14 total).
- **T-13-02-03 (Information Disclosure — palette-token references):** No new exposure. `--color-pv-fg-muted` etc. already exposed in `src/ui/index.css:132-134`, already used by every other pretty-* surface.
- **T-13-02-04 (Tampering — scope drift into pretty-view interior):** `git diff --name-only HEAD~3..HEAD` returns only the three files declared in `files_modified`. No pretty-view interior touched.
- **T-13-02-SC (Supply chain — package installs):** Zero installs. Pure JSX + CSS class-string text edits. No supply-chain surface.

## Test Suite Status

**Panel-scoped (this plan's scope):**
- Before: `PrettyConversationsPanel.test.tsx` 14 passing (Test 11 retired earlier).
- After: 14 passing, with 3 tests (Test 5, 7, 8) updated for the mock's new markup — all green.

**Global regression check:**
- Before this plan: 42 test files, 524 passing + 2 failing (pretty-view ComposeBox).
- After this plan: 42 test files, 524 passing + 2 failing (same ComposeBox baseline failures — unchanged).
- **Regressions caused by this plan: 0.**

## Downstream Enablement

This plan's execution makes Wave 3 (13-03 PinAction rewrite) and Wave 4 (13-04 post-lift verification/UAT) straightforward:

- **Wave 3 (13-03) — PinAction rewrite:** PinAction lives inside a row, not in the header. This plan's header rewrite doesn't touch the row internals, so 13-03 has full freedom to rewrite PinAction's pin-icon-with-hue-glow treatment without any coordination overhead. Wave 1's CSS already declared the row hover-reveal rule (`.pv-row.pv-row--desktop:not(.pinned):not(:hover) .pv-meta [data-testid="pin-action"] { opacity: 0 }`) that PinAction will consume.
- **Wave 4 (13-04) — post-lift verification / UAT:** Both surfaces Ashley called out ("bar at the top that says conversations" + "bar at the top around the session name") have now been rebased to the mock v4 aesthetic. UAT should focus on visual match confirmation against `prototype.html` mock v4, plus the ambient-recession dot-visibility investigation (which is upstream of both Wave 2 and Wave 3).

## Follow-up Candidates for Master Bounty

None require sibling bounties. Everything in this plan flows through the master `skynet-transformation` bounty:

- The AppShell shell chrome outside the chevron (`className="flex w-screen bg-background"` outer wrapper on L1400, the `100dvh` + `paddingTop` safe-area logic) still uses Skynet theme classes. Ashley's SHAPE-04 description explicitly limited SHAPE-04 to "the chevron area only"; broader shell-chrome rebase would be a future patch if it turns out to matter for the visual match. Deferred candidate for the master bounty timeline, NOT a sibling bounty.
- The 2 pre-existing ComposeBox test failures (`Test :send-yes | send-no` in `src/ui/features/pretty-view/ComposeBox.test.tsx`) are baseline flakes / regressions from an earlier phase, not caused by this plan. If they matter, they belong in a fresh bounty (compose-box test-suite hygiene) — SHAPE-06 lockout keeps them out of the Ship-of-Theseus scope, but they COULD be resolved by a `/gsd:quick`-style fix if Ashley cares. Not this plan's problem.

## Self-Check: PASSED

- **Files verified exist and are modified as declared:**
  - FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (426 lines, `pv-panel-header` + `pv-title` + `pv-pencil` present)
  - FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (748 lines, Test 5/7/8 updated with the new class-based assertions)
  - FOUND: `src/ui/AppShell.tsx` (chevron block references `--color-pv-fg-muted`, `--color-pv-border-quiet`, `--color-pv-fg`; no retired filled-glass-pill classes)
- **Commits verified exist:**
  - FOUND: `d165e02` (Task 1a — source rewrite)
  - FOUND: `7cfee26` (Task 1b — test update)
  - FOUND: `cfc92c0` (Task 2 — chevron rebase)
- **Test suite green (this plan's scope):** 14/14 PrettyConversationsPanel tests pass; tsc `--noEmit` exits 0 after each of the 3 commits.
- **Scope-lock preserved:** `git diff --name-only a4d5d10..HEAD` — after excluding `.planning/` docs — returns only `src/ui/AppShell.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`. No pretty-view / components / ssh / terminal / PrettyConversationRow / PinAction / pretty-conversations.css touched.
