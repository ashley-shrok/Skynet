# Phase 84: Create-role modal UX pass — Discussion Log

**Discussion held during** `/build` → `/open` (session 2026-09-07, Tabitha). CONTEXT.md was seeded directly from the shape file per build-skill convention — no separate discuss-phase interactive round-trip was needed because the shape file already locked all vision-level decisions.

## What was discussed and where it was decided

### 1. Handoff mechanics (create-role → create-agent)
- **Options considered:** two separate modals that chain sequentially / one blended two-stage flow.
- **Ashley picked:** separate modals, sequential (matches current mental model; users are already familiar with the create-agent modal on its own).
- **Landed in:** CONTEXT.md § Implementation Decisions #5.

### 2. Modal title alignment with dropdown labels
- **Ashley surfaced this mid-discussion:** dropdown says "New agent" / "New role", modals say "Create a new agent" / "Create a role" (actual code says `"Start a new agent"` / `"Create a role"` — close enough to her recollection).
- **Direction locked:** dropdown labels are source of truth; modal titles conform DOWN. Both modals get their title tweak in this bounty (paired coherence — half-landing the alignment creates a weird interim state).
- **Landed in:** CONTEXT.md § Implementation Decisions #6 and #7.

### 3. "Only one host" semantics (shared primitive)
- **Question grilled:** is "only one host" literally user has exactly one pickable-host row, or is there admin/role filtering?
- **Ashley confirmed:** literally count of pickable hosts == 1. No admin caveat, no per-flow filtering. Dead simple.
- **Landed in:** CONTEXT.md § Implementation Decisions #8.

### 4. Blurb constraints (best-UX independent reasoning)
- **Ashley's framing:** "there is a best answer here for best UX that is independent of any preferences me or you might have. And so that's what I want to try to hit."
- **Constraints derived (Tabitha's reasoning, greenlit implicitly):**
  - Paired vocabulary between role blurb (this phase) and future agent blurb (next bounty) — they'll be read in immediate sequence via the auto-advance.
  - One short sentence per blurb (modal-header help gets skimmed heavily; more than a sentence loses readers).
  - Product-language framing, not engineering terms ("template", "instance" out; "what an agent does and how it thinks" in).
- **Draft locked in CONTEXT.md (user may redirect during execute):** *"A role is what an agent does and how it thinks — many agents can share one."*
- **Landed in:** CONTEXT.md § Implementation Decisions #1.

### 5. Escape-hatch behavior (role stays if user aborts create-agent)
- **Question grilled:** after the auto-advance, if the user hits Escape on the create-agent modal, does the just-created role stay committed or roll back?
- **Ashley confirmed:** role stays. System tolerates a roleless-role state as an escape hatch. User picks up later via the "New agent" dropdown item and picks the role there.
- **Landed in:** CONTEXT.md § Implementation Decisions — Escape-hatch behavior.

### 6. Campaign scope (7-bounty UX-pass string)
- **Ashley 2026-09-07 verbatim on the constraint:** "the farthest you'll get amongst any of this is pushing changes to remote and running scoped tests, but we're not going to be running the full test suite we're not going to be rebuilding we're not going to be deploying until we're done."
- **Consequences enforced in this phase:** scoped tests only in execute; phase ends at push; no coord-room ship posts (no ship happens); every push runs `git pull --rebase` first.
- **Landed in:** CONTEXT.md § Campaign Context.

## Deferred / not discussed (parked in bounty pool, not this phase)

- The rest of the create-agent modal UX pass (its own bounty, next in campaign — `create-agent-modal-ux-pass`).
- Clone modal UX pass (`clone-modal-ux-pass`).
- Identity modal tab restructure (`identity-modal-tab-restructure`) — depends on `runbooks-formal-concept`.
- Runbooks formal concept (`runbooks-formal-concept`).
- Composebox buttons + queue tab redesign (`composebox-buttons-and-queue-tab-redesign`).
- Global-file agents-may-edit-on-permission fleet directive (`global-file-agents-may-edit-on-permission`).

## Claude's discretion (defaults picked in CONTEXT.md without a specific ask)

- **Blurb draft text** — Ashley delegated ("independent of any preferences me or you might have"). Draft in CONTEXT.md; user may redirect during execute.
- **Primitive placement** — inlined per-modal check vs shared helper: deferred to planner's discretion (implementation, not vision).
- **Where the removed strings land in code** — DELETED (not just disconnected from `t()` calls); source strings, hardcoded fallbacks, aria-labels all pulled.
- **New-session dialog test assertion update** — Test 5 (`PrettyConversationsPanel.test.tsx:1297`) currently asserts `"Start a new agent"` title text; needs to change to `"New agent"` as part of this phase's execute step.

## Scope creep redirects

None encountered. Ashley's digest already scoped this bounty tightly (item 1 of 7); the other items live in their own bounties.
