/**
 * Phase 50 Plan 01 Task 2 — per-session queue-enqueue dedup.
 *
 * The Claude Code harness writes a queued user message TWICE in the
 * session file: first as `type:"queue-operation", operation:"enqueue"`
 * when it slots the message into its own queue (~T+0, empirically ~111ms
 * after send per 50-CONTEXT.md § Empirical evidence), and again as a
 * normal `type:"user"` turn when the queue drains and Claude actually
 * consumes the message (up to ~2 MINUTES later per the same empirical
 * evidence). Without dedup, both frames would render as two bubbles.
 *
 * The parser now emits the first (Task 1); this seam applies a
 * per-session sliding-window dedup keyed on `contentHash = sha256(content).slice(0, 32)`
 * — content-only, NO sessionId, NO timestamp (see 50-01-PLAN.md § objective
 * "Hash-derivation contract" for the rationale; the enqueue and dequeue
 * timestamps differ, so any timestamp-inclusive key would fail to match).
 * Per-session scope comes from the Map living on the per-connection
 * closure. Wall-clock TTL is 10 minutes; capacity is capped at 100 entries
 * with oldest-first eviction.
 *
 * Six behaviors covered:
 *   1. Dedup fires across long span — enqueue at T+0 emits; matching
 *      user turn at T+120s (2 MINUTES — matches empirical dequeue span)
 *      suppresses.
 *   2. Different content, no dedup — enqueue "hello" then user "goodbye"
 *      → both emit.
 *   3. Different session, no dedup — dedup is per-session-scoped by
 *      construction (Map lives on the tail-watcher closure); this test
 *      demonstrates that two independent Maps do not cross-contaminate.
 *   4. Dedup expiry — T+11min → matching user turn emits (entry pruned).
 *   5. Dedup cap — 100 unique enqueues; the 101st evicts the oldest;
 *      a user-turn matching entry #1 emits (no longer in Map).
 *   6. Task-notification path unaffected — enqueue with <task-notification>
 *      content does NOT populate the dedup Map (patch #66 branch still
 *      owns that path); later matching user turn does NOT suppress.
 */

import { describe, it, expect } from "vitest";
import { parseSessionLine } from "./session-file-parser.js";
import { __applyQueueDedupForTests } from "./claude-session-server.js";

const TEN_MIN_MS = 10 * 60 * 1000;

function makeEnqueue(content: string, ts: string = "2026-08-20T12:00:00.000Z"): {
  parsedFrame: ReturnType<typeof parseSessionLine>;
  rawObj: Record<string, unknown>;
} {
  const rawObj = {
    type: "queue-operation" as const,
    operation: "enqueue" as const,
    content,
    timestamp: ts,
  };
  const parsedFrame = parseSessionLine(JSON.stringify(rawObj), "sess-A");
  return { parsedFrame, rawObj };
}

function makeUserTurn(content: string, ts: string = "2026-08-20T12:02:00.000Z"): {
  parsedFrame: ReturnType<typeof parseSessionLine>;
  rawObj: Record<string, unknown>;
} {
  const rawObj = {
    type: "user" as const,
    uuid: "u-" + content.slice(0, 6),
    timestamp: ts,
    message: {
      content,
    },
  };
  const parsedFrame = parseSessionLine(JSON.stringify(rawObj), "sess-A");
  return { parsedFrame, rawObj };
}

describe("__applyQueueDedupForTests — per-session queue-enqueue dedup", () => {
  it("Test 1: dedup fires across a 2-minute span (enqueue → dequeue empirical case)", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 1_000_000_000_000;
    const enq = makeEnqueue("hello", "2026-08-20T12:00:00.000Z");
    const r1 = __applyQueueDedupForTests({
      parsedFrame: enq.parsedFrame,
      rawObj: enq.rawObj,
      dedupMap,
      now: t0,
    });
    expect(r1.suppress).toBe(false);
    expect(r1.dedupMap.size).toBe(1);

    // Dequeue arrives 2 minutes later as a normal user turn
    const usr = makeUserTurn("hello", "2026-08-20T12:02:00.000Z");
    const r2 = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap,
      now: t0 + 120_000,
    });
    expect(r2.suppress).toBe(true);
    // Single-shot dedup — entry consumed on match
    expect(r2.dedupMap.size).toBe(0);
  });

  it("Test 2: different content → no dedup, both emit", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 2_000_000_000_000;
    const enq = makeEnqueue("hello", "2026-08-20T12:00:00.000Z");
    const r1 = __applyQueueDedupForTests({
      parsedFrame: enq.parsedFrame,
      rawObj: enq.rawObj,
      dedupMap,
      now: t0,
    });
    expect(r1.suppress).toBe(false);

    const usr = makeUserTurn("goodbye", "2026-08-20T12:01:00.000Z");
    const r2 = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap,
      now: t0 + 60_000,
    });
    expect(r2.suppress).toBe(false);
    // "hello" entry stays in the Map (never matched)
    expect(r2.dedupMap.size).toBe(1);
  });

  it("Test 3: different session (separate Maps) → dedup does NOT cross-contaminate", () => {
    // Map A gets the enqueue; Map B gets the user turn with matching content.
    // Since the dedup Map lives on the per-connection tail-watcher closure,
    // two connections effectively have two separate Maps and cannot suppress
    // each other's frames.
    const dedupMapA = new Map<string, number>();
    const dedupMapB = new Map<string, number>();
    const t0 = 3_000_000_000_000;

    const enq = makeEnqueue("hello", "2026-08-20T12:00:00.000Z");
    const rA = __applyQueueDedupForTests({
      parsedFrame: enq.parsedFrame,
      rawObj: enq.rawObj,
      dedupMap: dedupMapA,
      now: t0,
    });
    expect(rA.suppress).toBe(false);
    expect(dedupMapA.size).toBe(1);

    // Same content in a different session's Map → no suppression.
    const usr = makeUserTurn("hello", "2026-08-20T12:00:01.000Z");
    const rB = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap: dedupMapB,
      now: t0 + 1_000,
    });
    expect(rB.suppress).toBe(false);
    expect(dedupMapB.size).toBe(0); // user turns don't populate; only enqueues do
  });

  it("Test 4: dedup expiry — entry older than 10-minute TTL is pruned", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 4_000_000_000_000;
    const enq = makeEnqueue("hello", "2026-08-20T12:00:00.000Z");
    const r1 = __applyQueueDedupForTests({
      parsedFrame: enq.parsedFrame,
      rawObj: enq.rawObj,
      dedupMap,
      now: t0,
    });
    expect(r1.suppress).toBe(false);

    // User turn 11 minutes later — outside 10-min TTL
    const usr = makeUserTurn("hello", "2026-08-20T12:11:00.000Z");
    const r2 = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap,
      now: t0 + 11 * 60_000,
    });
    expect(r2.suppress).toBe(false);
    // Expired entry was cleared on lookup
    expect(r2.dedupMap.size).toBe(0);
  });

  it("Test 5: dedup cap — 101st insert evicts oldest; entry #1 no longer suppresses", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 5_000_000_000_000;
    // Insert 100 unique enqueues within the TTL window (well under 10 min).
    for (let i = 0; i < 100; i++) {
      const enq = makeEnqueue(`msg-${i}`, "2026-08-20T12:00:00.000Z");
      __applyQueueDedupForTests({
        parsedFrame: enq.parsedFrame,
        rawObj: enq.rawObj,
        dedupMap,
        // Space each insert 1ms apart so the wall-clock ordering is monotonic
        // (matches Map insertion order — Map preserves insertion order in JS).
        now: t0 + i,
      });
    }
    expect(dedupMap.size).toBe(100);

    // Insert the 101st — should evict the oldest (msg-0).
    const enq101 = makeEnqueue("msg-100", "2026-08-20T12:00:00.000Z");
    __applyQueueDedupForTests({
      parsedFrame: enq101.parsedFrame,
      rawObj: enq101.rawObj,
      dedupMap,
      now: t0 + 100,
    });
    expect(dedupMap.size).toBe(100);

    // Now a user turn matching msg-0 should NOT suppress (evicted).
    const usr = makeUserTurn("msg-0", "2026-08-20T12:00:01.000Z");
    const rEvicted = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap,
      now: t0 + 101,
    });
    expect(rEvicted.suppress).toBe(false);

    // Sanity: a user turn matching msg-50 (still present) SHOULD suppress.
    const usr50 = makeUserTurn("msg-50", "2026-08-20T12:00:01.000Z");
    const rHit = __applyQueueDedupForTests({
      parsedFrame: usr50.parsedFrame,
      rawObj: usr50.rawObj,
      dedupMap,
      now: t0 + 102,
    });
    expect(rHit.suppress).toBe(true);
  });

  it("Test 6: task-notification enqueue does NOT populate dedup Map", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 6_000_000_000_000;

    // The parser will skip this (Task 1 guard) — parsedFrame.kind === "skip".
    // But the seam is defensive: even if a task-notification frame reached it,
    // it should not populate the dedup Map (only kind:message enqueues do).
    const rawObj = {
      type: "queue-operation",
      operation: "enqueue",
      content: "<task-notification>\n<task-id>t</task-id>\n</task-notification>",
      timestamp: "2026-08-20T12:00:00.000Z",
    };
    const parsedFrame = parseSessionLine(JSON.stringify(rawObj), "sess-A");
    expect(parsedFrame.kind).toBe("skip");
    const r1 = __applyQueueDedupForTests({
      parsedFrame,
      rawObj,
      dedupMap,
      now: t0,
    });
    // No emission to suppress and no entry added.
    expect(r1.suppress).toBe(false);
    expect(r1.dedupMap.size).toBe(0);

    // A later user turn carrying that same task-notification body would
    // fall through to the existing patch #97 wrapper-strip skip path in
    // the parser (kind:skip), so it never reaches this seam. Sanity-check:
    // even if it did reach here, the Map is empty so no suppression.
    const usrRaw = {
      type: "user",
      uuid: "u-tn",
      timestamp: "2026-08-20T12:01:00.000Z",
      message: {
        content: "<task-notification>\n<task-id>t</task-id>\n</task-notification>",
      },
    };
    const usrParsed = parseSessionLine(JSON.stringify(usrRaw), "sess-A");
    // Wrapper-only user turns skip via the existing patch #97 path.
    expect(usrParsed.kind).toBe("skip");
    const r2 = __applyQueueDedupForTests({
      parsedFrame: usrParsed,
      rawObj: usrRaw,
      dedupMap,
      now: t0 + 60_000,
    });
    expect(r2.suppress).toBe(false);
  });

  it("Test 7 (TTL expiry pruned lazily on next insert): an expired entry is cleaned on subsequent enqueue insert", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 7_000_000_000_000;

    // Insert enqueue #1 at t0
    const enq1 = makeEnqueue("old", "2026-08-20T12:00:00.000Z");
    __applyQueueDedupForTests({
      parsedFrame: enq1.parsedFrame,
      rawObj: enq1.rawObj,
      dedupMap,
      now: t0,
    });
    expect(dedupMap.size).toBe(1);

    // Insert enqueue #2 at t0 + 11 minutes → the old entry is stale and
    // should be pruned lazily during the insert.
    const enq2 = makeEnqueue("fresh", "2026-08-20T12:11:00.000Z");
    __applyQueueDedupForTests({
      parsedFrame: enq2.parsedFrame,
      rawObj: enq2.rawObj,
      dedupMap,
      now: t0 + TEN_MIN_MS + 1,
    });
    // Only the fresh entry remains
    expect(dedupMap.size).toBe(1);
    // ...and it's the "fresh" one (matches by content-hash lookup).
    const usr = makeUserTurn("fresh", "2026-08-20T12:11:30.000Z");
    const rHit = __applyQueueDedupForTests({
      parsedFrame: usr.parsedFrame,
      rawObj: usr.rawObj,
      dedupMap,
      now: t0 + TEN_MIN_MS + 30_000,
    });
    expect(rHit.suppress).toBe(true);
  });

  it("Test 8: non-user-message frames pass through (assistant turns unaffected)", () => {
    const dedupMap = new Map<string, number>();
    const t0 = 8_000_000_000_000;
    const rawObj = {
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-08-20T12:00:00.000Z",
      message: { content: [{ type: "text", text: "hi there" }] },
    };
    const parsedFrame = parseSessionLine(JSON.stringify(rawObj), "sess-A");
    expect(parsedFrame.kind).toBe("message");
    if (parsedFrame.kind !== "message") throw new Error("unreachable");
    expect(parsedFrame.role).toBe("assistant");
    const r = __applyQueueDedupForTests({
      parsedFrame,
      rawObj,
      dedupMap,
      now: t0,
    });
    expect(r.suppress).toBe(false);
    expect(r.dedupMap.size).toBe(0);
  });
});
