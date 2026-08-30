---
phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
plan: 04
subsystem: full-stack (backend HTTP route + frontend dialog + panel launcher + nginx dual-config)
tags: [skynet, roles, backend, frontend, dialog, ssh, sftp, nginx, sric-04, seed-comment, tdd]

# Dependency graph
requires:
  - phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
    plan: 02
    provides: |
      ROLE_NAME_PATTERN constant (imported from identity-birth-orchestrator, not
      redefined); writeMarkdownFileAtomic exported (was private) — the SFTP
      tmp+rename helper with ext_openssh_rename per Pitfall 3; nginx /roles
      regex block that method-agnostically covers POST /roles; RoleSummary type
      + listRolesForHost pattern the createRole client mirrors
  - phase: 20-identity-creation-ui
    provides: |
      identity-birth.ts JSON POST route pattern (mirrored for POST /roles);
      identity-exists-on-host.ts collision-probe SSH command shape (mirrored
      for the role folder existence check); resolveHostById cross-user gate;
      connectOneShot + execCommand + shell-escape helpers
provides:
  - POST /roles HTTP route — SSHes to hostId, creates ~/.claude/roles/<name>/
    with bounties/ subdir + touched history.md + <name>.md stub via SFTP
    (writeMarkdownFileAtomic + ext_openssh_rename). Full validation surface
    (400/401/404/409/502) mirrors identity-birth's shape.
  - createRole(input) HTTP client + RoleAlreadyExistsError typed 409 in
    ui/api/identities-api.ts (dialog uses instanceof to detect conflicts)
  - CreateRoleDialog component + ROLE_NAME_PATTERN frontend regex mirroring
    the backend constant
  - `+ New role` launcher button in PrettyConversationsPanel header (Users
    icon from lucide, aria-label "New role", gated on the same
    showPencilButton predicate as the existing pencil)
  - Chain-into-create-identity extension point (onChainToCreateIdentity prop)
    exposed as undefined-safe optional callback for Plan 22-05 (SRIC-05) to
    wire without touching CreateRoleDialog again
  - Nginx dual-config parity for POST /roles — extended the existing 22-02
    /roles regex block with client_max_body_size 32k (T-22-04-04 DoS belt)
    in BOTH docker/nginx.conf AND docker/nginx-https.conf
affects: [22-05-chain-create-role-into-identity, 22-06-role-tab]

# Tech tracking
tech-stack:
  added: []  # No new npm packages — express, ssh2, react, @testing-library/react all pre-existing
  patterns:
    - "Chained app.use at the same base path — Express supports multiple Router
      instances mounted at the same base ('/roles'). The 22-02 list router
      handles GET, this plan's create router handles POST; POST falls through
      the GET-only router to reach the create router. Both mounts stay above
      /identities to preserve match precedence."
    - "REVISION seed-comment pattern generalized — 22-02 established the
      identity-file seed comment (agent registers relay account on first wake).
      22-04 mirrors the pattern for the role-file stub (agent fleshes out
      standing directives + 10,000-foot view of the domain on first wake).
      Same style constraints: no 'Skynet' word, no id-skill section refs,
      plain-English wake-up instructions ending with 'remove this comment'."
    - "Typed API error subclass (RoleAlreadyExistsError) — the dialog uses
      instanceof to detect 409 conflicts and render inline 'already exists on
      <host>' error, rather than pattern-matching a generic error string.
      Preserves handleApiError as the fallback for all other non-2xx statuses."
    - "Deferred extension point via optional callback prop — onChainToCreateIdentity
      is intentionally passed as `undefined` from the panel with an inline
      Plan 22-05 comment. Plan 22-05 wires the actual open-NewSessionDialog
      handler without touching CreateRoleDialog again — clean single-plan
      responsibility per component."
    - "Duplicated helper with F1 rationale — collectAllHosts + isFolder are
      inline-duplicated from NewSessionDialog per RESEARCH F1's 'extract into
      reusable HostPickerList (later)' recommendation. Explicit inline comment
      references F1 so a reviewer sees the pattern is a known deferred refactor,
      not accidental duplication."

key-files:
  created:
    - src/backend/database/routes/roles-create.ts                             # 300 lines: POST /roles route
    - src/backend/database/routes/roles-create.test.ts                        # 11 tests: RED→GREEN for POST /roles
    - src/ui/sidebar/CreateRoleDialog.tsx                                     # 360 lines: dialog component
    - src/ui/sidebar/CreateRoleDialog.test.tsx                                # 10 tests: RED→GREEN for dialog behavior
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx  # 3 tests for the launcher
  modified:
    - src/backend/database/database.ts                                        # +7 lines: import + mount rolesCreateRoutes
    - src/ui/api/identities-api.ts                                            # +41 lines: createRole + RoleAlreadyExistsError
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx      # +38 lines: import + state + button + dialog mount
    - docker/nginx.conf                                                       # +2 lines: client_max_body_size 32k on /roles block
    - docker/nginx-https.conf                                                 # +2 lines: same
    - .planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/deferred-items.md  # +24 lines: pre-existing panel test failures noted

key-decisions:
  - "REVISION SEED COMMENT (Ashley 2026-08-04 at 22-02 checkpoint, applied
    HERE per same-pattern extension): The role file stub Task 1 writes now
    includes a seed comment for the first-wake agent to flesh out. Concrete
    stub body: '# <name>\\n\\n## Role\\n\\n<description>\\n\\n<!-- This role
    file was auto-generated with only a basic description. On first wake of
    an agent holding this role, please flesh out the role with standing
    directives, learned preferences, and a 10,000-foot view of the domain
    the role covers, then remove this comment. -->\\n'. Style enforced by
    Test 6: (a) 4 positive seed phrases required; (b) no 'Skynet' (case-
    insensitive); (c) no §2/§3/id skill/SKILL.md refs; (d) description
    verbatim under ## Role. Rationale: mirrors 22-02's identity-file seed
    pattern — Skynet does file setup, agent does semantic setup."
  - "SEPARATE FILE for POST /roles (not extending roles-list-for-host.ts).
    Per plan Action step 1: 'SEPARATE FILE approach (cleaner concerns:
    list-for-host is SSH+read; create is SSH+write; different failure modes
    and validation shapes).' Both routers mount at the same /roles base via
    chained app.use — Express routes GET to the list router, POST falls
    through to the create router. Mount order verified: both /roles above
    /identities (lines 1813 and 1818 before /identities at 1819)."
  - "mkdir -p in a single call — 'mkdir -p \"\$HOME/.claude/roles/<name>/bounties\"'
    creates BOTH the parent role dir AND bounties/ atomically in one exec.
    Per RESEARCH Security 'Role name collision race — accept the race, worst
    case is duplicate mkdir which is idempotent'. Zero distributed-lock
    overhead for MVP."
  - "SFTP write via writeMarkdownFileAtomic (Pitfall 3 discipline). Raw
    sftp.rename triggers SSH2_FX_FAILURE on overwrite (quick 260802-qrw;
    Ashley UAT case). The helper uses ext_openssh_rename with POSIX atomic
    overwrite semantics. Test 6 mocks the helper and asserts it's called
    exactly once with the expected target path + stub body — the mock guards
    against a future refactor accidentally reverting to raw sftp.rename."
  - "Description passed VERBATIM via SFTP (bytes stream), NOT interpolated
    into any shell command. Test 8 covers newline preservation; Test 10
    covers shell metacharacters (backticks, \$, semicolons, quotes) —
    round-tripped unmodified into SFTP contents AND never appear in any
    execCommand arg. No shell-injection surface on description."
  - "RoleAlreadyExistsError typed subclass for 409 detection. Dialog uses
    'err instanceof RoleAlreadyExistsError' to distinguish conflicts from
    generic errors and render inline 'A role named X already exists on
    <host>' (Test 19). Preserves handleApiError as the fallback for all
    other non-2xx statuses (network errors, 500s, etc.)."
  - "Nginx block reuse instead of new location — the 22-02 /roles regex
    block '~ ^/roles(/.*)\$' is METHOD-AGNOSTIC (nginx location regex
    matches by URL only, not HTTP method), so POST /roles rides the SAME
    block that already serves GET. Added client_max_body_size 32k to the
    existing block (T-22-04-04 DoS belt) rather than creating a new
    location. Applied to BOTH nginx.conf AND nginx-https.conf per CLAUDE.md
    load-bearing rule."
  - "Chain hook (onChainToCreateIdentity) exposed but undefined in this
    plan. The panel mount passes explicit `undefined` with an inline
    'wired in Plan 22-05 SRIC-05' comment. Test 17b asserts undefined-
    safety (no crash when callback is not provided). Plan 22-05 wires the
    callback WITHOUT touching CreateRoleDialog — clean single-plan-
    responsibility per component. Test 17a asserts the callback IS invoked
    when provided AND checkbox is CHECKED."
  - "Icon for `+ New role` button: `Users` from lucide-react — visually
    disambiguates from the pencil's `Plus` (session-creation) icon.
    Sibling pv-pencil class treatment for visual parity. aria-label
    'New role' (matched by the launcher-button test's `/new role/i`
    regex — correct-label pattern avoids the class of test-coverage bug
    documented in deferred-items.md for Tests 5+8 of the pre-existing
    panel suite)."

patterns-established:
  - "Chained multi-Router mount at same base path — 'app.use(\"/roles\",
    rolesListForHostRoutes); app.use(\"/roles\", rolesCreateRoutes);'
    lets us split GET and POST into separate files without a single mega-
    router. Future /roles subpaths (e.g. PUT /roles/:name for edits) can
    add a third router at the same base."
  - "REVISION seed comment pattern for auto-generated on-box artifacts —
    Skynet writes minimal setup, embed an HTML comment in plain English
    telling the wake-up agent to flesh out semantics on first wake, then
    remove the comment. Ashley-locked style: no system-specific names, no
    fragile section pointers. Positive+negative test assertions enforce
    the style constraints at the test layer."
  - "Optional chain-callback extension point — an optional prop with a
    NEVER-provided panel mount + inline 'wired in Plan N' comment lets the
    creating plan expose the extension point without either implementing
    the chain OR introducing dead code. The consuming plan wires the prop
    at the mount site (one-line change) with zero component-side changes."

requirements-completed: [SRIC-04]

# Metrics
duration: 13min
completed: 2026-08-04
---

# Phase 22 Plan 22-04: SRIC-04 — Create-role surface Summary

**Ashley can now click `+ New role` in the panel header to open a new-role modal (name/description/host picker/chain-checkbox CHECKED-by-default) that provisions `~/.claude/roles/<name>/` on the picked host via a new `POST /roles` route which SSHes + SFTPs the role folder + bounties/ + history.md + a seed-commented `<name>.md` stub the first-wake agent will flesh out.**

## Performance

- **Duration:** ~13 min (both tasks RED→GREEN, single sequential executor session)
- **Started:** 2026-08-04T08:47:19Z (after loading state + reading plan + revision + research + summaries)
- **Completed:** 2026-08-04T09:00:35Z
- **Tasks:** 2 total, both `type=auto tdd=true`. Task 1 = 2 commits (RED test + GREEN feat). Task 2 = 2 commits (RED test + GREEN feat).
- **Test count:** 34 new tests (11 backend + 10 dialog + 3 panel-button + 10 existing regression check).

## Accomplishments

### Backend (Task 1)

- **POST /roles endpoint is live** at `src/backend/database/routes/roles-create.ts` (300 lines). Sequence per RESEARCH F8-B6:
  1. Validate body: `name` via `ROLE_NAME_PATTERN` (imported from `identity-birth-orchestrator`, NOT redefined per DRY + single-source-of-truth); `description` ≤4KB non-empty; `hostId` positive integer.
  2. `resolveHostById(hostId, userId)` — 404 on cross-user / unknown hosts (T-22-04-03 mitigation).
  3. `connectOneShot(host, 5000)` — 502 on connect failure.
  4. Collision probe: `if [ -d "$HOME/.claude/roles/<name>" ] ...` — 409 if "exists".
  5. `mkdir -p "$HOME/.claude/roles/<name>/bounties"` (creates parent + bounties/ atomically; idempotent).
  6. `touch "$HOME/.claude/roles/<name>/history.md"`.
  7. `echo $HOME` → resolve remote home.
  8. `writeMarkdownFileAtomic(conn, <remoteHome>/.claude/roles/<name>/<name>.md, stubBody)` — SFTP tmp+rename with ext_openssh_rename (Pitfall 3 discipline).
  9. Response 201 `{name, description}`.
  10. `try/finally conn.end()` — best-effort cleanup on every exit path.
- **Stub body includes the REVISION seed comment** so the first-wake agent knows to flesh out the file:
  ```
  # box-maintainer

  ## Role

  <description>

  <!-- This role file was auto-generated with only a basic description. On first wake of an agent holding this role, please flesh out the role with standing directives, learned preferences, and a 10,000-foot view of the domain the role covers, then remove this comment. -->
  ```
  Style enforced by Test 6: 4 positive seed phrases required; no "Skynet"; no §2/§3/id skill/SKILL.md; description verbatim under `## Role`.
- **database.ts mounts `rolesCreateRoutes` alongside `rolesListForHostRoutes`** at the same `/roles` base (chained `app.use`). GET falls through to the list router; POST falls through to the create router. Mount order verified: both /roles at lines 1813 & 1818, above /identities at 1819.
- **Nginx dual-config updated** — extended the existing 22-02 `~ ^/roles(/.*)?$` regex block with `client_max_body_size 32k;` (T-22-04-04 DoS belt) in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` per CLAUDE.md load-bearing rule. Regex is method-agnostic so POST /roles rides the same block.
- **API client `createRole(input)`** added to `src/ui/api/identities-api.ts` (+41 lines). Detects 409 conflicts via `err.response.status === 409` and throws typed `RoleAlreadyExistsError` for the dialog to render inline. All other non-2xx surface via existing `handleApiError`.

### Frontend (Task 2)

- **CreateRoleDialog component is live** at `src/ui/sidebar/CreateRoleDialog.tsx` (360 lines). Fields per D-CONTEXT §Frontend surfaces:
  - Name (required, kebab-case-lowercase via `ROLE_NAME_PATTERN /^[a-z0-9-]+$/` matching the backend constant verbatim).
  - Description (required, multi-line textarea per RESEARCH Open Q 4).
  - Host picker (inline listbox — same shape as NewSessionDialog L638-696; RESEARCH F1's extract-to-reusable recommendation is deferred as scope-creep, with `collectAllHosts` + `isFolder` duplicated inline and an F1 comment).
  - `Then create an identity with this role` checkbox — **DEFAULT TRUE** per D-CONTEXT §UX rules.
- **Auto-selects single host on open** (Test 15, mirrors NewSessionDialog L316-322 pattern).
- **canOpen predicate**: `nameValid && descriptionValid && hostValid && !submitting`. Create button disabled until all satisfied.
- **Submit flow**: `createRole` API call → on 201: invoke `onChainToCreateIdentity({role, host})` **IFF** checkbox CHECKED **AND** callback provided (undefined-safe by construction per Test 17b) → optional `onCreated` callback → `onClose`. On 409 `RoleAlreadyExistsError`: `setSubmitError("A role named `<name>` already exists on <host>")` inline (Test 19); dialog stays open. On any other error: generic error message inline.
- **Reset all state on close** via `useEffect` keyed on `[open, flatHosts]` — including checkbox back to CHECKED default (Test 20).
- **`+ New role` launcher button** added to `PrettyConversationsPanel.tsx` header, placed as a sibling of the existing `+ New agent` pencil, using the same `pv-pencil` class treatment for visual parity. Distinct `Users` icon from lucide + `aria-label="New role"` disambiguates. Gated on the SAME `showPencilButton` predicate as the pencil so both buttons share their `onCreateSession`-wired lifecycle. onClick opens `CreateRoleDialog`.
- **CreateRoleDialog is portal-mounted alongside NewSessionDialog** at the bottom of the panel body. `onChainToCreateIdentity` is intentionally passed as `undefined` with an inline comment referencing Plan 22-05 SRIC-05 — the extension point is discoverable to reviewers of that plan.
- **Zero touch to NewSessionDialog surface** (SRIC-02's work). Zero touch to PrettyConversationRow (SRIC-03's work). Zero DB schema changes (locked by CONTEXT.md).

## Task Commits

Each task followed the TDD RED→GREEN gate:

1. **Task 1 RED: failing tests for POST /roles route** — `226aad3` (test)
2. **Task 1 GREEN: add POST /roles route + createRole client + nginx guard** — `32c4fd1` (feat)
3. **Task 2 RED: failing tests for CreateRoleDialog + '+ New role' launcher** — `491a9d9` (test)
4. **Task 2 GREEN: CreateRoleDialog + '+ New role' launcher in panel header** — `1fc6afb` (feat)

_TDD gate sequence verified: RED test commit precedes GREEN feat commit for both tasks. Task 1 RED failed with "Cannot find module './roles-create.js'"; Task 2 RED failed with "Cannot find module './CreateRoleDialog'" + "Unable to find button matching /new role/i"._

**Plan metadata commit:** _(committed after STATE + ROADMAP updates below)_

## Deviations from Plan

### Ashley-approved plan revision (documented in the plan file as REVISION 2026-08-04 HTML comment above Task 1)

**1. Role file stub now includes a seed comment for the first-wake agent to flesh out**

- **Approved during:** 22-02 Task 2 checkpoint (2026-08-04, Ashley), applied to 22-04 Task 1 per same-pattern extension. Plan-checker gate on this revision was baked into the RED test assertions BEFORE writing the GREEN implementation.
- **Original spec:** Task 1's Test 6 stub assertion checked only for `^# box-maintainer\n\n## Role\n\nx\n$/` (bare stub, no seed).
- **Revised spec:** Test 6 also asserts (a) 4 positive seed phrases present: `This role file was auto-generated`, `On first wake of an agent holding this role`, `flesh out the role`, `remove this comment`; (b) NO "Skynet" (case-insensitive grep fails); (c) NO `§2` / `§3` / `id skill` / `SKILL.md` (case-insensitive); (d) description verbatim under `## Role`. Implementation exports `ROLE_STUB_SEED_COMMENT` constant and interpolates it into the stub body after the description block.
- **Impact:** +1 module-level constant, +4 test assertions in Test 6, +1 line of stub body. Zero cascading changes to other tests or routes.
- **Rationale (Ashley, from 22-02 checkpoint):** fewer moving parts in Skynet, cleaner boundary (Skynet does file setup, agent does semantic fleshing-out on first wake), matches the identity-file seed pattern from 22-02 Task 3.

### No auto-fixed issues

All 11 backend tests + 10 dialog tests + 3 panel-button tests passed on first GREEN run. TypeScript check clean. Backend build clean. Zero Rule 1-3 fix cycles required. Zero cascading changes to pre-existing tests (verified: 22-02's roles-list-for-host.test.ts still passes 10/10; PrettyConversationsPanel.test.tsx pre-existing 2 failures unchanged).

### One deferred-items log entry

**2. Pre-existing PrettyConversationsPanel tests 5 + 8 use wrong pencil-button label regex — pre-existing, NOT caused by this plan**

- **Found during:** Task 2 GREEN verification, `git stash` baseline check confirmed pre-existing (2 failed both before AND after Task 2).
- **Issue:** `PrettyConversationsPanel.test.tsx` Tests 5 + 8 look up the pencil via `queryByRole("button", { name: /new session/i })` but the actual `aria-label` is `"New agent"` (from `t("nav.newSession", { defaultValue: "New agent" })` at PrettyConversationsPanel.tsx:611). Same class of test-coverage bug documented in 22-02-SUMMARY.md deviations for NewSessionDialog Tests 5-10.
- **Action:** Appended a new section to `.planning/phases/22-.../deferred-items.md` documenting the pair. Recommended future-work fix (`/new agent|new session/i` regex, ~4-line diff) is out of SRIC-04 scope.
- **NOT fixed:** Rule 3 boundary — pre-existing failure orthogonal to SRIC-04 scope. My new Test 21 launcher tests use `/new role/i` (correct-label regex against the actual `"New role"` aria-label), so they don't inherit the same class of bug.

**Total deviations:** 1 Ashley-approved plan revision (seed comment, baked into RED test assertions before GREEN); 1 deferred-items log entry (out-of-scope pre-existing failure). Zero auto-fixed issues, zero scope creep.

## Issues Encountered

- **STATE.md is very large (~50KB — recurring issue noted in 22-01 + 22-02 summaries).** Used SDK verbs (`state.advance-plan`, `state.update-progress`, `state.record-metric`, `state.add-decision`, `state.record-session`) instead of raw edits.
- **2 pre-existing PrettyConversationsPanel test failures + 6 pre-existing NewSessionDialog test failures** — unchanged by this plan; all documented in `deferred-items.md`. Zero net regression.
- **HTMLCanvasElement.getContext() warning** — jsdom limitation, appears in the panel-button test output. Not related to any assertion; the tests pass despite the warning.

## User Setup Required

None — no new environment variables, no new npm packages, no dashboard configuration.

**Post-deploy manual verification (deferred to Phase 22 UAT per ROADMAP):**
1. Ashley clicks `+ New role` in the panel header → CreateRoleDialog opens with the chain checkbox CHECKED by default.
2. Ashley picks a host, types a kebab-case role name + a description, clicks Create → 201 response, dialog closes.
3. Ashley SSHs to the target host and verifies `~/.claude/roles/<name>/` exists with `bounties/` subdir, empty `history.md`, and a `<name>.md` stub containing the description under `## Role` PLUS the wake-up seed comment.
4. Ashley clicks `+ New role` again with the same name → 409 conflict → inline "A role named `<name>` already exists on <host>" renders, dialog stays open.
5. (Phase 22-05 gate) When the checkbox is CHECKED and Plan 22-05 has landed, submitting the create-role form should open NewSessionDialog with role+host pre-filled.

## Next Phase Readiness

**Wave 2 siblings unblocked:**
- **22-05 (Chain create-role → create-identity / SRIC-05):** The chain hook (`onChainToCreateIdentity`) is a documented extension point on `CreateRoleDialog`. Plan 22-05 wires it at the panel mount (`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`) with a ~5-line change: replace the explicit `undefined` on the `CreateRoleDialog` mount with a handler that captures the pre-fill values, opens `NewSessionDialog`, and threads role+host into its initial-state props. Zero touch to `CreateRoleDialog.tsx` needed. Test 17 (chain callback invocation with CHECKED + provided) is the contract Plan 22-05's frontend test can piggyback on.
- **22-03 (Clone flow / SRIC-03):** Independent of this plan. Can proceed without dependency on 22-04.

**Wave 3 (22-06 Role tab)** consumes the role folder + `<name>.md` that this plan creates. Post-Task 1, freshly-created roles have a well-formed stub file that `identity:get-role-file` (Plan 22-06) can read via the two-step from 22-01.

**Manual UAT gate (deferred to Phase 22 UAT per ROADMAP):** end-to-end fleet-side verification requires a live host with SSH access; automated coverage stops at the mocked-SSH boundary.

---

## Self-Check: PASSED

**Files created/modified verified:**
```
FOUND: src/backend/database/routes/roles-create.ts
FOUND: src/backend/database/routes/roles-create.test.ts
FOUND: src/backend/database/database.ts (modified)
FOUND: src/ui/api/identities-api.ts (modified)
FOUND: src/ui/sidebar/CreateRoleDialog.tsx
FOUND: src/ui/sidebar/CreateRoleDialog.test.tsx
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (modified)
FOUND: src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
FOUND: docker/nginx.conf (modified)
FOUND: docker/nginx-https.conf (modified)
FOUND: .planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/deferred-items.md (modified)
```

**Commits verified (git log --oneline):**
```
FOUND: 226aad3 test(22-04): add failing tests for POST /roles route              (Task 1 RED)
FOUND: 32c4fd1 feat(22-04): add POST /roles route + createRole client + nginx guard  (Task 1 GREEN)
FOUND: 491a9d9 test(22-04): add failing tests for CreateRoleDialog + '+ New role' launcher  (Task 2 RED)
FOUND: 1fc6afb feat(22-04): CreateRoleDialog + '+ New role' launcher in panel header  (Task 2 GREEN)
```

**All plan acceptance criteria pass:**

Task 1:
- All 10 tests in roles-create.test.ts pass (actually 11 — Test 2b added for path-traversal coverage per threat T-22-04-02) ✓
- `grep -c 'app.use("/roles"' src/backend/database/database.ts` returns 2 ✓ (list + create at same base)
- Route mount ordering: `awk` returns 0 (both /roles above /identities: lines 1813, 1818, 1819) ✓
- `grep -c "writeMarkdownFileAtomic" src/backend/database/routes/roles-create.ts` returns 10 ≥ 1 ✓
- `grep -c "ROLE_NAME_PATTERN" src/backend/database/routes/roles-create.ts` returns ≥ 1 ✓ (imported, not redefined)
- `grep -c "export const ROLE_NAME_PATTERN" src/backend/database/routes/roles-create.ts` returns 0 ✓ (NOT re-exported)
- `grep -c 'location.*roles' docker/nginx.conf` returns 1 ✓; same for nginx-https.conf ✓
- `grep -c "export.*createRole\|export.*RoleAlreadyExistsError" src/ui/api/identities-api.ts` returns 2 ≥ 1 ✓
- `grep -c "resolveHostById" src/backend/database/routes/roles-create.ts` returns 4 ≥ 1 ✓
- `git diff package.json` returns empty ✓

Task 2:
- All 10 tests in CreateRoleDialog.test.tsx pass ✓
- All 3 tests in PrettyConversationsPanel.new-role-button.test.tsx pass ✓
- `grep -c "export.*CreateRoleDialog" src/ui/sidebar/CreateRoleDialog.tsx` returns 2 ≥ 1 ✓ (interface + component)
- `grep -c "thenCreateIdentity.*useState.*true\|useState<boolean>(true)" src/ui/sidebar/CreateRoleDialog.tsx` returns 1 ✓
- `grep -c "ROLE_NAME_PATTERN.*=.*\[a-z0-9-\]" src/ui/sidebar/CreateRoleDialog.tsx` returns 1 ✓ (regex matches backend)
- `grep -c "createRole" src/ui/sidebar/CreateRoleDialog.tsx` returns 12 ≥ 2 ✓
- `grep -c "CreateRoleDialog" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 10 ≥ 2 ✓
- `grep -c "onChainToCreateIdentity" src/ui/sidebar/CreateRoleDialog.tsx` returns 5 ≥ 2 ✓ (prop declaration + call site)
- `grep -c "22-05\|SRIC-05" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 6 ≥ 1 ✓
- `npx tsc --noEmit` passes with no new errors ✓
- `git diff src/ui/sidebar/NewSessionDialog.tsx` returns empty ✓

Overall:
- `npm run build:backend` clean ✓
- 34 in-scope tests pass (11 backend + 10 dialog + 3 panel + 10 sibling regression roles-list-for-host) ✓
- 8 pre-existing failures unchanged (6 NewSessionDialog + 2 PrettyConversationsPanel — all documented in deferred-items.md) ✓
- Zero net regression ✓
- Nginx dual-config parity verified: `/roles` regex block present in BOTH nginx.conf and nginx-https.conf with client_max_body_size 32k ✓

## TDD Gate Compliance

Task 1: `test` (RED @ 226aad3) → `feat` (GREEN @ 32c4fd1) ✓
Task 2: `test` (RED @ 491a9d9) → `feat` (GREEN @ 1fc6afb) ✓

Both tasks followed the fail-fast rule — RED phase confirmed failure ("Cannot find module") BEFORE writing GREEN. No test-that-passes-unexpectedly regressions.

---
*Phase: 22-skynet-ui-parity-with-the-role-identity-paradigm*
*Completed: 2026-08-04*
