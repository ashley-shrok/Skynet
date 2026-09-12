# Phase 108: birth-pipeline role-folder existence check — Context

**Gathered:** 2026-09-12
**Status:** Ready for planning
**Source:** `/explain` design pass with Alice + bounty `birth-pipeline-role-folder-existence-check` (locked design, greenlit thumbs-up).

<domain>
## Phase Boundary

Insert a target-host role-folder existence probe into `identity-birth-orchestrator.ts` that runs BEFORE any durable side effect (identity folder mkdir, identity file write with role baked into frontmatter, Matrix admin-mint with role interpolated into MXID localpart, relay creds mint, relay.json SFTP write). On miss, throw a distinct error message that the orchestrator emits as `step:failed` + `ended{ok:false, failedStep:1, reason:"..."}`; the worker's existing `mapEndedEventToReason` regex catches the reason and drops a `FailureResponse{reason:"role_unknown"}` file in `~/fleet/spawn-requests/<uuid>.failure.json`.

**What "role folder" means concretely:** `~/fleet/roles/<role>/<role>.md` on the TARGET host — the role's markdown file, which is the FIRST substantive thing the id skill's `/id <name>` load reads. Absence = the identity has no mind. Roles are per-host; the target host's own filesystem is authoritative (D-05 discussion).

**Forensic origin** (surfaced via bounty investigation, not previously named in code): the worker at `spawn-requests/worker.ts:94-97` already has a `role_unknown` regex matcher AND the `FailureReason` enum at `types.ts:80` already lists `"role_unknown"` — the failure-side plumbing was authored anticipating a `Step 2.5 check in orchestrator` (worker.ts:94 comment) that was NEVER implemented. Phase 108 lands the missing orchestrator half. This is a partial-implementation gap, not a fresh design.

**Genesis case that surfaced the gap (2026-09-12):** ivory's spawn-scan e2e test for the newly-decoupled spawn-scan orchestrator (parent bounty `fleet-status-orchestrator-coupling-with-spawn-request-scanning`, archived) dropped a spawn-request with the deliberately bogus role `test-nonexistent-role-ivory-e2e`, expecting a `role_unknown` failure signal. The pipeline birthed identity `odin` (me) instead — Matrix account registered with the bogus role suffix PERMANENTLY baked into the localpart (`odin-test-nonexistent-role-ivory-e2e`), relay creds minted, identity folder + wakeups/ + relay-state/ + workspace/ on disk, success response file dropped. Alice caught it, role-swapped odin's frontmatter to `box-maintainer` to rescue, and greenlit exploring the gap.

**Out of scope:**
- **Race between check and Step 2.5** (role folder deleted mid-birth by a peer session): exotic; the resulting broken identity is no worse than what the pipeline produces today unconditionally. Not guarded.
- **Bootstrap-role-at-birth** / auto-create the role folder if missing: roles are created via `/role <name>` from a maintainer's session, never by the birth pipeline. A missing role at birth is always operator error, not a state to recover from.
- **Retroactive cleanup of odin's own bogus-role-suffix MXID localpart** (`odin-test-nonexistent-role-ivory-e2e`): irreversible — localparts are permanent on Synapse. Phase 108 prevents future occurrences; odin's own name stands as the historical marker.
- **Retroactive cleanup of other historical bogus-role identities:** none known besides odin; no sweep needed. If any surface later, they're already broken at `/id` load and can be archived manually.
- **Update Phase 106's shape file / arc:** Phase 106 (birth-flow Chunk 3 — tmux/harness retirement) is adjacent but orthogonal. Do not touch Phase 106 artifacts.

</domain>

<decisions>
## Implementation Decisions

### Probe placement + shape
- **D-01:** Insert the role-folder existence probe INSIDE existing Step 1 (`runStep(1, async () => {...})` at `identity-birth-orchestrator.ts:1232`), as the FIRST substantive check inside the runStep — before the avatar candidate lookup (currently first) AND before the on-disk identity-folder collision probe (currently second). Order rationale: role-folder-not-found is the cheapest and most-authoritative rejection; running it first minimizes wasted work on a fatal input.
- **D-02:** Do NOT create a new numbered step (no Step 0, no Step 1.5). The existing numbered-step contract (1, 2, 6, 7, 8) is a wire schema consumed by `identity-birth.ts` SSE clients + `worker.ts` + `identity-birth-orchestrator.test.ts` fixtures + frontend removed in Phase 106. Widening the schema for a check that shares Step 1's semantics (cheap pre-flight collision-class probe) is unnecessary. Attribution stays on step 1 in log-forensics — the reason string distinguishes.
- **D-03:** Probe primitive uses the same `exec()` closure defined at `identity-birth-orchestrator.ts:1181-1187` — routes to `deps.execLocal` for `useLocal=true` self-birth OR `deps.execCommand(conn!, ...)` for remote SSH. Same primitive Step 1's existing identity-collision probe uses. No new deps injection, no new SSH connection, no new configuration surface.
- **D-04:** Local branch check: `fs.access` on `path.join(getLocalIdentitiesRoot(), "..", "roles", opts.role, opts.role + ".md")` — mirroring the local-branch identity-collision probe's rationale at `identity-birth-orchestrator.ts:1256-1262` (a shell `test -f` on LOCAL would expand `$HOME` to the Skynet container's node user home, NOT the `/fleet` bind mount, and would ALWAYS report missing). Import path: `getLocalIdentitiesRoot()` from `../../claude-session/identity-artifact-reader.js` (already imported at the top of the file). Compute roles root via `path.join(getLocalIdentitiesRoot(), "..", "roles")` — same one-level-up-then-across pattern as bounty file discussion; simpler than adding a new `getLocalRolesRoot()` export unless a peer file already needs it (planner check: search for existing exports before adding one).
- **D-05:** Remote branch check: `test -f "$HOME/fleet/roles/<role>/<role>.md" && echo exists || echo missing` via `exec()`. `opts.role` interpolation is safe because `ROLE_NAME_PATTERN` (kebab-case-lowercase, no leading digit) is validated upstream at `identity-birth.ts:parseRequestBody` — the same validate-then-interpolate discipline the existing identity-collision probe uses for `opts.name` (see the doc comment at `identity-birth-orchestrator.ts:134-146`). Double-quote the path segment to survive shell metacharacters not otherwise present in the validated role name (defense in depth).
- **D-06:** Check the `.md` FILE specifically, NOT just the FOLDER. Rationale: a role folder without its markdown is a broken role and would fail at `/id <name>` load (the id skill reads `<role>.md` as the FIRST substantive action). `test -f` on the `.md` catches half-created roles that `test -d` would let slip through.

### Failure surface
- **D-07:** Error message thrown MUST match `worker.ts:95` regex `/role.*not found|role.*does not exist|unknown role|invalid role/i`. Concrete throw: `throw new Error("role not found on target host: " + opts.role);` — matches the FIRST alternation (`role.*not found`), embeds the offending role name for log-forensics.
- **D-08:** The throw propagates through `runStep(1)` → `emit({type:"step", n:1, phase:"failed", reason: "role not found on target host: <role>"})` → `emit({type:"ended", ok:false, failedStep:1, reason: "role not found on target host: <role>"})` (same wire path as the existing identity-collision throw at `identity-birth-orchestrator.ts:1270`). No orchestrator-side wiring changes required — the existing `runStep` machinery does it.
- **D-09:** Worker translation: existing `mapEndedEventToReason(endedEvent, lastStepFailReason)` at `worker.ts:79-101` already regex-matches `stepFailReason` to `"role_unknown"`. No worker changes needed for the primary path. `writeFailureFile` drops `{reason:"role_unknown"}` (no `message` field — matches the "ABSENT or terse for all other reasons" convention at `types.ts:89`).
- **D-10:** Update the STALE comment at `worker.ts:94` from `// Role folder not found on target host (Step 2.5 check in orchestrator)` to `// Role folder not found on target host (Step 1 check in orchestrator — Phase 108)`. Minor, no behavior change. Keeps forensic trail correct.

### Ordering + side effects
- **D-11:** The probe MUST run BEFORE the avatar candidate check at `identity-birth-orchestrator.ts:1241-1250`. Rationale: avatar candidate cache mutation is a side effect (consumed by `consumeCandidateForBirth` at Step 2.5). If the role is bad, we don't want to touch avatar cache state. Order within Step 1: (1) role folder probe, (2) avatar candidate check, (3) identity collision probe.
- **D-12:** The probe MUST run AFTER `deps.connectOneShot` at line 1205 for the remote branch — the probe uses `exec()` which requires `conn` to be assigned. This is already satisfied because Step 1 runs after the pre-step SSH connect (line 1200-1219).

### Tests
- **D-13:** Backend unit tests to add in `identity-birth-orchestrator.test.ts`:
  - **Test A** (remote): role folder MISSING on target → orchestrator emits `step:1:failed` with reason matching `/role not found/`, then `ended{ok:false, failedStep:1}`, then STOPS. Steps 2/2.5/6/7/8 NEVER run (assert via mock call counts on `deps.matrixCreateOrUpdateUser`, `deps.writeMarkdownFileAtomic`, etc. — all zero).
  - **Test B** (remote): role folder PRESENT on target → orchestrator proceeds past Step 1, reaches Step 2 mkdir. Mock `exec` to return `exists` for the role-folder probe path AND `missing` for the identity-folder probe path (differentiate by command substring). Assert Step 1 completes without emitting `failed`.
  - **Test C** (local): local self-birth (`isLocalHostId=true`), role folder MISSING at `getLocalIdentitiesRoot()/../roles/<role>/<role>.md` → same failure shape as Test A. Assert via mocked `fs.access` throwing `ENOENT`.
  - **Test D** (local): local self-birth, role folder PRESENT → orchestrator proceeds past Step 1.
  - **Test E** (ordering): role folder missing + avatar candidate ALSO missing → role probe fires FIRST, avatar check NEVER runs (assert `deps.getCandidateForBirth` call count = 0). Guards against a future refactor accidentally reordering.
- **D-14:** Worker-side test in `spawn-requests/worker.test.ts`: mock `birthIdentity` to emit `ended{ok:false, failedStep:1, reason:"role not found on target host: bogus"}` → assert `writeResponseFile` called with `"failure"` kind AND JSON payload `{"reason":"role_unknown"}`. Covers the mapEndedEventToReason regex path end-to-end at worker scope. (Existing `mapEndedEventToReason` tests may already cover the regex — planner: audit before duplicating.)
- **D-15:** Scoped test command for executor's green-gate (per fleet Test discipline directive): `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts src/backend/database/routes/identity-birth.test.ts src/backend/spawn-requests/worker.test.ts`. Full suite is orchestrator-only, per Alice's ship-gate rule (moved 2026-09-07).

### Container-mutation coordination
- **D-16:** Deploy motion follows the standing role rule (§Container mutations serialize across identities). This phase's deploy will require: coord-room BEFORE post on `!ZFgklgKthqYwVvLQzM:t1000.taild9b663.ts.net` (the new post-migration room) announcing "starting deploy on Phase 108 birth-pipeline-role-folder-existence-check, HEAD <sha>, hold if you're mid-container-work"; `git pull --rebase origin feat/tab-title-from-tmux` before push; ship-gate full-suite (`npx vitest run` + `npx playwright test tests/e2e/smoke.spec.ts --project=chromium` with `SKYNET_TEST_CREDS`); AFTER post on ship. Executor's remit STOPS at code + commit + scoped tests green — orchestrator (odin in-session, that's me) handles push + build + recreate + verify. Push held for Alice's explicit greenlight per the deploy-boundary rule (2026-08-29 refinement — greenlight sits at push, not at recreate).

### Claude's Discretion
- Exact placement of the role-folder probe within Step 1's `runStep(1, ...)` body — beginning is preferred (D-11) but the planner may choose to structure as a small helper function.
- Whether to introduce a `WAIT_FOR_ROLE_FOLDER_PROBE_MS`-style constant — no. This is a single synchronous exec; no polling, no timing.
- Whether to add a new `getLocalRolesRoot()` export in `identity-artifact-reader.ts` to mirror `getLocalIdentitiesRoot()` — planner's call. If a peer file (e.g. `role-utils.ts`, if it exists) already has one, use it. Otherwise inline `path.join(getLocalIdentitiesRoot(), "..", "roles")` is fine for a single call site.
- Whether to update the file-level docstring at `identity-birth-orchestrator.ts:1-41` to name the role-folder probe in the Step 1 description. Minor; recommend yes for future readers.
- Whether the throw's Error message should include the target host's `hostId` for even better log-forensics — planner's call. `opts.role` alone is sufficient for triage; hostId is already in the broader log context via `databaseLogger`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bounty + genesis
- `~/fleet/roles/box-maintainer/bounties/birth-pipeline-role-folder-existence-check/bounty.json` — LOCKED bounty with premise, design decisions, and Alice's greenlight. Every decision above traces back to this file + the `/explain` conversation captured in odin's session.
- `~/fleet/roles/box-maintainer/bounties/archive/fleet-status-orchestrator-coupling-with-spawn-request-scanning/bounty.json` — PARENT bounty (archived done 2026-09-12), where ivory's e2e test surfaced this gap. The related-slug is bidirectional.

### Backend files this phase modifies
- `src/backend/database/routes/identity-birth-orchestrator.ts` — insert role-folder probe as the FIRST check inside `runStep(1, ...)` at line 1232. Local branch uses `fs.access`; remote branch uses `exec()` with `test -f`. Also update the file-level Step 1 docstring at lines 12-13.
- `src/backend/spawn-requests/worker.ts` — update stale comment at line 94 from `(Step 2.5 check in orchestrator)` to `(Step 1 check in orchestrator — Phase 108)`. No code change; worker's regex-matcher for `role_unknown` at line 95 already works.

### Backend files this phase adds tests to
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — 5 new tests per D-13 (Tests A-E).
- `src/backend/spawn-requests/worker.test.ts` — 1 new test per D-14 (if not already covered by existing `mapEndedEventToReason` tests — audit first).

### Reusable existing code
- `src/backend/database/routes/identity-birth-orchestrator.ts:1181-1187` — the `exec()` closure the probe reuses.
- `src/backend/claude-session/identity-artifact-reader.ts` — `getLocalIdentitiesRoot()` for the local branch. `path.join(root, "..", "roles")` derives the roles root.
- `src/backend/utils/role-name-pattern.ts` — `ROLE_NAME_PATTERN` regex, validated upstream at request-body parse. Guarantees `opts.role` is safe to interpolate into the double-quoted probe path (D-05).
- `src/backend/spawn-requests/worker.ts:79-101` — `mapEndedEventToReason` regex matcher — already handles the `role_unknown` translation. No code change here, only comment update per D-10.
- `src/backend/spawn-requests/types.ts:78-84` — `FailureReason` enum already includes `"role_unknown"`. No schema change.

### Prior-art references (Phase 106)
- `src/backend/database/routes/identity-birth-orchestrator.ts:1252-1284` — existing Step 1 identity-folder collision probe. Same primitive, same validate-then-interpolate discipline, same local/remote split. Model the role-folder probe on it byte-for-byte in shape.
- `.planning/phases/106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s/106-CONTEXT.md` — Phase 106's CONTEXT.md, adjacent arc, worth skimming for background on the Step-numbering wire contract and the SSE `ended` event shape. NOT modified by this phase.

</canonical_refs>

<specifics>
## Specific Ideas

### Concrete probe shape (remote branch)
```typescript
// (inside runStep(1, ...), FIRST — before avatar candidate + identity collision probes)
if (useLocal) {
  const rolesRoot = path.join(getLocalIdentitiesRoot(), "..", "roles");
  const roleMdPath = path.join(rolesRoot, opts.role, opts.role + ".md");
  try {
    await fs.access(roleMdPath);
  } catch {
    throw new Error("role not found on target host: " + opts.role);
  }
} else {
  const roleProbeOut = await exec(
    `if [ -f "$HOME/fleet/roles/${opts.role}/${opts.role}.md" ]; then echo exists; else echo missing; fi`,
  );
  if (roleProbeOut.trim() !== "exists") {
    throw new Error("role not found on target host: " + opts.role);
  }
}
```

### Concrete throw message
`"role not found on target host: <role>"` — matches worker.ts:95 regex first alternation.

### Concrete failure response file body
`{"reason": "role_unknown"}` — `types.ts:FailureResponse`; `message` field omitted per D-09.

</specifics>

<deferred>
## Deferred Ideas

- Retroactive cleanup of the bogus-role-suffix MXID localpart on odin (irreversible on Synapse; historical marker preserved).
- Any changes to Phase 106's shape / arc / plans (orthogonal — do not touch).
- A `getLocalRolesRoot()` helper export in `identity-artifact-reader.ts` — planner's call at plan time; not required.
- Extension of the probe to check role folder structural completeness (e.g. `bounties/`, `history.md`, `runbooks/`) — the id skill treats absence of these as "not yet populated" and succeeds on the `.md` alone. Overreach for this phase; may be revisited if a "role folder exists but is corrupt" failure mode surfaces.

</deferred>

---

*Phase: 108-birth-pipeline-role-folder-existence-check-insert-a-pre-step*
*Context gathered: 2026-09-12 via `/explain` design pass with Alice + bounty capture*
