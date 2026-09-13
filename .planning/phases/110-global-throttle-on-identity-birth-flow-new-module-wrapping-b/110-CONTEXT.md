# Phase 110: Global throttle on identity-birth flow — Context

**Gathered:** 2026-09-13
**Status:** Ready for planning
**Source:** Manual — locked design from bounty premise + Tina 2026-09-13 role-peer sync + birch's investigation

<domain>
## Phase Boundary

Introduce a **single global rate-limiter** in the Skynet backend that both existing entry points into `birthIdentity()` funnel through, so a coordinator can drop N spawn-request files at once (or hit `POST /identities/birth` N times concurrently) without saturating downstream chokepoints (Matrix admin API, SSH channel budget on the target host).

Origin: Alice 2026-09-13 verbatim: *"i want to create a ninth agent to handle that exact problem and add like a global rate limiter or throttle i guess you would call it to the flow that that creates the identities on the skynet backend um because if we put it there then coordinators can drop a hundred new identity creation files at once and we'd never have a huge problem like that"*.

Bounty: `identity-creation-flow-global-throttle` (box-maintainer's shared pool).

</domain>

<decisions>
## Implementation Decisions

### Locked from Tina (role-peer sync 2026-09-13)

- **Scope: birth flow only.** Do NOT throttle the avatar-batch endpoint (`/identities/avatar/batch`) as part of this phase. It's UI-only, not exercised by coord drops, and coupling would drag in Anthropic/OpenAI rate-limit concerns that belong in their own follow-up bounty if they ever become live.
- **New module, not extension of `spawn-requests/queue.ts`.** `queue.ts` stays as the FIFO consumer of disk-drop files; the throttle is the broader construct BOTH entry points share. Clean boundary + unit-testable in isolation from the disk-drop watcher.
- **Default `maxConcurrent = 1`.** Preserves today's effective spawn-request behavior (serialized) while extending that safety to the HTTP path.
- **Observability discipline is load-bearing.** Log at wait / grant / release / reject with actionable context — Alice or a peer will later ask "births are slow today, is it the throttle?" and `console-forward.log` must answer directly. Follows the role-file logging directive (`Logging is cheap and batched to the console-forward server`).

### Module shape

- **File:** `src/backend/identity-birth/global-throttle.ts` (new folder — no other files land under `identity-birth/` this phase; the folder gets its first inhabitant here, and is a natural home for future birth-orchestration cross-entry-point primitives).
- **Public API:**
  - `acquireBirthSlot(context: { source: "http" | "spawn-request"; requestId?: string }): Promise<() => void>` — resolves with a `release` fn. Rejects (HTTP path only) with a typed `ThrottleRejectedError` when the queue is at `maxQueueDepth`.
  - Internal state: a Promise-chain semaphore (mirrors `spawn-requests/queue.ts`'s `workerPromise.then(drainOne)` pattern for API familiarity — reviewers already know that idiom).
  - Optional `minIntervalMs` gate: tracks `lastReleaseAt`; if `now - lastReleaseAt < minIntervalMs`, the acquiring caller sleeps `minIntervalMs - delta` before resolving.
  - Test hook: `__resetForTests()` (mirrors `queue.ts:__resetForTests`).
- **Config surface (env vars, read at module init time — no runtime PATCH endpoint in this phase):**
  - `IDENTITY_BIRTH_MAX_CONCURRENT` — integer ≥ 1, default `1`
  - `IDENTITY_BIRTH_MIN_INTERVAL_MS` — integer ≥ 0, default `0`
  - `IDENTITY_BIRTH_MAX_QUEUE_DEPTH` — integer ≥ 1, default `100`
  - Invalid env values → LOUD one-shot warn at startup + fall back to default (matches wake-up-scheduler's malformed-timezone discipline in id skill).

### Integration surface

- **`src/backend/database/routes/identity-birth.ts`** (POST `/identities/birth` SSE handler):
  - Before opening SSE: `const release = await acquireBirthSlot({ source: "http" })`. On `ThrottleRejectedError`, respond `429` with a JSON body `{error: "identity_birth_queue_full", retry_after_ms}` — the frontend can back off and retry. Do NOT open SSE.
  - Wrap the existing `birthIdentity(...)` call in `try { ... } finally { release(); }`.
  - Same treatment for the `POST /retry/:key` handler (mirrors the mint+relay-write path).
- **`src/backend/spawn-requests/worker.ts`** (`processBirth`):
  - At the top of the function, `const release = await acquireBirthSlot({ source: "spawn-request", requestId: item.uuid })`.
  - Spawn-request path never rejects (`maxQueueDepth` doesn't apply to disk-drop origin — those already live on disk, dropping them silently is worse UX than piling up in memory). Implementation: `acquireBirthSlot` accepts a bypass sub-option `{ bypassQueueDepth: true }` for the spawn-request caller.
  - Wrap the entire birth flow (pre-flight + `birthIdentity` + response file drop) in the acquire/release pair.
- **`src/backend/spawn-requests/queue.ts`** stays untouched. Its Promise-chain drain now cooperates with the throttle: when `maxConcurrent = 1` the throttle is effectively identity — the queue drains serially and the throttle waits on nothing. When `maxConcurrent > 1` (future) the queue still hands one item at a time to the worker, but the throttle would allow multiple in-flight — the queue's serialization is orthogonal.

### Test strategy

- **Unit tests for `global-throttle.ts`:** semaphore correctness (concurrency cap respected, FIFO ordering), min-interval spacing (fake timers), queue-depth rejection, `bypassQueueDepth` behavior, `__resetForTests` invariants, env-var parsing + malformed-value fallback with log assertion. Mirror `spawn-requests/queue.test.ts` shape.
- **Integration tests at both entry points:**
  - `identity-birth.test.ts`: three concurrent POST /identities/birth requests serialize (assert order of `birthIdentity` invocations); 429 fires when queue at cap.
  - `spawn-requests/worker.test.ts`: two `processBirth` calls in parallel serialize (extend existing tests); bypass semantics honored.
- **End-to-end smoke** (deferred to ship-time verify, not gated in this phase): drop 10 spawn-request files at once on the running t1000 container; verify none fail on rate limits and last-in-line completes within reasonable latency budget. Not a unit test — a manual verify step in the phase SUMMARY.

### Documentation update

- Update the coordinator-instructions companion (`substrate/skills/id/coordinator-instructions.md` in the repo, distributed by the fleet substrate distributor to every managed host) with a note under the spawn-request-drop mechanics section: *"Batch drops are safe — the Skynet backend paces births internally (see Phase 110). No manual spacing needed."*

### Out of scope (explicit)

- **Throttling the avatar-batch endpoint** — Tina's call, out of scope. Its own bounty if it ever becomes live.
- **Runtime-tunable throttle knobs** — env-var-only for this phase. A `PATCH /admin/identity-birth-throttle` endpoint is a plausible v2 but not needed today.
- **Distributed rate limiting** — single-Skynet-process only. If two Skynet processes ever share a Matrix homeserver (they don't today), coordination would need Redis or similar. Not a real concern in this fleet.
- **Retry-after logic beyond the 429 hint** — frontend behavior on 429 is caller-driven. The throttle just says "not now, try in ~N ms."
- **Changing the discovery-poll cadence or supervisor-wait timeout in `birthIdentity`** — orthogonal concerns. Those live in `identity-birth-orchestrator.ts` invariants and are out of scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing serialization / queue patterns (reference implementations)

- `src/backend/spawn-requests/queue.ts` — Promise-chain serialization idiom (reference for the throttle's internal state machine); also the pattern for `setProcessBirth` injection + `__resetForTests` shape.
- `src/backend/spawn-requests/worker.ts` — the spawn-request birth-caller. Integration lands here.
- `src/backend/database/routes/identity-birth.ts` — HTTP SSE birth route. Integration lands here at both the POST `/` handler and the POST `/retry/:key` handler.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — the `birthIdentity()` function itself. NOT modified this phase; the throttle wraps its invocations without touching its internals.

### Semaphore/concurrency patterns already in the codebase

- `src/backend/ssh/host-semaphore-registry.ts` — per-host SSH semaphore (Phase 101). Nearest existing analog; reference for the semaphore internals + logging shape. Do NOT reuse this specific instance (its scope is per-host SSH concurrency, not per-process birth concurrency), but its `sem.run(...)` API + logging pattern is the local convention to mirror.
- `src/backend/database/routes/identity-avatar-batch.ts` — Anthropic-API caller with in-memory candidate cache. Reference for env-var reads + startup log shape. Do NOT couple this phase to it.

### Logging convention

- `src/backend/utils/logger.ts` — `systemLogger` is the correct logger for this module (batch/throttle is a system concern, not per-user, not per-host). Log at `.info` for wait/grant/release; `.warn` for reject.
- Follow role-file § "⚠️ Logging is cheap and batched to the console-forward server" — structured log payloads with `operation:` key for grep-ability. Suggested keys: `identity_birth_throttle_wait`, `identity_birth_throttle_grant`, `identity_birth_throttle_release`, `identity_birth_throttle_reject`, `identity_birth_throttle_config_loaded`.

### Coordinator-instructions surface (docs update target)

- `substrate/skills/id/coordinator-instructions.md` — the companion file the fleet substrate distributor pushes to every managed host under `~/.claude/skills/id/coordinator-instructions.md`. Documents spawn-request-drop mechanics. Update lands here; hosts pick it up on next distributor sweep.

### Distributor catalog (no changes needed)

- `src/backend/distributor/catalog.ts` — canonical catalog of what the distributor pushes. `coordinator-instructions.md` is already in the catalog; editing its content in the repo is sufficient (no new catalog entry needed).

</canonical_refs>

<specifics>
## Specific Ideas

### Semaphore implementation shape

Two acceptable internal implementations; planner picks:

**Option A: Promise-chain (mirrors `spawn-requests/queue.ts`)**
- `let workerPromise = Promise.resolve();`
- `enqueue()` chains: `workerPromise = workerPromise.then(() => runOne());` where `runOne()` grants the slot and returns a Promise the caller resolves via `release`.
- Naturally serial; supporting `maxConcurrent > 1` requires N parallel worker chains (workable but not free).

**Option B: Counter + waiter queue (classic semaphore)**
- `let inFlight = 0; const waiters: Array<() => void> = [];`
- `acquire()`: if `inFlight < maxConcurrent`, `inFlight++` and resolve immediately; else push to `waiters` and resolve when a `release()` pops the queue.
- `release()`: `inFlight--`; if `waiters.length > 0`, shift and grant.
- Cleaner for `maxConcurrent > 1` in the future; ~20 lines.

**Recommendation:** Option B — modest complexity, honest with the concurrency model, ready for future tuning without a rewrite. The role file directive against premature abstraction (`Three similar lines is better than a premature abstraction`) doesn't apply here — Option B is closer to what a semaphore actually is; Option A would be the abstraction-that-later-needs-untangling.

### Min-interval spacing (token-bucket lite)

- After granting slot N, record `lastReleaseAt = Date.now()`.
- Grant slot N+1: if `Date.now() - lastReleaseAt < minIntervalMs`, schedule via `setTimeout` for the remaining delta; log `identity_birth_throttle_wait` with `reason: "min_interval", delayMs`.
- Simple, correct, no external dependency.

### Queue-depth check

- Track `waiters.length` (Option B) or `pendingCount` (Option A). Before adding a new waiter, if `pendingCount >= maxQueueDepth` AND `bypassQueueDepth !== true`, reject with `ThrottleRejectedError`. Include `retryAfterMs` estimated as `pendingCount * expectedBirthDurationMs` (make expected duration configurable, default 30_000ms).

### Failure modes to design against

- **Caller forgets to release** — the module holds the slot forever, births halt. Mitigation: the module's public API returns the `release` fn; callers use `try { ... } finally { release(); }`. Unit test asserts this pattern; code reviewers eyeball. No auto-timeout — birth can legitimately take 120s+ (supervisor wait).
- **Caller double-releases** — the second release increments the free count spuriously. Mitigation: `release()` is idempotent via a captured local `released` flag closed over per-acquire. Unit test covers.
- **Env-var typo** — silent skip is bad. Mitigation: LOUD startup warn + default fallback + one-shot log line at module init showing the resolved config (`identity_birth_throttle_config_loaded`).

</specifics>

<deferred>
## Deferred Ideas

- **Throttle the avatar-batch endpoint** — separate bounty if/when UI batching ever becomes live.
- **Runtime tunable knobs** — a `PATCH /admin/identity-birth-throttle` admin endpoint. Not blocking; future refinement.
- **Per-source rate limits** — different limits for HTTP vs spawn-request origins. Not needed today; add if traffic patterns diverge.
- **Distributed rate limiting** — Redis-backed if two Skynet processes ever share a Matrix homeserver. Not a real concern for the current fleet.
- **Metrics/histograms** — Prometheus-style p50/p95/p99 wait times. `console-forward.log` structured logs are sufficient for the observability need Alice actually stated.

</deferred>

---

*Phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b*
*Context gathered: 2026-09-13 by birch (box-maintainer) — bounty `identity-creation-flow-global-throttle`, Tina design-fork calls locked in-band*
