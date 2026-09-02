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
