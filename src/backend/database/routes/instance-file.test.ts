/**
 * /instance-file router — admin gate, GET/PUT round-trip, validation, size cap,
 * and the resweep-on-save hook. Real store on a temp DATA_DIR; auth, the admin
 * lookup and the substrate orchestrator are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

// Auth middleware stand-in: userId comes from the x-test-user header.
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: { headers: Record<string, string>; userId?: string }, _res: unknown, next: () => void) => {
          req.userId = req.headers["x-test-user"];
          next();
        },
    }),
  },
}));

vi.mock("../../instance-wide/admin.js", () => ({
  callerIsAdmin: vi.fn(async (userId: string) => userId === "admin-1"),
}));

const resweepAll = vi.fn(async (_reason: string) => {});
vi.mock("../../distributor/substrate-orchestrator-singleton.js", () => ({
  getSubstrateOrchestrator: vi.fn(() => ({ resweepAll })),
}));

vi.mock("../../utils/logger.js", () => ({
  systemLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import router from "./instance-file.js";
import { MAX_INSTANCE_FILE_BYTES, instanceFilePath } from "../../instance-file/store.js";
import { getSubstrateOrchestrator } from "../../distributor/substrate-orchestrator-singleton.js";

let server: Server;
let base: string;
let dataDir: string;
const prevDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  const app = express();
  app.use("/instance-file", express.json({ limit: "512kb" }), router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/instance-file`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "instance-file-route-"));
  process.env.DATA_DIR = dataDir;
  resweepAll.mockClear();
  vi.mocked(getSubstrateOrchestrator).mockReturnValue({ resweepAll } as never);
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
});

function get(user: string) {
  return fetch(base, { headers: { "x-test-user": user } });
}

function put(user: string, body: unknown) {
  return fetch(base, {
    method: "PUT",
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/instance-file", () => {
  it("non-admin GET → 403", async () => {
    const res = await get("user-2");
    expect(res.status).toBe(403);
  });

  it("non-admin PUT → 403, nothing written, no resweep", async () => {
    const res = await put("user-2", { content: "sneaky" });
    expect(res.status).toBe(403);
    await expect(fs.stat(instanceFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(resweepAll).not.toHaveBeenCalled();
  });

  it("admin GET with nothing saved → empty content, null updatedAt", async () => {
    const res = await get("admin-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: "", updatedAt: null });
  });

  it("admin GET returns the saved content", async () => {
    await fs.mkdir(path.dirname(instanceFilePath()), { recursive: true });
    await fs.writeFile(instanceFilePath(), "# hello fleet\n");

    const res = await get("admin-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; updatedAt: number | null };
    expect(body.content).toBe("# hello fleet\n");
    expect(typeof body.updatedAt).toBe("number");
  });

  it("admin PUT saves the file and triggers resweepAll", async () => {
    const res = await put("admin-1", { content: "# rules\n" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; updatedAt: number | null };
    expect(body.content).toBe("# rules\n");
    expect(typeof body.updatedAt).toBe("number");
    expect(await fs.readFile(instanceFilePath(), "utf-8")).toBe("# rules\n");
    expect(resweepAll).toHaveBeenCalledTimes(1);
    expect(resweepAll).toHaveBeenCalledWith("instance-file-saved");

    // And GET sees it.
    expect(((await (await get("admin-1")).json()) as { content: string }).content).toBe("# rules\n");
  });

  it("admin PUT with blank content clears the file and still resweeps (hosts get it removed)", async () => {
    await put("admin-1", { content: "# rules\n" });
    resweepAll.mockClear();

    const res = await put("admin-1", { content: "   \n" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: "", updatedAt: null });
    await expect(fs.stat(instanceFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(resweepAll).toHaveBeenCalledTimes(1);
  });

  it("admin PUT still saves when the orchestrator isn't running", async () => {
    vi.mocked(getSubstrateOrchestrator).mockReturnValue(null);
    const res = await put("admin-1", { content: "# rules\n" });
    expect(res.status).toBe(200);
    expect(await fs.readFile(instanceFilePath(), "utf-8")).toBe("# rules\n");
  });

  it("PUT with non-string content → 400", async () => {
    for (const body of [{ content: 42 }, { content: null }, {}, { text: "x" }]) {
      const res = await put("admin-1", body);
      expect(res.status).toBe(400);
    }
    await expect(fs.stat(instanceFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(resweepAll).not.toHaveBeenCalled();
  });

  it("PUT over the 256KB cap → 413, nothing written, no resweep", async () => {
    const res = await put("admin-1", { content: "x".repeat(MAX_INSTANCE_FILE_BYTES + 1) });
    expect(res.status).toBe(413);
    await expect(fs.stat(instanceFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(resweepAll).not.toHaveBeenCalled();
  });
});
