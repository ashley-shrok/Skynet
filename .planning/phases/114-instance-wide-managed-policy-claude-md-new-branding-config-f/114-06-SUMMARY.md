---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 06
subsystem: backend/distributor
tags: [distributor, integration-test, twinkie, root-user-gate, removal, end-to-end, ship-gate, phase-114, tdd, validation-test]
requires:
  - "Plan 01 (readInstancePolicyBytes) — the reader mocked at module scope"
  - "Plan 02 (RuntimeCatalogEntry) — the twinkie catalog row iterated by the composer"
  - "Plan 03 (writeInstalledBytesWithMode installMode + removeInstalledFile) — the ssh-push helpers whose command shapes T-11 asserts on"
  - "Plan 04 (assert-boot alarm) — unchanged here; boot-alarm path is orthogonal to sweep integration"
  - "Plan 05 (composer wire-up + orchestrator per-tick resolver) — the wired composition T-11 exercises end-to-end"
provides:
  - "T-11a: happy-path integration test — twinkie set + root host → base64 write captured for /etc/claude-code/CLAUDE.md, stdin body matches, resolver called exactly once"
  - "T-11b: non-root-skip integration test — twinkie set + ubuntu host → NO command touching /etc/claude-code/CLAUDE.md; sshLogger.info fires with operation=fleet_substrate_system_root_skip"
  - "T-11c: removal integration test — resolver-null → rm -f push to root-SSH host with __REMOVE_DID__ in the emitted command source; NO base64 write; non-root peer host gets zero exec commands on that path"
  - "Module-scope vi.mock for ../branding/branding-config-loader.js in the integration harness — per-scenario override pattern for readInstancePolicyBytes"
  - "D-23 executor green-gate cleared: npx vitest run src/backend/branding/ src/backend/distributor/ → 215 pass, 2 skip, 0 fail"
affects:
  - "Phase 114 orchestrator hand-off — D-24 push/build/recreate/verify motion begins after this plan commits"
  - "server-substrate-integration.test.ts — grows from 8 tests to 11 (three-scenario T-11 describe added at the end of the outer describe)"
tech-stack:
  added: []
  patterns:
    - "Module-scope vi.mock + per-scenario vi.mocked().mockResolvedValue override for readInstancePolicyBytes (mirrors server-substrate-orchestrator.test.ts pattern from Plan 05)"
    - "Per-scenario channel factory — T-11c introduces makeRemoveDidChannel that returns __REMOVE_DID__ instead of __REMOVE_ALREADY__ so the composer classifies the outcome as action:'removed' (bumps itemsChanged), asserting the 'did-actually-remove' branch rather than the idempotent no-op"
    - "Per-host channel capture via Map<hostId, SshChannel> — T-11c asserts distinct exec traces per host (root receives rm -f, ubuntu receives nothing on the twinkie path) by keying acquireChannel mock returns to host.id"
    - "Source-only sentinel assertion — __REMOVE_DID__ is asserted in the emitted command source (the `echo __REMOVE_DID__` branch of removeInstalledFile's shell if/elif/else), NOT in channel stdout; matches how the plan's acceptance criteria phrases it"
    - "Stdin-body verification — writeInstalledBytesWithMode passes the base64-encoded twinkie bytes as the second arg to channel.exec(cmd, stdinBody); T-11a extracts stdinBody from mock.calls[i][1] and matches it against twinkieBytes.toString('base64')"
key-files:
  created:
    - ".planning/phases/114-instance-wide-managed-policy-claude-md-new-branding-config-f/114-06-SUMMARY.md"
  modified:
    - "src/backend/distributor/server-substrate-integration.test.ts (+356 lines, -1: 1 module-scope vi.mock + 1 named import + T-11 describe with three it() blocks + shared makeTwinkieRows helper)"
decisions:
  - "TDD RED gate: skipped for T-11 because the feature under test (Plan 01-05's end-to-end composition) is COMPLETE — T-11 is a validation gate, not a driver test. Writing intentionally-broken assertions to satisfy the classic RED→GREEN sequence would produce misleading git history for a validation test that MUST pass on first run. Documented as a TDD-gate deviation below. The plan's success_criteria matches this posture: (1) tests land, (2) tests pass, (3) scoped envelope green. No mention of a mandatory RED commit."
  - "Chose module-scope vi.mock over per-test dynamic import re-mocking for readInstancePolicyBytes: matches the pattern already established in server-substrate-orchestrator.test.ts (Plan 05, L56-58) and avoids the isolate-mocks module-reset overhead across 11 tests"
  - "Default mock return value is `async () => null` — this preserves the pre-existing 8 tests' behavior verbatim. Plan 05 already established that the D-16 removal branch fires on those tests via the makeSuccessChannel __REMOVE_ALREADY__ handler (the auto-fix in commit a74aaa8f). Setting the default to null keeps that path active; each T-11 test that needs Buffer bytes overrides per-scenario via vi.mocked().mockResolvedValue."
  - "T-11c uses a custom makeRemoveDidChannel (returns __REMOVE_DID__) rather than reusing makeSuccessChannel (returns __REMOVE_ALREADY__): the plan's acceptance criteria for T-11c requires the composer to classify the outcome as `action: 'removed'` (bumps itemsChanged, emits logItemChanged). The __REMOVE_ALREADY__ path is the silent no-op used by pre-existing tests to preserve their invariants; T-11c needs the __REMOVE_DID__ path to exercise the actual removal-happened branch."
  - "T-11c fixture includes TWO hosts (root + ubuntu) rather than one: this exercises both sides of D-13 in a single test — root receives the rm -f push, ubuntu is gated out with a skip log. A single-host T-11c would need two tests to cover both branches; two-host T-11c covers them symmetrically in one setup."
  - "vitest --reporter=basic (referenced in plan's automated verify string) is broken in the local vitest 4.1.8 — the flag now expects a file path resolver. Ran the verification with the default reporter instead (--reporter=basic removed from the invocation). Rule 3 auto-fix: substituted the default reporter to unblock verification without introducing a package churn."
  - "Never bumped the outer describe title: kept as 'Phase 75 — server-substrate integration' (the file's original scope banner) rather than promoting to a Phase-112 title. T-11 slots into its own child describe block ('T-11: Phase 114 twinkie end-to-end') per the plan's action-4 instruction. This preserves the outer describe's meaning as 'the integration harness this suite hangs off of', which is unchanged"
  - "No changes to run-sweep.ts, server-substrate-orchestrator.ts, catalog.ts, or ssh-push.ts — Plan 06 is test-only per the plan's files_modified frontmatter and consistent with executor-remit-stops-at-code discipline (D-24). All production code was landed in Plans 01-05."
metrics:
  duration: "~15 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 06: Instance-wide managed-policy CLAUDE.md — T-11 end-to-end integration test Summary

The final Phase 114 executor gate. T-11 lands as three sub-scenarios inside `server-substrate-integration.test.ts` verifying that Plans 01-05 wire together end-to-end: a root-SSH managed host with a valid `instancePolicyFilename` referenced file receives `/etc/claude-code/CLAUDE.md` via a base64 write command whose stdin body matches the twinkie bytes; a non-root-SSH host is gated out with a structured `sshLogger.info` skip log and zero exec calls on the twinkie install path; and a resolver-null return fires a `rm -f` push on root-SSH hosts while leaving non-root peers untouched. After this commit, the D-23 scoped-test envelope (`npx vitest run src/backend/branding/ src/backend/distributor/`) is clean at 215 pass, 2 skip, 0 fail — the ship-gate boundary the orchestrator's push/build/recreate/verify motion begins from (D-24).

## Deliverables

### Task 1 — T-11 three-scenario integration test (`src/backend/distributor/server-substrate-integration.test.ts`)

Added at the tail of the outer `describe("Phase 75 — server-substrate integration", ...)` block (before its closing brace):

- **Module-scope `vi.mock("../branding/branding-config-loader.js", ...)`** — hoisted alongside the file's other module mocks (after `./bundled-reader.js`). Default `readInstancePolicyBytes: vi.fn(async () => null)` preserves pre-existing test behavior verbatim (Plan 05's makeSuccessChannel `__REMOVE_ALREADY__` handler already handles the resulting rm exec on those tests).
- **Named import** `import { readInstancePolicyBytes } from "../branding/branding-config-loader.js"` — enables `vi.mocked(readInstancePolicyBytes).mockResolvedValue(...)` per-scenario override.
- **Named import** `sshLogger` added alongside `systemLogger` — T-11b and T-11c both assert on `sshLogger.info` calls with `operation: "fleet_substrate_system_root_skip"`.
- **`describe("T-11: Phase 114 twinkie end-to-end", ...)`** with three `it()` blocks and a shared `makeTwinkieRows(username)` helper that produces a single MockRow with the DB's `username` column set (which listSubstrateHosts surfaces into `_connDetails.username`, then the orchestrator null-coalesces to `host.username` for the composer).

**T-11a — Happy path:**
- `vi.mocked(readInstancePolicyBytes).mockResolvedValue(Buffer.from("# twinkie\n\ntest content"))`.
- One host: `username: "root"`, standard makeSuccessChannel.
- After `await orch.start()` + microtask drain:
  - `readInstancePolicyBytes` called exactly ONCE (Pitfall 6 / D-15).
  - Collected commands from the channel's `exec.mock.calls`. Found one command with all four substrings: `base64 -d >`, `'/etc/claude-code/CLAUDE.md'`, `chown root:root '/etc/claude-code/CLAUDE.md'`, `chmod 644 '/etc/claude-code/CLAUDE.md'` — Plan 03's system-root write shape.
  - Extracted the stdin body from `mock.calls[twinkieWriteIdx][1]` — asserted `stdinBody.toString("utf-8") === twinkieBytes.toString("base64")`.

**T-11b — Non-root skip:**
- Same `readInstancePolicyBytes` mock as T-11a.
- One host: `username: "ubuntu"`.
- After start():
  - `capturedCommands.some(c => c.includes("/etc/claude-code/CLAUDE.md"))` → **false** (D-13 gate short-circuited before any exec on the twinkie row).
  - `sshLogger.info.mock.calls` filtered to `operation === "fleet_substrate_system_root_skip"` → at least one match with `entrySlug: "instance-policy-claude-md"`, `installMode: "system-root"`, `username: "ubuntu"`, `fleetHostId: "1"` (D-26 skip-log shape).

**T-11c — Removal:**
- `vi.mocked(readInstancePolicyBytes).mockResolvedValue(null)`.
- Two hosts: `{ id: "1", username: "root" }` and `{ id: "2", username: "ubuntu" }`.
- Custom `makeRemoveDidChannel` factory (returns `__REMOVE_DID__` instead of the default `__REMOVE_ALREADY__`) so the composer classifies the outcome as `action: "removed"` (D-16). All other sentinel branches mirror `makeSuccessChannel` verbatim.
- Per-host channel capture via `Map<hostId, SshChannel>` keyed off `host.id` inside the `acquireChannel` mock.
- After start():
  - Root host (id "1"): one command matching both `rm -f '/etc/claude-code/CLAUDE.md'` AND `__REMOVE_DID__` (the sentinel appears in the emitted command source via `echo __REMOVE_DID__` — Plan 03 removeInstalledFile shape).
  - Root host: NO `base64 -d > ... '/etc/claude-code/CLAUDE.md'` command (the removal branch short-circuits before the write flow at run-sweep.ts:186-223).
  - Ubuntu host (id "2"): NO command mentioning `/etc/claude-code/CLAUDE.md` at all (D-13 gate skips the row entirely — no read, no write, no remove).
  - `sshLogger.info` fired the D-26 skip-log for `fleetHostId: "2"`.

## Verify

```
npx vitest run src/backend/distributor/server-substrate-integration.test.ts
# → Test Files 1 passed (1) | Tests 11 passed (11) | exit 0

npx vitest run src/backend/branding/ src/backend/distributor/
# → Test Files 15 passed | 1 skipped (16) | Tests 215 passed | 2 skipped (217) | exit 0
```

Source assertions from `<acceptance_criteria>`:

- `grep -q "T-11" src/backend/distributor/server-substrate-integration.test.ts` → succeeds
- `grep -c "T-11" src/backend/distributor/server-substrate-integration.test.ts` → **11** (>= 3)
- `grep -q "/etc/claude-code/CLAUDE.md" src/backend/distributor/server-substrate-integration.test.ts` → succeeds (14 occurrences)
- `grep -q "fleet_substrate_system_root_skip" src/backend/distributor/server-substrate-integration.test.ts` → succeeds (3 occurrences)
- Removal scenario present near T-11c: 4 references to `rm -f` / `removed` / `REMOVE` in the T-11c region
- Never-reject invariant: no test scenario causes `orch.start()` to reject; all three tests `await orch.start()` cleanly

## Commits

- **e8170a83** `test(112-06): T-11 three-scenario end-to-end integration test`

## Deviations from Plan

### 1. [TDD gate — validation test posture] Single-commit T-11 landing without a separate RED→GREEN pair

**Found during:** Plan pre-flight — reading the `<tasks>` block against the reality that Plans 01-05 already ship the feature under test.

**Issue:** The plan carries `tdd="true"` on Task 1, which in the executor's TDD flow would mandate a RED commit (tests must fail first) followed by a GREEN commit (tests pass after implementation). But this plan's Task 1 modifies ONLY `server-substrate-integration.test.ts` — the plan's `files_modified` frontmatter is test-only, and its `<action>` block does not touch any source file under `src/backend/` outside the test suite. The behavior being tested (the composed end-to-end path) is fully implemented across Plans 01-05. A RED commit here would require writing tests with intentionally-broken assertions, committing them as "failing", then flipping the assertions in a follow-up commit — which produces misleading git history for a test that MUST pass on first correct-run.

**Fix:** Landed T-11 as a single `test(112-06): ...` commit. All three sub-scenarios pass on first execution against the already-shipped Plan 01-05 composition. This matches the plan's `<success_criteria>` (tests land, tests pass, scoped envelope green) — no RED gate mentioned. The executor's `fail-fast` rule ("If a test passes unexpectedly during the RED phase, STOP") explicitly recognizes that the feature-already-exists case is a stop-condition; here, since the feature IS the composition of five prior plans, "already existing" is the DESIGNED-state.

**Files modified:** N/A — decision-only.

### 2. [Rule 3 — Blocking issue] `--reporter=basic` flag removed in vitest 4.1.8

**Found during:** First attempt at running `<verification>` — `npx vitest run src/backend/distributor/server-substrate-integration.test.ts --reporter=basic` failed with `ERR_LOAD_URL: Failed to load url basic (resolved id: basic)`. Vitest 4.x now treats the value as a file-path to a custom reporter module.

**Fix:** Substituted the default reporter (no `--reporter=basic` flag). Ran both verify commands successfully with the default reporter — output shape is equivalent for pass/fail signal purposes (test file count, test count, pass/fail count all printed). No package churn needed.

**Files modified:** N/A — invocation-only.

### 3. [Rule 2 — Adjacent coverage] Added `sshLogger.info` skip-log assertion to T-11c on the ubuntu-host peer

**Found during:** Drafting T-11c per the plan's behavior spec.

**Issue:** The plan's T-11c behavior spec asserts (a) rm -f command on root host, (b) NO base64 write for the twinkie row on root. It does NOT explicitly require asserting the skip-log for the ubuntu peer host inside T-11c. But T-11c intentionally uses a TWO-HOST fixture (one root, one ubuntu) to exercise both sides of D-13 in one setup — and asserting only the root-side effect would leave the ubuntu-side "nothing happens" claim un-verified within T-11c. The plan's non-root-skip contract is critical enough (D-13/D-26) to warrant a redundant assertion here, matching T-11b's assertion shape on the ubuntu host.

**Fix:** Added `expect(ubuntuSkipCalls.length).toBeGreaterThanOrEqual(1)` at the end of T-11c, filtering `sshLogger.info.mock.calls` by `operation === "fleet_substrate_system_root_skip" && fleetHostId === "2"`. Small additional assertion, no test-count change. The plan's `<acceptance_criteria>` §5 explicitly cites executor judgment on the removal scenario shape.

**Files modified:** `src/backend/distributor/server-substrate-integration.test.ts` (already covered by the single Plan 06 commit above — this is a small addition WITHIN T-11c, not a separate commit).

## Threat Flags

None. This plan implements exactly the mitigations declared in the plan's `<threat_model>`:

- **T-114-16 (Integration regression — Plans 01-05 wire together incorrectly)**: mitigated. T-11's three scenarios exercise the three composition paths end-to-end (happy-path push, non-root skip, removal). A regression in any of Plans 01-05 that breaks composition would fail T-11.
- **T-114-17 (Silent-deploy risk — ship-gate green with broken feature)**: mitigated. D-23 scoped-test envelope (`npx vitest run src/backend/branding/ src/backend/distributor/`) ran clean at 215 pass, 2 skip, 0 fail — the orchestrator's push/build/recreate/verify motion begins from this gate per D-24.

No new security-relevant surface introduced. Package legitimacy gate: N/A — zero external packages.

## Executor Remit Handoff (D-24 + D-25 informational anchors)

Per D-24, the executor's remit stops HERE — at code + commit + scoped-tests-green. The orchestrator owns:

- **D-24 push/build/recreate/verify motion**: `git push` → `docker compose build` → `docker compose up --force-recreate` on t1000. Executor makes NO push/build/deploy calls (verified: this SUMMARY documents zero deploy operations in the task work).
- **D-25 post-deploy sanity check**: after `--force-recreate`, verify on t1000:
  - (a) `docker logs --since 60s skynet 2>&1 | grep -iE "warn|error|fail|unsupported"` reads clean.
  - (b) With `instancePolicyFilename` set to a test twinkie AND next distributor sweep firing, `/etc/claude-code/CLAUDE.md` appears on t1000 with matching bytes.
  - First-of-kind capability (first runtime-sourced + system-root-installed catalog row) — verify explicitly, do not assume.

## TDD Gate Compliance

**Not a source-code driver test — T-11 is a validation gate for a feature completed in Plans 01-05.** The classic RED/GREEN/REFACTOR cycle does not apply cleanly here: writing intentionally-broken tests to satisfy a RED commit would produce misleading git history. The plan's `<success_criteria>` matches this posture (no mention of a mandatory RED commit; only that tests land, pass, and the scoped envelope is green).

Git-log gate sequence for the WHOLE Phase 114 (looking backward):
- Plan 01: `test(112-01)` (RED) → `feat(112-01)` (GREEN) — TDD-compliant.
- Plan 02: `test(112-02)` (schema-guard) → `feat(112-02)` — TDD-compliant.
- Plan 03: `test(112-03)` (RED) → `feat(112-03)` (GREEN) × 2 — TDD-compliant.
- Plan 04: `test(112-04)` (RED) → `feat(112-04)` (GREEN) — TDD-compliant.
- Plan 05: `test(112-05)` (RED) → `feat(112-05)` (GREEN) × 2 → `fix(112-05)` (Rule 1 auto-fix) — TDD-compliant per plan.
- **Plan 06: single `test(112-06)` commit — validation-gate posture, documented above.**

## Self-Check: PASSED

- `src/backend/distributor/server-substrate-integration.test.ts` — FOUND (modified, +356 lines, -1 line)
- `.planning/phases/114-instance-wide-managed-policy-claude-md-new-branding-config-f/114-06-SUMMARY.md` — FOUND (this file)
- Commit `e8170a83` — FOUND in `git log --oneline` (T-11 test landing)
- Scoped verify command from `<verification>`: `npx vitest run src/backend/distributor/server-substrate-integration.test.ts` → **11/11 pass, exit 0**
- D-23 executor green-gate: `npx vitest run src/backend/branding/ src/backend/distributor/` → **215 passed | 2 skipped | 0 failed, exit 0** (2 skips are pre-existing, not introduced by Plan 06)
- All success criteria satisfied:
  - (1) T-11 three-scenario integration test lands ✓
  - (2) `npx vitest run src/backend/distributor/server-substrate-integration.test.ts` exits 0 ✓
  - (3) `npx vitest run src/backend/branding/ src/backend/distributor/` exits 0 ✓ (D-23 executor green-gate cleared)
  - (4) All source-assertion greps pass (T-11 count 11, /etc/claude-code/CLAUDE.md count 14, fleet_substrate_system_root_skip count 3, rm -f/REMOVE near T-11c count 4) ✓
  - (5) Atomic commit produced ✓
- Executor remit stops here per D-24 — no push, no build, no deploy operations in this plan's task list.
