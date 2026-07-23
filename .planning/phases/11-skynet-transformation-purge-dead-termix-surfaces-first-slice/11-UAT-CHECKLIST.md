# Phase 11 UAT Checklist — Skynet transformation: purge dead Termix surfaces (first slice)

**For:** Ashley
**Post-deploy validation of patch #138 (Phase 11 — Ship-of-Theseus first slice: landing swap + AppRail retirement + SettingsRow retirement + rail-view state-machine strip)**
**Batch context:** Patch #138 is the FIRST Phase 11 patch. **DO NOT deploy standalone.** Batch with subsequent Phase 12+ purge patches per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23) — see § Post-UAT deploy runbook at the bottom.
**Deploy anchor:** term.gigaashley.click (production) — post-deploy, once Ashley greenlights the batch.
**Design source-of-truth:** `.planning/phases/11-skynet-transformation-purge-dead-termix-surfaces-first-slice/11-CONTEXT.md` (LOCKED — no re-litigation) + `~/.claude/identities/tina/tina.md` § Skynet direction (Ship of Theseus).

**Trace commits (Phase 11 on `feat/tab-title-from-tmux`):**

- Plan 01 (docs — strip-list): `b19fc20` (enumerate strip-list for landing-surface swap + AppRail retirement) + `197c069` (begin phase execution)
- Plan 02 (landing swap): `8ae9baf` (add PrettyLandingCard component), `22b5cfb` (swap dashboard render to PrettyLandingCard in tabUtils), `425ba1f` (rename dashboard nav labels to conversations), `af347d1` (10-02 SUMMARY)
- Plan 03 (retirement — 5 atomic per B-3 split): `b68a821` (prune Test 11), `cf7fe27` (AppShell surgery), `992bee3` (drop settingsRowSlot prop), `c3c84be` (delete SettingsRow.tsx), `c386068` (delete AppRail.tsx), `cbff367` (11-03 SUMMARY)
- Plan 04 (docs — build-verify + UAT + patch #138): this commit

**Build-verify status (per `11-BUILD-VERIFY-LOG.md`):**
- `npx tsc --noEmit` — exit 0 ✅
- `npx vitest run` — 524/526 (2 pre-existing ComposeBox failures inherited from Phase 10; zero net-new Phase 11 regressions) ✅
- `npm run build` — exit 0 in 10.94s ✅
- All 17 grep hygiene gates PASS ✅
- **AppShell chunk delta: −373 kB / −83%** (Phase 10 tip: 448.82 kB → Phase 11 tip: 75.43 kB) — concrete headline of the Ship-of-Theseus purge landing

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All 🚨 items in Non-Negotiable sections (Desktop 1-10 + Mobile 11-17 + Cross-viewport 18-22) pass** → **greenlight patch #138 for the batched Phase 11+12 purge cluster deploy** OR **hold patch #138 in the batch** until the next grouped-semantic-unit is ready. Per the fleet-standing "batch patches into meaningful deploys" rule, THE DEFAULT ANSWER IS HOLD. Only greenlight standalone if there's a specific reason (Ashley wants to smoke-test the Skynet first-slice on prod before Phase 12+ lands, or something is actively broken in prod that Phase 11 fixes). Then help Tina pin patch #138: paste `.planning/phases/11-skynet-transformation-purge-dead-termix-surfaces-first-slice/11-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/termix-patches.md` at the next ordinal position (patch #138 unless an interstitial pinned first — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/termix-patches.md | tail -3`). Bump the "ONE HUNDRED THIRTY-SEVEN numbered patches" line near the top of `termix-patches.md` to "ONE HUNDRED THIRTY-EIGHT". Commit the pin (`docs(patches): pin patch #138 — Skynet transformation first slice`). Then `/close skynet-transformation-purge-dead-surfaces` on the Phase 11 bounty (or leave open if Phase 12+ is still ahead in the bounty's todo set).

- [ ] **Any 🚨 item fails** → note the failing item and observed-vs-expected behavior. Decide by severity: if the failure is a visual regression only (wrong padding, minor color hue drift), mark it for a follow-up polish patch and consider the deploy conditionally-good. If the failure is functional (landing renders dashboard cards instead of PrettyLandingCard, AppRail visible, dead-surface panel renders at `#hosts` / `#admin` / `#snippets`, RDP row click doesn't open Guacamole, SettingsRow visible on mobile), route back to the specific Plan/Task via the "Failure → route-back" table.

- [ ] **Nothing to log to `deferred-items.md`** — Phase 11 has no polish items; every item is a non-negotiable purge assertion.

## How to use this checklist

Work through top-to-bottom on BOTH viewports (desktop + iPhone). Each 🚨 item has an action + expected result + "if this fails" note. Mark [x] as you go.

**Section order:**
1. Desktop non-negotiable — items 1-10 (blocking) — INCLUDES hash-fragment probes for `#hosts`, `#admin`, `#snippets`, `#dashboard` at item 9
2. Mobile (iPhone) non-negotiable — items 11-17 (blocking)
3. Cross-viewport regression — items 18-22 (blocking; Phase 6/7/10 behaviors that must survive)
4. Failure → route-back table
5. Post-UAT deploy runbook (only if everything's green AND Ashley greenlights the batch)

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on a wide desktop window** (1400px+) AND in **Skynet on your iPhone** (PWA-installed after patch #125, or Mobile Safari fallback).
2. Have at least 2 running tmux identity sessions on distinct hosts, plus at least one RDP-enabled host for item 6 + item 15 + item 20 walks.
3. Clear session storage on desktop for a truly-fresh page-load (item 1): DevTools → Application → Session Storage → Clear. Alternatively use a fresh Chrome incognito window.
4. On iPhone: fully close Skynet PWA (swipe up from app switcher) before item 11's fresh page-load.

---

## Non-negotiable — Desktop UAT (wide window 1400px+)

### 1. Fresh page-load lands on PrettyLandingCard (NOT Termix dashboard)

> **Contract:** Desktop fresh page-load with no URL hash-fragment and no persisted tab state → main pane renders the new warm-glass PrettyLandingCard empty-landing card. NOT the Termix dashboard with host cards / stats bars / recent-sessions grid. Card contains no "Termix" or "Dashboard" text.

- [ ] 🚨 **Fresh page-load at `https://term.gigaashley.click/`** (no hash, session storage cleared per Setup 3). Wait ~2s for `/sessions/list` to resolve. Expected: main pane shows a warm-glass empty-landing card centered in its container — subtle `rgba(240, 235, 224, 0.9)` warm-cream text ("Select a conversation" or similar copy) on a `linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))` glass background with a `rgba(255, 220, 170, 0.10)` inset warm-glow highlight + 20px backdrop-blur. **NO** host cards. **NO** stats. **NO** recent-sessions grid. **NO** "Dashboard" heading. **NO** "Termix" branding. **If: Termix dashboard renders** → Plan 02 Task 2 (tabUtils.tsx case-body swap) didn't land — grep the compiled `dist/assets/AppShell-*.js` for `PrettyLandingCard` (should be present) and for `DashboardTab` (should be absent, except comment-preserved history annotations).

### 2. AppRail is gone

> **Contract:** The left AppRail (the ~40-48px-wide column of icon buttons for Dashboard / Hosts / Sessions / Credentials / Connections / Quick-Connect / SSH Tools / Snippets / History / Split Screen / Network Graph / User Profile / Admin Settings) is DELETED FROM THE DOM. Nothing renders where it used to be.

- [ ] 🚨 **Look at the left edge of the app shell.** Expected: the pretty-conversations sidebar sits flush against the left edge of the viewport (with only the persistent top-left chevron toggle overlaying it at `top: 8px, left: 8px, z-index: 30` per Phase 10 patch #128). **NO** icon column between the viewport edge and the sidebar. **If: icon column visible** → Plan 03 Task 2 (AppShell surgery — AppRail mount removal at old lines 1826-1847) didn't land, OR the file deletion at Plan 03 Task 5 (`c386068`) reverted somehow. Grep the deployed bundle: `docker exec termix grep -c 'AppRail' /app/html/assets/*.js` should return 0 (except within comment strings that were preserved). Grep the source: `test ! -f src/ui/sidebar/AppRail.tsx` should pass.

### 3. Sidebar is the pretty-conversations panel

> **Contract:** The sidebar is the same pretty-conversations panel Phase 10 shipped — chunky Telegram-style rows with 40px hue-ring avatar discs on desktop, pencil icon in the header for new-session, RDP-host-sentinel rows at the bottom. This is a preservation check; Phase 11 does NOT change the sidebar.

- [ ] 🚨 **Confirm sidebar content matches Phase 10.** Chunky rows, hue-ring avatars, header pencil, RDP-sentinel section at the bottom with the "Remote desktop" divider chip + Monitor-glyph avatars. **If: sidebar looks like Phase 6/7's dense list** → Phase 10 regressed somehow (should not happen — Phase 11 doesn't touch pretty-conversations rendering). Route back to Phase 10 Wave 3 (`a2868e6`).
- [ ] 🚨 **No gear icon in the header** (retired in patch #133). The header shows the "Conversations" label + the pencil only. **If: gear present** → patch #133 (shadcn-wrappers strip + Skynet base color rebase) regressed.

### 4. Persistent top-left chevron toggle works

> **Contract:** Phase 10 patch #128 shipped a 32x32 fixed chevron at `top: 8px, left: 8px, z-index: 30`. Click to collapse/expand the sidebar. Rotates 180° with `sidebarOpen` state. Phase 11 does NOT touch this.

- [ ] 🚨 **Click the chevron** — sidebar collapses. Chevron rotates so it now points RIGHT. **Click again** — sidebar expands, chevron rotates back to point LEFT. **If: no rotation** → Plan 03 Task 2 (`cf7fe27`) accidentally regressed the toggle wiring during the AppShell surgery. Unlikely — the AppShell surgery was surgical about the toggle preservation — but grep AppShell.tsx for `sidebarOpen` and `top: 8px, left: 8px` to confirm the toggle mount is intact.

### 5. Clicking an active conversation row opens PrettyView

> **Contract:** Existing Phase 6-10 behavior. Click an active tmux-identity conversation row → PrettyView chat surface renders in the main pane. Selected-row hue-lift treatment (Phase 10 Wave 1) unchanged.

- [ ] 🚨 **Click an identity row** (any active tmux session). Expected: main pane transitions from PrettyLandingCard to the pretty-view chat surface for that identity. Row acquires selected-state hue-lift. Existing conversation history renders. Composer at the bottom is functional (type-ahead, ThumbsUp send, etc.). **If: nothing happens** → Plan 03 Task 2 accidentally broke the openTab → selectConversationDeferred chain. Grep AppShell.tsx for `onConversationSelected` to verify the handler is still wired.

### 6. Clicking an RDP-host-sentinel row opens Guacamole (PURGE-05 runtime gate)

> **Contract:** Phase 7 wired RDP-host-sentinel rows in the pretty-conversations panel to open Guacamole panes. Phase 11 explicitly preserves this (PURGE-05 acceptance). The `onRdpRowClick` handler in AppShell is verbatim from pre-Phase-11.

- [ ] 🚨 **Scroll to the RDP-sentinel section at the bottom of the sidebar.** Click an RDP-enabled host row (Monitor-glyph avatar, "Remote desktop" divider above the section). Expected: main pane opens a new Guacamole tab. **guacd actually connects** — the remote-desktop canvas appears, keyboard input works, mouse events work. **This is the definitive PURGE-05 runtime gate — automated tests cannot verify guacd connection.** **If: nothing happens** → grep AppShell.tsx for `onRdpRowClick` (should return 1 hit, handler mounted on PrettyConversationsPanel with body verbatim). **If: RDP tab opens but guacd doesn't connect** → route to Phase 12+ scope investigation (guacd container health, tailnet reachability of RDP host) — NOT a Phase 11 regression.

### 7. Header pencil opens NewSessionDialog

> **Contract:** Phase 6-7 + Phase 10 behavior. Click the pencil icon in the sidebar header → NewSessionDialog opens (Radix modal with filterable host list). Phase 11 does NOT touch this.

- [ ] 🚨 **Click the pencil.** Expected: dialog opens with the filterable host list + optional session-name input + Cancel/Open buttons. Same modal as Phase 6/7/10. **If: nothing happens** → Plan 03 Task 3 (`992bee3`) accidentally broke the dialog-open state binding while dropping the settingsRowSlot prop. Grep PrettyConversationsPanel.tsx for `openNewSessionDialog` (or however Phase 10 named the state).

### 8. No gear icon anywhere (Ashley's "no settings" lock)

> **Contract:** CONTEXT.md § scope-fence discipline: "No settings UI anywhere. Not in this phase, not as a 'small mobile preferences pane,' not as a 'settings icon in the corner.' Zero." Every visible-UI entry point to any settings surface is gone.

- [ ] 🚨 **Sweep the entire desktop UI for any gear icon.** Header of sidebar: no gear. Anywhere in main pane: no gear. Anywhere in tab bar chrome (patch #128 top-left chevron area, top-right of window, etc.): no gear. **If: gear icon visible anywhere** → route to Plan 03 Task 2 or Task 4. The AppShell surgery + SettingsRow deletion should have removed every gear entry point; if one survived, it means a code path was missed in the strip-list.
- [ ] 🚨 **Verify no keyboard shortcut opens a settings surface.** Try common patterns: `Cmd+,` (macOS-standard settings shortcut), `Ctrl+,` (Windows/Linux), `Cmd+Shift+S`, `?` for help menu. Expected: nothing happens OR opens an unrelated existing shortcut (double-shift command palette is preserved — item 10). **If: any settings surface opens** → grep AppShell.tsx for keyboard-shortcut wiring; the strip-list may have missed a shortcut handler.

### 9. Hash-fragment dead-surface unreachability (per checker W-4 fix — the critical PURGE-03 runtime gate)

> **Contract:** No settings menu, no admin surface, no host manager, no snippets manager, no dashboard is reachable via any click, keyboard shortcut, or URL. Direct hash-fragment navigation to a dead surface's URL must NOT render the corresponding dead-surface panel. Both a 404-equivalent (blank / error / fallback) AND landing on the PrettyLandingCard warm-glass card are ACCEPTABLE outcomes — the load-bearing requirement is that the dead-surface panels (HostManagerPanel / AdminSettingsPanel / SnippetsPanel / DashboardTab) MUST NOT render in the main pane or the sidebar.

Walk each of the four direct-hash-fragment probes below. For each: type the URL into the browser address bar, press Enter, wait ~2s for any async state to settle. Observe the main pane content + the sidebar content + browser DevTools console for warnings.

- [ ] 🚨 **`https://term.gigaashley.click/#hosts`** — expected: 404-equivalent (blank main pane, or error card, or fallback) OR PrettyLandingCard warm-glass empty card. **NOT** the HostManagerPanel (host list, add-host CTA, edit-host modal chrome, credentials editor, etc.). If HostManagerPanel renders → **route back to Plan 03 Task 2**: a `railView === "hosts"` handler survived the strip in `sidebarPanelContent` or a `case "hosts"` block survived in the tab-content router.
- [ ] 🚨 **`https://term.gigaashley.click/#admin`** — expected: 404-equivalent OR PrettyLandingCard. **NOT** the AdminSettingsPanel (user list, permissions matrix, system-config editor, etc.). If AdminSettingsPanel renders → **route back to Plan 03 Task 2** (surviving `railView === "admin-settings"` handler).
- [ ] 🚨 **`https://term.gigaashley.click/#snippets`** — expected: 404-equivalent OR PrettyLandingCard. **NOT** the SnippetsPanel (snippet list, editor, tag manager). If SnippetsPanel renders → **route back to Plan 03 Task 2** (surviving `railView === "snippets"` handler).
- [ ] 🚨 **`https://term.gigaashley.click/#dashboard`** — expected: PrettyLandingCard warm-glass empty card (this is the intended outcome — the `"dashboard"` TabType identifier is preserved as a load-bearing fallback per Plan 02 decision, but its render path now returns `<PrettyLandingCard/>` instead of `<DashboardTab>`). **NOT** the Termix DashboardTab with host cards, stats bars, recent-sessions grid. If DashboardTab renders → **route back to Plan 02 Task 2** (`22b5cfb` `case "dashboard"` swap didn't land).

**Acceptance framing:** for each of the four probes, both possible outcomes (404-equivalent OR PrettyLandingCard) are acceptable — the requirement is that the CORRESPONDING DEAD-SURFACE PANEL must not render. This dual-outcome acceptance exists because the URL-fragment router is not modified in Phase 11 (that's a Phase 12+ scope item — deleting the router branches that handle these fragments), and the fallback behavior at each unhandled fragment is code-path-specific (some fragments may fall through to the initial-tab-seed which now uses PrettyLandingCard; others may hit the closeTab fallback which also uses PrettyLandingCard; others may render an empty tab tree with no active tab). All three fall-through outcomes prove the same thing: the dead-surface panels are unreachable from any UI path.

### 10. Existing keyboard shortcuts unchanged

- [ ] 🚨 **Double-shift** opens the command palette (existing Phase 6+ shortcut). Not touched by Phase 11.
- [ ] 🚨 **Ctrl+Shift+O** (or the equivalent pretty-view toggle if it's a different combo) still toggles pretty-mode in terminal panes when a session is active. Not touched by Phase 11.
- [ ] 🚨 **Ctrl+M** opens the message-queue drawer in a terminal pane. Not touched by Phase 11.

---

## Non-negotiable — Mobile UAT (iPhone / Skynet PWA)

### 11. Fresh page-load lands on pretty-conversations list

> **Contract:** Phase 10 behavior — mobile fresh page-load renders the pretty-conversations list view (not the view screen). Phase 11 does NOT change mobile landing.

- [ ] 🚨 **Fully close Skynet PWA** (swipe up from app switcher), then reopen. Expected: the mobile list screen shows the chunky pretty-conversations rows with 48px hue-ring avatars, header with compact pencil-only. Same as post-Phase-10 baseline. **If: view screen renders instead of list** → Phase 6 Plan 06-03 mobile-landing behavior regressed (should not happen — Phase 11 doesn't touch mobile navigation).

### 12. Tap conversation row → view screen opens

- [ ] 🚨 **Tap any identity row.** Expected: full-screen view transition to the pretty-view chat surface for that identity (mobile-native list→view screen replacement, no peek/overlay).

### 13. Top-left back button returns to list

- [ ] 🚨 **On the view screen, tap the top-left back button.** Expected: transitions back to the list view. Standard mobile back navigation, unchanged from Phase 6/10.

### 14. No bottom navigation bar

> **Contract:** Phase 6 Plan 06-03 deleted the MobileBottomBar unconditionally (TG-07). Confirming no regression.

- [ ] 🚨 **Look at the bottom of the mobile viewport.** No bottom nav bar with icons for Hosts / Snippets / Admin / etc. Only the safe-area padding from patch #126.

### 15. No SettingsRow at the bottom of the pretty-conversations list (Ashley's "no settings" lock — the mobile enforcement)

> **Contract:** Plan 03 Task 4 (`c3c84be`) deleted `src/ui/sidebar/SettingsRow.tsx`. Plan 03 Task 3 (`992bee3`) dropped the `settingsRowSlot` prop from PrettyConversationsPanel. There is no SettingsRow at the bottom of the mobile list anymore.

- [ ] 🚨 **Scroll to the very bottom of the mobile pretty-conversations list** (past the RDP-sentinel section). Expected: below the last RDP row, ONLY the safe-area padding renders (from patch #126). **NO** SettingsRow with a gear icon, NO settings label, NO settings entry point. **If: SettingsRow visible** → route back to Plan 03 Task 4 (file-delete didn't land) OR Plan 03 Task 2 (SettingsRow mount survived the AppShell strip) OR Plan 03 Task 3 (settingsRowSlot prop still mounted).

### 16. RDP row tap opens Guacamole (PURGE-05 mobile runtime gate)

- [ ] 🚨 **Scroll to the RDP-sentinel section.** Tap an RDP host row. Expected: full-screen view transition to the Guacamole pane; guacd connects; the remote-desktop canvas appears. Same runtime PURGE-05 verification as desktop item 6, but on mobile.

### 17. iOS PWA reinstall — safe-area seam still gray

> **Contract:** Phase 10 patch #126 rebased the mobile safe-area seam to `#0a0b12`. Confirming no regression from Phase 11's changes.

- [ ] 🚨 **Remove Skynet from the iPhone home screen** (long-press → Remove App → Delete from Home Screen). Then in Mobile Safari, navigate to `https://term.gigaashley.click`, tap Share → Add to Home Screen. Reopen from the fresh install. Expected: the top safe-area seam (above the status bar) and the bottom safe-area seam (above the home indicator) render as `#0a0b12` gray — no white flash, no color mismatch. Phase 11 does NOT touch safe-area handling, but this is a paranoid cross-check that the AppShell surgery didn't accidentally regress patch #126.

---

## Cross-viewport regression — Phase 6/7/10 behaviors that must survive

### 18. Message-queue drawer still works

- [ ] 🚨 **Open any active tmux-identity session.** Press **Ctrl+M**. Expected: the per-pane message queue drawer opens at the bottom of the terminal pane. **Press Ctrl+M again** — drawer closes. Not touched by Phase 11.

### 19. Pretty-view compose box + WipBubble + session-holding overlay behave

- [ ] 🚨 **In an active session's pretty-view, type a message + hit ThumbsUp send.** Expected: message dispatches; WipBubble spinner shows briefly; if the identity is holding a session, the session-holding overlay behaves per Phase 2-10 baseline. Phase 11 does NOT touch pretty-view internals (scope-fence per CONTEXT.md).

### 20. RDP session actually usable (PURGE-05 deep check)

- [ ] 🚨 **In the RDP tab from item 6 (desktop) or item 16 (mobile), interact with the remote desktop.** Type on the remote keyboard. Click. Move windows around on the remote OS. Expected: the remote desktop is USABLE — not just "the canvas rendered." Automated tests don't cover this; runtime UAT is the only proof.

### 21. Session persistence — switch A → B → A, no reconnect

- [ ] 🚨 **Click identity A. Scroll in pretty-view. Click identity B. Click identity A again.** Expected: INSTANT switch back to A. Scroll position preserved. Terminal buffer preserved. This proves the T-06-02-01 tabNodesRef DOM-move mechanism (patch #35) survived the Plan 03 AppShell surgery. **If: reconnect indicator or scroll reset** → the mount-lifecycle contract regressed somewhere in `cf7fe27`. Route back to Plan 03 Task 2.

### 22. Fleet-native rows on fresh page-load (Phase 7 lock)

- [ ] 🚨 **Fresh incognito window → identity rows appear for fleet-discovered tmux sessions** (from the one-shot `/sessions/list` fetch — Phase 7 Plan 07-01 lock). Clicking a fleet-only row transparently attaches (Phase 7 TG-14). Not touched by Phase 11.

---

## Sign-off

| Item | Status | Ashley notes |
|------|--------|--------------|
| 1-10 (Desktop non-negotiable) | ⬜ | |
| 11-17 (Mobile non-negotiable) | ⬜ | |
| 18-22 (Cross-viewport regression) | ⬜ | |

**Ashley signature:** ______________  **Date:** ______________
**Deploy verdict (circle one):** GOOD (batch #138 with Phase 12+) / STANDALONE-DEPLOY (against the default batching rule — explicit reason:____) / ROLLBACK

---

## Failure → route-back table

| Symptom | Root Plan / Task | Route-back target |
|---|---|---|
| Landing shows Termix dashboard cards / stats bars (not PrettyLandingCard) | Plan 02 Task 2 | Re-verify commit `22b5cfb` — the `case "dashboard"` swap in `src/ui/shell/tabUtils.tsx` |
| AppRail (skinny icon column) still visible on desktop | Plan 03 Task 2 or Plan 03 Task 5 | Re-verify commit `cf7fe27` (AppRail mount removal in AppShell) + `c386068` (file deletion) — `test ! -f src/ui/sidebar/AppRail.tsx` should pass |
| SettingsRow (gear icon + settings label) visible at bottom of mobile pretty-conversations list | Plan 03 Task 2, Plan 03 Task 3, or Plan 03 Task 4 | Re-verify `cf7fe27` (AppShell strip removed the SettingsRow import + mount), `992bee3` (settingsRowSlot prop dropped from PrettyConversationsPanel), `c3c84be` (SettingsRow.tsx file deletion) |
| RDP row click no longer opens Guacamole | Plan 03 Task 2 | `grep -c "onRdpRowClick" src/ui/AppShell.tsx` should be 1; body should be preserved verbatim from pre-Plan-03 |
| Sidebar renders blank (nothing shows in the sidebar column) | Plan 03 Task 2 | The PrettyConversationsPanel mount inside `sidebarPanelContent` was accidentally removed alongside the 11 dead-branch conditionals. Grep AppShell.tsx for `<PrettyConversationsPanel` — should be exactly 1 hit (mobile-list-mount was unified with desktop-sidebar-mount via reuse per Plan 03 Task 2 rewrite). |
| tsc broken / build broken | Any Plan 03 task | Bisect via `git log --oneline b19fc20..cbff367` — the 5 Plan 03 commits (b68a821, cf7fe27, 992bee3, c3c84be, c386068) each has its own per-commit tsc+vitest gate per Plan 03 Wave 4 precedent |
| Test 11 regression — PrettyConversationsPanel.test.tsx claims Test 11 still exists | Plan 03 Task 1 | Re-verify commit `b68a821` — the describe block for "PrettyConversationsPanel: mobile settings slot position" should be gone; file-header comment index at line 13 should say "RETIRED" |
| Hash-fragment `#hosts` still renders HostManagerPanel | Plan 03 Task 2 | A `railView === "hosts"` handler survived the sidebarPanelContent strip. Grep AppShell.tsx for `"hosts"` — should only appear in the `case "hosts"` block inside `renderTabContent` if the tab was seeded from a URL fragment (which is Phase 12+ scope to strip). |
| Hash-fragment `#admin` still renders AdminSettingsPanel | Plan 03 Task 2 | Same pattern — grep for `"admin-settings"` or `"admin"`. |
| Hash-fragment `#snippets` still renders SnippetsPanel | Plan 03 Task 2 | Same pattern — grep for `"snippets"`. |
| Hash-fragment `#dashboard` still renders DashboardTab (Termix stats bars, host cards) | Plan 02 Task 2 | Re-verify `22b5cfb` — the `case "dashboard"` block in tabUtils.tsx should render `<PrettyLandingCard/>`, NOT `<DashboardTab>`. `grep -c "DashboardTab" src/ui/shell/tabUtils.tsx` should be 0. |
| `profileDropdownOpen` state referenced somewhere (state field survived the strip) | Plan 03 Task 2 | The Plan 01 §E.2 safety-gate grep missed a consumer. Re-run `grep -rn "profileDropdownOpen\|setProfileDropdownOpen" src/` — should return only `//` comment-mention hits. If a code-hit survives, restore the state declaration + investigate the surviving consumer. |
| Persistent top-left chevron toggle broken (won't collapse/expand or won't rotate) | Plan 03 Task 2 | The AppShell surgery accidentally regressed the Phase 10 patch #128 toggle wiring. Grep AppShell.tsx for `sidebarOpen` — should return 5-10 hits (state declaration + setter calls + JSX conditional + transform binding). |
| PrettyView chat surface broken (regressed from Phase 4-10 baseline) | Any Plan 03 task | STOP — this means Phase 11 breached its scope fence (pretty-view internals were NOT supposed to be touched). Bisect the Plan 03 commits to find the breach and revert. |
| Session persistence broken (switching identity A → B → A drops scroll / reconnects) | Plan 03 Task 2 | The tabNodesRef DOM-move mechanism (patch #35, T-06-02-01 mount-lifecycle contract) regressed during the AppShell surgery. Re-verify the tab-node-portal-loop preservation in `cf7fe27`. |
| RDP tab lifecycle broken (tab opens but guacd doesn't connect, or tab disconnects on switch-away) | Any Plan 03 task (scope-fence breach) | STOP — Phase 11 was not supposed to touch RDP / guacd wiring. Bisect the Plan 03 commits. |

---

## Post-UAT deploy runbook (checker B-2 fix — authoritative source citation)

### AUTHORITATIVE SOURCE

**Deploy procedure lives at `~/.claude/identities/tina/deploy-runbook.md`** (dated post-2026-07-21). This is the current, self-contained procedure for shipping `termix-patched:local` onto termix-ec2. **Follow the steps in that file verbatim.** This UAT checklist does not duplicate the runbook; it points at it.

### Stale-reference callout — do NOT follow the fork CLAUDE.md 15-min deadman regime

The fork's `CLAUDE.md` (in this repo root) still contains this line under `Deploy safety`:

> "Every `docker compose up -d --force-recreate termix` runs behind the 15-min deadman rollback timer (`/opt/termix/.tmp-revert.sh`) — no exceptions, per Ashley 2026-07-03, even when she is at the keyboard."

**THIS CONSTRAINT WAS RETIRED FLEET-WIDE ON 2026-07-21.** Ashley's SSM-tmux-attach-via-SSH-over-SSM fallback (documented in `deploy-runbook.md` § "FALLBACK: tmux-attach via SSH-through-SSM") replaced the deadman's catastrophic-loss-recovery role. The fork's `CLAUDE.md` hasn't been updated yet; that update is a **SEPARATE OPEN BOUNTY** — `claude-md-15min-deadman-stale` — that will land in a Phase-12+ hygiene sweep. **Ignore the fork CLAUDE.md's 15-min deadman line. Use `~/.claude/identities/tina/deploy-runbook.md` as the authoritative source.**

If Ashley asks "why aren't you arming the deadman before the recreate?" the answer is: "The deadman regime was retired 2026-07-21 per your call after patch #81's hidden-stock-shipped bug; the SSM fallback took over its role. See `~/.claude/identities/tina/deploy-runbook.md` § retired-deadman-regime for the full history."

### FLEET-STANDING BATCHING RULE (Ashley 2026-07-23) — patch #138 SHOULD NOT auto-deploy

**"Batch patches into meaningful deploys — one patch ≠ one deploy."** Ashley called this out 2026-07-23 immediately after patch #135 landed (I keep reflexively recommending a deploy after every single fork patch, and every container recreate kills 20+ live WebSocket sessions across her open fleet). Phase 11 patches (patch #138 for the whole Phase 11 slice) **MUST NOT auto-deploy**. Batch them until:

- **Ashley explicitly says "deploy" for this batch,** OR
- **A grouped semantic unit is complete** (e.g., Phase 11 + Phase 12 landing together as "the visible-surface purge cluster" — the Phase 11 landing swap + AppRail retirement + Phase 12 dashboard/panel-file deletion + backend-route deletion together tell the "we deleted the Termix client surfaces" story), OR
- **Something is actively broken in production requiring an emergency patch ship** (Phase 11 doesn't fix anything broken in prod — it removes UI surfaces Ashley never uses — so this scenario does not apply).

**The default answer is HOLD.** Do not treat "code-complete-clean" as "deploy-ready." Patch #138 sits in the batch queue behind whatever Phase 12+ purge patches ship next; the deploy notification to Ashley bundles all Phase 11 + Phase 12 changes into ONE UAT + ONE recreate + ONE pin.

### CHECK-BEFORE-RECREATE ONE-LINER (from `~/.claude/identities/tina/tina.md` § learned preferences)

Before EVERY `docker compose up -d --force-recreate termix`, grep the compose file image line to catch pre-retirement leftover `sed` or any stale `sleep 900` process that might have rewritten the compose image line back to `ghcr.io/lukegus/termix:latest`:

```
grep 'image:' /opt/termix/docker-compose.yml | grep -q termix-patched:local || \
  sudo sed -i 's|image: ghcr.io/lukegus/termix:latest|image: termix-patched:local|' /opt/termix/docker-compose.yml
```

Idempotent — no-op when compose is already patched, corrects when it's been reverted. This one-liner is called out here because a naïve `docker compose up -d --force-recreate termix` without this grep can silently ship stock upstream — the container reports healthy because stock IS functional, so there's no failure signal. That's the trap that bit patches #43 and #69 pre-retirement, and it stays a risk post-retirement because manual sed mistakes and any leftover pre-retirement `sleep 900` background processes could still rewrite the compose file. **Survived deadman retirement, stays in force per `~/.claude/identities/tina/tina.md` § learned preferences.**

### ASHLEY PRE-WARN — first hard-refresh may white-screen

Per `~/.claude/identities/tina/tina.md` § learned preferences (2026-07-23, learned on the #131-#134 deploy during patch #133 write-up):

> After `docker compose up -d --force-recreate termix`, the FIRST hard-refresh may white-screen with `net::ERR_HTTP2_PROTOCOL_ERROR` on chunk loads. **The fix is close+reopen the tab, NOT a real deploy failure.** Symptom: two specific chunks (in Ashley's case `codemirror-*.js` + `file-preview-vendor-*.js`) fail with HTTP2_PROTOCOL_ERROR → white screen. Root cause: Caddy holds persistent upstream connections to the termix container; when the container dies mid-fetch during recreate, the browser's existing H2 stream to Caddy sees the upstream fail and marks the stream broken client-side. Fix = close and reopen the tab (spawns a fresh H2 connection).

**When the deploy actually happens, PRE-WARN Ashley in the deploy notification message** that the first hard-refresh may white-screen and the fix is close+reopen. Do NOT jump to rollback on the first PROTOCOL_ERROR report. Verify chunks reachable from tailnet first (curl them from the box), then guide her through the tab-close-and-reopen.

### Deploy flow (only if Ashley explicitly greenlights an early Phase 11 standalone deploy against the default batching rule)

Per `~/.claude/identities/tina/deploy-runbook.md` steps 1-8. Summary in this order:

1. **Apply + commit + push + build** — per deploy-runbook step 1. `git push` BEFORE build. The build script clones from GitHub; local-only commits cache-hit the frontend-builder layer. This is the trap that bit patches #43 and #69.
2. **Ask Ashley for explicit go-ahead for THIS deploy window.** A distinct green light, not carried over from any earlier "go for it" that authorized the code change. Every build → deploy transition is a new "may I?" moment.
3. **Run the check-before-recreate one-liner** (see above).
4. `cd /opt/termix && sudo docker compose up -d --force-recreate termix`
5. **Wait for `(healthy)`** — should be within 30s. Corroborate the patch shipped by grepping the deployed dist for the patch's signature bytes: `docker exec termix grep -c 'PrettyLandingCard' /app/html/assets/*.js` should return ≥ 1 (if not, the frontend build layer cache-hit and stock shipped — rollback + re-push + re-build).
6. **PRE-WARN Ashley in the deploy DM** about the first-hard-refresh white-screen risk; tell her the fix is close+reopen the tab.
7. **Tell Ashley to test** by walking this checklist. On her "pin it" reply: paste `.planning/phases/11-.../11-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/termix-patches.md`, bump the header count, commit the pin (`docs(patches): pin patch #138 — Skynet transformation first slice`).
8. **If broken**: manual rollback per deploy-runbook.md step 8 — `sudo sed -i 's|image: termix-patched:local|image: ghcr.io/lukegus/termix:latest|' /opt/termix/docker-compose.yml && cd /opt/termix && sudo docker compose up -d --force-recreate termix`. Then investigate.

---

*Phase: 11-skynet-transformation-purge-dead-termix-surfaces-first-slice*
*Checklist generated: 2026-07-23 (Plan 04 automation)*
*Design source-of-truth: `.planning/phases/11-.../11-CONTEXT.md` (LOCKED) + `~/.claude/identities/tina/tina.md` § Skynet direction*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)*
*Sign-off block at top of page.*
