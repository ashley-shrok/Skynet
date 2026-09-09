// ─── role-name-keyed READ WS handlers (Phase 90 Plan 90-07 Task 3) ─
//
// Byte-shape mirror of claude-session-server.role-update-file.test.ts (Plan
// 90-03), but covering the three READ variants added in Plan 90-07:
//   - role:get-file       → readRoleFileByName
//   - role:list-bounties  → readRoleBountiesByName
//   - role:list-wakeups   → readRoleWakeupsByName
//
// Test strategy:
//   - vi.mock the reader helpers so we control responses / surface throws.
//   - vi.mock connectOneShot + resolveHostById so we steer LOCAL vs REMOTE
//     routing without a real ssh2 pair.
//   - Drive each handler via its exported __handleRole*ForTests seam.
//   - Assert on the outbound wire messages captured by the wsStub.send spy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));
vi.mock("../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));
vi.mock("./identity-artifact-reader.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./identity-artifact-reader.js")
  >();
  return {
    ...actual,
    readRoleFileByName: vi.fn(),
    readRoleBountiesByName: vi.fn(),
    readRoleWakeupsByName: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  readRoleFileByName,
  readRoleBountiesByName,
  readRoleWakeupsByName,
} from "./identity-artifact-reader.js";
import {
  __handleRoleGetFileForTests,
  __handleRoleListBountiesForTests,
  __handleRoleListWakeupsForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub
// ──────────────────────────────────────────────────────────────────────

type AnyRoleReadResponse = {
  type: string;
  markdown?: string;
  bounties?: unknown[];
  archivedBounties?: unknown[];
  wakeups?: unknown[];
  error?: string;
};

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: AnyRoleReadResponse[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as AnyRoleReadResponse);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readRoleFileByName).mockReset();
  vi.mocked(readRoleBountiesByName).mockReset();
  vi.mocked(readRoleWakeupsByName).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
// role:get-file — happy path + invalid roleName + host-not-found
// ══════════════════════════════════════════════════════════════════════

describe("role:get-file WS handler", () => {
  it("LOCAL happy path: calls readRoleFileByName(null, roleName); response carries markdown", async () => {
    vi.mocked(readRoleFileByName).mockResolvedValue({
      markdown: "---\ntitle: Skynet\n---\n\nrole body",
    });

    await __handleRoleGetFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:get-file", roleName: "box-maintainer" },
      "1",
    );

    expect(readRoleFileByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleFileByName).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(readRoleFileByName).mock.calls[0][1]).toBe("box-maintainer");

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("role:file-loaded");
    expect(sent[0].markdown).toBe("---\ntitle: Skynet\n---\n\nrole body");
    expect(sent[0].error).toBeUndefined();

    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("REMOTE happy path: resolves host, opens conn, calls reader with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostX");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4", username: "ubuntu" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readRoleFileByName).mockResolvedValue({ markdown: "remote body\n" });

    await __handleRoleGetFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:get-file", roleName: "box-maintainer", hostId: 3 },
      "1",
    );

    expect(resolveHostById).toHaveBeenCalledTimes(1);
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleFileByName).mock.calls[0][0]).toBe(fakeConn);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({ type: "role:file-loaded", markdown: "remote body\n" });
  });

  it("invalid roleName → {error:'invalid roleName'}, no SSH open, no reader call", async () => {
    await __handleRoleGetFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:get-file", roleName: "../evil" },
      "1",
    );

    expect(readRoleFileByName).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:file-loaded",
      markdown: "",
      error: "invalid roleName",
    });
  });

  it("host not found → {error:'host not found'}, no reader call", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleGetFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:get-file", roleName: "box-maintainer", hostId: 999 },
      "1",
    );

    expect(readRoleFileByName).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:file-loaded",
      markdown: "",
      error: "host not found",
    });
  });

  it("reader throws → error propagates on envelope", async () => {
    vi.mocked(readRoleFileByName).mockRejectedValue(new Error("SSH broke"));

    await __handleRoleGetFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:get-file", roleName: "box-maintainer" },
      "1",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("role:file-loaded");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toBe("SSH broke");
  });
});

// ══════════════════════════════════════════════════════════════════════
// role:list-bounties — happy paths + validation
// ══════════════════════════════════════════════════════════════════════

describe("role:list-bounties WS handler", () => {
  it("LOCAL happy path (includeArchived omitted): calls reader with false, returns open list + empty archive", async () => {
    vi.mocked(readRoleBountiesByName).mockResolvedValue({
      bounties: [{ id: "b1", title: "bounty one" }],
      archivedBounties: [],
    });

    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "box-maintainer" },
      "1",
    );

    expect(readRoleBountiesByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleBountiesByName).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(readRoleBountiesByName).mock.calls[0][1]).toBe("box-maintainer");
    expect(vi.mocked(readRoleBountiesByName).mock.calls[0][2]).toBe(false);

    expect(sent[0].type).toBe("role:bounties-loaded");
    expect(sent[0].bounties).toHaveLength(1);
    expect(sent[0].archivedBounties).toHaveLength(0);
    expect(sent[0].error).toBeUndefined();
  });

  it("LOCAL happy path (includeArchived: true): forwards flag; returns both lists", async () => {
    vi.mocked(readRoleBountiesByName).mockResolvedValue({
      bounties: [{ id: "b1" }],
      archivedBounties: [{ id: "b0-archived" }],
    });

    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "box-maintainer", includeArchived: true },
      "1",
    );

    expect(vi.mocked(readRoleBountiesByName).mock.calls[0][2]).toBe(true);
    expect(sent[0].bounties).toHaveLength(1);
    expect(sent[0].archivedBounties).toHaveLength(1);
  });

  it("REMOTE happy path: resolves host, opens conn, calls reader with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostY");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readRoleBountiesByName).mockResolvedValue({ bounties: [], archivedBounties: [] });

    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "box-maintainer", hostId: 3 },
      "1",
    );

    expect(vi.mocked(readRoleBountiesByName).mock.calls[0][0]).toBe(fakeConn);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
    expect(sent[0].type).toBe("role:bounties-loaded");
  });

  it("invalid roleName → error envelope with empty lists, no reader call", async () => {
    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "BAD_NAME" },
      "1",
    );

    expect(readRoleBountiesByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:bounties-loaded",
      bounties: [],
      archivedBounties: [],
      error: "invalid roleName",
    });
  });

  it("host not found → error envelope with empty lists", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "box-maintainer", hostId: 999 },
      "1",
    );

    expect(readRoleBountiesByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:bounties-loaded",
      bounties: [],
      archivedBounties: [],
      error: "host not found",
    });
  });

  it("reader throws (e.g. SSH fail) → error propagates on envelope", async () => {
    vi.mocked(readRoleBountiesByName).mockRejectedValue(new Error("bounty read failed"));

    await __handleRoleListBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-bounties", roleName: "box-maintainer" },
      "1",
    );

    expect(sent[0].type).toBe("role:bounties-loaded");
    expect(sent[0].bounties).toEqual([]);
    expect(sent[0].error).toBe("bounty read failed");
  });
});

// ══════════════════════════════════════════════════════════════════════
// role:list-wakeups — happy paths + validation
// ══════════════════════════════════════════════════════════════════════

describe("role:list-wakeups WS handler", () => {
  it("LOCAL happy path: calls readRoleWakeupsByName(null, roleName); response carries wakeups list", async () => {
    vi.mocked(readRoleWakeupsByName).mockResolvedValue({
      wakeups: [
        {
          slug: "morning-check",
          name: "Morning Check",
          enabled: true,
          scheduleHuman: "every day at 09:00",
          schedule: { type: "cron", value: "0 9 * * *" },
          instruction: "Check morning email",
        },
      ],
    });

    await __handleRoleListWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-wakeups", roleName: "box-maintainer" },
      "1",
    );

    expect(readRoleWakeupsByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleWakeupsByName).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(readRoleWakeupsByName).mock.calls[0][1]).toBe("box-maintainer");

    expect(sent[0].type).toBe("role:wakeups-loaded");
    expect(sent[0].wakeups).toHaveLength(1);
    expect(sent[0].error).toBeUndefined();
  });

  it("REMOTE happy path: resolves host, opens conn, calls reader with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostZ");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readRoleWakeupsByName).mockResolvedValue({ wakeups: [] });

    await __handleRoleListWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-wakeups", roleName: "box-maintainer", hostId: 5 },
      "1",
    );

    expect(vi.mocked(readRoleWakeupsByName).mock.calls[0][0]).toBe(fakeConn);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
    expect(sent[0].type).toBe("role:wakeups-loaded");
  });

  it("invalid roleName → error envelope with empty list", async () => {
    await __handleRoleListWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-wakeups", roleName: "../oops" },
      "1",
    );

    expect(readRoleWakeupsByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeups-loaded",
      wakeups: [],
      error: "invalid roleName",
    });
  });

  it("host not found → error envelope with empty list", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleListWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-wakeups", roleName: "box-maintainer", hostId: 999 },
      "1",
    );

    expect(readRoleWakeupsByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeups-loaded",
      wakeups: [],
      error: "host not found",
    });
  });

  it("reader throws → error propagates on envelope", async () => {
    vi.mocked(readRoleWakeupsByName).mockRejectedValue(new Error("wakeup read failed"));

    await __handleRoleListWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:list-wakeups", roleName: "box-maintainer" },
      "1",
    );

    expect(sent[0].type).toBe("role:wakeups-loaded");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBe("wakeup read failed");
  });
});
