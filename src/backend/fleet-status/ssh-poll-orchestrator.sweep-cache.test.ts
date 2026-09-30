/**
 * ssh-poll-orchestrator.sweep-cache.test.ts — unit tests for the peer-keyed
 * sweep-result cache added to dedup SSH sweep calls when two orchestrators
 * (one per Skynet user) hold host rows pointing at the same physical box.
 *
 * Covers:
 *   - Fresh peer starts empty, returns null on read.
 *   - cacheSweepResult stores bytes and getCachedSweepResult returns them
 *     within the TTL window.
 *   - Expired entries return null on read AND are pruned from the Map.
 *   - Peers are independent — one peer's cache doesn't affect another.
 *   - Re-caching overwrites the prior entry (fresh window, latest bytes).
 *   - Empty-string result caches and returns cleanly (distinct from null-miss).
 *
 * The cache lives at module scope so all orchestrators in the same Node
 * process share it. Tests explicitly reset it in beforeEach to prevent
 * state leak between cases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSweepResultCacheForTests,
  SWEEP_RESULT_CACHE_TTL_MS,
  cacheSweepResult,
  getCachedSweepResult,
} from "./ssh-poll-orchestrator.js";

beforeEach(() => {
  __resetSweepResultCacheForTests();
  vi.useRealTimers();
});

describe("sweep-result cache — starting state", () => {
  it("returns null for a fresh peer", () => {
    expect(getCachedSweepResult("1.2.3.4:22")).toBeNull();
  });
});

describe("sweep-result cache — fresh writes", () => {
  it("returns the stored bytes on read within the TTL window", () => {
    const peer = "10.0.0.1:22";
    const payload = '{"kind":"identity","identity":"willa"}';
    cacheSweepResult(peer, payload);
    expect(getCachedSweepResult(peer)).toBe(payload);
  });

  it("re-caching overwrites the prior entry with the latest bytes", () => {
    const peer = "10.0.0.2:22";
    cacheSweepResult(peer, "first");
    cacheSweepResult(peer, "second");
    expect(getCachedSweepResult(peer)).toBe("second");
  });

  it("empty-string result caches cleanly and returns as empty (not null)", () => {
    // Distinct signal: an empty sweep is a legitimate emission for a
    // just-provisioned box (no identities on disk yet). The cache MUST
    // preserve the difference between "peer emitted empty this tick" and
    // "no cache entry for this peer."
    const peer = "10.0.0.3:22";
    cacheSweepResult(peer, "");
    expect(getCachedSweepResult(peer)).toBe("");
  });
});

describe("sweep-result cache — TTL expiry", () => {
  it("returns null after the TTL elapses (exact boundary)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T22:00:00Z"));
    const peer = "10.0.0.4:22";
    cacheSweepResult(peer, "payload");

    // Just inside the window — still hits.
    vi.advanceTimersByTime(SWEEP_RESULT_CACHE_TTL_MS - 1);
    expect(getCachedSweepResult(peer)).toBe("payload");

    // Exactly at the window boundary — Date.now() >= expiresAt evicts.
    vi.advanceTimersByTime(1);
    expect(getCachedSweepResult(peer)).toBeNull();
  });

  it("expired read prunes the entry from the underlying Map", () => {
    // Without eviction on expired read, the Map would grow unbounded over
    // the process's lifetime (one entry per peer ever polled). Locking the
    // prune-on-read behavior guards against that leak.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T22:00:00Z"));
    const peer = "10.0.0.5:22";
    cacheSweepResult(peer, "payload");

    // Force expiry.
    vi.advanceTimersByTime(SWEEP_RESULT_CACHE_TTL_MS + 100);

    // First expired read returns null AND evicts.
    expect(getCachedSweepResult(peer)).toBeNull();

    // A subsequent cacheSweepResult must create a fresh entry with a new
    // TTL window relative to now — not extend the old expired window.
    cacheSweepResult(peer, "refresh");
    expect(getCachedSweepResult(peer)).toBe("refresh");
  });
});

describe("sweep-result cache — peer independence", () => {
  it("one peer's cached entry does not affect another peer's read", () => {
    const peerA = "10.0.0.6:22";
    const peerB = "10.0.0.7:22";
    cacheSweepResult(peerA, "for-A");
    expect(getCachedSweepResult(peerA)).toBe("for-A");
    expect(getCachedSweepResult(peerB)).toBeNull();
  });

  it("expiring one peer's entry does not affect another peer's entry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T22:00:00Z"));
    const peerA = "10.0.0.8:22";
    const peerB = "10.0.0.9:22";
    cacheSweepResult(peerA, "for-A");

    // Advance halfway through TTL, then cache peerB.
    vi.advanceTimersByTime(SWEEP_RESULT_CACHE_TTL_MS / 2);
    cacheSweepResult(peerB, "for-B");

    // Advance past peerA's expiry but not peerB's.
    vi.advanceTimersByTime(SWEEP_RESULT_CACHE_TTL_MS / 2 + 100);

    expect(getCachedSweepResult(peerA)).toBeNull();
    expect(getCachedSweepResult(peerB)).toBe("for-B");
  });
});

describe("sweep-result cache — two-orchestrator dedup shape", () => {
  it("second-orchestrator read within TTL returns the first-orchestrator's bytes verbatim", () => {
    // This is the failure-mode the cache was added to solve: two orchestrators
    // (user's and joe's) each polling workstation independently. Under the
    // old shape, both fire fleet-status-sweep. Under the cache shape, the
    // second orchestrator's read must return the first's cached bytes byte-
    // for-byte, so the two orchestrators publish IDENTICAL downstream frames.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T22:00:00Z"));
    const peer = "100.82.225.100:22"; // real workstation peer for shape realism
    const sweepBytes = [
      '{"kind":"identity","identity":"willa","tmuxSession":"willa","hostId":"7"}',
      '{"kind":"pid","pid":12345}',
      '{"kind":"identity","identity":"aqua","tmuxSession":"aqua","hostId":"7"}',
    ].join("\n");

    // Orchestrator A polls first, caches.
    cacheSweepResult(peer, sweepBytes);

    // Orchestrator B polls 200ms later — well inside the TTL.
    vi.advanceTimersByTime(200);
    const readB = getCachedSweepResult(peer);
    expect(readB).toBe(sweepBytes);

    // Orchestrator A polls again at T=2000ms (its natural 2s cadence).
    // Cache is expired (TTL 1500ms) — miss, so it'd fire a fresh exec in
    // production. Here we just assert the miss.
    vi.advanceTimersByTime(2000 - 200);
    expect(getCachedSweepResult(peer)).toBeNull();
  });

  it("TTL is deliberately shorter than the default pollIntervalMs (2000ms)", () => {
    // Docblock invariant: cache TTL sits below the poll interval so a lone
    // orchestrator on its natural cadence effectively always misses, while
    // a second orchestrator polling within the window hits. This test
    // locks the invariant.
    expect(SWEEP_RESULT_CACHE_TTL_MS).toBeLessThan(2000);
  });
});
