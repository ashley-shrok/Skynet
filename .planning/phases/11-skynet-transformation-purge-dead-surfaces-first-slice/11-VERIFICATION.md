---
phase: 11-skynet-transformation-purge-dead-skynet-surfaces-first-slice
verified: 2026-07-23T00:00:00Z
status: human_needed
score: 6/6 must-haves verified (automated); 3 items require human UAT
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
gaps: []
deferred: []
human_verification:
  - test: "Desktop fresh page-load (Chrome + Safari, wide window ≥1400px, no URL hash-fragment): visible top-level surface is the pretty-conversations sidebar + PrettyView chat surface (PrettyLandingCard empty-state) — NOT the Skynet dashboard or any prior Skynet landing UI. Also probe #hosts / #admin / #snippets / #dashboard direct URLs: none render a dead-surface panel."
    expected: "Landing surface = pretty-conversations panel (left) + PrettyLandingCard warm-glass idle card (main pane). Direct hash-fragment nav lands on either 404-equivalent OR PrettyLandingCard fallback (both acceptable per Plan 04 checker W-4)."
    why_human: "Fresh-load visual rendering + runtime hash-fragment probes cannot be observed by static grep. See 11-UAT-CHECKLIST.md Desktop items 1, 9. Contract is what does NOT render (dead-surface panel), which requires a live DOM."
  - test: "RDP click-through: on a live tenant with an RDP-enabled host, click the RDP-host-sentinel row in the pretty-conversations sidebar; a Guacamole pane opens and remote desktop is usable."
    expected: "Guacamole pane opens and connects to guacd, remote desktop is interactive (mouse + keyboard + screen render) — identical to pre-Phase-11 behavior."
    why_human: "Automated tests can verify the onRdpRowClick handler is bound (they do — see G16 gate, hit count 1) but cannot verify live guacd session established + remote desktop actually usable. See 11-UAT-CHECKLIST.md Desktop item 6 + Cross-viewport item 3."
  - test: "Mobile fresh page-load (iOS Safari or Skynet PWA reinstall): landing surface is the pretty-conversations list view with mobile back-button flow to PrettyView chat surface unchanged. No SettingsRow at bottom of list. iOS PWA safe-area colors follow --color-pv-* palette (not Skynet dark-mode)."
    expected: "Mobile landing = pretty-conversations list. Tap-row navigates to view screen; back-button returns to list. No gear icon, no settings surface, no bottom nav bar. Safe-area color aligns with pretty-view palette."
    why_human: "Mobile viewport rendering + touch-flow behavior requires a real touchscreen or emulator with PWA install. See 11-UAT-CHECKLIST.md Mobile items 1-7."
---

# Phase 11: Skynet transformation — purge dead Skynet surfaces (first slice) Verification Report

**Phase Goal:** Desktop's landing surface renders the pretty-conversations panel + PrettyView chat surface on session load (NOT the Skynet dashboard), and the left AppRail — its file plus every reference — is deleted from AppShell so the Skynet dashboard, host manager UI, snippets manager, admin console, and any settings surfaces reachable via the AppRail become unreachable from the UI. The invisible-shell technical capability (tab plumbing, terminal renderer, RDP/VNC panes, host CRUD BACKEND API + encrypted-SQLite data layer) is untouched.

**Verified:** 2026-07-23 (HEAD `a17db3f` on branch `feat/tab-title-from-tmux`)
**Status:** human_needed (all automated gates PASS; three runtime UAT items remain for Ashley's walkthrough)
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths — 6 Success Criteria

| # | Success Criterion | Verdict | Evidence |
|---|-------------------|---------|----------|
| 1 | Desktop fresh page-load w/o hash-fragment renders pretty-conversations panel + PrettyView, NOT Skynet dashboard | PASS (automated) — runtime UAT deferred | `tabUtils.tsx:187-194` `case "dashboard": return <PrettyLandingCard />;`. Initial tab seed at `AppShell.tsx:175-183` uses `type: "dashboard"` (load-bearing) with `label: t("nav.conversations.title", …)`. Zero `DashboardTab` imports in tabUtils/AppShell. Ashley's post-deploy visual walk is the final gate (see human_verification #1). |
| 2 | AppRail file + imports gone; tsc clean; test suite green | PASS | `ls src/ui/sidebar/AppRail.tsx` → No such file (deleted commit `c386068`). `grep -rn "AppRail" src/ --include=*.ts --include=*.tsx` returns 8 hits, ALL inside `//` or `{/* */}` comments (verified line-by-line at AppShell.tsx:20,53,78,230,1081,1499 and PrettyConversationsPanel.tsx:23,118). Zero code-line hits. Build-verify §1 tsc exit 0; §2 vitest 524/526 (2 pre-existing ComposeBox baseline failures, zero net-new). |
| 3 | No visible UI navigation path from fresh landing to Skynet dashboard/host manager/snippets/admin/settings | PASS (automated) — runtime UAT deferred | `AppShell.tsx` grep: zero `<AppRail`, zero `<SettingsRow`, zero non-comment `railView`/`handleRailClick`/`editHostInManager`/`openSingletonTab`/`profileDropdownOpen`. `sidebarPanelContent` at 1317-1361 mounts `<PrettyConversationsPanel />` unconditionally as sole child. 11 sibling `{railView === "X"}` conditionals eliminated. Hash-fragment probe outcome deferred to human_verification #1. |
| 4 | Backend `/host/db/*` and `/identities/*` untouched; no backend route deletion | PASS | `git diff b19fc20^..HEAD -- src/backend/` returns empty. `git log --name-only HEAD~14..HEAD \| grep ^src/backend/` = 0 files. Full Phase 11 commit range (14 commits from b19fc20 to a17db3f) touches zero backend files. Build-verify §5 G17 gate confirms. |
| 5 | RDP/VNC/Guacamole sessions launch + render as before; RDP-host-sentinel row opens Guacamole | PASS (automated) — live RDP click-through deferred | `grep -c 'case "rdp"' src/` = 6 (baseline unchanged from Phase 10 tip: main.tsx:84, backend/guacamole/routes.ts:88/277/389, tabUtils.tsx:93/261). `grep -c "onRdpRowClick" src/ui/AppShell.tsx` = 1 (handler mounted with full body at 1350-1357). PrettyConversationsPanel.tsx:107,135,178-179 wires row → onRdpRowClick. Live guacd session verification requires runtime (human_verification #2). |
| 6 | Mobile landing = pretty-conversations panel; mobile back-button flow to PrettyView unchanged | PASS (automated) — runtime UAT deferred | `AppShell.tsx:1321` mounts `<PrettyConversationsPanel variant={isMobile ? "mobile" : "desktop"} …>` with `onConversationSelected={isTouchDevice ? () => navigateToView() : undefined}` — the Phase 10 mobile list→view flow untouched. No SettingsRow at bottom of mobile list (SettingsRow.tsx deleted commit `c3c84be`; `settingsRowSlot` prop removed from PrettyConversationsPanel signature + JSX). Test suite passes at baseline. Live mobile viewport verification deferred to human_verification #3. |

**Score:** 6/6 truths verified by automated evidence; 3 truths (#1, #5, #6) additionally require human UAT for runtime visual/behavioral confirmation (which is intrinsic — the human_verification items are the intended sink per PLAN 04).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/sidebar/AppRail.tsx` | DELETED | ✓ GONE | `ls` returns No such file. Deletion commit `c386068`. |
| `src/ui/sidebar/SettingsRow.tsx` | DELETED | ✓ GONE | `ls` returns No such file. Deletion commit `c3c84be`. |
| `src/ui/features/pretty-view/PrettyLandingCard.tsx` | EXISTS + wired | ✓ VERIFIED | Exists (3305 bytes, created commit `8ae9baf`). Wired into `tabUtils.tsx:26` (import) + `tabUtils.tsx:194` (JSX render call inside case "dashboard"). Uses inline warm-neutral rgba palette (rgba(240,235,224,…), rgba(255,220,170,…) inset) per --color-pv-* adjacency. |
| `src/ui/features/pretty-view/PrettyLandingCard.test.tsx` | EXISTS + passing | ✓ VERIFIED | Exists (2762 bytes). 4/4 tests passing per build-verify §2. |
| `src/ui/AppShell.tsx` | rail-view machine + AppRail/SettingsRow mounts stripped | ✓ VERIFIED | Zero `<AppRail`, zero `<SettingsRow`. Zero non-comment `railView`/`handleRailClick`/`editHostInManager`/`openSingletonTab`/`profileDropdownOpen`. Both `label:` occurrences at 180, 1115 use `nav.conversations.title`. `sidebarHeader` at 1364-1373 hardcodes `nav.conversations.title`. `onRdpRowClick` handler preserved at 1350-1357. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | `settingsRowSlot` prop retired | ✓ VERIFIED | `settingsRowSlot` appears only in 2 comment tombstones (lines 22, 117). Signature + destructure + JSX render site all gone. `type ReactNode` no longer imported (was sole consumer). |
| `src/ui/shell/tabUtils.tsx` | `case "dashboard"` renders `<PrettyLandingCard />` | ✓ VERIFIED | Line 187: `case "dashboard":`; line 194: `return <PrettyLandingCard />;`. `DashboardTab` import removed. `PrettyLandingCard` import at line 26. |
| Scope-fenced panel files (11 sidebar + dashboard tree) | STILL ON DISK | ✓ PRESERVED | 12 spot-checked files (HostsPanel/SnippetsPanel/AdminSettingsPanel/CredentialsPanel/ConnectionsPanel/UserProfilePanel/QuickConnectPanel/SshToolsPanel/HistoryPanel/SessionsPanel/SplitScreenPanel/DashboardTab) all EXIST. Zero imports of any of them in src/. Confirms scope-fence held: files are orphaned but present, awaiting Phase 12+ deletion. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tabUtils.tsx renderTabContent` | `PrettyLandingCard` | import + `case "dashboard"` JSX | WIRED | tabUtils.tsx:26 import + :194 JSX call. Sole render path for the dashboard TabType. |
| `AppShell.tsx sidebarPanelContent` | `PrettyConversationsPanel` | JSX mount | WIRED | AppShell.tsx:1320-1358 unconditional mount, receives 3 callbacks including `onRdpRowClick` and `variant={isMobile ? "mobile" : "desktop"}`. |
| `PrettyConversationsPanel` row click | `AppShell.tsx onRdpRowClick` | prop callback | WIRED | Panel emits `onRdpRowClick(row)` at src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:178-179; AppShell handler at 1350-1357 calls `openTab(host, "rdp")` → RDP tab renders via tabUtils.tsx `case "rdp"` at :261. |
| `AppShell.tsx openTab("rdp")` | `tabUtils.tsx case "rdp"` | tab-type switch | WIRED | tabUtils.tsx:261 `case "rdp"` untouched by Phase 11 (Plan 02 preserved; Plan 03 did not touch tabUtils.tsx). |
| Landing tab seed | PrettyLandingCard render | initial tab type="dashboard" → tabUtils | WIRED | AppShell.tsx:175-183 seeds tab type="dashboard" with conversations label; tabUtils renders PrettyLandingCard for that type. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| PrettyLandingCard | (static content only — "Select a conversation" copy) | none — prop-less, no state, no fetch | N/A (terminal idle state) | ✓ INTENTIONALLY STATIC |
| PrettyConversationsPanel | `hostTree` prop | AppShell.tsx:1325 `hostTree={realHostTree}` — sourced from Phase 7 conversation store (unchanged by Phase 11) | ✓ FLOWING (unchanged from Phase 10) | ✓ VERIFIED |

PrettyLandingCard is intentionally static ("Select a conversation" is the correct terminal-state UI for empty-landing; not a stub awaiting wiring). PrettyConversationsPanel host list data pipeline is unchanged by this phase (PURGE-04 preserves the backend + Phase 7 wiring).

### Behavioral Spot-Checks

Phase 11 is a UI-only deletion phase. Automated spot-checks recorded via Plan 04's build-verify log at HEAD `cbff367` (equivalent to `a17db3f` HEAD state — Plans 04 SUMMARY-only commits do not touch source):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript type-checks clean | `npx tsc --noEmit` | exit 0, zero diagnostics | ✓ PASS |
| Test suite green at baseline | `npx vitest run` | 524/526 (2 pre-existing ComposeBox baseline failures inherited from patches #121+#124; zero net-new Phase 11 regressions) | ✓ PASS |
| Production build succeeds | `npm run build` | exit 0 in 10.94s, `AppShell-*.js` = 75.43 kB (−373 kB / −83% vs Phase 10 tip's 448.82 kB — concrete Ship-of-Theseus evidence) | ✓ PASS |
| PrettyLandingCard component tests | `npx vitest run src/ui/features/pretty-view/PrettyLandingCard.test.tsx` | 4/4 passing (Plan 02 Task 1) | ✓ PASS |
| AppShell persistence contract preserved | `npx vitest run src/ui/AppShell.persistence.test.tsx` | 4/4 passing | ✓ PASS |
| PrettyConversationsPanel test suite (post Test 11 prune) | `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 14/14 passing (was 15 pre-Phase 11; Test 11 pruned commit `b68a821`) | ✓ PASS |

All Plan 04 build-verify §4 grep hygiene gates (G1–G17) PASS. Note: Verifier is honoring the verification-context instruction "NOT re-running the test suite or npm run build — Plan 04's 11-BUILD-VERIFY-LOG.md is the authoritative build-gate record."

### Probe Execution

No project-conventional `scripts/*/tests/probe-*.sh` probes exist for this phase — Phase 11 is UI-only. No PLAN declares probes. SKIPPED (no probes to execute).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| PURGE-01 | 11-01, 11-02, 11-04 | Desktop no-hash → pretty-conversations + PrettyView | ✓ SATISFIED | tabUtils.tsx `case "dashboard"` renders `<PrettyLandingCard />`. AppShell landing tab seed labeled "Conversations". Automated evidence complete; runtime desktop UAT deferred. |
| PURGE-02 | 11-01, 11-03, 11-04 | AppRail file deleted; zero imports; tsc clean; tests green | ✓ SATISFIED | `AppRail.tsx` gone (commit `c386068`). Zero code-line hits for `AppRail` (only comment tombstones). tsc exit 0. Test suite 524/526 baseline. |
| PURGE-03 | 11-01, 11-03, 11-04 | No visible UI path to dashboard/host-manager/snippets/admin/settings | ✓ SATISFIED (automated) | Zero `<AppRail>` mount, zero `<SettingsRow>` mount, zero non-comment rail-view state code lines. Runtime hash-fragment probe deferred to Ashley UAT per Plan 04 checker W-4. |
| PURGE-04 | 11-03 | Backend `/host/db/*` + `/identities/*` untouched | ✓ SATISFIED | `git diff` over full Phase 11 commit range shows zero backend file changes. |
| PURGE-05 | 11-02, 11-04 | RDP/VNC/Guacamole preserved; RDP-sentinel row opens Guacamole | ✓ SATISFIED (automated) | `case "rdp"` hit count = 6 (baseline unchanged). `onRdpRowClick` handler mounted intact. Live guacd click-through deferred to Ashley UAT. |

**No orphaned requirements.** REQUIREMENTS.md maps only PURGE-01..PURGE-05 to Phase 11, and every one is claimed by at least one plan's `requirements` frontmatter AND verified by shipped work.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | (none) | — | Zero blocker anti-patterns detected |

Scanned modified files (AppShell.tsx, PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx, tabUtils.tsx, PrettyLandingCard.tsx, PrettyLandingCard.test.tsx) for TBD/FIXME/XXX (BLOCKERS), TODO/HACK/PLACEHOLDER (WARNINGS), console.log-only handlers, empty JSX/`return null`, and hardcoded empty data flowing to renders. No unreferenced debt markers. All AppRail/SettingsRow/railView residuals are historical `//` line-comments or `{/* */}` JSX block-comment tombstones (Phase 10 Wave 4 policy: acceptable — same policy invoked by both Plan 03 SUMMARY and Plan 04 build-verify §4 methodology note). `PrettyLandingCard` renders static "Select a conversation" — this is the correct terminal-state idle UI, not a stub.

### Human Verification Required

Three runtime observations remain — all intrinsic to the phase goal (visual rendering + live click-through + mobile viewport) and explicitly enumerated in `11-UAT-CHECKLIST.md`:

#### 1. Desktop fresh page-load + hash-fragment probes

**Test:** Chrome + Safari at ≥1400px wide, fresh page-load with no URL hash. Then probe direct URLs `#hosts`, `#admin`, `#snippets`, `#dashboard`.
**Expected:** Landing surface = pretty-conversations sidebar (left) + PrettyLandingCard warm-glass "Select a conversation" idle card (main pane). No Skynet dashboard, no host manager panel, no admin panel visible. Direct hash-fragment nav lands on either 404-equivalent OR PrettyLandingCard fallback (both acceptable per Plan 04 checker W-4). Dead-surface panel must NOT render.
**Why human:** Runtime DOM composition and fragment-routing behavior are not observable by static grep. Automated evidence proves the code paths are wired correctly and the dead-surface imports are gone; the live-render observation is the final gate.

#### 2. RDP click-through end-to-end

**Test:** Tenant with a live RDP-enabled host. Click the RDP-host-sentinel row in the pretty-conversations sidebar.
**Expected:** Guacamole pane opens, connects to guacd (FreeRDP 2.11.7), remote desktop renders, mouse+keyboard interactive — identical to pre-Phase-11 behavior.
**Why human:** Automated gates confirm the `onRdpRowClick` handler is bound (G16 hit count = 1) and tabUtils.tsx `case "rdp"` is preserved (G15 hit count = 6). But actual guacd handshake + remote-desktop-usable requires a live tenant + live RDP host. Documented in 11-UAT-CHECKLIST.md Desktop item 6 + Cross-viewport item 3.

#### 3. Mobile fresh page-load + safe-area check

**Test:** iOS Safari or Skynet PWA (reinstall for safe-area check). Fresh page-load with no URL hash.
**Expected:** Landing = pretty-conversations list view. Tap-row transitions to view screen; browser/PWA back-button returns to list. No gear icon, no settings surface, no bottom nav bar, no SettingsRow at bottom of list. iOS PWA safe-area color follows --color-pv-* palette (not Skynet dark-mode `--background`).
**Why human:** Mobile viewport rendering + touch-flow behavior + PWA safe-area color require a real touchscreen/emulator with PWA install. Documented in 11-UAT-CHECKLIST.md Mobile items 1-7.

### Gaps Summary

No gaps blocking phase closure. All 6 ROADMAP.md Success Criteria are satisfied by observable code evidence + Plan 04 build-verify log. The three human_verification items are intrinsic runtime observations — automated tests cannot observe visual composition, live guacd handshake, or PWA safe-area colors — and are explicitly documented in `11-UAT-CHECKLIST.md` for Ashley's post-deploy walkthrough per the deploy discipline.

### Scope-fence Verification

**Scope-fence: PASS — no violations detected.**

The 12 files enumerated in Section G of `11-01-STRIP-LIST.md` as "Phase 12+ deferred" were spot-checked and all remain on disk:
- src/ui/sidebar/HostsPanel.tsx — EXISTS
- src/ui/sidebar/SnippetsPanel.tsx — EXISTS
- src/ui/sidebar/AdminSettingsPanel.tsx — EXISTS
- src/ui/sidebar/CredentialsPanel.tsx — EXISTS
- src/ui/sidebar/ConnectionsPanel.tsx — EXISTS
- src/ui/sidebar/UserProfilePanel.tsx — EXISTS
- src/ui/sidebar/QuickConnectPanel.tsx — EXISTS
- src/ui/sidebar/SshToolsPanel.tsx — EXISTS
- src/ui/sidebar/HistoryPanel.tsx — EXISTS
- src/ui/sidebar/SessionsPanel.tsx — EXISTS
- src/ui/sidebar/SplitScreenPanel.tsx — EXISTS
- src/ui/dashboard/DashboardTab.tsx — EXISTS

None of these are imported anywhere in `src/` — they are orphaned but preserved, exactly as the "delete AppRail + SettingsRow only in this phase; unreachable-but-present for the rest" contract requires. Phase 12+ owns their deletion.

---

_Verified: 2026-07-23_
_Verifier: Claude (gsd-verifier)_
_HEAD: a17db3f on branch feat/tab-title-from-tmux_
