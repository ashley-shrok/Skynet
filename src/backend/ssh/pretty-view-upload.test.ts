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
  handleUploadStart,
  handleUploadChunk,
  handleUploadAbort,
  cleanupBatchesForConnection,
  __getActiveBatchesForTest,
  __resetActiveBatchesForTest,
  __setClockForTest,
} from "./pretty-view-upload.js";
import {
  MAX_PER_BATCH_BYTES,
  MAX_PER_FILE_BYTES,
  type UploadFailedEvent,
  type UploadStartPayload,
} from "../../ui/api/pretty-view-upload-protocol.js";

/* --------------------------------------------------------------------- */
/*  Mock SFTP + WebSocket + SSH connection                               */
/* --------------------------------------------------------------------- */

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
  __writeStreams: MockWriteStream[];
  __existingPaths: Set<string>;
}

function makeMockSftp(existingPaths: string[] = []): MockSftp {
  const existing = new Set(existingPaths);
  const streams: MockWriteStream[] = [];
  const sftp: MockSftp = {
    __writeStreams: streams,
    __existingPaths: existing,
    realpath: vi.fn((p: string, cb: (err: Error | null, r: string) => void) => {
      queueMicrotask(() => cb(null, "/home/ash"));
    }),
    stat: vi.fn(
      (
        p: string,
        cb: (
          err: (Error & { code?: number }) | null,
          stats?: { isDirectory: () => boolean; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => {
          if (existing.has(p)) {
            cb(null, {
              isDirectory: () => p.endsWith("/pretty-view-uploads") || /\d{4}-\d{2}-\d{2}$/.test(p),
              isFile: () => !p.endsWith("/pretty-view-uploads") && !/\d{4}-\d{2}-\d{2}$/.test(p),
            });
          } else {
            const err = new Error("No such file") as Error & { code: number };
            err.code = 2;
            cb(err);
          }
        });
      },
    ),
    mkdir: vi.fn((p: string, cb: (err: Error | null) => void) => {
      existing.add(p);
      queueMicrotask(() => cb(null));
    }),
    createWriteStream: vi.fn((_p: string, _opts: unknown) => {
      const s = makeMockWriteStream();
      streams.push(s);
      return s;
    }),
    rename: vi.fn(
      (from: string, to: string, cb: (err: Error | null) => void) => {
        existing.add(to);
        existing.delete(from);
        queueMicrotask(() => cb(null));
      },
    ),
    unlink: vi.fn((p: string, cb: (err: Error | null) => void) => {
      existing.delete(p);
      queueMicrotask(() => cb(null));
    }),
    end: vi.fn(),
  };
  return sftp;
}

interface MockWs {
  send: Mock;
  readyState: number;
  pause: Mock;
  resume: Mock;
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
    pause: vi.fn(),
    resume: vi.fn(),
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

function makeDeps(sftp: MockSftp, ws: MockWs) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sshConn: makeMockSshConn(sftp) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: ws as any,
    userId: "user-42",
    currentSessionId: "sess-1",
  };
}

/* --------------------------------------------------------------------- */
/*  Helpers                                                              */
/* --------------------------------------------------------------------- */

/** Advance macrotasks until the mock ws has received an event matching pred. */
async function waitFor(ws: MockWs, pred: (e: unknown) => boolean, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (ws.__sentEvents.some(pred)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `waitFor timeout — events so far: ${JSON.stringify(ws.__sentEvents)}`,
  );
}

async function waitForNoBatch(mqid: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (!__getActiveBatchesForTest().has(mqid)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitForNoBatch timeout — ${mqid} still active`);
}

function startPayload(files: UploadStartPayload["files"]): UploadStartPayload {
  return {
    type: "upload_start",
    messageQueueItemId: "mqid-test",
    files,
  };
}

/* --------------------------------------------------------------------- */
/*  Tests                                                                */
/* --------------------------------------------------------------------- */

beforeEach(() => {
  __resetActiveBatchesForTest();
  // Fixed clock: 2026-07-20T14:32:11 local.
  __setClockForTest(() => new Date(2026, 6, 20, 14, 32, 11)); // month 6 = July
});

afterEach(() => {
  __setClockForTest(null);
});

describe("Test 1: upload_start rejects invalid filename", () => {
  it("emits upload_failed and never opens a write stream", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    await handleUploadStart(
      makeDeps(sftp, ws),
      startPayload([
        { tempId: "t1", filename: "../etc/passwd", size: 10, mimetype: "text/plain" },
      ]),
    );
    await waitFor(ws, (e) => (e as { type?: string }).type === "upload_failed");
    const failed = ws.__sentEvents.find(
      (e) => (e as UploadFailedEvent).type === "upload_failed",
    ) as UploadFailedEvent;
    expect(failed.reason).toBe("invalid_filename");
    expect(failed.tempId).toBe("t1");
    expect(sftp.createWriteStream).not.toHaveBeenCalled();
  });
});

describe("Test 2: upload_start rejects oversize file", () => {
  it("emits upload_failed reason per_file_size_overflow", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    await handleUploadStart(
      makeDeps(sftp, ws),
      startPayload([
        {
          tempId: "t1",
          filename: "big.bin",
          size: MAX_PER_FILE_BYTES + 1,
          mimetype: "application/octet-stream",
        },
      ]),
    );
    await waitFor(ws, (e) => (e as { type?: string }).type === "upload_failed");
    const failed = ws.__sentEvents.find(
      (e) => (e as UploadFailedEvent).type === "upload_failed",
    ) as UploadFailedEvent;
    expect(failed.reason).toBe("per_file_size_overflow");
    expect(sftp.createWriteStream).not.toHaveBeenCalled();
  });
});

describe("Test 3: upload_start rejects oversize batch", () => {
  it("emits upload_failed reason batch_size_overflow", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    // Two files each half MAX_PER_FILE_BYTES; total exceeds MAX_PER_BATCH_BYTES/2.
    // Craft so sum > MAX_PER_BATCH_BYTES (2 GB) using 5 files of ~450MB each.
    const per = 450 * 1024 * 1024;
    const files = Array.from({ length: 5 }, (_, i) => ({
      tempId: `t${i}`,
      filename: `f${i}.bin`,
      size: per,
      mimetype: "application/octet-stream",
    }));
    expect(files.reduce((s, f) => s + f.size, 0)).toBeGreaterThan(MAX_PER_BATCH_BYTES);
    await handleUploadStart(makeDeps(sftp, ws), startPayload(files));
    await waitFor(ws, (e) => (e as { type?: string }).type === "upload_failed");
    const failed = ws.__sentEvents.find(
      (e) => (e as UploadFailedEvent).type === "upload_failed",
    ) as UploadFailedEvent;
    expect(failed.reason).toBe("batch_size_overflow");
    expect(sftp.createWriteStream).not.toHaveBeenCalled();
  });
});

describe("Test 4 + Test 5: happy path — single file, atomic rename", () => {
  it("streams a small file → progress → complete → ready_to_inject", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    const bodyBytes = Buffer.from("hello world", "utf8");
    await handleUploadStart(
      deps,
      startPayload([
        {
          tempId: "t1",
          filename: "log.txt",
          size: bodyBytes.length,
          mimetype: "text/plain",
        },
      ]),
    );
    // wait until sftp+mkdir+createWriteStream done
    await new Promise((r) => setTimeout(r, 20));
    handleUploadChunk(deps, {
      type: "upload_chunk",
      messageQueueItemId: "mqid-test",
      tempId: "t1",
      offset: 0,
      bytes: bodyBytes.toString("base64"),
    });
    await waitFor(
      ws,
      (e) => (e as { type?: string }).type === "upload_ready_to_inject",
    );

    // progress emitted
    const progress = ws.__sentEvents.find(
      (e) => (e as { type?: string }).type === "upload_progress",
    ) as { bytesReceived: number; total: number } | undefined;
    expect(progress?.bytesReceived).toBe(bodyBytes.length);
    expect(progress?.total).toBe(bodyBytes.length);

    // complete has locked landing-path shape
    const complete = ws.__sentEvents.find(
      (e) => (e as { type?: string }).type === "upload_complete",
    ) as {
      landingPath: string;
      uploadTimestamp: string;
    } | undefined;
    expect(complete?.landingPath).toBe(
      "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
    );
    expect(complete?.uploadTimestamp).toBe("2026-07-20T14:32:11");

    // atomic rename happened: temp path was written and renamed to final
    expect(sftp.createWriteStream).toHaveBeenCalledTimes(1);
    const [tempPathArg, opts] = sftp.createWriteStream.mock.calls[0];
    // Temp path pattern: hidden + <hhmmss>-<filename>.<rand>.partial (T-05-02
    // belt-and-suspenders random suffix on top of createWriteStream({flags: 'wx'})).
    expect(tempPathArg).toMatch(
      /\/\.143211-log\.txt\.[a-z0-9]+\.partial$/,
    );
    // Symlink defense — flags: 'wx' MUST be on the createWriteStream call
    expect((opts as { flags?: string }).flags).toBe("wx");
    expect(sftp.rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename.mock.calls[0][0]).toBe(tempPathArg);
    expect(sftp.rename.mock.calls[0][1]).toBe(
      "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
    );

    // Batch cleared on ready_to_inject
    await waitForNoBatch("mqid-test");
  });
});

describe("Test 6: chunk out of order rejected + temp unlinked", () => {
  it("emits chunk_out_of_order and unlinks the temp file", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "log.txt", size: 1024 * 1024, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    // Skip offset 0 — jump straight to 65536
    handleUploadChunk(deps, {
      type: "upload_chunk",
      messageQueueItemId: "mqid-test",
      tempId: "t1",
      offset: 65536,
      bytes: Buffer.alloc(64).toString("base64"),
    });
    await waitFor(
      ws,
      (e) =>
        (e as { type?: string; reason?: string }).type === "upload_failed" &&
        (e as { reason?: string }).reason === "chunk_out_of_order",
    );
    expect(sftp.unlink).toHaveBeenCalled();
  });
});

describe("Test 7: size overflow during chunking", () => {
  it("emits size_overflow and unlinks temp when chunks exceed declared size", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    // declare 10 bytes but send 100
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "log.txt", size: 10, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    handleUploadChunk(deps, {
      type: "upload_chunk",
      messageQueueItemId: "mqid-test",
      tempId: "t1",
      offset: 0,
      bytes: Buffer.alloc(100).toString("base64"),
    });
    await waitFor(
      ws,
      (e) =>
        (e as { type?: string; reason?: string }).type === "upload_failed" &&
        (e as { reason?: string }).reason === "size_overflow",
    );
    expect(sftp.unlink).toHaveBeenCalled();
  });
});

describe("Test 8: filename collision → suffix", () => {
  it("retries with -2 if -log.txt exists on the box", async () => {
    // Prepopulate existing path so the first candidate collides.
    const sftp = makeMockSftp([
      "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
    ]);
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    const bodyBytes = Buffer.from("x", "utf8");
    await handleUploadStart(
      deps,
      startPayload([
        {
          tempId: "t1",
          filename: "log.txt",
          size: bodyBytes.length,
          mimetype: "text/plain",
        },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    handleUploadChunk(deps, {
      type: "upload_chunk",
      messageQueueItemId: "mqid-test",
      tempId: "t1",
      offset: 0,
      bytes: bodyBytes.toString("base64"),
    });
    await waitFor(
      ws,
      (e) => (e as { type?: string }).type === "upload_complete",
    );
    const complete = ws.__sentEvents.find(
      (e) => (e as { type?: string }).type === "upload_complete",
    ) as { landingPath: string };
    expect(complete.landingPath).toBe(
      "/home/ash/pretty-view-uploads/2026-07-20/143211-log-2.txt",
    );
  });
});

describe("Test 9: upload_abort — no tempId (batch-wide)", () => {
  it("tears down all in-flight streams and unlinks all temp files", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "a.txt", size: 1000, mimetype: "text/plain" },
        { tempId: "t2", filename: "b.txt", size: 1000, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));

    handleUploadAbort(deps, {
      type: "upload_abort",
      messageQueueItemId: "mqid-test",
    });
    await new Promise((r) => setTimeout(r, 30));
    const abortedTempIds = ws.__sentEvents
      .filter((e) => (e as UploadFailedEvent).type === "upload_failed")
      .map((e) => (e as UploadFailedEvent).tempId);
    expect(abortedTempIds).toContain("t1");
    expect(abortedTempIds).toContain("t2");
    expect(sftp.unlink).toHaveBeenCalledTimes(2);
    expect(__getActiveBatchesForTest().has("mqid-test")).toBe(false);
    // no ready_to_inject
    expect(
      ws.__sentEvents.some(
        (e) => (e as { type?: string }).type === "upload_ready_to_inject",
      ),
    ).toBe(false);
  });
});

describe("Test 10: upload_abort — single tempId only aborts that file", () => {
  it("leaves other files alone; ready_to_inject fires when remaining land", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    const bodyBytes = Buffer.from("x", "utf8");
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "a.txt", size: bodyBytes.length, mimetype: "text/plain" },
        { tempId: "t2", filename: "b.txt", size: bodyBytes.length, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));

    handleUploadAbort(deps, {
      type: "upload_abort",
      messageQueueItemId: "mqid-test",
      tempId: "t1",
    });
    await new Promise((r) => setTimeout(r, 15));

    // t1 was aborted; t2 uploads and lands
    handleUploadChunk(deps, {
      type: "upload_chunk",
      messageQueueItemId: "mqid-test",
      tempId: "t2",
      offset: 0,
      bytes: bodyBytes.toString("base64"),
    });
    await waitFor(
      ws,
      (e) => (e as { type?: string }).type === "upload_ready_to_inject",
    );
    const ready = ws.__sentEvents.find(
      (e) => (e as { type?: string }).type === "upload_ready_to_inject",
    ) as { files: Array<{ tempId: string }> };
    expect(ready.files).toHaveLength(1);
    expect(ready.files[0].tempId).toBe("t2");
  });
});

describe("Test 12: delimiter collision at upload_start", () => {
  it("emits reason delimiter_collision", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    await handleUploadStart(
      makeDeps(sftp, ws),
      startPayload([
        {
          tempId: "t1",
          filename: "--- attached files ---.log",
          size: 10,
          mimetype: "text/plain",
        },
      ]),
    );
    await waitFor(ws, (e) => (e as { type?: string }).type === "upload_failed");
    const failed = ws.__sentEvents.find(
      (e) => (e as UploadFailedEvent).type === "upload_failed",
    ) as UploadFailedEvent;
    expect(failed.reason).toBe("delimiter_collision");
    expect(sftp.createWriteStream).not.toHaveBeenCalled();
  });
});

describe("auth gate (T-05-07)", () => {
  it("silently no-ops if sshConn is missing (matches case input posture)", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    await handleUploadStart(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sshConn: null as any, ws: ws as any, userId: "u", currentSessionId: "s" },
      startPayload([
        { tempId: "t1", filename: "log.txt", size: 5, mimetype: "text/plain" },
      ]),
    );
    // no writes, no events
    await new Promise((r) => setTimeout(r, 20));
    expect(ws.__sentEvents).toHaveLength(0);
    expect(sftp.createWriteStream).not.toHaveBeenCalled();
  });
});

describe("cleanupBatchesForConnection", () => {
  it("unlinks all temp files for the passed batch ids", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "a.txt", size: 10, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    cleanupBatchesForConnection(["mqid-test"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(sftp.unlink).toHaveBeenCalled();
    expect(__getActiveBatchesForTest().has("mqid-test")).toBe(false);
  });
});

describe("duplicate upload_start on same messageQueueItemId", () => {
  it("emits reason batch_already_active", async () => {
    const sftp = makeMockSftp();
    const ws = makeMockWs();
    const deps = makeDeps(sftp, ws);
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t1", filename: "a.txt", size: 10, mimetype: "text/plain" },
      ]),
    );
    await new Promise((r) => setTimeout(r, 20));
    // second start on same mqid
    await handleUploadStart(
      deps,
      startPayload([
        { tempId: "t2", filename: "b.txt", size: 10, mimetype: "text/plain" },
      ]),
    );
    await waitFor(
      ws,
      (e) =>
        (e as UploadFailedEvent).type === "upload_failed" &&
        (e as UploadFailedEvent).reason === "batch_already_active",
    );
  });
});
