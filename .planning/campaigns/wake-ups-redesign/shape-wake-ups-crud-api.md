# Shape: wake-ups CRUD API — Skynet backend endpoints the modal will consume

**Opened:** 2026-09-21 (declared as part of retroactive campaign conversion)
**Settled:** 2026-09-21 (host scope + per-role CRUD fate locked during /build discussion; skills-OUT + hard-delete locked during discuss-phase)
**Vehicle:** GSD Phase 134 (2 plans, 2 waves, ~14 body commits + 8 code-review-followup commits)
**Status:** code-complete-awaiting-bundled-ship (2026-09-21) — held for end-of-campaign ship together with shape 3
**Part of campaign:** `campaign-wake-ups-redesign.md`

## What this is

Shape 2 of the wake-ups-redesign campaign. The disk-side plumbing is live from shape 1: any agent on any supervisor host can hand-write a spec at `~/fleet/wakeups/<slug>/wakeup.json` and it'll fire. Shape 2 lets **Skynet's backend** read + create + edit + delete + toggle those specs so shape 3's UI has endpoints to talk to. This is a thin layer over the existing on-disk state — the file is the truth, the API just marshals HTTP requests into filesystem operations.

## Shape

**Endpoints for the modal's CRUD** (paths TBD during shape discussion, but the surface is):
- **List** — return every `~/fleet/wakeups/<slug>/wakeup.json` on this host (or across the fleet's visible hosts?), each with parsed spec + derived-fields (next-fire-time, is-enabled).
- **Create** — accept a full spec, generate a fresh slug (or accept a caller-supplied slug), write the folder + `wakeup.json`.
- **Update** — accept a full spec for an existing slug, overwrite atomically.
- **Delete** — hard delete `~/fleet/wakeups/<slug>/` folder + cleanup `~/fleet/wakeups/.state/<slug>.fired` sentinel (settled 2026-09-21: no archive, no soft-delete via `enabled: false` — matches "on-disk files are the truth" philosophy; delete-vs-disable stays as separate ops in the modal).
- **Toggle enabled** — flip the `enabled` field without touching anything else (small convenience endpoint, since the toggle is on every list row in the modal).

**Enumeration endpoint the picker needs:**
- **Roles available on this host** — for the modal's role chip-picker dropdown. Reads `~/fleet/roles/*/` directory names. Reuse the existing `src/backend/database/routes/roles-list-for-host.ts` endpoint if it fits; extend or add a new fleet-wide variant if the shape 3 modal needs to enumerate roles across hosts for the modal's initial dropdown.

**Skill picker — OUT for this shape (settled 2026-09-21).** The user's call: "you pick roles only right now. we may allow picking skills later, but the reality is that an identity born for a wakeup will be able to invoke any skill available to it just like any other, so if you schedule a wakeup that says something like 'check my gmail and give me a digest' then that identity is obviously going to reach for the gmail skill, assuming it exists, so it is no problem." So: no skill-enumeration endpoint in shape 2, no skill picker in shape 3. The wake-up spec's `skills: []` field defined in Phase 127 D-04 stays supported by the scheduler + spawn-request schema (any agent hand-editing a spec can still set it), but the UI never populates it.

**Host scope — LOCKED to fleet-wide sweep (b).** The API enumerates every managed host's `~/fleet/wakeups/` on list, mirroring the fleet-status pattern already load-bearing for per-host identity enumeration. Writes dispatch to the right host based on a `host` field in the request payload. Reuse the TTLed caching pattern from `identity-artifact-reader.ts` for the SSH fan-out on list. The modal renders every wake-up fleet-wide by default, filterable by host, without shape 3 needing per-host modal instances. Cost accepted: every list call fans out SSH over reachable hosts — same cost fleet-status already pays.

**No DB shadow.** The on-disk files stay the truth. The API reads directly on each request (or holds a small in-memory cache invalidated on write, similar to fleet-status's identity picture). Any write goes to disk atomically before returning 200.

**No wire-protocol streaming.** Skynet has no message streaming (fleet-wide rule). The modal fetches once on open, refetches on write, refetches on filter change — plain REST.

## Philosophy

**Two paths in, one truth out.** This is the shape that starts realizing the philosophy. Agents write to disk; the API reads from disk; the modal (shape 3) reads via the API. Both surfaces are equal-citizen views on the same truth.

**Skynet's in-memory-DB posture doesn't apply here.** Wake-up specs never touch the DB (D-01 from shape 1 — files are the truth, no schema, no migration). So the "call forceSave after any write" rule doesn't apply; the concern is only filesystem atomicity on write (rename-into-place per convention).

**Thin API — do not accrete server-side smarts.** The API is a REST surface over the disk. Not a validation layer with its own opinions, not a queuing layer, not a rate limiter. The scheduler is the only actor that consumes specs at fire-time; the API just lets other actors CRUD them.

## Prior context

- Shape 1 (`shape-wake-ups-backend.closed.md`) landed the spec convention, the scheduler, and the fire path. The API this shape ships reads the same files the scheduler polls.
- Skynet already has a fleet-status pattern for enumerating per-host on-disk state (identities, apps) — this shape's list endpoint should mirror it.
- Skynet's ROLE-list-for-host endpoint already exists (`src/backend/database/routes/roles-list-for-host.ts`) — the role-enumeration piece of this shape may already be there or need minor extension.
- No CRUD-API groundwork specific to wake-ups exists yet (verified during shape 1 research — RESEARCH.md flagged `identity-artifact-reader.wakeup-crud.test.ts` as adjacent but the file is per-identity wake-up CRUD, not global).
- **Per-role wake-up CRUD surface still wired** — Skynet has substantial CRUD wired for `~/fleet/roles/<role>/wakeups/*.json` (`readRoleWakeups`, `writeRoleWakeupCreate`, `writeRoleWakeupUpdate`, `writeRoleWakeupDelete` in `src/backend/claude-session/identity-artifact-reader.ts`; WS handlers in `claude-session-server.ts`; UI callsites likely in `RoleModal.tsx` and/or `WakeupsTab.tsx`; tests: `identity-artifact-reader.role-wakeups.test.ts`, `claude-session-server.role-wakeup-crud.test.ts`, `claude-session-api.role-wakeup-crud.test.ts`, `PrettyView.role-modal-swap.test.tsx`). Shape 1 retired per-role wake-ups fleet-wide (28 specs migrated + scheduler stopped reading role-scope dirs), but this API surface is still fully live and would silently accept writes into a dead-end. **In-scope for this shape** — see § Scope edges.

## What would make it wrong

- API caches wake-up specs and drifts out of sync when an agent writes to disk directly ("two paths in" fails if either side is stale).
- Writes fail non-atomically (partial-write mid-fsync leaves a corrupt spec the scheduler tries to load).
- API responds to a delete by silently orphaning the spec's `.state/<slug>.fired` sentinel — the scheduler would think the slot has fired for a spec that no longer exists (minor, but ugly).
- The role/skill enumeration endpoints hard-code assumptions about which host they're for, breaking multi-host discovery.
- API adds validation constraints beyond what `wakeup-scheduler.py` accepts, causing UI-created specs to fail differently than agent-created ones.
- API surface leaks Skynet-DB-typing patterns (like the wire-protocol coordinator: boolean carry-over) into what should be a pure filesystem-facing surface.

## Scope edges

**In:**
- CRUD endpoints for global wake-up specs (list / create / update / delete / toggle-enabled).
- Fleet-wide sweep on list (host param on writes) — locked, see § Shape.
- Role + skill enumeration endpoints for the modal's chip-pickers.
- Atomic-write discipline (write to `<slug>/wakeup.json.tmp`, rename into place).
- **Removal of per-role wake-up CRUD surface** — the backend `writeRoleWakeup*` + `readRoleWakeups` functions, their WS handlers, UI callsites, and tests. Shape 1 retired per-role wake-ups; the API surface serving them is dead weight and creates a silent-fail failure mode (user adds wake-up in RoleModal's tab → it never fires because scheduler stopped reading role-scope dirs). **De-risk in discuss-phase**: confirm what `WakeupsTab.tsx` / `RoleModal.tsx` actually serves — per-role, per-identity, or both — so per-identity wake-up management doesn't get killed prematurely (shape 3's global modal is the successor for the per-role surface, not the per-identity surface).

**Out:**
- The UI modal itself → shape 3.
- Any DB shadow of the spec state.
- History-of-past-fires endpoint (deferred; can be a later phase if the modal grows a history view).
- Per-identity wake-up CRUD surface (the `~/fleet/identities/<name>/wakeups/*.json` path — different concern from shape 1's retirement, stays untouched).
- Notifications / websockets / streaming for spec changes (Skynet has no streaming — refetch on modal open + on write).

## Vehicle notes

Standard GSD phase, likely 1-2 plans. Reuses Skynet's existing filesystem-facing patterns (fleet-status for reads, atomic-write helpers for writes). Container mutation required to deploy. No fleet-substrate changes.

Per-role removal adds ~1 commit's worth (mechanical deletion — no rewriting; tests delete rather than rewrite), and its UI-side impact needs de-risking during discuss-phase before plan-phase locks the file list.
