# Phase 113: skill-creation-in-the-edit-skills-modal - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Seeded from:** `.planning/shapes/shape-skill-creation-in-edit-skills-modal.md` (opened + agreed 2026-09-17 via `/build` → `/open`); no live discuss step re-elicited what the shape locked.

<domain>
## Phase Boundary

The Edit Skills modal today lets a user pick an existing skill on a host and
edit, add, or delete files within it — or delete the whole skill. It cannot
create a brand-new skill from scratch. Phase 113 extends the modal so the
same surface covers the whole lifecycle: creating a new skill with a seeded
`SKILL.md` sentinel, moving the `+ Add file` affordance from the header into
a `+ New file` action-tab at the right of the tab strip where the resulting
file would appear, and hiding the host picker when only one host exists.
Backend gains one new endpoint (create-skill); frontend restructures the
modal's header row and tab strip. On-disk skill layout convention is
unchanged — every skill has a `SKILL.md` at its root, plus whatever else
the user adds.

</domain>

<decisions>
## Implementation Decisions

### New skill creation
- **D-01: A `+ New skill` button lives in the header, positioned AFTER the
  skill picker.** Header order becomes: title • host picker • skill picker
  • `+ New skill` • trash (delete-skill) • X. The delete-skill trash icon
  remains conditional on a picked skill; the `+ New skill` button is
  always visible once a host is picked.
- **D-02: Two chained `window.prompt`s.** First prompt asks for the skill
  name, second prompt asks for the description. Cancel on either aborts
  the whole flow with no side effect. Same UX register as the existing
  `+ Add file` prompt — deliberate consistency; a proper mini-dialog is
  deferred (see Deferred).
- **D-03: The name is silently slugified client-side.** The user types
  free-form ("My Cool Skill"); the client lowercases, replaces spaces
  with hyphens, strips anything outside `[a-z0-9._-]`, and caps at 128
  chars to match the backend's existing `SKILL_NAME_RE`. If the slug
  collapses to empty (e.g., user typed "!!!"), reject with `window.alert`
  and re-prompt the name field only. Do NOT show the final slug back to
  the user; it's an implementation detail.
- **D-04: The description is required.** Empty (or whitespace-only)
  description gets rejected with `window.alert` and re-prompts the
  description field only. The name entered in the first prompt is
  retained across the description re-prompt so the user does not retype
  it.
- **D-05: On success, the create endpoint returns the new skill's slug.**
  The frontend refetches the skills list, auto-selects the new skill, and
  the tab strip opens on the seeded `SKILL.md` file ready to edit.

### `SKILL.md` seed content
- **D-06: The seed file has YAML frontmatter and an empty body.** Exact
  shape (verbatim, no extra whitespace, LF line endings):
  ```
  ---
  name: <slug>
  description: <description-as-typed-by-user>
  ---

  ```
  Body is truly empty — no title, no placeholder. The trailing blank
  line after the closing `---` is intentional so opening the file lands
  the cursor on a clean body-editing position rather than at the end of
  frontmatter.
- **D-07: Description content is written raw as the user typed it**
  (trimmed for leading/trailing whitespace). It must be YAML-safe — if
  the description contains a `:` or a `#` or leading `!`, wrap it in
  double quotes and escape embedded quotes. Simplest safe approach: wrap
  every description in double quotes unconditionally, escape any embedded
  `"` and `\`.
- **D-08: The frontend does NOT write the `SKILL.md` seed itself.** The
  backend endpoint composes the frontmatter and writes the file server-side
  in the same call as the `mkdir`. Round-tripping through the frontend
  would double the SSH cost and open a partial-create window.

### `SKILL.md` invariant (forward-only)
- **D-09: New skills created through this modal always have a `SKILL.md`.**
  The seed happens as part of the create-skill endpoint — no path
  produces a bare skill folder without it.
- **D-10: `SKILL.md` cannot be deleted through this surface.** Both
  layers enforce:
  - Backend: DELETE `/skills-editor/file` returns 400 `{ error: "cannot
    delete SKILL.md" }` when `path === "SKILL.md"`.
  - Frontend: `SkillFileTab` hides its delete affordance when
    `file.path === "SKILL.md"`. The confirmation modal never opens for
    that tab.
- **D-11: Forward-only — legacy skills are not migrated.** Skills that
  already exist on the host without a `SKILL.md` (created manually via
  SSH, older tooling) render whatever files they have. They can land in
  the empty-file-list body state; that state's copy is repointed at the
  new-file tab (see D-15).

### `+ New file` action-shaped-as-tab
- **D-12: The header-level `+ Add file` button is REMOVED.** No longer
  rendered. Its handler and disabled logic are removed from the header
  chrome entirely.
- **D-13: A `+ New file` tab is added at the RIGHT END of the horizontal
  tab strip.** Same visual weight as the file tabs (icon + label pattern)
  — icon is a `Plus` (`lucide-react`) at size 18 to match the existing
  `FileText` icon in the tab strip; label reads `New file` on a single
  line, `text-[10px]`, matching the file-path labels' typography. Pinned
  right — always renders as the last child of the tab-strip container,
  regardless of horizontal scroll position of the preceding tabs.
- **D-14: Clicking `+ New file` runs the existing `handleAddFile` flow
  and does NOT change the active tab.** The click handler calls
  `handleAddFile()` and returns without calling `setActiveTab`. The
  currently-selected file tab stays highlighted throughout; the "+"
  never appears selected.
- **D-15: The `+ New file` tab is present the moment a skill is picked**
  — including in the empty-file-list state. When `files.data.length === 0`,
  the body still renders the informational copy (repointed): *"This skill
  has no files. Use the '+ New file' tab below to create one."* The tab
  strip renders with only the `+ New file` tab as its single child.
- **D-16: The `+ New file` tab is EXCLUDED from `activeTab` state
  transitions.** It cannot be the default `activeTab` when a skill loads
  (skill-load auto-selects the first file tab, not the `+`). Deleting
  the last file does NOT auto-select the `+` — `activeTab` becomes
  `null` and the body renders the empty-file-list branch.

### Single-host hides picker
- **D-17: When `flatHosts.length === 1`, the host picker `<select>` is
  hidden entirely.** The single host is still auto-selected on modal
  open (existing behavior at `SkillsEditorModal.tsx:124`), so the modal
  starts fully functional; the picker chrome just does not render.
- **D-18: The picker reappears when the host list has 2+ entries** —
  a user who gains a host between modal opens sees the picker on the
  next open. No stale-render.
- **D-19: This is scoped to the Edit Skills modal ONLY.** The sibling
  `GlobalFilesModal.tsx` shares the same host-picker pattern but is
  explicitly OUT of this phase's scope. Applying the same treatment
  there is worth a follow-up but is not part of this phase's diff.

### New backend endpoint
- **D-20: New route: `POST /skills-editor/skill`.** Body:
  `{ hostId: number, skill: string, description: string }`. Handler:
  1. Validate `hostId` (positive integer), `skill` (`isValidSkillName`
     gate — the client's slugification produces something that already
     matches, but re-validate anyway), and `description` (non-empty
     string; length ≤ 4KB after trim).
  2. `resolveHostById(hostId, userId)` for per-user isolation.
  3. `connectOneShot` → `echo $HOME` for the remote HOME resolution.
  4. Compose `skillsRoot = $HOME/.claude/skills` and
     `skillRoot = $skillsRoot/<slug>`; belt-and-suspenders prefix
     assertion (`skillRoot.startsWith(skillsPrefix)`).
  5. `test -d` on `skillRoot`. If exists, return 409 `{ error: "skill
     exists" }`.
  6. `mkdir -p` on `skillRoot`.
  7. Compose `SKILL.md` content per D-06 + D-07 and write via
     `writeMarkdownFileAtomic` (posix-rename per the identity-artifact-reader
     prologue at `identity-artifact-reader.ts:1039-1063`).
  8. Return 200 `{ slug: "<slug>", mtime: <stat-result> }`.
- **D-21: The route inherits the existing STRIDE posture** — 5s SSH
  connect timeout, 5s exec timeout, `authenticateJWT` before
  `express.json({ limit: "32kb" })`, `shellEscape` on every
  user-supplied value, no stderr / remote-path leakage in error
  responses. Same shape as the existing five endpoints in
  `skills-editor.ts`.

### DELETE `/skills-editor/file` update
- **D-22: The existing DELETE `/skills-editor/file` endpoint adds a
  hard-coded reject for `path === "SKILL.md"`.** Return 400
  `{ error: "cannot delete SKILL.md" }`. Placement: immediately after
  the `isSafeRelativePath` gate at `skills-editor.ts:984-987`, so the
  path-safety layer runs first (rejects `../` etc.), and this
  invariant gate runs before any `resolveHostById` call. No SSH cost
  for the rejection.

### Nginx parity
- **D-23: The new POST `/skills-editor/skill` route is served by the
  existing wildcard block for `/skills-editor(/.*)?`** — no new
  location block needed. The Phase 44 nginx block was written with the
  wildcard suffix precisely so extending the router with new sub-paths
  is a zero-config move. Verify by inspecting both `docker/nginx.conf`
  and `docker/nginx-https.conf` for a matching `location
  ~ ^/skills-editor(/.*)?$` block; if either is missing (regression),
  restore parity as part of this phase.

### Frontend API client update
- **D-24: `skills-api.ts` (or wherever `listSkills` / `createSkillFile`
  live) gains a `createSkill(hostId, name, description)` function.**
  Signature returns `Promise<{ slug: string; mtime: number }>`. Same
  error-class pattern as `SkillFileAlreadyExistsError` — a new
  `SkillAlreadyExistsError` class for the 409 branch; generic `Error`
  for network / 500 / 502.
- **D-25: The modal's `SkillsEditorModal.tsx` gains a
  `handleNewSkill` callback** that runs the chained prompts, calls
  `createSkill`, refetches the skills list on success, and calls
  `setSelectedSkillName(newSlug)`. Failure surfaces via `window.alert`
  matching the `handleAddFile` pattern for consistency.

### Testing
- **D-26: Backend tests for the new POST `/skills-editor/skill`** cover:
  happy path (200 with slug + mtime), duplicate (409), invalid skill
  name (400), empty description (400), overlength description (400),
  path escape / regex-bypass attempts (400), missing SSH host (404),
  SSH connect failure (502).
- **D-27: Backend tests for the DELETE `/skills-editor/file`
  `SKILL.md` guard** verify: 400 with the correct error string, no SSH
  connection opened (assertion on `connectOneShot` mock), other paths
  (`SKILL.md.bak`, `nested/SKILL.md`) still delete normally.
- **D-28: Frontend `SkillsEditorModal.test.tsx` tests** cover: `+ New
  skill` button visibility (present when host picked, hidden when
  host is null), chained-prompt flow (name → description → API call),
  cancellation on first / second prompt (no API call, no state
  change), empty-description re-prompt (does not clear typed name),
  auto-select on success, `+ New file` tab position (last child of tab
  strip), `+ New file` tab click does NOT change `activeTab`, single-host
  hides picker, multi-host shows picker, `SKILL.md` tab has no delete
  affordance.
- **D-29: Scoped-test discipline applies.** Executor runs
  `npx vitest related --run <touched files>` as the green gate; full
  `npx vitest run` + playwright smoke are the DEPLOY gate, run by the
  orchestrator immediately before `docker build`, not by the executor
  (see role file § Test discipline).

### Claude's Discretion
- Exact TypeScript signature and naming for `SkillAlreadyExistsError` /
  `createSkill` in `skills-api.ts` — mirror the existing
  `SkillFileAlreadyExistsError` shape.
- The `Plus` icon size and gap inside the `+ New file` tab — the
  starting values are picked to match `FileText` at size 18 and the
  `text-[10px]` label size that file-path labels use; planner /
  executor may tune by 1-2 px if needed for optical balance.
- Whether the `+ New skill` button uses the same
  `bg-[hsla(220,80%,60%,0.20)]` primary-accent style as the old `+ Add
  file` button (probably yes — visual continuity for the "add a thing"
  affordance shape).
- Slug-collision handling in the client-side slugify: if the user's
  raw input contains multiple runs of hyphens after stripping (e.g.,
  "hello  --  world" → "hello----world"), collapse consecutive hyphens
  to a single one before length-capping.
- Whether to add the `+ New file` tab to the ARIA tab-role structure or
  keep it as a `<button>` styled to visually match the tabs. A plain
  `<button>` is simpler and more honest about its "action" nature —
  recommended.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase agreement (the load-bearing spec — read this first)
- `.planning/shapes/shape-skill-creation-in-edit-skills-modal.md` —
  The shape file agreed at `/open`. Locks the WHAT, the philosophy, the
  what-would-make-it-wrong list, and the scope edges. Every decision
  above traces back to a section here.

### Existing Phase 44 (SKILLED) — the load-bearing prior art
- `src/backend/database/routes/skills-editor.ts` — the existing
  router with the 5 endpoints this phase extends. The prologue comment
  (lines 1-63) documents the STRIDE posture and endpoint shapes; the
  scope note at line 881-894 explicitly names skill-creation as
  out-of-scope for that phase and is what this phase supersedes.
- `src/ui/features/pretty-view/SkillsEditorModal.tsx` — the modal
  being extended. Header structure (lines 402-514), tab strip
  (lines 586-633), delete-file confirm (639-663), delete-skill
  confirm (666-692), `handleAddFile` reference implementation
  (280-306) that `handleNewSkill` and `handleAddFile` (retained) both
  mirror.
- `src/ui/features/pretty-view/SkillFileTab.tsx` — the tab body
  component whose delete affordance needs the `SKILL.md`-gate.
- `src/ui/features/pretty-view/GlobalFilesModal.tsx` — the byte-shape
  sibling. Referenced for the host-picker chrome pattern (D-17-D-19),
  the overlay + z-index ladder, and the modal-in-modal confirmation
  pattern that any new dialog inherits.

### Backend infrastructure
- `src/backend/claude-session/identity-artifact-reader.ts:1039-1063` —
  the prologue for `writeMarkdownFileAtomic` and the
  `ext_openssh_rename` EEXIST trap. The seed `SKILL.md` write uses this
  helper.
- `src/backend/ssh/ssh-one-shot.ts` — `connectOneShot` used by every
  route in `skills-editor.ts`.
- `src/backend/ssh/host-resolver.ts` — `resolveHostById` for per-user
  host isolation.

### Nginx
- `docker/nginx.conf` — HTTP-side nginx config. Contains the existing
  `location ~ ^/skills-editor(/.*)?$` block from Phase 44 (patch #446).
- `docker/nginx-https.conf` — HTTPS-side nginx config. Same block
  MUST be present; the phase includes a verification step.

### Frontend API client
- `src/ui/api/skills-api.ts` (path inferred from the modal's imports at
  `SkillsEditorModal.tsx:8-20`) — the current home of `listSkills`,
  `enumerateSkillFiles`, `readSkillFile`, `writeSkillFile`,
  `createSkillFile`, `deleteSkillFile`, `deleteSkill`,
  `SkillFileMtimeConflictError`, `SkillFileAlreadyExistsError`. Add
  `createSkill` + `SkillAlreadyExistsError` here.

### Role file directives — apply throughout
- `~/fleet/roles/box-maintainer/box-maintainer.md` — § Test discipline
  (scoped-during-dev, full-suite-only-at-ship); § Container mutations
  serialize (Ashley coordinates deploy manually); § Never use worktrees;
  § Executor deploy scope (code + commit + tests green, ship is
  orchestrator-owned); § Multi-identity git pull --rebase before push.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`isValidSkillName`, `isSafeRelativePath`, `shellEscape`,
  `execWithTimeout`, `buildAbsSkillFilePath`** — all in
  `skills-editor.ts` lines 119-237. The new route reuses them verbatim.
- **`writeMarkdownFileAtomic`** in `identity-artifact-reader.ts` — the
  atomic-write helper used by the existing PUT `/write` (line 747).
  Same helper composes the seed `SKILL.md`.
- **`SkillFileAlreadyExistsError`** at `skills-api.ts` — the pattern
  the new `SkillAlreadyExistsError` mirrors.
- **`DeleteConfirmDialog`** at
  `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` — not needed
  by this phase (the new-skill flow uses `window.prompt`), but noted
  for consistency; the shape-file explicitly deferred an upgrade to a
  proper mini-dialog.

### Established Patterns
- **Chained UI feedback via `window.prompt` / `window.alert`** — the
  existing `+ Add file` at `SkillsEditorModal.tsx:280-306` establishes
  this UX register. `+ New skill` matches.
- **Auto-select on success** — pattern seen at
  `SkillsEditorModal.tsx:291` (`setActiveTab(relPath)` after file
  create) and `SkillsEditorModal.tsx:124` (`setSelectedHostId(...)`
  on single-host mount). `handleNewSkill` uses the same shape:
  `setSelectedSkillName(newSlug)`.
- **STRIDE 5-layer route pattern** — every existing route in
  `skills-editor.ts` follows body-validate → resolveHostById →
  connectOneShot → echo-$HOME → compose+assert → SFTP/exec. The new
  route uses the same pattern verbatim.
- **Body parser AFTER auth middleware** — `authenticateJWT` is
  placed before `express.json` on every write route
  (`skills-editor.ts:466, 612, 803, 961, 1084`) so unauthenticated
  callers don't trigger the body parser. New route follows.

### Integration Points
- **`SkillsEditorModal.tsx` header** — header rendering block at
  lines 404-514 changes: `+ Add file` button (lines 462-469)
  disappears; `+ New skill` button appears between skill picker and
  delete-skill trash. Host picker (lines 413-427) gets a
  `flatHosts.length > 1` conditional.
- **`SkillsEditorModal.tsx` tab strip** — tab rendering block at
  lines 586-633 changes: the `.map(files.data ...)` remains; a new
  `<button>` styled as a tab is appended after the map, always as
  the last child.
- **`SkillsEditorModal.tsx` empty-file-list branch** — line 550-556
  copy is repointed at `+ New file`.
- **`SkillFileTab.tsx`** — the delete affordance (whatever prop /
  button surfaces it) becomes conditional on
  `file.path !== "SKILL.md"`. The exact location depends on the
  component's internals; planner reads first.
- **`skills-editor.ts`** — new router.post handler between line 949
  (end of POST `/create`) and line 951 (start of DELETE `/file`);
  new invariant check inside DELETE `/file` (line 984-987 region).
- **NO changes to** `PrettyView.tsx`, `PrettyConversationsPanel.tsx`,
  the docker-compose file, any file under `src/backend/database/` other
  than `skills-editor.ts` and its unit tests, `docker/Dockerfile`, or
  the `skynet-data` volume schema.

### Nginx trap
- **Phase 44 patch #446 arc** — both `docker/nginx.conf` and
  `docker/nginx-https.conf` must carry the `/skills-editor` location
  block for the routes to resolve. The current block uses a wildcard
  `(/.*)?` suffix so extending the router with a new sub-path is a
  zero-config move — verify both configs still have the block before
  declaring the phase done.

</code_context>

<specifics>
## Specific Ideas

- **Silent slugification means the user thinks in human words, the
  filesystem gets a machine name, and neither surface has to translate.**
  If the user types "My First Skill" and the server returns slug
  "my-first-skill", the picker just shows "my-first-skill" — no
  in-between step, no confirmation dialog. This is the load-bearing
  ergonomic call.
- **Chained `window.prompt` is on purpose.** A mini-dialog is nicer
  but consistency with `+ Add file` matters more right now; a follow-up
  polish pass can upgrade both flows together.
- **The `+ New file` tab is deliberately not a tab in ARIA terms** —
  it's a `<button>` styled to match. Honest UX: it's an action, not a
  selection.

</specifics>

<deferred>
## Deferred Ideas

- **Renaming a skill.** Not this phase. Would need a rename endpoint
  and UI affordance.
- **Cloning / duplicating a skill.** Not this phase.
- **Template starter picker for new skills.** The seed is a bare
  frontmatter block only; a template picker (choose "runbook / hook /
  utility") is a future beat.
- **Any marketplace / import / share flow.** Explicitly out.
- **Retroactive migration of existing SKILL.md-less skills.** Forward-only
  invariant is what this phase enforces; legacy skills are left alone.
- **Extending single-host-hides-picker to the sibling
  `GlobalFilesModal`.** Same treatment would apply cleanly but is
  scoped as a follow-up.
- **Upgrading the chained `window.prompt` to a proper mini-dialog**
  for BOTH `+ New skill` and `+ New file`. Consistency matters more
  than polish right now; a joint upgrade in a future phase is the
  right shape.
- **Any change to the sibling `GlobalFilesModal`.** Its host-picker
  chrome, its `+ Add file` in the header, its whole surface — untouched.

</deferred>

---

*Phase: 113-skill-creation-in-the-edit-skills-modal*
*Context gathered: 2026-09-17*
