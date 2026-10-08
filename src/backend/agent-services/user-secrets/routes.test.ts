import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../utils/logger.js", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { authLogger: stub, systemLogger: stub, databaseLogger: stub, sshLogger: stub };
});
// The production deps reach for the DB and the service registry; these tests
// inject their own, so stub the heavy imports out.
vi.mock("../../database/db/index.js", () => ({ db: {}, getDb: () => ({}) }));
vi.mock("../registry.js", () => ({ AGENT_SERVICES: [] }));

import { registerServiceSecretRoutes, type ServiceSecretRouteDeps } from "./routes.js";
import type { DeclaredUserSecret } from "./declared.js";

const DECLARED: DeclaredUserSecret[] = [
  {
    service: "zoho",
    serviceDescription: "Zoho CRM",
    name: "ZOHO_TOKEN",
    label: "Zoho API token",
    managedBy: "admin",
    hasFallback: false,
  },
  {
    service: "notes",
    serviceDescription: "Notes",
    name: "NOTES_KEY",
    label: "Notes key",
    managedBy: "user",
    hasFallback: false,
  },
];

let store: Map<string, { value: string; updatedAt: string; updatedBy: string }>;
let server: http.Server;
let base: string;

const users: Record<string, { id: string; isAdmin: boolean }> = {
  alice: { id: "alice", isAdmin: false },
  admin: { id: "admin", isAdmin: true },
};

beforeEach(async () => {
  store = new Map();
  const deps: ServiceSecretRouteDeps = {
    declared: () => DECLARED,
    getUser: async (id) => users[id] ?? null,
    listStatus: async (userId) =>
      [...store.entries()]
        .filter(([k]) => k.startsWith(`${userId}/`))
        .map(([k, v]) => {
          const [, service, name] = k.split("/");
          return { service, name, updatedAt: v.updatedAt };
        }),
    set: async (userId, service, name, value, updatedBy) => {
      store.set(`${userId}/${service}/${name}`, { value, updatedAt: "2026-10-08T00:00:00Z", updatedBy });
    },
    clear: async (userId, service, name) => store.delete(`${userId}/${service}/${name}`),
  };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const auth: express.RequestHandler = (req, res, next) => {
    const id = req.header("x-test-user");
    if (!id) return res.status(401).end();
    (req as unknown as { userId: string }).userId = id;
    next();
  };
  registerServiceSecretRoutes(router, auth, deps);
  app.use("/users", router);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users`;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

async function call(as: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user": as, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

describe("user-facing /me routes", () => {
  it("list only user-managed secrets, with status and no value", async () => {
    store.set("alice/notes/NOTES_KEY", { value: "hunter2", updatedAt: "t", updatedBy: "alice" });
    const r = await call("alice", "GET", "/me/service-secrets");
    expect(r.status).toBe(200);
    expect(r.body.secrets).toEqual([{ ...DECLARED[1], isSet: true, updatedAt: "t" }]);
    expect(r.text).not.toContain("hunter2");
    expect(r.text).not.toContain("zoho");
  });

  it("set and clear a user-managed secret, trimming whitespace", async () => {
    expect((await call("alice", "PUT", "/me/service-secrets/notes/NOTES_KEY", { value: "  k \n" })).body).toEqual({
      ok: true,
    });
    expect(store.get("alice/notes/NOTES_KEY")).toMatchObject({ value: "k", updatedBy: "alice" });
    const d = await call("alice", "DELETE", "/me/service-secrets/notes/NOTES_KEY");
    expect(d.body).toEqual({ ok: true, removed: true });
    expect(store.size).toBe(0);
  });

  it("treat an admin-managed secret as if it did not exist", async () => {
    store.set("alice/zoho/ZOHO_TOKEN", { value: "company", updatedAt: "t", updatedBy: "admin" });
    expect((await call("alice", "PUT", "/me/service-secrets/zoho/ZOHO_TOKEN", { value: "mine" })).status).toBe(404);
    expect((await call("alice", "DELETE", "/me/service-secrets/zoho/ZOHO_TOKEN")).status).toBe(404);
    expect((await call("alice", "PUT", "/me/service-secrets/nope/NOPE", { value: "x" })).status).toBe(404);
    expect(store.get("alice/zoho/ZOHO_TOKEN")?.value).toBe("company");
  });

  it("reject empty or oversized values", async () => {
    for (const value of ["", "   ", 42, "x".repeat(8193)]) {
      expect((await call("alice", "PUT", "/me/service-secrets/notes/NOTES_KEY", { value })).status).toBe(400);
    }
    expect(store.size).toBe(0);
  });
});

describe("admin /:id routes", () => {
  it("list every declared secret for the user, without values", async () => {
    store.set("alice/zoho/ZOHO_TOKEN", { value: "company", updatedAt: "t", updatedBy: "admin" });
    const r = await call("admin", "GET", "/alice/service-secrets");
    expect(r.status).toBe(200);
    expect(r.body.secrets.map((s: DeclaredUserSecret & { isSet: boolean }) => [s.name, s.isSet])).toEqual([
      ["ZOHO_TOKEN", true],
      ["NOTES_KEY", false],
    ]);
    expect(r.text).not.toContain("company");
  });

  it("set and clear admin-managed secrets, recording the admin", async () => {
    await call("admin", "PUT", "/alice/service-secrets/zoho/ZOHO_TOKEN", { value: "company" });
    expect(store.get("alice/zoho/ZOHO_TOKEN")).toMatchObject({ value: "company", updatedBy: "admin" });
    expect((await call("admin", "DELETE", "/alice/service-secrets/zoho/ZOHO_TOKEN")).body.removed).toBe(true);
  });

  it("refuse non-admins and unknown users", async () => {
    expect((await call("alice", "GET", "/admin/service-secrets")).status).toBe(403);
    expect((await call("alice", "PUT", "/alice/service-secrets/zoho/ZOHO_TOKEN", { value: "x" })).status).toBe(403);
    expect((await call("admin", "GET", "/nobody/service-secrets")).status).toBe(404);
    expect(store.size).toBe(0);
  });
});
