# Shape: Fleet auth reminders + guided re-login, in Skynet

**Opened:** 2026-08-03
**Vehicle:** GSD phase (single phase, three waves)

## What this is

A feature inside Skynet — the surface Ashley already uses to work with her fleet — that watches, for every managed box that runs the coding-harness, when the harness's login is going to force her to reauthenticate. It warns her ahead of time in the same surface she's already in, and gives her a guided flow to actually resolve the reauth right there without leaving Skynet or opening a session on the box by hand. So instead of finding out she's stranded when a scheduled wake-up fires into a dead harness, she sees a card telling her which box needs attention and clicks through a self-contained login flow that takes care of it.

## Shape

Two concerns, one integrated experience:

**The reminder side.** Skynet reaches into each qualifying managed box (over the same connection it already uses to read remote artifacts) to learn two things per box: when the last hand-typed re-authentication happened on that box (from the box's own record of typed commands), and whether the harness on that box is currently authenticated (by asking the harness directly, which is a cheap read-only query that doesn't rotate tokens). From those two, Skynet computes a per-box status: fine (no signal), close-to-expiring (yellow), or expired (red). Boxes needing attention surface as cards at the top of the conversation list — above all sessions — one card per affected box, expired above warning within the stack. Silent otherwise. No always-on status display, no dedicated fleet panel, zero visual weight when everything is fine.

**The guided-login side.** Each card is not just informational — it's an entry point. Clicking a card opens a full-app-blocking modal that drives the login for that specific box. Behind the modal, Skynet spins up a short-lived hidden session on the target box, kicks off the login command, auto-confirms the harness's first prompt (which is always the same choice she wants), captures the URL the harness emits, and presents it to her — auto-opened in a new tab if the browser allows it, or a clickable link otherwise. She does the browser side of the OAuth flow, gets back a code, pastes it into the modal, and Skynet feeds it into the hidden session, hits the right sequence of confirmations, waits for success, and tears down the session. The card disappears the moment the reauth lands. If she cancels the modal — deliberately, by navigation, by a tab crash — Skynet tears down the hidden session on the box so nothing is left hanging. If any step of the flow doesn't produce its expected signal within a reasonable time, Skynet times it out, marks the attempt failed, and puts her back at the card with a plain error, from which she can try again.

**Peekable.** The hidden session isn't strictly invisible — the same keyboard shortcut she already uses to peek behind pretty-view on a normal session reveals the raw session behind the login modal. That's the diagnostic escape hatch for when the flow does something unexpected. Not a button, not visible affordance — same shortcut she already has muscle memory for.

**Which boxes participate.** Determined by capability, not hand-picked. A box qualifies if it's Linux, has the terminal-multiplexer installed, and has the coding-harness installed — basically the prerequisites for the login flow to work at all. Skynet auto-detects on each managed host and silently skips those that don't meet the bar. No configuration.

## Philosophy

- **Skynet is where she lives to manage the fleet, so authentication belongs there.** Not scattered as per-box scripts she can't see, not routed through a channel she has to check separately.
- **Silence is success.** Boxes that are fine get zero visual weight. The feature only exists visually when it has something to say.
- **One clear signal per box per cycle.** No repeating alarms, no re-nagging. When she reauthenticates, the counter naturally resets, the card disappears, the box goes quiet.
- **Notice and resolve are one loop, not two.** The thing that tells her "log in" is the same thing that lets her actually log in. She never has to context-switch to another surface to fix what Skynet is telling her about.
- **Full-blocking modal during the flow.** No parallel logins, no half-attention on the flow. This is a short, focused interaction and it deserves the whole window.
- **Coarse-grained failure handling.** The feature does not try to enumerate every failure mode of the harness's login sequence. One blanket timeout per step waiting for its expected signal, generic error on any anomaly, retry from scratch. Not chasing perfection at the cost of complexity.
- **Ephemeral and self-cleaning.** The hidden session behind the modal exists only for the duration of the flow. Cancel or complete — either way, nothing lingers.

## Prior context

The precursor to this was a per-box notification script explored earlier in the same session — a small cron job reading the box's own record of typed commands to compute time-since-last-login, DMing when a threshold was crossed. That approach was decided against in favor of building the feature into Skynet: same detection logic (which is where the design of the reminder side comes from — that part is settled research), but Skynet-native surface + guided-flow addition. The cron script was NOT shipped as a day-zero safety net; going straight to the Skynet feature.

Detection specifics that carried over from that research:
- The harness has an eight-hour access-token cycle that auto-refreshes silently. This is well-known and NOT what the reminder is about — the reminder is about the longer refresh-token expiry which forces a hand-typed re-authentication.
- Research through community reports converged on approximately a thirty-day refresh-token lifetime, reverse-engineered from the underlying cookie. Anthropic does not publish the number.
- The harness itself has a three-day advance warning built in (v2.1.203+), but it only shows at harness startup — on always-on maintainer boxes where the harness has been running for weeks, that warning fires into an unattended session and is never seen. The fleet is currently pinned to an older harness version anyway.
- Ashley's fleet has multiple accounts she rotates between during high-usage weeks, which shortens the effective login cycle on any box she's using at that moment. The reminder side accommodates this naturally: any re-authentication event, for any reason, resets the counter — no special handling needed.
- Multiple concurrent harness processes across the fleet can rotate-invalidate each other's refresh tokens, which shortens the natural cycle in practice. Not fixable within this feature — the reminder just catches whatever happens.

The threshold value for "close to expiring" starts at approximately five days out (against the thirty-day baseline). This is tunable; the estimate could be wrong and we'll adjust based on how it fires in practice.

The already-integrated affordances this feature builds on:
- Skynet's existing per-host connection layer that reads remote files and runs remote commands over SSH.
- Skynet's session-driving primitives that spawn and drive terminal sessions on managed hosts.
- The conversation-list surface, where the cards live at the top.
- The pretty-view peek keyboard shortcut, whose semantics are extended to also reveal the hidden session behind the login modal.

## What would make it wrong

- **A scheduled wake-up fires into an unauthenticated harness with no prior warning.** The core failure mode this feature exists to prevent. If a maintainer box is stranded and Ashley didn't get a card in Skynet warning her ahead of time, the feature has missed its point.
- **Ashley gets pinged when nothing is actually wrong.** False-positive warnings — cards appearing when the box is fine — erode trust in the signal and train her to ignore it. Better to under-warn (fall back to the red-expired card) than to over-warn.
- **The guided flow becomes a place things get stuck.** If she clicks the log-in button and ends up with a modal that spins forever with no way to abandon it, or a hidden session that survives modal cancel and blocks a session slot, the feature has gone from helpful to actively harmful. Cancel and timeout are load-bearing.
- **Half-fixing after the fact.** If the guided flow completes successfully but the card doesn't disappear (stale state), or fails and leaves both the box in an unknown state AND the card still up in some ambiguous read, the loop is broken. Post-flow state must reconcile cleanly with reality.
- **Skynet keeps holding a token that isn't hers to hold.** The OAuth code passes transiently through Skynet's server memory during the paste-back step. That's acceptable (same trust posture as the SSH keys Skynet already holds) — but if we ever start persisting the token, logging it, or exposing it beyond the flow, we've crossed a line that wasn't part of the design.
- **The auth-status query itself starts rotating tokens.** The read-only query used to check if the harness is currently authenticated has been verified read-only. If a future harness version changes that (querying now consumes/rotates a token), our polling becomes the cause of the exact problem the feature exists to warn about.
- **A box gets watched that shouldn't be.** If Skynet starts polling a box that doesn't have the harness installed and generates spurious "expiring" cards for something that doesn't apply, the qualification-by-capability rule has failed.

## Scope edges

**In:**
- Per-box polling of last-login-time and current-auth-state, on the interval Skynet already uses for its other remote reads.
- Auto-detection of which boxes qualify (Linux + terminal-multiplexer + coding-harness installed).
- Top-of-list cards with expiring/expired styling, stacked expired-above-warning, always fully visible (no collapse).
- Click-a-card entry point to a full-app-blocking guided-login modal.
- Hidden-session driving of the login command with auto-confirmation of the choice-of-auth prompt, URL capture, and code-paste-back.
- Auto-open of the login URL in a new browser tab when the browser permits, clickable link fallback.
- Same-shortcut peek-through to reveal the hidden session driving the flow.
- Cancel-tears-down semantics: any way the modal goes away (button, navigation, tab crash, backend restart) results in the hidden session being cleaned up on the target box.
- Blanket per-step timeouts with a plain error and retry-from-scratch on any anomaly.
- Auto-clear of the card as soon as the reauth lands successfully.

**Out (of this phase):**
- A redundant direct-message channel that fires when Ashley isn't in the app. Explicitly deferred — she said "something to reach out to me, but I think we save that for later."
- Proactive re-login trigger outside the warning window. If a box is fine, Skynet does not offer a way to log it in — the only entry point is a card that appeared because something is expiring or expired.
- A dedicated fleet-wide auth-status glance view. Silent-when-fine means no always-on status surface.
- Per-error-mode recovery flows. Coarse-grained timeout + retry is the whole story.
- Handling non-Linux, non-tmux, non-harness boxes. Those silently don't participate.
- Per-box configurable threshold. One threshold value fleet-wide, adjustable in one place if the community's thirty-day estimate proves wrong.

**Tempting-but-no:**
- Adaptive threshold that learns each box's actual cycle. Feels clever but adds drift and complexity for a signal that's already fuzzy — fixed threshold is honest about the imprecision.
- A "log in on this box" button that appears at all times. Duplicates the entry-point role of the card and violates the silence-when-fine principle.
- Trying to distinguish "you got force-logged-out by the concurrent-process race" from "the token naturally expired." No user-actionable difference — either way, the card appears, the flow runs, done.
- Multi-account picker inside the flow. The harness's first prompt is auth-method (not account) — auto-confirming works uniformly. If future account-picking becomes a thing, that's a follow-up.

## Vehicle notes

**Why one phase, three waves:**

The three vertical layers of this feature — the detection engine, the surfaced cards, and the guided flow — are tightly coupled at the wire. The card is meaningless without the detection engine feeding it; the entry-point button is a lie without the flow behind it. Splitting into two phases (reminder-only first, guided-flow later) would ship a half-feature where clicking the "log in" affordance either does nothing or context-switches to a shell — the exact thing Ashley called out as unacceptable when she asked for this to be Skynet-native in the first place. One phase, one coherent vertical slice, verified end-to-end before it lands.

**Suggested wave shape (the phase planner may adjust):**

- Wave 1 — Detection engine. Per-box capability probe, remote read of the login-command record, remote auth-status query, backend state per host, WebSocket-out signals for expiring/expired transitions, no UI yet.
- Wave 2 — Cards. Top-of-list expired-above-warning card list, subscribed to the Wave-1 signals, styling matches existing per-row visual language, self-clearing on reauth-detected.
- Wave 3 — Guided flow. Full-app-blocking modal, hidden-session driving, URL capture, code paste-back, auto-confirm sequence, cancel-teardown, per-step timeout with retry, peek-through wired to the pretty-view peek shortcut.

**Handoff notes for the plan-phase agent:**

- Owning identity: Tina (Skynet fork maintainer on this box).
- The current session already has extensive research on the detection side (community-consensus ~30-day refresh-token lifetime, harness-side signals available/unavailable, concurrent-process rotation race). No need to redo that research.
- Skynet is currently pinned to harness version 2.1.150 fleet-wide; the login prompt sequence to auto-confirm is the 2.1.150 sequence. Any future harness upgrade is a concentrated separate effort that will include re-verifying this feature's assumptions.
- No day-zero safety-net cron was shipped; the fleet is unprotected between now and this feature landing. Not a blocker — Ashley explicitly said she's not worried about the interim.
- The archived bounty `login-reminders-or-something` under Tina's identity holds the empirical-watcher data and research trail that informed this shape.
