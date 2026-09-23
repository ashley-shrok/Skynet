---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 06
subsystem: backend
tags: [write-path, auto-tag, roles-create, multi-user, tdd]
dependency_graph:
  requires:
    - "129-01 (Foundations — provides isHostMultiUser + getUsernameForUserId + RawCosmetics.users? + gate)"
  provides:
    - "POST /roles auto-tags creator's Skynet username in new role file's users: frontmatter list when target host has >1 Skynet user with access"
    - "Silent single-user hosts (no users: key written → pre-129 file shape verbatim)"
    - "Fail-open on username-lookup failure with roles_create_username_lookup_failed warn log seam"
    - "roles_create_auto_tagged info log seam for auto-tag success ops visibility"
  affects:
    - "Phase 129 Wave 3 write-path completion (pairs with 129-07 identity-birth auto-tag, still pending)"
    - "Phase 129 Wave 2 read-path gates (129-02..05) can now observe realistic auto-tagged shared-role files end-to-end once 129-07 lands"
tech-stack:
  added: []
  patterns:
    - "Pre-yaml.dump cosmetics-dict mutation (mirrors PATTERNS.md § 'roles-create.ts (MODIFY — POST / L541-563)' auto-tag insertion pattern)"
    - "Collision-probe → auto-tag → yaml.dump ordering invariant (Pitfall 5 + D-5 lock)"
    - "Fail-open write-side auto-tag (PATTERNS.md exception to read-path fail-open discipline)"
key-files:
  created: []
  modified:
    - src/backend/database/routes/roles-create.ts
    - src/backend/database/routes/roles-create.test.ts
decisions:
  - "Auto-tag inserted BEFORE hasCosmetics check + yaml.dump (L583, between collision-probe 409 at L504 and yaml.dump at L619) — the existing dump picks up users: naturally without touching the dump call; canonical options preserved byte-for-byte."
  - "Single-mutation site enforced (grep for 'cosmetics as Record<string, unknown>).users = ' returns exactly 1 hit) — Pitfall 5 lock against a future refactor that could accidentally consolidate auto-tag into a shared 'add username to existing frontmatter' helper reachable from an existing-file code path."
  - "Fail-open on getUsernameForUserId returning null on a multi-user host — chose over fail-closed because a wrong-user auto-tag would be a shape §'would make it wrong' violation bullet 3. File still written, loud warn log at roles_create_username_lookup_failed."
  - "Case-preserved username (Pitfall 7 lock) — no toLowerCase / toUpperCase anywhere in the branch. Matches Plan 01 gate discipline."
  - "Structured info log at auto-tag success (roles_create_auto_tagged) per box-maintainer directive — gives ops visibility into which shared roles got auto-tagged when, without grepping frontmatter files across the fleet."
metrics:
  duration_seconds: 230
  duration_human: "~4 min executor time (RED + GREEN, both TDD gates)"
  completed_date: 2026-09-23
  new_tests: 7
  total_tests_run: 45
---

# Phase 129 Plan 06: POST /roles auto-tag on multi-user hosts Summary

**One-liner:** Implements the write-side half of D-4 for role creation — `POST /roles` inserts `users: [creatorUsername]` into the new role file's YAML frontmatter iff `isHostMultiUser(hostId)` returns true; single-user hosts stay silent (no `users:` key, pre-129 byte-identical file), the branch is inline in the initial-write path only (never touches existing files per Pitfall 5), and fails open with a loud warn log if `getUsernameForUserId` returns null on a multi-user host.

## What Shipped

### 1. Auto-tag branch in `roles-create.ts` POST /

- **Insertion:** L583 — after the collision-probe 409 at L504 and before the `hasCosmetics` check + `yaml.dump` at L619.
- **Imports:** Added `import { isHostMultiUser, getUsernameForUserId } from "../../utils/host-user-counter.js"` (dependency-free primitives from Plan 01).
- **Contract:**
  ```typescript
  const isMultiUser = await isHostMultiUser(hostId);
  if (isMultiUser) {
    const creatorUsername = await getUsernameForUserId(userId);
    if (creatorUsername) {
      (cosmetics as Record<string, unknown>).users = [creatorUsername];
      sshLogger.info("roles-create: auto-tagged creator on multi-user host", {
        operation: "roles_create_auto_tagged",
        role: name,
        hostId,
        creatorUsername,
      });
    } else {
      sshLogger.warn(
        "roles-create: username lookup failed — auto-tag skipped",
        { operation: "roles_create_username_lookup_failed", userId, hostId },
      );
    }
  }
  ```
- **yaml.dump byte-shape:** The `yaml.dump(stringifyColorHueForYaml(cosmetics), { sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false })` call at L619 is **byte-identical** to pre-edit — the only difference is that the input `cosmetics` dict may now carry a `users` key, which the dump serializes verbatim per its existing shape.
- **`yaml.dump(` invocation count** unchanged: 1 pre-edit → 1 post-edit (verified via git-show grep).

### 2. Auto-tag tests in `roles-create.test.ts`

New `describe("Phase 129: auto-tag on multi-user hosts", ...)` block with 7 behavior tests (A-G):

| Test | Description | Assertion |
|------|-------------|-----------|
| A | Single-user host → NO users: key; getUsernameForUserId NOT called | Efficiency invariant + shape §"invisible in majority case" |
| B | Multi-user host, direct-user share → users: [user] | Format-agnostic yaml.load parse; info log seam echoed |
| C | Multi-user host via RBAC-role share → auto-tag fires | Assumption A6 lock at the write side |
| D | Multi-user host + getUsernameForUserId returns null → auto-tag SKIPPED, warn log fires, file still written | Fail-open per PATTERNS.md write-side exception |
| E | Existing file → 409 short-circuits; isHostMultiUser + getUsernameForUserId + writeMarkdownFileAtomic all NOT called | Pitfall 5 lock via absence-of-call assertion |
| F | yaml.dump byte-shape preserved (sortKeys:false key order title→colorHue→voice→users; lineWidth:-1 no wrap under 500 chars) | Canonical options preserved |
| G | Case-preservation (the user, not user) | Pitfall 7 lock; info log echoes case-preserved creatorUsername |

Also added `vi.mock("../../utils/host-user-counter.js", ...)` with default `isHostMultiUser → false` and `getUsernameForUserId → null` so the 22 pre-existing tests stay on the single-user code path (zero regression).

Also added `vi.mock("../../utils/logger.js", ...)` so the tests can assert `sshLogger.info` (Test B, G) and `sshLogger.warn` (Test D) seam calls.

## TDD Gate Compliance

| Gate | Commit | Verification |
|------|--------|--------------|
| RED | `9bdbeedf` — `test(129-06): add RED tests for POST /roles auto-tag on multi-user hosts` | 6/7 new tests fail; Test E passes trivially (absence-of-call assertion works even when the code doesn't exist yet). This is the CORRECT expected RED — Test E's whole point is asserting the auto-tag branch is NOT reached. |
| GREEN | `566dbe82` — `feat(129-06): auto-tag creator on POST /roles for multi-user hosts` | All 7 new + 22 pre-existing + 16 host-user-counter transitives = 45/45 pass. |
| REFACTOR | none needed — the branch is 21 lines including comments; no repetition. |

## Verification

### Automated

```bash
npx vitest related --run \
  src/backend/database/routes/roles-create.test.ts \
  src/backend/database/routes/roles-create.ts
```

Result: **45 tests passed / 0 failed** (Test Files: 2 passed / 2 total; Duration ~1.07s).

TypeScript check:

```bash
npx tsc --noEmit
```

Result: exit 0.

### Acceptance criteria (grep-verified)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Single isHostMultiUser call site | `grep -n "isHostMultiUser(hostId)" src/backend/database/routes/roles-create.ts` | 1 hit | 1 hit (L583) |
| Single getUsernameForUserId call site | `grep -n "getUsernameForUserId(userId)" src/backend/database/routes/roles-create.ts` | 1 hit | 1 hit (L585) |
| Both structured log seams present | `grep -n "roles_create_username_lookup_failed\|roles_create_auto_tagged" src/backend/database/routes/roles-create.ts` | ≥2 hits | 2 hits (L589 auto_tagged, L598 lookup_failed) |
| Single write-mutation (Pitfall 5) | `grep -n "cosmetics as Record<string, unknown>).users = " src/backend/database/routes/roles-create.ts` | 1 hit | 1 hit (L587) |
| Auto-tag AFTER 409, BEFORE yaml.dump | `grep -n "isHostMultiUser(hostId)\|yaml.dump(\|res.status(409)"` line ordering | 409 < isHostMultiUser < yaml.dump | 409 at L504 → isHostMultiUser at L583 → yaml.dump at L619 |
| yaml.dump( invocation count stable | `git show HEAD~2:src/backend/database/routes/roles-create.ts \| grep -c "yaml\.dump("` vs current | equal | 1 pre → 1 post |

## Line-count Deltas

| File | Type | Lines added |
|------|------|-------------|
| src/backend/database/routes/roles-create.ts | modified | +64 (imports + 42-line branch including full comment block) |
| src/backend/database/routes/roles-create.test.ts | modified | +244 (new mock stack + 7-test describe block) |

## Deviations from Plan

None — the plan was executed exactly as written. No Rule 1 (bug), Rule 2 (missing critical functionality), Rule 3 (blocking issue), or Rule 4 (architectural change) deviations were needed.

### Minor implementation notes (NOT deviations from the plan's contract)

**1. `beforeEach` mock reset for pre-existing tests.** The plan's Task 1 <action> block calls out mocking `isHostMultiUser` + `getUsernameForUserId` per-test. To keep the 22 pre-existing (Phase 22 + Phase 86) tests from unintentionally entering the auto-tag branch, the `beforeEach` block explicitly resets both mocks to their single-user defaults (`false` / `null`). This is inside the plan's contract — it's just how the two mocks are wired into the existing test scaffold's `vi.clearAllMocks()` flow — and is what keeps zero-regression true.

**2. `sshLogger` mocked for seam assertions.** The plan's Test B/D/G assert log calls (`sshLogger.info` / `sshLogger.warn`). This required a full `vi.mock("../../utils/logger.js", ...)` block since the router module imports the real logger. Info/warn/error/debug are all vi.fn stubs. This is standard test-scaffold hygiene, not a deviation.

## Deferred Issues

None from this plan.

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions (A1 hostAccess authoritative, A6 RBAC-role expansion behavior) are honored by delegating to `isHostMultiUser` from Plan 01 — this plan writes zero new DB logic, only wires the primitive.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register (T-129-06-01 through T-129-06-04 + T-129-06-SC) is mitigated in-code as specified:

- **T-129-06-01** (Tampering — wrong-username auto-tag): `getUsernameForUserId` reads from the DB post-JWT-authn; case preserved verbatim (Pitfall 7); warn log on lookup failure prevents silent tag-with-empty-string.
- **T-129-06-02** (Tampering — auto-tag rewrites existing role file's users:): Collision probe at L472-496 short-circuits 409 before the auto-tag branch at L583 (Test E lock via absence-of-call assertion); single-mutation-site invariant enforced by grep (Pitfall 5).
- **T-129-06-03** (Info Disclosure — auto-tag fires on single-user host): `isHostMultiUser` guard at L583; Test A locks NO `users:` key AND NO frontmatter block on single-user path.
- **T-129-06-04** (Repudiation — silent auto-tag decisions in prod): Info log at successful auto-tag (`roles_create_auto_tagged` with role + hostId + creatorUsername) + warn log at skipped-lookup-failure (`roles_create_username_lookup_failed` with userId + hostId).
- **T-129-06-SC** (Supply chain — npm installs): No new packages.

## Self-Check: PASSED

Files modified (verified via git log + git show):

- `src/backend/database/routes/roles-create.ts` — modified (auto-tag branch + imports)
- `src/backend/database/routes/roles-create.test.ts` — modified (mock stack + 7-test describe block)

Commits (verified via `git log --oneline -3`):

- `9bdbeedf` — `test(129-06): add RED tests for POST /roles auto-tag on multi-user hosts` — FOUND
- `566dbe82` — `feat(129-06): auto-tag creator on POST /roles for multi-user hosts (GREEN)` — FOUND

Verification commands rerun clean (45/45 passing, tsc exit 0).

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 (RED) | 9bdbeedf | test | roles-create.test.ts |
| 1 (GREEN) | 566dbe82 | feat | roles-create.ts |
