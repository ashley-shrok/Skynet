# Phase 134: wake-ups-redesign campaign shape 2 — Skynet backend CRUD API for global wake-ups + per-role wake-up CRUD removal — Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Shape 2 of the three-phase `wake-ups-redesign` campaign. This phase delivers the **Skynet-backend REST API layer** the shape-3 UI modal will consume, plus the removal of the now-obsolete per-role wake-up CRUD surface.

Two responsibilities in one phase (both come out of the shape file, both LOCKED — see § Decisions):

1. **New global-wake-up CRUD surface** — REST endpoints over the on-disk spec convention Phase 127 landed (`~/fleet/wakeups/<slug>/wakeup.json` per host):
   - **List** — fleet-wide sweep of every managed host's `~/fleet/wakeups/`, aggregated response.
   - **Create** / **Update** / **Delete** / **Toggle-enabled** — per-host writes, atomic file operations, `host` param on the request.
   - **Role enumeration** — endpoint for the shape-3 modal's role chip-picker dropdown (list roles available on a given host). Skill enumeration is OUT of scope (see D-04).

2. **Removal of retired per-role wake-up CRUD surface** — the Phase 90 Plan 90-07 `role:*-wakeup` wire ops + their backend service functions + UI callsites. Phase 127 retired per-role wake-ups fleet-wide (28 specs migrated + scheduler stopped reading role-scope dirs), so the still-live API surface is dead weight that creates a silent-fail failure mode (user adds a wake-up in `RoleModal`'s tab → it never fires because the scheduler stopped reading role-scope dirs).

**Explicitly deferred to shape 3:**
- The UI modal itself (list view + create/edit form + delete confirmation).
- Modal-hosted role picker (shape 2 delivers the enumeration endpoint; shape 3 wires the picker component).
- Any deep-link / per-host vs fleet-wide default view decisions.

**The shape file lives at `.planning/campaigns/wake-ups-redesign/shape-wake-ups-crud-api.md` — required reading for every downstream agent working phase 128. It was settled 2026-09-21 during /build's discussion beat + refined further during this discuss-phase (see D-04 skill picker, D-06 delete semantics).**

</domain>

<decisions>
## Implementation Decisions

### API surface shape

- **D-01:** Endpoint style is **HTTP REST** (mirrors `src/backend/database/routes/roles-*.ts`, `identities.*.ts`, and the rest of the Drizzle-backend REST surface), NOT WebSocket wire ops. This is a small departure from the existing per-role/per-identity wake-up CRUD which uses WS (`identity:list-wakeups`, `role:list-wakeups`, etc.); the departure is defensible because (a) fleet-wide sweep aggregation is a natural REST shape, and (b) the ws pattern was designed for one-host-per-connection semantics that don't match the fan-out shape. Exact URL paths (leaning `/wakeups`) + verb decomposition + query-vs-body param placement is Claude's discretion at plan time — the constraint is "REST HTTP, matches existing Drizzle-backend route patterns."

- **D-02:** **Fleet-wide sweep on list; host param on writes.** LIST endpoint enumerates `~/fleet/wakeups/<slug>/wakeup.json` across every managed host (same fan-out shape `identity-artifact-reader.ts` uses for cross-host identity enumeration) and returns aggregated results with each item carrying a `host` field. CREATE / UPDATE / DELETE / TOGGLE endpoints take a `host` param on the request (identifying which host's `~/fleet/wakeups/` directory the write targets); each write dispatches to exactly one host. Return-shape and cache-invalidation strategy Claude's discretion at plan time; lean on the fleet-status TTL cache pattern (`identity-artifact-reader.ts` — TTLed SSH-fan-out caches over per-host reads) for the LIST endpoint.

- **D-03:** **Thin API — no DB shadow, no server-side smarts.** The on-disk files stay the source of truth. Each request reads from disk (or an invalidated-on-write TTL cache) and returns. No validation-layer opinions beyond what `wakeup-scheduler.py` accepts (i.e. no "reject this schedule shape" that the scheduler would still process). Skynet's in-memory-DB `forceSave` rule (per role file's load-bearing invariants) does NOT apply — wake-up specs never touch SQLite.

- **D-04:** **Enumeration endpoints: roles ONLY.** LIST-roles-for-host endpoint enumerates `~/fleet/roles/*/` directory names on a given host (extend or reuse the existing `src/backend/database/routes/roles-list-for-host.ts`). **Skills picker is OUT for this shape** — the user's call (2026-09-21 verbatim): *"i think you pick roles only right now. we may allow picking skills later, but the reality is that an identity born for a wakeup will be able to invoke any skill available to it just like any other, so if you schedule a wakeup that says something like 'check my gmail and give me a digest' then that identity is obviously going to reach for the gmail skill, assuming it exists, so it is no problem."* Rationale: newborn identities carry a role + a first-turn prompt, and can invoke any skill available on the host they land on the same way any other identity can. The wake-up spec's `skills: []` field defined in Phase 127 D-04 stays supported by the scheduler + spawn-request schema (any agent hand-editing a spec at `~/fleet/wakeups/<slug>/wakeup.json` can still set it), but the shape-3 modal never populates it. **No skill-enumeration endpoint in shape 2.**

### Write semantics

- **D-05:** **Atomic writes.** CREATE and UPDATE both use write-to-`.tmp` + rename-into-place, mirroring the atomic-write pattern used elsewhere in `identity-artifact-reader.ts` (rename atomicity guaranteed on same-filesystem). Non-atomic partial writes leave a corrupt spec the scheduler may try to load — this is called out in the shape file's "What would make it wrong" section.

- **D-06:** **Delete is a HARD DELETE** — remove `~/fleet/wakeups/<slug>/` folder entirely + cleanup `~/fleet/wakeups/.state/<slug>.fired` sentinel if it exists (settled during discuss-phase). No archive rename, no soft-delete via `enabled: false`. Rationale: matches the "on-disk files are the truth" philosophy (pretending a file is gone when it's not is the exact "two paths in, one truth out" failure mode the shape guards against); archive would add restore/history affordances that are explicitly out of scope for this arc. Delete-vs-disable stays as two separate ops in the modal: TOGGLE-ENABLED flips `enabled` (spec stays); DELETE removes. The `.fired` sentinel cleanup matters because an orphaned sentinel would inherit "already fired" state onto any future wake-up that happens to get the same slug.

- **D-07:** **Slug generation on create: kebab-case from name; 409 on collision.** Mirrors the existing `role:create-wakeup` handler's behavior (`writeRoleWakeupByName` in `identity-artifact-reader.ts` throws `"wakeup with this name already exists"` on clobber, surfaced as an error to the client). Client-side (the modal) handles the 409 by re-prompting the user to change the name. No auto-suffix numeric collision resolution — consistency with existing Skynet wake-up UX wins over cleverness.

- **D-08:** **Validation matches `wakeup-scheduler.py`'s parser exactly.** Anything the scheduler accepts, the API accepts. Anything the scheduler rejects, the API rejects. Rationale: shape file's "What would make it wrong" section calls out "API adds validation constraints beyond what wakeup-scheduler.py accepts, causing UI-created specs to fail differently than agent-created ones." The API isn't a validation opinion layer; it's a marshaling layer. Rejection reasons come from the scheduler's parser or from filesystem errors, not from the API inventing new gates.

### Per-role wake-up CRUD removal

- **D-09:** **`WakeupsTab.tsx` is a reusable component and MUST stay intact.** De-risk from shape file, resolved during discuss-phase codebase scout: `WakeupsTab.tsx` is a reusable list-renderer mounted by both `IdentityModal` (per-identity wake-ups) AND `RoleModal` (per-role wake-ups) via prop-injection of the CRUD callbacks. The per-identity mount is still live and OUT of scope for removal. What gets removed:
  - `RoleModal.tsx`'s **`role-wakeups` tab entry** (line ~89 `NAV_SECTIONS` entry `{ value: "role-wakeups", label: "Wakeups", Icon: AlarmClock }`).
  - `RoleModal.tsx`'s role-wakeup **fetch + CRUD callback plumbing** (`listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName` — the state block, effects, and callbacks that mount `WakeupsTab` for role scope).
  - `RoleModal.tsx`'s associated imports.
  - `WakeupsTab.tsx` itself stays untouched — still used by IdentityModal.

- **D-10:** **Backend removal — service functions.** Delete from `src/backend/claude-session/identity-artifact-reader.ts`:
  - `readRoleWakeups` (§ "3b. readRoleWakeups")
  - `readRoleWakeupsByName` (Phase 90 Plan 90-07 role-name-keyed variant)
  - `writeRoleWakeupUpdate` (§ "6a1")
  - `writeRoleWakeupCreate` (§ "6a2")
  - `writeRoleWakeupDelete` (§ "6a3")
  - `writeRoleWakeupByName` (Phase 90 Plan 90-07 role-name-keyed variant)
  - Their associated helper types and test-friendly exports if any exist.

- **D-11:** **Backend removal — WS handlers.** Delete from `src/backend/claude-session/claude-session-server.ts`:
  - Wire-op handlers for `identity:list-role-wakeups`, `identity:update-role-wakeup`, `identity:create-role-wakeup`, `identity:delete-role-wakeup` (Phase 72 Plan 01 per-identity two-step).
  - Wire-op handlers for `role:list-wakeups`, `role:create-wakeup`, `role:update-wakeup`, `role:delete-wakeup` (Phase 90 Plan 90-07 role-name-keyed variants).
  - Response types: `identity:role-wakeups`, `identity:role-wakeup-updated`, `identity:role-wakeup-created`, `identity:role-wakeup-deleted`, `role:wakeups-loaded`, `role:wakeup-created`, `role:wakeup-updated`, `role:wakeup-deleted`.
  - The docstring comment block (lines ~144-150 of the wire-op JSDoc) documenting the retired role-scope surface.

- **D-12:** **Frontend API removal.** Delete from `src/ui/api/claude-session-api.ts`:
  - `listRoleWakeups`, `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`, and any type exports that are role-wakeup-specific and no longer imported (e.g. `RoleWakeupResponse` — planner confirms which types are shared with per-identity wake-ups and MUST stay).
  - `WakeupSpecWire` stays (still used by per-identity + upcoming global wake-up API).

- **D-13:** **Test removal — full test files, not selective test blocks.** Delete these test files entirely:
  - `src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts`
  - `src/backend/claude-session/claude-session-server.role-wakeups.test.ts`
  - `src/backend/claude-session/claude-session-server.role-wakeup-crud.test.ts`
  - `src/ui/api/claude-session-api.role-wakeup-crud.test.ts`
  - `src/ui/api/claude-session-api.role-reads.test.ts` — **planner audits before deleting**; the file name suggests it covers other role-scope reads too (role file get, list-bounties). If it does, only the role-wakeup blocks come out; the file stays.
  - `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` — **planner audits**; may cover the modal-swap chrome independent of the wakeups tab. If so, only the wakeup-related test blocks come out.
  - `src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts` — **STAYS** (per-identity wake-up CRUD, still live).

- **D-14:** **Order-of-operations for the removal.** New global wake-up API lands FIRST + green in tests, then role-scope removal + `RoleModal` tab deletion + test-file deletions land. Same phase, same deploy, but the sequencing prevents an interim state where role-scope UI is gone but the new global surface isn't wired for shape 3 to hook into. (Not that shape 3 lands in this deploy, but keeps commits coherent.) Planner picks the wave decomposition.

### Fleet-wide list mechanics

- **D-15:** **SSH fan-out pattern reused from `identity-artifact-reader.ts`.** Planner reads the existing cross-host SSH-list pattern (delimiter-based one-liner batched over one SSH round-trip per host) and applies the same shape for the LIST endpoint. No streaming, single response, host-labeled aggregation. Timeout / partial-response semantics (a host is down or slow) match how fleet-status handles it — planner confirms during research.

- **D-16:** **`skynet` host itself is a "managed host" from the API's perspective.** The LIST endpoint's fan-out includes t1000 (Skynet's own host) as one of the enumerated hosts — reads `~/fleet/wakeups/` from the container's own filesystem OR via a loopback SSH the same way fleet-status treats it. Whichever fleet-status already does; planner mirrors.

### Nginx + routing

- **D-17:** **Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.** Per PROJECT.md § Constraints: without this, the route 200s with `index.html` and the frontend crashes on `.map`. Planner MUST include nginx block updates in every plan that adds a new endpoint.

### Deploy

- **D-18:** **Container mutation required.** Backend code + frontend removal + nginx blocks all live in the Skynet container. Standard docker build + `docker compose up --force-recreate skynet` motion. No fleet-substrate changes. Standard fleet-rule serialization on container mutations (the user coordinates manually).

- **D-19:** **Full test suite is the pre-deploy gate.** `npx vitest run` (exit 0) + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` (exit 0) BEFORE `docker build`. Per fleet rule "Test discipline: scoped during dev, full suite ONLY at deployment" — orchestrator runs the full suite as the FIRST step before container motion.

### Claude's Discretion

- **Exact URL paths** — `/wakeups`? `/api/wakeups`? Path-vs-query for `host` param? Consistent with existing REST routes (compare `roles-list-for-host.ts`'s `?hostId=<n>` pattern, `identities.get-disk.ts`, etc.). Planner picks.
- **TTL value for the LIST cache** — mirror fleet-status if a single value applies; planner picks otherwise.
- **Enable-toggle endpoint shape** — dedicated `PATCH /wakeups/<slug>/toggle-enabled` vs generic `PATCH /wakeups/<slug>` with partial body. Both are defensible; planner picks based on router-file cleanliness.
- **Return shape on aggregated LIST** — flat array with `host` field per item vs `{ [host]: [...] }` grouped. Planner picks based on the modal's rendering ergonomics (shape 3 concern, but shape 2 defines the shape).
- **Wave decomposition** — planner picks how to split the phase into 1-2 plans (likely: plan 1 = new global CRUD endpoints + enumeration; plan 2 = per-role removal + test deletions; or one plan if scope is small enough).
- **Any minor spec-field naming / JSON key ordering polish** — mirror what shape 1's specs already use.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Whole-arc campaign + shape (foundation for shape 2)

- `.planning/campaigns/wake-ups-redesign/campaign-wake-ups-redesign.md` — the campaign artifact naming shape 1 (closed) + shape 2 (this phase) + shape 3 + side-bounties + sequencing.
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-crud-api.md` — the shape agreement for shape 2 (settled 2026-09-21). Carries philosophy, prior context, what would make it wrong, scope edges (updated during this discuss-phase to reflect skills-out + hard-delete).
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-backend.closed.md` — shape 1's closed artifact (Phase 127); carries the on-disk convention shape 2's API layers over.
- `.planning/campaigns/wake-ups-redesign/shape-wake-ups-modal.md` — shape 3's declared shape (the UI consumer of shape 2's API); useful for understanding what shape 2's return shapes will feed.

### Prior phase CONTEXT.md (immediate predecessor)

- `.planning/phases/127-wake-ups-redesign-phase-1-global-on-disk-specs-global-scope-/127-CONTEXT.md` — Phase 127's context. D-04 (spec field shape) + D-11 (identity-birth request-file drop) + D-12 (roles[]/skills[]/prompt fields) are all upstream constraints shape 2 must respect.

### Existing wake-up code (must be understood before extending or removing)

- `src/backend/claude-session/identity-artifact-reader.ts` — home of the per-role wake-up CRUD service functions being removed (`readRoleWakeups`, `writeRoleWakeup*`) AND home of the atomic-write helpers + SSH-fan-out patterns the new global CRUD will reuse. Understand both faces before touching.
- `src/backend/claude-session/claude-session-server.ts` — WS wire-op handlers for the retired role-scope wake-up surface (lines ~1625+ Plan 90-07 block); handlers to delete. Wire-op JSDoc at lines ~124-211 documents every wake-up wire op and reply type; the role-scope entries come out.
- `src/ui/api/claude-session-api.ts` — frontend API surface with `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName` (all being removed). Understand which types are shared with per-identity wake-ups (`WakeupSpecWire`, `Wakeup`) — those stay.
- `src/ui/features/pretty-view/RoleModal.tsx` — `role-wakeups` tab + its fetch + CRUD callbacks (all being removed). `WakeupsTab.tsx` mount inside RoleModal comes out; the WakeupsTab import may become unused after removal if IdentityModal is the only remaining caller — planner audits.
- `src/ui/features/pretty-view/WakeupsTab.tsx` — reusable list-renderer, **stays intact** (per-identity mount inside IdentityModal is out of scope for this phase).

### Existing REST route patterns to mirror

- `src/backend/database/routes/roles-list-for-host.ts` — established SSH-per-host enumeration REST pattern (`GET /roles?hostId=<n>`, batched cat, JWT-gated, ROLE_NAME_PATTERN filter). The new "list roles for a host" enumeration endpoint for shape 3's modal picker can extend or reuse this directly (D-04). Read the header docstring for the security patterns to mirror.
- `src/backend/database/routes/roles-create.ts` — POST route with multipart/form-data, JWT auth, hostId scoping, kebab-case slug validation, SSH-writes-with-atomic-rename pattern. Read for the "write to remote host over SSH with atomic rename" pattern shape 2's CREATE endpoint mirrors.
- `src/backend/database/routes/identities.put-disk.test.ts` (and adjacent identities.*) — for the identities-side REST parity; wake-ups CRUD sits alongside identity-CRUD in the same routes/ folder.

### Scheduler script + wake-up spec parser (validation source of truth per D-08)

- `substrate/scripts/wakeup-scheduler.py` — the on-host scheduler that consumes `~/fleet/wakeups/<slug>/wakeup.json` specs. **Its spec parser IS the API's validation source of truth** (D-08). Header docstring documents current spec shape, schedule kinds, firing semantics.

### Fleet-substrate + nginx + deploy discipline

- `docker/nginx.conf` + `docker/nginx-https.conf` — must add matching `location` blocks for every new backend route (D-17). Per PROJECT.md § Constraints — failure to update BOTH is a known pattern of front-end crashes.
- `PROJECT.md` § Constraints — full deploy discipline (docker compose up --force-recreate, deadman timer, container-mutations-serialize rule).
- `~/fleet/roles/box-maintainer/box-maintainer.md` — role file's Standing directives + Learned preferences (test discipline, container mutation coordination, banned-strings gate, frontend `tsc --noEmit` doesn't catch backend TS errors → pre-push `npm run build:backend && npm run build`).

### Bounty / artifacts

- `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/` — the campaign bounty; holds shape 1's tasting prototype + migration script. Shape 2's execution notes may land here as the phase progresses.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`identity-artifact-reader.ts`'s SSH-fan-out pattern** — used by all cross-host per-identity reads. New fleet-wide LIST endpoint mirrors this shape (batched delimiter one-liner per host, single SSH round-trip per host, aggregated response).
- **`identity-artifact-reader.ts`'s atomic-write pattern** — write-to-`.tmp` + rename-into-place (rename atomicity on same filesystem). New global wake-up CREATE / UPDATE endpoints reuse this discipline.
- **`identity-artifact-reader.ts`'s TTLed cache** — established TTL cache pattern over SSH reads; new LIST endpoint can reuse or align.
- **`roles-list-for-host.ts` REST endpoint** — direct reuse candidate for the shape-3-modal role-picker enumeration endpoint (D-04). Extend it fleet-wide if the shape-3 modal wants to enumerate roles across hosts before the user picks a target host.
- **JWT-gated + `resolveHostById(hostId, userId)` for per-user host isolation** — every new endpoint mirrors this security pattern (established in every existing routes/ file).
- **`WakeupsTab.tsx`** — stays intact; its callback-injection shape is the pattern the future shape-3 modal will also plug into (though shape 3 gets its own modal-scope hosting, not RoleModal's).

### Established Patterns

- **REST HTTP with `hostId` query param** for host-scoped per-file operations (D-01).
- **SSH exec + delimiter-batched cat** for cross-host aggregated reads (D-15).
- **Atomic write via `.tmp` + rename** for on-disk spec persistence (D-05).
- **Full test file deletion when removing a subsystem** (D-13) — matches how prior removals happened cleanly.

### Integration Points

- **Nginx blocks in `docker/nginx.conf` + `docker/nginx-https.conf`** — mandatory paired update per new REST route (D-17).
- **Scheduler ↔ API** — one truth on disk; API reads/writes files the scheduler polls. Any validation mismatch between API and `wakeup-scheduler.py`'s parser is a "two paths in fail" (D-08).
- **RoleModal ↔ WakeupsTab** — currently role-scope mount; being removed. IdentityModal's per-identity mount stays.

</code_context>

<specifics>
## Specific Ideas

- The shape-3 modal design was tasting-settled during shape 1's /open at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`. Shape 2 doesn't render UI, but shape 2's endpoint return shapes should be ergonomic for what the prototype consumes (row-per-wake-up with `name`, `host`, `enabled`, `schedule` humanized, `roles`, `slug`, `nextFire` — planner double-checks against the prototype).
- The user's guidance on skills (D-04, verbatim 2026-09-21): *"i think you pick roles only right now. we may allow picking skills later, but the reality is that an identity born for a wakeup will be able to invoke any skill available to it just like any other, so if you schedule a wakeup that says something like 'check my gmail and give me a digest' then that identity is obviously going to reach for the gmail skill, assuming it exists, so it is no problem."*

</specifics>

<deferred>
## Deferred Ideas

### Deferred to shape 3 (Skynet UI modal)
- The header button in the conversation-list panel header opening the modal.
- List view (rows with name / schedule+next-fire / prompt / role chips / enable toggle / kebab).
- Filter bar (search, role dropdown, host dropdown for fleet-wide vs per-host filter).
- Create/edit form (name / prompt / roles / schedule pickers). No skill picker.
- Delete confirmation dialog wording.
- Whether the modal deep-links per-host or shows fleet-wide by default (leaning fleet-wide default; shape 3 confirms).
- UI hint text explaining the "prompt lands as `## Do this first` in the newborn's identity file body" contract (still open — shape 3 discussion).

### Deferred / considered but excluded
- **Skill enumeration endpoint + skill picker in the modal** — user's call in this discuss-phase: OUT. May be revisited later (D-04); if so, adds a `/skills?hostId=` endpoint reading `~/.claude/skills/*/SKILL.md` or fleet-substrate skills, and a chip-picker in the modal form. NOT this phase.
- **Archive/soft-delete semantics** — rejected in D-06. Delete is hard delete.
- **Server-side auto-suffix on slug collision** — rejected in D-07. 409 + client-re-prompts on collision matches existing wake-up UX.
- **DB shadow of wake-up specs** — rejected in D-03. Files stay the truth.
- **Streaming / websocket for spec-change notifications** — rejected per shape file. Skynet has no streaming; modal refetches on write + on open.
- **History-of-past-fires endpoint** — deferred (potential future phase if the modal grows a history view).
- **Cross-host wake-up management** (moving a spec from host A to host B) — rejected per shape 1's per-host philosophy.

</deferred>

---

*Phase: 128-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-*
*Context gathered: 2026-09-21*
