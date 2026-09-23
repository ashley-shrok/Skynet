# Phase 129 Discussion Log

**Date:** 2026-09-23
**Mode:** Seeded from /open shape file — no re-elicitation

## Origin

This phase was opened through `/build multi-user-single-host support` → `/open multi-user-single-host-support`. The full pitch → discuss → grill flow ran to completion in `/open`; the user greenlit the resulting shape file at `.planning/shapes/shape-multi-user-single-host-support.md`.

Per the /build skill's explicit rule ("seed discuss-phase from the shape file... don't re-do the discovery work /open already did"), the phase's CONTEXT.md was seeded directly from the shape file. This DISCUSSION-LOG.md captures the /open dialogue that produced the locked decisions.

## /open flow summary

### Beat 1 — user pitch

User's initial pitch (paraphrased from her own words): allow multiple Skynet users to be users of one host; roles/identities specify which user(s) own them; unlisted = fallback to "anyone with host access sees it"; users = Skynet accounts; the concrete driver is one shared-host case where the sidebar gets cluttered with each other's roles and identities; user-list lives in role/identity frontmatter on disk (no DB); if a host has only one user, any interface affordances added by this feature shouldn't show up for them.

### Beat 2 — discussion (informed by two Explore recon passes)

**Recon pass 1** — mapped how roles and identities currently reach the Skynet UI. Findings:
- Sidebar list = live tmux poll (every 2s) joined with `/identities/` endpoint that reads frontmatter directly.
- Skynet is ALREADY reading role/identity frontmatter for cosmetics (displayName, colorHue, voice, task, project, avatar, coordinator). Adding a `users` field is a small addition to an existing mechanism.
- Visibility today = host-level only. No per-role or per-identity gate exists yet — this feature adds the first one.
- Natural implementation seam: `RawCosmetics` type + `resolveIdentityAppearance()`.

**Recon pass 2** — traced role creation path. Findings:
- Roles cannot be typed in the new-agent UI; they must pre-exist.
- Role creation goes through a separate "+ New role" flow (CreateRoleDialog) that POSTs to `/roles`.
- Both create endpoints have the creating userId in scope from JWT — auto-tag is reachable from either.

**Discussion outcomes:**
- Feature is smaller than initially expected because Skynet already reads frontmatter.
- Two open angles raised: (1) role vs identity independence semantics; (2) how far the UI affordance goes.

### Beat 3 — grill (all decisions locked)

| # | Question grilled | User's answer |
|---|---|---|
| 1 | v1 UI scope: file-editing-only or in-app picker? | File-editing-only. No new affordance. Creation-time auto-tag with a smart conditional (only fires on multi-user hosts) is the whole UX. |
| 2 | Auto-tag: touches role file, identity file, or both? | Touches only the file being created. Role creation tags role file; identity creation tags identity file. |
| 3 | Cascade or intersection for role vs identity `users` lists? | Initially said "cascade" (option 2), then reversed to intersection after grilling the shared-role scenario. User must pass BOTH gates. |
| 4 | Role visibility & the "can I create an identity of a role I can't see" corner? | The role-picker filters by role.users gate; users can't pick roles they can't see, so the corner doesn't arise through the intended path. On-disk bypass acknowledged but out of scope. |
| 5 | Shared roles: separate user-role/zoe-role or add each other to one role file? | Add each other to one role file. Lifecycle: creator auto-tags role; other users get added manually later when they need access. |
| 6 | Depth of gate — orphan rows OK? | No. Truly invisible. Hidden identities leave no evidence anywhere. |
| 7 | Existing shared-host content migration? | Deferred to manual post-implementation discussion. Not in scope for v1 code. |
| 8 | Field name and format? | `users:` (YAML list of Skynet usernames). |

### Vehicle decision

GSD phase (per fleet standing directive against skipping phase setup for phase-sized work; touches backend + frontend + tests + deploy).

## Deferred ideas (Noted for later)

- Migration tooling to bulk-tag existing shared-host content — the user will hand-tag; separate discussion after this phase lands.
- UI affordance to view/edit `users` lists on roles/identities — not needed for v1; user's concrete case (the user + Zoe on shared host) works with file editing.
- Auto-add of new users to a role's `users` list when they gain host access — explicitly rejected. Manual.
- Auto-scrub of removed users from `users` lists when host access removed — explicitly rejected. Manual.
- Picker/search over "who else has this role/identity" — not v1.
- Admin-override visibility that bypasses the gate — not v1.
- "Primary owner" vs "secondary users" distinction — not v1; one flat list.

## Claude's discretion (not user-decided, common-sense defaults)

- Filter enforcement lives at the same read path where frontmatter cosmetics get merged (already the single source of truth for row rendering).
- Auto-tag logic runs backend-side after the creating user's JWT has been validated, before the file is written.
- "Multi-user host" test = the target host has >1 Skynet user with access in Skynet's user_hosts table at the moment of creation.
- Field parsing: standard YAML list of strings. Case-sensitivity of username comparison matches whatever the existing Skynet-username storage convention is (planner/researcher confirms during phase; not user-decided).
- Missing `users` field parses as empty list (equivalent to "no gate on this piece").
