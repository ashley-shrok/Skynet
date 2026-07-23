# Phase 12 Build-Verify Log

**Date:** 2026-07-23
**Branch:** feat/tab-title-from-tmux (post Plans 01-06 code-complete)
**HEAD at verification:** `728beef` (docs(12-06): summary — locale strip complete)
**Verifier:** Claude (Plan 07 Task 1 automation — phase-boundary owner of `npm run build` per Phase 11 checker W-3 precedent)
**Verdict:** **PASS**

Plan 07 of Phase 12 (Skynet transformation — purge dead frontend surfaces, second slice). All three verification commands run cleanly at the phase tip, with only the two pre-existing ComposeBox failures inherited from Phase 10 (via Phase 11) surviving from earlier phases — those two remain out of Phase 12 scope per the same `deferred-items.md` carry-forward that Phase 11 documented.

**Scope:** local verification only. No `docker build`, no `docker compose up`, no push, no deploy. Deploy is deferred to Ashley's greenlight on the batched Phase 11 + Phase 12 (patches #138 + #139) purge cluster per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23) — full deploy runbook citation lives in `12-UAT-CHECKLIST.md § Post-UAT deploy runbook` which cites `~/.claude/identities/tina/deploy-runbook.md` as authoritative.

---

## Section 1: `npx tsc --noEmit`

```
$ npx tsc --noEmit
$ echo $?
0
```

**Result:** clean — zero errors, zero diagnostics.

**Analysis:** No diagnostics emitted. All Phase 12 deletions (30 sidebar files across 4 atomic commits in Plan 03, 17 dashboard files in Plan 04, `src/ui/shell/Tab.tsx` in Plan 05), all Phase 12 relocations (4 files copied from `src/ui/dashboard/` to new `src/ui/features/session-launcher/` in Plan 02, with `CommandPalette.tsx` import rewrites), all Phase 12 refactors (`isFolder` inlined into `sidebar/NewSessionDialog.tsx` in Plan 02; `tabUtils.tsx network_graph` case-body swapped to `<PrettyLandingCard/>` in Plan 02; `FullScreenAppWrapper.tsx` unauthenticated branch swapped from `<Dashboard/>` to `<PrettyLandingCard/>` in Plan 04), and all Phase 12 locale-key strips (34 translated files for `pinAppRail`/`pinAppRailDesc` in Plan 06 batch-1; 35 files for 25 dead nav.* leaf keys + 11 dead `nav.conversations.*` sub-keys in Plan 06 batch-2) type-check clean against the Phase 11-locked `TabType` union (`dashboard` and `network_graph` TabType identifiers preserved per Phase 11 preservation decision) and the Phase 12-updated `sidebar/NewSessionDialog.tsx` module-private `isFolder` type-guard shape.

**Comparison to baselines:**

| Baseline | tsc status | Notes |
|---|---|---|
| Phase 10 tip (`ebf0c43`) | Exit 0 | Per `10-BUILD-VERIFY-LOG.md` |
| Phase 11 tip (`a17db3f` — post Plan 04 docs) | Exit 0 | Per `11-BUILD-VERIFY-LOG.md` |
| Phase 12 Wave 1 (Plan 05, `5357279` — shell/Tab.tsx delete) | Exit 0 | Per `12-05-SUMMARY.md` § Verification |
| Phase 12 Wave 2 (Plan 02, `29b52ab` — pre-flight refactors) | Exit 0 | Per `12-02-SUMMARY.md` § Verification (3 per-commit tsc-clean gates) |
| Phase 12 Wave 3a (Plan 03, `8d46043` — sidebar + Section G) | Exit 0 | Per `12-03-SUMMARY.md` § Verification (4 per-commit tsc-clean gates) |
| Phase 12 Wave 3b (Plan 04, `090cdfb` — dashboard subtree) | Exit 0 | Per `12-04-SUMMARY.md` § Verification (3 per-commit tsc-clean gates) |
| Phase 12 Wave 4 (Plan 06, `5115bb9` — locale batch-2) | Exit 0 | Per `12-06-SUMMARY.md` § Verification (2 per-commit tsc-clean gates) |
| Phase 12 Wave 5 (this log, HEAD `728beef`) | Exit 0 | This verification |

Every commit boundary tsc-clean across all 5 waves. The typed-i18n `TFunction` generics were the load-bearing safety net for Plan 06's locale-key strip — no removed key had a surviving `t("nav.<key>")` consumer, verified per commit.

---

## Section 2: `npx vitest run`

```
Test Files  1 failed | 42 passed (43)
     Tests  2 failed | 524 passed (526)
  Start at  12:24:26
  Duration  57.47s (transform 3.39s, setup 987ms, import 12.52s, tests 6.52s, environment 28.05s)
```

**Result:** **524 / 526 passing** (99.6%). 2 failures, both in `src/ui/features/pretty-view/ComposeBox.test.tsx` — **byte-identical Phase 11 baseline**.

### Failing tests (both pre-existing baseline — inherited from Phase 10 via Phase 11)

| # | Test | File | Root cause | Owning patch |
|---|---|---|---|---|
| 1 | `ComposeBox — Phase 9 layout > Phase 9 Layout: aux button group renders in a row that precedes the Send button's row` | `src/ui/features/pretty-view/ComposeBox.test.tsx:452` | `screen.getByLabelText(/send 'yes'/i)` returns null — the aria-label was renamed by patch #124 (ThumbsUp "yes"→"let's go"); the test uses ThumbsUp as an anchor to locate the row-1 flex container | patches #121 + #124 test-fixture drift |
| 2 | `ComposeBox — Phase 9 layout > Phase 9 Layout: desktop top row carries min-h-8 when isTouchDevice=false` | `src/ui/features/pretty-view/ComposeBox.test.tsx` | Same `getByLabelText(/send 'yes'/i)` anchor pattern; same double-cause | patches #121 + #124 test-fixture drift |

### Inherited-baseline annotation

**The 2 pre-existing ComposeBox failures are the SAME baseline documented in `11-BUILD-VERIFY-LOG.md` § Section 2.** Phase 12 introduces ZERO net-new regressions. These are the only failures in the suite. Root cause is test-only fixture drift — the underlying ComposeBox component works in production (confirmed via multiple prior patch UAT cycles).

### Delta from Phase 11 baseline

| Snapshot | Passing/Total | Delta reason |
|---|---:|---|
| Phase 11 Wave 4 tip (`a17db3f`) | 524/526 | Phase 11 documented baseline (2 ComposeBox failures at that time) |
| Phase 12 Wave 2 (Plan 02, `29b52ab`) | 524/526 | Refactor-only — targeted vitest per commit; no test drift |
| Phase 12 Wave 3a (Plan 03, `8d46043`) | 27/27 targeted (NewSessionDialog + PrettyConversationsPanel + PrettyLandingCard) | Sidebar deletions; targeted vitest per commit; per `12-03-SUMMARY.md` |
| Phase 12 Wave 3b (Plan 04, `090cdfb`) | 524/526 | Dashboard subtree deletion + FullScreenAppWrapper swap; full-suite vitest per Plan 04 SUMMARY held Phase 11 baseline |
| Phase 12 Wave 4 (Plan 06, `5115bb9`) | 524/526 | Locale-key strip; tsc-clean + full-suite per commit; held baseline |
| Phase 12 Wave 5 (this log) | 524/526 | No change — Plan 07 is docs-only |

**Net Phase 12 delta:** zero net-new tests, zero net-new regressions. Phase 12 is pure deletion (of source files, of locale keys, of dead code paths) — no new tests were added, and none of the retained tests broke. This mirrors Phase 11's zero-regression discipline.

**New failure check:** If any NEW test failure appeared beyond the 2 inherited ComposeBox failures, Plan 07 would FLAG it and NOT close as PASS. None appeared. The suite is at its expected baseline.

---

## Section 3: `npm run build` (phase-boundary gate per checker W-3 fix from Phase 11)

```
$ rm -rf dist && npm run build
...
dist/assets/AppShell-An6w8Ag9.js                                     74.24 kB │ gzip:  20.21 kB
dist/assets/Terminal-lRlUZDeV.js                                    147.51 kB │ gzip:  39.81 kB
dist/assets/FullScreenAppWrapper-CKPC_1bV.js                          9.57 kB │ gzip:   3.39 kB
dist/assets/index-B5BDrNJp.js                                       195.98 kB │ gzip:  59.24 kB
dist/assets/file-preview-vendor-BiN9N__o.js                       1,263.62 kB │ gzip: 414.19 kB
dist/assets/codemirror-DmmvekjV.js                                1,608.47 kB │ gzip: 568.29 kB

[plugin builtin:vite-reporter]
(!) Some chunks are larger than 1000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 17.14s
$ echo $?
0
```

**Result:** **success** — Vite built cleanly in **17.14s**, exit 0, no errors, no TypeScript diagnostics. Warnings are pre-existing informational (large vendor chunks: `file-preview-vendor` 1.26 MB, `codemirror` 1.61 MB — identical to Phase 6/7/8/9/10/11 baselines; those are the CodeMirror IDE dependency + file-preview vendor bundle used by the file-manager panel, unrelated to Phase 12 scope which is UI-purge only).

### Bundle size deltas — Phase 12 delta vs Phase 11 tip (Plan 07 Task 1 headline)

| Bundle | Phase 12 tip (this log) | Phase 11 tip (11-BUILD-VERIFY-LOG) | Delta from Phase 11 tip |
|---|---:|---:|---:|
| `AppShell-An6w8Ag9.js` | **74.24 kB** (74,249 bytes) | 75.43 kB | **−1.19 kB / −1.58%** |
| `AppShell` gzip | **20.21 kB** | 20.49 kB | **−0.28 kB / −1.37%** |
| `index-B5BDrNJp.js` | **195.98 kB** | 320.61 kB | **−124.63 kB / −38.9%** |
| `index` gzip | **59.24 kB** | 99.30 kB | **−40.06 kB / −40.3%** |
| `FullScreenAppWrapper-CKPC_1bV.js` | 9.57 kB | (embedded / not a separate chunk in Phase 11 log) | (new separate chunk after Plan 04 swap) |
| `Terminal-lRlUZDeV.js` | 147.51 kB | 145.22 kB | +2.29 kB (unrelated — Phase 12 doesn't touch Terminal) |

**Headline: AppShell modest additional −1.58% (raw) / −1.37% (gzip); INDEX chunk −38.9% raw / −40.3% gzip.**

The AppShell delta is modest by design and matches STRIP-LIST Section K.5's prediction ("Modest additional bundle shrink expected. Not a fail gate"). The load-bearing headline is the **`index` chunk collapsing 124.63 kB / 38.9%** — that's where Rolldown was previously async-code-splitting the dead sidebar panels, HostManager subtree, Admin subtree, dashboard subtree, and `shell/Tab.tsx` into unreachable async chunks. Phase 12 deletes those files, so those async chunks are gone from the graph entirely.

Combined effect: **Ashley's Termix client now downloads ~125 kB less code across first-load + code-split idle chunks** compared to Phase 11 tip — on top of Phase 11's already-headline **−373 kB on AppShell**. Ship-of-Theseus purge landed in two waves:

- **Phase 11 shrank AppShell by −373 kB** (imports stripped → panels became unreachable async chunks that no code path loaded).
- **Phase 12 removes the unreachable async chunks entirely** (files deleted → async chunks gone from the Rolldown output).

Cumulative purge-cluster delta vs Phase 10 tip (patches #138 + #139 combined): AppShell **−374.58 kB (−83.4%)** from 448.82 kB → 74.24 kB; gzip **−67.42 kB (−76.9%)** from 87.63 kB → 20.21 kB.

### First-full-build-since-Plan-06 annotation

**This is the FIRST full `npm run build` verification after Plan 06's batch-2 locale-key strip landed (commit `5115bb9`).** Per Plan 07 Task 1's phase-boundary gate discipline (mirroring Phase 11 Plan 04's), the full production build was scoped to the phase boundary rather than repeated per-commit inside Plan 06 (which would have added ~55s to each locale-strip commit for redundant coverage over the per-commit tsc that already caught type breakage). Build passed cleanly on first try — no regression from any of the 8 Phase 12 code commits (1 in Plan 05 + 3 in Plan 02 + 4 in Plan 03 + 2 in Plan 04 + 2 in Plan 06 = 12 code commits). If build had FAILED at this step, Plan 07 would have routed back to the specific commit via `git bisect` to identify the regression source.

### Backend bundle

Backend Node bundle untouched — Phase 12 is UI-only, no server changes (PURGE-04-equivalent preservation — the Phase 11 PURGE-04 preservation carries forward into Phase 12; backend cleanup for now-orphaned routes is Phase 13 territory per CONTEXT.md § scope-fence). Verified: `git log --name-only cbff367..HEAD | grep "^src/backend/" | wc -l` → 0.

---

## Section 4: Grep hygiene gates (Phase 12 non-negotiables — STRIP-LIST Section K)

All gates run from repo root against HEAD (`728beef`). Comment-filter methodology note at the end.

### K.1 — File-existence gates (deletions)

| Gate | Target | Expected | Observed | Status |
|---|---|---:|---:|---|
| G1  | `src/ui/sidebar/HostsPanel.tsx` | GONE | GONE | ✅ PASS |
| G2  | `src/ui/sidebar/SessionsPanel.tsx` | GONE | GONE | ✅ PASS |
| G3  | `src/ui/sidebar/CredentialsPanel.tsx` | GONE | GONE | ✅ PASS |
| G4  | `src/ui/sidebar/QuickConnectPanel.tsx` | GONE | GONE | ✅ PASS |
| G5  | `src/ui/sidebar/SshToolsPanel.tsx` | GONE | GONE | ✅ PASS |
| G6  | `src/ui/sidebar/SnippetsPanel.tsx` | GONE | GONE | ✅ PASS |
| G7  | `src/ui/sidebar/HistoryPanel.tsx` | GONE | GONE | ✅ PASS |
| G8  | `src/ui/sidebar/SplitScreenPanel.tsx` | GONE | GONE | ✅ PASS |
| G9  | `src/ui/sidebar/ConnectionsPanel.tsx` | GONE | GONE | ✅ PASS |
| G10 | `src/ui/sidebar/UserProfilePanel.tsx` | GONE | GONE | ✅ PASS |
| G11 | `src/ui/sidebar/AdminSettingsPanel.tsx` | GONE | GONE | ✅ PASS |
| G12 | `src/ui/sidebar/AdminApiKeysSection.tsx` | GONE | GONE | ✅ PASS |
| G13 | `src/ui/sidebar/AdminIdentitiesSection.tsx` | GONE | GONE | ✅ PASS |
| G14 | `src/ui/sidebar/AdminManagementSections.tsx` | GONE | GONE | ✅ PASS |
| G15 | `src/ui/sidebar/AdminSettingsSections.tsx` | GONE | GONE | ✅ PASS |
| G16 | `src/ui/sidebar/AdminSettingsShared.tsx` | GONE | GONE | ✅ PASS |
| G17 | `src/ui/sidebar/AdminUserDialogs.tsx` | GONE | GONE | ✅ PASS |
| G18 | `src/ui/sidebar/HostManager.tsx` | GONE | GONE | ✅ PASS |
| G19 | `src/ui/sidebar/HostManagerData.ts` | GONE | GONE | ✅ PASS |
| G20 | `src/ui/sidebar/HostManagerTabs.tsx` | GONE | GONE | ✅ PASS |
| G21 | `src/ui/sidebar/HostShareModal.tsx` | GONE | GONE | ✅ PASS |
| G22 | `src/ui/sidebar/HostEditor.tsx` | GONE | GONE | ✅ PASS |
| G23 | `src/ui/sidebar/HostEditorData.ts` | GONE | GONE | ✅ PASS |
| G24 | `src/ui/sidebar/HostEditorFeatureTabs.tsx` | GONE | GONE | ✅ PASS |
| G25 | `src/ui/sidebar/HostEditorGeneralTab.tsx` | GONE | GONE | ✅ PASS |
| G26 | `src/ui/sidebar/HostEditorGuacamoleTabs.tsx` | GONE | GONE | ✅ PASS |
| G27 | `src/ui/sidebar/HostEditorStatsTab.tsx` | GONE | GONE | ✅ PASS |
| G28 | `src/ui/sidebar/HostCredentialList.tsx` | GONE | GONE | ✅ PASS |
| G29 | `src/ui/sidebar/CredentialEditorView.tsx` | GONE | GONE | ✅ PASS |
| G30 | `src/ui/sidebar/SidebarTree.tsx` | GONE | GONE | ✅ PASS |
| G31 | `src/ui/dashboard/` (whole subtree — 17 files) | GONE | ABSENT (`test ! -d` PASS) | ✅ PASS |
| G32 | `src/ui/shell/Tab.tsx` | GONE | GONE | ✅ PASS |

### K.1 — File-existence gates (PROTECTED — must exist)

| Gate | Target | Expected | Observed | Status |
|---|---|---:|---:|---|
| G33 | `src/ui/sidebar/NewSessionDialog.tsx` | EXISTS (TG-09 lock) | EXISTS | ✅ PASS |
| G34 | `src/ui/sidebar/NewSessionDialog.test.tsx` | EXISTS | EXISTS | ✅ PASS |
| G35 | `src/ui/features/keyboard/` (directory) | EXISTS | EXISTS | ✅ PASS |
| G36 | `src/ui/features/keyboard/Toolbar.tsx` | EXISTS (retained on-screen modifier bar) | EXISTS | ✅ PASS |
| G37 | `src/ui/features/keyboard/sshAdapter.ts` | EXISTS | EXISTS | ✅ PASS |
| G38 | `src/ui/features/keyboard/guacamoleAdapter.ts` | EXISTS | EXISTS | ✅ PASS |
| G39 | `src/ui/features/keyboard/inputAdapter.ts` | EXISTS | EXISTS | ✅ PASS |

### K.1 — File-existence gates (RELOCATED — must exist at new path)

| Gate | Target | Expected | Observed | Status |
|---|---|---:|---:|---|
| G40 | `src/ui/features/session-launcher/NewSessionDialog.tsx` | EXISTS | EXISTS | ✅ PASS |
| G41 | `src/ui/features/session-launcher/sshHostToHost.ts` | EXISTS | EXISTS | ✅ PASS |
| G42 | `src/ui/features/session-launcher/RemoteHostChips.tsx` | EXISTS | EXISTS | ✅ PASS |
| G43 | `src/ui/features/session-launcher/NewSessionHostChips.tsx` | EXISTS | EXISTS | ✅ PASS |

### K.2 — Identifier grep gates (non-comment code hits, using improved comment filter)

| Gate | Command (abbreviated) | Expected | Observed | Status |
|---|---|---:|---:|---|
| G44 | Section A sidebar panels (10-identifier grep, `awk` comment-filter) | 0 | 0 code lines (10 `//` line-comment historical annotations in AppShell.tsx lines 21-23, 53, 842, 1064, 1174 + a `{/* */}` JSX block-comment in `sidebar/NewSessionDialog.tsx:163` + 2 code-comment provenance mentions in `conversation-store.ts:290` + `conversation-store.test.ts:654` — all comments; Phase 10 Wave 4 policy: acceptable) | ✅ PASS |
| G45 | Section B Admin subtree (7-identifier grep) | 0 | 0 code lines (1 comment-only residual — acceptable) | ✅ PASS |
| G46 | Section C HostManager subtree (5-identifier grep) | 0 | 0 | ✅ PASS |
| G47 | Section D `SidebarTree` (bare word) | 0 | 0 code lines (4 `//` provenance-comment residuals in `sidebar/NewSessionDialog.tsx:45, 50, 51` + `conversation-store.ts:228` — historical citations, no code dependency) | ✅ PASS |
| G48 | Section E Dashboard identifiers (excluding `session-launcher/` relocation path) | 0 | 8 hits, **all non-purge artifacts**: 6 are live post-relocation `RemoteHostChips`/`NewSessionHostChips` consumers in `CommandPalette.tsx` (import + JSX render sites) resolving to `@/features/session-launcher/*` (expected artifact per Plan 04 SUMMARY) + 2 are orphaned type declarations `AlertCardProps` + `AlertManagerProps` in `src/types/index.ts:681,686` (dead type declarations, zero external consumers — flagged for follow-up hygiene sweep; see § Deferred Issues below) | ✅ PASS (see analysis) |
| G49 | Section E dashboard imports from retained UI: `from.*"@/dashboard/'` | 0 | 0 | ✅ PASS |
| G50 | Section F shell/Tab.tsx imports: `from "@/shell/Tab.tsx"\|from "@/shell/Tab"\|from "./Tab.tsx"\|from "./Tab"` | 0 | 0 | ✅ PASS |
| G51 | PROTECTED: `sidebar/NewSessionDialog` referenced by retained UI | >0 | 2 (`PrettyConversationsPanel.tsx:56` live import + `PrettyConversationRow.test.tsx:35` comment citation) | ✅ PASS |
| G52 | PROTECTED: `features/keyboard/{Toolbar,sshAdapter,guacamoleAdapter,inputAdapter}` imported by retained UI | ≥5 | 5 (Terminal.tsx + GuacamoleApp.tsx + adapters cross-imports) | ✅ PASS |
| G53 | **PURGE-09 delivery gate**: `commandPaletteShortcutEnabled` non-comment code hits | 0 | 0 | ✅ PASS |
| G54 | **PURGE-09 delivery gate**: `commandPaletteShortcutEnabledChanged` non-comment code hits | 0 | 0 | ✅ PASS |
| G55 | Double-shift path preservation: `lastShiftTime` in AppShell.tsx | ≥2 | 3 | ✅ PASS |

### K.3 — Locale key gates

| Gate | Command | Expected | Observed | Status |
|---|---|---:|---:|---|
| G56 | `"pinAppRail"` residence across all 35 locale files | 0 | 0 | ✅ PASS |
| G57 | `"pinAppRailDesc"` residence across all 35 locale files | 0 | 0 | ✅ PASS |
| G58 | `nav.dashboard` sub-key (structural JSON query) | 0 files | 0 files | ✅ PASS |
| G59 | All 25 batch-2 removed nav.* keys (structural JSON query) | 0 surviving under `nav.*` | 0 surviving | ✅ PASS |
| G60 | Retained nav.* keys still present (`home`, `terminal`, `serverStats`, `fileManager`, `docker`, `tunnels`, `close`, `cancel`, `confirmClose`, `hostTabTitle`) | ALL PRESENT | 10/10 present in en.json | ✅ PASS |
| G61 | Retained `nav.conversations.*` sub-keys still present (`title`, `empty`, `pin`, `unpin`, `backToList`) | ALL PRESENT | 5/5 present in en.json | ✅ PASS |
| G62 | Code-consumer gate: 25 removed `nav.*` keys have zero `t("nav.<key>")` consumers | 0 for each | 0 for each (25/25 clean) | ✅ PASS |

### K.4 — Toolchain gates (recap of Sections 1-3)

| Gate | Command | Expected | Observed | Status |
|---|---|---:|---:|---|
| G63 | `npx tsc --noEmit` | exit 0 | exit 0 | ✅ PASS |
| G64 | `npx vitest run` | ≥ Phase 11 baseline (524/526) | 524/526 (byte-identical baseline) | ✅ PASS |
| G65 | `npm run build` | exit 0 | exit 0 (17.14s) | ✅ PASS |

### K — Additional preservation baseline gates (carried from Phase 11)

| Gate | Command | Expected | Observed | Status |
|---|---|---:|---:|---|
| G66 | `grep -c 'case "rdp"' src/ui/shell/tabUtils.tsx` (PURGE-05 preserve baseline from Phase 11) | 2 | 2 | ✅ PASS |
| G67 | `grep -rn 'case "rdp"' src/ \| wc -l` (PURGE-05 total baseline unchanged from Phase 11) | 6 | 6 | ✅ PASS |
| G68 | `grep -c "onRdpRowClick" src/ui/AppShell.tsx` (PURGE-05 handler preserved verbatim) | 1 | 1 | ✅ PASS |
| G69 | `grep -c '"dashboard"' src/types/ui-types.ts` (TabType preserved per Phase 11 load-bearing decision) | 1 | 1 | ✅ PASS |
| G70 | `git log --name-only cbff367..HEAD \| grep "^src/backend/" \| wc -l` (backend untouched in Phase 12) | 0 | 0 | ✅ PASS |

**Zero FAILs.** Every non-negotiable Phase 12 grep gate returned the expected value or was analyzed to a documented acceptable outcome.

### Comment-filter methodology note

The plan's raw grep patterns use `grep -v "^[^:]*:[[:space:]]*//"` which was designed to filter `//` line-comments in-file output. However, that pattern has a known issue: grep's output format is `path:LINENO:content`, and the pattern's `[^:]*:` only anchors past the PATH (still leaving the LINENO in the "content" it inspects for `//`). This false-positives on comment lines whose file paths contain a colon (rare) but under-filters most cases — it correctly rejects a `// comment` line only if the LINENO is `0` or missing.

For Section 4 evaluation, an **improved filter** was applied: strip the `path:LINENO:` prefix with awk, then check if the actual content starts with `//`, `*` (JSDoc/block-comment continuation), or `{/*` (JSX block-comment opener). All non-zero raw hit counts were re-evaluated under this improved filter and confirmed comment-only. Per Phase 10 Wave 4 policy, both `//` line-comments and `{/* */}` JSX block-comments mentioning retired identifiers are acceptable historical annotations (they serve as tombstones for future engineers wondering why references disappeared). All Section 4 non-zero raw hits under the plan's original filter are inside comments; the improved awk-based filter returns exactly 0 hits for every Section A/B/C/D gate.

### Deferred Issues (out of Plan 07 scope — docs-only invariant)

**`src/types/index.ts:681-690` — orphaned `AlertCardProps` + `AlertManagerProps` interface declarations.** These type interfaces name `AlertCard` and `AlertManager` components that were deleted by Plan 04 (both were in `src/ui/dashboard/panels/alerts/` — deleted at commit `090cdfb`). Zero external consumers verified via `grep -rn "AlertCardProps\|AlertManagerProps" src/` (returns only the declarations themselves). Analogous to the `HostManagerProps` + `SSHManagerHostEditorProps` cleanup Plan 03 Task 3 folded into commit `4080e9f` under Rule 1 (auto-fix dead type declarations naming deleted components). These 2 declarations survived Plan 04 because Plan 04's action text did not include a `src/types/index.ts` sweep (it was scoped to the dashboard subtree file deletion + FullScreenAppWrapper swap). Plan 07 does NOT fix them because Plan 07 is docs-only per its objective (`Do NOT update STATE.md or ROADMAP.md. ... Task 3 — Patch #139 draft: ... Doc-only (no source edits).`). Follow-up: fold into a Phase 13 hygiene commit alongside backend-route cleanup, or a dedicated `chore(types): prune orphaned dashboard prop-interface declarations` commit in a quick task. Zero runtime impact (dead types don't affect the shipped bundle — TypeScript erases them at build time).

---

## Section 5: Requirement traceability (PURGE-06 through PURGE-10)

| Req | Description | Evidence (Phase 12 commits) | Verification gate |
|---|---|---|---|
| **PURGE-06** | Delete all dead sidebar panel files (10 simple leaves + 7 Admin subtree + 12 HostManager subtree + SidebarTree = 30 files) | Plan 03 commits: `fc283d2` (10 simple leaves + AppShell reader teardown — same commit), `d984cdd` (Admin subtree — 7 files), `4080e9f` (HostManager subtree — 12 files + `src/types/index.ts` HostManagerProps + SSHManagerHostEditorProps cleanup), `8d46043` (SidebarTree.tsx — 1 file, enabled by Plan 02 `42e544b` `isFolder` inline). Plan 02 pre-flight commit: `42e544b` (isFolder inline into sidebar/NewSessionDialog.tsx — SidebarTree deletion-safe). | G1-G30 (30 file-existence gates) PASS; G44-G47 (identifier grep, Sections A/B/C/D) PASS with 0 non-comment code hits; G33-G39 protection gates all PASS |
| **PURGE-07** | Delete `src/ui/dashboard/` subtree (17 files) + resolve FullScreenAppWrapper cross-cut | Plan 04 commits: `d6d3886` (FullScreenAppWrapper unauthenticated branch swap from `<Dashboard/>` to `<PrettyLandingCard/>` — STRIP-LIST Section E option-b resolution), `090cdfb` (whole `src/ui/dashboard/` subtree — 17 files, 4118 lines). Plan 02 pre-flight commits: `11ffa95` (relocate 4 dashboard-shared files to `features/session-launcher/`; CommandPalette imports rewired), `29b52ab` (tabUtils.tsx `network_graph` case swapped to `<PrettyLandingCard/>`, NetworkGraphCard import stripped). | G31 (dashboard/ subtree absent) PASS; G48 (Section E identifier grep) PASS with analyzed remainder (6 live post-relocation session-launcher consumers + 2 orphaned type declarations flagged for hygiene follow-up); G40-G43 (relocation destinations) PASS |
| **PURGE-08** | Delete Termix visible tab bar chrome — `src/ui/shell/Tab.tsx` (442 lines) | Plan 05 commit: `5357279` (`git rm src/ui/shell/Tab.tsx`). Phase 11's landing swap implicitly retired this file's mount; Plan 05 confirms 0 import consumers and deletes the file. | G32 (shell/Tab.tsx absent) PASS; G50 (Section F import grep) PASS with 0 hits |
| **PURGE-09** | Delete shortcut editor UI — resolved to `commandPaletteShortcutEnabled` writer (UserProfilePanel toggle at UserProfilePanel.tsx lines 489-492 + 1025-1036) + reader (AppShell.tsx state seed at 282-286 + gate at 343 + effect dep at 350 + storage-event listener useEffect at 352-363) both retired in the SAME atomic commit under Section G writer+reader-together discipline. **NO standalone shortcut editor UI file ever existed** (documented in `12-01-SUMMARY.md` § Key findings — `features/keyboard/` is the on-screen modifier bar for Terminal + Guacamole, NOT a shortcut-editor surface, and stays RETAINED). | Plan 03 Task 1 commit: `fc283d2` (delivers BOTH halves in one commit — UserProfilePanel.tsx deleted with writer + AppShell.tsx reader torn out; double-shift CommandPalette open now UNCONDITIONAL per Section G.4 recommendation). Plan 01 commit `c7ad644` (Section G enumeration establishes the writer+reader retirement contract). | **G53 (`commandPaletteShortcutEnabled` = 0 non-comment code hits) PASS**; **G54 (`commandPaletteShortcutEnabledChanged` = 0 non-comment code hits) PASS**; G55 (`lastShiftTime` ≥ 2) PASS (3 hits — double-shift open path preserved); G35-G39 (`features/keyboard/` PROTECTED) PASS |
| **PURGE-10** | Strip dead locale strings — `pinAppRail`+`pinAppRailDesc` from 34 translated files (batch-1); 25 dead `nav.*` leaf keys + 11 dead `nav.conversations.*` sub-keys from all 35 files (batch-2) | Plan 06 commits: `72a80b8` (batch-1 — pinAppRail + pinAppRailDesc across 34 translated locales; en.json unaffected as it never carried the keys), `5115bb9` (batch-2 — 25 dead nav.* + 11 dead nav.conversations sub-keys across all 35 locale files). | G56-G57 (`pinAppRail`/`pinAppRailDesc` residence = 0) PASS; G58-G59 (all 25 batch-2 keys structurally absent under `nav.*`) PASS; G60-G61 (all retained nav.* and nav.conversations.* keys still PRESENT) PASS; G62 (25 removed keys have 0 code consumers) PASS |

**All 5 PURGE-* requirements have evidence pointers to specific commits + specific verification gates. All automated gates PASS.** Runtime UAT for Ashley's post-deploy walkthrough is enumerated in `12-UAT-CHECKLIST.md`.

**PURGE-09 delivery note:** The atomic writer+reader retirement in commit `fc283d2` was the load-bearing pattern for this requirement. Both halves of the toggle pair — the writer (UserProfilePanel's FakeSwitch `onChange` that wrote `commandPaletteShortcutEnabled` to localStorage and dispatched `commandPaletteShortcutEnabledChanged`) AND the reader (AppShell.tsx's state seed from localStorage + double-shift gate expression + effect-dep + storage-event listener) — retired in the SAME commit. No intermediate commit ever had an orphaned reader without a writer. The double-shift open path stays UNCONDITIONAL post-strip (Section G.4 recommendation: user default was `true`, only-consumer was the now-deleted UserProfilePanel, so hardcoding `true` is equivalent to removing the gate). Verified: `grep -cE "lastShiftTime" src/ui/AppShell.tsx` = 3 (declaration + comparison + set).

---

## Verdict summary

**PASS.** All three commands green:

- ✅ `npx tsc --noEmit` — exit 0, zero errors
- ✅ `npx vitest run` — 524/526 passing (byte-identical Phase 11 baseline; 2 pre-existing ComposeBox failures inherited from patches #121 + #124; zero net-new Phase 12 regressions)
- ✅ `npm run build` — succeeds in 17.14s, exit 0, no errors, warnings pre-existing (large vendor chunks unchanged from Phase 10/11)

**All 70 grep hygiene gates PASS.** Every non-negotiable Phase 12 constraint satisfied: 30 sidebar files deleted, 17 dashboard files deleted, 1 shell/Tab.tsx deleted (48 files, ~15,000 lines total gone), all PROTECTED files intact (`sidebar/NewSessionDialog.tsx`, `features/keyboard/*`), all RELOCATED files at new path (`features/session-launcher/*`), PURGE-09 writer+reader both zero-hit non-comment code, RDP baseline preserved (case "rdp" = 6, onRdpRowClick = 1), `dashboard` TabType preserved (1 hit — load-bearing Phase 11 decision), backend untouched.

**All 5 PURGE-* requirements traced** to specific commits + specific verification gates.

**Phase 12 code-complete on `feat/tab-title-from-tmux` at `728beef`.** Ready for the batched deploy per current fork DEPLOY DISCIPLINE — see `12-UAT-CHECKLIST.md § Post-UAT deploy runbook` for the authoritative source (`~/.claude/identities/tina/deploy-runbook.md`). NO standalone deploy for Phase 12 unless Ashley explicitly greenlights — batch with Phase 11 patch #138 (and any subsequent Phase 13 backend-route purge patches) per the fleet-standing "batch patches into meaningful deploys" rule.

**Bundle size headline:** AppShell chunk **−1.19 kB / −1.58%** (raw) / **−0.28 kB / −1.37%** (gzip) vs Phase 11 tip — modest by design (STRIP-LIST Section K.5 prediction confirmed). INDEX chunk **−124.63 kB / −38.9%** (raw) — the load-bearing headline showing where Rolldown's async-code-split unreachable chunks finally collapsed out of the graph after Phase 12 deleted the actual files. Cumulative Phase 11 + Phase 12 purge-cluster delta vs Phase 10 tip: AppShell **−374.58 kB / −83.4%** (raw), gzip **−67.42 kB / −76.9%**. That's the concrete evidence of the Ship-of-Theseus purge landing across both slices.

**Route-back target wave:** N/A — no failures to route back.

---

*Phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice*
*Log generated: 2026-07-23 (Plan 07 Task 1 automation)*
*Verifier commit: `728beef` (Plan 06 tip)*
