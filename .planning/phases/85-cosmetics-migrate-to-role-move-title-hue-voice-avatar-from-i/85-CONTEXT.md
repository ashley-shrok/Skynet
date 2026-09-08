# Phase 85: Cosmetics migrate from identity level to role level — Context

**Gathered:** 2026-09-07
**Status:** Ready for planning
**Source:** In-session `/build feature-mode` → `/open` shape lock 2026-09-07 (greenlit `thumbs up` same session). Bounty `cosmetics-migrate-to-role` (pinned by Ashley 2026-09-07, item 1b in the reordered UX-pass campaign — upstream dependency carved out of `create-agent-modal-ux-pass` /open discussion). Shape file: `.planning/shapes/shape-cosmetics-migrate-to-role.md`.

<domain>
## Phase Boundary

Move the four cosmetic frontmatter fields (`title`, `colorHue`, `voice`, `avatar`) from IDENTITY level to ROLE level as **defaults**, with the identity's own frontmatter fields becoming **overrides**. Mirrors how directives already inherit through the substrate (role baseline, identity narrows it). Six surface changes: role-file frontmatter grows the four cosmetic fields; backend loader overlays identity onto role; create-role dialog grows cosmetic authoring controls; new-session dialog loses those same controls; identity-edit modal gains explicit inherited/override affordances; tests updated across all four. Two documents move alongside code: substrate id-skill spec doc updates; avatar-generation runbook drops the stale Matrix-upload step.

Phase-scoped narrowly: creation-time cosmetic authoring only for roles — post-creation role cosmetic EDIT is deferred (Ashley 2026-09-07 verbatim: *"I would leave this alone because I actually plan on breaking out the role level stuff into its own modal later, and that would be a good opportunity to add it."*). Migration of existing identity cosmetics up to role level is OUT of scope — whoever deploys handles by hand (this ships mechanism, not data motion).

</domain>

<decisions>
## Implementation Decisions

### Inheritance model (LOCKED — from shape file § Shape + § Philosophy)

Per-field resolution semantics for `title`, `colorHue`, `voice`, `avatar`:

```
resolved_value = identity_frontmatter_value ?? role_frontmatter_value ?? null
```

- Absent from identity → inherit from role.
- Present in identity → override role's value (whatever it is — even if numerically identical, presence = override).
- Absent from both → `null` (as today for identities that have no cosmetic set).
- `displayName` is EXCLUDED from this migration — stays per-identity always (it IS the per-identity unique name).

Applies uniformly to all four fields. All four fields are structurally symmetric (Ashley 2026-09-07: "one shared image" for avatar — no per-identity generation within a role-defined style).

### The six surface changes (LOCKED — from shape file § Shape)

1. **Role file frontmatter gains four optional cosmetic fields.**
   - Schema addition: `title?: string`, `colorHue?: number (0-359)`, `voice?: string`, `avatar?: string` (filename of sibling avatar image, e.g. `<role>.webp`).
   - Location: `~/.claude/roles/<role>/<role>.md` YAML frontmatter block (same shape as identity frontmatter today).
   - Avatar image file lives ALONGSIDE the role file at `~/.claude/roles/<role>/<avatar-filename>` (mirrors identity-side convention: sibling image file, `avatar:` frontmatter field names the filename).
   - Existing role files without cosmetic frontmatter continue to work — every field is optional; absence resolves via fall-through per the model above.

2. **Backend loader reads role cosmetics, overlays identity cosmetics.**
   - New extraction path: after `readRoleFile(conn, identityKey)` at `src/backend/claude-session/identity-artifact-reader.ts:539-575`, apply an equivalent to `extractCosmeticsFromFrontmatter(markdown)` (currently only used on identity markdown at L2095-2157) against the role markdown.
   - Response builder `publicIdentity(identityKey, hostId, cosmetics, role)` at `src/backend/database/routes/identities.ts:109-150` receives BOTH the identity cosmetics AND the role cosmetics; merges per the `identity ?? role ?? null` rule per field.
   - Avatar URL resolution: the existing `/identities/${identityKey}/avatar?hostId=X` endpoint continues to serve the LOGICAL avatar for that identity. Backend resolves the file: if identity has an `avatar:` field pointing at a sibling file, serve that; else if role has an `avatar:` field pointing at a sibling file in the role folder, serve that; else 404 (or fallback to whatever the endpoint returns today for no-avatar). URL shape stays; the file-resolution logic gets a role-fallback branch.
   - **Load path efficiency (planner's discretion):** the current `listIdentityKeysOnHost` + per-identity `readIdentityFile` + `readRoleFile` flow already reads both. Cache role reads across identities that share a role (multiple identities of `box-maintainer` should not each re-read `box-maintainer.md` from disk). Planner picks the caching strategy — per-request memo is probably sufficient.
   - Types: `Identity` interface at `src/ui/api/identities-api.ts:3-28` gains no NEW fields; the existing `title | null`, `colorHue | number | null`, `voice | string | null`, `avatarUrl` continue to represent the RESOLVED value the frontend sees. Whether the identity's own cosmetic is an override vs inherit-from-role is a SEPARATE concern surfaced only in the identity-edit modal (change #5 below); the runtime rendering surface just sees the resolved value and doesn't care.

3. **CreateRoleDialog grows cosmetic authoring controls.**
   - File: `src/ui/sidebar/CreateRoleDialog.tsx` (420 lines today; has ZERO cosmetic controls per Phase 84 CONTEXT confirmation).
   - Fields to add (mirror what NewSessionDialog has today):
     - **Title** input (short subtitle string for the role). Same shape as NewSessionDialog L1195.
     - **ColorPicker** — reuse the existing `@/features/pretty-view/pickers/ColorPicker` component (48 lines, `{value, onChange, disabled?, id?}` — same call shape as NewSessionDialog L1249-1251, IdentityModal L1769-1772).
     - **VoicePicker** — reuse the existing `@/features/pretty-view/pickers/VoicePicker` component (same call shape as NewSessionDialog L1232-1235, IdentityModal L1763-1766).
     - **Avatar generator** — reuse the batch-generation flow from NewSessionDialog L655-700 (`postGenerateAvatarBatch({name, title, brief, colorHue})`) with role-scoped seeds. Carousel picker rendered the same way as NewSessionDialog L1269-1390 renders it.
       - **Seed mapping for role avatar generation:** `name` = role name (kebab-case), `title` = role title (from the new Title field in this dialog), `brief` = role description (the existing description textarea in CreateRoleDialog), `colorHue` = role colorHue (from the new ColorPicker in this dialog). Same generator, seeded from role-level values.
       - No separate `brief` field on CreateRoleDialog — the existing role description doubles as the brief for avatar generation (avoids duplicate freeform-text inputs).
   - Persistence: role cosmetic fields must land in the role file's frontmatter on `POST /roles` — either directly by the create-role endpoint (`src/backend/database/routes/roles-create.ts`), or via a subsequent write step. Include avatar image write to the role folder (`~/.claude/roles/<role>/<avatar-filename>`) as part of role creation.
   - Endpoint shape (LOCKED-BY-EXISTING-PATTERN): if role creation currently accepts JSON, extend to multipart/form-data with a `data` field carrying the role metadata JSON + optional `avatar` file upload — matches the identity endpoint pattern at `src/backend/database/routes/identities.ts` (identity PUT is multipart with `data` field per the learned preference in the role file about "Skynet `/identities/:id` PUT is multipart/form-data"). Planner: check what `/roles` accepts today (`roles-create.ts:1-87` per scout) and either follow the same convention as identities or keep JSON if avatar-file-write can be split into a post-create step.

4. **NewSessionDialog loses cosmetic controls.**
   - File: `src/ui/sidebar/NewSessionDialog.tsx` (1416 lines).
   - Remove from the identity-mode branch (where `identityMode === true`):
     - **Title input** (L1195, `id="new-identity-title"`).
     - **Brief textarea** (L1217).
     - **ColorPicker** (L1249-1251).
     - **VoicePicker** (L1232-1235).
     - **Avatar generator** (L655-700 handler + L1269-1390 carousel UI).
     - Associated state variables at L313-324: `title`, `brief`, `voice`, `colorHue`, avatar batch state.
   - The new-session flow's identity-mode still creates an identity — but the created identity has EMPTY cosmetic frontmatter, wearing the role's face on landing. Identity CAN be given per-identity overrides later via the identity edit modal (change #5 below).
   - Non-identity-mode (raw shell) is unaffected — it never rendered cosmetic controls.
   - The dialog's still-present fields: identity name, host, role (dropdown), path (per the create-agent bounty separately), identity-mode checkbox (per the create-agent bounty separately). Cosmetic strip here is orthogonal to those changes.

5. **IdentityModal gains explicit inherited/override affordances.**
   - File: `src/ui/features/pretty-view/IdentityModal.tsx` (2333 lines; edit block at L1676-1806).
   - Per cosmetic field (Title L1735-1760, Voice L1763-1766, ColorPicker L1769-1772, Avatar L1689-1733), TWO visible states:
     - **Field is UNSET on the identity → inherit from role.** Field renders as ghosted/placeholder with the role's value shown inline ("inherited from role: <value>"). The exact visual affordance is planner's discretion (ghost text in the input, an "Inherited" chip above the field, a dimmed preview) as long as the wearer can SEE the currently-displayed value came from the role.
     - **Field is SET on the identity → overrides role.** Field renders normally, plus a small "revert to role default" affordance next to it (e.g. an unlink icon, an X, a small button — planner's discretion for the visual, semantics are "clicking clears the identity override, reverts to inheritance").
   - Save-side wiring for revert: when the user clicks "revert to role default", the identity's cosmetic field is DELETED from frontmatter (not written as empty string / null). Presence of the field = override; absence = inherit. Backend detects the delete via `null` in the multipart PUT payload OR by field omission (planner picks the wire convention).
   - Save-side wiring for set: standard `updateIdentity(identityKey, meta, avatarFile, hostId)` call at L1342, but with the semantic that a value set = written to identity frontmatter (creates or updates the override).
   - Dirty tracking at L1789 must respect the new revert state — clicking revert on an unmodified field IS a dirty change (deletes the frontmatter field).
   - Voice sample playback (existing behavior at VoicePicker L46-71) should play the ROLE's voice when the field is in inherit state (so the wearer can hear what they're currently doing), and the identity's overridden voice when set. Planner: same for color/avatar preview — always show the RESOLVED value in the preview area, regardless of inherit vs override.

6. **Tests updated across all four surface changes.**
   - **Backend loader tests** (new): create alongside `src/backend/claude-session/identity-artifact-reader.role-file.test.ts` — add cases exercising role-cosmetic extraction (role file with all four fields, role file with subset, role file with none).
   - **Backend response merge tests** (new): tests for `publicIdentity()` merge behavior — identity-only, role-only, both, neither, per-field. Companion to existing `src/backend/database/routes/identities.put-disk.test.ts` (which already tests identity cosmetic persistence).
   - **CreateRoleDialog tests** (`src/ui/sidebar/CreateRoleDialog.test.tsx`) — grow to cover: cosmetic controls render, values persist via `POST /roles`, avatar generator flow, missing-field defaults. Existing "no cosmetic controls" assertion becomes "has cosmetic controls" assertion.
   - **NewSessionDialog tests** (`src/ui/sidebar/NewSessionDialog.test.tsx`) — REMOVE cases for cosmetic UI in identity-mode (title, brief, voice, colorHue, avatar generation). Preserve non-cosmetic identity-mode tests (name, host, role, path, checkbox).
   - **IdentityModal tests** — extend `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` OR create new sibling tests for the inherit/override affordance. Cases: field unset renders inherited-from-role affordance, field set renders revert affordance, click revert deletes identity override, save-set-cosmetic writes identity frontmatter, save-revert deletes identity frontmatter.

### Two docs updated alongside code (LOCKED — from shape file)

7. **Substrate id-skill spec document update.**
   - File: `~/.claude/roles/box-maintainer/id-skill-handoff.md` (per the "Reference files" list in the role file at box-maintainer.md L215).
   - Update the section describing identity frontmatter to reflect the new inheritance model: role-file frontmatter carries cosmetic defaults; identity-file frontmatter carries optional overrides; per-field resolution is `identity ?? role ?? null`; `displayName` stays per-identity always.
   - Do NOT edit the id skill body itself (`~/.claude/skills/id/SKILL.md`) — that's Nicole/Ashley's fleet-substrate authorship territory (per box-maintainer.md § Fleet-substrate ownership 2026-09-02, id skill authorship transferred to this role, but the spec-doc + skill-body update is a follow-up motion coordinated separately with the Skynet distributor phase). For THIS phase, update only the role-owned handoff doc so future maintainers of this box know the new semantics.

8. **Avatar-generation runbook update.**
   - File: `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md`.
   - Remove the Matrix media upload step (Ashley 2026-09-07 verbatim: *"'avatars also get uploaded to your Matrix homeserver' untrue, runbook that probably came from should be updated"*).
   - No other content changes required unless collateral references break as a consequence of the Matrix-upload strip.

### Migration is OUT of scope (LOCKED — Ashley 2026-09-07)

Ashley 2026-09-07 verbatim: *"Migration isn't part of the build. It's something that whoever deploys on this instance, and Stacy for her instance, would just need to do manually. and then there's no already-overridden problem anyway."*

Consequences for this phase:
- No auto-lift-first-identity's-values-to-role-level code.
- No auto-wipe-redundant-identity-frontmatter code.
- No "detect and warn" prompts in the UI about redundant overrides.
- The build ships the MECHANISM (role cosmetics with identity override). Whoever deploys this on t1000 (me, tabitha, as part of the campaign's eventual ship gate) or T800 (Stacy, on her instance) does the data motion by hand: for each existing role, pick appropriate cosmetics, write them to the role file's frontmatter, and wipe the redundant identity frontmatter fields as part of that motion. This turns every existing identity into "explicitly overriding nothing" (empty cosmetic frontmatter → inherit from role) or "explicitly overriding X" (a value the migrator chose to keep as an intentional divergence).

### Empty-role-cosmetics is not a scenario (LOCKED — Ashley 2026-09-07)

Ashley 2026-09-07 verbatim: *"Rolls can't have empty cosmetics with the flows that we have set up, so it's not an issue to solve."*

Post-migration + going forward, every role created via CreateRoleDialog carries cosmetics — the dialog requires them (planner: field-level required validation on title/colorHue/voice/avatar in CreateRoleDialog; missing values block form submission). Fall-through-to-null for the IdentityModal display case (role has nothing) is a defensive backstop only, not a designed UX — nothing in the identity edit modal shows a "inherited from role: (none)" affordance because that state does not occur in normal flows.

### Test discipline (per campaign constraint — Ashley 2026-09-07)

- Full suite (`npx vitest run`) does NOT run during this phase's execute step. Scoped runs only (`--related` on touched files, or targeted paths under `src/backend/claude-session/`, `src/backend/database/routes/`, `src/ui/sidebar/`, `src/ui/features/pretty-view/`).
- `git push` IS authorized as the terminal step of this phase's execute (per campaign constraint: "farthest you'll get is pushing changes to remote and running scoped tests").
- No `docker build`. No `docker cp` fast-path. No `docker compose up --force-recreate`. No coord-room ship posts (there is no ship).
- Every push still `git pull --rebase origin feat/tab-title-from-tmux` first (multi-identity rule).

</decisions>

<code_context>
## Reusable Assets Found (from scout)

### Backend

**Identity file loader:** `src/backend/claude-session/identity-artifact-reader.ts`
- `readIdentityFile(conn, identityKey)` at L414-448 — LOCAL: `~/.claude/identities/<key>/<key>.md` via `fs.readFile`; REMOTE: SSH `cat`.
- `extractCosmeticsFromFrontmatter(markdown)` at L2095-2157 — parses YAML frontmatter between `---` delimiters, returns optional `{displayName, title, colorHue, voice, avatar, coordinator, task}`. Narrowing: strings must be non-empty, `colorHue` must be 0-359, all fields optional. **REUSABLE for role frontmatter parse** — same YAML shape, same rules, just point it at role markdown.
- `listIdentityKeysOnHost(conn)` at L479-513 — enumerates identities.

**Role file loader:** `src/backend/claude-session/identity-artifact-reader.ts`
- `readRoleFile(conn, identityKey)` at L539-575 — resolves role name from identity's `role:` field, then reads `~/.claude/roles/<role>/<role>.md`.
- `extractRoleFromMarkdown(markdown)` at L273-284 — extracts `role:` YAML key.
- Currently does NOT extract cosmetic fields from role markdown — that's the delta this phase adds.

**Identity types:** `src/ui/api/identities-api.ts:3-28` — `Identity` interface with `displayName`, `title`, `colorHue`, `voice`, `role`, `avatarMime`, `avatarUrl`, `avatarEtag`, `coordinator`, `task`. **Interface shape stays** — only the SOURCE of the resolved values changes on the backend.

**Response builder:** `src/backend/database/routes/identities.ts:109-150` — `publicIdentity(identityKey, hostId, cosmetics, role)`. **THIS is the merge point** where identity cosmetics + role cosmetics need to be combined per the inheritance rule. Function signature likely needs to accept role cosmetics as an additional arg (planner picks the exact shape).

**Role creation endpoint:** `src/backend/database/routes/roles-create.ts` (L1-87 per scout) — currently writes a stub role file with `# <name>` and description comment; NO cosmetic frontmatter today. **Extension point** for cosmetic persistence at role creation.

**GET /identities endpoint:** `src/ui/api/identities-api.ts:78-91` — accepts `identityHosts: Record<string, number>` param; backend uses it to route cosmetic reads to each identity's home host.

### Frontend — cosmetic pickers (reusable)

**ColorPicker:** `src/ui/features/pretty-view/pickers/ColorPicker.tsx` (48 lines). Props: `{value: number, onChange, disabled?, id?}`. Range slider (0-360) + swatch + degree label. Used today by NewSessionDialog L1250, IdentityModal L1771. **Add to CreateRoleDialog with same call shape.**

**VoicePicker:** `src/ui/features/pretty-view/pickers/VoicePicker.tsx` (~150 lines). Props: `{value: string, onChange, disabled?, id?, ariaLabel?}`. `<select>` from `getVoices()` + sample playback via `postSpeak()` at L46-71. Used today by NewSessionDialog L1232, IdentityModal L1765. **Add to CreateRoleDialog with same call shape.**

**Avatar generation:** No reusable component today — the batch-generation flow is inlined in NewSessionDialog (handler at L655-700, carousel UI at L1269-1390, `postGenerateAvatarBatch({name, title, brief, colorHue})`). **Options:**
- (a) Extract to a reusable component during this phase (fresh component consumed by both CreateRoleDialog and NewSessionDialog — but NewSessionDialog is losing its avatar UI, so only CreateRoleDialog consumes it post-phase).
- (b) Inline the flow into CreateRoleDialog directly (mirror the NewSessionDialog implementation).
- **Planner's discretion.** (a) is cleaner but adds surface; (b) is what NewSessionDialog does today. Given only one caller remains post-phase, (b) is probably simpler. Extraction can happen later if a third caller emerges.

### Frontend — dialogs

**CreateRoleDialog:** `src/ui/sidebar/CreateRoleDialog.tsx` (420 lines). Post-Phase-84 shape: name (kebab-case) + description (textarea) + hostId (host picker). Header blurb added in Phase 84. **This phase adds cosmetic controls above/below the existing fields — planner picks placement.**

**NewSessionDialog:** `src/ui/sidebar/NewSessionDialog.tsx` (1416 lines). Cosmetic controls at L1176+ (identity-mode branch). State at L313-324. Avatar batch handler at L655-700. **This phase deletes those blocks from source, along with associated state and handler.**

**IdentityModal:** `src/ui/features/pretty-view/IdentityModal.tsx` (2333 lines). Edit block at L1676-1806. State drafts at L285-297. Save handler at L1317-1376 (calls `updateIdentity(identityKey, meta, avatarFile, hostId)` at L1342). Dirty tracking at L1789. **This phase adds the inherited/override affordance layer on top of the existing controls; ROLE cosmetic values must be accessible in this component (either passed as props from the parent that already has the identity object, or fetched via a new route — planner picks).**

### Tests

- **Backend cosmetic persistence:** `src/backend/database/routes/identities.put-disk.test.ts` — tests title/colorHue/voice overrides in identity PUT.
- **Backend avatar read:** `src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` — tests avatar sibling file discovery.
- **Backend role file read:** `src/backend/claude-session/identity-artifact-reader.role-file.test.ts` — tests role file reading (does NOT test cosmetics — none exist to test).
- **IdentityModal voice edit:** `src/ui/features/pretty-view/IdentityModal.voice.test.tsx`.
- **NewSessionDialog:** `src/ui/sidebar/NewSessionDialog.test.tsx` — tests identity-mode cosmetics.
- **CreateRoleDialog:** `src/ui/sidebar/CreateRoleDialog.test.tsx` — tests role creation.

### Prior related phase

Phase 80 (`id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool`) established the identity-artifact-reader disk-authoritative pattern this phase extends. Phase 80's CONTEXT + PLANS worth skimming for the read/merge conventions already in play.

</code_context>

<canonical_refs>
## Canonical References

Full relative paths — required reading for downstream agents:

- **Shape agreement (source of truth for scope conformance at `/close`):** `.planning/shapes/shape-cosmetics-migrate-to-role.md`
- **Bounty record + workspace:** `~/.claude/roles/box-maintainer/bounties/cosmetics-migrate-to-role/bounty.json`
- **Sister phase (immediate predecessor in the campaign):** `.planning/phases/84-create-role-modal-ux-pass-header-blurb-drop-required-caption/84-CONTEXT.md` (item 1 of the campaign — ship pending, this is item 1b upstream dependency)

**Backend:**
- Identity+role file loader: `src/backend/claude-session/identity-artifact-reader.ts`
- Identity API + types: `src/ui/api/identities-api.ts`
- Identity response builder: `src/backend/database/routes/identities.ts`
- Identity PUT endpoint (multipart pattern precedent): `src/backend/database/routes/identities.ts` (endpoint definitions in same file)
- Role creation endpoint (needs cosmetic-write extension): `src/backend/database/routes/roles-create.ts`

**Frontend dialogs:**
- CreateRoleDialog source: `src/ui/sidebar/CreateRoleDialog.tsx`
- NewSessionDialog source: `src/ui/sidebar/NewSessionDialog.tsx`
- IdentityModal source: `src/ui/features/pretty-view/IdentityModal.tsx`

**Frontend cosmetic pickers:**
- ColorPicker: `src/ui/features/pretty-view/pickers/ColorPicker.tsx`
- VoicePicker: `src/ui/features/pretty-view/pickers/VoicePicker.tsx`

**Tests worth touching (scoped tests):**
- `src/backend/claude-session/identity-artifact-reader.role-file.test.ts`
- `src/backend/database/routes/identities.put-disk.test.ts`
- `src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts`
- `src/ui/features/pretty-view/IdentityModal.voice.test.tsx`
- `src/ui/sidebar/NewSessionDialog.test.tsx`
- `src/ui/sidebar/CreateRoleDialog.test.tsx`

**Role-owned docs to update (outside repo, in identity substrate):**
- `~/.claude/roles/box-maintainer/id-skill-handoff.md` (substrate id-skill spec doc — update cosmetic-frontmatter section)
- `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` (remove Matrix-upload step)

**Learned preference relevant to endpoint work (from role file):**
- Skynet `/identities/:id` PUT is multipart/form-data with field name `data` — a JSON body silently no-ops with a 200. Same trap likely applies to any `/roles/:id` PUT extension. Verify endpoint shape by reading the frontend `*-api.ts` client before hand-testing.

No external ADRs, specs, or PRDs cited by ROADMAP.md for this phase.
</canonical_refs>

<deferred>
## Deferred / Out of Scope

**Deferred to a future bounty (role-level modal breakout):**
- Post-creation role cosmetic EDIT via UI (Ashley 2026-09-07 verbatim: *"I would leave this alone because I actually plan on breaking out the role level stuff into its own modal later, and that would be a good opportunity to add it."*). For Phase 85, roles are cosmetically authored ONCE at creation via CreateRoleDialog; subsequent changes require hand-editing the role file on disk. Whoever picks up the role-level modal bounty later adds a role-cosmetic-edit surface then.

**Deferred to whoever deploys (per Ashley 2026-09-07):**
- Migration of existing identity cosmetics to role-level defaults. Manual work per instance: pick appropriate cosmetics, write to role file frontmatter, wipe redundant identity frontmatter fields. Applies to t1000 (tabitha handles at eventual campaign ship gate) and T800 (Stacy handles on her instance).

**Deferred to later bounties in the campaign:**
- The rest of `create-agent-modal-ux-pass` (Path field admin-only, identity-mode checkbox admin-only + label inverted, paired header blurb — shape already written at `.planning/shapes/shape-create-agent-modal-ux-pass.md`).
- `clone-modal-ux-pass`.
- `identity-modal-tab-restructure`.
- `runbooks-formal-concept`.
- `composebox-buttons-and-queue-tab-redesign`.
- `global-file-agents-may-edit-on-permission`.
- `tts-speed-multiplier-per-instance` (side bounty spawned during `create-agent-modal-ux-pass` /open, NOT in the ordered campaign — pick up when campaign done or when routed).

**Tempting-but-no (out of scope for this phase, per shape file § Scope edges):**
- Per-identity avatar generation within a role-defined style (Ashley picked "one shared image" during /open — role owns one avatar, all inheriting identities show it).
- Auto-lift-first-identity's-values-to-role-level during deploy (manual work, sits with deployer).
- Redesign of the ColorPicker, VoicePicker, or avatar generator components themselves — reuse what already exists.
- Extracting the avatar-generation flow into a standalone reusable component (only CreateRoleDialog consumes it post-phase; inline is fine — extraction later if a third caller emerges).
- Any change to `displayName` semantics (stays per-identity always — it IS the per-identity unique name).
- id skill BODY updates (`~/.claude/skills/id/SKILL.md`) — role-owned spec-doc handoff updates only for this phase; skill-body update is a separate motion coordinated with the Skynet distributor phase.
- Adding a "you have a redundant override" warning in IdentityModal — no such state occurs after manual migration; not worth the UI surface.

**Non-goal:** any change that would make an existing role start rendering DIFFERENTLY after this phase lands but BEFORE manual migration runs. The mechanism ships; the data motion is separate. Every existing identity continues rendering its own cosmetics until someone deliberately migrates its role.

</deferred>

<campaign_notes>
## Campaign Context (reordered UX-pass string — 7 bounties remaining as of 2026-09-07)

Ashley 2026-09-07 verbatim on the campaign constraint:
> "the farthest you'll get amongst any of this is pushing changes to remote and running scoped tests, but we're not going to be running the full test suite we're not going to be rebuilding we're not going to be deploying until we're done."

Consequences enforced in this phase:
- Execute step runs scoped tests only (`--related <files>` or targeted paths).
- Phase ends at push. No `docker build`, no `docker compose up`, no `docker cp`, no full-suite gate.
- No coord-room BEFORE/AFTER posts (there is no ship; the pushes go without coord posts per Ashley 2026-09-05 push-only rule).
- Every push runs `git pull --rebase origin feat/tab-title-from-tmux` first (multi-identity rule).
- Ride-along ships: a peer's future `--force-recreate` may pick up my commits from origin. Ashley knows and has explicitly authorized this shape.

Reordered lineup (Ashley 2026-09-07, tabitha owns the order-keeping per Ashley's delegation):
1a. `create-role-modal-ux-pass` — Phase 84 DONE (shipped locally, not deployed pending campaign ship gate).
1b. **`cosmetics-migrate-to-role` — Phase 85 (this phase).** Upstream dependency carved out of `create-agent-modal-ux-pass` /open discussion.
2. `create-agent-modal-ux-pass` — SHAPED (shape at `.planning/shapes/shape-create-agent-modal-ux-pass.md`), execution deferred until this phase lands.
3. `clone-modal-ux-pass` — also benefits from this phase.
4. `runbooks-formal-concept`.
5. `identity-modal-tab-restructure` — semantics of cosmetic fields shift to override; benefits from this phase. Also the natural home for the role-cosmetic-edit UI deferred out of this phase.
6. `composebox-buttons-and-queue-tab-redesign`.
7. `global-file-agents-may-edit-on-permission`.

Ashley 2026-09-07 delegation (verbatim): *"after each build for this plan, you're going to reset yourself and then invoke the next build on the next bounty at the start of the next session"* and *"you're in charge of making sure that we continue with the plan and these bounties go in the right order."*

</campaign_notes>
