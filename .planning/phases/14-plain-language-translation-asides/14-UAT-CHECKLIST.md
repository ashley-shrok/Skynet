# Phase 14 UAT Checklist — Plain-Language Translation Asides

**For:** Ashley
**Post-deploy validation of the aside subsystem (Phase 14 patches, bundled with queued #150 A + C).**
**Batch context:** Phase 14 patches ship BUNDLED with the queued #150 A (pruner fleet-aware) + #150 C (URL-restore multi-tab glow) per CONTEXT.md § Phase Boundary — Ashley 2026-07-26 verbatim: "there's no point in deploying until we get it in." The three ship together in ONE deploy event on `feat/tab-title-from-tmux`. See § Post-UAT deploy runbook at the bottom.
**Deploy anchor:** term.gigaashley.click (production) — post-deploy, once Ashley greenlights the batch.
**Design source-of-truth:** `~/.claude/identities/tina/bounties/plain-language-translation-asides/bounty.json` (2026-07-26 design session with Ashley, full spec locked) + `~/.claude/identities/tina/bounties/plain-language-translation-asides/aside-visual-snippet.js` (DevTools recipe Ashley signed off on, defaults at 10px border + glow multiplier 1.0) + `.planning/phases/14-plain-language-translation-asides/14-CONTEXT.md` (LOCKED — no re-litigation).

**Trace commits (Phase 14 on `feat/tab-title-from-tmux`):**

- Plan 01 (Wave 1 — backend primitives): `b722977` + `d33ff77` + `c247b5c` + `ce04015` (RED/GREEN × 2 for BTW_PROMPT + shellQuote + injectBtw + sendEscapeToBtw + extractBtwAnswer)
- Plan 02 (Wave 2 — backend WS subsystem + wire types): `4ebb57d` + `60ebeb5` + `19ae23f` + `b4d9128` + `ab82bdd`
- Plan 03 (Wave 3 — frontend AsideBubble + PrettyView wiring + ComposeBox interface): `8c266a5` + `01d9350` + `88eaf0e` + `e9b0790` + `322e67f` + `8640804`
- Plan 04 (Wave 4 — ComposeBox morph body): `6c43184` + `f8c4e93` + `14d43c0` + `49bc643`
- Plan 05 (Wave 5 — integration tests + minimal source export): `be3ceb7` + `2b2b360` + `945d5b9` + `1371ae4`
- Plan 06 (Wave 6 — this checkpoint): `81d08e0` (build-verify log) + subsequent Wave 6 docs commits

**Build-verify status (per `14-BUILD-VERIFY-LOG.md`):**

- `npx tsc --noEmit` — exit 0
- `npx vitest run` — 596/596 passing across 49 test files (zero failures, zero skips)
- `npm run build` — exit 0 in 4.38s, 2395 modules transformed, no warnings
- Nginx caveat — N/A (Phase 14 adds no HTTP routes, only WS events on existing port 30011)

---

## Sign-off (top-of-page so you can find it fast)

- [ ] **All items in Desktop 1-11 + Cross-tab 12-13 + Mobile 14-19 + Cross-viewport regression 20-24 pass** → greenlight the bundled deploy (Phase 14 patches + queued #150 A + C ship as ONE deploy event). Reply with one of: **"deploy"** / **"ship it"** (Tina runs the deploy sequence per § Post-UAT deploy runbook; on your "pin it" reply post-UAT, Tina updates `skynet-patches.md` with all three patches together — see § Post-UAT deploy runbook for bump math).

- [ ] **Any item fails** → note the failing item and observed-vs-expected behavior. Decide by severity: if the failure is a visual delta from the locked aesthetic (wrong glow layer count, wrong border-width, hue not propagating correctly), route through the Failure → route-back table below to the specific Plan/Wave. If the failure is functional (aside never fires on a fleet-identity session, aside FIRES on an anonymous session, cross-tab dismiss doesn't propagate, ComposeBox morph doesn't happen, X-click doesn't dismiss, tab-close-then-reopen doesn't re-render the aside), route back per the table. If a SHAPE-06 scope violation (pretty-view interior touched outside `AsideBubble.tsx`, existing ChatMessage/ImageBubble/PlanPendingBubble/WipBubble modified), HARD FAIL.

- [ ] **Reply "hold off"** if something else takes priority OR the UAT surfaces something that needs revision before shipping. Phase 14 stays code-complete-on-branch; the deploy stays queued until you greenlight.

- [ ] **Reply "code-complete-pending-deploy"** if the code + docs look clean but the deploy itself is queued behind unrelated work (distinct from "hold off" — you approve the code, deploy just isn't happening yet in your current window).

## How to use this checklist

Work through top-to-bottom on BOTH viewports (desktop + iPhone PWA). Each item has an action + expected result + "if this fails" note. Mark [x] as you go.

**Section order:**

1. Setup — one time
2. Desktop UAT — items 1-11 (blocking) — ASIDE-01/02/03/04/05/06/07/09/10 coverage
3. Cross-tab UAT — items 12-13 (blocking) — ASIDE-08 + ASIDE-11 coverage
4. Mobile UAT (iPhone PWA) — items 14-19 (blocking) — mobile viewport render + morph + dismiss round-trip
5. Cross-viewport regression checks — items 20-24 (blocking; Phase 1/2/9/13 behaviors that must survive)
6. Failure → route-back table
7. Post-UAT deploy runbook + bounty closeout

## Setup — one time

1. Open https://term.gigaashley.click in **Chrome on a wide desktop window** (1400px+) AND in **Skynet on your iPhone** (PWA-installed, home-screen icon).
2. Have at least 2 running fleet-identity tmux sessions on distinct hosts (different hues to verify hue propagation) — e.g. `tina@skynet-ec2` + one other identity. Both sessions should have Claude Code running interactively.
3. Have at least 1 **anonymous** (non-`/id`) Claude Code session running in a random tmux window on some host — this is the negative-case verification for ASIDE-02 (identity gate).
4. Ashley Prime — open pretty-view on one fleet-identity session in a fresh Chrome tab; the tab should show the session's normal conversation stream at the bottom.
5. Have a scratchpad ready for the DevTools console verification snippets referenced in items 1 + 6 + 12 + 13 (the source-of-truth Map + WS-frame assertion snippets).

---

## Desktop UAT (wide window 1400px+)

### 1. ASIDE-01 + ASIDE-03: Aside fires on completed turn (fleet-identity session, arm loop end-to-end)

> **Contract:** Every completed assistant turn on a fleet-identity session with a pretty-view tab open triggers a canned `/btw` prompt injected into the identity's tmux via `tmux send-keys` over the existing SSH exec channel. The prompt text is exactly (per CONTEXT.md § Injection LOCKED, byte-for-byte): `/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.` (Note: U+2014 em-dash in "metaphor — explain".) Trigger source is the frontend's `isIdle: false → true` transition; PrettyView WS-sends `{type: "aside_arm"}` to the backend on port 30011; backend arms the poller and injects.

- [ ] **On a fleet-identity pretty-view tab (Session A), send a message that will produce a non-trivial reply.** Watch the pretty-view stream. Once Claude finishes replying and settles at the prompt (isIdle:false→true transition), wait ~2-4 seconds. Expected: an AsideBubble appears at the bottom of the stream — bright hue-tinted border, in-flow, not an overlay. Text is a plain-language re-explanation of what Claude just said.
- [ ] **DevTools console verify (optional confidence check):**
  ```js
  // Open Chrome DevTools → Console tab, then:
  document.querySelector('[aria-label="Plain-language aside from the identity"]')
  ```
  Expected: an element node (not `null`). If `null` after 4+ seconds and no bubble is visible, the arm loop didn't close. Route to Plan 14-02 (backend WS dispatch) OR Plan 14-03 (frontend arm-emitter) per the § Failure → route-back table.

### 2. ASIDE-02: Anonymous sessions never fire an aside (identity gate)

> **Contract:** Anonymous (non-`/id`) Claude Code sessions do NOT emit `aside_arm` from the frontend. Backend accepts any `aside_arm` on a connected pretty-view WS without checking identity (per plan-checker B2 lock — identity gating is frontend-only), so the frontend gate is the SOLE enforcement of ASIDE-02.

- [ ] **Open a pretty-view tab on the anonymous session from Setup step 3.** Send a message + wait for Claude to reply + wait ~4 seconds for the isIdle transition. Expected: NO AsideBubble appears. The compose bar stays in its normal state (no Send→X morph). If an aside appears on an anonymous session → route to Plan 14-03 Task 3 (the identity gate `pvIdentity != null` guard on the arm-emitter useEffect).

### 3. ASIDE-04: /btw answer extraction (multi-line + end-of-answer marker + last-occurrence anchoring)

> **Contract:** Backend polls `tmux capture-pane -p -S -200` at 300ms cadence after arm. Detects end-of-answer by watching for the marker line `↑/↓ to scroll · f to fork · Esc to close` to appear + pane content stable for two consecutive polls. Extracts answer text between the echoed `/btw` line and the marker. Multi-line answers exceeding the visible pane come from scrollback (`-S -200`). Uses LAST-occurrence anchoring on BOTH the marker AND the /btw echo — prior BTW invocations still visible in scrollback don't spoof the current answer.

- [ ] **On Session A, trigger multiple asides in sequence** (send a message → wait for aside → dismiss it → send another message → wait for aside). Each aside's text should be the plain-language re-explanation of THAT turn, not the previous one. Confirm the text semantically matches what Claude just replied (not what Claude replied 2 turns ago).
- [ ] **On Session A, send a message that will produce a LONG reply** (e.g. "list all the files in this directory with their purposes"). Wait for the aside. Expected: the aside text is the full plain-language re-explanation, not truncated at the visible-pane boundary. If truncated → the extraction poller isn't reaching into scrollback correctly (route to Plan 14-01 Task 2 or Plan 14-02 § poller — check the `capture-pane -S -200` flag is preserved).

### 4. ASIDE-05: Rendering — in-flow at bottom + scrollable message list preserved

> **Contract:** AsideBubble is a NEW pretty-view bubble type at the very BOTTOM of the scrollable message-bubble list. IN-flow (not overlay, popup, or fixed-position). Scroll behavior is unchanged: scrolling up to re-read history works exactly as before; the aside stays pinned at the bottom of the list. Bubble uses same identity-hue gradient as normal assistant bubbles but with 10px solid hue border + three-layer neon glow at 12/32/64px alphas 0.7/0.5/0.3.

- [ ] **When an aside is displayed on Session A, scroll the pretty-view stream UP to re-read earlier messages.** Expected: the aside stays at the BOTTOM of the list (not fixed to the viewport). Scrolling works exactly as before — no lag, no jank, no auto-snap-back. Scroll back to the bottom — the aside is still there in the same in-flow position.
- [ ] **Verify visual treatment:** 10px solid border in the identity's hue. Three-layer neon glow radiating outward (a soft outer glow that fades). Bubble background is the same hue-tinted gradient as normal assistant bubbles — semantically "from the same identity" but visually unmistakable as "not a normal reply."
- [ ] **DevTools console verify (optional):**
  ```js
  const el = document.querySelector('[aria-label="Plain-language aside from the identity"]');
  el && getComputedStyle(el).borderWidth
  ```
  Expected: `"10px"`. If different, route to Plan 14-03 Task 1 (AsideBubble aesthetic).

### 5. ASIDE-06: ComposeBox morph while aside displayed (Send→X + aux disabled + textarea preserved)

> **Contract:** While an aside is displayed for a session, ComposeBox morphs:
> - **Send button** → **X icon** (aria-label "Resume", hover tooltip "Resume"). Same DOM element (per PATTERNS.md L186-234 same-element-conditional-attribute morph — preserves focus + tab order + CSS selector stability).
> - **Reset / paperclip / thumbs-up / queue (Hourglass)** aux buttons → all disabled (greyed).
> - **Textarea** → REMAINS editable. Any partial draft text is preserved verbatim (never cleared or overwritten by aside displaying).
> - **Interrupt button** (Square icon, patch #120) → intentionally EXCLUDED from the morph gate; stays reachable even while aside is displayed (per its pre-existing safety-valve invariant).

- [ ] **When aside is displayed on Session A, look at the compose bar.** Expected: Send button is replaced with an X icon in the identity's hue color; hover it and tooltip reads "Resume". Reset (RefreshCw), paperclip, thumbs-up, and queue (Hourglass) all appear disabled/greyed. If Interrupt (Square) button is present, it should NOT be disabled — it stays reachable.
- [ ] **Before triggering the next aside, type some partial draft text in the textarea** (e.g. "this is a draft I don't want lost"). Then wait for the next aside to fire. Expected: the textarea content is still there when the aside displays. Draft is NOT cleared.
- [ ] **DevTools console verify (optional):**
  ```js
  document.querySelector('button[aria-label="Resume"]')
  ```
  Expected: an element (button). If `null`, the morph didn't fire → route to Plan 14-04 Task 2.

### 6. ASIDE-07: X (Resume) dismisses — aside clears + ComposeBox reverts + backend sends Escape to tmux

> **Contract:** X-click:
> 1. Frontend removes AsideBubble from the stream immediately (optimistic).
> 2. Frontend reverts ComposeBox to normal state (send button back, all affordances re-enabled).
> 3. Frontend WS-sends `{type: "aside_dismissed", hostId, tmuxSession}` to backend.
> 4. Backend `tmux send-keys -t <target> Escape` to close the underlying BTW overlay.
> 5. Backend WS-broadcasts `aside_dismissed` to ALL clients subscribed to that session (cross-tab dismiss coherence — item 12).
> Textarea content preserved through dismiss.

- [ ] **With an aside displayed on Session A + your draft still in the textarea, click the X (Resume) button.** Expected: AsideBubble disappears IMMEDIATELY (optimistic clear — no round-trip lag). ComposeBox reverts: X becomes Send again, aux buttons re-enable. Textarea content is preserved verbatim.
- [ ] **Verify backend Escape landed:** open the underlying tmux session directly (e.g. `ssh` in a terminal, `tmux attach -t <session>`). Expected: no BTW overlay visible; the pane is back at the normal Claude Code prompt. If BTW overlay is still open on tmux → the backend's `sendEscapeToBtw` didn't fire (route to Plan 14-02 § aside_dismissed handler).

### 7. ASIDE-08: v1 overlap policy — new turn while aside displayed does NOT get its own aside

> **Contract:** If a new completed turn arrives on a session that has an aside currently displayed, the currently-displayed aside stays UNCHANGED and the newer turn does NOT fire its own aside. The newer turn is otherwise unaffected. Backend enforces this via the `armed || displayed` overlap gate in the `aside_arm` dispatch handler.

- [ ] **With an aside displayed on Session A, quickly send a new message to Claude before dismissing the aside.** Wait for Claude to reply + isIdle transition (~4s). Expected: the currently-displayed aside stays unchanged (its text still corresponds to the earlier turn). NO new aside fires for the newer turn. The compose bar still shows the X (Resume) — has NOT reverted.
- [ ] **Now click X to dismiss.** Expected: aside clears, compose bar reverts. Note that the newer turn's message + reply are in the stream normally (just no aside for it).
- [ ] **Optional: to confirm the overlap gate reopens after dismiss, send ANOTHER message after dismiss.** Expected: on the isIdle transition, a NEW aside fires for THIS turn (the gate reset when displayed flipped to false via broadcast).

### 8. ASIDE-09: Tab-close + re-attach re-renders the aside from the still-open BTW overlay

> **Contract:** When a pretty-view tab is closed while its aside is displayed, the tmux BTW overlay is LEFT OPEN — backend does not send Escape. When a pretty-view subsequently mounts for that same session (any browser tab, same or new), the backend pane-probes the identity's tmux ONE time via `capture-pane -p -S -200`, detects the still-open BTW overlay, extracts its answer, and emits `aside_ready` to the mounting client so the aside is re-rendered in the same displayed state.

- [ ] **Trigger an aside on Session A + WITHOUT dismissing it, close the pretty-view tab entirely** (Ctrl+W / cmd+W). Wait 5 seconds.
- [ ] **Open a fresh pretty-view tab on the same Session A.** Expected: within ~1 second of the tab mounting, the aside re-appears at the bottom of the stream with the SAME text as before the close. ComposeBox morphs to Resume mode. If aside does NOT re-appear → the connect-time probe didn't fire OR didn't detect the still-open BTW overlay. Route to Plan 14-02 § connect-time probe (probe MUST run independent of activeViewers.size per plan-checker W7).

### 9. ASIDE-10: No aside store — backend restart recovers state by re-probing

> **Contract:** No database row, no in-memory KV, no persistence layer. The tmux BTW overlay itself is the sole source of truth. Backend is a pure translator.

- [ ] **This is a positive assertion — no test to run beyond items 8 + 12** (which prove the pane-probe mechanism works). If you want deeper confirmation on-box: `sudo docker exec skynet grep -rn "asideStore\|aside_store\|aside-store" /app/dist/` should return zero hits. But this is not a required UAT step — items 8 + 12 collectively prove ASIDE-10 works in practice.

### 10. Backend polling cadence — no perceptible lag between arm and aside display

> **Contract:** Backend polls at 300ms cadence with two-consecutive-stable-poll debounce. Total time from isIdle transition to aside_ready emit should be ~600ms (2 polls × 300ms) after the /btw answer lands in tmux.

- [ ] **On Session A, send a message + measure the time from "Claude settles at prompt" to "aside appears".** Expected: 2-6 seconds (accounting for `/btw` injection + Claude's own response time + 2×300ms poll debounce). If it consistently takes >10s → the poller cadence is off (route to Plan 14-02 § poller).

### 11. Locked aesthetic — 10px border + three-layer glow (Ashley aesthetic sign-off from aside-visual-snippet.js)

> **Contract:** Border 10px solid `hsla(var(--pv-id-hue), 90%, 65%, 1)` (full saturation, opaque). Three stacked outer shadows in the hue at descending alpha, ADDITIVE to the bubble's existing depth shadow + inner rim: `0 0 12px hsla(hue, 100%, 60%, 0.7)`, `0 0 32px hsla(hue, 100%, 55%, 0.5)`, `0 0 64px hsla(hue, 100%, 50%, 0.3)`.

- [ ] **Visual eyeball verification against `aside-visual-snippet.js` snapshot.** The aside should have an unmistakable "this glows" quality — obvious 10px opaque hue border + three concentric glow layers radiating outward (inner tight bright, middle wider softer, outer widest most-diffuse). If it looks like a normal assistant bubble with just a thin border → the glow inline-style isn't landing (route to Plan 14-03 Task 1).
- [ ] **Compare hues across identities:** trigger an aside on Session A (hue X) + trigger one on Session B (hue Y) in a separate tab. Expected: each aside adopts its OWN identity's hue — the border + glow + gradient background all shift to that identity's `--pv-id-hue` CSS var. Cross-check: does the aside's hue match the AsideBubble avatar / normal assistant bubble hues for that session?

---

## Cross-tab UAT (open at least 2 browser tabs on the SAME session)

### 12. ASIDE-11: Cross-tab dismiss coherence (dismiss in Tab A clears Tab B's aside)

> **Contract:** Backend `broadcastAsideDismissed` is an atomic BOTH-STEPS primitive: (a) sends `aside_dismissed` frame to EVERY OPEN peer WS on the session, AND (b) flips each peer's `asideState.get(peer).displayed = false` in the SAME loop iteration. Without step (b), peer overlap-ignore gates stay stuck on displayed:true forever and future asides silently break across tabs. Load-bearing invariant per CONTEXT.md § Backend per-connection state LOCK + plan-checker B3.

- [ ] **Open TWO pretty-view tabs on the SAME Session A** (both in the same Chrome window). Wait for both to fully load — both should show the identical conversation stream.
- [ ] **Trigger an aside on Session A** (send message from Tab A → wait for aside). Expected: both Tab A AND Tab B show the aside in their message stream. Both ComposeBoxes morph to Resume mode.
- [ ] **Click X (Resume) in Tab A.** Expected: within ~1 second, Tab B's aside ALSO disappears + its ComposeBox reverts to Send mode. Cross-tab coherence achieved. If Tab B's aside stays visible → the broadcast is only doing step (a) (sending frame) but not step (b) (flipping peer state) OR the frontend `aside_dismissed` WS handler isn't calling `setAsideText(null)`. Route to Plan 14-02 § broadcastAsideDismissed OR Plan 14-03 § aside_dismissed WS handler.
- [ ] **After the dismiss propagates, trigger a NEW aside** (send new message on Session A from Tab A). Expected: new aside fires and shows in BOTH tabs (proving the peer overlap-ignore gate reset correctly — this is the invariant plan-checker B3 called out). If only Tab A gets the new aside → peer state.displayed wasn't flipped by the previous dismiss broadcast; overlap gate stuck. Route to Plan 14-02 § broadcastAsideDismissed BOTH-STEPS.

### 13. External Escape via SSH also broadcasts dismiss (marker-disappearance branch)

> **Contract:** If Ashley SSH-attaches to the identity's tmux and presses Escape herself, the backend poller's marker-disappearance-FIRST branch detects the overlay disappearing and calls the SAME broadcastAsideDismissed primitive (same atomic BOTH-STEPS rule). So cross-tab coherence works regardless of dismiss origin — client-initiated dismiss OR external tmux Escape both flow through the same broadcast.

- [ ] **Trigger an aside on Session A (both tabs open showing it).** Then SSH into the identity's box (e.g. `ssh` in a terminal, `tmux attach -t <session>`) and press Escape once. Expected: the BTW overlay in tmux closes. Within ~1 second, BOTH Tab A and Tab B's asides clear + ComposeBoxes revert. Same behavior as clicking X (Resume) in the browser. If asides stay stuck in the browser after external Escape → the poller's marker-disappearance branch isn't reaching broadcastAsideDismissed (route to Plan 14-02 § poller marker-disappearance).

---

## Mobile UAT (iPhone / Skynet PWA)

### 14. Mobile aside render — in-flow at bottom (iPhone PWA + Session A)

- [ ] **Fully close Skynet PWA on iPhone** (swipe up from app switcher), then reopen. Open a pretty-view tab on Session A. Send a message from the iPhone. Wait for Claude to reply + isIdle transition. Expected: AsideBubble renders at the bottom of the stream — same aesthetic as desktop (10px border, three-layer glow, identity hue). Scrolling up to re-read history works; the aside stays pinned at the bottom.
- [ ] Verify the border + glow are visible + look proportional at mobile viewport. If the glow is clipped by the viewport edge on a narrow screen, that's a v1 acceptable-behavior note but worth flagging if it looks bad.

### 15. Mobile ComposeBox morph — Send→X + aux disabled + textarea editable

- [ ] **With aside displayed on iPhone, look at the compose bar.** Expected: Send morphs to X (tap-tap should read "Resume" via long-press or accessibility label). Aux buttons (reset / paperclip / thumbs-up / queue) all appear disabled. Textarea remains tappable + editable.
- [ ] **Type some draft text in the textarea WHILE the aside is displayed.** Textarea should accept input as normal. Any content typed pre-aside should be preserved verbatim through the display.

### 16. Mobile X-tap dismiss — same round-trip as desktop

- [ ] **Tap the X (Resume) button.** Expected: AsideBubble disappears immediately (optimistic). ComposeBox reverts to Send mode. Textarea content preserved. Backend sends Escape to tmux (verify via same tmux-attach method as desktop item 6 if you want deep confirmation).

### 17. Mobile cross-tab dismiss (iPhone + desktop on same session)

- [ ] **Open Session A pretty-view on both iPhone PWA AND a desktop Chrome tab.** Trigger an aside (from either device — send a message). Expected: aside shows on BOTH devices. Dismiss on iPhone (or desktop) → the other device's aside also clears within ~1 second. Same ASIDE-11 cross-tab coherence, cross-device edition. If it doesn't clear on the other device → same route-back as item 12.

### 18. Mobile tab-close + re-attach re-renders aside

- [ ] **Trigger aside on iPhone WITHOUT dismissing.** Close the pretty-view tab (or background the PWA). Reopen the PWA / open a fresh pretty-view tab on Session A. Expected: within ~1 second of mount, aside re-appears with the SAME text. Same ASIDE-09 pane-probe mechanism as desktop item 8, but on mobile.

### 19. Mobile — anonymous session negative case

- [ ] **On iPhone, open a pretty-view tab on the anonymous session from Setup step 3.** Send a message + wait for Claude to reply + wait for isIdle. Expected: NO aside fires (same identity-gate as desktop item 2).

---

## Cross-viewport regression checks

### 20. Pretty-view chat interior UNCHANGED from pre-Phase-14

> **Contract:** Only `AsideBubble.tsx` is a NEW file in `src/ui/features/pretty-view/`. Existing pretty-view components (ChatMessage, ImageBubble, PlanPendingBubble, WipBubble) are byte-preserved. Pre-Phase-14 pretty-view behaviors (bubbles rendering, message stream scrolling, WS reconnect on drop via patch #148, WIP indicator via patches #51/#85/#122, session-holding overlay via patch #74) all preserved.

- [ ] **Open a pretty-view tab on ANY session (fleet or anonymous).** Verify interior looks identical to pre-Phase-14: user cyan-tinted bubbles, assistant tan-tinted bubbles, tool-use plum bubbles, ComposeBox 2-tall shell, meter + queue + paperclip + reset all functional. If ANY existing bubble type visually changed → HARD FAIL (Phase 14 should be purely additive).

### 21. ComposeBox behavior on non-aside sessions (no morph, no gate)

- [ ] **On a fleet-identity session that has NO aside currently displayed, send messages normally.** ComposeBox should behave exactly as pre-Phase-14: Send button + Enter both send; queue button (Hourglass) queues; thumbs-up ("let's go") + reset + paperclip all enabled. No trace of the aside morph.

### 22. WIP indicator + session-holding overlay + isIdle plumbing all intact

- [ ] **Send a message, watch the WIP orb spinner briefly (patch #85), then wait for Claude's reply.** The isIdle transition (which drives the aside arm — item 1) is the same signal that drives the WIP indicator. Both must remain intact. If WIP orb never appears OR spins forever after Claude finishes → the `isIdle` signal is broken (route to Terminal.tsx isIdle useState — Phase 14 does NOT touch it, so this would be a regression from an unrelated cause).

### 23. Terminal mode + pretty-view mode toggle (Ctrl+Shift+O)

- [ ] **Press Ctrl+Shift+O to toggle pretty-view off (back to tmux mode).** Terminal mode should render normally. Press again to flip back to pretty-view. Aside subsystem should still be armed for the next completed turn. If ANY interaction between the toggle + aside subsystem breaks → route to Plan 14-03 § arm-emitter useEffect (may need to reset prevIsIdleRef on toggle).

### 24. Cross-tab dismiss doesn't affect UNRELATED sessions

- [ ] **Trigger an aside on Session A (in Tab A). Also have Session B open in Tab B with an aside displayed for Session B.** Dismiss Session A's aside in Tab A. Expected: Session B's aside stays displayed in Tab B (dismiss is session-scoped via the sessionKey in broadcastAsideDismissed, not global). If Session B's aside also clears → the broadcast is fanning out across sessions instead of within one (route to Plan 14-02 § broadcastAsideDismissed sessionKey scoping).

---

## Sign-off

| Item | Status | Ashley notes |
|------|--------|--------------|
| 1-11 (Desktop UAT — arm loop + rendering + morph + dismiss + overlap + re-attach + aesthetic) | ⬜ | |
| 12-13 (Cross-tab UAT — dismiss coherence + external Escape broadcast) | ⬜ | |
| 14-19 (Mobile UAT — iPhone PWA render + morph + dismiss + cross-tab + re-attach + anonymous negative) | ⬜ | |
| 20-24 (Cross-viewport regression) | ⬜ | |

**Ashley signature:** ______________  **Date:** ______________
**Deploy verdict (circle one):** GOOD (ship the bundle — Phase 14 + #150 A + #150 C together) / HOLD OFF (queue longer) / CODE-COMPLETE-PENDING-DEPLOY (approve code, deploy later) / ROLLBACK

---

## Failure → route-back table

| Symptom | Root Plan / Wave | Route-back target |
|---|---|---|
| Aside never fires on a fleet-identity session (item 1) | Plan 14-03 Task 3 (frontend arm-emitter) OR Plan 14-02 § aside_arm dispatch | Verify PrettyView.tsx emits `{type:"aside_arm"}` on isIdle:false→true when pvIdentity != null && wsRef.OPEN. Verify backend receives + sets state.armed = true + calls injectBtw. DevTools Network → WS frames tab shows outbound `aside_arm`. |
| Aside fires on anonymous session (item 2) | Plan 14-03 Task 3 | Identity gate `pvIdentity != null` is missing from the arm-emitter useEffect guard. |
| /btw prompt text is not verbatim per CONTEXT.md § Injection (item 1 — check tmux buffer) | Plan 14-01 Task 1 (BTW_PROMPT constant) | Verify `BTW_PROMPT` constant in claude-session-server.ts is byte-identical (including U+2014 em-dash) to `/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.` |
| Aside text is stale / from previous turn (item 3) | Plan 14-01 Task 2 (extractBtwAnswer) | Verify extractBtwAnswer uses LAST-occurrence anchoring on BOTH end marker AND /btw echo. Test case D + E in aside.test.ts should catch this. |
| Aside text truncated at visible pane boundary (item 3 long-reply case) | Plan 14-02 § poller | Verify `capture-pane -p -S -200` is used (with the `-S -200` scrollback flag), not just `capture-pane -p`. |
| AsideBubble missing 10px border or three-layer glow (item 4 + 11) | Plan 14-03 Task 1 (AsideBubble aesthetic) | Verify inline style has `borderWidth: "10px"` + boxShadow contains all three `0 0 12px|32px|64px hsla(var(--pv-id-hue), ...)`. Prop-driven; if borderWidthPx or glow props got wired to something ≠ 10 / 1.0, that's the cause. |
| AsideBubble is an overlay / popup / fixed-position (item 4) | Plan 14-03 Task 3 (AsideBubble mount site in PrettyView) | Verify AsideBubble is mounted INSIDE contentRef's flex column (after PlanPendingBubble), NOT as a sibling of the message list. |
| ComposeBox doesn't morph Send→X when aside displayed (item 5) | Plan 14-04 Task 2 (Send button morph) | Verify Send button's icon / aria-label / title / onClick / disabled / className all branch on asideActive. Verify PrettyView passes asideActive={asideText !== null} to ComposeBox. |
| Aux buttons NOT disabled while aside displayed (item 5) | Plan 14-04 Task 1 (aux button gate) | Verify 4 aux button `disabled` predicates all contain `|| asideActive === true` (reset, paperclip, thumbs-up, queue). |
| Textarea cleared when aside displays (item 5) | Plan 14-04 (negative-grep check) | Verify textarea's own `disabled` predicate is NOT extended with asideActive. The plan's negative-grep gate `! grep -E "disabled=\{[^}]*queueArmed[^}]*asideActive"` should pass. |
| X-click doesn't dismiss OR aside stays visible after click (item 6) | Plan 14-03 Task 3 (handleAsideDismiss) OR Plan 14-02 § aside_dismissed handler | Verify handleAsideDismiss does BOTH optimistic setAsideText(null) AND WS-send `{type:"aside_dismissed", hostId, tmuxSession}`. Verify backend receives + calls sendEscapeToBtw + broadcastAsideDismissed. |
| Backend Escape doesn't close BTW overlay in tmux (item 6 deep verify) | Plan 14-01 Task 1 (sendEscapeToBtw) OR Plan 14-02 § aside_dismissed handler | Verify sendEscapeToBtw executes `tmux send-keys -t <target> Escape` via execCommand. |
| New turn while aside displayed FIRES its own aside (item 7 — overlap policy broken) | Plan 14-02 § aside_arm dispatch overlap gate | Verify `if (state.armed \|\| state.displayed) return;` guard in aside_arm handler. |
| Tab-close + reopen does NOT re-render aside (item 8) | Plan 14-02 § connect-time probe | Verify probe fires INDEPENDENT of activeViewers.size (per plan-checker W7). If it's gated on size, ASIDE-09 breaks for the first client to reconnect. |
| Cross-tab dismiss doesn't propagate to peer tabs (item 12) | Plan 14-02 § broadcastAsideDismissed | Verify broadcastAsideDismissed is atomic BOTH-STEPS: (a) sends dismiss frame to each peer AND (b) flips each peer's asideState.get(peer).displayed = false. Backend integration test B explicitly asserts this. |
| Peer overlap gate stuck after cross-tab dismiss — new aside only fires in one tab (item 12 last check) | Plan 14-02 § broadcastAsideDismissed step (b) | Same as above — the peer-state-flip step is missing. Load-bearing invariant per CONTEXT.md § Backend per-connection state LOCK. |
| External SSH Escape doesn't broadcast dismiss (item 13) | Plan 14-02 § poller marker-disappearance | Verify the poller's marker-disappearance branch runs FIRST + calls broadcastAsideDismissed. |
| Pretty-view interior visually changed outside AsideBubble (item 20) | HARD FAIL — SHAPE-06-style scope violation | `git diff --stat 21358b5..HEAD -- src/ui/features/pretty-view/{ChatMessage,ImageBubble,PlanPendingBubble,WipBubble}.tsx` should return 0. If any is >0, that Wave violated scope. Revert + rebase before deploying. |
| tsc broken / build broken | Any Phase 14 Wave | Bisect via `git log --oneline f4ae668..HEAD` — each Wave's GREEN commit has its own tsc gate per SUMMARY.md verify sections. Re-run `npx tsc --noEmit` at each commit to identify regression source. |

---

## Post-UAT deploy runbook

### AUTHORITATIVE SOURCE

**Deploy procedure lives at `~/.claude/identities/tina/deploy-runbook.md`** (post-2026-07-21). This is the current, self-contained procedure for shipping `skynet-patched:local` onto skynet-ec2. **Tina follows the steps in that file verbatim.** This UAT checklist does not duplicate the runbook; it points at it.

### Stale-reference callout — the 15-min deadman regime is RETIRED

The fork's `CLAUDE.md` (in this repo root) still contains a line under `Deploy safety` mentioning the "15-min deadman rollback timer". **This constraint was RETIRED fleet-wide on 2026-07-21.** Ashley's SSM-tmux-attach-via-SSH-over-SSM fallback (documented in `deploy-runbook.md` § "FALLBACK: tmux-attach via SSH-through-SSM") replaced the deadman's catastrophic-loss-recovery role. The fork's `CLAUDE.md` hasn't been updated yet; that update is a **SEPARATE OPEN BOUNTY** — `claude-md-15min-deadman-stale` — that will land in a future hygiene sweep. **Ignore the fork CLAUDE.md's 15-min deadman line + ignore the plan file's `<what-built>` reference to it. Use `~/.claude/identities/tina/deploy-runbook.md` as the authoritative source.**

### BUNDLED DEPLOY — Phase 14 + queued #150 A + C ships as ONE deploy event

Per CONTEXT.md § Phase Boundary (Ashley 2026-07-26 verbatim: "there's no point in deploying until we get it in"), Phase 14 patches do NOT ship standalone. Deploy sequence:

- **Phase 14 patches** (aside subsystem — AsideBubble + PrettyView / ComposeBox / claude-session-server / claude-session-api changes, from commits `b722977` through `81d08e0`)
- **Queued #150 A** (pruner fleet-aware — `7f63a4b`, fixes Ashley's live-hit pin-nuke; solo-deploy carveout applied at the time was moot because this bundle absorbs it)
- **Queued #150 C** (URL-restore multi-tab glow — `b48023e` investigation + `162dc1c` fix)

All three land in ONE `docker compose up -d --force-recreate skynet` event on `feat/tab-title-from-tmux`. The `skynet-patches.md` pin at deploy time captures all three:

- Pin **#150 A** (pruner fleet-aware) — if not already pinned solo. Per quick task `260726-l1p` timeline, deploy was deferred pending Ashley greenlight; the solo-deploy carveout is now moot because #150 A ships with this bundle.
- Pin **#150 C** (URL-restore multi-tab glow) — if not already pinned solo.
- Pin **#151** (Phase 14 — Plain-Language Translation Asides) — the new patch, drafted in `14-PATCHES-MD-ENTRY.md`.

Header count bumps depend on `skynet-patches.md` current baseline; Tina verifies with `grep "numbered patches" ~/.claude/identities/tina/skynet-patches.md | head -3` at pin time and computes the correct bump. If both #150 A + C are unpinned at deploy time (likely), the bump is from N to N+3.

### CHECK-BEFORE-RECREATE ONE-LINER (survived deadman retirement)

Before EVERY `docker compose up -d --force-recreate skynet`, Tina runs:

```
grep 'image:' /opt/skynet/docker-compose.yml | grep -q skynet-patched:local || \
  sudo sed -i 's|image: ghcr.io/lukegus/skynet:latest|image: skynet-patched:local|' /opt/skynet/docker-compose.yml
```

Idempotent — no-op when compose is already patched, corrects when it's been reverted.

### ASHLEY PRE-WARN — first hard-refresh may white-screen

Per `~/.claude/identities/tina/tina.md` § learned preferences (2026-07-23):

> After `docker compose up -d --force-recreate skynet`, the FIRST hard-refresh may white-screen with `net::ERR_HTTP2_PROTOCOL_ERROR` on chunk loads. **The fix is close+reopen the tab, NOT a real deploy failure.** Root cause: Caddy holds persistent upstream connections to the skynet container; when the container dies mid-fetch during recreate, the browser's existing H2 stream to Caddy sees the upstream fail and marks the stream broken client-side. Fix = close and reopen the tab (spawns a fresh H2 connection).

**When the deploy actually happens, Tina PRE-WARNS Ashley in the deploy notification** that the first hard-refresh may white-screen and the fix is close+reopen. Do NOT jump to rollback on the first PROTOCOL_ERROR report.

### Deploy flow (only if Ashley explicitly greenlights)

Per `~/.claude/identities/tina/deploy-runbook.md` steps 1-8. Summary:

1. **Apply + commit + push + build** — deploy-runbook Step 1. `git push` BEFORE build. Build script clones from GitHub; local-only commits cache-hit the frontend-builder layer. Trap that bit patches #43 + #69.
2. **Ask Ashley for explicit go-ahead for THIS deploy window** — a distinct greenlight, not carried over from earlier code-work authorization. Every build → deploy transition is a new "may I?" moment.
3. **Run the check-before-recreate one-liner** (see above).
4. `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`
5. **Wait for `(healthy)`** — should be within 30s. Corroborate the patch shipped by grepping the deployed dist for the aside subsystem's signature bytes: `docker exec skynet grep -c 'AsideBubble' /app/html/assets/*.js` should return >= 1 (if 0, the frontend build layer cache-hit and stock shipped — rollback + re-push + re-build).
6. **PRE-WARN Ashley in the deploy DM** about the first-hard-refresh white-screen risk; tell her the fix is close+reopen the tab.
7. **Tell Ashley to walk this UAT checklist.** On her "pin it" reply: paste `.planning/phases/14-.../14-PATCHES-MD-ENTRY.md` (and #150 A + C entries if not yet pinned) into `~/.claude/identities/tina/skynet-patches.md`, bump the header count appropriately, commit the pin (`docs(patches): pin patches #150 A + #150 C + #151 — Phase 14 aside subsystem bundled with queued pruner + URL-restore fixes`).
8. **If broken**: manual rollback per deploy-runbook.md step 8 — `sudo sed -i 's|image: skynet-patched:local|image: ghcr.io/lukegus/skynet:latest|' /opt/skynet/docker-compose.yml && cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`. Then investigate.

---

## Bounty closeout note

After Ashley's UAT signs off (mobile + desktop both viewports), the bounty at `~/.claude/identities/tina/bounties/plain-language-translation-asides/` closes. The full aside subsystem shipped as designed:

- Backend: BTW inject via tmux send-keys + capture-pane extraction + 300ms poller + module-scope asideState Map + atomic BOTH-STEPS cross-tab broadcast + connect-time re-attach probe + connect/dispatch lifecycle
- Frontend: AsideBubble with locked 10px + three-layer neon glow aesthetic + PrettyView isIdle-transition arm emitter (identity-gated) + WS handlers for aside_ready / aside_dismissed + handleAsideDismiss two-step callback + ComposeBox interface extension + ComposeBox body morph (Send→X, aux disabled, textarea preserved)
- Tests: ~50 aside-specific unit + integration tests across 7 test files, all passing

Reply "pin it" post-UAT to close the bounty + pin the patches-md entry.

---

*Phase: 14-plain-language-translation-asides*
*Checklist generated: 2026-07-26 (Plan 14-06 Task 2)*
*Design source-of-truth: `~/.claude/identities/tina/bounties/plain-language-translation-asides/bounty.json` (LOCKED) + `.planning/phases/14-plain-language-translation-asides/14-CONTEXT.md` (LOCKED)*
*Deploy source-of-truth: `~/.claude/identities/tina/deploy-runbook.md` (post-2026-07-21) — NOT the fork CLAUDE.md's stale 15-min deadman reference*
*Sign-off block at top of page.*
