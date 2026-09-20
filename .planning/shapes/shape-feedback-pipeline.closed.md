# Shape: feedback pipeline

**Opened:** 2026-09-19
**Vehicle:** GSD phase
**Part of campaign:** `campaign-user-feedback.md` — shape 1 of 3

## What this is

The foundational plumbing for the user-feedback campaign. Delivers a portable, per-instance-configurable pipeline that any future trigger can plug into: a backend intake, a shared composition modal, environment-driven configuration with graceful hide when unset, a post-send acknowledgement, and a startup path that boots cleanly whether the operator has wired feedback up or not.

No user-facing trigger ships in this shape. The general button (shape 2) and message thumbs (shape 3) mount their own callers into this pipeline. Shape 1 is un-triggerable through the normal UI on its own; a dev-only trigger exists so the pipeline can be exercised end-to-end during verification.

## Shape

**A backend feedback intake.** One path, authenticated by the existing user session. Every future trigger — the general button, thumbs up, thumbs down — hands it a payload and it does the same thing regardless of caller: write a line to the console log, compose an email, hand off to the mail transport.

**A shared composition modal.** Same visual language as existing modals in the app (dark glass gradient, tinted border, uppercase 10px labels, warm off-white text). Two entry variants driven by which caller opens it:

- **General variant.** Title "Send feedback". Placeholder "What's on your mind?". Cancel + Send buttons. Dismissing sends nothing.
- **Thumbs-down variant.** Title "What went wrong?". Placeholder "Anything you want to add?". Close-X in the corner. Single Send button. The message being reacted to is not quoted back to the user in the modal.

**A post-send acknowledgement.** Bottom-right toast, ~2 second fade, "Thanks — feedback sent." Same toast fires after a thumbs-up (which has no modal path — it fires immediately on click).

**Environment-driven configuration.** All configuration lives in the deployment environment:

- Mail transport settings (host, port, user, password, from-address).
- Destination address (where feedback lands).
- Content-inclusion flag — a separate boolean, defaults off when unset.

**A frontend "is feedback configured" signal.** The frontend asks the backend once whether feedback is available on this deployment; the backend answers based on whether the mail transport settings AND the destination address are both present at startup. The frontend uses this to render the UI or hide it entirely. Read once at backend startup and cached — no per-request re-read.

**Instance name comes from the existing branding config.** No new environment variable for it. The name that appears in the email subject line and header block is the same one the operator has already configured for the app UI.

**Email format.** Plain text, no HTML.

- Subject: `[<instance-name> feedback] <type>` where type is `general`, `thumbs up`, or `thumbs down`.
- Header block: who submitted (username from the auth session), which instance, when (timestamp), what type.
- User note section: whatever the user typed, if anything.
- Exchange section: when content-inclusion is on AND this is a thumb-attached feedback, the exchange is included as markdown source verbatim — the assistant reply that was thumbed plus the user turn that prompted it. Nothing else. No rendered HTML, no images, no wider conversation window.

**Send failure behavior.** Log to console, drop. User always sees the "thanks" toast regardless of send outcome. No retries in this shape.

**Startup behavior.** If the config is present and looks structurally valid, feature is enabled. If it's absent, incomplete, or structurally invalid, feature is disabled — the app boots normally regardless. Bad-but-present SMTP credentials (that fail at actual send time) are NOT gated at boot; they're caught at send time and logged.

**Dev-only verification trigger.** A hidden way (keyboard shortcut or dev route) for exercising the modal end-to-end during shape 1's own verification, so shape 1 can be shipped and validated before shape 2 or shape 3 land real triggers. Removed or gated by the time it would matter for real users.

**Payload contract between shape 1 and its future callers.** The caller supplies: the kind of feedback (general / thumbs-up / thumbs-down), the user's typed note if any, and — for thumbs — a reference to the message plus the surrounding exchange text (assistant reply and prompting user turn, as markdown source). The backend fills in: who submitted, instance name, timestamp, content-inclusion decision. Message content travels client-to-server on the wire; the backend does not fetch it from a message store.

## Philosophy

**Portable, not bespoke.** Same code ships to every deployment. Per-instance config lives entirely in the environment. Nothing hardcoded per operator.

**Two independent flags, orthogonal decisions.** Turning on the feature (setting the mail transport + destination) is one gesture. Turning on content-inclusion is a second, separate gesture. Operators can enable either alone.

**Content-inclusion opts in explicitly.** When the flag is unset, message content stays out of emails even though the mechanism is on. Users don't set this expectation — operators do — but the app doesn't leak conversation content by default when someone wires the mechanism up in a hurry.

**Fire-and-forget on the send.** The user's experience never depends on whether the mail transport succeeded. Send failures are the operator's problem to notice via console logs, not the user's problem to be told about.

**No new abstractions.** Reuse the existing branding config for instance name. Reuse the existing auth session for user identity. Reuse the existing modal visual language. Don't introduce parallel systems for things the app already handles.

**Console log is the fallback record.** Every feedback submission generates a console line whether or not the email lands, so nothing a user typed is lost even in the failure path.

## Prior context

The app has an existing branding config the operator populates. It already carries the instance name used in the app UI. This shape reuses it.

There is no existing feedback surface in the app today. This is greenfield.

There is no existing mail transport wired into the app. This shape introduces one.

The app's modal visual language is well-established across many surfaces: dark glass gradient (`hsla(hue, 45%, 25%, 0.82)` to `hsla(hue, 40%, 15%, 0.88)`), backdrop blur with saturate, tinted border, rounded 16-20 pixel corners, warm off-white text (`#e8e4d8`), uppercase 10-pixel tracking-wide labels, pill-shaped buttons. The tasting page confirmed the new modal fits that language.

Skynet requires authentication — anonymous feedback is not a case that exists.

The app has no URL scheme for linking to a specific message in a specific conversation from an external context. Emails do not carry "view in app" links.

Skynet's assistant messages can include markdown, code blocks, and images. Only text (markdown source) travels in emails; images do not, in this shape.

## What would make it wrong

- If a user sends feedback and it silently fails with no operator awareness. The console log must always land, even when the mail send doesn't.
- If message content appears in an email when the content-inclusion flag is off. The flag governs the email body content, not just an in-app option.
- If the feedback UI shows up on a deployment where the mechanism isn't configured. Hide behavior must be tight — no half-visible affordances, no error banners.
- If the app fails to boot because the mail transport is misconfigured. Boot is robust to bad or missing config.
- If the modal blocks or delays the chat surface. It's an optional overlay, never in the critical path.
- If a user's typed note is lost with no record between submit and send. The console log captures the note before the send is attempted.
- If the general button attaches conversation context to its email. General means general — no conversation ID, no message context, no implied relationship.
- If the mechanism turns out to be user-scoped instead of instance-scoped. All users of an instance share the same config; the operator makes one decision for the whole instance.

## Scope edges

**IN this shape:**
- The backend intake path and its handler
- The shared composition modal (both entry variants) as a reusable UI component
- The post-send toast component (reusable — thumbs-up will also fire it in shape 3)
- Environment-variable config plumbing
- The "is feedback configured" signal exposed to the frontend
- Startup handling for enabled/disabled state
- Email composition (subject, header block, user note, exchange section) as plain text
- Mail transport integration (send + failure logging)
- Instance name pulled from existing branding config
- A dev-only trigger for end-to-end verification
- Tests covering the pipeline paths, config states, and modal behavior
- Documentation of the environment variables the operator sets

**OUT of this shape (belongs elsewhere):**
- The general "Send feedback" button placement in the app shell — shape 2
- Thumbs affordances on assistant messages — shape 3
- Any specific caller wiring — shapes 2 and 3
- Rich HTML email — not this shape, possibly never
- Image or attachment inclusion in emails — not this shape
- Rate limiting or abuse throttling — accepted risk for v1
- Retry-on-failure or persistence queue — v2 concern
- DB persistence of feedback records — v1 is email-out only
- Draft preservation across modal open/close — transient state
- Per-user email destinations — one destination per instance
- Category-based routing — no categories, single body
- Multiple destination addresses per operator — one address per instance
- Anonymous submissions — not applicable, auth is required
- Cancel-my-thumbs behavior — thumbs are single-tap final, not reversible via the modal
- A URL scheme for linking to a specific message — not present in the app, not built here

**Tempting but no:**
- Sanitizing markdown to plain text before sending. Markdown source verbatim is the design; stripping loses fidelity for no gain.
- Adding an in-app "settings" surface for feedback configuration. Environment-only is deliberate — operator-owned.
- Adding a Reply-To header with the user's email. Users don't provide an email; identity is the username.

## Vehicle notes

**Vehicle:** GSD phase, added via `/gsd:phase` then planned via `/gsd:plan-phase` (auto-proceeds to execute per standing rule).

**Seed CONTEXT.md from this shape file** — the "why + what + constraints + scope edges" are captured here, so `/gsd:discuss-phase` should read this rather than re-elicit the same ground.

**Related files:**
- Parent campaign artifact: `.planning/campaign-user-feedback.md`
- Tasting artifact (informative reference for the modal visual choices): `/home/ubuntu/fleet/identities/lark-box-maintainer/workspace/tasting-feedback-modal/index.html`

**Identity doing the work:** lark (via this session's `/build`).

**Deploy:** After code lands and a code review passes, deploy requires the user's explicit greenlight per the role's per-push authorization rule. The GSD phase's execute step covers code + commit + tests green; container build + `docker compose up --force-recreate` is a separate gesture after review.

**On completion of the built work:** run `/close shape-feedback-pipeline` to verify conformance against this file, then mark shape 1 complete in the campaign artifact's Shapes section.

---

## Close-Out

**Closed:** 2026-09-19
**Vehicle used:** GSD phase (Phase 123, 4 plans across 2 waves)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — foundational pipeline, no user-facing trigger, dev-only trigger for verification** — present · backend intake + shared modal + env-driven config + toast + startup + dev chord all present; no general button or thumbs affordance shipped
- **Shape: backend feedback intake (one path, auth-gated, same handling regardless of caller)** — present · POST /feedback authenticated by JWT middleware; single handler serves general/thumbs_up/thumbs_down
- **Shape: shared composition modal (general variant — title/placeholder/Cancel+Send/dismiss-sends-nothing)** — present · title "Send feedback", placeholder "What's on your mind?", Cancel+Send, dismiss sends nothing
- **Shape: shared composition modal (thumbs-down variant — title/placeholder/close-X/single Send/no message quoted)** — present · title "What went wrong?", placeholder "Anything you want to add?", close-X, single Send; message being reacted to is NOT rendered back
- **Shape: post-send acknowledgement toast (bottom-right, ~2s, "Thanks — feedback sent.")** — present · sonner Toaster mounted at position="bottom-right"; toast.success fires on both send and dismiss-with-vote paths
- **Shape: environment-driven configuration (mail transport, destination, content-inclusion flag defaults off)** — present · seven env vars, content-inclusion defaults false
- **Shape: frontend "is feedback configured" signal (asked once, transport+destination both present, cached)** — present · GET /api/feedback/enabled auth-gated route; frontend store reads once from AppShell mount effect; backend cache populated at boot
- **Shape: instance name comes from existing branding config (no new env var)** — present · reuses BrandingConfig.appName in subject and header block
- **Shape: email format (plain text, subject, header block, user note, exchange section verbatim markdown)** — present · text-only sendMail, subject `[<appName> feedback] <type>`, header lines match, sections gated correctly
- **Shape: send failure behavior (log to console, drop, always show toast, no retries)** — present · sendFeedbackEmail catches internally and never rethrows; client-side postFeedback swallows errors; no retry code
- **Shape: startup behavior (present+valid → enabled; absent/invalid → disabled; bad-but-present creds caught at send time)** — present · never-raises config loader; no SMTP handshake at boot
- **Shape: dev-only verification trigger (hidden, gated for real users)** — present · Ctrl+Alt+F / Ctrl+Alt+T chord hook gated by import.meta.env.DEV (tree-shaken from production bundle)
- **Shape: payload contract between shape 1 and future callers** — present · kind/userNote/messageRef/exchangeText from caller; submitter/instance/timestamp/content-decision filled by backend
- **Philosophy: portable, not bespoke** — present · single codepath, all per-instance config via env vars
- **Philosophy: two independent flags (feature-on vs content-inclusion)** — present · content-inclusion env var is separate from transport+destination trio
- **Philosophy: content-inclusion opts in explicitly (defaults off)** — present · returns false for empty/unset/any non-truthy value
- **Philosophy: fire-and-forget on the send** — present · route returns 202 without awaiting send; client shows toast regardless of outcome
- **Philosophy: no new abstractions (reuse branding, auth, modal language)** — present · reuses branding config, existing JWT auth middleware, existing modal glass gradient chrome
- **Philosophy: console log is the fallback record** — present · full userNote + exchangeText logged BEFORE the send attempt (pre-send log line is audit trail)
- **Prior context: existing modal visual language reused** — present · gradient hsla stops, backdrop-blur+saturate, tinted border, 20px radius, `#e8e4d8` text — all matched
- **Prior context: auth required (no anonymous feedback)** — present · authenticateJWT applied to both routes; POST returns 401 when userId missing
- **Prior context: only markdown source travels in emails; no images or wider conversation** — present · text field only; exchangeText treated as opaque markdown string
- **What would make it wrong: silent send failure with no operator awareness** — present · pre-send log writes full payload; failed send logs error via sshLogger.error
- **What would make it wrong: message content in email when content-inclusion flag is off** — present · server-side gate strips exchangeText at route BEFORE composeBody, even if caller sends it on the wire
- **What would make it wrong: feedback UI shows up on unconfigured deployment** — present · feedback-store defaults to `{enabled:false}`; useFeedbackEnabled() returns false until backend confirms; shapes 2+3 gate their triggers on this
- **What would make it wrong: app fails to boot on misconfigured mail transport** — present · loadFeedbackConfig never raises; boot proceeds; no SMTP handshake at boot
- **What would make it wrong: modal blocks or delays the chat surface** — present · Radix Dialog overlay, non-blocking, only rendered when open; no critical-path involvement
- **What would make it wrong: user's typed note lost with no record between submit and send** — present · sshLogger.info writes FULL userNote + exchangeText BEFORE the send fires
- **What would make it wrong: general button attaches conversation context to its email** — present · server-side gate strips exchangeText when kind==="general", even if caller sends it on the wire
- **What would make it wrong: mechanism turns out user-scoped instead of instance-scoped** — present · config sourced from process.env, cached in module scope; one destination per instance
- **Scope IN: backend intake path + handler** — present
- **Scope IN: shared composition modal (both variants) as reusable UI component** — present · one component with variant prop
- **Scope IN: post-send toast component (reusable for shape 3 thumbs-up)** — present · Toaster mounted globally; toast.success call is a one-liner any future caller can fire
- **Scope IN: environment-variable config plumbing** — present
- **Scope IN: "is feedback configured" signal to frontend** — present
- **Scope IN: startup handling for enabled/disabled state** — present · disabled sentinel is a valid runtime state
- **Scope IN: email composition as plain text** — present · pure composition, text-only
- **Scope IN: mail transport integration (send + failure logging)** — present · fire-and-forget contract with internal failure logging
- **Scope IN: instance name from branding config** — present
- **Scope IN: dev-only trigger** — present
- **Scope IN: tests covering pipeline paths, config states, modal behavior** — present · 7 test files, 109 total feedback-scope tests
- **Scope IN: documentation of env vars for operator** — present · JSDoc header enumerates all FEEDBACK_* env vars with required/optional status and expected values
- **Scope OUT: general "Send feedback" button placement (shape 2)** — present · no button placement in AppShell beyond invisible modal mount for the dev chord
- **Scope OUT: thumbs affordances on assistant messages (shape 3)** — present · no thumbs UI added
- **Scope OUT: rich HTML email** — present · sendMail called with only text field; no html field, no multipart alternatives
- **Scope OUT: image or attachment inclusion** — present · no attachment field; exchangeText is opaque string only
- **Scope OUT: rate limiting / abuse throttling** — present · no rate-limit middleware
- **Scope OUT: retry-on-failure / persistence queue** — present · no retry logic; failed sends dropped after logging
- **Scope OUT: DB persistence of feedback records** — present · no drizzle schema for feedback; email-out only
- **Scope OUT: draft preservation across modal open/close** — present · draft resets to empty on every open transition
- **Scope OUT: per-user email destinations** — present · single destination per instance
- **Scope OUT: category-based routing** — present · no category selector, no category field, single body composition
- **Scope OUT: multiple destinations per operator** — present · single destination address
- **Scope OUT: anonymous submissions** — present · auth required on both routes
- **Scope OUT: cancel-my-thumbs behavior** — present · no cancel/undo affordance
- **Scope OUT: URL scheme for linking to a specific message** — present · no view-in-app links generated
- **Tempting but no: sanitizing markdown to plain text** — present · exchangeText inserted verbatim; no stripping or escaping in composeBody
- **Tempting but no: in-app settings surface for feedback config** — present · environment-only per shape lock
- **Tempting but no: Reply-To header with user email** — present · sendMail sets only from/to/subject/text; no Reply-To added

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Clean pass both ways. A handful of small defensive choices (503 on stale-client POST when disabled, 512kb inline body cap on POST /feedback, "unknown" submitter fallback when DB row is missing, anonymous-relay SMTP support via optional USER/PASSWORD pairing, nginx dual-file blocks for both /api/feedback/enabled and /feedback) sit within the shape's philosophy (portable, no new abstractions, fire-and-forget, console-log-as-fallback) rather than adding user-facing surface. The dev-trigger modal mount is unconditional in AppShell but has no user-reachable path in production because the chord hook self-gates behind import.meta.env.DEV — the shape's "gated by the time it would matter for real users" commitment is satisfied structurally. Worth carrying into shapes 2 and 3: (1) the useFeedbackEnabled() hook is the intended gate for their triggers per code comments; (2) the payload contract's exchangeText field is already validated + gated server-side so callers can send it optimistically; (3) the toast is a globally-mounted singleton so any caller can fire "Thanks — feedback sent." without additional wiring.
