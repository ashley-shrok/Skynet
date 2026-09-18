# Phase 116: image-gen-skill — Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 14 new files + 2 modified files
**Analogs found:** 16 / 16 (all files have a strong analog)

Phase 116 is an intentional clone of Phase 99 (spawn-requests) with three concrete additions: (a) a hand-rolled token bucket, (b) a 5-worker concurrent pool (Phase 99 is serial), (c) an OpenAI adapter extracted from the existing avatar route. Everything else is rename-and-modify.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/image-gen-requests/types.ts` | model (types-only) | N/A | `src/backend/spawn-requests/types.ts` | exact |
| `src/backend/image-gen-requests/parse-request-body.ts` | utility (pure parser) | transform | `src/backend/spawn-requests/parse-request-body.ts` | exact |
| `src/backend/image-gen-requests/queue.ts` | service (in-memory FIFO) | event-driven | `src/backend/spawn-requests/queue.ts` | exact (+ TTL at dequeue) |
| `src/backend/image-gen-requests/worker.ts` | service (async processor) | request-response | `src/backend/spawn-requests/worker.ts` | exact (+ token bucket, delegates to adapter) |
| `src/backend/image-gen-requests/scan-orchestrator.ts` | orchestrator (always-on tick) | event-driven | `src/backend/spawn-requests/scan-orchestrator.ts` | exact |
| `src/backend/image-gen-requests/adapter.ts` | service (HTTP client) | request-response | `src/backend/database/routes/identity-avatar-batch.ts:378-410` | role-match (fetch call site extraction) |
| `src/backend/image-gen-requests/token-bucket.ts` | utility (rate-limit primitive) | transform | none in codebase — new hand-rolled ~50 lines | no analog |
| `src/backend/image-gen-requests/types.test.ts` | test | N/A | (no types.test.ts in spawn-requests — skip) | N/A |
| `src/backend/image-gen-requests/parse-request-body.test.ts` | test | N/A | patterns in `spawn-requests/worker.test.ts` (parse tests are re-exported into worker.test.ts) | role-match |
| `src/backend/image-gen-requests/queue.test.ts` | test | N/A | `src/backend/spawn-requests/queue.test.ts` | exact |
| `src/backend/image-gen-requests/worker.test.ts` | test | N/A | `src/backend/spawn-requests/worker.test.ts` | exact |
| `src/backend/image-gen-requests/scan-orchestrator.test.ts` | test | N/A | `src/backend/spawn-requests/scan-orchestrator.test.ts` | exact |
| `src/backend/image-gen-requests/adapter.test.ts` | test (mocked fetch) | N/A | vitest patterns from spawn-requests + `vi.stubGlobal("fetch", ...)` idiom | role-match |
| `src/backend/image-gen-requests/token-bucket.test.ts` | test (fake timers) | N/A | `vi.useFakeTimers()` pattern from `scan-orchestrator.test.ts` | role-match |
| `src/backend/starter.ts` (MODIFY) | config (boot wiring) | N/A | `starter.ts:1058-1184` (spawn scan orchestrator wiring) | exact |
| `src/backend/distributor/catalog.ts` (MODIFY) | config (catalog rows) | N/A | `catalog.ts:216-262` (SKILL.md row) + `catalog.ts:312-359` (script row) | exact |
| `substrate/skills/image-gen/SKILL.md` | config (agent-facing docs) | N/A | `substrate/skills/id/SKILL.md` (frontmatter + prose shape) + `substrate/skills/bounty/SKILL.md` (concise-invocation shape) | exact |
| `substrate/scripts/image-gen` | utility (bash helper) | file-I/O + poll | `substrate/scripts/agent-supervisor.sh` (bash header/set-flags/config shape) | role-match |
| `substrate/scripts/tests/image-gen.test.sh` | test (bash driver) | file-I/O | `substrate/scripts/tests/fleet-status-sweep.test.sh` | exact |

## Pattern Assignments

### `src/backend/image-gen-requests/types.ts` (model, types-only)

**Analog:** `src/backend/spawn-requests/types.ts` (95 lines, entire file)

**File-header docstring pattern** (lines 1-8): brief module name comment + reference to the wire decisions this file implements + explicit "no runtime imports — types-only file" reassurance.

**Request-body interface pattern** (lines 10-20):
```typescript
export interface SpawnRequestBody {
  role: string;
  task: string | null;
  requested_at: string; // ISO-Z timestamp for debug tracing
}
```
For Phase 116: `ImageGenRequestBody` carries `{prompt: string, size?: string, quality?: string, n?: number, ref?: string, requested_at: string}` — every field except `prompt` and `requested_at` is optional. All D-06 "provider-native passthroughs."

**Pending item interface pattern** (lines 27-52): `PendingBirth` carries `hostId` (string) + `hostIdNum` (number) + `uuid` + all parsed body fields + `userId` + `malformedReason?`. For Phase 116: `PendingImageGen` follows the same shape but must also carry `refImage?: Buffer` (companion `.ref.*` bytes loaded at scan time — D-07). Keep the `malformedReason?` optional field verbatim — same sweep-side malformed-shortcut pattern.

**Success response interface pattern** (lines 69-72):
```typescript
export interface SuccessResponse {
  name: string;
  birthed_at: string; // ISO-Z audit timestamp
}
```
For Phase 116: `SuccessResponse = {images: string[]; size: string; model: string; seed?: string; n: number; generation_time_ms: number}` per D-08.

**FailureReason enum pattern** (lines 78-84):
```typescript
export type FailureReason =
  | "malformed"
  | "role_unknown"
  ...
```
For Phase 116: exactly the 7 values from D-27 — `content_blocked | rate_limited | provider_unavailable | not_configured | malformed | expired | unknown`.

**Failure response interface pattern** (lines 92-95): `{reason: FailureReason; message?: string}` verbatim — same D-09 shape as Phase 99.

---

### `src/backend/image-gen-requests/parse-request-body.ts` (utility, transform)

**Analog:** `src/backend/spawn-requests/parse-request-body.ts` (91 lines, entire file)

**File-header docstring pattern** (lines 1-16): explains WHY this file is separate from worker.ts — worker's transitive imports (birthIdentity → DB init) pollute the fleet-status test graph, so the pure parser is split out. For Phase 116, same rationale applies: adapter.ts + queue.ts should never pull heavy fetch/openai concerns into the scan-orchestrator's test surface.

**Return-shape pattern** (lines 35-38):
```typescript
export function parseRequestBody(
  _uuid: string,
  rawBody: string,
): { ok: true; body: SpawnRequestBody } | { ok: false; reason: "malformed"; message: string }
```
Discriminated union with `ok: true | false`. Reason is always the literal `"malformed"` — this parser only ever produces malformed failures (other failure reasons come from the worker's own pre-flight or the adapter).

**Validation-chain pattern** (lines 39-90):
1. `JSON.parse` inside try/catch → return `{ok:false, reason:"malformed", message:"invalid JSON: ..."}`.
2. Guard `parsed === null || typeof parsed !== "object" || Array.isArray(parsed)` → `"body is not a JSON object"`.
3. Per-field checks: required-string, then pattern/length/type checks — each returns immediately on failure with a descriptive message.
4. Success path assembles the typed body object at the bottom.

For Phase 116: same validation chain, replacing `role` (ROLE_NAME_PATTERN) with `prompt` (non-empty string + 4000-char cap per V5 in RESEARCH.md), replacing `task` (500-char cap) with `size`/`quality`/`n`/`ref` optional passthroughs. **Critical addition per D-06:** enumerate the KNOWN-good keys and reject any unrecognized top-level key with `reason: malformed, message: "unrecognized field: <key>"` — do NOT silently drop. Phase 99's parser does NOT do this (it accepts and discards extras); Phase 116 explicitly rejects them.

---

### `src/backend/image-gen-requests/queue.ts` (service, event-driven)

**Analog:** `src/backend/spawn-requests/queue.ts` (103 lines, entire file)

**Module-state pattern** (lines 17-23):
```typescript
let workerPromise: Promise<void> = Promise.resolve();
const pending: PendingBirth[] = [];
let processBirthFn: ((item: PendingBirth) => Promise<void>) | null = null;
```
Module-scoped `let`s + a Promise chain for serialization + a nullable injected worker function (avoids circular queue↔worker import).

**Enqueue pattern** (lines 76-85):
```typescript
export function enqueue(item: PendingBirth): void {
  pending.push(item);
  systemLogger.info("spawn-request queue: enqueued", { operation: "spawn_request_enqueued", uuid: item.uuid, hostId: item.hostIdNum, role: item.role });
  workerPromise = workerPromise.then(() => drainOne());
}
```
Synchronous return; chains a drain step onto the worker Promise.

**Drain-error containment pattern** (lines 40-54):
```typescript
while (pending.length > 0 && processBirthFn) {
  const item = pending.shift();
  if (!item) continue;
  try {
    await processBirthFn(item);
  } catch (err) {
    systemLogger.error("spawn-request queue: drain error", { ... });
  }
}
```
A processing exception is caught and logged; the queue never stalls on one bad item.

**Injection pattern** (lines 68-70) + **test-reset pattern** (lines 99-103):
```typescript
export function setProcessBirth(fn: (item: PendingBirth) => Promise<void>): void { processBirthFn = fn; }
export function __resetForTests(): void { pending.length = 0; workerPromise = Promise.resolve(); processBirthFn = null; }
```

**What CHANGES for Phase 116 (per RESEARCH.md Pattern 5 + Pitfall 5):**
- Replace `workerPromise` (single-lane Promise chain) with a **worker pool of N=5 concurrent loops** (D-20). Each loop `await dequeueBlocking()` → `if (isExpired(item)) dropExpiredFailure(item); continue;` → `await tokenBucket.acquire()` → `await processImageGen(item, deps)`.
- Add a `waiters: Array<(item: PendingImageGen) => void>` list so a loop with an empty queue awaits a Promise that resolves when the next `enqueue()` call fires.
- **TTL check happens INSIDE the worker at dequeue** (not at enqueue) — compare `Date.now() > Date.parse(item.requested_at) + 5*60*1000`.
- Keep `setProcessImageGen(fn)` + `__resetForTests()` seams unchanged.

---

### `src/backend/image-gen-requests/worker.ts` (service, request-response)

**Analog:** `src/backend/spawn-requests/worker.ts` (556 lines — extract the writeResponseFile pattern; the birth-orchestration parts do NOT translate)

**Imports pattern** (lines 20-42):
```typescript
import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { isLocalHostId, writeMarkdownFileAtomic } from "../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../ssh/host-resolver.js";
```
Every side-effecting dep goes into `WorkerDeps` for test injection.

**Re-export of parseRequestBody pattern** (lines 54-60): worker.ts re-exports parseRequestBody from parse-request-body.ts so external importers keep working while the heavy transitive graph stays quarantined. Do the same in the Phase 116 worker.

**WorkerDeps interface pattern** (lines 137-146):
```typescript
export interface WorkerDeps {
  connectOneShot: typeof connectOneShot;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  ...
  now: () => Date; // injectable for test determinism
}
export function buildProductionDeps(): WorkerDeps { return { connectOneShot, writeMarkdownFileAtomic, ..., now: () => new Date() }; }
```

**writeResponseFile pattern** (lines 185-248) — **critical, must be copied wholesale**:
```typescript
async function writeResponseFile(item: PendingBirth, deps: WorkerDeps, kind: "success" | "failure", body: string): Promise<void> {
  try {
    if (isLocalHostId(item.hostIdNum)) {
      const targetPath = `$HOME/fleet/spawn-requests/${item.uuid}.${kind}.json`;
      await deps.writeMarkdownFileAtomic(null, targetPath, body);
      return;
    }
    const hostDetails = await deps.resolveHostById(item.hostIdNum, item.userId);
    if (!hostDetails) { /* warn + return */ }
    const conn = await deps.connectOneShot(hostDetails, SSH_CONNECT_TIMEOUT_MS);
    try {
      const targetPath = `$HOME/fleet/spawn-requests/${item.uuid}.${kind}.json`;
      await deps.writeMarkdownFileAtomic(conn, targetPath, body);
    } finally { conn.end(); }
  } catch (err) {
    systemLogger.warn("spawn-request worker: response file write failed", { ... });
  }
}
```
LOCAL vs REMOTE branch on `isLocalHostId(item.hostIdNum)`. Fresh SFTP connection per write (birth-orchestrator manages its own connections, so worker opens its own). Wrap in try/catch — a failed write does NOT re-throw (caller timeout handles it — matches D-15 no-retry, adapts to D-23/D-24 here).

For Phase 116:
- Target path becomes `$HOME/fleet/image-gen-requests/${item.uuid}.${kind}.json`.
- ADD a `writeBinaryFileAtomic(conn, targetPath, buffer)` helper (RESEARCH.md Open Question 2 + Pattern 4) — new tiny helper mirroring `writeMarkdownFileAtomic`'s tmp+mv invariant but using SFTP `writeFile(remotePath, buffer)` instead of a text write. Used to drop the success PNGs at `$HOME/fleet/image-gen-requests/${item.uuid}.success.${i}.png`.
- **Verify the writeMarkdownFileAtomic whitelist accepts the new path** (Pitfall 1). Read `src/backend/claude-session/identity-artifact-reader.ts` allowlist source at the top of implementation. If the whitelist is a static list, add `image-gen-requests/*.{success,failure}.json` before wiring the drop.

**processBirth main-flow pattern** (lines 279-556) — **selectively borrow**:
- The pre-flight structure (log start → malformed short-circuit → pre-flight checks → adapter call → success/failure drop) translates directly.
- **DROP** the pool-pick retry loop, birthIdentity + birthDeps assembly, matrix creds check, host-owner re-verify, mapEndedEventToReason — none apply to image-gen.
- **ADD** the token-bucket.acquire() + adapter call in place of birthIdentity. Concrete shape from RESEARCH.md Q9:
```typescript
async function processImageGen(item: PendingImageGen, deps: WorkerDeps): Promise<void> {
  // 1. Log start
  // 2. Malformed short-circuit (mirror lines 322-328)
  if (item.malformedReason !== undefined) {
    await writeFailureFile(item, deps, { reason: "malformed", message: item.malformedReason });
    return;
  }
  // 3. TTL check (Pitfall 5 — happens HERE, not at scan time)
  if (Date.now() > Date.parse(item.requested_at) + 5 * 60 * 1000) {
    await writeFailureFile(item, deps, { reason: "expired" });
    return;
  }
  // 4. Acquire token bucket (blocks if empty — D-21)
  await deps.tokenBucket.acquire();
  // 5. Call adapter (never throws — returns discriminated union)
  const result = await deps.callOpenAiImageGen(item.body, item.refImage);
  // 6. Drop response file
  if (result.ok) {
    // Write PNGs via writeBinaryFileAtomic, then success.json via writeMarkdownFileAtomic
    ...
  } else {
    await writeFailureFile(item, deps, { reason: result.reason, message: result.message });
  }
}
```

---

### `src/backend/image-gen-requests/scan-orchestrator.ts` (orchestrator, event-driven)

**Analog:** `src/backend/spawn-requests/scan-orchestrator.ts` (298 lines, entire file — mirror the whole structure)

**File-header rationale pattern** (lines 1-48): docstring explains why this module is always-on (independent of fleet-status WS-subscriber lifecycle). Phase 116 gets the SAME rationale — image-gen requests must run independent of browser presence.

**Public types pattern** (lines 60-105):
```typescript
export interface SpawnScanHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}
export interface SpawnScanOrchestratorDeps {
  listSubstrateHosts(): Promise<SpawnScanHostRecord[]>;
  acquireChannel(host: SpawnScanHostRecord): Promise<SshChannel | null>;
  releaseChannel(host: SpawnScanHostRecord, channel: SshChannel): void;
  enqueue(item: PendingBirth): void;
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;
  now(): number;
  scanIntervalMs?: number;
}
```
Rename to `ImageGenScanHostRecord` (or reuse — the type is generic) + `ImageGenScanOrchestratorDeps`. Same shape; `enqueue` takes `PendingImageGen`.

**In-flight guard pattern** (lines 130-138 + 234-252): per-host `Set<string>` with `.add()` → fire-and-forget → `.finally(() => .delete())`. Critical for preventing SSH-session pileup on slow hosts (wilma incident 2026-08-20). Copy verbatim.

**scanOneHost pattern** (lines 148-192):
```typescript
async function scanOneHost(host: SpawnScanHostRecord): Promise<void> {
  let channel: SshChannel | null = null;
  try {
    channel = await deps.acquireChannel(host);
    if (channel === null) { /* warn + return */ }
    const batch = await scanSpawnRequests(host as HostRecord, channel);
    for (const item of batch) { deps.enqueue(item); }
  } catch (err) { /* belt-and-suspenders warn */ }
  finally {
    if (channel !== null) { try { deps.releaseChannel(host, channel); } catch {} }
  }
}
```
For Phase 116: `scanSpawnRequests` becomes `scanImageGenRequests` (a new sibling helper — see below). Between `claim` and `enqueue`, **add a companion-file fetch** for any request whose parsed body has a `ref` field:
```typescript
for (const item of batch) {
  if (item.body.ref) {
    // Fetch companion bytes over the same channel via SFTP (or exec `cat`).
    const refBuffer = await sftpRead(channel, `~/fleet/image-gen-requests/${item.body.ref}`);
    item.refImage = refBuffer;
  }
  deps.enqueue(item);
}
```
Per D-02, the sweep does NOT delete the companion `.ref.*` file — that's the helper script's cleanup responsibility.

**scanAllHosts + start/stop pattern** (lines 199-297): copy verbatim. The `setInterval` + never-throw contract + eager first pass + SIGTERM stop hook all translate directly. Default `scanIntervalMs: 10000` per RESEARCH.md (same as Phase 99 — image-gen isn't more time-sensitive).

**Companion helper: scanImageGenRequests + IMAGE_GEN_SCAN_CMD** (mirror `ssh-poll-orchestrator.ts:1198-1311`):
```typescript
// Mirror lines 1198-1208 — swap folder path only.
const IMAGE_GEN_SCAN_CMD = [
  "cd ~/fleet/image-gen-requests 2>/dev/null || exit 0;",
  "for f in *.json; do",
  "[ -f \"$f\" ] || continue;",
  "base=\"${f%.json}\";",
  "[ ${#base} -eq 36 ] || continue;",
  "tmp=\"$f.$$\";",
  "mv \"$f\" \"$tmp\" 2>/dev/null || continue;",
  "printf '%s\\t' \"$f\"; cat \"$tmp\"; printf '\\n'; rm -f \"$tmp\";",
  "done",
].join(" ");
```
And a `parseImageGenRequestBatch(stdout, hostId): PendingImageGen[]` mirroring `parseSpawnRequestBatch` at lines 1228-1282. Same tab-separated protocol, same UUID_RE guard, same "malformed → enqueue with malformedReason" pattern.

**Where to put IMAGE_GEN_SCAN_CMD:** RESEARCH.md Q2 says NOT in `ssh-poll-orchestrator.ts`. Put it in `image-gen-requests/scan-orchestrator.ts` itself (or a sibling `scan-command.ts` if the file grows too long). Do NOT reuse the SPAWN_REQUESTS_SCAN_CMD export from `ssh-poll-orchestrator.ts` — those are folder-specific.

---

### `src/backend/image-gen-requests/adapter.ts` (service, request-response) — NEW MODULE

**Analog:** `src/backend/database/routes/identity-avatar-batch.ts:378-410` (extract the raw fetch call; leave the avatar route untouched per anti-pattern in RESEARCH.md)

**Imports pattern** (from the avatar route, lines 30-40): pure runtime imports — no SDK. Use the Node 20 built-in `fetch` global.

**Constants pattern** (from lines 55-56):
```typescript
const IMAGE_GEN_TIMEOUT_MS = 60_000; // 60s per image generation
```
Reuse the same 60s timeout (Pitfall 6 — prevents worker-pool starvation on stalled OpenAI calls).

**Core fetch pattern to extract** (lines 378-410):
```typescript
const imgController = new AbortController();
const imgTimeout = setTimeout(() => imgController.abort(), IMAGE_GEN_TIMEOUT_MS);
const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: "gpt-image-1", prompt: draftedPrompt, n: 1, size: "1024x1024", quality: "high" }),
  signal: imgController.signal,
});
clearTimeout(imgTimeout);
if (!imgRes.ok) { throw new Error(`image-gen non-2xx: ${imgRes.status}`); }
const imgData = (await imgRes.json()) as { data: Array<{ b64_json: string }> };
```

**What the adapter ADDS** (RESEARCH.md Example 2 gives the concrete shape):
- Discriminated-union return type: `{ok:true, images:Buffer[], generation_time_ms} | {ok:false, reason:FailureReason, message?:string}` — never throws in normal operation.
- Missing-key branch: `if (!process.env.OPENAI_API_KEY) return {ok:false, reason:"not_configured"}` (per D-25 + Pitfall 4 — this is DIFFERENT from a 401 response).
- Status-code mapping: `429 → rate_limited` (D-23), `5xx → provider_unavailable` (D-24), `400 with error.code === "content_policy_violation" → content_blocked` (D-27), `400 other → malformed`, `AbortError → provider_unavailable`, anything else → `unknown`.
- Multipart-form path for the reference-image (image-to-image) case — POST to `/v1/images/edits` with a multipart body including the `image` file + `prompt`. RESEARCH.md Assumption A3 flags this as needing verification during implementation.
- **Security**: do NOT log the Authorization header or the API key in any error path (RESEARCH.md V13 + Pitfall 4 rationale).

---

### `src/backend/image-gen-requests/token-bucket.ts` (utility, transform) — NEW MODULE, NO ANALOG

**Analog:** None in the codebase. RESEARCH.md Alternatives Considered rejects `bottleneck`, `p-limit`, `p-queue`, `limiter` libs in favor of ~50 lines the project owns outright.

**Concrete shape from RESEARCH.md Example 3:**
```typescript
export interface TokenBucket {
  acquire(): Promise<void>;
  getState(): { tokens: number; capacity: number; refillRatePerSec: number };
}

export function createTokenBucket(rpm: number): TokenBucket {
  const capacity = Math.max(1, Math.floor(rpm * 5 / 60)); // D-21 discretion — RPM × 5s
  const refillPerMs = rpm / 60_000;
  let tokens = capacity;
  let lastRefillMs = Date.now();
  const waiters: Array<() => void> = [];

  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefillMs;
    if (elapsed <= 0) return;
    tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
    lastRefillMs = now;
    while (waiters.length > 0 && tokens >= 1) {
      tokens -= 1;
      waiters.shift()!();
    }
  }
  setInterval(refill, 100).unref(); // periodic refill even without acquire() calls

  return {
    async acquire(): Promise<void> {
      refill();
      if (tokens >= 1) { tokens -= 1; return; }
      await new Promise<void>((resolve) => waiters.push(resolve));
    },
    getState: () => ({ tokens, capacity, refillRatePerSec: rpm / 60 }),
  };
}
```

**Env-var pattern:** `SKYNET_IMAGE_GEN_RPM` (default 30) — read at boot in `starter.ts`, passed to `createTokenBucket(rpm)`. NOT stored in `branding.json` (D-21 anti-pattern — provider-integration config lives in env).

**Add `__resetForTests()`** for test isolation, matching the queue.ts convention.

---

### `src/backend/image-gen-requests/queue.test.ts` (test)

**Analog:** `src/backend/spawn-requests/queue.test.ts` (170 lines total)

**Logger mock pattern** (lines 27-33):
```typescript
vi.mock("../utils/logger.js", () => ({
  systemLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
```

**Helper factory pattern** (lines 39-50):
```typescript
function makePendingBirth(overrides?: Partial<PendingBirth>): PendingBirth {
  return { hostId: "42", hostIdNum: 42, uuid: "test-uuid-0001-...", role: "coordinator", task: "do a thing", requested_at: "2026-09-10T00:00:00Z", userId: "user-abc", ...overrides };
}
```

**Test surface** (docblock lines 6-12): isEmpty on fresh queue → enqueue+drain → serial invocation → error-in-processBirth doesn't stall queue → enqueue returns void.

For Phase 116: add TTL-expiry test (enqueue an item with `requested_at` 6 min old → worker drops `expired` failure and does NOT call adapter, does NOT acquire token), and worker-pool parallelism test (enqueue 10 items → 5 concurrent adapter calls in-flight simultaneously). Use `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)` for timing assertions.

---

### `src/backend/image-gen-requests/worker.test.ts` (test)

**Analog:** `src/backend/spawn-requests/worker.test.ts` (999 lines — model the mock scaffolding + WorkerDeps injection)

**Mock-heavy scaffolding pattern** (lines 60-100):
```typescript
vi.mock("../claude-session/identity-artifact-reader.js", async (importActual) => {
  const actual = await importActual<typeof import("../claude-session/identity-artifact-reader.js")>();
  return { ...actual, isLocalHostId: vi.fn().mockReturnValue(false) };
});
vi.mock("../utils/logger.js", () => { const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() }; return { systemLogger: mockLogger, ... }; });
vi.mock("../database/db/index.js", () => ({ getDb: vi.fn(() => mockDb) }));
```
Partial-mock via `importActual` when tests need to flip ONE export.

**Injectable WorkerDeps pattern:** build a `makeTestDeps()` helper that returns a full `WorkerDeps` with `vi.fn()` mocks for every side-effecting dependency.

**Test surface for Phase 116** (docblock template):
- adapter success → success.json + N companion PNGs dropped
- adapter `{reason:"rate_limited"}` → failure.json only, no PNGs
- adapter `{reason:"not_configured"}` → failure.json
- item with `refImage: Buffer` → adapter called with buffer arg
- item TTL-expired at dequeue → failure.json `{reason:"expired"}` + NO adapter call + NO token acquire
- item.malformedReason set → failure.json `{reason:"malformed", message}` + NO adapter call

---

### `src/backend/image-gen-requests/scan-orchestrator.test.ts` (test)

**Analog:** `src/backend/spawn-requests/scan-orchestrator.test.ts` (382 lines)

**Mock pattern for the scan helper** (lines 35-45):
```typescript
vi.mock("../fleet-status/ssh-poll-orchestrator.js", () => ({ scanSpawnRequests: vi.fn(async () => []) }));
vi.mock("./queue.js", () => ({ enqueue: vi.fn() }));
```

**Test channel factory** (lines 51-53):
```typescript
function makeChannel(): SshChannel { return { exec: vi.fn(async () => "") }; }
```

**Fake-timers test pattern:** the analog uses `vi.useFakeTimers()` + captures the setInterval callback via `setIntervalMock` for direct invocation — see analog test lines 67-100. Copy this pattern.

**Test surface** (docblock lines 4-17): S1-S3 (start runs initial + installs interval), T1-T2 (interval tick fires + tick count), E1-E3 (enqueue called per PendingBirth), G1-G2 (per-host in-flight guard), F1-F2 (never-throw contract), L1-L2 (stop clears interval + post-stop no-op). All translate directly to Phase 116 with `scanImageGenRequests` in place of `scanSpawnRequests`.

For Phase 116: add coverage for the companion-file fetch step (item with `ref` field → sftpRead mock called → `refImage` populated on the enqueued item).

---

### `src/backend/image-gen-requests/adapter.test.ts` (test) — NEW

**Analog:** No exact match; use vitest fetch-stubbing idiom.

**Pattern:** `vi.stubGlobal("fetch", vi.fn())` at the top; per-test set `fetch.mockResolvedValueOnce({ok:true, json:async () => ({data:[{b64_json:"..."}]}), status:200})`.

**Test surface:**
- 200 OK → `{ok:true, images: [Buffer], generation_time_ms: number}`
- 429 → `{ok:false, reason:"rate_limited"}`
- 500 → `{ok:false, reason:"provider_unavailable"}`
- 400 with `error.code === "content_policy_violation"` → `{ok:false, reason:"content_blocked", message}`
- 400 without that code → `{ok:false, reason:"malformed", message}`
- AbortError (timeout) → `{ok:false, reason:"provider_unavailable", message:"openai timeout"}`
- Missing `OPENAI_API_KEY` → `{ok:false, reason:"not_configured"}` — NO fetch call made
- With `refImage: Buffer` → fetch called against `/v1/images/edits` with multipart body

---

### `src/backend/image-gen-requests/token-bucket.test.ts` (test) — NEW

**Analog:** No exact match; use `vi.useFakeTimers()` idiom (see scan-orchestrator.test.ts:80-100 for the fake-timers pattern in this codebase).

**Test surface:**
- `createTokenBucket(60)` → capacity = 5 (60 × 5 / 60), initial tokens = 5
- Consecutive acquires drain tokens; 6th blocks
- `vi.advanceTimersByTime(1000)` → 1 refilled token → blocked waiter resolves
- Multiple waiters resolve in FIFO order
- Rate-limit enforcement: over 60 seconds with `rpm=60`, at most 60 acquires complete

---

### `src/backend/starter.ts` (MODIFY, config)

**Analog:** `starter.ts:1058-1184` (the spawn-scan orchestrator wiring block)

**Wiring block pattern** (lines 1058-1184, 126 lines) — mirror this block for image-gen:
- Dynamic import of `createImageGenScanOrchestrator` from `./image-gen-requests/scan-orchestrator.js`.
- Own per-host `hostClients` map (`imageGenScanHostClients`) — separate from spawn-scan + fleet-status + substrate maps.
- `acquireChannel` closure that reuses ssh2 clients, uses `getHostSemaphore(host.id)` (shared 8-slot pool per host).
- `releaseChannel` no-op.
- Wire the enqueue to `enqueueImageGenRequest` from `./image-gen-requests/queue.js`.
- Fire-and-forget `.start()` with catch-warn on rejection.
- SIGTERM stop hook that calls `.stop()` + drains the hostClients map.

**Additional wiring at boot time (before scan-orch instantiation):**
- Import `createTokenBucket` from `./image-gen-requests/token-bucket.js`.
- Read `process.env.SKYNET_IMAGE_GEN_RPM ?? "30"` → parseInt → pass to `createTokenBucket(rpm)`.
- Import `buildProductionDeps` from `./image-gen-requests/worker.js`, but INJECT the tokenBucket instance into the deps so worker.ts uses the single boot-time instance (not a per-call one).
- Call `setProcessImageGen((item) => processImageGen(item, imageGenWorkerDeps))` mirroring lines 746-747 for spawn-request.

**Placement:** IMMEDIATELY AFTER the spawn-scan block (starter.ts:1184) — same DB-readiness precondition, same session-less enumeration primitive, cleanly isolated SSH-client pool.

---

### `src/backend/distributor/catalog.ts` (MODIFY, config)

**Analog:** Two existing catalog rows demonstrate both shapes needed here.

**Row 1 — skill (mirror `agent-relay-skill` at lines 248-253):**
```typescript
{
  slug: "image-gen-skill",
  sourceKind: "bundled",
  bundledPath: "/app/fleet-substrate/skills/image-gen/SKILL.md",
  installPath: "~/.claude/skills/image-gen/SKILL.md",
  restartHook: null,
},
```

**Row 2 — helper script (mirror `wakeup-scheduler` at lines 319-325 — restartHook:null since image-gen is invoked on-demand, not a daemon):**
```typescript
{
  slug: "image-gen-helper",
  sourceKind: "bundled",
  bundledPath: "/app/fleet-substrate/scripts/image-gen",
  installPath: "~/.local/bin/image-gen",
  restartHook: null,
},
```

**Placement:** Add both rows to `FLEET_SUBSTRATE_CATALOG` (line 215+). Skill row goes with the single-file skills block (lines 262-305, after `role-skill`). Helper-script row goes with the helper-scripts block (lines 307-359, after `install-usage-reporter`).

**Dockerfile:** No changes — `COPY --chown=node:node substrate /app/fleet-substrate` at `docker/Dockerfile:80` already picks up new files under `substrate/`.

---

### `substrate/skills/image-gen/SKILL.md` (NEW)

**Analog:** `substrate/skills/id/SKILL.md` (77-line prefix shows the frontmatter + prose shape) + `substrate/skills/bounty/SKILL.md` (18-line file shows a concise on-demand-loaded shape)

**Frontmatter pattern** (from `id/SKILL.md:1-5`):
```markdown
---
name: image-gen
description: Generate images from a prompt via the fleet's image provider. Invoke as `image-gen "prompt"`.
distributed: true
---
```
Do NOT use bounty's `$ARGUMENTS` variable — that's a slash-command pattern (`/bounty <thing>`), and image-gen is invoked as an executable helper, not a slash command.

**Body structure** (per CONTEXT.md D-17/D-18):
1. `# Title` + one-line "what this is" (matches id/SKILL.md line 6-7 shape).
2. **IMMEDIATELY** the PHI directive block — D-17 exact wording (locked):
   ```markdown
   ### ⚠️ Your prompt leaves this deployment

   Prompts are sent to a third-party image provider and leave this deployment's boundary. You MUST NOT include PHI, patient identifiers, or content your deployment's compliance boundary forbids sending to a third-party API. Paraphrase specifics; if unsure, don't send it.
   ```
3. Invocation examples — matching `image-gen "a cat" --size 1024x1024 --n 2 --quality high --out /tmp/cat.png` and the `--json <file> --ref <path>` variant per D-13.
4. Inline echo of the PHI reminder (D-18): *"Before invoking: confirm the prompt contains no PHI or compliance-restricted content. See the directive at the top of this file."*
5. Response shape section — describe the stdout/stderr split per D-14 (paths on stdout, metadata on stderr; exit 0 on success, non-zero + failure JSON on stderr on failure).
6. Failure handling section — one-liner per D-19 for `content_blocked`: *"If you get `content_blocked`, the provider refused the prompt. Rephrase and retry, or tell the user the request isn't something the provider will generate."* Plus a table of the 7 failure reasons (D-27) with the caller action per reason.

**Prose voice:** match `id/SKILL.md`'s direct-to-agent second-person voice ("You do X"). Keep prose crisp — the file is loaded into an agent's context at invocation time and every token costs.

---

### `substrate/scripts/image-gen` (NEW, bash helper)

**Analog:** `substrate/scripts/agent-supervisor.sh` (bash header conventions + config-file idiom + logging idiom) — but a much shorter file (~100 lines vs. 1000+).

**Shebang + header pattern** (agent-supervisor.sh:1-35):
```bash
#!/usr/bin/env bash
# image-gen — file-drop broker helper for OpenAI image generation.
#
# Canonical copy lives in the Skynet repo at substrate/scripts/image-gen and is
# distributed to every managed host by the fleet-substrate distributor (see
# src/backend/distributor/catalog.ts). Installed per-box at ~/.local/bin/image-gen.
# Do NOT hand-edit the installed copy — edits are made in the repo and land on
# all boxes via the next distributor sweep.
#
# Usage:
#   image-gen "a cat"                                             # simple
#   image-gen "a portrait" --size 1024x1024 --n 2 --quality high  # flags
#   image-gen --json /path/to/full-request.json --ref /path/to/ref.png  # full-payload
```

**set-flags pattern** (agent-supervisor.sh:35): `set -uo pipefail` — `-e` intentionally NOT set (some git/date subcommands' non-zero exits should not kill the script).

**Full-body scaffold:** already fully drafted in RESEARCH.md Example 4 (lines 428-527) — that skeleton is the executable spec, planner adapts it verbatim with minor tuning.

**Critical patterns the helper MUST implement (per RESEARCH.md Pitfalls + CONTEXT.md decisions):**
- **Write `.ref.<ext>` companion FIRST, then `.json` last** (Pitfall 3 — write-order = commit-order so the sweep never sees a `.json` without its `.ref.*`).
- **Atomic write via `.tmp.$$` + `mv`** for both request and companion files (D-10).
- **Poll cadence:** 500ms for the first 30s, then 2s after (RESEARCH.md discretion recommendation; also documented in CONTEXT.md Claude's Discretion section).
- **5-min timeout** (D-16) → synthesize `{"reason":"expired"}` on stderr + exit 1.
- **Move PNGs OUT** of `~/fleet/image-gen-requests/` to `~/fleet/image-gen-outputs/<uuid>-<i>.png` (D-15 — wire folder stays tidy).
- **Cleanup wire files** on happy path: `rm -f "$success_file" "$req_path" "$REQ_DIR/$uuid.ref."*` (D-05 — helper cleans its own response files, Skynet doesn't auto-reap).
- **Stdout/stderr split** per D-14: paths to stdout, success JSON to stderr for debug.
- **`uuidgen` with `/proc/sys/kernel/random/uuid` fallback** (RESEARCH.md Assumption A1).
- **jq preferred, printf fallback** for JSON assembly (RESEARCH.md Assumption A2).

---

### `substrate/scripts/tests/image-gen.test.sh` (NEW, bash test driver)

**Analog:** `substrate/scripts/tests/fleet-status-sweep.test.sh` (the drop-in test-driver template for hermetic bash tests in this codebase)

**Header + path-resolution pattern** (lines 1-38):
```bash
#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for the image-gen helper (Phase 116).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/substrate/scripts/image-gen"
[ -f "$HELPER" ] || { printf 'FATAL: helper not found at %s\n' "$HELPER" >&2; exit 1; }
```

**Fixture + cleanup pattern** (lines 45-52):
```bash
FIXTURE=""
FIXTURE=$(mktemp -d)
cleanup() { [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"; }
trap cleanup EXIT
```
Every test builds a scratch tree at `$FIXTURE` and runs the helper with `HOME="$FIXTURE"` — the real `~/fleet/image-gen-requests/` is never touched.

**Test-state + assert helpers pattern** (lines 54-72):
```bash
PASS=0; FAIL=0; FAILURES=()
fail() { local msg="${1:-unknown failure}"; FAILURES+=("${CURRENT_TEST:-unknown}: $msg"); FAIL=$((FAIL + 1)); }
assert_eq() { local expected="$1" actual="$2" msg="${3:-assert_eq}"; if [ "$expected" != "$actual" ]; then fail "$msg: expected='$expected' got='$actual'"; fi; }
```

**Test surface for Phase 116:**
- Test 1: `image-gen "prompt"` writes `<uuid>.json` at `$FIXTURE/fleet/image-gen-requests/` with the correct body.
- Test 2: `image-gen "prompt" --ref /tmp/fake.png` writes `<uuid>.ref.png` BEFORE `<uuid>.json` (verify via stat mtime or file existence at each step).
- Test 3: Timeout path — no response file appears → helper exits non-zero after ~2s (patch `TIMEOUT_SEC` via env override) with `{"reason":"expired"}` on stderr.
- Test 4: Success path — plant a `<uuid>.success.json` + `<uuid>.success.0.png` in the fixture before running → helper prints the moved path on stdout, exits 0, cleanup deletes wire files.
- Test 5: Failure path — plant a `<uuid>.failure.json` with `{"reason":"content_blocked"}` → helper prints JSON to stderr, exits non-zero.

**End-to-end integration test (RESEARCH.md Q8, Q11):** distinct from the helper unit tests above. Optional — planner may skip if the vitest suite already covers the wire schema. If included, mirror Phase 99's D-22 end-to-end test: drop a request file, tick the scanner (mock listSubstrateHosts + acquireChannel), mock fetch → assert `<uuid>.success.json` + `<uuid>.success.0.png` land at the expected paths with the expected schema.

## Shared Patterns

### Logging pattern (applies to every backend TS module)

**Source:** `spawn-requests/worker.ts:308-315` + `spawn-requests/queue.ts:78-83` + `scan-orchestrator.ts:153-160`

**Standard call shape:**
```typescript
systemLogger.info("image-gen worker: processing request", {
  operation: "image_gen_worker_start",
  uuid: item.uuid,
  hostId: item.hostIdNum,   // ALWAYS number for LogContext (Pitfall in spawn-requests worker.ts:81)
  ...taskSpecificFields,
});
```
Every meaningful state transition gets a `systemLogger.info` (per CONTEXT.md standing directive). Every failure surface gets a `systemLogger.warn`. Structured second-arg object always includes `operation:` as a stable key (log-search-friendly).

**Naming convention for the `operation` key:** `image_gen_<phase>_<event>` (mirrors `spawn_request_*` prefix). Examples: `image_gen_enqueued`, `image_gen_worker_start`, `image_gen_openai_call_start`, `image_gen_openai_call_done`, `image_gen_response_dropped`, `image_gen_ttl_expired`, `image_gen_scan_exec_complete`.

### Error-handling pattern (applies to all worker + scan-orchestrator code)

**Source:** `spawn-requests/scan-orchestrator.ts:171-191` + `spawn-requests/worker.ts:239-248`

**Belt-and-suspenders try/catch at every top-level async boundary** — even when the inner code is documented as never-throwing:
```typescript
try {
  await someOperation();
} catch (err) {
  systemLogger.warn("<subsystem>: <op> threw unexpectedly (should be unreachable)", {
    operation: "<subsystem>_<op>_threw",
    ...ctx,
    error: err instanceof Error ? err.message : "unknown",
  });
}
```
**Never re-throw from a top-level async boundary.** The queue MUST NOT stall on one bad item; the scan MUST NOT stall on one bad host. A failed response-file write is logged but not thrown (per D-15 in Phase 99 = D-23/D-24 in Phase 116 — no worker-side retry).

### Dep-injection pattern (applies to all worker + scan-orchestrator code)

**Source:** `spawn-requests/worker.ts:137-167` + `spawn-requests/scan-orchestrator.ts:76-105`

Every side-effecting dep (SSH, DB, timers, `Date.now()`, `fetch`, `writeMarkdownFileAtomic`) goes into a `WorkerDeps` / `<Module>Deps` interface. Prod wiring in `buildProductionDeps()`; tests override every field via `buildTestDeps()` returning `vi.fn()` mocks. No direct module-level side-effects in worker/scan-orchestrator code.

### Test-mock pattern (applies to all `.test.ts` files)

**Source:** `spawn-requests/worker.test.ts:64-100`

- `vi.mock("../utils/logger.js", () => ({ systemLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() } }))` — every test file that transitively imports code that logs.
- `vi.mock` with `async (importActual)` partial-override for modules whose ONE export needs mocking (like `isLocalHostId`) while preserving all others.
- Test-only reset seams: `__resetForTests()` on every module with mutable state, called in `beforeEach`.

### Atomic-write pattern (applies to helper script + worker response file writes)

**Source:** All request/response files use `.tmp.$$` → `mv` for atomic writes (D-10 in Phase 116; matches Phase 99 convention throughout `spawn-requests/`)

**Shell (helper side):**
```bash
cp "$src" "$dest.tmp.$$" && mv "$dest.tmp.$$" "$dest"
```

**TypeScript (backend side):** delegate to `writeMarkdownFileAtomic(conn, targetPath, contents)` (for JSON) or the new `writeBinaryFileAtomic(conn, targetPath, buffer)` (for PNGs — mirror the same tmp+mv invariant).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/backend/image-gen-requests/token-bucket.ts` | utility | transform | No token-bucket implementation exists in the codebase — hand-rolled ~50 lines per RESEARCH.md Example 3 |
| `src/backend/image-gen-requests/adapter.ts` (only PARTIAL — the fetch pattern has an analog but no dedicated OpenAI adapter module exists) | service | request-response | Extract-and-copy from `identity-avatar-batch.ts:378-410`, wrap in never-throw discriminated-union interface |
| Response-PNG binary SFTP writer | utility | file-I/O | No `writeBinaryFileAtomic` exists yet (RESEARCH.md Open Question 2). Add tiny new helper mirroring `writeMarkdownFileAtomic`'s tmp+mv invariant using SFTP `writeFile(path, buffer)` |

## Metadata

**Analog search scope:**
- `src/backend/spawn-requests/**` (all 7 modules + tests — Phase 99 pattern origin)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:1160-1311` (scan command + parser template)
- `src/backend/database/routes/identity-avatar-batch.ts:1-410` (OpenAI fetch call to extract)
- `src/backend/distributor/catalog.ts` (all 26+ existing entries — schema + row-shape examples)
- `src/backend/starter.ts:740-1184` (worker wiring + scan-orch wiring templates)
- `substrate/skills/**` (id/, bounty/ for frontmatter + prose shapes)
- `substrate/scripts/agent-supervisor.sh:1-80` (bash header + config-file conventions)
- `substrate/scripts/tests/fleet-status-sweep.test.sh` (hermetic bash test driver)

**Files scanned:** 14 primary analog files + 8 supporting reference files

**Pattern extraction date:** 2026-09-18
