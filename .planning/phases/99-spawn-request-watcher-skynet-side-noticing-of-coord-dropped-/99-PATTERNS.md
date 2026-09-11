# Phase 99: spawn-request-watcher — Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 7 (3 new, 1 modified, 3 test files)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/spawn-requests/types.ts` | types/config | transform | `src/backend/fleet-status/wire-protocol.ts` (wire types pattern) | role-match |
| `src/backend/spawn-requests/queue.ts` | service | event-driven | `src/backend/ssh/server-stats-state.ts` (RequestQueue class) | exact |
| `src/backend/spawn-requests/worker.ts` | service | request-response | `src/backend/database/routes/identity-birth.ts` (BirthDeps assembly + birthIdentity call) | role-match |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` (modify) | service | event-driven | self (extend `pollOneHost` at line 917) | self-extension |
| `src/backend/spawn-requests/queue.test.ts` | test | — | `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | role-match |
| `src/backend/spawn-requests/worker.test.ts` | test | — | `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | role-match |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (modify) | test | — | self (extend with spawn-request-scan cases) | self-extension |

---

## Pattern Assignments

### `src/backend/spawn-requests/types.ts` (types, transform)

**Analog:** `src/backend/database/routes/identity-birth-orchestrator.ts` (BirthOptions / BirthEvent type block, lines 127–170)

**Imports pattern** (line 1–2): no imports — types-only file, no runtime dependencies.

**Core type pattern** (orchestrator lines 127–170):
```typescript
// Discriminated union + plain interface pattern used throughout the codebase.
// Use 'export type' for union aliases, 'export interface' for object shapes.
export type BirthEvent =
  | { type: "step"; n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: "started" | "completed" | "failed"; reason?: string }
  | { type: "ended"; ok: boolean; failedStep?: number; identityId?: string; sessionName?: string };

export interface BirthOptions {
  userId: string;
  hostId: number;
  name: string;
  // ... further fields
  task?: string;
  poolPicked?: boolean;
}
```

**Types to define for this phase:**
```typescript
// Wire types — internal to backend, not exported to frontend (D-19)
export interface SpawnRequestBody {
  role: string;
  task: string | null;
  requested_at: string; // ISO-Z
}

export interface PendingBirth {
  hostId: string;         // HostRecord.id (string from PerHostState)
  hostIdNum: number;      // parseInt(hostId, 10) for BirthOptions.hostId (Pitfall 2)
  uuid: string;           // from filename (strip .json)
  role: string;
  task: string | null;
  requested_at: string;
  userId: string;         // owner-userId from host record (D-14)
}

export interface SuccessResponse {
  name: string;
  mxid: string;
  birthed_at: string; // ISO-Z
}

export type FailureReason =
  | "malformed"
  | "role_unknown"
  | "birth_failed"
  | "homeserver_unreachable"
  | "pool_exhausted"
  | "matrix_creds_missing";

export interface FailureResponse {
  reason: FailureReason;
  message?: string; // PRESENT + descriptive only when reason === "malformed"
}
```

---

### `src/backend/spawn-requests/queue.ts` (service, event-driven, in-memory queue)

**Analog:** `src/backend/ssh/server-stats-state.ts` lines 1–60 (RequestQueue class — per-hostId serialized queue using a processing flag + while loop)

**Imports pattern** (server-stats-state.ts lines 1–5):
```typescript
// No external imports needed for a simple in-memory queue.
// Import the shared type from types.ts:
import type { PendingBirth } from "./types.js";
```

**Core queue pattern** (server-stats-state.ts lines 1–59):
```typescript
// The existing per-hostId queue uses a class with a processing flag.
// The spawn-request queue is GLOBAL (not per-host) and simpler.
// RESEARCH Pattern 3 recommends Promise chaining over the flag approach for
// the global-serialized case. Use the Promise-chain form:

let workerPromise: Promise<void> = Promise.resolve();
const pending: PendingBirth[] = [];

export function enqueue(item: PendingBirth): void {
  pending.push(item);
  workerPromise = workerPromise.then(() => drain());
}

export function isEmpty(): boolean {
  return pending.length === 0;
}

export function dequeue(): PendingBirth | undefined {
  return pending.shift();
}
```

**Error handling pattern** (server-stats-state.ts lines 42–54):
```typescript
// Worker drain loop — never lets an error escape; logs and continues.
// The existing queue's processQueue() wraps each item in try/catch:
while (queue.length > 0) {
  const request = queue.shift();
  if (request) {
    try {
      await request();
    } catch {
      // expected — each item's error is handled at item level
    }
  }
}
```

---

### `src/backend/spawn-requests/worker.ts` (service, request-response, async birth-worker)

**Analog:** `src/backend/database/routes/identity-birth.ts` lines 14–55 (imports), lines 325–390 (BirthDeps assembly + birthIdentity invocation)

**Imports pattern** (identity-birth.ts lines 14–55):
```typescript
import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "../../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  birthIdentity,
  ROLE_NAME_PATTERN,
  ROLE_NAME_RE,
  SSH_CONNECT_TIMEOUT_MS,
  type BirthEvent,
  type BirthDeps,
} from "./identity-birth-orchestrator.js";
import {
  createOrUpdateUser as matrixCreateOrUpdateUser,
  loginAsUser as matrixLoginAsUser,
  buildRelayJsonBody,
  countUsersMatching as matrixCountUsersMatching,
} from "../../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";
import { getVettedPool } from "../pool/pool-loader.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import type { PendingBirth, SuccessResponse, FailureResponse, FailureReason } from "./types.js";
```

**Owner-userId derivation pattern** (guacamole/routes.ts lines 189–201, RESEARCH Pattern 4):
```typescript
// Direct Drizzle query — NOT resolveHostById (requires prior userId for decryption).
// hosts.userId column is a plaintext foreign key — NOT encrypted. (Pitfall 3)
async function getHostOwnerUserId(hostIdNum: number): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);
  return rows[0]?.userId ?? null;
}
```

**BirthDeps assembly pattern** (identity-birth.ts lines 325–363):
```typescript
// The worker assembles an IDENTICAL deps object to the HTTP route.
// Key differences: no SSE emit, no userId from JWT (derived from host record),
// name is pool-picked, poolPicked: true.
const deps: BirthDeps = {
  connectOneShot,
  execCommand,
  isLocalHostId,
  execLocal,                          // promisified child_process.exec
  getCandidateForBirth: () => null,   // no avatar candidate for worker births
  resolveHostById: async (hostId, uid) => resolveHostById(hostId, uid),
  fsp: {
    readFile: (p, enc) => fsp.readFile(p, enc),
    writeFile: (p, content) => fsp.writeFile(p, content),
  },
  writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
    writeMarkdownFileAtomic(conn, targetPath, contents),
  writeAvatarSiblingFile: async () => {},  // no avatar for worker births
  matrixCreateOrUpdateUser: (mxid, password, displayname) =>
    matrixCreateOrUpdateUser(mxid, password, displayname),
  matrixLoginAsUser: (mxid, validUntilMs) => matrixLoginAsUser(mxid, validUntilMs),
  matrixHomeserver: creds.homeserverBase,
  buildRelayJsonBody: (opts) => buildRelayJsonBody(opts),
  matrixCountUsersMatching: (mxid) => matrixCountUsersMatching(mxid),
};
```

**birthIdentity invocation pattern** (identity-birth.ts lines 368–390):
```typescript
// CRITICAL: export is 'birthIdentity', NOT 'runIdentityBirthOrchestrator' (Pitfall 4)
// The function never throws normally — all results come via emit().
let endedEvent: BirthEvent & { type: "ended" } | null = null;

const emit = (e: BirthEvent): void => {
  if (e.type === "ended") {
    endedEvent = e as BirthEvent & { type: "ended" };
  }
  // Log state transitions per standing directive
  systemLogger.info("spawn-request-worker: birth event", {
    operation: "spawn_request_birth_event",
    uuid: item.uuid,
    event: e,
  });
};

try {
  await birthIdentity(opts, emit, deps);
} catch (err) {
  // Truly unexpected — orchestrator's own catch should have emitted ended{ok:false}
  systemLogger.error("spawn-request-worker: birthIdentity threw unexpectedly", {
    operation: "spawn_request_birth_unexpected_throw",
    uuid: item.uuid,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

**BirthOptions shape for pool-picked worker birth** (RESEARCH Pattern 6):
```typescript
const opts: BirthOptions = {
  userId,                    // from getHostOwnerUserId(item.hostIdNum)
  hostId: item.hostIdNum,    // numeric (Pitfall 2: HostRecord.id is string, BirthOptions.hostId is number)
  name: pickedName.toLowerCase(),
  title: "",                 // absent-⇒-omit invariant (role-inherited, Phase 86)
  path: `~/${pickedName.toLowerCase()}/`,  // per-agent default (identity-birth.ts L245-249 fallback)
  colorHue: null,            // role-inherited
  voice: null,               // role-inherited
  avatarCandidateId: "",     // role-inherited avatar (Phase 86 absent-⇒-omit)
  role: item.role,
  task: item.task ?? undefined,  // null → undefined (absent-⇒-omit)
  poolPicked: true,
};
```

**Pool-picking pattern** (pool-loader.ts lines 81–100):
```typescript
// getVettedPool() returns string[] of PascalCase names; returns [] on any error (never throws).
const pool = getVettedPool();
if (pool.length === 0) {
  await writeFailureFile(item, "pool_exhausted");
  return;
}
const pickedName = pool[Math.floor(Math.random() * pool.length)];
```

**Response-file write pattern** (RESEARCH Pattern 7, identity-artifact-reader.ts lines 1924–1968):
```typescript
// Use writeMarkdownFileAtomic — NOT sftp.rename (Pitfall 6), NOT per-identity-file.ts (Pitfall 1).
// Path: literal $HOME — SFTP resolves it (same convention as per-identity-file.ts line 121).
// Open a fresh one-shot connection for the response write (birthIdentity closes its own conn).
const responseConn = await connectOneShot(hostDetails, SSH_CONNECT_TIMEOUT_MS);
try {
  const successPayload: SuccessResponse = {
    name: pickedName.toLowerCase(),
    mxid,
    birthed_at: new Date().toISOString(),
  };
  await writeMarkdownFileAtomic(
    responseConn,
    `$HOME/fleet/spawn-requests/${item.uuid}.success.json`,  // (Pitfall 8: NOT fleet/identities/)
    JSON.stringify(successPayload, null, 2),
  );
} finally {
  responseConn.end();
}
```

**Logging pattern** (ssh-poll-orchestrator.ts lines 864–868, 919–924):
```typescript
// systemLogger.info at every meaningful state transition (standing directive)
systemLogger.info("spawn-request-worker: processing birth", {
  operation: "spawn_request_worker_start",
  uuid: item.uuid,
  hostId: item.hostId,
  role: item.role,
});
```

---

### `src/backend/fleet-status/ssh-poll-orchestrator.ts` (modify — extend `pollOneHost`)

**Analog:** self — extend `pollOneHost` at line 917 (after `pollDormantOnlyIdentities` call, before poll-end log at line 919)

**Extension injection point** (ssh-poll-orchestrator.ts lines 861–924):
```typescript
// INJECT HERE — after pollDormantOnlyIdentities(hostState, liveTmuxSet) at line 917,
// before the systemLogger.info("Fleet-status poll end") at line 919.

// (d) Phase 99 — atomic spawn-request scan
const spawnBatch = await scanSpawnRequests(host, channel);
for (const item of spawnBatch) {
  if (deps.enqueueSpawnRequest) {
    deps.enqueueSpawnRequest(item);
  }
}
```

**OrchestratorDeps extension pattern** (RESEARCH Integration Point 1 / Pitfall 5):
```typescript
// Add as OPTIONAL field to avoid test churn (7207-line test file).
// Existing tests leave it undefined → scan runs, results silently discarded.
export interface OrchestratorDeps {
  // ... existing fields unchanged ...

  /**
   * Phase 99: enqueue a claimed spawn-request for async birth-worker processing.
   * Optional — when absent, spawn-request scan results are discarded (used by
   * tests that don't exercise the spawn-request path).
   */
  enqueueSpawnRequest?: (item: PendingBirth) => void;
}
```

**Fail-open exec pattern** (ssh-poll-orchestrator.ts lines 871–881):
```typescript
// Copy the existing ls fail-open pattern: null return = SSH error, treat as empty.
const listing = await channel.exec(
  "ls -1 ~/.claude/sessions/*.json 2>/dev/null || true",
);
if (listing === null) {
  systemLogger.warn("Fleet-status: ls of sessions dir returned null (SSH error)", {
    operation: "fleet_status_host_ssh_unreachable",
    fleetHostId: host.id,
  });
  return;
}
// For spawn-request scan: null → log warn + return [] (fail-open, don't kill the tick)
```

**Atomic read-and-delete shell command** (RESEARCH Pattern 2):
```typescript
// Shell command for scanSpawnRequests() — POSIX portable, atomic per-file claim.
// mv is the atomic claim: if two ticks somehow ran simultaneously, only one mv wins.
// Length check (${#f} -eq 36) prevents claiming *.success.json / *.failure.json (Security note).
const atomicCmd = [
  "cd ~/fleet/spawn-requests 2>/dev/null || exit 0;",
  "for f in *.json; do",
  "  [ -f \"$f\" ] || continue;",
  "  base=\"${f%.json}\";",
  "  [ ${#base} -eq 36 ] || continue;",   // UUID length guard (security: Pitfall 7 + RESEARCH security note)
  "  tmp=\"$f.$$\";",
  "  mv \"$f\" \"$tmp\" 2>/dev/null || continue;",  // atomic claim
  "  printf '%s\\t' \"$f\"; cat \"$tmp\"; printf '\\n'; rm -f \"$tmp\";",
  "done",
].join(" ");
```

**Stdout parsing pattern** (RESEARCH Pattern 2):
```typescript
// Each claimed file produces: <uuid>.json<TAB><json-body><NEWLINE>
// Empty stdout = no pending requests (not an error).
function parseSpawnRequestBatch(stdout: string, hostId: string): PendingBirth[] {
  if (!stdout.trim()) return [];
  const results: PendingBirth[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const filename = line.slice(0, tab).trim();
    const body = line.slice(tab + 1).trim();
    const uuid = filename.replace(/\.json$/, "");
    // validate UUID pattern before using in file paths (security: path traversal)
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // malformed JSON from file — log and skip; failure file drop happens in worker
      systemLogger.warn("spawn-request-scan: malformed JSON in request file", {
        operation: "spawn_request_scan_parse_error",
        fleetHostId: hostId,
        uuid,
      });
      continue;
    }
    // basic schema check; full validation happens in worker before birth
    if (parsed !== null && typeof parsed === "object") {
      results.push({ hostId, hostIdNum: parseInt(hostId, 10), uuid, ...(parsed as object) } as PendingBirth);
    }
  }
  return results;
}
```

---

### `src/backend/spawn-requests/queue.test.ts` (test, unit)

**Analog:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (overall test structure)

**Test file header pattern** (ssh-poll-orchestrator.test.ts lines 1–80):
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueue, dequeue, isEmpty } from "./queue.js";  // or whatever is exported

describe("spawn-request queue", () => {
  beforeEach(() => {
    // reset module state between tests (if queue holds module-level state)
    vi.resetModules();
  });

  it("isEmpty() returns true when queue is empty", () => { ... });
  it("enqueue() + dequeue() round-trip preserves item", () => { ... });
  it("dequeue() on empty queue returns undefined", () => { ... });
  it("serialized worker: second item not processed until first completes", async () => { ... });
});
```

**Mock pattern for injected deps** (ssh-poll-orchestrator.test.ts lines 217–270):
```typescript
// vi.fn() for every injected dependency; override per test as needed.
const mockEnqueue = vi.fn();
const mockOrchestrator = vi.fn().mockResolvedValue(undefined);
```

---

### `src/backend/spawn-requests/worker.test.ts` (test, unit + integration wire)

**Analog:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (MockSshChannel + buildDeps pattern)

**MockSshChannel pattern** (ssh-poll-orchestrator.test.ts lines 84–118):
```typescript
// Copy MockSshChannel for worker tests that need a response-file write stub.
// Use vi.fn() for writeMarkdownFileAtomic and connectOneShot in BirthDeps.
const mockWriteMarkdownFileAtomic = vi.fn().mockResolvedValue(undefined);
const mockConnectOneShot = vi.fn().mockResolvedValue({ end: vi.fn(), sftp: vi.fn() });
const mockBirthIdentity = vi.fn().mockImplementation(
  async (_opts, emit, _deps) => {
    emit({ type: "ended", ok: true, identityId: "willow", sessionName: "Willow-Coordinator" });
  }
);
```

**Test structure** (covers D-21, D-22):
```typescript
describe("spawn-request worker", () => {
  it("drops success response file on orchestrator success", async () => { ... });
  it("drops failure response file with reason=birth_failed on orchestrator failure", async () => { ... });
  it("drops failure response file with reason=malformed + message on malformed request", async () => { ... });
  it("drops failure response file with reason=pool_exhausted when pool is empty", async () => { ... });
  it("drops failure response file with reason=matrix_creds_missing when creds absent", async () => { ... });
  it("E2E wire: enqueue → worker drains → success file drops to correct path", async () => { ... });
  it("serialized: second birth does not start until first completes", async () => { ... });
});
```

**Response file path assertion** (Pitfall 8):
```typescript
// Assert path is fleet/spawn-requests/<uuid>.success.json, NOT fleet/identities/
expect(mockWriteMarkdownFileAtomic).toHaveBeenCalledWith(
  expect.anything(),
  `$HOME/fleet/spawn-requests/${uuid}.success.json`,
  expect.stringContaining('"name"'),
);
```

---

### `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (modify — extend existing file)

**Analog:** self — add tests inside the existing `describe("createSshPollOrchestrator")` block

**MockSshChannel extension for spawn-request tests** (existing pattern lines 89, 232–247):
```typescript
// Register a response for the spawn-request scan command pattern.
// The channel already uses string.includes() matching.
channel.setResponse(
  "fleet/spawn-requests",
  "",  // default: empty (no pending requests)
);

// Override in specific test to return a request file:
channel.setResponse(
  "fleet/spawn-requests",
  `${uuid}.json\t${JSON.stringify({ role: "coordinator", task: "test task", requested_at: "2026-09-10T00:00:00Z" })}\n`,
);
```

**Test cases to add** (RESEARCH Pattern 8, D-17 requirement):
```typescript
it("spawn-request scan: issues atomic exec command on each poll tick", async () => {
  // assert channel.getCalls() includes a command that matches 'fleet/spawn-requests'
});
it("spawn-request scan: null channel response → empty batch, no enqueue call", async () => {
  channel.setResponse("fleet/spawn-requests", null);
  // assert enqueueSpawnRequest was NOT called
});
it("spawn-request scan: missing folder (empty stdout) → empty batch", async () => {
  channel.setResponse("fleet/spawn-requests", "");
  // assert enqueueSpawnRequest was NOT called
});
it("spawn-request scan: valid request file → enqueues correct PendingBirth item", async () => {
  // assert enqueueSpawnRequest was called with uuid, role, task, hostId
});
it("spawn-request scan: does NOT claim *.success.json or *.failure.json files", async () => {
  // the shell length-guard (${#base} -eq 36) rejects response filenames
});
```

---

## Shared Patterns

### Logging
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` lines 864–868, 919–924
**Apply to:** `worker.ts`, extended section in `ssh-poll-orchestrator.ts`
```typescript
// systemLogger for backend fleet-side operations (not sshLogger, not databaseLogger)
import { systemLogger } from "../utils/logger.js";

systemLogger.info("description", {
  operation: "snake_case_operation_name",  // structured log key
  fleetHostId: host.id,                   // always include hostId for traceability
  uuid: item.uuid,                        // always include uuid for spawn-request events
});
```

### Fail-open error handling for SSH exec
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` lines 871–881
**Apply to:** `scanSpawnRequests()` helper in `ssh-poll-orchestrator.ts`
```typescript
// null return from channel.exec = SSH error; log warn and return [] (never throw)
if (result === null) {
  systemLogger.warn("Fleet-status: spawn-request scan returned null (SSH error)", {
    operation: "fleet_status_spawn_scan_ssh_error",
    fleetHostId: host.id,
  });
  return [];
}
```

### SFTP atomic write
**Source:** `src/backend/claude-session/identity-artifact-reader.ts` lines 1924–1968
**Apply to:** response-file drop in `worker.ts`
```typescript
// Always writeMarkdownFileAtomic — never sftp.rename (Pitfall 6),
// never per-identity-file.ts writeIdentityFile (Pitfall 1 — whitelist blocks *.success.json)
await writeMarkdownFileAtomic(conn, targetPath, JSON.stringify(payload, null, 2));
```

### OrchestratorDeps optional-field extension
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` lines 75–104
**Apply to:** `enqueueSpawnRequest` addition to `OrchestratorDeps`
```typescript
// Add optional fields to preserve backward-compat with existing tests.
// Tests that don't override the field get the "absent → no-op" behavior.
enqueueSpawnRequest?: (item: PendingBirth) => void;
```

### Direct Drizzle host-owner query
**Source:** `src/backend/guacamole/routes.ts` lines 189–201
**Apply to:** `getHostOwnerUserId()` in `worker.ts`
```typescript
// NOT resolveHostById() — that requires a prior userId for decryption scoping (Pitfall 3).
// hosts.userId is a plaintext foreign key — safe to query without userId scope.
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";

const rows = await getDb()
  .select({ userId: hosts.userId })
  .from(hosts)
  .where(eq(hosts.id, hostIdNum))
  .limit(1);
const userId = rows[0]?.userId ?? null;
```

---

## No Analog Found

All files have close analogs. No files in this phase lack a codebase match.

---

## Critical Pitfalls (summary for planner)

| # | What | How to Avoid |
|---|------|-------------|
| P1 | `per-identity-file.ts` ALLOWED_REL_PATHS rejects `*.success.json` | Use `writeMarkdownFileAtomic` directly |
| P2 | `HostRecord.id` is `string`; `BirthOptions.hostId` is `number` | Store `hostIdNum: parseInt(hostId, 10)` in `PendingBirth`; pass `hostIdNum` |
| P3 | `resolveHostById` requires prior userId for decryption | Use direct `db.select({ userId: hosts.userId })` query |
| P4 | Export is `birthIdentity`, not `runIdentityBirthOrchestrator` | Import `{ birthIdentity }` from `identity-birth-orchestrator.js` |
| P5 | Adding required field to `OrchestratorDeps` breaks 7207-line test file | Add `enqueueSpawnRequest?` as optional |
| P6 | `sftp.rename` is not atomic on OpenSSH | Always use `writeMarkdownFileAtomic` (uses `ext_openssh_rename`) |
| P7 | `*.json` glob claims response files (`*.success.json` ends in `.json`) | Shell length-check: `[ ${#base} -eq 36 ]` before claiming |
| P8 | Response file path is `fleet/spawn-requests/`, NOT `fleet/identities/` | Construct path explicitly; do not copy `per-identity-file.ts` path helpers |

---

## Metadata

**Analog search scope:** `src/backend/fleet-status/`, `src/backend/database/routes/`, `src/backend/ssh/`, `src/backend/claude-session/`, `src/backend/pool/`, `src/backend/guacamole/`
**Files scanned:** 11 source files read, 1 test file read
**Pattern extraction date:** 2026-09-10
