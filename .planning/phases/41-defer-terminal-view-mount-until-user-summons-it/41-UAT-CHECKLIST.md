# Phase 41 UAT Checklist — Defer Terminal Mount Until User Summons It

**Target:** Ashley
**Timing:** After `docker compose up -d --force-recreate skynet` completes, HTTPS 200 verified, PWA hard-refreshed.
**URL:** https://term.gigaashley.click
**Estimated duration:** ~15 minutes (10 items, items 1-8 fast, items 9-10 involve a send + console check).
**Prerequisite:** Have at least one identity conversation visible in the conversation list (e.g. tanya or any registered fleet agent).

Each of the 10 items verifies exactly one LOCKED decision class from `41-CONTEXT.md § Implementation Decisions`. The cross-reference is explicit in each item. If any item FAILS, escalate to the plan executor rotation before marking Phase 41 COMPLETE.

---

## Preconditions

- Phase 41 deploy landed (docker build from HEAD `d80d0e93...` or later on `feat/tab-title-from-tmux`; container recreated healthy; HTTPS 200; PWA hard-refreshed once to clear old JS).
- At least one identity-based fleet agent (tanya, tina, tiffany, or equivalent) has a conversation visible in the Skynet sidebar.
- A non-identity SSH workstation tab is also available if possible (for item 7). If not, skip item 7 and note "no non-identity SSH session available for this UAT run."
- DevTools console open (F12 or Option+Cmd+I) for item 10.
- No `docker exec` or shell access required — every check is UI-observable.

---

### 1. Identity-session cold-open (PrettyView, no Terminal flash)

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time`
- **Setup:** From the Skynet PWA, pick an identity agent (e.g. tanya) from the conversations list. This opens the identity pane.
- **Expected observable:** The pretty-view surface (conversation bubbles, compose box) appears immediately. There is NO xterm "Connecting…" loader or black/dark xterm area visible at any point during the open — the terminal is not mounted.
- **Fail signal:** Any brief flash of a dark xterm region, a "Connecting…" spinner that isn't part of PrettyView, or a visible "Connecting to host" message on the surface that then disappears. If you see the terminal connect-and-then-vanish sequence, Terminal is mounting eagerly (pre-Phase-41 behavior, regression).
- **Console-log check (optional):** In DevTools console, filter on `identity_session_pane_mount` — you should see one structured log entry with `{ operation: "identity_session_pane_mount", ... }` for the opened pane, but NO `terminal_mount` or SSH WebSocket connection events for an identity pane that opened in PrettyView.

---

### 2. Ctrl+Shift+O cold-boot into Terminal (first press)

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time` + LOCKED decision `Pane restructure — PrettyView promoted, Terminal becomes dormant peer`
- **Setup:** Identity pane is open and showing PrettyView (item 1 already verified). Press Ctrl+Shift+O (or Cmd+Shift+O on Mac — the existing keyboard toggle chord, unchanged from pre-Phase-41).
- **Expected observable:** The pretty-view surface disappears and the xterm terminal surface appears, showing the "Connecting…" loader briefly before live tmux content renders. The sequence is: PrettyView unmounts → Terminal mounts fresh → xterm inits → SSH WebSocket dials → tmux reattaches → live shell prompt visible.
- **Fail signal:** Nothing happens on Ctrl+Shift+O (toggle handler broken). Or the terminal appears but immediately crashes. Or PrettyView stays visible alongside Terminal (not a toggle — a sibling overlap). Or the "Connecting…" phase is skipped entirely (Terminal mounted but stale — shouldn't happen because every summon is a fresh cold-boot).
- **Console-log check (optional):** Filter on `identity_session_pane_toggle_pretty_mode` — you should see `{ operation: "identity_session_pane_toggle_pretty_mode", isPrettyMode: false, ... }` when toggle fires.

---

### 3. Long-press identity badge cold-boot (same behavior as Ctrl+Shift+O)

- **Cross-reference:** CONTEXT.md LOCKED decision `Pane restructure — PrettyView promoted, Terminal becomes dormant peer`
- **Setup:** Return to PrettyView first by pressing Ctrl+Shift+O again (toggle back — item 4 will also verify teardown, so you can do this in order: item 3 before item 4). With PrettyView visible and an identity pane active, tap-and-hold the identity badge (the avatar / identity name chip in the PrettyView surface, same badge as before Phase 41).
- **Expected observable:** The same toggle-to-terminal behavior as item 2. The long-press-identity-badge is a second entry point to the same `togglePrettyMode()` action — it should cold-boot Terminal with the "Connecting…" loader, then live tmux.
- **Fail signal:** Long-press does nothing. Or long-press toggles something OTHER than the terminal (e.g. opens a context menu or the identity modal instead of toggling). Or the badge doesn't exist in PrettyView (regression — badge was present pre-Phase-41 and must still be present on PrettyView surface; it's now owned by IdentitySessionPane wrapper, not Terminal.tsx).

---

### 4. Toggle-back tears Terminal down completely (cold-boot on re-summon)

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time` (every visit is a fresh cold-boot; no warm-keep)
- **Setup:** Terminal is visible from item 2 or 3. Live tmux content is showing.
- **Step A:** Press Ctrl+Shift+O (or long-press badge) again to toggle back to PrettyView. **Expected:** Terminal surface disappears, PrettyView surface returns. The xterm instance is destroyed, the SSH WebSocket closes.
- **Step B:** Wait 2 seconds, then press Ctrl+Shift+O again to summon Terminal a second time. **Expected:** The "Connecting…" loader appears again — this is NOT a resume of the previous xterm session; it is a fresh cold-boot.
- **Fail signal for Step A:** Terminal surface stays visible (toggle-back broken). Or a black empty region remains where the terminal was (unmount didn't fully clean up the DOM).
- **Fail signal for Step B:** Terminal re-appears WITHOUT the "Connecting…" flash (implying the previous xterm instance was kept warm in memory — this would violate the LOCKED "no warm-keep" decision). Or the terminal shows stale/cached state from the prior session without going through SSH reconnect.
- **Console-log check (optional):** After Step A, filter on `identity_session_pane_terminal_edge` — you should see `{ operation: "identity_session_pane_terminal_edge", edge: "unmount", ... }`. After Step B's summon, look for `edge: "mount"` again.

---

### 5. PrettyView WipBubble + ready-dot behave normally through toggles

- **Cross-reference:** CONTEXT.md LOCKED decision `isIdle re-sourcing`
- **Setup:** With an identity pane open in PrettyView, ask the agent to do something that takes a moment (e.g. "tanya, please count to 10 slowly" or any short task). Observe the WipBubble (the animated indicator in the pretty-view pane that appears when the agent is working) and the ready-dot (conversation list indicator).
- **Expected observable:** When the agent is actively working: WipBubble visible, ready-dot present. When the agent is idle: WipBubble gone, ready-dot absent. This behavior is driven by the fleet-status broadcast (not the Terminal's SSH WS) — so it works EVEN when Terminal is unmounted (PrettyView-only state).
- **Verify the toggle doesn't break it:** While the WipBubble is visible (agent working), press Ctrl+Shift+O to summon Terminal, then press it again to return to PrettyView. **Expected:** WipBubble state is unaffected by the toggle — it continues to track agent activity via the fleet-status broadcast independent of the Terminal mount state.
- **Fail signal:** WipBubble disappears when Terminal is unmounted and stays absent even while the agent is working (would mean PrettyView's isIdle signal regressed back to depending on Terminal's SSH WS — the pre-Phase-41 behavior that Plan 41-01 fixed). Or WipBubble gets stuck-on (permanently showing "working") after a toggle. Or ready-dot is absent when agent is idle AND working (both states pinned — indicates the `useSessionIsWorkingRaw` hook is returning `null` and the graceful-null path is rendering "absent" correctly, but confirm it eventually resolves once the first fleet-status broadcast arrives).

---

### 6. Tab title populates from fleet-status broadcast on identity panes

- **Cross-reference:** CONTEXT.md LOCKED decision `Tab title re-sourcing`
- **Setup:** Open a fresh identity session tab (or use the one from item 1). The browser tab title should resolve.
- **Expected observable:** The browser tab title shows either the identity's display name (e.g. "tanya"), the tmux session name (e.g. the agent's tmux session name as broadcast by the fleet-status poller), or a sensible placeholder (e.g. the host name or "…") if the fleet-status broadcast hasn't arrived yet for a freshly opened tab. The tab title does NOT show a raw URL or remain blank indefinitely.
- **Timing note:** The fleet-status broadcast polls at a regular cadence — the tab title may take up to a few seconds to resolve on a fresh tab open. This is expected and acceptable per the LOCKED "sensible placeholder" decision.
- **Regression check:** Ctrl+Shift+O into Terminal and back out to PrettyView — tab title should be UNAFFECTED by the toggle (it's sourced from the fleet-status broadcast store, not from Terminal's `onTmuxSessionChange` callback, which is now absent for identity panes).
- **Fail signal:** Tab title stays permanently blank or shows a raw IP/URL string. Or tab title DISAPPEARS when Terminal is unmounted (would mean the title mechanism regressed to Terminal-callback-only, pre-Phase-41 behavior). Or tab title flickers rapidly during toggle sequences.

---

### 7. Non-identity SSH terminal sessions are unaffected

- **Cross-reference:** CONTEXT.md LOCKED decision `Scope boundary`
- **Setup:** Open a pure-SSH workstation-style host tab — one where the target tmux session is NOT a registered identity (e.g. a workstation SSH host that isn't in the identities registry). If no such tab is available in the current session, note "skipped — no non-identity SSH session available" and continue to item 8.
- **Expected observable:** Terminal mounts EAGERLY on tab open (NO deferred-mount behavior). The xterm "Connecting…" loader appears immediately on tab open, exactly as it did before Phase 41. There is NO PrettyView surface for this tab type.
- **Fail signal:** Non-identity SSH tab opens to a blank area or to a PrettyView surface (shouldn't render PrettyView at all for non-identity tabs). Or Terminal is deferred (blank on open, "Connecting…" only appears after some user action). The `TerminalOrIdentitySessionPane` dispatch in tabUtils.tsx routes identity tabs to `IdentitySessionPane` and non-identity terminal tabs to the original `TerminalTabContent` — if the dispatch is broken, a non-identity tab could be accidentally sent through the identity path.

---

### 8. RDP / VNC / dashboard tabs unaffected

- **Cross-reference:** CONTEXT.md LOCKED decision `Scope boundary`
- **Setup:** Open an RDP tab (or VNC/Guacamole tab) OR the Skynet dashboard tab. These use entirely different render paths from terminal tabs.
- **Expected observable:** Behavior is byte-identical to pre-Phase-41. RDP tab shows the Guacamole client surface. Dashboard shows the session-list grid. No regression.
- **Fail signal:** RDP tab shows a blank area or throws a React error. Dashboard fails to render. Any crash or visual regression in non-terminal, non-identity pane types.

---

### 9. MessageQueueDrawer sends fire from the IdentitySessionPane wrapper

- **Cross-reference:** CONTEXT.md `Send path` (established prior — Phase 35 patch #435; refs hoisted correctly in Phase 41-02's IdentitySessionPane wrapper)
- **Setup:** With an identity pane open in PrettyView mode, open the message queue drawer (the existing keyboard shortcut or touch affordance — unchanged from pre-Phase-41). If you have queued messages, send one. If not, type a brief message in the ComposeBox and send it.
- **Expected observable:** The message reaches the agent. It appears as an Ashley turn in the conversation stream (or the queued message drains to the agent). The send path (pvSendInputRef / pvSendInterruptRef, now owned by IdentitySessionPane wrapper instead of Terminal.tsx) works correctly.
- **Fail signal:** Send button does nothing. Or the message appears to send (ComposeBox clears) but the agent doesn't receive it (pvSendInputRef ref is not wired — the wrapper failed to hoist it correctly). Or the MessageQueueDrawer fails to open.

---

### 10. No console errors during toggle sequences

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time` + general React correctness
- **Setup:** DevTools console open. Filter out structured `operation:` logs (they're expected — you can filter by `-operation:` to suppress them if helpful, but they're not errors).
- **Steps:** 
  1. Open an identity pane.
  2. Press Ctrl+Shift+O 5 times (cold-boot Terminal 3 times, return to PrettyView 2 times — or vice versa).
  3. Open a non-identity SSH pane.
  4. Close both tabs.
- **Expected observable:** DevTools console shows **zero uncaught exceptions** and **zero React warnings** (e.g. "Warning: Can't perform a React state update on an unmounted component", "Warning: Each child in a list should have a unique key", or similar) during the entire toggle sequence.
- **Fail signal:** Any red error entries in the console (uncaught exceptions). Or yellow React warnings about unmounted component state updates (would indicate a useEffect cleanup or abort controller is missing in IdentitySessionPane or Terminal on unmount). Structured `console.info` log entries with `operation:` fields are expected and fine — only red/yellow entries are failures.

---

### 11. File upload from identity pane with Terminal never summoned

- **Cross-reference:** CONTEXT.md `Send path` (Phase 35 pattern extended for uploads by Plan 41-04); Phase 41-04 close-verdict follow-up
- **Setup:** Open an identity pane from the Skynet sidebar (e.g. tanya). Do NOT press Ctrl+Shift+O — Terminal must never have mounted during this session.
- **Steps:** Drag a file (any image or text file) into the PrettyView compose area, or click the paperclip (on touch devices). Confirm the file chip strip appears in the compose box. Press Send (or use startBatch via the compose flow).
- **Expected observable:** The upload chip shows progress (uploading → complete). The file is delivered to the agent as an injected user turn — the `upload_ready_to_inject` event fires, the agent receives the file message in the conversation. No error chip ("Upload failed") appears.
- **Fail signal:** Chip strip appears but upload immediately fails with an error, OR the chip strip never appears (upload_start is never sent), OR the upload hangs indefinitely. Any of these indicates the upload channel did NOT successfully rewire to PrettyView's own claude-session WS (regression to the pre-Plan-41-04 broken state where Terminal had to be mounted).
- **Technical note:** PrettyView now routes uploads through its own claude-session WebSocket (port 30011) rather than Terminal's SSH WebSocket (port 30002). The `handleUploadStart / handleUploadChunk / handleUploadAbort` handlers now live in `claude-session-server.ts` and use the pane's `sshConn` set at `connectToPane` time.

---

### 12. Upload survives Terminal summon mid-flight

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time`; CONTEXT.md LOCKED decision `Pane restructure — PrettyView promoted, Terminal becomes dormant peer`
- **Setup:** Start a file upload from the PrettyView compose area (drag a larger file if possible — > 1 MB — so the upload takes a moment). While the upload chip is showing progress (uploading state), press Ctrl+Shift+O to summon Terminal.
- **Expected observable:** The upload continues to completion. PrettyView's upload channel is carried by PrettyView's own claude-session WS (port 30011) — Terminal's SSH WS (port 30002) is irrelevant. Summoning Terminal does NOT interrupt the upload. When the upload completes, the injected user turn appears in PrettyView as normal.
- **Fail signal:** Upload shows an error after Terminal is summoned (would indicate the upload was still tied to Terminal's WS and lost the connection). OR the upload hangs indefinitely after the toggle (would indicate Terminal's WS interruption broke the upload path — this should not happen since uploads now route through the claude-session WS which stays live throughout the toggle).

---

### 13. Upload survives toggle-back-to-PrettyView (Terminal torn down mid-upload)

- **Cross-reference:** CONTEXT.md LOCKED decision `Load behavior — cold-every-time` — cold-every-time (Terminal is torn down on toggle-back to PrettyView; previously this would kill uploads carried by Terminal's SSH WS)
- **Setup:** Summon Terminal (Ctrl+Shift+O) to reach Terminal mode. Then start a file upload — if you can drag a file into the underlying PrettyView (it may be hidden), do so; alternatively toggle back to PrettyView first, start the upload, then toggle Terminal on and quickly toggle back. The key scenario is: an upload is in-flight while you toggle back to PrettyView (causing Terminal to tear down).
- **Expected observable:** The upload survives Terminal being torn down and completes. PrettyView's own claude-session WS carries the upload independently of Terminal's lifecycle. The injected user turn appears after upload completion.
- **Fail signal:** Upload fails with an error after toggling back to PrettyView (would indicate the upload was still tied to Terminal's SSH WS which was destroyed on teardown). This was the pre-Plan-41-04 behavior when the upload channel depended on Terminal's WS. After Plan 41-04, uploads are WS-independent of Terminal.

---

## Regression Suspicions (Areas to Watch)

If something breaks, the RESEARCH.md §9 hot areas are:

- **`src/ui/features/terminal/Terminal.tsx`** — received heavy surgery in Plan 41-02 (403 lines deleted). Primary risk: any state or ref that was removed but is still implicitly expected by non-identity SSH pane paths. The wiring test guards (`Terminal.wiring.test.ts` — 42 tests) cover the key absence assertions.
- **`src/ui/features/pretty-view/PrettyView.tsx` — `isIdleDerived` path** — PrettyView now derives isIdle from `useSessionIsWorkingRaw(sessionWorkingKey)` via the fleet-status broadcast store, not from a Terminal prop. If the broadcast store is empty (first mount, no fleet-status frame yet), the WipBubble and ready-dot are ABSENT (not stuck-on). This is the LOCKED graceful-degradation behavior, not a bug.
- **Upload path when Terminal is unmounted** — RESOLVED in Plan 41-04. File uploads now work correctly when Terminal is unmounted. PrettyView routes uploads through its own claude-session WS (port 30011) which is always live. The `terminalWs={null}` workaround and TODO(41-followup) comment have been removed. See UAT items 11-13 for the upload-specific UAT checklist items.

---

## Blocking Issues Found During UAT

(fill in during walk; escalate any FAIL items back to the executor rotation before proceeding)

- Item __ — FAIL — [notes]
- Item __ — FAIL — [notes]

---

## Passed Items — Approved for Ship

- [ ] Item 1 — Identity-session cold-open (PrettyView, no Terminal flash)
- [ ] Item 2 — Ctrl+Shift+O cold-boot into Terminal (first press)
- [ ] Item 3 — Long-press identity badge cold-boot
- [ ] Item 4 — Toggle-back tears Terminal down + second summon cold-boots fresh
- [ ] Item 5 — PrettyView WipBubble + ready-dot behave normally through toggles
- [ ] Item 6 — Tab title populates from fleet-status broadcast on identity panes
- [ ] Item 7 — Non-identity SSH terminal sessions unaffected (or skipped: no session available)
- [ ] Item 8 — RDP / VNC / dashboard tabs unaffected
- [ ] Item 9 — MessageQueueDrawer sends fire from IdentitySessionPane wrapper
- [ ] Item 10 — No console errors during toggle sequences
- [ ] Item 11 — File upload from identity pane with Terminal never summoned (Plan 41-04)
- [ ] Item 12 — Upload survives Terminal summon mid-flight (Plan 41-04)
- [ ] Item 13 — Upload survives toggle-back-to-PrettyView with Terminal torn down (Plan 41-04)

Sign-off (Ashley): __________ Date: __________

---

*Phase: 41-defer-terminal-view-mount-until-user-summons-it*
*Checklist produced by Plan 41-03 executor, 2026-08-14*
*Each item cross-references LOCKED decisions in `.planning/phases/41-defer-terminal-view-mount-until-user-summons-it/41-CONTEXT.md`*
