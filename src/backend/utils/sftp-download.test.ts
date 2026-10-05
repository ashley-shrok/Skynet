import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { sendRemoteFileUnderRoot } from "./sftp-download.js";

/**
 * Fake remote FS: path → { realpath target, bytes }. Directories have no bytes.
 * /home/u/skills/demo/ is the root; /home/u/skills/demo/escape is a symlink out.
 */
const FS: Record<string, { real: string; bytes?: Buffer }> = {
  ".": { real: "/home/u" },
  "/home/u/skills/demo": { real: "/home/u/skills/demo" },
  "/home/u/skills/demo/notes.txt": { real: "/home/u/skills/demo/notes.txt", bytes: Buffer.from("hello") },
  "/home/u/skills/demo/pic.png": { real: "/home/u/skills/demo/pic.png", bytes: Buffer.from("PNGDATA") },
  "/home/u/skills/demo/page.html": { real: "/home/u/skills/demo/page.html", bytes: Buffer.from("<b>x</b>") },
  "/home/u/skills/demo/escape": { real: "/etc/passwd", bytes: Buffer.from("root:x") },
  "/etc/passwd": { real: "/etc/passwd", bytes: Buffer.from("root:x") },
};

const sftp = {
  realpath: (p: string, cb: (e: Error | null, r: string) => void) =>
    queueMicrotask(() => (FS[p] ? cb(null, FS[p].real) : cb(new Error("ENOENT"), ""))),
  stat: (p: string, cb: (e: Error | null, s?: { size: number; isFile: () => boolean }) => void) =>
    queueMicrotask(() => {
      const f = Object.values(FS).find((x) => x.real === p && x.bytes) ?? FS[p];
      if (!f) return cb(new Error("ENOENT"));
      cb(null, { size: f.bytes?.length ?? 0, isFile: () => !!f.bytes });
    }),
  createReadStream: (p: string, o?: { start?: number; end?: number }) => {
    const f = Object.values(FS).find((x) => x.real === p && x.bytes)!;
    return Readable.from([f.bytes!.subarray(o?.start ?? 0, (o?.end ?? f.bytes!.length - 1) + 1)]);
  },
};
const conn = { end: vi.fn(), sftp: (cb: (e: Error | null, s: typeof sftp) => void) => cb(null, sftp) };

let server: http.Server;

beforeEach(() => {
  (connectOneShot as Mock).mockResolvedValue(conn);
  const app = express();
  app.get("/dl", (req, res) => {
    const rel = String(req.query.path);
    void sendRemoteFileUnderRoot({
      req,
      res,
      host: {} as never,
      buildPaths: (home) =>
        rel.includes("..") ? null : { root: `${home}/skills/demo`, absPath: `${home}/skills/demo/${rel}` },
      inline: req.query.inline === "1",
    });
  });
  server = http.createServer(app).listen(0);
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    http
      .get({ host: "127.0.0.1", port, path, headers }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

describe("sendRemoteFileUnderRoot", () => {
  it("streams a file as an attachment by default", async () => {
    const r = await get("/dl?path=notes.txt");
    expect(r.status).toBe(200);
    expect(r.body).toBe("hello");
    expect(r.headers["content-disposition"]).toContain('attachment; filename="notes.txt"');
    expect(conn.end).toHaveBeenCalled();
  });

  it("inline=1 serves images inline with their content-type", async () => {
    const r = await get("/dl?path=pic.png&inline=1");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["content-disposition"]).toBeUndefined();
  });

  it("inline=1 still forces html to download", async () => {
    const r = await get("/dl?path=page.html&inline=1");
    expect(r.headers["content-disposition"]).toContain("attachment");
  });

  it("honours Range", async () => {
    const r = await get("/dl?path=pic.png&inline=1", { Range: "bytes=0-2" });
    expect(r.status).toBe(206);
    expect(r.headers["content-range"]).toBe("bytes 0-2/7");
    expect(r.body).toBe("PNG");
  });

  it("refuses a symlink that resolves outside the root", async () => {
    const r = await get("/dl?path=escape");
    expect(r.status).toBe(400);
    expect(r.body).toContain("path escapes root");
  });

  it("404s a missing file and 400s a rejected path", async () => {
    expect((await get("/dl?path=nope.txt")).status).toBe(404);
    expect((await get("/dl?path=../x")).status).toBe(400);
  });

  it("502s when SSH can't connect", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    expect((await get("/dl?path=notes.txt")).status).toBe(502);
  });
});
