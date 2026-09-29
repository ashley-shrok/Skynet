/**
 * host-circuit-breaker.test.ts — unit tests for the per-peer circuit breaker.
 *
 * Covers:
 *   - Fresh peer starts CLOSED, allows attempts.
 *   - Failures below threshold stay CLOSED, no state exposure.
 *   - Threshold failures open the breaker with backoff step 0 (30s).
 *   - CLOSED success resets counters.
 *   - OPEN refuses attempts inside the backoff window (with reason + nextAttemptAt).
 *   - OPEN transitions to PROBING when window elapses (single probe allowed).
 *   - PROBING refuses concurrent additional attempts.
 *   - PROBING success closes and resets backoff step.
 *   - PROBING failure re-opens with escalated backoff step.
 *   - Backoff schedule saturates at the cap (15min).
 *   - Peers are independent — one peer's state doesn't affect another.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetBreakerRegistryForTests,
  __resetExecBreakerRegistryForTests,
  BACKOFF_SCHEDULE_MS,
  CircuitBreakerOpenError,
  FAILURE_THRESHOLD,
  checkBreaker,
  checkExecBreaker,
  getBreakerSnapshot,
  getExecBreakerSnapshot,
  recordExecFailure,
  recordExecSuccess,
  recordFailure,
  recordSuccess,
} from "./host-circuit-breaker.js";

beforeEach(() => {
  __resetBreakerRegistryForTests();
  __resetExecBreakerRegistryForTests();
  vi.useRealTimers();
});

describe("host-circuit-breaker — starting state", () => {
  it("returns allowed=true for a fresh peer", () => {
    const result = checkBreaker("1.2.3.4:22");
    expect(result.allowed).toBe(true);
  });

  it("getBreakerSnapshot returns null for a never-touched peer", () => {
    expect(getBreakerSnapshot("never-seen:22")).toBeNull();
  });
});

describe("host-circuit-breaker — CLOSED failure counting", () => {
  it("stays CLOSED under threshold, no allowed=false", () => {
    const peer = "10.0.0.1:22";
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      recordFailure(peer);
      expect(checkBreaker(peer).allowed).toBe(true);
    }
    const snap = getBreakerSnapshot(peer);
    expect(snap?.state).toBe("CLOSED");
    expect(snap?.consecutiveFailures).toBe(FAILURE_THRESHOLD - 1);
  });

  it("opens on the Nth consecutive failure with backoff step 0 (exact 30s window)", () => {
    // Fake timers so the nextAttemptAt equality assertion is deterministic —
    // GC pause between recordFailure and Date.now() would otherwise flake.
    vi.useFakeTimers();
    const t0 = new Date("2026-09-29T17:00:00Z").getTime();
    vi.setSystemTime(t0);
    const peer = "10.0.0.2:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    const snap = getBreakerSnapshot(peer);
    expect(snap?.state).toBe("OPEN");
    expect(snap?.backoffStep).toBe(0);
    // Exact window — no fuzz.
    expect(snap?.nextAttemptAt).toBe(t0 + BACKOFF_SCHEDULE_MS[0]!);
  });

  it("recordSuccess resets consecutive failure count", () => {
    const peer = "10.0.0.3:22";
    recordFailure(peer);
    recordFailure(peer);
    recordSuccess(peer);
    expect(getBreakerSnapshot(peer)?.consecutiveFailures).toBe(0);
    expect(getBreakerSnapshot(peer)?.state).toBe("CLOSED");
  });
});

describe("host-circuit-breaker — OPEN refusal", () => {
  it("refuses attempts inside the backoff window with reason + nextAttemptAt", () => {
    const peer = "10.0.0.4:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    const result = checkBreaker(peer);
    expect(result.allowed).toBe(false);
    if (result.allowed === false) {
      expect(result.reason).toBe("backoff window active");
      expect(result.nextAttemptAt).toBeGreaterThan(Date.now());
    }
  });

  it("CircuitBreakerOpenError carries peer and nextAttemptAt", () => {
    const nextAt = Date.now() + 45_000;
    const err = new CircuitBreakerOpenError("10.0.0.5:22", nextAt);
    expect(err.peer).toBe("10.0.0.5:22");
    expect(err.nextAttemptAt).toBe(nextAt);
    expect(err.name).toBe("CircuitBreakerOpenError");
    expect(err.message).toContain("10.0.0.5:22");
    expect(err.message).toContain("OPEN");
  });
});

describe("host-circuit-breaker — OPEN → PROBING transition", () => {
  it("transitions to PROBING and allows one attempt when backoff window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
    const peer = "10.0.0.6:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    expect(getBreakerSnapshot(peer)?.state).toBe("OPEN");

    // Advance beyond the 30s window.
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);

    const result = checkBreaker(peer);
    expect(result.allowed).toBe(true);
    expect(getBreakerSnapshot(peer)?.state).toBe("PROBING");
  });

  it("sequential attempt after PROBING transition is refused with 'probe in flight'", () => {
    // NB: Node's single-threaded event loop makes checkBreaker synchronous,
    // so a truly-concurrent test isn't expressible here — we exercise the
    // "state was already mutated to PROBING" branch that guards the
    // invariant. If checkBreaker ever becomes async (e.g. persistent-store
    // backed), this test would need to be rewritten to prove the same
    // guarantee under real concurrency.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
    const peer = "10.0.0.7:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);

    // First check moves to PROBING and allows.
    const first = checkBreaker(peer);
    expect(first.allowed).toBe(true);

    // Second check while probe is in-flight → refused with reason.
    const second = checkBreaker(peer);
    expect(second.allowed).toBe(false);
    if (second.allowed === false) {
      expect(second.reason).toBe("probe in flight");
    }
  });
});

describe("host-circuit-breaker — PROBING resolution", () => {
  it("probe success closes the breaker and resets backoff step", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
    const peer = "10.0.0.8:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);
    checkBreaker(peer); // → PROBING

    recordSuccess(peer);

    const snap = getBreakerSnapshot(peer);
    expect(snap?.state).toBe("CLOSED");
    expect(snap?.consecutiveFailures).toBe(0);
    expect(snap?.backoffStep).toBe(0);
    expect(snap?.nextAttemptAt).toBe(0);
  });

  it("probe failure re-opens with escalated backoff step (exact 60s window)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-29T17:00:00Z").getTime();
    vi.setSystemTime(t0);
    const peer = "10.0.0.9:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    expect(getBreakerSnapshot(peer)?.backoffStep).toBe(0);

    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);
    checkBreaker(peer); // → PROBING

    const probeFailTime = Date.now();
    recordFailure(peer); // probe fails

    const snap = getBreakerSnapshot(peer);
    expect(snap?.state).toBe("OPEN");
    expect(snap?.backoffStep).toBe(1);
    // Exact window from probe-fail time — no fuzz.
    expect(snap?.nextAttemptAt).toBe(probeFailTime + BACKOFF_SCHEDULE_MS[1]!);
  });

  it("consecutive probe failures escalate through the schedule and saturate at the cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
    const peer = "10.0.0.10:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);

    // Walk through the full schedule + a few extra to prove saturation.
    for (let step = 0; step < BACKOFF_SCHEDULE_MS.length + 3; step++) {
      const currentWindow = BACKOFF_SCHEDULE_MS[
        Math.min(step, BACKOFF_SCHEDULE_MS.length - 1)
      ]!;
      vi.advanceTimersByTime(currentWindow + 500);
      checkBreaker(peer); // → PROBING
      recordFailure(peer); // probe fails
    }

    const snap = getBreakerSnapshot(peer);
    expect(snap?.state).toBe("OPEN");
    // backoffStep grows unbounded, but the window saturates.
    const msUntil = snap!.nextAttemptAt - Date.now();
    const cap = BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]!;
    expect(msUntil).toBeGreaterThan(cap - 1_000);
    expect(msUntil).toBeLessThanOrEqual(cap);
  });
});

describe("host-circuit-breaker — peer independence", () => {
  it("one peer's state does not affect another", () => {
    const peerA = "10.0.0.11:22";
    const peerB = "10.0.0.12:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peerA);

    expect(getBreakerSnapshot(peerA)?.state).toBe("OPEN");
    expect(checkBreaker(peerB).allowed).toBe(true);
    expect(getBreakerSnapshot(peerB)?.state).toBe("CLOSED");
  });
});

describe("host-circuit-breaker — defensive edge cases", () => {
  it("recordFailure while OPEN is a no-op (defensive; no state corruption)", () => {
    const peer = "10.0.0.13:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    const before = getBreakerSnapshot(peer)!;

    // A stray recordFailure while OPEN — should not corrupt state.
    recordFailure(peer);
    const after = getBreakerSnapshot(peer)!;

    expect(after.state).toBe(before.state);
    expect(after.consecutiveFailures).toBe(before.consecutiveFailures);
    expect(after.backoffStep).toBe(before.backoffStep);
    expect(after.nextAttemptAt).toBe(before.nextAttemptAt);
  });

  it("recordSuccess on a fresh (never-failed) peer creates the entry with all-zero state", () => {
    // Steady-state healthy fleet is expected to call recordSuccess ~thousands
    // of times per minute on already-CLOSED peers. This test pins the
    // expected post-state — invariant callers rely on when a snapshot is
    // taken mid-flight.
    const peer = "10.0.0.14:22";
    recordSuccess(peer);
    const snap = getBreakerSnapshot(peer);
    expect(snap).toEqual({
      state: "CLOSED",
      consecutiveFailures: 0,
      backoffStep: 0,
      nextAttemptAt: 0,
    });
  });

  it("recovered breaker resets backoffStep for the NEXT open cycle", () => {
    // OPEN → escalate → PROBING → success → CLOSED. The next threshold
    // failure must start over from step 0 (30s), not carry the escalated
    // backoffStep from the previous cycle.
    vi.useFakeTimers();
    const t0 = new Date("2026-09-29T17:00:00Z").getTime();
    vi.setSystemTime(t0);
    const peer = "10.0.0.15:22";

    // First open cycle — advance to backoffStep 2 (probe fails twice).
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);
    checkBreaker(peer);
    recordFailure(peer); // → step 1
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[1]! + 500);
    checkBreaker(peer);
    recordFailure(peer); // → step 2
    expect(getBreakerSnapshot(peer)?.backoffStep).toBe(2);

    // Recovery — successful probe.
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[2]! + 500);
    checkBreaker(peer);
    recordSuccess(peer);
    expect(getBreakerSnapshot(peer)?.state).toBe("CLOSED");
    expect(getBreakerSnapshot(peer)?.backoffStep).toBe(0);

    // Next threshold failure must open at step 0 (30s), NOT step 3 (300s).
    const openAt = Date.now();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    const snap = getBreakerSnapshot(peer)!;
    expect(snap.state).toBe("OPEN");
    expect(snap.backoffStep).toBe(0);
    expect(snap.nextAttemptAt).toBe(openAt + BACKOFF_SCHEDULE_MS[0]!);
  });
});

// ---------------------------------------------------------------------------
// EXEC breaker — parallel state machine, independent registry.
// The tests below prove:
//   (a) checkExec / recordExecFailure / recordExecSuccess drive the state
//       machine with the same semantics as the connect breaker, and
//   (b) exec and connect breakers on the SAME peer are INDEPENDENT — the
//       whole point of the two-registry split (see module docblock).
// ---------------------------------------------------------------------------

describe("host-circuit-breaker EXEC — starting state", () => {
  it("returns allowed=true for a fresh peer", () => {
    expect(checkExecBreaker("1.2.3.4:22").allowed).toBe(true);
  });

  it("getExecBreakerSnapshot returns null for a never-touched peer", () => {
    expect(getExecBreakerSnapshot("never-seen:22")).toBeNull();
  });
});

describe("host-circuit-breaker EXEC — CLOSED failure counting", () => {
  it("stays CLOSED under threshold, no allowed=false", () => {
    const peer = "10.1.0.1:22";
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      recordExecFailure(peer);
      expect(checkExecBreaker(peer).allowed).toBe(true);
    }
    const snap = getExecBreakerSnapshot(peer);
    expect(snap?.state).toBe("CLOSED");
    expect(snap?.consecutiveFailures).toBe(FAILURE_THRESHOLD - 1);
  });

  it("opens on the Nth consecutive failure with backoff step 0 (exact 30s window)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-29T17:00:00Z").getTime();
    vi.setSystemTime(t0);
    const peer = "10.1.0.2:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordExecFailure(peer);
    const snap = getExecBreakerSnapshot(peer);
    expect(snap?.state).toBe("OPEN");
    expect(snap?.backoffStep).toBe(0);
    expect(snap?.nextAttemptAt).toBe(t0 + BACKOFF_SCHEDULE_MS[0]!);
  });

  it("recordExecSuccess resets consecutive failure count", () => {
    const peer = "10.1.0.3:22";
    recordExecFailure(peer);
    recordExecFailure(peer);
    recordExecSuccess(peer);
    expect(getExecBreakerSnapshot(peer)?.consecutiveFailures).toBe(0);
    expect(getExecBreakerSnapshot(peer)?.state).toBe("CLOSED");
  });
});

describe("host-circuit-breaker EXEC — OPEN refusal + PROBING resolution", () => {
  it("refuses attempts inside the backoff window with reason + nextAttemptAt", () => {
    const peer = "10.1.0.4:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordExecFailure(peer);
    const result = checkExecBreaker(peer);
    expect(result.allowed).toBe(false);
    if (result.allowed === false) {
      expect(result.reason).toBe("backoff window active");
      expect(result.nextAttemptAt).toBeGreaterThan(Date.now());
    }
  });

  it("probe success closes the breaker and resets backoff step", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
    const peer = "10.1.0.5:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordExecFailure(peer);
    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);
    checkExecBreaker(peer); // → PROBING

    recordExecSuccess(peer);

    const snap = getExecBreakerSnapshot(peer);
    expect(snap?.state).toBe("CLOSED");
    expect(snap?.consecutiveFailures).toBe(0);
    expect(snap?.backoffStep).toBe(0);
    expect(snap?.nextAttemptAt).toBe(0);
  });

  it("probe failure re-opens with escalated backoff step (exact 60s window)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-29T17:00:00Z").getTime();
    vi.setSystemTime(t0);
    const peer = "10.1.0.6:22";
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordExecFailure(peer);

    vi.advanceTimersByTime(BACKOFF_SCHEDULE_MS[0]! + 500);
    checkExecBreaker(peer); // → PROBING

    const probeFailTime = Date.now();
    recordExecFailure(peer); // probe fails

    const snap = getExecBreakerSnapshot(peer);
    expect(snap?.state).toBe("OPEN");
    expect(snap?.backoffStep).toBe(1);
    expect(snap?.nextAttemptAt).toBe(probeFailTime + BACKOFF_SCHEDULE_MS[1]!);
  });
});

describe("host-circuit-breaker — connect and exec breakers are independent", () => {
  it("exec breaker OPEN does not affect connect breaker on the same peer", () => {
    const peer = "10.2.0.1:22";
    // Trip the exec breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordExecFailure(peer);
    expect(getExecBreakerSnapshot(peer)?.state).toBe("OPEN");
    expect(checkExecBreaker(peer).allowed).toBe(false);

    // Connect breaker on the same peer is untouched — allows the attempt,
    // and after the check the connect entry exists but is CLOSED (default
    // shape). No shared registry, no bleed-through.
    expect(checkBreaker(peer).allowed).toBe(true);
    const connectSnap = getBreakerSnapshot(peer);
    expect(connectSnap?.state).toBe("CLOSED");
    expect(connectSnap?.consecutiveFailures).toBe(0);
  });

  it("connect breaker OPEN does not affect exec breaker on the same peer", () => {
    const peer = "10.2.0.2:22";
    // Trip the connect breaker.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordFailure(peer);
    expect(getBreakerSnapshot(peer)?.state).toBe("OPEN");
    expect(checkBreaker(peer).allowed).toBe(false);

    // Exec breaker on the same peer is untouched — allows the attempt,
    // and after the check the exec entry exists but is CLOSED.
    expect(checkExecBreaker(peer).allowed).toBe(true);
    const execSnap = getExecBreakerSnapshot(peer);
    expect(execSnap?.state).toBe("CLOSED");
    expect(execSnap?.consecutiveFailures).toBe(0);
  });

  it("connect success does NOT reset exec failure counter — the whole point of the split", () => {
    // The observed workstation shape: fast connects, slow execs. If a
    // successful connect reset the exec counter, the exec breaker would
    // never open (identity-gate resolver's per-frame connectOneShot's
    // recordSuccess would keep zeroing the exec counter). This test locks
    // that guarantee.
    const peer = "10.2.0.3:22";
    recordExecFailure(peer);
    recordExecFailure(peer);
    expect(getExecBreakerSnapshot(peer)?.consecutiveFailures).toBe(2);

    // A concurrent connect success MUST NOT touch the exec counter.
    recordSuccess(peer);

    expect(getExecBreakerSnapshot(peer)?.consecutiveFailures).toBe(2);
    // One more exec failure → still opens at threshold, unaffected by
    // the connect success above.
    recordExecFailure(peer);
    expect(getExecBreakerSnapshot(peer)?.state).toBe("OPEN");
  });
});
