# Shape: Attach an optimistic bubble to every message the compose box sends

**Opened:** 2026-09-07
**Vehicle:** GSD phase

## What this is

The optimistic message bubble — the instant-feedback bubble that appears in
the transcript the moment you press send, before the harness has echoed the
message back — exists today only for a subset of the sends the compose box
performs. Plain text sends from the primary Send button get one. Text sends
from queue-slot Send, cadence auto-fires from the queue, and any send that
carries an attached file get nothing: the transcript stays silent until the
harness round-trips.

The rule going forward is simple. If a compose box sends a message, that
send produces an optimistic bubble. Non-send actions (like the interrupt
button) don't. This piece of work extends the existing optimistic-bubble
machinery so it covers every compose-box send trigger, in both text-only
and attachment-carrying variants.

## Shape

There is already a mechanism for optimistic bubbles: pressing send on a
plain text message from the primary compose surface seeds a pending record
that renders as a bubble in the transcript with a small sending spinner,
carrying an identifier assigned to that send. When the harness later echoes
the same message back as a real transcript line, the pending record is
matched by identifier in send-order and cleared — the real bubble takes
its place. If the echo never arrives within a client-side timeout, the
pending bubble turns red and stays as the record of the failed send. If
the send couldn't even be dispatched (connection not open), the bubble is
seeded already red.

The gaps this closes:

**Queue-slot text sends and cadence auto-fires from the queue.** These
already go through the same underlying send transport but skip the seeding
step. They should seed a pending bubble at the moment the send fires,
identical to the primary Send path.

**Attachment-carrying sends from any trigger site.** Today the attachment
path awaits the upload lifecycle to complete and never touches the
pending-bubble path. The rule: at the moment uploads have finished and the
message is about to be handed to the harness (not at Send press), seed a
pending bubble carrying the caption plus a strip of chips representing the
attached files — the same chip visual the settled attachment message
bubble already uses (filename plus human-readable size, quiet neutral
styling). This applies to every trigger site that can dispatch attachments:
primary Send, queue-slot Send, cadence auto-fire.

The pending bubble for an attachment send renders with the caption above
the chip strip. Empty-caption sends (files only, no text) show just the
chip strip. Failure turns the whole bubble red with chips still visible so
you can see what didn't land. Match-and-replace uses the same identifier
mechanism the text path uses; when the harness echo arrives the pending
attachment bubble is replaced by the settled attachment bubble in place.

## Philosophy

The compose box is the sole author of what a user sends into the harness.
Everything it sends deserves the same instant-feedback treatment; nothing
it sends should sit invisible while the round-trip happens. Whether the
send originated from the primary Send button, a queue slot, a cadence
auto-fire, or a voice submission is irrelevant to the user — they pressed
a thing that meant "send this," and the transcript should acknowledge that
immediately.

The upload phase and the harness-confirmation phase are separate concerns
with separate visual affordances. Upload progress stays exactly where it
lives today — chips in the compose area with per-chip progress rings.
Only once uploads have completed and the message is actually going to the
harness does the pending bubble appear. This keeps the upload-progress
signal untouched and reserves the pending bubble for what it already means
elsewhere: "the message went out, waiting for the harness to confirm."

Failure-path affordances for attachments are deliberately not part of
this work. If a send fails, the red bubble is the record, and retry means
re-attaching the files and re-typing the caption. No preservation of
staged files, no retry-easier affordance.

## Prior context

The text-only optimistic bubble machinery came in during a prior phase of
work on the primary Send path and was deliberately scoped to that path at
the time. Comments in the compose surface already flag queue-slot sends
as "not yet seeding an optimistic bubble — revisit if the semantic feels
inconsistent." The settled attachment message bubble that appears after
the harness echoes was built even earlier: caption plus a horizontal
chip strip of filename + size, using a component that also has a
"read-only" mode specifically for sender-side chip renders. That render
is what the pending bubble in this work is borrowing.

The identifier that ties a pending bubble to its later-arriving real
bubble is minted at the moment a send is dispatched. For attachment
sends the identifier is minted at batch-start time, before uploads
begin — meaning it's already available to hand to the pending-bubble
seed later when uploads complete. Matching in the transcript is by
identifier plus first-in-first-out ordering; content-equality between
the pending bubble and the real bubble is not required.

## What would make it wrong

- A compose-box send that produces no bubble. The whole point is symmetry
  across every trigger site.
- A bubble appearing during the upload phase. That window belongs to the
  compose chips with progress rings; the pending bubble is for the
  harness-confirmation phase only.
- Upload-progress affordance in the compose area getting reworked as a
  side effect. It stays exactly as it is today.
- An attachment-carrying pending bubble that shows chips visually
  different from the settled attachment bubble's chips. Same component,
  same styling, so the transition from pending to settled reads as an
  in-place refinement rather than a visual jump.
- The upload's own failure states (a server-rejected file, a network drop
  mid-upload) producing a pending bubble. Those stay in the compose
  chips as they do today; the pending bubble only exists once uploads
  succeed.
- The pending bubble surviving past the harness echo. Match-and-replace
  should be crisp, no ghost frame between pending disappearing and
  settled appearing.

## Scope edges

**In:** every compose-box send trigger (primary Send, queue-slot Send,
cadence auto-fire, voice-submit) in both text-only and attachment-carrying
variants; the seed-at-inject-time timing for attachment sends; the
extended pending-bubble render carrying caption + read-only chip strip;
the failed-bubble treatment with chips still visible; the match-and-replace
lifecycle when the real echo arrives.

**Out:** any changes to upload-progress rendering in the compose area;
any preservation of staged files across a failed send; any "retry"
affordance for attachment sends; any changes to non-send compose actions
like interrupt; any rework of how the settled attachment bubble renders
after the pending replacement.

**Deferred:** none identified.

**Tempting but no:** teaching the pending bubble to show upload progress
inline (rejected — upload progress lives in the compose chips, the
pending bubble is for the after-upload window only).

## Vehicle notes

GSD phase chosen because the work spans multiple compose-box send trigger
sites with shared design decisions, touches multiple surfaces
(compose-side dispatch, pending-record shape, pending-bubble render,
upload-lifecycle wiring), and needs test coverage across the trigger
sites and both text-only and attachment variants. Larger than a quick
task; benefits from phase-level SPEC/discuss/plan discipline.

The shape file here should feed `/gsd:discuss-phase` directly — most of
the "what + why + constraints + scope edges" grill work is already
captured above; discuss should build on this rather than re-eliciting it.

Handoff: implementing agent picks up in the box-maintainer role, on the
current working branch, in the box-maintainer's working tree. Related
prior artifacts: the existing text-only optimistic-bubble phase (its
CONTEXT.md, plans, and tests are the closest reference for the pending-
record + match-and-replace mechanism), the attachment-send phase (its
CONTEXT.md and the injected-user-turn format spec are the closest
reference for the settled bubble's chip render), and the compose-box
send-funnel refactor phase (where the seed-and-dispatch primitive was
extracted).
