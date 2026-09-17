---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 05
subsystem: backend/distributor
tags: [distributor, run-sweep, composer, root-user-gate, runtime-source, removal-branch, orchestrator, per-tick-resolver, host-username, phase-114, tdd, twinkie]
requires:
  - "Plan 01 (readInstancePolicyBytes) — orchestrator imports it to build the per-tick runtime bytes Map"
  - "Plan 02 (CatalogEntry discriminated union) — composer branches on entry.sourceKind; runtime rows expose resolverKey, bundled rows expose bundledPath"
  - "Plan 03 (writeInstalledBytesWithMode installMode opt + removeInstalledFile) — composer passes { installMode } through, calls removeInstalledFile on resolver-null runtime rows"
  - "Phase 111 sentinel-dispatch + never-throws contracts on ssh-push helpers (unchanged)"
provides:
  - "runSweepForHost widened host param: { id: string; name: string; username: string } (Pitfall 3)"
  - "SweepDeps.resolvedRuntimeBytes?: Map<string, Buffer | null> — pre-resolved runtime source bytes (Pattern 2 injection)"
  - "Composer D-13 root-user gate at TOP of for-of loop body: installMode === 'system-root' && host.username !== 'root' → sshLogger.info(operation: 'fleet_substrate_system_root_skip') + continue"
  - "Composer D-12/D-15 source-resolution branch: entry.sourceKind === 'runtime' pulls bytes from deps.resolvedRuntimeBytes.get(entry.resolverKey) with mode 0o644 (D-18); bundled rows unchanged"
  - "Composer D-16/D-27 removal branch: sourceKind === 'runtime' AND bundledResult === null → removeInstalledFile → maps action to logItemChanged / logItemFailed / silent-skip"
  - "Composer writeInstalledBytesWithMode call passes { installMode } opt so ssh-push branches to Plan 03's system-root command shape when the row is system-root"
  - "Composer maps writeResult.stage 'verify' (Plan 03's symlink-guard trip) → log-tags stage 'write' bucket (errorMessage carries T-114-SYMLINK reason)"
  - "Orchestrator resolveRuntimeBytesForTick helper + factory-scope currentRuntimeBytes Map — resolved ONCE per tick (start + retry), fanned to every host (Pitfall 6)"
  - "Orchestrator extracts host.username from _connDetails.username with 'unknown' fallback (safe default: composer's gate treats 'unknown' !== 'root' → skip-with-log)"
  - "Never-throw contract preserved on both run-sweep.ts and server-substrate-orchestrator.ts (grep count of bare throws = 0)"
affects:
  - "Plan 06 (integration end-to-end tests, if that plan exists) — consumes this plan's wired composer + orchestrator"
  - "server-substrate-integration.test.ts — makeSuccessChannel extended to handle __REMOVE_* sentinels (Rule 1 auto-fix, see Deviations § 1)"
  - "Every managed root-SSH host: on next sweep with instancePolicyFilename set + file present + non-empty, receives /etc/claude-code/CLAUDE.md via the wired composer path"
tech-stack:
  added: []
  patterns:
    - "Root-user gate at composer scope (Pattern 3): computed via `entry.installMode ?? 'user-home'` so bundled rows without the field default correctly; system-root gate short-circuits before ANY channel.exec, mitigating T-114-12"
    - "Per-tick resolver at orchestrator scope (Pattern 2 + Pitfall 6): resolveRuntimeBytesForTick() runs once at start() and once per retry-tick, populating a factory-scope Map that fans to every executeSweeForHost invocation via the SweepDeps closure — resolver call count === tick count, never N * ticks"
    - "Discriminated-union narrowing (Plan 02 axis): TypeScript's type-checker prevents bundledPath access on runtime rows and resolverKey access on bundled rows; composer's `if (entry.sourceKind === 'runtime')` branch is the narrowing anchor"
    - "Removal branch mapping: action:'removed' → logItemChanged(bytes-updated); action:'already-absent' → silent skip (mirrors bytes-match semantics); ok:false → logItemFailed(stage:write) — stays within existing log-tags enum per plan-author preference (PLAN.md acceptance criteria)"
    - "Stage-discriminant mapping: ssh-push's new 'verify' stage (Plan 03's symlink-guard) → log-tags 'write' bucket — 'verify' is not in log-tags' union, but the errorMessage carries the T-114-SYMLINK sentinel for greppability"
    - "Username null-coalesce to 'unknown' at orchestrator boundary — defense-in-depth per T-114-15: missing/malformed record → safely gates OUT of system-root rows"
    - "Test-side __REMOVE_* handling in integration-suite makeSuccessChannel (Rule 1 fix): return __REMOVE_ALREADY__ for the idempotent no-op path, preserving pre-Phase-112 'successful sweep → itemsFailed === 0' invariant"
key-files:
  created: []
  modified:
    - "src/backend/distributor/run-sweep.ts (+~120 lines: widened host param, added SweepDeps.resolvedRuntimeBytes, added D-13 gate + D-12 source-resolution branch + D-16 removal branch, extended writeInstalledBytesWithMode call with { installMode }, mapped writeResult.stage 'verify' → 'write')"
    - "src/backend/distributor/run-sweep.test.ts (+~330 lines: sshLogger vi.mock, HOST widened with username, catalogEntry+runtimeCatalogEntry factories, Test 1 bumped 24→25 with resolvedRuntimeBytes, Test 2 extended with resolvedRuntimeBytes, T-08/T-08b/T-09/T-10/T-10b/T-11 new tests)"
    - "src/backend/distributor/server-substrate-orchestrator.ts (+~75 lines: readInstancePolicyBytes import, resolveRuntimeBytesForTick helper, factory-scope currentRuntimeBytes let, per-tick refresh at start() and retry callback, widened host object passed to runSweepForHost with _connDetails.username null-coalesce)"
    - "src/backend/distributor/server-substrate-orchestrator.test.ts (+~195 lines: branding-config-loader vi.mock, listSubstrateHosts hosts type extended with username, P114-Orch-1..7 new tests)"
    - "src/backend/distributor/server-substrate-integration.test.ts (+13 lines: makeSuccessChannel extended with __REMOVE_* sentinel handler returning __REMOVE_ALREADY__ — Rule 1 auto-fix for pre-existing test that broke with the twinkie row's new default runtime-null path)"
decisions:
  - "Followed RESEARCH.md Pattern 2 (SweepDeps.resolvedRuntimeBytes injection) + Pattern 3 (root-user gate at composer scope, not orchestrator scope) + Pitfall 3 (widen host param, not add-to-deps) + Pitfall 6 (resolve at orchestrator scope, not composer scope) verbatim — no design deviation, only implementation detail"
  - "Map action:'removed' → changeKind: 'bytes-updated' (existing enum) rather than extending log-tags with 'removed' — smaller diff, plan-author preference (PLAN.md L103-104)"
  - "Mapped writeResult.stage 'verify' → 'write' at logItemFailed call site rather than extending log-tags stage union — errorMessage still carries T-114-SYMLINK for greppability; keeps log-tags stage enum stable for downstream dashboards"
  - "Chose null-coalesce fallback 'unknown' at orchestrator boundary rather than throwing on missing username — defensive posture: unknown value flows through composer gate as non-root → skip-with-log, safe under D-13 semantics"
  - "resolveRuntimeBytesForTick returns Map with 'instance-policy' → null on any resolver throw (defense-in-depth) — matches D-16 clean-unset-state semantics; a resolver failure is treated identically to a resolver-null return"
  - "Integration-test makeSuccessChannel returns __REMOVE_ALREADY__ (not __REMOVE_DID__) for the twinkie removal command — the test's original 'succeeding host' invariant is that itemsChanged === 0 AND itemsFailed === 0; __REMOVE_ALREADY__ is the silent-skip path that preserves both counters at 0"
metrics:
  duration: "~25 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 05: Instance-wide managed-policy CLAUDE.md — composer wire-up + orchestrator per-tick resolver Summary

Load-bearing composer wire-up for Phase 114. The `runSweepForHost` composer (`src/backend/distributor/run-sweep.ts`) gains three new branches inside its per-item catalog loop — a root-user gate (D-13/D-26), a source-resolution branch (D-12/D-15), and a removal branch (D-16/D-27) — plus a widened host parameter carrying `username` (Pitfall 3). The orchestrator (`server-substrate-orchestrator.ts`) resolves runtime-sourced catalog bytes ONCE per tick via `readInstancePolicyBytes()` and fans the resulting Map to every `runSweepForHost` invocation in that tick (Pitfall 6). After this plan, a root-SSH managed host with a valid `instancePolicyFilename` referenced file will receive `/etc/claude-code/CLAUDE.md` on the next sweep; a non-root-SSH host gets a structured `sshLogger.info(fleet_substrate_system_root_skip)` and no push attempt.

## Deliverables

### Task 1 — Composer wire-up (`src/backend/distributor/run-sweep.ts` + `.test.ts`)

- **Host param widened** at the function signature (L87-92) from
  `{ id: string; name: string }` to `{ id: string; name: string; username: string }`
  per Pitfall 3.
- **SweepDeps extended** with optional
  `resolvedRuntimeBytes?: Map<string, Buffer | null>` — pre-resolved
  runtime bytes populated ONCE per tick at orchestrator level, fanned
  to every host via the SweepDeps closure. Composer looks up by
  `entry.resolverKey`. Optional so tests that don't exercise runtime rows
  can omit it (default undefined → runtime rows fall through to null path).
- **Root-user gate (D-13/D-26)** inserted at the TOP of the for-of loop
  body, immediately after `itemsChecked++`:
  - Compute `const installMode = entry.installMode ?? "user-home";`
  - If `installMode === "system-root" && host.username !== "root"`:
    - Emit `sshLogger.info` with message
      `[substrate] skipping <slug> on host <id>: installMode=system-root requires SSH as root, current username is <user>`
      and metadata `{ operation: "fleet_substrate_system_root_skip",
      fleetHostId, hostName, entrySlug, installMode, username }`.
    - `continue;` — NO exec on the channel, no counter bump beyond
      itemsChecked (already bumped).
  - For the existing 24 bundled rows without an `installMode` field, the
    default `"user-home"` short-circuits the gate — bundled rows are
    unaffected regardless of `host.username`.
- **Source-resolution branch (D-12/D-15)** inside the outer try:
  - `if (entry.sourceKind === "runtime")` → look up
    `deps.resolvedRuntimeBytes?.get(entry.resolverKey) ?? null`;
    non-null Buffer stamps `bundledResult = { bytes, mode: 0o644 }`
    (D-18 twinkie mode invariant); null → `bundledResult = null`.
  - `else` → `bundledResult = await deps.readBundledBytes(entry.bundledPath);`
    (existing unchanged).
- **Removal branch (D-16/D-27)**: `if (entry.sourceKind === "runtime"
  && bundledResult === null)`:
  - Call `removeInstalledFile(channel, entry.installPath)` (Plan 03's
    peer helper). NO retryOnTransport wrapper — sweep retries naturally
    on next tick per D-27.
  - Map result:
    - `{ok:true, action:"removed"}` → `itemsChanged++`;
      `logItemChanged(changeKind: "bytes-updated", restartHookFired: null)`.
    - `{ok:true, action:"already-absent"}` → silent skip (no counter,
      no log — mirrors byte-compare `bytes-match` semantics).
    - `{ok:false, ...}` → `itemsFailed++`; `logItemFailed(stage:"write",
      errorMessage: rmResult.errorMessage)`.
  - `continue;` — do NOT fall through to the existing
    readInstalledBytes / decideItemAction / writeInstalledBytesWithMode
    flow.
- **writeInstalledBytesWithMode call** (L282+) extended with
  `{ installMode }` opt so ssh-push branches to Plan 03's system-root
  command shape (chown root:root, mkdir parent, symlink guard) when the
  row is system-root. For user-home rows (the existing 24), the opt is
  byte-identical to Plan 03's default per its guarantee.
- **Stage discriminant mapping**: Plan 03 extended
  `writeInstalledBytesWithMode`'s return with `stage: "verify"`
  (symlink-guard trip); log-tags' `stage` union does not include
  `"verify"` — mapped `"verify"` → `"write"` at the logItemFailed call
  site. The errorMessage carries the `T-114-SYMLINK` sentinel for
  greppability.

**Tests (21/21 pass — 16 pre-existing + 5 new P112 tests):**

- **Test 1 updated**: `itemsChecked` bumped 24→25 (Plan 02's catalog
  change); provides `resolvedRuntimeBytes` with matching bytes so the
  25th (twinkie) row byte-matches too.
- **Test 2 updated**: same `resolvedRuntimeBytes` extension for the
  twinkie row so it byte-matches the `installedMatching` stream.
- **P114-T-08 (resolver-once + null-skip triggers removal)**: runtime
  row with null resolved bytes → `rm -f` pushed (exactly one exec),
  NO base64 read, NO base64 write, `itemsChanged === 1`,
  `logItemChanged` with `entrySlug: "instance-policy-claude-md"` and
  `installPath: "/etc/claude-code/CLAUDE.md"`. `deps.readBundledBytes`
  NOT called.
- **P114-T-08b**: runtime null + `__REMOVE_ALREADY__` → silent skip
  (`itemsChanged: 0`, `itemsFailed: 0`, no log emissions) — mirrors
  bytes-match semantics.
- **P114-T-09 (runtime present + root host + push)**: runtime bytes
  non-null, host.username="root", installed absent → write fired;
  emitted command contains `chown root:root`, `/etc/claude-code/CLAUDE.md`,
  NO `~/`, and the symlink-guard invariant `test -f ... test ! -L`.
- **P114-T-10 (root gate — non-root host skip)**: host.username="ubuntu",
  same runtime row → sshLogger.info called with D-26 metadata shape;
  ZERO channel.exec calls for the row; `itemsChecked: 1, itemsChanged:
  0, itemsFailed: 0`; logItemChanged/logItemFailed NOT called.
- **P114-T-10b**: host.username="ubuntu" + user-home bundled row →
  gate does NOT fire (it's a system-root-only gate); the read command
  DID execute; no skip-log emitted.
- **P114-T-11 (removal transport failure)**: rm -f returns transport
  drop → `logItemFailed(stage:"write")` with entrySlug matching the
  twinkie; `itemsFailed === 1`.

### Task 2 — Orchestrator per-tick resolver + host.username widening (`server-substrate-orchestrator.ts` + `.test.ts`)

- **Import added**: `readInstancePolicyBytes` from
  `../branding/branding-config-loader.js` (Plan 01's never-throws reader).
- **Factory-scope Map**: `let currentRuntimeBytes: Map<string, Buffer | null> = new Map();`
  — refreshed once per tick, read by executeSweeForHost when
  constructing the SweepDeps closure.
- **`resolveRuntimeBytesForTick()` helper**: sets
  `"instance-policy"` → `readInstancePolicyBytes()` return value with
  `try/catch` defense-in-depth (Plan 01 already guarantees never-throws,
  the catch is future-proofing).
- **`start()`**: calls `resolveRuntimeBytesForTick()` at the TOP,
  BEFORE the host iteration loop. Once per tick, regardless of host
  count.
- **Retry-tick setInterval callback**: same pattern — refresh
  currentRuntimeBytes at the top, before iterating retryHosts. Fresh
  read per tick catches admin edits to the twinkie file between ticks.
- **executeSweeForHost's runSweepForHost call**:
  - Extract username from `host._connDetails.username` with
    null-coalesce to `"unknown"` if the field is missing/non-string.
  - Pass the widened host object `{ id, name, username }`.
  - Pass `currentRuntimeBytes` as `deps.resolvedRuntimeBytes`.

**Tests (25/25 pass — 18 pre-existing + 7 new P114-Orch tests):**

- **P114-Orch-1 (once-per-startup)**: 3 hosts, successful sweep →
  `readInstancePolicyBytes` called exactly ONCE at start();
  `runSweepForHost` called 3 times (per-host).
- **P114-Orch-2 (once-per-retry-tick)**: 2 hosts, all failing → 1 call
  after startup, 2 calls after 1 retry, 3 calls after 2 retries.
  Verifies per-tick count, not per-host per-tick.
- **P114-Orch-3 (Map propagation)**: `resolvedRuntimeBytes` in deps is
  an instance of Map with `"instance-policy"` key mapped to the
  resolver's return Buffer.
- **P114-Orch-4 (username propagation, root)**: host with
  `_connDetails.username = "root"` → composer receives host object with
  `.username === "root"`.
- **P114-Orch-5 (username propagation, non-root)**: `"ubuntu"` propagates
  verbatim through the composer boundary.
- **P114-Orch-6 (missing username fallback)**: `_connDetails: {}` (no
  username field) → composer receives `.username === "unknown"`.
- **P114-Orch-7 (never-throw on resolver error)**: `readInstancePolicyBytes`
  rejects → `orch.start()` does NOT reject; runSweepForHost still invoked;
  `resolvedRuntimeBytes` Map exists with `"instance-policy" → null`.

## Verify

```
npx vitest run src/backend/distributor/run-sweep.test.ts src/backend/distributor/server-substrate-orchestrator.test.ts
# → 46/46 pass, exit 0

npx vitest run src/backend/distributor/
# → 167/169 pass, 2 skipped (both pre-existing skips), exit 0

npx tsc --noEmit -p tsconfig.json
# → exit 0, zero errors project-wide
```

Source assertions from `<acceptance_criteria>`:

**Task 1 (run-sweep.ts):**
- `grep -q "host: { id: string; name: string; username: string }" src/backend/distributor/run-sweep.ts` → succeeds
- `grep -q "resolvedRuntimeBytes" src/backend/distributor/run-sweep.ts` → succeeds
- `grep -q "fleet_substrate_system_root_skip" src/backend/distributor/run-sweep.ts` → succeeds
- `grep -q "removeInstalledFile" src/backend/distributor/run-sweep.ts` → succeeds
- `grep -q 'entry.sourceKind === "runtime"' src/backend/distributor/run-sweep.ts` → succeeds
- `grep -q "host.username" src/backend/distributor/run-sweep.ts` → succeeds
- `grep -c "^throw " src/backend/distributor/run-sweep.ts` → **0** (fire-and-forget contract preserved)

**Task 2 (server-substrate-orchestrator.ts):**
- `grep -q "readInstancePolicyBytes" src/backend/distributor/server-substrate-orchestrator.ts` → succeeds
- `grep -q "resolvedRuntimeBytes" src/backend/distributor/server-substrate-orchestrator.ts` → succeeds
- `grep -qE "_connDetails\?\.username|_connDetails\.username" src/backend/distributor/server-substrate-orchestrator.ts` → succeeds
- `grep -c "^throw " src/backend/distributor/server-substrate-orchestrator.ts` → **0** (never-reject contract preserved)

## Commits

- **c0190824** `test(112-05): add failing tests for root gate + runtime source + removal branches` — Task 1 RED (6 failing tests)
- **e9b982e5** `feat(112-05): wire root gate + runtime source + removal branches into composer` — Task 1 GREEN (21/21 pass)
- **eda07665** `test(112-05): add failing tests for orchestrator per-tick resolver + host.username` — Task 2 RED (7 failing tests)
- **a4d48256** `feat(112-05): orchestrator resolves runtime bytes once per tick + widens host param` — Task 2 GREEN (25/25 pass)
- **a74aaa8f** `fix(112-05): extend integration-test success channel with __REMOVE_* handler` — Rule 1 auto-fix for integration test

Full RED → GREEN gate sequence per task (TDD discipline honored: RED commit precedes GREEN commit in the log for each task).

## Deviations from Plan

### 1. [Rule 1 - Bug] Extended integration-test `makeSuccessChannel` with `__REMOVE_*` handler

**Found during:** Task 2 GREEN verification — running the full distributor test suite (`npx vitest run src/backend/distributor/`) surfaced one failing integration test: `server-substrate-integration.test.ts > I-RETRY (D-17) > 30s tick re-sweeps failed host, skips already-succeeded host`.

**Issue:** With Plan 05's composer wiring, every sweep now iterates the 25th (twinkie) row. Since the integration test does NOT mock `readInstancePolicyBytes`, the real reader runs and returns null (the branding config has no `instancePolicyFilename` set in test defaults). Null bytes on a runtime row + `host.username === "root"` (test default via `makeRow`) triggers the D-16 removal branch, which sends an `rm -f` command through `makeSuccessChannel`. That helper had no branch matching `__REMOVE_*` sentinels — the command fell through to the safety-fallback empty-stdout branch, which `removeInstalledFile` classifies as `__REMOVE_FAIL__` → `itemsFailed++` → host NOT marked done → retry tick observed 2 acquire calls on the "succeeding" host 1 instead of the expected 1.

**Fix:** Added a `__REMOVE_*` branch to `makeSuccessChannel` that returns `__REMOVE_ALREADY__` — the idempotent no-op path that mirrors bytes-match semantics (no counter bump, no log, sweep succeeds). Preserves the pre-Phase-112 integration invariant "successful sweep → `itemsFailed === 0` → host marked done".

**Files modified:** `src/backend/distributor/server-substrate-integration.test.ts` (+13 lines).

**Commit:** `a74aaa8f` (`fix(112-05): extend integration-test success channel with __REMOVE_* handler`).

### 2. [Plan-author-preference decision] Kept `changeKind: "bytes-updated"` for removal action, did NOT extend log-tags with a "removed" changeKind

The plan (L103-104) explicitly allowed either shape but preferred staying within the existing enum to keep the plan tight. Implementation follows that preference: the D-16 removal path emits `logItemChanged({ changeKind: "bytes-updated" })` — semantically the closest fit (a byte-state change from present→absent). Future refinement to extend log-tags with a dedicated `"removed"` changeKind is a cosmetic improvement, not a correctness issue.

### 3. [Plan-author-preference decision] Kept `logItemFailed` stage union unchanged, mapped Plan 03's "verify" → "write"

Similar rationale as § 2. Plan 03 extended `writeInstalledBytesWithMode`'s return with a `stage: "verify"` discriminant (symlink-guard trip). log-tags' `stage` union is `"read-installed" | "read-bundled" | "write" | "chmod" | "restart"` — no `"verify"`. Rather than churn log-tags for one downstream stage value, the composer maps `"verify"` → `"write"` at the logItemFailed call site. The `errorMessage` still carries the `T-114-SYMLINK` sentinel for greppability. Same reasoning applies to `removeInstalledFile`'s `stage: "remove"` return — mapped to `"write"` (a mutating operation that failed).

## Threat Flags

None. This plan implements exactly the mitigations declared in the plan's `<threat_model>`:

- **T-114-12 (Elevation of Privilege — non-root host receives system-root push)**: mitigated via the composer-level D-13 root-user gate. Test P114-T-10 asserts `channel.exec` was NEVER called for the twinkie row on a non-root host, and the D-26 skip-log fired with the correct metadata.
- **T-114-13 (Information Disclosure — skip-log leaks)**: accepted per plan — the log payload contains `fleetHostId`, `hostName`, `entrySlug`, `installMode`, `username`. None are secret.
- **T-114-14 (DoS — resolver called N times per sweep)**: mitigated. Test P114-Orch-1 asserts `readInstancePolicyBytes` call count === 1 per tick regardless of host count (3 hosts → 1 resolver call).
- **T-114-15 (Tampering — missing username permits system-root writes)**: mitigated. Test P114-Orch-6 asserts a missing `_connDetails.username` field falls back to `"unknown"`, and the composer's gate treats `"unknown" !== "root"` → skip-with-log.
- **T-114-SC (Package legitimacy)**: N/A — zero external packages installed.

No new security-relevant surface introduced outside the declared threat register.

## Self-Check: PASSED

- `src/backend/distributor/run-sweep.ts` — FOUND (modified, +~120 lines)
- `src/backend/distributor/run-sweep.test.ts` — FOUND (modified, +~330 lines)
- `src/backend/distributor/server-substrate-orchestrator.ts` — FOUND (modified, +~75 lines)
- `src/backend/distributor/server-substrate-orchestrator.test.ts` — FOUND (modified, +~195 lines)
- `src/backend/distributor/server-substrate-integration.test.ts` — FOUND (modified, +13 lines, Rule 1 fix)
- Commit `c0190824` — FOUND in `git log --oneline` (Task 1 RED)
- Commit `e9b982e5` — FOUND in `git log --oneline` (Task 1 GREEN)
- Commit `eda07665` — FOUND in `git log --oneline` (Task 2 RED)
- Commit `a4d48256` — FOUND in `git log --oneline` (Task 2 GREEN)
- Commit `a74aaa8f` — FOUND in `git log --oneline` (Rule 1 integration fix)
- Scoped verify command from `<verification>`: `npx vitest run src/backend/distributor/run-sweep.test.ts src/backend/distributor/server-substrate-orchestrator.test.ts` → **46/46 pass, exit 0**
- Wider distributor suite: `npx vitest run src/backend/distributor/` → **167 passed | 2 skipped | 0 failed, exit 0** (2 skips are pre-existing)
- Full-project `npx tsc --noEmit -p tsconfig.json` → exit 0, zero errors
- Pre-existing red in `run-sweep.test.ts` (2 tests from Plan 02's 24→25 catalog change) is resolved: Test 1's assertion bumped to 25 + `resolvedRuntimeBytes` provided; Test 2 similarly updated.
- Success criteria all satisfied: D-13 gate emits structured info log with D-26 shape (verified P114-T-10); D-16 removal branch fires resolver-returns-null → rm-f push on root-SSH hosts only (verified P114-T-08); Pitfall 6 satisfied — resolver called ONCE per sweep, not per host (verified P114-Orch-1, P114-Orch-2).
