# Shape: the conversation view, reimagined under the redesign

**Opened:** 2026-10-23

## What this is

The chat itself — the screen Ashley spends the most time in — rebuilt in the redesign's look rather than adapted from today's. It covers everything in an open agent conversation: the header pill and the round buttons beside it, the message bubbles, messages to Ashley that travel over the relay, conversations between agents, the composer and its controls, the agent-memory indicator, the skills menu, voice recording, the working indicator, and the floating controls (back to the list on a phone, jump to latest, load older). It was settled through six rounds of live tasting over the real app; the tasting snippet is the reference for how it looks.

## Shape

**Header.** The floating pill stays a pill (not a bar like the other pane types — that bar only exists because nothing can float over an app). Solid, neutral dark fill, hairline edge, soft shadow, no glass; the agent's picture wears a thin ring in the agent's colour; the menu button is the kit's ⋯. The round buttons beside it (desktop running, unpushed work) and every other floating control — the phone's back-to-list button, jump to latest, load older messages — share the pill's look: same fill, edge and shadow, 40 high where they sit next to the pill. Jump to latest sits centred just above the composer. The desktop sidebar toggle becomes a quiet kit button.

**Edges.** Messages scroll underneath the header and the composer. Behind the pill and back button, the top of the list fades to dark; at the bottom, the flat strip around the composer is gone — the list runs under it, darkening toward the bottom edge. Darkening only, never blur.

**Messages.**
- The agent speaks in solid bubbles in its own colour (the colour is how Ashley orients — who, and what kind of agent). Ashley's own messages are a neutral grey bubble on the right.
- No tails; instead the corner nearest the speaker is less rounded (top-left for the agent, top-right for Ashley).
- Snug spacing: close to today's tight padding, text half a size up, equal space above the first line and below the last (lists included). Comfortable reading on a phone without losing how much fits on screen.
- The speak button sits just outside the agent bubble's bottom-right corner, faint until hovered; on narrow panes it tucks inside the corner.
- Code sits in a dark well inside either bubble.

**Messages the agent sent to Ashley over the relay** (what the app currently calls "DMs to you"). They are ordinary agent bubbles in the agent's colour, always open — never folded behind a header, because they are messages to her and agents often don't repeat them. The only mark is the sidebar's red envelope on the bubble's top-left corner ("Also sent to your phone" on hover). Opening a conversation that holds such a message she hasn't seen jumps to the oldest unseen one and briefly rings it, instead of landing at the bottom.

**Messages between agents.** Quiet neutral cards, folded: sender's picture, "Finch → Bilbo", a one-line preview, an arrow; open to read under a hairline. No DM pill, no ⓘ explainer, no "notified" label. Where the app can't tell who a message went to, the line still reads as plain words.

**Relay rooms** (a room Ashley opens herself): each agent's messages are bubbles in that agent's colour with its name on top; Ashley's own are the grey bubble. The room's participant header takes the pill's look.

**Composer.** One rounded card: the text on top, every control on one row underneath.
- Left: attach (the paperclip, until that button ever does more than attach), skills.
- Right: agent memory, voice mode, dictation mic, and one round main button.
- The main button does the likely next thing, always in the same neutral off-white (the icon says what it does — never the agent's colour): with text typed it sends; while the agent works it stops; with nothing typed it is the thumbs-up.
- When text is typed, the thumbs-up — or Stop, while the agent works — steps aside as a quiet button next to Send, so a thumbs-up never needs the draft cleared.
- Queue a message is gone entirely.

**Agent memory.** A small pie in the composer row, filling as the agent's memory fills. Grey and silent below 45%; amber with the percentage from 45%; red from 78% with a gentle pulse and a thin red line along the composer's edge, so it reads from the corner of the eye. Tapping it opens a small pop-over: how full, what that means in plain words, and Start fresh (today's reset, unchanged).

**Skills menu.** A wider kit pop-over with a search field on top (focused on open, except on touch devices), filtering on names and descriptions as you type, Enter running the top match. Each skill gets a lettered tile in its own steady colour; descriptions run to two lines.

**Recording.** While dictating, the composer's control row becomes the recording bar: attach and skills stay usable (files get picked mid-sentence); a red-tinted chip after them carries the dot, "Recording", timer and live waveform; voice mode and the main button step aside for Cancel (red ✕), add to text, and Send (the off-white main button). Holding the mic keeps it under the finger, lit red, with "release to send · slide off to cancel" in the chip. The floating recording pill above the box is gone.

**Working.** An orb in the agent's colour — an arc spinning around a breathing core — beside the word "Working". No timer. Only movement and fading animate. An installation that has set its own working image in branding keeps its image; the orb replaces the bundled default.

**Background work.** The lines for background sub-agents and background shells are no longer shown; everything underneath that tracks them stays in place so they can come back. The agent's task list stays, restyled to match, and sits above the floating composer.

## Philosophy

- The conversation is the content; chrome recedes, but never at the cost of knowing who is talking — the agent's colour on its bubbles is load-bearing.
- One thing per place: every floating control is one family; the composer is one card; the main button always means "the next thing".
- Don't make Ashley hunt: messages to her are read in place, unfolded, marked the same way the sidebar marks them, and the envelope takes her straight to them.
- Attention costs are earned: memory stays silent while there's room and gets loud only when it matters; the relay mechanism isn't something she should need to know about.
- Performance is part of the look: no persistent blur anywhere in the chat; animations are movement and fading only.

## Prior context

- Built on the campaign kit (foundation, sidebar, pane bar shapes). The tasting snippet at `workspace/tastings/convo/` (stylesheet + script) is the visual reference — six rounds with Ashley over the live app.
- Today: hue-glow gradient bubbles for both sides, a floating pill with glass history, a segmented memory meter with a reset button, a row of four buttons above the composer, a queue "+" notch, a dark flat strip around the composer, a dot-grid working image, folded DM cards with a DM pill / ⓘ / "notified".
- Research this session (2026-10-23): compaction is far less lossy than a year ago (bigger memory, models aware of their budget, the instruction file reloaded after compaction), but chat-only instructions, mid-task state and rules still get lost, and very long sessions still cost quality — so a quiet memory indicator plus deliberate fresh starts stays worth having.
- The 2026-10-17 performance pass removed persistent blurs from the chat (bubbles, rows, badge, jump button); no persistent blur has come back since.
- The app already records, per agent, when it last messaged Ashley over the relay and when she last saw that — the sidebar envelope runs on it; the jump-to-unseen uses the same record.

## What would make it wrong

- Agent bubbles losing the agent's colour, or a control borrowing the agent's colour as if colour meant an action.
- A message to Ashley folded away, or one she has to scroll to find after following the envelope.
- The memory indicator nagging while there's room, or staying quiet when it's nearly full.
- Any blur over the scrolling chat, or an animation that repaints while scrolling.
- Recording hiding attach or skills.
- A thumbs-up that requires clearing a draft.
- The phone feeling more cramped or showing less of a long agent reply than today.
- Anything removed (background lines, queue) taking its underlying machinery with it — sub-agent and shell tracking stays.

## Scope edges

- **In:** everything listed under Shape, phone and desktop, the conversation pane and relay-room pane.
- **Out:** widgets (Ashley is removing them); activity words in the working indicator ("Reading files…") — needs the server to report the agent's current step; its own piece later; retiring the word "DM" elsewhere in the app.
- **Designed in the build without another tasting, judged at close:** the permission bubble, the relay room's participant header, the task list line.
- **Deferred to after the campaign deploy (already logged):** modal sizing, look adjustments.

## Handoff notes

- Implementer: copper-box-maintainer-2, local only on `feat/tab-title-from-tmux` (campaign shipping rule — no push, no deploy until the campaign ends).
- Removing a visible control means an id-skill edit in the same change (task pill, stop / skills / thumbs-up / voice-mode buttons, context meter + reset, queue, recording, DM display); none of this is admin-only.
- What's-new: this campaign writes one note at campaign close (Ashley approves the text).
- The upstream desktop-pane bar (landed 2026-10-23) still needs the pane-bar look at the next rebase.

---

## Close-Out

**Closed:** 2026-10-24
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Pill, side buttons, bubbles, relay messages, agent cards, composer, memory, skills, recording, orb, back / jump / load older all restyled.
- **Header: solid neutral pill, colour ring on the picture, kit ⋯** — present
- **Header: floating family (side buttons, back, jump, load older)** — drifted · side buttons keep their green / amber fill and arrival glow; Ashley: keep (the colour is the message).
- **Header: jump to latest centred above the composer** — present
- **Header: quiet desktop sidebar toggle** — present
- **Edges: scroll under, darkening fades, no blur** — present
- **Messages: agent colour bubbles, neutral user bubbles, speaker-side corner, snug spacing, speak beside, code wells** — present
- **Messages to Ashley over the relay: open bubble + envelope, jump to oldest unseen + ring** — present
- **Messages between agents: folded neutral card, no DM pill / ⓘ / notified** — present
- **Relay rooms: name over agent-colour bubbles, pill participants** — present
- **Composer: one card, row order, neutral main button Send / Stop / 👍, 👍 or Stop beside Send while typing, queue gone** — present
- **Agent memory: pie bands 45 / 78, red edge, Start fresh pop-over** — present
- **Skills menu: search, Enter runs top, lettered tiles, two-line descriptions** — present
- **Recording: chip in the row, attach + skills stay, Cancel / add / Send, held mic red** — present
- **Working: agent-colour orb, no timer, custom branding image wins** — present
- **Background work: sub-agent / shell lines hidden, tracking kept; task list card** — present
- **Philosophy** — present · (side-button colour endorsed as above)
- **What would make it wrong: agent bubbles lose colour / a control borrows it** — present
- **What would make it wrong: a message to Ashley folded or hard to find** — present · a failed send was folded; fixed at close (open bubble, "not sent", no envelope).
- **What would make it wrong: memory nags or stays quiet when full** — present
- **What would make it wrong: blur or scroll-time repaints** — present
- **What would make it wrong: recording hides attach or skills** — present
- **What would make it wrong: thumbs-up needs the draft cleared** — present
- **What would make it wrong: phone more cramped** — present (by reading)
- **What would make it wrong: removals take their machinery** — present
- **Scope edges (out / designed in build / deferred)** — present
- **Handoff notes** — present · local only; id skill updated in the same change.

### Additions (in the result, not in the shape)

- Previously saved queued messages still show and send (nothing adds new ones) — endorsed-as-drift
- Relay-room participant pills show picture + name; roles / project in the tooltip — endorsed-as-drift
- Memory pie with Start fresh under each agent participant in relay rooms (replaces the old meter there) — endorsed-as-drift
- A failed message to Ashley was a folded "not sent" card — changed at close to an open bubble with a "not sent" mark

### Follow-ups

- Activity words in the working indicator ("Reading files…") — needs the server to report the agent's step; deferred (own piece of work).
- Desktop-pane bar (upstream 2026-10-23) needs the pane-bar look at the next rebase — deferred.

### Notes

Reviewer: the red memory pulse, the envelope-arrival ring and the side-button arrival glow animate a shadow (brief, on fixed controls, not the scrolling list). Desktop reading column 860 → 780.
