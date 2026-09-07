# Phase 81: Optimistic bubble for every compose-box send - Context

**Gathered:** 2026-09-07
**Status:** Ready for planning
**Seed:** `.planning/shapes/shape-attach-optimistic-bubble.md` (opened + greenlit 2026-09-07 via `/build` → `/open`, per fleet convention CONTEXT.md is seeded from the shape file — no re-elicitation of decisions already locked in `/open`).

<domain>
## Phase Boundary

Extend the existing optimistic-bubble machinery so it covers every compose-box send trigger in both text-only and attachment-carrying variants. Rule: if a compose-box send emits a message, that send produces an optimistic bubble; non-send actions (interrupt) still don't.

**Two gap classes this phase closes:**
1. **Queue-slot text sends and cadence auto-fires from the queue** never seed a pending bubble today. `ComposeBox.tsx:1429-1436` explicitly flags this as deferred out of Phase 50: *"primary handleSend seeds an optimistic bubble via onOptimisticSend; queue-slot sends currently do NOT (out of scope … Revisit if…)."* This phase revisits.
2. **Attachment-carrying sends from ANY trigger site** (primary Send, queue-slot Send, cadence auto-fire) never seed a pending bubble. The attachment branch of primary `handleSend` at `ComposeBox.tsx:1543-1575` routes through `onSendWithAttachments` and awaits `BatchOutcome` without calling `onOptimisticSend`. Same skip in the two queue-slot attachment paths at L1455 (queue-slot Send) and L1695 (cadence-fire).

</domain>

<decisions>
## Implementation Decisions

### Coverage rule (Ashley 2026-09-07, verbatim)
- **D-01:** *"if it comes out of the compose box, it should have an optimistic bubble... anything at all in the compose box sends a message into the compose box of the harness, then it should have an optimistic bubble."* Every compose-box send trigger in scope: primary Send, queue-slot Send, cadence auto-fire, voice-submit. Non-send actions (interrupt button) remain out — they don't emit a message.

### Seed timing for attachment sends
- **D-02:** For attachment sends, seed the pending bubble at **upload-complete / inject-time**, NOT at Send press. The compose chips with per-chip progress rings own the upload phase exactly as they do today (untouched). Only once uploads succeed (`upload_ready_to_inject` fires from the uploads hook) does the pending bubble seed. The pending bubble then covers the same window it does for text sends: "message just went to the harness, waiting for it to echo back."
- **D-03:** For text sends (primary + queue-slot + cadence), seed at dispatch time (Send press for primary; slot-fire for queue-slot; cadence-fire for auto-fire) — no change from today's primary-Send path.
- **D-04:** Rationale for D-02: upload phase and harness-confirmation phase are separate visual concerns with separate affordances. Upload progress lives in compose chips; the pending bubble is for the after-upload window only. This preserves today's compose-chip upload-progress affordance verbatim.

### Pending bubble render for attachment sends
- **D-05:** Same visual as the settled attachment message bubble: caption above a horizontal chip strip. Reuse `AttachmentChipStrip` in `readOnly=true` mode. Chip = filename + human-readable size only (no thumbnails, no inline previews, no landing-path display, no × remove, no progress ring — same UPLOAD-11 lock the settled bubble honors).
- **D-06:** Empty-caption case (files-only send): render just the chip strip, no caption line. Matches settled bubble's `injected.caption.length > 0 &&` conditional at `ChatMessage.tsx:488`.
- **D-07:** During the pending window (post-upload, pre-echo), chips render with `status:"complete"` styling (matches settled bubble at `ChatMessage.tsx:500`). No progress ring — uploads are done by definition when the pending bubble exists.

### Failure treatment
- **D-08:** Same red-whole-bubble treatment Phase 76 landed for text-only pending failures (D-06 from Phase 76 CONTEXT): whole bubble red, chips still visible so user sees what didn't land.
- **D-09:** Compose is NOT repopulated on failure (Ashley 2026-09-02, reversing Phase 50 D-20/D-56). Retry means re-attach + re-type — no preservation of staged files, no retry-easier affordance. Explicitly scope-out per Ashley 2026-09-07.

### Match-and-replace lifecycle
- **D-10:** Same mqid + FIFO head-match mechanism as text-only pending bubbles today (`PrettyView.tsx:1885-1911`). Content-equality between pending and real bubble is NOT required — matching is by mqid via FIFO head-match on incoming user-role message frames.
- **D-11:** For attachment sends, mqid is minted at `startBatch` time (well before `upload_ready_to_inject`). We already hold it at the moment of the seed-later step, so no new plumbing to get an id.

### Upload-failure path (pending bubble NEVER exists)
- **D-12:** If uploads themselves fail (server-rejected file, network drop, WS-not-open at startBatch time), NO pending bubble is ever seeded. The failure stays in the compose chips as it does today (compose chips already carry `status:"error"` state). The pending bubble is only born once uploads succeed and the message actually goes to the harness.
- **D-13:** If a batch is superseded (user sends batch A, then B before A completes), A's outcome is `"superseded"` and A never seeds a pending bubble. B seeds normally. No pending-bubble cleanup logic needed for the superseded case because the pending bubble was never seeded.

### Attachment metadata plumbing
- **D-14:** The `PendingSend` record shape at `PrettyView.tsx:1118-1124` extends with an optional `attachments?: Array<{filename, size, mimetype}>` field. When present, the pending-bubble render passes them to `ChatMessage` for the chip-strip render.
- **D-15:** `ChatMessage` gets a new render branch: when `pendingState !== null` AND attachment metadata is present, render `caption + AttachmentChipStrip readOnly` (mirroring the existing `injected` branch at L479-509 but keyed on the pending-bubble path, not on `parseInjectedUserTurn`).
- **D-16:** `onOptimisticSend` callback shape at `ComposeBox.tsx:181-192` extends with an optional `attachments?: Array<{filename, size, mimetype}>` field. Text-only callers omit it (backward-compatible).

### Voice-submit path
- **D-17:** Voice-submit already routes through primary `handleSend` via `funnel.send(payload, {trigger:"voice-submit"})` (voice records → payload injected into compose → handleSend fires). It's already covered by the primary-Send path fix — no additional work.

### Coverage summary (5 trigger × 2 variant matrix)
- **D-18:** Trigger sites needing seed calls (with today's status):
  - **Primary Send + text-only** — WORKS today (Phase 50)
  - **Primary Send + attachments** — MISSING today, fix in this phase (D-02)
  - **Queue-slot Send + text-only** — MISSING today (Phase 50 deferred), fix in this phase (D-03)
  - **Queue-slot Send + attachments** — MISSING today, fix in this phase (D-02 + D-03)
  - **Cadence auto-fire + text-only** — MISSING today (Phase 50 deferred), fix in this phase (D-03)
  - **Cadence auto-fire + attachments** — MISSING today, fix in this phase (D-02 + D-03)
  - **Voice-submit** — WORKS today via primary handleSend routing (D-17)

### Claude's Discretion
- Exact shape of the `attachments` field on `PendingSend` and `onOptimisticSend` (naming, whether to inline the file objects or take references) — planner + executor decide.
- Where to surface the file list at `upload_ready_to_inject` time from `use-pretty-view-uploads.ts` — either extend the `BatchOutcome` `ok:true` variant to carry `files`, or fire a separate `onOptimisticSeed` callback ahead of resolving the outcome, or piggyback on the existing `onReadyRef` callback. Planner picks the least-invasive shape.
- Whether the new pending-with-attachments render branch in `ChatMessage` shares code with the existing `injected` branch (via extracting a shared render helper) or duplicates it inline. Executor discretion — either is fine as long as visual output matches.
- Test structure: whether the new coverage extends `PrettyView.optimistic-bubbles.test.tsx` inline vs. adds a sibling `PrettyView.optimistic-bubbles-attachments.test.tsx`. Planner picks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (this phase)
- `.planning/shapes/shape-attach-optimistic-bubble.md` — locked design agreement from /open. Covers philosophy, scope edges, what-would-make-it-wrong. This CONTEXT.md is derived from it — read the shape file for the "why," this CONTEXT.md for the "how."

### Prior phases that built the machinery this extends
- `.planning/phases/50-optimistic-message-bubbles/50-CONTEXT.md` — text-only optimistic bubble mechanism (D-01/D-03/D-04/D-06/D-15/D-18/D-19/D-20/D-21). Defines `PendingSend` shape, `handleOptimisticSend` seed flow, `onOptimisticSend` callback contract, the 20-second-timer flip-to-failed lifecycle, FIFO head-match on incoming user-role frames, `immediateFailure:true` for WS-not-open path.
- `.planning/phases/50-optimistic-message-bubbles/50-01-PLAN.md` through `50-04-PLAN.md` — the actual plans that landed the text-only mechanism. Reference for how to shape this phase's plans.
- `.planning/phases/05-pretty-view-file-upload-support/05-CONTEXT.md` — attachment send infrastructure (UPLOAD-04 chip-strip mounting, UPLOAD-11 chip-visual lock, UPLOAD-13 empty-caption allowance, sender-side render via injected-user-turn format, `formatInjectedUserTurn` / `parseInjectedUserTurn` protocol). Defines the settled bubble's chip render (`AttachmentChipStrip readOnly` mode) that this phase's pending-bubble render mirrors.
- `.planning/phases/68-compose-send-funnel-universal-send-funnel-for-prettyview-com/68-CONTEXT.md` — Phase 68 extracted the `useComposeSend` funnel primitive that seeds optimistic bubbles + dispatches sends. Reference for the send-funnel shape and how the seed-and-dispatch contract works.
- `.planning/phases/76-*/76-CONTEXT.md` — Phase 76 D-06 whole-bubble red-fill on flip-to-failed. This phase inherits that treatment for attachment pending failures unchanged.

### Related bounties (context on the specific gaps this closes)
- `~/.claude/roles/box-maintainer/bounties/pv-queue-op-dedup-doesnt-survive-wake-recycle/` — sister bug in the queue-slot dedup path; not directly closed by this phase but shares surface area.

### Source-file anchors (executor will need these)
- `src/ui/features/pretty-view/ComposeBox.tsx:181-192` — `onOptimisticSend` callback prop shape
- `src/ui/features/pretty-view/ComposeBox.tsx:421-492` — `useComposeSend` funnel (text-only send transport with pending seed)
- `src/ui/features/pretty-view/ComposeBox.tsx:1421-1499` — queue-slot handleSend equivalent (text + attachment paths; L1429-1436 flags the queue-slot optimistic-bubble deferral)
- `src/ui/features/pretty-view/ComposeBox.tsx:1505-1600` — primary handleSend (text + attachment paths; L1543-1575 is the attachment branch that skips onOptimisticSend)
- `src/ui/features/pretty-view/ComposeBox.tsx:1691-1710` — cadence-fire queue-slot attachment path
- `src/ui/features/pretty-view/PrettyView.tsx:1111-1275` — `PendingSend` type + `handleOptimisticSend` seed logic
- `src/ui/features/pretty-view/PrettyView.tsx:1885-1911` — incoming-frame FIFO head-match cleanup
- `src/ui/features/pretty-view/PrettyView.tsx:3317-3338` — pending-bubble render (`pendingSends.map` → `ChatMessage role="user"`)
- `src/ui/features/pretty-view/PrettyView.tsx:3640-3666` — `onSendWithAttachments` prop wiring (routes to `uploads.startBatch`)
- `src/ui/features/pretty-view/ChatMessage.tsx:479-509` — settled `injected` render branch (caption + `AttachmentChipStrip readOnly`)
- `src/ui/features/pretty-view/ChatMessage.tsx:297-311` — `parseInjectedUserTurn(content)` call that drives the injected render
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — the chip-strip component with `readOnly` mode
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts:449-469` — `upload_ready_to_inject` handler (the moment we seed the pending bubble for attachments)
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts:88-104` — `BatchOutcome` shape (extension candidate for surfacing files at inject-time)
- `src/ui/api/pretty-view-upload-protocol.ts:222-337` — `InjectedTurnInput` / `formatInjectedUserTurn` / `parseInjectedUserTurn` (settled-bubble format spec)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AttachmentChipStrip` (with `readOnly=true` prop)** — the exact chip visual the settled attachment bubble uses today. Pending bubble reuses it verbatim. No new component needed.
- **`ChatMessage` component** — already renders both the settled attachment bubble (via `injected` branch, parsed from `content`) AND the text-only pending bubble (via `pendingState` prop). Extends with a new pending-with-attachments branch that combines both.
- **`PendingSend` record + `handleOptimisticSend` + FIFO head-match** — the whole text-only optimistic mechanism is already in place. Attachment path plugs into it by extending the record with an `attachments?` field and calling the same seed function.
- **`useComposeSend` funnel** — text-only primary Send already goes through this. Queue-slot text sends can be refactored to route through the funnel too (closes the Phase 50 deferred gap in D-03), OR the funnel's seed-and-dispatch pattern can be duplicated inline for queue-slot sites — planner's call.
- **`upload_ready_to_inject` event handler at `use-pretty-view-uploads.ts:449`** — already has the `files` array from the backend AND fires the `onReadyRef` callback with `{messageQueueItemId, files, caption}`. The pending-bubble seed hooks here.
- **`startBatch` return `{messageQueueItemId, outcome: Promise<BatchOutcome>}`** — mqid is available at Send press, before upload starts. Ready to hand to the pending-bubble seed later when uploads complete.

### Established Patterns
- **`onOptimisticSend` callback with `immediateFailure:boolean`** — Phase 50 D-20 pattern for seeding pending records synchronously before/around the WS write. Extends naturally with an optional `attachments` field.
- **Sender-side chip render via `readOnly` mode** — Phase 05 UPLOAD-11 established this. Same read-only pattern for the pending bubble.
- **`formatInjectedUserTurn` → jsonl frame → `parseInjectedUserTurn` → chip render** — the settled bubble's content string carries the file list inline; ChatMessage parses it back for chip render. The pending bubble does NOT need to use this format — it can carry attachment metadata directly on the `PendingSend` record and pass it to `ChatMessage` as a prop, bypassing the parse. This keeps the pending-bubble path structurally simple (no need to synthesize a fake `formatInjectedUserTurn` string with placeholder landing paths).
- **FIFO head-match on user-role incoming frames** (`PrettyView.tsx:1900`) — matches pending records by ORDER, not content. Attachment pending bubbles clear via the same mechanism when the real bubble arrives — the injected-turn-formatted content the harness echoes doesn't need to match anything content-wise.
- **Whole-bubble red on failure (Phase 76 D-06)** — extends unchanged to attachment pendings.

### Integration Points
- **Attachment send flow → pending seed:** the seed call needs to happen inside the `upload_ready_to_inject` handler in `use-pretty-view-uploads.ts` OR in the `onReadyRef` callback fired from there OR wired through the `BatchOutcome.ok` resolve. Whichever the planner picks, the seed must fire BEFORE the WS input frame is dispatched (Phase 50 D-01: seed must precede send so the incoming user-role frame's FIFO head-match finds a pending record to clear).
- **Queue-slot text sends → funnel or duplicated seed:** the two queue-slot text-send paths at `ComposeBox.tsx:1421-1499` (regular slot Send) and elsewhere (cadence-fire) currently don't route through `useComposeSend`. Either route them through the funnel, or duplicate the seed-and-dispatch primitive inline. Executor discretion.
- **`onSendWithAttachments` prop shape:** may need to widen to also accept an optional seed callback, or plans may add a new sibling prop (`onAttachmentSeed`?). Planner picks the interface.
- **Test coverage:** `PrettyView.optimistic-bubbles.test.tsx` covers text-only today. Extend for attachment variants across all trigger sites. `ComposeBox.test.tsx` § "optimistic bubble seeding (Phase 50 Plan 03 Task 2)" (L1754+) covers the compose-side unit tests; extend for attachment path.

</code_context>

<specifics>
## Specific Ideas

- **Ashley's verbatim rule (2026-09-07):** *"if it comes out of the compose box, it should have an optimistic bubble... anything at all in the compose box sends a message into the compose box of the harness, then it should have an optimistic bubble."* Any send trigger the compose box exposes gets a bubble; non-send actions don't.
- **Ashley's verbatim on failure-path (2026-09-07):** *"we are not making any attempt to make that part easy or easier in this chunk of work."* No preservation of staged files, no retry-easier affordance, no auto-repopulate — the red bubble is the record.
- **Ashley's verbatim on upload-progress-in-pending-bubble (2026-09-07):** *"I was hoping for the upload progress to not be changed from how it is now, and when they finish, that's when the optimistic bubble comes up, and so the files would have already been uploaded by then."* This locks the seed timing at upload-complete (D-02), not Send press. Compose chips' current upload-progress rendering is untouched.

</specifics>

<deferred>
## Deferred Ideas

- **Preserving staged files across a failed attachment send so retry doesn't require re-attaching.** Explicitly scoped out of this phase per Ashley 2026-09-07. Belongs in a follow-on phase if retry friction becomes a real complaint.
- **Upload-progress rendering inside the pending bubble** (Shape Y from the /open discussion). Rejected — compose chips carry upload progress, the pending bubble is for the after-upload window only. Not adding.
- **Retry affordance / one-click resend for failed attachment bubbles.** Same class as the preservation deferral above.
- **Refactoring queue-slot text sends to route through `useComposeSend` funnel** (as opposed to duplicating the seed-and-dispatch primitive inline). Either shape closes the gap; planner picks. If duplication ends up ugly, a follow-on refactor phase could consolidate.
- **Non-send compose actions producing bubbles** (interrupt, etc.). Explicitly scoped out — Ashley's rule is "sends → bubble" only.

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 81-optimistic-bubble-for-every-compose-box-send*
*Context gathered: 2026-09-07*
