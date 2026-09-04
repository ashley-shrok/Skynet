# Shape: Rewrite PrettyView auto-scroll from first principles

**Opened:** 2026-09-04
**Vehicle:** GSD phase (discuss-phase → plan-phase → execute-phase)

## What this is

Foundational rewrite of the chat panel's auto-scroll layer — the code that decides when the view sticks to the bottom of the message stream, when it holds still, and how the jump-to-bottom button appears. The current implementation reacts to a stack of independent watchers observing different signals; each new symptom over the past month has produced another watcher or another gate, and each attempt has bled another edge case. The rewrite replaces that reactive stack with a small deterministic state machine driven by a single invariant: position relative to the bottom.

## Shape

**Two states.** The scroll surface is always in one of two modes: at-bottom (chasing the bottom) or not-at-bottom (frozen where the user left it). The mode is derived from position — how far from the actual bottom the user currently is, compared against a small tolerance threshold (roughly one line of body text, ~24-32px, with additional slack on touch devices for iOS momentum overshoot).

**Symmetric event handling.** Every event that could move the bottom is treated uniformly: a new message arriving, the work-in-progress indicator appearing or disappearing, task or subagent accessory bubbles appearing or disappearing above the compose box, the browser window resizing, a session being dragged into a new split-pane layout. When in at-bottom mode, all of these trigger a chase to the new bottom. When in not-at-bottom mode, none of them touch scroll position.

**Transitions.** Out of at-bottom happens only when a real user input event (wheel, touch drag, scrollbar drag, keyboard) lands position outside the threshold. Into at-bottom happens when the user scrolls to within the threshold, clicks the jump-to-bottom button, or sends a message from the compose box (send flips to at-bottom regardless of prior state). Programmatic scroll writes never transition mode — they just chase.

**Session-scope state.** State is per-session, not per-pane. If a session was at-bottom and its pane is dragged into a new split, the state carries with the session. If the session was scrolled to a specific position, that position is preserved across pane movements.

**Session re-entry.** Switching away from a session and coming back does not touch scroll position. The view stays where the user left it, since the pretty view stays mounted across session switches.

**Mount landing.** The first time a session's view appears, it lands at the bottom after the initial batch of bubbles has settled. This requires a hide-pin-reveal pattern: the surface is invisible while content mounts, the state machine waits for the content-size measurement to report non-zero height, then jumps to bottom, then reveals — so there is no visible flash at the top on first paint.

**Chase behavior.** All chases are instant scroll writes (not smooth-scroll animations), coalesced into a single write per animation frame regardless of how many events triggered them.

**Jump-to-bottom button.** Visible exactly when in not-at-bottom mode. Plain pill, no unread count or badge. Clicking it flips back to at-bottom.

**Explicit ownership of scroll position.** The state machine takes exclusive ownership of scroll position. The browser's built-in feature that tries to preserve visual position across content mutations is disabled on the scroll container, so the browser and the state machine don't fight each other.

## Philosophy

The rewrite is deliberately picking a single invariant to defend — "if you were at-bottom, you remain at-bottom across any event that could move the bottom" — and organizing every other decision around whether it upholds or violates that invariant. Not a collection of reactive fixes; one rule, applied uniformly.

It deliberately does not try to guess user intent from ambiguous signals. The mode transitions are gated on the smallest possible set of concrete triggers: user input events for out-of-at-bottom, explicit user actions (scroll-to-bottom, jump-button-click, send) for into-at-bottom. Nothing is inferred from position drift, layout timing, or watcher race outcomes.

It deliberately does not distinguish "message added" from "accessory disappeared" from "window resized." All three are the same event conceptually: something changed that could have moved the bottom. Any code that special-cases one over the others is a signal that the state machine has been contaminated.

## Prior context

The current implementation has cycled through: virtualization introduction (Phase 27), correctness cluster on virtualization (Phase 28), temporary disable (patch #373), an auto-scroll three-case hook rewrite (Phase 32, the previous attempt at this), a tall-bubble content-size-watcher split (patch #437), a scroll-sentinel intersection fix (2026-08-30), and a session-pick regression + partial revert (2026-09-01). Four scroll bounties are currently open on the box-maintainer role: `pretty-view-auto-scroll-three-bug-rewrite` (in-progress, most active), `conversations-scroll-to-bottom-on-load` (open since 2026-07-30), `pretty-view-scroll-to-bottom-after-send` (open since 2026-07-27), `conversation-list-scroll-delay-on-load` (open since 2026-08-01). A fifth bounty — `load-more-scroll-and-order-corruption` (HIGH priority, since 2026-08-23) — is explicitly deferred out of scope for this rewrite (see Scope edges).

From the operator's perspective, the current experience is: session doesn't always land at bottom on entry; window resize breaks the bottom anchor; adding sessions via drag-drop breaks the bottom anchor; task or subagent accessory bubbles appearing above the compose box cover the latest message when already at bottom; jump-to-bottom button doesn't always appear when expected.

Research pass across authoritative sources on chat scroll implementations confirms the two-state position-as-source-of-truth pattern with an input-origin bit for the out-transition is the standard shape. Same research surfaced two pitfalls to fold in: iOS touch-momentum overshoot (allow additional threshold slack on touch devices) and the browser's built-in scroll-anchoring feature fighting explicit scroll writes (disable it on the container).

## What would make it wrong

- If the code ends up special-casing which kind of event triggered a chase (message vs. accessory vs. resize vs. pane change), the state machine has been contaminated and the invariant will drift.
- If any programmatic scroll write can transition mode, the recursive-bug pattern the current code trips on is back.
- If the mount-time landing has a visible flash at the top before jumping to bottom, the hide-pin-reveal pattern was not implemented correctly.
- If iOS momentum-scroll rubber-band produces a silent out-of-at-bottom flip during a chase, the input-origin bit was skipped.
- If the browser's built-in scroll-anchoring is left enabled on the container and produces subtle drift under mutation, the explicit ownership decision was not enforced.
- If the rewrite ends up needing three or more distinct kinds of watchers racing each other, the design has slid back into the shape of the current code.

## Scope edges

**In scope:**
- Two-state at-bottom / not-at-bottom state machine, position-derived with input-origin gating for transitions.
- All chase triggers: new messages, WIP indicator appear/disappear, all accessory bubbles above compose appear/disappear (task, waiting, planning, aside), window resize, pane-count / split-layout change.
- Send-message flip to at-bottom regardless of prior state.
- Jump-to-bottom button visibility bound to not-at-bottom state; click flips back to at-bottom.
- Mount-time landing via hide-pin-reveal.
- Session re-entry preserves scroll position (no touch).
- Explicit ownership of scroll position; browser scroll-anchoring disabled on the scroll container.
- Instant chases, coalesced one-write-per-frame.
- Full test coverage for the state machine and its transitions.

**Out of scope (deferred to follow-on):**
- Load-more anchor preservation (prepending older messages without visual jump). Tracked separately under bounty `load-more-scroll-and-order-corruption` (HIGH). The scroll container will be prepared for this to plug in cleanly (browser scroll-anchoring already disabled), but the anchor logic itself is a distinct mechanism and lands separately.
- Unread count or badge on jump-to-bottom button. Plain button, decision locked.
- Smooth-scroll animation on chase. Instant only, decision locked.
- Virtualization or windowed pagination changes. Separate bounty (`replace-pv-virtualization-with-windowed-pagination`).

**Tempting-but-no:**
- Guessing whether a scroll delta was user-caused or programmatic without an actual input event. Any such heuristic is a source of bugs; the input-origin bit is what makes the state machine sound.
- Adding a distinct "sending" state or "loading" state to the state machine. The two-state model is the whole point; any additional state that isn't strictly required for the invariant is contamination.

## Vehicle notes

Full GSD phase — discuss-phase → plan-phase → execute-phase. Phase-shaped by every measure (load-bearing surface, multiple bounties riding on it, multi-step build, prior attempts already tracked in ROADMAP as phases). The next step per `/build`'s auto-proceed rule is `/gsd:discuss-phase`, seeded from this shape file (either drop this file in as CONTEXT.md directly, or generate CONTEXT.md from it — don't re-elicit the "why + what + constraints" content that's already captured here).

The role holding this work is `box-maintainer`. Four bounties expected to close on ship: `pretty-view-auto-scroll-three-bug-rewrite`, `conversations-scroll-to-bottom-on-load`, `pretty-view-scroll-to-bottom-after-send`, `conversation-list-scroll-delay-on-load`. Fifth bounty `load-more-scroll-and-order-corruption` remains open post-ship as the follow-on.
