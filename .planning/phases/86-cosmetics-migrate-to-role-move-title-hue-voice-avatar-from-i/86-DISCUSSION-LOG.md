# Phase 85: Cosmetics migrate from identity level to role level — Discussion Log

**Date:** 2026-09-07
**Format:** In-session `/build feature-mode` → `/open` (shape file lock) → `/gsd:phase` → `/gsd:discuss-phase` (this log).
**Participants:** Ashley (visionary), tabitha (builder).

This file is for human reference / audits — NOT consumed by downstream researcher/planner/executor agents. CONTEXT.md is the canonical downstream input.

---

## Source: /open shape lock (2026-09-07)

The bulk of the direction was settled during `/open cosmetics-migrate-to-role`, greenlit by Ashley `thumbs up` in the same session. Shape file at `.planning/shapes/shape-cosmetics-migrate-to-role.md` — everything in the shape file's `## Shape`, `## Philosophy`, `## What would make it wrong`, and `## Scope edges` sections carries into CONTEXT.md's `<decisions>` and `<deferred>` blocks without re-elicitation, per the `/build` skill directive to seed discuss-phase from the shape file.

Key Ashley verbatims from that discussion, all captured in CONTEXT.md:

- *"one shared image"* — settled the avatar semantics (role owns one image, all identities show it; no per-identity generation within a role-defined style).
- *"Migration isn't part of the build. It's something that whoever deploys on this instance, and Stacy for her instance, would just need to do manually. and then there's no already-overridden problem anyway"* — settled migration as manual, out of scope; consequence: no auto-lift, no auto-wipe, no in-UI redundant-override warnings.
- *"Rolls can't have empty cosmetics with the flows that we have set up, so it's not an issue to solve"* — settled that fall-through-to-null for role cosmetics is a defensive backstop only, not a designed UX.
- *"'avatars also get uploaded to your Matrix homeserver' untrue, runbook that probably came from should be updated"* — settled the runbook update alongside the code change (Matrix-upload step is stale, gets stripped).
- *"we can be explicit for the second thing"* — settled the identity-edit UI affordance shape (explicit "inherited from role: X" / "revert to role default" affordances per field, not invisible-empty-means-inherit).

---

## /gsd:discuss-phase interaction (2026-09-07)

### Codebase scout (spawned Explore agent)

Purpose: map the surfaces this phase touches so CONTEXT.md carries real file paths + line ranges for the planner. Scope: identity file loader, role file loader, CreateRoleDialog current shape, NewSessionDialog cosmetic UI, IdentityModal cosmetic UI, shared cosmetic pickers, runtime cosmetic resolution path, existing tests.

Output folded into CONTEXT.md `<code_context>` section verbatim. Key discoveries:
- `extractCosmeticsFromFrontmatter()` at identity-artifact-reader.ts:2095-2157 is directly reusable for role frontmatter parse (same YAML shape, same rules).
- `publicIdentity()` at identities.ts:109-150 is the natural merge point for identity+role cosmetic overlay.
- `roles-create.ts` currently writes NO cosmetic frontmatter — extension point.
- ColorPicker + VoicePicker are already reusable components; avatar generation is inlined in NewSessionDialog.
- IdentityModal edit block state at L285-297 is where inherit/override affordance state lives.

### Gray area surfaced (only one)

**Ask:** Whether role cosmetic EDIT post-creation is in scope, or whether Phase 85 handles creation-time authoring only.

**Options presented:**
- (a) Creation-only. Role cosmetics authored via CreateRoleDialog, never edited from UI. Post-creation changes = hand-edit disk file or wait for a future bounty.
- (b) Add role-cosmetic-edit into IdentityModal (split cosmetic tab into "role defaults" + "your overrides").
- (c) Add a small standalone role-edit dialog in this phase.

**Ashley's answer (verbatim):** *"Yeah, I would leave this alone because I actually plan on breaking out the role level stuff into its own modal later, and that would be a good opportunity to add it."*

**Resolution:** (a) — creation-only for Phase 85. Role-cosmetic-edit-post-creation deferred to the future role-level modal breakout Ashley is planning. Captured in CONTEXT.md `<deferred>` section.

---

## Claude's discretion (called by planner, not requiring user input)

- Avatar generation component extraction (reusable vs inline in CreateRoleDialog) — planner picks; inline is fine given only one caller post-phase.
- Role-cosmetic-write endpoint shape (extend POST /roles to multipart with `data` field vs keep JSON with post-create avatar upload) — planner picks; multipart matches the identity-endpoint precedent.
- Role cosmetic caching strategy in backend loader (per-request memo vs longer-lived cache) — planner picks; per-request is probably enough.
- Exact visual affordance for inherit/override state in IdentityModal (ghost text, chip, unlink icon, X) — planner picks; semantics locked, visual is design detail.
- Wire convention for "revert to role default" save (null in multipart PUT vs field omission) — planner picks.
- Field placement of new cosmetic controls in CreateRoleDialog (above/below existing name+description+host block) — planner picks; no shape constraint.

---

## Deferred ideas from this discussion

- Post-creation role cosmetic edit UI → future role-level modal bounty (Ashley's planned breakout).
- Extract avatar generation into a reusable component → maybe later if a third caller emerges.
- Sweep peer identities' redundant frontmatter as part of ship → not part of code; migration is manual data motion by whoever deploys.

---

## No blocking anti-patterns found

`.continue-here.md` not present in phase 85 dir. No blocking anti-patterns to demonstrate understanding of.

---

## No SPEC.md

No `85-SPEC.md` exists — this phase came in through the `/build` → `/open` → shape file path, not the `/gsd:spec-phase` path. Shape file substitutes as the WHAT-and-WHY lock; CONTEXT.md carries the HOW decisions.

---

## No interrupted discussion checkpoint

`85-DISCUSS-CHECKPOINT.json` not present — single-session discussion.
