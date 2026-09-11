# Phase 102 — Host-picker ownership filter

Seeded from live conversation with Alice 2026-09-10 during role-cosmetics-data-migration UAT.
Shape is clear enough that no separate `/open` was run; this file replaces the CONTEXT
`/gsd:discuss-phase` would otherwise re-elicit.

## Problem

`GET /host/db/host` returns every host the requester has access to, computed as
`(hosts owned by requester) ∪ (hosts accessible via shared credentialId) ∪
(admin-visibility hosts)`. On Alice's t1000 instance today this surfaces 6 rows
where she'd expect 3 — `joe`'s workstation, `zoey`'s thenasty + ZoeyBattlestation,
plus her own three. All three physical boxes appear twice or thrice in her picker.

On the T800 instance (Stacy's fleet, ~100 users × dozens of identities each), the
same endpoint would swamp her sidebar and every host picker with hundreds of
irrelevant rows.

## Solution shape (LOCKED — Alice 2026-09-10)

- **Backend**: add `?ownedOnly=true` query param to `GET /host/db/host`. When present,
  filter results down to rows where `hosts.userId === requester.userId`. Default
  (param omitted) preserves current behavior verbatim so no non-picker consumer
  regresses.
- **Frontend**: 6 consumers pass `ownedOnly=true`:
  1. `RolesListModal` — the roles-modal host picker
  2. `GlobalFilesModal` — Edit-global-files host picker
  3. `SkillsEditorModal` — Skills editor host picker
  4. `CreateRoleDialog` — New-role host picker
  5. `NewSessionDialog` — New-session (spawn agent) host picker
  6. `AppShell` — sidebar host tree (via `useHostTree()` hook or the underlying API call)
- **Filter mechanism** chosen: backend param (opt-in from callers), NOT client-side
  post-filter. Rationale: wire payload stays tiny at scale; no client-side list
  juggling; any future picker defaults to today's behavior unless it explicitly
  opts in.

## Explicit non-scope

- Do NOT change the default behavior of `/host/db/host` (no removal of the
  cross-user rows for callers who don't ask for `ownedOnly=true`).
- Do NOT touch admin console surfaces (Skynet host manager was stripped per role
  file — no longer exists — but sanity-check no other admin surface consumes the
  full list and would regress).
- Do NOT touch the `hostAccess` table or credential-sharing mechanics — filter
  is READ-side only.
- Do NOT filter by hostAccess entries in the "owned only" path — strictly
  `hosts.userId === requester.userId`.

## Constraints

- **Every new/changed backend route needs matching nginx location blocks in
  BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`** per CLAUDE.md. Adding
  a query param to an EXISTING route does NOT require new location blocks (path
  is unchanged).
- **Scoped tests during dev; full suite only at ship** per fleet directive.
- **Bundled ship with newline fix** (commit `f5b6c4e0`) — Alice's directive:
  "keep doing more so you can ship more stuff at once later."
- **Push requires fresh per-push greenlight** per deploy-window rule — commit
  locally, present bundle for ship.

## Success criteria

- `GET /host/db/host?ownedOnly=true` from an authenticated request returns ONLY
  rows where `hosts.userId === request.userId`. Verified via test + manual curl
  against t1000 with Alice's cookie: expect 3 rows (her thenasty, workstation,
  ZoeyBattlestation), NOT 6.
- `GET /host/db/host` with the param omitted (or `?ownedOnly=false`) returns the
  full existing list — unchanged behavior. Test covers this.
- All 6 UI consumers pass `ownedOnly=true` and their host lists no longer show
  non-owned rows.
- Sidebar (`AppShell`) also filtered — verified by Alice eyeballing t1000 after ship.
- Existing tests for the endpoint continue to pass (no default-behavior regression).

## Related work

- Bounty: `~/.claude/roles/box-maintainer/bounties/host-picker-ownership-filter/`.
- Related bounty: `role-cosmetics-data-migration` (session where this scope emerged);
  the newline-fix commit `f5b6c4e0` from that work will ship in the same bundle.
- `T800-multi-user-isolation` bounty likely benefits from this — flag as related
  if the shape overlaps.
