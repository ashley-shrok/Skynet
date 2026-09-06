# Phase 75: Server-side substrate bootstrap — Pattern Map

**Mapped:** 2026-09-05
**Files analyzed:** 8 new/modified files + 1 removal target
**Analogs found:** 8 / 8 (removal target needs no analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/distributor/server-substrate-orchestrator.ts` | service/orchestrator | event-driven + periodic | `src/backend/fleet-status/ssh-poll-orchestrator.ts` | exact |
| `src/backend/distributor/server-substrate-orchestrator.test.ts` | test | — | `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` + `run-bootstrap.test.ts` | exact |
| `src/backend/distributor/log-tags.ts` | utility | — | `src/backend/distributor/log-tags.ts` (extend in place) | self |
| `src/backend/utils/substrate-credential-migration.ts` | utility/migration | CRUD | `src/backend/utils/credential-system-encryption-migration.ts` | role-match |
| `src/backend/utils/substrate-credential-migration.test.ts` | test | — | `src/backend/distributor/run-bootstrap.test.ts` | role-match |
| `src/backend/database/routes/host.ts` | route handler (modify) | request-response | `src/backend/database/routes/host-autostart-routes.ts` (forceSave pattern) | role-match |
| `src/backend/ssh/host-resolver.ts` | utility (modify) | request-response | `src/backend/ssh/host-resolver.ts` (existing credentialId branch) | self |
| `src/backend/starter.ts` | bootstrap (modify) | event-driven | `src/backend/starter.ts` (existing fleet-status block, lines 314-682) | self |
| **REMOVAL TARGET** `src/backend/fleet-status/ssh-poll-orchestrator.ts:822-833,2087-2152,2309-2310` | — | — | — | — |

---

## Pattern Assignments

### `src/backend/distributor/server-substrate-orchestrator.ts` (new orchestrator)

**Analog:** `src/backend/fleet-status/ssh-poll-orchestrator.ts`

**Imports pattern** — mirror the orchestrator's imports shape; only the needed subset:
```typescript
// From ssh-poll-orchestrator.ts:1-10 area (pattern — adapt paths)
import { readFile, stat } from "node:fs/promises";
import { systemLogger } from "../utils/logger.js";
import { runSweepForHost } from "./run-sweep.js";
import { FLEET_SUBSTRATE_CATALOG } from "./catalog.js";
import { logSweepHookError, logPersistentFailure } from "./log-tags.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
```

**Deps interface pattern** (ssh-poll-orchestrator.ts:76-105):
```typescript
export interface ServerSubstrateOrchestratorDeps {
  listSubstrateHosts(): Promise<SubstrateHostRecord[]>;
  acquireChannel(host: SubstrateHostRecord): Promise<SshChannel | null>;
  releaseChannel(host: SubstrateHostRecord, channel: SshChannel): void;
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;
  now(): number;
  retryIntervalMs?: number;
  persistentFailureThreshold?: number;
}

export interface ServerSubstrateOrchestrator {
  start(): Promise<void>;
  stop(): void;
  sweepOneHost(host: { id: string; name: string }): Promise<void>;
  getSweepTickCount(): number;   // observability; mirrors getPollTickCount()
}
```

**Factory function pattern** (ssh-poll-orchestrator.ts:787-794):
```typescript
export function createServerSubstrateOrchestrator(
  deps: ServerSubstrateOrchestratorDeps,
): ServerSubstrateOrchestrator {
  const retryIntervalMs = deps.retryIntervalMs ?? 30000;
  const persistentFailureThreshold = deps.persistentFailureThreshold ?? 3;
  // ... internal state
}
```

**Once-per-host gating Set pattern** (ssh-poll-orchestrator.ts:822-833) — replicate exactly:
```typescript
// Exact pattern from ssh-poll-orchestrator.ts:829-833
const sweepedThisInstance = new Set<string>();
const sweepInFlight = new Set<string>();
const consecutiveFailures = new Map<string, number>();
const persistentAlertFired = new Set<string>();
let sweepTickCount = 0;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
```

**queueMicrotask fire-and-forget pattern** (ssh-poll-orchestrator.ts:2117-2151) — the entire queueMicrotask block is the canonical shape; new orchestrator's per-host sweep follows it verbatim with the added failure counter logic:
```typescript
// ssh-poll-orchestrator.ts:2107-2151 (adapted for the new orchestrator)
if (!sweepedThisInstance.has(host.id) && !sweepInFlight.has(host.id)) {
  sweepInFlight.add(host.id);
  queueMicrotask(async () => {
    try {
      const result = await runSweepForHost(
        channel,
        { id: host.id, name: host.name },
        FLEET_SUBSTRATE_CATALOG,
        { readBundledBytes: bundledReaderFromDisk },
      );
      const failed = result?.itemsFailed ?? 0;
      if (failed === 0) {
        sweepedThisInstance.add(host.id);
        consecutiveFailures.delete(host.id);
        persistentAlertFired.delete(host.id);
      } else {
        const n = (consecutiveFailures.get(host.id) ?? 0) + 1;
        consecutiveFailures.set(host.id, n);
        if (n >= persistentFailureThreshold && !persistentAlertFired.has(host.id)) {
          persistentAlertFired.add(host.id);
          logPersistentFailure({ fleetHostId: host.id, hostName: host.name, consecutiveFailures: n });
        }
      }
    } catch (err) {
      logSweepHookError({
        fleetHostId: host.id,
        hostName: host.name,
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      sweepInFlight.delete(host.id);
    }
  });
}
```

**stop() cleanup pattern** (ssh-poll-orchestrator.ts:2295-2310):
```typescript
// ssh-poll-orchestrator.ts:2296-2310
stop(): void {
  stopped = true;
  if (retryTimer !== null) deps.clearInterval(retryTimer);
  retryTimer = null;
  // Close ssh2 clients (hostClients.clear() equivalent)
  sweepedThisInstance.clear();
  sweepInFlight.clear();
  consecutiveFailures.clear();
  persistentAlertFired.clear();
},
```

**bundledReaderFromDisk pattern** (ssh-poll-orchestrator.ts:2045-2057) — extract to local const inside factory (or extract to `src/backend/distributor/bundled-reader.ts` per RESEARCH open question A3 — planner must confirm):
```typescript
// ssh-poll-orchestrator.ts:2045-2057
const bundledReaderFromDisk = async (
  bundledPath: string,
): Promise<{ bytes: Buffer; mode: number } | null> => {
  try {
    const [bytes, statResult] = await Promise.all([
      readFile(bundledPath),
      stat(bundledPath),
    ]);
    return { bytes, mode: statResult.mode };
  } catch {
    return null;
  }
};
```

**getPollTickCount observability method** (ssh-poll-orchestrator.ts:2317-2319):
```typescript
getSweepTickCount(): number {
  return sweepTickCount;
},
```

**listSubstrateHosts query pattern** (starter.ts:392-406, adapted — session-less variant):
```typescript
// Adapt starter.ts:392-406 — replace resolveHostById(row.id, userId) with
// direct CSKEK decrypt from sshCredentials.system_* columns
const db = getDb();
const rows = await db
  .select({
    id: hostsTable.id,
    name: hostsTable.name,
    credentialId: hostsTable.credentialId,
  })
  .from(hostsTable)
  .where(and(eq(hostsTable.enableSsh, true), eq(hostsTable.runsFleetSubstrate, true)));
// Then for each row: fetch sshCredentials, decrypt from systemPassword/systemKey/systemKeyPassword
// using FieldCrypto.decryptField(ciphertext, CSKEK, credId.toString(), fieldName)
// NOTE: MUST NOT call DataCrypto.getUserDataKey() — server-context path only reads system_* cols
```

---

### `src/backend/distributor/server-substrate-orchestrator.test.ts` (new test)

**Primary analog:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (fake timers, factory test, mock channel, mock log-tags)
**Secondary analog:** `src/backend/distributor/run-bootstrap.test.ts` (makeChannel helper, never-throw testing)

**Mock pattern** (ssh-poll-orchestrator.test.ts:38-74):
```typescript
vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() },
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("./run-sweep.js", () => ({
  runSweepForHost: vi.fn(async () => ({ itemsChecked: 1, itemsChanged: 0, itemsFailed: 0 })),
}));
vi.mock("./log-tags.js", () => ({
  logSweepResult: vi.fn(),
  logItemChanged: vi.fn(),
  logItemFailed: vi.fn(),
  logSweepHookError: vi.fn(),
  logPersistentFailure: vi.fn(),  // new tag from Phase 75
}));
```

**MockSshChannel pattern** (ssh-poll-orchestrator.test.ts:84-118) — reuse verbatim. The `class MockSshChannel implements SshChannel` with `setResponse(pattern, response)` and substring-match exec is the standard test channel for all distributor tests.

**makeChannel helper pattern** (run-bootstrap.test.ts:50-61) — lighter alternative for simpler tests:
```typescript
function makeChannel(
  handlers: Record<string, string | null>,
  defaultResponse: string | null = null,
): { channel: SshChannel; exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async (cmd: string) => {
    for (const [key, response] of Object.entries(handlers)) {
      if (cmd.includes(key)) return response;
    }
    return defaultResponse;
  });
  return { channel: { exec }, exec };
}
```

**vi.useFakeTimers() pattern** — use for D-17 startup-pass and retry-cadence tests:
```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
// Drive the retry interval: await vi.runAllTimersAsync()
```

**never-throw contract test pattern** (run-bootstrap.test.ts:79 area):
```typescript
// Every test on runSweepForHost paths:
await expect(orchestrator.start()).resolves.not.toThrow();
// or for sweepOneHost:
await expect(orchestrator.sweepOneHost(host)).resolves.not.toThrow();
```

---

### `src/backend/distributor/log-tags.ts` (extend in place)

**Analog:** `src/backend/distributor/log-tags.ts` itself (lines 44-143 establish the pattern)

**New function to add** (pattern derived from logSweepHookError at lines 131-143):
```typescript
// Add after logSweepHookError — follows the same named-export + systemLogger.warn shape
export function logPersistentFailure(payload: {
  fleetHostId: string;
  hostName: string;
  consecutiveFailures: number;
}): void {
  systemLogger.warn(
    `Fleet-substrate persistent failure: ${payload.hostName} has failed ${payload.consecutiveFailures} consecutive sweeps`,
    {
      operation: "fleet_substrate_host_persistent_failure",
      ...payload,
    },
  );
}
```

**Discipline to preserve** (log-tags.ts:29-33): this file has ONE import — `systemLogger`. Do not add imports from the catalog, sweep-logic, or any transport module. The new function takes a plain payload object.

---

### `src/backend/utils/substrate-credential-migration.ts` (new migration)

**Analog:** `src/backend/utils/credential-system-encryption-migration.ts` (full file, 136 lines)

**Imports pattern** (credential-system-encryption-migration.ts:1-7):
```typescript
import { db } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { hosts } from "../database/db/schema.js";
import { SystemCrypto } from "./system-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { DatabaseSaveTrigger } from "../database/db/index.js";
import { databaseLogger } from "./logger.js";
// NOTE: import UserCrypto for the sessionless PBKDF2 derive path (see RESEARCH open question A1)
```

**Per-credential decrypt/re-encrypt pattern** (credential-system-encryption-migration.ts:44-96) — exact field-by-field shape to replicate; Phase 75 migration uses the same FieldCrypto calls but sources userDEK from PBKDF2 derivation (not `DataCrypto.getUserDataKey()`):
```typescript
// credential-system-encryption-migration.ts:44-96
const plainPassword = cred.password
  ? FieldCrypto.decryptField(cred.password, userDEK, cred.id.toString(), "password")
  : null;
const plainKey = cred.key
  ? FieldCrypto.decryptField(cred.key, userDEK, cred.id.toString(), "key")
  : null;
const plainKeyPassword = cred.keyPassword
  ? FieldCrypto.decryptField(cred.keyPassword, userDEK, cred.id.toString(), "keyPassword")
  : null;

const systemPassword = plainPassword
  ? FieldCrypto.encryptField(plainPassword, CSKEK, cred.id.toString(), "password")
  : null;
const systemKey = plainKey
  ? FieldCrypto.encryptField(plainKey, CSKEK, cred.id.toString(), "key")
  : null;
const systemKeyPassword = plainKeyPassword
  ? FieldCrypto.encryptField(plainKeyPassword, CSKEK, cred.id.toString(), "key_password")
  : null;

await db
  .update(sshCredentials)
  .set({ systemPassword, systemKey, systemKeyPassword, updatedAt: new Date().toISOString() })
  .where(eq(sshCredentials.id, cred.id));
```

**Summary-return pattern** (credential-system-encryption-migration.ts:38-126):
```typescript
let migrated = 0;
let failed = 0;
const skipped = 0;
// ... loop ...
return { migrated, failed, skipped };
```

**Error-per-host log-and-continue pattern** (credential-system-encryption-migration.ts:114-124):
```typescript
} catch (error) {
  databaseLogger.warn(
    `Skipping credential migration for credential ${cred.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    {
      operation: "substrate_migration_skip",
      credentialId: cred.id,
      userId,
    },
  );
  failed++;
}
```

**forceSave pattern after writes** (host-autostart-routes.ts:173-181 — canonical reference):
```typescript
try {
  await DatabaseSaveTrigger.forceSave("substrate-cred-migration");
} catch (saveError) {
  databaseLogger.warn("Database save failed after substrate migration", {
    operation: "substrate_migration_db_save_failed",
    error: saveError instanceof Error ? saveError.message : "Unknown error",
  });
  // log-and-swallow; migration rows may have succeeded
}
```

**Key divergence from the analog:** The existing migration calls `DataCrypto.getUserDataKey(userId)` (requires browser login). Phase 75 migration MUST NOT use this — derive the DEK via `UserCrypto` PBKDF2 from an externally-provided password. See RESEARCH open question A1 for the exact method to call before planning.

**Substrate-host filter for query** — narrow to `runsFleetSubstrate=true` hosts joined to sshCredentials (the analog queries all sshCredentials for a user where system cols are null):
```typescript
// Join hosts and sshCredentials, filter by runs_fleet_substrate=1 AND sshCredentials.userId=userId
const rows = await db
  .select({ cred: sshCredentials })
  .from(sshCredentials)
  .innerJoin(hosts, eq(hosts.credentialId, sshCredentials.id))
  .where(and(eq(sshCredentials.userId, userId), eq(hosts.runsFleetSubstrate, true)));
```

---

### `src/backend/database/routes/host.ts` (modify — POST create + PUT update)

**Analog:** `src/backend/database/routes/host-autostart-routes.ts:173-181` (forceSave usage), plus the existing POST handler at host.ts:101-438 itself.

**Singleton reference pattern for substrateOrch** (host.ts:78-81 — how other managers are accessed):
```typescript
// host.ts:78-81 — existing pattern for module-level singletons
const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
// Add: import or reference substrateOrch singleton at this scope
// (planner decides between singleton import vs. factory injection)
```

**effectiveRunsFleetSubstrate extraction** (host.ts:239-247 — already computed correctly, just reference it):
```typescript
// host.ts:239-247 — already in the codebase; the fire-and-forget trigger gates on this
const effectiveRunsFleetSubstrate =
  runsFleetSubstrate !== undefined
    ? !!runsFleetSubstrate
    : effectiveConnectionType === "ssh";
```

**Fire-and-forget insertion point** (host.ts:420 — after `res.json(resolvedHost)`, before the closing try/catch brace):
```typescript
// Insert after: res.json(resolvedHost);  (line ~420)
// Insert before: notifyStatsHostUpdated(...)  (line ~421) or after it — order doesn't matter
if (effectiveRunsFleetSubstrate && effectiveConnectionType === "ssh") {
  queueMicrotask(async () => {
    try {
      await substrateOrch.sweepOneHost({ id: String(createdHost.id), name: effectiveName });
    } catch {
      // defense-in-depth only — sweepOneHost has never-throw contract
    }
  });
}
```

**Validation guard for inline credentials (Pitfall 5)** — insert before the `try { const result = await SimpleDBOps.insert(...)` block at host.ts:389:
```typescript
// Guard: substrate hosts must use credentialId-based auth (no inline creds)
if (effectiveRunsFleetSubstrate && !credentialId) {
  return res.status(400).json({
    error: "Hosts with runsFleetSubstrate=true must use a named credential (credentialId required)",
  });
}
```

---

### `src/backend/ssh/host-resolver.ts` (modify — CSKEK decrypt branch)

**Analog:** `src/backend/ssh/host-resolver.ts:75-199` itself — the existing `credentialId` branch is the pattern. The new CSKEK branch sits above it (checked first for substrate hosts).

**Existing credentialId decrypt pattern** (host-resolver.ts:161-196) — the new CSKEK branch mirrors the same shape but reads `systemPassword`/`systemKey`/`systemKeyPassword` instead of calling `SimpleDBOps.select(..., "ssh_credentials", ownerId)`:
```typescript
// host-resolver.ts:161-173 (existing user-DEK path — shape to mirror for CSKEK path)
const credentials = await SimpleDBOps.select(
  db.select().from(sshCredentials).where(
    and(eq(sshCredentials.id, host.credentialId as number), eq(sshCredentials.userId, ownerId))
  ),
  "ssh_credentials",
  ownerId,
);
if (credentials.length > 0) {
  const cred = credentials[0] as Record<string, unknown>;
  host.password = cred.password;
  host.key = (cred.privateKey || cred.key) as string | null;
  host.keyPassword = cred.keyPassword;
  // ...
}
```

**CSKEK branch to insert before the existing credentialId block** (after line 75, check `host.runsFleetSubstrate`):
```typescript
// Insert at host-resolver.ts:75 — NEW: substrate-host CSKEK path (D-09)
if (host.runsFleetSubstrate && host.credentialId) {
  try {
    const { SystemCrypto } = await import("../utils/system-crypto.js");
    const { FieldCrypto } = await import("../utils/field-crypto.js");
    const CSKEK = await SystemCrypto.getInstance().getCredentialSharingKey();
    const rawRows = await db.select().from(sshCredentials)
      .where(eq(sshCredentials.id, host.credentialId as number));
    if (rawRows.length > 0) {
      const cred = rawRows[0];
      const credId = cred.id.toString();
      host.password = cred.systemPassword
        ? FieldCrypto.decryptField(cred.systemPassword, CSKEK, credId, "password")
        : null;
      host.key = cred.systemKey
        ? FieldCrypto.decryptField(cred.systemKey, CSKEK, credId, "key")
        : null;
      host.keyPassword = cred.systemKeyPassword
        ? FieldCrypto.decryptField(cred.systemKeyPassword, CSKEK, credId, "key_password")
        : null;
      host.authType = host.key ? "key" : host.password ? "password" : "none";
    }
    return host as unknown as SSHHost;  // explicit return — do NOT fall through to user-DEK branch
  } catch (e) {
    sshLogger.warn("Failed to resolve CSKEK credential for substrate host", {
      operation: "host_resolver_substrate_cskek",
      hostId,
      error: e instanceof Error ? e.message : "Unknown",
    });
    return null;  // fail closed — do NOT fall through to user-DEK branch
  }
}
// existing credentialId block continues below...
```

**Security invariant (D-10):** The `if (host.runsFleetSubstrate && host.credentialId)` check must be an EXPLICIT branch that returns before the user-DEK path. Never use CSKEK as a default fallback for non-substrate hosts.

---

### `src/backend/starter.ts` (modify — wire server-substrate-orchestrator at boot)

**Analog:** `src/backend/starter.ts:314-682` (the fleet-status block) — this IS the pattern. The new orchestrator wires directly after the fleet-status block closes (after line ~682).

**Placement constraint** (starter.ts:302 — RESEARCH Pitfall 3): must come AFTER `await (dbServer as ...).serverReady`:
```typescript
// starter.ts:301-302 — the gate that must precede the new orchestrator start
const dbServer = await import("./database/database.js");
await (dbServer as unknown as { serverReady: Promise<void> }).serverReady;
// ... (other awaited imports and fleet-status block) ...
// NEW: after the fleet-status block closes (~line 682):
```

**Boot-IIFE direct-start pattern** — analogous to how other servers are started in the boot IIFE (no `onFirstSubscriber` gate):
```typescript
// Place after fleet-status block (~line 682), inside the boot IIFE
{
  const { createServerSubstrateOrchestrator } = await import(
    "./distributor/server-substrate-orchestrator.js"
  );
  const { connectOneShot } = await import("./ssh/ssh-one-shot.js");
  const { execCommand } = await import("./ssh/tmux-helper.js");
  const { getDb: getDbForSubstrate } = await import("./database/db/index.js");
  const { hosts: hostsTable, sshCredentials: sshCredsTable } = await import(
    "./database/db/schema.js"
  );
  const { SystemCrypto } = await import("./utils/system-crypto.js");
  const { FieldCrypto } = await import("./utils/field-crypto.js");
  const { and, eq } = await import("drizzle-orm");

  // ... listSubstrateHosts, acquireChannel, releaseChannel local fns
  // (mirror pattern from listIdentityHostingHosts + acquireSshChannel at ~378-600)

  const substrateOrch = createServerSubstrateOrchestrator({
    listSubstrateHosts,
    acquireChannel,
    releaseChannel,
    setInterval,
    clearInterval,
    now: () => Date.now(),
    retryIntervalMs: 30000,
    persistentFailureThreshold: 3,
  });

  await substrateOrch.start();

  // SIGTERM cleanup — mirror orchestrator.stop() pattern at ~line 652
  // (fleet-status orchestrator stop is in registry.onLastUnsubscriber;
  //  server-substrate orchestrator stop is on process SIGTERM directly)
  process.once("SIGTERM", () => { substrateOrch.stop(); });

  systemLogger.info("Server-substrate orchestrator started", {
    operation: "fleet_substrate_orchestrator_started",
    retryIntervalMs: 30000,
  });
}
```

**acquireChannel pattern to copy** (starter.ts:459-599) — the `makeSemaphore(8)` + `connectOneShot` + `execCommand` composition is the standard pattern for all SSH channel acquisition in this codebase. Mirror it verbatim for the substrate orchestrator's channel factory.

---

## Shared Patterns

### CSKEK acquisition
**Source:** `src/backend/utils/system-crypto.ts:238-243`
**Apply to:** `server-substrate-orchestrator.ts` (listSubstrateHosts), `host-resolver.ts` (CSKEK branch), `substrate-credential-migration.ts`
```typescript
const systemCrypto = SystemCrypto.getInstance();
const CSKEK = await systemCrypto.getCredentialSharingKey();
// NEVER log CSKEK value. NEVER include it in error messages.
```

### FieldCrypto encrypt/decrypt
**Source:** `src/backend/utils/field-crypto.ts` (used in credential-system-encryption-migration.ts:44-96)
**Apply to:** `host-resolver.ts` CSKEK branch, `substrate-credential-migration.ts`
```typescript
// Decrypt from system_* column:
const plain = FieldCrypto.decryptField(cred.systemPassword, CSKEK, cred.id.toString(), "password");
// Re-encrypt into system_* column:
const encrypted = FieldCrypto.encryptField(plain, CSKEK, cred.id.toString(), "password");
// Note: keyPassword field name for FieldCrypto is "key_password" (not "keyPassword") —
// verified at credential-system-encryption-migration.ts:93
```

### DatabaseSaveTrigger.forceSave
**Source:** `src/backend/database/routes/host-autostart-routes.ts:173-181`
**Apply to:** `substrate-credential-migration.ts` (after each per-user batch of updates)
```typescript
try {
  await DatabaseSaveTrigger.forceSave("<descriptive-reason>");
} catch (saveError) {
  databaseLogger.warn("Database save failed", {
    operation: "<operation>_db_save_failed",
    error: saveError instanceof Error ? saveError.message : "Unknown error",
  });
  // log-and-swallow
}
```

### Never-throw contract
**Source:** `src/backend/distributor/run-sweep.ts:13-18` (contract comment) and the catch-all shape in ssh-poll-orchestrator.ts:2135-2147
**Apply to:** `server-substrate-orchestrator.ts` (sweepOneHost, the queueMicrotask body), any callers of runSweepForHost
```typescript
// Every runSweepForHost call site must be wrapped in try/catch.
// The catch is defense-in-depth — runSweepForHost never actually rejects.
// Route unexpected errors through logSweepHookError, not inline systemLogger.warn.
try {
  const result = await runSweepForHost(channel, host, FLEET_SUBSTRATE_CATALOG, deps);
  // ...
} catch (err) {
  logSweepHookError({ fleetHostId: host.id, hostName: host.name, errorMessage: err instanceof Error ? err.message : "unknown" });
} finally {
  sweepInFlight.delete(host.id);
}
```

### queueMicrotask over setImmediate
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts:2110-2117` (WARN-3 comment)
**Apply to:** `server-substrate-orchestrator.ts` fire-and-forget sweep kick, `host.ts` on-add trigger
```typescript
// Use queueMicrotask NOT setImmediate.
// queueMicrotask is drainable in tests via `await Promise.resolve()`.
// setImmediate under vi.useFakeTimers does NOT drain via tick() — causes false-green tests.
queueMicrotask(async () => { /* ... */ });
```

### Structured log operation naming
**Source:** `src/backend/distributor/log-tags.ts` (lines 19-24, operation field values)
**Apply to:** All new log calls in Phase 75 files
```typescript
// Convention: fleet_substrate_<noun>_<verb>
// Existing tags (stable — do not change):
//   fleet_substrate_sweep_result
//   fleet_substrate_item_changed
//   fleet_substrate_item_failed
//   fleet_substrate_sweep_hook_error
// New tags for Phase 75:
//   fleet_substrate_host_persistent_failure   (D-06 loud alert)
//   fleet_substrate_orchestrator_started
//   fleet_substrate_host_list_failed          (mirrors fleet_status_host_list_failed pattern)
```

### Test logger mock
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts:38-55` and `run-bootstrap.test.ts:29-36`
**Apply to:** All new test files in Phase 75
```typescript
vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() },
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
```

---

## Removal Target

No analog needed. Planner should assign this as a dedicated removal task, executed in the SAME wave as (or after) the server-substrate-orchestrator is confirmed wired and working.

| File | Lines | What | Why Removed |
|------|-------|------|-------------|
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | 822-833 | `sweepedThisInstance` and `sweepInFlight` Set declarations + comments | State moves to new orchestrator |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | 2087-2152 | Entire fleet-substrate sweep hook block (Phase 72 Plan 04) | Server-context path fully supersedes it (D-04) |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | 2309-2310 | `sweepedThisInstance.clear()` and `sweepInFlight.clear()` in `stop()` | State gone |

**Also verify:** Whether `runSweepForHost` import at the top of `ssh-poll-orchestrator.ts` is ONLY used by the removed block. If so, remove that import too. If it has other callers, keep it.

**Pitfall 6 order:** Removal wave MUST come after the server-substrate-orchestrator is live and confirmed. Do not delete before new code is deployed.

---

## No Analog Found

All files have analogs. No RESEARCH.md patterns needed as fallback for any file.

---

## Metadata

**Analog search scope:** `src/backend/fleet-status/`, `src/backend/distributor/`, `src/backend/utils/`, `src/backend/database/routes/`, `src/backend/ssh/`, `src/backend/starter.ts`
**Files scanned:** 11 source files, 2 test files read in full or targeted ranges
**Pattern extraction date:** 2026-09-05
