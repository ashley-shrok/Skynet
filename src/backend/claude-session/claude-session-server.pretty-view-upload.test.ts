/**
 * Phase 41 Plan 04 — Integration test for the pretty-view upload dispatch
 * added to claude-session-server.ts.
 *
 * Exercises the `__dispatchUploadMessageForTests` seam which wraps the same
 * body that lives inside ws.on("message") for upload_start / upload_chunk /
 * upload_abort. This avoids spinning up a real WebSocket server while still
 * covering the full dispatch + reusable-module path.
 *
 * Reuses the mock SFTP / mock WS / mock SSH infrastructure from
 * pretty-view-upload.test.ts (types re-declared locally to avoid module
 * coupling).
 *
 * Required behaviors (per 41-04-PLAN.md Task 3 <behavior>):
 *   1. upload_start registers batch in activeBatches + ownedUploadBatches
 *   2. upload_chunk deferred behind pendingStarts (Quick-fix 260801-29v guard)
 *   3. upload_abort clears mqid from ownedUploadBatches when batch-wide
 *   4. upload_* silent no-op when sshConn is null (T-05-07 guard)
 *   5. ws.on("close") posture: cleanupBatchesForConnection drains ownedUploadBatches
 *   6. teardownPane posture: ownedUploadBatches drained on pane-switch
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { EventEmitter } from "node:events";
import {
  __getActiveBatchesForTest,
  __resetActiveBatchesForTest,
  __setClockForTest,
  cleanupBatchesForConnection,
} from "../ssh/pretty-view-upload.js";
import { __dispatchUploadMessageForTests } from "./claude-session-server.js";
import type { UploadStartPayload } from "../../ui/api/pretty-view-upload-protocol.js";

/* ------------------------------------------------------------------ */
/*  Mock SFTP + WebSocket + SSH connection                             */
/*  (minimal subset of pretty-view-upload.test.ts infrastructure)     */
/* ------------------------------------------------------------------ */

interface MockWriteStream extends EventEmitter {
  write: Mock;
  end: Mock;
  destroy: Mock;
  bytesWritten: number;
}

function makeMockWriteStream(): MockWriteStream {
  const stream = new EventEmitter() as MockWriteStream;
  stream.bytesWritten = 0;
  stream.write = vi.fn((buf: Buffer, cb?: () => void) => {
    stream.bytesWritten += buf.length;
    if (cb) queueMicrotask(cb);
    return true;
  });
  stream.end = vi.fn((cb?: () => void) => {
    queueMicrotask(() => {
      stream.emit("finish");
      if (cb) cb();
      stream.emit("close");
    });
  });
  stream.destroy = vi.fn(() => {
    queueMicrotask(() => stream.emit("close"));
  });
  return stream;
}

interface MockSftp {
  realpath: Mock;
  stat: Mock;
  mkdir: Mock;
  createWriteStream: Mock;
  rename: Mock;
  unlink: Mock;
  end: Mock;
}

function makeMockSftp(): MockSftp {
  const streams: MockWriteStream[] = [];
  const sftp: MockSftp = {
    realpath: vi.fn((p: string, cb: (err: Error | null, r: string) => void) => {
      queueMicrotask(() => cb(null, "/home/ash"));
    }),
    stat: vi.fn(
      (
        _p: string,
        cb: (err: (Error & { code?: number }) | null) => void,
      ) => {
        // Stat returns ENOENT so mkdir is called (fresh landing dir)
        queueMicrotask(() => {
          const err = new Error("No such file") as Error & { code: number };
          err.code = 2;
          cb(err);
        });
      },
    ),
    mkdir: vi.fn((_p: string, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    createWriteStream: vi.fn((_p: string, _opts: unknown) => {
      const s = makeMockWriteStream();
      streams.push(s);
      return s;
    }),
    rename: vi.fn(
      (_from: string, _to: string, cb: (err: Error | null) => void) => {
        queueMicrotask(() => cb(null));
      },
    ),
    unlink: vi.fn((_p: string, cb: (err: Error | null) => void) => {
      queueMicrotask(() => cb(null));
    }),
    end: vi.fn(),
  };
  return sftp;
}

interface MockWs {
  send: Mock;
  readyState: number;
  __sentEvents: unknown[];
}

const WS_OPEN = 1;

function makeMockWs(): MockWs {
  const ws: MockWs = {
    __sentEvents: [],
    readyState: WS_OPEN,
    send: vi.fn((raw: string) => {
      try {
        ws.__sentEvents.push(JSON.parse(raw));
      } catch {
        ws.__sentEvents.push(raw);
      }
    }),
  };
  return ws;
}

interface MockSshConn {
  sftp: Mock;
}

function makeMockSshConn(sftp: MockSftp): MockSshConn {
  return {
    sftp: vi.fn((cb: (err: Error | null, sftp: MockSftp) => void) => {
      queueMicrotask(() => cb(null, sftp));
    }),
  };
}

function makeUploadDeps(
  sftp: MockSftp,
  ws: MockWs,
  sshConnOverride?: null,
) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sshConn: sshConnOverride === null ? null : (makeMockSshConn(sftp) as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: ws as any,
    userId: "user-42",
    currentSessionId: "sess-1",
  };
}

/** Advance async microtasks / macrotasks until predicate is satisfied. */
async function waitFor(
  pred: () => boolean,
  tries = 80,
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timeout");
}

function makeStartPayload(mqid = "test-mqid"): UploadStartPayload {
  return {
    type: "upload_start",
    messageQueueItemId: mqid,
    files: [
      {
        tempId: "tmp-1",
        filename: "photo.jpg",
        size: 12,
        mimetype: "image/jpeg",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Test suite                                                         */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  __resetActiveBatchesForTest();
  // Fixed clock (mirrors pretty-view-upload.test.ts convention)
  __setClockForTest(() => new Date(2026, 6, 20, 14, 32, 11));
});

afterEach(() => {
  __setClockForTest(null);
  vi.restoreAllMocks();
});

describe("claude-session-server pretty-view upload dispatch", () => {
  it("routes upload_start to handleUploadStart with pane sshConn", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();

    const payload = makeStartPayload("mqid-start-1");

    await __dispatchUploadMessageForTests(
      payload as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    // The dispatcher adds mqid to ownedUploadBatches immediately
    expect(ownedBatches.has("mqid-start-1")).toBe(true);

    // The batch registers in activeBatches (within pretty-view-upload.ts)
    // after SFTP setup completes. Wait for the async SFTP path to settle.
    await waitFor(() => __getActiveBatchesForTest().has("mqid-start-1"));
    expect(__getActiveBatchesForTest().has("mqid-start-1")).toBe(true);
  });

  it("routes upload_chunk to handleUploadChunk, deferring behind pending upload_start (Quick-fix 260801-29v)", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();

    const mqid = "mqid-chunk-race";
    const startPayload = makeStartPayload(mqid);

    // Simulate upload_start (async, SFTP setup not yet settled)
    const startDispatch = __dispatchUploadMessageForTests(
      startPayload as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    // Immediately (same tick) send upload_chunk before start has settled
    const chunkPayload = {
      type: "upload_chunk",
      messageQueueItemId: mqid,
      tempId: "tmp-1",
      offset: 0,
      bytes: Buffer.from("hello world!").toString("base64"),
    };

    const chunkDispatch = __dispatchUploadMessageForTests(
      chunkPayload as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    // Wait for both to settle
    await Promise.all([startDispatch, chunkDispatch]);

    // The key invariant: NO "upload_failed" with reason "unknown_temp_id"
    // was emitted (the race guard deferred the chunk behind the start).
    const events = ws.__sentEvents as Array<{ type?: string; reason?: string }>;
    const failedWithUnknownId = events.filter(
      (e) => e.type === "upload_failed" && e.reason === "unknown_temp_id",
    );
    expect(failedWithUnknownId).toHaveLength(0);
  });

  it("routes upload_abort to handleUploadAbort and clears mqid from ownedUploadBatches when batch-wide", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();
    const mqid = "mqid-abort-1";

    // First register the batch via upload_start
    await __dispatchUploadMessageForTests(
      makeStartPayload(mqid) as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    // Wait for start to register in activeBatches
    await waitFor(() => __getActiveBatchesForTest().has(mqid));
    expect(ownedBatches.has(mqid)).toBe(true);

    // Batch-wide abort (no tempId — entire batch abort)
    const abortPayload = {
      type: "upload_abort",
      messageQueueItemId: mqid,
      tempId: undefined,
    };
    await __dispatchUploadMessageForTests(
      abortPayload as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    // Batch should be drained from activeBatches by handleUploadAbort
    await waitFor(() => !__getActiveBatchesForTest().has(mqid));
    expect(__getActiveBatchesForTest().has(mqid)).toBe(false);
    // And the mqid should be removed from ownedUploadBatches by the dispatcher
    expect(ownedBatches.has(mqid)).toBe(false);
  });

  it("silently no-ops when sshConn is null (T-05-07 guard, pre-connectToPane)", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();

    const payload = makeStartPayload("mqid-null-conn");

    // Pass sshConn: null to simulate pre-connectToPane state
    await __dispatchUploadMessageForTests(
      payload as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws, null), // sshConn = null
      ownedBatches,
      pendingMap,
    );

    // The T-05-07 guard inside handleUploadStart should prevent any WS events
    // from being emitted (silent no-op — no upload_failed, no upload_progress)
    // Give microtasks a moment to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(ws.send).not.toHaveBeenCalled();
    // Batch should NOT be registered in activeBatches
    expect(__getActiveBatchesForTest().has("mqid-null-conn")).toBe(false);
  });

  it("cleans up owned upload batches on ws.close (mirrors ws.on(close) posture)", async () => {
    // This test exercises the cleanupBatchesForConnection call pattern that
    // claude-session-server.ts adds to ws.on("close"). We simulate it directly
    // by calling cleanupBatchesForConnection on a populated ownedUploadBatches set,
    // which is exactly what the ws.on("close") handler does.
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();

    // Start a batch to populate activeBatches
    const mqid = "mqid-close-cleanup";
    await __dispatchUploadMessageForTests(
      makeStartPayload(mqid) as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    await waitFor(() => __getActiveBatchesForTest().has(mqid));
    expect(ownedBatches.has(mqid)).toBe(true);

    // Simulate ws.on("close") cleanup path:
    // if (ownedUploadBatches.size > 0) { cleanupBatchesForConnection(...); ownedUploadBatches.clear(); }
    if (ownedBatches.size > 0) {
      cleanupBatchesForConnection(Array.from(ownedBatches));
      ownedBatches.clear();
    }

    // After cleanup: ownedUploadBatches is empty AND activeBatches no longer has the batch
    expect(ownedBatches.size).toBe(0);
    await waitFor(() => !__getActiveBatchesForTest().has(mqid));
    expect(__getActiveBatchesForTest().has(mqid)).toBe(false);
  });

  it("cleans up owned upload batches in teardownPane (pane-switch)", async () => {
    // This test exercises the cleanupBatchesForConnection call pattern that
    // claude-session-server.ts adds to teardownPane(). We simulate it directly,
    // matching the exact guard+drain pattern in the teardownPane body.
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const ownedBatches = new Set<string>();
    const pendingMap = new Map<string, Promise<void>>();

    const mqid = "mqid-teardown-cleanup";
    await __dispatchUploadMessageForTests(
      makeStartPayload(mqid) as unknown as Record<string, unknown>,
      makeUploadDeps(sftp, ws),
      ownedBatches,
      pendingMap,
    );

    await waitFor(() => __getActiveBatchesForTest().has(mqid));
    expect(ownedBatches.has(mqid)).toBe(true);

    // Simulate teardownPane cleanup path:
    // if (ownedUploadBatches.size > 0) { cleanupBatchesForConnection(...); ownedUploadBatches.clear(); }
    if (ownedBatches.size > 0) {
      cleanupBatchesForConnection(Array.from(ownedBatches));
      ownedBatches.clear();
    }

    expect(ownedBatches.size).toBe(0);
    await waitFor(() => !__getActiveBatchesForTest().has(mqid));
    expect(__getActiveBatchesForTest().has(mqid)).toBe(false);
  });
});
