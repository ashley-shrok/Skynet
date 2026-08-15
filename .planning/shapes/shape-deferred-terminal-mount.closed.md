# Shape: defer the terminal view until Ashley reaches for it

**Opened:** 2026-08-14
**Vehicle:** GSD phase (inside a `/build` arc)

## What this is

For an identity-based session (one where the chat surface is the default landing view), the terminal view no longer loads or connects to the box when the session opens. Only the chat surface loads. The terminal is summoned on demand — Ctrl+Shift+O, or long-press the identity badge — and each time it's summoned it cold-boots from nothing: fresh renderer, fresh connection, tmux reattach. Toggle away and the terminal goes cold again, releasing the resources back. This applies only to identity-based sessions; non-identity SSH-terminal sessions and RDP sessions are untouched.

## Shape

Today, opening a session in the app spins up two surfaces at once: the chat surface (default landing) and the terminal view (waiting silently in the background with a live connection to the box). Both are wired up eagerly. The chat surface, in the current arrangement, actually lives inside the terminal view — the terminal is the enclosing surface, the chat surface hangs inside it. When Ashley toggles views, she's flipping which one is shown; both remain mounted and connected.

The change flips this. The chat surface is promoted to standalone: it mounts and connects on its own, without the terminal wrapping it. The terminal becomes a peer, but a *dormant* peer — it does not exist at all until Ashley reaches for it. First toggle to the terminal cold-boots it: a fresh renderer is built, a new connection dials the box, the still-hot tmux session on the backend is reattached, and the last screen redraws. Toggle back to the chat surface and the terminal is torn down completely — its renderer is destroyed and its connection is closed. Every visit to the terminal is a fresh cold-boot.

Two things the chat surface has been getting through the terminal today have to be re-sourced so the chat surface can stand alone:

- **The "agent is working / agent is idle" signal.** This drives the work-in-progress indicator inside the chat surface and the ready dot in the conversation list. Today it flows in real time from the terminal's live box connection. In the new shape it flows from the backend fleet-status broadcast, which already knows this per-session by polling hosts on a cadence.

- **The tab title.** Today it's derived from the tmux session name, which the terminal side discovers once it's connected. In the new shape the fleet-status broadcast carries the tmux session name as an additional property alongside the working-idle signal — same delivery path, arriving the same way.

The send path from the chat surface to the agent is already self-contained (it stopped borrowing the terminal's connection a couple of weeks ago), so no re-sourcing there.

## Philosophy

The chat surface is what Ashley actually uses. The terminal is a rare-fallback tool for the moments the harness is in a state the chat surface can't cover — she goes in, hits a key, leaves. Nothing about the built result should assume the terminal is a co-equal always-there surface: it's summoned, used briefly, dismissed.

Cold-every-time is the deliberate stance. There is no "warm keep" mode, no escape hatch for "I'm going to be in the terminal for a while," no toggle to disable the deferral. The terminal being expensive to have open is exactly what motivates the change; adding modes to keep it open would defeat the point. If the cold-boot ever feels too slow in practice, the answer is to make cold-boot faster, not to add a warm-keep mode.

The slight lag introduced by the working-idle signal now flowing through backend polling instead of a live stream is accepted as the tradeoff. The chat surface's ready dot will appear a beat later than it does today — probably a second or two. If that ever feels wrong in practice, the answer is to poll more often (cheap over tailnet, few hosts), not to add a shadow live connection.

## Prior context

The send path was migrated to be chat-surface-owned rather than terminal-borrowed in Phase 35 (mid-August 2026, patch #435). That's what makes this change possible at all — without it, the chat surface still depended on the terminal's connection to send messages, and deferring the terminal would have broken sending.

The backend fleet-status broadcast that will now be the source of the working-idle signal shipped in Phase 39 (patch #441) with tuning in patch #442 (which corrected a composite formula that had been mis-treating a specific status as "working" and pinning the indicator on forever). It already polls every managed host on a cadence, decrypting credentials as needed and reattaching over SSH. Adding one more property to what it broadcasts is a small extension of an existing mechanism, not a new mechanism.

The current arrangement — chat surface nested inside terminal view — is a historical artifact of the chat surface having been built as an overlay on top of the terminal originally. The relationship has been inverted-in-spirit for months (Ashley almost never uses the terminal) but the code arrangement still reflects the old model. This change brings the code arrangement in line with the actual usage.

Non-identity sessions (pure SSH terminal hosts where there's no agent, no chat surface) and RDP sessions do not render a chat surface at all — the terminal or the RDP client is the only surface. These are unaffected. The change only applies where the chat surface is the default landing view.

## What would make it wrong

- **The chat surface silently degrading** because a signal it used to get from the terminal wasn't fully re-sourced from the fleet-status broadcast. The working-idle indicator and the tab title are named; if there's a third piece of information the chat surface relies on that isn't accounted for, the change misses the point. This is the primary risk area.

- **Cold-boot feeling broken instead of fast.** If summoning the terminal takes long enough that Ashley starts wondering whether the toggle registered, the shape has failed even if it technically works. Existing "connecting" state UX is reused precisely so this doesn't look like a bug when it does happen — but if cold-boot is routinely slow, that reuse isn't enough.

- **Non-identity sessions or RDP sessions being affected.** If the change accidentally reaches into panes that don't have a chat surface as their default, Ashley lands on nothing when she opens them, and the terminal-first hosts break. The scope boundary is load-bearing.

- **Toggle-back-to-chat leaving stale terminal state visible for a beat**, or the chat surface briefly showing a broken frame during the mount/unmount transitions. The pane restructure is real surgery; visual glitches during transitions would violate the "invisible replacement" quality the change should have.

- **The ready-dot workflow breaking outright** because the fleet-status broadcast has a bug for some hosts and never delivers the idle signal, causing dots to never appear or WIP to stick on. Graceful degradation matters here — if the signal is missing entirely, the indicator should be absent, not stuck-on.

## Scope edges

**In:**
- Identity-based sessions where the chat surface is the default landing view.
- Pane restructure: chat surface promoted to standalone, terminal becomes a dormant peer.
- Re-sourcing the working-idle signal from the fleet-status backend broadcast.
- Adding the tmux session name to what the fleet-status broadcast carries, and sourcing tab titles from there.
- Cold-boot on every toggle to the terminal; teardown on every toggle away.
- Reuse of the existing terminal "connecting" state UX for cold-boot moments.

**Out:**
- Non-identity SSH-terminal sessions.
- RDP sessions.
- Any "keep the terminal warm" mode, opt-out toggle, or feature flag to disable the deferral.
- Any change to the chat surface's own behavior beyond what's needed to stand alone.
- Any change to the fleet-status polling cadence (tune later if lag is felt).

**Deferred:**
- If the working-idle signal lag turns out to be too laggy in practice, faster polling — deferred until Ashley reports it feels wrong.
- Any cold-boot performance work beyond what falls out naturally from the pane restructure — deferred until Ashley reports it feels slow.

**Tempting but no:**
- A "keep this one warm" pin. Would defeat the point of the deferral.
- A visible indicator that the terminal is currently deferred (badge, icon, hint). Adds noise for an implementation detail Ashley doesn't need to see.
- Rewriting the chat surface's own architecture during this change. Out of scope.

## Vehicle notes

`/build` framing with GSD phase as the execution vehicle inside it. The phase is expected to split naturally into two plan slices: the pane restructure with state hoisting (chat surface promoted to standalone, terminal becomes dormant peer, dormancy of the terminal wired to the toggle state), and the re-sourcing of the working-idle signal + tmux session name through the fleet-status broadcast (with a small backend extension to add the tmux name to what's broadcast). Plan-checker gate applies; execution runs in waves; verifier gate applies.

Working tree is `~/skynet-tanya/` on `feat/tab-title-from-tmux`. Fleet coordination rules apply for the eventual deploy (BEFORE + AFTER announcements in the box-maintainer coord room; `git pull --rebase` before push). The deploy motion is orchestrator-owned, not executor-owned, per the fleet rule that subagents don't do deploys.

The build is closed out with `/close deferred-terminal-mount` — the file arrangement below is what that reviewer walks conformance against, both ways (nothing missing, nothing added).

---

## Close-Out

**Closed:** 2026-08-14
**Vehicle used:** GSD phase inside /build arc — three plan slices (41-01 broadcast-fed store + isIdle re-source, 41-02 IdentitySessionPane wrapper + Terminal surgery + tab-title retarget, 41-03 deploy-prep docs); deploy motion held for orchestrator per fleet rule 2026-08-08
**Overall verdict:** closed-with-misses

### Shape features (conformance)

- **What this is — terminal defers, chat surface loads standalone, cold-boot on summon, teardown on toggle-away, identity-only** — present · IdentitySessionPane conditionally mounts Terminal only when !isPrettyMode (default true); PrettyView always mounted as sibling; toggle back unmounts Terminal completely; non-identity terminal panes and RDP untouched
- **Shape — chat surface promoted to standalone under a new wrapper, terminal becomes dormant peer, isIdle and tab title re-sourced from fleet-status broadcast** — partial · wrapper + peer-render is exactly as described; isIdle and tab title both re-sourced; but a THIRD signal (uploads riding on terminal's WS) was not re-sourced — pretty-view chip strip/drop uploads are non-functional on identity panes
- **Philosophy — cold-every-time, no warm-keep, no opt-out, no keep-warm pin, slight isIdle lag accepted** — present · no warm-keep mode, no feature flag; every summon is a fresh Terminal mount + fresh SSH WS + tmux reattach; existing 'Connecting' UX reused
- **Prior context — Phase 35 send-path migration, Phase 39 broadcast, patch #442 composite fix** — present · PrettyView's pvSendInputRef/pvSendInterruptRef preserved in wrapper (Phase 35 send-path intact); backend broadcast SessionState.tmuxSession field discovered already on wire so no backend change required (small win over shape's expectation of adding a property); patch #442 composite honored via session-working-store
- **What would make it wrong: chat surface silently degrading because a signal it used to get from the terminal wasn't fully re-sourced** — missing · the primary risk-area failure mode is exactly what happened — the upload channel (a third signal PrettyView was getting through Terminal's WS) is not re-sourced; wrapper hands PrettyView terminalWs=null with a TODO(41-followup); Ashley: uploads must not be broken by the shipped result — close the gap in this same change before ship
- **What would make it wrong: cold-boot feeling broken instead of fast** — present · existing terminal Connecting UX reused via SimpleLoader unchanged; no visible test evidence of slowness (would need live deploy to judge, per the reviewer's read-only remit — reused loader is the guard the shape asked for)
- **What would make it wrong: non-identity SSH terminal sessions or RDP being affected** — present · tabUtils dispatcher branches on identitiesByKey.has(); non-identity terminal panes route to TerminalTabContent byte-unchanged; RDP/VNC/telnet/dashboard cases in switch untouched
- **What would make it wrong: toggle-back leaving stale terminal state visible or chat surface briefly showing a broken frame during transitions** — cannot-verify · React unmount is synchronous so no stale-state leak by construction; transitional-frame quality requires a live deploy to judge — outside a read-only conformance check
- **What would make it wrong: ready-dot workflow breaking outright because fleet-status broadcast has a bug — graceful degradation matters** — present · useSessionIsWorkingRaw returns null on absent key (never-heard-yet), which maps to isIdleDerived null → WipBubble absent (not stuck-on); explicit three-state semantics guard against pinning
- **Scope edges IN — identity panes only, pane restructure, isIdle re-source, tab title re-source, cold-boot every summon, reuse Connecting UX** — present · all IN items delivered as described
- **Scope edges OUT — no non-identity, no RDP, no keep-warm mode, no opt-out toggle, no changes to chat surface beyond standing alone, no polling-cadence change** — drifted · the 'no changes to chat surface beyond standing alone' commitment was quietly violated — the wrapper hands PrettyView a null upload WS where previously it had a live one, degrading upload capability; not a bad-faith addition but a subtractive change to PrettyView's runtime capability that wasn't sanctioned; Ashley disposition: fix in-this-change
- **Scope edges TEMPTING BUT NO — no keep-warm pin, no deferred-visible badge, no PrettyView architecture rewrite** — present · none of the rejected additions crept in

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Rewire the pretty-view upload channel off the terminal's connection and make it self-contained, so uploads work on identity panes without the terminal being mounted — must land in this same change before ship, not as a follow-up — new-shape

### Notes

The shape's re-sourcing list was incomplete: it enumerated isIdle and tab-title as the two things PrettyView was getting through the terminal, but PrettyView was ALSO borrowing the terminal's WebSocket for its upload channel (usePrettyViewUploads consuming the terminalWs prop). The executor spotted this and disposed of it as an 'acceptable trade-off' behind a TODO(41-followup) comment at IdentitySessionPane.tsx L271-275, which Ashley overturned: 'no reason to break uploads when we can just keep working to make sure everything is right.' Pattern worth carrying: /open shape enumeration of 'signals the surface depends on' should be treated as a discovery hypothesis to be validated during research, not a closed set — if research finds a third signal, the shape needs re-agreement before the plan commits to letting it degrade. The rest of the phase is a clean hit: pane restructure, cold-every-time, non-identity/RDP unaffected, ready-dot graceful degradation via three-state useSessionIsWorkingRaw, tab-title retarget through session-tmux-store, and the happy discovery that SessionState.tmuxSession was already on the fleet-status wire (no backend change needed).

---

## Close-Out (pass 2)

**Closed:** 2026-08-14
**Vehicle used:** GSD phase inside /build arc — pass-2 follow-up delivered as plan slice 41-04 (frontend rewire commit c29cbf50, backend relocation commit e0b80a54, integration test + seam commit 4e41b164, deploy-prep doc extension commit 8ef3cce7, summary commit b63f3efb)
**Overall verdict:** closed-hit
**Follow-up from pass 1:** closed

### Shape features (conformance — deltas from pass 1)

- **What would make it wrong — chat surface silently degrading because a signal it used to get from the terminal wasn't fully re-sourced (the pass-1 miss)** — present · usePrettyViewUploads in PrettyView.tsx now takes wsRef.current (PrettyView's own claude-session WS opened via openClaudeSessionSocket) for both ws and getBufferedAmount — no dependency on Terminal being mounted. Backend upload_start/upload_chunk/upload_abort dispatch moved to claude-session-server.ts and uses the pane's own sshConn set at connectToPane time. The upload channel is fully self-contained for identity panes.
- **Scope edges OUT — no changes to chat surface beyond standing alone (the pass-1 drift)** — present · The subtractive-capability drift flagged in pass-1 is undone: PrettyView is no longer being handed a null WS for uploads; the WS it receives (its own) is live in exactly the conditions it renders. The terminalWs prop no longer exists on the component surface at all.
- **Shape — third signal (uploads) re-sourced alongside isIdle and tab-title** — present · The three-signal set (isIdle, tab-title, uploads) is now fully re-sourced away from Terminal.
- **Scope edges OUT sanity — no non-identity, no RDP, no keep-warm mode, no polling cadence change (not touched by 41-04)** — present · 41-04's commits touch only PrettyView.tsx, IdentitySessionPane.tsx, PrettyView.compose-send.test.tsx, claude-session-server.ts, terminal.ts (subtractive), one new integration test, and three deploy-prep artifacts. Non-identity dispatch (tabUtils), RDP/VNC/telnet cases, fleet-status polling, and Terminal cold-boot machinery untouched.
- **Reusable upload module and REST /uploadFile endpoint unchanged** — present · git diff across 41-04 shows zero changes to src/backend/ssh/pretty-view-upload.ts, src/backend/ssh/file-manager-content-routes.ts, and src/ui/api/pretty-view-upload-protocol.ts. Wire protocol byte-identical.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Pass-2 conformance is clean. The pass-1 miss (upload channel riding Terminal's WS) and the pass-1 drift (subtractive capability change to PrettyView) are the same underlying issue and were both closed by the sanctioned scope of 41-04. Backend commit is purely subtractive on terminal.ts and purely additive on claude-session-server.ts (dispatch body ported verbatim including the Quick-fix 260801-29v pendingStarts race guard); frontend commit removes the terminalWs prop cleanly and rewires the hook to the WS that was already open on the surface. cleanupBatchesForConnection is called in both teardownPane and ws.on('close') per plan-checker guidance (belt-and-suspenders). The new __dispatchUploadMessageForTests seam mirrors the existing __applyInputMessageForTests pattern for test invocation without extracting the inline dispatch body — minimizing production diff. Deploy-prep artifacts (41-BUILD-VERIFY-LOG.md, 41-UAT-CHECKLIST.md items 11-13, 41-PATCHES-MD-ENTRY.md) extended to cover the upload-channel re-source.
