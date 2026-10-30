/**
 * Tests for the /sharing routes: bare Express app + node:http, with the
 * machine's people, its files and the host connection mocked; the real plan
 * logic (sharing-plan.ts) runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ShareHostState } from "../../sharing/sharing-plan.js";

let mockUserId = "u-ana";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as express.Request & { userId: string }).userId = mockUserId;
        next();
      },
    }),
  },
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const m = vi.hoisted(() => ({
  people: [] as string[],
  state: null as ShareHostState | null,
  writes: [] as Array<{ kind: string; slug: string; users: string[] }>,
  hostOk: true,
  publish: vi.fn(),
  iwBroken: false,
  taskLocked: 0,
}));

vi.mock("../../sharing/host-conn.js", () => {
  class HttpError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return {
    HttpError,
    withHost: async (_h: number, _u: string, fn: (c: null) => Promise<unknown>) => {
      if (!m.hostOk) throw new HttpError(404, "Host not found");
      return fn(null);
    },
  };
});
vi.mock("../../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn(async () => ({ name: "box" })) }));
vi.mock("../../distributor/machine-people.js", () => ({
  listMachinePeople: vi.fn(async () => m.people.map((username) => ({ username, mxid: null }))),
}));
vi.mock("../../utils/host-user-counter.js", () => ({
  getUsernameForUserId: vi.fn(async (id: string) => id.replace(/^u-/, "")),
}));
vi.mock("../../instance-wide/production.js", () => ({
  getInstanceWide: () =>
    m.iwBroken
      ? { listNames: async () => { throw new Error("down"); } }
      : null,
}));
vi.mock("../../fleet-status/subscription-registry.js", () => ({
  getSubscriptionRegistry: () => ({ publishProjectListChanged: m.publish }),
}));
vi.mock("./project-list.js", () => ({ enrichForWire: (p: unknown[]) => p }));
vi.mock("./identity-birth-orchestrator.js", () => ({ ROLE_NAME_PATTERN: /^[a-z0-9-]{1,64}$/ }));
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  IDENTITY_SLUG_RE: /^[a-z0-9_-]{1,80}$/i,
  PROJECT_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  listProjects: vi.fn(async () => []),
}));
vi.mock("./scheduled-agents-write.js", () => ({
  machineLockKey: (_h: unknown, hostId: number) => `host:${hostId}`,
  withScheduledAgentLock: vi.fn(async (_h: number, _s: string, fn: () => Promise<unknown>) => {
    m.taskLocked += 1;
    return fn();
  }),
}));
vi.mock("../../sharing/sharing-host.js", () => ({
  readShareHostState: vi.fn(async (_c: unknown, _p: unknown, iw: unknown) => {
    const st = structuredClone(m.state)!;
    if (iw === "all") for (const r of st.roles) r.instanceWide = true;
    return st;
  }),
  writeShareList: vi.fn(async (_c: unknown, w: { kind: string; slug: string; users: string[] }) => {
    m.writes.push(w);
    const s = m.state!;
    const list =
      w.kind === "agent"
        ? s.agents.find((a) => a.name === w.slug)
        : w.kind === "role"
          ? s.roles.find((r) => r.name === w.slug)
          : w.kind === "app"
            ? s.apps.find((a) => a.name === w.slug)
            : w.kind === "task"
              ? s.tasks.find((t) => t.name === w.slug)
              : s.projects.find((p) => p.slug === w.slug);
    if (list) list.users = w.users;
  }),
}));

import sharingRouter from "./sharing.js";

let server: http.Server;
let base: string;

beforeEach(async () => {
  mockUserId = "u-ana";
  m.people = ["ana", "bo"];
  m.writes = [];
  m.hostOk = true;
  m.publish.mockClear();
  m.iwBroken = false;
  m.taskLocked = 0;
  m.state = {
    people: ["ana", "bo"],
    agents: [{ name: "scout", label: "Scout", roles: ["painter"], project: "garden", users: ["ana"] }],
    roles: [{ name: "painter", label: "Painter", users: ["ana"], instanceWide: false }],
    projects: [{ slug: "garden", label: "Garden", parent: null, users: ["ana"] }],
    apps: [{ name: "tracker", label: "Tracker", users: null }],
    tasks: [{ name: "morning", label: "morning", roles: ["painter"], users: ["ana"] }],
  };
  const app = express();
  app.use(express.json());
  app.use("/sharing", sharingRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const get = (q: string) => fetch(`${base}/sharing?${q}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const send = (method: "POST" | "PUT", path: string, body: unknown) =>
  fetch(`${base}/sharing${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json() }),
  );

describe("GET /sharing", () => {
  it("answers multiUser:false on a machine with one person", async () => {
    m.people = ["ana"];
    const r = await get("hostId=3&kind=agent&slug=scout");
    expect(r.body).toEqual({ multiUser: false });
  });

  it("returns the list, the machine's people and the roles hiding it", async () => {
    m.state!.agents[0].users = ["ana", "bo"];
    const r = await get("hostId=3&kind=agent&slug=scout");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      multiUser: true,
      you: "ana",
      people: ["ana", "bo"],
      users: ["ana", "bo"],
      former: [],
      hiddenBy: { bo: [{ kind: "role", name: "painter", label: "Painter", fixable: true }] },
    });
  });

  it("is 404 to someone the thing is hidden from", async () => {
    mockUserId = "u-bo";
    expect((await get("hostId=3&kind=agent&slug=scout")).status).toBe(404);
    expect((await get("hostId=3&kind=project&slug=garden")).status).toBe(404);
  });

  it("rejects a bad kind or slug", async () => {
    expect((await get("hostId=3&kind=wiki&slug=x")).status).toBe(400);
    expect((await get("hostId=3&kind=agent&slug=../etc")).status).toBe(400);
  });

  it("is 404 for a host that isn't the caller's", async () => {
    m.hostOk = false;
    expect((await get("hostId=3&kind=agent&slug=scout")).status).toBe(404);
  });
});

describe("POST /sharing/plan", () => {
  it("names the role the agent share would also need, writing nothing", async () => {
    const r = await send("POST", "/plan", { hostId: 3, kind: "agent", slug: "scout", add: ["bo"] });
    expect(r.body.rolesToShare).toEqual([{ name: "painter", label: "Painter", people: ["bo"] }]);
    expect(m.writes).toEqual([]);
  });
});

describe("POST /sharing/plan — names only what the caller can see", () => {
  it("counts agents inside a project hidden from the caller instead of naming them", async () => {
    m.people = ["ana", "bo", "cy"];
    m.state!.people = ["ana", "bo", "cy"];
    m.state!.projects[0].users = ["ana", "bo"];
    m.state!.agents.push({ name: "secret", label: "Secret", roles: [], project: "garden", users: ["bo"] });
    m.state!.agents[0].users = ["ana", "bo"];
    m.state!.roles[0].users = null;
    const r = await send("POST", "/plan", { hostId: 3, kind: "project", slug: "garden", add: ["cy"] });
    expect(r.body.alsoShared).toEqual({ projects: [], agents: ["Scout"], roles: [], hidden: 1 });
    expect(JSON.stringify(r.body)).not.toContain("Secret");
  });
});

describe("PUT /sharing", () => {
  it("shares an agent and its role together", async () => {
    const r = await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", add: ["bo"], shareRoles: true });
    expect(r.status).toBe(200);
    expect(m.writes).toEqual([
      { kind: "agent", slug: "scout", users: ["ana", "bo"] },
      { kind: "role", slug: "painter", users: ["ana", "bo"] },
    ]);
    expect(r.body.users).toEqual(["ana", "bo"]);
    expect(r.body.hiddenBy).toEqual({});
  });

  it("shares a project with everything inside and tells open sidebars", async () => {
    await send("PUT", "", { hostId: 3, kind: "project", slug: "garden", add: ["bo"] });
    expect(m.writes.map((w) => `${w.kind}:${w.slug}`).sort()).toEqual(["agent:scout", "project:garden", "role:painter"]);
    expect(m.publish).toHaveBeenCalled();
  });

  it("answers gone when the caller takes themselves off", async () => {
    m.state!.agents[0].users = ["ana", "bo"];
    m.state!.roles[0].users = null;
    const r = await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", remove: ["ana"] });
    expect(r.body).toEqual({ gone: true });
  });

  it("refuses an empty list", async () => {
    const r = await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", remove: ["ana"] });
    expect(r.status).toBe(400);
    expect(m.writes).toEqual([]);
  });

  it("refuses someone not on the machine", async () => {
    const r = await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", add: ["mallory"] });
    expect(r.status).toBe(400);
  });

  it("refuses a change on a machine with one person", async () => {
    m.people = ["ana"];
    const r = await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", add: ["ana"] });
    expect(r.status).toBe(409);
  });
});

describe("projects and roles kept on every machine", () => {
  it("names the project above that hides a sub-project from someone", async () => {
    m.state!.projects.push({ slug: "kid", label: "Kid", parent: "garden", users: null });
    const r = await get("hostId=3&kind=project&slug=kid");
    expect(r.body.ticked).toEqual(["ana"]);
    expect(r.body.hiddenBy).toEqual({ bo: [{ kind: "project", name: "garden", label: "Garden", fixable: false }] });
  });

  it("when the list of every-machine roles can't be read, roles can't be changed", async () => {
    m.iwBroken = true;
    expect((await get("hostId=3&kind=role&slug=painter")).status).toBe(503);
    await send("PUT", "", { hostId: 3, kind: "agent", slug: "scout", add: ["bo"], shareRoles: true });
    expect(m.writes.some((w) => w.kind === "role")).toBe(false);
  });
});

describe("apps and scheduled tasks", () => {
  it("shows an app with no list as everyone, and writes only the app when someone is taken off", async () => {
    const r = await get("hostId=3&kind=app&slug=tracker");
    expect(r.body).toMatchObject({ multiUser: true, users: null, ticked: ["ana", "bo"], hiddenBy: {} });
    const put = await send("PUT", "", { hostId: 3, kind: "app", slug: "tracker", remove: ["bo"] });
    expect(put.status).toBe(200);
    expect(m.writes).toEqual([{ kind: "app", slug: "tracker", users: ["ana"] }]);
  });

  it("hides an app from someone not on its list", async () => {
    m.state!.apps[0].users = ["bo"];
    expect((await get("hostId=3&kind=app&slug=tracker")).status).toBe(404);
  });

  it("says when a task's role hides its conversations, and offers to share the role too", async () => {
    m.state!.tasks[0].users = ["ana", "bo"];
    const r = await get("hostId=3&kind=task&slug=morning");
    expect(r.body.hiddenBy).toEqual({ bo: [{ kind: "role", name: "painter", label: "Painter", fixable: true }] });
    m.state!.tasks[0].users = ["ana"];
    const plan = await send("POST", "/plan", { hostId: 3, kind: "task", slug: "morning", add: ["bo"] });
    expect(plan.body.rolesToShare).toEqual([{ name: "painter", label: "Painter", people: ["bo"] }]);
  });

  it("shares a task and its role together, under the task's own lock", async () => {
    const r = await send("PUT", "", { hostId: 3, kind: "task", slug: "morning", add: ["bo"], shareRoles: true });
    expect(r.status).toBe(200);
    expect(m.writes).toEqual(
      expect.arrayContaining([
        { kind: "task", slug: "morning", users: ["ana", "bo"] },
        { kind: "role", slug: "painter", users: ["ana", "bo"] },
      ]),
    );
    expect(m.taskLocked).toBe(1);
  });

  it("lists the machine's people for a new task's list", async () => {
    const r = await fetch(`${base}/sharing/people?hostId=3`).then((x) => x.json());
    expect(r).toEqual({ multiUser: true, you: "ana", people: ["ana", "bo"] });
    m.people = ["ana"];
    expect(await fetch(`${base}/sharing/people?hostId=3`).then((x) => x.json())).toEqual({ multiUser: false });
  });
});
