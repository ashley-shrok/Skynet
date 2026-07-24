# Phase 12 UAT Checklist — Skynet transformation: purge dead frontend surfaces (second slice)

**For:** Ashley
**Post-deploy validation of patch #139 (Phase 12 — Ship-of-Theseus second slice: sidebar panel + dashboard subtree + shell tab-bar-chrome deletion + PURGE-09 writer+reader atomic retirement + dead locale-key strip)**
**Batch context:** Patch #139 is the SECOND Phase-12-cluster patch (patch #138 = Phase 11 first slice; #139 = this Phase 12 slice). **DO NOT deploy standalone.** Batch with patch #138 and any subsequent Phase 13 backend-route purge patches per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23) — see § Post-UAT deploy runbook at the bottom.
**Deploy anchor:** term.gigaashley.click (production) — post-deploy, once Ashley greenlights the batch.
**Design source-of-truth:** `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-CONTEXT.md` (LOCKED — no re-litigation) + `~/.claude/identities/tina/tina.md` § Skynet direction (Ship of Theseus).

**Trace commits (Phase 12 on `feat/tab-title-from-tmux`):**

- Plan 01 (docs — strip-list): `c7ad644` (enumerate strip-list Sections A-K + Section G PURGE-09 writer+reader resolution)
- Plan 05 (Wave 1 — Tab.tsx delete): `5357279` (chore(shell): delete retired Tab.tsx — Phase 12 PURGE-08), `e44272c` (12-05 SUMMARY)
- Plan 02 (Wave 2 — pre-flight refactors, 3 atomic): `42e544b` (inline isFolder), `11ffa95` (relocate 4 session-launcher files), `29b52ab` (swap tabUtils network_graph render), `df8e87a` (12-02 SUMMARY)
- Plan 03 (Wave 3a — sidebar + PURGE-09, 4 atomic): `fc283d2` (10 simple leaves + AppShell reader teardown + AppShell double-shift gate unconditional), `d984cdd` (Admin subtree — 7 files), `4080e9f` (HostManager subtree — 12 files + types cleanup), `8d46043` (SidebarTree.tsx), `523cc87` (12-03 SUMMARY)
- Plan 04 (Wave 3b — dashboard subtree + FullScreenAppWrapper resolution): `d6d3886` (swap FullScreenAppWrapper unauth branch for PrettyLandingCard), `090cdfb` (delete src/ui/dashboard/ subtree — 17 files, 4118 lines), `479ec07` (12-04 SUMMARY)
- Plan 06 (Wave 4 — locale strip, 2 atomic): `72a80b8` (batch-1 pinAppRail+pinAppRailDesc), `5115bb9` (batch-2 nav.* dead keys), `728beef` (12-06 SUMMARY)
- Plan 07 (Wave 5 — docs: build-verify + UAT + patch #139): this checklist + `12-BUILD-VERIFY-LOG.md` + `12-PATCHES-MD-ENTRY.md` + `12-07-SUMMARY.md`

**Build-verify status (per `12-BUILD-VERIFY-LOG.md`):**
- `npx tsc --noEmit` — exit 0 ✅
- `npx vitest run` — 524/526 (byte-identical Phase 11 baseline; 2 pre-existing ComposeBox failures inherited; zero net-new Phase 12 regressions) ✅
- `npm run build` — exit 0 in 17.14s ✅
- All 70 grep hygiene gates PASS ✅
- **AppShell chunk delta: −1.19 kB / −1.58%** (Phase 11 tip: 75.43 kB → Phase 12 tip: 74.24 kB — modest by design, STRIP-LIST Section K.5 prediction)
- **INDEX chunk delta: −124.63 kB / −38.9%** (Phase 11 tip: 320.61 kB → Phase 12 tip: 195.98 kB — Rolldown's async-code-split unreachable chunks finally collapsed out of the graph after Phase 12 deleted the actual files)
- **Cumulative Phase 11 + Phase 12 vs Phase 10 tip:** AppShell −374.58 kB / −83.4% (raw), gzip −67.42 kB / −76.9%. Ship-of-Theseus purge landed in two waves.

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All 🚨 items in Non-Negotiable sections (Desktop 1-10 + Mobile 11-17 + Cross-viewport 18-22) pass** → **greenlight patch #139 for the batched Phase 11 + Phase 12 (patches #138 + #139) purge cluster deploy** OR **hold patch #139 in the batch** until the next grouped-semantic-unit is ready (e.g., Phase 13 backend-route purge). Per the fleet-standing "batch patches into meaningful deploys" rule, THE DEFAULT ANSWER IS HOLD. Only greenlight the batch deploy if there's a specific reason (Ashley wants to smoke-test the full Skynet purge on prod before Phase 13 lands, or something is actively broken in prod that Phase 11 + Phase 12 fixes). Then help Tina pin patches #138 and #139: paste both `11-PATCHES-MD-ENTRY.md` and `12-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` at the next ordinal positions (check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`). Bump the count line near the top from "ONE HUNDRED THIRTY-SEVEN" to "ONE HUNDRED THIRTY-NINE" (or adjust for any interstitial pinned first). Commit the pin (`docs(patches): pin patches #138 + #139 — Skynet transformation first + second slices`). Then `/close skynet-transformation-purge-dead-surfaces` if Phase 13 is not required OR leave open if Phase 13 backend-route purge is still ahead in the bounty's todo set.

- [ ] **Any 🚨 item fails** → note the failing item and observed-vs-expected behavior. Decide by severity: if the failure is a visual regression only (wrong padding, minor color hue drift), mark it for a follow-up polish patch and consider the deploy conditionally-good. If the failure is functional (landing renders dashboard cards / Skynet stats bars instead of PrettyLandingCard, sidebar panels still visible, dead-surface panel renders at `#hosts` / `#admin` / `#snippets` / `#dashboard` / `#network_graph`, RDP row click doesn't open Guacamole, tab strip visible, NewSessionDialog pencil doesn't open the picker, CommandPalette double-shift doesn't work, on-screen modifier bar gone from Terminal + Guacamole, i18n falls back to key names instead of translated labels), route back to the specific Plan/Task via the "Failure → route-back" table.

- [ ] **Nothing to log to `deferred-items.md`** — Phase 12 has no polish items; every item is a non-negotiable purge assertion. The 2 orphaned type-declaration residuals (`AlertCardProps` + `AlertManagerProps` in `src/types/index.ts:681,686`) noted in `12-BUILD-VERIFY-LOG.md § Deferred Issues` are pure dead code (zero runtime impact — TypeScript erases them at build time) and do NOT block deploy; they're a hygiene follow-up for a Phase 13 sweep or a quick-task chore commit.

## How to use this checklist

Work through top-to-bottom on BOTH viewports (desktop + iPhone). Each 🚨 item has an action + expected result + "if this fails" note. Mark [x] as you go.

**Section order:**
1. Desktop non-negotiable — items 1-10 (blocking) — INCLUDES hash-fragment probes for `#hosts`, `#admin`, `#snippets`, `#dashboard`, `#network_graph` at item 9 with dual-outcome-acceptable framing (per Phase 11 checker W-4 fix precedent)
2. Mobile (iPhone) non-negotiable — items 11-17 (blocking)
3. Cross-viewport regression — items 18-22 (blocking; Phase 6/7/10/11 behaviors that must survive)
4. Failure → route-back table
5. Post-UAT deploy runbook (only if everything's green AND Ashley greenlights the batch) — cites `~/.claude/identities/tina/deploy-runbook.md` as authoritative per Phase 11 checker B-2 fix precedent

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on a wide desktop window** (1400px+) AND in **Skynet on your iPhone** (PWA-installed after patch #125, or Mobile Safari fallback).
2. Have at least 2 running tmux identity sessions on distinct hosts, plus at least one RDP-enabled host for item 6 + item 16 + item 20 walks.
3. Clear session storage on desktop for a truly-fresh page-load (item 1): DevTools → Application → Session Storage → Clear. Alternatively use a fresh Chrome incognito window.
4. On iPhone: fully close Skynet PWA (swipe up from app switcher) before item 11's fresh page-load.
5. Confirm your `localStorage.commandPaletteShortcutEnabled` had been unset OR set to `"true"` pre-purge — post-purge the value is ignored, but this is a paranoid pre-check to make sure double-shift works for you specifically (item 10 gates it).

---

## Non-negotiable — Desktop UAT (wide window 1400px+)

### 1. Fresh page-load lands on PrettyLandingCard (Phase 11 preservation — Phase 12 does not touch landing)

> **Contract:** Desktop fresh page-load with no URL hash-fragment and no persisted tab state → main pane renders the Phase 11 warm-glass PrettyLandingCard empty-landing card. Phase 12 preserves this behavior (Phase 11 shipped it via `case "dashboard"` → `<PrettyLandingCard/>` swap in `tabUtils.tsx`, which Phase 12 leaves untouched apart from the additional `case "network_graph"` swap in Plan 02 Task 3).

- [ ] 🚨 **Fresh page-load at `https://term.gigaashley.click/`** (no hash, session storage cleared per Setup 3). Wait ~2s for `/sessions/list` to resolve. Expected: main pane shows the same warm-glass empty-landing card as Phase 11 (subtle `rgba(240, 235, 224, 0.9)` warm-cream text on `linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))` glass background with 20px backdrop-blur). **NO** host cards. **NO** stats bars. **NO** recent-sessions grid. **NO** "Dashboard" heading. **NO** "Skynet" branding. **If: Skynet dashboard renders** → route back to Phase 11 Plan 02 Task 2 (`22b5cfb`) — Phase 12 doesn't own this landing swap, so if it regressed, the regression came from Phase 12's touches to adjacent files. Check `git diff cbff367..HEAD -- src/ui/shell/tabUtils.tsx` for any inadvertent revert of the `case "dashboard"` block.

### 2. Sidebar is the pretty-conversations panel — no sidebar panels visible anywhere

> **Contract:** The sidebar is the same pretty-conversations panel Phase 10 shipped + Phase 11 kept. Phase 12 deleted 30 sidebar panel FILES (`HostsPanel`, `SessionsPanel`, `CredentialsPanel`, `QuickConnectPanel`, `SshToolsPanel`, `SnippetsPanel`, `HistoryPanel`, `SplitScreenPanel`, `ConnectionsPanel`, `UserProfilePanel`, `AdminSettingsPanel` + 6 Admin subtree files, `HostManager` + 11 HostManager subtree files, `SidebarTree`) but the AppShell mounts were already stripped in Phase 11. Verifying no visible regression.

- [ ] 🚨 **Confirm sidebar content matches Phase 11 baseline.** Chunky pretty-conversations rows, 40px hue-ring avatars, header with the pencil icon only (no gear per Phase 11 patch #133 + Phase 11 `SettingsRow` retirement + Phase 12 `UserProfilePanel` deletion), RDP-sentinel section at the bottom with "Remote desktop" divider chip + Monitor-glyph avatars. **If: any old-style panel visible** (HostsPanel list, SessionsPanel table, snippets manager, admin console, host manager, host editor, etc.) → the AppShell mount that Phase 11 stripped somehow got restored (unlikely — file-delete alone shouldn't do this). Grep the deployed bundle: `docker exec skynet grep -c 'HostsPanel\|AdminSettingsPanel\|HostManager' /app/html/assets/*.js` — should be 0 or comment-only.

### 3. No tab bar chrome at the top of the app shell (PURGE-08 runtime gate)

> **Contract:** Phase 12 Plan 05 deleted `src/ui/shell/Tab.tsx` (442 lines — the Skynet visible tab-strip renderer with per-tab-type icons, X-close, split icon). Phase 11's landing swap had already implicitly retired the mount; Plan 05 confirmed 0 import consumers and deleted the file. The visible top-of-window tab strip must NOT appear.

- [ ] 🚨 **Look at the top of the app shell.** Expected: no horizontal tab bar with "Terminal / RDP / Dashboard / ..." tabs. No X-close buttons on tabs. No split icons. **NO** Skynet tab bar chrome visible anywhere. The main pane transitions come from clicking pretty-conversations rows in the sidebar (identity conversations) or clicking RDP-sentinel rows in the sidebar (Guacamole panes). **If: tab bar visible** → route back to Plan 05 or Phase 11 Plan 03 Task 2 (AppShell surgery). `test ! -f src/ui/shell/Tab.tsx` should pass on the deployed bundle host. If the FILE was somehow restored, `git log --diff-filter=A --oneline -- src/ui/shell/Tab.tsx` should show only the original creation commit and 0 post-`5357279` recreations.

### 4. Clicking an active conversation row opens PrettyView

> **Contract:** Existing Phase 6-11 behavior. Click an active tmux-identity conversation row → PrettyView chat surface renders in the main pane. Phase 12 does NOT touch pretty-view internals (scope-fence per CONTEXT.md).

- [ ] 🚨 **Click an identity row** (any active tmux session). Expected: main pane transitions from PrettyLandingCard to the pretty-view chat surface for that identity. Row acquires selected-state hue-lift. Existing conversation history renders. Composer at the bottom is functional (type-ahead, ThumbsUp send, etc.). **If: nothing happens** → Phase 12's Plan 03 sidebar deletions somehow damaged the `onConversationSelected` handler wiring in AppShell.tsx. Grep AppShell.tsx for `onConversationSelected` to verify the handler is still bound to PrettyConversationsPanel.

### 5. Header pencil opens NewSessionDialog (TG-09 preservation + Phase 12 Plan 02 Task 1 refactor validation)

> **Contract:** Phase 6-7 + Phase 10 + Phase 11 behavior. Click the pencil icon in the sidebar header → NewSessionDialog opens (Radix modal with filterable host list). Phase 12 Plan 02 Task 1 **modified** `src/ui/sidebar/NewSessionDialog.tsx` in place: inlined the `isFolder` type-guard as a module-private function (replacing the `import { isFolder } from "@/sidebar/SidebarTree"` which would break when SidebarTree.tsx was deleted in Plan 03 Task 4). This is a load-bearing behavior-preservation refactor.

- [ ] 🚨 **Click the pencil.** Expected: dialog opens with the filterable host list + optional session-name input + Cancel/Open buttons. Same modal as Phase 6/7/10/11 — visually and functionally byte-preserved. **Type in the search box** — filter behavior should work (tree walk, folder collapse/expand). **Pick a host, hit Open** — dialog closes; new session opens. **If: dialog doesn't open** OR **filter is broken** OR **session-name auto-fallback broken (TG-09)** → route back to Plan 02 Task 1 (`42e544b`) — the inline isFolder refactor may have regressed. `grep -cE '^\s*function isFolder\s*\(' src/ui/sidebar/NewSessionDialog.tsx` should be 1; `grep -c 'from "@/sidebar/SidebarTree"' src/ui/sidebar/NewSessionDialog.tsx` should be 0.

### 6. Clicking an RDP-host-sentinel row opens Guacamole (PURGE-05 runtime gate — carried from Phase 11)

> **Contract:** Phase 7 wired RDP-host-sentinel rows in the pretty-conversations panel to open Guacamole panes. Phase 11 explicitly preserved this (PURGE-05 acceptance); Phase 12 does NOT touch guacd/RDP wiring. The `onRdpRowClick` handler in AppShell is verbatim from pre-Phase-12.

- [ ] 🚨 **Scroll to the RDP-sentinel section at the bottom of the sidebar.** Click an RDP-enabled host row (Monitor-glyph avatar, "Remote desktop" divider above the section). Expected: main pane opens a new Guacamole tab. **guacd actually connects** — the remote-desktop canvas appears, keyboard input works, mouse events work. **This is the definitive PURGE-05 runtime gate — automated tests cannot verify guacd connection.** **If: nothing happens** → grep AppShell.tsx for `onRdpRowClick` (should return 1 hit, handler mounted on PrettyConversationsPanel with body verbatim; verified by `12-BUILD-VERIFY-LOG.md` G68). **If: RDP tab opens but the on-screen modifier bar is gone** → route back to `features/keyboard/` protection failure (see item 20 for the deep check). Phase 12 explicitly PROTECTED `features/keyboard/{Toolbar,sshAdapter,guacamoleAdapter,inputAdapter}` — if it went missing, the file-existence gates G35-G39 would have failed at Plan 07 build-verify (they didn't).

### 7. Double-shift opens the CommandPalette — UNCONDITIONALLY (PURGE-09 runtime gate)

> **Contract:** Phase 12 Plan 03 Task 1 (`fc283d2`) delivered PURGE-09 as writer+reader atomic retirement. The UserProfilePanel toggle (writer) was deleted with the file; the AppShell.tsx `commandPaletteShortcutEnabled` state + gate expression + effect-dep + storage-event listener useEffect (reader) were torn out in the same commit. The double-shift → open CommandPalette path is now UNCONDITIONAL per Section G.4 recommendation (user default was `true`; the gate had no user-facing surface remaining to disable it, so hardcoding `true`-equivalent behavior is byte-preserved for the retained user population).

- [ ] 🚨 **Tap Shift twice rapidly** (within ~400ms). Expected: CommandPalette opens with the fleet session list (session-launcher relocation targets — retained visual). **If: nothing happens** → Section G.4's `lastShiftTime` retention may have regressed. Grep `src/ui/AppShell.tsx` for `lastShiftTime` — should return 3 hits (declaration + comparison + set — verified in build-verify log G55). Also grep for `commandPaletteShortcutEnabled` — should return 0 non-comment hits (verified G53). If BOTH gates pass in build-verify but the runtime behavior is broken, the deploy may have shipped a stale bundle (docker layer cache-hit) — check `docker exec skynet grep -c 'commandPaletteShortcutEnabled' /app/html/assets/*.js` = 0 to confirm the fresh bundle actually shipped.
- [ ] 🚨 **In the palette, search for a fleet session** (type-ahead). Expected: results appear in real-time from `filteredLaunchableHosts`. Click one to open a session. **If: NewSessionHostChips or RemoteHostChips don't render** in the palette → route back to Plan 02 Task 2 (`11ffa95`) — the CommandPalette import rewire may have shipped broken. Verified in Plan 02 SUMMARY: `grep -c 'from "@/features/session-launcher/' src/ui/shell/CommandPalette.tsx` = 4.

### 8. No gear icon anywhere (Ashley's "no settings" lock — carried from Phase 11, tightened by Phase 12 UserProfilePanel deletion)

> **Contract:** Phase 11 CONTEXT.md § scope-fence discipline: "No settings UI anywhere. Not in this phase, not as a 'small mobile preferences pane,' not as a 'settings icon in the corner.' Zero." Phase 12 tightened this by DELETING UserProfilePanel.tsx entirely (the file that hosted the `commandPaletteShortcutEnabled` toggle + any other user-preference UI). Every visible-UI entry point to any settings/preferences surface is gone.

- [ ] 🚨 **Sweep the entire desktop UI for any gear icon.** Header of sidebar: no gear (Phase 11 patch #133 dropped it). Anywhere in main pane: no gear. Anywhere in tab bar area (Phase 12 deleted the tab bar entirely per item 3): no gear. Top-left chevron corner: no gear. **If: gear icon visible anywhere** → route to Phase 12 Plan 03 Task 1 (`fc283d2`) — the UserProfilePanel deletion should have removed every user-preference entry point; if one survived, it means a code path was missed in the strip-list.
- [ ] 🚨 **Verify no keyboard shortcut opens a settings surface.** Try common patterns: `Cmd+,` (macOS-standard settings shortcut), `Ctrl+,` (Windows/Linux), `Cmd+Shift+S`, `?` for help menu, `Cmd+K` (Slack-style command surface). Expected: nothing happens OR opens an unrelated existing shortcut (double-shift command palette is preserved — item 7). **If: any settings surface opens** → grep AppShell.tsx for keyboard-shortcut wiring; the strip-list may have missed a shortcut handler.

### 9. Hash-fragment dead-surface unreachability (per Phase 11 checker W-4 fix — the critical PURGE-06/07 runtime gate)

> **Contract:** No settings menu, no admin surface, no host manager, no snippets manager, no dashboard, no network graph is reachable via any click, keyboard shortcut, or URL. Direct hash-fragment navigation to a dead surface's URL must NOT render the corresponding dead-surface panel. Both a 404-equivalent (blank / error / fallback) AND landing on the PrettyLandingCard warm-glass card are ACCEPTABLE outcomes — the load-bearing requirement is that the dead-surface panels MUST NOT render.

Walk each of the five direct-hash-fragment probes below. For each: type the URL into the browser address bar, press Enter, wait ~2s for any async state to settle. Observe the main pane content + the sidebar content + browser DevTools console for warnings.

- [ ] 🚨 **`https://term.gigaashley.click/#hosts`** — expected: 404-equivalent (blank main pane, or error card, or fallback) OR PrettyLandingCard warm-glass empty card. **NOT** the HostManagerPanel or any host list / add-host CTA / edit-host modal chrome / credentials editor. If HostManagerPanel renders → **route back to Phase 12 Plan 03 Task 3** (`4080e9f`) — a HostManager consumer survived. `test ! -f src/ui/sidebar/HostManager.tsx` should pass; the deployed bundle should have 0 `HostManager` mentions.
- [ ] 🚨 **`https://term.gigaashley.click/#admin`** — expected: 404-equivalent OR PrettyLandingCard. **NOT** the AdminSettingsPanel (user list, permissions matrix, system-config editor, etc.). If AdminSettingsPanel renders → **route back to Phase 12 Plan 03 Task 2** (`d984cdd`) — an Admin* consumer survived. `test ! -f src/ui/sidebar/AdminSettingsPanel.tsx` should pass.
- [ ] 🚨 **`https://term.gigaashley.click/#snippets`** — expected: 404-equivalent OR PrettyLandingCard. **NOT** the SnippetsPanel (snippet list, editor, tag manager). If SnippetsPanel renders → **route back to Phase 12 Plan 03 Task 1** (`fc283d2`) — the SnippetsPanel file deletion didn't land or a consumer survived.
- [ ] 🚨 **`https://term.gigaashley.click/#dashboard`** — expected: PrettyLandingCard warm-glass empty card (this is the intended outcome — the `"dashboard"` TabType identifier is preserved in `src/types/ui-types.ts` as a load-bearing fallback per Phase 11 Plan 02 decision + Phase 12 CONTEXT.md § scope-fence, but its render path returns `<PrettyLandingCard/>` — verified by build-verify log G69). **NOT** the Skynet DashboardTab with host cards, stats bars, recent-sessions grid. If DashboardTab renders → **route back to Phase 11 Plan 02 Task 2** (`22b5cfb`) OR Phase 12 Plan 04 (`090cdfb` deleted the `DashboardTab.tsx` file, so the source can't render — a rendering would mean stock upstream shipped instead of the patched image).
- [ ] 🚨 **`https://term.gigaashley.click/#network_graph`** — expected: PrettyLandingCard warm-glass empty card (Phase 12 Plan 02 Task 3 swapped `case "network_graph"` → `<PrettyLandingCard/>` in tabUtils.tsx; verified via `12-02-SUMMARY.md`). **NOT** the NetworkGraphCard render. If NetworkGraphCard renders → **route back to Phase 12 Plan 02 Task 3** (`29b52ab`) — the case-body swap didn't land or shipped stock. `grep -c 'NetworkGraphCard' src/ui/shell/tabUtils.tsx` should be 0.

**Acceptance framing:** for each of the five probes, both possible outcomes (404-equivalent OR PrettyLandingCard) are acceptable — the requirement is that the CORRESPONDING DEAD-SURFACE PANEL must not render. This dual-outcome acceptance exists because the URL-fragment router is not modified in Phase 12 (that's a Phase 13 scope item — deleting the router branches that handle these fragments), and the fallback behavior at each unhandled fragment is code-path-specific (some fragments may fall through to the initial-tab-seed which now uses PrettyLandingCard; others may hit the closeTab fallback which also uses PrettyLandingCard). Both fall-through outcomes prove the same thing: the dead-surface panels are unreachable from any UI path.

### 10. Existing keyboard shortcuts unchanged

- [ ] 🚨 **Double-shift** opens the command palette (existing Phase 6+ shortcut; Phase 12 Plan 03 Task 1 explicitly preserved this — see item 7 for the full gate).
- [ ] 🚨 **Ctrl+Shift+O** (or the equivalent pretty-view toggle if it's a different combo) still toggles pretty-mode in terminal panes when a session is active. Not touched by Phase 12 (protected `features/keyboard/` subtree owns this).
- [ ] 🚨 **Ctrl+M** opens the message-queue drawer in a terminal pane. Not touched by Phase 12.

---

## Non-negotiable — Mobile UAT (iPhone / Skynet PWA)

### 11. Fresh page-load lands on pretty-conversations list

> **Contract:** Phase 10 behavior + Phase 11 preservation — mobile fresh page-load renders the pretty-conversations list view (not the view screen). Phase 12 does NOT change mobile landing.

- [ ] 🚨 **Fully close Skynet PWA** (swipe up from app switcher), then reopen. Expected: the mobile list screen shows the chunky pretty-conversations rows with 48px hue-ring avatars, header with compact pencil-only. Same as post-Phase-11 baseline. **If: view screen renders instead of list** → Phase 6 Plan 06-03 mobile-landing behavior regressed (should not happen — Phase 12 doesn't touch mobile navigation).

### 12. Tap conversation row → view screen opens

- [ ] 🚨 **Tap any identity row.** Expected: full-screen view transition to the pretty-view chat surface for that identity (mobile-native list→view screen replacement, no peek/overlay).

### 13. Top-left back button returns to list

- [ ] 🚨 **On the view screen, tap the top-left back button.** Expected: transitions back to the list view. Standard mobile back navigation, unchanged from Phase 6/10/11.

### 14. No bottom navigation bar

> **Contract:** Phase 6 Plan 06-03 deleted the MobileBottomBar unconditionally (TG-07). Phase 12 does NOT touch this — but the sidebar panel deletions (10 simple leaves + Admin + HostManager subtrees) should not have accidentally revived any bottom-nav mount.

- [ ] 🚨 **Look at the bottom of the mobile viewport.** No bottom nav bar with icons for Hosts / Snippets / Admin / etc. Only the safe-area padding from patch #126.

### 15. No SettingsRow at the bottom of the pretty-conversations list (Ashley's "no settings" lock — Phase 11 mobile enforcement carried forward)

> **Contract:** Phase 11 Plan 03 Task 4 (`c3c84be`) deleted `src/ui/sidebar/SettingsRow.tsx`. Phase 12 does NOT touch this — but the pretty-conversations panel modification in Phase 11 Plan 03 Task 3 (`992bee3`) dropped the `settingsRowSlot` prop; verifying no regression.

- [ ] 🚨 **Scroll to the very bottom of the mobile pretty-conversations list** (past the RDP-sentinel section). Expected: below the last RDP row, ONLY the safe-area padding renders (from patch #126). **NO** SettingsRow with a gear icon, NO settings label, NO settings entry point. **If: SettingsRow visible** → this would mean Phase 11's deletion regressed, which is impossible without an explicit revert — check `git log --oneline -- src/ui/sidebar/SettingsRow.tsx` for any post-`c3c84be` creation.

### 16. RDP row tap opens Guacamole (PURGE-05 mobile runtime gate)

- [ ] 🚨 **Scroll to the RDP-sentinel section.** Tap an RDP host row. Expected: full-screen view transition to the Guacamole pane; guacd connects; the remote-desktop canvas appears; **the on-screen modifier bar renders at the bottom** (Ctrl / Shift / Alt / etc. — this is the `features/keyboard/Toolbar.tsx` PROTECTED file that Phase 12 explicitly retained per STRIP-LIST Section J). Same runtime PURGE-05 verification as desktop item 6, but on mobile. **If: modifier bar gone** → route to Phase 12 Plan 03 protection failure (see items 20 + 22 for deep checks).

### 17. iOS PWA reinstall — safe-area seam still gray

> **Contract:** Phase 10 patch #126 rebased the mobile safe-area seam to `#0a0b12`. Phase 11 preserved. Phase 12 does NOT touch safe-area handling; paranoid cross-check.

- [ ] 🚨 **Remove Skynet from the iPhone home screen** (long-press → Remove App → Delete from Home Screen). Then in Mobile Safari, navigate to `https://term.gigaashley.click`, tap Share → Add to Home Screen. Reopen from the fresh install. Expected: the top safe-area seam (above the status bar) and the bottom safe-area seam (above the home indicator) render as `#0a0b12` gray — no white flash, no color mismatch.

---

## Cross-viewport regression — Phase 6/7/10/11 behaviors that must survive

### 18. Message-queue drawer still works

- [ ] 🚨 **Open any active tmux-identity session.** Press **Ctrl+M**. Expected: the per-pane message queue drawer opens at the bottom of the terminal pane. **Press Ctrl+M again** — drawer closes. Not touched by Phase 12.

### 19. Pretty-view compose box + WipBubble + session-holding overlay behave

- [ ] 🚨 **In an active session's pretty-view, type a message + hit ThumbsUp send.** Expected: message dispatches; WipBubble spinner shows briefly; if the identity is holding a session, the session-holding overlay behaves per Phase 2-11 baseline. Phase 12 does NOT touch pretty-view internals (scope-fence per CONTEXT.md).

### 20. RDP session actually usable (PURGE-05 deep check + `features/keyboard/` PROTECTED verification)

- [ ] 🚨 **In the RDP tab from item 6 (desktop) or item 16 (mobile), interact with the remote desktop.** Type on the remote keyboard. Click. Move windows around on the remote OS. **Verify the on-screen modifier bar (Ctrl / Shift / Alt / Windows keys)** at the bottom of the pane responds to touch/click — the modifier keys should visually toggle and inject correctly into the remote OS. Expected: the remote desktop is USABLE — not just "the canvas rendered." Automated tests don't cover this; runtime UAT is the only proof. **If: modifier bar missing OR modifier keys don't inject** → the Phase 12 STRIP-LIST Section J PROTECTED `features/keyboard/{Toolbar,sshAdapter,guacamoleAdapter,inputAdapter}` files may have been accidentally deleted or their imports broke. Verified in build-verify log G35-G39 (all files present) + G52 (Terminal + Guacamole consumers still importing) — if runtime differs, deploy shipped a stale bundle.

### 21. Session persistence — switch A → B → A, no reconnect

- [ ] 🚨 **Click identity A. Scroll in pretty-view. Click identity B. Click identity A again.** Expected: INSTANT switch back to A. Scroll position preserved. Terminal buffer preserved. This proves the T-06-02-01 tabNodesRef DOM-move mechanism (patch #35) survived the Phase 11 + Phase 12 AppShell surgery. **If: reconnect indicator or scroll reset** → the mount-lifecycle contract regressed somewhere in Phase 12 Plan 03 Task 1's AppShell surgery (`fc283d2`). Route back to that commit.

### 22. Fleet-native rows on fresh page-load (Phase 7 lock)

- [ ] 🚨 **Fresh incognito window → identity rows appear for fleet-discovered tmux sessions** (from the one-shot `/sessions/list` fetch — Phase 7 Plan 07-01 lock). Clicking a fleet-only row transparently attaches (Phase 7 TG-14). Not touched by Phase 12.

### 23. i18n retained keys still resolve to translated labels (PURGE-10 runtime gate)

- [ ] 🚨 **Switch the browser language** (if you have a non-English locale installed as a Skynet language pack — e.g., de_DE, fr_FR, ja_JP) OR **manually flip your Skynet language preference** if there's a UI for it (there isn't, post-Phase-12 — settings are gone). Alternative: just verify in the default en.json language that all retained UI labels render as translated strings (not as bare key names like `nav.title` or `nav.conversations.title`). Expected: **All 10 retained `nav.*` leaf keys** (`home`, `terminal`, `serverStats`, `fileManager`, `docker`, `tunnels`, `close`, `cancel`, `confirmClose`, `hostTabTitle`) + **5 retained `nav.conversations.*` sub-keys** (`title`, `empty`, `pin`, `unpin`, `backToList`) render their translated labels, not the raw key. **If: any retained label shows as `nav.somekey` bare string** → Phase 12 Plan 06 over-stripped a key that was still a consumer. Route back to Plan 06 batch-2 (`5115bb9`). Build-verify log G60 + G61 confirm all retained keys still present in en.json; if they render as raw keys, this means the app is fetching a stale cached translation bundle (hard-refresh + wait for the new locale chunk).

---

## Sign-off

| Item | Status | Ashley notes |
|------|--------|--------------|
| 1-10 (Desktop non-negotiable) | ⬜ | |
| 11-17 (Mobile non-negotiable) | ⬜ | |
| 18-23 (Cross-viewport regression) | ⬜ | |

**Ashley signature:** ______________  **Date:** ______________
**Deploy verdict (circle one):** GOOD (batch #138 + #139 with Phase 13+) / GOOD (deploy #138 + #139 now, hold Phase 13+ for later) / STANDALONE-DEPLOY-139 (against the default batching rule — explicit reason:____) / ROLLBACK

---

## Failure → route-back table

| Symptom | Root Plan / Task | Route-back target |
|---|---|---|
| Landing shows Skynet dashboard cards / stats bars (not PrettyLandingCard) | Phase 11 Plan 02 Task 2 OR Phase 12 Plan 04 | Re-verify Phase 11 commit `22b5cfb` (the `case "dashboard"` swap in `tabUtils.tsx`). If OK, verify Phase 12 `090cdfb` actually landed (`test ! -d src/ui/dashboard` should pass on the deployed bundle host) — a rendering of DashboardTab would mean stock upstream shipped instead of the patched image |
| Sidebar panel (HostsPanel / SnippetsPanel / AdminSettingsPanel / HostManager / etc.) still visible | Phase 12 Plan 03 (Task 1 / 2 / 3) | Re-verify commits `fc283d2` (10 leaves) + `d984cdd` (Admin) + `4080e9f` (HostManager) — all files should be `test ! -f` PASS. If files are gone but panel still renders, an AppShell mount survived Phase 11 Plan 03 Task 2 (`cf7fe27`) — grep AppShell.tsx for the panel name |
| Skynet tab bar chrome visible at top of window | Phase 12 Plan 05 OR Phase 11 Plan 03 Task 2 | Re-verify commit `5357279` — `test ! -f src/ui/shell/Tab.tsx` should pass. If the FILE was somehow restored, `git log --diff-filter=A --oneline -- src/ui/shell/Tab.tsx` should show only the original creation commit and 0 post-`5357279` recreations |
| RDP row click no longer opens Guacamole | Phase 11 Plan 03 Task 2 OR Phase 12 Plan 03 Task 1 | `grep -c "onRdpRowClick" src/ui/AppShell.tsx` should be 1; body should be preserved verbatim; verified in Phase 12 build-verify log G68 |
| RDP tab opens but on-screen modifier bar (Ctrl / Shift / Alt) missing | Phase 12 Plan 03 (any task) — `features/keyboard/` scope-fence breach | STOP — Phase 12 was NOT supposed to touch `features/keyboard/`. Bisect the Plan 03 commits (`fc283d2`, `d984cdd`, `4080e9f`, `8d46043`) to find the breach. Build-verify gates G35-G39 (features/keyboard/* files present) + G52 (5 consumer imports) should have caught this — if runtime differs from build-verify, deploy shipped a stale bundle |
| Double-shift no longer opens CommandPalette | Phase 12 Plan 03 Task 1 | Re-verify `fc283d2` — the `lastShiftTime` useRef + outer double-shift `useEffect` + `setCommandPaletteOpen` should all be intact. Verified in build-verify G55 (`lastShiftTime` count = 3) |
| CommandPalette opens but NewSessionHostChips / RemoteHostChips don't render | Phase 12 Plan 02 Task 2 | Re-verify `11ffa95` — `grep -c 'from "@/features/session-launcher/' src/ui/shell/CommandPalette.tsx` should be 4 (per Plan 02 SUMMARY). If the imports still point at `@/dashboard/`, the relocation didn't land; the deployed bundle would fail-to-resolve since `src/ui/dashboard/` is deleted |
| NewSessionDialog pencil doesn't open the picker OR filter tree walk broken | Phase 12 Plan 02 Task 1 | Re-verify `42e544b` — `grep -cE '^\s*function isFolder\s*\(' src/ui/sidebar/NewSessionDialog.tsx` should be 1; `grep -c 'from "@/sidebar/SidebarTree"' src/ui/sidebar/NewSessionDialog.tsx` should be 0. If the inline refactor regressed, isFolder wouldn't resolve at runtime |
| Sidebar renders blank (nothing shows in the sidebar column) | Phase 12 Plan 03 Task 1 OR Phase 11 Plan 03 Task 2 | The PrettyConversationsPanel mount inside AppShell was accidentally removed. Grep AppShell.tsx for `<PrettyConversationsPanel` — should be exactly 1 hit |
| tsc broken / build broken | Any Phase 12 Plan | Bisect via `git log --oneline cbff367..HEAD` — each of the 12 Phase 12 code commits has its own per-commit tsc + targeted vitest gate (verified in the corresponding plan SUMMARY) |
| Hash-fragment `#hosts` still renders HostManagerPanel | Phase 12 Plan 03 Task 3 | Re-verify HostManager subtree deletion `4080e9f`. If the file is gone but panel renders, this means URL-router branches survived (Phase 13 scope) — but with the FILE gone, the render should fail with a module-resolution error, so the runtime "still renders" would mean stock upstream shipped |
| Hash-fragment `#admin` still renders AdminSettingsPanel | Phase 12 Plan 03 Task 2 | Same pattern — verify `d984cdd`; `test ! -f src/ui/sidebar/AdminSettingsPanel.tsx` |
| Hash-fragment `#snippets` still renders SnippetsPanel | Phase 12 Plan 03 Task 1 | Same pattern — verify `fc283d2`; `test ! -f src/ui/sidebar/SnippetsPanel.tsx` |
| Hash-fragment `#dashboard` still renders DashboardTab (Skynet stats bars, host cards) | Phase 11 Plan 02 Task 2 OR Phase 12 Plan 04 | Re-verify Phase 11 `22b5cfb` — the `case "dashboard"` block in tabUtils.tsx should render `<PrettyLandingCard/>`. Additionally verify Phase 12 `090cdfb` — `test ! -d src/ui/dashboard` should pass. Both together prove the swap holds and the source is gone |
| Hash-fragment `#network_graph` still renders NetworkGraphCard | Phase 12 Plan 02 Task 3 | Re-verify `29b52ab` — `grep -c 'NetworkGraphCard' src/ui/shell/tabUtils.tsx` should be 0; the `case "network_graph"` block should render `<PrettyLandingCard/>` |
| PrettyView chat surface broken (regressed from Phase 4-11 baseline) | Any Phase 12 task (scope-fence breach) | STOP — this means Phase 12 breached its scope fence (pretty-view internals were NOT supposed to be touched). Bisect the Phase 12 commits and find + revert the breach |
| Session persistence broken (switching identity A → B → A drops scroll / reconnects) | Phase 12 Plan 03 Task 1 | The tabNodesRef DOM-move mechanism (patch #35, T-06-02-01 mount-lifecycle contract) regressed during the AppShell surgery. Re-verify the tab-node-portal-loop preservation in `fc283d2` |
| Retained i18n labels render as raw key names (`nav.title`, `nav.conversations.title`, etc.) | Phase 12 Plan 06 Task 2 | Over-strip. Re-verify `5115bb9` — the retained `nav.*` leaf keys (`home`, `terminal`, `serverStats`, `fileManager`, `docker`, `tunnels`, `close`, `cancel`, `confirmClose`, `hostTabTitle`) + retained `nav.conversations.*` sub-keys (`title`, `empty`, `pin`, `unpin`, `backToList`) MUST still be present in en.json + translated files. If runtime shows bare keys, the client may have cached a stale locale chunk — hard-refresh |
| FullScreenAppWrapper unauthenticated branch renders Skynet Dashboard (not PrettyLandingCard) | Phase 12 Plan 04 Task 1 | Re-verify `d6d3886` — `grep -c 'from "@/dashboard/Dashboard' src/ui/features/FullScreenAppWrapper.tsx` should be 0. If Dashboard renders in the unauth branch, the swap didn't ship |

---

## Post-UAT deploy runbook (Phase 11 checker B-2 fix precedent — authoritative source citation)

### AUTHORITATIVE SOURCE

**Deploy procedure lives at `~/.claude/identities/tina/deploy-runbook.md`** (dated post-2026-07-21). This is the current, self-contained procedure for shipping `skynet-patched:local` onto skynet-ec2. **Follow the steps in that file verbatim.** This UAT checklist does not duplicate the runbook; it points at it.

### Stale-reference callout — do NOT follow the fork CLAUDE.md 15-min deadman regime

The fork's `CLAUDE.md` (in this repo root) still contains this line under `Deploy safety`:

> "Every `docker compose up -d --force-recreate skynet` runs behind the 15-min deadman rollback timer (`/opt/skynet/.tmp-revert.sh`) — no exceptions, per Ashley 2026-07-03, even when she is at the keyboard."

**THIS CONSTRAINT WAS RETIRED FLEET-WIDE ON 2026-07-21.** Ashley's SSM-tmux-attach-via-SSH-over-SSM fallback (documented in `deploy-runbook.md` § "FALLBACK: tmux-attach via SSH-through-SSM") replaced the deadman's catastrophic-loss-recovery role. The fork's `CLAUDE.md` hasn't been updated yet; that update is a **SEPARATE OPEN BOUNTY** — `claude-md-15min-deadman-stale` — that will land in a Phase-13+ hygiene sweep or as a quick task. **Ignore the fork CLAUDE.md's 15-min deadman line. Use `~/.claude/identities/tina/deploy-runbook.md` as the authoritative source.**

If Ashley asks "why aren't you arming the deadman before the recreate?" the answer is: "The deadman regime was retired 2026-07-21 per your call after patch #81's hidden-stock-shipped bug; the SSM fallback took over its role. See `~/.claude/identities/tina/deploy-runbook.md` § retired-deadman-regime for the full history."

### FLEET-STANDING BATCHING RULE (Ashley 2026-07-23) — patches #138 + #139 SHOULD NOT auto-deploy

**"Batch patches into meaningful deploys — one patch ≠ one deploy."** Ashley called this out 2026-07-23 immediately after patch #135 landed (I keep reflexively recommending a deploy after every single fork patch, and every container recreate kills 20+ live WebSocket sessions across her open fleet). Phase 11 + Phase 12 patches (patch #138 for Phase 11, patch #139 for Phase 12) **MUST NOT auto-deploy**. Batch them until:

- **Ashley explicitly says "deploy" for this batch,** OR
- **A grouped semantic unit is complete** — patches #138 + #139 together tell the full "we deleted the Skynet client surfaces" story (Phase 11 stripped the AppShell mounts + retired the two directly-mounted files; Phase 12 deleted the ~30 orphan panel files + the dashboard subtree + the tab-bar-chrome file + the dead locale strings). Phase 13 backend-route purge would extend this batch further if it lands before the deploy window. OR
- **Something is actively broken in production requiring an emergency patch ship** (Phases 11 + 12 don't fix anything broken in prod — they remove UI surfaces Ashley never uses — so this scenario does not apply).

**The default answer is HOLD.** Do not treat "code-complete-clean" as "deploy-ready." Patches #138 + #139 sit in the batch queue; the deploy notification to Ashley bundles all Phase 11 + Phase 12 changes into ONE UAT + ONE recreate + ONE (or TWO) pin(s). If Phase 13 lands within Ashley's typical batching window (~days), extend further.

### CHECK-BEFORE-RECREATE ONE-LINER (from `~/.claude/identities/tina/tina.md` § learned preferences — carried from Phase 11)

Before EVERY `docker compose up -d --force-recreate skynet`, grep the compose file image line to catch pre-retirement leftover `sed` or any stale `sleep 900` process that might have rewritten the compose image line back to `ghcr.io/lukegus/skynet:latest`:

```
grep 'image:' /opt/skynet/docker-compose.yml | grep -q skynet-patched:local || \
  sudo sed -i 's|image: ghcr.io/lukegus/skynet:latest|image: skynet-patched:local|' /opt/skynet/docker-compose.yml
```

Idempotent — no-op when compose is already patched, corrects when it's been reverted. This one-liner is called out here because a naïve `docker compose up -d --force-recreate skynet` without this grep can silently ship stock upstream — the container reports healthy because stock IS functional, so there's no failure signal. That's the trap that bit patches #43 and #69 pre-retirement, and it stays a risk post-retirement because manual sed mistakes and any leftover pre-retirement `sleep 900` background processes could still rewrite the compose file. **Survived deadman retirement, stays in force per `~/.claude/identities/tina/tina.md` § learned preferences.**

### ASHLEY PRE-WARN — first hard-refresh may white-screen

Per `~/.claude/identities/tina/tina.md` § learned preferences (2026-07-23, learned on the #131-#134 deploy during patch #133 write-up):

> After `docker compose up -d --force-recreate skynet`, the FIRST hard-refresh may white-screen with `net::ERR_HTTP2_PROTOCOL_ERROR` on chunk loads. **The fix is close+reopen the tab, NOT a real deploy failure.** Symptom: two specific chunks (in Ashley's case `codemirror-*.js` + `file-preview-vendor-*.js`) fail with HTTP2_PROTOCOL_ERROR → white screen. Root cause: Caddy holds persistent upstream connections to the skynet container; when the container dies mid-fetch during recreate, the browser's existing H2 stream to Caddy sees the upstream fail and marks the stream broken client-side. Fix = close and reopen the tab (spawns a fresh H2 connection).

**When the deploy actually happens, PRE-WARN Ashley in the deploy notification message** that the first hard-refresh may white-screen and the fix is close+reopen. Do NOT jump to rollback on the first PROTOCOL_ERROR report. Verify chunks reachable from tailnet first (curl them from the box), then guide her through the tab-close-and-reopen. **This warning is DOUBLY important for the Phase 11 + Phase 12 batched deploy** because both patches change many chunks (AppShell + index + FullScreenAppWrapper + async chunks for now-deleted panels/dashboard), so the first-hard-refresh chunk-load surface is larger than a typical single-patch deploy.

### Deploy flow (only if Ashley explicitly greenlights the batched deploy)

Per `~/.claude/identities/tina/deploy-runbook.md` steps 1-8. Summary in this order:

1. **Apply + commit + push + build** — per deploy-runbook step 1. `git push` BEFORE build. The build script clones from GitHub; local-only commits cache-hit the frontend-builder layer. This is the trap that bit patches #43 and #69.
2. **Ask Ashley for explicit go-ahead for THIS deploy window.** A distinct green light, not carried over from any earlier "go for it" that authorized the code change. Every build → deploy transition is a new "may I?" moment.
3. **Run the check-before-recreate one-liner** (see above).
4. `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`
5. **Wait for `(healthy)`** — should be within 30s. Corroborate the patch shipped by grepping the deployed dist for specific Phase 11 + Phase 12 signature bytes:
   - Phase 11 signature: `docker exec skynet grep -c 'PrettyLandingCard' /app/html/assets/*.js` should return ≥ 1
   - Phase 12 signature: `docker exec skynet grep -c 'session-launcher' /app/html/assets/*.js` should return ≥ 1
   - Phase 12 dead-code signature: `docker exec skynet grep -c 'HostManagerPanel\|AdminSettingsPanel\|DashboardTab' /app/html/assets/*.js` should return 0 (or comment-only)
   - If any of these signatures don't match, the frontend build layer cache-hit and stock shipped — rollback + re-push + re-build.
6. **PRE-WARN Ashley in the deploy DM** about the first-hard-refresh white-screen risk; tell her the fix is close+reopen the tab.
7. **Tell Ashley to test** by walking this checklist. On her "pin it" reply: paste both `.planning/phases/11-.../11-PATCHES-MD-ENTRY.md` (patch #138) and `.planning/phases/12-.../12-PATCHES-MD-ENTRY.md` (patch #139) into `~/.claude/identities/tina/skynet-patches.md`, bump the count line from "ONE HUNDRED THIRTY-SEVEN" to "ONE HUNDRED THIRTY-NINE", commit the pin (`docs(patches): pin patches #138 + #139 — Skynet transformation first + second slices`).
8. **If broken**: manual rollback per deploy-runbook.md step 8 — `sudo sed -i 's|image: skynet-patched:local|image: ghcr.io/lukegus/skynet:latest|' /opt/skynet/docker-compose.yml && cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`. Then investigate.

---

*Phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice*
*Checklist generated: 2026-07-23 (Plan 07 automation)*
*Design source-of-truth: `.planning/phases/12-.../12-CONTEXT.md` (LOCKED) + `~/.claude/identities/tina/tina.md` § Skynet direction*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)*
*Sign-off block at top of page.*
