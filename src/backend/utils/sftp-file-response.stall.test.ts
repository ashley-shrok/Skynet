/**
 * sendSftpFile — a transfer that stops moving bytes is torn down after its
 * stall limit, so the caller's pooled SSH connection is handed back instead
 * of being held for as long as the viewer stays open.
 */
import { Readable, Writable } from "node:stream";
import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { sendSftpFile } from "./sftp-file-response.js";

function fakeRes(): Writable & { set: () => unknown; status: () => unknown } {
  // Accepts the first chunk, then never asks for more — a paused reader.
  let first = true;
  const w = new Writable({
    highWaterMark: 1,
    write(_chunk, _enc, cb) {
      if (first) {
        first = false;
        cb();
      }
    },
  }) as Writable & { set: () => unknown; status: () => unknown };
  w.set = () => w;
  w.status = () => w;
  return w;
}

function fakeSftp(size: number) {
  return {
    createReadStream: () => {
      let sent = 0;
      return new Readable({
        highWaterMark: 16,
        read() {
          if (sent >= size) return this.push(null);
          sent += 16;
          this.push(Buffer.alloc(16));
        },
      });
    },
  };
}

describe("sendSftpFile stall teardown", () => {
  it("settles and destroys the response when no bytes flow for stallMs", async () => {
    const res = fakeRes();
    const started = Date.now();
    await sendSftpFile({
      req: { headers: {} } as unknown as Request,
      res: res as unknown as Response,
      sftp: fakeSftp(1_000_000) as never,
      path: "/x/video.mp4",
      size: 1_000_000,
      filename: "video.mp4",
      disposition: "auto",
      stallMs: 200,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(res.destroyed).toBe(true);
  });

  it("a transfer that keeps flowing completes normally", async () => {
    const chunks: Buffer[] = [];
    const res = new Writable({
      write(c, _e, cb) {
        chunks.push(c);
        cb();
      },
    }) as Writable & { set: () => unknown; status: () => unknown };
    res.set = () => res;
    res.status = () => res;
    await sendSftpFile({
      req: { headers: {} } as unknown as Request,
      res: res as unknown as Response,
      sftp: fakeSftp(64) as never,
      path: "/x/a.txt",
      size: 64,
      filename: "a.txt",
      disposition: "auto",
      stallMs: 200,
    });
    expect(Buffer.concat(chunks).length).toBe(64);
    // Ended normally (not torn down mid-stream), and the stall timer was
    // cleared: nothing errors after the limit passes.
    await new Promise((r) => setTimeout(r, 300));
    expect(res.writableFinished).toBe(true);
    expect(res.errored).toBeNull();
  });
});
