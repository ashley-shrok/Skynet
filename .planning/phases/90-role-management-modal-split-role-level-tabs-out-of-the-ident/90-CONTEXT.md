# Phase 90: Role management modal — split role-level tabs out of the identity modal into their own role modal + roles-list surface - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning
**Source:** In-session `/build feature-mode` → `/open` shape lock 2026-09-09 (greenlit `thumbs up` same session, 4 tasting rounds on roles-list rows, 2 console-snippet iterations on the identity-modal title-line treatment). Bounty `role-management-modal-split` (pinned by Ashley 2026-09-09, item 8 in the ongoing UX-pass campaign — natural follow-up to Phase 89's identity-modal-tab-restructure and Phase 86's cosmetics-migrate-to-role). Shape file: `.planning/shapes/shape-role-management-modal-split.md`.

<domain>
## Phase Boundary

Peel the four role-scope tabs (role file / runbooks / bounties / wakeups) out of the identity modal into their own dedicated **role modal**, addressed by role name rather than by identity. Add a new **roles-list modal** as the front door to it, reached from the conversation-list three-dots menu via a new **"Edit roles…"** entry. The identity modal simplifies as a result — no more segmented scope switch, no more role-scope tabs — and gains a small **clickable treatment on its title-line subtitle** as the fast-path shortcut back up to the identity's own role modal.

Three surfaces move: two are new (roles-list modal, role modal), one loses weight (identity modal). One supporting piece behind them: a way to enumerate every role on a host along with its cosmetic frontmatter (avatar filename, colorHue, title/displayName, voice), consumed by the roles-list modal to render conversation-row-treatment rows.

**In scope (repo changes only):**
- Roles-list modal (new) — reached from panel-header three-dots menu via "Edit roles…" entry. Renders host-picker dropdown at top + alphabetical list of roles below in `.pv-row` treatment (hue-tinted glass, role avatar, display name, chevron). Header includes a "+ New role" button that opens the existing CreateRoleDialog. Row click closes the list and opens the role modal for that role (swap-not-stack). Match the host-picker UX of `GlobalFilesModal.tsx` — single-host users auto-select their only host; multi-host users see a dropdown.
- Role modal (new) — global modal (portals to `document.body` — no chat-pane context). Chrome wears the role's own hue (matches the row that opened it). Header carries role avatar + role display name + close button. Four tabs (role file / runbooks / bounties / wakeups) hosting the same tab-body components those currently render in the identity modal's role scope, lifted with role-name addressing instead of identity-key addressing. Role file tab additionally gains cosmetic-edit controls (Title text input, ColorPicker, VoicePicker, avatar generator) — mirrors the identity modal's cosmetic edit block MINUS the inherit/override affordance layer (roles are the source of truth for cosmetic values; there is no upward inheritance to represent).
- Identity modal refactor — drop the top segmented scope switch (the `[role="group"][aria-label="Scope"]` element and its container) and drop the four role-scope tabs. Post-phase tab set is 3 tabs (identity file / wakeups / telegram — identity scope only). Preserve identity-scope cosmetic edit block AS-IS (Phase 86's inherit/override affordances stay).
- Identity title-line clickable treatment — the subtitle span in the identity modal header (`title` frontmatter field, visible under displayName) gets: dotted underline in a slightly brighter tone (`#c4b89a`), a `›` chevron suffix, and on hover: brighter color (`#f0ebe0`) + solid underline + full chevron opacity. Click routes to the role modal for the identity's role via the swap-not-stack transition (identity modal closes, role modal opens at global viewport level). Fallback when identity has no `title` set — decorate the displayName line instead (planner picks the specific treatment; same-shape decoration is acceptable).
- Three-dots menu (panel-header, `PrettyConversationsPanel.tsx:2036-2064`) — remove "New role" entry, add "Edit roles…" entry. Post-phase menu order: New agent · Edit roles… · Edit global files… · Edit skills…. The "+ New role" affordance folds into the roles-list modal header.
- Backend supporting piece — enumerate every role on a host along with its cosmetic frontmatter (title, colorHue, voice, avatar filename). Either extend the existing `GET /roles?hostId=<n>` endpoint (`src/backend/database/routes/roles-list-for-host.ts`) to include cosmetics, or add a companion route. Planner picks the exact shape.
- Backend supporting piece — serve role-level avatar bytes for the roles-list modal + role modal. Parallels the identity avatar endpoint (`/identities/:key/avatar?hostId=X`). Planner picks the shape — most likely `GET /roles/:name/avatar?hostId=X`.
- Backend supporting piece — write role-file cosmetic frontmatter from the role modal's role-file tab. Extend the existing `identity:update-role-file` WS wire type (currently keyed on `identityKey` that lets backend resolve role via the identity's `role:` frontmatter — see `claude-session-server.ts:1349+`) OR add a role-name-keyed variant (`role:update-file` type). Planner picks. Full-overwrite semantics (mirrors current role file editor). Same 409-mtime UX as the runbook editor from Phase 89 is a nice-to-have but planner's discretion.
- Tests — in-process user-flow tests walking: panel-header → three-dots → "Edit roles…" → roles-list modal renders → click a role row → role modal opens with correct hue + content → make a cosmetic edit → save → close. Also: identity-modal title-line click → identity modal closes → role modal opens. Also: "+ New role" button in roles-list opens CreateRoleDialog. Scoped unit tests for the backend enumeration + avatar-serve additions.

**Out of scope:**
- Enriching roles-list rows with state (bounty counts, identity counts, activity glances) — deliberately spartan; directory-not-dashboard.
- Search / filter inside the roles-list modal — small fleet doesn't warrant it.
- Cross-fleet role aggregation — list is per-selected-host (matches host-picker choice), not merged-across-fleet.
- "Recently-active" sort order — alphabetical only.
- Any change to what content lives inside the four role-scope tab bodies themselves — the role file / runbooks / bounties / wakeups tab bodies render identically to how they render in the identity modal today; only their host changes. (The role-cosmetic-edit block is a NEW addition to the role file tab, not a change to the tab body's existing content.)
- Any change to identity-scope tabs (identity file / wakeups / telegram) — untouched.
- Any change to the avatar-flow runbook or the avatar generation pipeline itself — this phase consumes role-level avatar bytes; how they got there is Phase 86's territory.
- Restoring the identity modal when the role modal closes — role modal close just dismisses to the surface underneath (panel-header if opened from three-dots menu; nothing if opened from identity title-line since the identity modal already closed).
- Modal-on-modal / stack behavior — swap-not-stack throughout (matches Phase 89's precedent).

</domain>

<decisions>
## Implementation Decisions

### D-01: Role-cosmetic-edit UI belongs in this phase (LOCKED — Ashley 2026-09-09, resolves Phase 86 deferral)

Ashley 2026-09-07 (Phase 86 CONTEXT.md § Deferred): *"I would leave this alone [post-creation role cosmetic edit] because I actually plan on breaking out the role level stuff into its own modal later, and that would be a good opportunity to add it."*

Ashley 2026-09-09 (this session, verbatim): *"we are going to do the cosmetics editing on this like it's basically just going to be the same thing that the identity modal has, except for maybe the override stuff that shows up there. So that should be a pretty one to one recreation."*

**Resolution:** the role modal's role-file tab grows the same cosmetic edit block the identity modal has for cosmetics — Title text input, ColorPicker (`src/ui/features/pretty-view/pickers/ColorPicker.tsx`), VoicePicker (`src/ui/features/pretty-view/pickers/VoicePicker.tsx`), and the avatar generator flow (inline batch-generation as it lives in NewSessionDialog + IdentityModal — same batch-generate + carousel + gamma-brighten flow). **MINUS the inherit/override affordance layer** (Phase 86's `titleReverting`/`voiceReverting`/`hueReverting`/`avatarReverting` states, "inherited from role: X" ghost hints, "revert to role default" buttons) — a role IS the source of truth for its cosmetic values; there is no upward inheritance to indicate, and "revert" has no defined target.

**Save-side wiring:** cosmetic values written directly to the role file's frontmatter (title, colorHue, voice, avatar). Value present = value; value absent = null (role has no cosmetic set — should not happen post-Phase-86 for roles created through the UI, but the read side handles null defensively).

**Same picker components, same call shapes** — no fork, no clone, no divergence.

### D-02: Roles-list modal uses the Edit-global-files host-picker pattern (LOCKED — Ashley 2026-09-09)

Ashley 2026-09-09 verbatim: *"for B, I was thinking we could actually set it up the same way as the edit global files modal, where there's a drop down to pick a host. And if you are a user that only has one host, then that just defaults to that one host that you have. So that keeps that simple."*

**Resolution:** the roles-list modal receives `hostTree: HostFolder | null` + `defaultHostId: number | null` props (mirrors `GlobalFilesModal.tsx:54-56`). At the top of the modal body: host-picker dropdown. Single-host users see their only host auto-selected with the picker hidden or disabled (match Phase 84's shared "hide-host-picker-when-only-one-host" primitive — same primitive shared with create-role/create-agent modals per Phase 84 CONTEXT). Multi-host users pick from the dropdown; roles list re-fetches on picker change.

**Roles list is scope-per-selected-host.** Not cross-fleet aggregate. If a user manages 3 hosts each with their own role sets, they pick one host at a time. Roles from different hosts are treated as separate entries even if their names happen to match — no dedup, no merge.

### D-03: Role modal is a global modal — portals to `document.body` (LOCKED — Ashley 2026-09-09)

Ashley 2026-09-09 verbatim: *"the roles modal and the edit role modal have nothing to do with sessions that you have open or not. like they are sort of global modals the same way that like editing skills and edit global files modals are."*

**Resolution:** both the roles-list modal AND the role modal portal to `document.body` — full-viewport, no chat-region portal, no `container` prop threading. Match `GlobalFilesModal` and `SkillsEditorModal` chrome and portal pattern. The swap-not-stack transition from an identity modal's title-line click closes the identity modal FIRST, then opens the role modal at global viewport level (not in the chat pane the identity modal was portalled to).

**Implication:** the role modal has no per-pane context. It doesn't know which chat pane triggered it (via title-line or otherwise), and doesn't try to restore anything on close. Close just dismisses.

### D-04: Identity title-line clickable treatment (LOCKED — Ashley 2026-09-09, from console-snippet tasting)

The identity modal's title span (the small subtitle under displayName, e.g. tabitha's `"Skynet"`) gets:
- Cursor: pointer.
- Color: `#c4b89a` (slightly brighter than the default muted `#a89a80`).
- Text-decoration: dotted underline, color `rgba(196, 184, 154, 0.35)`, underline-offset 2px.
- Suffix: chevron `›` in a nested span, `marginLeft: 3px, opacity: 0.7`.
- Transition: 120ms on color + text-decoration.
- On hover: color `#f0ebe0`, decoration solid, decoration-color `rgba(240, 235, 224, 0.6)`, chevron opacity 1.
- Native title attribute: `Open role modal: <role-display-name>`.

**Click handler:** closes the identity modal and opens the role modal for the identity's role. Same swap-not-stack transition the roles-list modal → role modal path uses.

**When identity has no `title` set:** apply the same treatment to the displayName line instead (planner picks whether to decorate the displayName directly, or fall back to a tiny pill below it if decorating a bolder line feels off). The console-snippet tasting decorated the title exclusively; planner extends to the no-title fallback.

**Reference:** locked console snippet in `/open` transcript (this session's chat, second snippet — the pill variant from the first snippet was rejected).

### D-05: Roles-list rows use `.pv-row` conversation-row treatment (LOCKED — Ashley 2026-09-09, from 4-round mock tasting)

**Reference:** locked mock at `~/.claude/roles/box-maintainer/bounties/role-management-modal-split/mock/index.html` Shape 1 column (served at `http://t1000:8898/index.html`).

Each row is a full `.pv-row`-styled element per `pretty-conversations.css:482-517`:
- Rounded rect, `border-radius: var(--radius-pv-bubble)` (14px).
- Background: `linear-gradient(160deg, hsla(var(--h), 50%, 38%, 0.55), hsla(var(--h), 45%, 24%, 0.60))` where `--h` is the role's `colorHue`.
- Border: `1px solid hsla(var(--h), 65%, 55%, 0.32)`.
- Layered box-shadow with hue glow.
- Backdrop-filter blur.
- 8px vertical gap between rows (matches conversation panel spacing).

Row content: 40px round `.pv-avatar`-style disc (background gradient with role's hue, image inside object-fit cover, 999px border-radius) + role's DISPLAY NAME (falls back to title-cased slug if `displayName` frontmatter absent) + right-side chevron.

**Sort order:** alphabetical by displayName.

**Empty state:** if the selected host has zero roles, render a small message ("This host has no roles yet.") + surface the "+ New role" affordance prominently. Planner picks the visual.

**Fallback for a role missing role-level cosmetics** (edge case only — should not occur per Phase 86's "roles can't have empty cosmetics" invariant): row renders with a neutral placeholder avatar + hue 190 (app-wide accent). Do NOT design elaborate empty states — this is a hand-broken role file, not a designed UX state.

### D-06: Role modal chrome wears the role's own hue (LOCKED — Ashley 2026-09-09)

The role modal's outer DialogContent applies the same hue-tinted glass gradient the identity modal applies today (`IdentityModal.tsx:1614-1621` pattern), but keyed on the ROLE's `colorHue` instead of an identity's. Same visual family:
- `linear-gradient(160deg, hsla(hue, 45%, 25%, 0.82), hsla(hue, 40%, 15%, 0.88))`.
- Border: `1px solid hsla(hue, 65%, 55%, 0.32)`.
- Box-shadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(hue, 65%, 55%, 0.2)`.
- Border-radius: 24px.
- Backdrop-filter: `blur(28px) saturate(1.4)`.

**Visual continuity:** the hue you see in the roles-list row is the hue you see when the role modal opens. Clicking a magenta-pink Box Maintainer row lands you in a magenta-pink role modal.

### D-07: Three-dots menu after this phase (LOCKED — Ashley 2026-09-09)

Panel-header three-dots menu (`PrettyConversationsPanel.tsx:2036-2064`) transitions from 4 entries to 4 entries — one swap:
- **Before:** New agent · New role · Edit global files… · Edit skills…
- **After:** New agent · **Edit roles…** · Edit global files… · Edit skills…

"New role" entry deleted; "Edit roles…" entry added in its position (between "New agent" and "Edit global files…"). Creation gesture folds into the "+ New role" button inside the roles-list modal header (mirrors how Edit global files… doesn't have a separate "New file" menu entry — the modal owns creation).

**Test collateral:** Phase 88 drift already fixed the CreateRoleDialog blurb reference in `PrettyConversationsPanel.new-role-button.test.tsx` (commit `fa86db0f`). That test now becomes stale for a different reason — the "New role" entry it asserts on doesn't exist post-phase. Either update it to assert the new "Edit roles…" entry + new roles-list modal opens CreateRoleDialog via its + button, OR retire the test + add a new one on the new entry point. Planner picks.

### D-08: Backend enumeration + avatar + write endpoints — planner shapes (LOCKED SEMANTICS, SHAPE OPEN)

Three backend affordances the frontend needs:

1. **Enumerate roles on a host with cosmetics.** Current `GET /roles?hostId=<n>` returns `[{name, description}]` (no cosmetics). Either:
   - Extend the existing endpoint to include cosmetic frontmatter fields (add `title`, `displayName`, `colorHue`, `voice`, `avatarFilename` to each response entry — reuse the `extractCosmeticsFromFrontmatter` helper from `identity-artifact-reader.ts:2095-2157` applied to each role's markdown), OR
   - Add a companion route (e.g. `GET /roles/full?hostId=<n>`) that returns cosmetics too, leaving the existing endpoint untouched for legacy callers.
   - Planner picks. Extending is simpler; adding a companion is safer if any existing caller assumes the two-field shape.

2. **Serve role avatar bytes.** New route parallel to `/identities/:key/avatar?hostId=X`. Most likely shape: `GET /roles/:name/avatar?hostId=X`. Backend resolves `~/.claude/roles/<name>/<avatar-filename>` from role frontmatter and streams the bytes. Returns 404 if role has no avatar frontmatter or the sibling file is missing. Same ROLE_NAME_PATTERN validation as `roles-list-for-host.ts` (`/^[a-z0-9-]+$/` kebab-case, defense against path traversal per STRIDE T-22-02-02). Same SSH lifecycle as existing role reads.

3. **Write role file cosmetics.** Existing `identity:update-role-file` WS wire type (`claude-session-server.ts:1349+`) takes an `identityKey` and resolves the role via the identity's `role:` frontmatter — good for identity-modal-triggered writes, awkward for role-modal-triggered writes since the role modal has no identity context. Two options:
   - Add a companion `role:update-file` wire type keyed directly on `{roleName, hostId, contents}` — cleaner separation.
   - Have the frontend synthesize an `identityKey` from the selected host's identity list (pick any identity holding the role) — brittle, breaks if roles-list host has no local identities.
   - Planner picks the wire shape. Full-overwrite semantics (mirrors current role file editor). Multipart with `data` field + optional avatar file upload if avatar-write happens in same request (mirrors identity PUT pattern per learned preference); or separate avatar-write route. Planner's discretion.

### D-09: Component structure — new RoleModal component, lift existing tab bodies (LOCKED SEMANTICS)

The role modal is a NEW component (`RoleModal.tsx`), NOT a re-parameterization of `IdentityModal.tsx` with a `mode: "role" | "identity"` prop. IdentityModal keeps identity-scope tabs only; RoleModal owns role-scope tabs only. Two clean components beat one branchy super-component.

**Tab body components lifted:**
- `RoleFileTab.tsx` (177 lines) — role file editor, currently consumed by IdentityModal. Now consumed by RoleModal instead. Addressed by role name directly (RoleModal is role-scope); no more resolve-role-via-identity-frontmatter two-step for the render path.
- Bounties tab body — currently inlined in IdentityModal (roughly `IdentityModal.tsx:2100-2300` per scout, driven by the fetched `Bounty[]` array and the client-side search). Lifted into RoleModal, or refactored into its own component consumed by both (probably new component; keeps RoleModal shell clean). Planner picks.
- Runbooks tab body — Phase 89 added this to IdentityModal. Lifted into RoleModal identically. The runbook editor modal (Phase 89's `RunbookEditorModal.tsx`) opens via swap-not-stack from the role modal now instead of the identity modal (semantically identical — just a different parent modal closes when it opens).
- Wakeups tab body (role-scope) — currently the identity modal's `role-wakeups` tab. Lifted into RoleModal. Fetched via existing `identity:list-role-wakeups` WS wire type (which takes an identityKey and resolves the role) OR a new role-name-keyed variant (planner picks — same tradeoff as D-08.3).

**Identity modal after this phase** — role scope removed entirely (scope switch + 4 role-scope tabs). Identity-scope stays: identity file / wakeups / telegram. The `useModalScope` / `setModalScope` hook and `ModalScope` type become dead code (no more scope switching); either delete during this phase or leave for a follow-up dead-code pass. Planner picks.

### D-10: Roles-list modal "+ New role" affordance — modal header (LOCKED SEMANTICS)

The "+ New role" button lives in the roles-list modal's header (right side, near the close X — mirrors how many settings surfaces put creation actions in the header). Click opens the existing `CreateRoleDialog.tsx` on top of the roles-list modal (stack). CreateRoleDialog's existing flow runs unchanged (Phase 84's UX-pass shape). On successful creation, CreateRoleDialog closes and the roles-list refreshes to include the new role.

**Not:** floating action button, inline "+ New role" row at top of list, or persistent button below the list. Header placement matches settings-surface convention.

### D-11: Test discipline (LOCKED — campaign constraint holds)

- Full suite (`npx vitest run`) does NOT run during this phase's execute step. Scoped runs only (`--related` on touched files, or targeted paths).
- `git push` IS authorized as the terminal step of this phase's execute.
- No `docker build`. No `docker cp`. No `docker compose up --force-recreate`. No coord-room ship posts.
- Every push runs `git pull --rebase origin feat/tab-title-from-tmux` first (multi-identity rule).
- Peer identities (tina, tiffany, tanya, taylor) may push concurrently; rebase handles it. No coord post required for push-only sessions per Ashley 2026-09-05 rule.

### Claude's Discretion (planner picks the specifics)

- Exact wire shape for the enumerate-roles-with-cosmetics endpoint (extend vs add companion).
- Exact wire shape for the role-avatar-serve endpoint (path shape, cache headers).
- Exact wire shape for the role-cosmetic-write path (identity-keyed extension vs role-keyed companion, single-request-with-avatar vs separate-avatar-write, mtime-409 UX or not).
- Whether the "+ New role" button opens CreateRoleDialog inside the roles-list modal (stack) or closes the roles-list first (swap). Stack-inside is more common for settings surfaces; swap keeps the swap-not-stack philosophy consistent. Planner picks — either works.
- Whether the identity-modal jump-to-role's `title` fallback (when identity has no title) decorates displayName directly or renders a tiny pill below it.
- Whether to retire `useModalScope`/`setModalScope`/`ModalScope` type as part of this phase or defer to a follow-up dead-code pass.
- Whether Bounties + Wakeups tab bodies get extracted into their own components or inlined in RoleModal.
- Whether the existing `identity:list-role-wakeups` WS type is repurposed with an optional role-name-keyed mode, or a new `role:list-wakeups` type is added.
- Test file names + test-case titles.
- Wave graph (probably: Wave 1 backend enumeration + avatar-serve + write; Wave 2 RoleModal shell + tab-body lifts; Wave 3 RolesListModal + host-picker; Wave 4 IdentityModal refactor + title-line treatment + three-dots menu swap).

</decisions>

<code_context>
## Reusable Assets Found (from scout)

### Backend

**Role list endpoint (extend or companion):** `src/backend/database/routes/roles-list-for-host.ts` — current shape returns `[{name, description}]`; uses two SSH exec calls (`ls -1 ~/.claude/roles` + batched `cat` of each role's markdown). Description parsing already extracts the `## Role` markdown section. Frontmatter extraction is NOT currently done — add `extractCosmeticsFromFrontmatter` from `identity-artifact-reader.ts:2095-2157` applied to each role markdown to grow the response shape.

**Role file loader:** `src/backend/claude-session/identity-artifact-reader.ts`
- `readRoleFile(conn, identityKey)` at L539-575 — reads role file by resolving role name from identity's `role:` frontmatter. Role-scope reads that don't have an identity context need either a role-name-keyed variant or an identityKey-to-role indirection at the frontend.
- `extractCosmeticsFromFrontmatter(markdown)` at L2095-2157 — YAML frontmatter parser, returns `{displayName, title, colorHue, voice, avatar, coordinator, task}`. **REUSABLE** for role frontmatter (same shape).
- `writeRoleFile(...)` at L2606+ — role file writer, full-overwrite semantics.

**Role file WS write handler:** `src/backend/claude-session/claude-session-server.ts:1349+` — `identity:update-role-file` wire type, keyed on `identityKey`. Extend or add companion `role:update-file` wire type (see D-08.3).

**Identity avatar serve endpoint:** `/identities/:key/avatar?hostId=X` — used to backend-resolve identity avatar (falls through to role avatar per Phase 86 loader). Parallel pattern for role avatar serve.

**Role name pattern validator:** `roles-list-for-host.ts:47` — `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/`. Reused for any new role-name path parameter.

### Frontend — modals to mirror

**GlobalFilesModal (host-picker + global-modal chrome reference):** `src/ui/features/pretty-view/GlobalFilesModal.tsx`
- Portals to `document.body` (no per-pane container).
- Takes `hostTree: HostFolder | null` + `defaultHostId: number | null` props from PrettyConversationsPanel.
- Host-picker dropdown at top of modal body.
- `open` state controlled by parent.
- **Mirror this pattern verbatim for the roles-list modal chrome.**

**SkillsEditorModal (global-modal reference #2):** `src/ui/features/pretty-view/SkillsEditorModal.tsx` — same portal-to-document.body pattern, same host-picker convention. Body layered branches (host-not-picked / loading / error / no-items / list). Rows are simple list items with click-to-open. **Mirror the modal shell + host-picker + list structure.**

**IdentityModal (hue-tinted chrome reference):** `src/ui/features/pretty-view/IdentityModal.tsx:1605-1621`
- 24px border-radius, hue-tinted linear-gradient background, hue-tinted border, hue-tinted box-shadow + glow.
- Backdrop-filter blur 28px saturate 1.4.
- **Mirror the DialogContent chrome for the role modal**, with role's `colorHue` supplying the hue variable.

### Frontend — identity-modal parts to lift or drop

**Scope switch (drop):** `IdentityModal.tsx:2089-2141` — `<div role="group" aria-label="Scope">` and its `pt-3 pb-2 flex justify-center` parent wrapper. Delete entirely. Also delete `useModalScope`/`setModalScope`/`ModalScope` imports at L108-110 + related state (L259-278) and effect (L272-277).

**Role-scope NAV_SECTIONS_ROLE (drop):** `IdentityModal.tsx:351-361` — 4-entry role-scope tab config. Delete.

**Identity-scope NAV_SECTIONS_IDENTITY (keep, unwrap):** `IdentityModal.tsx:362-368` — becomes the ONLY NAV_SECTIONS after this phase. Drop the scope-conditional at L369.

**Role file tab render (lift to RoleModal):** `IdentityModal.tsx` renders `<RoleFileTab .../>` in one of its TabsContent panes for role scope. Lift to RoleModal; keep `RoleFileTab.tsx` (177 lines) as-is or with a minor prop-shape refactor (address by role name directly instead of via identity).

**Bounties tab render (lift to RoleModal):** IdentityModal contains the bounties fetch effects + `useState<Bounty[]>` + `useState<Bounty[]>(archived)` + client-side search + accordion (`archiveAccordionValue`) + role-scope filter. Lift the whole tab body — either extract into a `RoleBountiesTab.tsx` component or inline in RoleModal. Fetch pattern: `identity:get-bounties` wire type (currently identity-keyed — needs role-name-keyed variant, see D-08 pattern).

**Runbooks tab render (lift to RoleModal):** Phase 89's addition. Same lift-shape as bounties. Runbook editor modal (Phase 89's `RunbookEditorModal.tsx`) opens via swap-not-stack from the role modal instead of the identity modal — same interaction shape, different parent modal closes.

**Wakeups (role-scope) tab render (lift to RoleModal):** `roleWakeupsState` + the identity-modal role-wakeups tab body. Lift; fetch via existing `identity:list-role-wakeups` WS type (identity-keyed) or new role-name-keyed variant.

**Title-line for jump-to-role treatment:** `IdentityModal.tsx:1738-1742` — the `<span className="text-xs text-[#a89a80] truncate leading-tight">{identity.title}</span>` inside the `.flex.flex-col.min-w-0.flex-1` container. Decorate per D-04 (cursor + dotted underline + chevron + hover shifts + click handler). Fallback when `identity.title` is null: decorate the displayName span at L1735-1737 instead.

### Frontend — three-dots menu

**PrettyConversationsPanel three-dots menu:** `PrettyConversationsPanel.tsx:2036-2064` — the portalled `role="menu"` element. Four entries in the `items` array (New agent / New role / Edit global files… / Edit skills…). Swap "New role" → "Edit roles…" (label + onClick). Add roles-list modal mount alongside the sibling `<GlobalFilesModal />` + `<SkillsEditorModal />` mounts at L1995-2011.

### Frontend — cosmetic pickers (reusable for role cosmetic edit block)

- **ColorPicker:** `src/ui/features/pretty-view/pickers/ColorPicker.tsx` (48 lines). Used by CreateRoleDialog + NewSessionDialog + IdentityModal today.
- **VoicePicker:** `src/ui/features/pretty-view/pickers/VoicePicker.tsx`. Same reusable component.
- **Avatar generator:** inlined in NewSessionDialog + CreateRoleDialog (Phase 86 added it to CreateRoleDialog). For the role-modal cosmetic edit block, mirror the CreateRoleDialog implementation — it's already role-seeded.

### Existing role-list API client

**`listRolesForHost(hostId)`** at `src/ui/api/identities-api.ts:278` — returns `[{name, description}]`. Extend the return shape (grow `RoleSummary` type) to include cosmetics, or add a companion `listRolesForHostWithCosmetics(hostId)`.

### Established modal patterns to inherit

- Radix Dialog primitives with portal-to-body.
- z-index ladder: overlay `z-[110]`, content `z-[120]`.
- Backdrop-blur overlay with dark tint.
- Header: title on left, close X on right, optional action button between (per SkillsEditorModal).
- Tab strip (role modal): existing bottom-icon-bar chrome from IdentityModal (`IdentityModal.tsx:2143+` — the `Tabs` + `TabsList` shape). Keep the same bottom-nav treatment.

### Tests worth touching (scoped)

- `src/ui/features/pretty-view/IdentityModal.*.test.tsx` — all identity-modal tests that assert scope-switch presence, role-scope tab behavior, or role tab bodies. Some become stale (assert removed surfaces); some become moot (test was for role-scope behavior that's gone from identity modal). Executor decides case-by-case: rewrite for the new identity-modal shape, or retire.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` — was rescued in Phase 88's `fa86db0f` commit. Post-phase, its assertion of "New role" button in the three-dots menu becomes false. Rewrite for "Edit roles…" entry OR retire.
- `src/backend/database/routes/roles-list-for-host.test.ts` (if exists) — extend for the cosmetic fields shape.
- New tests for the roles-list modal + role modal + host-picker flow — in-process user-flow tests per Phase 89's convention.

</code_context>

<canonical_refs>
## Canonical References

Full relative paths — required reading for downstream agents:

### Shape agreement (source of truth for `/close` conformance)
- `.planning/shapes/shape-role-management-modal-split.md`

### Locked visual references (from the /open tasting)
- Mock served locally at `http://t1000:8898/index.html` — Shape 1 column (Spartan directory with conversation-row treatment) is the locked reference for roles-list rows.
- Mock disk path: `~/.claude/roles/box-maintainer/bounties/role-management-modal-split/mock/index.html`.
- Console snippet for identity-modal title-line treatment: locked version is the SECOND snippet in this session's /open transcript (pill variant rejected in favor of title-decoration variant).

### Prior related phases (predecessors)
- Phase 86: `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/86-CONTEXT.md` — established role-level cosmetic frontmatter + per-identity override affordances. Phase 90 resolves the "post-creation role cosmetic edit" deferral from Phase 86.
- Phase 89: `.planning/phases/89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed/89-CONTEXT.md` — established swap-not-stack modal transitions + Runbooks tab. Phase 90 lifts the Runbooks tab body into the new role modal.
- Phase 84: `.planning/phases/84-create-role-modal-ux-pass-header-blurb-drop-required-caption/` — CreateRoleDialog UX pass + shared hide-host-picker-when-only-one-host primitive.

### Backend surfaces
- Role list endpoint: `src/backend/database/routes/roles-list-for-host.ts`
- Identity + role file loader (extraction helpers): `src/backend/claude-session/identity-artifact-reader.ts`
- Role file writer + wire handler: `src/backend/claude-session/identity-artifact-reader.ts` (`writeRoleFile`) + `src/backend/claude-session/claude-session-server.ts:1349+` (`identity:update-role-file` WS handler)
- Identity avatar serve pattern (mirror for role avatar serve): identity artifact reader + identities routes

### Frontend surfaces
- IdentityModal source: `src/ui/features/pretty-view/IdentityModal.tsx`
- RoleFileTab (existing, lifted): `src/ui/features/pretty-view/RoleFileTab.tsx`
- PrettyConversationsPanel three-dots menu: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2036-2064`
- GlobalFilesModal (host-picker pattern to mirror): `src/ui/features/pretty-view/GlobalFilesModal.tsx`
- SkillsEditorModal (global-modal chrome to mirror): `src/ui/features/pretty-view/SkillsEditorModal.tsx`
- RunbookEditorModal (Phase 89, opened via swap-not-stack from role modal now): `src/ui/features/pretty-view/RunbookEditorModal.tsx`
- Cosmetic pickers (reused verbatim): `src/ui/features/pretty-view/pickers/ColorPicker.tsx`, `src/ui/features/pretty-view/pickers/VoicePicker.tsx`
- API client — role list: `src/ui/api/identities-api.ts:278` (`listRolesForHost`)
- CreateRoleDialog (opened by "+ New role" button in roles-list modal header): `src/ui/sidebar/CreateRoleDialog.tsx`

### Bounty record + workspace
- `~/.claude/roles/box-maintainer/bounties/role-management-modal-split/bounty.json`
- Mock folder: `~/.claude/roles/box-maintainer/bounties/role-management-modal-split/mock/`

### Standing fleet rules (from box-maintainer role file)
- Multi-identity role — `git pull --rebase origin feat/tab-title-from-tmux` before every push.
- No worktrees (do NOT spawn Agent with `isolation: "worktree"`).
- No coord-room posts for push-only sessions (Ashley 2026-09-05).
- Subagents don't do deploys — this phase ships push-only, no deploy.
- Test discipline: scoped during dev, full suite ONLY at deploy gate after explicit ship greenlight.
- No worktrees. No streaming (Skynet has no message streaming — do not design around it).

</canonical_refs>

<deferred>
## Deferred / Out of Scope

**Deferred to a future bounty/phase:**
- Enriching roles-list rows with state (bounty counts, identity counts, activity glances, last-touched timestamps). Directory-not-dashboard stance is deliberate; add later once the routing shape settles and Ashley wants the extra signal.
- Search / filter inside the roles-list modal. Small fleet doesn't warrant it; revisit if fleet grows past ~20 roles.
- Cross-fleet role aggregation (merge roles from every managed host into one list). Kept per-selected-host per Ashley 2026-09-09 (Edit-global-files pattern).
- "Recently-active" sort order in the roles-list. Alphabetical only for v1.
- Modal-on-modal / stack behavior between the roles-list modal and the role modal. Swap-not-stack throughout per shape; upgrade to stack is a v2 if the round-trip proves annoying.
- Restore-identity-modal-on-close when role modal was opened via identity-modal title-line jump. Role modal close just dismisses; no back-navigation.
- Role-scope switching WITHIN the role modal to a different role (e.g. a role picker in the role modal header for quick round-trips). One role per modal open; user goes back to roles-list to pick another.

**Tempting-but-no (out of scope per shape file § Scope edges):**
- Extracting a shared modal shell primitive from GlobalFilesModal + SkillsEditorModal + new roles-list modal. Do the clone; extract later if a fourth caller emerges.
- Extracting a shared cosmetic-edit-block primitive from IdentityModal + RoleModal + CreateRoleDialog + NewSessionDialog. Same reasoning — do the mirror; extract later.
- Adding a "which host does this role live on?" indicator on identity modal (since roles are now first-class-fleet-viewable). Not needed — identity modal already shows the identity's host implicitly.
- Auto-migrating box-maintainer's role file to add cosmetic frontmatter it currently lacks (empty frontmatter). Per Phase 86 deferral, migration is deployer-hand-motion, not code motion.
- Any change to CreateRoleDialog itself (Phase 84's UX-pass shape stays intact; roles-list modal + button just opens it).
- Backfilling role-level cosmetics for existing roles that don't have them. Same deferral as above — hand motion.
- Renaming `useModalScope`/`setModalScope`/`ModalScope` to reflect the identity-only future. Either delete them entirely (they're dead code post-phase) or leave for a follow-up sweep. Not a shape decision.

**Non-goal:** any change that would make an existing identity modal open with a DIFFERENT tab set on identities that haven't been touched. Every existing identity modal continues to render identity-scope tabs after this phase; the scope switch + role-scope tabs simply vanish.

</deferred>

<campaign_notes>
## Campaign Context

Phase 90 sits after Phase 89 (identity modal tab restructure, Runbooks tab added) and Phase 86 (cosmetics migrate to role). It resolves Phase 86's deferral on post-creation role cosmetic edit UI by adding that block to the new role modal's role-file tab.

Campaign constraint continues (Ashley 2026-09-07):
> "the farthest you'll get amongst any of this is pushing changes to remote and running scoped tests, but we're not going to be running the full test suite we're not going to be rebuilding we're not going to be deploying until we're done."

Consequences enforced in this phase:
- Execute step runs scoped tests only.
- Phase ends at `git push`. No `docker build`, no `docker compose up --force-recreate`, no `docker cp` fast-path, no full-suite gate.
- No coord-room BEFORE/AFTER posts (push-only rule, Ashley 2026-09-05).
- Every push runs `git pull --rebase origin feat/tab-title-from-tmux` first.
- Ride-along ships: a peer's future `--force-recreate` may pick up my commits from origin. Ashley knows and has explicitly authorized this shape.

Post-phase items pending in the campaign string:
- Whatever campaign items remain after Phase 90 lands (Ashley tracks the ordering; tabitha keeps the order per her delegation).

Ashley 2026-09-07 delegation (verbatim): *"after each build for this plan, you're going to reset yourself and then invoke the next build on the next bounty at the start of the next session"* and *"you're in charge of making sure that we continue with the plan and these bounties go in the right order."*

</campaign_notes>

---

*Phase: 90-Role-Management-Modal-Split*
*Context gathered: 2026-09-09*
