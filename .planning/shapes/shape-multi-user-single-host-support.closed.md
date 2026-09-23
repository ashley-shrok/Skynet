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

---

## Close-Out

**Closed:** 2026-09-23
**Vehicle used:** GSD phase (129-multi-user-single-host-support-per-user-visibility-gate-on-r), 8 plans across 4 waves
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · per-user visibility gate on roles and identities, falling through to today's behavior when no users named
- **Shape: users list on role + identity frontmatter** — present · users?: string[] parsed in extractCosmeticsFromFrontmatter with absent-⇒-omit for empty/missing/[]; type carried on RawCosmetics
- **Shape: intersection gate (both sides must pass; empty side falls open)** — present · isIdentityVisibleToUser implements D-2 intersection + D-3 fallback, 10-case matrix test locks the truth table
- **Shape: auto-tag creator on multi-user hosts (both create flows)** — present · isHostMultiUser gates the write in both roles-create.ts and identity-birth.ts; buildIdentityFileBody emits users: [creator] via absent-⇒-omit
- **Shape: single-user hosts stay silent (no users field written)** — present · both create endpoints skip the branch when isHostMultiUser=false; file is byte-identical to a pre-129 file
- **Shape: sharing/widening is manual file edit** — present · no widen/share endpoints introduced; auto-tag lives ONLY in the initial-write path (roles-create runs after collision-probe 409; birth writes once at file creation)
- **Shape: deep filtering (no leaked evidence anywhere in sidebar)** — present · gates at GET /identities, GET /sessions/list, GET /roles?hostId, POST /conversation-search, and WS app-frame-filter covering update/gone/identity-archived/snapshot/session-project-changed
- **Philosophy: frontmatter on disk is source of truth** — present · no new DB table, no sync layer; users field parsed by the same reader as displayName/colorHue/voice
- **Philosophy: zero cost for current world** — present · no migration tooling; every existing file has no users field and the fallback keeps it visible
- **Philosophy: visibility filter, not permission system** — present · no admin-override; no bypass warning; no backend write-blocking; null-caller bypass documented as internal-server/test only
- **Philosophy: simple beats clever (no auto-expand, no auto-scrub)** — present · no code path modifies an existing users list after creation
- **Prior context: gate applied at the cosmetics-merge seam, no new file-read plumbing** — present · gate reads users via extractCosmeticsFromFrontmatter alongside existing cosmetics; call sites hold gate authority per one-cascade-authority invariant
- **Prior context: role picker is a separate flow, auto-tag hooks both create points** — present · auto-tag lives in POST /roles and POST /identities/birth; role picker (GET /roles?hostId) applies the role-side gate
- **What would make it wrong: single-user host sees no evidence of the feature** — present · no users key written on single-user hosts, no picker option, no new UI affordance anywhere in src/ui/
- **What would make it wrong: hidden identity leaks through somewhere** — present · five REST read paths gated + five WS frame kinds gated; snapshot/app-snapshot emit empty projections rather than orphan rows
- **What would make it wrong: brand-new identity/role auto-tagged wrong** — present · isHostMultiUser mirrors permission-manager's access shape (owner ∪ direct ∪ RBAC-role); fail-open on username lookup null skips auto-tag rather than tagging with empty; case preserved from DB
- **What would make it wrong: users list change requires redeploy/restart** — present · reads happen per-request; app-frame-filter documents no cache per Assumption A3 to preserve the on-next-read promise
- **What would make it wrong: role picker shows roles the user can't see** — present · GET /roles?hostId filters via isIdentityVisibleToUser(null, roleCos, callerUsername); users key never leaks into response body
- **What would make it wrong: existing users list rewritten by anything other than initial auto-tag** — present · auto-tag lives inline in the initial-write path only; collision probe 409 protects roles-create from rewriting a hand-widened file; birth writes once at file creation
- **Scope-in: users frontmatter field** — present · YAML list of Skynet usernames, parsed and normalized on read
- **Scope-in: intersection gate reaches sidebar rows and live-session indicators** — present · REST list endpoints + WS frames both gated
- **Scope-in: role picker respects role gate** — present · roles-list-for-host filters using role-side gate
- **Scope-in: auto-tag conditional on multi-user host** — present · both create endpoints gate on isHostMultiUser
- **Scope-in: test coverage (single-user unchanged, shared-host tagged/untagged/cross-tagged, shared-role narrowing, role-picker filter)** — present · identity-visibility-gate.test.ts (10-case matrix), roles-create.test.ts + identity-birth.test.ts auto-tag suites, roles-list-for-host.test.ts picker gate suite, identity-artifact-reader.users.test.ts field parsing, app-frame-filter.test.ts identity-gate wiring
- **Scope-out: no UI affordance to view/change users list** — present · zero touches under src/ui/ related to the users field; IdentityModal + CreateRoleDialog + NewConversationModal have no users control
- **Scope-out: no migration tooling** — present · no migration files added; fallback rule keeps existing untagged content visible
- **Scope-out: no backend permission enforcement beyond visibility** — present · gate is consulted only at read-path filtering seams; write endpoints and SSH access are untouched
- **Scope-out: files created outside Skynet UI stay untagged and visible** — present · auto-tag runs only in POST /roles and POST /identities/birth; hand-edited or agent-driven files carry no users field and fall through the D-3 fallback
- **Tempting-but-no: no auto-add on host-access grant** — present · no code path adds usernames on access changes
- **Tempting-but-no: no auto-scrub on host-access revoke** — present · no code path removes usernames on access changes
- **Tempting-but-no: no picker/search over who else has a role/identity** — present · no such UI or endpoint added
- **Tempting-but-no: no admin-override visibility** — present · no admin bypass path; null-caller short-circuit is scoped to internal-server/test contexts only
- **Tempting-but-no: no primary vs secondary users notion** — present · one flat string[] list on each file

### Additions (in the result, not in the shape)

- The live-status frame that carries a session-and-project change also gained a host-level access check (not just the identity-name gate). Pre-129 this frame passed through unfiltered on hosts the receiver has no access to; the executor closed that separate pre-existing host-visibility gap on the same code path as a Rule-2 correctness fix. Documented in the plan summary as such. — endorsed-as-drift

### Follow-ups

None.

### Notes

Provenance for the endorsed host-check drift is triple-layered and one hop from a regressing line to the phase context: the plan SUMMARY documents it, this close-out records it as endorsed drift, and git blame on the added host check points at a commit whose message references Plan 129-05. No separate follow-up needed. Notable design choices worth carrying forward: (1) call sites hold gate authority (grep for isIdentityVisibleToUser is the audit-visible answer to 'did we gate this call site?') rather than embedding the gate in the cosmetics-merge cascade — preserves the pre-existing one-cascade-authority invariant; (2) split fail-open vs fail-closed discipline documented in PATTERNS.md — list endpoints fail-open on read errors (empty sidebar is worse than a stray row), search + WS frames fail-closed (a stray hit or live frame is more visible than a dropped one); (3) no cache on the WS identity-gate resolver by design (Assumption A3), so the shape's 'picked up on next read' promise stays true — flagged as a possible follow-up if SSH profiling shows the per-frame cost is prohibitive; (4) case preservation end-to-end (DB → auto-tag → file → gate compare) is a load-bearing choice locked by RESEARCH § Pitfall 7 and the gate's matrix test.
