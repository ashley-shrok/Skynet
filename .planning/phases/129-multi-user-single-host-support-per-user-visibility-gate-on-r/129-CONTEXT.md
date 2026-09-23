# Phase 129 Context: multi-user-single-host support

**Date:** 2026-09-23
**Phase directory:** `.planning/phases/129-multi-user-single-host-support-per-user-visibility-gate-on-r/`
**Source:** Seeded directly from `.planning/shapes/shape-multi-user-single-host-support.md` per /build skill rule ("either drop the shape file in as CONTEXT.md directly, or generate CONTEXT.md from it — don't re-do the discovery work /open already did"). The /open discussion + grill locked all the decisions below; discuss-phase did not re-elicit.

## Canonical refs (MUST READ before planning)

- `.planning/shapes/shape-multi-user-single-host-support.md` — the source shape file (identical content below, kept in sync). Authoritative shape agreement.
- `src/backend/fleet-status/identity-appearance.ts` — the merge point where role + identity frontmatter cosmetics get resolved into a `ResolvedIdentityAppearance` row. The `RawCosmetics` type (~L31-47) is where the new `users` frontmatter field gets declared; `resolveIdentityAppearance()` (~L62-88, L142-222) is where the intersection gate is applied.
- `src/backend/database/routes/identities.ts` (~L294-350) — the `/identities/` endpoint that enumerates identity keys per host and calls the appearance resolver. The gate needs to filter at this seam for the identity list.
- `src/backend/claude-session/identity-artifact-reader.ts` (~L32-48, L370-386) — `readIdentityFile` + `readRoleFileByName` fetch role and identity markdown over SSH and parse frontmatter via `extractCosmeticsFromFrontmatter`. The new `users` field needs to be parsed here too.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (~L1-50) — the 2-second SSH poll that discovers tmux sessions per host. The session list also needs gating (deep-gate rule — no orphan rows).
- `src/ui/state/conversation-store.ts` (~L50-72) — frontend join of `/sessions/list` + `/identities/`. Filter must bite before this reaches the UI, or the join needs to filter downstream.
- `src/backend/database/routes/roles-create.ts` (~L286-628, userId extracted at L308) — `POST /roles` endpoint. Add auto-tag of creator's Skynet username to new role file's frontmatter when target host has >1 Skynet user with access.
- `src/ui/features/pretty-conversations/CreateRoleDialog.tsx` — the "+ New role" UI. Client-side change probably not needed (backend handles auto-tag), but the dialog is the origin.
- `src/backend/database/routes/identities.ts` — identity-creation POST endpoint (same file as list). Add matching auto-tag for identity file on multi-user hosts.
- `src/ui/features/{new-agent-modal}/NewSessionDialog.tsx` — role dropdown that calls `GET /roles?hostId=<n>` (identities-api.ts L321-328, L533-536). This picker MUST filter by the role gate (role.users intersected with logged-in user).
- Role/identity file locations on managed hosts: `~/fleet/roles/<slug>/<slug>.md` and `~/fleet/identities/<name>/<name>.md`.

## Domain

Per-user visibility gate on roles and identities. Adds a `users` YAML list field to the frontmatter of role and identity markdown files (on disk, on each managed host). The gate is applied at the identity-appearance merge point in the Skynet backend read path, hidden identities do not surface anywhere in the UI, and creation-time auto-tag happens only on multi-user hosts.

## Locked decisions (from /open shape agreement)

- **Storage:** New `users` list in frontmatter of both role AND identity markdown files. YAML list of Skynet usernames. Either or both may be empty.
- **Gate semantics:** Intersection. User sees identity iff `(role.users empty OR user ∈ role.users) AND (identity.users empty OR user ∈ identity.users)`.
- **Fallback:** Empty/absent `users` list means "visible to everyone with host access." Preserves current behavior for every existing role/identity across the fleet. Zero migration cost.
- **Auto-tag conditional:** At creation time via the "+ New role" flow and the "new agent" flow, backend writes creator's Skynet username to the new file's `users` list ONLY IF the target host has more than one Skynet user with access. On single-user hosts, nothing is written and the field stays absent.
- **Auto-tag scope:** Only touches the file being created. Role file auto-tagged on role creation; identity file auto-tagged on identity creation. Never rewrites existing values.
- **UI:** NO new affordance for viewing or editing `users` lists. Sharing = manual frontmatter edit. Role picker in new-agent UI DOES filter by role.users gate (existing picker, gated read).
- **Depth of gate:** Hidden identities leave no evidence anywhere — no orphan session rows, no ghostly indicators. Filter must bite at every surface where the sidebar composes rows (identity list + session list + any live-status heartbeat).
- **Not a permission system:** Visibility filter only. No backend permission enforcement beyond current host-access gate. On-disk bypass (agent editing files directly) is out of scope — trusted.
- **Migration of existing shared-host content:** Deferred. Ashley will hand-tag existing entries post-implementation as a separate manual discussion.
- **Field name confirmed:** `users:` (YAML list of Skynet usernames).

## Shape file below (unchanged from `.planning/shapes/shape-multi-user-single-host-support.md`)

---

# Shape: multi-user-single-host support

**Opened:** 2026-09-23
**Vehicle:** GSD phase

## What this is

A per-user visibility gate on roles and identities. Today Skynet shows every user everything on every host they have access to — a fine model when a host has one user, but on a host shared by multiple users each user's sidebar gets cluttered with the other's roles and identities. This feature lets a role or identity name the users it belongs to, and hides it from everyone else. The gate falls through to today's behavior when a role or identity doesn't name anyone.

## Shape

Two things live in the frontmatter of the file on disk: a `users` list on the role's markdown file, and a `users` list on the identity's markdown file. Both lists carry Skynet usernames. Either or both can be empty; both empty means "no gate on this piece."

A logged-in user sees an identity if, and only if, both gates pass for them:

- The role gate passes if the role's `users` list is empty, or the logged-in user's name is on it.
- The identity gate passes if the identity's `users` list is empty, or the logged-in user's name is on it.

Both must pass — this is an intersection. So a shared role (say, `users: [ashley, zoe]`) can still contain identities that only one of them sees, because each identity's own `users` list narrows further within that role.

When a role or identity is created through the Skynet app on a host that has more than one Skynet user with access to it, the creator's Skynet username is automatically written to the new file's `users` list. When it's created on a host that has only one user, nothing is written — the field stays absent, the file looks exactly like a file made before this feature ever existed. This keeps the feature invisible in the majority case and self-managing in the shared case.

Sharing a role or identity with a cohabitant is a manual edit: open the file, add the other user's name to the `users` list. Widening also happens by editing.

The gate reaches deep. When the sidebar hides a role or identity from a user, no evidence of it survives anywhere in that user's view of that host — no stripped-down "something's here" row, no orphan indication that a process is running. From that user's seat, on that host, the hidden piece does not exist.

## Philosophy

Frontmatter on disk is the source of truth for how roles and identities present themselves. This feature keeps it that way — one more field alongside the display name and color, read from the same place, at the same time, in the same way. No new database, no new sync layer, no mirror to keep consistent.

Zero cost for the current world. Every existing role and identity on every host has no `users` field, and the fallback rule keeps them all visible exactly as they are today. No migration, no dropped rows, no surprises. Users on single-user hosts see no new interface, no new frontmatter noise on new roles they create, no reason to know this feature exists.

The gate is a visibility filter, not a permission system. There is no admin override, no bypass warning, no backend enforcement beyond what the current host-access gate already does. If someone edits a file directly on disk to give themselves visibility, that is fine — the frontmatter is the truth, and whoever can edit it is trusted.

Simple beats clever. A role that only names its creator stays "theirs" until they or a cohabitant adds someone. It does not auto-expand as new Skynet users appear on the host, and it does not auto-scrub when a user is removed. The state on disk is the state; if it drifts from intent, a person notices and edits.

## Prior context

Skynet is already reading role and identity frontmatter today. Every cosmetic on a sidebar row — display name, color, voice, task, project, avatar, coordinator marker — is pulled from the same markdown files this feature would extend. The gate can be applied at exactly the point where those cosmetics get merged into a row; no new file-read plumbing is required.

Visibility today is host-level only. A Skynet user owns a set of hosts and sees everything on them. There is no per-role or per-identity gate anywhere yet, so this feature adds the first one.

The identity-creation UI is a picker of existing roles on the target host — the user cannot type a new role name at identity-creation time. Roles are created through a separate "+ New role" flow launched from the sidebar header. Both flows already know the Skynet username of the caller at creation time (from the login session), so auto-tagging is reachable from either without new plumbing.

The concrete driver: most Skynet users are one-to-one with a single host, but Ashley has one host shared with Zoe today, and the sidebar clutter from seeing each other's roles and identities is the day-to-day pain that motivated this.

## What would make it wrong

- A user on a single-user host sees any evidence of this feature — a `users` field written to a new file, a picker option, a stray affordance anywhere in the UI. The invisibility in the majority case is load-bearing.
- A hidden identity leaks through somewhere — a session row without cosmetics, an unfiltered fleet-status heartbeat, a notification, a search result, anything reachable from the sidebar. If the gate hides you, the gate hides you everywhere.
- A brand-new identity or role created on a shared host is auto-tagged with the wrong user's name, or missed when it should have been tagged, or tagged when the host is not actually multi-user.
- Changing a role's or identity's `users` list requires a redeploy or a restart to take effect. This is on-disk frontmatter and should be picked up on the next read, the same way a display-name change is today.
- The role picker in the new-agent UI shows roles the user can't see. Whatever gates the sidebar has to gate the picker too, from the same source of truth.
- A role or identity file has its `users` list rewritten by anything other than the initial auto-tag at creation. This feature does not touch existing values.

## Scope edges

**In:**
- The `users` frontmatter field on role and identity markdown files (YAML list of Skynet usernames).
- The intersection gate in the read path, applied deeply enough that hidden pieces do not surface anywhere in the sidebar, its rows, or the live-session indicators feeding into them.
- The role picker in the new-agent UI respects the role gate.
- Auto-tag at creation time in the "+ New role" flow and the new-agent flow, conditional on the target host having more than one Skynet user with access.
- Tests covering: single-user host unchanged; shared-host visibility of tagged, untagged, and cross-tagged content; shared-role narrowing via identity-level tags; role-picker filtering.

**Out:**
- A UI affordance to view or change a role or identity's `users` list. Sharing is a file edit for now.
- Any migration tooling. Existing content on the shared host stays untagged; the fallback rule keeps it visible to everyone until it's hand-tagged.
- Any backend-side permission enforcement beyond visibility. The gate hides; it does not block writes or block SSH.
- Handling of role or identity files created outside the Skynet UI (agent-driven, hand-edited on disk). Those come in untagged; the fallback rule keeps them visible.

**Deferred:**
- Post-implementation, Ashley will manually clean up the existing shared-host content by hand-editing frontmatter. Whether any tooling helps with that is a separate conversation after the code lands.

**Tempting but no:**
- Auto-adding new users to a role's `users` list when they gain host access.
- Auto-scrubbing removed users from `users` lists when they lose host access.
- A picker or search over "who else has this role/identity."
- Admin-override visibility that ignores the gate.
- Any notion of "primary owner" vs "secondary users." One flat list.

## Vehicle notes

GSD phase because the change spans backend (frontmatter parsing, gate logic in the read path, session-list filtering, both create endpoints, tests) and frontend (role picker filter). Ashley's standing directive against skipping phase setup for phase-sized work applies here.

The identity doing the work is `pixel-box-maintainer-2` on the `feat/tab-title-from-tmux` branch. Next step is `/gsd:phase` to slot this shape into a phase, followed by `/gsd:plan-phase` → `/gsd:execute-phase` (auto-proceeding per GSD's standard rule). Deploy stays orchestrator-only per box-maintainer standing directives — no ship steps in executor plans. `/close multi-user-single-host-support` runs at the end against this file.
