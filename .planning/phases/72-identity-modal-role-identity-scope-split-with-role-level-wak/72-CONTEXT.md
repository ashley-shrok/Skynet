# Phase 72 CONTEXT: Identity modal role/identity scope split with role-level wakeups management

**Opened:** 2026-09-04
**Vehicle:** GSD phase (discuss-phase → plan-phase → execute-phase)

**Provenance:** This CONTEXT.md was seeded directly from the `/build` → `/open` shape file at `.planning/shapes/shape-identity-modal-scope-split.md` (opened + greenlit by Ashley 2026-09-04). All "What this is / Shape / Philosophy / Prior context / What-would-make-it-wrong / Scope edges" sections below are LOCKED decisions from that session — do NOT re-elicit.

The `/gsd:discuss-phase` step added: (a) canonical refs the planner needs, (b) code-context grounding for the four existing patterns this phase will mirror, and (c) a small set of implementation decisions surfaced during codebase probing that the shape file did not lock (add-wakeup UX, delete-wakeup UX, scope-switch memory storage, wire-protocol shape for role-scope CRUD, tab-label choice under each scope, race-handling for concurrent role-wakeup writes). All (c) items are LOCKED here with defaults grounded in existing patterns; Ashley can override any of them in one line before planning.

---

## What this is

The identity modal — the panel that opens when you tap an identity's badge in a chat — is being reorganized so the two worlds it currently mixes together are visible as two worlds. Some of what the modal shows belongs to the role (shared across every identity of that role); some belongs to just this one identity. Right now those live in one flat strip of six tabs and you have to remember which is which. In the new shape, the modal has a Role view and an Identity view; you switch between them with one control at the top, and the tabs at the bottom change to match. A second thing the modal was missing is fixed at the same time: schedules that belong to the role — rather than to a specific identity — can now be listed, edited, added, and disabled from inside the Role view. Before this, those schedules had no interface at all, which was especially painful for coordinator identities whose only meaningful state is those role-level schedules.

## Shape (LOCKED from shape file)

Open the modal on any identity. At the top, just under the modal title, sits a single two-position control: **Role** on the left, **Identity** on the right. Tap one, tap the other; it switches which view is showing. The view fills the middle of the modal, and the icon bar along the bottom shows only the tabs that belong to that view.

- **Role view** — shows things that belong to the role (shared across every identity holding it). Its tabs: the role's own description document, the shared list of active work items, the shared chronological log, and the role-scoped schedules.
- **Identity view** — shows things that belong to this specific instance of the role. Its tabs: this identity's own document, this identity's schedules, and this identity's where-we-left-off carry.

When the modal opens for an ordinary actor identity, it defaults to the Identity view (matches current default). When the modal opens for a coordinator identity, it defaults to the Role view.

Schedules are the load-bearing new capability: the schedules tab under Role view lists role-scoped schedules, lets you edit / disable / add / delete them, and reads/writes the role's shared schedules folder on disk. Each schedule visibly wears its scope so you never confuse the two, and adding a new one from either tab lands it in the correct scope by construction.

## Philosophy (LOCKED from shape file)

The redesign is about **legibility of scope**, not more features. The scope switch makes the split explicit and hands the mental map to the UI. Two focused views, each smaller and cleaner, beat one blended view with everything on offer at once.

Deliberately doing: making scope readable at a glance; filling the role-scope schedule interface gap; letting coordinator identities render as what they actually are — a router, not a broken actor.

Deliberately not doing: showing role and identity content simultaneously (variants B/E ruled out); left-side navigation (variant C — sacrifices mobile-first bottom-bar language); scope-picker-in-tab (redundant with top switch); redesigning on-disk storage; redesigning anything else in pretty-view.

Spirit-violation: any state where the reader can't tell whether the thing they're looking at is a role thing or an identity thing.

## Prior context (LOCKED from shape file)

Modal today has six tabs in the Telegram-style bottom icon-bar (patch #191). Tabs left-to-right: role's document / identity's document / shared work list / chronological log / schedules / where-we-left-off carry. Schedules tab reads only from identity's own schedules folder — role-scoped schedules aren't surfaced.

Coordinator identities added later; a coordinator has no role document loaded, doesn't touch the shared work list in the normal way, has no meaningful where-we-left-off carry, and its one meaningful piece of state is the role-scoped schedules. Current modal opens on a coordinator → five of six tabs near-empty, and the tab that should carry its whole reason for existing is truthfully empty ("no scheduled wakeups") because it reads the wrong folder.

Ashley pitched the reorganization in-conversation; five layout options were sketched and compared side-by-side with actor vs coordinator states. **Variant D — top scope switch — was chosen** (thumbs-up 2026-09-04, sketch HEAD `f5c8f459`).

Design system notes carrying forward:
- Modal's visual language is the pretty-view palette (`--color-pv-*` tokens), not general Skynet dark-mode tokens.
- Per-identity hue drives glass tints, selected-tab pill background, and mid-gradient surfaces.
- The bottom icon-bar is a deliberately chosen shape (patch #191, keeps the mobile-first ergonomic).

## What would make it wrong (LOCKED from shape file)

- Scope split reads as decoration — reader can't tell just by looking whether they're in Role view or Identity view.
- Role-scoped and identity-scoped schedules bleed together in either view.
- Coordinator identities open the modal and see mostly-empty regions with no explanation.
- Scope switch has surprising memory across identity swaps.
- Any existing modal behavior (bounty search, archive lazy-load, live pinned-count invalidation, inline title/avatar/hue/voice editors, stays-awake switch) regresses.
- Role-scope schedule surface missing an obvious CRUD action.

## Scope edges (LOCKED from shape file)

**In:** segmented Role/Identity switch at top of modal body (above the current icon bar); icon bar reshuffles per scope (Role: role-file / bounties / history / role-schedules; Identity: identity-file / identity-schedules / handoff); role-scope schedule listing + editing + adding + enable/disable + delete (full parity with existing identity-scope surface, but against role folder); coordinator identities default to Role view on open; actor identities default to Identity view on open (matches current); scope switch position remembered across opens of the same identity within a browser session; every wakeup visibly declares its scope.

**Out:** storage / on-disk layout of schedules (already correct); cross-role or cross-identity schedule browsing; badge or surrounding chat surface; bounty/history/handoff renderers; adding/removing tabs beyond the split.

**Deferred:** global schedule dashboard; schedule scope conversion (identity ↔ role without recreate); coordinator dispatch history tab.

**Tempting-but-no:** universal open-default (costs coordinators a click every time for no benefit); picker-in-tab as fallback (dual mechanisms confuse); consolidating both schedule tabs into one under a third top-level control (two tabs, one per view, is cleaner and cheaper); auto-collapsing scope-empty tabs (empty-with-caption is more informative than hidden).

---

## Canonical refs (MANDATORY — every downstream agent MUST read)

- **`.planning/shapes/shape-identity-modal-scope-split.md`** — the original shape file. LOCKED source of truth for what this phase delivers. Everything in this CONTEXT.md's first six sections is derived from it.
- **`.planning/sketches/001-identity-modal-role-vs-identity-split/index.html`** — the visual + interaction contract. Variant D (Top Scope Switch) is the chosen design. Ground layout / palette / interaction details here rather than re-deriving. Sketch is served on tailnet at `http://100.99.149.8:8899/001-identity-modal-role-vs-identity-split/` while the box's HTTP share is running.
- **`.planning/sketches/001-identity-modal-role-vs-identity-split/README.md`** — sketch metadata including per-variant read (pros/cons), for future reference on why variants B/C/E were ruled out.
- **`src/ui/features/pretty-view/IdentityModal.tsx`** — the modal being changed (~1963 lines today).
- **`src/ui/features/pretty-view/WakeupsTab.tsx`** — the current identity-scope wakeups tab (~848 lines).
- **`src/ui/features/pretty-view/RoleFileTab.tsx`** — the current role-scope tab renderer (proof of concept that role-scope data already flows through the modal for OTHER artifacts).
- **`src/backend/claude-session/identity-artifact-reader.ts`** — home of `readIdentityWakeups` (L700), `readRoleFile` (L539), `resolveRoleForIdentity`, `humanizeWakeupSchedule` (L109). New role-wakeup reader should live here alongside these; new writer follows the pattern established by `writeIdentityFile` / `writeRoleFile`.
- **`src/backend/claude-session/claude-session-server.ts`** — home of the `identity:list-wakeups` (L4953) and `identity:update-wakeup` (L5010) WS handlers. New role-scope handlers land here alongside them. `identity:list-bounties` (multi-identity role-scope pattern with SSH local vs remote branching) is the closest structural analog and worth referencing.
- **`src/ui/api/claude-session-api.ts`** — wire type definitions for existing wakeup payloads (`IdentityListWakeupsPayload`, `IdentityUpdateWakeupPayload`, `IdentityWakeupsEvent`, `IdentityWakeupUpdatedEvent`) that will get role-scope siblings.
- **`src/ui/api/identities-api.ts:22`** — the Phase 67 `coordinator: boolean` field on Identity type. Already threaded via `useIdentities()`; modal reads `identity.coordinator` to decide default scope on open. NO backend work needed for coordinator detection.
- **`~/.claude/skills/id/SKILL.md`** § "Scheduled wake-ups" — spec format (interval / daily / weekly / one_shot), file locations (identity-scope at `~/.claude/identities/<name>/wakeups/<slug>.json`, role-scope at `~/.claude/roles/<role>/wakeups/<slug>.json`), authoring rule (agent NEVER creates a scheduled wake-up on own initiative; only per Ashley's authorization). The modal's add/edit/delete affordances DO NOT bypass this — they exist for Ashley to use, not for identities to programmatically populate; no code-side gate needed.

## Code context (existing patterns this phase mirrors)

**Backend wakeup CRUD pattern to mirror (LOCKED):**

The existing `readIdentityWakeups(conn, identityKey)` at `identity-artifact-reader.ts:700` handles both local (in-container) and remote (SSH-branch) reads of `~/.claude/identities/<key>/wakeups/*.json`, parses schedule JSON, and humanizes it via `humanizeWakeupSchedule`. Both branches return `{ wakeups: Wakeup[] }`.

The `identity:list-wakeups` WS handler at `claude-session-server.ts:4953` accepts `{ identityKey, hostId? }`, routes local vs remote based on hostId, responds `identity:wakeups` with the list.

The `identity:update-wakeup` WS handler at `claude-session-server.ts:5010` (patch #154) accepts `{ identityKey, hostId?, wakeupSlug, updates: { enabled?, schedule? } }` and PATCHES a single JSON file atomically, then re-lists and responds `identity:wakeup-updated` with the refreshed list.

**Role-folder two-step pattern to mirror (LOCKED):**

`resolveRoleForIdentity(identityKey)` reads `~/.claude/identities/<key>/<key>.md`, parses YAML frontmatter, extracts `role:` value (validated against `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/`), returns the role slug. Throws when frontmatter is missing, `role:` key absent, or value fails the regex.

`readRoleFile(conn, identityKey)` uses `resolveRoleForIdentity` to get the role slug, then reads `~/.claude/roles/<role>/<role>.md`. Both local + remote branches present. Returns `{ markdown, error? }`.

`readBounties()` and `writeBountyFields()` mirror the same two-step. All role-scope reads follow this pattern.

**Wire protocol shape for role-scope CRUD (LOCKED — decision):**

New wire types added as siblings to the existing identity-scope ones. Names carry the "role-" scope infix so it's clear at the wire what folder is being touched. Rationale: extending existing `identity:list-wakeups` with a `scope` parameter is DRY but muddies "this is an identity op" boundary and forces every existing caller to update. Separate handlers keep the boundary clean and add zero risk to the existing identity-scope surface.

```
identity:list-role-wakeups         { identityKey, hostId? } → identity:role-wakeups         { wakeups: Wakeup[], error? }
identity:update-role-wakeup        { identityKey, hostId?, wakeupSlug, updates } → identity:role-wakeup-updated  { wakeups, error? }
identity:create-role-wakeup        { identityKey, hostId?, spec: { name, schedule, instruction, enabled } } → identity:role-wakeup-created { wakeups, error? }
identity:delete-role-wakeup        { identityKey, hostId?, wakeupSlug } → identity:role-wakeup-deleted { wakeups, error? }
```

Note: the `identityKey` is what drives role resolution via the two-step, so the "identity:" prefix stays; the "role-" infix names the artifact scope. Coordinator identities also carry a `role:` frontmatter entry, so the same two-step works for them.

**Also add symmetric create + delete for the IDENTITY-scope existing surface** (LOCKED — decision) — since the shape says both scopes get full CRUD parity, and the current identity-scope surface today only supports list + update (patch #17g + patch #154), we need to add create + delete for identity-scope too:

```
identity:create-wakeup             { identityKey, hostId?, spec } → identity:wakeup-created { wakeups, error? }
identity:delete-wakeup             { identityKey, hostId?, wakeupSlug } → identity:wakeup-deleted { wakeups, error? }
```

**Frontend coordinator surfacing (LOCKED — no backend work):**

Phase 67 Plan 67-01 already added `coordinator: boolean` to the Identity type at `identities-api.ts:22` (non-nullable, derived from the identity's on-disk YAML frontmatter `coordinator: true|false`). The modal reads `identity.coordinator` directly. No API addition needed.

**Scope-switch memory storage (LOCKED — decision):**

A tiny Zustand slice, e.g. `src/ui/state/modal-scope-store.ts`, keyed by `identityKey → 'role' | 'identity'`. Mirrors the shape of the existing `bounty-counts-store` (imported in `IdentityModal.tsx:28`). In-memory only (browser session lifetime). Rationale: the shape locks scope memory at "within a browser session," which matches Zustand default in-memory shape exactly. NOT persisted to localStorage (cross-tab / cross-day memory would be surprising per the "no surprising memory" failure mode). On modal open: read the store; if entry absent, use the identity-vs-coordinator default. On scope-switch tap: write to the store.

**Add-wakeup UX (LOCKED — decision):**

Sub-modal (Radix Dialog-in-Dialog) with a form. Fields:
- **Name** — text input, required. Becomes the filename slug (`<name>.json`) after slug-normalization (kebab-case, lowercase, alphanumerics + hyphens, matches the id-skill's `slug` convention).
- **Schedule type** — segmented select: Interval / Daily / Weekly / One-shot.
- **Schedule params** — dynamic per type:
  - Interval: `every` text input (accepts `30m`, `2h`, `1d`, etc — parser already exists as `humanizeWakeupSchedule` reads this shape).
  - Daily: `at` time input (24-hour HH:MM).
  - Weekly: `day` select (mon..sun) + `at` time input.
  - One-shot: `at` datetime-local input; timezone locked to browser (fine per spec — bare naive is combined with box-local).
- **Timezone** (optional) — IANA name text input, help text noting it applies to Daily/Weekly/One-shot only. Left empty = box-local.
- **Instruction** — multiline textarea, required.
- **Enabled** — Switch, default `true`.
- **Save** button (primary, hue-tinted) posts via the new create wire type; on success, refreshes the list and closes the sub-modal. **Cancel** button closes without writing.

The "Add wakeup" affordance is a hue-tinted pill button at the top of the wakeups tab (above the list), matching the mid-gradient palette of the existing sticky-search input in the Bounties tab. Same shape for BOTH scopes' add buttons — the current tab dictates which scope the created wakeup lands in.

**Delete UX (LOCKED — decision):**

Small trash icon per wakeup row (lucide `Trash2`), positioned symmetrically to the existing enable/disable Switch. Click opens a small in-modal confirm (Radix AlertDialog): "Delete `<slug>`? This cannot be undone." Confirm posts the delete wire type; refreshes the list on success. Rationale: destructive op needs a confirm; no undo because the file-write is atomic and there's no history to roll back to.

**Tab labels (LOCKED — decision):**

Under Role view: "Role file" / "Bounties" / "History" / "Wakeups". Under Identity view: "Identity file" / "Wakeups" / "Handoff". The scope switch at top already carries the disambiguation; naming the wakeup tab differently under each scope is redundant. Rationale matches the shape's "picker-in-tab is redundant with the top switch" call.

**Race handling for concurrent role-wakeup writes (LOCKED — decision):**

Multiple identities of the same role could simultaneously write to `~/.claude/roles/<role>/wakeups/*.json` from different sessions. Match the existing bounty-write pattern: atomic write via `fs.writeFile` (which on Linux is atomic within a single file for the whole payload). Last-writer-wins semantics. No lockfile. Rationale: the write frequency for wakeup CRUD is low (Ashley-driven, not automated); the bounty pattern already accepts the same race and no incidents have surfaced; adding a lockfile is over-engineering for the actual write volume.

**Coordinator identity Identity-view behavior (LOCKED — decision):**

When a coordinator identity opens the modal and switches to Identity view, all three identity-view tabs render but with informative empty states (matches the sketch's variant-D coordinator column mockups):
- **Identity file** — renders normally (the coord DOES have a slim identity file; small content).
- **Wakeups** — empty state: "Coordinators use role-scope wakeups only. Switch to Role view to manage."
- **Handoff** — empty state: "Coordinators are stateless routers — no handoff to display."

Empty-with-caption matches the "empty-with-caption is more informative than hidden" scope-edge decision from the shape file.

**Testing surface (planner input — NOT locked, flag for planner):**

Existing modal tests: `IdentityModal.test.tsx`, `IdentityModal.voice.test.tsx`, `IdentityModal.role-tab.test.tsx`, `IdentityModal.stays-awake.test.tsx`. All will need updates for the new default-active-tab logic (was `"role"` per patch #22 SRIC-06; now depends on `identity.coordinator`).

New test files expected:
- `IdentityModal.scope-switch.test.tsx` — segmented control renders, tap flips view, coord-vs-actor default, memory across open/close of same identity within session.
- `WakeupsTab.role-scope.test.tsx` — role-scope list read, create, edit, enable/disable, delete flows.
- `identity-artifact-reader.role-wakeups.test.ts` — backend two-step read (local + remote branches).
- `claude-session-server.role-wakeups.test.ts` — WS handler tests for all 4 role-wakeup wire types.

Planner may choose to piggyback on existing test files rather than add new ones — decision belongs in the plan phase.

**Modal-file-split decision (planner input — NOT locked, flag for planner):**

`IdentityModal.tsx` is ~1963 lines today. Adding the scope switch + reshuffled tab list + Zustand slice bindings without splitting is defensible; splitting into `<ScopeSwitch>` + `<RoleView>` + `<IdentityView>` sub-components before the change lands is also defensible. Plan-checker pass should weigh testability and blast radius; both approaches are acceptable.

---

## Deferred ideas (noted, not in scope for Phase 72)

- **Global schedule dashboard** — a top-level view listing all schedules across all roles + all identities, sortable / filterable. Future phase if Ashley wants it.
- **Schedule scope conversion** — move an existing schedule from identity-scope to role-scope (or vice versa) without recreating. Simple file move, but UX needs thought. Future phase.
- **Coordinator dispatch history tab** — a new artifact (per-coordinator log of what got routed where + when). Would be net-new backend + storage.
- **Unified schedule editor across scopes** — a form that can create in either scope from the same UI (with a scope picker inside). Explicitly ruled out for Phase 72 per "picker-in-tab" scope edge.
- **Role file tab under coordinator's Role view** — the current sketch shows this tab renders with an "not loaded — coordinators don't read the role file" empty state. Alternative: hide the tab for coordinators. Deferred until Ashley has seen the shipped version and can judge.
- **Wakeup-scope conversion notification to peer identities** — none. Same rationale as bounty writes: peers pick up file changes on next scheduler poll.

---

## Handoff to `/gsd:plan-phase`

The plan should be structured around **four waves** of work, each independent enough to stand on its own commit-window:

1. **Backend wakeup CRUD parity** — add `identity-artifact-reader.ts` role-wakeup read (mirroring `readIdentityWakeups` + `readRoleFile` two-step), role-wakeup write / create / delete; add the 6 new WS wire types (4 role-scope + 2 identity-scope create/delete additions); test coverage per pattern. This is the widest-radius, lowest-visual-risk work — should land first.
2. **Frontend wakeup-tab refactor** — extend `WakeupsTab.tsx` to accept a `scope: 'role' | 'identity'` prop and route its list/create/edit/delete calls to the right wire types based on scope. Add the sub-modal for create, the trash icon + confirm for delete. Test per-scope behavior. No modal-shell changes yet.
3. **Scope switch + tab reshuffle in IdentityModal** — add the segmented control at the top of the modal body, the Zustand slice for scope memory, the coordinator-vs-actor default logic, the per-scope conditional tab list, wire the reshuffled bottom-bar. Update the 4 existing modal tests for the new default-tab logic. Add scope-switch tests.
4. **Coordinator empty states + polish** — implement the informative empty states for coordinator Identity view (Wakeups + Handoff empty-with-caption). Visual pass against the sketch (variant D). Any Ashley UAT tweaks land here.

Deploy as one atomic ship (per the box-maintainer standing directive about push-gate + coord-room-announce) after all four waves land and full suite is green.
