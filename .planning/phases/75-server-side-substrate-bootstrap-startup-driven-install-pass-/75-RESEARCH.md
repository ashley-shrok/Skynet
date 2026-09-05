# Phase 75: Server-side substrate bootstrap — Research

**Researched:** 2026-09-05
**Domain:** Fleet-substrate distribution lifecycle, system-credential model, server-context orchestrator, one-shot migration
**Confidence:** HIGH — all findings verified against the live codebase; no assumptions required

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger model**
- D-01: Startup pass runs at container boot, serially through every host with `runsFleetSubstrate:true`. No parallelism.
- D-02: Host-create hook fires the install pass immediately for the just-created host as fire-and-forget from the create request. POST /host/db/host returns without awaiting the sweep.
- D-03: Retry cadence piggybacks on the existing 30-second host-list refresh — no new timer. Server-context orchestrator gets a periodic tick equivalent to the existing `hostRefreshEveryNTicks` semantics.
- D-04: Existing browser-driven install-pass hook at `ssh-poll-orchestrator.ts:2087-2152` is removed. Server-context path fully supersedes it.
- D-05: Once-per-host-per-Skynet-lifetime invariant is preserved — successful sweep marks the host done; container restart re-fires. Same Set<string> shape as `sweepedThisInstance` today, owned by the new server-context orchestrator.

**Failure handling**
- D-06: Retry-forever semantics with distinctive loud alerting after N consecutive failures per host (N = small number, likely 3-5, planner picks). Alert is a structured log line (new operation tag, e.g. `fleet_substrate_host_persistent_failure`). Retries continue in background regardless.
- D-07: Alert fires once per host per uptime at the N-th failure — subsequent failures log at normal severity, not re-scream. Reset counter on next successful sweep.

**Credential model**
- D-08: Substrate-flagged hosts get credentials wrapped with `SystemCrypto.getCredentialSharingKey()` (CSKEK) — one representation, no per-user DEK wrap. Applies at: host create with `runsFleetSubstrate:true`; host update that flips `runsFleetSubstrate` to `true`; host update that changes the credential on an already-substrate host.
- D-09: Owner accesses through the same CSKEK path. Browser terminal to a substrate host reads through the system key, not through the owner's DEK. Single representation — no dual-wrap sync problem.
- D-10: Non-substrate hosts unchanged — per-user DEK wrap continues exactly as today. Relaxation is scoped to substrate hosts only.
- D-11: Substrate-flag-toggle-off (rare) is deferred out-of-phase — credential stays CSKEK-wrapped, sweep just stops running for that host.

**Migration**
- D-12: One-shot operator-run migration script ships in-phase, delivered as a small script/endpoint in the codebase.
- D-13: Migration takes every existing substrate-host owner's key material as input (feasible because both live instances have small, known user populations and Ashley has all the credentials).
- D-14: Per-host migration: unwrap credential using the owner's key material → re-wrap with CSKEK → update record. Atomic per host.
- D-15: Migration script is retired after ship.

**Test coverage**
- D-16: Unit tests for the CSKEK wrap/unwrap swap at host-create and host-update paths.
- D-17: Integration test for the startup pass (server-context orchestrator boots, walks substrate hosts, marks successful ones done, leaves failures for retry).
- D-18: Integration test for the on-add trigger (host-create with `runsFleetSubstrate:true` fires the sweep fire-and-forget; create response doesn't block).
- D-19: Migration script has its own test using a fixture database with per-user-DEK-wrapped credentials → runs migration → verifies CSKEK-wrapped output + working decrypt.

### Claude's Discretion
- Exact value of N (consecutive-failures threshold before the loud alert) — planner picks a defensible small number, likely 3-5.
- Exact shape of the server-context orchestrator (new module vs. extending starter.ts vs. new subscriptionless variant) — planner decides based on how cleanly the existing code decomposes.
- Migration invocation surface (CLI script vs. admin endpoint vs. one-shot node command) — planner picks whichever fits Skynet's existing operational patterns cleanest.
- Log-tag naming for the new operations (following the existing `fleet_substrate_*` convention).

### Deferred Ideas (OUT OF SCOPE)
- Substrate-flag-toggle-off (going from substrate to non-substrate on an existing host).
- Extension of the CSKEK model to future classes of hosts beyond substrate.
- Periodic mid-uptime sweeps for substrate updates.
- UI affordance for triggering the install pass manually.
- Full history of past install-pass runs recorded in the DB.
- Parallelized startup pass.
- Fleet-wide system-key wrap (drop per-user DEK for everything).
</user_constraints>

---

## Summary

This phase replaces the browser-session-gated fleet-substrate install pass with a system-driven one. Today, substrate distribution is welded to `ssh-poll-orchestrator.ts:2087-2152`, which only runs when a browser is subscribed to fleet-status AND that browser's user can decrypt the host credentials. The work has three load-bearing parts:

**Part 1 — New server-context orchestrator** (`src/backend/distributor/server-substrate-orchestrator.ts`). A standalone module that starts at container boot (wired in `starter.ts` directly, before the subscription-registry lifecycle), walks every `runsFleetSubstrate:true` host serially, retries failures on a 30s tick, tracks consecutive failures per host, and emits a loud structured-log alert at N failures. Its SSH credential path reads through CSKEK (not per-user DEK). The existing sweep-hook block at orchestrator lines 2087-2152 is deleted in the same wave.

**Part 2 — Credential model change** in `host.ts` (POST create, PUT update) and `host-resolver.ts` (decrypt path for browser terminal). When a host has `runsFleetSubstrate:true`, the credential is stored wrapped with CSKEK only — no per-user DEK wrap. The system reads through `systemPassword`/`systemKey`/`systemKeyPassword` columns (already in the schema and already populated by `SimpleDBOps.insert/update` via `DataCrypto.encryptRecordWithSystemKey`). The substrate-host path for browser terminal connect also routes through CSKEK.

**Part 3 — One-shot migration script** that accepts per-user key material, walks every `runsFleetSubstrate:true` host, decrypts using the provided owner's password-derived DEK, re-encrypts the `sshCredentials` record's `systemPassword`/`systemKey`/`systemKeyPassword` columns, and flushes with `DatabaseSaveTrigger.forceSave`. The existing `CredentialSystemEncryptionMigration` class is the direct model.

**Primary recommendation:** Build the server-context orchestrator as a new standalone module (`src/backend/distributor/server-substrate-orchestrator.ts`) started directly from `starter.ts`'s boot IIFE — independent of the subscription-registry hooks. This is the cleanest decomposition: zero coupling to fleet-status browser lifecycle, new module is easily unit-tested with injected deps, and the planner can assign it a separate plan wave from the credential changes.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Startup pass orchestration | API / Backend | — | Container-boot-driven; no browser required |
| Per-host sweep (catalog walk) | API / Backend | — | Reuses existing `runSweepForHost` composer; no change |
| On-add trigger | API / Backend | — | Fires from POST /host/db/host after commit |
| Retry cadence (30s tick) | API / Backend | — | `setInterval` inside server-context orchestrator |
| Consecutive-failure alerting | API / Backend | — | In-memory counter inside the orchestrator |
| Credential wrap-at-store | API / Backend | Database / Storage | Happens in host.ts handlers before `SimpleDBOps.insert/update` |
| Credential decrypt for browser terminal | API / Backend | — | `host-resolver.ts` decrypt path, routes through CSKEK for substrate hosts |
| One-shot migration | API / Backend | Database / Storage | Script writes sshCredentials rows, calls `DatabaseSaveTrigger.forceSave` |
| DB schema | Database / Storage | — | No schema change needed — `system_password`/`system_key`/`system_key_password` columns already exist in `sshCredentials` |

---

## Standard Stack

No new external packages needed. All required infrastructure already exists in the codebase.

### Core (All Existing, Verified In-Codebase)

| Library / Module | Version | Purpose | Notes |
|---------|---------|---------|--------------|
| `SystemCrypto.getCredentialSharingKey()` | system-crypto.ts:238 | Returns CSKEK Buffer for CSKEK wrap/unwrap | Auto-generates and persists CSKEK to `./db/data/.env` on first call; loaded from `CREDENTIAL_SHARING_KEY` env var. Never throws if the env is set — always resolves. [VERIFIED: codebase] |
| `DataCrypto.encryptRecordWithSystemKey()` | data-crypto.ts:477 | Encrypts password/key/keyPassword fields with system key into systemPassword/systemKey/systemKeyPassword | Already called by `SimpleDBOps.insert` and `SimpleDBOps.update` for tableName `ssh_credentials`. [VERIFIED: codebase] |
| `FieldCrypto.encryptField()` / `decryptField()` | field-crypto.ts | Field-level AES-GCM encrypt/decrypt | Already used by the existing migration. [VERIFIED: codebase] |
| `runSweepForHost()` | distributor/run-sweep.ts:87 | Per-host sweep composer, never-reject contract | Reuse unchanged. Takes `SshChannel`, host id/name, catalog, deps. [VERIFIED: codebase] |
| `FLEET_SUBSTRATE_CATALOG` | distributor/catalog.ts | Item catalog with per-item idempotence checks | Reuse unchanged. [VERIFIED: codebase] |
| `bundledReaderFromDisk` | ssh-poll-orchestrator.ts:2123 | Reads bundled substrate bytes from container fs | Import and reuse in the new orchestrator. [VERIFIED: codebase] |
| `connectOneShot()` | ssh/ssh-one-shot.ts | Opens an ssh2 Client connection | The new orchestrator needs its own SSH connections independent of the fleet-status pool. [VERIFIED: codebase] |
| `execCommand()` | ssh/tmux-helper.ts | Executes a command on an ssh2 Client | Used to build the `SshChannel` adapter. [VERIFIED: codebase] |
| `makeSemaphore()` | starter.ts:102 | 8-exec-channel cap per SSH connection | The new orchestrator's channel adapter wraps `execCommand` in the same semaphore pattern. [VERIFIED: codebase] |
| `DatabaseSaveTrigger.forceSave()` | utils/database-save-trigger.ts:62 | Immediate encrypted-SQLite flush | MUST be called after any direct credential writes in the migration script. [VERIFIED: codebase] |
| `DataCrypto.getUserDataKey()` | data-crypto.ts | Returns user's in-memory DEK (null if not logged in) | NOT usable in the server-context path — only available after browser login. This is why the per-user-DEK model is the problem. [VERIFIED: codebase] |
| `UserCrypto.deriveKeyFromPassword()` | user-crypto.ts | PBKDF2-derive a DEK from password+salt | Used by the migration script to derive the owner's key material from a provided password. [VERIFIED: codebase — confirmed class exists; derive method needs codebase check before plan] |

### No New Packages

This phase does not install any external packages. The Package Legitimacy Audit section is omitted — not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Container boot
     │
     ▼
starter.ts boot IIFE
     │
     ├── (existing) subscription-registry wires fleet-status orchestrator
     │              (lifecycle: 0→1 browser subscriber → start; 1→0 → stop)
     │
     └── (NEW) server-substrate-orchestrator.start() ← called directly, no subscription gate
                    │
                    ▼
          Enumerate all runsFleetSubstrate=true hosts from DB
          (direct Drizzle query — no user session needed)
                    │
                    ▼ serial
          for each host:
            acquireChannel → runSweepForHost → mark done OR increment failCount
                    │
                    ▼ success
            sweepedThisInstance.add(host.id)
                    │
                    ▼ failure (N consecutive)
            emit fleet_substrate_host_persistent_failure log (once per uptime)
                    │
                    ▼
          setInterval(30s): re-enumerate hosts, retry un-done ones
                    │
                    ▼ SIGTERM
          orchestrator.stop() — close ssh2 clients, clear Sets

POST /host/db/host
     │  host created with runsFleetSubstrate:true
     │
     ├── credential stored with CSKEK wrap (D-08)
     │
     └── queueMicrotask(async () => runSweepForHost(newHost)) ← fire-and-forget (D-02)

Browser terminal → substrate host
     │
     └── host-resolver.ts: if runsFleetSubstrate → decrypt from systemPassword/systemKey (CSKEK path)
                                                   (instead of per-user DEK path)

Operator runs migration script
     │
     ├── accepts: [{userId, password}, ...] (or reads from stdin JSON)
     ├── for each substrate host: decrypt with owner DEK → re-wrap with CSKEK
     └── DatabaseSaveTrigger.forceSave("substrate-cred-migration")
```

### Recommended Project Structure

```
src/backend/distributor/
├── server-substrate-orchestrator.ts   ← NEW: server-context orchestrator
├── server-substrate-orchestrator.test.ts  ← NEW: tests D-17, D-18
├── run-sweep.ts                       (unchanged)
├── run-bootstrap.ts                   (unchanged)
├── catalog.ts                         (unchanged)
├── log-tags.ts                        (+ new logPersistentFailure fn for D-06)
└── ssh-push.ts                        (unchanged)

src/backend/utils/
└── substrate-credential-migration.ts  ← NEW: migration script logic (+ .test.ts for D-19)

src/backend/fleet-status/
└── ssh-poll-orchestrator.ts           (delete lines 2087-2152 + state at 829/833 + clear at 2309-2310)

src/backend/database/routes/
└── host.ts                            (D-08 wrap-at-store at create + update paths)

src/backend/ssh/
└── host-resolver.ts                   (D-09 CSKEK decrypt path for substrate hosts)
```

---

## Key Code Patterns — Verified

### Pattern 1: Server-context orchestrator lifecycle (how starter.ts must wire it)

[VERIFIED: starter.ts:167–682] The boot IIFE is guarded by `process.env.VITEST !== "true"`. The fleet-status orchestrator is started inside `registry.onFirstSubscriber`. The new server-context orchestrator must be started OUTSIDE that callback — directly in the boot IIFE sequence after database is ready. Recommended placement: immediately after the fleet-status block closes (after the `registry.onLastUnsubscriber` wiring at line ~672). The boot IIFE already handles `SIGTERM` not explicitly but through process-level shutdown.

```typescript
// Pattern: boot-IIFE direct start (analogous to how other servers are started)
const { createServerSubstrateOrchestrator } = await import(
  "./distributor/server-substrate-orchestrator.js"
);
const substrateOrch = createServerSubstrateOrchestrator({
  listSubstrateHosts,      // DB query returning runsFleetSubstrate=true hosts with CSKEK-decrypted creds
  acquireChannel,          // connectOneShot + execCommand + makeSemaphore(8) — same pattern as fleet-status
  releaseChannel,
  runSweep: runSweepForHost,
  catalog: FLEET_SUBSTRATE_CATALOG,
  readBundledBytes: bundledReaderFromDisk,
  setInterval, clearInterval,
  retryIntervalMs: 30000,
  persistentFailureThreshold: 3,  // planner picks N
  now: () => Date.now(),
});
await substrateOrch.start();  // runs startup pass, then sets interval
// On SIGTERM: substrateOrch.stop()
```

### Pattern 2: Host enumeration without a user session

[VERIFIED: starter.ts:378–442] Today, `listIdentityHostingHosts()` requires `currentSubscriberUserId` because it calls `resolveHostById(row.id, userId)` to decrypt credentials. For the new server-context path, substrate hosts must be enumerable WITHOUT a user session.

The new `listSubstrateHosts()` function must:
1. Direct Drizzle query: `db.select().from(hosts).where(and(eq(hosts.enableSsh, true), eq(hosts.runsFleetSubstrate, true)))`
2. For each host, retrieve the `sshCredentials` record and decrypt using CSKEK (not user DEK) — reading `systemPassword`, `systemKey`, `systemKeyPassword` columns directly.

This is the key decoupling: the server-context path never calls `DataCrypto.getUserDataKey()` or `DataCrypto.decryptRecord()` with a userId. It calls `FieldCrypto.decryptField(ciphertext, CSKEK, recordId, fieldName)` directly on the `system_*` columns.

### Pattern 3: Fire-and-forget from POST /host/db/host (D-02)

[VERIFIED: host.ts:389–436] After `SimpleDBOps.insert()` returns and `res.json(resolvedHost)` has been called, add the fire-and-forget sweep:

```typescript
// After res.json(resolvedHost):
if (effectiveRunsFleetSubstrate && effectiveConnectionType === "ssh") {
  queueMicrotask(async () => {
    try {
      // acquires its own fresh SSH channel; does not block response
      await substrateOrch.sweepOneHost({ id: String(createdHost.id), name: effectiveName });
    } catch {
      // never-throw contract — defense-in-depth only
    }
  });
}
```

The `substrateOrch` reference must be made available to the host route — either via a module-level singleton (simplest) or dependency injection through the router factory. Module-level singleton is the existing pattern in Skynet (see `authManager`, `permissionManager` at host.ts:78-81).

### Pattern 4: Credential wrap-at-store branch (D-08)

[VERIFIED: simple-db-ops.ts:14-55] `SimpleDBOps.insert()` already calls `DataCrypto.encryptRecordWithSystemKey()` for tableName `ssh_credentials`. This means the `system_*` columns are already populated for EVERY `sshCredentials` record insert via SimpleDBOps. The `sshCredentials` table (NOT the `hosts` table) is where per-host SSH credentials live when `credentialId` is non-null on a host record.

IMPORTANT FINDING: The credentials are in TWO places depending on how the host was created:
1. **Inline in `hosts` table** — when credentials are stored directly on the host row (password/key/keyPassword columns on the `hosts` table). These are encrypted with user DEK via `SimpleDBOps.insert(hosts, "ssh_data", ...)`.
2. **In `sshCredentials` table** — when a named credential is used (`credentialId` on the host). These are encrypted with BOTH user DEK AND CSKEK (SimpleDBOps already does both for `ssh_credentials`).

The D-08 credential-model change has different implications depending on auth type:
- **`credentialId`-based hosts**: The `sshCredentials` record already has CSKEK columns. The decrypt path just needs to read `systemPassword`/`systemKey`/`systemKeyPassword` instead of the user-DEK-encrypted `password`/`key`/`keyPassword`.
- **Inline credential hosts** (password/key stored directly on `hosts` row): These are in `ssh_data` tableName scope. `SimpleDBOps.insert(hosts, "ssh_data", ...)` calls `DataCrypto.encryptRecord("ssh_data", ...)` with user DEK but does NOT currently call `encryptRecordWithSystemKey` for `ssh_data`. This path DOES need a change — the host row's inline credentials need a system-key encrypted copy added, OR the plan forces all substrate hosts to use `credentialId`-based auth.

This is a critical fork point the planner must address explicitly.

### Pattern 5: CSKEK decrypt path for browser terminal (D-09)

[VERIFIED: host-resolver.ts:75-199] Current decrypt flow for credentialId-based hosts: `SimpleDBOps.select(..., "ssh_credentials", ownerId)` which calls `DataCrypto.decryptRecord("ssh_credentials", cred, ownerId, userDataKey)` — requires the owner's userDataKey to be loaded in memory (only true if owner is logged in).

For D-09 (substrate hosts, owner browser terminal), the path needs to check `runsFleetSubstrate` on the host record and branch: if true, decrypt from `systemPassword`/`systemKey`/`systemKeyPassword` using CSKEK. This avoids the `userDataKey` requirement entirely.

### Pattern 6: `DatabaseSaveTrigger.forceSave` — canonical usage

[VERIFIED: host-autostart-routes.ts:173-181, database-save-trigger.ts:62] The forceSave pattern:
```typescript
try {
  await DatabaseSaveTrigger.forceSave("substrate-cred-migration");
} catch (saveError) {
  systemLogger.warn("Database save failed", {
    operation: "substrate_migration_db_save_failed",
    error: saveError instanceof Error ? saveError.message : "Unknown error",
  });
  // log-and-swallow; migration itself may have succeeded
}
```

### Pattern 7: CredentialSystemEncryptionMigration — template for migration script

[VERIFIED: credential-system-encryption-migration.ts:1-136] The existing migration:
- Takes `userId` (requires user to be logged in to get their DEK via `DataCrypto.getUserDataKey(userId)`)
- Queries `sshCredentials` for that user where system columns are null
- Decrypts with user DEK, re-encrypts with CSKEK, updates record

The Phase 75 migration script mirrors this shape but:
- Accepts user passwords as external input (not session-derived)
- Uses `UserCrypto` to derive the DEK from `{userId, password}` pair (same PBKDF2 derivation that login uses)
- Narrows to only `runsFleetSubstrate:true` hosts (not all sshCredentials)
- Does NOT require the user to be logged in — fully operator-driven

### Pattern 8: Once-per-host-per-Skynet-lifetime Set gating

[VERIFIED: ssh-poll-orchestrator.ts:822-833, 2087-2152] The exact pattern to replicate in the new orchestrator:
```typescript
const sweepedThisInstance = new Set<string>();
const sweepInFlight = new Set<string>();

// Gate: only run if not already done AND no sweep in flight
if (!sweepedThisInstance.has(host.id) && !sweepInFlight.has(host.id)) {
  sweepInFlight.add(host.id);
  queueMicrotask(async () => {
    try {
      const result = await runSweepForHost(channel, host, FLEET_SUBSTRATE_CATALOG, deps);
      if ((result?.itemsFailed ?? 0) === 0) {
        sweepedThisInstance.add(host.id);
        consecutiveFailures.delete(host.id);  // reset on success
        persistentAlertFired.delete(host.id); // reset on success (re-alert on next N failures)
      } else {
        // Failure handling: D-06/D-07
        const n = (consecutiveFailures.get(host.id) ?? 0) + 1;
        consecutiveFailures.set(host.id, n);
        if (n >= PERSISTENT_FAILURE_THRESHOLD && !persistentAlertFired.has(host.id)) {
          persistentAlertFired.add(host.id);
          logPersistentFailure({ fleetHostId: host.id, hostName: host.name, consecutiveFailures: n });
        }
      }
    } finally {
      sweepInFlight.delete(host.id);
    }
  });
}
```

### Pattern 9: Log-tag extension (D-06)

[VERIFIED: distributor/log-tags.ts:100-143] Existing log functions follow a consistent shape: named export, systemLogger.warn/info call, structured `{ operation: "fleet_substrate_*", ...payload }`. New function to add:

```typescript
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

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-field AES-GCM encrypt/decrypt | Custom crypto | `FieldCrypto.encryptField()` / `decryptField()` | Already battle-tested, handles IV+tag, consistent record-id binding |
| CSKEK lookup | Custom env-var read | `SystemCrypto.getInstance().getCredentialSharingKey()` | Auto-generates + persists if missing; handles both env-var and file paths |
| SSH connection management | New SSH pool | `connectOneShot()` + `execCommand()` + `makeSemaphore(8)` | Semaphore respects MaxSessions=10 (wilma incident fix) |
| Sweep execution | New sweep logic | `runSweepForHost()` | Never-reject contract, per-item retry, all log tags already wired |
| DB writes + persistence | Raw `db.update().run()` without save | `DatabaseSaveTrigger.forceSave()` after write | In-memory SQLite: writes disappear on crash unless explicitly flushed |
| PBKDF2 key derivation | Custom password→key | `UserCrypto` PBKDF2 path | Matches the exact derivation parameters (100000 iterations, 32-byte DEK) used by login |

---

## Critical Finding: Credential Storage Split (Inline vs. credentialId)

[VERIFIED: host.ts:329-384, schema.ts:130-190, simple-db-ops.ts:14-55]

Substrate host credentials live in one of two places:

**Case A — `sshCredentials` table** (when `credentialId` is non-null on the `hosts` row):
- Already has both per-user DEK columns (`password`, `key`, `keyPassword`) AND CSKEK columns (`systemPassword`, `systemKey`, `systemKeyPassword`)
- `SimpleDBOps.insert/update` for `ssh_credentials` tableName already writes both sets
- D-08 decrypt change: read from `system_*` columns instead of user-DEK columns when `runsFleetSubstrate:true`
- Migration: re-wrap `system_*` columns (they may have been written when CSKEK wasn't intended for substrate use)

**Case B — inline on `hosts` table** (when `password`/`key`/`keyPassword` stored directly on the host row):
- Encrypted with user DEK via `DataCrypto.encryptRecord("ssh_data", ...)` in `SimpleDBOps.insert(hosts, "ssh_data", ...)`
- `ssh_data` tableName does NOT trigger `encryptRecordWithSystemKey` — this path has NO CSKEK columns
- The `hosts` table has no `system_password`/`system_key` columns in schema.ts
- **This is the hard case for D-08**: inline credentials require either (a) adding CSKEK columns to the `hosts` table, or (b) requiring substrate hosts to always use credentialId-based auth

**Planner must resolve:** Whether to enforce that substrate hosts must use a named credential (credentialId), and reject inline-credential host creates with `runsFleetSubstrate:true`. This is likely the right call — it avoids adding CSKEK columns to the `hosts` table and is enforced at the API boundary. The existing code at `host.ts:239-247` shows the `effectiveRunsFleetSubstrate` default logic; a validation check can be added there.

---

## Common Pitfalls

### Pitfall 1: Deriving user DEK in the server-context path
**What goes wrong:** The new orchestrator or migration script calls `DataCrypto.getUserDataKey(userId)` expecting to get the user's key for credential decryption, gets `null`, and silently skips all hosts.
**Why it happens:** `getUserDataKey()` returns `null` if the user hasn't logged in during this process run — which is always true for a server-context path.
**How to avoid:** The server-context orchestrator MUST use CSKEK (from `SystemCrypto.getCredentialSharingKey()`) for all credential decryption. The migration script derives the DEK via PBKDF2 from a provided password, never via `getUserDataKey()`.

### Pitfall 2: Forgetting `DatabaseSaveTrigger.forceSave` after migration writes
**What goes wrong:** Migration updates credential rows in the in-memory SQLite, the script reports success, but the encrypted file on disk is never updated. Next container restart loses the migration.
**Why it happens:** Skynet's primary data store is in-memory SQLite — writes go to RAM, not disk, until explicitly flushed.
**How to avoid:** Call `DatabaseSaveTrigger.forceSave("substrate-cred-migration")` after every batch of updates. Wrap in try/catch; log-and-swallow the error but do not count it as a migration failure.

### Pitfall 3: Starting the server-context orchestrator before the DB is ready
**What goes wrong:** The orchestrator's `listSubstrateHosts()` runs before `initializeDatabaseAsync()` completes, throws on an uninitialized DB handle.
**Why it happens:** `starter.ts` initializes the DB asynchronously; the boot IIFE runs several `await import(...)` steps before the DB is usable.
**How to avoid:** Wire the new orchestrator start AFTER `await (dbServer as ...).serverReady` (line ~302 in starter.ts). The fleet-status block already follows this ordering — the new orchestrator must be placed after the same gate.

### Pitfall 4: Concurrent double-sweep on the same host from startup pass + on-add trigger
**What goes wrong:** A host is created at exactly the same moment the startup pass runs; the on-add fire-and-forget and the startup-pass loop both call `runSweepForHost` on the same host concurrently.
**Why it happens:** The startup pass iterates serially but the on-add trigger uses `queueMicrotask` to decouple from the HTTP response — both can be in flight simultaneously.
**How to avoid:** The `sweepInFlight` Set blocks the second entry for the same `host.id`. The on-add trigger's `queueMicrotask` wrapper must check `sweepInFlight` before firing, same as the orchestrator's main loop.

### Pitfall 5: Inline credential substrate hosts (see Critical Finding above)
**What goes wrong:** A substrate host with inline credentials (no credentialId) can't have CSKEK decryption applied because there are no `system_*` columns on the `hosts` table.
**Why it happens:** The `sshCredentials` table has CSKEK columns; the `hosts` table does not.
**How to avoid:** Enforce at the API layer (host.ts create/update) that `runsFleetSubstrate:true` is only valid when `credentialId` is set. Return a 400 if attempted with inline credentials.

### Pitfall 6: Removing sweep hook before server-context orchestrator is wired
**What goes wrong:** The sweep hook at lines 2087-2152 is deleted in an early wave before the server-context orchestrator is wired in starter.ts. Substrate hosts get no sweeps at all during that deployment window.
**Why it happens:** Multi-wave plans that delete the old code before shipping the new code.
**How to avoid:** The deletion wave (D-04 removal) must come AFTER the server-context orchestrator is confirmed working. The planner should order these in the same wave or explicitly after.

### Pitfall 7: `sweepedThisInstance` not reset on persistent-failure-then-success
**What goes wrong:** A host fails N times (alert fires). Then it succeeds. The `sweepedThisInstance` marks it done. Next restart, it tries again. But `persistentAlertFired` was never reset, so the next N failures don't alert.
**Why it happens:** The alert-fired Set mirrors the lifetime of `sweepedThisInstance`, but success resets `sweepedThisInstance` on next container restart while `persistentAlertFired` would persist.
**How to avoid:** Reset `persistentAlertFired.delete(host.id)` (and `consecutiveFailures.delete(host.id)`) on a successful sweep, matching the same lifecycle as `sweepedThisInstance`.

---

## Removal Target — What Disappears

[VERIFIED: ssh-poll-orchestrator.ts:822-833, 2087-2152, 2305-2310]

Exact lines to delete from `ssh-poll-orchestrator.ts`:

1. **Lines 822-833** — `sweepedThisInstance` and `sweepInFlight` Set declarations and their comments
2. **Lines 2087-2152** — The entire fleet-substrate sweep hook block (Phase 72 Plan 04 comment through the closing brace)
3. **Lines 2305-2310** — `sweepedThisInstance.clear()` and `sweepInFlight.clear()` in the `.stop()` method

Also remove the import of `runSweepForHost` from `"../distributor/run-sweep.js"` at the top of `ssh-poll-orchestrator.ts` if it's only used by the removed block (verify there are no other callers first).

**Cross-wiring to verify before deleting:** The `subscription-registry.ts` `onFirstSubscriber`/`onLastUnsubscriber` hooks do NOT directly reference the sweep hook — they only start/stop the orchestrator. The sweep hook is self-contained inside the orchestrator's `tryAcquireHostChannel` / `pollAllHosts` flow. No external wiring to clean up beyond the orchestrator itself.

---

## Migration Script Shape

[VERIFIED: credential-system-encryption-migration.ts, user-crypto.ts]

**Invocation surface (planner's discretion):** The cleanest fit for Skynet's operational patterns is a standalone TypeScript script runnable via `npx tsx src/backend/utils/substrate-credential-migration.ts` from inside the container. This mirrors how other one-shot migrations work (see database/db/index.ts boot migrations). The script reads input from stdin as JSON (`[{userId, password}, ...]`) and prints progress to stdout.

**What the migration script must do:**
```
1. Load DB from disk (decrypt with DATABASE_KEY env var)
2. Load CSKEK from CREDENTIAL_SHARING_KEY env var
3. Read input: [{userId: string, password: string}] from stdin (or args)
4. For each {userId, password}:
   a. Derive DEK: UserCrypto PBKDF2 path (same as login)
   b. Query: hosts JOIN sshCredentials WHERE runs_fleet_substrate=true AND sshCredentials.userId=userId
   c. For each credential record:
      - Decrypt password/key/keyPassword with user DEK
      - Re-encrypt into systemPassword/systemKey/systemKeyPassword with CSKEK
      - Update the sshCredentials row
   d. DatabaseSaveTrigger.forceSave("substrate-migration-userId")
5. Print summary: {migrated, failed, skipped} per user
```

**Atomicity per host (D-14):** The update is a single `db.update(sshCredentials).set({...}).where(eq(...))`. If it throws, the host is left unchanged. Log the failure and continue to next host.

---

## Test Infrastructure — What Exists

[VERIFIED: src/backend/distributor/*.test.ts, src/backend/fleet-status/ssh-poll-orchestrator.test.ts]

**Existing test files the planner must reuse patterns from:**

- `distributor/run-sweep.test.ts` — Uses `vi.mock("./log-tags.js")`, `vi.mock("./run-bootstrap.js")`, `SshChannel` mock with command-dispatching handler. New orchestrator tests follow this exact pattern.
- `distributor/run-bootstrap.test.ts` — Uses `makeChannel(handlers)` helper with command-substring matching. Reliable pattern for testing channel-dependent behavior.
- `fleet-status/ssh-poll-orchestrator.test.ts` — Uses `vi.useFakeTimers()`, `vi.fn()` for all deps, `createSshPollOrchestrator`. The new `createServerSubstrateOrchestrator` should be a factory with the same dep-injection shape, enabling identical test patterns.
- `vi.mock("../utils/logger.js")` — Suppresses log output in tests. Every new test file should mock this.

**What tests need (D-16 to D-19):**
- D-16: Unit tests for credential wrap in host.ts create/update — need `vi.mock("../../utils/system-crypto.js")` to inject a test CSKEK, verify `FieldCrypto.encryptField` was called with it.
- D-17: Integration test for startup pass — factory test with fake host list returning 2 substrate hosts, fake `runSweepForHost`, verify both hosts swept, verify `sweepedThisInstance` populated on success, failures leave host un-marked.
- D-18: Integration test for on-add trigger — call host.ts POST handler in test, verify `runSweepForHost` was called exactly once fire-and-forget, verify response returned before sweep resolved.
- D-19: Migration script test — fixture DB with per-user-DEK-only credentials, run migration with test user+password, verify `systemPassword`/`systemKey` columns populated and decryptable with test CSKEK.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no new auth surfaces) |
| V3 Session Management | no | — (no session changes) |
| V4 Access Control | no | — (access control paths unchanged) |
| V5 Input Validation | yes | Migration script validates user input ({userId, password} shape); host.ts already validates runsFleetSubstrate as boolean |
| V6 Cryptography | **yes** | `FieldCrypto.encryptField`/`decryptField` (AES-GCM, never hand-rolled) |
| V7 Error Handling | yes | Never-throw contracts throughout; sweep errors contained |
| V8 Data Protection | **yes** | CSKEK is the load-bearing new key — see threat model below |

### Threat Model

**This phase's deliberate security-posture change:**

The "credentials require the owner to be present to decrypt" property is relaxed for substrate-flagged hosts. The planner's threat_model block must reflect:

| Threat | Before Phase 75 | After Phase 75 | Net Change |
|--------|----------------|----------------|------------|
| Disk theft of encrypted DB | Attacker needs user's password to decrypt substrate host credentials | Attacker needs `CREDENTIAL_SHARING_KEY` env var (same bar as server root access) | Equivalent — CSKEK lives in the same `.env` file as DATABASE_KEY which they'd need anyway |
| Session-hijack of browser session | Stealing session gives access to host creds (via user DEK in memory) | Stealing session still gives access (CSKEK stored in server memory) | Unchanged — server memory compromise was always sufficient |
| Substrate host cred recovery without user present | Impossible — required user session | Possible with CSKEK (by design — that's the point of this phase) | Intentional relaxation, scoped to substrate hosts only |
| Non-substrate host cred exposure | N/A | Unchanged — non-substrate hosts still require user DEK | No change (D-10 scope boundary holds) |
| Migration script key material handling | N/A | Migration accepts plaintext passwords via stdin; these must not be logged or written to disk | New risk: migration script must be careful about stdin handling, never print passwords in logs |

**Key security invariants the planner must preserve:**
1. `CREDENTIAL_SHARING_KEY` must never be logged at any log level.
2. Migration script stdin (containing plaintext passwords) must not be echoed to stdout/logs.
3. The D-10 scope boundary (non-substrate hosts unchanged) must be enforced at the credential decrypt path — the `runsFleetSubstrate` branch must be an explicit check, not a default.
4. The `listSubstrateHosts()` function must only expose CSKEK-decrypted credentials to the substrate orchestrator — not to any HTTP response path.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `CREDENTIAL_SHARING_KEY` env var | CSKEK path | ✓ (auto-generated on first boot if absent) | — | SystemCrypto auto-generates and persists to .env |
| `better-sqlite3` | DB access in migration script | ✓ | Already in package.json | — |
| `tsx` or compiled JS | Running migration script | Check build output | — | Run via compiled JS in Docker container |

---

## Open Questions (RESOLVED)

All three open questions raised at research time have been resolved during planning. Resolutions are recorded here for traceability; the phase plans referenced below implement each resolution.

1. **Inline-credential substrate hosts (the critical fork)** — **RESOLVED**
   - What we knew: `hosts` table has no CSKEK columns; `sshCredentials` table has them; `SimpleDBOps` already writes CSKEK for `ssh_credentials` tableName.
   - What was unclear: Whether any existing `runsFleetSubstrate:true` hosts on the live instances use inline credentials (no credentialId).
   - **Resolution**: Two-layer defense. **Plan 75-04** installs an API-layer 400 guard on POST /host/db/host and PUT /host/db/host/:id that rejects any create/update setting `runsFleetSubstrate=true` with `credentialId=null` — this prevents NEW inline-credential substrate hosts from being written. **Plan 75-08 Task 2** implements a pre-check in the migration module that queries for `runsFleetSubstrate=true AND credentialId IS NULL` before any writes; if any PRE-EXISTING inline-credential substrate hosts are found (rows that predate the 75-04 guard), the migration aborts loudly with the offending host IDs surfaced via `substrate_migration_precheck_aborted` operation tag, exit code 1, and `aborted: true` in the result JSON. Ashley must resolve any flagged rows manually before re-running the migration.

2. **Migration script: password derivation internals** — **RESOLVED**
   - What we knew: `UserCrypto.setupUserEncryption(userId, password)` uses PBKDF2 with 100k iterations. The salt is stored in the `settings` table keyed to `userId`.
   - What was unclear: The exact exported method on `UserCrypto` that derives a key from (userId, password, salt) for external use — the `migrateUserCredentials` path calls `DataCrypto.getUserDataKey()` which requires an in-memory session. The migration needs a sessionless derivation path.
   - **Resolution**: **Plan 75-08 Task 1** adds a new public instance method `UserCrypto.deriveDekForMigration(userId, password): Promise<Buffer>`. Verification of the private-method chain during planning confirmed all four required internals are reachable via `this.*` from a new public method on the same class: `getKEKSalt` at user-crypto.ts:566-582, `deriveKEK` at user-crypto.ts:493-501, `getEncryptedDEK` at user-crypto.ts:606-622, `decryptDEK` at user-crypto.ts:533-545. No refactor of the existing private surface is required. The new method mirrors `authenticateUser` (user-crypto.ts:114-165) lines 119-140 but skips the `userSessions.set` step (lines 149-152) so the derivation is sessionless. The returned Buffer is caller-owned and the migration module zeroes it in a `finally` block.

3. **`bundledReaderFromDisk` location** — **RESOLVED**
   - What we knew: It's defined inside `ssh-poll-orchestrator.ts` as a local function at line ~2123 (inferred from context).
   - What was unclear: Whether it's exported or needs to be extracted to a shared module for the new orchestrator.
   - **Resolution**: **Plan 75-01 Task 1** (Wave 0) extracts `bundledReaderFromDisk` to `src/backend/distributor/bundled-reader.ts` as a first-class exported function with its own unit test covering the never-throw contract (returns `{bytes, mode}` on success; returns null on ENOENT; returns null on EACCES). The legacy sweep hook at ssh-poll-orchestrator.ts:2117-2124 continues to call the same function via the new import, so both the legacy hook (in the transition window before 75-07 removes it) and the new server-context orchestrator (75-02) share a single canonical implementation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `UserCrypto` has or can expose a sessionless `deriveKeyForMigration(userId, password)` path | Migration script shape | Migration script design needs rework; may require adding a new method to UserCrypto |
| A2 | All existing `runsFleetSubstrate:true` hosts on the live instances use `credentialId`-based auth (not inline) | Critical finding / pitfall 5 | If inline-cred substrate hosts exist, migration is more complex |
| A3 | `bundledReaderFromDisk` is currently a module-scoped const inside `ssh-poll-orchestrator.ts` (not exported) | Removal target section | If already exported, extraction is trivial; if not, it's a Wave 0 extraction task |

---

## Sources

### Primary (HIGH confidence — verified in live codebase)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — sweep hook (2087-2152), state (829-833), stop cleanup (2309-2310), OrchestratorDeps (76-105), IdentityHostingHostRecord (209-212), hostRefreshEveryNTicks cadence (840-843)
- `src/backend/utils/system-crypto.ts` — CSKEK loading (199-243), auto-generate-and-persist pattern (314-332)
- `src/backend/utils/credential-system-encryption-migration.ts` — migration pattern template
- `src/backend/utils/simple-db-ops.ts` — `encryptRecordWithSystemKey` already called for `ssh_credentials` (32-44, 128-139)
- `src/backend/utils/data-crypto.ts` — `encryptRecordWithSystemKey` implementation (477-517)
- `src/backend/database/db/schema.ts` — `runs_fleet_substrate` column (140), `system_password`/`system_key`/`system_key_password` in sshCredentials (284-286)
- `src/backend/database/routes/host.ts` — POST create (101-438), PUT update (745-1060), `resolveHostCredentials` (2035-2110), `effectiveRunsFleetSubstrate` logic (239-247)
- `src/backend/ssh/host-resolver.ts` — credential decrypt path (75-199)
- `src/backend/starter.ts` — boot IIFE structure (168-690), `listIdentityHostingHosts` pattern (378-442), fleet-status orchestrator wiring (314-672)
- `src/backend/fleet-status/subscription-registry.ts` — `onFirstSubscriber`/`onLastUnsubscriber` hooks (60-90)
- `src/backend/distributor/run-sweep.ts` — `runSweepForHost` contract and signature (87-263)
- `src/backend/distributor/log-tags.ts` — existing log-tag functions (100-143)
- `src/backend/utils/database-save-trigger.ts` — `forceSave` API (62-100)
- `src/backend/database/routes/host-autostart-routes.ts` — canonical `forceSave` usage pattern (173-181)
- `src/backend/distributor/run-sweep.test.ts`, `run-bootstrap.test.ts`, `ssh-poll-orchestrator.test.ts` — test patterns for new tests

### Secondary (CONTEXT.md decisions — locked by Ashley)
- `.planning/phases/75-server-side-substrate-bootstrap-startup-driven-install-pass-/75-CONTEXT.md` — all 19 decisions (D-01 through D-19)
- `.planning/shapes/shape-server-side-substrate-bootstrap.md` — scope edges, "what would make it wrong," philosophy

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules verified in live codebase
- Architecture: HIGH — server-context orchestrator pattern is a clean decomposition of the existing fleet-status pattern
- Pitfalls: HIGH — inline-credential fork is a verified structural issue; DB save pitfall is a standing directive; others derived from code inspection
- Migration: MEDIUM — UserCrypto sessionless derivation path needs confirmation before planner specifies exact method call

**Research date:** 2026-09-05
**Valid until:** Stable — this is an implementation-detail-locked phase. Valid until codebase changes in the affected modules.
