# Campaign: user feedback

**Opened:** 2026-09-19
**Status:** in_progress
**Workspace:** `/home/ubuntu/fleet/identities/lark-box-maintainer/workspace/skynet/.planning/`

## Concept

A portable, per-instance-configurable feedback pipeline for the app. Any user of any deployment can send feedback from inside the app; each deployment operator configures where feedback lands via environment variables (SMTP credentials plus a destination email address). Nothing bespoke to any single deployment — the same code ships everywhere and each operator wires up their own email endpoint.

Three trigger points, one shared composition surface, one backend path:

- A general "Send feedback" button somewhere in the app shell — for anything a user wants to volunteer.
- Thumbs up on assistant messages — for signaling that a specific reply was good.
- Thumbs down on assistant messages — for signaling that a specific reply was bad, with room for the user to elaborate.

All three funnel into the same backend, which logs to console and sends an email to the configured destination address for that instance. On instances where the environment variables aren't configured, the feedback UI hides — nothing half-broken, nothing complaining, just absent.

## Success criteria

The concept has been fully met when:

- An operator can enable feedback on any deployment by setting the environment variables — no code changes, no per-deployment forks.
- A user in a running conversation can leave a thumbs up on any assistant message with one tap. That tap fires an email; the user gets a brief acknowledgment so they know it registered. No modal.
- A user in a running conversation can leave a thumbs down on any assistant message with one tap. That tap opens a modal for optional elaboration. Whether the user submits with a note or dismisses without one, exactly one email fires for that thumbs down, carrying whatever was said (or wasn't).
- A user anywhere in the app can hit the general feedback button, compose freeform feedback with a light category selector, and submit. That fires an email. Dismissing the modal without submitting sends nothing (unlike thumbs down, there was no signal to preserve).
- On deployments where feedback isn't configured, the feedback UI simply isn't present. No error banners, no placeholders, no half-visible buttons that do nothing.
- Email send failures are logged to console but the user still sees the same "thanks" they'd see on success. Nothing surfaces the failure to the user.

## Shapes

Sequence is 1 → 2 → 3, because 2 and 3 both depend on the backend and modal from 1. Doing 2 next confirms the pipeline works end-to-end with the simpler consumer before wiring per-message polish in 3.

- **[complete] shape-feedback-pipeline** — The shared feedback backend and composition modal. Environment-variable-driven configuration, log-to-console, send email on submit, graceful hide when unconfigured. No triggers yet — this is the plumbing everything else plugs into. Status: complete (2026-09-19). Vehicle: Phase 123 (4 plans, 2 waves). Verifier 12/12, /close closed-hit, code-review 9 fixes applied. Artifact: `.planning/shapes/shape-feedback-pipeline.closed.md`. Not pushed / not deployed — deploy deferred to end of campaign.
- **[complete] shape-feedback-general-button** — The "Send feedback" trigger placed as a single icon button (`MessageSquare` at 18px) at position five of six in the conversation-list header row, right before the kebab menu; opens shape 1's shared composition modal in general variant; hidden on unconfigured deployments via shape 1's `useFeedbackEnabled()` signal. App-level not conversation-level — no conversation context attaches (D-25 lock inherited from shape 1). No role gating in v1. Dev chord unchanged. Status: complete (2026-09-20). Vehicle: Phase 124 (1 plan, 1 wave). Verifier 13/13 must-haves passed, /close closed-hit (zero unagreed additions), framework code-review found 0 blockers + 3 warnings (WR-01 dev-chord footgun, WR-02 doc-gap, WR-03 dead mock). Artifact: `.planning/shapes/shape-feedback-general-button.closed.md`. Not pushed / not deployed — deploy deferred to end of campaign.
- **[complete] shape-message-thumbs** — Thumbs up and thumbs down affordances on every assistant message + assistant-bubble layout swap (in-bubble speak → below-bubble action strip) gated on shape 1's enabled signal. Thumbs up is one-tap silent (fires email immediately, pressed state + toast acknowledgment). Thumbs down opens shape 1's modal for optional elaboration; a single email fires when the user either submits or dismisses. Off-deployments render exactly like today (Ashley's strong lock 2026-09-20). Status: complete (2026-09-20). Vehicle: Phase 125 (2 plans, 2 waves). Verifier 54/54 D-XX passed, /close verdict closed-hit (zero divergences, zero unagreed additions). Artifact: `.planning/shapes/shape-message-thumbs.closed.md`. Not pushed / not deployed — deploy end-of-arc (all 3 shapes now ready).

## Side-bounties

None yet.

## Other work

None yet.

## Lingerers (explicitly approved)

None yet.

## Open questions

- **Where the general feedback button lives in the shell.** Deferred to shape 2's shape-session — this is exactly the question that shape's `/open` is for.
- **What the modal actually asks.** Category options, field labels, tone of voice — deferred to shape 1's shape-session.
- **Whether the operator's email destination is one address or multiple** (e.g., different addresses for different categories). Default assumption: one address per instance, kept simple. If categorization within the email body is sufficient, we don't need to fork the destination — but shape 1 can revisit if it feels wrong there.

## Research notes (concept-open, 2026-09-19)

The thumbs-up behavior was the one question flagged for research. Findings that shaped the locked design above:

- Industry convergence (ChatGPT, Copilot Studio, published AI UX pattern guides): thumbs up = one-tap, no modal; thumbs down = one-tap logs the vote, then optional follow-up. Phrased in the pattern research as "satisfaction is fast; dissatisfaction gets structure when users opt in."
- Positive feedback capture collapses if you add a modal to it. Users don't have anything to compose when things worked; a modal punishes them for wanting to express approval. Only 1–3% of users click rating buttons in most implementations to begin with — adding friction to thumbs up costs most of that already-thin signal.
- The click IS the signal; the modal is optional elaboration. Standard pattern is to log the click on click, not on modal submit — otherwise votes are lost when users tap then dismiss.

The one deviation from the pure industry pattern in the locked design: on thumbs down, dismissing the modal still fires ONE email (not zero). The click captured the vote; the modal was for elaboration; either way the operator sees the thumbs-down signal. Two-email-per-thumbs-down was considered and rejected as spammy.
