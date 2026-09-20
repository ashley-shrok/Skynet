# Phase 123: user-feedback campaign shape 1 — feedback pipeline - Context

**Gathered:** 2026-09-19
**Status:** Ready for planning
**Source:** Generated from `.planning/shapes/shape-feedback-pipeline.md` (opened + greenlit 2026-09-19 via /build → /open, ~6 grill exchanges + modal tasting). Per build-skill rule, discuss-phase does not re-elicit ground the shape file already covers.

<domain>
## Phase Boundary

Shape 1 of the `user-feedback` campaign (`.planning/campaign-user-feedback.md`). Delivers the foundational plumbing every future feedback trigger plugs into: a backend intake path, a shared composition modal, environment-variable-driven configuration with graceful hide when unset, a post-send toast, and a startup path that boots cleanly whether or not the operator has wired feedback up. No user-facing trigger ships in this shape — the general "Send feedback" button is shape 2, message thumbs are shape 3. A dev-only trigger exists so shape 1 can be exercised end-to-end during verification.

</domain>

<decisions>
## Implementation Decisions

### Configuration surface

- **D-01:** Portable design — same code ships to every deployment. Per-instance configuration lives entirely in the environment; nothing is hardcoded per operator.
- **D-02:** Two independent flags. Flag one (mechanism enabled) is implied by the presence of BOTH the mail transport config AND the destination address. Flag two (content-inclusion) is a separate explicit boolean env var that defaults OFF when unset.
- **D-03:** Instance name is NOT a new env var. It comes from the existing `BrandingConfig.appName` loaded by `src/backend/branding/branding-config-loader.ts::loadBrandingConfig()`. Reuse — do not add a parallel.
- **D-04:** Env var naming — bikeshed at planning time, but the semantic set is fixed: mail transport (host, port, user, password, from-address), destination email address, content-inclusion boolean. Seven env vars total. SMTP user + password are treated as a pair (if one is set, the other must be too; both absent = anonymous SMTP relay is acceptable if the operator's transport supports it, otherwise the parser reports the feature as disabled).

### Startup and enablement

- **D-05:** Read env once at backend startup and cache. No per-request re-read. Operators change env via container restart anyway.
- **D-06:** "Feature enabled" is TRUE iff both mail-transport env vars AND destination address are present and structurally non-empty at startup. Either absent → feature disabled → all feedback UI hides on the frontend.
- **D-07:** Boot is ROBUST to invalid SMTP credentials. Bad-but-present credentials (auth fails at real send time) are NOT gated at boot — they surface at send time, log to console, and the feature stays "enabled" from the frontend's perspective. Rationale: opening an SMTP handshake at every boot is fragile; feedback is not essential to app operation.
- **D-08:** Frontend `is feedback configured` signal is a small backend-served value the frontend fetches once at load (or bootstraps at initial HTML render). Not per-request.

### Composition modal

- **D-09:** ONE reusable composition modal component with TWO entry variants driven by which caller opens it.
- **D-10:** General variant — title `Send feedback`, single textarea with placeholder `What's on your mind?`, footer buttons `Cancel` + `Send`. Dismissing (Cancel or backdrop click) sends nothing.
- **D-11:** Thumbs-down variant — title `What went wrong?`, single textarea with placeholder `Anything you want to add?`, close-X in top-right corner, single primary `Send` button in the footer. Close-X or backdrop click sends the vote WITHOUT a note (still fires ONE email); Send sends the vote WITH the note (fires ONE email). Message being reacted to is NOT quoted back to the user in the modal.
- **D-12:** No category selector. No footer disclaimer line ("sending to the operator of this instance" — considered and dropped for redundancy). No subtitle, no separate field label — title + placeholder carry all the guidance.
- **D-13:** Visual language reuses existing Skynet modal styling — dark glass gradient (`hsla(hue, 45%, 25%, 0.82)` → `hsla(hue, 40%, 15%, 0.88)`), backdrop blur with saturate 1.4, tinted border, warm off-white text (`#e8e4d8`), uppercase 10px tracking-wide labels for any labels used, pill-shaped buttons, rounded 16-20px corners. Reference implementations: `src/ui/features/pretty-view/AddWakeupDialog.tsx` (input-heavy modal) and `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` (small modal). Modal chrome uses Radix `Dialog` primitive same as those.

### Post-send acknowledgement

- **D-14:** ONE reusable toast component used by BOTH the modal submit path and the thumbs-up click path (thumbs-up in shape 3 has no modal — the click IS the submit). Bottom-right anchor, ~2 second visible then fade, single-line: "Thanks — feedback sent." Same toast fires regardless of send outcome (the user experience does not surface send failures).

### Email format

- **D-15:** Plain text email. NOT HTML. Not multipart-with-html-alternative. Just text.
- **D-16:** Subject line: `[<instance-name> feedback] <type>` where `<instance-name>` is `BrandingConfig.appName` (e.g., "gigaashley") and `<type>` is `general` / `thumbs up` / `thumbs down`.
- **D-17:** Sender address is the operator's configured from-address env var (not synthesized).
- **D-18:** Recipient is the operator's destination address env var (not synthesized). Single address per instance; no per-category routing, no multiple recipients.
- **D-19:** Body layout — key-value header block (`Feedback from: <user>`, `Instance: <appName>`, `When: <timestamp>`, `Type: <type>`), then optional `--- User note ---` section (user's typed text if any), then optional `--- Exchange ---` section (only when content-inclusion is ON and this is a thumb-attached feedback).
- **D-20:** No "View in app" link. Skynet has no URL scheme for opening a specific message in a specific conversation from an external context; do not invent one here.

### Content-inclusion semantics

- **D-21:** When content-inclusion flag is ON: thumbs-attached emails carry the markdown source of the assistant reply that was thumbed PLUS the user turn that prompted it. That's it — no wider window, no images, no attachments, no rendered HTML. Markdown SOURCE VERBATIM (fenced code stays fenced, links stay as bracket-syntax, etc.).
- **D-22:** When content-inclusion flag is OFF: the exchange section is omitted entirely from thumb emails. Ambient identity fields (submitter, instance, timestamp, type) always travel regardless of the content flag.
- **D-23:** General button emails NEVER carry message content — general is scope-free by design (see D-25).

### Payload contract between shape 1 and future callers

- **D-24:** Caller supplies: `kind` (one of `general` / `thumbs_up` / `thumbs_down`), `userNote` (string, may be empty), and — for thumbs — `messageRef` (an opaque identifier chosen by the caller) plus `exchangeText` (markdown source of the reply + prompting user turn). Backend fills: `submitter` (from auth session), `instance` (from BrandingConfig), `timestamp` (Date.now()), and applies the content-inclusion decision (drop `exchangeText` from the email body if flag is off — the payload always CONTAINS it on the wire; the decision is server-side email composition, not client-side gating).
- **D-25:** General button (shape 2) is context-free. It does NOT attach any conversation ID / message ID / conversation content even if the user happens to be inside a conversation when they click. General means general.
- **D-26:** Message content travels client-to-server on the wire. Shape 1's backend does NOT fetch messages from the DB. Rationale: the caller (shape 3) already has the content client-side because it's rendering thumbs on rendered messages; making shape 1 stateless on the message store keeps the shape lean.

### Failure and boundary behavior

- **D-27:** Send failure = log to console, drop. NO retries in shape 1. NO persistence queue. User always sees "thanks" toast regardless. Console log carries the full attempted payload so nothing a user typed is lost.
- **D-28:** NO rate limiting in shape 1. Accepted risk for v1 given deployment context (small trusted user base per instance). If it becomes a problem, adds later in a follow-up.
- **D-29:** NO DB persistence of feedback records in shape 1. Email-out + console log only.
- **D-30:** NO draft preservation across modal close/reopen. Transient state — user closes the modal, textarea is empty next open.

### Verification-in-shape-1

- **D-31:** Dev-only trigger for exercising the pipeline end-to-end during shape 1's verification, since no user-facing trigger ships until shape 2 (general button) and shape 3 (thumbs). Trigger form: a hidden keyboard chord OR a dev-only route — planner chooses. Gated so it doesn't show up for real users (either dev-build-only, or role-gated).

### Claude's Discretion

- **Env var names** — the semantic set is locked (D-04), the exact names are for planner/executor to pick. Suggestion: some prefix like `FEEDBACK_SMTP_*` + `FEEDBACK_TO_ADDRESS` + `FEEDBACK_INCLUDE_CONTENT`, but bikeshed at plan time.
- **Mail transport library** — nodemailer is the obvious choice for Node.js SMTP. Planner picks; open to alternative if there's an existing utility in the codebase (none found at scout time).
- **Frontend "is feedback configured" transport shape** — REST GET vs. embedded in an existing bootstrap payload vs. WebSocket-borne. Planner picks based on what the existing app already does for similar per-instance flags.
- **Dev-only trigger form** — keyboard chord vs. hidden route vs. dev-menu entry. Planner picks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Campaign + shape agreement (LOAD FIRST)
- `.planning/campaign-user-feedback.md` — the parent campaign artifact. Locks the arc across shapes 1/2/3.
- `.planning/shapes/shape-feedback-pipeline.md` — the shape agreement this CONTEXT was generated from. Contains philosophy + "what would make it wrong" + scope edges. If any decision here reads unclear, the shape file is the tiebreaker.

### Branding config (reuse target)
- `src/backend/branding/branding-config-loader.ts` — exports `loadBrandingConfig(): Promise<BrandingConfig>` (line 229) and `type BrandingConfig` (line 41). Feedback pipeline reads `config.appName` for the instance-name in the email subject and header block.
- `src/backend/branding/branding-template.ts` — reference for how the branding config is consumed elsewhere; shows the pattern for pulling `appName` and HTML-escaping if needed (feedback is plain text, so no escaping needed for the subject).
- `src/backend/branding/assert-boot.ts` — reference for the branding-config boot-gate pattern. Feedback does NOT follow this fail-fast pattern (per D-07); intentional divergence.

### Backend entry point
- `src/backend/starter.ts` — where the boot flow lives (line ~398 has the branding boot-gate). Feedback config load hooks in here or in a nearby module, planner decides.
- `src/backend/database.ts` — reference for how existing routes/routers are mounted (e.g., `brandingRoutes`).

### Modal design language (visual reference)
- `src/ui/features/pretty-view/AddWakeupDialog.tsx` — input-heavy modal reference. Shows Radix Dialog primitive, gradient background, backdrop-filter, uppercase label styling, save-disable gate pattern.
- `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` — small modal reference. Shows the simpler two-button footer + inline error surface pattern.
- `src/ui/components/dialog.tsx` — shared dialog primitive wrapper if planner chooses to use it.

### Existing UI shell (for where the modal + toast mount)
- `src/ui/AppShell.tsx` — where modals and top-level UI mount today.
- `src/ui/features/pretty-view/PrettyView.tsx` — the primary chat surface; shapes 2 and 3 later mount their triggers here or in AppShell.

### Logging (existing utility)
- `src/backend/utils/logger.ts` — exports `sshLogger` used throughout. Feedback pipeline uses this for console-log-on-send + console-log-on-send-failure.

### Tasting artifact (informative)
- `/home/ubuntu/fleet/identities/lark-box-maintainer/workspace/tasting-feedback-modal/index.html` — the tasting page that produced the locked modal design choices. Not committed to the repo; informative only.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **BrandingConfig loader** (`src/backend/branding/branding-config-loader.ts::loadBrandingConfig`) — feedback pipeline reads `.appName` from this for the instance name in emails. Never-throws contract per the branding-config docstring — always returns something usable. Feedback does not need its own load-with-fallback logic; the branding loader already handles it.
- **Radix Dialog primitive** (via `radix-ui`) — already used by every existing modal. Feedback modal uses the same primitive with matching chrome styles.
- **Dialog title component** (`src/ui/components/dialog.tsx::DialogTitle`) — small shared primitive for consistent title styling. Reuse.
- **sshLogger** (`src/backend/utils/logger.ts`) — structured logger used app-wide. Use for feedback console-log entries (both success and failure paths). Log keys: `operation: "feedback_submit"` / `operation: "feedback_send_failed"` with structured fields (submitter, type, hasNote:boolean, hasExchange:boolean, error).
- **Existing env-var config loader pattern** — Skynet reads config from env at startup and caches (branding config is a JSON file variant of the same pattern). Feedback follows the env-var flavor.

### Established Patterns

- **Loader modules that never throw at request time** — see the branding-config-loader docstring. Feedback env parser follows this: return a `FeedbackConfig | null` from a single boot-time load; downstream never has to handle load errors.
- **Boot-time cache + module-scope state** — see how branding-related state gets read at startup and cached in module scope. Feedback config lives the same way.
- **Radix Dialog + inline gradient/backdrop-filter styles** — modal chrome is Radix primitive + Tailwind + inline style with `hsla(...)` for the hue-aware gradient. Feedback modal matches; hue can be a fixed neutral (e.g., 220) or inherit from the caller's context.
- **Structured logger with `operation:` key** — every backend log line uses this shape. Feedback follows.
- **Env-driven feature gates** — presence-of-env-var implies enable is a natural pattern in the codebase. Feedback follows.

### Integration Points

- **Backend route mount** — new feedback route registers alongside existing routes in the module that wires up `express.Router()` (planner locates the exact spot; look near `brandingRoutes` mount in `database.ts` for the pattern).
- **Boot startup** — feedback config load fires near where branding boot-gate fires in `starter.ts`, but DOES NOT gate boot on validity. Just parse-and-cache.
- **Frontend "is feedback configured" fetch** — planner picks. Reasonable options: a small `GET /api/feedback/enabled` route; or a field appended to an existing bootstrap payload (e.g., `/api/branding` shape extension); or a value shipped in the initial HTML template similar to how branding gets baked in. Pick what matches existing patterns.
- **Modal mount point** — the shared composition modal registers with whatever modal-portal mechanism the app already uses (Radix's `Dialog.Portal` is the current pattern). No new portal machinery needed.
- **Toast** — Skynet may not have a shared toast component yet; if not, the reusable one lands as part of this shape and shape 3 will consume it for thumbs-up. Planner checks + decides whether to introduce or reuse.
- **Auth session for submitter** — backend intake reads the auth session (existing middleware) for the submitter's username. Planner locates the standard middleware pattern.

</code_context>

<specifics>
## Specific Ideas

- **Modal visual reference: A2a + B3b variants** from the tasting page. Winning general variant: title `Send feedback`, placeholder `What's on your mind?`, `Cancel` + `Send`. Winning thumbs-down variant: title `What went wrong?`, placeholder `Anything you want to add?`, close-X, single `Send`. See D-10 / D-11.
- **Ashley's default posture on her own instances:** BOTH flags on (mechanism + content-inclusion). Design accommodates operators who want mechanism ON but content-inclusion OFF (see D-02, D-21, D-22).
- **Email format example (locked pattern):**
  ```
  Subject: [gigaashley feedback] thumbs down

  Feedback from: ashley
  Instance:      gigaashley
  When:          2026-09-19 15:24 UTC-4
  Type:          thumbs down on assistant reply

  --- User note ---
  The migration binary doesn't exist in the container image, I looked.

  --- Exchange ---

  User asked:
  > How do I run the migration?

  Assistant replied:
  > Sure — you can run the migration by opening a shell into the container
  > and calling the migration binary directly.
  ```
- **Thumbs-up email** carries the same header block + exchange section (no user note section, since thumbs-up has no modal).
- **General email** carries header block + `--- Message ---` section only; NO exchange section (see D-23, D-25).

</specifics>

<deferred>
## Deferred Ideas

These came up during /open and are deliberately OUT of shape 1's scope. Preserved so future work knows they were considered.

### Belongs in shape 2 (general button)
- Placement of the "Send feedback" button in the app shell — deferred to shape 2's `/open` (the campaign artifact says this).
- Any decision about which surfaces (pretty view, terminal, filestash) get the general button — shape 2's call.

### Belongs in shape 3 (thumbs)
- Which "assistant" messages get thumbs affordances (all? Certain roles? Bridged agents?) — shape 3's call.
- Whether hovering the thumbs-down affordance shows any preview.
- Anti-abuse per-message (can a user thumb the same message twice?) — shape 3's call.

### Belongs to a future v2 pass
- Retry-on-failure with a persistence queue — v2 concern (D-27).
- Rate limiting / anti-abuse throttling — accepted risk for v1 (D-28); v2 revisit.
- DB persistence of feedback records — v1 is email-out only (D-29).
- Rich HTML email with image inlining and rendered markdown — probably never at this pipeline's stakes.
- Image/attachment inclusion in emails (Skynet messages can contain images) — out of shape 1; not planned for v2 unless it becomes clear it's needed.
- Draft preservation across modal open/close — transient state by design (D-30); could revisit if operators report users losing typed feedback.
- Per-user or per-category email destinations — one destination per instance is the design (D-18).
- A URL scheme for linking to a specific message in a conversation from external context — not present in the app today, not built here (D-20).
- Reply-To header carrying the submitter's email — users don't provide an email; identity is the username.

</deferred>

---

*Phase: 122-user-feedback campaign shape 1: feedback pipeline*
*Context gathered: 2026-09-19*
