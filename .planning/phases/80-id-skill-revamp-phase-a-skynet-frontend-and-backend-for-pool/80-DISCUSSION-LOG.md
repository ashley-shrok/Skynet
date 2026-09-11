# Phase 80: id skill revamp Phase A - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-06
**Phase:** 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
**Areas discussed:** Pool storage mechanism, Task pill visual family (chat surface), Conversation-list row subtitle typography

**Preamble:** CONTEXT.md was seeded from the pre-existing shape file (`~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md`) per `/build` skill convention — the shape had already been produced by `/open` with full grill pass and greenlit by Alice 2026-09-06. Discuss-phase focused exclusively on the small set of gray areas the shape explicitly deferred to phase-time. The shape itself is the primary canonical ref; every other scope decision traces to it.

---

## Pool storage mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| (a) JSON file in the repo, checked in at deploy time | Simplest path; matches how other seeded lists live. Loaded on boot. | ✓ |
| (b) DB table populated by migration on first boot | Rows can be flagged retired, easier to add names later without a deploy. | |
| (c) Config value from a backend config file (e.g., branding-config) | Loaded from config layer the branding-config phase already touches. | |

**User's choice:** (a) JSON file in the repo.
**Notes:** Alice: "leaning A for number one."

---

## Task pill visual family (chat surface)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Glass treatment matching identity badge, hue-tinted from identity's colorHue | Pill visually belongs to badge family — "this identity's current task, wearing this identity's face." | ✓ |
| (b) Neutral pv-cream text on subtle pv-glass background, agnostic of colorHue | Pill is its own thing, purely typographic — "the task itself, sitting apart from any specific identity's decoration." | |

**User's choice:** (a) Same glass treatment as identity badge, hue-tinted from colorHue.
**Notes:** Alice: "A for number two." Agent had leaned toward (b) in the pitch (arguing task-primary under the reframing suggests role-cosmetics recede); Alice overrode toward (a) — cohesion with the badge wins. Locked as D-02.

---

## Conversation-list row subtitle typography

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Same size as role, dimmer hue (60% opacity or fainter cream) | | |
| (b) Smaller than role, same hue | | |
| (c) Both — smaller AND dimmer | | |

**User's choice:** Not an open question — top line just adopts current top-line behavior. Locked as D-03.
**Notes:** Alice: "number three is not an open question, because we're just reusing how the top line behaves currently." Interpreted as: the visual treatment of the new task-primary top line inherits the current top-line typography verbatim (which previously carried the identity name), and the new subtitle inherits the current subtitle typography. No new typographic vocabulary invented. Any pixel-level tuning discovered during implementation surfaces as an executor decision, not a planning question.

---

## Claude's Discretion (executor / planner)

- Pixel-level task-input character cap.
- Pool-fetch endpoint shape (single-name-per-call backend-picks preferred; exact contract is planner territory).
- Ordinal-query implementation (specific Synapse admin endpoint; verified during research phase).
- Modal layout details (form ordering, labels, hint text, error states).

## Deferred Ideas

All items in the shape's scope-edges section that landed in Phase B or C. Enumerated in CONTEXT.md `<deferred>` block. Key items:
- To Phase B: pin sentinel migration, cosmetics-to-role frontmatter move.
- To Phase C: metadata folder migration, agent-supervisor idle-scan, id skill body edits, coord companion file edits, agent-relay discovery convention.
- To future work: user-facing manual archive UI, in-UI edit affordance for task, coordinator picker rework, reactivation of deactivated accounts (rejected).
