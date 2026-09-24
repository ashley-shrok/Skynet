# Phase 134 — Discussion Log

**Gathered:** 2026-09-21
**Identity:** vector (box-maintainer)
**Vehicle:** /build → /gsd:phase → /gsd:discuss-phase

This log is for human reference (audit, retrospective). It is NOT consumed by downstream agents — see `134-CONTEXT.md` for the decisions that flow into research + planning.

## Provenance

Phase 134 is shape 2 of the `wake-ups-redesign` campaign (three shapes total; shape 1 landed as Phase 127; shape 3 declared as `shape-wake-ups-modal.md`, not yet phased).

The shape file (`.planning/campaigns/wake-ups-redesign/shape-wake-ups-crud-api.md`) was retroactively declared during a campaign-conversion beat after shape 1's ship (2026-09-21 morning), then **settled during /build's discussion beat this same day** — two locks landed there before /gsd:phase was invoked:

- **Host scope** — locked to (b) fleet-wide sweep, mirroring the fleet-status pattern. Options considered: (a) Skynet host only, (b) fleet-wide sweep, (c) per-request host param. User: thumbs up.
- **Fate of per-role wake-up CRUD surface** — locked to (A) fold removal into shape 2, on the grounds that Phase 127 retired per-role wake-ups fleet-wide and the still-live API surface creates a silent-fail failure mode (user adds a wake-up in RoleModal's tab → it never fires). Options considered: (A) fold into shape 2, (B) defer to follow-up bounty. User: thumbs up (implicit-recommendation form on my two-path close).

De-risk item flagged for this discuss-phase: **confirm what `WakeupsTab.tsx` / `RoleModal.tsx` actually serves** (per-role vs per-identity vs both) so per-identity management isn't killed prematurely. Discussed below.

## Areas discussed

### Area 1: De-risk from shape file — WakeupsTab.tsx / RoleModal.tsx fate

Resolved silently during codebase scout (no user question needed):

- `WakeupsTab.tsx` is a reusable list-renderer mounted by both `IdentityModal` (per-identity wake-ups) AND `RoleModal` (per-role wake-ups) via prop-injection of the CRUD callbacks.
- Removing per-role wake-ups means: (1) removing `RoleModal.tsx`'s `role-wakeups` tab entry + its role-scope fetch + CRUD callbacks; (2) removing role-scope backend service functions in `identity-artifact-reader.ts`; (3) removing WS handlers in `claude-session-server.ts` (both Phase 72 Plan 01 per-identity two-step AND Phase 90 Plan 90-07 role-name-keyed variants); (4) removing frontend API surface in `claude-session-api.ts`; (5) deleting associated role-scope test files.
- `WakeupsTab.tsx` itself STAYS intact — still used by IdentityModal. Per-identity wake-up management is fully preserved.

Captured as D-09 in CONTEXT.md.

### Area 2: Skill picker source

**Question presented:**
- (a) Fleet-substrate skills only — `substrate/skills/*/SKILL.md`; small consistent canon.
- (b) All skills discoverable on the target host — fleet-substrate + `~/.claude/skills/*/SKILL.md` + project-local; per-host variation.
- (c) Fleet-substrate + `~/.claude/skills/` only — middle ground; skip project-local.

**Claude's recommendation:** (a).

**User's answer:** OUT for this shape. Verbatim (2026-09-21): *"i think you pick roles only right now. we may allow picking skills later, but the reality is that an identity born for a wakeup will be able to invoke any skill available to it just like any other, so if you schedule a wakeup that says something like 'check my gmail and give me a digest' then that identity is obviously going to reach for the gmail skill, assuming it exists, so it is no problem."*

**Impact:** Removes the entire skill-enumeration endpoint from shape 2's scope. Shape 3's modal loses its skill picker. Wake-up spec's `skills: []` field defined in Phase 127 D-04 stays supported by the scheduler + spawn-request schema for hand-editing; UI never populates it. Shape file updated to reflect skill-picker-OUT.

Captured as D-04 in CONTEXT.md.

### Area 3: Delete semantics

**Question presented:**
- (a) Hard delete `~/fleet/wakeups/<slug>/` folder + cleanup `.state/<slug>.fired` sentinel.
- (b) Archive rename to `<slug>.archived/` (reversible).
- (c) Soft delete via `enabled: false` (spec stays, marked disabled).

**Claude's recommendation:** (a).

**User's answer:** thumbs up on (a).

**Impact:** Delete is a hard operation. No archive affordance in shape 3's modal, no restore, no history. Delete-vs-disable stays as two separate ops in the modal (toggle-enabled flips `enabled`; delete removes the folder). Sentinel cleanup prevents an orphaned `.fired` sentinel from inheriting "already fired" state onto any future wake-up that happens to be created with the same slug.

Captured as D-06 in CONTEXT.md.

### Area 4: Slug generation on create (Claude's discretion, not asked)

Not asked — deferred to Claude's discretion at plan time. Plan-time call flagged in CONTEXT.md D-07: mirror the existing `role:create-wakeup` pattern (`slug = kebab-case(name)`, 409 on collision, client re-prompts). Rejected: auto-suffix numeric collision resolution (breaks consistency with existing Skynet wake-up UX).

## Deferred ideas captured

See CONTEXT.md `<deferred>` section — covers what belongs in shape 3, what was rejected this discussion (archive semantics, auto-suffix slugs, DB shadow, streaming), and what may return in a future phase (skill enumeration + picker, history-of-past-fires, cross-host wake-up movement).

## Claude's discretion items surfaced during discuss-phase

- Exact URL paths — `/wakeups`? path-vs-query for `host` param? Planner picks matching Drizzle-backend route conventions.
- TTL value for the LIST cache — planner picks based on fleet-status precedent.
- Enable-toggle endpoint shape — dedicated route vs generic PATCH. Planner picks.
- Return shape on aggregated LIST — flat array with `host` field per item vs `{ [host]: [...] }` grouped. Planner picks based on shape-3 modal ergonomics.
- Wave decomposition — 1 vs 2 plans. Planner picks.
- JSON key ordering / minor spec-field naming polish — planner mirrors shape 1's specs.

---

*Discussion for Phase 134, held during a single /build → /gsd:phase → /gsd:discuss-phase invocation on 2026-09-21.*
