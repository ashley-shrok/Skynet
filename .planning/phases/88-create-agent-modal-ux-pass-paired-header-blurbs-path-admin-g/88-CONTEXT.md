# Phase 88: Create-agent modal UX pass — Context

**Gathered:** 2026-09-08
**Status:** Ready for planning
**Source:** In-session `/build feature-mode` continuation of a `/open` shape locked 2026-09-07 (greenlit `thumbs up` same session, alongside the parent cosmetics-migration /open). Bounty `create-agent-modal-ux-pass` (pinned by Ashley 2026-09-07, item 3 in the reordered UX-pass campaign — upstream dependency `cosmetics-migrate-to-role` shipped 2026-09-08 as Phase 86, unblocking this bounty). Shape file: `.planning/shapes/shape-create-agent-modal-ux-pass.md`. On this run of `/build`, Ashley greenlit skipping `/gsd:discuss-phase` — shape has verbatim copy, exact file:line targets, Phase 84 admin-gate pattern to mirror; nothing left to elicit.

<domain>
## Phase Boundary

A polish pass on the create-agent modal (`NewSessionDialog.tsx`) paired with a matching blurb revision on the create-role modal (`CreateRoleDialog.tsx`). Three shipping surfaces plus a prop-plumb + a backend default-substitution:

1. **Paired 2-sentence header blurbs.** Revise the Phase-84-shipped one-sentence role blurb to a new 2-sentence form; add the sibling agent blurb to the create-agent modal. Vocabulary paired around the verb "adopt."
2. **Path field admin-gate.** Admin sees + defaults to `~/`; non-admin never sees the field and the birth backend substitutes `~/<agent-name>/` for absent/empty path.
3. **Identity-mode checkbox admin-gate + label inversion.** Admin-only; label flips from "Create with new identity" to "Just a shell — no agent"; default `useState(true)` flips to `false`; fail-closed `isAdmin=false` default on the dialog prop.
4. **Prop-plumb `isAdmin`** from `PrettyConversationsPanel` (already a prop there with a fail-closed `= false` default at L285, used at L1651 for `<WeeklyUsageMeter />`) into `NewSessionDialog`.
5. **Backend birth endpoint** accepts absent/empty path in the create-session payload and substitutes `~/<agent-name>/` — OR frontend fills in the default before submit. Planner picks front vs back; shape is agnostic (§Scope edges: "executor decides").

**What Phase 86 already landed for this bounty (do NOT re-do):** cosmetic pickers (color/voice/avatar), Title field, and Brief field are all already stripped from `NewSessionDialog.tsx` (Plan 86-04 commit `5ab32b25`). Those todos on the bounty JSON are already `done: true`.

</domain>

<decisions>
## Implementation Decisions (LOCKED — from shape file)

### Verbatim copy for the header blurbs

- **Role blurb (REVISE `CreateRoleDialog.tsx:527-529`):** *"Roles are the expertise your agents adopt. Every agent using this role inherits its goals, rules, and knowledge."*
- **Agent blurb (ADD to `NewSessionDialog.tsx:816-819`):** *"Agents are the workers you chat with. Each one adopts a role that shapes what they know and how they help."*

Shared verb: **"adopt"** — deliberately paired. Both blurbs go in `<DialogDescription>` slots inside `<DialogHeader>`.

### Verbatim label for the identity-mode checkbox (flipped semantics)

- **Old label** at `NewSessionDialog.tsx:958`: *"Create with new identity"* (checkbox default checked).
- **New label:** *"Just a shell — no agent"* (checkbox default UNCHECKED).
- Ashley greenlit that exact wording during /open (shape §Tempting-but-no: "Ashley greenlit that specific text").

### Path field admin-gate

- File: `src/ui/sidebar/NewSessionDialog.tsx:926-942`.
- Admin: field renders as today (label "Path", input placeholder "~/", default value `useState("~/")` at L322).
- Non-admin: field does NOT render at all.
- Non-admin default: `~/<agent-name>/` substituted at birth time. Where the substitution happens (frontend fills before submit, or backend substitutes when payload has empty/absent path) is planner's call — shape defers it.
- **Fail-closed:** when `isAdmin` prop is not passed, treat as `false` (non-admin) — matches Phase 84's `CreateRoleDialog` and `PrettyConversationsPanel` L285 pattern.

### Identity-mode checkbox admin-gate + inversion

- File: `src/ui/sidebar/NewSessionDialog.tsx:944-960`.
- Admin sees checkbox; label = "Just a shell — no agent"; default unchecked.
- Non-admin: checkbox does NOT render at all; user is always spawning an agent (never a raw shell).
- State variable `identityMode` (currently `useState(true)` at L326): default flips to `false`. Semantics also flip — the checkbox NOW represents "opt out of identity mode into raw shell," where BEFORE it represented "opt in to identity mode from raw shell default."
- **Variable rename or comment invariant (shape §What would make it wrong item #5):** The state var name is `identityMode` which historically meant "checkbox is checked = identity mode ON." After the inversion, `identityMode: false = checkbox unchecked = agent (default)`, `identityMode: true = checkbox checked = shell (opt-out)`. Executor MUST either rename the variable (candidates: `shellOnly`, `isRawShell`, `agentDisabled`) OR add a header comment locking the new invariant. Semantic drift trap is the concern; renaming is cleaner.
- **Non-admin invariant:** when `isAdmin=false`, `identityMode` at submit time MUST resolve as if agent mode is on (checkbox never shown = user can't opt out). Enforce in the submit path, not just via the render gate — defense-in-depth.

### `isAdmin` prop plumbing (fail-closed)

- Source: `PrettyConversationsPanel.tsx:285` already accepts `isAdmin = false` prop.
- Destination: `NewSessionDialog.tsx` — add `isAdmin?: boolean = false` prop; forward from panel's `<NewSessionDialog>` call site (grep for where it's rendered in the panel).
- **Default `false`** at prop destructuring. If some future caller forgets to pass it, non-admin behavior kicks in — that's the safe direction.

### Backend birth endpoint change

- Today the create-session endpoint expects `path` as a required non-empty string (frontend sets default `~/` via `useState("~/")` at L322 + `normalizePath` at L97).
- New contract: accept empty/absent `path` in the payload, and when so, server-side substitute `~/<agent-name>/` where `<agent-name>` is the identity's `name` (kebab-case) already in the same payload.
- Alternative shape (planner's choice): frontend always sends a filled `path` — when non-admin (no field visible), frontend computes `~/<name>/` from the name field before submit. Backend stays unchanged. This keeps the wire contract identical and localizes the change to the frontend.
- **Both shapes are equivalent for the user-visible behavior.** Planner picks based on test-surface simplicity + which side already owns similar defaulting.

</decisions>

<prior_context>
## Prior context

### Phase 84 (create-role-modal-ux-pass, shipped 2026-09-07 as commit `dfa5929e`)

Phase 84 established the sibling patterns this bounty pairs against:

- **Header blurb pattern** at `CreateRoleDialog.tsx:527-529` — the exact slot to revise. Current text: *"A role is what an agent does and how it thinks — many agents can share one."*
- **Admin gating** — `PrettyConversationsPanel.tsx:285` already carries `isAdmin = false` prop (fail-closed default), used at L1651 for `<WeeklyUsageMeter />`. Phase 84 did NOT add admin-gating to `CreateRoleDialog` because the role modal is admin-only-visible upstream anyway; this bounty is the first to introduce admin-gating INSIDE a modal.
- **Single-host hide-primitive** shipped in Phase 84 already handles the flatHosts-length-1 case in both modals (see `NewSessionDialog.tsx:835`).

### Phase 86 (cosmetics-migrate-to-role, shipped 2026-09-08)

- Removed the cosmetic pickers, Title, and Brief fields from `NewSessionDialog`. So the modal today (Phase 86 HEAD) is already lean — only host list, name, path, checkbox, role picker remain.
- Reordering: Ashley's 2026-09-07 delegation to tabitha *"you're in charge of making sure that we continue with the plan and these bounties go in the right order"* stands. Phase 86 was the upstream that had to land first for the modal removals in that phase; this bounty (Phase 88) is now unblocked.

### Bounty JSON state

`~/.claude/roles/box-maintainer/bounties/create-agent-modal-ux-pass/bounty.json` shows 4 SHIPPING todos remaining + 6 already-done/dissolved. The 4 remaining match this phase's four surface changes 1-2-3-4.

</prior_context>

<scope>
## Scope edges (LOCKED — from shape file)

### In

- `CreateRoleDialog.tsx` blurb text revision at L527-529 (single-sentence → 2-sentence).
- `NewSessionDialog.tsx` changes:
  - Add 2-sentence header blurb to `<DialogDescription>` at L816-819 (currently just `{startDescription}` i18n key — replace or extend with the new copy).
  - Admin-gate the Path field render at L926-942.
  - Admin-gate the identity-mode checkbox render at L944-960.
  - Flip checkbox label to "Just a shell — no agent" (or wrap in i18n key).
  - Flip `identityMode` default at L326 from `true` to `false`.
  - Rename `identityMode` variable OR add invariant comment (executor's call).
  - Enforce non-admin agent-mode invariant at submit path (not just render gate).
  - Add `isAdmin?: boolean = false` prop.
- `PrettyConversationsPanel.tsx` — forward `isAdmin` prop to `<NewSessionDialog>` at whichever call site renders it.
- Backend birth endpoint OR frontend submit path — accept absent/empty path and substitute `~/<agent-name>/` for non-admin. Planner picks side.
- Tests updated:
  - `NewSessionDialog.test.tsx` — checkbox default-unchecked + admin-conditional-render + label text.
  - `NewSessionDialog.role-dropdown.test.tsx` / `.chain.test.tsx` — audit for `identityMode` default assumptions that may now be flipped.
  - New test: `NewSessionDialog` renders with `isAdmin={false}` (default) has NO Path field + NO checkbox visible.
  - New test: `NewSessionDialog` with `isAdmin={true}` renders both, defaults match spec.
  - New test: submit path with `isAdmin={false}` + absent path in state → payload substitutes `~/<agent-name>/` (front OR back, wherever substitution lands).
  - `CreateRoleDialog.test.tsx` — audit for blurb text assertion; update to new text.

### Out (moved to other bounties)

- Cosmetics migration (Phase 86, DONE).
- TTS speed multiplier — own bounty `tts-speed-multiplier-per-instance`.
- Working-directory auto-creation timing (whether backend `mkdir`s at birth vs lazy on first write) — whatever current behavior is, stays.
- Task-input textarea (already added in Phase 80).
- Any rename of the modal itself ("New agent" title stays — Phase 84 conformed).
- Making the checkbox label "cleverer" than "Just a shell — no agent" (Ashley greenlit exact text).

### Tempting-but-no

- Adding a per-agent "description" or "notes" field to replace removed Brief. Not asked; separate bounty if needed later.
- Adding an "Override cosmetics for this identity" affordance on create-agent. Post-cosmetics-migration, per-identity overrides happen via the identity modal after creation; create-agent stays lean.

</scope>

<risks>
## What would make it wrong (from shape §What would make it wrong)

- **Ship agent blurb without revising role blurb.** Phase 84's one-sentence blurb + this bounty's 2-sentence blurb side-by-side is visible inconsistency to any user opening both. Both blurbs MUST land in the same commit (or contiguous commits, one deploy).
- **Non-admin sees the "Just a shell" checkbox.** Leaked shell access to non-admin users. Fail-closed default `isAdmin=false` on the dialog prop is the guard; submit-path invariant is defense-in-depth.
- **Non-admin sees the Path field.** Same asymmetric risk — non-admins configuring their own path defeats "each agent gets its own working directory" scoping.
- **`identityMode` semantics-vs-UI drift.** Keeping the variable name `identityMode` but flipping the checkbox default without renaming or explicit comment creates a permanent trap where `identityMode === true` sometimes means "checkbox checked" and sometimes means "identity mode active" depending on which end of the code you're reading. Executor MUST resolve.
- **This bounty ships BEFORE cosmetics-migrate-to-role.** Already satisfied — Phase 86 shipped 2026-09-08.

</risks>

<constraints>
## Execution constraints (fleet + campaign rules)

- **Campaign constraint (Ashley 2026-09-07):** push + scoped tests only, no full suite, no docker build, no docker cp, no `docker compose up --force-recreate`, no deploy — until entire remaining UX-pass campaign lands + Ashley greenlights ship.
- **/build pipeline ends at push** for this bounty. Post-push: unbiased general-purpose subagent code review → apply findings → `/close create-agent-modal-ux-pass` → `/id reset` → next bounty (item 4: `runbooks-formal-concept`).
- **Scoped tests only for the executor's green gate** per fleet 2026-08-20 rule (`--related <changed-files>` or targeted paths under `src/ui/sidebar/` + `src/backend/` if backend touched).
- **No worktrees** per fleet 2026-07-31 rule. Work happens on `~/skynet-tabitha` on branch `feat/tab-title-from-tmux`.
- **Executor's remit stops at code + commit + tests green** per fleet 2026-08-08 rule. No push, no build, no deploy — orchestrator (tabitha) picks up push after executor returns green.
- **`git pull --rebase origin feat/tab-title-from-tmux`** before every push — tina landed `d9d81e3d`, then `8f5d2a70` (terminal-render-broken hotfix) during this session, and further hotfixes may land while phase executes. Rebase at push time.

</constraints>

<vehicle_notes>
## Vehicle notes

- **Vehicle:** GSD phase (Phase 88).
- **Discuss-phase:** SKIPPED per Ashley greenlight this session ("straightforward enough that we don't have to discuss"). Shape has verbatim copy, exact file:line targets, admin-gate pattern from Phase 84 to mirror.
- **Plan-phase:** next step. Seed from this CONTEXT.md + the shape file.
- **Execute-phase:** wave/task structure at planner's discretion. Roughly 3-5 tasks fit: (1) prop plumb + fail-closed default, (2) blurb revise + add pair, (3) Path admin-gate, (4) checkbox admin-gate + label flip + default flip + invariant fix, (5) backend/frontend path-default substitution + submit-invariant enforcement. Planner may fold some together (e.g. steps 3-4-5 all inside `NewSessionDialog.tsx` — they overlap in file surface).
- **Post-execute (orchestrator, tabitha):** unbiased general-purpose subagent code review → apply findings inline → `/close create-agent-modal-ux-pass` → `/id reset`.

</vehicle_notes>
