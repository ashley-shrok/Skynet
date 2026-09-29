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

## Post-launch refinements (2026-09-28)

The v1 phases 138–142 shipped as designed. Two things surfaced during the user's first live use that shifted the shape enough to record here.

### Submit envelope

The initial submit-message routing (shape §"Submit routing") described "fires a signal out of its frame [...] translates that into a message written into the conversation, flagged to the existing invisible-message blacklist." At ship time this landed as a `/widget-submit <id> <val>` slash-command shape written into the session — which Claude Code's slash-command handler ate as an unknown command and dropped.

Fix: the submit signal is now a `<task-notification>` envelope wrapping the wake ping, matching the ambient-monitor's existing envelope shape that Claude Code recognizes natively. `sendInput` gained a `skipTagNeutralize` param so the envelope tag survives to CC intact. The parser gained `isWidgetSubmitEnvelope` so wrapper-only user turns for widget submits are labeled/passed-through instead of skipped; the send-watchdog gained a `bodyKind: "compose" | "envelope"` field so the FIFO walks past head-of-queue entries with the wrong kind. This fixed a double-wake bug where the envelope arrived, parser skipped it, watchdog full-resend duplicated the wake 5.5s later.

Regression coverage: 4 tests in `pv-send-watchdog.test.ts` covering envelope-doesn't-clear-compose, compose-doesn't-clear-envelope, envelope-clears-envelope, and mixed-queue walk-past-head.

### Widget viewport model

The original shape didn't specify how a widget's iframe should size itself. v1 rendered every widget at a fixed 200px iframe height, which silently clipped taller content (4-option polls showed only 3 options with no scroll affordance). The container's overflow-indication story was also unspecified.

Refined model, owned entirely by the parent `WidgetBubble`:

- **Iframe auto-sizes to content.** Widget reports its `document.documentElement.scrollHeight` via a `widget-resize` postMessage (initial + on ResizeObserver ticks). Parent listens, clamps into [40, 480]px, applies the height with a 120ms ease-out transition. Widgets shorter than 480px render at their natural size; nothing wasted.
- **Cap at 480px + parent-side scroll thumb.** When reported height exceeds 480, the parent's outer wrapper caps at max-height 480 and scrolls its iframe child. Modern Chromium's overlay-scrollbar mode auto-hides native scrollbars even under aggressive `::-webkit-scrollbar` styling (confirmed via live `!important` override), so the parent hides the native scrollbar entirely (`widget-scroll-wrapper` utility class) and paints a DOM-based always-visible thumb on the wrapper's right edge that tracks scrollTop on scroll + ResizeObserver.
- **Carded frame** on the outer container: 1px `rgba(255,255,255,0.14)` border + `rgba(255,255,255,0.04)` background + `rounded-lg` + `overflow-hidden`. Widgets read as embedded controls, not as detached iframes.
- **Widget bodies are transparent.** `html, body { background: transparent }`; content sits directly on the card's bg tint. Removes the "widget is its own opaque box floating in the bubble" feel — widget flows into the bubble color.
- **Widget authors touch zero overflow-UI code.** Templates only need transparent bg + resize reporter (both trivial). Cap, thumb, card, and scrolling all live in the parent — custom widgets get the same UX for free by adopting the two primitives.

### Ancillary polish

- **Expired-widget HTML.** The pane router's 404-JSON response body ("widget is not currently serving on a port") used to render as raw JSON in the iframe — no error event fires on a 404 with a body, so `WidgetBubble`'s retry+expired path never ran. The router now returns a small styled HTML expired-message that renders inside the parent's carded frame and auto-reports its own height.
- **No-cache on proxy responses.** `/interactive/*` and `/apps/*` proxy responses set `Cache-Control: no-store, must-revalidate` so agents editing a widget's or app's files are reflected on the user's next iframe reload without a hard-refresh. Widgets are small; the fetch cost is negligible.
- **Post-click ✓ confirmation.** Terminal-on-click templates (poll, color-picker) now show an explicit "you're done" state on successful `/submit` fetch resolve: checkmark on the selected button/swatch + success-colored status text. The button-turning-blue-and-disabling signal was too subtle on its own.

### Deferred (not in v1, not in this refinement pass)

- **Live-reload signal from server → frontend.** No-store cache handles agent-edit propagation on next reload, but doesn't push updates. A websocket/SSE notify-on-change would be cleaner UX but is a separate phase.
- **id-skill update covering the widget UX.** Role directive says user-facing app changes require matching `substrate/skills/id/SKILL.md` edits. The interactive-messages arc IS user-facing and id skill doesn't cover it yet. Own phase.

---

## Close-Out

**Closed:** 2026-09-29
**Vehicle used:** GSD phases (multi-phase) — five phases 138-142 shipped end-to-end, plus a small post-launch docs commit to the id-skill (accepted-as-drift in lieu of the deferred "own phase")
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — inline interactive widget alongside agent's words; click/tick/drag/fill; terminal wake vs non-terminal ambient state; earns interactivity over plain text** — present · Widgets embed inline via anchor URL in message body; terminal-mode fires wake envelope on submit; non-terminal persists state read alongside next text reply; SKILL.md leads with the "earns its interactivity" filter.
- **Shape — widgets live where the agent lives; separate folder root, durable-service prefix, URL prefix; never sidebar tiles** — present · `~/fleet/interactive-messages/<slug>/`, `im-<slug>.service` systemd user unit prefix, `/interactive/` URL prefix, separate `getWidgetSnapshot()` distinct from `getAppSnapshot()`; no widget path into sidebar tile rendering.
- **Shape — scaffold via new skill with opinionated templates + custom escape hatch** — present · interactive-messages skill ships six preset templates + explicit custom-widget authoring recipes A and B; "earns its interactivity" filter applied both to presets and custom.
- **Shape — three submit modes, agent-chosen per widget instance; every template supports non-terminal; per-template curated terminal sets; affordance follows mode** — present · `--mode` dispatcher resolves to `templates/<template>-<mode>/`; 12 template folders (6 templates × 2 modes each = terminal default + non-terminal); `is_supported_combo` enforces curated set; terminal-on-click renders as buttons, non-terminal renders as radios/checkboxes.
- **Shape — triggering the embed via anchor URL + server-provided allowlist with type discriminator; retry loading to cover sweep-discovery gap** — present · `INTERACTIVE_MSG_URL_RE_CLIENT` extends the existing URL-detection layer; eligibility map values are `'file' | 'interactive-message'`; WidgetBubble retries with exponential backoff (2s/4s/8s, 3 attempts) before flipping to expired-placeholder.
- **Shape — multiple widgets per message supported; skill steers agents to non-terminal for multi-widget** — present · SKILL.md "Multi-widget per message" section carries the explicit recommendation; `WidgetBubble.multi-mount.test.tsx` verifies mount independence.
- **Shape — submit routing: signal out of frame → invisible message via blacklist; agent reads state directly from filesystem** — present · Post-launch refinement: signal now carried as `<task-notification>` envelope (not slash-command) which Claude Code recognizes natively; sendInput gained skipTagNeutralize, parser gained isWidgetSubmitEnvelope, watchdog gained bodyKind FIFO; agent reads `~/fleet/interactive-messages/<slug>/state.json` directly.
- **Shape — lifecycle: agent leads with one-command teardown; seven-day backstop; skill teaches the rule; expired-placeholder UI on load failure** — present · `teardown-widget.sh` does atomic stop+disable+rm+daemon-reload; `interactive-messages-gc.py` + `.service` + `.timer` distributed via catalog and enabled by run-bootstrap; SKILL.md "Seven-day backstop" section names the rule and the "reconstruct on next reply" recovery.
- **Shape — mobile is first-class; ranking has both drag-handles and arrow buttons** — present · Every template has explicit Mobile section (44px min touch targets, single-column stacking); ranking widget has both drag-handles and arrow buttons with arrows called out as intended primary interaction on mobile; `mobile-audit.test.sh` gates the discipline.
- **Philosophy — widgets are peers to the agent with full capability set** — present · `server.py` runs on agent's box via systemd user unit; no cross-machine RPC; state.json read via local filesystem.
- **Philosophy — every widget earns its interactivity** — present · Stated in SKILL.md overview, per-template "Do NOT use it when" guidance, and made mandatory-discipline for custom widgets.
- **Philosophy — affordance matches behavior** — present · Explicit "Affordance rule" block on every template; terminal-mode templates render buttons/swatches, non-terminal templates render radios/checkboxes/inputs; only `/update` (never `/submit`) fires from non-terminal widgets.
- **Philosophy — agents lead lifecycle; timers are the safety net** — present · SKILL.md lifecycle section positions `teardown-widget.sh` as primary; seven-day GC framed as backstop for forgetful agents.
- **Philosophy — opinionated presets, not open-ended authoring by default** — present · Six presets are the fast path with dedicated per-template reference sections; custom-widget authoring recipes explicitly framed as escape hatch.
- **Philosophy — widgets don't stream (atomic render)** — present · Explicit "No streaming" mandatory discipline for custom widgets; `mobile-audit.test.sh` grep-checks against EventSource / WebSocket / setInterval markers.
- **Prior context — reuses full-app machinery, URL-detection layer, invisible-message blacklist, iframe embedding precedent** — present · `im-pane-router.ts` is a near-verbatim sibling of `app-pane-router.ts` reusing auth/CSRF/tunnel/proxy factory; URL detection extends the existing eligibility Map with a type discriminator; render-blacklist gate covers widget-submit envelopes.
- **Scope v1 — six templates, three modes, in-bubble embed, invisible submit routing, filesystem state, teardown command, seven-day timer, expired UI, multi-widget, custom authoring, mobile-first** — present · Every v1 line item is delivered — count-matched against the shape's In-v1 bullet list.
- **Scope v1-OUT — promote-to-app; conversation-cascade cleanup; cross-machine push; idle-timeout <7d; manual cleanup UI; more templates** — present · No promote-to-app path; no conversation-cascade hook; no cross-machine push signal for submit; no idle-timeout under 7 days; no user-facing cleanup UI; no seventh template.
- **Scope deferred — widget-to-widget; real-time collaborative; streaming; cross-Skynet sharing** — present · None of these appear in shipped code.
- **What would make it wrong: Widgets end up hosted on Skynet's own backend instead of the agent's host** — present · `server.py` binds `127.0.0.1:$PORT` on the agent's box; Skynet only proxies via SSH tunnel; state.json lives on agent host.
- **What would make it wrong: Users have to say "OK I filled it out" after interacting** — present · Terminal-mode widgets fire postMessage → envelope wake internally; no user text confirmation required; SKILL.md failure-modes list explicitly forbids this pattern.
- **What would make it wrong: The visible sidebar app-list starts showing widgets as tiles** — present · Sidebar uses `getAppSnapshot()` only; widgets live in the separate `getWidgetSnapshot()` map; grep of sidebar shell shows no widget references.
- **What would make it wrong: A widget's visual affordance suggests one behavior but performs another** — present · Terminal-on-click templates render active buttons/swatches that submit on click; non-terminal templates render passive radios/checkboxes/inputs that only `/update` and never fire postMessage.
- **What would make it wrong: The user can't work productively on a phone or narrow window** — present · Every template has an explicit Mobile section with 44px min touch targets; ranking has arrow-button fallback for touch; `mobile-audit.test.sh` enforces the discipline.
- **What would make it wrong: A widget older than seven days is still functional** — present · `interactive-messages-gc.py` sweeps `~/fleet/interactive-messages/*/` daily via systemd user timer; tears down anything with metadata.json.created_at older than 7 days by shelling to `teardown-widget.sh --force`; distributor catalog + run-bootstrap wire this on every managed host.
- **What would make it wrong: Same template silently behaves differently across identical-looking bubbles** — present · Mode is per-widget-instance via `--mode`; `templates/<template>-<mode>/` resolution is explicit; affordance follows mode (buttons for terminal, radios for non-terminal) — visual language never ambiguous.
- **What would make it wrong: Multi-widget messages fire multiple terminal wakes for one action** — present · SKILL.md "Multi-widget per message" section carries the explicit "use --mode non-terminal for all of them" rule with worked example; "What you must NOT do" bullet forbids mixing terminal with any other widget in one message.
- **Post-launch refinement — submit envelope** — present · `task-notification` envelope wraps the wake ping; `sendInput.skipTagNeutralize` preserves the tag to CC; `isWidgetSubmitEnvelope` parser predicate; `pv-send-watchdog` bodyKind: 'compose' | 'envelope' with FIFO walk-past-head; 4 regression tests in `pv-send-watchdog.test.ts`.
- **Post-launch refinement — widget viewport model** — present · Iframe auto-sizes via widget-resize postMessage clamped to [40, 480]; 120ms ease-out transition; carded outer wrapper with white/14 border + white/04 bg + rounded-lg + overflow-hidden; transparent widget bodies; DOM-based fake scroll thumb via `widget-scroll-wrapper` utility class.
- **Post-launch refinement — expired-widget HTML** — present · `im-pane-router.ts` `sendExpiredHtml()` emits styled HTML with transparent body and auto-height-report on port-lookup miss.
- **Post-launch refinement — no-cache on proxy responses** — present · `Cache-Control: no-store, must-revalidate` on `/interactive/*` responses in `im-pane-router.ts`.
- **Post-launch refinement — post-click ✓ confirmation on terminal-on-click templates** — present · poll-terminal-on-click and color-picker-terminal-on-click `widget.html` render `.btn.submitted::before { content: '✓' }` + success-colored status text on fetch resolve.
- **Post-launch deferred — live-reload signal from server → frontend** — present · No websocket/SSE change-notify shipped; no-cache handles the propagation-on-reload case as the shape's refinement pass called out.

### Additions (in the result, not in the shape)

- id-skill "Interactive messages (widgets in chat bubbles)" subsection was delivered via a small direct docs commit today rather than through its own phase as the shape's Deferred list scoped it — endorsed-as-drift

### Follow-ups

- Live-reload signal from server → frontend (websocket/SSE notify-on-change) — cleaner UX than no-store cache on reload, but a separate phase — deferred

### Notes

Every shape facet — What this is, Shape, Philosophy, Prior context, all eight failure modes, all v1 In/Out/Deferred edges, and every post-launch refinement including the deferred live-reload signal — is faithfully reflected in the shipped material. The arc holds together across five phases (138-142) plus the two post-launch refinement threads recorded on the shape. Nothing in the material contradicts or quietly extends beyond the shape apart from the single endorsed-as-drift item (id-skill subsection delivered as docs commit rather than as its own phase). Notable engineering surprises worth carrying forward: (a) the `/widget-submit` slash-command → `task-notification` envelope pivot required non-trivial FIFO-splitting in `pv-send-watchdog` to avoid a double-wake bug — a good pattern to remember when introducing new user-turn categories; (b) the widget viewport model landed as a parent-owned primitive (WidgetBubble owns cap, thumb, card, scrolling; widget authors only need transparent bg + resize reporter) which cleanly gives custom widgets the same UX for free — a good default composition boundary; (c) the port-lookup-miss path needed to return HTML not JSON because a 404 with a body doesn't fire iframe error events — an easy-to-miss failure mode.
