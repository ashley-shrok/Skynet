# Phase 13 UAT Checklist — Skynet transformation: conversation list lift-from-mock (final Ship-of-Theseus slice)

**For:** Ashley
**Post-deploy validation of patch #140 (Phase 13 — Ship-of-Theseus final slice: conversation-list row/panel-header/pin/chevron lifted verbatim from mock v4)**
**Batch context:** Patch #140 is the FINAL Ship-of-Theseus slice. **DO NOT deploy standalone.** Batch with patch #138 (Phase 11 first slice — landing swap + AppRail retirement) + patch #139 (Phase 12 second slice — panel/dashboard/tab-bar deletion + PURGE-09 + locale strip) per the fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23) — see § Post-UAT deploy runbook at the bottom. When shipped, patches #138 + #139 + #140 together tell the "we deleted the Skynet client surfaces AND lifted the remaining conversation-list surface verbatim from the mock" story.
**Deploy anchor:** term.gigaashley.click (production) — post-deploy, once Ashley greenlights the batch.
**Design source-of-truth:** `~/.claude/identities/tina/bounties/skynet-transformation/prototype.html` (LOCKED mock v4, Ashley signed off 2026-07-23; Full-intensity + Normal density variant with active-set/ambient recession and single ready-for-attention dot is what ships) + `.planning/phases/13-skynet-transformation-conversation-list-lift-from-mock/13-CONTEXT.md` (LOCKED — no re-litigation) + `~/.claude/identities/tina/tina.md` § "Skynet direction — the app IS Telegram" (mental model).

**Trace commits (Phase 13 on `feat/tab-title-from-tmux`):**

- Plan 01 (Wave 1 — row + CSS foundation): `e7eb080` (feat(13-01): lift mock CSS into pretty-conversations.css + wire import), `aabd216` (feat(13-01): rewrite PrettyConversationRow with class-toggle state variants + tests), `9994062` (refactor(13-01): retire unused row-min-height layout tokens), `a4d5d10` (docs(13-01): summary)
- Plan 02 (Wave 2 — panel header + AppShell chevron): `d165e02` (feat(13-02): rewrite PrettyConversationsPanel header to mock's class-toggle treatment), `7cfee26` (test(13-02): update PrettyConversationsPanel header tests), `cfc92c0` (feat(13-02): rebase AppShell sidebar-toggle chevron to --color-pv-* palette + mock pencil treatment), `42ac07c` (docs(13-02): summary)
- Plan 03 (Wave 3 — PinAction): `c2e48de` (feat(13-03): rewrite PinAction desktop to mock's bare-icon-with-hue-glow), `1f854dd` (docs(13-03): summary)
- Plan 04 (Wave 4 — pre-UAT diagnostic): `843942e` (docs(13-04): pre-UAT diagnostic sweep + UAT template + route-back matrix), `ee4de1e` (docs(13-04): summary)
- Plan 05 (Wave 5 — docs closeout): this commit

**Build-verify status (per `13-BUILD-VERIFY-LOG.md`):**

- `npx tsc --noEmit` — exit 0
- `npx vitest run` — 524/526 passing (2 pre-existing ComposeBox failures inherited from Phase 10 via Phase 11 + Phase 12; zero net-new Phase 13 regressions)
- `npm run build` — exit 0 in 8.87s
- All 21 grep hygiene gates PASS (SHAPE-01/02/03/04/06/07 non-negotiables + baseline preservation carry-forward from Phase 11 + Phase 12)
- **AppShell chunk delta: −6.18 kB / −8.32%** vs Phase 12 tip (cumulative Phase 11 + Phase 12 + Phase 13 vs Phase 10 tip: −380.76 kB / −84.8%)
- **SHAPE-06 scope-boundary evidence:** `git diff --stat f1c77fd..HEAD` on `src/ui/features/pretty-view/`, `src/ui/components/`, `src/ui/ssh/`, `src/ui/features/terminal/` returns 0 lines each — the four locked directories are byte-preserved from Phase 12 tip through Phase 13 tip

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All items in Desktop 1-12 + Mobile 13-20 + Cross-viewport 21-26 pass** → **greenlight patch #140 for the batched Phase 11+12+13 purge cluster deploy**. Per the fleet-standing "batch patches into meaningful deploys" rule, the default answer is HOLD until the full cluster is verified end-to-end. Only greenlight standalone if there's a specific reason (Ashley wants to smoke-test the Skynet SHAPE completion on prod before further work, or something is actively broken in prod that Phase 13 fixes — Phase 13 doesn't fix anything broken in prod, it lifts the mock aesthetic onto the surface Ashley called out as "still looks Skynet"). Then help Tina pin patch #140: paste `.planning/phases/13-.../13-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` at the next ordinal position. If patches #138 + #139 have not yet been pinned, pin all three together as a combined "ONE HUNDRED THIRTY-SEVEN → ONE HUNDRED FORTY" bump. Commit the pin (`docs(patches): pin patches #138 + #139 + #140 — Skynet transformation Ship-of-Theseus movement complete`). Then close the master bounty `~/.claude/identities/tina/bounties/skynet-transformation/` on Ashley's UAT sign-off — the entire Ship-of-Theseus movement (Phases 11+12+13) is complete at this milestone.

- [ ] **Any item fails** → note the failing item and observed-vs-expected behavior. Decide by severity: if the failure is a visual delta from the mock (wrong padding, minor color hue drift, ambient recession slightly off), route through the Failure → route-back table below to the specific Plan/Wave. If the failure is functional (row treatment matches Skynet not mock, pin buttons still visible on unpinned rows, chevron still filled-glass, dot doesn't appear on clicked-idle rows, mobile scroll freezes), route back per the table. If SHAPE-06 scope violation (pretty-view interior changed, shadcn dialog broken, RDP visual regressed), HARD FAIL — the offending Wave gets reverted + rebased before phase-13 closes.

- [ ] **Nothing to log to `deferred-items.md`** — Phase 13 has no known-deferred polish items apart from candidates enumerated in `13-04-UAT-DIAG-LOG.md § Section 3` (safe-area architectural fix + mobile scroll `touch-action: pan-y` follow-up if the mobile UAT reproduces freeze). Those route to their own follow-up plans or to the master bounty per the diag-log's route-back matrix.

## How to use this checklist

Work through top-to-bottom on BOTH viewports (desktop + iPhone PWA). Each item has an action + expected result + "if this fails" note. Mark [x] as you go.

**Section order:**

1. Desktop UAT — items 1-12 (blocking) — SHAPE-01/02/03/04/05/06/07 coverage
2. Mobile UAT (iPhone PWA) — items 13-20 (blocking) — includes 13-04's mobile scroll + safe-area verifies
3. Cross-viewport regression checks — items 21-26 (blocking; Phase 6/7/10/11/12 behaviors that must survive)
4. Failure → route-back table
5. Post-UAT deploy runbook + master bounty closeout

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on a wide desktop window** (1400px+) AND in **Skynet on your iPhone** (PWA-installed after patch #125, or Mobile Safari fallback).
2. Have at least 3 running tmux identity sessions on distinct hosts (different hues to verify hue propagation), plus at least one RDP-enabled host for items 8 + 18 walks, plus one fleet-only tmux session on a host you haven't attached to yet (for the fleet-derived row edge case in Cross-viewport item 25).
3. Open the mock in a second browser tab side-by-side: `file://~/.claude/identities/tina/bounties/skynet-transformation/prototype.html` — Full-intensity + Normal density variant selected. This is your visual parity comparator throughout the desktop walk.
4. Clear session storage on desktop for a truly-fresh page-load (item 1): DevTools → Application → Session Storage → Clear. Alternatively use a fresh Chrome incognito window.
5. On iPhone: fully close Skynet PWA (swipe up from app switcher) before item 13's fresh page-load.

---

## Desktop UAT (wide window 1400px+)

### 1. SHAPE-01/02: Fresh page-load — pretty-conversations panel renders with UPPERCASE title + transparent pencil

> **Contract:** Panel header title is UPPERCASE "CONVERSATIONS" (not mixed-case "Conversations"), 12px font + 700 weight + 0.1em letter-spacing, in `--color-pv-fg` warm-cream. Pencil is 32x32, transparent background + transparent border, 8px border-radius, `--color-pv-fg-muted` icon color, with `rgba(220,225,245,0.06)` hover fill. NOT the retired Skynet filled-glass pill (34x34, `rounded-full`, `bg-white/[0.04]`, mixed-case 13px chunky title).

- [ ] **Fresh page-load at `https://term.gigaashley.click/`** (no hash, session storage cleared per Setup 4). Look at the panel header at the top of the sidebar. Expected: title reads "CONVERSATIONS" in ALL CAPS, thin-ish 12px font with visible letter-spacing (looks tracked-out). Pencil icon on the right is a bare icon with no visible border/fill — hover over it and a subtle warm-tinted glass hover fill appears. Compare side-by-side against the mock's `.panel-header .title` + `.panel-header .pencil` treatment (Setup 3). If: title still mixed-case "Conversations" OR pencil is a filled 34x34 circle → route to Plan 13-02 Task 1 (`d165e02` — header rewrite didn't land).

### 2. SHAPE-01: Row treatment (active-set full bubble) matches mock v4

> **Contract:** Rows Ashley HAS clicked in this browser session (active-set) render with the Full-intensity treatment: 160deg linear gradient `hsla(hue, 50%, 38%, 0.55)` → `hsla(hue, 45%, 24%, 0.60)` with `hsla(hue, 60%, 65%, 0.32)` border, warm-cream `rgba(255, 220, 170, 0.18)` top inset rim, `hsla(hue, 70%, 55%, 0.20)` hairline trace + `hsla(hue, 65%, 50%, 0.18)` 32px outer glow shadow, backdrop-filter `blur(20px) saturate(1.5)`. Warm-cream `#fbf5e8` text.

- [ ] **Click Row A (any conversation).** Verify Row A immediately transitions from ambient to full-bubble treatment — deeper hue-tinted background, visible warm-cream text-shadow on the label, subtle hue outer glow around the row. Hover over Row A — row lifts `translateY(-1px)`, glow strengthens. Compare against mock's Full-intensity row (Setup 3). If: row treatment doesn't match (wrong gradient direction, no hue border, no warm inset rim, no glow) → route to Plan 13-01 Task 1 (`e7eb080` — CSS lift didn't land) or Plan 13-01 Task 2 (`aabd216` — row rewrite didn't emit correct classes).

### 3. SHAPE-01 (ambient recession): Rows Ashley HASN'T clicked read as ambient/recessed

> **Contract:** Rows NOT in Ashley's active-set (not clicked this session) read as ambient: flat `hsla(hue, 40%, 20%, 0.16)` rgba background (no gradient), 0.14 alpha muted border, minimal inset + hairline shadow, NO backdrop-blur, muted foreground text. Legible but recessed vs full-bubble active rows. This addresses Ashley's this-session complaint that "active conversations like ones that I've already loaded into are not glowing fully like they were supposed to. It seems like they more get like a glowing border or something."

- [ ] **Confirm rows Ashley HAS NOT clicked in this session** (all rows except Row A from item 2) render with ambient recession — flatter background, muted text, no glow. **Confirm active-set rows GLOW FULLY** (not just a glowing border — the whole bubble is hue-tinted with the warm inset rim). If: active-set rows show only a border (not full-bubble glow) → route to Plan 13-01 Task 2 (`aabd216` — the `.pv-row.active-set` class-toggle emission is wrong) OR the ambient recession alpha values in Wave 1 CSS are wrong (Plan 13-01 Task 1, `e7eb080`). If: EVERY row looks ambient (nothing glows) → the `activeSet.has(row.id)` propagation is broken (Candidate C failure — route to 13-04-UAT-DIAG-LOG.md § Section 3A row 6).

### 4. SHAPE-03: Pin buttons only visible on pinned rows or on hover; bare-icon-with-hue-drop-shadow

> **Contract:** Mock's `.row:not(.pinned) .meta .pin { display: none }` invariant lifted verbatim. Pinned rows show a bare pin icon in the right `.pv-meta` column — no button chrome (no rounded-md, no bg-transparent, no `hover:bg-white/[0.06]`) — just the icon in `hsla(var(--pv-hue), 80%, 70%, 0.95)` with a `drop-shadow(0 0 4px hsla(var(--pv-hue), 80%, 60%, 0.55))`. Unpinned rows show NO pin button at all. On hover over an unpinned desktop row, the bare-icon pin action appears for the click affordance. This addresses Ashley's this-session complaint that "the pin buttons are totally obnoxious."

- [ ] **Pick a pinned row** (any row where you previously clicked the pin). Verify: right side of the row shows a bare hue-tinted pin icon with a subtle hue drop-shadow — no button border, no button background, no rounded-md chrome. Compare against mock's `.pinned .meta .pin` treatment (Setup 3). If: pin button is a rounded-md button with visible chrome → route to Plan 13-03 (`c2e48de` — PinAction rewrite didn't land).
- [ ] **Pick an unpinned row that Ashley HAS clicked** (active-set). Verify: NO pin button visible in the right column by default. Hover over the row → bare-icon pin action appears. Click it to pin → row now shows the pin icon permanently. Hover away → still visible (row is now pinned). Click again to unpin → row now shows no pin icon by default. If: pin button visible on unpinned rows even without hover → route to Plan 13-01 Task 1 (`e7eb080` — hover-reveal CSS rule missing) OR Plan 13-03 CSS augmentation missing the `:not(.pinned):not(:hover):not(:focus-within)` selector.

### 5. SHAPE-04: AppShell top-left chevron matches mock's `.pv-pencil` aesthetic

> **Contract:** Top-left persistent sidebar-toggle chevron (fixed at `top: max(env(safe-area-inset-top), 8px), left: 8px, z-index: 30`, 32x32 rounded-lg) rebased from Skynet filled-glass pill (`bg-[rgba(20,22,28,0.85)]` + `backdrop-blur-[10px]` + `border-white/[0.08]` + `shadow-[0_2px_8px_rgba(0,0,0,0.35)]` + `text-muted-foreground`) to mock's transparent bare-icon-with-rounded-md aesthetic — `bg-transparent`, `border border-transparent`, `text-[color:var(--color-pv-fg-muted)]` icon color, `hover:bg-[rgba(220,225,245,0.06)]` hover fill, `hover:border-[color:var(--color-pv-border-quiet)]` hover border, `hover:text-[color:var(--color-pv-fg)]` hover text. Visually consistent with the panel-header pencil from item 1.

- [ ] **Look at the top-left corner of the app shell.** The chevron button should look like a bare icon — no visible dark filled-glass pill, no white-alpha border by default, no drop-shadow. It should look like the panel-header pencil from item 1 aesthetically. Hover over it — subtle warm-tinted hover fill appears + hue-tinted border appears + icon color brightens. Compare against mock's `.panel-header .pencil` treatment (Setup 3) — visually consistent (bare button, no chrome). Click chevron — sidebar collapses, chevron rotates 180° to point right. Click again — sidebar expands, chevron rotates back to point left. If: chevron still has filled-glass pill treatment → route to Plan 13-02 Task 2 (`cfc92c0` — chevron rebase didn't land).

### 6. SHAPE-05: Ready-for-attention dot appears on clicked+idle rows (PRIMARY VERIFICATION)

> **Contract:** Cmd+R / iOS reload the page. Verify activeSet starts empty (all rows should be ambient). Click 3 different conversations one after another; once each agent is idle at the prompt, its row shows a bright hue-cream ready-dot in the right `.pv-meta` column. Rows NOT in Ashley's activeSet (not clicked this session) never show the dot regardless of agent state. Rows where the agent is currently working ("Claude is thinking...") do not show the dot until the response finishes. This is the SHAPE-05 requirement — Ashley's v4 lock is "one meaning: this row is in the active set AND its agent is idle."

- [ ] **Freshly-reloaded browser** (Cmd+R to clear sessionStorage). Verify activeSet is empty — all rows ambient, no dots visible.
- [ ] **Click Row A** (any conversation with an idle Claude pane, e.g., Ashley Prime at the prompt). Row A transitions to full-bubble treatment (item 2). Wait ~2s for backend `{type:"idle"}` frame. Expected: bright hue-cream dot appears in Row A's right `.pv-meta` column.
- [ ] **Click Row B** (a different conversation, ideally also idle). Repeat verification — dot appears on Row B.
- [ ] **Click Row C** (a third conversation, ideally also idle). Repeat — dot appears on Row C.
- [ ] **Rows NOT clicked this session** should NOT show a dot regardless of their agent's idle state (rows not in active-set have no `.active-set` class, so the CSS selector `.pv-row.active-set:not(.working) .pv-ready-dot { display: block }` doesn't fire). Confirm by scrolling through the panel and verifying only the 3 clicked-idle rows show the dot.
- [ ] **DevTools verification** (paste into Chrome/Safari console):
  ```js
  document.querySelectorAll('[data-pv-conv-ready-dot="true"]').length
  ```
  Expected: 3 (one per clicked+idle row). If 0: JS-gate condition `inActiveSet && isWorking === false` isn't evaluating true — refer to `13-04-UAT-DIAG-LOG.md § Section 3A` for the exhaustive route-back matrix. If some show dots and others don't: highly likely Candidate B.1 mismatch (fresh-terminal path key format divergence) — see § Section 3A row 4 for the follow-up action.

### 7. SHAPE-06: Pretty-view chat interior is IDENTICAL to pre-Phase-13

> **Contract:** `src/ui/features/pretty-view/` is byte-preserved from Phase 12 tip through Phase 13 tip (SHAPE-06 scope-boundary evidence: `git diff --stat f1c77fd..HEAD -- src/ui/features/pretty-view/ | wc -l` returns 0). The interior (bubbles, ComposeBox, IdentityBadge, message rendering, chat-column background) is completely unchanged.

- [ ] **Click into any pretty-view chat.** Confirm interior is identical to pre-Phase-13:
  - Bubbles: user cyan-tinted, assistant tan-tinted, tool-use plum
  - ComposeBox: bottom-anchored, auto-grow textarea, send button, aux button row
  - IdentityBadge: top-of-scroll identity display
  - Message rendering: markdown, code blocks, tool bubbles
  - Chat-column background: no visual change
- [ ] If ANY element inside pretty-view changed → **HARD FAIL — SHAPE-06 scope violation**; route back to whichever Wave/plan modified `src/ui/features/pretty-view/`. Since `git diff --stat f1c77fd..HEAD -- src/ui/features/pretty-view/` returns 0, this should not be reachable — but if it is, revert + rebase before phase-13 closes.

### 8. SHAPE-06: shadcn dialogs + SSH/RDP dialogs visually unchanged from pre-Phase-13

> **Contract:** `src/ui/components/` (shadcn primitives: input, skeleton, sidebar, card, sheet, sonner, password-input, command, tabs, alert-dialog, switch) + `src/ui/ssh/` (OPKSSHDialog, SSHAuthDialog, TmuxSessionPicker, WarpgateDialog, ConnectionLog) are byte-preserved from Phase 12 tip. Ship-of-Theseus rule: these still serve the RDP/SSH dialogs and xterm.js chrome that Ashley DOES see when she uses RDP/SSH, and preserving them preserves upstream Skynet rebase-ability.

- [ ] **Right-click a session** (or use whatever gesture opens SSH-auth prompts) → OPKSSHDialog / SSHAuthDialog / TmuxSessionPicker open. Confirm visual is IDENTICAL to pre-Phase-13 (Skynet theme classes preserved for shadcn + SSH dialogs per Ship-of-Theseus rule).
- [ ] **Open a NewSessionDialog** by clicking the pencil in the panel header (item 1). Confirm dialog visual is IDENTICAL to pre-Phase-13 — same Radix modal, same filterable host list, same Cancel/Open buttons.
- [ ] If any shadcn/SSH dialog visual changed → **HARD FAIL — SHAPE-06 scope violation** — route back to whichever Wave modified `src/ui/components/` or `src/ui/ssh/`. `git diff --stat` proves both directories are byte-preserved; this should not be reachable.

### 9. SHAPE-06: RDP row opens Guacamole with unchanged visual

> **Contract:** `src/ui/features/terminal/` is byte-preserved (xterm.js chrome). RDP-host-sentinel rows in the pretty-conversations panel continue to open Guacamole panes; `onRdpRowClick` handler in AppShell preserved verbatim (grep confirms 1 hit).

- [ ] **Scroll to the RDP-sentinel section at the bottom of the sidebar.** Click an RDP-enabled host row (Monitor-glyph avatar, "Remote desktop" divider above the section). Expected: main pane opens a new Guacamole tab. guacd actually connects — the remote-desktop canvas appears; keyboard input works; mouse events work. Compare against pre-Phase-13 visual — should be IDENTICAL.
- [ ] **Open an xterm.js SSH session** — terminal opens; visual is identical to pre-Phase-13.
- [ ] If RDP visual regressed OR xterm.js chrome changed → **HARD FAIL — SHAPE-06 scope violation**; route back to whichever Wave modified `src/ui/features/terminal/`.

### 10. Cross-viewport: NewSessionDialog opens; host picker works

- [ ] **Click the pencil in the panel header** (item 1's affordance). Expected: NewSessionDialog opens with the filterable host list + optional session-name input + Cancel/Open buttons. Pick a host, submit — new tab opens. Dialog behavior unchanged from Phase 12 tip.

### 11. Cross-viewport: Persistent top-left chevron toggle works

- [ ] **Click the top-left chevron.** Sidebar collapses; chevron rotates 180°. Click again — sidebar expands; chevron rotates back. Same behavior as Phase 10 patch #128 baseline, only the chevron's visual chrome changed (SHAPE-04).

### 12. SHAPE-07: Existing keyboard shortcuts unchanged

- [ ] **Double-shift** opens the command palette (existing Phase 6+ shortcut). Not touched by Phase 13.
- [ ] **Ctrl+Shift+O** (or the equivalent pretty-view toggle if it's a different combo) still toggles pretty-mode in terminal panes when a session is active. Not touched by Phase 13.
- [ ] **Ctrl+M** opens the message-queue drawer in a terminal pane. Not touched by Phase 13.

---

## Mobile UAT (iPhone / Skynet PWA)

### 13. SHAPE-01/02: Fresh page-load — mobile pretty-conversations list with mock's chunky treatment

> **Contract:** Phase 10 behavior preserved — mobile fresh page-load renders the pretty-conversations list view (not the view screen). Phase 13 lifted the mock's chunky mobile row treatment: 72px min-height, 12px 16px padding, 48px avatar, 15.5px label, 12.5px host (`.pv-row--mobile` variant). Panel header renders empty-left + right-anchored pencil (mock's mobile variant).

- [ ] **Fully close Skynet PWA** (swipe up from app switcher), then reopen. Expected: mobile list screen shows the chunky pretty-conversations rows — 72px minimum height, 48px hue-ring avatars, mock's mobile row treatment applied. Panel header shows the transparent 32x32 pencil on the right (no gear icon, gear was retired in patch #133). If: rows are still short/dense (pre-Phase-10 baseline) → the `.pv-row--mobile` variant CSS didn't land (Plan 13-01 Task 1 grep gate).

### 14. SHAPE-03: Swipe-left on a non-RDP row reveals mobile 48x48 pin action disc (PRESERVED fork affordance)

> **Contract:** Mobile 48x48 hue-tinted disc swipe-reveal treatment is preserved byte-for-byte from pre-Phase-13 (per Plan 13-03 decisions — mobile branch UNCHANGED). Ashley's iPhone swipe-reveal workflow works exactly as before.

- [ ] **Swipe left on a non-RDP row.** 48x48 mobile pin action disc reveals in the trailing region. Pin/unpin works. Swipe right or tap the row body closes the reveal. Same behavior as Phase 10/11/12 baseline.

### 15. SHAPE-05: Ready-dot appears on clicked+idle rows (mobile PRIMARY VERIFICATION)

- [ ] **Repeat the desktop item 6 test on iPhone PWA.** Fully close and reopen the PWA to freshly hydrate sessionStorage (may or may not clear the activeSet depending on PWA sessionStorage semantics — pin the Session Storage state via Safari devtools if needed). Click 3 conversations one after another. Verify dots appear on the 3 idle rows and not on unclicked rows. Copy the exact verdict from `13-04-UAT-DIAG-LOG.md § Section 2B` once populated: _PASS / FAIL_NO_DOTS / FAIL_PARTIAL / FAIL_WRONG_ROWS_.

### 16. Mobile scroll test (13-04 verify)

> **Contract:** Copy the verdict from `13-04-UAT-DIAG-LOG.md § Section 2C` once Ashley fills it in post-deploy. Wave 1 static analysis verdict: UNCHANGED FROM PRE-WAVE-1 (Wave 1 did NOT add `touch-action: pan-y` to `.pv-row` and did NOT change the touch handler strategy — if freeze reproduced pre-Wave-1, it will likely reproduce post-Wave-1; if it reproduces, single-line CSS fix `.pv-row { touch-action: pan-y }` is the recommended follow-up per 13-04-UAT-DIAG-LOG.md § Section 3B).

- [ ] **Scroll from top to bottom of the conversation list.** No freeze. Fast flick + slow drag both work. Try scrolling while a swipe is partially in progress (drag a row left ~10px, then try to scroll vertically without lifting finger). Copy verdict from 13-04-UAT-DIAG-LOG.md § Section 2C row-by-row: fast flick down _/_, slow drag down _/_, fast flick up _/_, slow drag up _/_, mid-swipe vertical scroll _/_. If: FAIL_FREEZE reproduces → follow the 13-04 § Section 3B route-back (add `.pv-row { touch-action: pan-y }` to pretty-conversations.css — single-line phase-13 follow-up).

### 17. Safe-area padding verify (13-04 verify)

> **Contract:** Copy the verdict from `13-04-UAT-DIAG-LOG.md § Section 2D` once Ashley fills it in post-deploy. Wave 2 static analysis verdict: WORKAROUND STILL NEEDED — the `pb-[env(safe-area-inset-bottom)]` workaround at PrettyConversationsPanel.tsx:233 is present and doing its job; architectural fix (move safe-area compensation to AppShell root) is a master-bounty patch, not phase-13 scope.

- [ ] **Scroll to the very bottom of the conversation list.** Verify the LAST row is NOT scrolled behind the iPhone home indicator (black bar at bottom). Copy verdict from 13-04-UAT-DIAG-LOG.md § Section 2D. If: last row scrolls under the home indicator → follow the 13-04 § Section 3C route-back (deeper investigation OR architectural fix at master-bounty level).

### 18. SHAPE-06: Pretty-view interior tap unchanged on mobile

- [ ] **Tap into a pretty-view chat.** Interior identical to pre-Phase-13 (same bubbles, same ComposeBox, same IdentityBadge, same message rendering). If any element inside pretty-view changed → HARD FAIL SHAPE-06 scope violation.

### 19. SHAPE-06: RDP row tap opens Guacamole (mobile runtime gate)

- [ ] **Scroll to the RDP-sentinel section. Tap an RDP host row.** Full-screen view transition to the Guacamole pane; guacd connects; the remote-desktop canvas appears. Same runtime PURGE-05 verification as desktop item 9, but on mobile. RDP visual IDENTICAL to pre-Phase-13.

### 20. Mobile PWA reinstall — safe-area seam still gray

> **Contract:** Phase 10 patch #126 rebased the mobile safe-area seam to `#0a0b12`. Confirming no regression from Phase 13's changes.

- [ ] **Remove Skynet from the iPhone home screen** (long-press → Remove App → Delete from Home Screen). Then in Mobile Safari, navigate to `https://term.gigaashley.click`, tap Share → Add to Home Screen. Reopen from the fresh install. Expected: top safe-area seam (above status bar) and bottom safe-area seam (above home indicator) render as `#0a0b12` gray — no white flash, no color mismatch. Phase 13 does NOT touch safe-area handling, but this is a paranoid cross-check.

---

## Cross-viewport regression checks

### 21. Message-queue drawer still works

- [ ] **Open any active tmux-identity session.** Press **Ctrl+M**. Expected: per-pane message queue drawer opens at bottom of terminal pane. Press Ctrl+M again — drawer closes. Not touched by Phase 13.

### 22. Pretty-view compose box + WipBubble + session-holding overlay behave

- [ ] **In an active session's pretty-view, type a message + hit ThumbsUp send.** Expected: message dispatches; WipBubble spinner shows briefly; if the identity is holding a session, the session-holding overlay behaves per Phase 2-10 baseline. Phase 13 does NOT touch pretty-view internals (SHAPE-06 lockout).

### 23. RDP session actually usable (PURGE-05 deep check)

- [ ] **In the RDP tab from item 9 (desktop) or item 19 (mobile), interact with the remote desktop.** Type on the remote keyboard. Click. Move windows around on the remote OS. Expected: remote desktop is USABLE — not just "the canvas rendered." Automated tests don't cover this; runtime UAT is the only proof.

### 24. Session persistence — switch A → B → A, no reconnect

- [ ] **Click identity A. Scroll in pretty-view. Click identity B. Click identity A again.** Expected: INSTANT switch back to A. Scroll position preserved. Terminal buffer preserved. Proves the T-06-02-01 tabNodesRef DOM-move mechanism (patch #35) survived Phase 13 (which doesn't touch this at all — mount-lifecycle scope is out of SHAPE-06's `src/ui/features/terminal/` fence).

### 25. Fleet-native rows on fresh page-load (Phase 7 lock)

- [ ] **Fresh incognito window → identity rows appear for fleet-discovered tmux sessions** (from the one-shot `/sessions/list` fetch — Phase 7 Plan 07-01 lock). Clicking a fleet-only row transparently attaches (Phase 7 TG-14). Row rendering uses the mock's `.pv-row` class contract (item 2's treatment). Not touched functionally by Phase 13.

### 26. Direct navigation to `#hosts`, `#admin`, `#snippets` still unreachable (Phase 11 preservation)

- [ ] **Type `https://term.gigaashley.click/#hosts` in address bar → press Enter.** Expected: 404-equivalent OR PrettyLandingCard (per Phase 11 Plan 04 UAT item 9 outcome). NOT the HostManagerPanel. Repeat for `#admin` (NOT AdminSettingsPanel) and `#snippets` (NOT SnippetsPanel). If any dead-surface panel renders → Phase 11's PURGE-03 regressed somehow (should not happen — Phase 13 doesn't touch AppShell tab-content routing).

---

## Sign-off

| Item | Status | Ashley notes |
|------|--------|--------------|
| 1-12 (Desktop UAT) | ⬜ | |
| 13-20 (Mobile UAT) | ⬜ | |
| 21-26 (Cross-viewport regression) | ⬜ | |

**Ashley signature:** ______________  **Date:** ______________
**Deploy verdict (circle one):** GOOD (batch #140 with #138 + #139 for the full Ship-of-Theseus movement deploy) / STANDALONE-DEPLOY (against the default batching rule — explicit reason: ____) / ROLLBACK

---

## Failure → route-back table

| Symptom | Root Plan / Wave | Route-back target |
|---|---|---|
| Row visual doesn't match mock (wrong gradient, wrong padding, wrong hue values, ambient recession off) | Plan 13-01 | Re-verify commits `e7eb080` (CSS lift) + `aabd216` (row rewrite). Grep the deployed dist bundle for `pv-row`, `pv-avatar`, `pv-body`, `pv-meta`, `pv-ready-dot` — all 5 should be present. |
| Panel header title still mixed-case "Conversations" instead of UPPERCASE "CONVERSATIONS" | Plan 13-02 Task 1 | Re-verify commit `d165e02` (header rewrite). Grep AppShell dist chunk for `.pv-title { text-transform: uppercase` — should be present in the CSS chunk. |
| Panel header pencil still a filled 34x34 rounded-full pill | Plan 13-02 Task 1 | Re-verify commit `d165e02`. `grep -cE 'pv-pencil' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` should return >= 1. |
| Pin buttons still visible on unpinned desktop rows (no hover-reveal invariant) | Plan 13-03 | Re-verify commit `c2e48de`. Grep pretty-conversations.css for `.pv-row.pv-row--desktop:not(.pinned):not(:hover):not(:focus-within) .pv-pin-action-desktop { display: none }` — should be present. |
| Pin buttons still have rounded-md button chrome + `bg-transparent hover:bg-white/[0.06]` | Plan 13-03 | Same — re-verify `c2e48de`. `grep -c 'pv-pin-action-desktop' src/ui/features/pretty-conversations/PinAction.tsx` should return >= 1. |
| AppShell chevron still filled-glass `bg-[rgba(20,22,28,0.85)]` + `backdrop-blur-[10px]` + `border-white/[0.08]` | Plan 13-02 Task 2 | Re-verify commit `cfc92c0`. Extract chevron block via `awk '/Phase 10 Wave 3: persistent top-left sidebar-toggle chevron/,/^\s*\)\}\s*$/' src/ui/AppShell.tsx` and grep for `--color-pv-fg-muted` — should be present. |
| Ready-for-attention dot doesn't appear after 3+ conversation clicks | Plan 13-04 diagnostic candidates A-D | Start with the SUSPECT/MISMATCH verdicts from `13-04-UAT-DIAG-LOG.md § Section 1A`. Highest-probability failure: Candidate B.1 (sessionWorkingKey mismatch in fresh-terminal path) — see § Section 3A route-back row 4. Ashley's DevTools snippet: `document.querySelectorAll('[data-pv-conv-ready-dot="true"]').length` should return 3 for 3 clicked+idle rows. |
| Ready-for-attention dot appears on wrong rows (rows NOT clicked this session) | Plan 13-04 § Section 3A route-back row 6 | activeSet incorrectly populated OR stale sessionStorage. Ashley clears sessionStorage: `sessionStorage.removeItem('pv-conv-active-set')` in devtools, reloads. If dots reappear immediately on non-clicked rows → new addToActiveSet bug (not previously suspected); investigate. |
| Mobile scroll-freeze reproduces on iPhone PWA | Plan 13-04 § Section 3B route-back | Apply single-line CSS addition: `.pv-row { touch-action: pan-y }` in pretty-conversations.css. Follow-up plan (13-06 or 13-05-follow-up) — pretty-conversations.css IS in phase-13 scope. |
| Last row on mobile scrolls behind home indicator | Plan 13-04 § Section 3C route-back | Ashley checks in Safari devtools whether `pb-[env(safe-area-inset-bottom)]` is computed on PrettyConversationsPanel.tsx:233. If yes but visually failing — deeper layout issue. Architectural fix (move safe-area compensation to AppShell.tsx:1400 outer wrapper) is master-bounty patch, not phase-13. |
| Pretty-view chat interior changed (bubbles/ComposeBox/IdentityBadge/etc.) | HARD FAIL — SHAPE-06 scope violation | `git diff --stat f1c77fd..HEAD -- src/ui/features/pretty-view/` should return 0 (build-verify log confirmed). If it doesn't, identify the Wave/plan/commit that violated, revert + rebase before phase-13 closes. |
| Shadcn dialog / RDP visual changed | HARD FAIL — SHAPE-06 scope violation | `git diff --stat f1c77fd..HEAD -- src/ui/components/`, `src/ui/ssh/`, `src/ui/features/terminal/` should all return 0 (build-verify log confirmed). If any doesn't, identify the Wave/plan/commit that violated, revert + rebase before phase-13 closes. |
| tsc broken / build broken | Any Phase 13 Wave | Bisect via `git log --oneline f1c77fd..HEAD` — the 8 Phase 13 code commits each has its own per-commit tsc gate per Plan-per-Wave verify sections. Re-run `npx tsc --noEmit` at each commit to identify the regression source. |

---

## Post-UAT deploy runbook

### AUTHORITATIVE SOURCE

**Deploy procedure lives at `~/.claude/identities/tina/deploy-runbook.md`** (dated post-2026-07-21). This is the current, self-contained procedure for shipping `skynet-patched:local` onto skynet-ec2. **Follow the steps in that file verbatim.** This UAT checklist does not duplicate the runbook; it points at it.

### Stale-reference callout — do NOT follow the fork CLAUDE.md 15-min deadman regime

The fork's `CLAUDE.md` (in this repo root) still contains this line under `Deploy safety`:

> "Every `docker compose up -d --force-recreate skynet` runs behind the 15-min deadman rollback timer (`/opt/skynet/.tmp-revert.sh`) — no exceptions, per Ashley 2026-07-03, even when she is at the keyboard."

**THIS CONSTRAINT WAS RETIRED FLEET-WIDE ON 2026-07-21.** Ashley's SSM-tmux-attach-via-SSH-over-SSM fallback (documented in `deploy-runbook.md` § "FALLBACK: tmux-attach via SSH-through-SSM") replaced the deadman's catastrophic-loss-recovery role. The fork's `CLAUDE.md` hasn't been updated yet; that update is a **SEPARATE OPEN BOUNTY** — `claude-md-15min-deadman-stale` — that will land in a Phase-13+ hygiene sweep. **Ignore the fork CLAUDE.md's 15-min deadman line. Use `~/.claude/identities/tina/deploy-runbook.md` as the authoritative source.**

### FLEET-STANDING BATCHING RULE (Ashley 2026-07-23) — patch #140 SHOULD NOT auto-deploy

**"Batch patches into meaningful deploys — one patch ≠ one deploy."** Ashley called this out 2026-07-23 immediately after patch #135 landed (I keep reflexively recommending a deploy after every single fork patch, and every container recreate kills 20+ live WebSocket sessions across her open fleet). Phase 13 patch #140 **MUST NOT auto-deploy**. Batch it until:

- **Ashley explicitly says "deploy" for this batch,** OR
- **A grouped semantic unit is complete** — the natural batching unit for patch #140 is patches #138 + #139 + #140 together as "the Ship-of-Theseus movement complete" (Phase 11's landing swap + AppRail retirement + Phase 12's dashboard/panel-file deletion + Phase 13's conversation-list lift-from-mock — three slices, one deploy), OR
- **Something is actively broken in production requiring an emergency patch ship** (Phase 13 doesn't fix anything broken in prod — it lifts the mock aesthetic onto the surface Ashley called out — so this scenario does not apply).

**The default answer is HOLD.** Do not treat "code-complete-clean" as "deploy-ready." Patch #140 sits in the batch queue with patches #138 + #139; the deploy notification to Ashley bundles all three into ONE UAT + ONE recreate + ONE pin.

### CHECK-BEFORE-RECREATE ONE-LINER (survived deadman retirement, per `~/.claude/identities/tina/tina.md` § learned preferences)

Before EVERY `docker compose up -d --force-recreate skynet`, grep the compose file image line to catch any stale `sed` or leftover `sleep 900` process that might have rewritten the compose image line back to `ghcr.io/lukegus/skynet:latest`:

```
grep 'image:' /opt/skynet/docker-compose.yml | grep -q skynet-patched:local || \
  sudo sed -i 's|image: ghcr.io/lukegus/skynet:latest|image: skynet-patched:local|' /opt/skynet/docker-compose.yml
```

Idempotent — no-op when compose is already patched, corrects when it's been reverted. This one-liner is called out here because a naïve `docker compose up -d --force-recreate skynet` without this grep can silently ship stock upstream — the container reports healthy because stock IS functional, so there's no failure signal. That's the trap that bit patches #43 and #69 pre-retirement, and it stays a risk post-retirement because manual sed mistakes and any leftover pre-retirement `sleep 900` background processes could still rewrite the compose file. **Survived deadman retirement, stays in force.**

### ASHLEY PRE-WARN — first hard-refresh may white-screen

Per `~/.claude/identities/tina/tina.md` § learned preferences (2026-07-23, learned on the #131-#134 deploy during patch #133 write-up):

> After `docker compose up -d --force-recreate skynet`, the FIRST hard-refresh may white-screen with `net::ERR_HTTP2_PROTOCOL_ERROR` on chunk loads. **The fix is close+reopen the tab, NOT a real deploy failure.** Symptom: two specific chunks (in Ashley's case `codemirror-*.js` + `file-preview-vendor-*.js`) fail with HTTP2_PROTOCOL_ERROR → white screen. Root cause: Caddy holds persistent upstream connections to the skynet container; when the container dies mid-fetch during recreate, the browser's existing H2 stream to Caddy sees the upstream fail and marks the stream broken client-side. Fix = close and reopen the tab (spawns a fresh H2 connection).

**When the deploy actually happens, PRE-WARN Ashley in the deploy notification message** that the first hard-refresh may white-screen and the fix is close+reopen. Do NOT jump to rollback on the first PROTOCOL_ERROR report.

### Deploy flow (only if Ashley explicitly greenlights)

Per `~/.claude/identities/tina/deploy-runbook.md` steps 1-8. Summary in order:

1. **Apply + commit + push + build** — per deploy-runbook step 1. `git push` BEFORE build. The build script clones from GitHub; local-only commits cache-hit the frontend-builder layer. This is the trap that bit patches #43 and #69.
2. **Ask Ashley for explicit go-ahead for THIS deploy window.** A distinct green light, not carried over from any earlier "go for it" that authorized the code change. Every build → deploy transition is a new "may I?" moment.
3. **Run the check-before-recreate one-liner** (see above).
4. `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`
5. **Wait for `(healthy)`** — should be within 30s. Corroborate the patch shipped by grepping the deployed dist for the patch's signature bytes: `docker exec skynet grep -c 'pv-panel-header' /app/html/assets/*.css` should return >= 1 (if not, the frontend build layer cache-hit and stock shipped — rollback + re-push + re-build).
6. **PRE-WARN Ashley in the deploy DM** about the first-hard-refresh white-screen risk; tell her the fix is close+reopen the tab.
7. **Tell Ashley to test** by walking this checklist. On her "pin it" reply: paste `.planning/phases/13-.../13-PATCHES-MD-ENTRY.md` (and potentially `.planning/phases/11-.../11-PATCHES-MD-ENTRY.md` + `.planning/phases/12-.../12-PATCHES-MD-ENTRY.md` if not yet pinned) into `~/.claude/identities/tina/skynet-patches.md`, bump the header count from "ONE HUNDRED THIRTY-SEVEN" to "ONE HUNDRED FORTY" (or "ONE HUNDRED THIRTY-EIGHT" → "ONE HUNDRED FORTY" if #138 was pinned solo earlier), commit the pin (`docs(patches): pin patches #138 + #139 + #140 — Skynet transformation Ship-of-Theseus movement complete`).
8. **If broken**: manual rollback per deploy-runbook.md step 8 — `sudo sed -i 's|image: skynet-patched:local|image: ghcr.io/lukegus/skynet:latest|' /opt/skynet/docker-compose.yml && cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`. Then investigate.

---

## Master bounty closeout note

After Ashley's UAT signs off at parity with the mock (mobile + desktop, both viewports), the master bounty `~/.claude/identities/tina/bounties/skynet-transformation/` closes — the entire **Ship-of-Theseus movement (Phases 11 + 12 + 13)** is complete. The Skynet SHAPE (Telegram-mobile-app-of-Skynet) is done.

- Phase 11 (patch #138): landing swap (dashboard → PrettyLandingCard) + AppRail retirement + SettingsRow retirement + rail-view state-machine strip
- Phase 12 (patch #139): 30 sidebar panel files deleted + `src/ui/dashboard/` subtree (17 files) deleted + `src/ui/shell/Tab.tsx` deleted + PURGE-09 writer+reader atomic retirement + dead locale-key strip
- Phase 13 (patch #140, this phase): conversation-list row rewritten to mock's flat CSS class-toggle contract + panel header lifted to mock's UPPERCASE + transparent-pencil treatment + PinAction lifted to bare-icon-with-hue-drop-shadow + AppShell chevron rebased to `--color-pv-*` palette; the LOCKED mock v4 (Ashley signed off 2026-07-23) lifted verbatim onto the conversation-list surface

Ashley's next set of Skynet bounties will be NEW-FEATURE work (pretty-view enhancements, message-queue improvements, translation asides, tool-use bubble upgrades, etc.) — not further Ship-of-Theseus purge. The master bounty catalog reflects this in its completed-todos post-closeout.

**Meta-lesson pinned** (Ashley 2026-07-23): "I fragmented the Ship-of-Theseus movement into sibling bounties instead of tracking it all inside the master `skynet-transformation` bounty" — the failure pattern that caused Tina to lose the Skynet vision. Fixed in this session: renamed master bounty, merged the 4 fragments in, rewrote `tina.md § Skynet direction` to lead with the Telegram-shape framing so future-me arrives with it. **All Phase 13 progress + closeout updates live IN the master `skynet-transformation` bounty timeline+todos, NOT in any sibling.** Ashley's UAT sign-off is what triggers the master bounty's `/close skynet-transformation`.

---

*Phase: 13-skynet-transformation-conversation-list-lift-from-mock*
*Checklist generated: 2026-07-23 (Plan 05 automation)*
*Design source-of-truth: `~/.claude/identities/tina/bounties/skynet-transformation/prototype.html` (LOCKED mock v4) + `.planning/phases/13-.../13-CONTEXT.md` (LOCKED) + `~/.claude/identities/tina/tina.md` § Skynet direction*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21)*
*Master bounty: `~/.claude/identities/tina/bounties/skynet-transformation/` — closes on Ashley UAT sign-off*
*Sign-off block at top of page.*
