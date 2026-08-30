---
phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
plan: 02
subsystem: full-stack (backend route + orchestrator + frontend dropdown)
tags: [skynet, roles, backend, frontend, birth, dropdown, ssh, nginx, sric-02, seed-comment]

# Dependency graph
requires:
  - phase: 20-identity-creation-ui
    provides: identity-birth-orchestrator.ts 5-step Nelly-cribbed sequence + identity-birth.ts SSE route
  - phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
    plan: 01
    provides: extractRoleFromMarkdown + resolveRoleForIdentity + getLocalRolesRoot in identity-artifact-reader.ts (Wave 1 sibling; not directly consumed here but sets the fleet-wide invariant that every identity file has role: frontmatter — this plan writes that frontmatter at birth time)
provides:
  - GET /roles?hostId=<n> HTTP route returning [{name, description}] scoped by user via resolveHostById
  - listRolesForHost(hostId) + RoleSummary type in ui/api/identities-api.ts
  - ROLE_NAME_PATTERN kebab-case-lowercase constant (exported from identity-birth-orchestrator; used by identity-birth.ts too)
  - IDENTITY_FILE_SEED_COMMENT constant with Ashley-locked verbatim wake-up seed text
  - writeMarkdownFileAtomic now PUBLIC (was private) in identity-artifact-reader.ts — for the Step 2.5 pre-write; other in-plan uses stay behind writeIdentity{File,History,Handoff}
  - BirthOptions.role + BirthDeps.writeMarkdownFileAtomic (new required orchestrator surfaces)
  - NewSessionDialog role dropdown + host-change repopulate + submit-block-if-empty + role in birth payload
affects: [22-03-clone (may reference RoleSummary + listRolesForHost), 22-04-create-role-dialog (wires the "no roles on this host — create one first" click handler stub), 22-05-role-tab (renders role artifact folder that this plan's birth seeds), 22-06-role-tab]

# Tech tracking
tech-stack:
  added: []  # No new npm packages — express, ssh2, react, @testing-library/react all already present
  patterns:
    - "Skynet writes a wake-up SEED COMMENT — no more Skynet-side SSH-invoke of the relay-register block. The fresh agent registers its own Matrix relay account on first wake per the seed's plain-English instruction (Ashley-locked wording: no 'Skynet' word, no §2/§3 refs). Boundary shrinks: Skynet does file setup, agent does identity setup."
    - "Step 2.5 piggybacks on Step 2's runStep — pre-write is silent inside Step 2's completion path, so the frontend BirthProgress checklist stays untouched (no new SSE event types)."
    - "writeMarkdownFileAtomic export lets other backend code re-use the SFTP tmp+rename with ext_openssh_rename discipline (Pitfall 3 / #2924) for arbitrary target paths, while writeIdentity{File,History,Handoff} keep locked-shape (identity-scoped) semantics."
    - "Frontend Role dropdown is CREATE-only (per D-CONTEXT §UX rules) — required when identity-mode is ON; hidden when OFF. Zero clutter for the regular-session path."
    - "Client-side dropdown uses native <select> + <option> — no new component libs; matches the existing Voice/Color picker aesthetic without bringing a combobox component in."

key-files:
  created:
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts  # 11 tests for Step 2.5 (Task 3 RED→GREEN)
    - src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx                             # 8 tests for role dropdown (Task 4 RED→GREEN)
    - .planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/deferred-items.md
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts               # export writeMarkdownFileAtomic + doc-comment update
    - src/backend/database/routes/identity-birth-orchestrator.ts           # ROLE_NAME_PATTERN + IDENTITY_FILE_SEED_COMMENT + BirthOptions.role + BirthDeps.writeMarkdownFileAtomic + Step 2.5 pre-write inside runStep(2)
    - src/backend/database/routes/identity-birth.ts                        # role destructure + validation + pass-through + writeMarkdownFileAtomic dep
    - src/backend/database/routes/identity-birth-orchestrator.test.ts      # makeOpts.role + makeDeps.writeMarkdownFileAtomic + `echo $HOME` handling in all mockExecCommand overrides
    - src/backend/database/routes/identity-birth.test.ts                   # VALID_BODY.role + writeMarkdownFileAtomic dep assertion + Test 18/19 for role validation
    - src/ui/api/identities-api.ts                                          # BirthRequest.role field
    - src/ui/sidebar/NewSessionDialog.tsx                                   # role state + useEffect + dropdown render + canOpen gate + payload
    - src/ui/sidebar/NewSessionDialog.test.tsx                              # listRolesForHost mock + fillIdentityFormAndPick role pick + Tests G/Q/R/T inline role pick

key-decisions:
  - "REVISION 2026-08-04 (Ashley at Task 2 checkpoint): B4b(a) APPROVED with refinement — Skynet writes only the identity folder + role: frontmatter + wake-up seed comment; the fresh agent registers its own Matrix relay account on first wake. Skynet no longer performs the register step. Ashley's rationale: fewer moving parts in Skynet, cleaner boundary, same end-state."
  - "Seed comment text is Ashley-verbatim: 'This identity has no relay account yet. On first wake, please register a Matrix relay account for this identity and remove this comment.' Style constraints enforced by tests — no 'Skynet' word (agents don't know what that is), no §2/§3 refs (fragile skill-section pointers), no 'id skill' phrase (implementation detail)."
  - "Step 2.5 piggybacks on Step 2's runStep (no new SSE event type). Rationale: keeps the frontend BirthProgress checklist untouched — a new step:2.5 event would require frontend consumer changes for zero user-visible benefit. The pre-write IS Step 2's contract now."
  - "Step 2.5 is remote-branch only (skipped when isLocalHostId=true). Rationale: this phase's UAT scope is remote fleet hosts only per CONTEXT; local-branch self-birth is a pre-Phase-22 workflow that doesn't need the role scoping. Documented inline in the orchestrator."
  - "writeMarkdownFileAtomic exported (was private). Rationale: the orchestrator needs to write to an arbitrary target path (~/.claude/identities/<name>/<name>.md constructed at runtime), whereas writeIdentityFile locks to a fixed shape. Doc-comment updated to reflect the second call site."
  - "Role name validator: /^[a-z0-9-]+$/ — strict kebab-case-lowercase per D-CONTEXT §Frontend surfaces. Stricter than IDENTITY_KEY_RE. Applied at HTTP handler AND re-applied at orchestrator entry (defense in depth per T-22-02-01: role is shell-interpolated into SSH commands)."
  - "Frontend Role dropdown is a native <select>+<option> — no combobox library. Matches the existing Voice/Color picker aesthetic. Zero new npm deps."
  - "Zero-roles-on-host hint is a no-op-stub button with a text link — the actual click handler is wired in Plan 22-04 (SRIC-04 CreateRoleDialog). Preserving the affordance now avoids a UX gap during the interim between waves."

patterns-established:
  - "Step 2.5 pre-write flow: (1) validate role against ROLE_NAME_PATTERN, (2) resolve remote $HOME via one SSH round-trip, (3) mkdir wakeups + touch handoff in ONE combined exec, (4) writeMarkdownFileAtomic via SFTP tmp+rename. Wrapped in runStep(2) so failures emit step:2:failed and skip Step 3-5."
  - "SEED COMMENT pattern for cross-boundary agent instructions: HTML comment in the identity file, plain English, no cross-references to system-specific names/paths/section numbers. Agent removes the comment when they've acted on it. Tests grep-anchor both the required phrases (positive assertions) AND the forbidden phrases (negative assertions)."
  - "Frontend Role dropdown effect keys on [selectedHost, identityMode]: fetch when both truthy; reset (rolesForHost=[], selectedRole='') when either falsy. Cancellation-guard pattern (let cancelled = false; return () => { cancelled = true; }) handles rapid host switches without stale-response bugs."

requirements-completed: [SRIC-02]

# Metrics
duration: 22min
completed: 2026-08-04
---

# Phase 22 Plan 22-02: SRIC-02 — Role dropdown at create + `role:` frontmatter at birth Summary

**NewSessionDialog now requires a role from a host-scoped dropdown at create time; the birth orchestrator pre-writes `~/.claude/identities/<name>/<name>.md` with `role:` frontmatter + a wake-up seed comment so the id skill on the box takes its load-existing branch (skipping the interactive create) — and the fresh agent registers its own Matrix relay account on first wake per the seed comment.**

## Performance

- **Duration:** ~22 min (Task 3 + Task 4)
- **Started:** 2026-08-04T08:13:37Z (after loading state + reading plan)
- **Completed:** 2026-08-04T08:35:52Z
- **Tasks:** 4 total in plan; Tasks 1 + 2 done in prior executor session (Task 1 = 2 commits, Task 2 = checkpoint); this session completed Tasks 3 + 4 (4 commits: RED test + GREEN feat pair per task)
- **Files touched (this session):** 8 source/test files + 1 doc + 1 SUMMARY

## Accomplishments

- **Backend Step 2.5 pre-write is live.** After `tmux new-session` completes and the 3s login-shell sleep, the orchestrator now:
  1. Validates `opts.role` against `ROLE_NAME_PATTERN` (defense in depth on top of the HTTP handler's validation).
  2. Resolves `$HOME` on the target host via one SSH round-trip.
  3. Execs `mkdir -p ~/.claude/identities/<name>/wakeups && touch ~/.claude/identities/<name>/handoff.md` in one combined command.
  4. Writes `~/.claude/identities/<name>/<name>.md` via SFTP tmp+rename (`writeMarkdownFileAtomic` with `ext_openssh_rename` per Pitfall 3) with body:
     ```
     ---
     role: <opts.role>
     ---

     <!-- This identity has no relay account yet. On first wake, please register a Matrix relay account for this identity and remove this comment. -->

     # <opts.name>
     ```
  5. On any failure: emit `step:2:failed` + `ended{ok:false, failedStep:2}` and skip Steps 3-5. No new SSE event types — piggybacked on Step 2's number so the frontend BirthProgress checklist stays untouched.
- **HTTP handler `POST /identities/birth` validates and threads `role`.** New 400 responses for missing role or role failing `ROLE_NAME_PATTERN`. Passes `role.trim()` into the orchestrator opts.
- **Frontend `Role` dropdown is live in `NewSessionDialog`** — positioned as the FIRST field in the identity-birth cluster (near the host picker). Populates via `GET /roles?hostId=<n>` whenever the selected host OR identity-mode changes. Clears selection on host change (force re-pick). Blocks Create until a role is picked. Zero-roles response renders an inline no-op-stub button ("no roles on this host — create one first") that will be wired to CreateRoleDialog in Plan 22-04.
- **Zero cross-boundary work.** Skynet no longer SSHes to the target host to invoke the id-skill relay-register block. The seed comment tells the wake-up agent to do it themselves on first wake — cleaner boundary, fewer moving parts in Skynet.
- **395 tests pass across backend routes + claude-session + ui/sidebar.** 6 pre-existing NewSessionDialog test failures (Tests 5-10) documented in `deferred-items.md` — orthogonal to SRIC-02 scope; unchanged from baseline before Task 4.

## Task Commits (this session)

Task 3 (revised per checkpoint refinement):
1. **Task 3 RED: failing tests for Step 2.5 role frontmatter + seed comment** — `38eabf5` (test)
2. **Task 3 GREEN: birth Step 2.5 pre-writes identity file with role + seed comment** — `7578999` (feat)

Task 4:
3. **Task 4 RED: failing tests for NewSessionDialog role dropdown** — `1197ab1` (test)
4. **Task 4 GREEN: required Role dropdown in NewSessionDialog + role in birth payload** — `10c35a3` (feat)

Support:
5. **Deferred-items log for pre-existing test failures** — `ac673d3` (docs)

_(Task 1 commits from prior executor session: `79dc4ba` (RED), `2efc2d1` (GREEN). Task 2 was a checkpoint — no commit.)_

**Plan metadata commit:** _(committed after STATE + ROADMAP updates below)_

## Files Created/Modified (this session)

**Created:**
- `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` — 11 tests for Step 2.5 (Task 3 RED→GREEN).
- `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` — 8 tests for role dropdown (Task 4 RED→GREEN).
- `.planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/deferred-items.md` — logs pre-existing NewSessionDialog test failures.

**Modified:**
- `src/backend/claude-session/identity-artifact-reader.ts` — export `writeMarkdownFileAtomic` (was private) + doc-comment update noting the second call site.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — added `ROLE_NAME_PATTERN` + `IDENTITY_FILE_SEED_COMMENT` constants + `role: string` on `BirthOptions` + `writeMarkdownFileAtomic` on `BirthDeps` + Step 2.5 pre-write inside `runStep(2)`.
- `src/backend/database/routes/identity-birth.ts` — destructure/validate/pass-through `role`; add `writeMarkdownFileAtomic` to deps; import `ROLE_NAME_PATTERN` from orchestrator.
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — updated `makeOpts` (role) + `makeDeps` (writeMarkdownFileAtomic) + `echo $HOME` handling in all `mockExecCommand.mockImplementation` overrides so pre-existing tests still pass with Step 2.5 live.
- `src/backend/database/routes/identity-birth.test.ts` — added `role` to `VALID_BODY`; added `writeMarkdownFileAtomic` dep assertion in Test 5; added Tests 18/19 for missing/invalid role → 400.
- `src/ui/api/identities-api.ts` — added `role: string` to `BirthRequest` interface (matches the new backend contract).
- `src/ui/sidebar/NewSessionDialog.tsx` — new state (`selectedRole`, `rolesForHost`, `rolesLoading`, `rolesError`); new useEffect keyed on `[selectedHost, identityMode]`; dropdown render as first field in identity cluster; `canOpen` extended with `selectedRole !== ""` gate; `handleBirth` adds `role: selectedRole` to payload; modal-close reset clears new state.
- `src/ui/sidebar/NewSessionDialog.test.tsx` — added `mockListRolesForHost` (default one role); updated `fillIdentityFormAndPick` + Tests G/Q/R/T to pick a role before hitting Create.

**Untouched (per plan scope):**
- Frontend birth stream consumer (`handleBirth` L450-500 event loop) — unchanged; the role: frontmatter is written by the orchestrator on the box, invisible to the SSE stream.
- Existing identity-mode-off session-only flow (path field, session name, host picker) — unchanged.
- claude-session-server.ts — zero diff.

## Deviations from Plan

### Ashley-approved plan revision (documented in the plan file as REVISION 2026-08-04 HTML comment above Task 3)

**1. Skynet no longer invokes the relay-register block over SSH**

- **Approved during:** Task 2 checkpoint (2026-08-04).
- **Original spec:** Task 3 was to SSH-invoke the id-skill L317-346 register block and write `relay.json` on the target host as part of Step 2.5.
- **Revised spec:** Step 2.5 writes ONLY the identity folder (`<name>.md` with `role:` frontmatter + seed comment, `wakeups/` dir, empty `handoff.md`). The wake-up agent registers its own Matrix relay account on first wake, prompted by the seed comment.
- **Impact:**
  - Removed one SSH exec call from the orchestrator.
  - Removed Test 16 (relay register) from the RED test suite before writing it.
  - Removed threat model rows T-22-02-04 (register-hang DoS) and T-22-02-06 (register-creds leak in SSE) — no longer applicable since Skynet doesn't perform the register.
  - Modified Test 12 to also assert the seed comment is present + does NOT contain the word "Skynet" (case-insensitive) + does NOT reference `§2` / `§3` / `id skill` (case-insensitive).
  - Modified the CALL ORDER integration test to drop the relay-register exec step.
- **Rationale (Ashley):** fewer moving parts in Skynet, cleaner boundary (Skynet does file setup, agent does identity setup), same end-state.

### Auto-fixed Issues (Rule 3 blocking)

**2. Updated pre-existing identity-birth-orchestrator.test.ts to handle the new required opts.role + new echo $HOME exec**

- **Found during:** Task 3 GREEN verification.
- **Issue:** Every existing test in `identity-birth-orchestrator.test.ts` uses `makeOpts()` (no `role`) and `makeDeps()` (no `writeMarkdownFileAtomic`), and many override `mockExecCommand.mockImplementation` with returns-empty-for-all-commands. When Step 2.5 executes `echo $HOME`, the orchestrator receives `""`, hits the "could not resolve remote $HOME" guard, and fails Step 2. This cascades to ~7 pre-existing tests.
- **Fix:** Added `role: "box-maintainer"` to `makeOpts()` default. Added `writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined)` to `makeDeps()` default. Updated the beforeEach default + 6 per-test `mockExecCommand.mockImplementation` overrides to handle `echo $HOME` (return `/home/ubuntu\n`) as a special case.
- **Files modified:** `identity-birth-orchestrator.test.ts`.
- **Verification:** All 31 pre-existing orchestrator tests pass. All 11 new Task 3 tests pass.
- **Committed in:** `7578999` (Task 3 GREEN commit — the changes are inseparable from Step 2.5 landing).

**3. Updated pre-existing identity-birth.test.ts VALID_BODY + added Tests 18/19 for role validation**

- **Found during:** Task 3 GREEN verification.
- **Issue:** `VALID_BODY` lacked `role`, so Tests 1, 4, 5 all hit the new 400 gate on missing role.
- **Fix:** Added `role: "box-maintainer"` to `VALID_BODY`. Also added `ROLE_NAME_PATTERN` to the vi.mock for `./identity-birth-orchestrator.js`, added `writeMarkdownFileAtomic` to the vi.mock for `identity-artifact-reader.js`, added dep assertion in Test 5, and added Tests 18 + 19 (missing role → 400 / invalid role → 400).
- **Verification:** All 7 identity-birth.test.ts tests pass (was 5, now 7 with the added coverage).
- **Committed in:** `7578999` (Task 3 GREEN commit).

**4. Updated pre-existing NewSessionDialog.test.tsx tests to pick a role before Create**

- **Found during:** Task 4 GREEN verification.
- **Issue:** All identity-mode tests that click Create (Tests G, Q, R, T, W, X, Y, Z, AA, BB, EE) now hit the new `selectedRole !== ""` canOpen gate. Also the file lacked a mock for `listRolesForHost`, which would fire on every host select in identity-mode.
- **Fix:** Added `mockListRolesForHost` (default one role: `box-maintainer`). Updated `fillIdentityFormAndPick` helper to wait for the dropdown and pick the default role. Updated Tests G, Q, R, T inline (they don't use the helper) to also pick the role.
- **Verification:** 45 tests pass in NewSessionDialog.test.tsx + role-dropdown.test.tsx combined. 6 pre-existing failures unchanged (documented in deferred-items.md).
- **Committed in:** `10c35a3` (Task 4 GREEN commit).

### No unrelated fixes

- Pre-existing NewSessionDialog Tests 5-10 (looking up button by `/^open$/i` when the label is `"Create"`) were **NOT** fixed — orthogonal to SRIC-02 scope, documented in `deferred-items.md` for future work. Baseline was 6 failing, my Task 4 kept it at 6 failing (regression-free).

**Total deviations:** 4 (1 plan revision Ashley-approved, 3 auto-fixed Rule 3 blocking test-cascade cleanups)
**Impact on plan:** The revision reduced scope (dropped relay-register SSH exec + one test + two threat rows). The auto-fixes were essential Rule 3 unblockers — adding the required `role` field to BirthOptions cascades to every pre-existing test that constructs opts. Zero scope creep beyond what the plan documents.

## Issues Encountered

- **STATE.md is very large (~50KB — same issue noted in 22-01 summary)** — will use SDK verbs for updates below.
- **6 pre-existing NewSessionDialog test failures** — not caused by this plan; documented in `deferred-items.md` for future work.

## User Setup Required

None — no new environment variables, no new npm packages, no dashboard configuration. The nginx dual-config work for `/roles` was already committed in Task 1 (`2efc2d1`).

## Next Phase Readiness

**Wave 2 unblocked:**
- **22-04 (CreateRoleDialog / SRIC-04):** the "no roles on this host — create one first" inline hint in NewSessionDialog already has the no-op-stub button + comment reference to 22-04/SRIC-04. Wiring the click handler to open CreateRoleDialog is a small ~5-line change in 22-04.
- **22-03 (Clone identity / SRIC-03):** can reference `listRolesForHost` + `RoleSummary` if the clone flow needs to display or pre-fill role. Also can rely on the invariant that every fleshly-birthed identity now has `role:` frontmatter — no need to null-check.

**Wave 1 sibling (22-01 two-step) can now find role frontmatter in every fleshly-birthed identity.** Ashley's non-negotiable "no fleet identity lacks `role:` frontmatter post-migration" is now enforced at the birth boundary.

**Manual UAT gate (deferred to Phase 22 UAT per ROADMAP):**
1. Ashley opens NewSessionDialog, picks a fleet host → Role dropdown populates from that host's `~/.claude/roles/`.
2. Ashley picks a role, fills the rest of the form, clicks Create → identity is birthed with correct `role:` frontmatter in the on-box file.
3. On first wake, the fresh agent sees the seed comment, registers a relay account for itself, removes the comment. (Nelly-side / cross-boundary; not testable from Skynet.)

---

## Self-Check: PASSED

**Files created/modified verified:**
```
FOUND: src/backend/claude-session/identity-artifact-reader.ts
FOUND: src/backend/database/routes/identity-birth-orchestrator.ts
FOUND: src/backend/database/routes/identity-birth-orchestrator.test.ts
FOUND: src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
FOUND: src/backend/database/routes/identity-birth.ts
FOUND: src/backend/database/routes/identity-birth.test.ts
FOUND: src/ui/api/identities-api.ts
FOUND: src/ui/sidebar/NewSessionDialog.tsx
FOUND: src/ui/sidebar/NewSessionDialog.test.tsx
FOUND: src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx
FOUND: .planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/deferred-items.md
```

**Commits verified:**
```
FOUND: 79dc4ba test(22-02): add failing tests for GET /roles?hostId=<n> route  (Task 1 RED — prior session)
FOUND: 2efc2d1 feat(22-02): add GET /roles?hostId=<n> route with dual nginx blocks + listRolesForHost client  (Task 1 GREEN — prior session)
FOUND: 5ced52a docs(22-02): revise Task 3 — seed-comment approach, no SSH register  (checkpoint response — prior session)
FOUND: 38eabf5 test(22-02): add failing tests for Step 2.5 role frontmatter + seed comment  (Task 3 RED)
FOUND: 7578999 feat(22-02): birth Step 2.5 pre-writes identity file with role + seed comment  (Task 3 GREEN)
FOUND: 1197ab1 test(22-02): add failing tests for NewSessionDialog role dropdown (Task 4)  (Task 4 RED)
FOUND: 10c35a3 feat(22-02): required Role dropdown in NewSessionDialog + role in birth payload  (Task 4 GREEN)
FOUND: ac673d3 docs(22-02): log pre-existing NewSessionDialog test failures as deferred  (support)
```

**Acceptance criteria all pass:**

Task 3:
- `grep -c "^export const ROLE_NAME_PATTERN" src/backend/database/routes/identity-birth-orchestrator.ts` returns 1 ✓
- `grep -c "role: string" src/backend/database/routes/identity-birth-orchestrator.ts` returns 1 ✓ (added to BirthOptions)
- `grep -c "writeMarkdownFileAtomic" src/backend/database/routes/identity-birth-orchestrator.ts` returns 3 ≥ 2 ✓ (dep declaration + interface + call site)
- `grep -c "role: \${opts.role}" src/backend/database/routes/identity-birth-orchestrator.ts` returns 1 ✓ (frontmatter template)
- `grep -c "ROLE_NAME_PATTERN" src/backend/database/routes/identity-birth.ts` returns 2 ≥ 1 ✓ (import + validation)
- `grep -c "role: role.trim()" src/backend/database/routes/identity-birth.ts` returns 1 ✓
- All 11 new tests pass + all 31 pre-existing orchestrator tests pass + all 7 identity-birth.test.ts tests pass ✓

Task 4:
- `grep -c "listRolesForHost" src/ui/sidebar/NewSessionDialog.tsx` returns 2 ≥ 2 ✓ (import + call site)
- `grep -c "selectedRole" src/ui/sidebar/NewSessionDialog.tsx` returns 6 ≥ 5 ✓
- `grep -c "no roles on this host" src/ui/sidebar/NewSessionDialog.tsx` returns 1 ✓
- `grep -c "role: selectedRole" src/ui/sidebar/NewSessionDialog.tsx` returns 1 ✓
- `grep -c "22-04\|SRIC-04" src/ui/sidebar/NewSessionDialog.tsx` returns 4 ≥ 1 ✓
- `npx tsc --noEmit` clean ✓
- `npm run build:backend` clean ✓
- All 8 new role-dropdown tests pass ✓
- No net regression: 6 pre-existing failures unchanged (documented in deferred-items.md) ✓

---
*Phase: 22-skynet-ui-parity-with-the-role-identity-paradigm*
*Completed: 2026-08-04*
