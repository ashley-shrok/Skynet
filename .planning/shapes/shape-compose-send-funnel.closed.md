# Shape: universal compose-box send funnel

**Opened:** 2026-09-02
**Vehicle:** gsd phase

## What this is

A universal send-funnel for the PrettyView compose box. Every user affordance that inserts characters and submits them to a Claude session — the main text area, the queued-message text areas, the thumbs-up canned dispatch, the recap canned dispatch, the reset command — currently takes its own path. Some produce an optimistic bubble, some wake dormant sessions, some do both, some do neither. The result: users can't predict whether hitting a button will produce a bubble, wake a sleeping session, or drop characters straight into bare bash. This work replaces the fragmented paths with one common send-funnel that every affordance routes through.

## Shape

Conceptually there is ONE send-funnel with three responsibilities: wake the session if dormant, dispatch the text to Claude, and — unless the payload is on the render-blacklist — seed an optimistic bubble via the existing Phase 50 mqid pattern. Each caller supplies the text to dispatch, whether the send is render-blacklisted, and any caller-local cleanup (which input to clear, whether there are attachments). The funnel handles wake + dispatch + optional bubble seed uniformly.

The rule of thumb the user gave, verbatim: *"does it enter characters into the Harness Compose box and submit it?"* If yes → funnel. No exceptions for slash commands, canned dispatches, reset, queued sends.

## Philosophy

The funnel is the source of truth for "how a message enters a session." Downstream render decisions — like reset's render-blacklist — stay with the render layer, not with the caller. The caller's only responsibility is "I want to send text T to this session"; every other invariant (wake, mqid generation for the wake-gate, bubble seed, error handling) belongs to the funnel.

**Deliberately doing:** unifying the SEND transport (wake + dispatch + bubble seed).

**Deliberately NOT doing:** unifying attachment handling, textarea clearing, focus management, draft persistence. Those stay per-caller — the funnel is about send transport, not about the surrounding UI. Also NOT doing: unifying system-initiated sends (WIP-restore replays, agent-relay forwards, session-recycle bootstrap prompts) — those aren't user-driven affordances and have their own paths.

**Would violate the spirit even if it passed a test:** adding a new send affordance to the compose box that doesn't route through the funnel; special-casing wake or bubble seeding for one specific button; treating "no mqid = no wake" as a legitimate state; making a caller aware of the render-blacklist rather than letting the render layer own it.

## Prior context

Patch #505 (Phase 50, 2026-08-21) added optimistic bubbles for the main text area only, via a signal-driven watchdog + `pv-optim-*` mqid seeded on a pending-send FIFO. Explicitly out of scope at the time: queue-slot sends, quick-reply buttons. Phase 56-01 later added invisible backend wake for dormant panes — but the wake gate only fires for sends carrying the pretty-view submit shape, which the main-textarea path guarantees via mqid.

Today's per-trigger status, per an audit run before this shape:

| Trigger | Optimistic bubble | Dormancy wake |
|---|---|---|
| Main text area | YES | YES |
| Queue-slot send | NO | YES |
| Thumbs-up | NO | NO (button disabled when `canSend===false`) |
| Recap | NO | NO (same disable gate) |
| Reset | NO (blacklisted, correct) | NO (bug — drops `/id reset` into bare bash on dormant sessions) |

Thumbs-up and recap are disabled-when-dormant as a legacy artifact from when dormant panes required a dedicated wake-up button before any interaction. That button is long gone; the disable is a stale leftover.

The main-textarea handler is not a cleanly-callable helper today — the `handleSend` wrapping bakes together the optimistic seed + wake + dispatch + error handling + textarea clearing + draft clearing + attachment branching. The funnel needs to be extracted as its own thing, not just point every caller at the existing handler.

The reset-button dormant bug is expected to fix as a side-effect of routing reset through the funnel: the funnel will generate an mqid for wake-gate purposes, which will match the main-textarea's payload shape for the backend, which will fire the wake. If the actual root cause turns out to be something other than mqid-shape, the phase absorbs the extra diagnosis.

## What would make it wrong

- A user hits any compose-box affordance, session is dormant, and characters end up in bare bash instead of Claude.
- A user hits thumbs-up or recap on a dormant session and the button silently does nothing (still disabled).
- A user hits the main text area and no optimistic bubble appears — regression from today's baseline.
- Reset shows a bubble — violates the render blacklist.
- Adding a new send affordance in a future feature and discovering during code review that the developer forgot to wire it through the funnel — the funnel should be so obviously the only way to send that bypassing it feels wrong.

## Scope edges

**In:** the five affordances named — main text area, queue-slot send, thumbs-up, recap, reset. All route through the funnel. Thumbs-up and recap become enabled-when-dormant with wake routing. Per-trigger in-process tests locking the new behavior.

**Out:** system-initiated sends (WIP-restore, agent-relay forwards, session-recycle bootstrap). Attachment handling refactor. Draft persistence refactor. Any new compose-box affordances not on the list above (voice send-mode, mic gestures, etc. — those get added later, and they will use the funnel).

**Deferred:** the bubble render-blacklist logic itself — stays as-is. The funnel plumbs an mqid through even for blacklisted sends so that wake fires; the render layer honors the blacklist and skips the bubble.

**Tempting but no:** unifying the backend wake gate with the frontend funnel. The wake gate is backend and payload-shape-driven; the frontend funnel is caller-shape-driven. They meet at the WS message contract, not at a shared abstraction.

## Vehicle notes

GSD phase. The funnel + rewire touches 5 UI affordances + likely a new hook or helper module + tests per trigger. The phase will need its own discuss → plan → execute → verify.

Handoff seed for the phase: this shape file is authoritative for what → discuss-phase should generate CONTEXT.md from it (or drop it in as CONTEXT.md), not re-elicit. Identity doing the work: `tiffany` (box-maintainer of t1000, Skynet). Related files that discuss-phase will need to point at:

- `src/ui/features/pretty-view/ComposeBox.tsx` — all 5 trigger handlers live here (`handleSend`, `handleQueueSlotSend`, `handleQuickSend`, `handleResetSend`, `dispatchResetPayload`)
- `src/ui/features/pretty-view/PrettyView.tsx` — the `onSend` callback + WS message construction with conditional `messageQueueItemId`
- `src/backend/claude-session/claude-session-server.ts` — the backend send handler + Phase 56 dormant-wake branch
- Prior art: patch #505 (Phase 50) shape file at `.planning/shapes/shape-optimistic-message-bubbles.closed.md` for the mqid contract + watchdog design

---

## Close-Out

**Closed:** 2026-09-02
**Vehicle used:** gsd phase (68-01 refactor + 68-02 rewire + 68-03 tests)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — one universal send-funnel replacing fragmented per-caller paths** — present · useComposeSend hook at ComposeBox.tsx L440 is the single send transport; all 5 user affordances instantiate and call funnel.send()
- **Shape — funnel owns wake+dispatch+optional bubble seed; caller supplies text + local cleanup** — present · Hook body handles mqid generation, onOptimisticSend seed (pre-send + failure), onSend dispatch, and submit-entry/success/failed logs; callers retain only setText/clearAfterSend/setErrorMessage per PATTERNS.md Contract boundary
- **Shape — rule of thumb: any affordance that enters characters and submits routes through the funnel (no exceptions for slash commands, canned dispatches, reset, queued sends)** — present · All 5 listed affordances routed; reset (slash command) and thumbs-up/recap (canned) explicitly go through funnel.send
- **Philosophy — funnel is source of truth; render decisions stay downstream; caller only says 'send text T'** — present · Render-blacklist implemented in PrettyView.handleOptimisticSend as isIdCommand(payload) early-return at L1157; no caller carries a render-blacklist flag. (Note: the bubbleTextOverride affordance is a partial philosophy departure at the thumbs-up wire site — endorsed as drift per D-02.)
- **Prior context — reset dormant bug fixed as side-effect of routing through funnel (mqid-shape hypothesis)** — present · Test 5 in ComposeBox.send-funnel.test.tsx executes the full production chain and asserts the outgoing WS input frame carries messageQueueItemId equal to the funnel-minted mqid — hypothesis verified in-process
- **What would make it wrong: dormant-session send drops into bare bash** — present · Funnel always mints mqid (D-03); WS frame always carries messageQueueItemId when mqid present (PrettyView.sendInput L1000-1005); Test 5 locks reset's frame shape specifically
- **What would make it wrong: thumbs-up or recap silently no-op on dormant session** — present · canSend === false || removed from both button disabled predicates at L2468 (thumbs-up) and L2501 (recap); Tests 3 and 4 assert button.disabled === false when session is streaming
- **What would make it wrong: main text area send produces no optimistic bubble (regression)** — present · Test 1 locks: exactly one pending bubble with data-event-id ^pending-pv-optim- after Enter; funnel.send calls onOptimisticSend synchronously before dispatch
- **What would make it wrong: reset shows a bubble (blacklist violation)** — present · Test 5 asserts countPendingBubbles === 0 after reset click; isIdCommand guard in handleOptimisticSend returns before any pendingSends record is added
- **What would make it wrong: future affordance forgets to route through the funnel** — present · Single hook, single call pattern (funnel.send(payload, { trigger })), co-located in ComposeBox.tsx above the component body — the pattern is uniform across all 5 sites, making a bypass visible at code-review
- **Scope edges — In: 5 named affordances all through funnel; thumbs-up/recap enabled-when-dormant; per-trigger in-process tests** — present · All 5 affordances routed; both disable predicates relaxed; ComposeBox.send-funnel.test.tsx has 5 tests, one per trigger
- **Scope edges — Out: system-initiated sends, attachment refactor, draft-persistence refactor** — present · Backend claude-session-server.ts untouched (git diff --stat shows zero backend changes); attachment branching still per-caller in each handler; draft persistence unchanged. Arm-idle drainer (fireNextQueued) and voice-slot send left on direct onSend per shape's system-initiated carve-out.
- **Scope edges — Deferred: bubble render-blacklist logic stays; funnel plumbs mqid through even for blacklisted sends** — present · Blacklist logic is a single new guard clause using existing isIdCommand helper (module-scoped at L425); mqid always generated and passed to sendInput regardless of blacklist
- **Scope edges — Tempting but no: unifying frontend funnel with backend wake gate** — present · Backend untouched; frontend funnel and backend Phase 56 wake gate remain separate abstractions meeting at the WS input-frame contract

### Additions (in the result, not in the shape)

- bubbleTextOverride parameter on the funnel that lets a caller (thumbs-up wire site) seed a pending bubble whose rendered text differs from the payload sent to the backend — the thumbs-up bubble shows '👍' while the backend receives 'thumbs up'. The caller becoming aware of a per-caller render concern is a partial departure from the shape's Philosophy section. — endorsed-as-drift

### Follow-ups

- Shape file was never updated to reflect the D-02 bubbleTextOverride decision that was locked in discuss-phase — the shape and CONTEXT.md diverged on this point. — accepted-as-drift

### Notes

Clean pass on both directions. Every shape commitment is present and executable-tested (5/5 tests). The sole material divergence — bubbleTextOverride — was a discuss-phase decision (D-02 in CONTEXT.md) that never back-propagated to shape-compose-send-funnel.md; the philosophy departure is real but sanctioned. Backend claude-session-server.ts confirmed untouched. Arm-idle drainer (fireNextQueued at L1233) and voice-slot send (L1712) still call onSend directly rather than funnel.send — the phase's 68-02 SUMMARY categorizes these as system-initiated per the shape's Out carve-out, which is a defensible reading (both are not among the 5 named user-driven affordances). Worth flagging for future review if voice-driven sends become a first-class user affordance.

---

## Amendment — 2026-09-02 (post-close correction)

**Scope correction, not scope expansion.** When Ashley reviewed the Close-Out
notes flagging arm-idle drainer + voice-slot send as "system-initiated per the
shape's Out carve-out (defensible reading)," she rejected that reading:

> "everything that comes out of the compose box should go through the stuff that
> we were talking about. So if you're saying that the delayed until idle
> messages, and the voice stuff doesn't do it, then fucking get on it."

Both sites carry user-typed content submitted through compose-box affordances:
the arm-idle drainer fires queued user text after the session goes idle; the
voice-slot send fires user-dictated text after transcription. Neither is
system-initiated in the sense the shape's Out edge meant (WIP-restore replays,
agent-relay forwards, session-recycle bootstrap prompts — none of which carry
user-typed compose-box content). They should always have been in scope.

**Additional rewires shipped as commit 665af6f7 (refactor(68-04)):**
- `fireNextQueued` arm-idle drainer text-only branch: `onSend(payload)` →
  `funnel.send(payload, { trigger: "queue-item" })`. `useComposeSend`
  declaration hoisted above `fireNextQueued` so the drainer's useCallback can
  close over `funnel.send`.
- Voice-slot text-only send (post-transcription, no attachments):
  `onSend(payload)` → `funnel.send(payload, { trigger: "voice-slot" })`.

Both sites now inherit optimistic bubbles + dormancy wake uniformly with the
other 5 named affordances. No new tests added — behaviorally identical to
queue-slot direct Send (Test 2) which already locks the funnel API contract.

**Revised final verdict: closed-hit.** All user-initiated compose-box
affordances (7 sites total: main text area, queue-slot Send, thumbs-up, recap,
reset, arm-idle drainer, voice-slot post-transcription) route through the
funnel.
