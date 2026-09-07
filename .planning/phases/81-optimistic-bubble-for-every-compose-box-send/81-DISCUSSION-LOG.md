# Phase 81 Discussion Log

**Gathered:** 2026-09-07
**Discussion mode:** Seeded from shape file per `/build` skill convention. No interactive `/gsd:discuss-phase` question pass was run — the /open discussion pass already locked all the substantive decisions, and per build-skill § 2 ("If the vehicle is a GSD phase, seed discuss-phase from the shape file... Don't re-do the discovery work `/open` already did.") CONTEXT.md is derived directly from the shape file plus a live-code investigation pass.

**Shape file:** `.planning/shapes/shape-attach-optimistic-bubble.md`

## /open discussion arc (2026-09-07)

The /open discussion covered every substantive decision that would normally be elicited in a /gsd:discuss-phase question pass. Transcript summary:

1. **Pitch beat.** Diagnosis of the bug (attachment path skips `onOptimisticSend` at `ComposeBox.tsx:1543`) plus initial three-shape offer for the bubble render (files-only sends): (a) caption + "N files" indicator, (b) caption + filename chips, (c) caption only. Ashley chose (b): *"Well, obviously the best UX is number two."*

2. **Discussion beat.** Ashley wanted honest confidence on whether (b) was really "reasonably easy." Named the assumption: the settled attachment bubble already renders `AttachmentChipStrip` in `readOnly` mode via the `injected` render branch (`ChatMessage.tsx:479-509`), which meant reusing an existing visual — not inventing one. Live-code investigation confirmed. Ashley pushed back on speculation-without-checking: *"you really need to get familiar with this whole thing if we're gonna have the right discussion about it."* Follow-on code investigation covered: (a) `AttachmentChipStrip` `readOnly` mode + `ChatMessage.injected` render; (b) `formatInjectedUserTurn`/`parseInjectedUserTurn` protocol for settled-bubble content; (c) `startBatch` mints mqid before uploads begin (D-11); (d) FIFO head-match on user-role incoming frames (D-10); (e) `upload_ready_to_inject` handler as the natural seed-later hook.

3. **Scope-widening grill.** Asked whether primary Send was the only trigger site in scope or whether queue-slot text/attachment sends + cadence auto-fire should be included. Ashley's response was foundational: *"if it comes out of the compose box, it should have an optimistic bubble... anything at all in the compose box sends a message into the compose box of the harness, then it should have an optimistic bubble."* Every compose-box send trigger in scope (D-01/D-18). Non-send actions (interrupt) explicitly out.

4. **Failure-friction grill.** Asked whether the attachment failure case should preserve staged files so retry doesn't require re-attaching (asymmetric friction vs. text-only retry). Ashley: *"we are not making any attempt to make that part easy or easier in this chunk of work."* Failure-easier scope-out locked (D-09).

5. **Seed-timing grill.** Offered two shapes (X: seed at Send press with static chips; Y: seed at Send press with live upload-progress chips). Ashley offered a third: *"I was hoping for the upload progress to not be changed from how it is now, and when they finish, that's when the optimistic bubble comes up, and so the files would have already been uploaded by then."* Seed timing locked at upload-complete/inject-time for attachments (D-02/D-04). Compose-chip upload-progress affordance untouched (out of scope).

6. **Vehicle grill.** Confirmed GSD phase (multi-file, multi-trigger, cross-cutting behavior with shared design decisions). Ashley thumbs-up.

7. **Shape file written + greenlit thumbs-up.** Locked scope edges: in — every compose-box send trigger × text/attachment variants, seed-at-inject for attachments, extended pending render, symmetric failure treatment, mqid-based match-and-replace. Out — upload-progress rework, staged-file preservation, retry-easier affordance, non-send action bubbles, settled-bubble rework.

## Deferred Ideas (surfaced during /open)

- Preserving staged files across a failed attachment send (retry-friction fix). Explicit scope-out, follow-on phase candidate.
- Upload-progress rendering inside the pending bubble (Shape Y). Rejected — belongs in compose chips.
- Retry affordance / one-click resend for failed attachment bubbles. Same class as preservation deferral.
- Refactoring queue-slot text sends to route through `useComposeSend` funnel vs. duplicating the seed-and-dispatch primitive inline. Planner-discretion in this phase; consolidation-refactor a follow-on candidate if the duplication ends up ugly.

## Claude's Discretion

- Exact shape of the `attachments` field on `PendingSend` and `onOptimisticSend` (naming, whether to inline or reference).
- Where to surface the file list at `upload_ready_to_inject` from `use-pretty-view-uploads.ts` (extend `BatchOutcome`, add sibling callback, or piggyback on `onReadyRef`).
- Whether the new pending-with-attachments render branch in `ChatMessage` shares code with the existing `injected` branch via extraction, or duplicates inline.
- Test structure: extend `PrettyView.optimistic-bubbles.test.tsx` inline vs. add sibling `PrettyView.optimistic-bubbles-attachments.test.tsx`.

---

*Phase: 81-optimistic-bubble-for-every-compose-box-send*
*Discussion completed: 2026-09-07*
