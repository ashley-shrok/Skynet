# Phase 39: Fleet-status Gate 2 — Research

**Researched:** 2026-08-13
**Domain:** Backend WS lifecycle + SSH connection orchestration + structured logging
**Confidence:** HIGH (all code paths grepped/read in-tree; no external library docs required)

## Summary

Design is LOCKED (Path C, presence-driven lifecycle). Research maps concrete code surfaces:

1. `SubscriptionRegistry` has NO first-subscriber / last-unsubscriber hooks today. Plan 1 must extend the interface — additive, doesn't disturb the 7 existing tests.
2. `createSshPollOrchestrator` already has a clean `start()` / `stop()` split with idempotent state cleanup. Re-entrancy across start/stop/start cycles works but needs one small fix (the `stopped = false` in `start()` is correct; verify test coverage for a start→stop→start sequence — none currently exists).
3. `fleet-status-server.ts:181` already extracts `userId` from JWT and holds it in the connection-scoped closure. The subscribe path (line 238) has direct access to it. Plumbing `userId` through to the poller is a 3-line change per subscription.
4. The logger bug is 100% localized: `logger.ts:141-155` `formatMessage()` only surfaces 7 whitelisted context fields (`operation`, `userId`, `hostId`, `tunnelName`, `sessionId`, `requestId`, `duration`). The `error` field is passed but silently dropped. Fix at that one function fixes all 13 fleet-status `error: err.message` call sites simultaneously — no per-call-site changes required.
5. `remote-hook-install.ts` has NO ergonomic "is-it-installed?" probe. The install helper is idempotent (readAndMergeStopHookSettings returns `alreadyInstalled: true` on second run) so re-running against every host is safe — but we'd waste an SSH round-trip. Recommend a small `checkStopHookInstalled(channel)` helper (probe `test -x <path>` + `grep -q <path> ~/.claude/settings.json`) that Plan 04 can call before invoking `installStopHook`.
6. Test conventions are dead-standard vitest with hoisted `vi.mock("../utils/logger.js", ...)`. Mock patterns for SSH channels use a `MockSshChannel` class defined inline in each test file (duplicated across `ssh-poll-orchestrator.test.ts:53` and `remote-hook-install.test.ts:48` — Plan 1 could DRY into a test helper, but not required).
7. `hostClients` Map (starter.ts:234) is scoped INSIDE the fleet-status IIFE block. Nothing else in the codebase depends on the SSH-poll orchestrator running at boot. Zero landmines — the current `orchestrator.start()` call at starter.ts:340 is fire-and-forget and can be replaced with lifecycle-hook wiring without affecting any other subsystem.

**Primary recommendation:** Plan into 4 waves — (1) extend `SubscriptionRegistry` with `onFirstSubscriber` / `onLastUnsubscriber` callbacks, (2) rewire `starter.ts` to defer `orchestrator.start()` behind those hooks + swap `listIdentityHostingHosts` to use `resolveHostById(hostId, userId)` per host, (3) fix `logger.ts` formatMessage passthrough for `error` + other structured fields, (4) build a `checkStopHookInstalled` probe + wire into the orchestrator's per-host acquire flow.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Root cause (empirical):** SSH-poll's `listIdentityHostingHosts()` in `src/backend/starter.ts` (~line 232) reads `hostsTable.key`/`.password`/`.keyPassword` fields via raw `db.select({...}).from(hostsTable)`. Returns app-level ciphertext, not plaintext. Passes ciphertext to `connectOneShot`, ssh2 rejects as invalid key. Fix: use `resolveHostById(hostId, userId)` for per-host decrypt (canonical Skynet pattern).

**Path C — presence-driven lifecycle (LOCKED by Ashley 2026-08-13):**
Ashley verbatim: *"nobody needs to know if something is idle or not, or anything else that's going on here, if no user is present to want to know the information."*

- SSH-poll runs **only while at least one browser is connected to the fleet-status WS** (via `/fleet-status/ws`).
- First subscriber → start the poller.
- Last unsubscriber → stop the poller.
- The poller uses the *subscribing user's* authenticated session as the `userId` context for `resolveHostById(hostId, userId)`.

**On the SSH-poll's data-source assumption:** The poller reads `~/.claude/fleet-status/last-stop-payload.json` on each target host. Verify Plan 04's Stop hook (`stop-hook.sh` via `remote-hook-install`) install status per enrolled host + install where missing.

**Logger fix:** `systemLogger.warn("Fleet-status: SSH channel acquire failed", { operation: "fleet_status_host_ssh_unreachable", fleetHostId, error: err.message })` — the structured `error` field is passed but does NOT surface in `console-forward.log`. Fix logger config or specific fleet-status log calls so `error` flows through to both console-forward and `docker logs skynet`.

**Executor scope reminder:** Per box-maintainer standing directive: "subagents (executors) don't do deploys — the orchestrator does." Plan MUST NOT include a "ship" task at executor scope.

**No worktrees:** Per fleet rule: NO `isolation: "worktree"` on any Agent spawn. All work happens in the main tree at `~/skynet-tanya` on `feat/tab-title-from-tmux`.

### Claude's Discretion

- **Multi-user shape** (single-user box today, but user-scoped by design). Recommendation from CONTEXT.md line 66: "one *unified* poller keyed by the union of hosts across all subscribed users, with per-host decrypt using the host's own owner userId." Ashley has not spoken to this specifically; planner picks the cleanest shape.
- **Test shape**: Unit tests for lifecycle hooks + decrypt path. Integration test optional.

### Deferred Ideas (OUT OF SCOPE)

- Per-user poller instances (single-user box).
- TTL cache on decrypted host records.
- Any change to `PrettyConversationsPanel` / `WipBubble` / `WaitingBubble` / store consumers.
- Formalizing "adding an nginx routing block for a new in-container service is part of the phase deliverable" as a project rule (banked in patch #439 follow-ups).
- Any change to the composite `isWorking` formula.
- Multi-user / per-user isolation beyond single-user reality on this box.
- Any change to fleet-status wire protocol, `SessionState` shape, or subscription registry semantics beyond wiring lifecycle hooks.
- Any change to `session-working-store.ts` / `session-waiting-store.ts` client-side stores.

## Phase Requirements

Phase 39 has no formal REQ-XX IDs in `.planning/REQUIREMENTS.md` (this is a bounty-driven bugfix phase). Requirements derive from CONTEXT's LOCKED decisions:

| ID (local) | Description | Research Support |
|------------|-------------|------------------|
| GATE2-01 | SSH-poll orchestrator starts on first fleet-status WS subscriber | § Q1 (SubscriptionRegistry extension), § Q2 (start/stop split) |
| GATE2-02 | SSH-poll orchestrator stops on last unsubscriber | § Q1 (SubscriptionRegistry extension), § Q2 (start/stop split) |
| GATE2-03 | Per-host decrypt uses `resolveHostById(hostId, userId)` with the subscribing user's session | § Q3 (auth threading), § Canonical pattern in sessions.ts:70 |
| GATE2-04 | Structured `error` field surfaces in `console-forward.log` + `docker logs skynet` | § Q4 (logger fix) |
| GATE2-05 | Stop-hook install verified per enrolled host + installed where missing | § Q5 (probe design) |
| GATE2-06 | No `fleet_status_host_ssh_unreachable` events during a browser session (regression signal) | § Success Signals |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subscription lifecycle signals | API/Backend (fleet-status/subscription-registry.ts) | — | Registry is the ONLY source of truth for "is anyone watching" |
| Per-subscriber auth (userId extraction) | API/Backend (fleet-status/fleet-status-server.ts) | — | JWT decode belongs at the WS boundary |
| Per-host decrypt via user session | API/Backend (ssh/host-resolver.ts) | Database/Storage (drizzle+DataCrypto) | Canonical pattern; NEVER re-implement decrypt |
| SSH-poll orchestration | API/Backend (fleet-status/ssh-poll-orchestrator.ts) | — | Long-lived Client pool + poll cadence |
| Stop-hook install/probe on remote hosts | API/Backend (fleet-status/remote-hook-install.ts) | — | Runs one-shot per host via injected SshChannel |
| Structured log format | API/Backend (utils/logger.ts) | Frontend (console-forward via backend transport) | Format layer must include all context fields |

---

## Q1: SubscriptionRegistry API surface — does it expose lifecycle events?

**File:** `src/backend/fleet-status/subscription-registry.ts` (135 lines total)

### Current interface (lines 20-51)

```typescript
export interface SubscriptionRegistry {
  subscribe(sendFrame: SendFrame): () => void;
  publishSessionState(hostId: string, state: SessionState): void;
  publishSessionGone(hostId: string, tmuxSession: string | null, sessionId: string): void;
  getSnapshot(): SessionState[];
}
```

**No lifecycle callbacks exist today.** No first-subscriber / last-unsubscriber signal, no subscriber-count property, no EventEmitter integration. `subscribers` is a private `Set<SendFrame>` scoped inside the factory closure (line 78).

### Current `subscribe` / `unsubscribe` signatures (lines 81-100)

```typescript
subscribe(sendFrame: SendFrame): () => void {
  subscribers.add(sendFrame);                         // idempotent (Set)
  const snapshot = makeSnapshotFrame(Array.from(state.values()));
  try { sendFrame(snapshot); } catch (err) { ... }
  return () => {
    subscribers.delete(sendFrame);                    // disposer
  };
}
```

The `unsubscribe` is a disposer closure returned from `subscribe` — NOT a separate method. This is the cleanest API surface to extend.

### Recommended Plan 1 extension (surface + shape)

Add TWO optional callbacks to the `subscribe` signature or add a separate registration API. Cleanest shape (backward-compatible with the 7 existing tests):

```typescript
export interface SubscriptionRegistry {
  subscribe(sendFrame: SendFrame): () => void;
  publishSessionState(hostId: string, state: SessionState): void;
  publishSessionGone(hostId: string, tmuxSession: string | null, sessionId: string): void;
  getSnapshot(): SessionState[];

  // NEW — presence signals for Phase 39 (Path C)
  onFirstSubscriber(cb: (context: { userId: string }) => void): () => void;
  onLastUnsubscriber(cb: () => void): () => void;
}
```

The `subscribe` signature also needs to accept `userId` for the "first subscriber" callback to carry it:

```typescript
subscribe(sendFrame: SendFrame, ctx: { userId: string }): () => void;
```

The `ctx.userId` is required for Path C — the poller needs the subscribing user's session to call `resolveHostById(hostId, userId)`. All 3 existing `subscribe()` callers (fleet-status-server.ts:238 + 2 in tests) must be updated.

**Test impact:** All 7 subscription-registry tests use `registry.subscribe((frame) => {...})` without ctx. Plan 1 either (a) makes `ctx` optional with `{ userId: "system" }` default, or (b) updates all 7 tests. Since tests own the shape, updating them is fine and preferred (Skynet convention: no compat fallbacks).

**Confidence:** HIGH — all code is in-tree, no external dependencies.

---

## Q2: `createSshPollOrchestrator` — start/stop re-entrancy

**File:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` (567 lines total)

### Current `start()` behavior (lines 496-532)

```typescript
async start(): Promise<void> {
  stopped = false;                                    // ← RESET on start (good)
  let initialHosts: HostRecord[] = [];
  try {
    initialHosts = await deps.listIdentityHostingHosts();
  } catch (err) { ... }
  for (const host of initialHosts) {
    await tryAcquireHostChannel(host);                // populates perHostState
  }
  await pollAllHosts();                               // immediate first poll
  pollTimer = deps.setInterval(pollAllHosts, pollIntervalMs);
  sweepTimer = deps.setInterval(sweepAllHostsForStalePids, staleSweepIntervalMs);
}
```

### Current `stop()` behavior (lines 534-560)

```typescript
stop(): void {
  stopped = true;
  if (pollTimer !== null) { deps.clearInterval(pollTimer); pollTimer = null; }
  if (sweepTimer !== null) { deps.clearInterval(sweepTimer); sweepTimer = null; }
  for (const hostState of perHostState.values()) {
    try { deps.releaseSshChannel(hostState.host, hostState.channel); } catch {}
  }
  perHostState.clear();                               // ← CLEARED (good)
}
```

### Re-entrancy analysis (start → stop → start)

- `stopped` flag: `start()` resets it; `stop()` sets it. ✓ CORRECT
- `pollTimer` / `sweepTimer`: `stop()` nulls them; `start()` reassigns. ✓ CORRECT
- `perHostState` Map: `stop()` clears it; `start()` repopulates via `tryAcquireHostChannel`. ✓ CORRECT
- `pollTickCount`: NOT reset on `stop()` — it monotonically increases across start/stop cycles. **Minor watch-out:** the `hostRefreshEveryNTicks` modulo check (line 369) uses this count. On re-start the first tick's modulo may hit the refresh branch unexpectedly. Non-blocking (refresh is safe; it just does an extra DB query) but worth noting in the plan.

**Test coverage gap:** `ssh-poll-orchestrator.test.ts` has 12 general tests + fail-open sub-suite (Task 3), but NO test for a `start() → stop() → start()` sequence. Plan 2 should add one: assert that after stop/start the perHostState Map is repopulated and polling resumes.

### Test infrastructure — critical for Plan 2

The MockRegistry (`ssh-poll-orchestrator.test.ts:93-122`) implements the `SubscriptionRegistry` interface. If Plan 1 extends that interface with `onFirstSubscriber` / `onLastUnsubscriber`, the MockRegistry MUST add stubs for both methods or TS compilation fails on the test file. Plan 2 (or Plan 1) needs to touch this file.

### `starter.ts` wiring (lines 154-358)

- The orchestrator is created at line 318 (inside a `{ ... }` block scope).
- `orchestrator.start()` is called fire-and-forget at line 340.
- **Nothing else in the codebase depends on the orchestrator running at boot** (verified via grep — the only `createSshPollOrchestrator` reference outside fleet-status is a comment reference in the same file).
- The `hostClients` Map (line 234) is scoped INSIDE the fleet-status block — safe to survive across start/stop cycles because `acquireSshChannel` reuses live clients + auto-cleans on disconnect (lines 285-287).
- **However:** `hostClients` should be CLEARED on last-unsubscriber (or the orchestrator's `stop()` should end them), because the design says "no user watching = no work happening." Leaving 10 idle SSH clients open when no browser is connected leaks the very TCP connections we're trying not to run.

### Recommended Plan 2 shape

Move the `orchestrator.start()` call OUT of the boot path. Instead:

```typescript
// starter.ts (rewrite around line 340)
registry.onFirstSubscriber(({ userId }) => {
  // Rewire listIdentityHostingHosts to use resolveHostById(id, userId) internally
  currentSubscriberUserId = userId;
  orchestrator.start().catch(err => { ... });
});

registry.onLastUnsubscriber(() => {
  orchestrator.stop();
  // Also close any live hostClients to release SSH TCP connections
  for (const [id, client] of hostClients) {
    try { client.end(); } catch {}
  }
  hostClients.clear();
});
```

The `currentSubscriberUserId` (or a per-user pool) is threaded into a rewritten `listIdentityHostingHosts` that calls `resolveHostById(id, userId)` per host. See Q3 for the canonical pattern.

**Confidence:** HIGH.

---

## Q3: How WS server threads authenticated userId — auth path

**File:** `src/backend/fleet-status/fleet-status-server.ts` (395 lines total)

### `handleFrontendConnection` auth path (lines 148-198)

```typescript
async function handleFrontendConnection(
  ws: WebSocket,
  req: IncomingMessage,
  remoteIp: string,
  authManager: AuthManagerLike,
  registry: SubscriptionRegistry,
): Promise<void> {
  let userId: string | undefined;
  let sessionId: string | undefined;

  // Line 160-181: JWT extract + verify
  const token = extractJwtToken(req);                 // cookie 'jwt=' or Bearer
  if (!token) { ws.close(1008); return; }
  const payload = await authManager.verifyJWTToken(token);
  if (!payload?.userId || payload.pendingTOTP) { ws.close(1008); return; }
  userId = payload.userId;                            // ← LIVE HERE for subscribe scope
  sessionId = payload.sessionId;
```

### Subscribe path (lines 231-242)

```typescript
if (frame.type === "subscribe" && !subscribeHandled) {
  subscribeHandled = true;
  systemLogger.info("Fleet-status frontend subscribed", {
    operation: "fleet_status_subscribed",
    userId,                                            // ← already logged
    sessionId,
  });
  disposer = registry.subscribe((outFrame) => {       // ← userId in closure scope
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(outFrame));
    }
  });
}
```

**The `userId` is a closure variable ALREADY in scope where `registry.subscribe()` is called.** Plan 1 change is a single line:

```typescript
disposer = registry.subscribe(
  (outFrame) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(outFrame)); },
  { userId: userId! }   // ← NEW: pass userId as context
);
```

### JWT extract helper (lines 60-75)

```typescript
function extractJwtToken(req: IncomingMessage): string | undefined {
  // 1. Cookie: jwt=<token>
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  // 2. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice("Bearer ".length);
  return undefined;
}
```

This is the SAME pattern used at `src/backend/ssh/terminal.ts:129-160` (per fleet-status-server.ts:58 comment). No changes needed.

### AuthManager interface (lines 40-42)

```typescript
interface AuthManagerLike {
  verifyJWTToken(token: string): Promise<AuthPayload | null>;
}
```

Where `AuthPayload = { userId: string; sessionId?: string; pendingTOTP?: boolean }`.

### Canonical decrypt pattern to mirror

From `src/backend/database/routes/sessions.ts:70-75`:

```typescript
const resolved = await resolveHostById(hostId, userId);
if (!resolved) return [];
const conn = await connectOneShot(
  resolved as unknown as Parameters<typeof connectOneShot>[0],
  PER_HOST_TIMEOUT_MS,
);
```

`resolveHostById(hostId: number, userId: string)` at `src/backend/ssh/host-resolver.ts:14` returns `SSHHost | null`. It uses `SimpleDBOps.select(..., "ssh_data", userId)` which runs `DataCrypto.decryptRecords` unconditionally before returning. Handles credentialId indirection (shared / override credentials) — all 10 enrolled hosts store inline PEM per CONTEXT §Root cause, but the code path handles both.

**Type impedance mismatch to flag for planner:** `HostRecord` (fleet-status/host-id-resolver.ts:14) has `id: string`; `resolveHostById` takes `hostId: number`. `starter.ts:219` already does `id: String(row.id)` for the SSH-poll consumer. Plan 2's rewrite of `listIdentityHostingHosts` needs to keep the raw numeric ID for the `resolveHostById` call while still returning `{ id: string, name: string, _connDetails: ... }` to the orchestrator. Not a landmine, just a foot-shoot risk if not called out.

**Confidence:** HIGH.

---

## Q4: Logger — where `error` field is swallowed + smallest-surface fix

**File:** `src/backend/utils/logger.ts` (306 lines total)

### The swallow (lines 127-162, `formatMessage`)

```typescript
private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = this.getTimeStamp();
  const levelColor = this.getLevelColor(level);
  const serviceTag = chalk.hex(this.serviceColor)(`[${this.serviceIcon}]`);
  const levelTag = levelColor(`[${level.toUpperCase()}]`);

  let contextStr = "";
  if (context) {
    const sanitizedContext = this.sanitizeContext(context);
    const contextParts = [];
    if (sanitizedContext.operation)  contextParts.push(`op:${sanitizedContext.operation}`);
    if (sanitizedContext.userId)     contextParts.push(`user:${sanitizedContext.userId}`);
    if (sanitizedContext.hostId)     contextParts.push(`host:${sanitizedContext.hostId}`);
    if (sanitizedContext.tunnelName) contextParts.push(`tunnel:${sanitizedContext.tunnelName}`);
    if (sanitizedContext.sessionId)  contextParts.push(`session:${sanitizedContext.sessionId}`);
    if (sanitizedContext.requestId)  contextParts.push(`req:${sanitizedContext.requestId}`);
    if (sanitizedContext.duration)   contextParts.push(`duration:${sanitizedContext.duration}ms`);
    if (contextParts.length > 0) {
      contextStr = chalk.gray(` [${contextParts.join(",")}]`);
    }
  }
  return `${timestamp} ${levelTag} ${serviceTag} ${message}${contextStr}`;
}
```

**The gap is glaring:** Only 7 hard-coded fields are copied into `contextParts`. Every other field passed via `LogContext` (which is typed `[key: string]: unknown`) is silently dropped from the human-readable msg. This includes:
- `error`
- `fleetHostId`
- `hostname`
- `remoteIp`
- `pid`
- `tick`
- `frameType`
- `wsState`
- `zodError`
- `reason`
- ... plus every other domain-specific field.

### Downstream: console-forward pipeline (lines 219-224)

```typescript
warn(message: string, context?: LogContext): void {
  if (!this.shouldLog("warn", message)) return;
  const formatted = this.formatMessage("warn", message, context);
  console.warn(formatted);                            // ← docker logs skynet
  enqueueBackendLog({ level: "warn", msg: formatted });  // ← console-forward.log
}
```

Both `console.warn` AND `enqueueBackendLog` receive the SAME pre-formatted string. `enqueueBackendLog` (console-forward-transport.ts:105-120) writes it as `{ ts, level, msg, source: "backend" }` to `console-forward.log`. **The `msg` is exactly what came out of `formatMessage()` — so fixing `formatMessage` fixes BOTH targets at once.**

### Smallest-surface fix (recommended)

Replace the 7 hard-coded `if` blocks with a generic "print all non-sensitive fields not already claimed" pass. `sanitizeContext()` (lines 96-125) already handles the SENSITIVE_FIELDS list (password, key, token, jwt, etc.) — those get masked to `[MASKED]` before reaching `formatMessage`. Untouched fields are safe to print.

Proposed shape (Plan 3):

```typescript
const KNOWN_CTX_FIELDS = ["operation","userId","hostId","tunnelName","sessionId","requestId","duration"];
// Known fields first, in existing order
if (sanitizedContext.operation)  contextParts.push(`op:${sanitizedContext.operation}`);
// ... (existing block unchanged)

// Then everything else the context carried
for (const [k, v] of Object.entries(sanitizedContext)) {
  if (KNOWN_CTX_FIELDS.includes(k)) continue;
  if (v === undefined || v === null) continue;
  const valStr = typeof v === "string" ? v : JSON.stringify(v);
  contextParts.push(`${k}:${valStr}`);
}
```

**Alternative narrower fix** (surface-only Phase 39): add `error` to the explicit whitelist. This misses `fleetHostId`, `hostname`, etc. — planner picks. Recommend the generic fix; it costs the same effort and fixes future gaps.

### Test impact

No existing `logger.test.ts` file was found in the fleet-status search. If one exists elsewhere and asserts the format string exactly, the generic fix will need test updates. Planner should grep for `formatMessage` test coverage before finalizing shape.

**Confidence:** HIGH (code-verified). Planner should add a `logger.test.ts` (or extend an existing one) asserting `error` field surfaces.

---

## Q5: `remote-hook-install.ts` — is there a "verify install status" mode?

**File:** `src/backend/fleet-status/remote-hook-install.ts` (389 lines total)

### Exported functions

- `installStopHook(channel, opts)` — idempotent installer. Returns `{ hookInstalled: boolean, settingsUpdated: boolean }`. Second run detects the entry in settings.json and returns `{ hookInstalled: true, settingsUpdated: false }` without any writes (lines 251-260).
- `uninstallStopHook(channel, opts)` — removes settings entry + `rm -f` the script.
- `readAndMergeStopHookSettings(currentSettings, remoteHookPath)` — PURE (no SSH). Detects `alreadyInstalled` by scanning `hooks.Stop[*].hooks[*].command`.

**No standalone "is-it-installed?" probe exists.** Options for Plan 4:

**Option A (cheapest):** Just call `installStopHook` blindly per host on first poll cycle. It's idempotent. Wastes ~5 SSH round-trips per host on happy path (mkdir + write .tmp + verify + read settings + skip write) but zero risk. This matches the existing D-CTX §PIVOT design: "The ssh-poll-orchestrator calls this once per newly-discovered identity-hosting host."

**Option B (efficient):** Add a small `checkStopHookInstalled(channel, opts)` helper. Two SSH `exec` calls:
```bash
test -x ~/.claude/hooks/skynet-fleet-status-stop.sh && echo OK
grep -q 'skynet-fleet-status-stop.sh' ~/.claude/settings.json && echo OK
```
Returns `{ scriptPresent, settingsRegistered }`. Orchestrator calls this on first-seen host; installs only if either is false.

**Option C (per CONTEXT §Third strand — recommended):** Fold Option A behavior into the orchestrator's `tryAcquireHostChannel` path — on first successful channel acquire per host, kick off `installStopHook(channel)` fire-and-forget. Never blocks polling. Any install error is logged (with the newly-fixed structured logger, so `err.message` actually surfaces).

### Payload path convention on target host

- Hook script path: `~/.claude/hooks/skynet-fleet-status-stop.sh` (const `DEFAULT_REMOTE_HOOK_PATH`, line 63).
- Payload directory: `~/.claude/fleet-status` (const `DEFAULT_REMOTE_PAYLOAD_DIR`, line 65).
- Payload file: `~/.claude/fleet-status/last-stop-payload.json` (from `stop-hook.sh` line 14 + orchestrator config at `starter.ts:335`).
- Settings.json path: `~/.claude/settings.json` (hard-coded at remote-hook-install.ts:208).

### Verification script (existing, human-driven)

`src/backend/fleet-status/scripts/verify-monitor-payload.sh` — usage: `bash verify-monitor-payload.sh <hostname>`. Ssh's to host, cats the payload file, `jq`-parses `background_tasks`, prints monitor-type entries. **Not runnable in-process** (bash + jq required on the researcher's box, not the target). Useful for end-of-phase UAT; not for the orchestrator's install-check flow.

**Confidence:** HIGH.

---

## Q6: Test conventions — vitest, mocks, existing test structure

### vitest configuration (`vitest.config.ts`)

- Two projects: `backend` (Node env, `src/backend/**/*.test.ts`), `frontend` (jsdom, `src/ui/**/*.test.{ts,tsx}`).
- Setup file: `./vitest.setup.ts` (checked — exists).
- Alias `@` → `./src/ui`, `@/types` → `./src/types`.
- Run commands: `npm test` (all), or `npm test -- src/backend/fleet-status/subscription-registry.test.ts` (targeted).

### Standard mock pattern for logger (used in all fleet-status tests)

```typescript
vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),      // add if needed
    success: vi.fn(),    // add if needed
  },
}));
```

Present in: `subscription-registry.test.ts:8-15`, `fleet-status-server.test.ts:16-23`, `ssh-poll-orchestrator.test.ts:34-41`, `remote-hook-install.test.ts:33-40`.

### Mock SSH channel (duplicated across tests)

Both `ssh-poll-orchestrator.test.ts:53-87` and `remote-hook-install.test.ts:48-71` define an identical inline `MockSshChannel` class. Not currently DRY'd. If Plan 4 adds tests for the install-check flow, either duplicate the pattern or extract to `src/backend/fleet-status/test-helpers.ts`.

### Mock ssh2 / DB / registry

- **ssh2:** Never mocked directly — always injected via `acquireSshChannel: vi.fn().mockResolvedValue(channel)` (see `ssh-poll-orchestrator.test.ts:197`).
- **DB:** Not mocked in fleet-status tests. Where the DB is needed (starter.ts wiring is NOT under test today), the pattern from `src/backend/database/routes/sessions.test.ts` (if it exists) would apply — grep needed if Plan 2 grows integration tests.
- **Registry:** `MockRegistry` class in `ssh-poll-orchestrator.test.ts:93-122` implements the interface with `subscribers = new Set()` — **NOTE:** if Plan 1 adds `onFirstSubscriber` / `onLastUnsubscriber` to the interface, this MockRegistry file MUST be updated too (TS compile-break otherwise).

### Existing test files for touched modules

| File | Tests | Coverage notes |
|------|-------|-----------------|
| `subscription-registry.test.ts` | 7 tests (Test 1-7) | No lifecycle-hook coverage. Plan 1 adds first-subscriber/last-unsubscriber tests. |
| `fleet-status-server.test.ts` | 6+ tests (Test 1-6+) | Auth path + snapshot delivery + watcher hello covered. Plan 2 may want a test asserting `userId` is threaded to `registry.subscribe` — needs registry spy. |
| `ssh-poll-orchestrator.test.ts` | 12 general + fail-open sub-suite | Comprehensive start/poll/sweep/fail-open. Missing: start→stop→start cycle. |
| `remote-hook-install.test.ts` | 10 tests | Full install/uninstall/idempotency/JSON-invalid coverage. Plan 4 could add a `checkStopHookInstalled` test. |

**Confidence:** HIGH.

---

## Q7: Hidden lifecycle landmines — is `starter.ts` relying on the poller running at boot for anything else?

**Grep verified:** `createSshPollOrchestrator` is referenced ONLY in `starter.ts:164` (import) + `starter.ts:318` (call site). No other consumer.

### `hostClients` Map lifecycle (starter.ts:234)

- Defined INSIDE the fleet-status IIFE block scope `{ ... }` at lines 154-358.
- Not exported, not passed anywhere else.
- Only accessed by the local `acquireSshChannel` closure (lines 236-306).
- Auto-cleaned on ssh2 client `end`/`close`/`error` events (lines 285-287).
- **Landmine:** if Plan 2 rewires the block to gate `orchestrator.start()` behind `onFirstSubscriber`, `hostClients` will need to survive across the enclosing IIFE completing. Currently it does (the closure is captured by `acquireSshChannel` which the orchestrator holds a ref to). **But** — the local `const orchestrator = createSshPollOrchestrator(...)` at line 318 is ALSO block-scoped; Plan 2 must lift it (or at least the presence-hook wiring) outside the block, OR move the `registry.onFirstSubscriber` / `onLastUnsubscriber` registrations INSIDE the block before it closes. Latter is simpler.

### No other backend feature relies on the SSH-poll running

Verified via grep — no code path reads from `SubscriptionRegistry.getSnapshot()` at boot, no dashboard route depends on fleet-status data existing before a browser connects, no health check pings the orchestrator.

**However — one subtle case worth naming to the planner:**

**The `identityHostCount` info log at starter.ts:349** is currently emitted at boot regardless of subscriber presence. This has been a useful boot-time signal for confirming the DB query worked. If Plan 2 moves `orchestrator.start()` behind the first-subscriber hook, this log will only fire on first subscriber. Not a bug — it's actually MORE truthful (we don't have the SSH channels open until first subscriber, so counting them at boot was misleading anyway) — but flag for planner in case Ashley expects boot-time visibility. Could add a `fleet_status_awaiting_subscriber` info log at boot as replacement.

### One additional watch-out — WS server WITHOUT subscriber

`startFleetStatusServer` at starter.ts:178 starts the WS server on port 30012 at boot, regardless of subscribers. This is CORRECT and remains unchanged — the WS server has to be listening BEFORE any browser can connect and trigger the first-subscriber signal. Plan 2 does NOT gate the WS server behind lifecycle — only the SSH-poll orchestrator.

**Confidence:** HIGH.

---

## Runtime State Inventory

Phase 39 is a code/wiring change, not a rename/migration. Runtime state inventory is minimal:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB schema changes. Encrypted `hosts` table is READ via `resolveHostById`, never mutated by this phase. | none |
| Live service config | 10 identity-hosting hosts registered in Skynet's `hosts` table. Each MAY or MAY NOT have `~/.claude/hooks/skynet-fleet-status-stop.sh` installed on the target host — CONTEXT §Third strand explicitly notes "Unverified whether the install step was ever run against any host." | Plan 4: probe or blind-install per host |
| OS-registered state | Fleet-status Stop hook registered in `~/.claude/settings.json` on target hosts (via `hooks.Stop[0].hooks[]` array). Idempotent registration via `readAndMergeStopHookSettings`. | Plan 4 verifies + adds where missing |
| Secrets/env vars | None — no new env vars or secrets. Existing SOPS-managed JWT signing key remains unchanged. Code only changes how existing decrypt happens (via `resolveHostById`), not what keys are used. | none |
| Build artifacts | None — this is a TypeScript source change. `npm run build` from clean will pick up the changes; no stale `.d.ts` or compiled artifact concerns. | Standard build after execute |

**Nothing found in category "Stored data":** verified by grep — no `ALTER TABLE`, `sqliteTable`, or DataCrypto schema references in the phase's touched files.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | v22+ (per fleet convention) | — |
| vitest | Tests | ✓ | Per vitest.config.ts, uses `vitest/config` | — |
| TypeScript | Build | ✓ | Fork-standard | — |
| ssh2 npm package | SSH connections | ✓ | Bundled in existing `connectOneShot` | — |
| Fleet-status WS server (port 30012) | Runtime | ✓ | Already started at starter.ts:178 | — |
| `resolveHostById` (host-resolver.ts) | Per-host decrypt | ✓ | Already deployed | — |
| Target hosts' `stop-hook.sh` install status | End-to-end poll success | ✗ (per CONTEXT §Third strand) | — | Plan 4 blind-install (idempotent — safe) OR probe-then-install |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Stop-hook install per host — Plan 4 either probes or blind-installs (both viable).

---

## Standard Stack

Phase 39 uses ONLY existing in-tree Skynet primitives. No new dependencies.

### Core (all in-tree, verified)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `resolveHostById` (src/backend/ssh/host-resolver.ts) | in-tree | Per-host decrypt with SimpleDBOps + DataCrypto | Used by sessions.ts, identity-birth.ts, roles-create.ts, relay-pointer.ts, guacamole/routes.ts — canonical Skynet pattern |
| `connectOneShot` (src/backend/ssh/ssh-one-shot.ts) | in-tree | Establish ssh2 Client from a decrypted host record | Canonical companion to `resolveHostById` |
| `SimpleDBOps` (src/backend/utils/simple-db-ops.ts) | in-tree | Decrypt-wrapped drizzle select | Called BY resolveHostById; do NOT invoke directly |
| `systemLogger` (src/backend/utils/logger.ts) | in-tree | Structured logging | Already used everywhere in fleet-status — bug to fix, not replace |
| `installStopHook` (fleet-status/remote-hook-install.ts) | in-tree | Idempotent Stop-hook installation | Already implemented; reuse verbatim |
| vitest | Fork-standard | Testing framework | Configured in vitest.config.ts |
| ssh2 | via connectOneShot | SSH client | Already the SSH primitive; no direct usage in this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending SubscriptionRegistry with onFirstSubscriber/onLastUnsubscriber | Node's EventEmitter | EventEmitter adds a dependency and a whole new lifecycle; the registry is already a self-contained closure with a Set — two extra callback slots is the minimum viable extension. |
| Threading `userId` into `subscribe(sendFrame, ctx)` | Global "current userId" module var | Global mutable state = harder to test, breaks under any conceivable multi-subscribe scenario. Plumb the ctx explicitly. |
| Blind-install stop-hook per host on first acquire (Option C in §Q5) | Probe-then-install (Option B) | Blind install is 5 SSH calls per host every acquire; probe is 2 calls first (skip install if both present). Marginal. Option C recommended for simplicity. |
| Generic "print all context fields" fix in logger.formatMessage | Explicit `error` addition to whitelist | Generic fix costs the same effort and fixes all 13 fleet-status swallow sites simultaneously, plus every future logger use. Recommended. |

**Installation:** No new packages required.

**Version verification:** Not applicable — no external dependencies.

## Package Legitimacy Audit

Not applicable — Phase 39 introduces no new npm/PyPI/crates packages. All changes are in-tree TypeScript source edits.

## Architecture Patterns

### System Architecture Diagram

```
                                                      ┌─────────────────┐
Browser (Skynet UI) ── WSS ─────────────────────────► │ WS server       │
  https://term.gigaashley.click/fleet-status/ws       │ port 30012      │
                                                      │ (fleet-status-  │
                                                      │  server.ts)     │
                                                      └────┬────┬───────┘
                                                           │    │
                                    JWT-auth {userId}      │    │ subscribe(sendFrame, {userId})
                                                           │    ▼
                                                      ┌────▼────────────┐
                                                      │ Subscription    │
                                                      │ Registry        │
                                                      │ (subscription-  │
                                                      │  registry.ts)   │
                                                      │                 │
                                                      │ • Set<sendFrame>│
                                                      │ • Map<key,state>│
                                                      │ • NEW: emits    │
                                                      │   onFirstSub    │
                                                      │   onLastUnsub   │
                                                      └────┬────────────┘
                                                           │
                            onFirstSubscriber({userId}) ── │ ─── orchestrator.start()
                            onLastUnsubscriber()      ──── │ ─── orchestrator.stop()
                                                           ▼
                                                      ┌─────────────────┐         ┌───────────────────┐
                                                      │ SSH-poll        │◄────────│ resolveHostById   │
                                                      │ orchestrator    │ per host│ (host-resolver.ts)│
                                                      │ (ssh-poll-      │ decrypt │                   │
                                                      │  orchestrator.ts)│         │ SimpleDBOps →     │
                                                      │                 │         │ DataCrypto →      │
                                                      │ • start/stop    │         │ drizzle SELECT    │
                                                      │ • poll 2s tick  │         └───────────────────┘
                                                      │ • sweep 30s tick│
                                                      └──────┬──────────┘
                                                             │ ssh2 exec (via connectOneShot per-host clients)
                                                             ▼
                                                      ┌─────────────────┐
                                                      │ Target hosts    │
                                                      │ (10 identity-   │
                                                      │  hosting boxes) │
                                                      │                 │
                                                      │ Reads:          │
                                                      │  ~/.claude/     │
                                                      │   sessions/*    │
                                                      │  /proc/<pid>/*  │
                                                      │  ~/.claude/     │
                                                      │   fleet-status/ │
                                                      │   last-stop-    │
                                                      │   payload.json  │
                                                      │  ← written by   │
                                                      │    stop-hook.sh │
                                                      │    (Plan 4)     │
                                                      └─────────────────┘
```

### Pattern 1: Extend interface with optional callbacks, NOT EventEmitter

**What:** Add `onFirstSubscriber(cb)` / `onLastUnsubscriber(cb)` to the `SubscriptionRegistry` interface. Each returns a disposer.

**When to use:** Small internal API with 1-2 lifecycle events. Avoid pulling in EventEmitter for two events.

**Example:**
```typescript
// Source: proposed extension to subscription-registry.ts
const firstSubCallbacks = new Set<(ctx: { userId: string }) => void>();
const lastUnsubCallbacks = new Set<() => void>();

return {
  subscribe(sendFrame, ctx) {
    const wasEmpty = subscribers.size === 0;
    subscribers.add(sendFrame);
    // ...snapshot delivery unchanged...
    if (wasEmpty) {
      for (const cb of firstSubCallbacks) {
        try { cb(ctx); } catch (err) { systemLogger.warn(...); }
      }
    }
    return () => {
      subscribers.delete(sendFrame);
      if (subscribers.size === 0) {
        for (const cb of lastUnsubCallbacks) {
          try { cb(); } catch (err) { systemLogger.warn(...); }
        }
      }
    };
  },
  onFirstSubscriber(cb) { firstSubCallbacks.add(cb); return () => firstSubCallbacks.delete(cb); },
  onLastUnsubscriber(cb) { lastUnsubCallbacks.add(cb); return () => lastUnsubCallbacks.delete(cb); },
  // ...existing publish + snapshot methods unchanged...
};
```

### Pattern 2: Decrypt-then-connect (canonical Skynet)

**What:** For every SSH operation, `await resolveHostById(hostId, userId)` first, then pass the returned SSHHost record to `connectOneShot`.

**When to use:** ANY server-side SSH from a user-authenticated context.

**Example (verbatim from `src/backend/database/routes/sessions.ts:70-75`):**
```typescript
const resolved = await resolveHostById(hostId, userId);
if (!resolved) return [];
const conn = await connectOneShot(
  resolved as unknown as Parameters<typeof connectOneShot>[0],
  PER_HOST_TIMEOUT_MS,
);
```

### Pattern 3: Generic context passthrough in logger

**What:** Instead of hard-coding which context fields format into the human-readable msg, iterate all sanitized fields and print `key:value` for each. Sensitive fields are already `[MASKED]` by `sanitizeContext()`.

**When to use:** Structured logger that needs to surface ad-hoc fields per call site.

**Example (proposed):**
```typescript
// After the 7 known-field pushes:
const KNOWN = new Set(["operation","userId","hostId","tunnelName","sessionId","requestId","duration"]);
for (const [k, v] of Object.entries(sanitizedContext)) {
  if (KNOWN.has(k)) continue;
  if (v === undefined || v === null) continue;
  const valStr = typeof v === "string" ? v : JSON.stringify(v);
  contextParts.push(`${k}:${valStr}`);
}
```

### Anti-Patterns to Avoid

- **Hand-rolling a decrypt function.** `SimpleDBOps.select(..., "ssh_data", userId)` is the ONLY correct path. See CONTEXT §Root cause — hand-rolling is literally the current bug.
- **EventEmitter for a two-signal API.** Overkill; adds a dependency; the registry's Set closure pattern already handles this cleanly.
- **Passing ciphertext to ssh2.** The current bug is exactly this: `Buffer.from(cleanKey, "utf8")` at ssh-one-shot.ts:76 with `cleanKey` being encrypted ciphertext = ssh2 rejects as invalid key. `resolveHostById` returns decrypted `host.key` — safe.
- **Boot-time SSH work.** The whole phase is about REMOVING this. Do not add any `orchestrator.start()` call outside the first-subscriber hook.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-record credential decrypt | Any manual `DataCrypto.decrypt` call | `resolveHostById(hostId, userId)` | Handles credentialId indirection, shared/override credentials, key normalization — all landmines |
| JWT extract from WS req | Regex over req.headers | `extractJwtToken` (fleet-status-server.ts:60) already exists; already used | Already used by both fleet-status-server.ts and terminal.ts |
| Stop-hook install on remote | Manual scp + settings.json edit | `installStopHook(channel, opts)` | Handles atomic write, .tmp/mv, idempotent merge, invalid-JSON safeguard |
| SSH host record fetch | Raw drizzle `db.select().from(hosts)` | `resolveHostById` | Raw drizzle returns ciphertext — the current bug |
| Structured log to console-forward | Custom write to console-forward.log | `systemLogger.warn/error/info` (once formatMessage is fixed) | Batching, rotation, source-tagging all handled |

**Key insight:** The fix is not to introduce new abstractions — it's to STOP bypassing the existing ones. `resolveHostById` was there the whole time; SSH-poll just skipped it. The logger's formatMessage was there the whole time; it just failed to surface half its inputs. Plan 2 is "swap raw drizzle for the canonical resolver"; Plan 3 is "make the logger surface what it was passed."

## Common Pitfalls

### Pitfall 1: Ciphertext → ssh2 → silent invalid-key rejection

**What goes wrong:** Raw `db.select({...key: hostsTable.key})` returns app-level encrypted ciphertext; ssh2 wraps in Buffer, gets nonsense bytes, rejects with a generic error.
**Why it happens:** Skynet's per-record encryption is transparent to drizzle — you get raw column bytes unless you go through `SimpleDBOps.select(..., "ssh_data", userId)`.
**How to avoid:** Always use `resolveHostById(hostId, userId)` — it wraps SimpleDBOps + parses JSON fields + handles credential indirection.
**Warning signs:** `fleet_status_host_ssh_unreachable` firing for ALL hosts (not just some); ssh2 error messages like "Invalid key format" or "Cannot parse privateKey"; browser session shows empty snapshot despite subscribers connected.

### Pitfall 2: Logger drops the `error` field silently

**What goes wrong:** `systemLogger.warn("...", { operation: "...", error: err.message })` — only the message + `operation` tag surface in `console-forward.log`. The actual `err.message` from ssh2 (the diagnostic value) never appears.
**Why it happens:** `logger.ts:formatMessage()` has a hard-coded 7-field whitelist. Anything else is dropped from the human-readable output.
**How to avoid:** Fix `formatMessage` to iterate all non-sensitive context fields (generic passthrough). Sensitive-field masking already handled upstream in `sanitizeContext`.
**Warning signs:** Log lines that end with just `[op:someOp]` and nothing more, even when the call site passed a structured error payload. Human diagnosing a bug can't tell WHAT failed.

### Pitfall 3: Poller keeps running (or SSH clients stay open) after last unsubscriber

**What goes wrong:** If `onLastUnsubscriber` only calls `orchestrator.stop()` but the `hostClients` Map (starter.ts:234) still holds live ssh2 Clients, we leak the very TCP connections we said "no user watching = no work."
**Why it happens:** `hostClients` is scoped to the fleet-status IIFE and holds Client references that outlive `orchestrator.stop()`.
**How to avoid:** In the `onLastUnsubscriber` callback, iterate `hostClients` and call `client.end()` on each, then `hostClients.clear()`. `stop()` already calls `perHostState.clear()` inside the orchestrator, but that's a DIFFERENT Map (the one holding channel wrappers, not raw Clients).
**Warning signs:** After closing all browser tabs, `netstat` shows 10 idle port-22 outbound connections to identity-hosting boxes still open.

### Pitfall 4: MockRegistry in orchestrator test breaks when interface extends

**What goes wrong:** Plan 1 adds `onFirstSubscriber` / `onLastUnsubscriber` to `SubscriptionRegistry`; the MockRegistry in `ssh-poll-orchestrator.test.ts:93-122` doesn't implement them; TypeScript rejects the test file with "does not fully implement interface."
**Why it happens:** Structural typing + test double duplicated inline instead of imported.
**How to avoid:** Plan 1 (or Plan 2's first task) updates MockRegistry to add stub `onFirstSubscriber`/`onLastUnsubscriber` methods. Also applies to any spy in `fleet-status-server.test.ts` that types `registry as SubscriptionRegistry`.
**Warning signs:** `npm test` fails with TS2420 in an unrelated test file after the registry change.

### Pitfall 5: `HostRecord.id: string` vs `resolveHostById(hostId: number)` type mismatch

**What goes wrong:** `starter.ts:219` maps `id: String(row.id)` for the orchestrator's `HostRecord` (fleet-status/host-id-resolver.ts:14 declares `id: string`). But `resolveHostById` (host-resolver.ts:14) takes `hostId: number`. Plan 2's rewrite must keep the numeric id available for the decrypt call OR parse the string back to number at the call site.
**Why it happens:** Historical drift — fleet-status was designed around string ids (subscription-registry keys); the rest of Skynet uses numeric primary keys.
**How to avoid:** Keep the raw numeric `row.id` in scope in `listIdentityHostingHosts`. Call `resolveHostById(row.id, userId)` per host. Return the string form to the orchestrator + the decrypted `SSHHost` record. Use closure/tuple, not a schema change.
**Warning signs:** Runtime `null` from `resolveHostById` (userId or hostId mismatch); TS compile error if the two types get conflated.

## Code Examples

### Extending SubscriptionRegistry (Plan 1)

```typescript
// Source: proposed extension to src/backend/fleet-status/subscription-registry.ts

export interface SubscriptionRegistry {
  subscribe(sendFrame: SendFrame, ctx?: { userId: string }): () => void;
  publishSessionState(hostId: string, state: SessionState): void;
  publishSessionGone(hostId: string, tmuxSession: string | null, sessionId: string): void;
  getSnapshot(): SessionState[];
  onFirstSubscriber(cb: (ctx: { userId: string }) => void): () => void;
  onLastUnsubscriber(cb: () => void): () => void;
}

export function createSubscriptionRegistry(): SubscriptionRegistry {
  const state = new Map<string, SessionState>();
  const subscribers = new Set<SendFrame>();
  const firstSubCallbacks = new Set<(ctx: { userId: string }) => void>();
  const lastUnsubCallbacks = new Set<() => void>();

  return {
    subscribe(sendFrame, ctx) {
      const wasEmpty = subscribers.size === 0;
      subscribers.add(sendFrame);
      const snapshot = makeSnapshotFrame(Array.from(state.values()));
      try { sendFrame(snapshot); } catch (err) { /* existing warn */ }
      if (wasEmpty && ctx) {
        for (const cb of firstSubCallbacks) {
          try { cb(ctx); }
          catch (err) { systemLogger.warn("Fleet-status onFirstSubscriber callback threw", {
            operation: "fleet_status_lifecycle_cb_failed",
            error: err instanceof Error ? err.message : "unknown",
          }); }
        }
      }
      return () => {
        subscribers.delete(sendFrame);
        if (subscribers.size === 0) {
          for (const cb of lastUnsubCallbacks) {
            try { cb(); }
            catch (err) { systemLogger.warn("Fleet-status onLastUnsubscriber callback threw", {
              operation: "fleet_status_lifecycle_cb_failed",
              error: err instanceof Error ? err.message : "unknown",
            }); }
          }
        }
      };
    },
    // ...existing publishSessionState, publishSessionGone, getSnapshot unchanged...
    onFirstSubscriber(cb) { firstSubCallbacks.add(cb); return () => firstSubCallbacks.delete(cb); },
    onLastUnsubscriber(cb) { lastUnsubCallbacks.add(cb); return () => lastUnsubCallbacks.delete(cb); },
  };
}
```

### Threading `userId` from WS server (Plan 2)

```typescript
// Source: proposed patch to src/backend/fleet-status/fleet-status-server.ts:238
if (frame.type === "subscribe" && !subscribeHandled) {
  subscribeHandled = true;
  systemLogger.info("Fleet-status frontend subscribed", {
    operation: "fleet_status_subscribed", userId, sessionId,
  });
  disposer = registry.subscribe(
    (outFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(outFrame));
    },
    { userId: userId! },   // ← NEW: pass userId as ctx
  );
}
```

### Rewiring `listIdentityHostingHosts` for decrypt (Plan 2)

```typescript
// Source: proposed rewrite of src/backend/starter.ts:199-231

async function listIdentityHostingHosts(userId: string) {
  try {
    const db = getDb();
    const idRows = await db
      .select({ id: hostsTable.id, name: hostsTable.name })
      .from(hostsTable)
      .where(eq(hostsTable.enableSsh, true));

    // Decrypt per row via canonical resolver
    const results = await Promise.all(
      idRows.map(async (row) => {
        const resolved = await resolveHostById(row.id, userId);
        if (!resolved) return null;
        return {
          id: String(row.id),
          name: row.name ?? String(row.id),
          _connDetails: resolved,   // now DECRYPTED per canonical pattern
        };
      })
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  } catch (err) {
    systemLogger.warn("Fleet-status: identity-host list query failed", {
      operation: "fleet_status_host_list_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}
```

### Rewiring orchestrator lifecycle in starter.ts (Plan 2)

```typescript
// Source: proposed replacement for src/backend/starter.ts:339-357

let currentSubscriberUserId: string | null = null;

registry.onFirstSubscriber(({ userId }) => {
  currentSubscriberUserId = userId;
  systemLogger.info("Fleet-status orchestrator starting on first subscriber", {
    operation: "fleet_status_orchestrator_lifecycle",
    userId,
  });
  orchestrator.start().catch((err) => {
    systemLogger.warn("Fleet-status orchestrator start failed", {
      operation: "fleet_status_orchestrator_start_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  });
});

registry.onLastUnsubscriber(() => {
  systemLogger.info("Fleet-status orchestrator stopping on last unsubscriber", {
    operation: "fleet_status_orchestrator_lifecycle",
  });
  orchestrator.stop();
  // Also close live ssh2 Clients (they outlive orchestrator's perHostState clear)
  for (const [id, client] of hostClients) {
    try { client.end(); } catch { /* best-effort */ }
  }
  hostClients.clear();
  currentSubscriberUserId = null;
});

// Replaces the fire-and-forget orchestrator.start() at line 340
// Boot-time log becomes:
systemLogger.info("Fleet-status orchestrator initialized (awaiting first subscriber)", {
  operation: "fleet_status_awaiting_subscriber",
  pollIntervalMs: 2000,
  staleSweepIntervalMs: 30000,
});
```

Note: the closure over `currentSubscriberUserId` in the rewired `listIdentityHostingHosts` — the orchestrator's `deps.listIdentityHostingHosts()` signature is `() => Promise<HostRecord[]>` (no userId param). Plan 2 either (a) captures `currentSubscriberUserId` via closure and passes to the internal function, or (b) rebuilds the orchestrator on each first-subscriber with a userId-bound function. (a) is simpler and matches the multi-user recommendation (union of hosts) if extended.

### Fixing the logger (Plan 3)

```typescript
// Source: proposed replacement for src/backend/utils/logger.ts:127-162
private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = this.getTimeStamp();
  const levelColor = this.getLevelColor(level);
  const serviceTag = chalk.hex(this.serviceColor)(`[${this.serviceIcon}]`);
  const levelTag = levelColor(`[${level.toUpperCase()}]`);

  let contextStr = "";
  if (context) {
    const sanitizedContext = this.sanitizeContext(context);
    const contextParts: string[] = [];
    // Known-order fields first (preserve existing format for observability)
    const KNOWN_ORDER: Array<[keyof LogContext, string]> = [
      ["operation", "op"], ["userId", "user"], ["hostId", "host"],
      ["tunnelName", "tunnel"], ["sessionId", "session"],
      ["requestId", "req"], ["duration", "duration"],
    ];
    const seen = new Set<string>();
    for (const [field, label] of KNOWN_ORDER) {
      const v = sanitizedContext[field];
      if (v !== undefined && v !== null && v !== "") {
        contextParts.push(field === "duration" ? `${label}:${v}ms` : `${label}:${v}`);
        seen.add(field as string);
      }
    }
    // Then everything else (fixes the swallow — surfaces error, fleetHostId, hostname, etc)
    for (const [k, v] of Object.entries(sanitizedContext)) {
      if (seen.has(k)) continue;
      if (v === undefined || v === null) continue;
      const valStr = typeof v === "string" ? v : JSON.stringify(v);
      contextParts.push(`${k}:${valStr}`);
    }
    if (contextParts.length > 0) {
      contextStr = chalk.gray(` [${contextParts.join(",")}]`);
    }
  }
  return `${timestamp} ${levelTag} ${serviceTag} ${message}${contextStr}`;
}
```

## State of the Art

Not applicable — Phase 39 is a bugfix within an existing established pattern. No "old approach → new approach" for the domain.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | vitest version + config matches fork-standard (no version-specific breaking changes needed) | Standard Stack | Test file syntax may need updates if vitest was upgraded — low risk, in-tree config is HEAD |
| A2 | `hostClients` Map at starter.ts:234 is fully closure-scoped and doesn't leak refs elsewhere | Q7 landmines | Verified via grep — no other file references it |
| A3 | No `logger.test.ts` currently asserts the exact format string of `formatMessage` | Q4 test impact | If one exists that I missed, Plan 3's generic-passthrough fix breaks it — planner should grep before finalizing shape |
| A4 | The `onFirstSubscriber` / `onLastUnsubscriber` shape (Set of callbacks, called synchronously) is preferred over EventEmitter | Q1 recommendation | If Skynet has an existing EventEmitter convention I missed, planner may want to align — low risk, no EE convention found in fleet-status |
| A5 | The rewired `listIdentityHostingHosts` capturing `currentSubscriberUserId` via closure is acceptable | Plan 2 shape | If multi-user semantics (multiple users concurrently subscribed) become a real requirement mid-plan, the closure needs replacement with a Map. Ashley explicitly deferred this per CONTEXT §deferred. |
| A6 | Stop-hook install can be blind-run per host (idempotent) OR probed — CONTEXT lets planner pick | Q5 | If Ashley has a preference between blind-install vs probe-first, planner needs to check. Both work; both safe. |

**All 6 assumptions are LOW-risk and non-blocking for planning.** They surface options for the planner rather than gate progress.

## Open Questions

1. **Should `installStopHook` be called on first-poll per host, or only when the poll observes the empty payload?**
   - What we know: install is idempotent; CONTEXT recommends "verify install status per host + install where missing"; the poller's fail-open path already logs `fleet_status_hook_payload_missing` on empty payload.
   - What's unclear: Is Ashley's expectation "blind install on every host we first see" (Option A) OR "install only when we observe missing" (Option B)?
   - Recommendation: Option A — blind install on first-successful-channel-acquire per host. It's cheap, idempotent, and doesn't require adding logic to the poll fail-open path. Planner asks Ashley during plan-check if this is contentious.

2. **What should the log line say when the orchestrator boots without a subscriber?**
   - What we know: Currently `fleet_status_orchestrator_started` fires with `identityHostCount: N` at boot. After Plan 2 rewire, this log becomes misleading (channels aren't open).
   - What's unclear: Do we want a boot-time indication that the pipeline is armed (`fleet_status_awaiting_subscriber`) or silence?
   - Recommendation: Emit `fleet_status_awaiting_subscriber` at boot. Preserves the "backend is healthy" signal without lying about SSH connections.

3. **Should Plan 3's logger fix be scoped to fleet-status calls only (whitelist `error`) or the whole logger (generic passthrough)?**
   - What we know: 13 fleet-status call sites use `error:` today; hundreds of other backend call sites also do. Generic fix helps all; scoped fix helps only Phase 39.
   - What's unclear: Risk-tolerance for touching a shared logger. There's no `logger.test.ts` I found, but there may be snapshot tests elsewhere.
   - Recommendation: Generic fix, but include the change in its own commit + wave so it can be reverted independently if a snapshot test surprises during CI.

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false`.

Manual UAT per CONTEXT §Success shape from a real browser session:
- Open a browser tab to https://term.gigaashley.click/
- fleet-status WS connects → backend logs `fleet_status_connect` + `fleet_status_frontend_subscribed`
- Within ~2 seconds, SSH-poll starts → per-host `fleet_status_host_poll_started` events fire (new op — currently silent) → SSH handshake succeeds via `resolveHostById` decrypt path → per-host `fleet_status_host_poll_success` events fire
- `SessionState` frames flow to the browser → `session-working-store` populates → convlist rows show ready-dots for idle sessions AND `<WipBubble />` renders in PrettyView for the working session
- Close all browser tabs → fleet-status WS server logs `fleet_status_frontend_disconnected` for the last one → within ~2 seconds, poller stops → per-host `fleet_status_host_poll_stopped` events fire
- No `fleet_status_host_ssh_unreachable` events during the poll-active window (the primary regression signal)

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` per config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT via cookie or Bearer already enforced at fleet-status-server.ts:159-198 (unchanged) |
| V3 Session Management | yes | `payload.pendingTOTP` rejected at fleet-status-server.ts:172 (unchanged) |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` uses userId for SimpleDBOps decrypt scope — proper isolation. Multi-user forward-compat pattern (union of hosts using each host's owner userId) preserves per-host owner boundary. |
| V5 Input Validation | yes | Zod `WatcherInboundFrame` / `FrontendInboundFrame` validation unchanged at fleet-status-server.ts:218-227 |
| V6 Cryptography | yes | DataCrypto (via SimpleDBOps) already handles encrypt/decrypt — NEVER hand-roll. This is literally the phase's central lesson. |
| V7 Error Handling & Logging | yes | The logger fix (Plan 3) is a V7 improvement — currently structured `error` fields are silently dropped, degrading diagnostic capability. Fix surfaces them. |

### Known Threat Patterns for {Node.js + WebSocket + SSH + SQLite}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Ciphertext leaking through raw SQL query | Information Disclosure | Never call `db.select({...key: hostsTable.key})` — always via `resolveHostById` (fixes current bug) |
| Auth bypass on WS upgrade | Spoofing | Existing JWT + pendingTOTP check at fleet-status-server.ts:172 (unchanged) |
| Sensitive fields in logs | Information Disclosure | `sanitizeContext` masks SENSITIVE_FIELDS list (logger.ts:46-64); Plan 3 fix does NOT bypass this — sanitization runs BEFORE the generic passthrough |
| SSH host-key spoofing | Tampering | `hostVerifier: () => true` in ssh-one-shot.ts:67 is the trust boundary (Tailscale network); documented, unchanged |
| Stop-hook shell injection | Elevation of Privilege | `installStopHook` uses heredoc-quoted writes with fixed path (remote-hook-install.ts:181-184); path is a compile-time const, no user input; safe |

### Security review checklist for planner

- Plan 3's logger fix MUST preserve `sanitizeContext` masking — validate by tracing: `warn(msg, ctx) → sanitizeContext(ctx) → formatMessage(level, msg, sanitizedContext)`. The generic passthrough runs on `sanitizedContext`, so all SENSITIVE_FIELDS entries are already `[MASKED]` before being printed.
- Plan 2's `userId` threading MUST NOT log `userId` in a way that leaks user identity to other subscribers — but `SessionState` frames are per-subscriber (each WS connection has its own send closure); no cross-subscriber leak vector.

## Sources

### Primary (HIGH confidence — all in-tree source, verified via Read/Grep)

- `/home/ubuntu/skynet-tanya/.planning/phases/39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen/39-CONTEXT.md` — locked design decisions
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/subscription-registry.ts` (135 lines) — Q1 API surface
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/ssh-poll-orchestrator.ts` (567 lines) — Q2 start/stop
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/fleet-status-server.ts` (395 lines) — Q3 auth path
- `/home/ubuntu/skynet-tanya/src/backend/utils/logger.ts` (306 lines) — Q4 formatMessage swallow
- `/home/ubuntu/skynet-tanya/src/backend/utils/console-forward-transport.ts` (145 lines) — Q4 downstream consumer
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/remote-hook-install.ts` (389 lines) — Q5 install helper
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/stop-hook.sh` (20 lines) — Q5 payload writer
- `/home/ubuntu/skynet-tanya/src/backend/ssh/host-resolver.ts` (226 lines) — canonical decrypt pattern
- `/home/ubuntu/skynet-tanya/src/backend/ssh/ssh-one-shot.ts` (95 lines) — ssh2 connect wrapper
- `/home/ubuntu/skynet-tanya/src/backend/database/routes/sessions.ts` (line 70 — canonical usage) — Q3 pattern verbatim
- `/home/ubuntu/skynet-tanya/src/backend/starter.ts` (lines 154-358, 457 total) — Q7 wiring + hostClients scope
- `/home/ubuntu/skynet-tanya/src/backend/database/db/schema.ts` (lines 67-71) — hosts table with userId column
- `/home/ubuntu/skynet-tanya/vitest.config.ts` — Q6 test infra
- `/home/ubuntu/skynet-tanya/.planning/config.json` — validation + security config
- `/home/ubuntu/skynet-tanya/src/backend/fleet-status/{ssh-poll-orchestrator,subscription-registry,fleet-status-server,remote-hook-install}.test.ts` — Q6 test conventions
- `~/.claude/roles/box-maintainer/bounties/fleet-status-ssh-poll-decrypt-and-lazy-lifecycle/bounty.json` — root cause + design lockdown

### Secondary (MEDIUM confidence)

- None — all findings are in-tree code verification, not external documentation.

### Tertiary (LOW confidence)

- None.

## Landmines / Watch-outs

Additional pitfalls surfaced during research beyond the 5 in Common Pitfalls:

1. **`pollTickCount` doesn't reset across start/stop cycles** (ssh-poll-orchestrator.ts:143). The `hostRefreshEveryNTicks` modulo check (line 369) can hit the refresh branch immediately after a re-start. Not a bug (refresh is safe), but a test asserting tick counts after start→stop→start may need to account for this.

2. **Timing of `fleet_status_subscribed` log** — fires BEFORE `registry.subscribe()` returns (fleet-status-server.ts:233). If `onFirstSubscriber` callbacks fire orchestrator.start() (which awaits DB + SSH), the "subscribed" log will appear well before the poller has any data. This is fine (they're separate operations) but planner should NOT couple them via the same log op.

3. **Zombie WS connection edge case** — if a browser disconnects ungracefully (network drop), `ws.on("close")` fires and the disposer runs → subscribers.size → 0 → orchestrator stops. Standard ws lib behavior includes ping timeout. However, if the poller is mid-await when the user disconnects, the current cycle finishes and publishes to a now-empty subscriber set (no-op, safe). Plan 2 should double-check this via test: `stop()` mid-poll should not throw.

4. **`_connDetails` cargo-culting** (starter.ts:222-273) — currently `_connDetails` is a raw drizzle row cast to Record<string, unknown> and passed to connectOneShot. After Plan 2, it should carry the decrypted SSHHost record from resolveHostById. The Plan 2 typing needs to match `Parameters<typeof connectOneShot>[0]`. The `resolved` cast at sessions.ts:73 uses `as unknown as` — acceptable per fleet convention.

5. **`releaseSshChannel` is a no-op today** (starter.ts:308-316). The comment says "Long-lived channels are NOT released after each use — they persist for the life of the orchestrator." Plan 2 changes "life of the orchestrator" to "life of the presence-driven session (first sub → last unsub)." The no-op stays, but the semantic changes. `orchestrator.stop()` iterates `perHostState.values()` and calls `releaseSshChannel` for each (ssh-poll-orchestrator.ts:548-552) — since it's a no-op, the actual client cleanup MUST happen elsewhere (in the `onLastUnsubscriber` callback in starter.ts as recommended). Missing this leaks ssh2 Clients.

6. **`stop-hook.sh` writes to `~/.claude/fleet-status/last-stop-payload.json`** but the ORCHESTRATOR reads from `~/.claude/fleet-status/last-stop-payload.json` (starter.ts:335, orchestrator.ts:136). Both agree, verified. But if Plan 4 introduces a different payload path (e.g., per-session-id file), MUST update both sides.

7. **The `fleet_status_orchestrator_started` log at starter.ts:349 fires from an async `.then()`** on a separate `listIdentityHostingHosts()` call — so it can race with the orchestrator's own `fleet_status_orchestrator_started` (ssh-poll-orchestrator.ts:525). Two logs with the same op tag can appear. Not a bug, but Plan 2 should remove the starter.ts:348-357 duplicate.

## Metadata

**Confidence breakdown:**
- Q1 (SubscriptionRegistry surface): HIGH — read the full 135-line source; grepped for all consumers.
- Q2 (Orchestrator start/stop): HIGH — read the full 567-line source; verified re-entrancy path by tracing state var lifecycle.
- Q3 (Auth threading): HIGH — read the full fleet-status-server.ts; matched against terminal.ts canonical.
- Q4 (Logger swallow): HIGH — read all 306 lines of logger.ts + all 145 lines of console-forward-transport.ts; both consumers verified.
- Q5 (Hook install probe): HIGH — read the full 389-line source; confirmed no probe function exists.
- Q6 (Test conventions): HIGH — read four test files, verified vitest config.
- Q7 (Landmines): HIGH — grepped all `createSshPollOrchestrator` references and `hostClients` usage.

**Research date:** 2026-08-13
**Valid until:** 2026-09-13 (30 days — code paths are stable; no fast-moving external deps involved)

## RESEARCH COMPLETE
