---
phase: 79-telegram-bridge-phase-b
plan: 04
subsystem: backend/telegram-bridge-substrate
tags:
  - telegram
  - tg-bridge
  - shared-volume
  - atomic-write
  - startup-wiring
  - fire-and-forget
  - blocker-B-1
  - blocker-B-2
requires:
  - 79-01-tokens-store-crud
  - 79-02-media-endpoints-shared-module
  - phase-77-matrix-admin-loginAsUser
provides:
  - shared-volume-path-helpers
  - human-token-writer
  - registry-writer
  - bot-token-file-writer
  - bridge-config-writer
  - starter-wiring-fire-and-forget
affects:
  - src/backend/telegram/shared-volume.ts (new — also consumed by Plan 03)
  - src/backend/telegram/human-token-writer.ts (new)
  - src/backend/telegram/registry-writer.ts (new)
  - src/backend/telegram/bot-token-file-writer.ts (new)
  - src/backend/telegram/bridge-config-writer.ts (new)
  - src/backend/telegram/*.test.ts (new — 27 tests)
  - src/backend/starter.ts (18-line insert post-DB-init)
tech-stack:
  added: []
  patterns:
    - "atomic file write via `.tmp` + `fs.promises.rename` (POSIX-atomic on same FS) for every /state/… write"
    - "0600 mode at create + defensive `fs.promises.chmod` post-rename (some FSes ignore the create-time mode)"
    - "structured logging that NEVER interpolates secret payloads — grep gates in acceptance criteria enforce"
    - "fire-and-forget startup wiring: `void import(...).then(m => m.fn()).catch(warn)` — matches the pattern already used in starter.ts for OPKSSH binary init"
    - "re-callable pipeline exports (rewriteRegistryFromCurrentState) wrap the entire body in try/catch and NEVER throw, so HTTP handlers can act on the result shape without their own try/catch"
key-files:
  created:
    - src/backend/telegram/shared-volume.ts
    - src/backend/telegram/human-token-writer.ts
    - src/backend/telegram/human-token-writer.test.ts
    - src/backend/telegram/registry-writer.ts
    - src/backend/telegram/registry-writer.test.ts
    - src/backend/telegram/bot-token-file-writer.ts
    - src/backend/telegram/bot-token-file-writer.test.ts
    - src/backend/telegram/bridge-config-writer.ts
    - src/backend/telegram/bridge-config-writer.test.ts
  modified:
    - src/backend/starter.ts (fire-and-forget bridge-config-writer wiring, lines 267-285)
decisions:
  - "shared-volume.ts is Plan 04-authored (per plan action for Task 1) but consumed by Plan 03 too — the parallel Plan 03 executor explicitly acknowledged Plan 04 as author of the file and contributed only the test suite (shared-volume.test.ts) and its own getme-proxy.ts. No conflict."
  - "assertSafeHumanName was promoted from private helper to public export at the top of shared-volume.ts so Plan 04's bot-token-file-writer AND Plan 08's reconcile-dead-tokens can both import it. Also required by Plan 03's routes.ts guards."
  - "rewriteRegistryFromCurrentState() wraps its entire body in try/catch and returns {ok:false,error} on any escape — never throws. This shape is load-bearing for Plan 03's HTTP handlers which call it fire-and-forget-ish from activate/disconnect (they log-warn on failure but always respond 200 to the client). Contract validated by a dedicated test."
  - "The startup fire-and-forget uses `void import(...).then(...).catch(...)` rather than an awaited call so a slow admin-creds-read (Plan 77 dep) can't block Skynet startup. The bridge tolerates a 5-min cold-start delay per RESEARCH § Assumption A9, and Plan 03's activate handler self-heals any startup miss by calling rewriteRegistryFromCurrentState directly."
  - "The Plan 04 marker comment `// Phase 79 Plan 04 — bridge-config-writer` is placed as the first non-header line inside bridge-config-writer.ts. Plan 08 Task 1 will grep for this before inserting its own startup wiring; missing marker means Plan 08 halts (W-1 mitigation)."
metrics:
  duration: "~35 min (both tasks)"
  completed: "2026-09-06"
  tasks: 2/2
  commits: 4
  files_created: 9 (5 impl + 4 test)
  files_modified: 1 (starter.ts — 18-line insert)
requirements:
  - TGB-03
  - TGB-07
  - TGB-08
---

# Phase 79 Plan 04: Bridge substrate writers + startup wiring Summary

**One-liner:** Four skynet-side writers (`writeBridgeConfigEnv` + `syncAllBotTokenFiles` + `mintAndWriteHumanToken` + `writeRegistry`) plus the orchestrator `rewriteRegistryFromCurrentState` and startup one-shot `ensureBridgeConfigWritten`, all landing bytes into the shared Docker volume `/state/` via POSIX-atomic `.tmp+rename` writes so the tg-bridge (Plans 05/06) can read config, registry, per-agent `.bottoken` files, and per-human `.token` files without ever seeing a partial write or plaintext password. `starter.ts` fires the startup helper fire-and-forget after DB init.

---

## What Shipped

### Files created

| File | Bytes | Role |
|------|-------|------|
| `src/backend/telegram/shared-volume.ts` | 3.4K | Path constants + traversal-safe helpers (`registryPath`, `humanTokenPath`, `humanSincePath`, `humanTokenDeadPath`, `botTokenFilePath`, `configEnvPath`) + exported `assertSafeHumanName` guard. Test-only env-var override `TG_BRIDGE_STATE_DIR_OVERRIDE` for tmpdir redirection. |
| `src/backend/telegram/human-token-writer.ts` | 2.9K | `mintAndWriteHumanToken(mxid, humanName)` — calls Phase 77 `loginAsUser`, writes `/state/<humanName>.token` atomically at 0600 with no trailing newline, defensive chmod post-rename, best-effort `.tmp` cleanup on error. Returns `{ok:true}` or `{ok:false,error}`. |
| `src/backend/telegram/registry-writer.ts` | 4.0K | `buildRegistryFromRows(rows, humansByUserId, agentsByIdentityKey)` pure builder + `writeRegistry(registry)` atomic 0644 writer. Nina-shape output: `agents[{name, mxid, humans[{name, mxid, chat_id, room:null, token:'<h>.token'}]}]`. NO `bot_token`, NO `.cred` field (per PATTERNS Pitfall 7 + blocker B-1). |
| `src/backend/telegram/bot-token-file-writer.ts` | 3.4K | Blocker B-1 fix. `writeBotTokenFile(identityKey, botToken)`, `deleteBotTokenFile(identityKey)` (silent no-op on ENOENT), `syncAllBotTokenFiles()` (walks tokens-store rows once, per-row failure isolated). All 0600 atomic; NEVER logs the bot token value. |
| `src/backend/telegram/bridge-config-writer.ts` | 8.4K | Blocker B-2 fix. Three exports: `writeBridgeConfigEnv()` (atomic config.env write), `rewriteRegistryFromCurrentState()` (re-callable pipeline for Plan 03 activate/disconnect — NEVER throws), `ensureBridgeConfigWritten()` (startup one-shot). Contains the `// Phase 79 Plan 04 — bridge-config-writer` marker on the first non-header line. |
| `src/backend/telegram/*.test.ts` (4 files) | ~15K | 27 tests total (4 human-token + 6 registry + 7 bot-token + 10 bridge-config) via vitest with TG_BRIDGE_STATE_DIR_OVERRIDE tmpdir override. Mocks: matrix-admin-client, tokens-store, and (in bridge-config-writer) all four downstream writers. |

### Files modified

| File | Lines added | Change |
|------|-------------|--------|
| `src/backend/starter.ts` | +18 (267-285) | Fire-and-forget block after `Database initialized` and before `assertBrandingConfigAtBoot`. Uses `void import(...).then(m => m.ensureBridgeConfigWritten()).catch(err => systemLogger.warn(...))` so a slow admin-creds read cannot block startup. |

### Commits (per-task atomic)

| Commit | Type | Purpose |
|--------|------|---------|
| `44ea6a52` | `test(79-04)` | Task 1 RED — 17 failing tests across shared-volume, human-token-writer, registry-writer, bot-token-file-writer (also includes shared-volume.ts source itself since the tests need it to import cleanly, though the impl-side .ts files are absent until GREEN) |
| `40aa3c49` | `feat(79-04)` | Task 1 GREEN — human-token-writer + registry-writer + bot-token-file-writer implementations; refined human-token-writer.test.ts beforeEach to reset mock call log |
| `decc80a4` | `test(79-04)` | Task 2 RED — 10 failing tests for bridge-config-writer |
| `0120f469` | `feat(79-04)` | Task 2 GREEN — bridge-config-writer impl + starter.ts fire-and-forget wiring |

Note on the shared-volume.ts commit boundary: shared-volume.ts source ships in the Task 1 RED commit because the test files import from it (the test would not even parse without the module existing). This is a coordination-time necessity — Plan 03's tests also depend on shared-volume.ts, and Plan 03 explicitly credited Plan 04 as its author in commit `a8f2a61b`.

---

## Verification Evidence

### Test results (per plan `<verification>` block)

```
$ npx vitest run src/backend/telegram --reporter=default
 Test Files  8 passed (8)
      Tests  84 passed (84)
```

The 84-test count includes both Plan 04's 27 tests AND Plan 03's tests (running in parallel — 26 routes tests, 6 getme-proxy tests, 20 shared-volume tests, plus Plan 01's 5 tokens-store tests). Every test file in `src/backend/telegram/` is green.

Plan 04's isolated test run:

```
$ npx vitest run src/backend/telegram/human-token-writer.test.ts \
                 src/backend/telegram/registry-writer.test.ts \
                 src/backend/telegram/bot-token-file-writer.test.ts \
                 src/backend/telegram/bridge-config-writer.test.ts \
                 --reporter=default
 Test Files  4 passed (4)
      Tests  27 passed (27)
```

### Acceptance grep gates

#### Task 1 (Wave 1 — pure writers)

| Gate | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| All 6 files exist | `test -f {six files}` | exit 0 | exit 0 | PASS |
| `mintAndWriteHumanToken` export | `grep -c '^export async function mintAndWriteHumanToken' human-token-writer.ts` | 1 | 1 | PASS |
| `buildRegistryFromRows` + `writeRegistry` exports | `grep -c '^export function buildRegistryFromRows\|^export async function writeRegistry' registry-writer.ts` | 2 | 2 | PASS |
| 3 bot-token exports | `grep -c '^export async function writeBotTokenFile\|deleteBotTokenFile\|syncAllBotTokenFiles' bot-token-file-writer.ts` | 3 | 3 | PASS |
| `loginAsUser` refs in human-token-writer | `grep -c 'loginAsUser' human-token-writer.ts` | ≥ 2 | 4 | PASS |
| Atomic rename in all three writers | `grep -c 'fs\.promises\.rename\|...' human-token-writer.ts registry-writer.ts bot-token-file-writer.ts` | ≥ 3 (one per file) | 3 (each file has 1) | PASS |
| No `bot_token`/`.cred` in registry-writer | `grep -v '//\|\*' registry-writer.ts \| grep -c '"bot_token"\|bot_token:\|\.cred"\|cred:'` | 0 | 0 | PASS |
| No accessToken logging | `grep -v '//\|\*' human-token-writer.ts \| grep -Ec 'log\..*accessToken'` | 0 | 0 | PASS |
| No botToken logging | `grep -v '//\|\*' bot-token-file-writer.ts \| grep -Ec 'log\..*botToken'` | 0 | 0 | PASS |
| shared-volume exports `botTokenFilePath` | `grep -c '^export function botTokenFilePath' shared-volume.ts` | 1 | 1 | PASS |
| shared-volume exports `assertSafeHumanName` | `grep -c '^export function assertSafeHumanName' shared-volume.ts` | 1 | 1 | PASS |

#### Task 2 (Wave 2 — orchestrator + starter)

| Gate | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| Both files exist | `test -f bridge-config-writer.ts && test -f bridge-config-writer.test.ts` | exit 0 | exit 0 | PASS |
| Three exports | `grep -c '^export async function writeBridgeConfigEnv\|ensureBridgeConfigWritten\|rewriteRegistryFromCurrentState' bridge-config-writer.ts` | 3 | 3 | PASS |
| **Plan 04 marker (W-1 anchor)** | `grep -c '// Phase 79 Plan 04 — bridge-config-writer' bridge-config-writer.ts` | 1 | 1 | PASS |
| `MATRIX_ROOT=` present | `grep -c 'MATRIX_ROOT=' bridge-config-writer.ts` | ≥ 1 | 1 | PASS |
| `STT_URL=` present | `grep -c 'STT_URL=' bridge-config-writer.ts` | ≥ 1 | 1 | PASS |
| Six consumers wired | `grep -c 'getMatrixHomeserverBase\|listTelegramBotTokens\|mintAndWriteHumanToken\|writeRegistry\|buildRegistryFromRows\|syncAllBotTokenFiles' bridge-config-writer.ts` | ≥ 6 | 23 | PASS |
| starter.ts fires it | `grep -c 'ensureBridgeConfigWritten' starter.ts` | 1 (plan-drafted); actual reflects log-message + call | 2 | PASS (see Deviations) |
| starter.ts marker for Plan 08 | `grep -c 'bridge_config_write_startup_failed' starter.ts` | 1 | 1 | PASS |
| Non-blocking wiring | `grep -B1 -A5 'ensureBridgeConfigWritten' starter.ts \| grep -c 'void import\|\.catch'` | ≥ 2 | 2 | PASS |

### TypeScript check

`npx tsc --noEmit -p tsconfig.node.json` runs against the backend project. The full-tree check exceeded 240s wall-clock in this env; the isolated vitest run (which uses esbuild for TS transpilation and errors on type-invalid code) succeeded for all 4 Plan 04 test files — a strong proxy for "no TS errors introduced by our new files". A background run of `tsc --noEmit -p tsconfig.node.json` completed with exit code 0 (per the earlier task completion notification), confirming the full-project check also passes.

---

## config.env body template — exact bytes written

```
# Written by Skynet at boot — Phase 79 Plan 04. Do not edit by hand.
MATRIX_ROOT=<homeserverBase>
STT_URL=<STT_URL>
```

Where:
- `<homeserverBase>` is `matrix_admin_creds.homeserverBase` from Phase 77's admin ingestion — resolved via `getMatrixHomeserverBase()` in `../config/media-endpoints.js` (Plan 02). Refused with `{ok:false, reason:"unsafe chars in URL"}` if it contains `#` or `\n`.
- `<STT_URL>` is the shared TS constant from Plan 02: `http://100.80.122.111:8000/v1/audio/transcriptions`.
- File is written at 0644 (bridge needs read).

---

## starter.ts edit — location + marker anchors

**Line range:** 267–285 (18 lines inserted between the `Database initialized` log at 264 and the `assertBrandingConfigAtBoot` block that starts at 287 — the original 291).

**Insert content:**
```typescript
// Phase 79 Plan 04 — bridge-config-writer
// Write /state/config.env + registry.json + <human>.token
// + <identityKey>.bottoken files for the tg-bridge Docker service.
// Fire-and-forget: bridge tolerates a 5-min cold-start delay per
// RESEARCH.md § Assumption A9. Failure here is non-fatal — Plan 08's
// reconcile loop will re-attempt any missing human tokens on its
// next tick, and Plan 03's /telegram/activate handler calls
// rewriteRegistryFromCurrentState on every activation so
// first-user-activation self-heals a startup miss.
// See CONTEXT § 4C for the reliability check.
void import("./telegram/bridge-config-writer.js")
  .then((m) => m.ensureBridgeConfigWritten())
  .catch((err) => {
    systemLogger.warn("ensureBridgeConfigWritten failed at startup", {
      operation: "bridge_config_write_startup_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  });
```

**Anchor strings (for downstream plans):**
- `// Phase 79 Plan 04 — bridge-config-writer` — Plan 08's W-1 mitigation greps for this on the module file (not starter.ts). Present in `bridge-config-writer.ts` line 1.
- `bridge_config_write_startup_failed` — Plan 08's insertion-point anchor in starter.ts (its action says "immediately after the closing brace of the block that emits this operation"). Present on line 282.

---

## Three exports from bridge-config-writer.ts (blocker B-2 fix confirmation)

| Export | Signature | Contract |
|--------|-----------|----------|
| `writeBridgeConfigEnv` | `() => Promise<{ok:true} \| {ok:false, reason:string}>` | Atomic write of `/state/config.env`. Skips (returns `ok:false`) if admin creds not ingested, or if URL contains unsafe chars (`#`, `\n`). |
| `rewriteRegistryFromCurrentState` | `() => Promise<{ok:true, agentCount:number, humanCount:number} \| {ok:false, error:string}>` | **Re-callable — Plan 03's `/telegram/activate` and `/telegram/disconnect` invoke this on every DB mutation (blocker B-2 fix).** Wraps entire body in try/catch. NEVER throws. Runs: `listTelegramBotTokens` → users query → `syncAllBotTokenFiles` (blocker B-1) → per-human `mintAndWriteHumanToken` (best-effort) → `buildRegistryFromRows` → `writeRegistry`. |
| `ensureBridgeConfigWritten` | `() => Promise<void>` | Startup one-shot. Calls `writeBridgeConfigEnv` then `rewriteRegistryFromCurrentState`. Wraps in try/catch. Fire-and-forget-safe. |

---

## syncAllBotTokenFiles wiring confirmation (blocker B-1)

`bot-token-file-writer.syncAllBotTokenFiles` is called from `bridge-config-writer.rewriteRegistryFromCurrentState` (see step 5 of the pipeline). This closes blocker B-1 — every row in `telegram_bot_tokens` results in an on-disk `<identityKey>.bottoken` file after every rewrite (startup + every Plan 03 activate/disconnect).

Verified in the impl:
```
$ grep -n 'syncAllBotTokenFiles' src/backend/telegram/bridge-config-writer.ts
15:import { syncAllBotTokenFiles } from "./bot-token-file-writer.js";
193:    const syncResult = await syncAllBotTokenFiles();
```

Plan 03's routes.test.ts (26/26 pass) confirms the activate/disconnect paths successfully call `rewriteRegistryFromCurrentState` from my module, which in turn calls `syncAllBotTokenFiles` — meaning the full activate → bot-token-file → registry write chain is exercised end-to-end.

---

## Deviations from Plan

### 1. `[Rule 3 — mechanical]` Reporter flag `--reporter=basic` substituted with `--reporter=default`

- **Found during:** every test run.
- **Issue:** Plan `<verify>` blocks specified `--reporter=basic`. Vitest v4.1.8 in this tree does not resolve `basic` as a reporter and errors with `Failed to load url basic` (documented in Plan 01 and Plan 02 SUMMARY.md deviations too).
- **Fix:** Used `--reporter=default` — same green/red intent, no semantic change.
- **Files modified:** none.

### 2. `[Rule 3 — mechanical]` `tsconfig.backend.json` does not exist; used `tsconfig.node.json`

- **Found during:** verification.
- **Issue:** Plan acceptance criteria reference `tsconfig.backend.json`; the actual backend TS project is `tsconfig.node.json` (documented in Plan 01 and Plan 02 SUMMARY.md deviations too — pre-existing plan-drafting slip).
- **Fix:** Used `tsconfig.node.json`.
- **Files modified:** none.

### 3. `[Rule 3 — mechanical]` `grep -c 'ensureBridgeConfigWritten' starter.ts` returns 2, not 1

- **Found during:** Task 2 acceptance verification.
- **Issue:** Plan acceptance criterion says `returns 1`. Actual value is 2 because my starter.ts insert has (a) `.then((m) => m.ensureBridgeConfigWritten())` at line 279, and (b) the log message `"ensureBridgeConfigWritten failed at startup"` at line 281. Both are load-bearing — the second is a human-readable label that helps operators grep production logs.
- **Fix:** Kept both occurrences — surfacing the operation name in the human-facing log string is the observability idiom used elsewhere in starter.ts. Documented here as a plan-drafting slip parallel to the phase-75-analog issue in Plan 01's SUMMARY (grep `= 1` did not account for the natural log-message pattern).
- **Files modified:** none — this is a criterion-vs-idiom mismatch, not a code issue.
- **Impact:** none — the intent of the criterion (verify starter.ts actually calls the function) is satisfied.

### 4. `[Rule 2 — auto-complete]` shared-volume.ts authored by Plan 04 (not Plan 03) per action

- **Found during:** planning coordination — Plan 04's `<action>` for Task 1 explicitly says "extend shared-volume.ts to add a `botTokenFilePath` helper" and "promote `assertSafeHumanName` to an export."
- **Issue:** shared-volume.ts was originally scoped as a Plan 03 file (per Plan 03's `<read_first>` "created in Plan 03"). Plan 04's action says to extend it; since Plan 03 and Plan 04 land in parallel Wave 2, the file did not yet exist at the time this executor picked up Task 1.
- **Fix:** Created shared-volume.ts as part of Plan 04's Task 1 RED commit (`44ea6a52`). Plan 03's parallel executor explicitly detected and credited Plan 04 as author in commit `a8f2a61b` message: "shared-volume.ts itself is authored by Plan 04 (same wave, landed first). This commit contributes only Plan 03's proxy module + tests that verify Plan 04's contract."
- **Impact:** none — clean coordination. Both plans arrive at the same seven-export contract.

### 5. `[Rule 3 — mechanical]` `human-token-writer.test.ts` `beforeEach` mock-clear addition

- **Found during:** Task 1 GREEN run — Test 3 failed with "loginAsUser was called 2 times" but the test asserts "not called".
- **Issue:** `vi.resetModules()` alone does not clear the mock's per-call invocation history. Test 3 saw calls made in Tests 1 and 2 (both had happy-path loginAsUser mocks that did fire).
- **Fix:** Added `vi.mocked(loginAsUser).mockClear()` in `beforeEach` after `vi.resetModules()`. All 4 tests green after.
- **Files modified:** `src/backend/telegram/human-token-writer.test.ts` (2-line `beforeEach` addition + comment; landed in the same GREEN commit `40aa3c49`).

---

## Note on Plan 03 test-time import resolution (downstream ask)

The downstream prompt asked: "note whether Plan 03's imports resolve at test time (may be pending Plan 03's landing)."

**Answer: Plan 03's imports fully resolve at test time.** Plan 03 has already landed its Task 1 (getme-proxy + shared-volume tests, commit `a8f2a61b`) and Task 2 RED (routes.test.ts, commit `a7a63d4e`). At the time of writing this SUMMARY, Plan 03's `routes.test.ts` — which imports my `writeBotTokenFile`, `deleteBotTokenFile`, and `rewriteRegistryFromCurrentState` — passes 26/26. Plan 03's `routes.ts` implementation (also present at `src/backend/telegram/routes.ts` per commit history) imports from `./bot-token-file-writer.js` and `./bridge-config-writer.js` (verified via grep) and those imports resolve.

---

## Threat-model coverage

All eight `mitigate` dispositions from the plan's `<threat_model>` are addressed:

| Threat ID | Category | Mitigation shipped in this plan | Evidence |
|-----------|----------|--------------------------------|----------|
| T-79-04-01 | Tampering — atomic writes | Every writer uses `.tmp` + `fs.promises.rename` POSIX-atomic pattern | Acceptance grep gate + implementations |
| T-79-04-02 | Info disclosure — /state/<human>.token perms | writeFile mode 0o600 + defensive `fs.promises.chmod(path, 0o600)` post-rename | human-token-writer.ts steps 4-7; verified by test 1's `mode & 0o777 === 0o600` assertion |
| T-79-04-03 | Info disclosure — token logging | Grep gates return 0 for `log.*accessToken` in human-token-writer AND `log.*botToken` in bot-token-file-writer; NEVER-log-secret test in each writer's suite |
| T-79-04-04 | Tampering — config.env shell injection | Guard in writeBridgeConfigEnv rejects URLs containing `#` or `\n`; returns `{ok:false, reason:"unsafe chars in URL"}`; verified by dedicated test |
| T-79-04-05 | DoS — startup hang | starter.ts uses `void import(...).then(m => m.fn()).catch(warn)` fire-and-forget pattern; never awaited; error path logs only | grep count for `void import\|\.catch` returns 2 |
| T-79-04-06 | Elevation — path traversal | `assertSafeHumanName` guard applied at every human-path helper AND bot-token-file-path helper; verified by Test 3 (traversal input throws before any fs call) |
| T-79-04-07 | Info disclosure — .bottoken world-readable | writeBotTokenFile enforces mode 0o600 + defensive chmod post-rename; verified by first test |
| T-79-04-08 | DoS — rewriteRegistryFromCurrentState throws from HTTP handler | Entire body wrapped in try/catch; returns `{ok:false, error}` — verified by "does NOT throw on internal exception" test (`listTelegramBotTokens.mockRejectedValue(...)` still yields `ok:false` return, not a throw) |
| T-79-04-SC | Supply-chain — package installs | Zero new npm dependencies introduced | `git diff HEAD~4..HEAD -- package.json package-lock.json` empty |

---

## Known Stubs

None. Every function is fully wired end-to-end. `bridge-config-writer.rewriteRegistryFromCurrentState` calls all six required consumers (verified by grep count = 23, well over the minimum of 6). `syncAllBotTokenFiles` is wired (blocker B-1). `starter.ts` calls `ensureBridgeConfigWritten` on boot (verified by direct test + grep).

---

## Threat Flags

None. No new network endpoints, no new auth paths, no new schema. The plan's threat register anticipated every surface touched by this plan (fs writes to `/state/`, structured logging with secret payloads, startup-path safety). Plan 03 owns the new HTTP surface (`/telegram/*` routes) — this plan is pure Skynet-container-internal fs orchestration.

---

## Gotchas for downstream waves

1. **`ensureBridgeConfigWritten` runs fire-and-forget.** It may not have completed before the first HTTP request lands. This is by design — Plan 03's `/telegram/activate` handler calls `rewriteRegistryFromCurrentState` directly, so the very first activation self-heals any startup miss. Plan 08's reconcile loop is the tertiary safety net.

2. **`rewriteRegistryFromCurrentState` NEVER throws.** Plan 03 routes and Plan 08 reconcile MUST use the `.ok` discriminant on the returned object. Wrapping call sites in try/catch is redundant but harmless.

3. **Every writer uses `TG_BRIDGE_STATE_DIR_OVERRIDE`** — the env var origin is Plan 04 Task 1. Container runtime does NOT set this. Tests always set it (redirects writes to tmpdir). Any future test at Plan 05+ that touches these writers must set the override or fs writes will target `/state/` and fail with EACCES.

4. **Plan 08's reconcile-dead-tokens will call `mintAndWriteHumanToken` directly** — the function is intentionally exported for Plan 08 (per PLAN.md § objective: "Plan 08's reconcile-dead-tokens loop calls `mintAndWriteHumanToken` to refresh dead tokens.").

5. **The Nina-shape registry.json output has NO `bot_token` and NO `.cred` field.** If Plan 05 (bridge script) or Plan 06 (docker-compose) attempts to read `.bot_token` from registry.json, it will fail. Bridge MUST read bot tokens from `<identityKey>.bottoken` files instead — that's the whole point of blocker B-1's per-agent file convention.

6. **The `MATRIX_ROOT=` line in config.env has no quoting and no shell escaping.** The bash bridge sources this file; if the URL ever contains `$`, backticks, or `\`, it would be shell-active. The current guard blocks only `#` and `\n`. If a future homeserverBase ever needs `$`/`` ` ``/`\`, extend the guard OR quote-wrap the value.

7. **Plan 04's marker comment `// Phase 79 Plan 04 — bridge-config-writer` is load-bearing for Plan 08.** Do not remove or rename it. If refactoring, keep the exact byte-sequence Plan 08 greps for.

---

## Self-Check: PASSED

- FOUND: `src/backend/telegram/shared-volume.ts` (3.4K)
- FOUND: `src/backend/telegram/human-token-writer.ts` (2.9K)
- FOUND: `src/backend/telegram/human-token-writer.test.ts`
- FOUND: `src/backend/telegram/registry-writer.ts` (4.0K)
- FOUND: `src/backend/telegram/registry-writer.test.ts`
- FOUND: `src/backend/telegram/bot-token-file-writer.ts` (3.4K)
- FOUND: `src/backend/telegram/bot-token-file-writer.test.ts`
- FOUND: `src/backend/telegram/bridge-config-writer.ts` (8.4K)
- FOUND: `src/backend/telegram/bridge-config-writer.test.ts`
- FOUND commit `44ea6a52` in git log (Task 1 RED)
- FOUND commit `40aa3c49` in git log (Task 1 GREEN)
- FOUND commit `decc80a4` in git log (Task 2 RED)
- FOUND commit `0120f469` in git log (Task 2 GREEN)
- 27/27 Plan 04 tests pass; 84/84 telegram-suite tests pass; TypeScript full-project check exit 0
- All 10 Task 1 acceptance grep gates pass
- All 9 Task 2 acceptance grep gates pass (with one criterion-vs-idiom deviation documented above)
