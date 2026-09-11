---
phase: 92-pin-sentinel-migration
plan: 01
subsystem: infra
tags: [ssh, sftp, per-identity-file, sentinel, identity-birth, ext_openssh_rename]

requires:
  - phase: 77-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun
    provides: identity-birth SFTP wire (relay.json write path via writeMarkdownFileAtomic + chmod 600)
provides:
  - per-identity-file primitive (writeIdentityFile / removeIdentityFile / identityFileExists) at src/backend/claude-session/per-identity-file.ts
  - single audit surface for `~/.claude/identities/<name>/<relPath>` writes with two callers per D-05 (identity-birth Step 8 now, pin action in Plan 92-02)
  - H1 write⇔read parity lock (IDENTITY_KEY_RE imported from identity-artifact-reader.ts:174 — never redefined)
  - ALLOWED_REL_PATHS whitelist bounding relPath to {relay.json, .pinned}
  - byte-shape parity between primitive-routed Step 8 and pre-refactor Phase 77 wire (proven by six T1-T6 regression tests + Test 9 on the primitive itself)
affects: [92-02-pin-action, 92-03-*, 92-04-*]

tech-stack:
  added: []
  patterns:
    - "One-audit-surface primitive layered over identity-artifact-reader's writeMarkdownFileAtomic — delegates the SFTP tmp+atomic-rename discipline rather than duplicating it"
    - "H1 write⇔read regex parity: primitive imports IDENTITY_KEY_RE (stricter reader-side regex) and re-exports for test observability; any drift is caught by Test 11's .source + .flags assertion + table-driven sweep"
    - "Bounded relPath whitelist (Set<string>) as belt-and-suspenders to the identityKey traversal-character exclusion"
    - "Tagged chmod-failure semantics preserved in the primitive (`chmod_<mode>_failed:` rewrap) so the caller's failure-attribution regex works unchanged"

key-files:
  created:
    - src/backend/claude-session/per-identity-file.ts
    - src/backend/claude-session/per-identity-file.test.ts
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
    - src/backend/database/routes/identity-birth.test.ts

key-decisions:
  - "H1 fix: primitive IDENTITY_KEY_RE is IMPORTED from identity-artifact-reader.ts:174 (`/^[a-z0-9_-]{1,64}$/`), never redefined — Test 11 asserts .source + .flags parity + table-driven acceptance sweep"
  - "REMOTE target path passes $HOME as a LITERAL string to SFTP (byte-shape parity with pre-refactor identity-birth Step 8 L862 literal), NOT resolved via `echo $HOME` — different from identity-artifact-reader's other writers which do resolve"
  - "chmod is opt-in via opts.chmod — relay.json passes 0o600 (S-1 secret material), .pinned passes nothing (parallel `.no-dormancy` treatment)"
  - "Primitive tags chmod failures as `chmod_<mode>_failed: <message>` on both LOCAL and REMOTE branches to preserve pre-refactor Step 8 failure-attribution semantics"
  - "Only Step 8's usage of deps.writeMarkdownFileAtomic is rerouted; Step 2.5's identity .md write stays on deps (BirthDeps type unchanged)"

patterns-established:
  - "Per-identity file-touch primitive routing: isLocalHostId(hostId) branch → node fs at ${homedir}/.claude/identities/<name>/<relPath>; otherwise SFTP → writeMarkdownFileAtomic with $HOME literal"
  - "removeIdentityFile / identityFileExists are idempotent (ENOENT swallowed) / fail-closed (stat error → false) per the presence-is-meaning semantics of the .pinned sentinel"

requirements-completed: [D-05, D-08-wire-generalization]

duration: 20min
completed: 2026-09-09
---

# Phase 92 Plan 92-01: Wire generalization — per-identity-file primitive + identity-birth Step 8 refactor Summary

**Per-identity-file primitive with three exports (writeIdentityFile / removeIdentityFile / identityFileExists) generalizing the Phase 77 identity-birth SFTP wire into a single audit surface — identity-birth Step 8 rerouted through it with byte-shape parity to the pre-refactor L862 literal.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-09T18:28:00Z
- **Completed:** 2026-09-09T18:48:00Z
- **Tasks:** 2 (Task 1 primitive + tests; Task 2 orchestrator refactor + regression tests)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- **Primitive shipped:** `per-identity-file.ts` exports three async functions (`writeIdentityFile`, `removeIdentityFile`, `identityFileExists`) with contract-tested LOCAL/REMOTE routing that mirrors `identity-artifact-reader`'s split. 28 primitive contract tests green, including Test 11 (H1 anti-drift lock) and Test 9 (byte-shape regression trap).
- **Step 8 refactor byte-identical:** identity-birth-orchestrator Step 8 (previously a direct `deps.writeMarkdownFileAtomic` + `deps.execCommand(chmod 600)` sequence) now routes through `writeIdentityFile(opts.name, "relay.json", relayJsonBody, { hostId, conn, chmod: 0o600 })`. Six new regression tests (T1-T6) lock the byte-shape (target path, body, chmod mode + tag, failure semantics, Step 6/7 isolation, regex-tightening backwards compat).
- **H1 write⇔read parity locked:** `IDENTITY_KEY_RE` is imported (not redefined) from `identity-artifact-reader.ts:174`. Test 11 asserts `.source + .flags` equality plus a table-driven acceptance sweep across `["tina", "tina.core", "tina/sub", "tina+plus", "tina=eq", ...]` — any future edit that reintroduces the looser `identity-birth.ts:64` regex characters breaks the primitive test suite loudly with a diagnostic naming the source of truth.
- **Regression trap wired:** primitive tests install a throwing trap on `sftp.rename` that fails Test 4 loudly with `"pin sentinel wire regressed to sftp.rename — must use ext_openssh_rename via writeMarkdownFileAtomic"` if a future refactor bypasses the primitive's delegation to `writeMarkdownFileAtomic` (which owns the `sftp.ext_openssh_rename` discipline).

## Task Commits

Task 1 (TDD RED → GREEN → follow-on fix):
1. `e0487826` (test) — RED: 28 failing contract tests for the primitive (module not yet created)
2. `6409d74d` (feat) — GREEN: `per-identity-file.ts` lands with three async exports + ALLOWED_REL_PATHS whitelist + IDENTITY_KEY_RE re-export
3. `6f2bd700` (fix) — auto-fix during Task 2 planning: preserve the pre-refactor `$HOME` LITERAL in the REMOTE target path (do NOT resolve via `echo $HOME`)

Task 2 (TDD RED → GREEN):

4. `033ef601` (test) — RED: 6 new regression tests (T1-T6) + updates to existing Test A/C/E to inspect the module-level `writeMarkdownFileAtomic` mock post-refactor
5. `451247b7` (feat) — GREEN: Step 8 rerouted through `writeIdentityFile`; four test-file mocks updated to export `IDENTITY_KEY_RE` so the transitive primitive import resolves

**Plan metadata:** _committed with SUMMARY + STATE + ROADMAP updates below_

## Files Created/Modified

- **`src/backend/claude-session/per-identity-file.ts`** (created) — the primitive module. Exports `writeIdentityFile`, `removeIdentityFile`, `identityFileExists`, `ALLOWED_REL_PATHS`, and re-exports `IDENTITY_KEY_RE` from the reader. Delegates writes to `writeMarkdownFileAtomic` (do NOT re-implement the SFTP tmp+rename discipline).
- **`src/backend/claude-session/per-identity-file.test.ts`** (created) — 28 contract tests covering identityKey gate, relPath whitelist, LOCAL/REMOTE write/remove/exists paths, byte-shape parity, chmod handling, and H1 anti-drift lock.
- **`src/backend/database/routes/identity-birth-orchestrator.ts`** (modified) — Step 8 rerouted; direct `deps.writeMarkdownFileAtomic` + manual `deps.execCommand(chmod 600)` block replaced with a single `writeIdentityFile(...)` call.
- **`src/backend/database/routes/identity-birth-orchestrator.test.ts`** (modified) — adds `IDENTITY_KEY_RE` to the vi.mock, resets the module-level `writeMarkdownFileAtomic` mock between tests, updates Test A/C/E to inspect the correct mock, appends six T1-T6 regression tests.
- **`src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts`** (modified) — mock now exports `IDENTITY_KEY_RE` (transitive dependency via primitive import in Step 8).
- **`src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts`** (modified) — same mock addition.
- **`src/backend/database/routes/identity-birth.test.ts`** (modified) — same mock addition.

## Decisions Made

- **ALLOWED_REL_PATHS = {"relay.json", ".pinned"}** — bounded to exactly the two basenames this phase's callers touch. Kept intentionally tiny per D-01 filename lock + one-audit-surface rule. Any other value throws before I/O; future callers that need a new file basename must land it as an explicit whitelist addition (single-line grep-visible change), not accept arbitrary relPath.
- **H1 stricter IDENTITY_KEY_RE** (`/^[a-z0-9_-]{1,64}$/`, imported from `identity-artifact-reader.ts:174`) — vs. the looser `identity-birth.ts:64` route-level regex `/^[a-z0-9._=/+-]+$/`. Rationale: same regex writer + on-disk readers = no silent write-succeeds-read-fails divergence. Every key the primitive accepts is guaranteed readable by every existing on-disk reader (`agent-supervisor.sh [ -f $dir/.pinned ]`, `publicIdentity` fanout, `identityFileExists`). Test 11 pins this to `.source + .flags` equality plus a table-driven sweep.
- **REMOTE branch delegates to `writeMarkdownFileAtomic`** — the SFTP tmp+atomic-rename discipline lives inside that helper (which is where the `sftp.ext_openssh_rename` posix-rename call site is). Duplicating it here would create a second audit surface for the same discipline and forfeit the D-05 quality gate. Removes tests were kept small (`sftp.unlink` + fs.unlink with ENOENT swallow); exists probes similarly use `sftp.stat` + `fs.stat` fail-closed.
- **`$HOME` literal in REMOTE target path** — matches the pre-refactor Step 8 L862 literal byte-for-byte. Different from identity-artifact-reader's `writeIdentityFile` at :2604 which resolves `$HOME` via `echo $HOME`; that's a coherent choice for a different set of files, but Phase 77's Step 8 shipped with the literal shape and byte-shape parity for THIS wire is the deliverable. Documented in the primitive's `remoteTargetPath` prologue.
- **chmod is opt-in (opts.chmod)** — relay.json passes `0o600` (T-92-01-04 secret-material mitigation), .pinned passes nothing (parallel `.no-dormancy`/`.recycle-requested` presence-only treatment). Primitive tags chmod failures as `chmod_<mode>_failed: <message>` on both branches so the pre-refactor Test C2 `/chmod_600_failed/` regex still bites.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `$HOME` literal preservation in REMOTE target path**

- **Found during:** Task 2 planning (before writing Task 2 tests)
- **Issue:** My initial primitive (from Task 1 GREEN) resolved `$HOME` via `execCommand(conn, "echo $HOME")` — mirroring `identity-artifact-reader.writeIdentityFile` at :2626. But the plan's Task 2 `<action>` requires the primitive's REMOTE target path to be `$HOME/.claude/identities/${name}/${relPath}` VERBATIM (a LITERAL `$HOME` prefix) to match pre-refactor Step 8's L862 shape byte-for-byte. Phase 77 has proven this literal-$HOME shape in production; resolving it would change the wire's byte-shape.
- **Fix:** Changed `remoteTargetPath` from an async `execCommand`-driven resolver to a synchronous string-concat helper. Updated tests 4 + 9 to assert the literal `$HOME/...` shape and added a load-bearing comment in the primitive's `remoteTargetPath` prologue documenting the invariant.
- **Files modified:** src/backend/claude-session/per-identity-file.ts, src/backend/claude-session/per-identity-file.test.ts
- **Verification:** All 28 primitive tests green + Task 2's T1/T6 assertions (`$HOME/.claude/identities/<name>/relay.json`) pass.
- **Committed in:** `6f2bd700`

**2. [Rule 3 - Blocking] Test-mock parity: four adjacent test files were missing `IDENTITY_KEY_RE` from their `identity-artifact-reader` vi.mock**

- **Found during:** Task 2 GREEN (after Step 8 refactor)
- **Issue:** `per-identity-file.ts` imports `IDENTITY_KEY_RE` from `identity-artifact-reader` (H1 write⇔read parity lock). When Step 8 transitively imports the primitive, four pre-existing test files with their own `vi.mock("../../claude-session/identity-artifact-reader.js", ...)` triggered `[vitest] No "IDENTITY_KEY_RE" export is defined on the mock` at Step 8 runtime — surfacing as ~22 unrelated test failures across `identity-birth-orchestrator.test.ts`, `.mxid-derivation.test.ts`, `.role-frontmatter.test.ts`, and `identity-birth.test.ts`. Not a production bug; a test-mock-hygiene fallout of the transitive import.
- **Fix:** Added `IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/` to each of the four `vi.mock` blocks with a comment naming Phase 92 Plan 92-01 Task 2 as the reason and the H1 parity lock as the rationale.
- **Files modified:** identity-birth-orchestrator.test.ts, identity-birth-orchestrator.mxid-derivation.test.ts, identity-birth-orchestrator.role-frontmatter.test.ts, identity-birth.test.ts
- **Verification:** 152/152 tests across the 6 in-scope test files pass; 69/69 adjacent identity tests (`identities.put-disk`, `.get-disk`, `user-admin-routes`, `identity-harness-start`) also pass.
- **Committed in:** `451247b7` (part of Task 2 GREEN commit)

**3. [Rule 2 - Missing critical functionality] Tagged chmod-failure semantics in the primitive**

- **Found during:** Task 2 GREEN (as I refactored Step 8)
- **Issue:** The plan's Task 2 `<action>` says "Delete the manual `execCommand(conn, `chmod 600 ...`)` block at Step 8 — the primitive's chmod option handles it now." But the pre-refactor block wraps chmod errors as `Error('chmod_600_failed: ...')` and Test C2 asserts `reason.match(/chmod_600_failed/)`. Deleting the manual block without preserving this semantics would silently break Test C2 (which is a pre-existing failure-attribution contract).
- **Fix:** Added a `try/catch` around the primitive's chmod call (both LOCAL and REMOTE branches) that rewraps the failure as `Error(\`chmod_${modeStr}_failed: <message>\`)`. This preserves Test C2's regex, and the tag is now mode-agnostic (works for any octal mode a future caller passes).
- **Files modified:** src/backend/claude-session/per-identity-file.ts
- **Verification:** Test C2 (chmod 600 failure fails step 8 without rollback) still passes; the mode-parametric tag makes the failure-attribution contract usable by future callers too.
- **Committed in:** `451247b7` (part of Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 bug: byte-shape divergence; 1 blocking: test-mock hygiene; 1 missing critical: failure-attribution semantics)

**Impact on plan:** All three auto-fixes were required for correctness. #1 fixes a byte-shape divergence between my initial implementation and the plan's explicit `<action>` requirement. #2 unblocks a fleet of tests that were failing purely due to a transitive import from the primitive to the mocked module. #3 preserves a pre-refactor test contract (Test C2) that the plan's "delete the manual block" instruction would otherwise silently break. No scope creep — all three land in-file, no new dependencies, no new modules.

## Threat Flags

None — this plan preserves the Phase 77 threat surface for the identity-birth wire (same auth path, same SFTP conn, same tmp+atomic-rename discipline, same chmod 600 on relay.json). The stricter IDENTITY_KEY_RE gate at the primitive reduces the write-side attack surface vs the looser identity-birth route regex.

## Issues Encountered

None — all three deviations above are auto-fixes classified under the deviation-rules workflow, not blocking issues.

## User Setup Required

None — pure refactor over existing ssh2 + node fs modules. No new dependencies, no new env vars, no external service configuration.

## Next Phase Readiness

- **Plan 92-02 (pin action) is unblocked:** the primitive's `writeIdentityFile("<key>", ".pinned", "", { hostId, conn })` and `removeIdentityFile("<key>", ".pinned", { hostId, conn })` are ready as the pin-toggle backend's write/remove path. `identityFileExists("<key>", ".pinned", { hostId, conn })` is ready as the read side for the per-identity metadata `pinned: boolean` field.
- **No dependencies deferred to Plan 92-02:** the primitive is complete (three exports, tested, byte-shape locked). Plan 92-02 needs only to wire the pin action to `writeIdentityFile` / `removeIdentityFile`, wire the per-identity metadata endpoint to `identityFileExists`, and drop the DB column (`user_preferences.pinned_conversation_ids`) in the same schema migration per D-02.
- **Test 4's regression trap is in place** — future refactors that bypass the primitive's delegation to `writeMarkdownFileAtomic` (e.g. calling `sftp.rename` directly) fail loudly with a fix-name diagnostic.

## Self-Check: PASSED

- Created files:
  - `src/backend/claude-session/per-identity-file.ts` — FOUND
  - `src/backend/claude-session/per-identity-file.test.ts` — FOUND
- Modified files (all touched at git-diff level):
  - `src/backend/database/routes/identity-birth-orchestrator.ts` — verified `writeIdentityFile` import + call added, Step 8 sequence replaced
  - `src/backend/database/routes/identity-birth-orchestrator.test.ts` — verified new T1-T6 tests + IDENTITY_KEY_RE mock addition
  - identity-birth-orchestrator.mxid-derivation.test.ts + .role-frontmatter.test.ts + identity-birth.test.ts — verified IDENTITY_KEY_RE mock addition
- Commits (all short hashes exist on `feat/tab-title-from-tmux`):
  - `e0487826` — FOUND
  - `6409d74d` — FOUND
  - `6f2bd700` — FOUND
  - `033ef601` — FOUND
  - `451247b7` — FOUND
- Scoped-test result: 6/6 in-scope test files, 152/152 tests green. Adjacent identity tests: 4/4 files, 69/69 green.

---

*Phase: 92-pin-sentinel-migration*
*Completed: 2026-09-09*
