# Phase 84: Create-role modal UX pass — Context

**Gathered:** 2026-09-07
**Status:** Ready for planning
**Source:** In-session `/build feature-mode` → `/open` shape lock 2026-09-07 (greenlit `thumbs up` same session). Bounty `create-role-modal-ux-pass` (pinned by Ashley 2026-09-07, item 1 of 7 in the UX-pass campaign). Shape file: `.planning/shapes/shape-create-role-modal-ux-pass.md`.

<domain>
## Phase Boundary

Tighten the "create a new role" dialog and align its sibling "create a new agent" dialog's title as a paired coherence tweak. Eight surface changes on one dialog + one paired title tweak on a second + a shared "single-host → hide the picker" primitive callable from both. Item 1 of a 7-bounty UX-pass string covering both dialogs, the clone dialog, the identity modal, the composebox, and a new runbooks concept.

Phase-scoped narrowly: only the create-role dialog changes end-to-end here; the create-agent dialog gets ONLY the title tweak (the rest of its overhaul lives in the next bounty). The shared host-picker primitive is built here (used by both dialogs) so the next bounty gets it for free.

</domain>

<decisions>
## Implementation Decisions

### The eight surface changes (LOCKED — from shape file § Shape)

1. **Header blurb added** to the create-role dialog.
   - **Draft copy (LOCKED for planning; user may redirect during execute):**
     > "A role is what an agent does and how it thinks — many agents can share one."
   - Constraints (LOCKED per shape file § Philosophy): one short sentence; product-language framing (not "template"/"instance"); paired vocabulary with the future create-agent blurb (that lands in the create-agent bounty — draft carried forward there: *"An agent is one specific worker doing a role, with its own name and history."*).
   - Placement: immediately below the modal title, above the fields. Same visual weight as any small subtitle already in the dialog.

2. **"These fields are required" caption removed** entirely from the dialog body. The fields themselves already signal required state.

3. **"Then create an identity with this role" checkbox removed** entirely from DOM — NOT hidden via CSS or `display:none`. The checkbox, its label, its `checked` state, and its wiring are deleted.

4. **Primary button always advances to the create-agent dialog on success** — no branching, no gating. Success = successful POST /roles round-trip returning 201.

5. **Pre-fill carry into create-agent modal.**
   - Role name and role description carry into the create-agent modal (visible in the corresponding fields there).
   - Mechanism (LOCKED): reuse the existing `onChainToCreateIdentity({role, host, description})` callback pattern; the current gate on the checkbox is removed and the callback is invoked unconditionally on success.

6. **Create-role modal title conforms to its dropdown label.**
   - Current: title reads `"Create a role"` (i18n `nav.createRoleTitle` defaultValue).
   - Change to: `"New role"` (matches the dropdown item's label at `PrettyConversationsPanel.tsx:2037`).
   - Implementation (LOCKED): change the `defaultValue` in the existing `t("nav.createRoleTitle", { defaultValue: "New role" })` call. Do NOT create a new key. Existing translations remain valid (they'd say "Create a role" until re-translated, which the fleet is fine with — the source-of-truth locale is English).

7. **Create-agent modal title conforms to its dropdown label** (paired tweak, sibling dialog).
   - Current: title reads `"Start a new agent"` (i18n `nav.newSessionTitle` defaultValue in `NewSessionDialog.tsx:846`).
   - Change to: `"New agent"` (matches the dropdown item's label at `PrettyConversationsPanel.tsx:2036`).
   - Same in-place `defaultValue` change; no new key.

8. **Host picker hidden when user has exactly one pickable host** — shared primitive.
   - Applied to BOTH dialogs (create-role and create-agent) as part of this phase — since the primitive is shared and small, it lands once here and the create-agent bounty inherits it.
   - Detection (LOCKED): total pickable-host count in the flattened `hostTree` (via `collectAllHosts`) === 1. No admin-caveat, no per-flow filtering.
   - When hidden: the single host is auto-picked as the value; neither the list nor the search box renders. The label/heading for the host section can render as normal or be omitted — planner's discretion; user-facing effect matches (no picker chrome, host auto-selected).

### Escape-hatch behavior (LOCKED — preserved)

- If a user Escapes or clicks-away in the create-agent dialog AFTER a role was successfully created:
  - The role STAYS committed (already on disk, endpoint returned 201).
  - No rollback. No undo prompt.
  - The user can create an agent under that role later via the "New agent" dropdown item (which the sibling dialog already handles).
- This is the same behavior the current dialog exhibits when the checkbox is unchecked; only difference is the checkbox is gone so the escape-hatch state is reachable only via user cancel, not via a checkbox choice.

### Copy-guard (locked)

- Any user-visible string changes touch ONLY the i18n `defaultValue` in place. No new i18n keys created; no restructure of the translation vocabulary.
- Removed strings (required-caption, checkbox label) are DELETED from source (their `t()` calls, corresponding hardcoded fallbacks, and any related aria-labels) — not just disconnected.

### Test discipline (per campaign constraint — Ashley 2026-09-07)

- Full suite (`npx vitest run`) does NOT run during this phase's execute step. Scoped runs only (`--related` on touched files, or targeted paths under `src/ui/sidebar/` + `src/ui/features/pretty-conversations/`).
- `git push` IS authorized as the terminal step of this phase's execute (per campaign constraint: "farthest you'll get is pushing changes to remote and running scoped tests").
- No `docker build`. No `docker cp` fast-path. No `docker compose up --force-recreate`. No coord-room ship posts (there is no ship).
- Every push still `git pull --rebase origin feat/tab-title-from-tmux` first (multi-identity rule).

</decisions>

<code_context>
## Reusable Assets Found (from scout)

**Create-role dialog:** `src/ui/sidebar/CreateRoleDialog.tsx` (402 lines).
- Has the `onChainToCreateIdentity({role, host, description})` callback wired at existing chain-hook site (added in Phase 22 SRIC-05).
- Uses `collectAllHosts(hostTree.children)` for host flattening (L55-64 in that file — same pattern as NewSessionDialog).
- I18n title at L212 (`nav.createRoleTitle` defaultValue `"Create a role"`).
- Uses `POST /roles` via `createRole` from `identities-api.ts` (see L44 import + L46 usage).

**Create-agent (new session) dialog:** `src/ui/sidebar/NewSessionDialog.tsx` (1382 lines).
- I18n title at L846 (`nav.newSessionTitle` defaultValue `"Start a new agent"`).
- Same `collectAllHosts` host-flatten pattern (per CreateRoleDialog's comment noting duplication).

**Dropdown source-of-truth labels:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2036-2037` — labels `"New agent"` and `"New role"`. These do NOT change in this phase (they're the anchor the modal titles conform to).

**Test files worth touching (scoped tests):**
- `src/ui/sidebar/CreateRoleDialog.test.tsx` — existing suite for create-role.
- `src/ui/sidebar/NewSessionDialog.test.tsx` — existing suite for the sibling dialog.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` — clicks through the dropdown → dialog flow.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — currently asserts `"Start a new agent"` title text at Test 5 (L1297); needs update to `"New agent"`.

**Prior phase precedent for i18n `defaultValue` edits without new key creation:** widespread throughout the codebase; no ADR required.

**No shared host-count utility exists today.** The primitive built in this phase is likely a small helper (e.g., `useHostCount(hostTree)` or an inlined `collectAllHosts(...).length === 1` check) — planner's choice. Both dialogs already import `collectAllHosts` so the addition surface is small.
</code_context>

<canonical_refs>
## Canonical References

Full relative paths — required reading for downstream agents:

- **Shape agreement (source of truth for scope conformance at `/close`):** `.planning/shapes/shape-create-role-modal-ux-pass.md`
- **Bounty record + workspace:** `~/.claude/roles/box-maintainer/bounties/create-role-modal-ux-pass/bounty.json`
- **Create-role dialog source:** `src/ui/sidebar/CreateRoleDialog.tsx`
- **Create-agent dialog source:** `src/ui/sidebar/NewSessionDialog.tsx`
- **Dropdown label site (anchor for title conforms):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2036-2037`
- **Existing create-role dialog tests:** `src/ui/sidebar/CreateRoleDialog.test.tsx`, `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx`
- **Existing new-session dialog title test (needs update):** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` Test 5 (L1297)

No external ADRs, specs, or PRDs cited by ROADMAP.md for this phase.
</canonical_refs>

<deferred>
## Deferred / Out of Scope

**Deferred to the next bounty (`create-agent-modal-ux-pass`):**
- The create-agent dialog's own header blurb (paired with this one — will land there).
- The rest of the create-agent modal UX changes (role-picker bug fix on direct-landing, path field admin-only + non-admin `~/<agent-name>/` default, "Create with new identity" checkbox admin/non-admin split, "brief" → "description" rename, TTS speed multiplier, title pre-fill from role name un-slugified).

**Deferred to later bounties in the campaign:**
- Clone modal UX pass (`clone-modal-ux-pass`).
- Identity modal tab restructure (`identity-modal-tab-restructure`) — depends on `runbooks-formal-concept`.
- Runbooks formal concept (`runbooks-formal-concept`).
- Composebox buttons + queue tab redesign (`composebox-buttons-and-queue-tab-redesign`).
- Global-file agents-may-edit-on-permission fleet directive (`global-file-agents-may-edit-on-permission`).

**Tempting-but-no (out of scope for this phase, per shape file § Scope edges):**
- Renaming the underlying modal components in code (`CreateRoleDialog` / `NewSessionDialog`) — naming refactor is off-scope; only user-visible labels change.
- Adding cancel/back affordances to the create-role → create-agent handoff — escape-hatch behavior already covers it.
- Changing required-fields validation itself (only the caption reminding-you-it's-required goes away).
- Extracting `collectAllHosts` into a shared utility (scope-creep noted in CreateRoleDialog.tsx L48; leave for a future refactor phase).
- Changing dropdown labels themselves (they're the source of truth in this bounty).
- Localization of the new blurb text (English defaultValue only; downstream translators pick it up on their normal cadence).

**Non-goal:** any change that would cause a role to be created BEFORE the create-agent handoff completes to succeed differently than it does today. The atomic-role-creation-then-optional-agent shape is preserved.

</deferred>

<campaign_notes>
## Campaign Context (7-bounty UX-pass string)

Ashley 2026-09-07 verbatim on the campaign constraint:
> "the farthest you'll get amongst any of this is pushing changes to remote and running scoped tests, but we're not going to be running the full test suite we're not going to be rebuilding we're not going to be deploying until we're done."

Consequences enforced in this phase:
- Execute step runs scoped tests only (`--related <files>` or targeted paths).
- Phase ends at push. No `docker build`, no `docker compose up`, no `docker cp`, no full-suite gate.
- No coord-room BEFORE/AFTER posts (there is no ship; the pushes go without coord posts per Ashley 2026-09-05 push-only rule).
- Every push runs `git pull --rebase origin feat/tab-title-from-tmux` first (multi-identity rule).
- Ride-along ships: a peer's future `--force-recreate` may pick up my commits from origin. Ashley knows and has explicitly authorized this shape.

Bounty pool for the campaign (all pinned in `~/.claude/roles/box-maintainer/bounties/`):
1. `create-role-modal-ux-pass` ← this phase
2. `create-agent-modal-ux-pass`
3. `clone-modal-ux-pass`
4. `identity-modal-tab-restructure` (depends on 6)
5. `composebox-buttons-and-queue-tab-redesign`
6. `runbooks-formal-concept`
7. `global-file-agents-may-edit-on-permission`

</campaign_notes>
