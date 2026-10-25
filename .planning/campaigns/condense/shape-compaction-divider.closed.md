# Shape: a condense shows in the chat as a slim divider, not a giant bubble

**Opened:** 2026-10-25

## What this is

When an agent's conversation is condensed, the chat view today shows three stray things on the user's side — a huge bubble holding the whole summary as if the user had sent it, a slash-command bubble for the compact step, and a "Compacted" output block with the summary helper's chatter — and a message the user sends while a condense is running loses its "sending" bubble early because the summary is mistaken for it. This shape replaces all of that with one slim divider at the point where the condense happened, with the summary tucked inside it, and makes sure nothing a condense writes is ever mistaken for the user's own message arriving.

## Shape

- **One divider per condense.** Everything a condense leaves in the transcript — the summary, the compact command and its output — collapses into a single divider placed where the condense happened. Nothing else of it appears in the chat.
- **The divider reads** "Conversation condensed · <time>" on one line. When guidance was given (typed with the button, or carried by the agent's own request), it shows in muted text underneath, in quotes, cut to one line.
- **Summary on demand.** Clicking (tapping) the divider opens it in place: the full guidance, if any, then the summary itself, formatted like an agent message (headings, lists). The fixed preamble the harness puts at the top of every summary is left off; nothing else is rewritten or shortened. Clicking again closes it. Closed by default.
- **Same for every trigger.** The user's button, the agent asking, and the automatic condense near the limit all look the same — no "automatic" note.
- **Pending messages settle only on the user's own message.** The summary, the compact command and its output never count as the user's message arriving, so a message sent during a condense keeps its "sending" bubble until that message actually lands.
- **Past conversations too.** Compactions already in old transcripts (including the idle ones from before this campaign) show as dividers the same way.
- **History stays continuous.** One transcript runs through a condense; scrolling and loading back past a divider is confirmed to work, not built.

## Philosophy

A condense is something that happened to the conversation, not something anyone said — so it reads as a quiet marker, not as speech from either side. The summary is written for the agent; it's available to the user for the curious moment, never pushed at them. The fix is in how the chat reads what's already written, not in what the agent or the supervisor write.

## Prior context

- The condense operation itself (request, supervisor, button, "Condensing…" on the memory pie) landed in the previous shape. The supervisor's "Compaction done" nudge to the agent is already hidden from the chat.
- On disk a condense writes, in order: a compaction marker, the summary (flagged as a summary), and — when it came from the compact command — that command (with any guidance) and its "Compacted" output. An automatic condense writes only the marker and the summary.
- The chat today drops the marker and shows the other three as user-side bubbles. The "sending" bubble settles on whichever user-side line arrives next, in send order — so each of those three can wrongly settle a pending message.

## What would make it wrong

- Any part of a condense still shows up as a bubble from the user — or the summary is open by default and the user has to scroll past it.
- A message sent during a condense loses its "sending" bubble before it actually lands, or shows twice.
- The divider drops or garbles the summary, or rewrites it beyond removing the fixed preamble.
- A condense started by the agent or automatically looks different from one the user started.
- Scrolling back past a condense stops working, or the conversation appears to start fresh at the divider.

## Scope edges

- **In:** the divider and its open/closed summary; guidance on the divider; keeping condense lines from settling pending messages; old transcripts getting the same treatment; confirming load-back across a divider.
- **Out:** what the agent sees; the supervisor; the memory pie and "Condensing…" (previous shape); terminal view.
- **Deferred (filed in the campaign's Other work):** search across conversations labels hits inside summaries as things the user said, and there's a case for adjusting what search finds — Ashley: "maybe we don't do that here."
- **Tempting but no:** token counts or sizes on the divider; an "automatic" badge; summarising the summary.

## Handoff notes

- Identity: blaze-box-maintainer-3, campaign `condense`, shape 4 of 4. Ends at commit — no push, no deploy until campaign close.
- Real sample transcript with four condenses (manual, with and without guidance): the e2e tester's session under /tmp/e2e/home (may be gone after a reboot). No automatic-condense sample on hand — build tests from its known shape (marker + summary only).
- The user-visible change needs an id-skill edit (Conversation view → Messages) and a what's-new note shown to Ashley first.

---

## Close-Out

**Closed:** 2026-10-25
**Overall verdict:** closed-hit

### Shape features (conformance)

- **One divider per condense** — present · The summary becomes the one divider; the marker, the compact command line, its "Compacted" output and the /compact prompt as typed or queued are all dropped; guidance folds into the divider just above it and never renders on its own.
- **Divider reads "Conversation condensed · <time>" with guidance underneath** — present · One line; guidance in quotes, muted, cut to one line while closed; taken from the compact command, so the same whether the button or the agent's request started it.
- **Summary on demand, closed by default, formatted like an agent message** — present · Starts closed; click toggles in place; open shows full guidance then the summary as formatted text. Only the fixed opening (and, per Ashley at close, the tools-used line just after it) is removed; the rest is word for word.
- **Same for every trigger, no "automatic" note** — present · One rendering path, no trigger field, no badge.
- **Pending messages settle only on the user's own message** — present · Divider and guidance frames never settle a pending send; the compact prompt, command and output never reach the chat as user lines; a view test covers a message sent mid-condense.
- **Past conversations too** — present · The change is in how existing lines are read, so old transcripts get dividers.
- **History stays continuous (confirmed, not built)** — present · Load-older shares the same shaping and carries the condense frames; guidance folding runs over the merged list. Confirmed by code path, no recorded load-back test across a divider.
- **id-skill edit (Conversation view → Messages)** — present · Describes the divider, guidance line, closed by default, click to open and close, same for every condense; the Compacting-yourself section links to it.
- **Deferred search item filed in campaign Other work** — present
- **What's-new note shown to Ashley first** — drifted · Ashley was shown a draft and said "Skip it" — no note.
- **Out-of-scope and tempting-but-no respected** — present · Supervisor, what the agent sees, memory pie and terminal view untouched; no token counts, sizes, automatic badge or re-summarising.

### Additions (in the result, not in the shape)

- On a day other than today the divider shows the date with the time — endorsed-as-drift (Ashley: "Yes")
- Hovering the divider shows its full date and time — endorsed-as-drift (Ashley: "Yes")
- The tools-used line at the top of a summary is left off along with the preamble — endorsed-as-drift (Ashley: "Yeah, drop it")
- A small condense icon and open/close chevron on the divider label — within "slim divider" (reviewer's read; not put to Ashley)

### Follow-ups

- The unread-mark scan counted the plain /compact prompt the supervisor types as a user reply — accepted into this campaign (Ashley: "Do it here"); fixed, filed done in the campaign's Other work.
- Search labels hits inside summaries as things the user said — deferred (campaign Other work).

### Notes

Claude Code also records the /compact prompt as typed (and, when the agent is busy, as a queued copy) before the condense runs — a fourth line the shape's prior context didn't list; it is handled the same way as the other three.
