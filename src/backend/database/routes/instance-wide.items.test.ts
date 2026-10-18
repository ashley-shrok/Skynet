/**
 * GET /instance-wide/items — shared skills are agent-only for non-admins, so
 * the list leaves them out for them; admins get each skill's two invocation
 * settings alongside (shape-skills-modal).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
          (req as express.Request & { userId: string }).userId = "7";
          next();
        },
    }),
  },
}));

vi.mock("../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [{ username: "pat" }] }) }) },
}));

vi.mock("../../instance-wide/admin.js", () => ({ callerIsAdmin: vi.fn() }));

const MASTER: Record<string, string> = {
  "skill/house-style/SKILL.md": "---\nname: house-style\ndescription: House style\ndisable-model-invocation: true\n---\n",
  "role/helper/helper.md": "---\ndescription: Helps\n---\n",
};
vi.mock("../../instance-wide/production.js", () => ({
  getInstanceWide: () => ({
    status: async () => [
      { kind: "skill", name: "house-style", updatedAt: 1, behind: 0, conflicts: 0, hosts: [] },
      { kind: "role", name: "helper", updatedAt: 1, behind: 0, conflicts: 0, hosts: [] },
    ],
    readMasterFile: async (kind: string, name: string, file: string) => {
      const text = MASTER[`${kind}/${name}/${file}`];
      if (text == null) throw new Error("missing");
      return Buffer.from(text);
    },
    hostCount: async () => 2,
  }),
  machineForHostRow: vi.fn(),
}));

vi.mock("../../fleet-status/identity-visibility-gate.js", () => ({
  isIdentityVisibleToUser: () => true,
}));

vi.mock("../../utils/logger.js", () => {
  const l = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), success: vi.fn() };
  return { systemLogger: l, logger: l, sshLogger: l, databaseLogger: l, authLogger: l, apiLogger: l };
});

import { callerIsAdmin } from "../../instance-wide/admin.js";
const { default: router } = await import("./instance-wide.js");

let server: http.Server;

function get(path: string): Promise<{ status: number; body: { isAdmin: boolean; items: Array<Record<string, unknown>> } }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      })
      .on("error", reject);
  });
}

beforeEach(async () => {
  const app = express();
  app.use("/instance-wide", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  vi.clearAllMocks();
});

describe("GET /instance-wide/items", () => {
  it("leaves shared skills out for a non-admin (roles still listed)", async () => {
    (callerIsAdmin as Mock).mockResolvedValue(false);
    const res = await get("/instance-wide/items");
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => `${i.kind}/${i.name}`)).toEqual(["role/helper"]);
  });

  it("lists shared skills for an admin with their invocation settings", async () => {
    (callerIsAdmin as Mock).mockResolvedValue(true);
    const res = await get("/instance-wide/items?kind=skill");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ name: "house-style", description: "House style", modelInvocable: false });
    expect(res.body.items[0]).not.toHaveProperty("userInvocable");
  });
});
