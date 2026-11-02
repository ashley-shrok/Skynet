# Shape: the heard note shows a short run of what the user heard, with their own messages in it

**Opened:** 2026-11-01

## What this is

Every voice message already carries a hidden note saying what the user had heard when they spoke. Today it names only the single last reply heard. When that reply is a bare "Okay.", the note points at the right moment but carries no topic. This shape makes the note show the last stretch of the conversation as the user lived it, and always say that nothing after it had been heard.

## Shape

- **The heard run.** The last three replies the user heard in this voice session, oldest first. Between them sit the user's own messages, at the point where each was sent. Each entry is quoted by its opening words, and quotes still grow until they're distinct, as today.
- **Ordered by experience, not transcript.** A reply takes its place in the run at the moment it was read to the user; a user message at the moment it was sent. So a reply held while the user was talking shows up after the message they were saying.
- **A user message enters the run** when it was sent after the earliest reply in the run. The note shows only the words of a voice message, never its own earlier note.
- **Cut off stays marked.** A reply in the run that was stopped partway is marked "cut off partway". The separate "before that, they heard only part of…" sentence goes away, because the run covers it.
- **The standing line, always.** "Nothing you sent after <the last heard reply> had been heard yet, including anything you send before you read this."
- **Not heard yet**, when known at send time: replies held or skipped are still named, as today.
- **Nothing heard yet in this voice session:** say so, still add the standing line, and name any held replies.
- **Same hiding as today.** The note shows nowhere the voice tag doesn't.

## Philosophy

- Built for every condition and every agent, not tuned to the orchestrator.
- Honest over precise: state only what voice mode knows.
- Context beats pointers: a reply's topic should be readable in the note, not something the agent has to work out.

## What would make it wrong

- An agent can't tell what a voice answer is about from the note.
- The run puts things in transcript order instead of the order the user experienced them.
- The note grows so long it buries the user's words.
- The note says something was heard when it wasn't.

## Scope edges

- **In:** the note's wording and the tracking it needs (heard order, send moments); the id skill's voice-mode line if its wording no longer fits; tests.
- **Out:** the orchestrator role line. That was offered separately and isn't part of this.
- **Out:** replies heard before voice mode was switched on. The run starts fresh each voice session, as the note does today.
- **Out:** typed messages sent while voice mode is on still get no note, though they do appear in the run when one is sent.

## Handoff notes

- Code: src/ui/features/pretty-view/heard-note.ts (builds the note) and useVoiceMode.ts (tracks heard replies; currentHeardNote).
- No What's-new note: users see no difference.
- Commit and scoped tests only. Push and deploy each need the user's greenlight.

---

## Close-Out

**Closed:** 2026-11-01
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · The note shows the last stretch of the voice session as the user lived it, then always says nothing after it had been heard.
- **The heard run** — present · Last three heard replies, oldest first, with the user's messages where each was sent; reply quotes grow until distinct. The user's own messages keep a fixed short opening (the user agreed: they're context).
- **Ordered by experience, not transcript** — present · Replies enter when read, messages when sent; a replay after the user spoke now lands after their words (fixed after review).
- **A user message enters the run** — present · Only after the earliest reply in the run; voice messages by their words only.
- **Cut off stays marked** — present · Marked in place; the separate "before that" sentence is gone.
- **The standing line, always** — present.
- **Not heard yet** — present.
- **Nothing heard yet in this voice session** — present.
- **Same hiding as today** — present.
- **Philosophy** — present.
- **What would make it wrong: An agent can't tell what a voice answer is about from the note** — present · The "Okay." incident is reproduced in a test.
- **What would make it wrong: The run puts things in transcript order** — present.
- **What would make it wrong: The note grows so long it buries the user's words** — present · Replies capped at three; the user's messages capped at the latest four (added after code review).
- **What would make it wrong: The note says something was heard when it wasn't** — present.
- **Scope edges** — present.
- **Handoff notes** — present · Committed with scoped tests; no push or deploy.

### Additions (in the result, not in the shape)

- A reply quoted in full reads `your reply "Okay."`; a longer one `your reply starting "…"` — endorsed-as-drift
- User messages keep a fixed short quote rather than growing — endorsed-as-drift (the user, 2026-11-01)

### Follow-ups

- Push and deploy — deferred until the user's greenlight

### Notes

Code review fixes folded in: the standing line is anchored to the newest reply heard (a replay of an older one no longer marks later replies unheard); wake-ups and other non-typed events stay out of the run; the "latest of your replies that start that way" position now says "as of when they spoke", since the agent may send another before reading; a replay that reports only its end still lands after what the user said.
