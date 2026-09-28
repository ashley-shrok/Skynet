# Shape: Interactive messages

**Opened:** 2026-09-27
**Vehicle:** GSD phases (multi-phase — 3 or 4 phases proposed below)

## What this is

A new kind of message an agent can send. Alongside the agent's normal words in a chat bubble, an interactive widget renders inline — a poll, a checklist, a form, a ranked list, a list of items with per-row actions, a color picker, or a custom widget the agent authors for a one-off need. Users click, tick, drag, or otherwise interact with it. When the interaction is terminal, an invisible message is written back into the conversation carrying the outcome and the agent wakes to it; when the interaction is ambient, the widget quietly persists state that the agent reads alongside the user's next text reply. The whole point is doing things that are easier or better than replying through plain text — if typing would be easier, the widget is wrong.

## Shape

**Widgets live where the agent lives.** Each widget is a small self-hosted app on the same box the agent runs on. It reuses the existing full-app machinery — durable service unit, discovery sweep, authenticated same-origin frame embed — but in its own separate folder root distinct from full apps, with its own durable-service naming prefix, and its own URL prefix. Widgets never appear as sidebar tiles; they only exist inside chat bubbles.

**Agents scaffold widgets via a new skill.** The skill ships opinionated common shapes as ready-to-drop-in templates — poll, checklist, form, list-with-per-row-actions, ranking, color picker — and also teaches agents to author custom widgets when the shape they want isn't in the set. The templates are the fast path; custom is the escape hatch. The design principle every template and every custom widget is measured against: every widget must earn its interactivity over a plain text reply.

**Three submit modes, agent-chosen per widget instance.** *Terminal-on-click* means the interaction IS the submit — poll rendered as buttons where clicking an option ends it, color picker rendered as swatches where clicking one ends it. *Terminal-on-submit* means the user assembles then hits one deliberate button — form, checklist, list-actions, ranking, or any template configured this way. *Non-terminal* means the widget contributes to a text reply that hasn't happened yet; state persists on every interaction; there is no submit inside the widget; the user's own text reply is what wakes the agent. Every template supports the non-terminal mode. Each template has a curated set of terminal modes it can additionally be configured in — the skill knows which combinations make sense and only offers those. The mode determines the widget's visual affordance: terminal-on-click renders as buttons (which read as active); non-terminal renders as radios or persistable selectors (which read as passive). Affordance and behavior always match.

**Triggering the embed.** The agent writes a specific anchor URL shape into their message. The frontend's URL-detection layer — the same one that already recognizes editable-file links and attaches a pencil affordance — extends to recognize widget URLs via a server-provided allowlist with a type discriminator ("file" gets the pencil, "interactive-message" gets swapped for an inline frame sized for chat flow). The frame retries loading for a few seconds after mount to cover the discovery-sweep gap between when a widget was scaffolded and when it becomes reachable.

**Multiple widgets per message are supported.** Each is independent — its own scaffold, state, mode, and lifecycle. Multi-terminal per message is possible but the skill instructs agents to prefer non-terminal when embedding multiple widgets in one message, so users don't inadvertently fire multiple submit-wakes with a single interaction.

**Submit routing.** When a terminal widget submits, it fires a signal out of its frame. The surrounding page translates that into a message written into the conversation, flagged to the existing invisible-message blacklist so the bubble list stays clean. The agent's session receives that as a normal wake and reads the widget's persisted state file directly from its own filesystem. The state itself is always on the agent's host — the invisible message just carries the wake ping, not the state contents.

**Lifecycle.** Agents lead: the skill teaches them to tear down a widget when they're done reading its state, and provides a one-command atomic teardown. As a backstop, any widget older than seven days is automatically torn down by a scheduled local sweep on the widget's host box. The skill explicitly names the seven-day rule to agents so an agent who sees a user-reported "the widget's broken" understands what happened and reconstructs the widget on their next reply. When a load ultimately fails after retries — because the widget expired or was already torn down — the frontend renders a small inline placeholder ("this widget expired — ask the agent to send it again if you still need it") that names the recovery path.

**Mobile is first-class.** The client isn't known in advance and mustn't be assumed to be desktop. Every template renders correctly on narrow screens and touch input, and the skill teaches the same discipline to agents authoring custom widgets. Ranking specifically renders both drag-handles and arrow buttons so it works on every input mode.

## Philosophy

- **Widgets are peers to the agent, not children of Skynet.** They live on the agent's host with the same capability set — network, credentials, filesystem access. This is deliberate: it's what lets an interactive message pull from any live source the agent has access to (a live query, an API, a running test), which was the load-bearing reason for hosting widgets on the agent's box rather than serving them from Skynet's own backend as static bundles.
- **Every widget earns its interactivity over a plain text reply.** If a plain text reply would be easier for the user, the widget is wrong. This is the filter for adding shapes later too.
- **Affordance matches behavior.** If a widget looks like a passive selector, it must not fire on click. If it looks like a button, it must act on click. A visual affordance that lies to the user is broken by construction, not just uncomfortable.
- **Agents lead lifecycle; timers are the safety net.** The primary teardown mechanism is the agent recognizing "I'm done" and calling teardown. The seven-day backstop exists for forgetful agents and abandoned conversations, not as the default cleanup path.
- **Opinionated presets, not open-ended authoring by default.** Common shapes are the fast path. Custom authoring is supported when presets don't fit, but the presets exist because widgets that fit standardized shapes are easier for users to recognize and interact with.
- **Widgets don't stream.** They render atomically. This matches the fleet-wide invariant that no message content streams anywhere.

## Prior context

Skynet already has a full-app model where each app is a long-running service on its home box, discovered by the fleet-status sweep, and embedded via an authenticated same-origin frame path. Full apps show up as sidebar tiles and open either in a new tab or in a side pane. Interactive messages reuse everything about this except the folder location, the durable-service unit prefix, the URL prefix, and the sidebar-visibility rule — separation clean enough that tools and users can tell the two concepts apart at a glance without confusion.

The message-rendering layer already scans agent messages for URLs and, based on a server-provided allowlist, decorates certain URLs with additional affordances (currently the editable-file pencil). Interactive-message URLs extend this same mechanism with a URL-type flag rather than inventing a parallel detection scheme.

Skynet already has a blacklist of message shapes that reach the backend but are not rendered in the visible bubble list (invisible wake and other cases). The submit-message routing extends that blacklist rather than inventing a new "hidden message" concept.

The role has extensive precedent for iframe embedding — drag pass-through, dark-mode injection, retry-on-load-fail, same-origin authenticated frames — that interactive messages reuse.

Widgets run on the agent's host, and the agent reads state directly via local filesystem access. No cross-machine RPC is involved in the data-return path; the invisible submit message only carries a wake signal.

## What would make it wrong

- **Widgets end up hosted on Skynet's own backend instead of the agent's host.** The whole capability ceiling — custom widgets that pull from live sources the agent has access to — collapses. The design rejected the light-backend-hosted variant deliberately for exactly this reason.
- **Users have to say "OK I filled it out" after interacting with a widget.** The terminal act belongs inside the widget, or the widget belongs in non-terminal mode. Requiring a text confirmation on top of a widget interaction is the design failing at its own principle.
- **The visible sidebar app-list starts showing widgets as tiles.** Full apps and widgets are separate concepts; if they bleed together the separation has broken.
- **A widget's visual affordance suggests one behavior but performs another.** Passive-looking radios that submit on click, or button-looking things that don't — either violates the affordance-matches-behavior rule and breaks user trust.
- **The user can't work productively on a phone or narrow window.** Mobile is a first-class client, not a stretch goal; a widget that only works on desktop is a widget that half the users can't use.
- **A widget older than seven days is still functional.** The backstop is load-bearing; without it, sprawl is unbounded. Widgets older than the backstop must be torn down.
- **The same template silently behaves differently across identical-looking bubbles.** Mode is per-widget-instance and the visual affordance follows the mode, so two "polls" that look identical must behave identically. Anything less breaks predictability.
- **Multi-widget messages that fire multiple terminal wakes for one user action become normalized.** The skill has to steer agents away from stacking terminal widgets in a single message; if that steering fails, wake spam becomes a routine problem.

## Scope edges

**In v1:**
- Six templates: poll, checklist, form, list-with-per-row-actions, ranking, color picker.
- Three submit modes: terminal-on-click, terminal-on-submit, non-terminal — per-template curated sets, agent picks per widget instance.
- In-bubble embed via anchor URL + server-provided allowlist with URL-type flag.
- Invisible submit-message routing via the existing message blacklist.
- Agent-side state reads via local filesystem.
- Agent teardown command bundled with the skill (one atomic call).
- Seven-day backstop timer as a scheduled local sweep on the widget's host.
- Expired-placeholder UI on load failure.
- Multi-widget per message.
- Custom-widget authoring instructions in the skill, with the "earns its interactivity" and mobile-friendliness disciplines taught broadly.
- Mobile-first-class rendering for every template.

**Out of v1:**
- Promotion of a widget to a full sidebar app. If an agent wants a full sidebar app they use the existing full-app skill; no cross-conversion mechanism.
- Conversation-cascade cleanup (deleting a conversation doesn't tear down its widgets in v1; the seven-day backstop handles them eventually).
- Cross-machine push signals for submit — v1 routes submit locally and via Skynet's message channel only.
- Idle-timeout cleanup for widgets younger than seven days.
- Manual "cleanup my widgets" UI for users.
- More templates beyond the six.

**Deferred / tempting but no:**
- Widget-to-widget interaction (widget A's state readable by widget B). Not needed — agents synthesize aggregates.
- Real-time collaborative widgets (two users editing at once). Not v1.
- Streaming widget updates. Never — matches the fleet-wide no-streaming rule.
- Cross-Skynet-instance widget sharing. The skill is fleet-distributed; individual widgets are per-host.

## Vehicle notes

Chosen vehicle: **GSD phases (multi-phase)**. The full scope is too big for a single phase to safely ship all at once; each of the phases below stands alone, delivers user-visible value, and composes into the whole picture. The user invokes the phase-management workflow to add each phase to the roadmap; each phase then runs its discuss → plan → execute cycle independently.

**Because the shape is settled here, each phase's discuss step should seed its context document directly from this shape file** rather than re-eliciting the design. The design decisions have already been made; discuss-phase for each phase should focus on the phase-specific "how" not the arc-wide "what".

Proposed phase breakdown:

1. **Plumbing + first template.** New folder root for widgets, sweep extension with type-tagging, forked URL prefix and its proxy path, server-allowlist type discriminator, in-bubble URL detection + frame swap, invisible-submit-message routing via the existing blacklist, agent scaffold command, and one template implemented end-to-end (poll in terminal-on-click mode). No lifecycle infrastructure yet — widgets accumulate. Goal: prove the whole loop works end-to-end.

2. **Templates + modes.** The other five templates (checklist, form, list-with-per-row-actions, ranking, color picker) and full mode flexibility (terminal-on-click / terminal-on-submit / non-terminal) with per-template curated mode sets. Multi-widget per message. Skill teaches modes and multi-widget guidance.

3. **Lifecycle + polish.** Agent teardown command, seven-day backstop timer as a substrate-distributed scheduled local sweep, expired-placeholder UI, skill names the seven-day rule to agents.

4. **Custom-widget authoring + mobile audit.** Skill instructions for agents to author custom widgets (persistence discipline, mobile-first-class discipline, affordance-matches-behavior discipline). Responsive verification across every template. Ranking's arrow-button touch fallback confirmed. May fold into phase 3 if scope allows.

Identity handoff: this shape was opened by corsair-box-maintainer on 2026-09-27. Any identity picking up any of the phases should read this shape file first — it's the settled design contract the phases execute against. Close-out via `/close interactive-messages` after the last phase ships.
