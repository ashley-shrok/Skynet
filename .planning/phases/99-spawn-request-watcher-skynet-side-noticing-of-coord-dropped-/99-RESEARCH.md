# Phase 99: spawn-request-watcher — Skynet-side noticing of coord-dropped request files

**Researched:** 2026-09-10
**Domain:** Skynet backend TypeScript — fleet-status sweep extension + in-memory queue + identity-birth caller + SFTP response-file drop
**Confidence:** HIGH (all findings confirmed from live codebase; no external package installs required)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Observation-and-claim (D-01..D-03)**
- Piggyback on the existing fleet-status per-host sweep (`src/backend/fleet-status/ssh-poll-orchestrator.ts`). No new SSH plumbing, no parallel poller subsystem.
- Single atomic read-and-delete exec per tick per host: enumerate `~/fleet/spawn-requests/`, read each file, delete it, return batched contents — all in one remote exec.
- Missing folder is not an error: if `~/fleet/spawn-requests/` doesn't exist, exec returns empty batched contents; no mkdir, no warn-log.

**Request file schema (D-04..D-05)**
- `{role, task, requested_at}` in JSON. `role` and `task` are functional inputs; `requested_at` is ISO-Z timestamp for debug. Request-id is the filename (`<uuid>.json`), NOT the body.
- NOT in schema: `coord_mxid`, any target-host field, priority, retry-count, etc.

**Backend queue + birth-worker (D-06..D-08)**
- In-memory queue on the backend. No persistent queue, no DB backing, no replay-on-restart.
- Birth-worker concurrency = 1 (serialized). One birth at a time.
- Queue holds: parsed request contents `{role, task, requested_at}`, source host id, source uuid, derived owner-userId.

**Response file schemas (D-09..D-13)**
- Success: `~/fleet/spawn-requests/<uuid>.success.json` — `{name, mxid, birthed_at}`.
- Failure: `~/fleet/spawn-requests/<uuid>.failure.json` — `{reason, message?}`.
- `message` PRESENT and descriptive when `reason == "malformed"`; ABSENT or terse for all other reasons.
- Same folder as request. Coordinator watches ONE folder.
- Response file cleanup is coordinator's job. Skynet does NOT auto-reap.

**Ownership attribution (D-14)**
- `userId` passed to birth-orchestrator = owner-userId of the host the request came from. Looked up via Drizzle from the `ssh_data` table (hosts.userId column).

**Failure semantics + safety timeout (D-15..D-16)**
- No automatic retry anywhere. On birth failure, failure file drops, coord escalates.
- Coord-side safety timeout for Skynet-crashed-mid-birth case. Planner picks concrete value (a few minutes).

**Code change surface (D-17..D-20)**
- Modifies: `src/backend/fleet-status/ssh-poll-orchestrator.ts` — adds atomic scan step per tick.
- Creates: new `src/backend/spawn-requests/` module(s) — queue + worker + response-file drop.
- Creates: shared types for request/success/failure wire schema (internal-to-backend).
- NO changes to `src/backend/database/routes/identity-birth-orchestrator.ts`.

**Test surface (D-21..D-22)**
- Unit tests: request-file body parser, queue module, birth-worker (mocked orchestrator).
- Integration test: fleet-status sweep atomic-read-and-delete with mocked SSH channel.
- End-to-end wire test: full flow from fleet-status tick through queue through worker through response file drop (mocked orchestrator + SSH channel).

**Ship coordination (D-23)**
- All changes held from ship until Alice greenlights whole id-skill-revamp campaign. NO push/deploy as part of executor's remit.

### Claude's Discretion (implementation-level, planner decides)

- Exact number of plans and wave breakdown (3-plan-in-2-waves suggested as reasonable).
- Concrete coord-side safety timeout value (D-16 range: "a few minutes").
- Exact failure `reason` enum values (D-10 — planner enumerates from orchestrator's actual failure modes).
- Atomic read-and-delete shell command (D-02 — planner picks shell-portable form).
- Whether queue module is its own file or inline in the worker file.
- Observability log lines (standing directive: log at every meaningful state transition).

### Deferred Ideas (OUT OF SCOPE)

- Response-file aging / auto-reaper on Skynet side.
- Bounded-N or unbounded birth-worker parallelism.
- Persistent queue with replay-on-restart.
- Cross-host birth.
- Rich failure diagnostics beyond the `malformed` class.
- UI surface for pending spawn-requests.
- Shared frontend/backend types for the wire schema (internal-to-backend for now).
- CI grep test that fails build on response-file schema drift.
</user_constraints>

---

## Summary

Phase 99 adds one new capability to Skynet's backend: when a coordinator drops a `<uuid>.json` request file at `~/fleet/spawn-requests/` on a managed host, Skynet notices it on the next fleet-status sweep tick, claims it atomically (read + delete in one exec), enqueues it in an in-memory pending-birth queue, and a serialized async worker drains the queue by calling the existing `birthIdentity` function from Phase 77. On completion the worker writes a success or failure response file back to the same folder on the requesting host using an SFTP write over a fresh one-shot SSH connection.

The design is an extension of three already-working subsystems: `ssh-poll-orchestrator.ts` (the sweep), `identity-birth-orchestrator.ts` (the birth machinery), and `identity-artifact-reader.ts` + `per-identity-file.ts` (the SFTP write primitives). Every locked decision confines the new code to a small, well-bounded surface.

The largest implementation risk is the atomic shell one-liner for the read-and-delete exec — it must be shell-portable across the fleet's Linux hosts (Ubuntu, Bazzite, possibly others) and must guarantee that read and delete happen atomically per file with no double-observation window.

**Primary recommendation:** Implement in two waves — Wave 1: new `src/backend/spawn-requests/` module (queue + worker + wire types, all independently testable with mocked orchestrator); Wave 2: `ssh-poll-orchestrator.ts` extension (atomic scan step + enqueue call), wiring into `OrchestratorDeps` injectable deps, and response-file drop via SFTP. Full test coverage of the wire from fleet-status through queue through worker through response-file drop, plus scoped-test green gate before proceeding.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Observe and claim request files | Fleet-status sweep (per-host SSH exec tier) | — | Already owns the per-host SSH channel and the two-second tick cadence |
| In-memory pending-birth queue | Backend process (in-memory state) | — | Lives in Node.js backend process; dies on restart, coord timeout catches the loss |
| Birth-worker serialization | Backend process (async loop) | — | Serialized against the queue; all actual birth I/O goes over a fresh one-shot SSH connection |
| Identity birth (name pick, Synapse mint, SFTP writes) | `identity-birth-orchestrator.ts` (unchanged) | — | Phase 77 machinery; this phase is a new caller only |
| Response-file write | Backend process → SFTP over fresh one-shot SSH | Fleet-status sweep's existing channel (not used for this) | SFTP via `writeMarkdownFileAtomic` or SSH exec write; NOT on the critical sweep path |
| Owner-userId derivation | Backend process → Drizzle query on `ssh_data` table | — | `hosts.userId` column is the ground truth; a direct `select` by `hosts.id` |

---

## Standard Stack

### Core (no new packages — all reuse existing backend infrastructure)

| Library / Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ssh-poll-orchestrator.ts` | existing | Extension point for per-tick exec | Already has the per-host SSH channel and exec infrastructure |
| `identity-birth-orchestrator.ts` | existing | Birth machinery (no changes) | Phase 77 — the canonical name-pick + Synapse mint + SFTP write sequence |
| `identity-artifact-reader.ts` | existing | `writeMarkdownFileAtomic` SFTP primitive | The one-and-only SFTP atomic-write helper; also used by per-identity-file.ts |
| `per-identity-file.ts` | existing | SFTP write primitive | Could be used for response-file drops if extended; currently limited to `relay.json` and `.pinned` whitelist — see Pitfall 3 |
| `ssh/ssh-one-shot.ts` | existing | One-shot SSH connections | Birth-worker opens a fresh connection per birth (same as identity-birth.ts HTTP route) |
| `ssh/tmux-helper.ts` | existing | `execCommand(conn, cmd)` | The standard exec wrapper over an SSH `Client` |
| `pool/pool-loader.ts` | existing | `getVettedPool()` — name array | Birth-worker picks a name the same way the HTTP route does |
| `matrix/matrix-admin-client.ts` | existing | Synapse admin mint primitives | Birth-worker assembles the same `BirthDeps` as the HTTP route |
| `matrix/matrix-admin-creds-store.ts` | existing | `getMatrixAdminCreds()` | Required before each birth invocation |
| `database/db/schema.ts` | existing | `hosts` table (`hosts.userId`, `hosts.id`) | Direct Drizzle query for owner-userId derivation |
| `database/db/index.ts` | existing | `getDb()` | Standard DB access pattern throughout backend |
| `vitest` | existing | Test framework | Confirmed via `vitest.config.ts`; both node and jsdom projects configured |

**No new npm packages are required for this phase.** All infrastructure reuses existing imports.

---

## Package Legitimacy Audit

> No new packages are installed in this phase — all implementation reuses existing backend imports. This section is intentionally empty.

| Package | Registry | Status |
|---------|----------|--------|
| (none) | — | No new installs |

---

## Architecture Patterns

### System Architecture Diagram

```
Coordinator (on managed host)
  └─ writes ~/fleet/spawn-requests/<uuid>.json  ─────────────────────────┐
                                                                          │
Fleet-status sweep (every 2s per host)                                    │
  pollOneHost()                                                           │
    ├─ [existing] ls sessions, cat sessions, stat procs, dormant scan      │
    └─ [NEW] atomic read-and-delete exec                                   │
         find ~/fleet/spawn-requests/ → read each .json → delete → stdout ┘
                    │
                    ▼ parsed [{uuid, role, task, requested_at}] per host
         spawnRequestQueue.enqueue({hostId, uuid, role, task, requested_at, userId})
                    │
                    ▼ (async, decoupled from sweep tick)
         serializedBirthWorker (while queue not empty)
                    │
          ┌─────────┴─────────────────────────────┐
          │ validate request schema                │
          │ if malformed → writeFailureFile(malformed, message)
          │                                        │
          │ getMatrixAdminCreds()                  │
          │ if missing → writeFailureFile(birth_failed)
          │                                        │
          │ pool.getVettedPool() → pick name       │
          │                                        │
          │ connectOneShot(hostConnDetails)         │
          │ birthIdentity(opts, emit, deps)         │
          │   → BirthEvent{type:"ended", ok:true}  │
          │     writeSuccessFile(name, mxid, birthed_at)
          │   → BirthEvent{type:"ended", ok:false} │
          │     writeFailureFile(birth_failed, ...)
          └─────────────────────────────────────────┘
                    │
                    ▼ SFTP via connectOneShot → writeMarkdownFileAtomic
         ~/fleet/spawn-requests/<uuid>.success.json  OR
         ~/fleet/spawn-requests/<uuid>.failure.json
                    │
                    ▼ (coordinator watches same folder, reads response, deletes it)
```

### Recommended Project Structure

```
src/backend/spawn-requests/
├── types.ts          # Wire types: SpawnRequest, SuccessResponse, FailureResponse, FailureReason
├── queue.ts          # In-memory queue + enqueue/dequeue/isEmpty operations
└── worker.ts         # Serialized birth-worker: pulls from queue, calls birthIdentity, drops response files
```

The sweep extension lives in `src/backend/fleet-status/ssh-poll-orchestrator.ts` — no new file for that piece.

Test files colocated with source following the codebase pattern (`*.test.ts` next to the module):
```
src/backend/spawn-requests/
├── queue.test.ts
└── worker.test.ts
src/backend/fleet-status/
└── ssh-poll-orchestrator.test.ts  (extended — existing file)
```

### Established Patterns This Phase Follows

**Pattern 1: `pollOneHost` extension for one extra exec per tick**

`pollOneHost` (`ssh-poll-orchestrator.ts:861`) is the natural injection point. It runs sequentially for each host after the PID enumeration loop and the `pollDormantOnlyIdentities` call. The spawn-request scan goes here — after the existing work, before the poll-end log.

Concrete structure (pseudocode):
```typescript
// Inside pollOneHost(), after pollDormantOnlyIdentities():
const spawnBatch = await scanSpawnRequests(hostState.channel, host);
for (const item of spawnBatch) {
  spawnRequestQueue.enqueue(item);  // fire-and-forget enqueue
}
```

`scanSpawnRequests` issues one `channel.exec(atomicCmd)` call and returns `ClaimedSpawnRequest[]`. On `null` return (SSH error), logs warn and returns `[]` (same fail-open pattern as the existing `ls -1` listing at line 871).

**Pattern 2: Atomic read-and-delete shell one-liner (D-02 — CRITICAL)**

The shell command must list `~/fleet/spawn-requests/*.json` (request files only — NOT `.success.json` or `.failure.json`), read each file's contents, delete the file, and return a parseable batch — in one exec with no window between read and delete.

Recommended shell shape (Linux-portable, no bash-specific syntax):
```bash
cd ~/fleet/spawn-requests 2>/dev/null || exit 0; \
for f in *.json; do \
  [ -f "$f" ] || continue; \
  printf '%s\t' "$f"; cat "$f"; printf '\n'; rm -f "$f"; \
done
```

However, there is a subtle correctness issue: if `cat` succeeds but `rm` fails, the file survives and the next tick sees it again — potentially double-processing. A safer one-liner using `mv` for atomic claim followed by read-and-delete:
```bash
cd ~/fleet/spawn-requests 2>/dev/null || exit 0; \
for f in *.json; do \
  [ -f "$f" ] || continue; \
  tmp="$f.$$"; \
  mv "$f" "$tmp" 2>/dev/null || continue; \
  printf '%s\t' "$f"; cat "$tmp"; printf '\n'; rm -f "$tmp"; \
done
```

The `mv "$f" "$tmp"` is the atomic claim step — if two ticks ran simultaneously (in-flight guard prevents this, but belt-and-suspenders), only one `mv` wins. The `|| continue` skips if the file was already claimed. This is the correct portable POSIX atomic-claim pattern.

**stdout format:** Each claimed file produces one tab-separated line: `<uuid>.json<TAB><json-body><NEWLINE>`. The parser splits on `\t`, extracts uuid from filename (strip `.json`), JSON-parses the body. Empty stdout = no pending requests (not an error). Null return from `channel.exec` = SSH error, treat as empty (fail-open, same pattern as the existing `ls` call at orchestrator line 871).

**Pattern 3: Serialized async worker**

Standard Node.js Promise-chain serialization — no external library needed:
```typescript
// In queue module or worker module
let workerPromise: Promise<void> = Promise.resolve();

function drainOne(): Promise<void> {
  return workerPromise.then(async () => {
    while (!queue.isEmpty()) {
      const item = queue.dequeue();
      if (item) await processBirth(item);  // throws never — internal catch
    }
  });
}

export function enqueue(item: PendingBirth): void {
  queue.push(item);
  workerPromise = drainOne();
}
```

This matches the existing pattern in `src/backend/ssh/server-stats-state.ts:30-59` (a per-hostId serialization queue using `while (queue.length > 0)` + a `processing` flag). The spawn-request worker is simpler — it's global-not-per-host, and uses Promise chaining instead of a flag.

**Pattern 4: Owner-userId derivation from hostId**

The `hosts` table (`schema.ts:103`) has `userId: text("user_id").notNull()`. The spawn-request worker needs:
```typescript
// Direct Drizzle query — no full resolveHostById needed (that function requires
// a userId to scope the decryption, which we don't have yet; we only need the
// plaintext userId column which is NOT encrypted).
const db = getDb();
const rows = await db
  .select({ userId: hosts.userId })
  .from(hosts)
  .where(eq(hosts.id, hostId))
  .limit(1);
const userId = rows[0]?.userId ?? null;
```

**IMPORTANT:** `resolveHostById(hostId, userId)` CANNOT be used here because it requires a pre-known userId for decryption scoping. The `users.userId` column on the `hosts` table is NOT encrypted (it is a foreign key reference to `users.id`). A direct `db.select({ userId: hosts.userId })` query reads the plaintext userId without decryption — this is the correct pattern. Confirmed: `guacamole/routes.ts:189-201` does the same `getDb().select().from(hosts).where(eq(hosts.id, hostId))` and then reads `host.userId` directly.

**Pattern 5: `birthIdentity` calling convention (the real export name)**

CONTEXT.md guesses `runIdentityBirthOrchestrator` — this is incorrect. The actual export is `birthIdentity` (`identity-birth-orchestrator.ts:904`). Signature:
```typescript
export async function birthIdentity(
  opts: BirthOptions,
  emit: (e: BirthEvent) => void,
  deps: BirthDeps,
): Promise<void>
```

The function never throws in normal operation — all failures are communicated via `emit({type:"ended", ok:false, failedStep:N})`. It can throw only on truly unexpected internal errors (the outer catch at line 1285 catches these and emits `ended{ok:false}`). The worker's `emit` callback captures the final `ended` event to know success/failure.

**Pattern 6: Assembling `BirthDeps` for the birth-worker**

The HTTP route handler `identity-birth.ts` shows the complete deps assembly. The birth-worker assembles an identical deps object minus the UI-specific pieces. Key difference: the worker must pick a name from the pool (since there is no frontend name input) and set `poolPicked: true`.

Worker BirthOptions shape:
```typescript
{
  userId,          // derived from host record (D-14)
  hostId,          // numeric (parseInt(hostId, 10) if hostId is a string from HostRecord)
  name,            // pool-picked lowercase name (e.g. "willow")
  title: "",       // absent-⇒-omit via orchestrator (role inherits)
  path: `~/${name}/`,  // per-agent default working dir (matches identity-birth.ts L246-249 fallback)
  colorHue: null,  // role-inherited
  voice: null,     // role-inherited
  avatarCandidateId: "",  // role-inherited avatar (Phase 86 absent-⇒-omit)
  role,            // from request file (validated as ROLE_NAME_PATTERN before passing)
  task,            // from request file (optional, may be null)
  poolPicked: true,  // name is pool-picked → Step 6 derives PascalCase-hyphenated MXID
}
```

Name pool-picking logic: `getVettedPool()` returns `string[]` of PascalCase names. The birth-worker does NOT need to call the pool HTTP route — it calls `getVettedPool()` directly and picks a name (random from the pool). For the first implementation, a simple random pick is sufficient; the `deriveMxidWithOrdinal` step inside Step 6 handles collision via `-N` suffixes.

**Pattern 7: Response-file write via SFTP**

The response file at `~/fleet/spawn-requests/<uuid>.success.json` (or `.failure.json`) is a small JSON file written over SSH. Two options:

Option A: SSH exec `echo '<json>' > ~/fleet/spawn-requests/<uuid>.success.json` — simple, no SFTP setup. Works if the JSON is small (< ~2KB, safe for echo). Risk: shell quoting of JSON content is error-prone.

Option B: `writeMarkdownFileAtomic(conn, path, contents)` from `identity-artifact-reader.ts:1924` — the existing SFTP atomic-write primitive. Uses `sftp.writeFile(tmp) + sftp.ext_openssh_rename(tmp, target)`. Contents are passed as a string, no shell quoting. This is the correct approach for any content with special characters.

**Recommendation: Use Option B (writeMarkdownFileAtomic).** The response file path is `$HOME/fleet/spawn-requests/<uuid>.success.json` (or `.failure.json`) — the `$HOME` prefix must be a literal string (SFTP resolves it; same convention as per-identity-file.ts line 121). The `conn` comes from a fresh `connectOneShot` call per birth (same connection already open for the birth steps, OR a second one-shot just for the response file write). Simplest: reuse the same `conn` that `birthIdentity` used internally — but `birthIdentity` manages its own connection internally and closes it. The worker must open its own connection for the response write.

**Pattern 8: Test structure for the sweep extension**

From `ssh-poll-orchestrator.test.ts`, the `MockSshChannel` class uses a pattern-matching map (`setResponse(pattern, response)` where pattern is matched via `command.includes(pattern)`). New tests for the spawn-request scan should:
1. Register a mock response for `"spawn-requests"` or `"find ~/fleet/spawn-requests"` in the channel.
2. Assert that the enqueue callback received the correct parsed item.
3. Test the null-return (SSH error) path returns empty batch.
4. Test the missing-folder case (empty stdout from `|| exit 0`).

The test suite uses `vi.mock` for logger, `vi.fn()` for injected deps, and `vi.useFakeTimers()` is NOT needed for this extension (the spawn-request exec runs inside `pollOneHost` which is already driven by the test's `await orchestrator.start()`).

### Anti-Patterns to Avoid (from CONTEXT.md)

- **Do NOT split the read and delete into two exec calls.** Atomicity is load-bearing.
- **Do NOT create the spawn-requests folder from Skynet's side.** Missing folder = empty result, not error.
- **Do NOT retry failed births inside the worker.** Failure file drops, coord escalates.
- **Do NOT persist the queue to DB.** In-memory only.
- **Do NOT call `runIdentityBirthOrchestrator`** — that export does not exist. The export is `birthIdentity`.
- **Do NOT use `per-identity-file.ts`'s `writeIdentityFile`** for the response files — its whitelist (`ALLOWED_REL_PATHS`) only allows `relay.json` and `.pinned`, not `*.success.json`/`*.failure.json`. Use `writeMarkdownFileAtomic` directly.
- **Do NOT use message streaming anywhere.** Response files are atomic writes.
- **Do NOT include a ship/push/deploy task.** Executor's remit stops at tests green.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SFTP atomic file write | custom sftp.writeFile | `writeMarkdownFileAtomic` from `identity-artifact-reader.ts:1924` | Already implements ext_openssh_rename discipline (Pitfall 3 / #2924 — regular sftp.rename is NOT atomic on OpenSSH) |
| Promise serialization | a mutex class | Promise chain (`workerPromise = workerPromise.then(...)`) | Simple, built-in, matches the in-flight guard pattern already used in the sweep |
| SSH exec over the per-host channel | a new SSH client | `channel.exec(cmd)` — the injected `SshChannel` interface | Already wired; adding one more exec call is trivial |
| Name pool selection | random number generation | `getVettedPool()` from `pool/pool-loader.ts` | Already memoized, already shape-validated |
| MXID ordinal collision handling | counting Synapse users | `deriveMxidWithOrdinal` inside `birthIdentity` Step 6 | The orchestrator already does this when `poolPicked: true` |
| Matrix admin mint + access_token | direct Synapse HTTP calls | `birthIdentity` (calls `matrixCreateOrUpdateUser` + `matrixLoginAsUser` internally) | Phase 77 orchestrator handles all Steps 6-8 |

---

## Failure `reason` Enum (D-10 — planner's discretion)

From reading `identity-birth-orchestrator.ts` (`birthIdentity`) and its actual failure modes:

| Enum value | Trigger | message? |
|------------|---------|---------|
| `"malformed"` | Worker's own parse/validation: invalid JSON body, missing required fields (`role`, `task`), `role` fails `ROLE_NAME_PATTERN`, `task` > 500 chars | YES — descriptive (coord can fix the request) |
| `"role_unknown"` | `role` passes `ROLE_NAME_PATTERN` but the role folder doesn't exist on the target host (Step 1 collision probe or Step 2.5 check fails with role-not-found-on-host) | NO (terse) |
| `"birth_failed"` | Generic orchestrator failure: Step 1 (collision probe), Step 2 (mkdir/tmux), Step 3 (harness start), Step 4/5 (synthetic events — never fail) | NO (terse) |
| `"homeserver_unreachable"` | Step 1 SSH connect failure (error message matches `/timeout|unreachable/i` in `sanitizeError`) OR Step 6 Synapse mint returns connection error | NO (terse) |
| `"pool_exhausted"` | `getVettedPool()` returns `[]` (missing pool.json or empty pool) — worker cannot pick a name | NO (terse) |
| `"matrix_creds_missing"` | `getMatrixAdminCreds()` returns null | NO (terse) |

The worker maps `BirthEvent{type:"ended", ok:false, failedStep:N}` to these enums:
- Step 1 with SSH-connect error → `homeserver_unreachable`
- Step 1 with "identity already exists" error → `birth_failed` (identity name collision — rare, pool handles this)
- Step 6 with admin_mint_failed / admin_login_failed → `birth_failed` (or `homeserver_unreachable` if the message matches)
- Any other failedStep → `birth_failed`
- Worker pre-flight errors (pool empty, creds missing) → their own reason values

**Recommended final enum:** `"malformed" | "role_unknown" | "birth_failed" | "homeserver_unreachable" | "pool_exhausted" | "matrix_creds_missing"`

---

## Coord-Side Safety Timeout Concrete Value (D-16)

Normal birth latency from the Phase 77 test suite (Steps 1-8): approximately 22-35 seconds on a healthy network (ENTER_TRAIN_COUNT × ENTER_TRAIN_SPACING_MS = 7 × 3000ms = 21s for the Enter train alone, plus Step 2's 3s sleep + Step 3's 2s sleep). Call it 30-40 seconds in the happy case.

A coord-side timeout of **3 minutes (180 seconds)** is the recommendation:
- Allows a slow birth (60-90s under load) to complete normally.
- Is short enough that a Skynet crash during birth surfaces within 3 minutes rather than coord watching indefinitely.
- Is well inside "a few minutes" as specified in D-16.

---

## Runtime State Inventory

> Phase 99 creates NO persistent state — in-memory queue only. This section is a brief confirmation.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — queue is in-memory; identity DB has no spawn-request table; identities table was deleted in Phase 69 | None |
| Live service config | None — no external service tracks spawn-request state | None |
| OS-registered state | None — no OS-level registration | None |
| Secrets/env vars | None — no new secrets; reuses existing Matrix admin creds | None |
| Build artifacts | None — new TypeScript source files only | None |

---

## Common Pitfalls

### Pitfall 1: `per-identity-file.ts` ALLOWED_REL_PATHS whitelist blocks response-file writes
**What goes wrong:** Trying to use `writeIdentityFile(name, "foo.success.json", ...)` throws "invalid relPath" before any I/O — the whitelist only allows `"relay.json"` and `".pinned"`.
**Why it happens:** `per-identity-file.ts:80-83` has a hard whitelist `ALLOWED_REL_PATHS = new Set(["relay.json", ".pinned"])`.
**How to avoid:** Use `writeMarkdownFileAtomic(conn, path, contents)` from `identity-artifact-reader.ts` directly for response-file writes. The path is constructed as `$HOME/fleet/spawn-requests/<uuid>.success.json` (literal `$HOME` — SFTP resolves it, same convention as `per-identity-file.ts:121`).

### Pitfall 2: `hostId` type mismatch — HostRecord.id is a string, BirthOptions.hostId is a number
**What goes wrong:** `birthIdentity` requires `hostId: number`; the sweep's `PerHostState.host.id` is `string` (set as `String(row.id)` in `starter.ts:514`). Passing the string directly causes a type error; `parseInt(hostId, 10)` is the correct conversion.
**Why it happens:** `HostRecord.id` is `string` by interface definition (`host-id-resolver.ts:14-17`); the DB integer is stringified in `listIdentityHostingHosts`.
**How to avoid:** In the enqueued `PendingBirth` object, store `hostIdNum: parseInt(hostId, 10)` (number) alongside the string `hostId`. Pass `hostIdNum` to `BirthOptions.hostId`.

### Pitfall 3: Using `resolveHostById` for the owner-userId lookup fails without a prior userId
**What goes wrong:** `resolveHostById(hostId, userId)` is the standard host resolver but it requires the caller to already know `userId` for decryption scoping. The spawn-request worker has no JWT — it is not handling an HTTP request.
**Why it happens:** `SimpleDBOps.select` (inside `resolveHostById`) uses the `userId` to scope decryption of encrypted fields. Without a userId, the call throws or returns wrong data.
**How to avoid:** Use a direct `getDb().select({ userId: hosts.userId }).from(hosts).where(eq(hosts.id, hostId))` query. The `userId` column on the `hosts` table is a plaintext foreign key — NOT encrypted. This gives the owner-userId without needing the full `resolveHostById` decrypt path. (See `guacamole/routes.ts:189-201` for the pattern.) Then use this `userId` + the stored `_connDetails` from the `PerHostState` host record to build the birth connection.

### Pitfall 4: `birthIdentity` is not exported as `runIdentityBirthOrchestrator`
**What goes wrong:** CONTEXT.md guesses the export name as `runIdentityBirthOrchestrator`. That export does not exist. Importing it throws at runtime (undefined function call).
**Why it happens:** The orchestrator exports `birthIdentity` (line 904) — the CONTEXT.md guess was not verified against the file.
**How to avoid:** Import `birthIdentity` (not `runIdentityBirthOrchestrator`) from `identity-birth-orchestrator.ts`. Already confirmed.

### Pitfall 5: `OrchestratorDeps` cannot be extended without test churn — inject enqueue via a dep
**What goes wrong:** Adding a new required field to `OrchestratorDeps` forces changes to every existing test that builds deps via `buildDeps()`. The existing test file has 7207 lines.
**Why it happens:** `OrchestratorDeps` is the public interface consumed by both production code (`starter.ts`) and tests.
**How to avoid:** Add `enqueueSpawnRequest?: (item: PendingBirth) => void` as an OPTIONAL field on `OrchestratorDeps` (or pass it as a separate argument to an extracted helper). When the dep is absent, the spawn-request scan still runs but discards results (no-op for existing tests). Alternatively, create a standalone `scanAndEnqueueSpawnRequests(channel, host, enqueue)` helper that the orchestrator calls — the queue module is injected from `starter.ts`, tests override or stub it.

### Pitfall 6: `ext_openssh_rename` required for SFTP atomic write (not `sftp.rename`)
**What goes wrong:** Using `sftp.rename(tmpPath, targetPath)` fails on OpenSSH hosts because sftp.rename is NOT atomic on POSIX filesystems (it's equivalent to POSIX rename only on NFS, not on local Linux fs with sftp).
**Why it happens:** This pitfall is documented in `identity-artifact-reader.ts:1899-1920` (the quick 260802-qrw root-cause section). The existing codebase uses `sftp.ext_openssh_rename` throughout.
**How to avoid:** Always use `writeMarkdownFileAtomic` (which calls `sftp.ext_openssh_rename` internally). Never call `sftp.rename` directly.

### Pitfall 7: Double-observation if the atomicity shell command is incorrect
**What goes wrong:** If the read-and-delete exec is split into two execs (list, then delete), a second tick that fires between the two calls observes the same request file and enqueues it twice — spawning the same identity twice.
**Why it happens:** D-02 is load-bearing: the atomicity claim happens in ONE exec.
**How to avoid:** The shell command must `mv` (claim) the file before reading it, or use the `printf + rm -f` pattern in a single exec. Test with the `MockSshChannel` that returns a response containing a request file, and assert that a second poll tick (same channel, same response) does NOT produce a second enqueue (because the file was already claimed on the first tick — the real shell would return empty stdout on the second tick).

### Pitfall 8: Response file path uses wrong folder — needs `spawn-requests/` not `identities/`
**What goes wrong:** Code copies the `writeIdentityFile` pattern which writes to `$HOME/fleet/identities/<name>/relay.json`. The response file goes to `$HOME/fleet/spawn-requests/<uuid>.success.json` — a different folder.
**Why it happens:** Copy-paste of the Step 8 relay.json write pattern without updating the path.
**How to avoid:** Build the response path explicitly: `$HOME/fleet/spawn-requests/${uuid}.success.json`. Do NOT use `per-identity-file.ts`'s path helpers (they construct `$HOME/fleet/identities/` paths).

---

## Integration Points

### 1. Fleet-status `ssh-poll-orchestrator.ts` — one additional exec per tick

**Extension point:** End of `pollOneHost()` (line 925, after `pollDormantOnlyIdentities` call, before the poll-end log). This is the single place to add the spawn-request scan.

**Dependency injection:** The spawn-request queue's `enqueue` function needs to reach `pollOneHost`. Options:
- Add `enqueueSpawnRequest?: (item: PendingBirth) => void` to `OrchestratorDeps` (optional so existing tests compile with zero changes).
- Or extract a module-level `setSpawnRequestQueue(queue)` setter called from `starter.ts` after both are initialized.

**Recommended:** Add to `OrchestratorDeps` as optional. `starter.ts` provides the real enqueue function; tests leave it undefined (scan runs, results are silently discarded).

### 2. `birthIdentity` — new caller (no changes to the function itself)

The birth-worker calls `birthIdentity(opts, emit, deps)` where:
- `opts` includes `userId` (from host record), `hostId` (numeric), pool-picked `name`, `role` and `task` from the request file, `poolPicked: true`, and the cosmetic-field defaults (all absent-⇒-omit).
- `emit` collects `BirthEvent` objects; the worker only needs the final `{type:"ended"}` event.
- `deps` is assembled the same way as `identity-birth.ts`'s `deps` object: `connectOneShot`, `execCommand`, `isLocalHostId`, `resolveHostById` (for SSH credential resolution inside the orchestrator), `getMatrixAdminCreds`-sourced fields, etc.

**Key difference from HTTP route:** No SSE stream. The `emit` callback just captures the `ended` event in a local variable. The birth connection cleanup (SSH `conn.end()`) happens inside `birthIdentity`'s own `finally` block.

**BirthDeps wiring for the worker:** Identical to `identity-birth.ts:325-363`. The worker module either imports those same wired functions or receives them as injectable deps (recommended for testability).

### 3. Host-record `userId` derivation — direct Drizzle query

```typescript
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";

async function getHostOwnerUserId(hostId: number): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  return rows[0]?.userId ?? null;
}
```

This runs once per queued birth request (not per tick). If the host was deleted between the sweep tick and birth-worker drain, `getHostOwnerUserId` returns `null` — worker drops a `birth_failed` failure file and moves on.

### 4. Host SSH credentials for the birth-worker's `connectOneShot`

`birthIdentity` internally calls `deps.resolveHostById(opts.hostId, opts.userId)` at Step 2's SSH connect. The worker's `deps.resolveHostById` is the same function wired in `identity-birth.ts:331-332`. This call uses the owner-userId for decryption scoping — which the worker now has from the host-record query above. The full SSH credential decryption happens inside the orchestrator, not the worker.

---

## Validation Architecture

**Vitest config:** `vitest.config.ts` — backend test project, node environment, include `src/backend/**/*.test.ts`. Global timeout: 30,000ms.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (confirmed via `vitest.config.ts`) |
| Config file | `vitest.config.ts` at project root |
| Quick run command | `npx vitest run --project backend src/backend/spawn-requests/` |
| Sweep extension tests | `npx vitest run --project backend src/backend/fleet-status/ssh-poll-orchestrator.test.ts` |
| Full backend suite | `npx vitest run --project backend` |

### Phase Requirements to Test Map

| Req | Behavior | Test Type | Automated Command | File |
|-----|----------|-----------|-------------------|------|
| D-02 | Atomic read-and-delete returns parsed batch | unit | `npx vitest run --project backend src/backend/spawn-requests/queue.test.ts` | Wave 0 gap |
| D-02 | SSH null return → empty batch (fail-open) | unit | same | Wave 0 gap |
| D-03 | Missing folder → empty batch (not error) | unit | same | Wave 0 gap |
| D-04 | Request schema parse: valid JSON → SpawnRequest | unit | `npx vitest run --project backend src/backend/spawn-requests/worker.test.ts` | Wave 0 gap |
| D-04 | Request schema parse: malformed JSON → malformed failure | unit | same | Wave 0 gap |
| D-04 | Request schema parse: missing `role` → malformed failure | unit | same | Wave 0 gap |
| D-06 | Queue enqueue/dequeue/isEmpty | unit | `npx vitest run --project backend src/backend/spawn-requests/queue.test.ts` | Wave 0 gap |
| D-07 | Worker processes requests serially (second not started until first completes) | unit | same | Wave 0 gap |
| D-09 | Success response file shape: `{name, mxid, birthed_at}` | unit | worker.test.ts | Wave 0 gap |
| D-10 | Failure response file shape: `{reason, message?}` | unit | worker.test.ts | Wave 0 gap |
| D-10 | malformed class gets descriptive message; others get terse/no message | unit | worker.test.ts | Wave 0 gap |
| D-17 | Sweep tick issues atomic-scan exec AND existing session execs | integration | `npx vitest run --project backend src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | Extend existing |
| D-22 | E2E wire: tick → enqueue → birth (mocked) → success response file | integration | worker.test.ts (with mocked channel) | Wave 0 gap |

### Sampling Rate
- Per task commit: `npx vitest run --project backend src/backend/spawn-requests/`
- Per wave merge: `npx vitest run --project backend src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/spawn-requests/`
- Phase gate: full backend suite green before `/gsd-verify-work`

### Wave 0 Gaps (all new — no existing tests for this phase)
- [ ] `src/backend/spawn-requests/queue.test.ts` — covers D-02, D-03, D-06
- [ ] `src/backend/spawn-requests/worker.test.ts` — covers D-04, D-07, D-09, D-10, D-22
- [ ] Extend `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — covers D-17

---

## Environment Availability

> No external tools or services beyond the existing Skynet backend stack are required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | TypeScript execution | ✓ | (existing — not probed) | — |
| vitest | Test runner | ✓ | (existing in devDependencies) | — |
| ssh2 (npm) | SSH/SFTP primitives | ✓ | (existing in dependencies) | — |
| Drizzle ORM | DB queries | ✓ | (existing in dependencies) | — |
| OpenSSH on managed hosts | `ext_openssh_rename` SFTP extension | ✓ | Ubuntu fleet (confirmed existing phase patterns work) | — |

---

## Security Domain

> security_enforcement: not set in config → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — no new auth surface; sweep uses existing SSH channel |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Owner-userId derivation (D-14) ensures births happen under the correct user's credential scope. Single-user boxes: trivially correct. Multi-user boxes: Stacy's coord births under Stacy's userId — natural isolation boundary. |
| V5 Input Validation | yes | Request file body: validate role against `ROLE_NAME_PATTERN` (from orchestrator), task against 500-char cap (from HTTP route), uuid against UUID pattern before using in file paths; JSON.parse in try/catch |
| V6 Cryptography | no | relay.json written by the birth orchestrator with existing 0o600 chmod |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious uuid in filename → path traversal in response file path | Tampering | Validate uuid against `/^[0-9a-f-]{36}$/` (UUID v4 shape) before constructing response file path. `writeMarkdownFileAtomic` uses SFTP path directly — SFTP does not execute shell, but a `../` in uuid could still traverse folders. Validate at parse time. |
| Malicious JSON body in request file → shell injection | Tampering | `birthIdentity` already validates `role` via `ROLE_NAME_PATTERN` and `TMUX_SAFE_NAME_RE` internally. Worker validates `role` before calling orchestrator. `task` is passed as YAML value — `yaml.dump` handles escaping. |
| Large request file → memory exhaustion | DoS | Size-cap the exec stdout before parsing: if stdout > 512KB for a single host's tick, log and discard (same principle as the 262144-byte tail cap in the JSONL scanner). |
| Stale/orphaned success files confuse next tick's observation | Tampering | D-03: the exec only reads `*.json` (not `*.success.json` or `*.failure.json`). The shell pattern `*.json` naturally matches request files only if response files use `.success.json` / `.failure.json` suffixes — which they do (D-09, D-10). This isolation is by naming convention, not by separate folder. Verified: the glob `*.json` would also match `<uuid>.success.json` and `<uuid>.failure.json` if they happened to end in `.json`. **Important:** the shell command must use the pattern `[a-f0-9-]*.json` or `*-*.json` to distinguish request UUIDs from response filenames, OR the response file suffix must not end in plain `.json`. The simplest fix: response files end in `.success.json` and `.failure.json` — a glob for `*.json` would match `foo.success.json` because it ends in `.json`. This means the sweep could accidentally claim its own response files if the coordinator hasn't cleaned them up. **The correct guard:** filter files in the shell loop by checking that the filename matches the UUID pattern (32 hex chars + 4 hyphens = 36 chars) and does NOT contain a dot in the UUID portion. The recommended shell one-liner already uses `for f in *.json` — add a length/pattern check: only claim files whose basename (minus `.json`) matches a UUID regex. |

**Critical security note on response file naming vs glob:** The request files are `<uuid>.json` (exactly 36 chars + `.json` = 41 total). Response files are `<uuid>.success.json` and `<uuid>.failure.json` (longer). A glob `*.json` matches ALL of them. The atomic read-and-delete exec MUST filter to only UUID-shaped filenames (36-char hex-and-dash string before `.json`). Recommended: use `f="${f%.json}"` (strip the suffix) and then check `[ ${#f} -eq 36 ]` before claiming.

---

## Sources

### Primary (HIGH confidence — verified directly from codebase)

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — full file read; `pollOneHost` at line 861, `SshChannel` interface at line 71, `OrchestratorDeps` at line 75, `PerHostState` at line 377, `pollAllHosts` at line 1975, `createSshPollOrchestrator` factory at line 811.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — full file read; `birthIdentity` export at line 904, `BirthOptions` interface at line 131, `BirthDeps` interface at line 173, `BirthEvent` type at line 127, `BirthAborted` sentinel at line 303.
- `src/backend/database/routes/identity-birth.ts` — full file read; `BirthDeps` assembly pattern at lines 325-363, `userId` from JWT at line 84, `parsedPath` fallback at lines 245-249, `parsedPoolPicked` at line 273.
- `src/backend/claude-session/per-identity-file.ts` — full file read; `ALLOWED_REL_PATHS` whitelist at line 80, `writeIdentityFile` at line 179, remote path shape at line 121.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — partial read; `MockSshChannel` at line 84, `buildDeps` at line 217, test patterns.
- `src/backend/fleet-status/host-id-resolver.ts` — full file read; `HostRecord` interface at line 14 (only `id: string`, `name: string`).
- `src/backend/database/db/schema.ts` — line 103-147; `hosts.userId` column confirmed as `text("user_id").notNull()`.
- `src/backend/pool/pool-loader.ts` — full file read; `getVettedPool()` at line 81.
- `src/backend/ssh/server-stats-state.ts` — lines 30-59; queue/serialization pattern confirmed.
- `src/backend/ssh/host-resolver.ts` — lines 16-30 and 145; `hosts.userId` read pattern confirmed.
- `vitest.config.ts` — full file read; backend project, 30s timeout, `src/backend/**/*.test.ts` pattern.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The fleet's managed Linux hosts all support POSIX `mv` for atomic file claiming in the shell one-liner | Pitfall 7 / Pattern 2 | If some host uses a non-POSIX shell or busybox `mv` with different semantics, the atomic claim fails; likelihood very low (box-map.md confirms Ubuntu + Bazzite — both POSIX) | [ASSUMED] |
| A2 | `ext_openssh_rename` (SFTP atomic rename extension) is available on all managed hosts | Pitfall 6 / Pattern 7 | Existing Phase 77 relay.json writes already use this extension and work — so it is available. But if a future host lacks it, `writeMarkdownFileAtomic` throws. [ASSUMED] since I haven't checked the actual SSH server versions, but prior phases confirm the pattern works. |
| A3 | `getVettedPool()` will return a non-empty pool at runtime | Pattern 6 / Failure enum | If pool.json is absent at runtime, pool is empty — worker must handle this gracefully (drop a `pool_exhausted` failure file). [ASSUMED] — the pool file's presence depends on the Docker build including it. |
| A4 | 3 minutes (180 seconds) is the correct coord-side safety timeout | D-16 section | If births routinely take longer than 180 seconds under load, coord escalates false-positives. Measured happy-path is ~30-40s; 3 minutes gives 4x headroom. [ASSUMED] — planner should confirm against observed birth latency in production. |

---

## Metadata

**Confidence breakdown:**
- Standard stack (reused modules): HIGH — all confirmed by reading live files
- Architecture patterns: HIGH — all confirmed by reading live files; exact line references provided
- Pitfalls: HIGH — all traced to specific code patterns or existing comments in source
- Failure enum: MEDIUM — derived from reading orchestrator source; concrete error message strings confirmed, but a future orchestrator change could add new step failure classes

**Research date:** 2026-09-10
**Valid until:** 2026-11-01 (stable codebase; this phase modifies the files researched, so the research reflects HEAD at research time)
