# Shape: conversation list — flat, recency-sorted, messaging-app model

**Opened:** 2026-08-14
**Vehicle:** GSD phase

## What this is

The conversation list stops being organized by host. Instead, running sessions
are shown as one flat list, ordered by most recent message activity, in the same
shape a modern messaging app uses. Pins remain the way to keep something at the
top regardless of activity. Remote-desktop sessions stay in their own section at
the bottom of the list, as a stable landmark you can always return to. A search
input is always present at the very top of the list but lives just out of view
under the panel header on cold load — scrolling up reveals it and lets you
narrow the list by typing part of a row's visible label.

## Shape

- **The middle of the list is flat and recency-sorted.** Everything that is
  neither pinned nor remote-desktop sits in one list, ordered by most recent
  message activity — the freshest interaction floats to the top, older
  interactions sink. There is no host grouping in this section, no per-host
  separator, no strict per-identity order. Just one column of rows sorted the
  way a messaging app sorts.

- **"Activity" is a message either direction, and only that.** A message you
  sent, or a message the agent sent back to you, both float the row. Tool-use
  chatter, streaming ticks, lifecycle events like a session going down and
  coming back up — none of that touches the sort. If nothing observable to you
  crossed the wire, position does not change.

- **Rows with no message history at all float to the top.** A truly-new
  session that has never exchanged a message yet is an exception to the
  recency rule: it sits above everything with actual history, so a fresh
  session doesn't sink to the bottom just because it has nothing to sort by.

- **Pins are the only stickiness mechanism.** If you want a row to hold a
  fixed spot regardless of activity, you pin it. The pinned rows cluster at
  the very top of the list. Within the pin cluster, the ordering is the same
  stable rule the list uses today (the pre-existing ordering that gives every
  row a fixed relative spot) — so pinned rows themselves don't shuffle when
  they receive activity; they stay findable.

- **Remote-desktop sessions live in a section at the bottom.** They are their
  own zone under the flat recency list. Internally that section uses the same
  stable ordering as pins, for the same reason — remote-desktop is a landmark
  you visit rarely, and you want it to look the same each time. When there
  are zero remote-desktop sessions running, the section header does not
  render at all — no empty placeholder.

- **The ready-dot appears on every row, uniformly.** No row-state distinction
  between "background" and "actively worked" anymore. The old visual
  recession that made background rows look dimmer is retired. Position and
  the ready-dot together carry the entire "where should I look next" story
  for the list.

- **Search input lives at the very top of the list, hidden on cold load.**
  The input is always in the DOM at the top of the list. On the app's first
  render of the list, the scroll position is set so the input sits just out
  of view behind the panel header. Scrolling up reveals it — on any platform,
  no separate mobile vs. desktop shape. After that first cold-load hide, the
  list's scroll position is left alone; opening and returning to the panel
  does not reset it.

- **Typing in search flattens everything down to matches.** The filter
  matches against whatever text is visible in a row's label. Content inside
  message bubbles is not searched — only labels. While a filter is active,
  the pinned zone, the flat middle, and the remote-desktop section all
  collapse into one list of matches; sections and pin priority are not
  preserved during search. Clearing the filter restores the normal three-zone
  view.

- **Reordering on activity is a snap, not an animation.** When a row jumps
  because a message just landed, it moves instantly without a slide
  transition. Provisional call — if it feels disorienting in practice, we
  reconsider then; not now.

## Philosophy

The previous shape (Phase 7) explicitly said "no recency shuffle, host-grouped,
strict order." That was the right call at the time, because the sidebar the
list replaced was host-organized and Ashley's mental model was still "which
box is this on." Since then, she works from her phone almost exclusively, and
her mental model has shifted to "who did I last talk to" — which is what
messaging apps optimize for. The shape follows the mental-model shift.

This is deliberately taking the messaging-app default and not inventing a
Skynet-specific twist. Rows float on message activity. Pins keep favorites
sticky. Search filters by label. Remote-desktop is the one landmark that
resists the sort, because it's the one section she visits rarely enough that
finding it in a shuffling list would frustrate her.

What this is deliberately NOT doing:

- Not indexing message bodies for search. That's a much bigger commitment
  (indexing pipeline, freshness rules, how far back) and label search covers
  the "find the conversation quickly" job.
- Not keeping closed conversations in the list. The list continues to
  represent currently-running sessions only; when a session stops, its row
  goes away. This shape does not extend the list's scope in time, only
  changes how running sessions are ordered.
- Not adding secondary stickiness beyond pins. No "recent 5" bucket, no
  "you were just here" indicator, no favorites-plus-pins two-tier system.
  Pins are the sole affordance for "keep this at the top."
- Not preserving the ambient-recession visual. That was a Phase 6/7 concept
  that answered "which of these am I paying attention to." Position + the
  ready-dot together do that job now, and a third visual axis is redundant.

## Prior context

- The current list is a fleet-native, host-grouped view that shipped with
  Phase 7 (July 21 shape, `shape-fleet-native-conversation-list.md`). Rows
  are the fleet's currently-running tmux sessions, always visible whether or
  not the browser tab has "opened" them. That data-source shape stays. This
  shape only changes how those rows are ORDERED.
- Pins were introduced then and already work as a "float this to the top"
  mechanism. The stable per-row ordering that pinned rows use is the same
  ordering the whole list uses today — this shape scopes that ordering down
  to just pins and remote-desktop, and hands the middle over to recency.
- The ready-dot was originally gated to "active-set only" and only visible
  when a row was in the small set Ashley was actively working. That gate was
  removed in patch #447 (August 14) — dots now render on any row that isn't
  currently working. This shape formalizes that direction and retires the
  ambient-recession visual entirely, so all rows carry the same visual
  weight.
- Identity sessions on this fleet run permanently via an agent-supervisor
  script that lives outside Skynet — those rows are effectively always
  present. Non-identity sessions come and go with their tmux lifecycle.
  Both kinds live in the same flat middle; recency treats them identically.

## What would make it wrong

- **If active or noisy agents dominate the top of the list.** The whole
  point of the sort is "who did I last talk to," not "who is the busiest
  right now." If tool-use chatter, streaming ticks, or any signal that
  isn't a discrete inbound-or-outbound message ends up floating rows, the
  list becomes a slot machine and the change has missed the point.
- **If a truly-new session with no history ever sinks to the bottom.** The
  no-history-to-top exception exists so fresh sessions are findable. If
  the sort naively picks "no activity = older than everything," a new
  session appears in a spot no one thinks to look.
- **If pins or remote-desktop rows visibly shuffle while you're using
  them.** The whole reason they are held out of the recency sort is
  stability. If they end up sorted by activity because the "sort the whole
  list by recency" pass didn't respect zones, the change has silently
  taken away the landmark property.
- **If search only reveals when you swipe past some invisible threshold
  and users on desktop can't figure out how to trigger it.** The pattern
  is "scroll up on the list reveals it." If desktop's list is short enough
  that "scroll up" isn't a natural gesture, or the search input is
  visually hidden even when technically-scrolled-to, the affordance is
  effectively invisible.
- **If typing in search preserves the section structure and confuses
  filter results.** The agreed model is filter-flattens. If pins float
  above matches, or the remote-desktop section header appears above its
  matches, the filter is doing something more clever than agreed and
  probably worse.
- **If the ready-dot's meaning drifts because of the visual retirement.**
  All rows uniform means the dot is the sole "come look" signal for every
  row. If the dot's rules change silently as part of retiring the
  recession visual, a whole class of "why isn't this showing me anything"
  bugs opens up.
- **If the initial-scroll-hides-search rule fires more than once per
  cold load.** The rule is one-shot at the app's first mount of the list.
  If it fires on every panel-return or every re-render, the list keeps
  jumping under the user.

## Scope edges

**In:**

- Retire host grouping in the middle of the list; adopt recency sort.
- Introduce the pin zone at the top and the remote-desktop zone at the
  bottom, both using the existing stable order internally.
- Adopt "message-either-direction" as the sole activity signal for recency;
  ignore lifecycle events, tool-use chatter, and streaming ticks.
- Truly-new-session exception (no history → top).
- Retire the ambient-recession visual so all rows carry the same weight.
- Add the search input at the top of the list, hidden by scroll on cold
  load, revealed by scrolling up.
- Filter that collapses zones and matches against visible row labels only.
- Snap reordering on activity (no animation for now).
- Hide the remote-desktop section header when there are zero remote-desktop
  sessions.

**Out:**

- Searching inside message bodies.
- Persisting closed sessions in the list.
- Any secondary stickiness beyond pins.
- Any change to how sessions are discovered or which sessions belong in the
  list (data-source shape stays exactly as Phase 7 established).
- Animation shape for the reorder (locked as snap for now; revisit only
  if it feels wrong).

**Deferred (revisit if the shape lands and something feels off):**

- Reorder animation, if snap feels disorienting after real use.
- Empty-remote-desktop-section header behavior, if you want a visible
  landmark even when empty.
- Search behavior on very short desktop lists where "scroll up" isn't a
  natural gesture (may need an explicit reveal affordance).

**Tempting but no:**

- Grouping matches under section headers during filter (rejected: filter
  flattens).
- A separate mobile vs. desktop search-reveal pattern (rejected: uniform
  scroll-up on both).
- A dedicated "recently active" badge in addition to the dot and position
  (rejected: dot + position are enough).
- Reintroducing any visual dimming to convey "background" (rejected: the
  retirement of ambient-recession is deliberate and load-bearing).

## Vehicle notes

Chosen vehicle: **GSD phase.** Sized appropriately — this touches the sort
model, adds a new always-in-DOM input with a scroll-reveal pattern, adds a
filter pass across three zones, retires a visual axis, wires reorder to
message events, and needs coverage. It is exactly the kind of coordinated
multi-surface work that fleet directive #218 says "if the work is
phase-sized, the phase entry is table stakes."

Handoff to the planner:

- The prior conversation-list shape (`shape-fleet-native-conversation-list.md`,
  Phase 7) is the layered foundation. Its data-source model, its
  session-persistence contract, its list-of-currently-running-sessions
  scope — all still apply. Only the ordering rules and the search
  affordance change.
- Patch #447 (recent, August 14) already removed the active-set gate on
  the ready-dot. The current live behavior — dots on all non-working
  rows — matches what this shape assumes. The role-file description of
  the OLD dot semantics is stale (pending re-ask to update) but should
  not be treated as design authority; the code and this shape agree.
- Patches #450 / #451 / #452 (all same-day, tina) refined the bubble
  chrome adjacent to this surface — assistant bubble bottom-padding
  match, prose margin strip on last-content-paragraph, and between-bubble
  spacing halve. Aesthetic-adjacent to this work but functionally
  separate; no interaction to design around.
- Identity: this work happens under this identity (tina, box-maintainer
  of the Skynet EC2 that hosts the app at term.gigaashley.click). The
  container-mutation coordination protocol in the role file applies to
  every deploy motion (BEFORE announce in the box-maintainer coord room,
  ship, AFTER announce).
