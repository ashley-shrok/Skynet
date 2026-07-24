# Phase 10 UAT Checklist — Pretty-Conversations visual-language rework

**For:** Ashley
**Post-deploy validation of patch #128 (Phase 10 — presentation-only follow-up to Phase 6/7)**
**Batch context:** Ships behind ONE build/deploy with patches #123 through #128 stacked on `feat/tab-title-from-tmux` (paperclip decouple + ThumbsUp rename + Skynet rebrand + PWA install + safe-area polish + this).
**Deploy anchor:** term.gigaashley.click (production) — post-deploy.
**Design source-of-truth (locked, Ashley signed off 2026-07-22):**
- Mobile: `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/prototype.html` (v0.3)
- Desktop: `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/desktop.html` (v0.1)

**Trace commits (Phase 10 on `feat/tab-title-from-tmux`):**

- Wave 1 foundation: `06c12fc` (tokens + PinAction), `55624a9` (PrettyConversationRow), `06d8a93` (Row tests 12/12), `be58042` (docs)
- Wave 2 panel: `3cab53e` (PrettyConversationsPanel), `b003207` (Panel tests 15/15), `fc82696` (docs)
- Wave 3 cutover: `a2868e6` (AppShell mount-site swap), `65c572c` (persistent top-left toggle, thin-strip retired), `8cf4c8b` (Test 10 retarget), `0d39c43` (docs)
- Wave 4 retirement: `5d17167` (delete ConversationsPanel.tsx), `b61503b` (delete ConversationRow.tsx), `40ee620` (prune NewSessionDialog.test.tsx Test 1), `c45312a` (delete NewSessionButton.tsx), `ebf0c43` (docs)
- Wave 5 verify + docs: this checklist + build-verify log + patches-md draft (one docs commit)

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All 🚨 items in Non-Negotiable sections (Desktop 1-7 + Mobile 8-15 + Cross-viewport 16-19) pass** → **greenlight the deploy as good**, then help Tina pin patch #128: paste `.planning/phases/10-pretty-conversations-visual-language-rework/10-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` at the next ordinal position (patch #128 unless an interstitial pinned first — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`). Bump the "ONE HUNDRED TWENTY-SEVEN numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED TWENTY-EIGHT". Commit the pin (`docs(patches): pin patch #128 — pretty-conversations visual-language rework`). Then `/close pretty-conversations-panel-redesign` on the Phase 10 bounty.

- [ ] **Any 🚨 item fails** → note the failing item and observed-vs-expected behavior. Decide by severity: if the failure is a visual regression only (e.g. wrong hue, slight geometry off) mark it for a follow-up polish patch and consider the deploy conditionally-good. If the failure is functional (row won't open, pin doesn't persist, swipe hijacks vertical scroll, sidebar unreachable at any width, mobile session-create broken), route back to the specific Wave via the "Failure → route-back" table at the bottom of this file.

- [ ] **Only Polish items (20-22) fail** → deploy as good, log the polish items in this phase's `deferred-items.md` for a Phase 11 polish sweep. No route-back.

## How to use this checklist

Work through top-to-bottom on BOTH viewports (desktop + iPhone). Each 🚨 item has an action + expected result + "if this fails" note. Mark [x] as you go. Non-🚨 items are polish — nice to check but not blocking.

**Section order:**
1. Desktop non-negotiable — items 1-7 (blocking)
2. Mobile (iPhone) non-negotiable — items 8-15 (blocking)
3. Cross-viewport regression — items 16-19 (blocking; Phase 6/7 behaviors that must survive)
4. Optional polish — items 20-22 (non-blocking)
5. Sign-off table + failure route-back
6. Post-UAT deploy runbook (only if everything's green)

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on a wide desktop window** (1400px+) AND in **Skynet on your iPhone** (PWA-installed after patch #125, or Mobile Safari fallback).
2. Have at least 3 identities configured with distinct `colorHue` values (any range — 3 well-spread hues let you eyeball item 20 easily).
3. Have at least 2 running tmux identity sessions on distinct hosts, plus at least one RDP-enabled host (for the "RDP-can't-be-pinned" item 12 walk).
4. Have at least one PINNED session and one UNPINNED session before starting — makes items 3, 9, and 20 fast to check.
5. Fresh Chrome incognito window recommended for the empty-state item 14 walk.

---

## Non-negotiable — Desktop (wide window 1400px+)

### 1. New panel loads with chunky rows

> **Contract:** The retiring shadcn-derived ConversationsPanel is GONE. New chunky Telegram-style rows load in its place. Each row shows a 40px hue-ring avatar disc + primary label (session name = identity name) + secondary line (Server-glyph + host name).

- [ ] 🚨 **Fresh desktop page-load renders new rows.** Open Skynet on desktop. Wait for `/sessions/list` to resolve (~2s). Expected: the sidebar ConversationsPanel shows the NEW chunky rows — approximately **62px tall** (min-height), each with a **40px identity-hue avatar disc** (radial-gradient, with a `hsla(colorHue, 65%, 55%, 0.45)` hue-ring), primary label = the session name (= identity name per Ashley convention), and a secondary line with a **Server-glyph** + the host name. **If: rows look dense/compact like before** → the AppShell cutover regressed; the old ConversationsPanel is still mounted somewhere. Grep the compiled `dist/assets/AppShell-*.js` for `ConversationsPanel` — should ONLY appear inside `PrettyConversationsPanel` string mentions (comment-preserved history annotations from Wave 4).
- [ ] 🚨 **No IdentityBadge chip on rows.** Look closely at any identity row. Confirm there is NO chip/badge showing the identity name in the row body. The label carries the identity presence, the avatar hue-ring reinforces it — no separate chip. **If: chip visible** → PrettyConversationRow accidentally regained the IdentityBadge import (grep confirmed zero at Wave 1 commit `55624a9`).

### 2. Selected-row treatment matches ChatMessage assistant bubble

> **Contract:** Clicking a row applies the same `hsla`-gradient treatment ChatMessage.tsx uses for assistant bubbles — verbatim class strings adapted for row geometry (reduced alpha per prototype.html lines 231-239).

- [ ] 🚨 **Click any identity row and verify hue-lift.** Click a row (any identity). Expected: the row background acquires the identity's hue as a gradient lift — matches the pretty-view assistant bubble's `hsla(hue,50%,38%,0.30) → hsla(hue,45%,24%,0.35)` treatment, plus a subtle hue-border and inset+outer hue glow. Open the pretty-view pane in the main area for the same identity — the row's selected state and the assistant bubble should visually share the SAME hue tint (this is intentional; the panel adopted the pretty-view visual language). **If: no visible tint change** → selected-state branch in PrettyConversationRow.tsx regressed. **If: tint is wrong hue** → the identity's `colorHue` isn't reaching the row; check identity-store resolution.

### 3. Pin toggle — hover-reveal on desktop

> **Contract:** Hover any unpinned row → 24x24 pin button appears in the right column. Click → row jumps to top with a filled pin glyph in the identity hue. Pinned rows keep the pin button always visible.

- [ ] 🚨 **Hover on unpinned row shows pin button.** Move your mouse over an unpinned row. Expected: a **24x24 rounded pin button** appears in the right column (near the trailing edge of the row). It's the lucide `Pin` outline glyph. Hover another row and confirm the button hides on the first row and appears on the second. **If: no button on hover** → PinAction desktop variant not being rendered; check PrettyConversationRow.tsx `variant === "desktop"` branch.
- [ ] 🚨 **Click pin button and verify row floats to top.** Click the pin button on a row currently in a host group mid-list. Expected: row snaps to the top of the list (above all unpinned rows), the pin glyph changes to the FILLED `Pin` variant, and the button is now permanently visible (no hover required). Pin color = identity hue. **If: row doesn't move** → pin-toggle wiring regressed at panel level; check `useConversations()` sort order. **If: glyph doesn't fill** → PinAction's `pinned` prop not threaded.
- [ ] 🚨 **Click pin button on pinned row and verify row falls back into its host group.** Click the (now filled) pin button on the just-pinned row. Expected: row drops back to its original host-group position, pin glyph reverts to outline, button hides on mouseleave.

### 4. Header pencil = new session

> **Contract:** The full-width labeled "New Session" CTA is REPLACED with a compact 34x34 pencil icon in the panel header. Click opens the existing NewSessionDialog byte-identical to Phase 7.

- [ ] 🚨 **Pencil icon in sidebar header.** Look at the top of the ConversationsPanel scroller. Expected: header row shows label ("Conversations") + a compact **34x34 pencil icon-button** in the right column (with the gear next to it). The pencil is the lucide `Pencil` glyph. No more full-width "New Session" button below the pins. **If: full-width button still present** → header retained the old NewSessionButton mount; check Wave 3's cutover.
- [ ] 🚨 **Click pencil opens NewSessionDialog.** Click the pencil. Expected: the SAME NewSessionDialog as Phase 6/7 opens — Radix modal, filterable host list, optional session-name input, Cancel + Open buttons, all i18n copy unchanged. Cancel → dialog closes cleanly. **If: nothing happens** → dialog `open` prop wiring regressed; check PrettyConversationsPanel.test.tsx Test 5 for the contract.

### 5. Header gear = settings dropdown

> **Contract:** Compact 34x34 gear icon-button next to the pencil in the header. Opens the same SETTINGS_MENU_ITEMS dropdown as Phase 6.

- [ ] 🚨 **Gear icon next to pencil.** Verify the gear icon (lucide `Settings`) appears next to the pencil in the sidebar header. Same 34x34 size, same icon-only chrome (no label). **If: gear absent** → showGear gate broke; check `variant === "desktop"` branch.
- [ ] 🚨 **Click gear opens settings dropdown.** Expected: same dropdown menu as Phase 6/7 (Host Manager, Credentials, Connections, Quick Connect, SSH Tools, Snippets, History, Split Screen, User Profile, Admin Settings). All entries route correctly (same handleRailClick as before).

### 6. Persistent top-left chevron toggle

> **Contract:** A fixed 32x32 chevron button lives at `top: 8px, left: 8px, z-index: 30` in the AppShell — visible at ALL window widths (this fixes the small-window sidebar-affordance regression Ashley called out). Rotates 180° when sidebar is open vs collapsed.

- [ ] 🚨 **Chevron button visible top-left.** Look at the top-left corner of the app shell. Expected: a **32x32 glass-treatment chevron button** at `top: 8px, left: 8px`. Style matches desktop.html mock — subtle backdrop-blur, thin border. **If: no button** → Wave 3's persistent-toggle addition regressed; grep AppShell.tsx for `top: 8px, left: 8px`.
- [ ] 🚨 **Click chevron collapses/expands sidebar.** Click the chevron. Expected: sidebar collapses. Chevron rotates 180° (points RIGHT when sidebar closed; points LEFT when open). Click again — sidebar expands, chevron rotates back. **If: no rotation** → the `sidebarOpen` state binding on the CSS transform regressed. **If: sidebar doesn't collapse** → the click handler isn't wired to the AppShell's sidebar-toggle state.

### 7. Small-window regression fix (THE headline bug this phase fixes)

> **Contract:** At Ashley's typical narrow-window desktop size (~600-800px wide), the old thin-strip clickable-affordance would disappear when the sidebar was collapsed, leaving the sidebar unreachable. The new persistent top-left toggle stays visible at ALL widths — this is the fix.

- [ ] 🚨 **Shrink browser window to ~600px width.** Grab the window corner and drag to shrink Chrome to ~600px wide (or use DevTools "Toggle device toolbar" set to iPad Portrait 768px). Expected: the persistent top-left toggle STAYS VISIBLE at every intermediate width. **If: toggle disappears at any width** → the persistent toggle regressed to width-conditional rendering.
- [ ] 🚨 **Collapse and re-expand at narrow width.** Click the chevron while at narrow width. Sidebar collapses. Chevron STAYS VISIBLE (this is the fix — at this width the old thin-strip was gone). Click again — sidebar expands. **This is THE headline fix Ashley called out at Phase 10 spec.**
- [ ] 🚨 **No thin-strip artifact at narrow width.** With sidebar collapsed at narrow width, verify there is NO leftover thin clickable strip between the top-left toggle and the main content. The old AppShell had a strip at line 1844-1852 that was removed in Wave 3 (`65c572c`). **If: thin strip still visible** → the retirement didn't land cleanly.

---

## Non-negotiable — Mobile (iPhone / Skynet PWA)

### 8. Mobile variant loads with chunky rows + compact header

> **Contract:** On mobile (touch device), rows are ~72px tall with 48px hue-ring avatar discs. Header shows the compact pencil ONLY (no gear, no title text — the gear moved to the mobile SettingsRow at the bottom of the scroller per Phase 6 TG-18 dedup).

- [ ] 🚨 **Open Skynet PWA on iPhone.** Home screen → tap Skynet. Expected: the mobile list screen shows the NEW chunky rows with **48px hue-ring avatar discs**, 72px min-height, primary label + host secondary line. **If: rows look like desktop** → the `variant` prop isn't being computed from `useIsTouchDevice()`; check PrettyConversationsPanel's variant selection.
- [ ] 🚨 **Header shows compact pencil ONLY.** Look at the top of the mobile ConversationsPanel. Expected: just the compact pencil icon in the header (no gear, no "Conversations" title text). **If: gear visible on mobile** → TG-18 dedup regressed. **If: title text visible** → mobile variant of PrettyConversationsPanel header regressed.
- [ ] 🚨 **Rows are chunkier than desktop.** Compare eye-height of a row to what you saw on desktop. Expected: mobile rows are visibly taller (72px vs 62px) with larger avatars (48px vs 40px) — generous tap targets, Telegram-native feel.

### 9. Flat list — no section headers, no "Pinned"

> **Contract:** Flat scroll region. No "Pinned" section header. No per-host semibold headers. Pin glyph on the row IS the marker for pinned status. RDP rows still sit at the bottom (with the subtle "Remote desktop" divider chip and Monitor-glyph avatars — same as Phase 7).

- [ ] 🚨 **No "Pinned" header at the top.** Scroll to the top of the mobile list. Expected: pinned rows are simply at the top (no header separator, no "Pinned" label). **If: header visible** → the flat-list decision regressed.
- [ ] 🚨 **No per-host section headers.** Scroll through the list. Expected: rows flow continuously — NO semibold host-name section headers between host groups. The host name appears on the row itself (secondary line). **If: headers visible** → PrettyConversationsPanel `renderHostGroup` accidentally started rendering section headers.
- [ ] 🚨 **Filled pin glyph on pinned rows.** Scroll to the top. Expected: pinned rows show a small **filled pin glyph** in the identity hue somewhere on the row (leading side of the secondary line or trailing right column, per prototype.html). Unpinned rows show no glyph. **If: filled pin glyph missing** → PinAction pinned-state variant regressed.

### 10. Swipe-left pin reveal

> **Contract:** Swipe an identity row leftward past 40px → hue-tinted pin action button reveals. Tap to toggle pin. Only one row swiped-open at a time. Vertical scrolling not hijacked.

- [ ] 🚨 **Swipe left on any identity row.** Do a horizontal swipe-left gesture starting from the middle of a row. Expected: the row body translates left, revealing a **hue-tinted 48x48 pin action button** on the right side. Snaps open past ~40px past neutral. **If: nothing happens** → touch handlers didn't wire; grep PrettyConversationRow.tsx for `onTouchStart`.
- [ ] 🚨 **Tap the revealed pin action.** Tap the visible pin action button on a swiped-open row. Expected: the row's pin state toggles. Row jumps to top with a filled pin glyph (if just pinned) or drops back into its host group (if just unpinned). Swipe closes automatically after the tap. **If: pin doesn't toggle** → onPinToggle handler wiring regressed.
- [ ] 🚨 **Swipe row A, then swipe row B.** Do the two swipes in sequence. Expected: row A closes automatically the moment row B opens. **Only one row is swiped-open at any time.** This is the `forceClosed` coordination surface working correctly. **If: both rows stay open** → the `currentlySwipedId` state at panel level regressed.
- [ ] 🚨 **Tap swiped-open row body → closes.** With a row swiped-open, tap somewhere on the visible row body (not the pin action). Expected: swipe closes, no navigation triggered (the tap-body-closes-instead-of-selects semantic). **If: navigation triggers** → the row's tap dispatch is misrouting through onSelect.
- [ ] 🚨 **Swipe-right on swiped-open row → closes.** With a row swiped-open, do a horizontal swipe-right on it. Expected: the row snaps closed.

### 11. Vertical scroll not hijacked

> **Contract:** Starting a vertical swipe on a row should let the list scroll normally — the swipe state machine bails when the gesture crosses a 12° angle threshold (PC_SWIPE_ANGLE_TOLERANCE).

- [ ] 🚨 **Scroll the list vertically starting from a row.** Put your finger on any row and drag DOWN or UP to scroll the list. Expected: normal vertical scroll — NO swipe action reveals, NO horizontal translation on the row. **If: swipe hijacks vertical scroll** → the 12° angle-tolerance bail-out regressed.

### 12. RDP rows can't be pinned (T-Test-34 preserved)

> **Contract:** Scroll to the RDP rows at the bottom of the list. Swipe-left on any RDP row → nothing happens. No pin action, no swipe reveal. This preserves the Phase 7 T-Test-34 constraint (RDP rows don't participate in the pinning mechanism).

- [ ] 🚨 **Scroll to bottom of mobile list.** Expected: the RDP sentinel section appears below all identity-tmux rows. Subtle divider chip labeled "Remote desktop" + Monitor-glyph avatars (no identity hue) — same as Phase 7 TG-15.
- [ ] 🚨 **Try to swipe-left on an RDP row.** Expected: NOTHING happens. No horizontal translation, no pin action reveal, no swipe strip. The RDP row's `rdpHostRow: true` marker causes the row to skip the touch listener wiring entirely. **If: RDP row responds to swipe** → the row's variant-agnostic RDP branch regressed; check `if (row.rdpHostRow) return early` in the touch handler.

### 13. Mobile settings row at bottom

> **Contract:** Below the last identity/RDP row, a SettingsRow with the gear icon renders — mobile's canonical entry point to the SETTINGS_MENU_ITEMS registry (per Phase 6 TG-18 dedup).

- [ ] 🚨 **Scroll to the very bottom of the mobile list.** Expected: below the last RDP row (above the iOS home indicator safe-area padding from patch #126), a SettingsRow renders with the gear icon and label. Tap → same dropdown menu as desktop's header gear. **If: SettingsRow absent** → the `settingsRowSlot` prop wiring at AppShell:1348 regressed.

### 14. Empty state renders idle glass card

> **Contract:** If a user has zero identity-tmux sessions AND zero RDP-enabled hosts (rare but possible on first-login), the empty state renders a PlanPendingBubble-style idle glass card centered in the scroll region with "No conversations yet" copy.

- [ ] 🚨 **Empty-state walk (only if you can reproduce it).** In a fresh Chrome incognito window OR after logging into a scratch account with no configured hosts, open Skynet. Expected: instead of the empty scroller, an **idle glass card** centered in the panel with "No conversations yet" text. Matches PlanPendingBubble's visual treatment (subtle glass, no motion). **If: bare empty scroller** → the empty-state branch in PrettyConversationsPanel regressed.
- [ ] Note: if you can't reproduce empty state (you always have configured hosts + RDP), skip. Non-blocking to observe on prod; PrettyConversationsPanel.test.tsx Test 1 already gates this contract in CI.

### 15. Mobile header pencil = new session (auto-navigate)

> **Contract:** Tap the compact pencil in the mobile header → NewSessionDialog opens → complete → new session created + auto-selected + auto-navigates to the view screen (existing Phase 6 Plan 06-03 mobile behavior).

- [ ] 🚨 **Tap pencil in mobile header.** NewSessionDialog opens. Same modal as desktop. Filterable host list + optional name field.
- [ ] 🚨 **Complete new-session flow.** Pick a host, leave name empty (or fill in), tap Open. Expected: dialog closes, new session gets created and auto-selected. **Mobile auto-navigates to the view screen** (list vanishes, session pane shows). **If: mobile stays on list screen** → the mobile auto-navigate behavior from Phase 6 Plan 06-03 didn't survive the Wave 3 cutover.

---

## Cross-viewport regression — Phase 6/7 behaviors that must survive

### 16. Pretty-view internals unchanged

- [ ] 🚨 **Open any identity session and confirm pretty-view renders identically to pre-Phase-10.** ChatMessage bubbles, ComposeBox (post patches #118-#127 layout), WipBubble spinner, PlanPendingBubble, HarnessTasksPanel, backgrounded-agents panel, backgrounded-shells panel — all render as they did the day before Phase 10 shipped. Phase 10 is presentation-only for the sidebar; it MUST NOT touch pretty-view internals.

### 17. Session persistence — switch A → B → A, no reconnect

- [ ] 🚨 **Click identity A. Scroll in pretty view. Click identity B. Click identity A again.** Expected: INSTANT switch back to A. Scroll position preserved. Terminal buffer preserved. ComposeBox draft preserved. **THIS IS THE ULTIMATE PROOF THAT WAVE 3's AppShell CUTOVER DIDN'T BREAK T-06-02-01** — the tabNodesRef DOM-move mechanism (patch #35) is preserved. **If: reconnect indicator or scroll reset** → the mount-lifecycle contract regressed at the AppShell cutover site.

### 18. RDP tab lifecycle unchanged

- [ ] 🚨 **Click an RDP row.** RDP tab opens, guacamole canvas connects normally. **Click back to identity tab.** RDP tab stays connected (Phase 6 lock — RDP disconnect/reconnect behavior unchanged). **Click back to RDP.** Same connected canvas.

### 19. Fleet-native rows appear on fresh page-load (Phase 7 lock)

- [ ] 🚨 **Fresh incognito → fleet rows appear.** Fresh incognito window, ensure at least one tmux identity session exists on the backend. Load Skynet. Expected: identity rows for fleet-discovered tmux sessions appear (from the one-shot `/sessions/list` fetch — Phase 7 Plan 07-01 lock). Clicking a fleet-only row transparently attaches (Phase 7 TG-14 lock, no dialog).

---

## Optional polish (YELLOW = deploy but log for follow-up)

### 20. Selected-row hue matches identity chip color

- [ ] **For 2-3 identities in a row**, verify the row's selected-state glow color visually matches the identity's colorHue driving the pretty-view assistant bubble. This is a subjective eyeball match — if the row lift feels obviously mismatched from the assistant bubble on the same identity, log it and Tina can inspect the alpha values against the ChatMessage.tsx source-of-truth strings.

### 21. Chevron animation smoothness

- [ ] **Toggle sidebar 3-5 times in quick succession** by clicking the persistent top-left chevron. Expected: rotation is smooth, no visual jank, no jumping between rotation states. If it feels janky, the transition timing on the transform can be tuned in a follow-up polish patch.

### 22. Empty-state glass card centered vertically

- [ ] **If you can reproduce empty state (rare):** the idle glass card should sit vertically centered in the scroll region, not top-aligned. Non-blocking; visual polish. Follow-up sweep can add a `flex items-center` wrapper if it's top-anchored.

---

## Sign-off

| Item | Status | Ashley notes |
|------|--------|--------------|
| 1-7 (Desktop non-negotiable) | ⬜ | |
| 8-15 (Mobile non-negotiable) | ⬜ | |
| 16-19 (Cross-viewport regression) | ⬜ | |
| 20-22 (polish) | ⬜ | |

**Ashley signature:** ______________  **Date:** ______________
**Deploy verdict (circle one):** GOOD / CONDITIONALLY-GOOD (list items) / ROLLBACK

---

## Failure → route-back table

| Failed item | Root Wave | Route-back target |
|---|---|---|
| 1 (rows dense/old panel still mounted) | Wave 3 (AppShell cutover) | Re-verify `a2868e6` — the mount-site swap |
| 1 (no IdentityBadge on rows) | Wave 1 (Row foundation) | Re-verify `55624a9` grep for zero IdentityBadge imports |
| 2 (selected-row hue absent) | Wave 1 (Row selected-state) | Re-verify PrettyConversationRow.tsx selected-state branch |
| 3 (pin toggle broken) | Wave 1 (PinAction) or Wave 2 (panel wiring) | Bisect between `55624a9` and `3cab53e` |
| 4/5 (header icons broken) | Wave 2 (panel header render) | Re-verify PrettyConversationsPanel.tsx variant-based header |
| 6/7 (top-left toggle broken / narrow-window regression back) | Wave 3 (persistent toggle) | Re-verify `65c572c` |
| 8-9 (mobile variant/flat-list broken) | Wave 2 (panel + variant prop) | Re-verify `3cab53e` |
| 10-12 (swipe mechanics) | Wave 1 (swipe state machine) | Re-verify PrettyConversationRow.tsx touch handlers |
| 13 (SettingsRow absent) | Pre-Wave-1 (unchanged from Phase 6) | Check AppShell:1348 `settingsRowSlot` prop wiring |
| 14 (empty state) | Wave 2 (panel empty-state branch) | Re-verify PrettyConversationsPanel.tsx `isEmpty` derivation |
| 15 (mobile auto-navigate) | Pre-Wave-1 (unchanged from Phase 6 Plan 06-03) | Check AppShell mobile-view auto-navigate on new session |
| 16 (pretty-view internals broken) | Any Wave (scope-fence breach) | STOP — this means Phase 10 breached its scope fence, which was NOT supposed to happen |
| 17 (session persistence broken) | Wave 3 (AppShell cutover / tabNodesRef site) | Bisect T-06-02-01 contract at `a2868e6` |
| 18 (RDP lifecycle broken) | Any Wave (scope-fence breach) | STOP — same as 16 |
| 19 (fleet rows absent on fresh load) | Any Wave (Phase 7 regression) | Check the Phase 7 `useEffect` fleet fetch at AppShell mount site |

---

## Post-UAT deploy runbook (only if 1-19 are all green)

Once Ashley greenlights, the deploy sequence for the batched #123-#128 stack (single build/deploy per current fork DEPLOY DISCIPLINE — the 15-min deadman regime was retired 2026-07-21):

1. **Confirm the batch is on the branch.** `git log --oneline feat/tab-title-from-tmux | head -30` — verify all Phase 10 commits from Wave 1 through Wave 5 are present, plus the #123-#127 patches from the earlier batch.
2. **Sanity grep on the compose file.** `grep -n "skynet-patched:local" /opt/skynet/docker-compose.yml` — check-before-recreate that we're pinned to the patched image tag.
3. **Push the branch** (only after Ashley signs off): `git push origin feat/tab-title-from-tmux`.
4. **Build the image on the deploy host:** `sudo docker build -t skynet-patched:local ~/skynet` (from the freshly-pulled branch).
5. **Recreate the container:** `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`.
6. **Wait for healthy.** `docker ps` shows skynet as `(healthy)` — typically within 30s.
7. **Verify patch signature bytes in the container** (optional smoke): `docker exec skynet grep -c "PrettyConversationRow" /app/dist/assets/AppShell-*.js || echo "grep-fallback-check-source-mangling"`. If the identifier survived (or via a fallback: grep the panel scroller className `pretty-conversations`), the new panel shipped.
8. **Hand back for full-flow UAT.** Ashley walks items 1-19 above on desktop AND iPhone.
9. **If PASS:** paste the patches-md draft into `~/.claude/identities/tina/skynet-patches.md` (with the fill-in placeholders resolved from the build-verify log), bump the patch count, commit the pin, `/close pretty-conversations-panel-redesign`.
10. **If any 🚨 fails:** decide by severity per the route-back table above. Prod is running the batched-patched image; no automatic rollback (deadman regime retired 2026-07-21). Manual rollback if needed via the previous-known-good image tag.

---

*Phase: 10-pretty-conversations-visual-language-rework*
*Checklist generated: 2026-07-22 (Wave 5 automation)*
*Design source-of-truth: prototype.html + desktop.html at ~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/*
*Sign-off block at top of page.*
