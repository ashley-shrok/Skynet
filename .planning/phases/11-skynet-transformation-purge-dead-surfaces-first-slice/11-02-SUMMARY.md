---
phase: 11-skynet-transformation-purge-dead-skynet-surfaces-first-slice
plan: 02
subsystem: ui/app-shell
tags: [ui, app-shell, landing-surface, skynet-purge, palette-pv, pretty-view]

# Dependency graph
requires:
  - phase: 11-01
    provides: authoritative strip-list Section A (8 landing-surface swap targets) + PrettyLandingCard component recommendation + preserve-dashboard-TabType rationale
  - phase: 10-pretty-conversations-visual-language-rework
    provides: PrettyConversationsPanel empty-state idle glass card visual language + Phase 10 patch #133 shadcn-free precedent + rgba(240,235,224) warm-cream palette values
provides:
  - src/ui/features/pretty-view/PrettyLandingCard.tsx — warm-glass empty-landing card (prop-less) rendered by tabUtils.tsx when the "dashboard" TabType fallback is active
  - src/ui/features/pretty-view/PrettyLandingCard.test.tsx — 4 behavior tests (data-attribute presence, centering classes, inline-style palette-authority marker, motion-guardrail static-content check)
  - Modified src/ui/shell/tabUtils.tsx — case "dashboard" now renders <PrettyLandingCard/> instead of <DashboardTab>; DashboardTab import removed
  - Modified src/ui/AppShell.tsx — the two synthetic-fallback-tab creation sites (line 185 initial useState seed + line 1187 doCloseTab fallback) now use t("nav.conversations.title", {defaultValue:"Conversations"}) as the label
affects:
  - Plan 03 (AppRail + SettingsRow + rail-view state retirement) — Plan 02 does NOT close every UI path to admin surfaces yet; Plan 03 closes the AppRail path
  - Phase 12+ deletion of src/ui/dashboard/** — the entire dashboard component tree is now unreachable from any UI path and safe to delete in a future phase (this phase leaves the files on disk per scope-fence)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline-style palette-authority (JSDOM-verifiable): warm-neutral rgba/hsla tokens live on the outer container's `style={{...}}` prop rather than in a Tailwind arbitrary-value class, so JSDOM tests can assert on `element.getAttribute('style')` without needing computed-CSS resolution (which JSDOM does not perform for CSS variables or Tailwind classes)"
    - "Landing-swap by RENDER-path substitution, not TabType-union edit: the load-bearing 'dashboard' TabType identifier is preserved in effectiveSelectedTabId + doCloseTab + hostlessTypes; only the tabUtils.tsx switch-case body swaps its JSX. Minimal-blast-radius refactor per 11-CONTEXT.md § Deletion, not gating."
    - "Baseline+delta gate on label-count edits: pre-edit `t('nav.conversations.title'` occurrences captured (=2), post-edit expected exactly +2 (=4). Confirms both sites landed AND no accidental spread beyond the two intended lines."

key-files:
  created:
    - src/ui/features/pretty-view/PrettyLandingCard.tsx
    - src/ui/features/pretty-view/PrettyLandingCard.test.tsx
    - .planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-02-SUMMARY.md
  modified:
    - src/ui/shell/tabUtils.tsx
    - src/ui/AppShell.tsx

key-decisions:
  - "Preserved LayoutDashboard import in tabUtils.tsx (line 5) because tabIcon's `case \"dashboard\"` (line 90) still consumes it. TypeScript did NOT complain about it being unused after removing the DashboardTab import — the tabIcon consumer is enough to justify the import. Plan action step 2 flagged this as conditional on tsc; tsc stayed clean, so LayoutDashboard stays."
  - "Rephrased the plan's prescribed inline comment on the swapped case block to avoid the literal string 'DashboardTab', which the plan's OWN acceptance criterion required to have 0 hits in the file. Comment intent preserved (explains the retired component tree under src/ui/dashboard/); wording adjusted. Documented as Rule 1 deviation."
  - "Test 3 palette-authority marker check uses inline `.getAttribute('style')` OR `.style.<prop>` — NOT `window.getComputedStyle`. Grep gate `getComputedStyle: 0 hits in the test file` satisfied. Removed a first-draft comment mentioning `window.getComputedStyle` because the grep would have counted the comment."

patterns-established:
  - "Inline-style palette declaration for JSDOM-testable palette-authority — new pattern usable by any future pretty-view component that needs a testable palette-authority contract."
  - "Landing-swap-by-render-substitution: the TabType union stays intact; only the tabUtils.tsx case body swaps. Downstream Plan 03 executor may follow the same pattern for any other TabType whose render should retire but whose identifier is load-bearing elsewhere."

requirements-completed: [PURGE-01, PURGE-05]

# Metrics
duration: 20min
completed: 2026-07-23
tasks_completed: 3
files_created: 2
files_modified: 2
commits_landed: 3
---

# Phase 11 Plan 02: Landing-surface swap (Skynet dashboard → PrettyLandingCard) Summary

**Swapped the desktop landing render from Skynet's `<DashboardTab>` to a new warm-glass `<PrettyLandingCard/>` inside `renderTabContent`'s `case "dashboard"` block, while preserving the `dashboard` TabType identifier as a load-bearing fallback in AppShell's state machine — delivers PURGE-01 (desktop landing = pretty-view empty card) and preserves PURGE-05 (RDP/VNC/Guacamole render paths untouched).**

## Performance

- **Duration:** ~20 min (executor wall-clock)
- **Started:** 2026-07-23T~10:00Z
- **Completed:** 2026-07-23T10:03:00Z
- **Tasks:** 3 (create component + test → swap tabUtils → rename AppShell labels)
- **Files created:** 2 source files + 1 SUMMARY
- **Files modified:** 2 source files
- **Test suite:** 525/527 passing (2 pre-existing ComposeBox baseline failures; no new failures)

## Accomplishments

**Task 1 — PrettyLandingCard component + test.** Created `src/ui/features/pretty-view/PrettyLandingCard.tsx` — a prop-less React functional component that renders a warm-glass idle card centered in its parent container. Uses inline `style={{...}}` prop for the palette-authority values (per 11-CONTEXT.md `--color-pv-*` lock) so JSDOM tests can query them without computed-CSS resolution. Visual language mirrors Phase 10's `PrettyConversationsPanel` empty-state idle glass card (lines 282-308) — the same `linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))` background, `rgba(240,235,224,0.9)` warm-cream text color, `rgba(255,220,170,0.10)` inset warm-glow highlight, and 20px backdrop-blur. No animation, no shadcn primitives, no lifecycle hooks (motion + data-fetch guardrails per Ashley's motion-quiet lock and threat-model T-11-02-03). Test file `PrettyLandingCard.test.tsx` covers all 4 behaviors from the plan's `<behavior>` block:
- Test 1: `[data-pv-landing-card="true"]` attribute present
- Test 2: outer container carries flex centering classes (`flex flex-col items-center justify-center`)
- Test 3: inner card's inline `style` attribute matches `/rgba\(240,\s*235,\s*224/` OR `/rgba\(255,\s*220,\s*170/` OR `/hsla\(/` (palette-authority marker)
- Test 4: no `animate-*`, no `aria-busy`, no animated SVGs anywhere in the rendered subtree

4/4 tests pass. Committed as `8ae9baf`.

**Task 2 — tabUtils.tsx case-body swap.** Removed the `import { DashboardTab } from "@/dashboard/DashboardTab";` line and added `import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard";` in its place. Replaced the 6-line `case "dashboard": return (<DashboardTab onOpenSingletonTab={...} onOpenTab={...}/>);` block with a prop-less `return <PrettyLandingCard/>;` (plus an explanatory comment). Preserved `case "dashboard"` in the `tabIcon` function at lines 89-90 (returning `<LayoutDashboard/>`) because the `LayoutDashboard` import is still consumed there and tsc did not complain about it being unused. RDP/VNC/Telnet cases at lines 261-263 are untouched (PURGE-05 preservation). Committed as `22b5cfb`.

**Task 3 — AppShell.tsx label rename.** Both `label: t("nav.dashboard"),` occurrences (line 185 in the initial `useState<Tab[]>` seed, line 1187 in the `doCloseTab` synthetic-fallback tab creation) replaced with `label: t("nav.conversations.title", { defaultValue: "Conversations" }),`. The `id: "dashboard"`, `instanceId: "dashboard"`, `type: "dashboard"`, and `hostlessTypes: ["dashboard", "tunnel"]` load-bearing identifiers are ALL preserved verbatim (per 11-01-STRIP-LIST.md Section A rationale + threat-model T-11-02-01 mitigation). Baseline+delta gate: pre-edit `t("nav.conversations.title"` occurrence count was 2 (sidebarTitle label lookup at line 334 + sidebarHeader consumer at line 1741); post-edit is 4 (+2 exactly). AppShell.persistence.test.tsx passes 4/4 (persistence contract unchanged). Committed as `425ba1f`.

## Task Commits

| # | SHA | Message | Files touched |
|---|-----|---------|---------------|
| 1 | 8ae9baf | `feat(11-02): add PrettyLandingCard component` | src/ui/features/pretty-view/PrettyLandingCard.tsx (created), src/ui/features/pretty-view/PrettyLandingCard.test.tsx (created) |
| 2 | 22b5cfb | `feat(11-02): swap dashboard render to PrettyLandingCard in tabUtils` | src/ui/shell/tabUtils.tsx |
| 3 | 425ba1f | `feat(11-02): rename dashboard nav labels to conversations` | src/ui/AppShell.tsx |

Three atomic commits — tsc clean between each; test suite baseline held between each.

## Files Created/Modified

**Created:**
- `src/ui/features/pretty-view/PrettyLandingCard.tsx` (77 lines) — new prop-less component
- `src/ui/features/pretty-view/PrettyLandingCard.test.tsx` (58 lines) — 4 behavior tests
- `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-02-SUMMARY.md` (this file)

**Modified:**
- `src/ui/shell/tabUtils.tsx` — 1 import line removed, 1 import line added, 6-line case body swapped for a prop-less render call + 6-line comment
- `src/ui/AppShell.tsx` — 2 lines changed (both `label: t("nav.dashboard"),` → `label: t("nav.conversations.title", { defaultValue: "Conversations" }),`)

## Decisions Made

See frontmatter `key-decisions`. Summary:

1. **LayoutDashboard import preserved in tabUtils.tsx.** The plan's action step 2 said "if tsc complains, remove it." tsc did NOT complain because `tabIcon`'s `case "dashboard"` at line 90 still uses it. Preserved.
2. **Comment wording adjusted to satisfy grep gate.** The plan's `<action>` prescribed a comment containing the literal `DashboardTab` twice, but its own `<acceptance_criteria>` required 0 hits of that string in the file. Rephrased the comment to reference "the retired component tree under src/ui/dashboard/" — same intent, satisfies the grep. Documented as Rule 1 deviation.
3. **Test 3 palette-authority marker regex uses BOTH warm-cream AND warm-glow OR hsla.** The component's inline style contains BOTH `rgba(240,235,224,...)` (text color) AND `rgba(255,220,170,...)` (inset highlight), so the regex OR check gives the test more resilience against future palette tweaks that swap one marker for another.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan self-contradiction] Comment wording in tabUtils.tsx case body.**
- **Found during:** Task 2 verification
- **Issue:** The plan's `<action>` block prescribed a comment containing the string "DashboardTab" twice ("in place of the old Skynet DashboardTab. The" and "in effectiveSelectedTabId + doCloseTab; the DashboardTab component"), but the plan's OWN `<acceptance_criteria>` required `grep -c "DashboardTab" src/ui/shell/tabUtils.tsx` to return exactly `0`. Applying the plan verbatim would have failed acceptance.
- **Fix:** Rephrased the multi-line comment to reference "the retired component tree under src/ui/dashboard/" instead of the class name. Intent preserved (explains the Phase 11 swap and the Phase 12+ deletion plan for the dashboard/ tree).
- **Files modified:** src/ui/shell/tabUtils.tsx
- **Commit:** 22b5cfb (Task 2 commit body notes this deviation)

**2. [Rule 1 - Plan self-contradiction] Test file comment about `getComputedStyle`.**
- **Found during:** Task 1 verification
- **Issue:** First-draft test file contained a comment saying "NOT window.getComputedStyle" for reader clarity, but the plan's acceptance criterion required `grep -c "getComputedStyle" src/ui/features/pretty-view/PrettyLandingCard.test.tsx` to return exactly `0`. The comment would have failed the grep.
- **Fix:** Rephrased the comment to describe the assertion approach without using the word `getComputedStyle`. Semantic intent unchanged (still explains JSDOM's CSS-variable-non-resolution limitation).
- **Files modified:** src/ui/features/pretty-view/PrettyLandingCard.test.tsx
- **Commit:** 8ae9baf (Task 1)

### Deltas from plan-text guidance (not code deviations)

- **Task 3 BEFORE_LABEL_COUNT expected value.** The plan said "Expected pre-edit value: 0 (this task is the FIRST introduction of `t(\"nav.conversations.title\"` as a `label:` value at those specific tab-creation sites)." The actual pre-edit count of `t("nav.conversations.title"` anywhere in AppShell.tsx was 2 (line 334 sidebarTitle Record + line 1741 sidebarHeader consumer). This is NOT a deviation — the plan's "0 at those specific label: lines" is correct; my baseline capture used the file-wide count. The delta gate still passed cleanly (2 → 4 = +2, exactly the two intended new label lines landed).

## Verification (plan-boundary gates)

**Toolchain:**
- `npx tsc --noEmit` — exit 0 ✓
- `npx vitest run src/ui/features/pretty-view/PrettyLandingCard.test.tsx` — 4/4 passing ✓
- `npx vitest run src/ui/AppShell.persistence.test.tsx` — 4/4 passing ✓ (persistence contract preserved)
- `npx vitest run` (full suite) — 525/527 passing; 2 failures both in `ComposeBox.test.tsx` (pre-existing baseline per `.planning/phases/10-.../deferred-items.md`; NO new failures introduced by Plan 11-02)

**Grep gates:**
- `grep -rn "DashboardTab" src/ | grep -v "src/ui/dashboard/" | grep -v "\.md$" | wc -l` → 0 ✓ (DashboardTab only lives in `src/ui/dashboard/` now — Phase 12+ deletion target)
- `grep -c "PrettyLandingCard" src/ui/shell/tabUtils.tsx` → 2 ✓ (import + JSX)
- `grep -cE '^\s*label: t\("nav\.conversations\.title"' src/ui/AppShell.tsx` → 2 ✓ (both new label lines landed)
- `grep -c 't("nav.dashboard")' src/ui/AppShell.tsx` → 0 ✓ (old label expression retired)
- `grep -c 'type: "dashboard"' src/ui/AppShell.tsx` → 2 ✓ (TabType identifier preserved at both synthetic-tab sites)

**RDP/VNC/Guacamole preservation (PURGE-05):**
- `case "rdp":`, `case "vnc":`, `case "telnet":` present at tabUtils.tsx lines 261-263 (untouched, exact line ranges verified pre- and post-edit)

**Commit sequence on `feat/tab-title-from-tmux`:**
- 8ae9baf feat(11-02): add PrettyLandingCard component
- 22b5cfb feat(11-02): swap dashboard render to PrettyLandingCard in tabUtils
- 425ba1f feat(11-02): rename dashboard nav labels to conversations

## Success Criteria (from PLAN.md)

- ✓ On desktop, a fresh page-load with no URL hash-fragment lands on the pretty-conversations sidebar (unchanged from Phase 10) with the new warm-glass empty-landing card in the main pane instead of the Skynet dashboard (PURGE-01 delivered)
- ✓ Mobile page-load renders the pretty-conversations list view (unchanged from Phase 10 — no code path in this plan touches the mobile flow)
- ✓ `<DashboardTab>` is no longer imported anywhere in `src/ui/shell/tabUtils.tsx` (nor anywhere else in `src/` outside `src/ui/dashboard/`)
- ✓ The main-pane empty-landing card uses `--color-pv-*`-adjacent warm-neutral palette tokens (`rgba(240,235,224,0.9)` warm-cream + `rgba(255,220,170,0.10)` warm-glow + backdrop-blur) per 11-CONTEXT.md palette authority
- ✓ RDP/VNC/Guacamole sessions launch and render exactly as before — `case "rdp"`/`case "vnc"`/`case "telnet"` blocks in renderTabContent untouched (PURGE-05 preserved)
- ✓ TypeScript compiles clean; existing test suite passes at the same baseline (525/527; the 2 ComposeBox failures pre-date Phase 11 per deferred-items.md; PrettyLandingCard adds 4 new tests all passing)

## Issues Encountered

**Plan self-contradictions caught inline (documented as Rule 1 deviations):**
1. The plan's `<action>` for Task 2 prescribed a comment that would have violated the plan's own `<acceptance_criteria>` grep gate on `DashboardTab`. Rephrased the comment to preserve intent while satisfying the gate.
2. Similar issue in Task 1 test-file draft with `getComputedStyle` reference. Rephrased.

Both self-contradictions are executor-level Rule 1 fixes and do not affect the phase's substantive contract. Would benefit from a planner-side lint pass in a future phase (plan-checker gate: "any string prescribed in `<action>` must not appear in a negative-grep `<acceptance_criteria>`").

**Test suite baseline shift (not a regression):**
- Deferred-items records "4 pre-existing ComposeBox failures" from Phase 10 Wave 3 baseline. Current run shows only 2 ComposeBox failures — appears something between Phase 10 Wave 3 and now fixed 2 of the 4. NO new failures introduced by Plan 11-02.

## User Setup Required

None — this is a UI-only change with no infrastructure, no new dependencies, no configuration.

## Known Stubs

None. `PrettyLandingCard` renders static "Select a conversation" copy — this is the correct terminal-state UI for the empty-landing case, not a placeholder awaiting future wiring.

## Threat Flags

None. This plan:
- Removes one component import + one JSX render call (net attack-surface reduction — the DashboardTab tree with its API-fetching cards is no longer reachable)
- Adds one static prop-less component with zero data fetching, zero external inputs, zero side effects
- Does NOT introduce any new network endpoints, auth paths, or trust boundaries

Threat-model dispositions from PLAN.md `<threat_model>` all held:
- T-11-02-01 (state-machine regression) — mitigated: `id/instanceId/type = "dashboard"` preserved verbatim; persistence test passes
- T-11-02-02 (RDP/VNC accidental strip) — mitigated: `case "rdp"/vnc/telnet` untouched, verified by grep
- T-11-02-03 (info disclosure) — accepted + reinforced: PrettyLandingCard is static, no useEffect/useState, no data fetch
- T-11-02-04 (admin route reachability during WIP state) — accepted-for-now: AppRail admin path remains reachable until Plan 03 closes it

## Next Plan Readiness

**Plan 03 (AppRail + SettingsRow + rail-view state retirement):** ready to execute. This plan's landing-swap does NOT touch:
- AppRail.tsx or its import at AppShell.tsx:20-21 or its mount at AppShell.tsx:1834-1847
- SettingsRow.tsx or its import at AppShell.tsx:83 or its mount at AppShell.tsx:1437-1441
- `settingsRowSlot` prop chain on PrettyConversationsPanel
- railView / handleRailClick / sidebarTitle / editHostInManager state machine
- The 11 sidebar-panel imports at AppShell.tsx:22-31, 59
- `openSingletonTab` / `profileDropdownOpen` (subject of Plan 03's disposition-decision trees)

Plan 03 executor: consume 11-01-STRIP-LIST.md Sections B, C, D, E as your input contract. Run Section E.2's safety-gate grep BEFORE line-234 `profileDropdownOpen` deletion. Run Section E.6's decision-tree grep BEFORE `openSingletonTab` deletion. Do NOT touch `src/ui/dashboard/**` — Phase 12+ owns that.

## Self-Check

- [x] SUMMARY.md exists at expected path
- [x] Three commits landed on `feat/tab-title-from-tmux` (verified via `git log --oneline -6`)
- [x] `src/ui/features/pretty-view/PrettyLandingCard.tsx` exists on disk (verified via `test -f`)
- [x] `src/ui/features/pretty-view/PrettyLandingCard.test.tsx` exists on disk (verified via `test -f`)
- [x] Commit 8ae9baf exists in `git log` (`git log --oneline | grep 8ae9baf`)
- [x] Commit 22b5cfb exists in `git log`
- [x] Commit 425ba1f exists in `git log`
- [x] Plan-boundary greps all pass (see Verification section)
- [x] tsc --noEmit exit 0
- [x] Full test suite: 525/527 (2 pre-existing baseline failures; no new failures)

## Self-Check: PASSED

---
*Phase: 11-skynet-transformation-purge-dead-skynet-surfaces-first-slice*
*Completed: 2026-07-23*
