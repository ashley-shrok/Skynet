# Phase 133: Role archival - Context

**Gathered:** 2026-09-24
**Status:** Ready for planning

**Seeded from:** `.planning/shapes/shape-role-archival.md` (via `/build` → `/open`, greenlit 2026-09-24 after 5-round grill). Downstream agents SHOULD read the shape file for the full conceptual narrative — this CONTEXT.md translates the locked decisions into planning-ready form.

<domain>
## Phase Boundary

Add the missing "retire a role" gesture to Skynet. Today, when a role is no longer needed, there is nothing an operator can do about it — the role folder just sits at `~/fleet/roles/<name>/` forever, along with every identity that ever held the role, even after the reason for the role is long gone. This phase delivers: (a) a single operator gesture in the Skynet UI that archives a role, (b) an HTTP endpoint that receives it, (c) a supervisor-side scanner that consumes the sentinel and executes the cascade (retire every identity currently holding the role, then move the role folder to `~/fleet/roles-archive/<name>/`), and (d) a refactor of the existing identity retirement machinery to use inline per-step retries in place of the current cross-tick fail-counter + retire-stuck-sentinel mechanism, so both the new role cascade path and the existing user-initiated identity archive path share the clean semantic.
</domain>

<decisions>
## Implementation Decisions

### Trigger + UI
- **D-01:** Trigger is a **single operator gesture** — one click that produces one sentinel drop; cascade complexity lives entirely inside the supervisor. Do NOT fan out sentinels from the frontend.
- **D-02:** Affordance lives as a **right-click context menu item on the `RolesListModal` rows** (the roles-list surface), NOT on the `RoleModal` per-role detail view. Reuses `PrettyConversationContextMenu` (or a close sibling) — same interaction model as every other archival action in the app (identity archive on session pane, conversation archive on row).
- **D-03:** **Double confirmation.** Two sequential native `window.confirm` calls after the menu click.
  - **First dialog:** Lists **every identity that will be cascade-archived**, one line per identity. Each line uses **`identity.task || identity.displayName`** — the same fallback the sidebar uses at `AppShell.tsx:894` (do not special-case "Untitled conversation"). List is **complete, not truncated**, however long it is. When zero identities hold the role, the dialog says so plainly ("archive role X? no identities hold it.").
  - **Second dialog:** Plain "are you sure? this can't be undone." — the sanity tap.
  - Both dialogs must be OK'd to proceed. Cancel at either stops.
- **D-04:** The count + task list is computed **frontend-side** — the `Identity` type at `src/ui/api/identities-api.ts:4` already carries `role: string | null` + `hostId?: number` + `task: string | null`, so a `useIdentities()` filter gives both the count and the ordered task list with no additional RPC.

### Sentinel semantics
- **D-05:** **Sentinel filename: `.archive-requested`** (same as identity), dropped at `~/fleet/roles/<name>/.archive-requested`. Path disambiguates from the identity sentinel — no filename collision because scanners walk different root dirs. Presence-only, empty file. Matches the existing convention.
- **D-06:** **One-shot sentinel.** The sentinel is deleted at the end of the supervisor tick that processes it, **regardless of cascade success or failure**. There is NO cross-tick persistence of the archival intent. On failure the operator retries via the UI (which drops a fresh sentinel).
- **D-07:** **Fresh enumeration each time the scanner processes a sentinel.** The scanner walks `~/fleet/identities/*/*.md` and matches `role:` frontmatter against the role name at scan time. No snapshot stored anywhere.

### Cascade semantics
- **D-08:** **Fail-soft cascade.** The scanner attempts to retire **every** enumerated identity regardless of individual failures. It does not abort after the first failure.
- **D-09:** **Role folder moves ONLY if every enumerated identity retired cleanly.** If any identity retire failed, the role folder stays put in `~/fleet/roles/<name>/`; sentinel is deleted anyway; supervisor logs LOUDLY which identities failed and why (same LOUD `ERROR:` prefix carve-out currently used by identity retire-stuck logging).
- **D-10:** **Guard bypass for cascade identities.** The `.pinned`, `.no-dormancy`, and `coordinator: true` guards that gate the 180-day daily identity sweep are **bypassed** for identities cascaded by a role archival — same reasoning as the existing user-initiated identity archive path already applies. Operator click = intent; guards exist to protect against automated surprises, not deliberate operator action.
- **D-11:** **Retry on failure = operator re-clicks Archive in the UI.** Because the scanner walks the live dir fresh each time, a retry naturally picks up only the identities that weren't already archived (successfully-retired ones are gone from the live tree and get silently skipped).
- **D-12:** **Empty cascade is a degenerate case of the same code path.** If zero identities hold the role at scan time, the cascade phase is a no-op and the folder move happens immediately.

### Refactor of identity retirement
- **D-13:** **Refactor `retire_identity()` to use inline per-step retries** with bounded exponential backoff (3 attempts, 2s/4s/8s per step). Retry granularity is **per-step, not per-retire** — a matrix deactivate hiccup should not force graceful-exit + tmux-kill to re-run.
  - **D-13a (refinement, 2026-09-24 after research):** Inline retries apply **only to steps 1 (matrix deactivate) and 4b (folder move)** — those are the steps with genuine transient-failure surface (network hiccup, filesystem race). Steps 2 (graceful harness exit — already carries an 11s GRACE_WAIT) and 3 (tmux kill — idempotent no-op if session gone) keep single-attempt behavior. Rationale: uniform 3× on all steps would balloon worst-case retire to ~90s per identity, compounding across cascade; applying retries where they help matches D-14's intent ("no cross-tick counters") without ceremony where they don't.
- **D-14:** **Remove the cross-tick failure-count + retire-stuck-sentinel mechanism entirely.** Delete `retire-fail-count-<name>` and `retire-fail-count-user-<name>` counter files in `$DORMANCY_STATE_DIR`. Delete the `retire-stuck` sentinel drop after 3 consecutive failures in both `scan_archive_requested_sentinels()` and `run_archive_scan()`. `retire_identity()` becomes atomic from the caller's perspective — either succeeds outright (having recovered inline from transient failures) or fails terminally in one call, no cross-tick state.
- **D-15:** **Both callers of `retire_identity()` benefit.** The role cascade path (new) and the existing user-initiated identity archive path (`scan_archive_requested_sentinels`) both get the clean inline-retry semantic. The 180-day daily sweep (`run_archive_scan`) also inherits it — the sweep just calls `retire_identity()` in a loop.

### Archive location + content
- **D-16:** **Archive location: `~/fleet/roles-archive/<name>/`** — sibling to `~/fleet/roles/<name>/`, exactly parallel to `~/fleet/identities-archive/`. Convention preserved.
- **D-17:** **Verbatim move, no scrubbing.** Whatever lives in the role folder at the moment of archival (role file, history, runbooks, reference docs, wakeups, bounties, ad-hoc content, and yes any stray credential files) all travels along in the move. Roles should not hold credentials as a hygiene matter, but this archival gesture is not the place to introduce scrubbing.

### Scope
- **D-18:** **Per-box only.** A role and its identities are host-local (id-skill invariant: "Identities and roles are strictly 1:1 with a host"). The archival gesture, sentinel, scanner, and cascade all live on the box holding the role. No cross-box coordination.
- **D-19:** **One-way, no un-archive.** No gesture for restoring an archived role. If needed later, that is a separate future concern.
- **D-20:** **User-initiated only.** No automated role archival (no 180-day dormancy sweep for roles). Strictly triggered by the operator gesture.
- **D-21:** **Old on-disk state from the retired mechanism is left as archaeology.** Do not add cleanup logic for existing `retire-stuck` sentinels in `~/fleet/identities-archive/*/` or existing `retire-fail-count-*` files in `$DORMANCY_STATE_DIR`. The new code simply does not read or write them any more; they remain harmlessly in place on boxes that accumulated them. If a clean sweep is wanted, that is a one-liner the operator can run manually.

### Claude's Discretion
- Exact bash retry-loop shape inside each retire step (inline `for` loop vs helper function) — planner's call.
- Whether to introduce a per-role-file writer primitive as a separate module or extend `writeIdentityFile` to cover role paths — planner's call after checking whether an existing helper already covers the role-folder write path.
- Log format specifics for the LOUD partial-failure message — as long as it names each failed identity + the step that failed + the underlying error, format is the planner's call.
- Bash unit test style + fixture setup for the substrate scanner tests — planner's call, but match the existing convention in `substrate/scripts/tests/*.test.sh`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (load-bearing)
- `.planning/shapes/shape-role-archival.md` — the shape agreement carrying this phase, including the philosophy, "what would make it wrong" failure modes, and scope edges. The single most important reference for this phase.

### Direct prior art (identity archival — the model this shape clones)
- `src/backend/database/routes/identity-archive.ts` — the HTTP route that the new role-archive route mirrors byte-for-byte in shape. Auth + `IDENTITY_KEY_RE` gate + `resolveHostById` + local/remote branch + `writeIdentityFile` sentinel drop. Copy this file's structure and threat register verbatim, substituting role concepts.
- `src/backend/database/routes/identity-archive.test.ts` — the test shape for the route above; new role-archive route tests should mirror.
- `src/backend/claude-session/per-identity-file.ts` — the primitive that writes files into identity folders (used by identity-archive.ts to drop the sentinel). Check whether an analogous role-folder writer exists or needs to be added.
- `src/ui/api/identity-archive-api.ts` — the frontend API wrapper (`archiveIdentity(hostId, key)`); model for the new `archiveRole(hostId, name)`.
- `src/ui/api/identity-archive-api.test.ts` — API-client test shape.
- `src/ui/shell/IdentitySessionPane.tsx` §L192-242 — the identity archive menu item + `window.confirm` copy + fire-and-forget API call shape.

### Substrate — supervisor identity archive machinery (the refactor + cascade caller)
- `substrate/scripts/agent-supervisor.sh` §L590-825 — `retire_identity()` five-step function (matrix deactivate → graceful exit → tmux kill → sentinel delete → workspace cleanup → folder move). This function is refactored per D-13/D-14 and called by the new role cascade per D-15.
- `substrate/scripts/agent-supervisor.sh` §L826-925 — `run_archive_scan()` (180-day daily identity sweep). Retry-counter + retire-stuck-sentinel logic to remove per D-14.
- `substrate/scripts/agent-supervisor.sh` §L928-1000 — `scan_archive_requested_sentinels()` (user-initiated identity archive scanner). Retry-counter + retire-stuck-sentinel logic to remove per D-14. New sibling `scan_role_archive_requested_sentinels()` follows this function's pattern.
- `substrate/scripts/agent-supervisor.sh` §L2327 — reconcile-loop dispatch. New role scanner wires in here.
- `substrate/scripts/tests/` — existing bash test conventions for substrate. New tests for the role scanner + refactored identity retire go here.

### Role UI surfaces
- `src/ui/features/pretty-view/RolesListModal.tsx` — the roles list surface where the new context menu affordance lands (D-02).
- `src/ui/features/pretty-view/PrettyConversationContextMenu.tsx` — the reusable context-menu component (or a close sibling) that the new role archive menu item consumes.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` §L1470 `handleArchive` — reference implementation for the row-context-menu → archive flow.

### Type contracts + fallbacks
- `src/ui/api/identities-api.ts:4-80` — `Identity` interface: `role: string | null`, `hostId?: number`, `task: string | null`. All three fields are present and populated; the frontend has everything needed to compute the cascade preview without a new RPC (D-04).
- `src/ui/AppShell.tsx:882-899` — the sidebar's `identity?.task || identity?.displayName` fallback pattern that the first-confirm dialog copies verbatim (D-03).

### Fleet-substrate + id-skill (docs update destination)
- `substrate/skills/id/SKILL.md` — the identity skill (also the source of the "On archiving an identity" section). New "Archiving a role" section (sibling shape) goes here as part of this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`retire_identity()` in agent-supervisor.sh** — the five-step retire function. Called by the new role cascade for each enumerated identity. Being refactored in this phase (D-13/D-14) to add inline retries and remove cross-tick state.
- **`PrettyConversationContextMenu`** — the right-click menu component. Portal-mounted at cursor coords, dismisses on Escape / click-outside, supports `danger: true` for destructive items. Reused for the new "Archive role" menu item on `RolesListModal` rows.
- **`writeIdentityFile()` in `per-identity-file.ts`** — writes a file into an identity's home folder over local or SSH. Analogous write for role folders may need to be added (check whether an existing `writeRoleFile` sibling exists first).
- **`resolveHostById()` in `host-resolver.ts`** — the standard host ownership check used by identity-archive.ts; new role-archive route uses the same.
- **`useIdentities()` hook** — provides `byHostKey` + `byKey` maps of `Identity`; new archive-role handler filters this by `identity.role === roleName && identity.hostId === hostId` to compute cascade preview.
- **`match_session()` in agent-supervisor.sh** — case-insensitive tmux session name lookup, used by `retire_identity()`. Unaffected by this phase but relevant to preserve as the refactor moves.

### Established Patterns
- **Sentinel-drop-then-supervisor-consume** — identity archive established this pattern (frontend → HTTP → SFTP write → supervisor reconcile-tick pickup → cascade → sentinel delete). Role archive follows the same pattern with one additional layer (cascade over identities before the role folder move).
- **`window.confirm` for destructive actions** — the identity archive uses native `window.confirm` (`archive <displayName>? this can't be undone.`). Role archive uses two sequential native confirms — same primitive doubled up.
- **Multipart JSON body — `data` JSON blob** — the roles-create route uses multipart (Phase 22/86); role-archive route uses plain JSON body `{ hostId }` matching identity-archive (single-field body, no file upload). Not a multipart route.
- **`IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/`** — regex gate for keys at the HTTP handler entry, prevents path traversal (T-115-03-02 in identity-archive.ts). A `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/` already exists in `roles-create.ts` — reuse for the new role-archive route.
- **Bash test convention** — existing tests in `substrate/scripts/tests/*.test.sh` use bats-like manual assertion patterns; new tests match.

### Integration Points
- **Skynet backend routes registry** — the new route mounts in `database.ts` before the generic `/roles` router (mirrors how identity-archive mounts before the generic `/identities` router per Phase 115 Plan 115-03 requirement).
- **Supervisor reconcile-loop tick** — the new `scan_role_archive_requested_sentinels()` wires in at `agent-supervisor.sh:2327` alongside the existing identity sentinel scanner.
- **`RolesListModal` row rendering** — the context-menu binding goes on the row element's `onContextMenu` handler.
- **id-skill docs** — new "Archiving a role" section in `substrate/skills/id/SKILL.md`, sibling to the existing "On archiving an identity" section. Text-content update, no code.

</code_context>

<specifics>
## Specific Ideas

- **First-confirm text template:**
  ```
  archive role <role-displayName>? this will also archive <N> identities holding it:
  • <identity1 task or displayName>
  • <identity2 task or displayName>
  • ... (all N, no truncation)
  ```
  When N=0: `archive role <role-displayName>? no identities hold it.`

- **Second-confirm text:** `are you sure? this can't be undone.`

- **Menu item label:** `Archive role` (or just `Archive` if context makes it obvious the row is a role — planner's call).

- **Menu item is `danger: true` styled** (red text, matching identity archive item in `IdentitySessionPane.tsx`).

- **Log format for LOUD partial-failure** — should carry the `ERROR:` prefix (the existing D-15 silent-discipline carve-out in `agent-supervisor.sh`) and name each failed identity + which step failed + the underlying error message. Format is planner's call within those constraints.

- **API endpoint shape** — `POST /roles/:name/archive` with body `{ hostId: number }`, returns `200 { ok: true }` on success. Error contract mirrors identity-archive.ts: 400 (bad name/hostId), 404 (host not found — cross-user or unknown), 504 (host unreachable), 500 (SFTP write failure). No new error codes.

- **Route mount order** — mount BEFORE the generic `/roles` router in `database.ts` so `/roles/:name/archive` doesn't fall through to the generic router's `/:roleName` handlers.

- **Ordering within `retire_identity()` after the refactor** — preserve the existing five-step order per Phase 115 D-13 (matrix deactivate → graceful exit → tmux kill → workspace cleanup → sentinel delete + folder move). The refactor only changes retry mechanics, not step order.

</specifics>

<deferred>
## Deferred Ideas

**Un-archive (role or identity).** Restoring an archived role or identity to the live tree. Deliberately out of scope for this phase per D-19. Would require its own shape work — is it a simple mv-back, or is it a rehydrate that re-provisions matrix accounts, tmux sessions, etc.? Not settled.

**Automated role archival (age-based dormancy sweep).** Analogous to the 180-day identity sweep but for roles whose folder + all identities have been untouched. Explicitly rejected per D-20 — role archive is strictly operator-initiated for now.

**Cleanup of legacy retry-mechanism artifacts.** Old `retire-stuck` sentinels in `~/fleet/identities-archive/*/` and old `retire-fail-count-*` files in `$DORMANCY_STATE_DIR` from the removed mechanism (D-14). Left as archaeology per D-21. Operator can `find ~/fleet/identities-archive -name retire-stuck -delete` manually if desired.

**Archive affordance on `RoleModal` (per-role detail view).** Adding a second archive gesture on the RoleModal itself would fragment the "context menu is the archival surface" convention (D-02) and diverge from how identity archive lives only on the session pane, not on the identity modal. Explicitly rejected in the shape's "Tempting-but-no" list.

**Role-level `retire-stuck` marker.** Mirroring what we're removing from identities. Rejected in the shape's "Tempting-but-no" — the whole refactor moves AWAY from cross-tick failure state; adding a new flavor of it at the role level would defeat the point.

**Reassign identity to a different role.** Would provide an escape hatch for "I want to archive this role but keep identity X alive." Doesn't exist today; adding it is separate future work. This phase honors the operator's intent by bypassing guards (D-10) rather than providing a migration UX.

**Cross-box role coordination.** Roles are per-box (D-18). If a future need arises for a "fleet-wide role" concept, it is separate future work.

</deferred>

---

*Phase: 133-role-archival*
*Context gathered: 2026-09-24*
