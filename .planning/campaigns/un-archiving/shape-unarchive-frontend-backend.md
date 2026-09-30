# Shape: Un-archive — user path from app to on-disk sentinel

**Opened:** 2026-09-30
**Vehicle:** GSD phase

## What this is

The user-facing half of un-archiving. Shape 1 gave the on-box reconciler the ability to un-archive when it sees the right sentinel; shape 2 gives the user (and the app's server on her behalf) a way to drop that sentinel through the app, along with the discoverable surfaces where archived things are visible. It also normalizes archive AND un-archive interaction on the surfaces it touches — moving them from an invisible right-click gesture to a discoverable menu affordance on each row.

## Shape

**On the server.** Three request paths, one per type (identity, role, app). Each is called with the name of the archived thing and drops the sentinel inside its archive folder. Before dropping, the server checks three preconditions mirroring what the reconciler enforces independently: the archive exists; no live-tree thing at the same name; and (identities only) every role the identity claims must still be live. If a check fails, the request returns a structured reason so the app can name it. The reconciler stays authoritative — the server precheck is a fast-path defense so the realistic failure (missing roles) reaches the user immediately rather than after a silent tick.

Three more request paths on the server: list archived things of each type. Two are new (roles, apps); the third exposes an existing internal listing primitive for identities as an endpoint, so all three types have parallel list APIs from the app's perspective.

A small companion behind those three POSTs: the app's existing per-type file writers today target the LIVE tree with a small whitelist of allowed file paths. Un-archive endpoints need to write into the ARCHIVE tree, and only the sentinel. That's a sibling function per type — not a "which tree?" boolean on the existing writers, because the whitelists differ cleanly (live tree allows several files today; archive tree allows exactly one).

**On the app.** Three discoverable surfaces where archived things live, each attached to the surface for LIVE things of the same type.

- Archived apps live in a new modal reached from a small archived-box icon on the right side of the sidebar's Apps section header, positioned left of the collapse chevron. Fleet-wide list of archived apps across every host; no host label per row (matches how live app tiles work). Rounded-square avatars, mirroring how live apps present in the sidebar.
- Archived roles live in a new collapsed section at the bottom of the drama-masks roles modal. Section header always visible; expanding lazy-loads the archived list. Host-scoped, inheriting whatever host the roles modal has selected.
- Archived identities live where they already do — as rows in the conversation search modal — and gain a new interaction path there.

On every row of every affected surface (live rows in the roles modal + archived rows in all three surfaces), a small always-visible three-dots icon appears. Clicking it opens a small menu; for a live row the menu offers "Archive"; for an archived row it offers "Un-archive". The click stops propagation so the row's usual click behavior (opening the role's modal on live rows, for instance) is not triggered. On success the row is optimistically removed from the list and a native alert tells the user the change may take a moment to reflect elsewhere in the app. On failure the row stays and a native alert names the reason: distinct wording for the missing-roles case, generic wording for everything else.

The right-click gesture that today opens an archive menu on the roles modal is retired in favor of the three-dots menu. The sidebar conversation rows preserve their existing right-click menu because the sidebar isn't touched by this shape (a follow-on shape normalizes it).

**For agents.** No new slash-command. Un-archive is a sentinel drop inside an archived folder, paralleling the archive gesture they already use. The id skill is edited to describe the new user-facing surfaces (so agents can point users at them accurately) and the sentinel-drop pattern for un-archive (so agents can un-archive on the user's behalf when asked).

## Philosophy

**Symmetric with archive, not clever.** Un-archive is the inverse of archive, so it inherits the sentinel-drop-plus-reconciler design already in place; the app just adds the trigger surface and the discoverability layer on top.

**Discoverable-by-default, not right-click-only.** The archive gesture today works via right-click but is invisible to anyone who doesn't already know to try it. The three-dots menu makes both archive AND un-archive first-class visible gestures on the surfaces this shape touches. The sidebar rows retain their existing right-click menu — normalizing them is out of scope here.

**Optimistic on the endpoint, honest about the tick.** When the server acknowledges the request, the row disappears and the alert tells the user the on-disk work happens in a moment. It doesn't pretend un-archive is instant, and it doesn't force the user to sit watching a spinner for the reconciler to catch up.

**Native alerts, not toasts.** Alerts are blocking and impossible to miss; toasts are easy to miss. Success and failure feedback here is small in volume but high in importance — a native alert is the right register. Pragmatic-for-now; may re-evaluate once the pattern has been in use.

**Preconditions on the server, but the app knows about them.** The reconciler on-disk is the source of truth for correctness. The endpoint precheck is a fast-path defense so the app can surface the realistic failure reason (missing roles) immediately rather than after the reconciler's next tick.

**Single-item menus today, extensibility tomorrow.** The three-dots menu on each row carries exactly one action right now (Archive or Un-archive). The pattern is a menu, not a direct-action button, because it establishes an extensibility point — future actions accumulate as additional menu items in the same place across surfaces.

## Prior context

Shape 1 landed the on-box half: three reconciler scanners that pick up the sentinel, do the folder move, handle name collisions and missing-roles refusal, and — for identities — reactivate the Matrix account via admin API. Shape 1's stack is on origin as of this session. The reconciler tick is roughly ~15 seconds; the success alert's language reflects that.

The archive gesture today uses right-click as the ONLY interaction path across every archivable surface — sidebar conversation rows, roles modal rows, and app tiles in the sidebar. Shape 2 changes this on the modal surfaces only; the sidebar stays as-is until a follow-on shape normalizes it.

The conversation search modal already surfaces archived-identity rows in its search results; that's how the current "coming soon" alert fires when the user clicks one. Shape 2 does not need a new fetch path for identities — the rows are already there — it just adds a new interaction affordance on them.

The app has a shared menu-popover primitive and a shared modal primitive in its component library, and a toast primitive that is deliberately not used for this feature per the philosophy above. Every modal in the app uses the same dialog primitive with the same glass-card design tokens, and the taste-modal work done during this shape's discussion beat confirmed that the new archived-apps modal reads correctly under those tokens.

## What would make it wrong

- If clicking the affordance triggers the row's default action (opening the Role modal, say). The click must stop propagation.
- If the row disappears on success and then something later goes wrong on the reconciler side (permanent failure, on-disk work fails), the user is left with no signal. Accepted risk: the archived-list is authoritative on next fetch — the item shows back up the next time the surface is opened. This shape does not add a separate "un-archive failed after the fact" surface; the fetch-on-reopen is the recovery path.
- If the right-click gesture is retired on the sidebar in this shape. The sidebar stays as-is; a follow-on shape handles it. Retiring right-click on the sidebar without a replacement would be a user-visible regression.
- If any surface that today shows archived items visually is left touching right-click only. All three affected surfaces gain the three-dots menu together.
- If the three-dots affordance is added to some rows on a surface but not others, or with inconsistent behavior across surfaces. The pattern is uniform: always visible, click opens a menu, stops propagation.
- If the tests currently locking the right-click-only-archive invariants stay pinned. They get removed with breadcrumb comments naming the shape file, mirroring how the on-box shape retired its own no-longer-applicable design locks.
- If the id skill's teaching of the affected surfaces is not updated in the same shape. The distributed id skill silently misinforms every session otherwise. Substrate source is edited; distribution follows the next sweep.
- If archive is treated as fundamentally different from un-archive in the affordance layer. Both are menu items in the same menu on the same rows; a user finds them the same way.

## Scope edges

**In:**

- Three POST un-archive endpoints and their preconditions.
- Three GET list endpoints (two new, one exposing an existing primitive).
- Archive-tree companion functions for the three per-type file writers.
- New archived-apps modal + its sidebar-header trigger button.
- New archived-roles collapsed section at the bottom of the roles modal.
- Three-dots menu affordance on live-role rows (Archive) and on archived rows in all three surfaces (Un-archive).
- Retirement of the right-click → Archive gesture on the affected modal surfaces (with tests migrated or retired accordingly).
- Optimistic success + failure UX via native alerts, with distinct wording for the missing-roles precondition failure.
- Empty-state text on the archived surfaces when zero items.
- id-skill edits for each affected surface + the un-archive sentinel-drop pattern for agents.
- The campaign artifact's shape 3 declared entry (already sits as a staged edit from this shape's /open discussion).

**Out:**

- Sidebar conversation rows keep their existing right-click menu unchanged. Deferred to the sibling shape that normalizes sidebar header + row affordances.
- The archive-side script split (the standalone shell script that today handles part of app archive) stays as-is. Not touched by this campaign.
- A new agent slash-command for un-archive.
- Room-rejoin fidelity for Matrix un-archive stays as documented drift from shape 1. A separate follow-up shape lands only if peer stale-cache trouble becomes user-visible.
- Any change to the live-app tiles in the sidebar itself. They keep archiving via their existing right-click.
- A "un-archive that role first, then this identity" convenience path. The refuse-with-reason alert is the whole path; the user does the two-step manually.

**Deferred (near-term, in this campaign):**

- Sidebar section header + row affordance normalization → sibling shape 3.

**Tempting but no:**

- Wiring the current "coming soon" left-click alert in the conversation search modal to open the new archived-apps modal (or navigate the user toward un-archiving). Small hook, worth noting as a possible follow-up, but scope creep for this shape.

## Vehicle notes

GSD phase — enumeration is substantial (twenty-five distinct items across five areas: server endpoints, list primitives, three UI surfaces, UX behavior, id-skill edits, and test migration) with tightly coupled decisions across the span. Use `/gsd:phase` to slot it into the roadmap, then `/gsd:plan-phase` → `/gsd:execute-phase` per the standing "no greenlight between plan and execute" rule (auto-proceed inside the phase).

Shape 1's stack lives on the same branch (`feat/tab-title-from-tmux`) and is on origin as of this session. Shape 2 lands on top of it.

**Where the implementer looks:**

- Campaign artifact and shape 1 close-out: `.planning/campaigns/un-archiving/`.
- id skill substrate source (the file that gets edited, NOT the distributed copy): `substrate/skills/id/SKILL.md`.
- Existing archive routes on the server (the shape to parallel): `src/backend/database/routes/{identity,role,apps}-archive.ts`.
- Existing per-type file writers to sibling: `src/backend/claude-session/per-{identity,role,app}-file.ts`.
- Existing archived-identity list primitive to re-use + expose: `src/backend/claude-session/list-archived-identity-keys.ts`.
- Existing modal primitive in the shared component library: `src/ui/components/dialog.tsx`.
- Existing menu-popover primitive: `src/ui/components/dropdown-menu.tsx`.
- Existing toast primitive (deliberately not used here): sonner via `src/ui/components/sonner.tsx`.
- Roles modal to extend: `src/ui/features/pretty-view/RolesListModal.tsx`.
- Sidebar's Apps section header (where the new archived-apps button lands): `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`.
- Conversation search modal (where the kebab lands on archived-identity rows): `src/ui/features/pretty-conversations/ConversationSearchModal.tsx`.
- Substrate distributor catalog: `src/backend/distributor/catalog.ts`.

**Standing conventions active for this shape:**

- One shape per session. Each shape gets its own `/build <shape>` in its own session.
- Deploy boundary: `git push` and `docker build` + `docker compose up --force-recreate` are separate per-invocation greenlights.
- Substrate distribution rule: edit substrate source only; never hand-edit the distributed copy.
- Multi-identity role: `git pull --rebase` before every push and again before every `docker build`.
- Test discipline: scoped tests during dev / push-prep; full suite as the first step before `docker build` at deploy time.
- Executors don't deploy — code + commit + scoped-tests-green only.
