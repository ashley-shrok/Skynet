# Phase 90: Relay-mediated group conversations sub-slice D — relay-session pane rendering with per-agent badge affordances - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 90-relay-mediated-group-conversations-sub-slice-d-relay-session
**Areas discussed:** (see below — walked in `/open` conversation, not in discuss-phase)

---

## Seed-only invocation

Per `/build` skill convention (feature-mode → GSD phase → seed CONTEXT.md from shape file), this phase's CONTEXT.md was written directly from the shape file (`.planning/shapes/shape-relay-session-pane-rendering.md`) which had already locked all 20 implementation decisions (D-01..D-20) during a walked-one-at-a-time `/open` conversation with Ashley on 2026-09-08. Each shape decision was greenlit `thumbs up` before advancing during that conversation.

Discuss-phase was invoked to satisfy the /build pipeline's phase-vehicle auto-proceed rule, but no new gray areas surfaced — the shape file's discovery already covered them. This log preserves the alternatives considered during the `/open` conversation for audit purposes.

---

## Architecture (D-01, D-02, D-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Modify pretty view with a kind-branch | One pane, one component, branches internally on session kind | |
| Two panes side-by-side | Separate relay pane component tree; extract only truly-primitive shared pieces | ✓ |
| Full fork with no shared primitives | Complete duplication; each pane owns everything | |

**User's rationale:** Surface similarity is a trap — every layer that looks the same is driven by radically different plumbing underneath. Folding into one pane would grow a kind-branch at every layer and accumulate complexity inside the currently-working harness pane, compounding regression risk. Ashley verbatim: *"I don't want to disturb the harness session pretty view functionality because most of it works well already."*

---

## Presence-tile ordering within a role (D-07)

| Option | Description | Selected |
|--------|-------------|----------|
| Recency of last message | Row reshuffles as people speak; most-recently-active first | |
| Alphabetical by name | Stable, predictable, no motion | ✓ |
| Fixed at room creation | Order participants were added; frozen | |

**User's rationale:** No motion desired — the presence row sits at the top of the pane where the eye lands, and reshuffling on every message would feel restless during a lively group.

---

## Per-agent badge shape (D-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Compact tile with tap-to-open popover | Small tile, meter/reset hidden in popover | |
| Medium tile with inline affordances | Tile sized to show name + meter inline | |
| Full-info card-sized tile | Card with name + avatar + numeric % + reset button | |
| Existing identity badge + shrunk meter/reset appendage | Reuse existing pretty-view badge with a bottom appendage carrying the shrunk-down compose-box meter and reset | ✓ |

**User's rationale:** Reuse existing visual language. Ashley verbatim: *"the meter and button already exist in the compose box for the regular harness sessions. And so I was just picturing it as kind of a smaller version of that that is in that area that's popped out from underneath the identity badges."*

---

## Pagination behavior (D-14)

| Option | Description | Selected |
|--------|-------------|----------|
| Design fresh (~50 initial, infinite scroll, ~50 batches) | Modern chat-app defaults, snappy initial pane | |
| Match pretty view 1:1 | Same initial load, same scroll-back trigger, same batch size | ✓ |

**User's rationale:** Ashley verbatim: *"this should just be the same as Harness Sessions."*

---

## Compose-box buttons treatment (D-04, D-05, D-06, D-09)

| Option | Description | Selected |
|--------|-------------|----------|
| Show all buttons disabled with tooltips | Preserves visual parity; teases missing functionality | |
| Hide inapplicable buttons; keep applicable ones enabled | Remove stop/recap/queue/thumbs-up; keep attach either disabled or hidden | |
| Whole upper area vanishes; only textarea + send remain | Reset/meter move to per-agent badges; queue/stop/thumbs-up/recap gone entirely; attach hidden | ✓ |

**User's rationale:** Ashley enumerated the entire upper-area contents and concluded none of it applies to relay sessions: reset and context meter move to per-agent badges; queue-a-message has no meaning because relay sessions never show a work-in-progress indicator; stop has no single agent to stop; thumbs-up doesn't apply; recap is redundant because the relay's message history IS the transcript already visible in the pane. Attach hidden entirely for v1 — Ashley verbatim: *"attach could just be hidden or disabled, I don't really care which."* Went with hidden per absence-as-affordance principle.

---

## Claude's Discretion

Areas explicitly delegated to the planner (per shape file's Claude's Discretion section):
- Concrete component tree structure for the relay pane (single file vs split across modules).
- Concrete primitive extraction shape.
- Concrete kind-discriminator branching site.
- Concrete "friendly error state" copy + visual (D-18).
- Concrete pagination page-size + trigger match with pretty view — planner reads pretty view and matches (D-14).
- Concrete optimistic-send match with pretty view — planner reads pretty view and matches (D-16).
- Concrete "inbound attachment placeholder" text/rendering (D-19).
- Concrete responsive breakpoint / overflow behavior for the identity-badge row on narrow viewports — v1.5 will revisit (D-20).
- Concrete data-fetching shape for message history + live subscription against the relay.

---

## Deferred Ideas

Explicit scope-out per shape file:
- **Mobile-specific layout** of the identity-badge row when it overflows — deferred to v1.5 (D-20).
- **Attach support** in either direction (outbound send, inbound rich media rendering) — deferred to a later slice.
- **Typing indicators, read receipts, message editing, redaction, per-message reply threading, reactions** — deferred (per master shape v1 scope).
- **"Unread" state on sidebar entries** for room-backed sessions — deferred (per master shape v1 scope).
- **Convergence work** to migrate pretty view onto the shared bubble/compose primitives — deferred to a future slice if visual drift becomes a real problem.
