# Shape: add file upload support to pretty view

**Opened:** 2026-07-20
**Vehicle:** GSD phase (planned via `/gsd:plan-phase`, executed via `/gsd:execute-phase`)

## What this is

A way to hand files from your local machine to the specific agent you're
already talking to in pretty view, without leaving the conversation.

Right now moving a file to an agent requires figuring out a per-box transfer
path — different for each box, none of them convenient — and always breaks
the flow of actually talking to the agent. This closes that gap: you're in
the pretty-view surface, you drop a file (or paste one from clipboard, or on
mobile tap a paperclip), you write what you want the agent to do with it,
you hit send. The file lands at a predictable path on the receiving box and
a message that names the file(s) is injected into the session so the agent
can just go read them.

The whole point is the paperclip should feel cognitively free: you never
think about "which box, which path, will this eat my context, will it work
next reboot." You have a thing, you want the agent to have the thing, you
say what you want done — and hit send.

## Shape

Three ways to attach a file:

- **Drag-and-drop anywhere on the pretty-view surface.** When a drag enters
  the surface, a "drop files here" overlay appears; drop anywhere in the
  surface to add attachments. This is the primary interaction.
- **Paste from clipboard.** Pasting into the compose area — a screenshot,
  an image, whatever's on the clipboard as a file-shaped payload — is
  first-class. Same landing behavior as drag.
- **Paperclip button — mobile only.** Because touch devices can't drag,
  a paperclip appears in the compose area on touchscreens only (gated by
  the same touch-device signal the mobile bottom nav uses). Desktop
  never sees it. Tap opens the native file picker.

Attaching stages files into a chip strip that sits above the compose
textarea. Each attachment is a chip showing the original filename and size,
with a small × to remove it before sending. Attachments never send on their
own — they always ride out as part of a message you're composing. Empty
caption is fine (send goes through with no text if the box is empty).

**Send behavior is atomic.** When you hit send, all attachments transfer to
the receiving box first; the injected message does not go until every file
has landed successfully. During transfer, each chip shows its own progress
indicator (per-chip is preferred; a single aggregate indicator is an
acceptable fallback if per-chip proves fiddly). If any file fails
mid-transfer, chips go red, the message stays in staging, you retry.

**Files land at a predictable path.** On the receiving box, uploads go to
`~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` under the
receiving user's home directory. Day-organized, timestamped so there are
no collisions, browseable, and never in `/tmp` (which loses its contents
on reboot). The receiving user's home is universal — works on any managed
box, no dependency on an identity being loaded.

**The injected user turn is path-only, never inline dumped.** Once
everything has landed, a message is injected containing your caption plus
a compact metadata block per file: original filename, size, mimetype,
upload timestamp, and the landing path. The agent reads what it needs when
it needs it. On a Claude Code pane the agent can `@`-reference the path
when they want the content; on a plain shell pane a human user can just
`cat` it. Either way the file is sitting there, ready.

**In your own pretty-view stream**, your sent message renders as a single
bubble containing the caption text and inline chips for each attachment —
same visual grouping as one turn on the wire, because that's what it is.
Chips only; no inline previews or thumbnails, even for images. Consistent
across mimetypes and keeps the stream scannable.

**Failure and offline behavior is forgiving.** Pane's SSH channel is down
when you hit send: attachments + caption queue locally alongside the
draft; everything sends when the connection comes back. Tab close during
staging: attachments are lost (drafts survive per existing draft
persistence, but the file bytes themselves aren't stored client-side;
re-drag from the file that's still on your desktop). No auto cleanup on
the receiving side; uploads persist until the agent or the user deletes
them.

**Folder drops are refused with a nudge** ("please attach files or zip
first"). Standard chat-app behavior. Avoids accidentally shoving
`~/Documents` at your SSH channel.

**One caption per batch.** Attach three files, write one caption, send —
they all go in a single injected user turn sharing that caption. No
per-chip caption inputs; that's heavier UI for no real workflow win.

## Philosophy

The core stance: **make the paperclip cognitively free.** Attaching a file
to a message should never require you to think about context cost,
transfer path, cleanup, or what "attaching a file" means in some abstract
sense. Every design decision here defers to that.

Downstream commitments that fall out:

- **Path-only injection, always.** The CLI's native attach convention (the
  one that inlines file bytes into context) was tempting because it's
  elegant, but it means a 100KB file eats 100KB of context immediately
  whether the agent needs it or not. That surprise is exactly what makes
  people stop trusting the paperclip. Path-only-with-metadata pushes all
  context cost to the moment the agent actually looks.
- **Atomic transfer, not partial.** The agent should never see a message
  that references a file that isn't there. The user should never wonder
  "did some of them make it or not." Atomic collapses that class of
  confusion at the cost of a small wait on big-file sends.
- **No cleanup, ever.** Files delivered on purpose are worth keeping until
  someone decides otherwise. Auto sweeps mean an upload vanishing right
  when you wanted to reference it back.
- **Paperclip button is not the primary affordance — drag-and-drop is.**
  Desktop users have the file in their hand 99% of the time; they don't
  need a button, and the button would be visual noise the rest of the
  time. The button exists specifically because mobile can't drag.

What would violate the spirit even if it technically shipped: any
implementation where attaching a file secretly balloons context, where you
have to think about the receiving box, where the paperclip clutters
desktop, or where sending files feels like a different action-shape than
sending a message.

## Prior context

Skynet is the browser SSH/RDP surface the whole fleet uses. Pretty view is
its chat-style rendering of Claude Code sessions running inside tmux on
managed boxes — bubbles, streaming, message queue drawer, identity
badges, WIP indicators, plan-pending bubbles, backgrounded-agents panels,
and so on. The core interaction today is: type a message in the compose
area, hit send, message goes down the SSH channel to the agent's tmux
pane, agent responds, streaming replies appear as bubbles.

The transfer channel a file upload would use already exists. Every
pretty-view session has a live SSH connection to the receiving box —
that's how send/receive work at all. Uploading a file is fundamentally
the same channel doing the same thing with different bytes.

The touch-device signal for the mobile-only paperclip already exists too,
introduced in patch 102 for the mobile bottom nav (touchscreens report
coarse pointer + no hover; desktops report fine + hover regardless of
window width). Rendering the paperclip conditionally on that signal is a
one-line consequence of infrastructure that just shipped this morning.

The message-queue drawer already persists typed drafts across reloads
(patch 49 work). That's the model the caption text would inherit here —
but the attachments themselves deliberately do NOT get that guarantee
(see philosophy: no client-side storage of file bytes).

Recently-shipped patches worth being aware of during planning:
- Patch 60 introduced atomic delete-on-send in the SSH input handler
  keyed on a per-message queue item id. The split-write architecture
  there is the natural place a "message with attached-file paths" slots
  in — same handler, same queue item, additional per-item state for
  the pre-send upload phase.
- Patch 100 (shipped today) split-and-delays the trailing Enter on
  pretty-view submits. File-attachment submits inherit the same
  submit path, so they get the same Enter-drop reliability fix.
- Patch 86 has inline image render for tool_result blocks. Chip
  rendering in the sent-message bubble should feel visually
  consistent even though it's a different code path.

## What would make it wrong

- **Paperclip becomes visible on desktop by mistake.** Whole point was
  that desktop users never think about the button existing.
- **A big attached file silently inflates the model's context.**
  Violates the path-only promise and loses trust in "just attach it."
- **The injected message can reference files that never landed.**
  Breaks atomicity and hands the agent a broken world.
- **User has to think about the receiving box** (which box, what path,
  is there space) when attaching. That's the friction this feature
  exists to remove.
- **Uploads clutter the agent's working directory or a shared project
  tree.** The `~/pretty-view-uploads/date-organized` landing is
  deliberate; landing anywhere else defeats it.
- **A Wi-Fi flap loses in-flight uploads permanently with no retry.**
  Breaks the forgiving-failure stance.
- **Pasting a screenshot into the compose area does something confusing
  or nothing at all.** Regresses a reflex the user already has from
  every chat app.
- **Dropping a folder produces recursive upload storms with no
  warning.** Reasonable default is refuse; anything else is worse.
- **Auto sweeps make an upload vanish mid-conversation.** Violates
  "no cleanup, ever."
- **The chip strip is heavy visual chrome in the empty state.** Should
  only exist when attachments are actually staged; no persistent empty
  strip in the compose area on desktop.

## Scope edges

**In:**
- Drag-and-drop anywhere on the pretty-view surface, with a "drop files
  here" overlay while dragging.
- Clipboard paste as first-class attachment (routes through same landing
  behavior).
- Mobile paperclip button, gated on the touch-device signal only.
- Chip strip staging with per-chip remove.
- Per-chip transfer progress (aggregate acceptable as fallback).
- Atomic transfer semantics (message doesn't send until all files land).
- Retry on failure.
- Offline queueing that inherits the existing draft-persistence model
  for the caption; attachments do NOT persist across tab close.
- Path-only-with-metadata injected user turn (filename, size, mimetype,
  upload timestamp, landing path).
- `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>`
  landing convention on the receiving box.
- Sender-side chip rendering in the message bubble alongside the
  caption.
- Folder-drop refusal with a "please attach files or zip first" nudge.
- One caption per batch.
- Feature works on any pane (Claude Code or plain shell) — the
  injected message is meaningful to a human at a shell too.

**Out:**
- Inline content dumping via the CLI's native `@` fetch. Deliberately
  rejected in favor of path-only.
- Per-file captions. One caption per batch; no per-chip caption inputs.
- Automatic file cleanup on the receiving side. Agent or user handles
  lifecycle.
- Attachment persistence across tab close. Drafts survive, file bytes
  don't.
- Undo after send. Once the message is out and files have landed,
  they're out.

**Deferred — revisit if the itch surfaces:**
- An "inline this" per-attachment toggle for the case where the user
  really does want a small file dumped straight into context.
- Agent → user download direction (agent produces a file, user pulls
  it back to their local machine).
- Drag-out from a chip in a received message to save it locally.
- Sweep policy for uploads older than N days.
- Keyboard shortcut to open the file picker on desktop (unlikely to
  come up, but trivial to add if it does).

**Tempting but no:**
- Rich thumbnail previews for image attachments in the message-stream
  bubble. Chip-only keeps visual noise minimal and the pattern
  consistent across mimetypes. The agent can render the image itself
  if the user asks.
- Auto-inline for tiny text files ("smart" mimetype behaviors). Every
  smart special case is another surprise in an interaction that's
  supposed to be surprise-free.
- Progress bar for the aggregate batch alongside per-chip progress
  bars. Redundant; per-chip alone is sufficient.

## Vehicle notes

Chosen: **GSD phase.** Planned via `/gsd:plan-phase` (slug up to the
planner — something like `pretty-view-file-uploads` fits), executed via
`/gsd:execute-phase`.

Why phase and not smaller:

- **Multi-file, multi-layer scope.** Frontend components (drop overlay,
  chip strip, per-chip progress, mobile paperclip, clipboard paste
  handler, message-stream chip rendering), backend upload path (browser
  → Skynet EC2 → target box), protocol additions (message format for
  the injected user turn), and a new filesystem convention on the
  receiving side. Too much surface for `/gsd:quick`.
- **Tight coupling around atomic-send semantics.** Splitting into
  serial quicks would leave half-features that don't validate.
- **Real design calls will surface during planning that this shape
  intentionally didn't lock down.** Specifically: the exact injected-
  message text format including delimiter shape (prose-with-header vs
  structured block), the wire protocol for streaming file bytes through
  the existing SSH channel vs a separate upload path, the per-chip
  progress event schema, and the retry protocol on partial failure.
  Those benefit from plan-phase's goal-backward validation.

Existing infrastructure the planner should reuse rather than reinvent:

- Every pretty-view session already has a live SSH connection to the
  receiving box — the file transfer rides that channel, not a new one.
- The touch-device detection from patch 102 (`useIsTouchDevice`) is the
  exact gate for the mobile-only paperclip. Same signal, same hook, one
  import.
- The draft persistence in the message-queue drawer (patch 49) is the
  model for how caption text survives a reload. Attachments explicitly
  do NOT inherit this (per shape).
- Patch 60's atomic delete-on-send in the SSH input handler
  (`src/backend/ssh/terminal.ts`, the `input` case) is the closest
  architectural analog: message + resource lifecycle bound to a single
  logical unit via `messageQueueItemId`. Attachments should extend
  that same pattern (message + files + delete-on-successful-send)
  rather than build a parallel one.
- Patch 100's split-and-delay pretty-view submit path is inherited
  automatically since attachment submits go through the same input
  handler.

Handoff notes for the planning agent:

- **Bounty of record:** `pretty-view-file-upload-support` under
  `~/.claude/identities/tina/bounties/`. The bounty file has been
  updated with a pointer to this shape file, so the trail from open
  bounty → shape → phase kickoff is intact.
- **Deploy path:** standard fork build + deadman + force-recreate flow
  per tina's deploy runbook (`~/.claude/identities/tina/deploy-runbook.md`).
  This is a fork patch series, not an out-of-band change.
- **Close-out:** `/close pretty-view-file-upload-support` once the
  phase ships and Ashley has confirmed the feature in production.
