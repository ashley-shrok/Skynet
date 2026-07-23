# Phase 11 Build-Verify Log

**Date:** 2026-07-23
**Branch:** feat/tab-title-from-tmux (post Plan 03 code-complete + Plan 04 verification pass)
**HEAD at verification:** `cbff367` (docs(11-03): summary — AppRail + SettingsRow retirement + rail-view state-machine strip complete)
**Verifier:** Claude (Plan 04 Task 1 automation — phase-boundary owner of `npm run build` per checker W-3 fix)
**Verdict:** **PASS**

Plan 04 of Phase 11 (Skynet transformation — purge dead Termix surfaces, first slice). All three verification commands run cleanly, with only the two pre-existing ComposeBox failures inherited from Phase 10 baseline surviving from earlier phases — those two remain out of Phase 11 scope per Phase 10 `deferred-items.md`.

**Scope:** local verification only. No `docker build`, no `docker compose up`, no push, no deploy. Deploy is deferred to Ashley's greenlight on the batched Phase 11 + Phase 12+ purge cluster per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23) — full deploy runbook citation lives in `11-UAT-CHECKLIST.md`.

---

## Section 1: `npx tsc --noEmit`

```
$ npx tsc --noEmit
$ echo $?
0
```

**Result:** clean — zero errors, zero diagnostics.

**Analysis:** No diagnostics emitted. All Phase 11 additions (`src/ui/features/pretty-view/PrettyLandingCard.tsx` + its test), all Phase 11 modifications (`src/ui/AppShell.tsx` heavy surgery, `src/ui/shell/tabUtils.tsx` case-body swap, `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` prop drop, `PrettyConversationsPanel.test.tsx` Test 11 prune), and both Phase 11 deletions (`src/ui/sidebar/AppRail.tsx` + `src/ui/sidebar/SettingsRow.tsx`) type-check clean against the Phase 6-locked `ConversationRow` / `HostGroup` shapes and the Phase 10-locked `PrettyConversationsPanel` prop shape.

**Comparison to baselines:**

| Baseline | tsc status | Notes |
|---|---|---|
| Phase 10 tip (`ebf0c43`) | Exit 0 | Per `10-BUILD-VERIFY-LOG.md` |
| Phase 11 Wave 2 (`425ba1f` — post Plan 02) | Exit 0 | Per `11-02-SUMMARY.md` (§ Verification) |
| Phase 11 Wave 3 (`cbff367` — post Plan 03) | Exit 0 | Per `11-03-SUMMARY.md` (§ Verification, 5 per-commit tsc-clean gates) |
| Phase 11 Wave 4 (this log, HEAD `cbff367`) | Exit 0 | This verification |

Every commit boundary tsc-clean, verified at Plan 02's 3 per-commit gates, Plan 03's 5 per-commit gates, and now the phase-boundary re-verification.

---

## Section 2: `npx vitest run`

```
Test Files  1 failed | 42 passed (43)
     Tests  2 failed | 524 passed (526)
  Start at  10:24:34
  Duration  62.86s (transform 3.88s, setup 936ms, import 16.07s, tests 6.87s, environment 28.75s)
```

**Result:** **524 / 526 passing** (99.6%). 2 failures, both in `src/ui/features/pretty-view/ComposeBox.test.tsx`.

### Failing tests (both pre-existing baseline)

| # | Test | File | Root cause | Owning patch |
|---|---|---|---|---|
| 1 | `ComposeBox — Phase 9 layout > Phase 9 Layout: aux button group renders in a row that precedes the Send button's row` | `src/ui/features/pretty-view/ComposeBox.test.tsx` | `getByLabelText(/send 'yes'/i)` returns null — the aria-label was renamed by patch #124 (ThumbsUp "yes"→"let's go"); the test uses ThumbsUp as an anchor to locate the row-1 flex container | patches #121 + #124 test-fixture drift |
| 2 | `ComposeBox — Phase 9 layout > Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false` | `src/ui/features/pretty-view/ComposeBox.test.tsx` | Same `getByLabelText(/send 'yes'/i)` anchor pattern; same double-cause | patches #121 + #124 test-fixture drift |

### Inherited-baseline annotation

**The 2 pre-existing ComposeBox failures are INHERITED BASELINE from Phase 10 (originally 4 failures per `.planning/phases/10-pretty-conversations-visual-language-rework/deferred-items.md`, then dropped to 2 sometime between Phase 10 Wave 3 and Phase 11 Plan 02 per `11-02-SUMMARY.md` § "Test suite baseline shift"). Phase 11 introduces ZERO net-new regressions.** These 2 failures are the ONLY failures in the suite. They are test-only fixture drift — the underlying ComposeBox component works in production (confirmed via patch #125 UAT + patch #129/#130/#135 in-flight UAT).

### Delta from prior waves

| Snapshot | Passing/Total | Delta reason |
|---|---:|---|
| Phase 10 Wave 5 tip (`ebf0c43`) | 499/503 | Phase 10 baseline (4 ComposeBox failures at that time) |
| Between Phase 10 tip and Phase 11 Plan 02 | (2 ComposeBox failures fixed by unrelated in-flight patch — likely #129 or #130 which touched ComposeBox aria-labels and geometry) | Not a Phase 11 change; not documented per Plan 02 SUMMARY note |
| Phase 11 Wave 1 (Plan 02, `425ba1f`) | 525/527 | +26 tests: +4 PrettyLandingCard tests (Plan 02 Task 1). Fixed ComposeBox count means from Plan 02's perspective +4/+4 net. |
| Phase 11 Wave 3 (Plan 03, `cbff367`) | 524/526 | −1 test: Test 11 (settingsRowSlot mobile position) pruned per Plan 03 Task 1 |
| Phase 11 Wave 4 (this log) | 524/526 | No change — Plan 04 is docs-only |

Test 11 (settingsRowSlot mobile position) has been PRUNED as expected per Plan 03 Task 1 (the settingsRowSlot prop retirement). Not "skipped" — the whole describe block is gone; the file-header comment index at line 13 of `PrettyConversationsPanel.test.tsx` was updated in place: `//  11)  RETIRED — settingsRowSlot prop dropped in Phase 11 (Ashley's "no settings" lock)`.

**Net Phase 11 delta:** +4 PrettyLandingCard tests (Plan 02) − 1 Test 11 prune (Plan 03) = **+3 tests, +3 passing**. Full-suite total moved from 499/503 (Phase 10 tip, 4 ComposeBox failures) → 524/526 (Phase 11 Plan 04, 2 ComposeBox failures) = +25/+23 (+3 net-new from Phase 11 + 2 pre-Phase-11 ComposeBox fixes that happened between phases + 20 tests from the intervening in-flight patches #129–#137). The +3 net-new-from-Phase-11 delta is exactly what Plan 04's expected-delta computation predicted.

**New failure check:** If any NEW test failure appeared beyond the 2 inherited ComposeBox failures, Plan 04 would FLAG it and NOT close as PASS. None appeared. The suite is at its expected baseline.

---

## Section 3: `npm run build` (phase-boundary gate per checker W-3 fix on Plan 03)

```
$ rm -rf dist && npm run build
...
dist/assets/AppShell-xt78nb9e.js                                     75.43 kB │ gzip:  20.49 kB
dist/assets/Terminal-CWbYL1VB.js                                    145.22 kB │ gzip:  39.28 kB
dist/assets/index-Tns5kMac.js                                       320.61 kB │ gzip:  99.30 kB
dist/assets/file-preview-vendor-BiN9N__o.js                       1,263.62 kB │ gzip: 414.19 kB
dist/assets/codemirror-DmmvekjV.js                                1,608.47 kB │ gzip: 568.29 kB

[plugin builtin:vite-reporter]
(!) Some chunks are larger than 1000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 10.94s
$ echo $?
0
```

**Result:** **success** — Vite built cleanly in **10.94s**, exit 0, no errors, no TypeScript diagnostics. Warnings are pre-existing informational (large vendor chunks: `file-preview-vendor` 1.26 MB, `codemirror` 1.61 MB — identical to Phase 6/7/8/9/10 baselines; those are the CodeMirror IDE dependency + file-preview vendor bundle used by the file-manager panel, unrelated to Phase 11 scope).

### Bundle size deltas — the SIGNIFICANT reduction claim (Plan 04 Task 1 gate)

| Bundle | Phase 11 Plan 04 (this log) | Phase 10 tip (10-BUILD-VERIFY-LOG) | Delta from Phase 10 tip |
|---|---:|---:|---:|
| `AppShell-xt78nb9e.js` | **75.43 kB** (77,239 bytes) | 448.82 kB (459,594 bytes) | **−373.39 kB / −382,355 bytes / −83.2%** |
| `AppShell` gzip | **20.49 kB** | 87.63 kB | **−67.14 kB / −76.6%** |
| `Terminal-CWbYL1VB.js` | 145.22 kB | 144.46 kB (Phase 10 tip) | +0.76 kB (unrelated to Phase 11 — Terminal chunk absorbed intervening quick-task patches #129–#137) |
| `index-Tns5kMac.js` | 320.61 kB | 333.13 kB (Phase 10 tip) | −12.52 kB (partial dashboard tree still on disk but no longer imported by AppShell landing path) |

**AppShell chunk reduction of 373 kB / 83% is the headline number for Phase 11.** This comes from:

- **AppRail.tsx deletion (283 lines source, ~10-15 kB minified with Lucide icon deps)**
- **SettingsRow.tsx deletion (198 lines source, ~7-10 kB minified)**
- **11 sidebar panel imports removed from AppShell** (HostsPanel, SessionsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, UserProfilePanel, AdminSettingsPanel, CredentialsPanel, ConnectionsPanel). Rolldown was previously pulling all 11 panel component trees + their transitive deps into the AppShell chunk because they were direct imports. With the imports gone, Rolldown code-splits them into their own async chunks that are never actually loaded at runtime because no code path reaches them.
- **`case "dashboard"` → `<PrettyLandingCard/>` swap in tabUtils.tsx** (Plan 02): DashboardTab (with its host-list-fetching cards, chart libs, stats panels) is no longer statically imported by tabUtils.tsx, so its subtree code-splits away from the AppShell chunk.
- **340-line net strip from AppShell.tsx** (Plan 03 cf7fe27): rail-view state machine, openSingletonTab function, handleRailClick + editHostInManager helpers, sidebarTitle Record.

The net effect: **Ashley's Termix client now downloads 373 kB less code on first-load** for the exact same landing surface (which is now pretty-conversations + PrettyLandingCard instead of pretty-conversations + Termix dashboard). Gzip'd first-load delta = **−67 kB on the wire** — that's a real bandwidth + parse-time win, not just a code hygiene win.

### First-full-build-since-Plan-03 annotation

**This is the FIRST full `npm run build` verification after Plan 03's per-commit tsc + vitest + grep gates landed.** Per checker W-3 fix on Plan 03, the full production build was scoped to the phase boundary (this file) rather than repeated per-commit inside Plan 03 (which would have added ~55s to each of Plan 03's 5 commits for redundant coverage over the per-commit tsc that already caught type breakage). Build passed cleanly on the first try — no regression from any of Plan 03's 5 commits. If build had FAILED at this step, Plan 04 would have routed back to the specific Plan 03 commit via `git bisect` to identify the regression source.

### Backend bundle

Backend Node bundle untouched — Phase 11 is UI-only, no server changes (PURGE-04 preservation).

---

## Section 4: Grep hygiene gates (Phase 11 non-negotiables)

All gates run from repo root against HEAD (`cbff367`).

| Gate | Command | Expected | Observed | Status |
|---|---|---:|---:|---|
| G1 | `grep -rn 'from "@/sidebar/AppRail"' src/ \| wc -l` | 0 | 0 | ✅ PASS |
| G2 | `grep -rn 'from "@/sidebar/SettingsRow"' src/ \| wc -l` | 0 | 0 | ✅ PASS |
| G3 | `grep -rn "AppRail" src/ \| grep -v "pinAppRail" \| grep -v "\.md$" \| grep -v "^\s*//" \| grep -v "^\s*\*"` code-lines | 0 | 0 code lines (1 JSX block-comment history annotation at AppShell.tsx:1499 — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G4 | `grep -rn "SettingsRow" src/ \| grep -v "\.md$" \| grep -v "^\s*//" \| grep -v "^\s*\*"` code-lines | 0 | 0 code lines (2 JSX block-comment history annotations at AppShell.tsx:1552 + 1716 — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G5 | `grep -rn "renderSettingsMenuItems" src/ \| grep -v "\.md$" \| wc -l` | 0 | 0 | ✅ PASS |
| G6 | `grep -rn "railView\|handleRailClick\|sidebarTitle\|RailView" src/ \| grep -v "\.md$"` code-lines | 0 | 0 code lines (7 `//` line-comment history annotations in AppShell.tsx — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G7 | `grep -rn "profileDropdownOpen\|setProfileDropdownOpen" src/ \| grep -v "\.md$"` code-lines (per Plan 01 Section E.2 safety-gate, AppRail-only state stripped in Plan 03 Task 2) | 0 | 0 code lines (1 `//` line-comment history annotation at AppShell.tsx:229 — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G8 | `grep -rn "settingsRowSlot" src/ \| grep -v "\.md$"` code-lines | 0 | 0 code lines (1 JSX block-comment history annotation at AppShell.tsx:1718 — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G9 | `grep -rn "DashboardTab" src/ \| grep -v "src/ui/dashboard/" \| grep -v "\.md$"` code-lines | 0 | 0 code lines (1 `//` line-comment history annotation at AppShell.tsx:1086 — Phase 10 Wave 4 policy: acceptable; `src/ui/dashboard/` tree stays on disk per Section G scope-fence for Phase 12+ deletion) | ✅ PASS |
| G10 | `grep -rn "openSingletonTab" src/ \| grep -v "\.md$"` code-lines | 0 | 0 code lines (2 `//` line-comment history annotations at AppShell.tsx:1079 + 1694 — Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G11 | `test -f src/ui/sidebar/AppRail.tsx && echo EXISTS \|\| echo GONE` | GONE | GONE | ✅ PASS |
| G12 | `test -f src/ui/sidebar/SettingsRow.tsx && echo EXISTS \|\| echo GONE` | GONE | GONE | ✅ PASS |
| G13 | `test -f src/ui/features/pretty-view/PrettyLandingCard.tsx && echo EXISTS \|\| echo GONE` | EXISTS | EXISTS | ✅ PASS |
| G14 | `grep -c "PrettyLandingCard" src/ui/shell/tabUtils.tsx` (import + JSX render call) | 2 | 2 | ✅ PASS |
| G15 | `grep -rn 'case "rdp"' src/ \| wc -l` (PURGE-05 preserve baseline) | 6 (unchanged from Phase 10) | 6 | ✅ PASS |
| G16 | `grep -c "onRdpRowClick" src/ui/AppShell.tsx` (PURGE-05 handler preserved verbatim) | 1 | 1 | ✅ PASS |
| G17 | `git log --name-only --since="2026-07-23 09:00" \| grep "^src/backend/" \| wc -l` (PURGE-04 backend untouched) | 0 | 0 | ✅ PASS |

**Zero FAILs.** Every non-negotiable Phase 11 grep gate returned the expected count.

**Comment-filter methodology note:** The plan's grep patterns use `grep -v "^\s*//"` which correctly filters `//` line-comments in-file, but does NOT filter JSX block-comments (`{/* */}`) that live on multi-line spans. Per Phase 10 Wave 4 policy, both `//` line-comments and `{/* */}` JSX block-comments mentioning retired identifiers are acceptable historical annotations (they serve as tombstones for future engineers wondering why references disappeared). All 15 residuals above were manually inspected and confirmed to be inside comments; a proper multi-line-comment-aware AST filter would return exactly 0 hits for every gate.

---

## Section 5: Requirement traceability (PURGE-01 through PURGE-05)

| Req | Description | Evidence | Verification |
|---|---|---|---|
| **PURGE-01** | Landing surface swap — desktop no-hash lands on pretty-conversations sidebar + PrettyLandingCard main-pane empty card (NOT Termix dashboard) | Plan 02 commits `8ae9baf` (add PrettyLandingCard component + 4 tests), `22b5cfb` (swap `case "dashboard"` render in tabUtils.tsx), `425ba1f` (rename dashboard nav labels to conversations) | `grep -c "PrettyLandingCard" src/ui/shell/tabUtils.tsx` → 2 (import + JSX call) ✅; `test -f src/ui/features/pretty-view/PrettyLandingCard.tsx` → EXISTS ✅; Plan 02 SUMMARY § Verification confirms 4/4 PrettyLandingCard tests pass |
| **PURGE-02** | AppRail component file deleted from src/ tree, zero visible-UI entry points to Termix dashboard from AppRail | Plan 03 Task 5 commit `c386068` (delete AppRail.tsx — 283 lines); Plan 03 Task 2 commit `cf7fe27` (strip AppRail mount + all 11 sidebar-panel imports + rail-view state machine from AppShell) | `test -f src/ui/sidebar/AppRail.tsx` → GONE ✅; `grep -rn 'from "@/sidebar/AppRail"' src/` → 0 ✅ (G1, G11) |
| **PURGE-03** | No visible UI navigation path to Termix dashboard, host manager, snippets manager, admin console, or any settings surface | Plan 03 Task 2 commit `cf7fe27` (AppShell surgery — AppRail mount gone + SettingsRow mount gone + 10 dead panel-branch conditionals + rail-view state machine strip + openSingletonTab function retirement + profileDropdownOpen state strip via §E.2 safety-gate); Plan 03 Task 3 commit `992bee3` (drop vestigial settingsRowSlot prop); Plan 03 Task 4 commit `c3c84be` (delete SettingsRow.tsx — 198 lines, Ashley's "no settings" lock) | All 10 hygiene grep gates in Section 4 (G3–G10) return 0 code hits ✅. Direct hash-fragment probes for `#hosts` / `#admin` / `#snippets` deferred to UAT (see `11-UAT-CHECKLIST.md` Desktop item 9 — automated tests can't observe the fully-rendered navigation state, so the runtime UAT walk is the definitive gate). |
| **PURGE-04** | Backend routes untouched (`/host/db/*`, `/identities/*`, `/sessions/*`, WebSocket routes) | Phase 11 touched zero backend files | `git log --name-only --since="2026-07-23 09:00" \| grep "^src/backend/" \| wc -l` → 0 ✅ (G17). No `src/backend/**` files appear in any Phase 11 commit's file list; the encrypted-SQLite data layer + all backend HTTP/WS routes continue to serve as they did pre-Phase-11. |
| **PURGE-05** | RDP still works — RDP-host-sentinel rows in pretty-conversations sidebar continue to open Guacamole panes; renderTabContent's `case "rdp"` / `case "vnc"` / `case "telnet"` blocks preserved verbatim | Plan 02 preserved tabUtils.tsx `case "rdp"/vnc/telnet` blocks (verified by grep pre- and post-swap); Plan 03 Task 2 preserved `onRdpRowClick` handler in AppShell.tsx verbatim through the sidebarPanelContent rewrite | `grep -rn 'case "rdp"' src/ \| wc -l` → 6 (baseline unchanged from Phase 10) ✅ (G15); `grep -c "onRdpRowClick" src/ui/AppShell.tsx` → 1 (handler mounted on PrettyConversationsPanel with full body verbatim) ✅ (G16). **Runtime verification deferred to Ashley UAT** for click-through walkthrough on live RDP host (documented in `11-UAT-CHECKLIST.md` Desktop item 6 + Cross-viewport item 3 — automated tests cannot verify actual guacd connection + remote-desktop-usable, only that the handler is bound). |

**All 5 PURGE-* requirements have evidence pointers to specific commits + specific verification gates. All automated gates PASS.** Runtime UAT for PURGE-03 (hash-fragment probes) and PURGE-05 (live RDP click-through) is Ashley's post-deploy walkthrough — the automated suite cannot observe those, but every code path that would need to break for either to fail has been grep-verified stripped or preserved as appropriate.

---

## Verdict summary

**PASS.** All three commands green:

- ✅ `npx tsc --noEmit` — exit 0, zero errors
- ✅ `npx vitest run` — 524/526 passing (2 pre-existing ComposeBox baseline failures inherited from patches #121 + #124; zero net-new Phase 11 regressions)
- ✅ `npm run build` — succeeds in 10.94s, exit 0, no errors, warnings pre-existing (large vendor chunks unchanged from Phase 10)

**All 17 grep hygiene gates PASS.** Every non-negotiable Phase 11 constraint (AppRail gone, SettingsRow gone, PrettyLandingCard present, no visible-UI code paths to dead surfaces, RDP baseline preserved, backend untouched) satisfied. The 15 non-zero residuals in comment-filtered greps are all inside `//` line-comments or `{/* */}` JSX block-comments — Phase 10 Wave 4 policy: historical annotations for future engineers are acceptable.

**All 5 PURGE-* requirements traced** to specific commits + specific verification gates.

**Phase 11 code-complete on `feat/tab-title-from-tmux` at `cbff367`.** Ready for the batched deploy per current fork DEPLOY DISCIPLINE — see `11-UAT-CHECKLIST.md` § Post-UAT deploy runbook for the authoritative source (`~/.claude/identities/tina/deploy-runbook.md`). NO standalone deploy for Phase 11 unless Ashley explicitly greenlights — batch with subsequent Phase 12+ purge patches per the fleet-standing "batch patches into meaningful deploys" rule.

**Bundle size headline:** AppShell chunk **−373 kB / −83%** (−67 kB gzip) vs Phase 10 tip. That's the concrete evidence of the Ship-of-Theseus purge landing.

**Route-back target wave:** N/A — no failures to route back.

---

*Phase: 11-skynet-transformation-purge-dead-termix-surfaces-first-slice*
*Log generated: 2026-07-23 (Plan 04 Task 1 automation)*
*Verifier commit: `cbff367` (Plan 03 tip)*
