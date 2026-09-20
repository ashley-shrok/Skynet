# Phase 123: user-feedback campaign shape 1 — feedback pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `123-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-09-19
**Phase:** 122-user-feedback-campaign-shape-1-feedback-pipeline
**Source of discussion:** `/build` → `/open` session (not `/gsd:discuss-phase`). Per build-skill rule, CONTEXT.md was generated from the shape file rather than re-eliciting the same ground in a second discussion. Full grill transcript is captured in this log; final agreements live in the shape file at `.planning/shapes/shape-feedback-pipeline.md` and the derived CONTEXT.md.

**Areas discussed:** Email body content lens, Content-inclusion flag defaults, Modal design (tasting), Rate limiting, Rich content in email, General-button conversation context, Payload contract shape 1↔callers, Boot behavior when SMTP misconfigured, Vehicle choice

---

## Email body content — "quality-signal" vs "acts-on-it" lens

| Option | Description | Selected |
|--------|-------------|----------|
| Quality-signal | Thin telemetry pings — sender, category, user note; no message content | |
| Acts-on-it (mixed) | Thumbs-down carries the exchange (assistant + prompting user turn); thumbs-up short; general = what the user typed + ambient identity | ✓ |
| Acts-on-it (full) | Every email carries wide conversation context regardless of type | |

**User's choice:** Acts-on-it (mixed) — plus a governing "content flag" makes it operator-configurable.
**Notes:** Users already know messages travel through operator infrastructure; message content is not a privacy surprise. the user's stance: "I want as much info as I can get because that's just gonna help me solve things." Operator gets max signal by default on her instances; other operators split the mechanism from content via two independent flags.

---

## Content-inclusion flag defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Feature + content as one decision | Setting SMTP config implies content ON; you have to explicitly turn it off | |
| Two independent flags | Setting SMTP config enables mechanism; content is a separate explicit boolean, defaults OFF | ✓ |

**User's choice:** Two independent flags. Content defaults OFF when unset even when the mechanism is enabled.
**Notes:** Verbatim: "you might want to turn the feature on without always getting message content in the emails, or you might want both." Defensive default; operator turns both on if they want max fidelity.

---

## Modal design (tasting page)

Full tasting artifact: `/home/ubuntu/fleet/identities/lark-box-maintainer/workspace/tasting-feedback-modal/index.html` — served on port 8903, iterated once with feedback-driven trim.

### General "Send feedback" button

| Option | Description | Selected |
|--------|-------------|----------|
| A1 — category chips + textarea | Category selector (optional pick) + big text box + ambient footer | |
| A2a — title + textarea (chosen after trim) | Title "Send feedback" + placeholder "What's on your mind?" + Cancel/Send | ✓ |
| A2b — titleless | Placeholder carries all the guidance; no separate title | |

**User's choice:** A2a. Trim rationale: "we're saying send feedback and anything you want to share about the app and what's up and what happened or what would you have liked to happen so like it's like four different things all saying this is for sending feedback."
**Notes:** Dropped category chips. Dropped "sending to the operator of this instance" footer line as redundant/implied. Kept the title.

### Thumbs-down modal

| Option | Description | Selected |
|--------|-------------|----------|
| B1 — quoted message, warm framing | Shows the thumbed reply at top, "Thanks for the signal" framing, Send-without-note / Send-with-note buttons | |
| B2 — quoted message, plain framing | Shows the thumbed reply at top, plainer copy, Dismiss/Submit + footer explanation | |
| B3a — no quote, two buttons | Simple "What went wrong?" title + textarea + Skip / Send buttons | |
| B3b — no quote, single button + X | Simple "What went wrong?" title + textarea + close-X + single Send button | ✓ |

**User's choice:** B3b. Simpler, single unambiguous action button.
**Notes:** Rejected quoting the thumbed message back at the user — the campaign research had warned against making users feel interrogated on thumbs-down. Cancel/Dismiss button labels were rejected because they could ambiguously read as "cancel my thumbs down"; the close-X + single Send resolves that.

### Post-send acknowledgement

| Option | Description | Selected |
|--------|-------------|----------|
| C1 — bottom-right toast, ~2s fade | Modal closes, small toast appears bottom-right | ✓ |
| C2 — modal transforms in place | Modal doesn't close, swaps its content to a "thanks" panel with a close button | |

**User's choice:** C1. Also used after thumbs-up (no modal path — click IS the submit).

---

## Rate limiting

| Option | Description | Selected |
|--------|-------------|----------|
| No throttle in v1 | Accept the risk given trusted-user deployment context | ✓ |
| Basic throttle | Per-user cooldown or per-instance rate limit | |

**User's choice:** No throttle in v1.

---

## Rich content in email body

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text only — strip markdown | Convert markdown to plain text; drop images | |
| Markdown source verbatim | Send whatever the assistant produced, fenced code stays fenced, links stay bracketed | ✓ |
| HTML email with images inlined | Real work, unlikely v1 | |

**User's choice:** Markdown source verbatim.

---

## General button — conversation context if pressed inside a conversation?

| Option | Description | Selected |
|--------|-------------|----------|
| Context-free general button | General means general; no conversation ID, no message context | ✓ |
| Context-if-available | Include the conversation ID when user is inside one | |

**User's choice:** Context-free. Attaching a conversation implies a relationship that often isn't there.

---

## Payload contract between shape 1 and its callers

| Option | Description | Selected |
|--------|-------------|----------|
| Caller supplies everything | Frontend fills submitter, instance, timestamp too | |
| Caller supplies feedback-specific fields; backend fills ambient/session context | Caller: kind, userNote, messageRef, exchangeText; backend: submitter, instance, timestamp, content-inclusion decision | ✓ |
| Caller supplies IDs only; backend looks up content server-side | Requires shape 1 to query message store | |

**User's choice:** Middle option. Payload split as chosen means shape 1's backend is stateless on the message store; content travels client-to-server on the wire.
**Notes:** Verbatim: "any decisions about which parts should be done in each shape is left up to you" — the user delegated shape-boundary decisions to the working agent (me).

---

## Boot behavior when SMTP config is present but broken

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast at boot | Refuse to boot until operator fixes credentials (matches branding-config pattern) | |
| Boot anyway, log-and-degrade | Feature appears enabled; sends fail silently and log to console | ✓ |

**User's choice:** Boot anyway. Feedback isn't essential to app operation; failing the whole app because SMTP auth is wrong is disproportionate.
**Notes:** Also locked: "enabled" requires BOTH SMTP config AND destination address present. Either absent → feature disabled → UI hidden.

---

## Vehicle choice

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Too big | |
| Plan mode | Too big for a single planned change | |
| GSD quick | Fleet rule says no ("if choosing between /gsd:quick and a phase, it's a phase") | |
| GSD phase | Multi-file, cross-subsystem work, phase-shaped | ✓ |
| Bounty | No — doing it now | |

**User's choice:** GSD phase, via `/gsd:phase` + `/gsd:plan-phase` (auto-proceeds to execute per fleet standing rule).

---

## Claude's Discretion

Areas delegated to the working agent:
- Env variable names (semantic set is locked D-04; exact names are for planner to pick).
- Mail transport library choice (nodemailer is the obvious default; no existing utility in the codebase to reuse).
- Frontend "is feedback configured" transport shape (REST GET vs. embedded in bootstrap payload vs. WebSocket-borne — pick what matches existing patterns).
- Dev-only trigger form for shape 1 verification (keyboard chord vs. hidden route vs. dev-menu entry).
- Shape 1/2/3 internal boundary decisions ("any decisions about which parts should be done in each shape is left up to you" — the user 2026-09-19).

## Deferred Ideas

Preserved for future shape work or v2 iteration; see the CONTEXT.md `<deferred>` section for the full list. Highlights:

- Shape 2 (general button placement in shell, which surfaces get it).
- Shape 3 (which messages get thumbs, per-message anti-abuse).
- v2 (retry queue, rate limiting, DB persistence, HTML email, image inclusion, draft preservation, per-user email destinations, URL scheme for in-app links, Reply-To).
