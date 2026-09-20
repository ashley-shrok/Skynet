# Phase 125: user-feedback campaign shape 3 — message thumbs - Context

**Gathered:** 2026-09-20
**Status:** Ready for planning
**Source:** Generated from `.planning/shapes/shape-message-thumbs.md` (opened + greenlit 2026-09-20 via /build → /open, six grill exchanges + tasting page comparing five variants — Ashley picked variant E with the strong lock that feedback-off deployments must render exactly like today). Per build-skill rule, discuss-phase does not re-elicit ground the shape file already covers.

<domain>
## Phase Boundary

Shape 3 of the `user-feedback` campaign (`.planning/campaign-user-feedback.md`) and the final shape in the arc. Delivers the last production trigger for the pipeline shape 1 built (Phase 122): per-message thumbs up and thumbs down on assistant bubbles inside the pretty-view chat surface. Uses shape 1's existing `postFeedback`, shape 1's existing `FeedbackModal` in `thumbs_down` variant, shape 1's existing `useFeedbackEnabled` signal, and shape 1's globally-mounted sonner toast. Invents no new backend surface, adds no new payload contract fields, changes no shape 1 or shape 2 code.

Shape 3 has a second responsibility beyond wiring the affordance: it also swaps the visual home of the speak button. On deployments where feedback is configured, the assistant bubble drops its in-bubble speak button and grows an action strip below it holding speak + thumbs-up + thumbs-down as three peers. On deployments where feedback is NOT configured, the assistant bubble looks exactly as it does today — zero visual change. One signal (`useFeedbackEnabled`) gates both the affordance AND the layout swap; they travel together as a paired decision.

Shape 3 is the last work in this campaign. Deploy is END-OF-ARC (per the campaign artifact): all three shapes' commits are held locally on `feat/tab-title-from-tmux` for a single deploy gesture when shape 3 is code-complete.

</domain>

<decisions>
## Implementation Decisions

### The layout swap — coupled affordance + rendering mode

- **D-01:** One signal gates BOTH the thumb affordances AND the assistant-bubble rendering mode: `useFeedbackEnabled()` from `src/ui/feedback/feedback-store.ts`. They travel together; there is no code path that shows thumbs without moving speak, or moves speak without showing thumbs.
- **D-02:** **Feedback OFF** (transport or destination env vars unset — hook returns `false`): assistant bubbles render exactly as they do today. Speak button stays welded inside the bubble at bottom-right (`position: absolute; right: 6; bottom: 6`). Bubble keeps its `pr-[42px]` right-side padding pocket for the speak button. No strip below. No thumbs anywhere on the surface. Zero visual change vs today — a before/after screenshot of a feedback-off instance must be pixel-identical.
- **D-03:** **Feedback ON**: assistant bubbles render in strip mode. The in-bubble speak button is not rendered (its DOM node is absent). The bubble's right-side padding collapses from `pr-[42px]` to symmetrical `pr-[12px]` — matching the left padding — so the bubble reads as pure text content. An action strip renders below the bubble containing speak + thumbs-up + thumbs-down as three peers.

### Strip structure + visual

- **D-04:** Strip position: directly below the assistant bubble, left-edge aligned to the bubble's outer-left edge. Small left indent of ~4px so icons don't sit at the literal `x=0` of the bubble but read as visually attached to it.
- **D-05:** Icon order (left to right): speak · thumbs-up · thumbs-down. Speak reads first (it's the older/pre-existing action), then the feedback pair sits together.
- **D-06:** All three icons share one button shell — same size, same border-radius, same background at rest, same border, same padding. No visual distinction between speak and the thumbs at rest (a distinguished speak button would suggest hierarchy that doesn't exist).
- **D-07:** Strip resting opacity: matches the current in-bubble speak button's resting weight (~62%). Hovering the assistant bubble lifts the strip to 100% opacity. Bubble hover and strip hover both count — hovering anywhere on the anchor lifts the strip.
- **D-08:** Touch-device baseline: on `@media (hover: none)`, the strip sits at a slightly-brighter always-visible weight (~72%) mirroring the current in-bubble speak button's mobile treatment (`[@media(hover:none)]:!opacity-[0.72]` on `.pv-speak-btn`). No hover-lift on touch.
- **D-09:** Vertical gap between bubble and strip: small margin-top on the strip (~4-6px) so it reads as attached to the bubble rather than as a separate row of controls.
- **D-10:** Strip button glyphs: speak uses `Volume2` from `lucide-react` (same as current); thumbs use `ThumbsUp` and `ThumbsDown` from `lucide-react`. Icon size 14-16px inside a ~24-28px button shell — planner picks exact numbers to eyeball right against the bubble.

### Scope of the layout swap — which bubble types

- **D-11:** ONLY assistant bubbles rendered by `ChatMessage` with `role="assistant"` get the swap. This is the sole target of the layout mode.
- **D-12:** `RelayInboundBubble` (relay messages from other users' agents) keeps its current in-bubble speak button even on feedback-enabled deployments. No thumbs, no strip, no swap. Rationale: feedback is on the AI assistant, not on peer users; a relay message is between users. Only one action (speak) means no strip is warranted.
- **D-13:** `WaitingBubble` (assistant-is-thinking placeholder) is unchanged. No completed message to react to, no thumbs, no strip.
- **D-14:** User bubbles (both `role="user"` in `ChatMessage` and the pending-send optimistic variant) are unchanged. Never had a speak button, never get thumbs.

### Speak button in the new location

- **D-15:** ALL existing speak-button state visuals are preserved when speak moves into the strip: resting `Volume2` icon, `Loader2` loading spinner, `Pause` while playing, `Play` while paused, identity-hue-tinted background when `autoplayArmed` is true. Every current visual state cue carries over verbatim.
- **D-16:** All existing speak-button interactions are preserved: pointer-down long-press handler (500ms → fires `onLongPressSpeak`), pointer-move cancellation (>10px drift), tap → `onSpeakClick`, singleton coordination via `speak-singleton.ts`. The behavior contract is unchanged; only the DOM position changes.
- **D-17:** The speak-button's autoplay-armed identity-hue tint applies to the strip's speak button in exactly the same way (identity-hue-tinted background). No behavior gets lost, no color gets substituted.

### Thumbs-up behavior

- **D-18:** One tap on thumbs-up fires the shape-1 payload:  
  `postFeedback({ kind: "thumbs_up", userNote: "", messageRef, exchangeText })`  
  Client-forwards-content per shape 1's D-24/D-26 lock: `exchangeText` is sent optimistically; the backend content-inclusion gate (`FEEDBACK_INCLUDE_CONTENT`) decides whether it lands in the email body. Shape 3 does NOT client-side-gate its payload.
- **D-19:** Post-fire toast: `toast.success("Thanks — feedback sent.", { duration: 2000 })` — same text and duration as shape 1's dev-chord path and shape 2's general button. The globally-mounted sonner Toaster at `src/main.tsx:243` fires it.
- **D-20:** Pressed state visual on the tapped thumb: identity-hue fill background — the same `hsla(var(--pv-id-hue), 65%, 55%, 0.36)` treatment the tasting used, or planner's near-equivalent. The pressed thumb pops to 100% opacity regardless of the strip's resting weight (i.e., a pressed thumb overrides the 62%-at-rest fade so the vote state remains legible).
- **D-21:** Pressed state persists for as long as the message stays hydrated in the client (see D-30 for the persistence model).
- **D-22:** Second tap on an already-pressed thumb: no-op. No additional email fires. No state change. No visual flash. The `postFeedback` call is skipped entirely on the second tap.

### Thumbs-down behavior

- **D-23:** One tap on thumbs-down opens shape 1's `FeedbackModal` in `variant="thumbs_down"` (per shape 1 D-11 the modal renders the "What went wrong?" title, the "Anything you want to add?" placeholder, close-X in top-right, single Send button in footer).
- **D-24:** The message being reacted to is NOT quoted back to the user in the modal (shape 1 D-11 lock; still correct at the per-message trigger context because the user just clicked ON the specific bubble and already sees it in the conversation).
- **D-25:** Modal Send OR modal dismiss (close-X, backdrop click, or Escape key) both fire EXACTLY ONE email:  
  `postFeedback({ kind: "thumbs_down", userNote: <note or "">, messageRef, exchangeText })`  
  Submit path uses the user's typed note; dismiss path passes an empty `userNote`. This mirrors shape 1's `onDismissWithoutSubmit` contract exactly.
- **D-26:** The pressed state on the thumbs-down button applies on the tap (immediately, before the modal opens) — matches thumbs-up visual treatment (identity-hue fill, 100% opacity).
- **D-27:** Toast fires after the modal closes (either path), matching D-19's toast contract.
- **D-28:** If the user has already pressed thumbs-down on this message and taps it again while the modal is closed: no-op, same as D-22. Does NOT reopen the modal.

### Both-thumbs semantics

- **D-29:** Both thumbs-up AND thumbs-down are allowed on the same assistant message, independently. Tapping up does NOT lock out down; tapping down does NOT lock out up. Each tap fires its own `postFeedback` call; each pressed state persists independently. Rationale: they capture genuinely different signals ("useful reply, bad tone" is a real user reaction).

### Persistence

- **D-30:** Pressed state lives in-memory in the client, alongside the message record, for as long as the message stays hydrated. When the client tears the messages down (page reload, navigating away and back to a different conversation and back, hydration flush), the pressed state resets. There is no server-side vote record and no cross-reload persistence — matches shape 1's "email-out only, no database" stance.
- **D-31:** No un-vote / cancel-my-thumb / edit-vote affordance. Once tapped, pressed for the session, and that's it.

### Payload construction — how ChatMessage gets the pieces it needs

- **D-32:** `messageRef`: use the assistant message's `eventId` (the same stable identifier ChatMessage already receives as a prop). Backend caps `messageRef` at 256 chars and strips CRLF at the route boundary (per feedback-routes.ts line 149-155), so eventId as-is is safe. Planner picks exact serialization if eventId isn't already a plain string.
- **D-33:** `exchangeText`: markdown source of the assistant reply concatenated with the prompting user turn. The specific format is planner's discretion but the intent is: the assistant's `content` (already markdown source in `ChatMessage`) plus the most recent prior user turn's content, so the operator reading the email sees both sides of the exchange. Reasonable default: `` `> ${userTurnContent}\n\n${assistantContent}` `` or two labeled blocks — see Claude's Discretion.
- **D-34:** How ChatMessage accesses the prior user turn: PrettyView holds the full messages array and can compute the exchange. Preferred pattern (see D-38): PrettyView constructs the exchangeText for each assistant message and threads it in as a prop (or via a callback that runs at fire time).
- **D-35:** For assistant messages that have NO prior user turn (edge case — e.g., an assistant "greeting" that opens the conversation): send `exchangeText` = the assistant content alone (no prior turn to include). Backend gracefully handles any exchangeText shape.

### Reuse locks — no shape 1 changes, no shape 2 changes

- **D-36:** Shape 3 makes ZERO changes to any file under `src/backend/feedback/`, `src/ui/feedback/`, or `src/ui/features/pretty-conversations/`. All shape-1 and shape-2 code is inherited unchanged. If shape 3 finds itself editing feedback-store.ts, feedback-api.ts, FeedbackModal.tsx, feedback-routes.ts, or PrettyConversationsPanel.tsx, something is wrong.
- **D-37:** No new payload fields, no new backend routes, no new modal variants, no new toast primitives.

### Wiring pattern — how ChatMessage gets the feedback plumbing

- **D-38:** Preferred pattern (planner may deviate if a cleaner shape emerges during pattern-mapping): callback prop threaded down from PrettyView through ChatMessage. PrettyView owns the exchange-text computation and the modal-open state (same as shape 2's pattern where AppShell owns the modal atom and PrettyConversationsPanel receives an `onOpenFeedback?: () => void` callback prop). ChatMessage exposes `onThumbsUp?: (eventId) => void` and `onThumbsDown?: (eventId) => void` (or equivalent) that get the payload building done at fire time.
- **D-39:** `useFeedbackEnabled()` read location: ChatMessage reads it directly as a leaf-level subscription (per shape 1 D-08's `useSyncExternalStore` singleton design). Passing the boolean down through PrettyView as a prop is also acceptable but adds noise for zero win.
- **D-40:** Pressed state storage: planner picks — reasonable options are (a) `useState` inside ChatMessage keyed by eventId, (b) a small in-memory Set of `${eventId}:${kind}` at the pretty-view level, (c) a per-conversation store slice. Whatever the choice, the state MUST reset when the message unhydrates.

### Non-goals

- **D-41:** No changes to shape 1's backend, payload contract, modal, toast, or enabled signal.
- **D-42:** No changes to shape 2's general feedback button.
- **D-43:** No new backend routes or endpoints.
- **D-44:** No "your reactions" history surface anywhere in the app.
- **D-45:** No cross-session or server-side vote records.
- **D-46:** No un-vote, cancel, or edit-vote affordance.
- **D-47:** No filtering thumbs by assistant-message content type — every assistant message (text, code, images, attachments, whatever) is thumb-able.
- **D-48:** No rate limiting or spam throttling on thumbs (accept the risk, matches shape 1 D-28 and shape 2 D-16).
- **D-49:** No production keyboard shortcut for firing thumbs (matches shape 2 D-17 — no new prod chord siblings).
- **D-50:** No telemetry, no click analytics, no vote-rate measurement (matches shape 2 D-20).
- **D-51:** No animation on the appearance of the strip beyond CSS defaults (the padding-collapse transition on the bubble may transition, but the strip itself just appears when feedback is on).
- **D-52:** No differentiator styling on the strip vs the current speak button visual weight (they inherit the same aesthetic — quiet, recessive, hue-tinted on interaction).

### Test scope

- **D-53:** Tests cover (at minimum):
  1. **Feedback OFF rendering:** assistant bubble renders in-bubble speak button (bottom-right); no strip below the bubble; no thumbs anywhere. Bubble has `pr-[42px]` right padding.
  2. **Feedback ON rendering:** assistant bubble does NOT render an in-bubble speak button; bubble has symmetrical `pr-[12px]` padding; strip below the bubble is present with speak + thumbs-up + thumbs-down in left-to-right order.
  3. **Thumbs-up flow:** click fires `postFeedback` with `kind: "thumbs_up"`, correct `messageRef` (eventId), and non-empty `exchangeText`; toast fires; pressed-state class/attribute lands on the tapped thumb.
  4. **Thumbs-down open + submit:** click opens FeedbackModal in `thumbs_down` variant; submit fires `postFeedback` with `kind: "thumbs_down"` and the typed `userNote`; toast fires; pressed state persists.
  5. **Thumbs-down open + dismiss:** click opens modal; dismiss (close-X or backdrop) fires `postFeedback` with `kind: "thumbs_down"` and empty `userNote`; toast fires; pressed state persists (per D-26 the tap fires the pressed state immediately, not modal-close).
  6. **Second-tap no-op:** already-pressed thumb tapped again → no second `postFeedback` call, no state change, no toast.
  7. **Both-thumbs allowed:** clicking up then down on the same message → two separate `postFeedback` calls, both pressed states persist.
  8. **RelayInboundBubble unaffected:** even when `useFeedbackEnabled()` returns true, a rendered `RelayInboundBubble` has its in-bubble speak button and no thumbs and no strip.
  9. **WaitingBubble unaffected:** no thumbs, no strip.
  10. **User bubble unaffected:** feedback ON or OFF, user bubble has no strip.
  11. **exchangeText carries the prior user turn** for a normal user→assistant exchange; carries assistant-only content when there is no prior user turn (D-35).
- **D-54:** Test file location: planner picks (extend `ChatMessage.test.tsx` for the ChatMessage-scope tests, add new `ChatMessage.feedback-thumbs.test.tsx` for shape-3-specific behavior, extend `PrettyView.tsx` tests for the exchange-text plumbing tests, or a mix — whatever mirrors the existing test-file organization in `src/ui/features/pretty-view/`).

### Deferred (explicitly not in v1)

- Cross-session vote memory (would require server-side vote records — shape 1 explicitly rejected).
- Per-user or per-conversation "your reactions" history surface.
- Un-vote / cancel-my-thumb / edit-vote affordance.
- Rate limiting / abuse throttling on thumbs (accept the risk for v1, matches shape 1 D-28).
- Filtering thumbs by message content type (all assistant messages are thumb-able).
- Production keyboard shortcut for firing thumbs.
- Telemetry / click analytics.
- Batching or debouncing per-user thumb events at the transport layer.
- Any changes to the strip's alignment / order / opacity treatment based on future taste calls (v1 is locked to variant E, left-edge, speak-up-down, 62% at rest).

### Claude's Discretion (planner picks)

- **Exact icon size + button-shell dimensions in the strip.** Target: quiet, recessive at rest; matches the current speak button's visual weight. Reasonable starting point: 14px icons in 24-28px shells with 4-6px gap between icons, but the planner should eyeball against the actual bubble in a running dev instance.
- **Exact `messageRef` serialization.** eventId is a string, so pass it directly. If any transformation is needed (e.g., normalization), planner picks.
- **Exact `exchangeText` format.** Two reasonable options: (a) two labeled blocks with `**User:**` and `**Assistant:**` prefixes; (b) markdown blockquote for the user turn followed by the assistant content verbatim; (c) two `---`-separated blocks; (d) something else. Whatever the planner picks, the format should be operator-legible in a plain-text email and preserve markdown fences in the assistant content verbatim (per shape 1 D-21).
- **Wiring pattern for the thumbs handlers.** D-38 recommends callback props from PrettyView; planner may pick a lighter alternative if pattern-mapper surfaces a cleaner path (e.g., a small dedicated hook, or direct atom access if AppShell exposes a suitable signal already).
- **Pressed state storage.** D-40 lists three reasonable options. Planner picks based on what fits ChatMessage's existing state shape best.
- **Whether to extract the strip into its own component or inline it in ChatMessage.** Inlining is simpler; extraction becomes worth it if the strip has more than trivial internal logic. Planner picks.
- **Whether ChatMessage's render branch structure changes materially.** The current ChatMessage has a "not isUser" branch that renders the in-bubble speak button conditionally. Shape 3 adds a "feedback enabled" branch under that. Planner picks between (a) a single conditional expression, (b) small helper functions, (c) a rendering-mode enum. Small file diff either way.
- **Exact test file organization.** See D-54.
- **Whether to add a data-testid marker to the strip container.** Test-selector planning — probably yes for legibility.

</decisions>
