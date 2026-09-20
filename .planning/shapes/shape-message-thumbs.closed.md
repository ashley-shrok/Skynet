# Shape: message thumbs

**Opened:** 2026-09-20
**Vehicle:** GSD phase
**Part of campaign:** `campaign-user-feedback.md` — shape 3 of 3

## What this is

The per-message feedback affordances on the assistant side of the pretty-view chat surface. A user reading an assistant reply can leave a thumbs up or a thumbs down on that specific message. Thumbs up fires an email and shows a brief acknowledgment; thumbs down opens the shared feedback modal for optional elaboration, and either submitting or dismissing sends exactly one email. This is the third and final consumer of the pipeline shape 1 built.

Shape 3 also locks the visual home for these affordances. When the deployment has feedback configured, the assistant bubble drops its in-bubble speak button and grows a small action strip below it holding speak, thumbs up, and thumbs down as three equal siblings. When the deployment does NOT have feedback configured, the assistant bubble looks exactly as it does today — speak stays welded into the bubble corner, no strip, no thumbs. One signal (feedback-enabled) governs both the affordance and the layout.

## Shape

**Where the affordances live.** A small action strip sits directly below each assistant bubble. Left-edge aligned to the bubble. Contains three icons in this order: speak, thumbs up, thumbs down. All three share one visual treatment — same button shell, same size, same resting weight.

**Two rendering modes, gated by the same signal.**

- **Feedback OFF** (mail transport or destination not configured on this deployment). Assistant bubbles render exactly as they do today. The speak button sits welded in the bubble's bottom-right corner. No strip below. No thumbs anywhere. Zero visual change from the current app for this deployment.
- **Feedback ON.** Assistant bubbles render in strip mode. The bubble content itself is pure text — no in-bubble speak button, and the extra right-side padding that today makes room for that button collapses away. The strip below the bubble holds all three actions.

**Which bubbles get the swap.** Assistant bubbles in the pretty-view chat only. Relay-inbound bubbles (messages from another user's agent) keep their current in-bubble speak button even on feedback-enabled deployments — they get no thumbs and no strip. Waiting bubbles (the "assistant is thinking" placeholder) stay untouched. User bubbles are unaffected across the board.

**Strip visual weight.** The strip sits at the same resting opacity the speak button uses today (roughly 62%). Hovering the bubble lifts the whole strip to full opacity, matching how the speak button reveals its own attention state today. On touch surfaces where hover doesn't apply, the strip stays at a slightly-brighter always-visible weight, mirroring the current speak button's mobile treatment.

**Thumbs up behavior.** One tap. The email fires. A bottom-right toast appears saying "Thanks — feedback sent." — the same toast shape 1 wired up, the same shape 2 fires from the general button. The tapped thumb fills in at the identity hue and pops to full opacity, and that pressed state persists for as long as the message stays hydrated in the client. A second tap on an already-pressed thumb is a no-op — no additional email fires, no state change. No un-vote affordance.

**Thumbs down behavior.** One tap opens shape 1's shared composition modal in its thumbs-down variant. Whether the user submits with a note or dismisses without one, exactly one email fires for that thumbs-down — this matches the campaign's locked "one email per thumbs-down regardless of path" rule. The tapped thumb fills in identical to thumbs up. The message being reacted to is NOT quoted back to the user in the modal (shape 1's lock).

**Both thumbs on the same message.** A user is allowed to tap both up AND down on the same assistant message — they're independent signals ("useful reply, bad tone" or similar). Two emails fire, two pressed states persist. Nothing locks the pair.

**Which messages get thumbs.** Every assistant message. No filtering by content type — text, code blocks, images, tool output visualizations, all of them are valid targets. Applying a filter would introduce a maintenance rule that doesn't earn its keep.

**Payload for shape 1.** The caller supplies: the kind of feedback (thumbs up or thumbs down), any user-typed note (thumbs down only, and only if they typed one), plus a reference to the specific message and the surrounding exchange text (the assistant reply that was thumbed plus the user turn that prompted it, as markdown source). Everything after that is shape 1's job — instance name, submitter, timestamp, content-inclusion gating, email composition, transport, failure logging.

**No new backend surface.** Shape 3 is a caller. It uses shape 1's existing intake path, its existing payload contract, its existing enabled signal, its existing toast singleton, its existing modal component. Zero new endpoints. Zero payload-contract changes.

**No un-vote, no cancel, no retroactive edits.** Once a thumb is pressed, it stays pressed for the session. The email is already sent — there's no way to un-send it, and offering a UI affordance that suggests otherwise would be misleading.

**No persistence across page reload.** The pressed state lives in the client's in-memory conversation state, alongside the messages themselves. If the client tears the messages down (page reload, navigation away and back) the state is gone. Matches shape 1's "email-out only, no database" stance — there is no server-side record of individual votes to hydrate against.

## Philosophy

**The affordance and the layout are one decision, not two.** The strip only makes sense because there's more than one action to put in it. Moving speak out of the bubble corner is not a design flourish; it's the necessary consequence of adding two more actions that need a home. Consequently, the strip and the speak-relocation ship together, gated by the same signal — never one without the other.

**Do not touch instances that don't have feedback.** Deployments where feedback isn't configured are entitled to a completely unchanged UI. Zero cost. Zero visual drift. If someone runs the same code with no env vars set, their app looks and feels identical to the day before this shape shipped. The rendering mode swap is not a global stylistic choice; it's a consequence of enabling a feature.

**One click is the signal, elaboration is optional.** Thumbs up gets the least friction — one tap, no modal, ever. Thumbs down captures the vote on the click, then optionally captures elaboration through the modal. Either way, the vote is what matters and the operator gets the email whether the user elaborates or not.

**Reuse everything shape 1 built.** No parallel code paths for per-message thumbs. Same pipeline, same modal, same toast, same enabled signal, same payload contract. Shape 3 is a caller.

**The pressed state is a memory aid, not a rating widget.** It tells a user "you already tapped this, don't tap it again" — it does not turn the thumbs into a persistent rating surface. There's no leaderboard, no history view, no way to browse or edit past votes. Session-lifetime, informational only.

**Every assistant message is thumb-able.** Uniformity beats cleverness. A filter that hides thumbs on "content types that shouldn't be rated" is a rule to maintain and a source of "why can't I thumb this?" confusion. If someone taps thumbs down on a code block, that's still legitimate feedback.

## Prior context

Shape 1 shipped the pipeline: the backend intake path, the shared modal, the payload contract, the toast, the enabled signal, the environment-driven configuration, the boot-time enablement decision. All of it is in place. It's not yet deployed — the whole campaign's push and deploy happen at end of arc when all three shapes land.

Shape 2 shipped the general feedback button in the conversation-list header, using shape 1's modal in its general variant and gating on shape 1's enabled signal. Also not yet deployed. Shape 2 established the pattern for adding a new caller of the pipeline without touching shape 1's own files.

The pretty-view assistant bubble today: message text (rendered as markdown) plus an in-bubble speak button anchored to the bottom-right corner. The bubble carries extra right-side padding specifically to make room for that speak button. The speak button has multiple state visuals (resting volume icon, loading spinner, playing pause, paused play, autoplay-armed identity-hue tint), all preserved when it moves into the strip.

The bottom-right toast (from shape 1) is globally mounted at the app level. Any caller can fire it with one line. Shape 2 already uses it for its general submits; shape 3 does the same for both thumbs-up submits and thumbs-down submit-or-dismiss.

There is no server-side record of feedback votes. The pipeline is email-out only. There is no per-user "your reactions" surface anywhere in the app, and shape 3 does not create one.

## What would make it wrong

- **If the feedback-off render mode drifts even slightly from today's app.** A deployment that hasn't turned feedback on should see zero visual change. If someone eyeballs a before/after screenshot of a feedback-off instance and can spot a difference, shape 3 has missed the point.
- **If the layout swap and the affordance can be independently enabled.** They travel together. There should be no code path that shows thumbs without moving speak, or moves speak without showing thumbs. One flag, one paired behavior.
- **If a pressed thumb becomes tappable-again in a way that lets a user re-fire the email.** The second-tap-is-no-op rule is protection against spam and against confusing UI (a "still-pressable" pressed state suggests it's not registered).
- **If tapping thumbs down and dismissing the modal fails to fire the email.** Shape 1's rule is that the click is the signal; the modal is elaboration. Dismissal must not lose the signal.
- **If thumbs appear on relay-inbound bubbles.** Feedback is on the assistant, not on peer users. A relay message is between users and has no operator-side "reply quality" concept.
- **If the pressed state persists across a page reload.** There's no server-side record and no client-side store for votes. Persistence would imply a database shape 1 explicitly did not build.
- **If the speak button loses any of its existing state visuals when it moves to the strip.** Loading, playing, paused, autoplay-armed — all preserved. The relocation is purely positional; behavior is unchanged.
- **If the strip's resting weight competes with the message text.** The strip inherits the speak button's quietness at rest. Fully-visible action rows attached to every message would eat into the scrollback's readability.
- **If the exchange text travels to the email even when content-inclusion is off.** Shape 1's server-side gate handles this — shape 3 sends the exchange text optimistically in the payload, and the backend decides whether to include it in the email based on the operator's flag. Shape 3 does not client-side-gate its own payload; the server owns that decision.
- **If a user can un-thumb via any UI path.** No un-vote button, no long-press-to-remove, no context menu with a "clear" option. Once tapped, pressed for the session, and that's it.

## Scope edges

**IN this shape:**
- The action strip below the assistant bubble, holding speak, thumbs up, thumbs down
- The layout swap on the assistant bubble (in-bubble speak removed, right padding collapsed) when feedback is enabled
- Wiring shape 1's `useFeedbackEnabled` signal to gate the layout mode
- Thumbs-up wiring: fires shape 1's payload with the message reference and exchange text; fires the shape 1 toast; persists pressed state in-session
- Thumbs-down wiring: opens shape 1's shared modal in thumbs-down variant with the message reference in scope; fires exactly one email per press whether the user submits or dismisses; persists pressed state in-session
- Second-tap-is-no-op on any already-pressed thumb
- Independent tap-both-thumbs allowed on the same message
- Pressed state visual (identity-hue fill, full opacity, overrides the strip's resting weight)
- Speak button state visuals preserved in the new location (resting, loading, playing, paused, autoplay-armed)
- Strip touch-device treatment (slightly-brighter always-visible baseline mirroring current speak button behavior)
- Tests for the strip's presence/absence based on feedback-enabled state, thumbs-up flow, thumbs-down submit and dismiss flows, second-tap no-op, both-thumbs-independent behavior, and the speak-button-position swap

**OUT of this shape (belongs elsewhere or explicitly not built):**
- Any changes to shape 1's backend, payload contract, or modal
- Any changes to shape 2's general feedback button
- Any new backend routes
- A "your reactions" history surface in the app
- Persistence of vote state across page reload / conversation switch
- Cross-session or server-side vote records
- An un-vote or edit-vote affordance
- Filtering thumbs by message content type (all assistant messages are thumb-able)
- Rate limiting or spam throttling (accepted risk for v1, matches shape 1)
- Applying the strip layout to relay-inbound bubbles or waiting bubbles
- Applying the strip layout to user bubbles
- Any surface for the operator to see a per-user or per-conversation "reaction score"
- Deploy of the campaign — that happens end-of-arc after all three shapes land, per the campaign artifact

**Deferred (may revisit later, not this shape):**
- A more elaborate hover-reveal treatment for the strip if the always-visible weight feels wrong in practice
- Any cross-session vote memory should the operator decide the fire-and-forget model isn't enough
- Batching or debouncing per-user thumb events at the transport layer if spam becomes real

**Tempting but no:**
- Making the strip's alignment configurable (left / right / center). Left-edge is the locked answer; a knob would just be indecision hardened into config.
- Animating the appearance of the pressed state beyond a simple opacity/fill transition. Anything more elaborate would draw attention to the vote instead of the message.
- Wiring a per-message "you already reacted" indicator that survives reload. This would require server-side vote records, which shape 1 explicitly rejected.
- Using the strip as a hook for a future "share this message" or "copy link" action. Additions like that belong to a separate shape, not a scope-creep bolt-on.

## Vehicle notes

**Vehicle:** GSD phase, added via `/gsd:phase` then planned via `/gsd:plan-phase` (auto-proceeds to execute per standing rule). Same vehicle shapes 1 and 2 used. Expected size: smaller than shape 1, similar to shape 2 — likely 1 plan, possibly 2 if the layout swap and the thumbs wiring want to be separated.

**Seed CONTEXT.md from this shape file** — the "why + what + constraints + scope edges" are captured here, so `/gsd:discuss-phase` should read this rather than re-elicit the same ground. Same seeding pattern shape 2 used successfully.

**Related files:**
- Parent campaign artifact: `.planning/campaign-user-feedback.md`
- Closed shape 1 artifact: `.planning/shapes/shape-feedback-pipeline.closed.md` — payload contract, enabled signal, modal, toast, pipeline
- Closed shape 2 artifact: `.planning/shapes/shape-feedback-general-button.closed.md` — the "new caller of shape 1" pattern reference
- Message tasting: `~/fleet/identities/lark-box-maintainer/workspace/tasting-message-thumbs/index.html` (variant E is the locked design)

**Identity doing the work:** lark (via this session's `/build`).

**Push and deploy:** END-OF-ARC. Shape 3 code goes on the same branch as shapes 1 and 2, holding for the campaign's single deploy gesture once all three shapes land. `git push` is per-push-authorization; `docker build` + `docker compose up --force-recreate` is a separate ship greenlight. Neither happens as part of this shape's execution.

**Reviewers:**
- Framework code-review (`/gsd:code-review`) runs as part of the phase
- Unbiased general-purpose code-review runs after `/close` per the build skill

**On completion of the built work:** run `/close shape-message-thumbs` to verify conformance against this file, then mark shape 3 complete in the campaign artifact's Shapes section. That closes the campaign arc; the deploy gesture is a separate turn.

---

## Close-Out

**Closed:** 2026-09-20
**Vehicle used:** GSD phase (Phase 125, Plan 01 + Plan 02) — matches what the shape recorded at open time
**Overall verdict:** closed-hit

### Shape features (conformance)

- **Action strip below assistant bubble, left-edge aligned, three peers (speak · thumbs-up · thumbs-down)** — present · flex-col items-start group wrapper + strip with speak, thumbs-up, thumbs-down in that order, all sharing pv-speak-btn treatment
- **Two rendering modes gated by feedback-enabled signal** — present · Feedback OFF keeps in-bubble speak + pr-[42px]; Feedback ON removes it and collapses to pr-[12px]
- **Feedback OFF = byte-identical to today (in-bubble speak welded corner, no strip, no thumbs)** — present · !isUser && !feedbackEnabled branch renders the absolute-positioned in-bubble button verbatim; strip block gated off
- **Feedback ON = in-bubble speak removed, pr collapsed to 12px, strip below with three peers** — present · padding branch and strip mount both key on the same feedbackEnabled signal
- **Swap applies only to assistant bubbles in pretty-view (relay-inbound, waiting, user unaffected)** — present · onThumbsUp/onThumbsDown threaded only on the ChatMessage branch of the message-type conditional; RelayInboundBubble/WaitingBubble untouched; pendingSends optimistic bubbles don't receive the callbacks; strip block gates on !isUser
- **Strip resting weight ≈62%, hover-lift to 100%, touch baseline 0.72** — present · opacity-[0.62] group-hover:opacity-100 [@media(hover:none)]:opacity-[0.72] on the strip container
- **Thumbs-up: one tap, email fires, toast, identity-hue fill persists, second-tap no-op** — present · handleThumbsUp posts kind=thumbs_up with empty userNote, toast.success 'Thanks — feedback sent.', pressed state hue-fill, and if(thumbsUpPressed) return guard
- **Thumbs-down: opens shared modal in thumbs_down variant; exactly one email on submit or dismiss** — present · FeedbackModal mounted at PrettyView with variant='thumbs_down'; onSubmit fires postFeedback(userNote=typed); onDismissWithoutSubmit fires postFeedback(userNote='')
- **Message being reacted to NOT quoted back in the modal (shape 1 lock)** — present · modal is invoked with variant + open + callbacks only; no exchange text prop is passed into the modal itself
- **Both thumbs allowed on same message, independent signals, two persistent pressed states** — present · separate thumbsUpPressed and thumbsDownPressed state slots; test 7 locks the behavior
- **Every assistant message is thumb-able (no filtering by content type)** — present · strip renders for every !isUser ChatMessage with feedbackEnabled; no content-type gate
- **Payload: kind, userNote (thumbs-down only), messageRef, exchangeText (assistant + prior user turn as markdown)** — present · postFeedback called with {kind, userNote, messageRef: eventId, exchangeText}; format is `**User:**\n\n...\n\n---\n\n**Assistant:**\n\n...` or assistant-only when no prior user turn (D-35)
- **No new backend surface — shape 3 is a caller of shape 1's pipeline** — present · only imports from @/feedback/* and sonner; no new endpoints, no payload-contract changes
- **No un-vote, no cancel, no retroactive edits — pressed for the session** — present · second-tap-no-op via early returns; no un-vote affordance, no long-press-to-clear, no context menu
- **No persistence across page reload — state is client in-memory only** — present · both pressed states are useState scoped to the ChatMessage instance; unmount clears
- **Speak button state visuals preserved in the new strip location (loading, playing, paused, autoplay-armed)** — present · strip's speak button duplicates the full pointer/click handler set plus the Loader2/Pause/Play/Volume2 glyph machine and autoplay-armed hue tint
- **exchangeText travels optimistically to server regardless of content-inclusion gate (server owns the decision)** — present · client always attaches exchangeText; no client-side filtering on operator flag
- **T-124-05 mitigation: prior-turn lookup filters on m.type==='message' && role==='user' (skips relay_inbound)** — present · backward walk in handleThumbsUp/handleThumbsDown enforces the discriminator; test 9 locks it
- **Tests: strip presence/absence, thumbs-up flow, thumbs-down submit + dismiss, second-tap no-op, both-thumbs independent, speak swap, T-124-05** — present · ChatMessage.feedback-thumbs.test.tsx (9 cases) + PrettyView.feedback-thumbs.test.tsx (9 cases) cover the full grid
- **Layout swap and affordance travel together — one signal, one paired behavior** — present · same feedbackEnabled boolean drives both the padding/in-bubble-speak branch and the strip-mount branch; no path shows thumbs without moving speak or vice versa

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Clean pass in both directions. The pressed-state aria-labels ("Feedback recorded (thumbs up/down)" vs the resting "Send thumbs [up/down] feedback") and the defensive `if (!eventId) return` no-op are minor implementation details consistent with the "pressed state is a memory aid" semantic — not divergences worth surfacing. The modal-context atom (`feedbackModalContext` with `eventId`+`exchangeText`) is the exact PrettyView-local plumbing pattern the shape's philosophy pointed at ("Reuse everything shape 1 built. Shape 3 is a caller."). Deploy of the campaign is correctly deferred (per shape's Scope edges).
