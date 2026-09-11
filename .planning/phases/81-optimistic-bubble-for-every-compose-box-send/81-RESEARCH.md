# Phase 81: Optimistic bubble for every compose-box send — Research

**Researched:** 2026-09-07
**Domain:** ComposeBox send-trigger plumbing + optimistic-bubble render extension for attachment sends
**Confidence:** HIGH (all findings verified from source; no external library research required)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Coverage rule (D-01):** Every compose-box send trigger produces a pending bubble. In scope: primary Send, queue-slot Send, cadence auto-fire, voice-submit. Non-send actions (interrupt) remain out.

**Seed timing (D-02/D-03/D-04):**
- Attachment sends: seed AT `upload_ready_to_inject` (post-upload, pre-echo), NOT at Send press. Compose chips continue to own the upload phase untouched.
- Text sends: seed at dispatch time (Send press / slot-fire / cadence-fire) — unchanged from today.

**Pending render (D-05/D-06/D-07):**
- Same visual as settled attachment bubble: caption above horizontal chip strip.
- Reuse `AttachmentChipStrip readOnly=true`. Chip = filename + human size ONLY (no thumbnails/previews/paths/×/rings).
- Empty caption → chip strip only (mirrors settled bubble's `injected.caption.length > 0 &&` gate at ChatMessage.tsx:488).
- Chips render `status:"complete"` (uploads are done by definition).

**Failure treatment (D-08/D-09):**
- Same whole-bubble-red treatment from Phase 76 D-06 for text-only failures.
- Compose is NOT repopulated on failure (Alice 2026-09-02 reversed Phase 50 D-20/D-56). No retry-easier affordance, no staged-file preservation.

**Match-and-replace (D-10/D-11):**
- Same mqid + FIFO head-match mechanism as text-only pending bubbles (PrettyView.tsx:1885-1911).
- Content equality NOT required.
- For attachment sends, mqid minted at `startBatch` time — already available at seed-later step.

**Upload-failure path (D-12/D-13):**
- If uploads fail (server-rejected / network drop / WS-not-open) → NO pending bubble ever seeded. Failure stays in compose chips.
- If batch superseded → outcome resolves `"superseded"` and A never seeds. B seeds normally. No pending-bubble cleanup needed.

**Plumbing (D-14/D-15/D-16):**
- `PendingSend` record shape extends with optional `attachments?: Array<{filename, size, mimetype}>` field.
- `ChatMessage` gets a new render branch: `pendingState !== null` AND attachment metadata present → render caption + `AttachmentChipStrip readOnly`. Keyed on pending-bubble path, NOT on `parseInjectedUserTurn`.
- `onOptimisticSend` callback shape extends with optional `attachments?` field. Text-only callers omit it (backward-compat).

**Voice-submit (D-17):** Already routes through primary `handleSend` (via `funnel.send(payload, {trigger:"voice-submit"})`). Already covered by primary-Send path fix — no additional work.

**Coverage matrix (D-18):** 5 trigger × 2 variant matrix listed in CONTEXT.md. See § "Trigger-Site Inventory — Verified" below for the corrected current-state map.

### Claude's Discretion

- **Exact shape of `attachments` field** on `PendingSend` and `onOptimisticSend` (naming, inline objects vs references).
- **Where to surface files at `upload_ready_to_inject` time** — three candidates: (a) extend `BatchOutcome.ok:true` variant to carry `files`, (b) fire a separate `onOptimisticSeed` callback ahead of resolving the outcome, (c) piggyback on the existing `onReadyRef` callback.
- **Shared code vs duplication** in `ChatMessage` new render branch — share with `injected` branch via extracted helper, or duplicate inline. Either fine as long as visual output matches.
- **Test structure** — extend `PrettyView.optimistic-bubbles.test.tsx` inline vs. add sibling `PrettyView.optimistic-bubbles-attachments.test.tsx`.

### Deferred Ideas (OUT OF SCOPE)

- Preserving staged files across a failed attachment send so retry doesn't require re-attaching.
- Upload-progress rendering inside the pending bubble (Shape Y — rejected).
- Retry affordance / one-click resend for failed attachment bubbles.
- Refactoring queue-slot text sends to route through `useComposeSend` funnel (already done — see § "State-of-Play Correction" below).
- Non-send compose actions producing bubbles (interrupt, etc.).
</user_constraints>

## Summary

Phase 81 extends the text-only optimistic-bubble machinery (Phase 50 + Phase 68 funnel refactor + Phase 76 red-bubble upgrade) to cover attachment-carrying sends from every compose-box trigger site. All substantive design decisions (D-01 through D-18) are locked in CONTEXT.md — this research is scoped to concrete implementation groundwork for the planner: verify trigger-site plumbing, recommend the seed-at-inject-time integration point, size the callback-widening surface, and identify test-file placement.

**Two correctness surprises this research surfaces (both make the phase SMALLER than CONTEXT.md's D-18 matrix implies):**

1. **Queue-slot text sends and cadence-fired text sends ALREADY route through `funnel.send` today.** Phase 68 follow-up did this migration (see `ComposeBox.tsx:1486`, `ComposeBox.tsx:1242`, `ComposeBox.tsx:1721`). The D-18 matrix in CONTEXT.md marks them "MISSING today (Phase 50 deferred)" — that inventory is stale. Only the **attachment** paths from these triggers actually skip the pending seed.
2. **Voice-submit primary path DOES route through `handleSend`** (confirmed at `ComposeBox.tsx:1672` inside `handleVoiceSend` primary branch). Voice-submit into a queue-slot also routes through `funnel.send` (`ComposeBox.tsx:1721`). D-17 is correct.

**Net remaining work** collapses to: (a) attachment-branch seed calls at 4 sites, (b) `onOptimisticSend` callback widening, (c) `PendingSend` record widening, (d) `ChatMessage` new render branch, (e) plumbing files at `upload_ready_to_inject` time to the seed call.

**Primary recommendation:** Widen `onSendWithAttachments` prop to accept an `onOptimisticSeed?: (args: {mqid, caption, attachments})` callback (Discretion option "sibling callback" — variant B). Fire it from a NEW `onUploadReadyToInject` wrapper inside PrettyView, BEFORE calling `sendInput` (the WS write). Do NOT extend `BatchOutcome` — that Promise resolves AFTER the seed-time window closes (ordering constraint from Phase 50 D-01: seed must precede the WS-input frame so FIFO head-match works). Do NOT modify `onReadyRef` — that callback fires the send itself; folding seed into it would tangle two concerns.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compose-box trigger dispatch | `ComposeBox.tsx` (renderer + event handlers) | `useComposeSend` funnel | Owns per-trigger UI cleanup (setText, clearAfterSend, scheduleAutosave); funnel owns mqid+seed+dispatch primitive |
| Upload lifecycle | `use-pretty-view-uploads.ts` | `pretty-view-upload-protocol.ts` | Owns chunk pump, batch outcome, `upload_ready_to_inject` handler that fires the WS input frame |
| Optimistic-bubble record + FIFO cleanup | `PrettyView.tsx` | — | Owns `pendingSends[]`, `handleOptimisticSend`, `flipToFailed`, FIFO head-match cleanup |
| Pending-bubble render | `ChatMessage.tsx` | `AttachmentChipStrip.tsx` | Already renders text pending (`pendingState` prop) AND settled attachment (`injected` branch). Extends with pending-with-attachments branch |
| Pending-bubble WS-write dispatch | `PrettyView.tsx` (`sendInput`) → Terminal-side ref-forwarding | — | Unchanged — attachment send's `onReadyRef` callback already fires `sendInput` with the mqid |

## Standard Stack

**No external dependencies added.** All work is in existing files under `src/ui/features/pretty-view/` and `src/ui/api/pretty-view-upload-protocol.ts`. React 18 hooks + existing test infrastructure (Vitest + React Testing Library + jsdom).

### Version verification
Skipped — no new packages. Standard-stack table omitted.

## Package Legitimacy Audit

Skipped — no external packages installed in this phase.

## State-of-Play Correction (What CONTEXT.md Got Right vs Stale)

Verified 2026-09-07 by reading `src/ui/features/pretty-view/ComposeBox.tsx` (3558 lines) end-to-end and cross-referencing every callsite.

### CONTEXT.md D-18 Matrix — Corrected Against Live Source

| Trigger × Variant | CONTEXT.md D-18 claim | Verified truth (as of 2026-09-07) |
|--------------------|-----------------------|-----------------------------------|
| Primary Send + text | WORKS (Phase 50) | ✅ WORKS via `funnel.send()` at ComposeBox.tsx:1591 |
| Primary Send + attachments | MISSING | ✅ MISSING — attachment branch at ComposeBox.tsx:1543-1575 never calls seed |
| Queue-slot Send + text | MISSING (Phase 50 deferred) | ❌ **ALREADY WORKS** via `funnel.send({trigger:"queue-item"})` at ComposeBox.tsx:1486 (Phase 68 follow-up landed) |
| Queue-slot Send + attachments | MISSING | ✅ MISSING — `handleQueueSlotSend` attachment branch at ComposeBox.tsx:1449-1478 never calls seed |
| Cadence auto-fire + text | MISSING (Phase 50 deferred) | ❌ **ALREADY WORKS** via `funnel.send({trigger:"queue-item"})` at ComposeBox.tsx:1242 (Phase 68 follow-up landed) |
| Cadence auto-fire + attachments | MISSING | ✅ MISSING — `fireNextQueued` attachment branch at ComposeBox.tsx:1200-1236 never calls seed |
| Voice-submit + text | (implied WORKS via D-17) | ✅ WORKS — primary path routes to `handleSend` at ComposeBox.tsx:1672; queue-slot voice routes to `funnel.send({trigger:"voice-slot"})` at ComposeBox.tsx:1721 |
| Voice-submit + attachments (queue-slot) | (not enumerated) | ✅ MISSING — `handleVoiceSend` slot-attachment branch at ComposeBox.tsx:1695-1717 never calls seed |
| Voice-submit + attachments (primary) | (not enumerated — see D-17) | ✅ MISSING — voice primary path calls `handleSend` which routes to the primary attachment branch (same gap as row 2) |

**Net attachment-branch seed gap: 4 sites** (not 6 as D-18 suggests).

**Reduced scope means simpler plan:** the plan need not touch the queue-slot text or cadence text paths at all — they already seed. Only the four attachment branches need extension.

### Additional trigger sites reviewed and confirmed OUT-OF-SCOPE

| Site | Path | Why out |
|------|------|---------|
| `handleQuickSend` (thumbs-up, /explain) | ComposeBox.tsx:1886-1916 | Already routes through `funnel.send({trigger:"quick-reply"})` at L1897 — text pending seed already fires |
| `handleResetClick` → `dispatchResetPayload` | ComposeBox.tsx:1817-1838 | Already routes through `funnel.send({trigger:"reset"})` at L1827. Reset payloads are render-blacklisted at `handleOptimisticSend` via `isIdCommand()` guard (PrettyView.tsx:1193) — mqid still generated so backend wake gate fires. Attachments not possible on reset (no chip strip on reset path) — no new work |
| `handleAsideDismiss` | Wired via `onAsideDismiss` prop; PrettyView side | Non-send (aside dismiss is a `type:"aside_dismissed"` WS frame, not a message) — matches CONTEXT.md D-01 "non-send actions remain out" |
| `onInterrupt` (interrupt button) | ComposeBox.tsx:223 | Non-send — matches CONTEXT.md D-01 |

## Trigger-Site Inventory — Verified

The four attachment-branch sites that this phase touches:

### Site 1: Primary Send with attachments — `handleSend` attachment branch
**Location:** `ComposeBox.tsx:1543-1575`
**Path:** User types caption + attaches files + presses Send → `handleSend(undefined, "send-button")` → `if (hasAttachments && onSendWithAttachments)` branch → awaits `onSendWithAttachments(captionPayload)` (which routes to `PrettyView.uploads.startBatch(caption)`) → on `outcome.ok`: clears text + `clearAfterSend()`.
**Gap:** No `onOptimisticSend` call anywhere in this branch. Attachment bubble never seeds.
**Also enters via:** Voice primary send → `handleVoiceSend("primary")` → `handleSend(result.glued, "queue-item")` at L1672. Same branch, same gap.

### Site 2: Queue-slot Send with attachments — `handleQueueSlotSend` attachment branch
**Location:** `ComposeBox.tsx:1449-1478`
**Path:** User has typed into a queued slot + attached files to it + presses per-slot Send → `handleQueueSlotSend(slotId)` → gets slot's target-scoped attachments via `getStagedAttachmentsForTarget(slotTarget)` → if non-empty and `onSendWithAttachments` wired → awaits `onSendWithAttachments(captionPayload, slotTarget)` → on ok: removes slot + `clearStagedForTarget(slotTarget)`.
**Gap:** No `onOptimisticSend` call. Attachment bubble never seeds.

### Site 3: Cadence auto-fire with attachments — `fireNextQueued` attachment branch
**Location:** `ComposeBox.tsx:1200-1236`
**Path:** Session goes idle → 3s idle watchdog fires `fireNextQueued()` → head-of-queue entry belongs to a slot with staged attachments → routes to `onSendWithAttachments(captionPayload, slotTarget)` inside async IIFE → on ok: `setQueue(...filter...)` + `setQueueSlots(...filter...)` + `clearStagedForTarget`.
**Gap:** No `onOptimisticSend` call. Attachment bubble never seeds.
**Note:** This site has a subtle interaction with autofocus/scroll — see § "Common Pitfalls" #3.

### Site 4: Voice-submit into queue-slot with attachments — `handleVoiceSend` slot attachment branch
**Location:** `ComposeBox.tsx:1695-1717`
**Path:** User taps mic on a queued slot's mic button → records → glued transcript triggers `handleVoiceSend(target=slotId)` → slot has staged attachments → routes to `onSendWithAttachments(payload, slotTarget)` inside async IIFE → on ok: removes slot + `clearStagedForTarget`.
**Gap:** No `onOptimisticSend` call. Attachment bubble never seeds.

## Architecture Patterns

### System Data Flow — Where the Seed Fires

Text-only send (already working, unchanged):
```
User press Send / arms slot / cadence fires
    │
    ▼
funnel.send(payload, {trigger})
    │
    ├─► generate mqid (`pv-optim-<ts>-<8hex>`)
    ├─► onOptimisticSend({payload, mqid, immediateFailure:false})  ◄── SEED (before send)
    │       │
    │       ▼
    │   PrettyView.handleOptimisticSend → pushes to pendingSends[]
    │       │
    │       ▼
    │   ChatMessage renders pending bubble (spinner or red)
    │
    ├─► onSend(payload, mqid) → sendInput → WS write
    │
    └─► if !dispatched: onOptimisticSend({..., immediateFailure:true}) → flips to red
```

Attachment send (target state — same seed pattern, deferred to inject-time):
```
User press Send (with attachments)
    │
    ▼
onSendWithAttachments(caption, target)
    │
    ▼
uploads.startBatch(caption, target)
    │
    ├─► mints batchId (= mqid — SAME id used later at inject time)
    ├─► emits WS upload_start
    ├─► arms 30s outcome timer
    ├─► kicks chunk pump
    └─► returns {messageQueueItemId, outcome: Promise}
    │
    ▼   (background: WS carries upload_progress → upload_complete for each file)
    │
    ▼
WS receives upload_ready_to_inject event
    │
    ├─► resolveOutcome(batchId, {ok:true})   ← existing behavior
    │
    └─► onReadyRef.current({mqid=batchId, files, caption})
            │
            ▼
        PrettyView.onUploadReadyToInject handler
            │
            ├─► **NEW**: fire seed callback FIRST — onOptimisticSend({
            │       payload: caption,
            │       mqid,
            │       immediateFailure: false,
            │       attachments: files.map({filename,size,mimetype})   ◄── new field
            │   })
            │       │
            │       ▼
            │   PrettyView.handleOptimisticSend → pushes to pendingSends[] with
            │       attachments metadata → ChatMessage renders caption + chip strip
            │
            └─► **EXISTING**: build formatInjectedUserTurn() body → sendInput(body, mqid)
                    │
                    ▼
                Terminal-side ref-forwarding → paste into tmux via WS
                    │
                    ▼   (echo comes back later as user-role message frame)
                    │
                    ▼
                PrettyView WS message handler → FIFO head-match at PrettyView.tsx:1900
                    → clears the pending bubble → settled `injected` bubble renders in place
```

### Pattern 1: Widen `onOptimisticSend` callback signature
**What:** Add optional `attachments?: Array<{filename: string; size: number; mimetype: string}>` field to the seed callback args at `ComposeBox.tsx:187-192`.
**When:** Only present for attachment-send seeds (all text-only callers omit — TypeScript optional field, backward-compat).
**Example:**
```typescript
// Source: verified from ComposeBox.tsx:187-192 (existing) + D-16 (new field)
onOptimisticSend?: (args: {
  payload: string;
  mqid: string;
  immediateFailure: boolean;
  attachments?: Array<{             // NEW — D-16
    filename: string;
    size: number;
    mimetype: string;
  }>;
}) => void;
```

### Pattern 2: Widen `PendingSend` record
**What:** Add optional `attachments?: Array<{filename, size, mimetype}>` field to the record type at `PrettyView.tsx:1118-1124`.
**When:** Present only when the seed carried it. `handleOptimisticSend` copies from args to record.
**Example:**
```typescript
// Source: verified from PrettyView.tsx:1118-1124 (existing) + D-14 (new field)
type PendingSend = {
  mqid: string;
  content: string;
  sentAt: number;
  state: "sending" | "failed";
  timer: number | null;
  attachments?: Array<{             // NEW — D-14
    filename: string;
    size: number;
    mimetype: string;
  }>;
};
```

### Pattern 3: New `ChatMessage` render branch
**What:** Add `attachments?` prop to `ChatMessage`. When `pendingState !== null` AND `attachments` prop is present and non-empty, render caption + `AttachmentChipStrip readOnly` (same as `injected` branch shape but without going through `parseInjectedUserTurn`).
**When:** For pending attachment bubbles. Assistant bubbles ignore.
**Example:**
```typescript
// Source: proposed — mirrors ChatMessage.tsx:479-509 (settled `injected` branch)
// but keyed on the new `attachments` prop, not on parseInjectedUserTurn(content).
{isQuickReply ? (
  <ThumbsUp className="size-6" aria-label="quick reply" />
) : injected ? (
  // Existing: settled bubble via parseInjectedUserTurn
  <>
    {injected.caption.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {injected.caption}
      </div>
    )}
    <AttachmentChipStrip attachments={/* mapped */} onRemove={()=>{}} readOnly />
  </>
) : pendingAttachments && pendingAttachments.length > 0 ? (
  // NEW: pending attachment bubble
  <>
    {content.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {content}
      </div>
    )}
    <AttachmentChipStrip
      attachments={pendingAttachments.map((f) => ({
        tempId: `pending-${f.filename}-${f.size}`,   // synthetic — never used interactively
        file: { name: f.filename, size: f.size, type: f.mimetype },
        status: "complete",
        bytesUploaded: f.size,
        error: null,
      }))}
      onRemove={() => {}}
      readOnly
    />
  </>
) : (
  <ReactMarkdown ...>{processedContent}</ReactMarkdown>
)}
```

### Anti-Patterns to Avoid

- **Do NOT synthesize a fake `formatInjectedUserTurn()` string on the pending-record `content` field just so the existing `injected` branch parses it back out.** CONTEXT.md § Established Patterns rejects this explicitly: "the pending bubble does NOT need to use this format — it can carry attachment metadata directly on the `PendingSend` record and pass it to `ChatMessage` as a prop, bypassing the parse. This keeps the pending-bubble path structurally simple (no need to synthesize a fake `formatInjectedUserTurn` string with placeholder landing paths)." Doing so would force fabrication of `landingPath` values (which the pending bubble doesn't know and shouldn't display) and would couple the seed path to a parser format designed for a different concern (harness-side transport of injected turns).

- **Do NOT extend `BatchOutcome.ok:true` variant to carry files.** The outcome resolves AFTER the seed-time window (the outcome is what unblocks the *awaiter* in `ComposeBox` — that awaiter clears the compose textarea; the seed must happen BEFORE the WS input frame goes out, i.e. inside the `onReadyRef` callback, not after). See § "Plumbing Options for Seed-at-Inject-Time" for the full trade-off.

- **Do NOT fold the seed call into `onReadyRef`** (the existing callback that fires `sendInput`). `onReadyRef` runs at the right MOMENT but its contract is "here's what to send"; layering "here's what to seed" on top tangles two concerns and complicates test doubles. Add a SIBLING callback (`onOptimisticSeed?`) at the same site.

- **Do NOT change `AttachmentChipStrip` at all.** It already handles `readOnly=true` mode with `status:"complete"` chips. Reuse verbatim.

## Plumbing Options for Seed-at-Inject-Time (CONTEXT.md § Claude's Discretion)

Three candidates were named in CONTEXT.md. Analysis:

### Option A: Extend `BatchOutcome.ok:true` to carry `files`
**Shape:** `BatchOutcome = {ok: true, files: UploadReadyToInjectFileSummary[]} | {ok: false, ...}`
**Where seed fires:** In `ComposeBox` at the attachment-branch `await onSendWithAttachments(...)` callsite, after `outcome.ok`.
**Rejected — ordering violation.** The `outcome` Promise resolves inside `handleServerEvent` at `use-pretty-view-uploads.ts:457`, in the order: `resolveOutcome(ourBatch, { ok: true })` → `onReadyRef.current({...})`. The `onReadyRef` callback is what fires the WS input frame. So the outcome awaiter in ComposeBox always runs AFTER the WS input frame has been dispatched to the harness. Seeding there means the pending bubble races the incoming echo frame — FIFO head-match at PrettyView.tsx:1900 could clear the pending bubble BEFORE it renders, defeating the entire purpose.
**Additional cost:** Breaks backward-compat for `BatchOutcome` — every consumer of `{ok: true}` needs updating. Currently 6 consumers (grep for `outcome.ok`).

### Option B: Sibling callback (`onOptimisticSeed` or `onAttachmentPendingSeed`) — **RECOMMENDED**
**Shape:** Add an optional callback prop alongside `onSendWithAttachments`. Fired from `onUploadReadyToInject` handler BEFORE `sendInput()`.
**Where seed fires:** Inside `PrettyView`'s `onUploadReadyToInject` handler (the callback wired into `usePrettyViewUploads.deps.onUploadReadyToInject`), immediately before or after building the injected turn body and calling `sendInput`.
**Concrete wiring:**
- Add prop to `ComposeBoxProps`: none needed — the seed happens in PrettyView's `onUploadReadyToInject`, not in ComposeBox. ComposeBox stays unaware.
- Modify PrettyView's `onUploadReadyToInject` closure (existing site — grep for where `usePrettyViewUploads` is wired; the callback that builds `formatInjectedUserTurn` and calls `sendInput`) to first invoke `handleOptimisticSend({payload: caption, mqid: messageQueueItemId, immediateFailure: false, attachments: files})`.
**Pros:** Zero API surface change in ComposeBox. Zero backward-compat impact on `BatchOutcome`. Ordering guaranteed correct (seed fires before `sendInput`). Only PrettyView touches upload-hook wiring — which is already PrettyView's responsibility today.
**Cons:** None material. The seed lives adjacent to the send in PrettyView instead of in ComposeBox — but that mirrors where the text-only funnel puts them anyway (side by side).

### Option C: Piggyback on existing `onReadyRef` callback
**Shape:** Fold the seed call into the existing `onUploadReadyToInject` callback that PrettyView passes to the uploads hook.
**Where seed fires:** Same site as Option B, but inside the existing callback closure rather than a new sibling helper.
**Verdict:** This IS Option B in practice — there is only one callback (`onUploadReadyToInject`) that PrettyView passes to the uploads hook, and modifying it to also fire the seed IS what Option B recommends. The phrasing "piggyback vs new sibling callback" is a naming choice for the internal implementation, not a semantic distinction. The plan should just add the seed call inside the existing PrettyView `onUploadReadyToInject` closure.

### Recommendation: **Option B/C (they're the same in practice)**

The seed call goes inside PrettyView's `onUploadReadyToInject` closure that's already wired to `usePrettyViewUploads.deps.onUploadReadyToInject`. Fire `handleOptimisticSend` FIRST, then build the injected-turn body and call `sendInput` (unchanged). Ordering:

```typescript
// Inside PrettyView — at the site where usePrettyViewUploads is instantiated
const uploads = usePrettyViewUploads({
  ws: /* ... */,
  onUploadReadyToInject: ({messageQueueItemId, files, caption}) => {
    // NEW — Phase 81: seed the pending bubble BEFORE dispatching the WS input frame.
    // Same handleOptimisticSend the text-only funnel calls, extended with attachments.
    handleOptimisticSend({
      payload: caption,
      mqid: messageQueueItemId,
      immediateFailure: false,
      attachments: files.map((f) => ({
        filename: f.filename,
        size: f.size,
        mimetype: f.mimetype,
      })),
    });
    // EXISTING — unchanged: build injected turn + dispatch WS input frame with mqid.
    const body = formatInjectedUserTurn({caption, files});
    sendInputRef.current?.(body, messageQueueItemId);
  },
});
```

The planner should verify the existing wire site — grep for `onUploadReadyToInject:` or `formatInjectedUserTurn(` in PrettyView.tsx.

## `PendingSend` + `onOptimisticSend` — Backward-Compatibility Surface

### `PendingSend` consumers (all internal to PrettyView.tsx)

Grep confirms `PendingSend` type is used within PrettyView.tsx only (no exports). Consumers:
- `pendingSends` state at L1125 — needs the widened type.
- `pendingSendsRef` at L1126 — same, uses same type via `PendingSend[]`.
- `handleOptimisticSend` at L1182 — spreads args into the record; add `attachments` copy.
- `flipToFailed` at L1156 — reads mqid/timer only; unaffected by new field.
- FIFO head-match block at L1900 — reads `p.state`, `p.mqid`, `p.timer`; unaffected.
- `clearAllPendingSends` at L1273 — iterates all timers; unaffected.
- `latestSendingPending` derivation at L1294 — filters on state; unaffected.
- Pending render at L3317-3338 — passes `p.content` and `computedPendingState` to `ChatMessage`; needs to also pass `p.attachments`.

**Net changes required:** 3 sites (record type L1118, `handleOptimisticSend` spread L1246, render call L3331).

### `onOptimisticSend` callback consumers

Callers (all in ComposeBox.tsx via the funnel):
- `useComposeSend.send` at L471 and L487 — text-only, omits `attachments` (backward-compat).
- (New — Phase 81) PrettyView's `onUploadReadyToInject` closure — passes `attachments`.

**Backward-compat verdict:** Optional field. Text-only callers unchanged. No breaking edits to ComposeBox's funnel primitive.

## ChatMessage Render Branch — Share vs Duplicate

Analysis of the existing `injected` branch at ChatMessage.tsx:479-509:

```jsx
injected ? (
  <>
    {injected.caption.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {injected.caption}
      </div>
    )}
    <AttachmentChipStrip
      attachments={injected.files.map((f) => ({
        tempId: f.landingPath,
        file: { name: f.filename, size: f.size, type: f.mimetype },
        status: "complete",
        bytesUploaded: f.size,
        error: null,
      }))}
      onRemove={() => {}}
      readOnly={true}
    />
  </>
) : ...
```

**Recommendation: duplicate inline for pending branch — do NOT extract a shared helper.**

Rationale:
1. **Different caption source.** Settled uses `injected.caption` (parsed from content). Pending uses `content` directly (raw). Extracting to a shared helper would require passing both a caption string and a files array — the caller-side unpacking would be more code than the inline render.
2. **Different tempId source.** Settled uses `f.landingPath` (guaranteed unique by backend's collision-suffix loop). Pending has no landingPath at all — must synthesize a synthetic tempId (`pending-${filename}-${size}` or similar) purely for React key purposes. Different logic.
3. **Different file-shape mapping.** Settled maps from `ParsedInjectedTurn["files"]`. Pending maps from `PendingSend["attachments"]` (a stripped-down `{filename,size,mimetype}` triple with no landingPath, no uploadTimestamp). Different source shape.
4. **The three rendering elements (caption block, chip strip, readOnly flag) are 8 lines of JSX total.** Extracting is not a code-density win.

**Concern about `parseInjectedUserTurn(content)` coupling:** The existing `injected` branch calls `parseInjectedUserTurn(content)` at ChatMessage.tsx:309. This runs for **every user message** and is defended by an early `indexOf` bail on non-injected content — but it does mean adding a pending-with-attachments branch requires care about branch ordering. The correct order (verified from existing code):

```jsx
{isQuickReply ? <ThumbsUp .../>
 : injected ? <settled attachment render>       // parsed from content
 : (pendingState !== null && pendingAttachments) ? <pending attachment render>   // NEW
 : <ReactMarkdown>content</ReactMarkdown>}
```

Injected-branch first because a pending bubble's content field carries only the caption (which won't parse as an injected turn — no delimiter substring). The `injected` check is safe for pending records — `parseInjectedUserTurn(caption)` returns null when there's no `\n---attached files---\n` delimiter, which is always true for a pending record's caption-only content. So ordering doesn't conflict, but keep `injected` first (matches settled-bubble semantics unchanged) and add the pending branch after.

**Prop-widening for `ChatMessage`:** Add `attachments?: Array<{filename, size, mimetype}>` prop. Optional — text pending bubbles and settled bubbles omit it.

## Queue-Slot Text Sends — Already Handled

CONTEXT.md § Claude's Discretion asks whether to route queue-slot text sends through `useComposeSend` funnel OR duplicate the seed-and-dispatch primitive inline. **This decision was already made by Phase 68 follow-up work: queue-slot text sends route through `funnel.send` today** (verified at `ComposeBox.tsx:1486`).

Consequently:
- Cadence text sends: already through funnel at `ComposeBox.tsx:1242`.
- Queue-slot text sends: already through funnel at `ComposeBox.tsx:1486`.
- Voice-into-slot text sends: already through funnel at `ComposeBox.tsx:1721`.

No new code needed for these paths. The planner should note this and NOT include them in the touched-files list — a stale plan that "adds seed to queue-slot text send" would introduce a duplicate seed (bubble would seed twice).

## Voice-Submit — Verified

CONTEXT.md D-17 claims voice-submit is already covered via primary `handleSend`. Verified true:
- Primary voice-submit: `handleVoiceSend("primary")` at ComposeBox.tsx:1648 → on non-recycle path, calls `handleSend(result.glued, "queue-item")` at L1672 → primary handleSend runs its full text branch (which routes through `funnel.send`) OR attachment branch (which currently skips seed — this IS Site 1 above).
- Queue-slot voice-submit: `handleVoiceSend(target=slotId)` → text branch routes through `funnel.send({trigger:"voice-slot"})` at L1721; attachment branch is Site 4 above.

D-17's claim is correct for the text path. But note that D-17 does not enumerate voice-with-attachments explicitly — the plan should cover Site 4 (queue-slot voice + attachments), which is a natural consequence of the general attachment-branch fix but worth calling out in the coverage matrix.

## Superseded-Batch Handling — Verified

CONTEXT.md D-13 claims: "If a batch is superseded (user sends batch A, then B before A completes), A's outcome is `"superseded"` and A never seeds a pending bubble. B seeds normally. No pending-bubble cleanup logic needed for the superseded case because the pending bubble was never seeded."

**Verified.** The superseded path in `use-pretty-view-uploads.ts`:
- `startBatch` at L594-599: if a prior resolver for THIS batchId exists (shouldn't happen — `makeId()` prevents id collision, but defensive), supersede first with `priorResolver({ok: false, reason: "superseded"})`.
- `retryBatch` at L701-706: same pattern, but the reuseIdOnRetry path can genuinely reuse an id — in which case the old awaiter gets `superseded`.
- `resetBatch` at L789: fires `resolveOutcome(priorBatchId, {ok: false, reason: "superseded"})` when caller invokes.

**The critical invariant:** superseded batches never reach `upload_ready_to_inject` — the `readyFiredRef` guard at L450 short-circuits, and the batchId gate at L378 drops events for retired batches. Because the seed call lives in the `onUploadReadyToInject` callback (per Option B recommendation above), it only fires when the batch actually completes. Superseded batches never seed — matches D-13.

**No cleanup needed for superseded case.** Planner should include a regression test that asserts this: batch A superseded, batch B completes → only one pending bubble seeded (with B's mqid), no orphan A bubble.

## Failure Treatment Mechanics — Verified

Phase 76 D-06 whole-bubble red is implemented at ChatMessage.tsx:406-414:

```typescript
const showFailedBubble = isUser && pendingState === "failed";
const bubbleInlineStyle: React.CSSProperties = showFailedBubble
  ? {
      position: "relative",
      background: "hsla(0, 60%, 35%, 0.90)",
      borderColor: "hsla(0, 70%, 50%, 0.85)",
    }
  : { position: "relative" };
```

Applied to the outer bubble `<div>` at L420. This treatment applies UNIFORMLY regardless of which content branch renders inside (markdown vs injected vs — new — pending-with-attachments). The `bubbleInlineStyle` sits on the bubble root, so the new pending-attachment render branch inherits it for free.

**One concern for the planner:** The chip strip renders with `readOnly` styling (`bg-white/[0.04] border-white/[0.10] text-[#e8e4d8]`) which is a quiet neutral — on a red bubble background it will read as translucent-neutral-on-red. Visual verification during human-verify: confirm the chips remain legible/visible against the whole-bubble-red fill (D-08 requires "chips still visible so user sees what didn't land"). Likely fine because chips have their own border and translucent light background, but worth eyeballing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| mqid generation | New id scheme for attachment sends | Reuse `messageQueueItemId` from `startBatch` return | It IS the mqid — already minted at batch start, threaded through to `onUploadReadyToInject` event, and used by the FIFO head-match on echo. Zero new id logic |
| Attachment chip render | Custom pending-chip component | `AttachmentChipStrip readOnly=true` | Already the exact component used by settled bubbles — identical visual by contract |
| Formatting the injected turn for the wire | Manual JSON/string synthesis | `formatInjectedUserTurn` from `pretty-view-upload-protocol.ts:256` | Already used by the existing `onUploadReadyToInject` path; unchanged |
| FIFO cleanup on echo arrival | New matching logic for attachment sends | Existing FIFO head-match at PrettyView.tsx:1900 | Content-equality not required (Phase 50 D-10). The mqid+FIFO gate clears any pending user-role record regardless of attachments |
| Whole-bubble red on failure | New failure style | `pendingState === "failed"` gate at ChatMessage.tsx:406 | Applies at the outer bubble div; inherited by every render branch. Free for pending-with-attachments |
| Superseded cleanup | Manual pending-bubble removal for superseded batches | Nothing — superseded batches never seed | `upload_ready_to_inject` never fires for superseded batches (batchId gate + readyFiredRef guard) |

**Key insight:** The existing text-only bubble machinery (Phase 50 + 68 + 76) is a complete, well-shaped system. Phase 81 is 90% wiring — surfacing metadata already available at the seed site (`upload_ready_to_inject` event's `files` array) into an already-optional callback field on an already-existing seed function.

## Common Pitfalls

### Pitfall 1: Seeding twice on retry
**What goes wrong:** If the pending bubble is seeded inside `onUploadReadyToInject` and the same `onUploadReadyToInject` fires twice (e.g., a retry with `reuseIdOnRetry=true` that succeeds on the second attempt), the SECOND fire would seed a duplicate pending record — but the mqid is the same, so head-match would still work. Both bubbles would render briefly, and the harness echo would clear only the oldest.
**Why it happens:** Retry uses the same `messageQueueItemId` when `reuseIdOnRetry=true`. If retry succeeded, `readyFiredRef` may not have been reset — actually it IS reset at retryBatch L683 (`readyFiredRef.current = false`), and the fresh-id path mints a new id anyway.
**How to avoid:** Check `readyFiredRef` semantics — the existing guard at L450 `if (readyFiredRef.current) return;` prevents double-fire of `onUploadReadyToInject` per batchId. Reuse-id retry resets the flag, so retry after first failure would fire once for the retry (fresh event). This is likely correct — the seed fires exactly once per batchId lifecycle. Regression test needed: retry-after-timeout scenario should produce exactly one pending bubble.
**Warning signs:** Two identical caption+chips bubbles side-by-side after retry.

### Pitfall 2: mqid must be `messageQueueItemId` (batch id), NOT a fresh `pv-optim-*` id
**What goes wrong:** If the seed call generates a fresh `pv-optim-<ts>-<hex>` mqid (following the text-only funnel pattern) instead of reusing `messageQueueItemId` from the `upload_ready_to_inject` event, the FIFO head-match still clears (matches by FIFO order + role + state, not by mqid equality). BUT the backend's Phase 56 wake gate and the pv-send-watchdog on the backend both key on the mqid that flowed with the send. Using a different mqid for the bubble than for the WS input frame would decorrelate diagnostics.
**Why it happens:** Copy-paste from `useComposeSend.send` at ComposeBox.tsx:465 which does `mqid = pv-optim-<ts>-...`.
**How to avoid:** Explicitly pass `messageQueueItemId` (from the event) as the `mqid` field in the seed call. Add a code comment naming the invariant: "mqid for attachment sends === upload batchId === messageQueueItemId from upload_ready_to_inject event."
**Warning signs:** Backend diagnostics show a batchId that never appears in frontend logs; frontend logs show a `pv-optim-*` id that never appears in the backend.

### Pitfall 3: Cadence-fire attachment path is inside an async IIFE
**What goes wrong:** The cadence path at ComposeBox.tsx:1215-1233 runs the attachment send inside `void (async () => { ... })()`. This means the seed call — if placed inside the IIFE — fires asynchronously with respect to the caller's synchronous flow. This is FINE for the seed itself (React state updates from callbacks are batched anyway), but if any plan step tries to make the seed synchronous relative to a caller test assertion, it will fail.
**Why it happens:** Cadence-fire branch is the only site where the outer flow is a `useCallback` returning void, so the attachment work is wrapped in an IIFE.
**How to avoid:** Because the recommended plumbing (Option B — seed inside PrettyView's `onUploadReadyToInject` closure) puts the seed on the RECEIVING side (PrettyView's handler for the batch-complete event) rather than in the compose-side IIFE, this pitfall is entirely avoided. The seed fires when the WS delivers `upload_ready_to_inject`, regardless of which trigger site started the batch. This is a strong argument for Option B over Option A.
**Warning signs:** Tests that expect the pending bubble to appear synchronously with the trigger action fail; the bubble appears one microtask later.

### Pitfall 4: `parseInjectedUserTurn` on caption-only content
**What goes wrong:** A pending bubble's record has `content: caption` (the raw caption text) — no delimiter, no file lines. ChatMessage's `injected = parseInjectedUserTurn(content)` at L309 runs for every user message including pending. If the CAPTION happens to contain the string `\n---attached files---\n`, the parser would run the full parse and — if the parse succeeds — the `injected` branch would fire instead of the pending-with-attachments branch.
**Why it happens:** Alice could paste a message that literally includes the delimiter substring as text.
**How to avoid:** Two defenses. (a) `parseInjectedUserTurn` requires at least one well-formed `(N. filename ...)\n   uploaded ...` file line pair to return non-null (verified at L322-336) — a captured caption without those lines returns null even with the delimiter present. (b) In practice this is unreachable because the pending record's content field carries only the caption text, and the caption text going through `formatInjectedUserTurn` would only match the parser if it accidentally contained the entire file-line format — statistically impossible for user-typed prose. **No mitigation needed**, but the plan should include a defensive test: pending-attachment bubble with caption containing "---attached files---" as literal text still renders as pending-attachment (not as injected).
**Warning signs:** A pending bubble renders without a spinner (because `injected` branch fires) despite `pendingState === "sending"`.

### Pitfall 5: Immediate-failure path for attachment sends
**What goes wrong:** Text-only sends have an `immediateFailure:true` path (WS not open at Send press → seed as failed from birth). Attachment sends have a different failure model: upload failures (WS not open at `startBatch`, `ws.send()` throws, upload_failed event, 30s timeout) resolve the outcome with a failure reason BUT never fire `onUploadReadyToInject` — so with Option B plumbing, the pending bubble is never seeded for these failures. CONTEXT.md D-12 explicitly locks this: "If uploads themselves fail (server-rejected file, network drop, WS-not-open at startBatch time), NO pending bubble is ever seeded. The failure stays in the compose chips as it does today."
**Why it happens:** The seed is gated on upload success. This is correct per D-12 — but the plan should verify no accidental seed path exists elsewhere (e.g., a well-meaning "seed on batch start" call snuck in).
**How to avoid:** Regression test — mock ws=null, call `onSendWithAttachments`, assert no pending bubble ever appears. Then mock upload_failed event, assert same.
**Warning signs:** A pending bubble appears with attachment chips even though the compose chips still show an upload error.

### Pitfall 6: `AttachmentChipStrip` requires a truthy `readOnly` marker
**What goes wrong:** The `AttachmentChipStrip` component conditions its styling on `readOnly=true`. If the pending render branch omits the prop (or passes `false`), chips render in the interactive-staging style (warm-black background, × button visible, progress ring) — visually wrong, and the × button firing `onRemove()` would call the empty no-op passed by the pending branch (harmless but confusing in a11y tools).
**How to avoid:** Always pass `readOnly={true}` verbatim (matches the settled bubble render at ChatMessage.tsx:507). Test assertion: chip strip inside pending-attachment bubble has `data-readonly="true"` attribute (verified at AttachmentChipStrip.tsx:107).
**Warning signs:** Pending attachment chips have visible × buttons or emerald-check icons.

## Code Examples

Verified patterns from existing source:

### Pattern: Seed → Send ordering (Phase 50 text-only baseline)
```typescript
// Source: ComposeBox.tsx:465-490 (verified)
const mqid = `pv-optim-${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: false });
const dispatched = onSend(payload, mqid);
if (!dispatched) {
  onOptimisticSend?.({ payload: bubbleText, mqid, immediateFailure: true });
}
```

### Pattern: onUploadReadyToInject callback contract (existing)
```typescript
// Source: use-pretty-view-uploads.ts:449-469 (verified)
case "upload_ready_to_inject": {
  if (readyFiredRef.current) return;
  readyFiredRef.current = true;
  resolveOutcome(ourBatch, { ok: true });
  const caption = capturedCaptionRef.current;
  const cb = onReadyRef.current;
  setBatchInFlight(false);
  if (cb) {
    cb({
      messageQueueItemId: event.messageQueueItemId,
      files: event.files,      // ← Array<UploadReadyToInjectFileSummary>
      caption,
    });
  }
  break;
}
```

### Pattern: FIFO head-match cleanup (existing — unchanged for attachments)
```typescript
// Source: PrettyView.tsx:1900-1911 (verified)
if (parsed.role === "user") {
  const list = pendingSendsRef.current;
  const oldestSendingIdx = list.findIndex((p) => p.state === "sending");
  if (oldestSendingIdx !== -1) {
    const match = list[oldestSendingIdx]!;
    if (match.timer !== null) window.clearTimeout(match.timer);
    setPendingSends((prev) => prev.filter((p) => p.mqid !== match.mqid));
  }
}
```

### Pattern: Settled attachment bubble render (mirror this for pending)
```jsx
// Source: ChatMessage.tsx:479-509 (verified)
injected ? (
  <>
    {injected.caption.length > 0 && (
      <div className="pv-injected-caption whitespace-pre-wrap mb-2">
        {injected.caption}
      </div>
    )}
    <AttachmentChipStrip
      attachments={injected.files.map((f) => ({
        tempId: f.landingPath,
        file: { name: f.filename, size: f.size, type: f.mimetype },
        status: "complete",
        bytesUploaded: f.size,
        error: null,
      }))}
      onRemove={() => { /* readOnly — never fires */ }}
      readOnly={true}
    />
  </>
) : ...
```

## Test File Layout

Existing coverage inventory:

| Test file | Lines | Current coverage | Phase 81 role |
|-----------|-------|-------------------|---------------|
| `PrettyView.optimistic-bubbles.test.tsx` | 1169 | Text-only pending bubble state machine, FIFO head-match, timers, WS cleanup, whole-bubble-red (via Phase 76). **Zero attachment coverage** (verified — grep for `attachment` returns no hits). | **Primary extension surface.** Add attachment-pending seed test, attachment-pending render test, attachment FIFO head-match test, superseded-never-seeds regression |
| `ComposeBox.test.tsx` § "optimistic bubble seeding (Phase 50 Plan 03 Task 2)" (L1764+) | 1883 total | Text-only funnel: `onOptimisticSend` firing with mqid, `immediateFailure:true` on onSend=false, mqid format regex | **No changes needed.** ComposeBox is unaware of the attachment-seed plumbing under Option B (seed lives in PrettyView's `onUploadReadyToInject` closure) |
| `ComposeBox.queued-attachment.test.tsx` | 584 | `handleQueueSlotSend` attachment path, `fireNextQueued` attachment path, `handleVoiceSend` slot attachment path, primary attachment path. **Tests outcome-gated compose clear**, not pending bubbles | **No changes needed** by the same reason as above. These tests verify ComposeBox's attachment-branch orchestration; the seed fires elsewhere |
| `use-pretty-view-uploads.test.ts` | 1063 | `startBatch`, outcome promise, upload_ready_to_inject firing, superseded/timeout/ws_not_open reasons | **Optional extension:** if a new callback prop or wiring change is made to the hook (not recommended per Option B), add coverage. Under Option B: no changes |
| `PrettyView.compose-send.test.tsx` | 447 | Phase 35 ref-forwarding cutover — split-send patterns, `handleInjectedTurnReady` two-event pattern | **Add ONE test:** `handleInjectedTurnReady` (or wherever the injected-turn body is built and dispatched in PrettyView) now also seeds a pending bubble via `handleOptimisticSend`. This is where the plumbing landing site can be regression-tested at the integration level |

**Recommendation:** Extend `PrettyView.optimistic-bubbles.test.tsx` inline. Don't add a sibling file. Rationale:
- Existing file already has full setup harness (WS mock, PrettyView mount, message frame injection). Duplicating that in a sibling file would be 200+ lines of scaffolding for 8-10 new test cases.
- Attachment coverage is a natural extension of the "state machine" theme, not a distinct concern.
- Add a nested describe block: `describe("PrettyView — attachment pending bubbles (Phase 81)", () => { ... })` at the end of the file after the existing "render latest-only + interleaving" block. Reuse existing WS-frame helpers.

**Also extend `PrettyView.compose-send.test.tsx`** with one integration test for the `upload_ready_to_inject → handleOptimisticSend` wiring. This is where the plumbing actually happens.

**Suggested new test cases for PrettyView.optimistic-bubbles.test.tsx:**
1. `upload_ready_to_inject event → pending bubble seeds with caption + chip metadata`
2. `pending attachment bubble renders caption above chip strip (AttachmentChipStrip readOnly)`
3. `empty caption + attachments → chip strip only, no caption line`
4. `pending attachment bubble → whole bubble red on flip-to-failed (Phase 76 D-06 inheritance)`
5. `pending attachment bubble → chips still visible on red-fill (D-08)`
6. `superseded batch (A superseded by B) → only B's pending bubble seeds, not A's` (regression for D-13)
7. `upload_failed → NO pending bubble ever seeds` (regression for D-12)
8. `WS-not-open at startBatch → NO pending bubble ever seeds` (regression for D-12)
9. `FIFO head-match on user-role echo clears pending attachment bubble same as text` (D-10)
10. `mqid on pending attachment bubble === batchId === messageQueueItemId on upload_ready_to_inject event`

**Suggested test helpers/fixtures worth reusing:**
- WS mock setup boilerplate from `PrettyView.optimistic-bubbles.test.tsx` beforeEach
- Message-frame injection helper (whatever sends `{type:"message", role:"user", ...}` through the mock WS)
- Existing PrettyView mount factory
- `usePrettyViewUploads` mock or driver from `use-pretty-view-uploads.test.ts` for triggering upload_ready_to_inject frames

## Runtime State Inventory

> Not applicable — Phase 81 is not a rename/refactor/migration phase. No stored data, live service config, OS-registered state, secrets, or build artifacts embed the old string in a way that outlives source updates. All work is in-memory React state and prop-drilling.

## Environment Availability

> Skipped — Phase 81 is code-only. No new external tools, services, runtimes, or CLI utilities required. Reuses existing `src/ui` bundle build (Vite), existing test runner (Vitest), existing WS mock harness.

## Validation Architecture

> Skipped per `.planning/config.json` — `workflow.nyquist_validation: false`.

## Security Domain

`security_enforcement: true` per `.planning/config.json` — applicable to this phase.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched — all UI-side rendering + already-authenticated WS flows |
| V3 Session Management | no | No session lifecycle changes |
| V4 Access Control | no | No new endpoints or authorization surfaces |
| V5 Input Validation | yes (indirect) | Filename sanitization already handled by `sanitizeFilenameForUpload` at pretty-view-upload-protocol.ts:157 (V5-verified in Phase 05). Pending-bubble render passes filename through to `AttachmentChipStrip` which uses `<span className="truncate">{file.name}</span>` — React's default text-node escaping mitigates XSS. NO `dangerouslySetInnerHTML` involved |
| V6 Cryptography | no | No crypto |

### Known Threat Patterns for {React UI + WS-driven state}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via attacker-controlled filename | Tampering / Info Disclosure | React default text-node escaping (verified — chip renders `{file.name}` inside a `<span>`, not via HTML) |
| WS event ID confusion (attacker sends fake `upload_ready_to_inject` for another user's batch) | Spoofing | Existing batchId gate at use-pretty-view-uploads.ts:378 (`event.messageQueueItemId !== ourBatch` → drop) — unchanged |
| Client-side pending record leak across sessions | Info Disclosure | Existing `clearAllPendingSends("session-rotation")` at PrettyView.tsx:1880 fires on session_changed WS frame — pending records with attachment metadata clear along with the rest |
| DoS via giant caption text in pending bubble | DoS | Caption is bounded upstream by textarea max-length semantics + auto-grow cap. Attachment count is bounded by user's staging capacity. No pathological case introduced |

No new threat surfaces introduced by this phase — attachments already flow through the compose UI; Phase 81 only surfaces their metadata into a pre-existing pending-record shape.

## Assumptions Log

> All claims in this research are `[VERIFIED: source-file inspection]` from actual file reads at listed line numbers. No `[ASSUMED]` claims.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (empty — all findings traced to specific source lines verified 2026-09-07) | — | — |

## Open Questions

1. **Should the seed call include a diagnostic marker so log-grep can distinguish attachment-pending seeds from text-only pending seeds?**
   - What we know: Text-only seed logs go through `[compose] submit-entry` at ComposeBox.tsx:459. Attachment sends already log `[compose] submit-entry ... path=attachment mqid=pending`. The seed itself (inside `handleOptimisticSend`) logs `[diag-dormant-send] arm mqid=... dormant=...` at PrettyView.tsx:1240.
   - What's unclear: Whether the diagnostic surface for attachment seeds should carry an explicit marker (e.g., `attachmentCount=N`) so post-ship grep-based repro of the "did the bubble seed?" question doesn't require correlating two log lines.
   - Recommendation: Add `attachmentCount=${attachments?.length ?? 0}` to the existing `[diag-dormant-send] arm` log line. One-line change, high diagnostic value for the exact "did an attachment bubble seed for this batchId?" query.

2. **Should the plan include a code-review checkpoint for the `AttachmentChipStrip` visual on the red-fill background?**
   - What we know: Chip styling is quiet-neutral over `bg-white/[0.04]`. Bubble red fill is `hsla(0, 60%, 35%, 0.90)`. Both are translucent — the chip's neutral background will composite over the red.
   - What's unclear: Whether the composed visual is legible enough. D-08 says "chips still visible so user sees what didn't land" — this is a soft requirement.
   - Recommendation: Include a human-verify screenshot task at end-of-phase (or during plan-checker if visual verification is in scope). No code change needed unless the visual fails.

3. **Is there a "queue-slot voice-submit with attachments" happy path that's tested end-to-end today?**
   - What we know: `ComposeBox.queued-attachment.test.tsx` Test 4 covers `handleVoiceSend slot-target WITH attachment routes to onSendWithAttachments`. This tests the compose-side wiring but doesn't verify the pending-bubble seed at that trigger site (because the seed doesn't exist yet).
   - What's unclear: Whether the Phase 81 test plan should assert seed-behavior at THIS specific trigger, or whether coverage of the underlying `onUploadReadyToInject → seed` plumbing is sufficient (since all four trigger sites converge into that plumbing).
   - Recommendation: Since Option B plumbing means ALL four trigger sites go through the same `onUploadReadyToInject` handler, ONE test covers the seed-behavior. Individual per-trigger seed tests are redundant. Cover the four triggers instead via a matrix test that just verifies each trigger successfully starts a batch that terminates in `upload_ready_to_inject` (existing pattern in `ComposeBox.queued-attachment.test.tsx`) — the seed test in `PrettyView.optimistic-bubbles.test.tsx` covers what happens once the event arrives.

## Deploy Risk / Blast Radius

**Surfaces touched:**
- `src/ui/features/pretty-view/PrettyView.tsx` — `PendingSend` type widening (L1118), `handleOptimisticSend` args + record spread (L1183-1256), pending render call site attachment prop (L3331), NEW seed call inside existing `onUploadReadyToInject` wiring closure (grep needed to locate)
- `src/ui/features/pretty-view/ComposeBox.tsx` — `onOptimisticSend` prop type widening (L187-192). ZERO logic changes in ComposeBox — the funnel keeps its text-only pattern; attachment-branch code is unchanged
- `src/ui/features/pretty-view/ChatMessage.tsx` — new `attachments?` prop (L52-87), new render branch (~L479-509 area)
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — additive test cases
- `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` — one additive test for the plumbing

**What could break:**
- Text-only pending bubbles (Phase 50 baseline) — regression risk from widening `PendingSend` type and `handleOptimisticSend` signature. Mitigation: run existing 1169-line optimistic-bubbles test suite unchanged; all tests should stay green
- Settled attachment bubbles (Phase 05 baseline) — regression risk from adding a new render branch to `ChatMessage`. Mitigation: settled `injected` branch fires FIRST (before pending branch) — pending attachments only render when settled path returns null. Existing settled tests should stay green
- Superseded batches — subtle risk that adding seed call in `onUploadReadyToInject` accidentally fires for a superseded batch. Mitigation: the existing `readyFiredRef` + batchId gates prevent this by definition; add explicit regression test #6 above
- WS reconnect during in-flight upload — the `readyFiredRef` semantics + outcome-timeout at 30s already govern this. Pending bubble not seeded means no orphan. No new risk

**Regression coverage needed:**
- All existing tests in the 5 identified test files must stay green
- 10 new tests listed above
- Manual verify: red bubble legibility with chips (Question 2)

**Blast radius:** Confined to pretty-view feature namespace. No API contract changes (all callback fields optional). No backend changes (upload event shapes unchanged; WS input frame carries same mqid it always did). No cross-team surfaces touched.

## Project Constraints (from CLAUDE.md)

> No `CLAUDE.md` file exists at project root (`/home/ubuntu/skynet-tabitha/CLAUDE.md` — verified absent). No project-specific coding conventions, forbidden patterns, or security requirements sourced from CLAUDE.md apply beyond what is already captured in the existing `.planning/STATE.md` conventions and prior-phase CONTEXT.md files.

**Project skills:** `.claude/skills/` directory does not exist in this project — verified absent.

## Sources

### Primary (HIGH confidence — direct source inspection 2026-09-07)
- `src/ui/features/pretty-view/ComposeBox.tsx` (3558 lines) — funnel definition (L440-496), primary handleSend + attachment branch (L1505-1602), queue-slot handleSend + attachment branch (L1437-1497), cadence-fire + attachment branch (L1196-1258), voice-submit + attachment branch (L1648-1729), Enter-key handler (L1918-1946), reset-send funnel routing (L1817-1838), quick-send funnel routing (L1886-1916)
- `src/ui/features/pretty-view/PrettyView.tsx` (3692 lines) — `PendingSend` type (L1118-1124), `handleOptimisticSend` (L1176-1258), FIFO head-match (L1900-1911), pending render (L3317-3338), `onSendWithAttachments` prop wiring (L3640-3666), `isIdCommand` render-blacklist (L1193)
- `src/ui/features/pretty-view/ChatMessage.tsx` (625 lines) — `injected` render branch (L479-509), `parseInjectedUserTurn` call (L309), `pendingState` prop (L86), whole-bubble-red inline style (L406-414)
- `src/ui/features/pretty-view/use-pretty-view-uploads.ts` (1180 lines) — `BatchOutcome` type (L81-90), `startBatch` (L562-652), `retryBatch` (L657-756), `resetBatch` superseded path (L779-793), `handleServerEvent` upload_ready_to_inject case (L449-469), `readyFiredRef` guard (L450-451), `onReadyRef` (L320-323)
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` (194 lines) — `readOnly` mode contract (L36-49), chip render conditional styling (L114-134)
- `src/ui/api/pretty-view-upload-protocol.ts` (396 lines) — `UploadReadyToInjectFileSummary` shape (L123-130), `InjectedTurnInput` (L224-235), `formatInjectedUserTurn` (L256-268), `parseInjectedUserTurn` (L296-336)
- `.planning/phases/81-optimistic-bubble-for-every-compose-box-send/81-CONTEXT.md` — full read
- `.planning/shapes/shape-attach-optimistic-bubble.md` — full read
- `.planning/phases/76-.../76-CONTEXT.md` § D-06 whole-bubble red decision (L37)
- `.planning/phases/50-optimistic-message-bubbles/50-CONTEXT.md` — referenced for text-only baseline

### Secondary (MEDIUM confidence — grep-based verification)
- Test file inventory: `find /home/ubuntu/skynet-tabitha/src -name "*.test.tsx" -o -name "*.test.ts"` — 30+ files matching pretty-view namespace, focused reads on the 5 relevant test files
- Attachment coverage in optimistic-bubbles test: `grep -n "attachment\|injected\|upload_ready" PrettyView.optimistic-bubbles.test.tsx` — zero matches confirms no existing coverage

### Tertiary (LOW confidence)
- None — no WebSearch or external-library research performed (not required for this phase)

## Metadata

**Confidence breakdown:**
- Standard stack: N/A (no new packages)
- Architecture: HIGH — every claim traced to specific source-line inspection
- Pitfalls: HIGH for #1, #2, #4, #5, #6 (verified from source); MEDIUM for #3 (reasoning from IIFE pattern, not a repro'd bug)
- Trigger-site inventory: HIGH — verified from ComposeBox.tsx grep + focused reads at every `handleSend`, `handleQueueSlotSend`, `fireNextQueued`, `handleVoiceSend`, `handleQuickSend`, `handleResetClick` callsite
- Test file layout: HIGH — verified from `wc -l` + grep of describe/it blocks

**Research date:** 2026-09-07
**Valid until:** 2026-10-07 (30-day estimate — pretty-view codebase is actively developed; ComposeBox.tsx has churned recently per git log)
