---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 04
subsystem: backend/branding
tags: [assert-boot, boot-alarm, non-fatal, phase-114, tdd, d-05]
requires:
  - "Plan 01: readInstancePolicyBytes() export + instancePolicyFilename field on BrandingConfig"
  - "Phase 74 assertBrandingConfigAtBoot() fatal gate on avatarDirectorSpec (pattern reference)"
  - "sshLogger from ../utils/logger.js (Phase 114 uses non-fatal channel)"
provides:
  - "assertBrandingConfigAtBoot() gains a NON-THROWING misconfig alarm branch appended AFTER the Phase 74 fatal gate"
  - "sshLogger.error emission with operation:\"branding_instance_policy_boot_alarm\" whenever instancePolicyFilename is set but readInstancePolicyBytes() returns null"
  - "T-06a..T-06d test coverage for the new branch (4 new tests, 10/10 total in assert-boot.test.ts)"
  - "Regression guarantee: Phase 74 gate is byte-untouched; existing Tests 1-6 all still pass"
affects:
  - "Skynet-server startup path: ops now sees the D-05 misconfig alarm ONCE at boot in the sshLogger.error stream — no need to wait for a distributor-sweep log grep to notice a mis-set instancePolicyFilename"
  - "Plans 05 / 06 (sweep composer + integration): the boot-time alarm is orthogonal but complementary — sweep-time silence in readInstancePolicyBytes on ENOENT (Plan 01 P114-T-05) relies on this file being the loud channel"
tech-stack:
  added: []
  patterns:
    - "Non-fatal alarm shape (D-05) — deliberate non-replication of Phase 74's process.exit(1) — sshLogger.error + return silently"
    - "Empty-string field short-circuits BEFORE the resolver call (guards against future accidental gate additions per T-114-11)"
    - "Message shape verbatim per D-05 canonical anchor at 114-RESEARCH.md L676-707"
    - "Anti-pattern lock: docstring + T-06c assertion + acceptance_criteria grep triple-witness the non-fatal invariant"
key-files:
  created: []
  modified:
    - "src/backend/branding/assert-boot.ts (+57 insertions, -3 deletions — new imports, docstring extension, Phase 114 branch appended after Phase 74 gate)"
    - "src/backend/branding/assert-boot.test.ts (+168 insertions, -2 deletions — state.instancePolicyBytes mock field, readInstancePolicyBytes loader-mock leg, sshLoggerErrorSpy, T-06a..T-06d)"
decisions:
  - "Co-located import of readInstancePolicyBytes on the existing loader import line (D-11 discretion — every dep already local to the loader)"
  - "Empty-filename fast-path lives at the assert-boot layer BEFORE calling the resolver (contrast: the resolver ALSO fast-paths on empty per Plan 01, but the boot-alarm branch double-guards for clarity — T-114-11 regression test T-06a specifically validates)"
  - "Message shape emitted with exact D-05 wording — 'instance-policy field is set to ...' + resolved absolute path + 'no twinkie will be pushed' + fix-guidance suffix; tests assert three fragments of the message rather than an exact match to preserve wording latitude if D-05 is refined in a follow-up phase"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 04: Instance-wide managed-policy CLAUDE.md — non-throwing boot alarm Summary

Appends the D-05 non-fatal misconfig alarm branch to
`assertBrandingConfigAtBoot()`, giving ops a loud-at-boot signal when
`instancePolicyFilename` is set but the referenced markdown file cannot
be read (missing, over the 256 KB byte cap, path-containment violation,
or read error). Deliberate non-replication of the Phase 74 fatal-gate
shape — the process continues to start.

## Deliverables

- **`assert-boot.ts` addition**: after the existing Phase 74 fatal gate
  (untouched at L37-78 of the modified file), a new branch reads
  `config.instancePolicyFilename`, trims it, and — if non-empty — awaits
  `readInstancePolicyBytes()`. On `null` return, emits `sshLogger.error`
  with the D-05 message + `operation: "branding_instance_policy_boot_alarm"`
  metadata. No throw, no `process.exit`. Docstring header updated to
  document the Phase 114 addition and the anti-pattern lock ("Phase 114
  branch MUST NOT call process.exit or throw").
- **Import additions**: `readInstancePolicyBytes` folded into the
  existing `./branding-config-loader.js` import line; `sshLogger` folded
  into the existing `../utils/logger.js` import line. Zero new modules
  imported.
- **`assert-boot.test.ts` mock extensions**: shared `state` gains
  `instancePolicyBytes: Buffer | null` (default null); loader mock gains
  `readInstancePolicyBytes: async () => state.instancePolicyBytes`;
  `LoadResult` type gains optional `instancePolicyFilename: unknown`;
  `makeValidLoadResult()` sets `instancePolicyFilename: ""` by default so
  Phase 74 tests continue to focus on avatarDirectorSpec without the
  Phase 114 branch firing. New `sshLoggerErrorSpy` alongside the existing
  `systemLoggerErrorSpy`, routed through the logger mock's `sshLogger.error`
  handler. `beforeEach` resets both spies and re-seeds `state.instancePolicyBytes`.

## Tests (all passing — 10/10 in the assert-boot test file)

New Phase 114 T-06 tests:

- **Test 7 (T-06a)**: empty `instancePolicyFilename` default → NO
  `sshLogger.error` call with `operation:"branding_instance_policy_boot_alarm"`,
  NO `process.exit`. Regression guard against future accidental boot
  gate on the field being set (T-114-11).
- **Test 8 (T-06b)**: field set to `"team.md"` + resolver returns
  `Buffer.from("hello twinkie")` → clean startup, no alarm, no exit.
- **Test 9 (T-06c)**: field set to `"team.md"` + resolver returns null →
  `sshLoggerErrorSpy` called with the D-05 message containing
  `"instance-policy field is set to 'team.md'"`, `"/etc/skynet/branding/team.md"`,
  `"no twinkie will be pushed"` AND metadata `{ operation:
  "branding_instance_policy_boot_alarm", instancePolicyFilename: "team.md",
  resolvedPath: "/etc/skynet/branding/team.md" }`. `exitSpy.not.toHaveBeenCalled()`
  is asserted explicitly — the non-fatal-alarm invariant test-level witness.
- **Test 10 (T-06d)**: field set to `"huge.md"` + resolver returns null
  (representing over-cap-null from the caller's view — the specific
  size-log fires inside the resolver per Plan 01 P114-T-03, out of scope
  here) → boot alarm still fires with the same shape as T-06c but the
  filename slot is `"huge.md"` and the resolved path is `/etc/skynet/branding/huge.md`.
  Guards against a code path that special-cases size vs missing at the
  caller level and forgets to alarm.

Regression coverage:

- Phase 74 Tests 1-6 all still pass unchanged: the mock extensions add
  new fields but preserve every prior mock contract. The default
  `makeValidLoadResult()` still has non-empty `avatarDirectorSpec` so
  the T-06 tests do not accidentally trip the Phase 74 gate.

## Verify

```
npx vitest run src/backend/branding/assert-boot.test.ts
# → 10 passed (10 tests, 1 file)

npx vitest run src/backend/branding/
# → 45 passed (all 4 branding test files, no regressions)

npx tsc --noEmit -p tsconfig.json
# → exit 0 (backend TS clean)
```

Acceptance-criteria greps all pass:

- `grep -c "branding_instance_policy_boot_alarm" src/backend/branding/assert-boot.ts`
  → 2 (metadata key + a docstring mention) — the code emission is present.
- `grep -c "readInstancePolicyBytes" src/backend/branding/assert-boot.ts`
  → 3 (import + call + docstring mention).
- `grep -c "sshLogger" src/backend/branding/assert-boot.ts`
  → 3 (import + call + docstring mention).
- `grep -c "systemLogger" src/backend/branding/assert-boot.ts`
  → 3 (import + call + docstring mention — Phase 74 branch preserved).
- `grep -nE "^\s*process\.exit\(" src/backend/branding/assert-boot.ts`
  → 1 match at L78 (Phase 74 branch only) — the Phase 114 branch adds
  ZERO new `process.exit` call sites.
- `grep -nE "^\s*throw new Error\(" src/backend/branding/assert-boot.ts`
  → 0 matches (no throws anywhere in the source; test file uses one
  inside the exitSpy mock which is expected).

Defense-in-depth check for the executor's success_criteria:

```
grep -E "process\\.exit|throw new Error" src/backend/branding/assert-boot.ts
```

Returns matches only in comment/docstring contexts explaining the
anti-pattern lock plus the single Phase 74 `process.exit(1)` call at
L78. The new instance-policy branch (L84-108) contains zero
`process.exit` calls and zero `throw` statements — the non-fatal-alarm
invariant is preserved.

## Commits

- **cc7c9fe1** `test(112-04): add failing T-06a..T-06d for instance-policy boot alarm` — RED phase (T-06c/d fail against un-modified source; other 8 tests pass, proving the mock extensions did not break Phase 74).
- **83ba0c38** `feat(112-04): add non-throwing instance-policy misconfig alarm to assert-boot` — GREEN phase (all 10 tests pass; tsc clean).

## Deviations from Plan

None. Plan 04 executed exactly as written — a single TDD RED → GREEN
task with the co-located imports (D-11 discretion), verbatim D-05
message shape (per 114-RESEARCH.md L667-708), and the mock extensions
listed in `<action>` step 2. No auth gates, no checkpoints, no Rule 1-4
deviations. TDD RED gate committed separately from GREEN gate for
audit clarity.

**Test-name numbering note**: the Vitest test file uses sequential
`Test 7 / 8 / 9 / 10` names (continuing from Phase 74's Test 1-6) with
the T-06a-d spec IDs called out in the test titles. This preserves the
file's existing house style (sequential-numeric titles) while making
the D-21 spec-ID linkage grep-findable inside the parens.

## Threat Flags

None. Plan 04 implements exactly the mitigations declared in the plan's
`<threat_model>`:

- **T-114-09** (transient FS errors on boot): accepted per RESEARCH §
  Pitfall 4 (a) — the alarm text is deliberately soft ("no twinkie will
  be pushed to managed hosts this sweep" is factually correct
  regardless of cause). A false-positive alarm self-resolves on the
  next sweep's successful byte-compare.
- **T-114-10** (boot alarm eating startup time on large twinkie read):
  mitigated by Plan 01's byte-cap-before-readFile short-circuit in
  `readInstancePolicyBytes` — over-cap files never consume readFile
  budget at boot.
- **T-114-11** (future contributor accidentally gates on the field
  being set): mitigated by T-06a explicitly asserting no alarm fires
  and no exit is called when `instancePolicyFilename === ""`.

No new security-relevant surface introduced outside the declared
threat register.

## Self-Check: PASSED

- `src/backend/branding/assert-boot.ts` — FOUND (modified, +57 -3, imports + docstring + new branch).
- `src/backend/branding/assert-boot.test.ts` — FOUND (modified, +168 -2, mock extensions + T-06a..d).
- Commit `cc7c9fe1` — FOUND in `git log --oneline` (RED phase).
- Commit `83ba0c38` — FOUND in `git log --oneline` (GREEN phase).
- Scoped test command exits 0: `npx vitest run src/backend/branding/assert-boot.test.ts` → 10/10 pass.
- Full branding scope clean: `npx vitest run src/backend/branding/` → 45/45 pass.
- Backend tsc clean: `npx tsc --noEmit -p tsconfig.json` → exit 0.
- Defense-in-depth grep: no `process.exit` or `throw new Error` in the new instance-policy branch code (matches limited to docstring/Phase 74).
