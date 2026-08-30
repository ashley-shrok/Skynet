---
phase: 22-skynet-ui-parity-with-the-role-identity-paradigm
plan: 01
subsystem: backend
tags: [skynet, roles, backend, ssh, two-step, artifact-reader, js-yaml, frontmatter]

# Dependency graph
requires:
  - phase: 18-identity-modal-full-editability-across-all-tabs
    provides: readIdentityBounties/readIdentityHistory public signature + WS handler wiring in claude-session-server.ts (L1815+/L1985+)
provides:
  - resolveRoleForIdentity(conn, identityKey) helper — the SINGLE source of truth for the identity-file → role-frontmatter → role-name two-step; consumed by every role-scoped op in Wave 2+
  - extractRoleFromMarkdown(md) — regex-bounded YAML frontmatter parse (js-yaml.load); returns null on any failure so callers can null-check without try/catch
  - getLocalRolesRoot() — ROLES_HOST_DIR env var + $HOME/.claude/roles fallback; parallel to getLocalIdentitiesRoot for the LOCAL bind-mount branch
  - readIdentityBounties / readIdentityHistory / writeIdentityBounty{Priority,Status,Pinned,Fields} / archiveIdentityBounty / deleteIdentityBounty / readIdentityPinnedBountyCount now transparently do the two-step (public signatures unchanged)
affects: [22-03-clone, 22-06-role-tab, any future role-scoped SSH op]

# Tech tracking
tech-stack:
  added: []  # No new npm packages — js-yaml (^4.1.1) already at package.json:58, already used in src/backend/ssh/opkssh-auth.ts:14
  patterns:
    - "Backend-internal two-step (identity file → role: frontmatter → role artifact) — frontend contract stays (identityKey, hostId); the role name never crosses the wire"
    - "resolveRoleForIdentity + IDENTITY_KEY_RE defense-in-depth gate on extracted role — role is shell-interpolated into SSH exec commands, so re-validating with the same regex that guards identityKey is a hard requirement (threat T-22-01-01/02)"
    - "No-fallback semantics: helper THROWS on missing role/frontmatter (D-CONTEXT LOCKED 2026-08-04 — Ashley: no such identities exist post-migration; graceful fallback = dead code = plan-checker BLOCK)"
    - "Hoisted-slug-guard pattern: IDENTITY_SLUG_RE fires at the TOP of every bounty write helper so a bad slug can't slip past a LOCAL-branch path.join (mirrors deleteIdentityBounty's earlier pattern-drift call-out)"

key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.two-step.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts

key-decisions:
  - "Reused existing js-yaml (^4.1.1) — already a direct dependency, already used in production at src/backend/ssh/opkssh-auth.ts:14. Zero new npm packages. (Threat T-22-01-SC: no supply-chain audit needed.)"
  - "Regex-bounded frontmatter block (/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/) then yaml.load on the extracted block — never yaml.load the whole markdown body. Bounds js-yaml exposure (T-22-01-05: billion-laughs upper bound) + handles CRLF line endings from Windows editors."
  - "resolveRoleForIdentity re-validates the extracted role against IDENTITY_KEY_RE (defense-in-depth). Role is shell-interpolated into SSH cat/ls/cd commands; without the second gate a hostile role: value in a compromised identity file could inject shell code."
  - "Scope expansion (Rule 2/3 deviation): repointed ALL bounty write/count helpers (writeIdentityBountyPriority/Status/Pinned/Fields, archiveIdentityBounty, deleteIdentityBounty, readIdentityPinnedBountyCount) — not just the two readers listed in Task 2's <action>. Without this, writes would silently land in the empty identity folder while reads pulled from the role folder (SRIC-01 would be functionally broken)."
  - "Hoisted IDENTITY_SLUG_RE guard to the TOP of every bounty write helper (was previously inside the REMOTE branch only). Same pattern deleteIdentityBounty added when it first documented the drift. Fixes a pre-existing LOCAL-branch slug-validation gap in writeIdentityBountyFields."

patterns-established:
  - "Two-step role resolution: always resolveRoleForIdentity BEFORE the branch split, so both LOCAL and REMOTE branches share the same role → path substitution logic. Never do the two-step twice for a single op."
  - "Test-fixture layout for role-scoped tests: temp IDENTITIES_HOST_DIR + ROLES_HOST_DIR mkdtemp pair per test, with an identity file (role: frontmatter) seeded under the identities root and the artifact tree under the roles root. Mirrors the fleet on-disk shape post-migration."

requirements-completed: [SRIC-01]

# Metrics
duration: 24min
completed: 2026-08-04
---

# Phase 22 Plan 01: Repoint IdentityModal Bounties + History to role folder via backend two-step Summary

**Backend readers/writers for bounty + history artifacts now transparently do the identity-file → `role:` frontmatter → role-folder two-step; frontend contract stays `(identityKey, hostId)` — zero UI code touched, SRIC-01 fixed end-to-end without a wire-format bump.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-08-04T07:01:00Z (approx — before first Read call)
- **Completed:** 2026-08-04T07:25:00Z
- **Tasks:** 2 (both `type=auto tdd=true`)
- **Files modified:** 2 (identity-artifact-reader.ts + new two-step.test.ts) + 5 sibling test fixtures updated (deviation-driven, see below)

## Accomplishments

- **Two-step helpers live in identity-artifact-reader.ts** and are exported so Wave 2 plans (22-03 clone, 22-06 role tab) can `import { resolveRoleForIdentity, extractRoleFromMarkdown, getLocalRolesRoot }` verbatim.
- **IdentityModal Bounties + History tabs render role-folder contents.** The two callers in claude-session-server.ts (identity:list-bounties L1815+, identity:get-history L1985+) got the fix "for free" — no diff to server.ts because signatures didn't change.
- **All 9 bounty write/count helpers repointed** to the role folder (deviation Rule 2/3, see below). Toggling a bounty's priority/status/pinned via the identity modal now persists correctly instead of silently writing to the empty identity folder.
- **New `identity-artifact-reader.two-step.test.ts` (16 tests)** covers every branch: extractRoleFromMarkdown edge cases (typical / missing block / no role key / empty value / CRLF), resolveRoleForIdentity happy path + no-role throws + shell-safety gate, readIdentityBounties/History REMOTE + LOCAL branches with the new role-folder paths, throw propagation on missing frontmatter, and a signature-drift smoke check.
- **All 42 tests across 7 identity-artifact-reader test files pass** (the 5 existing bounty test files were updated in lock-step to seed identity file + role folder fixtures).

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for two-step helpers** — `92660e8` (test)
2. **Task 1 GREEN: add three helpers (resolveRoleForIdentity + extractRoleFromMarkdown + getLocalRolesRoot)** — `461b556` (feat)
3. **Task 2 GREEN: repoint bounty + history reads/writes to role folder via two-step** — `6140903` (feat)

_TDD gate sequence: RED test commit precedes GREEN feat commit (identity-artifact-reader.two-step.test.ts wrote 15/16 failing tests at 92660e8; tests 1-9 flipped to green at 461b556 after helpers landed; tests 10-16 flipped to green at 6140903 after the readers/writers were repointed.)_

**Plan metadata commit:** _(committed after STATE + ROADMAP updates below)_

## Files Created/Modified

**Created:**
- `src/backend/claude-session/identity-artifact-reader.two-step.test.ts` — 16-test file covering all three helpers + readIdentityBounties/History two-step behavior.

**Modified (in-plan scope):**
- `src/backend/claude-session/identity-artifact-reader.ts` — added 3 exports (extractRoleFromMarkdown, resolveRoleForIdentity, getLocalRolesRoot); imported js-yaml; modified readIdentityBounties + readIdentityHistory to do the two-step. Also (per deviation, see below) repointed writeIdentityBountyPriority, writeIdentityBountyStatus, writeIdentityBountyPinned, writeIdentityBountyFields, archiveIdentityBounty, deleteIdentityBounty, readIdentityPinnedBountyCount.

**Modified (deviation-driven — test fixtures updated to match new role-folder layout):**
- `src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts` — beforeEach now mkdtemp's both IDENTITIES_HOST_DIR + ROLES_HOST_DIR, seeds the identity file with `role: box-maintainer` frontmatter, and writes bounty fixtures under ROLES_HOST_DIR/<role>/bounties.
- `src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts` — same fixture-layout update.
- `src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts` — same fixture-layout update.
- `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` — same fixture-layout update.
- `src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts` — same fixture-layout update.

**Untouched (per D-CONTEXT LOCKED):**
- `src/backend/claude-session/claude-session-server.ts` — zero diff. All WS handler call sites keep the (identityKey, hostId) shape.
- Every frontend file. IdentityModal.tsx / HistoryTab.tsx / BountyCard.tsx / etc. — untouched.

## Decisions Made

- **Reused existing js-yaml (^4.1.1)** — direct dependency at package.json:58, already used at src/backend/ssh/opkssh-auth.ts:14. Zero new packages; no legitimacy audit needed (T-22-01-SC accepted).
- **Regex-bounded frontmatter parse** — `/^---\r?\n([\s\S]*?)\r?\n---/` bounds the js-yaml exposure and CRLF-tolerates identity files touched by Windows editors. Extraction returns null on any failure (missing block, missing role key, empty/non-string value, parse error); the caller decides fatality.
- **THROW on missing role, never fall back** (D-CONTEXT LOCKED 2026-08-04) — matches Ashley's non-negotiable: no fleet identity lacks `role:` frontmatter post-migration; a silent empty result would hide data corruption instead of surfacing it. Tests 6, 14, 15 pin this behavior; the throw message includes the identityKey for grep-ability in ops logs.
- **Defense-in-depth IDENTITY_KEY_RE re-validation on extracted role** — role is shell-interpolated into SSH exec commands; without the second gate a hostile role: value from a compromised identity file could inject shell code. Test 7 pins this.
- **Local roles root env var: `ROLES_HOST_DIR`** — parallels `IDENTITIES_HOST_DIR`. Not yet set in production docker compose; when tina's box needs a role bind-mount, adding it becomes a compose-side change with no code work.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 + Rule 3 - Missing Critical + Blocking] Repointed ALL bounty write/count helpers to the role folder (not just the two readers Task 2 explicitly enumerated)**

- **Found during:** Task 2 verification. Plan's Task 2 `<action>` step 1 said "modify the internals of BOTH readIdentityBounties and readIdentityHistory"; the plan's own grep-based acceptance criterion (`returns 0 for identities/${identityKey}/bounties|history.md`) returned **6** immediately after that narrow fix.
- **Issue:** `writeIdentityBountyPriority`, `writeIdentityBountyStatus`, `writeIdentityBountyPinned`, `writeIdentityBountyFields`, `archiveIdentityBounty`, `deleteIdentityBounty`, and `readIdentityPinnedBountyCount` all still wrote to `~/.claude/identities/<key>/bounties/…`. Post fleet migration these folders are empty — user clicks on the modal (edit priority, toggle pinned, archive, delete, per-row pinned-count badge) would silently no-op or fail. SRIC-01's must_haves.truths ("IdentityModal's Bounties tab renders the same host's ~/.claude/roles/<role>/bounties/ contents") is not satisfied if writes go elsewhere than reads.
- **Fix:** Applied the same two-step (`resolveRoleForIdentity` at the top of each function, path substitution `identities/${identityKey}` → `roles/${role}` in both LOCAL and REMOTE branches). Also updated 5 sibling test fixture files to seed both an identity file (with role frontmatter) and the role folder.
- **Files modified:** identity-artifact-reader.ts (7 additional functions repointed); count-bounties + archive-bounty + delete-bounty + write-bounty-status + write-bounty-pinned test files (fixture layout).
- **Verification:** All 42 tests across 7 test files pass. `grep` acceptance criterion returns 0. `npm run build:backend` succeeds. `npx tsc --noEmit` clean.
- **Committed in:** `6140903` (Task 2 GREEN commit, along with the plan-enumerated readers).

**2. [Rule 2 - Missing Critical] Hoisted IDENTITY_SLUG_RE guard to the TOP of every bounty write helper**

- **Found during:** Task 2, after repointing writes. The write-bounty-pinned test file had an existing case "rejects invalid slug on the remote branch before any SSH call" — pre-two-step, the slug guard fired only inside the REMOTE branch (after `if (conn === null)`), so an invalid slug rejected before any SSH round-trip. Post-two-step, `resolveRoleForIdentity` would fire BEFORE the slug guard (since two-step happens before the branch split), so invalid slugs would trigger a real SSH connection attempt (and, on a fake test conn, throw an unrelated error).
- **Issue:** Pre-existing pattern drift — the LOCAL branch of writeIdentityBountyPriority/Status/Pinned/Fields had NO slug validation at all. A crafted slug like `../../etc/passwd` in a LOCAL-branch call would traverse outside the role folder via path.join. Not exploitable via the WS handler (which validates at its edge) but a defense-in-depth gap.
- **Fix:** Hoisted `IDENTITY_SLUG_RE.test(bountySlug)` guard to the TOP of writeIdentityBountyPriority, writeIdentityBountyStatus, writeIdentityBountyPinned, writeIdentityBountyFields, archiveIdentityBounty. Removed the now-redundant REMOTE-branch guards. Also hoisted `IDENTITY_KEY_RE.test(identityKey)` in writeIdentityBountyFields for symmetry. Matches deleteIdentityBounty's pre-existing pattern (which had a comment explicitly calling out the drift).
- **Files modified:** identity-artifact-reader.ts.
- **Verification:** write-bounty-pinned's "rejects invalid slug on the remote branch before any SSH call" test still passes. write-bounty-status's "rejects an unknown status" tests still pass. TypeScript check clean.
- **Committed in:** `6140903` (Task 2 GREEN commit).

**3. [Rule 1 - Bug] Fixed test 6's `mockResolvedValueOnce` when the test made two calls to the mocked function**

- **Found during:** Task 2 verification (mid-development).
- **Issue:** Test 6 called `resolveRoleForIdentity(conn, "moxie")` twice (once per `rejects.toThrow` assertion) but the mock was set with `mockResolvedValueOnce("")` — the second call returned undefined, throwing "Cannot read properties of undefined (reading 'match')" instead of the expected role-missing error.
- **Fix:** Changed to `mockResolvedValue("")` so both invocations return the empty stub.
- **Files modified:** identity-artifact-reader.two-step.test.ts.
- **Verification:** Test 6 now passes.
- **Committed in:** `6140903` (part of Task 2 GREEN commit, since the test lived in a file that was still being iterated for Task 2's assertions).

**4. [Rule 1 - Bug] Fixed test 10's overbroad command filter**

- **Found during:** Task 2 verification (mid-development).
- **Issue:** Test 10 filtered captured SSH commands via `c.includes("/bounties") && !c.includes("archive")`. Both the open-bounties command AND the archive-bounties command contain the string "archive" (the open command's shell loop body has `[ "$d" = "archive" ] && continue`), so the filter matched nothing and `bountiesCmd` was undefined.
- **Fix:** Narrowed the filter to key on the cd-target path (`'.claude/roles/box-maintainer/bounties" '` — trailing space distinguishes the openCmd's cd target from the archiveCmd's).
- **Files modified:** identity-artifact-reader.two-step.test.ts.
- **Verification:** Test 10 now passes.
- **Committed in:** `6140903`.

---

**Total deviations:** 4 auto-fixed (2 missing critical/blocking, 2 bugs)
**Impact on plan:** Deviations 1 + 2 substantially expanded the scope of changes to identity-artifact-reader.ts (7 additional helpers repointed, 5 sibling test files updated) but are essential for SRIC-01 to work end-to-end — the plan's own grep acceptance criterion catches this scope. Deviations 3 + 4 are test-code bugs I introduced when writing the RED tests; they were caught by the vitest run and fixed inline before commit. Zero scope creep beyond the identity-artifact-reader.ts + its test files (frontend / claude-session-server.ts untouched, per D-CONTEXT).

## Issues Encountered

- **STATE.md is very large (~50KB)** — reading the file exceeded the tool's 25000-token cap. Worked around by scoping reads to specific line ranges + grepping for known markers. STATE.md updates below use the SDK's dedicated verbs (`state.advance-plan`, `state.update-progress`, etc.) instead of raw edits, which keeps this manageable.

## User Setup Required

None — no new environment variables, no new npm packages, no dashboard configuration. `ROLES_HOST_DIR` env var is documented but not required (falls back to `$HOME/.claude/roles` if unset). Docker compose config unchanged.

## Next Phase Readiness

**Wave 2 unblocked:**
- **22-06 (Role tab)** can now `import { resolveRoleForIdentity } from "./identity-artifact-reader.js"` — the exact helper it needs for `identity:get-role-file` / `identity:update-role-file` WS ops.
- **22-03 (Clone)** can call `resolveRoleForIdentity` inside the clone endpoint to read the source identity's role for the destination fleet-folder creation.

**Wave 1 sibling (22-02 birth writes `role:` frontmatter)** does not consume this plan's helpers directly — it's additive on the write side. But its correctness gates SRIC-01's end-to-end value: without 22-02, freshly-birthed identities would fail `resolveRoleForIdentity`'s throw guard.

**Manual UAT gate (deferred to Phase 22 UAT per ROADMAP):** Ashley clicking through IdentityModal → Bounties tab → seeing bounties from the role folder. Cannot be automated because it requires a real fleet identity + role folder pair on a live host.

---

## Self-Check: PASSED

**Files created/modified verified:**
```
FOUND: src/backend/claude-session/identity-artifact-reader.ts
FOUND: src/backend/claude-session/identity-artifact-reader.two-step.test.ts
FOUND: src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts (modified)
FOUND: src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts (modified)
FOUND: src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts (modified)
FOUND: src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts (modified)
FOUND: src/backend/claude-session/identity-artifact-reader.write-bounty-pinned.test.ts (modified)
```

**Commits verified:**
```
FOUND: 92660e8 test(22-01): add failing tests for two-step role resolution helpers
FOUND: 461b556 feat(22-01): add two-step role resolution helpers to identity-artifact-reader
FOUND: 6140903 feat(22-01): repoint bounty + history reads/writes to role folder via two-step
```

**Acceptance criteria all pass:**
- 3 helpers exported ✓ (grep returned 3)
- js-yaml imported 1× ✓
- `IDENTITY_KEY_RE.test(role)` present ✓ (1×)
- Throw message "no role" present ✓ (2×)
- 0 non-comment identity-scoped bounty/history paths ✓
- 9 role-scoped bounty/history paths ✓ (well above ≥2 minimum)
- `resolveRoleForIdentity(conn, identityKey)` called 9× ✓ (well above ≥2 minimum)
- `git diff src/backend/claude-session/claude-session-server.ts` empty ✓
- `npx tsc --noEmit` clean ✓
- `npm run build:backend` succeeds ✓
- All 42 tests across 7 test files pass ✓

---
*Phase: 22-skynet-ui-parity-with-the-role-identity-paradigm*
*Completed: 2026-08-04*
