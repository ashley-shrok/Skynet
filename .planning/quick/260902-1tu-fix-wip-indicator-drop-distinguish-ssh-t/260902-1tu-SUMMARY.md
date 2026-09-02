---
phase: 260902-1tu-fix-wip-indicator
plan: 01
subsystem: fleet-status / ssh-poll-orchestrator
tags: [wip-indicator, fleet-status, ssh-transport, liveness-check, fail-open, session-gone, bounty-9c8d4a72]
requires: []
provides:
  - readStatWithSentinel (module-scope helper distinguishing transport error from PID-dead)
  - Fail-OPEN reap path — SSH channel-open-failure never publishes session_gone by itself.
affects:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (processPid ~L1198, sweepOneHost ~L2062)
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts (fixture contract + 4 new regression tests at :6847)
tech-stack:
  added: []
  patterns: [exit-code-sentinel-wrapper, tagged-discriminated-union, fail-open-on-transport]
key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - Insert helper at module scope, exported (co-located with SshChannel interface).
  - Fixture contract shift — makeStatContents now emits `<content>\n__STAT_OK__` to model the post-fix shell command output; 3 pre-existing null-stat fixtures migrated to `__STAT_ENOENT__`.
metrics:
  duration_seconds: 738
  tasks_completed: 2
  files_touched: 2
  tests_before: 118
  tests_after: 122
  new_tests: 4
  completed: 2026-09-02T01:35:00Z
---

# 260902-1tu Plan 01: Fix WIP Indicator Drop — Distinguish SSH Transport Error from PID-Dead in Stat Read — Summary

**One-liner:** Added `readStatWithSentinel(channel, pid)` at module scope in `ssh-poll-orchestrator.ts` — wraps the `/proc/<pid>/stat` exec in a shell sentinel (`&& echo __STAT_OK__ || echo __STAT_ENOENT__`) and returns a tagged discriminated union so SSH channel-open-failure (bounty 9c8d4a72's Tina 2026-09-02 root cause) never conflates with real PID-dead ENOENT and never reaps a live session.

---

## Location & line numbers (post-fix)

### `src/backend/fleet-status/ssh-poll-orchestrator.ts`

- **Helper `readStatWithSentinel`:** line **151** (`export async function readStatWithSentinel(...)`). Docblock at lines 111-149. Type alias `StatReadResult` at line **128**.
- **Call site 1 — processPid Promise.all triple:** line **1198** (`const statPromise = readStatWithSentinel(channel, pid);`). Prior code was `channel.exec(\`cat /proc/${pid}/stat\`)` at the estimated ~L1119; drift = ~+79 lines due to helper block insertion above.
- **Call site 2 — processPid stale-check dispatch:** line **1643** onwards (tagged-union branch on `statResult`; transport → debug log + skip stale-check; enoent + ok → feed to `isStaleFromStat`). Prior code was the single `const stale = isStaleFromStat(...)` at estimated ~L1565; drift = ~+78 lines.
- **Call site 3 — sweepOneHost:** line **2062** (`const statResult = await readStatWithSentinel(channel, pid);`). Prior code was at estimated ~L1959; drift = ~+103 lines.

### Scope-guard verification (unchanged)

```
git diff --stat src/backend/fleet-status/liveness-check.ts src/backend/starter.ts
(empty — both files byte-identical to pre-fix)
```

- `liveness-check.ts` — pure `isStaleFromStat` contract preserved. The fix stops feeding `null` to it on transport error; the function itself still treats `null` as PID-dead (unchanged), and the sentinel path (`ok: false, reason: 'enoent'`) is remapped to `null` at the call site so the ENOENT branch still fires exactly as today.
- `starter.ts` — null-on-error channel adapter preserved. Every other consumer of `SshChannel.exec` (session JSON reads, hook payload reads, environ reads, tmux reads, per-session stat mtime reads) keeps its existing fail-open-via-null contract.

---

## New regression tests

Location: `src/backend/fleet-status/ssh-poll-orchestrator.test.ts:6847` — new describe block `transport-vs-dead distinction in stat read (bounty 9c8d4a72)`.

| Line | Test | Purpose |
|---|---|---|
| **6853** | `Test 1 — Transport failure: null stat return does NOT reap (fail-OPEN, session stays live) [THE bug fix]` | Pins the fix. Pre-fix, this asserts `publishedGone === []` would have failed because `isStaleFromStat(_, null) === true` reaped the live session. |
| **6874** | `Test 2 — Real PID reuse: sentinel-wrapped stat with mismatched field22 DOES reap [baseline]` | Confirms the field22-mismatch reap path still works via the sentinel-wrapped content. |
| **6894** | `Test 3 — Live PID: sentinel-wrapped stat with matching field22 does NOT reap [baseline]` | Confirms the happy path (default `buildDeps()` fixture) still passes. |
| **6912** | `Test 4 — Real absence: bare __STAT_ENOENT__ sentinel DOES reap [baseline]` | Confirms real PID-dead still reaps via the ENOENT sentinel. |

All 4 use the existing `MockSshChannel` (`.setResponse` + substring-includes matcher at test :90) — the substring `cat /proc/12345/stat` still matches the post-fix wrapped command because the fix's `\`cat /proc/${pid}/stat 2>&1 && echo __STAT_OK__ ...\`` contains the substring literally.

---

## Scoped test gate output (tail)

```
 RUN  v4.1.8 /home/ubuntu/skynet-tanya


 Test Files  1 passed (1)
      Tests  122 passed (122)
   Start at  01:35:13
   Duration  20.17s (transform 10.45s, setup 1.13s, import 11.60s, tests 2.85s, environment 0ms)
```

Command run: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts`. Delta: 118 → 122 tests, all green.

---

## Commits

| Task | Commit | Description |
|---|---|---|
| 1 | `0ddb876c` | `fix(260902-1tu-01): distinguish SSH transport error from PID-dead in stat read` — helper + two call sites + fixture contract shift. |
| 2 | `6731606e` | `test(260902-1tu-02): pin transport-vs-dead distinction in ssh-poll-orchestrator` — 4 regression tests. |

---

## Deviations from Plan

### `[Rule 3 — Blocking Fix]` Task 1 fixture contract shift — makeStatContents + 3 null-stat call sites

- **Found during:** Task 1 verification (`npx vitest run` after implementing the helper + call sites).
- **Issue:** The plan's `<done>` for Task 1 said "Existing test suite still passes (all baselines preserved)" but changing the stat-read command shape from raw `cat /proc/12345/stat` to `cat /proc/12345/stat 2>&1 && echo __STAT_OK__ || echo __STAT_ENOENT__` broke 4 baseline tests because:
  1. `makeStatContents(starttime)` returned raw /proc/stat with no sentinel → post-fix Rule 4 (unknown shape) fired → transport → no reap; but tests using it as "live stat" still passed since transport = no reap = live-behaviour-equivalent. However —
  2. Three tests (Test 7 sweep-reap, Test 9 environ re-read after reap, Test P52-01-T3-vii source-B rediscover) set `channel.setResponse("cat /proc/12345/stat", null)` to simulate PID-dead. Under the fix's new contract, `null` = transport = fail-OPEN = **no reap** → those tests now saw `publishedGone.length === 0` and failed.
  3. Test 55-D used `wireSourceAResponses({statStarttime: "99999"})` (raw stat, no sentinel) to force a stale reap; the raw content falls into Rule 4 → transport → no reap → cache write happens (which the test asserts must NOT happen) → fail.
- **Fix:** Updated `makeStatContents` helper (test file :168) to append `\n__STAT_OK__` — every existing fixture using it now exercises the post-fix command shape end-to-end. Migrated the 3 null-stat fixtures (test file :478, :552, :2930) to `"__STAT_ENOENT__"` — under the new contract, ENOENT is signalled via sentinel, not null. This aligns fixture semantics with the new contract while preserving the tests' original **intent** (real PID-dead → reap).
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (4 sites — 1 helper + 3 fixture-site migrations).
- **Commit:** `0ddb876c` (bundled into Task 1 per Rule 3 — needed for Task 1's own verification to pass).
- **Rule 3 justification:** The task was blocked from meeting its own `<done>` criterion ("existing tests still pass") without the fixture update. The change is a fixture contract migration to match the new command shape — no test *semantics* were altered (real-PID-dead still means reap, live-PID still means no-reap), only the fixture *encoding* of those semantics.

### `[Note — Vitest CLI flag]` `--related` requires `--changed`

- **Found during:** Baseline test run before Task 1.
- **Issue:** Plan constraint says run `npx vitest run --related src/backend/fleet-status/ssh-poll-orchestrator.ts`; vitest v4.1.8 rejects `--related` unless paired with `--changed` (which itself requires a git diff base). The semantic intent (scope tests to this file) is equivalent to running the corresponding `.test.ts` directly.
- **Fix:** Ran `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — same scope, no ambiguity. Recorded in this SUMMARY under the scoped-test-gate section above so the orchestrator's ship-gate uses the working invocation.
- **Files modified:** none (docs-only note).
- **Commit:** n/a.

---

## Auth gates

None.

---

## Known Stubs

None.

---

## Deferred Issues

None.

---

## Threat Flags

None. The fix strictly narrows the reap trigger (was: null-or-mismatch; now: sentinel-enoent-or-mismatch). No new network/auth/schema surface introduced.

---

## Surprises

- **Line-number drift from plan estimates:** helper block insertion (~85 lines) shifted every call site forward. Plan estimated processPid at ~L1119/~L1565 and sweepOneHost at ~L1959; actual post-fix positions are L1198 / L1643 / L2062. Well within the "~L" tolerance the plan implied.
- **Fixture-contract shift was more mechanical than expected.** Just 4 test-file sites (1 helper + 3 migrations) covered every affected baseline test — the substring-includes matcher in `MockSshChannel.exec` made the mock keep matching the wrapped command without needing per-site pattern updates.
- **No changes needed to sub-helpers like `wireSourceAResponses`** — that helper calls `makeStatContents(starttime)`, so updating the base helper cascaded to it and to every other call site automatically.

---

## Self-Check

**Files exist:**
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` → FOUND (helper at :151, call sites at :1198, :2062)
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → FOUND (new describe at :6847, 4 tests at :6853/:6874/:6894/:6912)

**Commits exist:**
- `0ddb876c` (Task 1) → FOUND in `git log`
- `6731606e` (Task 2) → FOUND in `git log`

**Scope-guarded files unchanged:**
- `src/backend/fleet-status/liveness-check.ts` → `git diff` empty → CONFIRMED
- `src/backend/starter.ts` → `git diff` empty → CONFIRMED

**Test gate:**
- `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → `Tests  122 passed (122)` → GREEN

## Self-Check: PASSED
