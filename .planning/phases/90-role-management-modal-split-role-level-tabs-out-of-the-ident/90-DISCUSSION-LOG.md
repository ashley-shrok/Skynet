# Phase 90 Discussion Log

**Date:** 2026-09-09
**Identity:** tabitha
**Vehicle:** /build feature-mode → /gsd:phase → /gsd:discuss-phase (this doc) → /gsd:plan-phase → /gsd:execute-phase

## Context

Shape file already locked in the /open discussion this same session (`.planning/shapes/shape-role-management-modal-split.md`). Most shape-level questions (surface changes, transition semantics, hue treatment, sort order, menu entry) were settled during /open with `thumbs up` greenlights across 4 tasting rounds (roles-list rows visual) and 2 console-snippet iterations (identity-modal title-line treatment).

This discussion surfaced only implementation-HOW gray areas the shape deliberately left open.

## Areas Presented

Ashley picked all three to resolve in one turn (rather than the workflow's default one-at-a-time flow).

### Area A: Role-cosmetic-edit UI scope

**Presented:**
- (a1) Include role-cosmetic-edit affordances on the role file tab in this phase — resolves Phase 86's deferral.
- (a2) Keep this phase narrowly-scoped per its own shape; ships as immediate follow-up bounty.
- (a3) Minimal edit surface (title text only; hue/voice/avatar deferred).

**Ashley's answer (verbatim):** *"we are going to do the cosmetics editing on this like it's basically just going to be the same thing that the identity modal has, except for maybe the override stuff that shows up there. So that should be a pretty one to one recreation."*

**Decision:** (a1) with the "one to one recreation" refinement — same pickers as identity modal, minus the inherit/override affordance layer. Captured as D-01.

### Area B: Roles-list scope

**Presented:**
- (b1) Same-host only (matches existing `listRolesForHost` endpoint).
- (b2) Cross-fleet aggregate.

**Ashley's answer (verbatim):** *"for B, I was thinking we could actually set it up the same way as the edit global files modal, where there's a drop down to pick a host. And if you are a user that only has one host, then that just defaults to that one host that you have. So that keeps that simple."*

**Decision:** (b1) with the Edit-global-files pattern — host-picker dropdown at the top, single-host users auto-selected. Captured as D-02.

### Area C: Role modal portal container

**Presented:**
- (c1) Always portal to `document.body` — full-viewport.
- (c2) Context-dependent — chat-region portal when swap-in from identity modal, `document.body` otherwise.

**Ashley's answer (verbatim):** *"this kind of goes along with B in the sense that like, the roles modal and the edit role modal have nothing to do with sessions that you have open or not. like they are sort of global modals the same way that like editing skills and edit global files modals are."*

**Decision:** (c1) — global modal, always `document.body`. Even title-line jump-in from an identity modal opens the role modal at global viewport level (identity modal closes first). Captured as D-03.

## Deferred Ideas

- Enriching roles-list rows with state (bounty counts, identity counts, activity glances).
- Search / filter in the roles-list modal.
- Cross-fleet role aggregation.
- Recently-active sort order.
- Modal-on-modal / stack behavior.
- Restore-identity-modal-on-close.
- Role-picker in role modal header for quick round-tripping.
- Shared modal shell / cosmetic-edit-block primitive extraction.

## Claude's Discretion (planner picks)

Listed in CONTEXT.md § D-08 + § Claude's Discretion — wire shapes for enumerate/serve/write role endpoints, whether "+ New role" opens CreateRoleDialog as stack or swap, title-fallback treatment, dead-code-sweep timing for `useModalScope`, tab-body extraction granularity, wave graph.

