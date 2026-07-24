# Phase 7 UAT Checklist — Fleet-native Conversation List

**For:** Ashley
**Post-deploy validation of patch #106 (Phase 7 — follow-up to patch #105)**
**Deployed:** _<auto-fill at deploy time>_
**Deadman armed at:** _<auto-fill at deploy time>_
**Deadman disarm deadline:** _<auto-fill at deploy time — deploy time + 15 min>_

**Trace commits (Phase 7 code + verify artifacts on `feat/tab-title-from-tmux`):**

- Plan 07-01: `dd076a7` (test RED — fleet store), `93ec517` (feat GREEN — fleet store), `88ff18d` (feat — ConversationsPanel + AppShell + persistence-test wiring)
- Plan 07-02: `141c481` (test RED — RDP row derivation), `50c8e58` (feat GREEN — RDP row derivation), `883e3a0` (feat — pencil + mobile gear-dedup + RDP rendering + AppShell handler)
- Plan 07-03: `fb8eeb0` (docs — build verify log — this deploy-side verification of everything above)

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All 🚨 items in Phase 7 CORE pass** → **disarm deadman:**
      ```
      sudo touch /tmp/skynet-keep-patched
      sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'
      ```
      Verify no `sleep 900` process remains: `ps -ef | grep 'sleep 900' | grep -v grep` — expected empty output.

      Then help me pin the patch: paste `.planning/phases/07-fleet-native-conversation-list/07-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` as patch #106 (or next available — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`), bump the "ONE HUNDRED FIVE numbered patches" count near the top of that file to "ONE HUNDRED SIX" (or actual new count), and commit the pin. Then `/close telegram-like-interface` on the shared Phase 6 + Phase 7 bounty.

- [ ] **Any 🚨 item in Phase 7 CORE fails** → **let the deadman fire** (15-min timer auto-reverts) OR run `sudo bash /opt/skynet/.tmp-revert.sh` immediately for instant rollback. Note the failing item and the observed-vs-expected behavior for the follow-up amendment.

- [ ] **Only regression-smoke items fail** → decide case-by-case. Phase 6 was UAT-signed at patch #105 so a Phase 6 regression is Phase 7's doing. Same rollback rules apply if the regression is severe.

## How to use this checklist

Work through top-to-bottom. Each item has an action + expected result + "if this fails" note. Mark [x] as you go. The 🚨 marker means "blocking gate — if this fails, don't disarm the deadman." Unmarked items are nice-to-have polish.

**Section order (mobile parity: check both viewports where noted):**
1. Phase 7 core — TG-12..TG-18 (blocking gates)
2. Phase 7 additional — Plan 07-01 & 07-02 SUMMARY-listed UAT walk items
3. Phase 6 regression — TG-01..TG-11 (compressed walk; Phase 6 was signed off at patch #105)
4. Prior-patch regression smoke — patches #25/#35/#57/#60/#100/#102/#105
5. Deadman disarm — ONLY after every 🚨 in sections 1+2 is [x]

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on desktop** AND **on your phone** (or use DevTools "Toggle device toolbar" with a mobile viewport + `pointer: coarse` emulation).
2. Have at least 3 hosts configured in Skynet (any mix of SSH/RDP is fine; **at least one host must have `enableRdp: true`** for the TG-15 walk).
3. Have at least 2 running tmux sessions active on distinct hosts before starting (one identity-attached Claude session, one plain shell). Kill nothing prior — Phase 7's whole point is discovering these sessions.
4. Open **DevTools → Network tab** on desktop, filter by "sessions/list" — you'll use this for the TG-17 no-polling check.
5. Fresh incognito window recommended for TG-12 (mimics "fresh page-load, no open tabs" scenario).

---

## Phase 7 core — the new behavior (TG-12..TG-18)

### TG-12 — Fleet-native list on fresh page-load

> **TG-12 contract:** *"The conversation list on a fresh page-load shows the running tmux sessions across the fleet (unioned with any browser-tab-open Skynet tabs), not just tabs open in the current browser session."*

- [ ] 🚨 **TG-12 desktop fresh page-load** Open Skynet in a fresh incognito window on desktop. Wait for the page to load fully (allow ~2 seconds for `/sessions/list` to resolve). Expected: the ConversationsPanel shows one row per running tmux session across ALL your reachable hosts — the same set the current sidebar host-tree + double-shift menu would show. Rows grouped by host with separators. **If: only shows tabs from this browser tab (empty on fresh load)** → Plan 07-01's fetch effect isn't firing; check DevTools console for JS errors + Network tab for the `/sessions/list` request; if the request is missing, the useEffect empty-dep-array wiring in `AppShell.tsx` regressed; if the request returns non-200, backend session-list endpoint is broken.
- [ ] 🚨 **TG-12 mobile fresh page-load** Open Skynet in fresh incognito on phone (or DevTools with `pointer: coarse` + narrow viewport). Same expectation: full-screen ConversationsPanel shows running tmux sessions. **This is THE gap patch #105 shipped with** — Phase 6 UAT found "no active conversations" on a fresh mobile page-load even when Ashley had active sessions on hosts. Phase 7 fix must show them.
- [ ] 🚨 **TG-12 graceful fallback if `/sessions/list` fails** Simulate backend failure (block `/sessions/list` in DevTools Network tab → Block request URL). Refresh. Expected: page loads, ConversationsPanel renders Phase 6 openTabs-only behavior (empty state on fresh incognito, or existing tabs if any). NO error toast, NO crash — Plan 07-01's silent try/catch swallowing keeps the UI graceful. **If: page crashes or shows error banner** → the try/catch on the fetch effect regressed.

### TG-13 — Attached vs detached rows visually indistinguishable

> **TG-13 contract:** *"Rows for currently-attached sessions look identical to rows for fleet-discovered but not-yet-clicked sessions — no brightness delta, no dot, no italic, no spinner, no per-row indicator."*

- [ ] 🚨 **TG-13 no visual delta after attach** From the fresh page-load state above (TG-12), click one row to attach. Wait for the pane to open. Return to the list (mobile back button, or just look at the sidebar on desktop). Expected: the row you clicked looks **identical** to the rows you haven't clicked — same font weight, same text color, same background hue, same icon treatment, no dot, no italic, no spinner. Only the `data-selected="true"` state differs (the currently-viewed row gets the `bg-accent-brand/10 text-accent-brand` treatment — which is the SAME treatment Phase 6 gave openTabs-based selected rows; this is NOT an attached/detached distinction). **If: any visual difference (fainter, brighter, italic, dot, spinner)** → ConversationRow acquired accidental state-based styling; check the `fleetOnly` field is INTERNAL routing only and does NOT reach the render layer.
- [ ] 🚨 **TG-13 both sources render via same ConversationRow** DevTools-inspect a fleet-only row and an openTabs row. Expected: same DOM structure, same className tree, same avatar element type. Only difference: fleet-only rows have `data-conversation-id="fleet::<hostId>::<sessionName>"`; openTabs rows have the tab id shape from Phase 6.

### TG-14 — Click-a-detached-row transparently attaches

> **TG-14 contract:** *"Clicking a detached (fleet-only) row opens the session with no dialog, no confirmation, no separate 'connect' step. Single click = attached + selected + shown."*

- [ ] 🚨 **TG-14 detached row single click = open** From the fresh page-load state (TG-12), click a row you haven't opened yet in this browser session. Expected: pane opens immediately, **NO dialog**, **NO confirmation prompt**, **NO "connect" step**. Single click transitions the row from "detached" → "attached + selected + shown" and the tmux session displays in the main pane. **If: dialog appears** → AppShell's `onDetachedRowClick` handler is wired to the create-session flow instead of the attach flow; verify `allowCreateTmux: false` (ATTACH not create) in the handler per Plan 07-01 lock.
- [ ] 🚨 **TG-14 T-06-02-01 mount-lifecycle preserved on detached-attach** After the detached row opens, scroll the pane content (pretty view: scroll UP through history; terminal: type some commands to fill the buffer). Click a different row to switch away. Click back to the first row. Expected: **instant switch**, **no reconnect flash**, **scroll position preserved**, **terminal buffer preserved**. Because Plan 07-01's onDetachedRowClick handler routes through the same `openTab(host, "terminal", ...)` + `selectConversationDeferred` chain that Phase 6's tab-attach path uses, the tabNodesRef DOM-move mechanism (patch #35) preserves the pane's mounted DOM node byte-for-byte.
- [ ] 🚨 **TG-14 session died between page-load and click → backend errors** Kill a fleet-discovered session on the backend AFTER page-load but BEFORE clicking its row: `ssh <host> tmux kill-session -t <name>`. Then click the row. Expected: backend returns an error (no session to attach to; `allowCreateTmux: false` means the backend does NOT resurrect an empty pane). The UI shows a normal Skynet session-open failure (whatever the existing openTab flow does for a failed attach; typically an inline error in the pane area). **If: an empty pane opens** → the handler is using `allowCreateTmux: true` instead of `false`, which would silently re-create the killed session (wrong per Plan 07-01 lock).

### TG-15 — RDP host rows at bottom

> **TG-15 contract:** *"One row per RDP-enabled host at the bottom of the list, monitor icon in the avatar slot, host name as the label, no identity hue, no identity name."*

- [ ] 🚨 **TG-15 RDP rows visible at bottom** Scroll to the bottom of the ConversationsPanel. Expected: **one row per RDP-enabled host** — no more, no less. Row chrome:
  - **Monitor glyph** (lucide `Monitor` icon, `text-muted-foreground` color) in the avatar slot (left column)
  - **Host name** as the row label (font-medium, size-[13px])
  - **No identity hue** (no linear-gradient tint on row background)
  - **No identity avatar image**
  - **No host-name secondary line** (the label IS the host name — nothing muted below it)
  - **No pin toggle button** on the right (RDP rows can't be pinned per Plan 07-02)
  - `data-rdp-host-row="true"` DevTools attribute on the row
- [ ] 🚨 **TG-15 RDP section placement** The RDP rows appear **BELOW all identity-tmux HostGroups** (both fleet-only and openTabs-derived). **NO semibold "host name" header** renders above the RDP rows — just a thin top border for visual separation from the identity-tmux section above. **If: RDP rows appear at TOP or interspersed with tmux rows** → the `__rdp__` sentinel HostGroup isn't being appended LAST inside `computeSnapshot()`; check Plan 07-02's ordering. **If: a semibold header appears above the RDP rows** → the `group.hostId === "__rdp__"` special-case in ConversationsPanel isn't suppressing the header (NOTE-A regression).
- [ ] 🚨 **TG-15 one row per RDP host** If you have 2+ RDP-enabled hosts, verify one row for EACH. Not one row for all RDP hosts; not multiple rows for the same host. Rows appear in host-tree walk order (matches the ordering of identity-tmux HostGroups above).
- [ ] 🚨 **TG-15 click an RDP row opens the RDP tab** Click an RDP row. Expected: RDP tab opens, remote desktop connects normally. Existing RDP disconnect/reconnect behavior UNCHANGED (per scope-fence lock — guacamole + Terminal.tsx untouched in Phase 7). Row's `data-selected="true"` state applies once selected (same accent treatment as identity-tmux rows).
- [ ] 🚨 **TG-15 selected state on RDP row** When the RDP tab is the active tab, the RDP row has the `bg-accent-brand/10 text-accent-brand` selected treatment. Click away to a tmux tab; the RDP row loses the selected state. Click back; it re-acquires it.
- [ ] 🚨 **TG-15 enableRdp toggle roundtrip** In HostEditor (Host Manager → edit host), **disable RDP** on one host (uncheck `enableRdp`). Save. Refresh browser. Expected: that host's RDP row is **GONE** from the ConversationsPanel bottom section. Now **re-enable RDP** on the same host (check `enableRdp`). Save. Refresh again. Expected: RDP row **RETURNS** to the bottom section. **Note:** NO auto-update per TG-17 shape lock — Ashley refreshes to see the change. **If: RDP row persists after disable + refresh** → the store's `enableRdp === true` filter regressed to truthy coerce and is picking up stale/undefined values; check Plan 07-02's strict filter.

### TG-16 — Pencil re-style

> **TG-16 contract:** *"The New Session button is re-styled from Plus to Pencil. Function unchanged — pick host, name session, open."*

- [ ] 🚨 **TG-16 pencil glyph visible** Look at the New Session button in the ConversationsPanel (top of scroller, above pins). Expected: **pencil glyph** (lucide `Pencil` icon), NOT a plus. Icon size (size-3), button chrome (h-7, px-2, text-[10px], accent-brand outline, full-width), and i18n label ("New session") UNCHANGED from Phase 6.
- [ ] 🚨 **TG-16 clicking opens NewSessionDialog byte-identical to Phase 6** Click the pencil. Expected: same **NewSessionDialog** (Radix modal, filterable host list, optional session-name input, Cancel + Open buttons, i18n copy) as Phase 6 patch #105. Function unchanged; only the button glyph differs.
- [ ] 🚨 **TG-16 create a session via pencil** Pick a host, leave name empty, click Open. Expected: new tab appears in the ConversationsPanel with the tmux window title as label (auto-fill via the fork's `feat/tab-title-from-tmux` behavior). Auto-navigate to view on mobile. Same behavior as Phase 6.
- [ ] **TG-16 pencil in dist** DevTools-inspect the New Session button. Expected: SVG has a pencil-shaped `<path>` (roughly `M21.174 6.812...` — the lucide Pencil vector). No plus-cross shape.

### TG-17 — No polling

> **TG-17 contract:** *"No polling. The fleet-discovery signal fires ONCE on mount. No subsequent requests on interval, focus, visibility change, or hosts-changed event."*

- [ ] 🚨 **TG-17 exactly ONE /sessions/list on page-load** Open DevTools → Network tab. Filter for `sessions/list`. Refresh Skynet (Cmd+R). Expected: **exactly ONE request** to `/sessions/list` at page-load. **If: multiple requests** → polling regression; check Plan 07-01's empty dep array on the fetch effect.
- [ ] 🚨 **TG-17 no /sessions/list on tab focus/blur** Leave Skynet open in tab A. Switch to tab B (any other tab). Wait 30 seconds. Switch back to tab A. Expected: still ZERO subsequent `/sessions/list` requests in the Network tab (only the original one from page-load). **If: request fires on focus** → a `visibilitychange` or `focus` listener was accidentally wired to the fetch.
- [ ] 🚨 **TG-17 no /sessions/list on hosts-changed event** In Skynet, add a new host via Host Manager (or edit an existing host's `enableRdp` flag). Save. This fires the `skynet:hosts-changed` event internally. Expected: still ZERO subsequent `/sessions/list` requests. Plan 07-01's grep gate explicitly asserted `getSessionList` is NOT wired to this event. **If: request fires on host edit** → the fetch effect got listener-wired somehow; check `AppShell.tsx` around `skynet:hosts-changed` handling.
- [ ] 🚨 **TG-17 no /sessions/list on idle** Sit idle for 5 minutes with Skynet as the active tab. Expected: still ZERO subsequent `/sessions/list` requests. Cross-device / cross-session fleet staleness is DELIBERATELY acceptable per shape lock.
- [ ] 🚨 **TG-17 no visible polling indicator** Nowhere in the UI is there a "syncing…" spinner, live-count, activity indicator, or refresh countdown for the conversation list. The list is a snapshot; snapshots don't animate.

### TG-18 — Mobile gear/settings-row dedup

> **TG-18 contract:** *"On mobile: NO gear icon in the header, SettingsRow visible at bottom. On desktop: gear icon in header, NO SettingsRow at bottom. Neither viewport shows both."*

- [ ] 🚨 **TG-18 mobile (touch device): no gear + settings row visible** Open Skynet on your phone (or DevTools with `pointer: coarse` + narrow viewport). Look at the ConversationsPanel:
  - **NO gear icon** in the panel header (the entire header row with the gear should be absent — `showGear = false` on touch device → renders empty spacer instead)
  - **SettingsRow visible** at the BOTTOM of the scroller (below RDP rows if present, else below last identity-tmux HostGroup) — same location Plan 06-03 established
  - Tapping SettingsRow opens the dropdown with all 10 admin destinations (Users, Hosts, Snippets, Alerts, Files, Docker, Docker Sync, Db Backup, Db Restore, Db Import, Db Export — from Plan 06-02's SETTINGS_MENU_ITEMS registry)
  - **If: gear AND SettingsRow both visible** → Phase 6's TG-18 bug regressed; check ConversationsPanel `showGear` gate has `&& !isTouchDevice`
  - **If: neither gear NOR SettingsRow visible on mobile** → both entry points broke; check the useIsTouchDevice hook detection and Plan 06-03's mobile SettingsRow mount at AppShell:1348
- [ ] 🚨 **TG-18 desktop (non-touch): gear visible + no settings row** Open Skynet on desktop (mouse, non-touch viewport). Look at the ConversationsPanel:
  - **Gear icon visible** in the panel header (top-right, tooltip "Settings & Admin")
  - **NO SettingsRow** at the bottom of the scroller (AppShell:1348 gate `isTouchDevice ? <SettingsRow /> : undefined` → undefined on desktop)
  - Clicking the gear opens the same dropdown with the same 10 admin destinations (single SETTINGS_MENU_ITEMS registry — no menu drift between mobile and desktop)
- [ ] 🚨 **TG-18 both entry points route through same handleRailClick** From the mobile SettingsRow OR the desktop gear dropdown, tap/click any admin destination (e.g. "Hosts"). Expected: navigates to the Host Manager panel. Both entry points behave identically after the menu opens. Menu items and their routes are locked at the shared SETTINGS_MENU_ITEMS registry level (per Plan 06-02).

---

## Phase 7 additional — from Plans 07-01 and 07-02 SUMMARY UAT items

### Plan 07-01 — data-source correctness (fleet-native + dedup)

- [ ] 🚨 **Session-identity dedup: pencil-created session does NOT double-render** Click the pencil, pick hostA, name the session "work". Open. Verify: the ConversationsPanel shows **ONE row** for the new session, NOT two. If the dedup regressed, you'd see one row from the fleet-only source (fleet::hostA::work) AND one row from openTabs (the pencil-created one) — verify only ONE.
- [ ] 🚨 **openTabs-entry-wins on dedup collision** After the pencil-created session opens (TG-14 walk above), verify the row uses the openTabs id shape (not the `fleet::` prefix). Pin the row. Verify: pin state persists (fleet-only ids can't be pinned per Plan 07-01 defense-in-depth — the fact that pinning works confirms the row came from openTabs).
- [ ] 🚨 **Existing openTab-derived rows still switch instantly** Click a row derived from openTabs (either the pencil-created one, or a row you attached earlier this session — TG-14 walk). Expected: switches instantly with NO reconnect flash, NO loading state, NO scroll reset (T-06-02-01 mount-lifecycle contract preserved). Same behavior as Phase 6 patch #105.
- [ ] 🚨 **Null-target openTabs tab doesn't false-collide with named fleet session** If you have a legacy openTabs tab with no explicit `targetTmuxSession` (e.g. from Phase 4 or earlier), and a fleet session on the same host with a real name (`work`), verify BOTH appear in the list — one row from the null-target tab + one row from the fleet-only named session. Plan 07-01's identity check (`hostA, null` ≠ `hostA, "work"`) prevents accidental collapse.
- [ ] **Fleet-only row fallback host name when hostTree not resolved yet** Rare timing case: if `/sessions/list` resolves BEFORE `getSSHHosts()` populates realHostTree, fleet rows briefly render with the `hostName` from the FleetSession payload (not the resolved Host record). Visual difference is subtle — the HostGroup header shows the API-returned host name instead of the local record's name. Usually you won't see this window; it resolves on the next tabs-update tick. Not a blocking gate; document any anomaly here.

### Plan 07-02 — RDP row + pencil + gear-dedup implementation

- [ ] 🚨 **Multiple RDP hosts render in host-tree walk order** If you have 3+ RDP-enabled hosts, the RDP rows appear at the bottom in the SAME order the identity-tmux HostGroups appear above (which matches the sidebar host-tree walk order).
- [ ] 🚨 **Orphan RDP host (in hostsFlat but not in hostTree)** Rare edge case: a host record that's RDP-enabled but not surfaced in the buildHostTree walk (e.g. filtered out for some reason). Plan 07-02 says these still render in Map insertion order after the host-tree ones. Not directly observable without triggering the specific edge case; document if you see any RDP rows in unexpected positions.
- [ ] 🚨 **RDP row respects strict `enableRdp === true` check (not truthy coerce)** If you have a legacy Host record without the `enableRdp` field (`enableRdp === undefined`), verify NO RDP row appears for it. Plan 07-02 T-07-02-01 mitigation. **If: a row appears for a host with no enableRdp field** → strict `=== true` check regressed to truthy coerce.
- [ ] 🚨 **RDP row on isEmpty scenario** If your fleet has ZERO identity-tmux sessions but AT LEAST ONE RDP-enabled host: verify the empty-state "No active conversations" message does NOT render — the RDP rows in the `__rdp__` sentinel HostGroup make `grouped.length > 0` → `isEmpty === false` → the empty-state message is suppressed. Plan 07-02's `isEmpty` derivation was NOT changed for this exact case (RDP rows are inside `grouped`, so they satisfy the existing `pinned.length + grouped.length` check).

---

## Phase 6 regression — verify TG-01..TG-11 still hold

Phase 6 was UAT-signed at patch #105 (2026-07-21 earlier today). Compressed walk to prove Phase 7 didn't break anything.

- [ ] 🚨 **TG-01 flat host-grouped list; session-end vanishes rows** Sidebar is a flat scrollable list, grouped by host with separators, in existing host-tree order. Kill a tmux session on the backend (`ssh <host> tmux kill-session -t <name>`); its row vanishes on next tabs-update. **NOTE:** with Phase 7's fleet-native list, killing a session that was ONLY discovered from fleet (never opened this browser session) may leave the fleet-only row visible until page refresh — this is the TG-17 shape lock (no polling). Killing an openTabs-derived session still vanishes immediately (Phase 6 behavior preserved).
- [ ] 🚨 **TG-02 pin/unpin works; pins float above host groups** Hover-reveal on desktop, tap-hold on mobile: click the pin toggle on an openTabs row. Row floats above host groups. Unpin drops it back to its host group. Pin state per-session, not per-host. Session-end clears pin.
- [ ] 🚨 **TG-03 only ONE conversation visible; no tab strip** Main content area shows exactly ONE conversation or empty-view fallback. NO tab strip. Selected row is the "which am I viewing" indicator.
- [ ] 🚨 **TG-04 internal experience unchanged (pretty view / terminal / RDP)** Click an identity Claude session row → pretty view opens with WipBubble, PlanPendingBubble, compose box, ambient panels, identity badge unchanged. Click a plain SSH row → xterm terminal renders unchanged. Click an RDP row → guacd canvas connects normally.
- [ ] 🚨 **TG-05 session persistence — switch away and back, no reconnect, scroll preserved** Open conversation A (identity Claude). Scroll UP in pretty view. Click B. Click A. Expected: INSTANT switch, scroll position preserved, no reconnect indicator. **THIS IS THE ULTIMATE PROOF THAT PHASE 7 DIDN'T BREAK T-06-02-01** — the tabNodesRef DOM-move mechanism (patch #35) is preserved.
- [ ] 🚨 **TG-06 mobile list-vs-view flow** Two-screen mobile flow: tap row → view screen (list vanishes); top-left back button → list (view vanishes); browser back gesture also works. URL fragment `#mv=1` survives Chrome window-restore.
- [ ] 🚨 **TG-07 mobile bottom nav absent** No bottom navigation bar on any mobile viewport in any state (deleted in Plan 06-03).
- [ ] 🚨 **TG-08 desktop sidebar collapse unchanged** Chevron-left collapses to thin strip; click to re-expand. Collapse state persists across page-load.
- [ ] 🚨 **TG-09 new-session button opens host picker; empty name allowed** Click the pencil (was Plus in Phase 6; now Pencil per TG-16). Modal opens: filterable host list, optional session name (empty = tmux window title auto-fill), Cancel + Open. Sole-host auto-select. Validation on non-empty names (`[\w-]{0,64}`). Mobile auto-navigate to view on create.
- [ ] 🚨 **TG-10 admin destinations reachable via gear OR SettingsRow** Desktop: gear in header. Mobile: SettingsRow at bottom. Both route to same 10 destinations via shared SETTINGS_MENU_ITEMS. Admin-only entries stay admin-gated at menu-render level (T-06-02-04).
- [ ] 🚨 **TG-11 no toggle to bring tabs back; TabBar unconditionally gone** No feature flag anywhere (ConversationsPanel gear dropdown, SettingsRow menu, User Profile, Admin Settings, Preferences). TabBar unconditionally deleted from dist (verified in build log: 0 hits in dist).

---

## Prior-patch regression smoke — patches #25/#35/#57/#60/#100/#102/#105

- [ ] 🚨 **Patch #25 URL scheme survives Chrome window-restore** On desktop: open a specific conversation, note the URL fragment (`#tab=<type>:<host>[:<session>]&active=N`). Close the tab. Use Chrome's Ctrl+Shift+T to restore. Verify: exact same conversation opens. Patch #25 preserved.
- [ ] 🚨 **Patch #35 DOM node stability (patch #35 = tabNodesRef DOM-move)** The TG-05 pretty-view-scroll-preservation test above IS the direct end-to-end proof. `appendChild` count in `dist/assets/AppShell-*.js` = 6 (verified in build log Step D; matches Phase 6 baseline of 6 exactly).
- [ ] 🚨 **Patch #57 compose-drafts** Type into a pretty-view compose box. Close the tab (don't send). Reopen the pane. Verify: text is restored. `/compose-drafts` grep = 3 in Terminal chunk (verified in build log).
- [ ] 🚨 **Patch #60 atomic delete-on-send** Open message queue drawer with Ctrl+Shift+; . Add a message, hit Send. Verify: drawer row disappears atomically; refresh — the sent message is NOT back in the drawer.
- [ ] 🚨 **Patch #100 split-and-delay Enter** Send a message via a pretty-view compose. Verify: Claude Code REPL treats input as TYPED (not paste — no bracketed-paste indicator, no character-count-in-status-bar).
- [ ] 🚨 **Patch #102 useIsTouchDevice** On desktop: mobile-specific UI (list-vs-view screens, SettingsRow at bottom, MobileViewHeader back button) is ABSENT. On phone: present. Same signal (`useIsTouchDevice()`) drives both. Now ALSO drives the TG-18 showGear gate — the SAME signal, no new detection mechanism.
- [ ] 🚨 **Patch #105 (Phase 6) — every TG-01..TG-11 above still holds** Covered by the Phase 6 regression section above. Phase 6 was UAT-signed today; Phase 7 must not regress it.

---

## Negative-space checks (scope-fence)

Phase 7 explicitly does NOT ship these; verify they are ABSENT.

- [ ] 🚨 **NO polling indicator anywhere** No "syncing…" spinner, no live-count badge, no refresh countdown, no auto-update animation on the conversation list. Snapshot-on-load only (TG-17 lock).
- [ ] 🚨 **NO plain-SSH host rows in the list** The conversation list only shows tmux sessions + RDP hosts. NO row per SSH-only host as a "quick-connect" affordance. Plain-SSH one-shots are explicitly out per shape lock.
- [ ] 🚨 **NO attached-vs-detached visual distinction** (TG-13 above) Verify no dot, no italic, no brightness delta, no per-row indicator on any row. Rows are rows.
- [ ] 🚨 **NO cross-device / cross-session state sync** A session created on your phone does NOT auto-appear on desktop without a refresh. Verified by TG-17 no-polling walk.
- [ ] 🚨 **NO second creation button** Only the pencil creates sessions. No FAB with a "+" fallback, no context-menu "create new session," no keyboard shortcut that opens a different creation modal.
- [ ] 🚨 **NO activity/unread signal on rows** Deferred to v2 per Phase 6 lock. Phase 7 does not add any.
- [ ] 🚨 **NO viewport-width-based mobile detection** iPad landscape (touchscreen, large viewport) still gets mobile flow (list-vs-view, no gear, SettingsRow at bottom, no AppRail rail). Signal is `useIsTouchDevice()` ONLY.
- [ ] 🚨 **NO tab strip in ANY state** Even with sidebar collapsed, split-screen active, or any RailView. TabBar unconditionally gone.
- [ ] 🚨 **NO changes to identity-tmux / RDP / plain-SSH tab lifecycle** RDP tab disconnect/reconnect, identity attach/detach, pretty-view mount-on-identity-resolution all preserved byte-for-byte (scope-fence lock). Grep-verified in build log Step G.

---

## Deadman disarm — ONLY after every 🚨 in sections above is [x]

On the EC2 host (via SSM per CLAUDE.md — no public SSH), run:

```
sudo touch /tmp/skynet-keep-patched
sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'
```

Verify no revert cron/nohup is still running:

```
ps -ef | grep 'sleep 900' | grep -v grep
```

Expected: empty output.

**⚠️ NARROW pkill pattern** — a bare `pkill -f "sleep 900"` matches AND kills the guacd-zombie sentinel's own poll loop and any other future 15-min sentinel. Learned 2026-07-11 the annoying way. **Do NOT use bare `pkill -f "sleep 900"`.**

**⚠️ NEVER kill a deadman's sleep child directly** while sentinel is absent — see `deploy-runbook.md` §"NEVER kill a deadman's sleep 900 child directly." The `sudo touch /tmp/skynet-keep-patched` above ensures sentinel is PRESENT when the pkill fires, which is the safe order.

---

## If a UAT item fails

- **Phase 7 core (TG-12..18) fails** → DO NOT touch `/tmp/skynet-keep-patched`. Deadman fires at the 15-min mark; production auto-rolls-back to `ghcr.io/lukegus/skynet:latest` (pre-patch state). Note which item failed for a follow-up amendment (Plan 07-04 or a delta patch).
- **Phase 7 additional (Plan 07-01/07-02 items) fails** → decide by severity. If session-identity dedup broken (double-rendered rows) or the isEmpty derivation broken, disarm-and-rollback via explicit `sudo bash /opt/skynet/.tmp-revert.sh`.
- **Phase 6 regression fails** → decide by severity. Phase 6 was UAT-signed at patch #105 so any regression is Phase 7's doing. Same rollback rules.
- **Prior-patch regression fails** → severity-dependent. Patches #25/#35/#57/#60/#100/#102 are load-bearing; regression means the rebase-hostile territory in AppShell.tsx got disturbed. Rollback recommended.

---

## Post-sign-off actions

Once all 🚨 items pass and the deadman is disarmed:

1. **Pin the patch.** Paste `.planning/phases/07-fleet-native-conversation-list/07-PATCHES-MD-ENTRY.md` into `~/.claude/identities/tina/skynet-patches.md` at the next ordinal position (patch #106 unless an interstitial pinned first — check via `grep -n "^\s*[0-9]\+\." ~/.claude/identities/tina/skynet-patches.md | tail -3`).
2. **Bump the count.** Update the "ONE HUNDRED FIVE numbered patches" line near the top of `skynet-patches.md` to "ONE HUNDRED SIX" (or actual new count).
3. **Commit the pin.** Standard conventional-commit style (`docs(patches): pin patch #106 — fleet-native conversation list`).
4. **Close the bounty.** `~/.claude/identities/tina/bounties/telegram-like-interface/` via `/close telegram-like-interface`. The bounty spans BOTH patch #105 (Phase 6) and patch #106 (Phase 7) as one ship arc; closing it now marks the whole Telegram-like interface project complete.

---

*Phase: 07-fleet-native-conversation-list*
*Checklist generated: 2026-07-21T06:32:27Z*
*Deploy runbook reference: `~/.claude/identities/tina/deploy-runbook.md`*
*Sign-off block at top of page.*
