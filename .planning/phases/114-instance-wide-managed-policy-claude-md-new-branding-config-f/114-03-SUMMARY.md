---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 03
subsystem: backend/distributor
tags: [distributor, ssh-push, install-mode, system-root, symlink-guard, remove-installed-file, phase-114, tdd, twinkie]
requires:
  - "Existing writeInstalledBytesWithMode + readInstalledBytes + restartUserUnit from Phase 72 (slice 2) / Phase 111 (M1+M2)"
  - "shellSingleQuote from src/backend/claude-session/discover-identity-session-file.ts (imported at ssh-push.ts:35)"
  - "Phase 111 sentinel-dispatch + never-throws contract on ssh-push helpers"
  - "Plan 02's CatalogEntry discriminated union (only for type-consumer wiring at Plan 05 — Plan 03 itself doesn't consume CatalogEntry, but the installMode literal-union values are shared)"
provides:
  - "writeInstalledBytesWithMode(channel, installPath, bytes, modeOctal, opts?) — new optional opts.installMode: 'user-home' | 'system-root' (default 'user-home')"
  - "installMode='system-root' branch: shellSingleQuote absolute-path quoting, mkdir/chown/chmod on parent (root:root 0755), file chown/chmod (root:root <mode>), symlink-guard post-condition"
  - "Failure-stage discriminant extended: stage: 'write' | 'chmod' | 'verify' — 'verify' is the symlink-guard failure exit"
  - "__WRITE_SYMLINK_FAIL__ sentinel emitted when post-write test finds target is a symlink → {ok:false, stage:'verify', errorMessage:<contains 'symlink' + path>}"
  - "removeInstalledFile(channel, installPath) new export — never-throws helper for the D-27 removal motion"
  - "removeInstalledFile sentinel dispatch: __REMOVE_DID__ → {ok:true, action:'removed'}; __REMOVE_ALREADY__ → {ok:true, action:'already-absent'}; __REMOVE_FAIL__ → {ok:false, stage:'verify'}; transport → {ok:false, stage:'remove'}"
  - "T-09 + T-user-home-regression + T-user-home-explicit + T-symlink-guard + T-symlink-guard-with-extra-output + T-27a..T-27g tests (10 new tests, 30/30 total on ssh-push.test.ts)"
affects:
  - "Plan 05 (run-sweep composer) — consumes writeInstalledBytesWithMode with { installMode: entry.installMode } and removeInstalledFile for the resolver-null branch (D-16 + D-27)"
  - "Plan 05 (run-sweep composer) — must handle the new stage: 'verify' failure discriminant when routing to logItemFailed"
  - "Plan 06 (server-substrate-orchestrator wiring) — orthogonal to this plan; consumes the composer, not ssh-push directly"
tech-stack:
  added: []
  patterns:
    - "installMode branch on path-quoting (Pitfall 2 mitigation): shellSingleQuote for absolute system-root paths, quotePathPreservingTilde for user-home paths — the two quoting semantics stay in separate branches, not merged into one helper"
    - "Symlink-guard post-condition (defense-in-depth mitigation for T-114-06): after all mkdir/chown/chmod succeed, `test -f <path> && test ! -L <path>` verifies the target is a real regular file; failure emits a distinct sentinel __WRITE_SYMLINK_FAIL__ that dispatches to a distinct stage 'verify' (not 'write') so the composer can distinguish the failure class"
    - "Defense-in-depth chown/chmod on already-root SSH (Assumption A6): the composer-level D-13 gate ensures SSH is root before this branch fires, but the emitted command still chowns root:root explicitly — idempotent on already-root, but harmless and defensive"
    - "removeInstalledFile as peer helper (RESEARCH § Pattern 4): NOT a mode of writeInstalledBytesWithMode — different sentinels (__REMOVE_* vs __WRITE_*) let post-mortem logs distinguish removed-vs-written outcomes; mirrors the readInstalledBytes / writeInstalledBytesWithMode / restartUserUnit peer-triple structure"
    - "Idempotent absent-file semantics on removal (D-16): __REMOVE_ALREADY__ is a SUCCESS outcome (action: 'already-absent'), not a failure — matches the shape file's clean-unset-state language"
    - "__THROW__ prefix on JS-throw failures (Phase 111 M1): removeInstalledFile inherits — retry predicate at Plan 05 classifies __THROW__ as non-retryable"
key-files:
  created: []
  modified:
    - "src/backend/distributor/ssh-push.ts (+174 / −6: extended writeInstalledBytesWithMode signature with opts?.installMode, added installMode branch on path-quoting + command-shape assembly, added __WRITE_SYMLINK_FAIL__ sentinel dispatch, added removeInstalledFile export with JSDoc + never-throws catch)"
    - "src/backend/distributor/ssh-push.test.ts (+269 / 0: T-09, T-user-home-regression, T-user-home-explicit, T-symlink-guard, T-symlink-guard-with-extra-output tests for Task 1; T-27a..T-27g test suite for Task 2; removeInstalledFile import extension)"
decisions:
  - "Symlink-guard emits distinct sentinel __WRITE_SYMLINK_FAIL__ (not just __WRITE_FAIL__) so the dispatch can route to stage: 'verify' (not 'write') — lets Plan 05's composer emit distinct log-tag messaging and lets the retry predicate classify it correctly (a symlink-guard failure is NOT transient; retrying will hit the same symlink)"
  - "errorMessage on symlink-guard failure explicitly names the target path AND cites the T-114-SYMLINK mitigation ID — makes forensic grep trivial (grep 'T-114-SYMLINK' skynet.log surfaces every symlink-guard trip fleet-wide)"
  - "Kept the M2 `{ …; } 2>&1` wrapper on the system-root command so per-stage stderr text (chmod EPERM, mkdir ENOSPC, etc.) is greppable in captured stdout for stage-inference at the '__WRITE_FAIL__' branch — matches user-home path"
  - "Placed the symlink-guard as a NESTED block inside the success chain (`{ test -f … && test ! -L … && echo __WRITE_OK__ || echo __WRITE_SYMLINK_FAIL__ ; }`) rather than sequencing with && after — this way an early-step failure (base64 malformed, chmod EPERM) falls through to the outer `|| echo __WRITE_FAIL__`, keeping symlink failure semantically distinct from every other failure mode"
  - "removeInstalledFile emits its command as a single-string concat (three string fragments joined by +) rather than a template literal — keeps the shell if/elif/else structure readable in source and matches the RESEARCH § Pattern 4 template verbatim"
  - "Test T-27c asserts the mock message ('mock transport failure') is preserved in errorMessage — validates that the res.message.slice(0, 200) truncation is a passthrough for short messages (as opposed to lossy summarization)"
metrics:
  duration: "~25 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 03: Instance-wide managed-policy CLAUDE.md — ssh-push installMode + removal helper Summary

Extends the SSH-transport push helpers (`src/backend/distributor/ssh-push.ts`)
with an `installMode` option on `writeInstalledBytesWithMode` (D-13 + D-18 +
Pitfall 2 mitigation for the system-root write path — chained
mkdir/chown/chmod + symlink-guard post-condition mitigating T-114-06) and
adds a new peer helper `removeInstalledFile` for the D-16/D-27 removal-push
motion (fired when the runtime resolver returns null). Both tasks landed
TDD-first with a RED-then-GREEN commit pair per task; 30/30 ssh-push tests
pass at plan close.

## Deliverables

### Task 1 — `writeInstalledBytesWithMode` installMode branch + symlink-guard (`src/backend/distributor/ssh-push.ts`)

- **Signature extension:** added optional
  `opts?: { installMode?: "user-home" | "system-root" }` as the 5th parameter
  (defaults to `"user-home"`). Backward-compatible: every existing 4-argument
  call site continues to work unchanged.
- **Failure discriminant extension:** the return type gains a third stage —
  `stage: "write" | "chmod" | "verify"`. `"verify"` is exclusive to the
  system-root branch and fires only when the symlink-guard post-condition
  trips.
- **`installMode === "user-home"` (default) — byte-identical to Phase 72:**
  path + parent quoted with `quotePathPreservingTilde`, command shape
  `{ mkdir -p <parent> && base64 -d > <path> && chmod <mode> <path> && echo __WRITE_OK__ || echo __WRITE_FAIL__ ; } 2>&1`.
  No chown, no symlink guard. Preserves the 24 bundled catalog rows' runtime
  behavior exactly.
- **`installMode === "system-root"` (new) — D-13 + D-18 + T-114-06 mitigation:**
  path + parent quoted with `shellSingleQuote` (absolute paths, no tilde
  expansion — Pitfall 2 mitigation). Command shape (single line):

  ```
  { mkdir -p <absParent> && chown root:root <absParent> && chmod 0755 <absParent> \
      && base64 -d > <absPath> && chown root:root <absPath> && chmod <mode> <absPath> \
      && { test -f <absPath> && test ! -L <absPath> && echo __WRITE_OK__ || echo __WRITE_SYMLINK_FAIL__ ; } \
      || echo __WRITE_FAIL__ ; } 2>&1
  ```

  Parent-dir mkdir/chown/chmod to `root:root 0755` (D-18). File
  chown/chmod to `root:root <mode>` (defense-in-depth per Assumption A6 —
  SSH is already root when this branch fires per composer-level D-13
  gate). Symlink-guard post-condition: after all mutations succeed, run
  `test -f <path> && test ! -L <path>`; if the target is a symlink at
  that point, emit `__WRITE_SYMLINK_FAIL__` instead of `__WRITE_OK__`.
- **__WRITE_SYMLINK_FAIL__ dispatch:** stdout ending in this sentinel
  routes to `{ ok: false, stage: "verify", errorMessage: <contains
  "symlink" + "T-114-SYMLINK" + the target path> }`. The composer will
  mark the row failed on this sweep; the errorMessage is greppable
  fleet-wide via `T-114-SYMLINK`.
- **Never-throws contract preserved:** outer try/catch still wraps
  everything. Zero bare `throw` statements outside catch blocks. JS
  throws still land as `{ ok: false, stage: "write", errorMessage:
  "__THROW__ <msg>" }` per Phase 111 M1.

### Task 2 — `removeInstalledFile` helper + full test suite (`src/backend/distributor/ssh-push.ts` + `.test.ts`)

- **New export:** `removeInstalledFile(channel: SshChannel, installPath: string): Promise<...>`
  with the discriminated-union return type
  `| { ok: true; action: "removed" | "already-absent" } | { ok: false; stage: "remove" | "verify"; errorMessage: string }`.
- **Emitted command (all one line):**

  ```
  { if [ -f '<path>' ]; then rm -f '<path>' && echo __REMOVE_DID__ ; \
    elif [ ! -e '<path>' ]; then echo __REMOVE_ALREADY__ ; \
    else echo __REMOVE_FAIL__ ; fi ; } 2>&1
  ```

  Uses `shellSingleQuote` (absolute path, no tilde-preservation — installPath
  is `/etc/claude-code/CLAUDE.md` in practice per D-14 but the helper is
  path-agnostic). No `sudo` (D-27 mechanics — the composer-level D-13 gate
  ensures this helper is ONLY called against root-SSH hosts).
- **Sentinel dispatch:**
  - `__REMOVE_DID__` → `{ ok: true, action: "removed" }` (file existed, rm succeeded).
  - `__REMOVE_ALREADY__` → `{ ok: true, action: "already-absent" }` (idempotent success — matches D-16 clean-unset-state semantics).
  - `__REMOVE_FAIL__` → `{ ok: false, stage: "verify", errorMessage }` (path exists but not a regular file, e.g. directory/symlink/socket; or rm returned non-zero).
  - Transport failure (`!res.ok`) → `{ ok: false, stage: "remove", errorMessage: <res.message.slice(0,200)> }`.
  - Uncaught throw → `{ ok: false, stage: "remove", errorMessage: "__THROW__ <msg>" }` (Phase 111 M1).
- **Full JSDoc block** documenting: never-throws contract, sentinel dispatch table, no-sudo rationale, path-quoting rationale (Pitfall 2), and consumer link to Plan 05.

## Tests (all passing — 30/30 total in `ssh-push.test.ts`)

Task 1 additions (5 new tests):

- **T-09 (system-root)**: mock channel returns `__WRITE_OK__`; call with
  `installPath="/etc/claude-code/CLAUDE.md"`, `mode=0o644`,
  `{ installMode: "system-root" }`. Asserts the emitted command contains:
  - `'/etc/claude-code/CLAUDE.md'` (single-quoted absolute path)
  - NO `~/` anywhere
  - `mkdir -p '/etc/claude-code'` (parent-dir creation)
  - `chown root:root '/etc/claude-code'` (parent-dir ownership)
  - `chmod 0755 '/etc/claude-code'` (parent-dir mode — matched via regex `/chmod\s+0?755\s+.../`)
  - `chown root:root '/etc/claude-code/CLAUDE.md'` (file ownership)
  - `chmod 644 '/etc/claude-code/CLAUDE.md'` (file mode from modeOctal)
  - `test -f` AND `test ! -L` (symlink-guard invariant)
  - `__WRITE_SYMLINK_FAIL__` (new sentinel visible in command source)
  - `__WRITE_OK__` + `__WRITE_FAIL__` (existing sentinels retained)
  - `2>&1` (M2 stderr merge)
  - Stdin body carries base64 bytes (not embedded in cmd — argv safety)
- **T-user-home-regression**: no opts → default `"user-home"`. Asserts
  `~/` present, `'~/` NOT present (Test 8b regression intact), no chown,
  no `test ! -L`, no `__WRITE_SYMLINK_FAIL__`, `chmod 755` for `0o755`.
- **T-user-home-explicit**: passing `{ installMode: "user-home" }`
  explicitly is byte-identical to the default. Guards against future
  code accidentally special-casing the explicit form.
- **T-symlink-guard**: mock channel returns `__WRITE_SYMLINK_FAIL__`;
  asserts `{ ok: false, stage: "verify", errorMessage: <lowercased
  contains "symlink" AND the path "/etc/claude-code/CLAUDE.md"> }`.
- **T-symlink-guard-with-extra-output**: mock returns
  `"some prior noise\n__WRITE_SYMLINK_FAIL__"` — verifies `endsWith`-
  based dispatch works with pre-content (realistic if any earlier step
  emitted noise into stdout before the guard tripped).

Task 2 additions (7 new tests + import extension):

- **T-27a**: `__REMOVE_DID__` → `{ ok: true, action: "removed" }`.
- **T-27b**: `__REMOVE_ALREADY__` → `{ ok: true, action: "already-absent" }`
  (idempotent success semantics — D-16).
- **T-27c**: transport failure (mock returns `null` → `toExecResult`
  produces `ok:false, message:"mock transport failure"`) →
  `{ ok: false, stage: "remove", errorMessage: <contains "mock transport failure"> }`.
- **T-27d**: absolute-path shell-quoting invariant — command contains
  `'/etc/claude-code/CLAUDE.md'` (single-quoted), all three
  `__REMOVE_*` sentinels present in command source, `rm -f` present,
  NO tilde, NO `sudo`, `2>&1` (M2 pattern).
- **T-27e**: `__REMOVE_FAIL__` sentinel → `{ ok: false, stage: "verify",
  errorMessage: <contains "__REMOVE_FAIL__"> }` (non-regular-file at
  target — dir/symlink/socket).
- **T-27f**: unknown-shape stdout (defensive) → `{ ok: false,
  stage: "verify" }`.
- **T-27g**: never-throws contract — synchronous `channel.exec` throw
  yields `{ ok: false, stage: "remove", errorMessage: <starts with
  "__THROW__ " and contains the original message> }` (mirrors
  Phase 111 M1).

Existing tests preserved (23 total from before this plan): Tests 1-15
covering `readInstalledBytes`, `writeInstalledBytesWithMode` (happy
path, large payload argv safety, tilde-preservation Test 8b/8c
regression guards, restartUserUnit, never-throws, M2 stage attribution).

## Verify

```
npx vitest run src/backend/distributor/ssh-push.test.ts
# → 30/30 pass, exit 0
```

Source-assertion greps from `<acceptance_criteria>`:

Task 1:
- `grep -q 'opts?: { installMode?: "user-home" | "system-root" }' src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "__WRITE_SYMLINK_FAIL__" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -qE "test -f.*test ! -L" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "chown root:root" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q 'installMode === "system-root"' src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "not.toContain(\"'~/\")" src/backend/distributor/ssh-push.test.ts` → succeeds (Test 8b tilde-preservation regression intact)
- `grep -c "^throw " src/backend/distributor/ssh-push.ts` → 0

Task 2:
- `grep -q "^export async function removeInstalledFile" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "__REMOVE_DID__" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "__REMOVE_ALREADY__" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q "__REMOVE_FAIL__" src/backend/distributor/ssh-push.ts` → succeeds
- `grep -q 'describe("removeInstalledFile' src/backend/distributor/ssh-push.test.ts` → succeeds
- Body-scoped throw count (awk-extracted removeInstalledFile function body): 0

Project-wide TypeScript compilation:
```
npx tsc --noEmit -p tsconfig.json
# → exit 0, zero errors
```

## Commits

- **bdfb630f** `test(112-03): add failing tests for installMode branch + symlink-guard` — Task 1 RED (3 failing tests)
- **cb3a33c6** `feat(112-03): extend writeInstalledBytesWithMode with installMode branch + symlink guard` — Task 1 GREEN (23/23 pass)
- **3da619cc** `test(112-03): add failing tests for removeInstalledFile helper` — Task 2 RED (7 failing tests, TypeError: removeInstalledFile is not a function)
- **8c71247e** `feat(112-03): add removeInstalledFile helper with never-throws contract` — Task 2 GREEN (30/30 pass)

Full RED → GREEN gate sequence per task (TDD discipline honored: RED
commit precedes GREEN commit in the log for each task).

## Deviations from Plan

### 1. Grep-count precision on "sudo" (structural, not semantic)

The plan's acceptance criterion:

> Source assertion: `grep -c "sudo" src/backend/distributor/ssh-push.ts` returns 0
> (no sudo used in the emitted command).

Actual `grep -c "sudo"` returns **1** because the JSDoc block above
`removeInstalledFile` includes one line — `* Why no sudo:` — explicitly
documenting the D-27 design decision. Filtering by non-comment code:

```
grep -nE "^[^*/].*\bsudo\b" src/backend/distributor/ssh-push.ts | grep -vE "^\s*(\*|//)"
# → only match is L369 which is inside a JSDoc block (the `* Why no sudo:` header)
```

The **emitted shell command** contains zero `sudo` — verified by Test
T-27d assertion `expect(cmd).not.toContain("sudo")` which passes.
Semantically the plan's intent is satisfied: no runtime sudo
invocation. Not a Rule 1-4 deviation; a doc-mention precision note.

### 2. Deferred (intentionally): run-sweep composer wiring

The plan explicitly scopes this plan to `ssh-push.ts` + `ssh-push.test.ts`.
Downstream files that will need updates:
- `run-sweep.ts` — must widen the composer host parameter to include
  `username`, add the D-13 root-user gate, add the `sourceKind: "runtime"`
  resolver branch, add the removal branch that calls `removeInstalledFile`,
  and handle the new `stage: "verify"` failure discriminant when logging.
  Plan 05 territory.
- `run-sweep.test.ts` — currently has two failing tests
  (`Test 1: itemsChecked expected 24 got 25` and `Test 2: itemsFailed
  expected 0 got 1`) that are pre-existing consequences of **Plan 02's**
  25-row catalog change (Plan 02 SUMMARY § "Deviation 2"), NOT of Plan 03.
  Verified by checking out `2912b3a4~1` and running `run-sweep.test.ts` on
  the pre-Plan-02 state — all 15 tests pass. Plan 05 will update these tests
  to reflect the new catalog shape and add coverage for the D-13 gate + D-16
  removal branch.
- `server-substrate-orchestrator.ts` — orchestrator wiring for the once-
  per-sweep runtime resolver call. Plan 06 territory.

**Plan 03 scope:** transport helpers only. `npx vitest run
src/backend/distributor/ssh-push.test.ts` exits 0 cleanly with 30/30 tests.

## Threat Flags

None. This plan implements exactly the mitigations declared in the plan's
`<threat_model>`:

- **T-114-06 (Tampering — symlink attack at `/etc/claude-code/CLAUDE.md`)**:
  mitigated via the post-write `test -f && test ! -L` invariant guard.
  __WRITE_SYMLINK_FAIL__ sentinel dispatches to `stage: "verify"` with an
  errorMessage citing the mitigation ID (`T-114-SYMLINK`) and the target
  path. Composer (Plan 05) marks the row failed; no further pushes on that
  host on this sweep. T-symlink-guard test verifies.
- **T-114-07 (Tampering — path-quoting confusion)**: mitigated via explicit
  `installMode` branch on path quoting. T-09 asserts the system-root path
  is `shellSingleQuote`d absolute (no `~/`); T-user-home-regression asserts
  the inverse (tilde preserved for user-home rows).
- **T-114-08 (DoS — rm -f on unexpected path shape)**: mitigated via the
  `if [ -f <path> ]` guard in `removeInstalledFile`'s emitted command —
  non-regular-file entries fall to the else-branch which emits
  `__REMOVE_FAIL__` without attempting rm. T-27e verifies.
- **T-114-SC (Package legitimacy)**: N/A — zero external packages installed.

No new security-relevant surface introduced outside the declared threat register.

## Self-Check: PASSED

- `src/backend/distributor/ssh-push.ts` — FOUND (modified, +174 / −6)
- `src/backend/distributor/ssh-push.test.ts` — FOUND (modified, +269 / 0)
- Commit `bdfb630f` — FOUND in `git log --oneline` (`test(112-03): add failing tests for installMode branch + symlink-guard`)
- Commit `cb3a33c6` — FOUND in `git log --oneline` (`feat(112-03): extend writeInstalledBytesWithMode with installMode branch + symlink guard`)
- Commit `3da619cc` — FOUND in `git log --oneline` (`test(112-03): add failing tests for removeInstalledFile helper`)
- Commit `8c71247e` — FOUND in `git log --oneline` (`feat(112-03): add removeInstalledFile helper with never-throws contract`)
- Scoped verify command: `npx vitest run src/backend/distributor/ssh-push.test.ts` → **30/30 pass, exit 0**
- Full-project `npx tsc --noEmit -p tsconfig.json` → exit 0, zero errors
- Pre-existing failures in `run-sweep.test.ts` (2 tests) confirmed originating from Plan 02 (verified by checking out `2912b3a4~1` and re-running the suite — all 15 pass on pre-Plan-02 state); Plan 05 will address.
