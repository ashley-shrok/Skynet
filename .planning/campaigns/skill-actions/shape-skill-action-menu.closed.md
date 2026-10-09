# Shape: some way to activate skills with mouse only — the skill action menu

**Opened:** 2026-10-09
**Vehicle:** inline

## What this is

A lightning-bolt button in the small button row above the compose box, just left of the thumbs-up. Tapping it opens a floating menu listing the skills on the box this agent runs on — the same set the Skills editor shows — each with its name and a one-line description. Tapping a skill sends it to the agent immediately as that skill's slash command, exactly the way the thumbs-up sends its canned reply. Skills become one-tap actions; an argument-free skill becomes a custom action button the user can author herself. The sidebar-footer button that opens the Skills editor changes from a wrench to the same lightning bolt so the two read as one concept.

## Shape

- **The button.** Lightning bolt, same quiet look as the thumbs-up and stop buttons, sitting immediately left of the thumbs-up. Appears only in agent conversations (the whole row is already absent in relay rooms). Appears only once the app knows this box has at least one skill — no known skills, no button. Disabled in exactly the moments the thumbs-up is disabled (reset in flight, reconnecting, aside active).
- **The menu.** A floating panel anchored just above the button (below it if there's no room above), on desktop and phone alike — on a phone it is nearly full-width and thumb-scrollable. One flat alphabetical list, no sections, no grouping, no folding. Each row: the slash-name in bold, the one-line description beneath in smaller muted text, truncated to one line. Tapping outside or pressing Escape closes it; tapping the button again closes it.
- **What's listed.** Exactly the skills the Skills editor lists for that box: everything in the user's skills folder on that box except the ones the fleet distributor manages. Skills flagged "slash command only" are included (they are slash-invokable by definition). Claude Code's own built-in commands are not listed.
- **Tapping a skill.** Closes the menu and sends that skill's bare slash command as the user's message, through the same path as the thumbs-up: the view jumps to the bottom, whatever the user had typed in the compose box stays there untouched, a failed dispatch shows the same "not connected" message. The sent message renders as the same command pill a typed slash command produces today.
- **Where the list comes from, and freshness.** The skill list (name plus one-line description) is fetched from the box. The browser remembers the list per box, across reloads. Opening a conversation on a box fetches that box's list in the background (once per box per app load), so the button and list are ready before the user reaches for them. Each menu open shows the remembered list instantly and quietly refreshes it in the background, so a freshly created skill appears by the next open. A failed fetch leaves whatever was remembered in place, silently.
- **Footer icon.** The sidebar-footer Skills-editor button's wrench becomes the lightning bolt. Nothing else about that button or the editor changes.
- **The id skill** (the fleet-distributed guide every agent loads) is updated in the same change: the new button and its behavior in the compose-area description, and the footer icon description changed from wrench to lightning bolt.

## Philosophy

Skills are actions you take in the app, not text you type. This is the thumbs-up generalized: one tap, it fires, nothing else asked of you. Deliberately simple v1 — no curation, no choosing, no stars, no folding, no arguments. Features get added when their absence is actually felt, not in anticipation. Anything that turns the tap into a multi-step interaction (confirm dialogs, argument prompts, insert-then-edit) violates the spirit of it.

## Prior context

Today the only ways to run a skill are typing the slash command or speaking "slash <name>" in voice mode. The compose box has no slash picker. The Skills editor (behind the footer wrench) is edit-only and tells the user to type the name. The app can already fetch a box's skill names (minus distributor-managed ones) for that editor, but not descriptions. The thumbs-up is the model this copies: a quiet button in the row above the compose box that sends a canned message and leaves the user's draft alone. A type-ahead slash autocomplete is planned separately for later and is what covers the "I want to add text after the command" case.

## What would make it wrong

- Tapping a skill does anything other than send it at once — a confirm, an insert into the compose box, a prompt for arguments.
- The menu shows a loading line or spinner in normal use, or the button flickers in and out as lists load.
- The list diverges from what the Skills editor shows for the same box (distributor-managed skills leak in, or real ones go missing).
- The user's half-typed message is disturbed by firing an action.
- The menu is unusable on a phone (clipped off-screen, too small to tap, can't scroll).
- The footer still shows a wrench, or the id skill still describes the wrench / doesn't know the button exists.

## Scope edges

- **In:** the button, the menu, the descriptions on the skill list, the per-box remembered list with background fetch on conversation open and refresh on menu open, hide-when-no-skills, wrench → lightning bolt, the id-skill update, tests covering all of it.
- **Out:** stars, favourites, curation, recently-used ordering; grouping or folding (GSD is going away anyway); search/filter in the menu; long-press or insert-into-compose; arguments; Claude Code built-in commands; relay rooms; queued-message slots.
- **Deferred:** type-ahead slash autocomplete in the compose box (separate future work). Stars, if the pull is felt later.
- **Elsewhere in this campaign:** the voice "slash <multi-word name>" fix is a separate Other-work item, not part of this shape.

## Vehicle notes

Inline in this session by garnet-box-maintainer-2, by the user's choice (she is evaluating model performance and wants the work done directly rather than via GSD). Track pieces with harness tasks. Standing box-maintainer rules apply: scoped tests during work, structured logs at the fetch / cache / send boundaries, backend changes need the backend build check, and nothing is pushed or deployed without the user's explicit greenlight. The id skill lives in the repo's substrate skills folder — edit there, never the installed copy. Tasting snippet that the user approved visually: workspace/tasting/skill-actions-taste.js (minus its stars and GSD fold, both dropped).

---

## Close-Out

**Closed:** 2026-10-09
**Vehicle used:** inline (in-session by garnet-box-maintainer-2; no GSD)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Lightning-bolt button left of thumbs-up opens the box's skills with descriptions; a tap sends /<name> via the thumbs-up path; footer wrench is now a lightning bolt.
- **Shape: The button** — present · Same quiet look, immediately left of thumbs-up, agent conversations only, hidden until skills are known, disabled on thumbs-up's exact conditions.
- **Shape: The menu** — present · Above the button (flips below), flat alphabetical, bold name + muted one-line description, closes on outside tap / Escape / re-tap, scrolls. Reviewer flagged the phone width as only ~80% of a typical phone; user chose to widen it, and it now spans the screen minus small gutters on phones.
- **Shape: What's listed** — present · Same listing and distributor-managed filter as the Skills editor; slash-only skills included; no built-ins.
- **Shape: Tapping a skill** — present · Closes and sends through the thumbs-up path; draft kept, jump to bottom, same failure message, command pill.
- **Shape: Where the list comes from, and freshness** — present · Descriptions from the box; remembered per box (and per user) across reloads; background fetch once per box per app load; refresh on each menu open; failures keep the remembered list.
- **Shape: Footer icon** — present · Only the icon changed.
- **Shape: The id skill** — present · Substrate copy updated: new button entry, footer icon, voice-button neighbour text, changelog line.
- **Philosophy** — present · One tap fires; no confirm, arguments, curation, stars, folding, search.
- **Prior context** — present · Builds on the editor's skill listing; copies the thumbs-up model.
- **What would make it wrong: tapping does anything other than send at once** — present · Direct send.
- **What would make it wrong: loading line/spinner or button flicker** — present · No loading UI; button only renders from a known list.
- **What would make it wrong: list diverges from Skills editor** — present · Same endpoint, same filter.
- **What would make it wrong: half-typed message disturbed** — present · Same path as thumbs-up; tested.
- **What would make it wrong: menu unusable on phone** — present · Viewport-capped, edge-padded, larger rows, scrolls; now nearly full-width.
- **What would make it wrong: footer wrench / id skill stale** — present · Both updated.
- **Scope edges** — present · All In items present with tests; no Out items; voice fix untouched.

### Additions (in the result, not in the shape)

- Hovering a truncated description shows the full text as a tooltip (desktop only) — endorsed-as-drift
- Implementation details: remembered list scoped per user as well as per box; server caps descriptions at 500 chars; log lines at fetch / refresh / fire — endorsed-as-drift

### Follow-ups

- Voice "slash <multi-word name>" fix — deferred (campaign Other-work item, outside this shape)

### Notes

Phone-width partial was resolved in-session before archiving (user: "thumbs up" to widening it and keeping the tooltip).
