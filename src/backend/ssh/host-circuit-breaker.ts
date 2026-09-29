/**
 * host-circuit-breaker.ts — Per-peer circuit breaker for SSH connect attempts.
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
 * This module encodes the fix: after N consecutive connect failures against
 * a peer, refuse further connect attempts to that peer for an exponentially-
 * increasing backoff window. One probe is allowed at each window's end. On
 * probe success, breaker closes and normal cadence resumes. On probe failure,
 * backoff escalates.
 *
 * Wired at connectOneShot (ssh-one-shot.ts) so every consumer of that
 * function inherits protection at one point. That covers all five polling
 * orchestrators (fleet-status, distributor/substrate, spawn-scan,
 * image-gen-scan, phone-call-scan) plus any callers that route through
 * connectOneShot for one-shot exec work.
 *
 * ⚠️ **Not yet covered — direct-Client callers.** Several SSH consumers
 * instantiate `new ssh2.Client()` directly and bypass connectOneShot
 * entirely: `terminal.ts` (browser terminal reconnects), `tunnel.ts` +
 * `tunnel-ssh-primitives.ts` (serve-URL / forward tunnels), `server-stats.ts`
 * + `-jump-hosts` variants, `guacamole/routes.ts` (RDP/VNC bootstrap),
 * `docker.ts`, `file-manager.ts`, `credential-deploy-routes.ts`,
 * `snippets.ts`, `jump-host-chain.ts`, `terminal-jump-hosts.ts`. During a
 * real host degradation the breaker will hold back POLLING load, but
 * these direct-Client paths keep pushing at the host. Follow-up bounty:
 * extract a `withPeerBreaker(peer, factory)` helper that any `new Client()`
 * site can wrap so coverage is uniform.
 *
 * ⚠️ **Credential errors do NOT trip the breaker.** ssh2 auth failures
 * (bad password, wrong key, key-passphrase mismatch) and sync config
 * errors (invalid key material, unsupported authType) short-circuit
 * before or bypass `recordFailure`. Retrying with the same bad
 * credentials against a healthy host would just reproduce the failure
 * three times and open the breaker system-wide for that peer, blocking
 * every legitimate other caller. See `isCredentialError` in ssh-one-shot.ts.
 *
 * ---
 *
 * Key = peer string (`ip:port`). That's what the underlying SSH layer knows
 * about; matches the shape of every existing connect-failed log line. No
 * fleet-DB hostId dependency, so this module has no import from anything
 * upstream.
 *
 * State machine:
 *   CLOSED   → normal. Every connect attempt is allowed.
 *              On failure: increment consecutiveFailures.
 *              If consecutiveFailures >= FAILURE_THRESHOLD → OPEN.
 *              On success: reset consecutiveFailures to 0.
 *   OPEN     → refusing. Connect attempts short-circuit with
 *              CircuitBreakerOpenError until nextAttemptAt is reached.
 *              At nextAttemptAt → PROBING (one attempt allowed through).
 *   PROBING  → probe in flight. Additional concurrent attempts are refused
 *              (act like OPEN) so we don't fan out concurrent probes.
 *              On probe success → CLOSED (reset counters + backoff step).
 *              On probe failure → OPEN with escalated backoff.
 *
 * Backoff schedule (index into BACKOFF_SCHEDULE_MS):
 *   step 0 →  30s
 *   step 1 →  60s
 *   step 2 → 120s
 *   step 3 → 300s
 *   step 4+ → 900s (15min cap; never grows past this)
 *
 * Failure threshold = 3 consecutive. Single transient failure shouldn't trip
 * the breaker; three in a row (each with a 5-10s timeout, so 15-30s of failing
 * before we open) is a clear signal something is genuinely wrong.
 *
 * ---
 *
 * Observability: every state transition is logged (CLOSED→OPEN,
 * OPEN→PROBING, PROBING→CLOSED, PROBING→OPEN). Steady-state checks and
 * routine failures below the threshold are silent — they don't need a log
 * line each.
 */

import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Consecutive connect failures before the breaker opens. Chosen for
 * responsiveness (opens within ~15-30s of a real failure at typical
 * per-call timeouts) without tripping on single transient hiccups.
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
 * Thrown by connectOneShot when the breaker refuses an attempt. Callers can
 * `instanceof`-check this to log the refusal differently from a genuine
 * connect failure (breaker refusals are expected during known-bad periods,
 * not anomalies).
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
// Internal state
// ---------------------------------------------------------------------------

type BreakerEntry = {
  state: BreakerState;
  consecutiveFailures: number;
  backoffStep: number; // index into BACKOFF_SCHEDULE_MS for the NEXT open cycle
  nextAttemptAt: number; // epoch ms; meaningful only when state === OPEN
};

const registry = new Map<string, BreakerEntry>();

function get(peer: string): BreakerEntry {
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
  peer: string,
  from: BreakerState,
  to: BreakerState,
  entry: BreakerEntry,
): void {
  const msUntilNext = Math.max(0, entry.nextAttemptAt - Date.now());
  sshLogger.warn(
    `[host-circuit-breaker] transition peer=${peer} from=${from} to=${to} consecutiveFailures=${entry.consecutiveFailures} backoffStep=${entry.backoffStep} nextAttemptInSec=${Math.ceil(msUntilNext / 1000)}`,
    {
      operation: "host_circuit_breaker_transition",
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a new connect attempt to `peer` is allowed right now.
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
  const entry = get(peer);
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
    logTransition(peer, from, "PROBING", entry);
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "backoff window active",
    nextAttemptAt: entry.nextAttemptAt,
  };
}

/**
 * Record that a connect attempt against `peer` succeeded. Transitions the
 * breaker to CLOSED (and resets counters + backoff step) if it wasn't
 * already there.
 */
export function recordSuccess(peer: string): void {
  const entry = get(peer);
  const from = entry.state;
  const hadFailures = entry.consecutiveFailures > 0;
  entry.consecutiveFailures = 0;
  entry.backoffStep = 0;
  entry.nextAttemptAt = 0;
  entry.state = "CLOSED";
  if (from !== "CLOSED" || hadFailures) {
    logTransition(peer, from, "CLOSED", entry);
  }
}

/**
 * Record that a connect attempt against `peer` failed. Advances state
 * per the rules in the module docblock.
 *
 * From CLOSED  : increment consecutiveFailures. If threshold hit → OPEN.
 * From PROBING : the probe failed. Escalate backoffStep and go back to OPEN.
 * From OPEN    : should not normally happen (the connect was refused, so
 *                nothing should be reporting a failure). Treated as a no-op
 *                to be defensive — a stray call must not corrupt state.
 */
export function recordFailure(peer: string): void {
  const entry = get(peer);
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
    logTransition(peer, from, "OPEN", entry);
    return;
  }

  // from === CLOSED
  entry.consecutiveFailures += 1;
  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
    // Fresh open cycle — start at backoffStep 0.
    entry.backoffStep = 0;
    entry.nextAttemptAt = Date.now() + backoffForStep(0);
    entry.state = "OPEN";
    logTransition(peer, from, "OPEN", entry);
  }
  // else: silent — still below threshold, no transition.
}

/**
 * Read-only snapshot for observability (tests, diagnostics).
 * Returns null if the peer has no entry (never been checked).
 */
export function getBreakerSnapshot(peer: string): Readonly<BreakerEntry> | null {
  const entry = registry.get(peer);
  if (!entry) return null;
  return { ...entry };
}

/**
 * __resetBreakerRegistryForTests — clears the module-scope registry Map.
 *
 * TEST-ONLY. Call in beforeEach to prevent state leak between test cases.
 * The __ prefix signals internal-only; do not call from production code.
 */
export function __resetBreakerRegistryForTests(): void {
  registry.clear();
}
