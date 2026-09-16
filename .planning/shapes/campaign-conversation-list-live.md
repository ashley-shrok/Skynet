# Campaign: the conversation list should open fully populated and never lag behind

**Opened:** 2026-09-16
**Status:** in_progress
**Workspace:** `/home/ubuntu/fleet/identities/pixel/workspace/.planning/shapes/`

## Concept

The conversation list is messy in two primary ways, and the user's framing is that
she wants the right pass taken at it rather than symptom patches — explicitly
including redoing pieces if that's what getting it right takes.

First, opening the app takes several seconds to settle. Some rows do appear
quickly, but they all arrive undressed — no colour, no avatar, no title, no task
— looking like ordinary terminal sessions for a few seconds before becoming
themselves. The user's stated bar: when you open the app you should see
everything populated already, fully, and then it's understandable if it takes a
couple of seconds for things created on *other* clients to appear or for
disk-side updates to catch up.

Second, the list isn't reactive. A conversation created in another client
instance, or an agent rewriting its own task description on disk, does not show
up until the page is refreshed. Her words: there's an obvious shape for what a
sidebar full of conversations should do, and this isn't hitting it — there's no
reason a conversation list needs to lag behind. Anything that changes while the
client is open should appear.

A third concern — what the experience should be on a genuinely slow first-ever
load with no cache, where real work has to happen before anything can be shown —
was raised and deliberately deferred. It only bites the first time anybody opens
the app, so it is not urgent, and it becomes its own chunk of work later.

## Success criteria

1. **Opening the app shows a fully-dressed list immediately.** Rows appear with
   their colour, avatar, title and task already on them — not as plain terminal
   sessions that dress themselves seconds later. The undressed window is gone,
   not merely shortened.
2. **Anything that changes while the client is open reaches the list without a
   page refresh.** Specifically: a conversation created on another client
   instance appears; a conversation that goes away disappears; an agent editing
   its own identity file on disk (task, title, colour) is reflected. A couple of
   seconds of lag for these is acceptable and expected.
3. **Returning to the app on the phone shows what is current.** Whether that is
   achieved by a fresh load or by resuming and catching up is an implementation
   choice, not a requirement — the requirement is that coming back never shows a
   stale list.
4. **Making the list live does not make the fleet poll materially more
   expensive.** The existing two-second-per-host pulse stays cheap in the steady
   state; expensive work happens only when there is evidence something actually
   changed.
5. **No regression in what the list already gets right.** Ordering, pinning,
   hiding, relay-room rows, and the per-session work indicators keep working.

## Prior context — how it works today

Established by reading the code this session, not assumed:

- **A row-set cache already exists** (`conversation-store.ts:1228`, read at
  `AppShell.tsx:726` before the network fetch). It remembers *which*
  conversations exist — names, ordering, last-message times — so rows paint
  fast. It stores nothing about appearance, which is why the fast paint is an
  undressed paint. The half-working cache is what makes the undressed state the
  guaranteed experience rather than an occasional one.
- **Cosmetics are fetched by a second request that queues behind the first.**
  The cosmetics request must name which identity lives on which host, and that
  mapping is derived from the session-list response, with an explicit guard that
  skips the request entirely while the mapping is empty
  (`identities-store.ts:274-277`). So it does not race the session list — it
  waits for it, then does its own SSH fanout. This ordering is the direct cause
  of the undressed window.
- **The session list is fetched exactly once per page load**, by deliberate
  design — a documented shape lock stating no polling, no interval, no refetch
  on focus (`AppShell.tsx:711-714`, empty dependency array at `:793`). Two
  features later got hand-wired exceptions (identity create, relay-room create).
  Nothing else re-asks, which is why the list freezes for the life of the tab.
- **A live channel already exists and already runs**, delivering per-session
  work state to the browser continuously, fed by a poller that visits every host
  every two seconds. But it is per-session, not per-list: it reports on sessions
  the client already knows about and signals when one is gone. Nothing in it
  creates a row, because rows are built purely from the one-shot fetch
  (`conversation-store.ts:695,734`). Cosmetics are not on this channel at all.
- **The per-host sweep already enumerates every identity folder** every tick
  (`substrate/scripts/fleet-status-sweep.py`), checking small sentinel files. The
  visit is already happening; only its scope is narrow.
- **There is no file-watching anywhere on the hosts.** Everything is discovered
  by polling and diffing server-side.
- **The live connection gives up permanently** after roughly half a minute of
  failed reconnect attempts — well inside the time a phone spends backgrounded.

The through-line: the transport for a live list already exists and is proven.
What is missing is scope — what the pulse looks at, and what it is permitted to
tell the client.

## Shapes

- **[declared] shape-conversation-list-dequeue-cosmetics** — Stop the cosmetics
  request from queueing behind the session-list request. The server already has
  the identity-to-host mapping when it answers the session list; having the
  client learn it and then ask again is a round-trip that exists for no reason.
  Either the session-list answer carries cosmetics, or cosmetics can be answered
  without being told the mapping. This alone removes the undressed window on a
  cold load. Contained, and it makes the next shape trivially correct. — status:
  in_progress
- **[declared] shape-conversation-list-cache-cosmetics** — Persist appearance
  alongside identity in the stored snapshot, so opening from cache looks
  finished rather than looking like plain terminals. Deliberately second: the
  cache's job is defined by what corrects it, so building it before the
  correction path means guessing. Small once the first shape has landed — the
  data is already flowing, it just isn't written down. — status: in_progress
- **[declared] shape-conversation-list-live-updates** — Make the list a live
  thing rather than a fetched thing, by widening what the existing two-second
  pulse reports and what it may say: appearing sessions create rows,
  disappearing sessions remove them, and changed identity files update
  appearance. Cost is controlled by a **timestamp gate** — the sweep already
  visits each identity folder, so it additionally reports when the identity file
  was last modified (cheap, fixed cost, no parsing); the server compares against
  the last timestamp it saw and only reads and parses the file when it actually
  changed, for that one identity on that one host. Steady state adds no parsing
  at all. Generalises past task text to colour and title for free, since they
  live in the same file. Needs a floor — a full re-read on the first tick after
  a fresh server start — so a missed change degrades to "slightly stale" rather
  than "permanently wrong". **Includes fixing the give-up-forever reconnect
  behaviour**, since returning-to-current on the phone depends on it. — status:
  in_progress

### Sequencing and why

De-queue first, then cache, then live. This is a deliberate reversal of the
first ordering proposed in concept-open (which put live first): de-queueing is
what actually kills the undressed window, it is the most contained of the three,
and it makes the caching shape nearly free afterwards. The live-list work is the
larger and riskier piece and benefits from the other two being settled first.

The phone requirement (criterion 3) is satisfied by the combination rather than
by any single shape: on return, paint from cache, reconnect the live channel, and
re-ask the server once for the current list. Correctness never rests on
reconciliation logic being perfect — the re-ask is the backstop — and it is the
same path as a cold open, so there is one path to build and one path to get
right instead of two.

## Side-bounties

Existing bounties in the role pool that this campaign overlaps. Each needs a
terminal state or an explicit link at campaign close.

- `client-cache-session-list` — the original "cache the session list for instant
  first paint" ask. Substantially delivered already by the existing row-set
  cache; this campaign completes it by covering cosmetics.
- `conversation-rows-render-colourless-silent-refresh-failure` — the
  stuck-forever form of the undressed-rows symptom. Partially fixed already
  (latch now spends only on success). De-queueing removes the class of bug
  rather than the instance, so this bounty's remaining open items should be
  re-checked against the new shape.
- `sidebar-fleet-sessions-refresh-after-identity-create` — one of the two
  hand-wired refresh exceptions; the birth-side half is still open. A live list
  makes the hand-wiring unnecessary, so this likely closes as superseded.
- `speed-up-pretty-view-initial-load` — the sibling complaint about opening a
  *specific conversation* being slow. Explicitly out of scope here (different
  surface) but shares the "first paint feels sluggish" family.
- `conversation-list-scroll-delay-on-load` — list unscrollable for seconds after
  load. Adjacent and may be a side-effect of the same load sequencing; worth
  re-testing once the first shape lands.

## Other work

- Deferred by explicit user decision: the slow-first-ever-load experience — what
  to show when there is no cache and real work must happen, and distinguishing
  "still looking" from "found nothing" from "couldn't reach some hosts". Today
  it is a single "Loading conversations…" line that flips to showing nothing on
  failure, indistinguishable from having no conversations. Becomes its own chunk
  of work later. — state: dropped from this campaign (deferred, not abandoned)

## Open questions

- Which de-queue mechanism is right: fold cosmetics into the session-list
  response, or make cosmetics answerable without the client-supplied mapping.
  Both remove the round-trip; the choice is about coupling and where the fanout
  cost lands. To be settled in the first shape session.
- Whether row appearance/disappearance should ride the existing live channel's
  frame set (which needs a schema revision) or arrive by a narrower addition.
  To be settled in the third shape session.
- Whether the timestamp gate needs a periodic full re-read beyond the
  fresh-start floor, or whether the floor alone is sufficient insurance.
