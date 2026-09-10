# Shape: Left-side relay bubble styling pass — chat-native strip + speak affordance

**Opened:** 2026-09-10
**Vehicle:** /gsd:quick (orchestrator-driven, after live console-snippet visual tuning)

## What this is

A focused visual and behavioral pass on the incoming (left-side) message bubbles rendered inside a relay-source view — the view Ashley uses when she's chatting IN a matrix room via Skynet. Three concrete changes:

1. Strip the room identifier from every bubble's header. The header currently reads "avatar-dot • sender-name • room-identifier"; after the pass it reads "avatar-dot • sender-name" — nothing after the name.
2. Remove the small "via recv.sh" footer that today marks each bubble as originating from the receiver script.
3. Add a speak-button affordance to each incoming bubble, wired to the same text-to-speech mechanism already present on assistant-role bubbles in the harness chat: the small volume-icon button anchored at the bubble's bottom-right, plus the long-press-anywhere-on-the-bubble gesture that arms autoplay for subsequent inbound messages in the same pane.

Together the three changes make the left-side bubbles feel chat-native (the harness-derived tells go away) while preserving the "who's talking" affordance appropriate to a multi-sender room.

## Shape

The change is scoped to ONE display context — the relay-source view. The same bubble component also renders in a second context (a task-notification-triggered bubble inside a harness chat pane); that second context is out of scope for this pass and its look stays exactly as it is today. The branch discriminator between the two contexts already exists in the component.

Shape of the resulting bubble in relay-source view:

- **Header row.** Coloured dot (sender's identity colour, or a neutral grey fallback when the sender's identity doesn't resolve) followed by the sender's display name. That's it. No trailing separator, no room identifier.
- **Body.** Unchanged — the message text renders as before, with the same tint / border / shadow / typography.
- **Footer.** Gone. The "via recv.sh" line is removed entirely.
- **Speak button.** A small volume-icon button, anchored bottom-right of the bubble. When tapped, it starts reading the bubble's body aloud using the sender's identity voice; when the sender's identity doesn't resolve to a known identity, it falls back to a default voice rather than being hidden or disabled. States (idle / loading / playing / paused) match the existing right-side speak-button state machine and use the same icons. Cross-bubble singleton behaviour also carries over — tapping speak on one bubble stops speak on any other bubble.
- **Long-press anywhere on the bubble.** Arms autoplay. Any subsequent incoming (non-self) bubble that arrives in the same pane afterward auto-speaks. Same arming behaviour as today's harness chat bubbles.

Values (padding, exact positions, opacity, sizes) — decided live during the console-snippet visual tuning beat with Ashley, THEN locked into code. The shape does not pre-commit values; it commits the anatomy.

## Philosophy

The stance: keep the affordance that identifies WHO is talking (multi-sender room, identity matters), lose the affordances that betray "this is not really a chat" (raw room identifier surfaced on every bubble, receiver-script provenance stamped in the corner). Add the affordance a chat with an agent needs (hear what they said) — using the mechanism the app already has for exactly this purpose, unmodified.

Deliberately doing:
- Reusing the entire existing speak / autoplay / cross-bubble singleton mechanism as-is. No new player, no parallel state machine, no divergent icon set. The right-side apparatus is already correct for this job.
- Preserving the sender identity affordance (coloured dot + name) because the room has multiple senders.
- Defaulting to a usable voice when the sender doesn't resolve. "Better to hear the message in a default voice than not be able to hear it at all" is the explicit call.

Deliberately NOT doing:
- Not touching the harness-view rendering of the same bubble component. That context still needs its collapsible header, its room hint, and its provenance footer; those cues belong there.
- Not adding copy buttons, reasoning-token toggles, or other assistant-bubble adornments — none of those exist in the app today.
- Not touching the bubble's colour treatment, glass depth, gradient, or padding beyond whatever falls out of live visual tuning.
- Not attempting to surface the room name in the pane chrome. If a room-name label on the pane is ever wanted, that's a separate conversation.

## Prior context

This is the direct mirror of a change already shipped in batch #5 of the Phase 97 UAT follow-up campaign (HEAD `9cd61269`, 2026-09-10). Batch #5 removed the outbound (right-side) relay bubble entirely, routing the user's own outgoing messages through the standard chat bubble instead. The result on the right side was clean — user-blue bubbles with an iMessage-style pending spinner, no header, no footer, no "via" provenance. Ashley's end-of-session direction was to reset, then start on the left side next session. That's what this pass is.

The left-side bubbles today have three tells that mark them as harness-derived rather than chat-native:
- The header carries both the sender's identity AND the room identifier separated by a middle dot, so every bubble reads like a log line ("dot Tina dot roomId").
- A small right-aligned "via recv.sh" line sits below every body, marking the receiver-script origin.
- The speak / autoplay affordance that lives on every assistant-role bubble in a harness chat isn't wired in on this component at all.

The receiver-script origin was accurate for the earlier phase when relay bubbles ONLY appeared as task-notification wakes inside a harness chat. In relay-source view that framing is no longer accurate — the messages don't come through the receiver script at all, they come straight from the matrix adapter driving the room — so the "via recv.sh" footer is both visually noisy and technically incorrect for this context.

Sender voice resolution is already fully wired: the same identity-resolution path that supplies the coloured dot supplies the identity's voice, and the app already has a default-voice fallback for cases where no voice is configured. No new plumbing needed; the wire-up reads the resolved identity's voice and passes it into the existing speak mechanism.

The file-pointer branch of the bubble is left untouched. It is real code (the receiver script does spill long peer DMs to a file and emits a pointer-line body in the harness view) but the code path is only reached in the harness view. Relay-source view bodies come straight from matrix and never hit the pointer-detect regex; so the branch is inert in the context this pass is changing, and the pass does not need to touch it.

## What would make it wrong

- If the left-side bubbles lose their "who's talking" affordance. Stripping the room identifier is correct; stripping the sender name or the coloured dot is not — you need to know who's talking in a multi-sender room.
- If the speak button reintroduces itself on the user's own outgoing bubbles. User bubbles across the whole app deliberately don't have this button; the invariant should hold across contexts. The button lives on peer-side inbound bubbles only.
- If the harness-view rendering of relay bubbles changes in this pass. The two contexts share a component but not a look; the header simplification and footer removal must gate on the relay-source discriminator, not apply globally.
- If the speak mechanism is re-implemented rather than reused. Any divergence from the existing right-side apparatus (parallel player instance, separate state machine, its own singleton) is a mistake. The whole point is one mechanism for one job.
- If the "sender doesn't resolve" case ends up with a speak button that does nothing, throws, or is hidden. Falling back to the default voice is the explicit correct behaviour — the button being tappable and producing audio is what matters.
- If autoplay stops firing on subsequent left-side bubbles in a room after long-press arming. The gesture arms autoplay for any subsequent non-self inbound message; that behaviour should be identical to how autoplay behaves in a harness chat, just against the relay-source stream.

## Scope edges

**In scope:**
- RelayInboundBubble's rendering in the relay-source view context (the always-expanded branch).
- Stripping the room identifier and the middle-dot separator from the header row.
- Removing the "via recv.sh" footer.
- Adding the speak-button UI and wiring it to the existing speak mechanism.
- Wiring long-press-arms-autoplay for the relay-source pane, using the same autoplay gate the harness pane uses.
- Voice resolution: use the sender's identity voice when the sender resolves; fall back to the default voice when they don't.
- Tests covering the header strip, the footer removal, the speak button presence + interaction, and the autoplay-arm gesture.

**Out of scope:**
- Harness-view rendering of the same bubble component (task-notification wakes in a harness chat). Unchanged.
- Sender-side / outgoing / user-role bubble rendering. Already handled in batch #5.
- The bubble's colour treatment, glass depth, gradient, sizing, corner radius, or backdrop-blur beyond what live tuning surfaces.
- A room-name label on the pane chrome. Separate conversation.
- The file-pointer inline body path. Real code, but never fires in the relay-source context; not touched.
- The conversation-list row styling for relay rooms — this is the SECOND `/build` invocation Ashley and I agreed to do next, after this one lands.

**Deferred (may earn its own pass later, not now):**
- Any change to the autoplay-arm scoping (whether it should arm per-sender in a multi-sender room, versus per-pane which is today's behaviour). Ashley's explicit call is to keep today's per-pane semantics.

**Tempting but no:**
- Removing the file-pointer branch as "dead in this context." It is not dead in the harness context, and the harness context is out of scope; leave the branch alone.
- Making the whole bubble structure symmetric with the sender-side (which lost its header entirely in batch #5). The left side has different requirements (multi-sender identity affordance) and should stay asymmetric.
- Adding a copy button as long as we're in here. Neither side of the app has one today; this pass isn't the place to introduce a new pattern.

## Vehicle notes

`/gsd:quick`, orchestrator-driven. The overall arc runs in two beats:

1. **Console-snippet visual tuning (live, this session).** Taylor produces a paste-into-DevTools snippet that mutates the live relay-source view in Ashley's browser — strips the header suffix + removes the footer + injects a mock speak-button at the target position — with a small +/- control panel exposing the tunable values (button size, right/bottom inset, opacity, hover-opacity increment). Ashley iterates in place until she says "locked at X" for each value. This beat produces the exact numbers that go into the code.

2. **Code lock-in via `/gsd:quick`.** With the locked values in hand, orchestrator dispatches a `/gsd:quick` that applies the changes to the relay-source branch of the bubble component and adds test coverage. The executor runs scoped tests as its green gate per the standing fleet directive; the full-suite ship gate is orchestrator-managed at deploy time, not part of the executor's remit.

Working directory: `/home/ubuntu/skynet-taylor`, branch `feat/tab-title-from-tmux`. Bounty: the Phase 97 UAT follow-up campaign (`phase-93-uat-polish-arc`) — this pass is the next batch (batch #6) in that arc.

`/close <slug>` at the end of the arc verifies the built result against this shape file both ways: every strip / add is present, and nothing is present that this shape did not agree on.

---

## Close-Out

**Closed:** 2026-09-10
**Vehicle used:** /gsd:quick after a live console-snippet visual tuning beat, per the shape's Vehicle notes
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — strip room identifier from bubble header** — present · alwaysExpanded=true branch renders avatar-dot + displayName only; no room, no middle-dot separator
- **What this is — remove 'via recv.sh' footer** — present · Footer wrapped in !alwaysExpanded guard so it renders only in the harness branch
- **What this is — add speak-button affordance wired to existing TTS mechanism** — present · Volume-icon button anchored bottom-right; 4-state icon set; uses the existing postSpeakStream + WebAudioStreamPlayer path unmodified
- **Shape — Header row (coloured dot + display name only)** — present · Dot uses resolved hue or neutral grey fallback; only displayName follows
- **Shape — Body unchanged** — present · Body text renders as before; tint/border/shadow/typography untouched
- **Shape — Footer gone in relay-source view** — present · The via-recv.sh line is entirely dropped in the alwaysExpanded branch
- **Shape — Speak button anchored bottom-right with existing state machine** — present · position absolute right:6 bottom:6; idle/loading/playing/paused states match; cross-bubble singleton preempt is enforced by lifting the pair into a shared module
- **Shape — Long-press anywhere on bubble arms autoplay** — present · Bubble-root pointer handlers wire the 500ms long-press with move-cancel; calls onLongPressSpeak(eventId) and startSpeak('long-press'); short-circuits when the pointer target is inside the speak button so the button owns its own gesture
- **Shape — Values locked from live tuning, anatomy not pre-committed** — present · Padding widened to reserve a right-side gutter; button inset/opacity/size locked to specific values; header brightness locked per the live-tune beat
- **Philosophy — reuse existing speak/autoplay/singleton mechanism as-is** — present · Singleton pair extracted into a shared module; ChatMessage refactored onto the same accessors; no new player, no parallel state machine, no divergent icons
- **Philosophy — preserve sender identity affordance** — present · Coloured dot + display name retained in the relay-source header
- **Philosophy — default voice fallback when sender doesn't resolve** — present · identityVoice = identity?.voice ?? undefined; postSpeakStream called with undefined on unresolved senders; button still renders
- **Prior context — mirrors batch #5 on the receiver side** — present · Batch #6 commit message and code changes mirror the sender-side change (9cd61269); the two-tell strip + speak addition all happen on the left side
- **Prior context — file-pointer branch left untouched** — present · detectFilePointer branch and fetch effect are unchanged; inert in relay-source path as the shape describes
- **What would make it wrong: left-side bubbles lose 'who's talking' affordance** — present · Guarded — dot + display name both kept; only the room suffix and separator are stripped
- **What would make it wrong: speak button appears on user's own outgoing bubbles** — present · Guarded — RelayInboundBubble is the peer-side inbound component only; outgoing bubbles go through the standard ChatMessage user path from batch #5
- **What would make it wrong: harness-view rendering changes** — present · Guarded — every new behavior gates on alwaysExpanded; the alwaysExpanded=false branch is byte-for-byte unchanged and a dedicated regression test pins that
- **What would make it wrong: speak mechanism is re-implemented rather than reused** — present · Guarded — same postSpeakStream, same WebAudioStreamPlayer, same singleton (now shared via extracted module), same icon set, same 500ms/move-cancel/tap-suppress pattern
- **What would make it wrong: unresolved sender leaves a dead / hidden / throwing speak button** — present · Guarded — button renders regardless; unresolved sender calls postSpeakStream with undefined so the default-voice path in the API takes over
- **What would make it wrong: autoplay stops firing on subsequent left-side inbound bubbles after long-press arming** — present · Guarded — autoplay effect fires startSpeak when autoplayTargetEventId matches this bubble's eventId; PrettyView threads the same autoplayArmed/autoplayTargetEventId used by the sibling assistant render
- **Scope edges — In scope items all landed** — present · Every in-scope bullet (header strip, footer removal, speak UI + wire-up, long-press-arms-autoplay, voice resolution with fallback, tests) is present
- **Scope edges — Out-of-scope items untouched** — present · Harness-view rendering, outgoing/user bubbles, colour treatment/gradient/glass depth, pane-chrome room label, file-pointer branch, conversation-list row styling — none touched
- **Scope edges — Deferred item respected (autoplay arming stays per-pane, not per-sender)** — present · Autoplay wiring reuses the existing per-pane autoplayArmed/autoplayTargetEventId; no per-sender scoping introduced
- **Scope edges — Tempting-but-no items resisted** — present · No file-pointer branch removal, no symmetry-with-sender-side collapse of the header, no copy button introduced

### Additions (in the result, not in the shape)

- Header sender-name text brightened from the muted 60%-alpha token up to full body-text brightness in the relay-source branch — endorsed-as-drift

### Follow-ups

None.

### Notes

The singleton extraction from ChatMessage into a shared module is a small refactor beyond the strict letter of the shape, but it is the mechanism the shape explicitly requires (one player, one owner, cross-bubble preempt working both directions) — treating it as delivery of that commitment rather than an unagreed addition. Header brightness was confirmed as a live-tune value locked during the tuning beat named in the shape's Vehicle notes, so it is captured as endorsed drift rather than an unsanctioned addition. The alwaysExpanded discriminator on the component is used consistently as the sole gate for every relay-source change, which makes the harness-view invariant easy to reason about and easy to test.
