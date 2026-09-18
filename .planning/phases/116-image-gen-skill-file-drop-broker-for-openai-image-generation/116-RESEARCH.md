# Phase 116: image-gen-skill — file-drop broker for OpenAI image generation — Research

**Researched:** 2026-09-18
**Domain:** File-drop broker (backend TS + shell helper) — clone of Phase 99 spawn-request pattern with OpenAI adapter + token bucket
**Confidence:** HIGH (all findings cited from repo code; no ecosystem/library guesswork beyond what CONTEXT already locked)

## Summary

Phase 116 clones the Phase 99 spawn-request broker architecture wholesale, swapping the identity-birth backend action for an OpenAI `gpt-image-1` API call. Every architectural question the planner will ask is answered by an existing file in the tree — Phase 99 code is remarkably close to what Phase 116 needs. The delta from Phase 99 is: (a) a token bucket rate limiter and 5-worker concurrency pool (Phase 99 is serialized), (b) an image-file companion transport on both request and response sides, (c) a 5-min TTL on queue items, and (d) a helper shell script distributed via the fleet-substrate catalog.

**Primary recommendation:** Clone `src/backend/spawn-requests/` → `src/backend/image-gen-requests/` filename-for-filename (7 modules), reuse the exact atomic-mv scan shell template from `ssh-poll-orchestrator.ts:1198-1208` (adapting the folder path), stand up a new `image-gen-scan-orchestrator.ts` mirroring `scan-orchestrator.ts` at a slower tick (~10s), replace the serialized Promise-chain queue with a bounded worker-pool + token bucket, hand-roll a ~50-line token bucket (no library), extract the raw-fetch call from `identity-avatar-batch.ts:384-408` into `adapter.ts`, and add 2 catalog rows (skill dir + helper script).

## User Constraints (from CONTEXT.md)

### Locked Decisions

All 28 decisions D-01 through D-28 in `116-CONTEXT.md` are locked. Highlights the planner MUST honor:

- **D-01** Piggyback on the existing per-host sweep pattern (no new SSH plumbing); the concrete home is a NEW always-on scan orchestrator (mirroring `spawn-requests/scan-orchestrator.ts`), not a piggyback on `ssh-poll-orchestrator.ts` — see Q2 below. [VERIFIED: repo code — `src/backend/spawn-requests/scan-orchestrator.ts` docstring lines 1-48]
- **D-02** Single atomic read-and-delete exec per tick per host (mv-based claim).
- **D-06** Request file `~/fleet/image-gen-requests/<uuid>.json`, filename is primary key, unrecognized params → `reason: malformed`.
- **D-07** Reference image = companion `<uuid>.ref.<ext>` file, NOT base64.
- **D-08** Success at `<uuid>.success.json` + companion PNGs at `<uuid>.success.<i>.png`.
- **D-09** Failure at `<uuid>.failure.json` with `{reason, message?}`.
- **D-20** Worker concurrency N=5.
- **D-21** Token bucket, env `SKYNET_IMAGE_GEN_RPM` (default 30), capacity = RPM × 5s.
- **D-22** Queue TTL = 5 min from `requested_at`; on expiry, drop `failure.json` reason=`expired`.
- **D-23/D-24** No retries in worker.
- **D-25/D-26** Reuse `process.env.OPENAI_API_KEY`; model locked to `gpt-image-1`.
- **D-27** Failure enum locked to 7 values: `content_blocked | rate_limited | provider_unavailable | not_configured | malformed | expired | unknown`.
- **D-28** Executor stops at code + commit + tests green; NO push/build/compose.

### Claude's Discretion

- Number of plans + wave breakdown (2-5 plans, 2-3 waves plausible).
- Exact bucket capacity — recommendation locked at RPM × 5s.
- Logging instrumentation at every meaningful state transition.
- Atomic mv shell shape (recommendation: mirror Phase 99's inline for-loop exactly — see Q2).
- Backend module layout (recommendation: mirror `src/backend/spawn-requests/` filename-for-filename).
- Helper script poll cadence (recommendation: 500ms for first 30s, then 2s).

### Deferred Ideas (OUT OF SCOPE)

Second provider path (Bedrock); per-caller attribution/metering; skill-side post-processing; avatar-flow bleed-in; caller-selectable model; multi-provider-per-host; job-handle async pattern; cross-provider param abstraction; admin surface for provider swap; auto-reaper for orphaned response files; broker-pattern factoring; per-host quota. **Do not research or propose alternatives to any of these.**

## Project Constraints (from CLAUDE.md)

`/home/ubuntu/skynet-nebula/CLAUDE.md` does not exist. Global instructions from `~/.claude/CLAUDE.md` apply (user preferences; not code-shaping). No project-level CLAUDE.md constraints to enforce.

## Phase Requirements

Requirements are captured in `116-CONTEXT.md` decision list — no separate REQUIREMENTS.md row IDs for this phase. Each `D-NN` acts as the requirement token the planner maps tasks against.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Request drop + poll for response | Managed-host shell (helper) | — | Filesystem is the trust boundary (D-06 shape) |
| Skill body (agent-facing docs + PHI directive) | Managed-host `.claude/skills/` markdown | — | Loaded by agent harness at invocation time |
| Per-host scan + atomic claim | Backend TS — new `image-gen-scan-orchestrator.ts` | Existing SSH channel pool | Independent lifecycle from fleet-status per Phase 99 scan-orchestrator precedent |
| Queue + TTL enforcement | Backend TS — new `queue.ts` | — | In-memory only (D-06 in Phase 99, adopted here) |
| Worker pool (5 concurrent) | Backend TS — new `worker.ts` | Token bucket dep | Node event-loop with parallel awaits — see Q9 |
| Token bucket rate limit | Backend TS — new `token-bucket.ts` | — | Hand-rolled ~50 lines (D-21) |
| OpenAI HTTP call | Backend TS — new `adapter.ts` | `fetch` global | Raw fetch, no SDK (matches `identity-avatar-batch.ts`) |
| Response file drop (JSON + PNGs) | Backend TS — worker via SFTP over existing SSH channel | `writeMarkdownFileAtomic` for JSON, new binary writer for PNG | D-11 pattern from Phase 99 |
| Skill + helper distribution | Fleet-substrate distributor via `catalog.ts` rows | Container image `/app/fleet-substrate/` | Only mechanism per D-28 anti-hand-patching rule |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node `fetch` (built-in) | Node 20+ | OpenAI HTTP call | Existing avatar route uses raw fetch, not the `openai` SDK — matches convention. [VERIFIED: `identity-avatar-batch.ts:384-408` uses `fetch("https://api.openai.com/v1/images/generations", …)`; `npm ls openai` returns nothing in package.json.] |
| `vitest` (already installed) | ^4.1.8 | Test framework | Repo-wide standard — `package.json:20-24`. [VERIFIED: `package.json`] |
| `bash` (managed-host baseline) | POSIX-ish | Helper script language | Substrate scripts are mostly `.sh` or `.py`; agent-supervisor.sh + install-usage-reporter.sh + usage-reporter.sh are precedent. [VERIFIED: `substrate/scripts/` listing] |
| `uuidgen` (managed-host baseline) | coreutils / util-linux | UUID generation in helper | Portable on Linux + macOS (util-linux + BSD both ship `uuidgen`); no external dependency needed. [ASSUMED: portable across the managed-host baseline — Ubuntu 22/24 hosts all have util-linux `uuidgen`.] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `writeMarkdownFileAtomic` (repo internal) | — | Atomic tmp+mv JSON writes via SFTP | For success/failure JSON drops (matches Phase 99 worker.ts:230). [VERIFIED: `src/backend/claude-session/identity-artifact-reader.ts` — used at spawn-requests/worker.ts:230] |
| `connectOneShot` / `execCommand` (repo internal) | — | SSH channel primitives | For scan exec + SFTP writes (matches spawn-requests worker.ts:224). [VERIFIED: `src/backend/ssh/ssh-one-shot.ts` + `src/backend/ssh/tmux-helper.ts`] |
| `listSubstrateHosts` (repo internal) | — | Session-less host enumeration for scan orchestrator | Exact reuse from Phase 99 scan-orchestrator wiring in `starter.ts:1062-1064` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled token bucket | `bottleneck`, `p-limit`, `p-queue`, `limiter` npm libs | Adds dependency + supply-chain risk for ~50 lines of code the project can own outright. Repo prefers minimizing deps per rate-limiter avoidance in existing code. Skip the library. |
| Raw fetch | `openai` npm SDK | SDK adds ~400KB + full-featured retry/backoff/streaming semantics we explicitly reject (no-retry per D-23/D-24; no streaming per fleet-wide directive). Raw fetch matches `identity-avatar-batch.ts`. |
| Bash helper | Python helper | Python is available on managed hosts (substrate has 6 py scripts), but bash is lighter for a poll-loop with no data structures. Bash is the correct pick for this workload. |

**Installation:** Nothing to install — all deps already present.

**Version verification:** Not applicable — no new npm packages.

## Package Legitimacy Audit

No external packages installed in this phase. All backend deps (`fetch`, `vitest`, existing repo internals) are pre-existing. Slopcheck N/A. Disposition: **no packages to audit.**

## Architecture Patterns

### System Architecture Diagram

```
[Agent inside harness on managed host]
    │
    │  invokes skill body
    ▼
[substrate/skills/image-gen/SKILL.md] ── calls ──▶ [~/.local/bin/image-gen helper]
                                                          │
                                    (1) mkdir + atomic write .tmp → mv
                                                          ▼
                                          ~/fleet/image-gen-requests/<uuid>.json
                                          ~/fleet/image-gen-requests/<uuid>.ref.png  (optional)
                                                          │
                                                          │  every ~10s tick
                                                          ▼
[Skynet backend: image-gen scan-orchestrator]
    │
    │  per-host: atomic read+mv (batched exec, one round-trip)
    ▼
[image-gen queue (in-memory FIFO + TTL)]
    │
    │  5 workers race dequeue
    ▼
[worker acquires token from token-bucket] ─── blocks if bucket empty ───┐
    │                                                                    │
    │  TTL check: now < requested_at + 5min?                              │
    │  NO → drop <uuid>.failure.json reason:"expired"                     │
    │  YES ↓                                                              │
    ▼                                                                    │
[adapter: POST api.openai.com/v1/images/generations]  ◀──── token ───────┘
    │
    │  200 OK  → parse b64_json[] → PNG buffers
    │  4xx/5xx → map to failure reason
    ▼
[SFTP over existing SSH channel to origin host]
    │
    ├─ success: <uuid>.success.<i>.png + <uuid>.success.json
    └─ failure: <uuid>.failure.json
                                                          │
                                                          ▼
[helper polls same folder]
    │
    │  moves PNGs → ~/fleet/image-gen-outputs/<uuid>-<n>.png
    │  deletes wire files (request tmp, response JSON, response PNGs)
    │  prints paths to stdout, metadata to stderr
    ▼
[Agent gets paths]
```

### Recommended Project Structure

```
src/backend/image-gen-requests/
├── types.ts                       # ImageGenRequestBody, PendingImageGen, SuccessResponse, FailureResponse, FailureReason enum
├── parse-request-body.ts          # pure validation (mirrors spawn-requests/parse-request-body.ts)
├── token-bucket.ts                # hand-rolled bucket (~50 lines)
├── queue.ts                       # in-memory FIFO + TTL check on dequeue
├── worker.ts                      # 5 workers race dequeue, acquire token, call adapter, drop response files
├── adapter.ts                     # raw fetch to api.openai.com/v1/images/generations + /edits
├── scan-orchestrator.ts           # always-on per-host scan tick (mirror spawn-requests/scan-orchestrator.ts)
├── *.test.ts                      # one per module
substrate/skills/image-gen/SKILL.md
substrate/scripts/image-gen        # bash helper (no extension, matches agent-supervisor / wakeup-scheduler)
```

### Pattern 1: Mirror Phase 99 filename-for-filename
**What:** For each file in `src/backend/spawn-requests/`, create a same-named sibling in `src/backend/image-gen-requests/`.
**When to use:** Always. Every abstraction the planner might invent is worse than the drop-in clone, because Phase 99 has already survived code review + integration + production.
**Example:**
```typescript
// src/backend/image-gen-requests/queue.ts — mirrors spawn-requests/queue.ts:20-103
// but replaces Promise-chain serialization with a worker-pool + TTL check.
```

### Pattern 2: Atomic mv-based scan exec (canonical)
**Source:** `src/backend/fleet-status/ssh-poll-orchestrator.ts:1198-1208`
```bash
cd ~/fleet/image-gen-requests 2>/dev/null || exit 0;
for f in *.json; do
  [ -f "$f" ] || continue;
  base="${f%.json}";
  [ ${#base} -eq 36 ] || continue;           # UUID length guard rejects .success.json/.failure.json/.ref.png
  tmp="$f.$$";
  mv "$f" "$tmp" 2>/dev/null || continue;    # atomic claim; loser skips
  printf '%s\t' "$f"; cat "$tmp"; printf '\n'; rm -f "$tmp";
done
```
**Adaptation for Phase 116:** identical shell, changing only the folder path. Pull companion `.ref.*` bytes via a follow-up SFTP read triggered by the parsed `ref` field in the JSON body — do NOT try to batch companion bytes into the same tab-separated stdout (binary content + newlines break the parser). CONTEXT.md D-02 says the ref file becomes an orphan on the host disk (helper cleans it up on timeout/success) — the sweep does NOT delete it.

### Pattern 3: Scan orchestrator (always-on, session-less)
**Source:** `src/backend/spawn-requests/scan-orchestrator.ts` (298 lines, complete) + wiring in `starter.ts:1058-1149`.
Mirror the entire structure. Only changes:
- Interval: `scanIntervalMs: 10000` is fine (identical to spawn-requests — image-gen isn't more time-sensitive than spawn).
- Function names: `scanImageGenRequests` in place of `scanSpawnRequests`.
- Enqueue target: `image-gen-requests/queue.enqueue` instead of `spawn-requests/queue.enqueue`.
- Companion ref-file fetch: added to `scanOneHost` between claim and enqueue.

### Pattern 4: Response file drop (SFTP over fresh one-shot channel)
**Source:** `spawn-requests/worker.ts:184-248` (`writeResponseFile`).
Local-vs-remote branching + isLocalHostId check + `writeMarkdownFileAtomic(conn, targetPath, body)` — all reused verbatim. For PNGs (new in Phase 116), extend the pattern: instead of `writeMarkdownFileAtomic`, use SFTP `sftp.writeFile(remotePath, buffer)` — the existing SSH channel already has SFTP capability. Recommendation: add a small `writeBinaryFileAtomic` helper (write to `.tmp` via SFTP put, then SSH exec `mv $tmp $final`) matching the atomic-write invariant.

### Pattern 5: Worker-pool with concurrency N
**Source:** New — Phase 99 is serialized (N=1). For N=5, replace `spawn-requests/queue.ts:21`'s `workerPromise = workerPromise.then(...)` chain with a fixed-size pool. Concrete shape (Q9 details):
```typescript
// worker-pool.ts (~30 lines)
const WORKERS = 5;
async function workerLoop(): Promise<void> {
  while (true) {
    const item = await dequeueBlocking();  // await new item or Promise.resolve() if TTL-expired one available
    await token-bucket.acquire();
    await processImageGen(item, deps);
  }
}
export function startPool(): void {
  for (let i = 0; i < WORKERS; i++) void workerLoop();
}
```

### Anti-Patterns to Avoid

Copied straight from `116-CONTEXT.md` <code_context> section:

- **Do NOT introduce a persistent queue** — in-memory only.
- **Do NOT retry failed calls in the worker** — all retries are caller decisions.
- **Do NOT modify `identity-avatar-batch.ts`** — extract-and-copy the fetch call; leave the avatar route intact.
- **Do NOT expose model choice as a request param in v1** — locked to `gpt-image-1`.
- **Do NOT silently drop unrecognized caller params** — reject with `reason: malformed` + descriptive message.
- **Do NOT introduce message streaming** — anywhere.
- **Do NOT hand-patch fleet-substrate-managed content on managed hosts** — only via `catalog.ts`.
- **Do NOT push / docker build / docker compose up** — executor stops at code + commit + tests green.
- **Do NOT put throttle config in `branding.json`** — provider-integration config lives in env.
- **Do NOT use `openai` npm SDK** — matches existing avatar route's raw-fetch convention.
- **Do NOT use worktrees** — `config.json:workflow.use_worktrees: false`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes to remote host | Custom SFTP write + fsync flow | `writeMarkdownFileAtomic` (repo internal) for JSON; new small `writeBinaryFileAtomic` helper mirroring it for PNGs | Existing helper handles the tmp+mv+error-branch invariant with a whitelist guard for identity-file writes |
| SSH channel management | Custom `ssh2` client wiring | Reuse `connectOneShot`, `execCommand`, `execCommandWithStdin`, `getHostSemaphore` — all wired in `starter.ts:1080-1128` | Battle-tested; shares the 8-slot per-host semaphore with fleet-status + substrate |
| Host enumeration for scan | Custom DB query | `listSubstrateHosts({getDb})` from `distributor/list-substrate-hosts.ts` | Session-less CSKEK path; correct host filter (`enableSsh AND runsFleetSubstrate`) |
| Per-host in-flight guarding | Custom Set + finally-cleanup logic | Copy the `inFlight` Set pattern from `spawn-requests/scan-orchestrator.ts:130-138, 234-252` | Prevents SSH session pileup (wilma incident 2026-08-20 precedent) |
| Test-time logger mocking | Manual console spies | `vi.mock("../utils/logger.js", …)` — copy from `spawn-requests/worker.test.ts:72-80` | Repo-standard test seam |

**Key insight:** Almost nothing in Phase 116's backend is genuinely new — the only from-scratch code is (a) the token bucket, (b) the worker-pool loop, (c) the OpenAI fetch call. Everything else is a rename-and-clone.

## Runtime State Inventory

Not applicable — Phase 116 is a greenfield feature, not a rename/refactor/migration.

## Common Pitfalls

### Pitfall 1: `writeMarkdownFileAtomic` may whitelist-reject the new response paths
**What goes wrong:** The helper has a filename whitelist that blocks `*.success.json` / `*.failure.json` (see Phase 99 worker.ts:17 "identity-file writer" comment — this was Pitfall 1 in Phase 99's own research too).
**Why it happens:** The helper was originally scoped to identity metadata writes.
**How to avoid:** Verify the whitelist check on the actual helper implementation before wiring the response file drop. Phase 99 solved this by using `writeMarkdownFileAtomic` directly — confirm the whitelist has been broadened or add `image-gen-requests/*.{success,failure}.json` to the allowlist.
**Warning signs:** First integration test on the response-file drop returns a permission/allow-list error.

### Pitfall 2: PNGs are ~1-5MB; buffer-in-memory-then-SFTP is fine, but don't accumulate
**What goes wrong:** Worker holds 5 concurrent × N=1..N images per call × ~4MB per image ≈ 20MB steady-state per worker; if a slow SFTP write coincides with the next enqueue you can drift toward 100MB.
**Why it happens:** Node's fetch buffer + Buffer.from(b64) + SFTP send buffer all coexist.
**How to avoid:** Release the fetch response buffer as soon as PNG bytes are written to SFTP; do not hold b64 strings in scope longer than needed. Use `imgRes.arrayBuffer()` sparingly.
**Warning signs:** Memory profile shows steady growth during load.

### Pitfall 3: Companion `.ref.*` file may not have arrived yet when scan claims the `.json`
**What goes wrong:** Helper writes `.json` before `.ref.png` (out-of-order fsync), sweep claims the `.json`, then tries to read `.ref.png` — file doesn't exist → treated as malformed.
**Why it happens:** No atomic write across two separate files.
**How to avoid:** Helper MUST write the `.ref.<ext>` FIRST, then write `.json` last (write-order = commit-order). The scan reads `.json` first (that's the claim), then reads `.ref.<ext>` — companion always present. Document this in helper script comments.
**Warning signs:** Intermittent `reason: malformed` failures during high-load bursts.

### Pitfall 4: OpenAI 401 (bad key) is NOT `not_configured` — it's `unknown`
**What goes wrong:** Adapter maps missing env var to `not_configured`, but a set-but-invalid key returns 401 from OpenAI and shouldn't be classified as "not configured."
**Why it happens:** `not_configured` per D-27 means "backend has no API key set" — a 401 is a different failure (bad or revoked key).
**How to avoid:** In adapter: `if (!process.env.OPENAI_API_KEY) return {reason:"not_configured"}`; 401 responses fall through to `unknown` or `provider_unavailable` (planner picks — recommend `unknown` since it's a config bug, not a transient issue).
**Warning signs:** After OpenAI key rotation, all image-gen calls suddenly return `not_configured`.

### Pitfall 5: TTL check must happen inside the worker, not at scan time
**What goes wrong:** If TTL is checked at scan time, a request that sat in the queue for 4.9 minutes and gets dequeued at 5.1 min would sneak through (queue holds it, worker calls OpenAI).
**Why it happens:** Requests can accumulate wall-clock time in the queue.
**How to avoid:** TTL check happens IN the worker at dequeue, comparing `Date.now()` against parsed `requested_at + 5min`. If expired, drop failure file, do NOT call adapter, do NOT consume a token.
**Warning signs:** OpenAI bill has requests whose `requested_at` is > 5min old.

### Pitfall 6: Worker-pool starvation on a stalled OpenAI call
**What goes wrong:** OpenAI request hangs indefinitely; worker holds a token forever; all 5 workers can end up hung → complete stall.
**Why it happens:** Node fetch has no default timeout.
**How to avoid:** Adapter MUST set an AbortController with a bounded timeout (recommendation: 60s per call — matches `identity-avatar-batch.ts:56`'s `IMAGE_GEN_TIMEOUT_MS`). On timeout → treat as `provider_unavailable`.
**Warning signs:** Scan orchestrator log shows requests claimed but never resolving.

### Pitfall 7: The scan tick's per-host in-flight guard is PER-HOST, not global
**What goes wrong:** Assuming a global lock will cause one slow host to block scans for every other host.
**How to avoid:** Copy the `inFlight = new Set<string>()` per-host guard pattern from `spawn-requests/scan-orchestrator.ts:130-138`.

### Pitfall 8: `writeMarkdownFileAtomic` LOCAL branch uses `os.homedir()` — not `$HOME` string substitution
**What goes wrong:** Test the local-host path (`isLocalHostId(item.hostIdNum)` true) and the file lands in Skynet's own container home, not the target user's home.
**How to avoid:** Read `spawn-requests/worker.ts:198-208` — the LOCAL branch's `$HOME/fleet/image-gen-requests/...` string is substituted by `writeMarkdownFileAtomic` via `os.homedir()`. Local host must be Skynet itself with the correct `/fleet` bind-mount; verify the bind-mount is present in `docker-compose.yml` for a co-located test host.

## Code Examples

### Example 1: Atomic scan exec constant + parser (adapt from spawn-requests)
```typescript
// image-gen-requests/scan-orchestrator.ts (mirrors spawn-requests/scan-orchestrator.ts)
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
// Source: ssh-poll-orchestrator.ts:1198-1208 (identical shape, folder swapped)
```

### Example 2: OpenAI adapter (extracted from identity-avatar-batch.ts:378-410)
```typescript
// image-gen-requests/adapter.ts — new file, isolated from avatar route
import type { ImageGenRequestBody, FailureReason } from "./types.js";

const IMAGE_GEN_TIMEOUT_MS = 60_000;
const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";

export interface AdapterResult {
  ok: true;
  images: Buffer[];       // PNG buffers, one per n
  generation_time_ms: number;
} | {
  ok: false;
  reason: FailureReason;
  message?: string;
};

export async function callOpenAiImageGen(
  body: ImageGenRequestBody,
  refImage?: Buffer,
): Promise<AdapterResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };

  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), IMAGE_GEN_TIMEOUT_MS);

  try {
    const url = refImage ? OPENAI_EDITS_URL : OPENAI_GENERATIONS_URL;
    const requestBody = refImage
      ? buildMultipartEditBody(body, refImage)     // multipart form for /edits
      : JSON.stringify({ model: "gpt-image-1", ...body });
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (!refImage) headers["Content-Type"] = "application/json";

    const res = await fetch(url, { method: "POST", headers, body: requestBody, signal: ctrl.signal });

    if (res.status === 429) return { ok: false, reason: "rate_limited" };
    if (res.status >= 500)  return { ok: false, reason: "provider_unavailable" };
    if (res.status === 400) {
      const err = await res.json().catch(() => ({}));
      // OpenAI content-policy refusal has code "content_policy_violation"
      if (err?.error?.code === "content_policy_violation") {
        return { ok: false, reason: "content_blocked", message: err?.error?.message };
      }
      return { ok: false, reason: "malformed", message: err?.error?.message ?? "bad request" };
    }
    if (!res.ok) return { ok: false, reason: "unknown", message: `status ${res.status}` };

    const data = await res.json() as { data: Array<{ b64_json: string }> };
    const images = data.data.map((d) => Buffer.from(d.b64_json, "base64"));
    return { ok: true, images, generation_time_ms: Date.now() - start };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "provider_unavailable", message: "openai timeout" };
    }
    return { ok: false, reason: "unknown", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
```

### Example 3: Hand-rolled token bucket (~50 lines)
```typescript
// image-gen-requests/token-bucket.ts
export interface TokenBucket {
  acquire(): Promise<void>;
  getState(): { tokens: number; capacity: number; refillRatePerSec: number };
}

export function createTokenBucket(rpm: number): TokenBucket {
  const capacity = Math.max(1, Math.floor(rpm * 5 / 60)); // RPM × 5s of headroom
  const refillPerMs = rpm / 60_000;                       // tokens per ms
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
      const resolve = waiters.shift()!;
      resolve();
    }
  }

  // Periodic refill so waiters get unblocked even without new acquire() calls.
  setInterval(refill, 100).unref();

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

### Example 4: Helper script skeleton (bash)
```bash
#!/usr/bin/env bash
# ~/.local/bin/image-gen — distributed via fleet-substrate catalog
set -euo pipefail

REQ_DIR="${HOME}/fleet/image-gen-requests"
OUT_DIR="${HOME}/fleet/image-gen-outputs"
POLL_INTERVAL_FAST=0.5   # first 30s
POLL_INTERVAL_SLOW=2     # after 30s
TIMEOUT_SEC=300          # 5 min (matches D-16)

# --- arg parse: positional prompt + flags ---
prompt=""; size=""; n=""; quality=""; out=""; ref=""; json_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --size)    size="$2";    shift 2;;
    --n)       n="$2";       shift 2;;
    --quality) quality="$2"; shift 2;;
    --out)     out="$2";     shift 2;;
    --ref)     ref="$2";     shift 2;;
    --json)    json_file="$2"; shift 2;;
    -h|--help) echo "usage: image-gen <prompt> [--size ...] [--n N] [--quality ...] [--out path] [--ref path] [--json file]" >&2; exit 0;;
    *) prompt="$1"; shift;;
  esac
done

# --- ensure dirs exist ---
mkdir -p "$REQ_DIR" "$OUT_DIR"

# --- build request UUID + body ---
uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')
req_path="$REQ_DIR/$uuid.json"
req_tmp="$req_path.tmp.$$"

# --- IMPORTANT: write ref file FIRST (Pitfall 3) ---
if [ -n "$ref" ]; then
  ext="${ref##*.}"
  ref_dest="$REQ_DIR/$uuid.ref.$ext"
  cp "$ref" "$ref_dest.tmp.$$" && mv "$ref_dest.tmp.$$" "$ref_dest"
fi

# --- assemble JSON body ---
if [ -n "$json_file" ]; then
  cp "$json_file" "$req_tmp"
else
  # jq strongly preferred for correct escaping; fall back to hand-crafted if unavailable
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg p "$prompt" --arg s "$size" --arg q "$quality" --argjson nn "${n:-1}" \
      '{prompt:$p} + (if $s != "" then {size:$s} else {} end) + (if $q != "" then {quality:$q} else {} end) + {n:$nn, requested_at:(now | todateiso8601)}' > "$req_tmp"
  else
    # minimal fallback — no quote escaping in prompt
    printf '{"prompt":"%s","n":%s,"requested_at":"%s"}\n' "$prompt" "${n:-1}" "$(date -u +%FT%TZ)" > "$req_tmp"
  fi
fi
mv "$req_tmp" "$req_path"

# --- poll ---
deadline=$(( $(date +%s) + TIMEOUT_SEC ))
poll_start=$(date +%s)
success_file="$REQ_DIR/$uuid.success.json"
failure_file="$REQ_DIR/$uuid.failure.json"

while [ ! -f "$success_file" ] && [ ! -f "$failure_file" ]; do
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    # synthesize expired failure so downstream branch handles it identically
    printf '{"reason":"expired"}\n' >&2
    exit 1
  fi
  if [ $((now - poll_start)) -lt 30 ]; then
    sleep "$POLL_INTERVAL_FAST"
  else
    sleep "$POLL_INTERVAL_SLOW"
  fi
done

# --- branch success / failure ---
if [ -f "$failure_file" ]; then
  cat "$failure_file" >&2
  rm -f "$failure_file" "$req_path" "$REQ_DIR/$uuid.ref."*  2>/dev/null || true
  exit 1
fi

# success — move PNGs to output dir
paths=()
i=0
for png in "$REQ_DIR/$uuid.success."*.png; do
  [ -f "$png" ] || continue
  dest="${out:-$OUT_DIR/$uuid-$i.png}"
  mv "$png" "$dest"
  paths+=("$dest")
  i=$((i+1))
done

# metadata to stderr, paths to stdout (D-14)
cat "$success_file" >&2
for p in "${paths[@]}"; do printf '%s\n' "$p"; done

# cleanup wire files
rm -f "$success_file" "$req_path" "$REQ_DIR/$uuid.ref."* 2>/dev/null || true
exit 0
```

### Example 5: Two new catalog rows

```typescript
// In src/backend/distributor/catalog.ts, append:
{
  slug: "image-gen-skill",
  sourceKind: "bundled",
  bundledPath: "/app/fleet-substrate/skills/image-gen/SKILL.md",
  installPath: "~/.claude/skills/image-gen/SKILL.md",
  restartHook: null,
},
{
  slug: "image-gen-helper",
  sourceKind: "bundled",
  bundledPath: "/app/fleet-substrate/scripts/image-gen",
  installPath: "~/.local/bin/image-gen",
  restartHook: null,
},
```

Both bundled sources land in the image via existing `COPY --chown=node:node substrate /app/fleet-substrate` (Dockerfile:80). No Dockerfile changes needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Piggyback scans on `ssh-poll-orchestrator.ts` per-host tick | Dedicated always-on `scan-orchestrator.ts` module | 2026-09-11 (bounty `fleet-status-orchestrator-coupling-with-spawn-request-scanning`) | Phase 116 uses the newer always-on pattern from the start — do NOT piggyback |
| Serialized N=1 worker (Phase 99) | Worker-pool N=5 with token bucket | This phase (D-20/D-21) | New pattern; Phase 116 introduces it. Future rate-limited brokers can adopt |
| `openai` SDK | Raw `fetch` to `api.openai.com` | Never in this codebase — no SDK dep exists | Continue the raw-fetch convention |

**Deprecated/outdated:** The pre-2026-09-11 comment in `ssh-poll-orchestrator.ts:1168-1179` about scan-piggybacking is stale — actual scan lives in `spawn-requests/scan-orchestrator.ts`. Planner should read the docstring at the top of `scan-orchestrator.ts` for the correct pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `uuidgen` is available on every managed host | Standard Stack | Helper script fails on hosts lacking it — mitigation: fallback to `cat /proc/sys/kernel/random/uuid` if `uuidgen` missing |
| A2 | Managed-host baseline has `jq` available | Example 4 (helper) | Helper falls back to minimal hand-crafted JSON string; if hand-crafted breaks on quotes in prompts, add a real dependency check + install step. Recommend planner add jq availability check in a checkpoint task. |
| A3 | OpenAI /edits endpoint accepts multipart form with a single image + prompt for `gpt-image-1` | Example 2 (adapter) | If the SDK convention is different, the adapter multipart-build code needs iteration; verify against OpenAI docs during implementation of adapter.ts |
| A4 | OpenAI 400 error responses include `error.code === "content_policy_violation"` for content refusals | Example 2 (adapter) | If the code string differs, the content_blocked classification falls back to `malformed` — user-visible impact is a slightly-wrong reason enum. Verify with a real refused-prompt test |
| A5 | `writeMarkdownFileAtomic` accepts arbitrary `~/fleet/image-gen-requests/*.json` paths OR needs allowlist extension | Pitfall 1 | If allowlist blocks new paths, worker fails silently on response drop → coord sees `expired`; mitigate by checking the whitelist source before implementation |

## Open Questions

1. **Does `writeMarkdownFileAtomic` need an allowlist update to permit `image-gen-requests/*.{success,failure}.json`?**
   - What we know: Phase 99 uses it for `spawn-requests/*.{success,failure}.json` — clearly permitted for that path.
   - What's unclear: Is the allowlist a static list or a pattern-match on `~/fleet/*/`?
   - Recommendation: Planner adds a Wave 1 task to inspect `src/backend/claude-session/identity-artifact-reader.ts` and extend if needed.

2. **PNG SFTP write — is there an existing binary-file atomic helper, or does this phase add `writeBinaryFileAtomic`?**
   - What we know: `writeMarkdownFileAtomic` is text-only.
   - What's unclear: Whether any existing SFTP helper writes arbitrary bytes atomically.
   - Recommendation: Planner adds a Wave 0 or Wave 1 task to check; if none exists, add a small new helper following the same tmp+mv invariant.

3. **`n=1` vs `n>1` — does OpenAI's `gpt-image-1` support `n>1` natively, or does the adapter need to loop?**
   - What we know: The avatar route uses 3 parallel calls each with `n:1`, not one call with `n:3`.
   - What's unclear: Whether that was a Phase 74 constraint (needed 3 different prompts) or an API constraint.
   - Recommendation: Adapter attempts `n>1` as passed-through by the caller; if OpenAI 400s on `n>1`, fall back to parallel loop in the adapter.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (Skynet backend) | Backend TS | ✓ (container) | Node 20+ (whatever image ships) | — |
| `fetch` global | adapter.ts | ✓ | Node 20 built-in | — |
| Vitest | Tests | ✓ | ^4.1.8 | — |
| bash on managed hosts | Helper script | ✓ | POSIX bash 4+ | — |
| `uuidgen` on managed hosts | Helper script | ASSUMED ✓ | util-linux | `cat /proc/sys/kernel/random/uuid` |
| `jq` on managed hosts | Helper JSON assembly | ASSUMED ✓ | 1.6+ | Hand-crafted `printf` (loses quote-safety) |
| SFTP over existing SSH channels | Response file writes | ✓ | ssh2 lib | — |
| `OPENAI_API_KEY` env | adapter runtime | ✓ (existing avatar route reads it) | — | `reason: not_configured` failure enum |
| `SKYNET_IMAGE_GEN_RPM` env | token bucket | Not yet set — introduced by this phase | — | Default 30 if unset |

**Missing dependencies with no fallback:** None — everything is available or has a graceful default.
**Missing dependencies with fallback:** `uuidgen`/`jq` on managed hosts — fall back to `/dev/urandom` UUID + minimal `printf`.

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user-facing auth in this phase (trust boundary is filesystem — D-13 shape). OpenAI outbound uses bearer token from env, not user creds. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | yes (implicit) | Trust boundary is "who can write to `~/fleet/image-gen-requests/`" — same as Phase 99. Managed by SSH access to the host. No new controls needed. |
| V5 Input Validation | yes | Request-body validation via `parseRequestBody` — reject on missing `prompt`, unrecognized params (per D-06). Enforce max prompt length? Recommendation: cap at 4000 chars (OpenAI docs 4000-char limit for gpt-image-1 prompts). |
| V6 Cryptography | no | No new crypto. TLS to OpenAI is delegated to Node fetch. |
| V7 Error Handling | yes | Failure reasons closed enum (D-27) — do NOT leak OpenAI internal error messages back to caller for non-malformed cases (message is ABSENT for opaque failures per D-09). |
| V8 Data Protection | yes | Request bodies contain user prompts that go to OpenAI. PHI directive in SKILL.md (D-17/D-18) is the compliance control. |
| V10 Malicious Code | yes | Do NOT `eval()` or shell-interpolate any prompt content in the helper script — use jq for JSON assembly (Example 4). |
| V12 File Handling | yes | Reference image uploads: helper accepts arbitrary `--ref <path>` — no validation on file type/size. Recommendation: adapter validates PNG/JPEG/WebP magic bytes before sending to OpenAI. |
| V13 API | yes (outbound only) | Outbound calls carry `Authorization: Bearer ${OPENAI_API_KEY}` — do NOT log the header. Follow existing pattern from `identity-avatar-batch.ts`. |
| V14 Configuration | yes | `OPENAI_API_KEY` + `SKYNET_IMAGE_GEN_RPM` in env only, NOT in `branding.json` (D-21). |

### Known Threat Patterns for {backend TS + shell helper}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection to OpenAI | Tampering | Out of scope — OpenAI's own content-policy handles this; we surface `content_blocked` |
| Path traversal in helper `--ref <path>` | Tampering | Helper reads local files; caller has shell already, so no privilege escalation from path traversal |
| API key logged in error message | Info Disclosure | Adapter MUST NOT include Authorization header or full URL in error/log lines |
| PHI leakage to third-party API | Info Disclosure | PHI directive in SKILL.md (D-17); enforcement is agent-level not code-level |
| Slow-loris hang on OpenAI stalls | DoS | AbortController with 60s timeout in adapter (Pitfall 6) |
| Malicious ref file (huge / non-image) | DoS / Malicious | Validate size cap (5 MB matches avatar route Multer cap) + magic-byte check before forwarding to OpenAI |
| Companion `.ref.*` sitting on disk as orphan | Info Disclosure | Helper cleans up on success/timeout; long-lived orphans are the deferred auto-reaper problem (out of scope this phase) |

## Sources

### Primary (HIGH confidence)
- `src/backend/spawn-requests/queue.ts` (103 lines) — canonical queue pattern
- `src/backend/spawn-requests/worker.ts` (556 lines) — canonical worker + response-file drop patterns
- `src/backend/spawn-requests/scan-orchestrator.ts` (298 lines) — canonical always-on scan pattern
- `src/backend/spawn-requests/types.ts` — canonical type layout
- `src/backend/spawn-requests/parse-request-body.ts` — canonical pure-parser pattern
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:1168-1311` — atomic mv scan command + parser
- `src/backend/database/routes/identity-avatar-batch.ts:290-410` — OpenAI fetch call site to extract
- `src/backend/distributor/catalog.ts:215-446` — catalog entry schema + examples
- `src/backend/starter.ts:1050-1149` — scan orchestrator wiring template
- `.planning/phases/99-spawn-request-watcher-.../99-CONTEXT.md` — pattern context
- `.planning/phases/116-image-gen-skill-.../116-CONTEXT.md` — locked decisions (28 total)
- `.planning/shapes/shape-image-gen-skill.md` — authoritative shape
- `docker/Dockerfile:80` — substrate copy line (confirms no Dockerfile changes needed)
- `.planning/config.json` — `nyquist_validation:false`, `security_enforcement:true`, `use_worktrees:false`

### Secondary (MEDIUM confidence)
- None — all findings drawn from repo code directly.

### Tertiary (LOW confidence)
- OpenAI API shape for `/edits` (multipart form) — verify during adapter implementation.
- OpenAI 400 error code string for content-policy refusals — verify during adapter implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps present in repo; no external adds.
- Architecture: HIGH — near-exact clone of Phase 99, which is production-tested.
- Pitfalls: HIGH — drawn from Phase 99's own research + code review history.
- OpenAI adapter details: MEDIUM — extracted from existing avatar route, but /edits multipart shape needs verification.

**Research date:** 2026-09-18
**Valid until:** 2026-10-18 (30 days — stable subsystems, no fast-moving libs)

---

## Answers to the 12 Planner Questions (concise)

**Q1. Backend module layout.** Mirror `src/backend/spawn-requests/` filename-for-filename in `src/backend/image-gen-requests/`. 7 files: `types.ts`, `parse-request-body.ts`, `queue.ts`, `worker.ts`, `adapter.ts` (new — no analog in Phase 99), `token-bucket.ts` (new), `scan-orchestrator.ts`. Each gets a `.test.ts` sibling. Module responsibilities match Phase 99 verbatim except: queue adds TTL check; worker delegates OpenAI call to adapter; scan-orchestrator uses `image-gen-requests/` folder path.

**Q2. Fleet-status sweep extension.** MISLEADING QUESTION — after the 2026-09-11 refactor (`spawn-requests/scan-orchestrator.ts` docstring lines 1-48), the spawn-request scan does NOT live in `ssh-poll-orchestrator.ts` anymore. It lives in a dedicated always-on scan-orchestrator module. Phase 116 should copy THAT pattern, not modify ssh-poll-orchestrator.ts. Correct code pattern for the atomic exec: reuse the `SPAWN_REQUESTS_SCAN_CMD` string from `ssh-poll-orchestrator.ts:1198-1208` verbatim (swap the folder path). The enqueue call is `queue.enqueue(item)` where item is a `PendingImageGen` object (mirror `PendingBirth` type). Wiring: mirror `starter.ts:1058-1149`.

**Q3. OpenAI adapter.** Extract from `identity-avatar-batch.ts:384-408`. Shape of adapter interface in Example 2 above. Supports both text-to-image (POST `/v1/images/generations` with JSON body `{model:"gpt-image-1", prompt, n, size, quality}`) and image-to-image (POST `/v1/images/edits` with multipart form including `image` file + `prompt`). Response for both is `{data: [{b64_json: string}, ...]}`. Error mapping: 400 with `error.code === "content_policy_violation"` → `content_blocked`; 400 other → `malformed`; 429 → `rate_limited`; 5xx or AbortError → `provider_unavailable`; missing env → `not_configured`; anything else → `unknown`.

**Q4. Token bucket implementation.** Hand-roll ~50 lines (Example 3). No library. Parameters: refill rate = `SKYNET_IMAGE_GEN_RPM` env (default 30) → `rpm/60_000` tokens/ms. Capacity = `Math.max(1, Math.floor(rpm * 5 / 60))` (RPM × 5s worth). Waiters queue on empty bucket, wake on next refill.

**Q5. In-memory queue with TTL.** Layer TTL as a check INSIDE the worker's dequeue step (Pitfall 5). Queue itself stays FIFO; on worker dequeue, compare `Date.now()` vs. `Date.parse(item.requested_at) + 5*60*1000`. If expired: drop `<uuid>.failure.json {reason:"expired"}`, do NOT acquire token, do NOT call adapter. Do NOT check TTL at enqueue time (that would double-check).

**Q6. Substrate distributor pattern.** Catalog schema is `BundledCatalogEntry` (`catalog.ts:97-141`). Two rows needed (Example 5). Install destinations: `~/.claude/skills/<slug>/` for skills; `~/.local/bin/<name>` for executable scripts. No restart hook for either. The `substrate/` folder is copied into the image at `/app/fleet-substrate/` via `Dockerfile:80` — no Dockerfile changes.

**Q7. Helper script implementation.** Bash (matches agent-supervisor.sh + install-usage-reporter.sh + usage-reporter.sh precedent). Full skeleton in Example 4. Key patterns: (a) UUID via `uuidgen` (fallback `/proc/sys/kernel/random/uuid`); (b) atomic write = write `.tmp` then `mv`; (c) IMPORTANT — write `.ref.*` BEFORE `.json` (Pitfall 3); (d) poll loop with two cadences (500ms first 30s, then 2s); (e) branch on success-vs-failure file; (f) move PNGs to `~/fleet/image-gen-outputs/`; (g) print paths to stdout, JSON to stderr; (h) cleanup wire files; (i) exit non-zero on failure.

**Q8. Test surface breakdown.** Vitest for backend (per `package.json:20-24` + repo standard). Test patterns:
- Queue tests: mirror `spawn-requests/queue.test.ts` (170 lines) — enqueue/dequeue, isEmpty, __resetForTests.
- Worker tests: mirror `spawn-requests/worker.test.ts` (999 lines) — logger mock via `vi.mock("../utils/logger.js")`, deps interface for injection, adapter mocking, response-file drop assertion.
- Scan-orchestrator tests: mirror `spawn-requests/scan-orchestrator.test.ts` (382 lines) — `vi.useFakeTimers()`, mocked `listSubstrateHosts` + `acquireChannel`.
- Token bucket: pure function test with `vi.useFakeTimers()` for refill timing.
- Adapter: mock global `fetch` via `vi.stubGlobal("fetch", vi.fn())`.
- Helper script: bash test driver in `substrate/scripts/tests/image-gen.test.sh` — mirror `fleet-status-sweep.test.sh` (assert-based, hermetic fixture with `mktemp -d`, `trap cleanup EXIT`).
- Integration end-to-end: NEW — mirror Phase 99 D-22 pattern; drop a request file (via helper OR bare write), mock fetch, tick scanner, assert response file lands with correct schema.

**Q9. Concurrency model.** 5 concurrent workers = 5 parallel async loops sharing one queue. Each loop:
```
while (true) {
  const item = await dequeueBlocking();       // resolves when queue non-empty
  if (isExpired(item)) { dropExpiredFailure(item); continue; }
  await tokenBucket.acquire();                // block on empty bucket
  const result = await callOpenAiImageGen(item);
  await dropResponseFile(item, result);
}
```
`dequeueBlocking` = shifts from array if non-empty; otherwise returns a Promise resolved on the next `enqueue` call (implement as a `waiters: Array<(item)=>void>` list — same shape as the token bucket's waiter queue). Node's event loop runs all 5 concurrently — no thread pool needed, no worker_threads.

**Q10. Docker/container concerns.** No Dockerfile changes. `substrate/` is copied via `COPY --chown=node:node substrate /app/fleet-substrate` at Dockerfile:80 — new files in `substrate/skills/image-gen/` and `substrate/scripts/image-gen` land automatically. Backend TS is transpiled via `npm run build:backend` (`package.json:27`) and picked up on container restart. Deploy motion is orchestrator-owned per D-28 — executor stops at code + commit + tests green. Docker `docker cp` fast-path is not part of this phase's concern.

**Q11. Validation approach.** End-to-end test structure:
1. Setup: mock global `fetch`, mock `listSubstrateHosts` to return one fake host, mock `acquireChannel` to return an exec-mocked channel.
2. Action: exec-mock returns tab-separated `<uuid>.json\t{"prompt":"cat","n":1,"requested_at":"<now>"}\n`.
3. Verify: `enqueue` called with correct PendingImageGen; worker dequeues; fetch called with `api.openai.com/v1/images/generations` and correct body; SFTP write mock called with `~/fleet/image-gen-requests/<uuid>.success.png` (binary buffer matches decoded mock b64) + `<uuid>.success.json` (JSON matches schema).
Also test the failure path: fetch returns 429 → `<uuid>.failure.json` with `{reason:"rate_limited"}`. Also test the TTL path: enqueue with `requested_at` 6 min old → `{reason:"expired"}` before fetch is called.

**Q12. Anti-patterns / gotchas.** All listed in the "Anti-Patterns to Avoid" section above. Skynet-specific pitfalls beyond CONTEXT.md's list:
- The `writeMarkdownFileAtomic` whitelist may reject new paths (Pitfall 1).
- The always-on scan-orchestrator pattern SUPERSEDES piggybacking on `ssh-poll-orchestrator.ts` — do not repeat the pre-2026-09-11 pattern (see State of the Art table).
- `writeMarkdownFileAtomic`'s LOCAL branch resolves `$HOME` via `os.homedir()` — for a co-located test host you need the `/fleet` bind-mount (Pitfall 8).
- Node's `fetch` has no default timeout — MUST wrap in AbortController (Pitfall 6).
- Companion ref file must be written BEFORE the request JSON (Pitfall 3) — helper enforces this.
- Do not accumulate PNG buffers longer than needed (Pitfall 2).
