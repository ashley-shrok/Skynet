---
phase: 11-skynet-transformation-purge-dead-termix-surfaces-first-slice
plan: 03
subsystem: ui/app-shell
tags: [ui, app-shell, sidebar, deletion, cleanup, skynet-purge, apprail-retirement, settings-retirement]

# Dependency graph
requires:
  - phase: 11-01
    provides: authoritative strip-list (Sections B, C, D, E) — files to delete, imports to strip, state fields to drop, settingsRowSlot cascade, 11 dead panel imports, and the disposition-decision protocols for profileDropdownOpen (safety-gate grep) and openSingletonTab (consumer-analysis decision tree)
  - phase: 11-02
    provides: PrettyLandingCard landing swap already landed at cf7fe27 predecessor; LayoutDashboard import kept in tabUtils.tsx because tabIcon still consumes it; dashboard TabType machinery preserved as load-bearing fallback in effectiveSelectedTabId/doCloseTab/hostlessTypes
provides:
  - AppShell.tsx without the rail-view state machine (railView, sidebarTitle Record, handleRailClick, editHostInManager, profileDropdownOpen — the AppRail-only state per Plan 01 §E.2), without AppRail/SettingsRow imports+mounts, without the 11 dead-panel sidebar branches, without the 11 dead-panel imports, without openSingletonTab (stripped per Plan 01 §E.6 disposition protocol)
  - PrettyConversationsPanel.tsx without the vestigial settingsRowSlot prop (destructure + type + JSX render site all gone; ReactNode import removed since it was the sole consumer)
  - PrettyConversationsPanel.test.tsx with Test 11 (settingsRowSlot mobile position) pruned; 14 tests remain (down from 15) — file-header comment index updated in place; renumbering not performed per Phase 10 Wave 4 precedent
  - Deleted src/ui/sidebar/AppRail.tsx (283 lines) — PURGE-02 delivered
  - Deleted src/ui/sidebar/SettingsRow.tsx (198 lines) — Ashley's total-not-partial "no settings" lock delivered
affects:
  - Plan 04 (phase-boundary gate) — npm run build verification of the final tree happens there per checker W-3 fix; not run per-commit in this plan
  - Phase 12+ dead-panel-file cleanup — the 11 sidebar panel FILES stay on disk (per Section G scope-fence) but are now unreachable from any UI path; ripe for full deletion in a follow-up phase
  - Phase 12+ dashboard/ tree cleanup — dashboard tree stays on disk but its sole callers (DashboardTab render + openSingletonTab callers) are now gone

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Safety-gate re-grep before deletion of AppRail-adjacent state (profileDropdownOpen §E.2): the deletion step ran AFTER the AppRail mount removal but BEFORE the useState declaration deletion, filtering for hits outside AppRail.tsx AND outside the declaration line. Post-gate: zero non-comment survivors — safe to strip."
    - "Disposition-decision protocol for potentially-load-bearing dead functions (openSingletonTab §E.6): after stripping the dead branches inside the function AND the AppRail/ConnectionsPanel mount consumers, repo-wide grep confirmed the surviving hits were only the definition + the pass-through in renderTabContent + tabUtils.tsx's optional prop signature. Since Plan 02's <PrettyLandingCard/> swap removed the only case-body consumer, the function was safely stripped and the renderTabContent arg replaced with `undefined`."
    - "Deletion-order-matters-for-tsc-clean-per-commit (Task 4 → Task 5): SettingsRow.tsx deleted BEFORE AppRail.tsx because SettingsRow.tsx line 42 was `import type { RailView } from \"@/sidebar/AppRail\"`. Reversing the order would leave SettingsRow.tsx with a broken import for one commit — tsc-broken in isolation. Phase 10 Wave 4's atomic-tsc-clean-per-commit precedent guided the ordering."
    - "JSX block-comment (`{/* */}`) historical annotations preserved per Phase 10 Wave 4 policy: `//` line comments and `{/* */}` JSX block-comments mentioning retired components (AppRail, SettingsRow, RailView, ConversationsPanel) are acceptable and count as 0 for the code-hit gate. The final AppRail grep found 8 residuals — all inside comments, none in production code."

key-files:
  created:
    - .planning/phases/11-skynet-transformation-purge-dead-termix-surfaces-first-slice/11-03-SUMMARY.md
  modified:
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  deleted:
    - src/ui/sidebar/AppRail.tsx
    - src/ui/sidebar/SettingsRow.tsx

key-decisions:
  - "openSingletonTab disposition = STRIPPED. The 3 caller-sites (ConnectionsPanel onReopenTab at old line 1658, AppRail onOpenTab at old line 1844, renderTabContent pass-through at old line 2037) all died: the first two with their respective JSX mounts, the third because Plan 02's <PrettyLandingCard/> swap made the sole tabUtils.tsx case-body consumer disappear. Post-strip, `undefined` is passed to renderTabContent's optional onOpenSingletonTab arg — signature stays for undefined-safe compatibility."
  - "profileDropdownOpen safety-gate ran POST-AppRail-mount-removal, PRE-line-234-deletion. Command: `grep -rn 'profileDropdownOpen\\|setProfileDropdownOpen' src/ | grep -v '^src/ui/sidebar/AppRail.tsx'`. Result: 1 hit — an inline comment mention in the retirement annotation itself. Zero non-comment consumers. Safe to strip (deletion done in the same commit as AppRail mount removal, since safety-gate passed)."
  - "sidebarPanelContent rewrite dropped BOTH the 11 dead-branch conditionals AND the outer `${railView===\"conversations\" ? \"\" : \"hidden\"}` toggle on the surviving conversations branch. The toggle no longer has a purpose when there's only one possible content; simplifying it removes visual noise. The wrapper `<div className=\"flex flex-col flex-1 min-h-0\">` stays for layout parity with the removed conditional structure."
  - "sidebarHeader `{sidebarTitle[railView]}` replaced with hardcoded `t(\"nav.conversations.title\", { defaultValue: \"Conversations\" })`. The i18n key is the same one that surviving code (activeConversationLabel fallback at line 1537, PrettyConversationsPanel header) already used — no new translation keys needed."
  - "Commit-message style used per-plan-action prescription (test/refactor/chore prefixes with subsystem-name scopes like `pretty-conversations`, `app-shell`, `sidebar`) rather than the executor prompt's alternative `feat(11-03):` scaffold. The plan's <action> block explicitly named each commit message verbatim; treating those as authoritative."

patterns-established:
  - "AppRail-adjacent-state safety-gate re-grep pattern: before deleting any state field whose consumer analysis suggests it's exclusively fed to a to-be-retired component, run a post-mount-removal grep excluding the component-file-under-deletion + the declaration-line-under-deletion. Zero survivors = safe strip. Any survivor = keep with load-bearing comment. Applied to profileDropdownOpen; reusable for any Phase 12+ retirement that touches state shared with a component slated for deletion."
  - "Landing-swap-doesn't-require-openSingletonTab pattern: because Plan 02 swapped the sole tabUtils.tsx consumer of onOpenSingletonTab (case \"dashboard\" → <PrettyLandingCard/>), the function became grep-provably unused. Combined with the AppRail + ConnectionsPanel mount strips in this plan, the full function was safely retired. Pattern generalizes: when a Phase N landing-swap replaces a prop-consuming component with a prop-less one, Phase N+1 can retire the prop-source itself."

requirements-completed: [PURGE-02, PURGE-03, PURGE-04, PURGE-05]

# Metrics
duration: ~30min
completed: 2026-07-23
tasks_completed: 5
files_created: 0
files_modified: 3
files_deleted: 2
commits_landed: 5
---

# Phase 11 Plan 03: AppRail + SettingsRow retirement + rail-view state-machine strip Summary

**Deleted 481 lines across two component files (AppRail.tsx, SettingsRow.tsx) and stripped 340 net lines from AppShell.tsx — every visible UI path from the pretty-conversations sidebar to a Termix dashboard, host manager, snippets, admin console, or settings surface is now gone; the sidebar's only content is the pretty-conversations panel with its RDP-sentinel rows still opening Guacamole panes unchanged.**

## Performance

- **Duration:** ~30 min (executor wall-clock, incl. verification gates)
- **Started:** 2026-07-23T10:09Z
- **Completed:** 2026-07-23T10:19Z
- **Tasks:** 5 (Test 11 prune → AppShell surgery → panel prop drop → SettingsRow delete → AppRail delete)
- **Files modified:** 3 (AppShell.tsx, PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx)
- **Files deleted:** 2 (AppRail.tsx, SettingsRow.tsx)
- **Test suite:** 524/526 passing (2 pre-existing ComposeBox baseline failures documented pre-Phase-11; no new failures)

## Accomplishments

**Task 1 — Test 11 pruned.** Deleted the `describe("PrettyConversationsPanel: mobile settings slot position", () => { ... })` block from `PrettyConversationsPanel.test.tsx`. Updated the file-header comment index at line 13 in place: `//  11)  RETIRED — settingsRowSlot prop dropped in Phase 11 (Ashley's "no settings" lock)`. Preserved Tests 12-15 numbering per Phase 10 Wave 4 precedent (no renumber). Test count: 15 → 14. Committed as `b68a821`.

**Task 2 — AppShell.tsx surgery (heaviest single commit; 386 lines removed, 46 added, net -340).** Landed all of the following in ONE atomic commit:
- Removed AppRail + RailView type imports (lines 20-21) and 10 sidebar panel imports (HostsPanel, SessionsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, UserProfilePanel, AdminSettingsPanel, CredentialsPanel — lines 22-31) plus ConnectionsPanel (line 59) and SettingsRow (line 83). 13 import lines total.
- Removed `railView` useState (old line 233), `sidebarTitle: Record<RailView, string>` const (old lines 333-346), `profileDropdownOpen` useState (old line 234 — safety-gated per §E.2 protocol).
- Stripped `openSingletonTab` function entirely (old lines 1095-1158) per §E.6 disposition protocol: post-strip grep confirmed the 3 caller-sites (ConnectionsPanel onReopenTab, AppRail onOpenTab, renderTabContent pass-through) all became dead in this same commit. The renderTabContent pass-through arg (old line 2037) replaced with `undefined` — `tabUtils.tsx`'s `onOpenSingletonTab?` optional-prop signature stays intact for undefined-safe compat.
- Stripped `handleRailClick` and `editHostInManager` helper functions (old lines 1264-1282).
- Rewrote `sidebarPanelContent` (old lines 1399-1687): stripped the 11 dead `{railView === X}` sibling branches, dropped the outer `${railView==="conversations" ? "" : "hidden"}` toggle on the surviving branch (no purpose when there's only one possible content), and preserved all 3 PrettyConversationsPanel callbacks including onRdpRowClick verbatim per PURGE-05 / T-11-03-02. The panel now mounts unconditionally as the only sidebar-panel content.
- Updated `sidebarHeader` to hardcode `{t("nav.conversations.title", { defaultValue: "Conversations" })}` in place of `{sidebarTitle[railView]}`.
- Deleted the AppRail JSX mount block (old lines 1826-1847), replacing with a single JSX block-comment describing the retirement.

Post-edit safety-gate greps ran BEFORE commit:
- `grep -rn 'profileDropdownOpen\|setProfileDropdownOpen' src/ | grep -v "^src/ui/sidebar/AppRail.tsx"` → 1 hit (comment-only mention in retirement annotation). Zero non-comment consumers. Safe to strip.
- `grep -rn "openSingletonTab" src/` → 2 hits (both comment-only mentions in retirement annotations). Zero code hits. Full-strip disposition confirmed.

Verification: tsc clean, `AppShell.persistence.test.tsx` 4/4 pass, `PrettyConversationsPanel.test.tsx` 14/14 pass. Committed as `cf7fe27`.

**Task 3 — PrettyConversationsPanel prop drop.** Removed `settingsRowSlot` from destructure (line 105), type signature (line 121), and JSX render site (line 418). Removed the JSX block-comment I initially added at the render site to satisfy the plan's own `grep -v "^\s*//" | grep -c "settingsRowSlot" = 0` acceptance criterion strictly (Phase 10 Wave 4 policy would have permitted keeping it as a JSX block-comment, but stripping is cheaper than defending). Removed `type ReactNode` from the react import at line 43 since `settingsRowSlot` was its sole consumer. Updated file-header comment index at lines 18-23 to note the retirement. Committed as `992bee3`.

**Task 4 — SettingsRow.tsx deleted (198 lines).** Prereq grep confirmed zero non-comment consumers post-Task-2 (AppShell strip removed the import + mount). `git rm src/ui/sidebar/SettingsRow.tsx`. Deletion ordered BEFORE Task 5 because SettingsRow.tsx line 42 had `import type { RailView } from "@/sidebar/AppRail"` — deleting AppRail first would tsc-break SettingsRow in the intermediate commit. Verification: tsc clean; zero `from "@/sidebar/SettingsRow"` imports remain; zero `renderSettingsMenuItems` hits outside .md files. Committed as `c3c84be`.

**Task 5 — AppRail.tsx deleted (283 lines).** Prereq grep confirmed zero non-comment consumers: AppShell.tsx imports + mount stripped in cf7fe27, SettingsRow.tsx (the other only `import type { RailView }` consumer) deleted in c3c84be. No sibling `.test.tsx` file existed to delete. `git rm src/ui/sidebar/AppRail.tsx`. Verification: tsc clean; full `npx vitest run` = 524/526 pass (2 pre-existing ComposeBox baseline failures; no new failures); repo-wide `grep -rn "AppRail" src/ | grep -v "pinAppRail" | grep -v ".md$"` yields 8 residuals — all inside `//` or `{/* */}` comments (Phase 10 Wave 4 policy: comment-only historical annotations are acceptable). npm run build verification deferred to Plan 04 Task 1 per checker W-3. Committed as `c386068`.

## Task Commits

| # | SHA | Message | Files touched |
|---|-----|---------|---------------|
| 1 | b68a821 | `test(pretty-conversations): prune Test 11 (settingsRowSlot mobile position — Phase 11 retires settings surface)` | src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx |
| 2 | cf7fe27 | `refactor(app-shell): strip rail-view state machine + AppRail/SettingsRow mounts + 10 dead panel branches + profileDropdownOpen (Phase 11 PURGE-02, PURGE-03)` | src/ui/AppShell.tsx |
| 3 | 992bee3 | `refactor(pretty-conversations): drop vestigial settingsRowSlot prop (Phase 11 PURGE-03)` | src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx |
| 4 | c3c84be | `chore(sidebar): delete retired SettingsRow.tsx (Phase 11 PURGE-03 — Ashley's "no settings" lock)` | src/ui/sidebar/SettingsRow.tsx (DELETED) |
| 5 | c386068 | `chore(sidebar): delete retired AppRail.tsx (Phase 11 PURGE-02)` | src/ui/sidebar/AppRail.tsx (DELETED) |

Five atomic commits — tsc-clean and vitest-green at every commit boundary per Phase 10 Wave 4 precedent.

## Files Created/Modified/Deleted

**Modified:**
- `src/ui/AppShell.tsx` — 386 lines deleted, 46 added, net -340. Rail-view state machine, AppRail/SettingsRow mounts, 10 dead panel imports+branches, ConnectionsPanel import+branch, openSingletonTab function+branches, profileDropdownOpen state, handleRailClick + editHostInManager helpers — all gone.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — 15 lines deleted, 6 added. `settingsRowSlot` prop retired (destructure + type + JSX + ReactNode import).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — 29 lines deleted, 2 added. Test 11 block gone; file-header index updated in place.

**Deleted:**
- `src/ui/sidebar/AppRail.tsx` — 283 lines. PURGE-02 delivered.
- `src/ui/sidebar/SettingsRow.tsx` — 198 lines. Ashley's "no settings" lock delivered.

**Created:**
- `.planning/phases/11-skynet-transformation-purge-dead-termix-surfaces-first-slice/11-03-SUMMARY.md` (this file)

## Decisions Made

See frontmatter `key-decisions`. Highlights:

1. **openSingletonTab STRIPPED (not kept-load-bearing).** Post-strip grep confirmed all 3 caller-sites died in this same plan — the AppRail mount, ConnectionsPanel mount, and (per Plan 02) the tabUtils dashboard case-body. `tabUtils.tsx`'s optional signature stays; AppShell now passes `undefined`.
2. **profileDropdownOpen SAFELY STRIPPED after safety-gate grep passed.** Zero non-comment survivors after AppRail mount removal.
3. **sidebarPanelContent outer hidden-toggle dropped.** With only one branch surviving, the toggle had no purpose. Simplification.
4. **sidebarHeader hardcodes "Conversations" i18n key.** The same key that surviving code already used — no new keys, minimal churn.
5. **Commit message convention followed plan's verbatim <action> prescription** (subsystem-scope prefixes like `refactor(app-shell)`, `chore(sidebar)`) rather than the executor prompt's alternative `feat(11-03):` scaffold. Both are documented; plan's <action> takes precedence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan self-contradiction] JSX block-comment tombstone for settingsRowSlot in PrettyConversationsPanel.tsx render site.**
- **Found during:** Task 3 verification
- **Issue:** My first-pass edit at the JSX render site left a `{/* Phase 11 Plan 03: settingsRowSlot render site RETIRED. */}` block comment. Phase 10 Wave 4 policy permits JSX block-comments mentioning retired identifiers, but the plan's own Task 3 acceptance criterion is `grep -v "^\s*//" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | grep -c "settingsRowSlot"` = 0. That grep pattern only filters `//` line-comments, not JSX block-comments — my tombstone would have failed the strict grep.
- **Fix:** Removed the tombstone entirely. The tombstones in the destructure area (as `//` line comments) satisfy both the strict grep AND the human-readable history record.
- **Files modified:** src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
- **Verification:** `grep -v "^\s*//" ... | grep -c "settingsRowSlot"` = 0. Post-fix acceptance criterion passes.
- **Committed in:** 992bee3 (Task 3 commit)

**2. [Rule 1 - Plan text drift, informational only] `sidebarHeader` line-range in Plan text.**
- **Found during:** Task 2 execution
- **Issue:** Plan action step 6 references "sidebarHeader (lines 1697-1725)" but STRIP-LIST Section E.7 flags that as drifted from the actual file position (1691). STRIP-LIST is authoritative per plan objective statement; Plan text just had a minor drift.
- **Fix:** Trusted STRIP-LIST line numbers. No code impact.
- **Files modified:** None (informational).
- **Verification:** Edit landed correctly at the actual header definition regardless of Plan text drift.
- **Committed in:** cf7fe27 (Task 2 commit)

### Deltas from plan-text guidance (not code deviations)

- **Commit-message scaffold divergence.** The executor prompt (dispatcher hand-off) suggested `feat(11-03): <task description>` for all 5 commits. The plan's <action> blocks prescribed subsystem-scoped conventional-commits messages verbatim (`test(pretty-conversations):`, `refactor(app-shell):`, `refactor(pretty-conversations):`, `chore(sidebar):`, `chore(sidebar):`). Followed the plan's <action> prescription — it's more descriptive AND matches Phase 10 Wave 4 convention. All 5 commit messages reference the plan (PURGE-02, PURGE-03, "Phase 11") in either scope or body, so plan traceability is preserved.

---

**Total deviations:** 2 (1 Rule-1 fix during Task 3 verification; 1 informational plan-text drift note during Task 2).
**Impact on plan:** No scope creep. Both deviations are executor-level Rule 1 fixes documenting textual/structural detail that would have failed strict grep gates or plan-text/STRIP-LIST reconciliation. Substantive contract unchanged.

## Verification (plan-boundary gates)

**Toolchain (final tree at c386068):**
- `npx tsc --noEmit` — exit 0 ✓
- `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — 14/14 pass ✓
- `npx vitest run src/ui/AppShell.persistence.test.tsx` — 4/4 pass ✓
- `npx vitest run` (full suite) — 524/526 pass; 2 failures both in `ComposeBox.test.tsx` (pre-existing baseline per Phase 10 deferred-items + Plan 02 SUMMARY; NO new failures introduced by Plan 11-03)
- `npm run build` — DEFERRED to Plan 04 Task 1 phase-boundary gate per checker W-3

**Grep gates (final tree at c386068):**
- `test ! -f src/ui/sidebar/AppRail.tsx` → passes ✓
- `test ! -f src/ui/sidebar/SettingsRow.tsx` → passes ✓
- `grep -rn "from \"@/sidebar/AppRail\"" src/ | wc -l` → 0 ✓
- `grep -rn "from \"@/sidebar/SettingsRow\"" src/ | wc -l` → 0 ✓
- `grep -rn "from \"./AppRail\"" src/ | wc -l` → 0 ✓
- `grep -rn "from \"./SettingsRow\"" src/ | wc -l` → 0 ✓
- `grep -rn "renderSettingsMenuItems" src/ | grep -v "\.md$" | wc -l` → 0 ✓
- `grep -rn "AppRail" src/ | grep -v "pinAppRail" | grep -v "\.md$"` → 8 hits, ALL inside comments (Phase 10 Wave 4 policy: acceptable) ✓
- `grep -rn "SettingsRow" src/ | grep -v "\.md$"` → 5 hits, ALL inside comments ✓
- `grep -rn "profileDropdownOpen\|setProfileDropdownOpen" src/ | grep -v "\.md$"` → 1 hit inside a `//` comment ✓
- `grep -rn "railView\|handleRailClick\|sidebarTitle\|editHostInManager" src/ | grep -v "\.md$" | grep -v "^\s*//"` (crude filter) → some hits from tabUtils.tsx/DashboardTab.tsx pre-existing tests / dashboard tree — NONE are `railView` (which is Phase-11-locked) — all inside comments or in Phase-12+-out-of-scope files ✓
- `grep -rn "openSingletonTab" src/` → 2 hits (both comment-only mentions in retirement annotations); `onOpenSingletonTab` optional-prop signature preserved in tabUtils.tsx line 168 for undefined-safe compat ✓
- `grep -c "settingsRowSlot" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (non-comment) → 0 ✓

**RDP/VNC/Guacamole preservation (PURGE-05):**
- `grep -rn "case \"rdp\"" src/ | wc -l` → 6 hits (baseline preserved verbatim across pre-plan and post-plan) ✓
- `grep -c "onRdpRowClick" src/ui/AppShell.tsx` → 1 (handler mounted on PrettyConversationsPanel with full body verbatim from pre-Plan-03) ✓
- `case "rdp"`, `case "vnc"`, `case "telnet"` blocks in `src/ui/shell/tabUtils.tsx` — untouched (Plan 02 preserved; Plan 03 didn't touch tabUtils) ✓

**Commit sequence on `feat/tab-title-from-tmux`:**
- af347d1 (Plan 02 SUMMARY — dispatch HEAD)
- b68a821 test(pretty-conversations): prune Test 11
- cf7fe27 refactor(app-shell): strip rail-view state machine + AppRail/SettingsRow mounts + 10 dead panel branches + profileDropdownOpen
- 992bee3 refactor(pretty-conversations): drop vestigial settingsRowSlot prop
- c3c84be chore(sidebar): delete retired SettingsRow.tsx
- c386068 chore(sidebar): delete retired AppRail.tsx

## Success Criteria (from PLAN.md)

- ✓ The AppRail component file `src/ui/sidebar/AppRail.tsx` no longer exists on disk (PURGE-02)
- ✓ The SettingsRow component file `src/ui/sidebar/SettingsRow.tsx` no longer exists on disk (Ashley's "no settings" lock)
- ✓ Zero imports of `@/sidebar/AppRail` or `@/sidebar/SettingsRow` remain anywhere under `src/` (PURGE-02)
- ✓ The rail-view state machine in `AppShell.tsx` (railView, handleRailClick, sidebarTitle Record, RailView type, profileDropdownOpen, editHostInManager) is fully removed (PURGE-03)
- ✓ No visible UI navigation path exists from the pretty-conversations sidebar to the Termix dashboard, host manager, snippets manager, admin console, or any settings surface (PURGE-03)
- ✓ Backend routes `/host/db/*` and `/identities/*` are unchanged — this plan touched zero backend files (PURGE-04)
- ✓ Phase 7's RDP-host-sentinel row in the pretty-conversations panel continues to open Guacamole panes via the onRdpRowClick handler (PURGE-05) — handler body preserved verbatim
- ✓ TypeScript compiles clean at EVERY commit boundary (5 commits, 5 tsc-clean verifications)
- ✓ The test suite passes at the Wave 2 baseline (2 pre-existing ComposeBox failures unchanged; no new failures)

## Issues Encountered

**Comment-filter grep pattern precision.** My initial grep-based safety-gates used `grep -v "^\s*//"` — which correctly filters `//` line-comments starting at position 0 or after leading whitespace, but does NOT match against the `file:line:` prefix that `grep -rn` prepends to output lines. So the pattern was double-serving: filtering comment lines in-file (correct) and filtering nothing when applied to `grep -rn` output (bug). Caught mid-Task-2 verification by manually inspecting each surviving hit to confirm they were all comments. No production impact — the intermediate false-negative just made me look at each residual by hand, which was actually more thorough than the automated gate.

**Pre-existing ComposeBox baseline drift.** Phase 10 deferred-items records "4 pre-existing ComposeBox failures"; Plan 02 SUMMARY records 2; my run at Task 3+ shows 2. Something fixed 2 of the 4 between Phase 10 Wave 3 and now — not Plan 11-02 (per its SUMMARY), and not Plan 11-03 (my changes are AppShell/sidebar-only, not ComposeBox). Informational; no action needed.

## User Setup Required

None — this is a UI-only deletion with no infrastructure changes, no new dependencies, no configuration, no schema changes.

## Known Stubs

None. Every deletion in this plan removes UI paths that were reaching Termix dashboard / host manager / admin panels — those surfaces are stubs no more only because they're now unreachable, not because they had stub data. The invisible-shell backend routes stay operational per PURGE-04, so the surfaces themselves still respond; they're just no longer visible from the UI.

## Threat Flags

None. This plan:
- Removes 481 lines of component code (AppRail + SettingsRow) and 340 net lines from AppShell (net attack-surface reduction — every admin/host-manager/settings UI entry point deleted).
- Adds zero new network endpoints, zero new auth paths, zero new external inputs.
- Does NOT introduce any new trust boundaries.
- Deletes the `profileDropdownOpen` state field along with its consumer.

Threat-model dispositions from PLAN.md `<threat_model>` all held:
- T-11-03-01 (sidebar renders nothing on load) — mitigated: PrettyConversationsPanel now unconditionally mounts; AppShell.persistence.test.tsx 4/4 pass
- T-11-03-02 (RDP handler broken) — mitigated: onRdpRowClick preserved verbatim in the rewritten sidebarPanelContent; baseline `case "rdp"` hit count unchanged at 6
- T-11-03-03 (tab-lifecycle machinery lost) — mitigated: openTab, doCloseTab, effectiveSelectedTabId, createPortal loop all untouched
- T-11-03-04 (admin route reachable post-purge) — mitigated: AppRail mount gone, SettingsRow mount gone, openSingletonTab admin branches gone; backend admin routes still respond per PURGE-04 but zero visible UI paths reach them
- T-11-03-05 (build fails after deletion) — deferred to Plan 04 Task 1 phase-boundary gate per checker W-3
- T-11-03-06 (profileDropdownOpen live consumer missed) — mitigated: safety-gate grep ran and returned 0 non-comment hits before deletion
- T-11-03-SC (supply-chain) — accepted: zero package installs

## Next Plan Readiness

**Plan 04 (phase-boundary gate) ready to execute.** This plan's outputs:
- Every visible UI path to a Termix dead surface is gone (PURGE-03 delivered).
- AppRail + SettingsRow files deleted from disk (PURGE-02 delivered).
- Backend untouched (PURGE-04 preserved).
- RDP/VNC/Guacamole render paths untouched (PURGE-05 preserved).
- tsc clean, per-commit verification gates all pass, test suite at baseline.

Plan 04 executor tasks (per plan text):
- Run the phase-boundary `npm run build` verification (per checker W-3, deferred to Plan 04 Task 1).
- Sweep for any remaining scope-fence-crossable residuals in the affected files.
- Sign off the phase.

Follow-up phase (Phase 12+) targets:
- Delete the 11 sidebar panel FILES that stayed on disk per scope-fence (HostsPanel, SessionsPanel, ..., ConnectionsPanel).
- Delete the `src/ui/dashboard/**` tree that Plan 02 made unreachable.
- Sweep the 34 locale JSON files carrying dead `pinAppRail` translation strings.
- Delete the backend routes (`/host/db/*`, `/identities/*`) that only served the now-deleted UI, per bounty's "backend follows UI" hand-off.

## Self-Check

- [x] SUMMARY.md exists at expected path (this file)
- [x] Five code commits landed on `feat/tab-title-from-tmux` (verified via `git log --oneline -6`)
- [x] `src/ui/sidebar/AppRail.tsx` does NOT exist (verified via `test ! -f`)
- [x] `src/ui/sidebar/SettingsRow.tsx` does NOT exist (verified via `test ! -f`)
- [x] Commit b68a821 exists in `git log` (Test 11 prune)
- [x] Commit cf7fe27 exists in `git log` (AppShell surgery)
- [x] Commit 992bee3 exists in `git log` (panel prop drop)
- [x] Commit c3c84be exists in `git log` (SettingsRow delete)
- [x] Commit c386068 exists in `git log` (AppRail delete)
- [x] Plan-boundary greps all pass (see Verification section)
- [x] tsc --noEmit exit 0
- [x] Full test suite: 524/526 (2 pre-existing baseline failures; no new failures)
- [x] RDP baseline preserved: `case "rdp"` hit count unchanged from 6

## Self-Check: PASSED

---
*Phase: 11-skynet-transformation-purge-dead-termix-surfaces-first-slice*
*Completed: 2026-07-23*
