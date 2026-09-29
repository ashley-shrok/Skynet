/**
 * host-circuit-breaker.ts — Per-peer circuit breakers for SSH work.
 *
 * Two breakers, same shape, independent registries:
 *   - CONNECT breaker (checkBreaker / recordSuccess / recordFailure)
 *   - EXEC breaker    (checkExecBreaker / recordExecSuccess / recordExecFailure)
 *
 * Philosophy: Skynet cannot guarantee that any given host is not currently
 * exploding. Anything can happen on managed hosts — agents doing heavy work,
 * humans running builds, runaway processes. Skynet must gather the info it
 * needs on a best-effort basis, but must never be the reason a host stays
 * broken.
 *
 * The 2026-09-29 workstation incident is the motivating case: Skynet was
 * pushing ~6 SSH commands per second per host at steady state (fleet-status,
 * substrate-orchestrator, spawn-scan, image-gen-scan, phone-call scan, plus
 * per-identity tmux/session/task queries × ~130 identities). When workstation
 * fell slightly behind that ceiling, Skynet kept firing at the same rate.
 * Sessions backed up, per-session latency grew, connect timeouts started
 * firing, but new attempts kept stacking anyway. Throughput collapsed from
 * ~380/min to 1/min in three minutes.
 *
 * The first-round fix (connect breaker) closed the case where the TCP+SSH
 * handshake itself timed out. Follow-up ops evidence (2026-09-29 late-day
 * workstation degradation) showed the peer can be stressed enough that SSH
 * *connects* stay fast (~3ms) while *execs* on the already-open channel
 * time out at 5-8s (fleet-status sweep probe + batch exec). The connect
 * breaker never sees these because it's only wired at socket-open. The exec
 * breaker below covers this failure mode.
 *
 * Why two independent registries rather than a single unified counter:
 *   A fast connect + slow exec is exactly the observed workstation shape.
 *   If both signals rolled into one counter, every successful connect would
 *   reset the exec-failure count (the identity-gate resolver fires
 *   connectOneShot at ~1/frame). The breaker would never open, defeating
 *   the point. Two independent state machines keep each signal honest.
 *
 * ---
 *
 * Wiring:
 *   - Connect breaker: connectOneShot (ssh-one-shot.ts). Every one-shot
 *     connect gets breaker-gated; connect failures counted, connect successes
 *     reset. Covers the identity-gate resolver's per-frame SSH connects and
 *     any other one-shot exec caller.
 *
 *   - Exec breaker: fleet-status ssh-poll-orchestrator's presence probe +
 *     pollOneHostBatch sweep-exec. Both use a long-lived channel.exec with
 *     Promise.race wall-time bounds; on timeout, recordExecFailure fires.
 *     On success, recordExecSuccess resets.
 *
 * ⚠️ **Not yet covered — direct-Client callers.** Several SSH consumers
 * instantiate `new ssh2.Client()` directly and bypass connectOneShot
 * entirely: `terminal.ts` (browser terminal reconnects), `tunnel.ts` +
 * `tunnel-ssh-primitives.ts` (serve-URL / forward tunnels), `server-stats.ts`
 * + `-jump-hosts` variants, `guacamole/routes.ts` (RDP/VNC bootstrap),
 * `docker.ts`, `file-manager.ts`, `credential-deploy-routes.ts`,
 * `snippets.ts`, `jump-host-chain.ts`, `terminal-jump-hosts.ts`. During a
 * real host degradation the breaker will hold back POLLING load, but
 * these direct-Client paths keep pushing at the host. Uniform coverage
 * would need a shared `withPeerBreaker(peer, factory)` helper that any
 * `new Client()` site could wrap — not scoped to this change.
 *
 * ⚠️ **Credential errors do NOT trip the connect breaker.** ssh2 auth
 * failures (bad password, wrong key, key-passphrase mismatch) and sync
 * config errors (invalid key material, unsupported authType) short-circuit
 * before or bypass `recordFailure`. Retrying with the same bad credentials
 * against a healthy host would just reproduce the failure three times and
 * open the breaker system-wide for that peer, blocking every legitimate
 * other caller. See `isCredentialError` in ssh-one-shot.ts.
 *
 * ---
 *
 * Key = peer string (`ip:port`). Matches the shape of every existing
 * connect-failed log line, and matches the peer key format the
 * fleet-status orchestrator uses to identify hosts. No fleet-DB hostId
 * dependency, so this module has no import from anything upstream.
 *
 * State machine (identical for both breakers, per their own registry):
 *   CLOSED   → normal. Every attempt is allowed.
 *              On failure: increment consecutiveFailures.
 *              If consecutiveFailures >= FAILURE_THRESHOLD → OPEN.
 *              On success: reset consecutiveFailures to 0.
 *   OPEN     → refusing. Attempts short-circuit until nextAttemptAt.
 *              At nextAttemptAt → PROBING (one attempt allowed through).
 *   PROBING  → probe in flight. Additional concurrent attempts refused
 *              (act like OPEN) so we don't fan out concurrent probes.
 *              On probe success → CLOSED (reset counters + backoff step).
 *              On probe failure → OPEN with escalated backoff.
 *
 * Backoff schedule (shared between breakers):
 *   step 0 →  30s
 *   step 1 →  60s
 *   step 2 → 120s
 *   step 3 → 300s
 *   step 4+ → 900s (15min cap; never grows past this)
 *
 * Failure threshold = 3 consecutive. Single transient failure shouldn't trip
 * either breaker; three in a row is a clear signal something is genuinely
 * wrong (connect side: ~15-30s of failing at typical 5-10s timeouts; exec
 * side: ~15-24s at 5-8s timeouts).
 *
 * ---
 *
 * Observability: every state transition is logged with `kind=connect|exec`
 * so the two breakers are distinguishable in log grep. Steady-state checks
 * and routine failures below the threshold are silent — they don't need a
 * log line each.
 */

import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Configuration (shared across both breakers)
// ---------------------------------------------------------------------------

/**
 * Consecutive failures before a breaker opens. Chosen for responsiveness
 * (opens within ~15-30s of a real failure at typical per-call timeouts)
 * without tripping on single transient hiccups.
 */
export const FAILURE_THRESHOLD = 3;

/**
 * Exponential backoff windows in milliseconds, indexed by backoffStep.
 * Steps past the end saturate at the last value (15min cap).
 */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [
  30_000, // step 0 —  30s
  60_000, // step 1 —  1min
  120_000, // step 2 —  2min
  300_000, // step 3 —  5min
  900_000, // step 4+ — 15min (cap)
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BreakerState = "CLOSED" | "OPEN" | "PROBING";

export type BreakerCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; nextAttemptAt: number };

/**
 * Thrown by connectOneShot when the connect breaker refuses an attempt.
 * Callers can `instanceof`-check this to log the refusal differently from
 * a genuine connect failure (breaker refusals are expected during known-
 * bad periods, not anomalies).
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly peer: string,
    public readonly nextAttemptAt: number,
  ) {
    const ms = Math.max(0, nextAttemptAt - Date.now());
    super(
      `Circuit breaker OPEN for ${peer}; next probe allowed in ${Math.ceil(ms / 1000)}s`,
    );
    this.name = "CircuitBreakerOpenError";
  }
}

// ---------------------------------------------------------------------------
// Internal state (two independent registries)
// ---------------------------------------------------------------------------

type BreakerEntry = {
  state: BreakerState;
  consecutiveFailures: number;
  backoffStep: number; // index into BACKOFF_SCHEDULE_MS for the NEXT open cycle
  nextAttemptAt: number; // epoch ms; meaningful only when state === OPEN
};

const connectRegistry = new Map<string, BreakerEntry>();
const execRegistry = new Map<string, BreakerEntry>();

function getEntry(
  registry: Map<string, BreakerEntry>,
  peer: string,
): BreakerEntry {
  let entry = registry.get(peer);
  if (!entry) {
    entry = {
      state: "CLOSED",
      consecutiveFailures: 0,
      backoffStep: 0,
      nextAttemptAt: 0,
    };
    registry.set(peer, entry);
  }
  return entry;
}

function backoffForStep(step: number): number {
  const clamped = Math.min(step, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[clamped]!;
}

function logTransition(
  kind: "connect" | "exec",
  peer: string,
  from: BreakerState,
  to: BreakerState,
  entry: BreakerEntry,
): void {
  const msUntilNext = Math.max(0, entry.nextAttemptAt - Date.now());
  sshLogger.warn(
    `[host-circuit-breaker] transition kind=${kind} peer=${peer} from=${from} to=${to} consecutiveFailures=${entry.consecutiveFailures} backoffStep=${entry.backoffStep} nextAttemptInSec=${Math.ceil(msUntilNext / 1000)}`,
    {
      operation: "host_circuit_breaker_transition",
      kind,
      peer,
      from,
      to,
      consecutiveFailures: entry.consecutiveFailures,
      backoffStep: entry.backoffStep,
      nextAttemptInSec: Math.ceil(msUntilNext / 1000),
    },
  );
}

// ---------------------------------------------------------------------------
// Internal state-machine helpers (shared shape; parameterized by registry)
// ---------------------------------------------------------------------------

function checkImpl(
  kind: "connect" | "exec",
  registry: Map<string, BreakerEntry>,
  peer: string,
): BreakerCheckResult {
  const entry = getEntry(registry, peer);
  if (entry.state === "CLOSED") {
    return { allowed: true };
  }
  if (entry.state === "PROBING") {
    return {
      allowed: false,
      reason: "probe in flight",
      nextAttemptAt: entry.nextAttemptAt,
    };
  }
  // OPEN — has the backoff window elapsed?
  if (Date.now() >= entry.nextAttemptAt) {
    const from = entry.state;
    entry.state = "PROBING";
    logTransition(kind, peer, from, "PROBING", entry);
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "backoff window active",
    nextAttemptAt: entry.nextAttemptAt,
  };
}

function recordSuccessImpl(
  kind: "connect" | "exec",
  registry: Map<string, BreakerEntry>,
  peer: string,
): void {
  const entry = getEntry(registry, peer);
  const from = entry.state;
  const hadFailures = entry.consecutiveFailures > 0;
  entry.consecutiveFailures = 0;
  entry.backoffStep = 0;
  entry.nextAttemptAt = 0;
  entry.state = "CLOSED";
  if (from !== "CLOSED" || hadFailures) {
    logTransition(kind, peer, from, "CLOSED", entry);
  }
}

function recordFailureImpl(
  kind: "connect" | "exec",
  registry: Map<string, BreakerEntry>,
  peer: string,
): void {
  const entry = getEntry(registry, peer);
  const from = entry.state;

  if (from === "OPEN") {
    // Defensive: no attempt should have gone out while OPEN. Ignore.
    return;
  }

  if (from === "PROBING") {
    // Probe failed → escalate backoff and re-open.
    entry.backoffStep += 1;
    const window = backoffForStep(entry.backoffStep);
    entry.nextAttemptAt = Date.now() + window;
    entry.state = "OPEN";
    logTransition(kind, peer, from, "OPEN", entry);
    return;
  }

  // from === CLOSED
  entry.consecutiveFailures += 1;
  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
    // Fresh open cycle — start at backoffStep 0.
    entry.backoffStep = 0;
    entry.nextAttemptAt = Date.now() + backoffForStep(0);
    entry.state = "OPEN";
    logTransition(kind, peer, from, "OPEN", entry);
  }
  // else: silent — still below threshold, no transition.
}

// ---------------------------------------------------------------------------
// Public API — CONNECT breaker (existing; behavior unchanged)
// ---------------------------------------------------------------------------

/**
 * Check whether a new CONNECT attempt to `peer` is allowed right now.
 *
 * CLOSED  → allowed=true.
 * OPEN    → if now >= nextAttemptAt, TRANSITION to PROBING and allow this ONE
 *           attempt (the probe). Otherwise allowed=false.
 * PROBING → allowed=false (a probe is already in flight; don't fan out).
 *
 * When allowed=true, the caller MUST subsequently call recordSuccess or
 * recordFailure so the state machine can resolve. Failing to do that in the
 * PROBING branch leaves the breaker stuck.
 */
export function checkBreaker(peer: string): BreakerCheckResult {
  return checkImpl("connect", connectRegistry, peer);
}

/**
 * Record that a CONNECT attempt against `peer` succeeded. Transitions the
 * connect breaker to CLOSED (and resets counters + backoff step) if it wasn't
 * already there.
 */
export function recordSuccess(peer: string): void {
  recordSuccessImpl("connect", connectRegistry, peer);
}

/**
 * Record that a CONNECT attempt against `peer` failed. Advances state
 * per the state-machine rules in the module docblock.
 */
export function recordFailure(peer: string): void {
  recordFailureImpl("connect", connectRegistry, peer);
}

/**
 * Read-only snapshot of the CONNECT breaker for observability (tests,
 * diagnostics). Returns null if the peer has no entry.
 */
export function getBreakerSnapshot(
  peer: string,
): Readonly<BreakerEntry> | null {
  const entry = connectRegistry.get(peer);
  if (!entry) return null;
  return { ...entry };
}

/**
 * __resetBreakerRegistryForTests — clears the CONNECT breaker's registry Map.
 *
 * TEST-ONLY. Call in beforeEach to prevent state leak between test cases.
 * The __ prefix signals internal-only; do not call from production code.
 */
export function __resetBreakerRegistryForTests(): void {
  connectRegistry.clear();
}

// ---------------------------------------------------------------------------
// Public API — EXEC breaker (parallel; independent state)
// ---------------------------------------------------------------------------

/**
 * Check whether a new EXEC attempt (channel.exec) against `peer` is allowed
 * right now. Same state-machine semantics as checkBreaker; independent
 * registry — an EXEC breaker OPEN does NOT block connects, and a CONNECT
 * breaker OPEN does NOT block execs. See module docblock for the rationale.
 *
 * When allowed=true, the caller MUST subsequently call recordExecSuccess or
 * recordExecFailure so the state machine can resolve.
 *
 * Distinct from `CircuitBreakerOpenError`: the exec breaker does not throw
 * a dedicated error class because its call sites (fleet-status probe and
 * batch-exec) already have a natural fail-return-shape. Refused-because-OPEN
 * is treated the same way as refused-because-timeout at those sites.
 */
export function checkExecBreaker(peer: string): BreakerCheckResult {
  return checkImpl("exec", execRegistry, peer);
}

/**
 * Record that an EXEC attempt against `peer` succeeded. Transitions the exec
 * breaker to CLOSED (and resets counters + backoff step) if it wasn't already
 * there.
 */
export function recordExecSuccess(peer: string): void {
  recordSuccessImpl("exec", execRegistry, peer);
}

/**
 * Record that an EXEC attempt against `peer` failed (timeout, null stdout on
 * a nonempty peer, or an SSH-layer channel error surfaced by the caller).
 * Advances state per the state-machine rules in the module docblock.
 */
export function recordExecFailure(peer: string): void {
  recordFailureImpl("exec", execRegistry, peer);
}

/**
 * Read-only snapshot of the EXEC breaker for observability (tests,
 * diagnostics). Returns null if the peer has no entry.
 */
export function getExecBreakerSnapshot(
  peer: string,
): Readonly<BreakerEntry> | null {
  const entry = execRegistry.get(peer);
  if (!entry) return null;
  return { ...entry };
}

/**
 * __resetExecBreakerRegistryForTests — clears the EXEC breaker's registry Map.
 *
 * TEST-ONLY. Call in beforeEach to prevent state leak between test cases.
 */
export function __resetExecBreakerRegistryForTests(): void {
  execRegistry.clear();
}
