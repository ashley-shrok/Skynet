// ─── role-name-keyed wakeup CRUD WS handlers (Phase 90 Plan 90-07 Task 3) ─
//
// Covers the three wakeup-mutation variants added in Plan 90-07:
//   - role:create-wakeup  → writeRoleWakeupByName (create-or-update semantics)
//   - role:update-wakeup  → writeRoleWakeupByName (same writer, distinct wire type)
//   - role:delete-wakeup  → deleteRoleWakeupByName
//
// Both create-wakeup and update-wakeup share the same writer
// (writeRoleWakeupByName) but map to distinct response types
// (role:wakeup-created vs role:wakeup-updated) so the client can distinguish
// optimistic UI. Delete-wakeup uses a separate helper (deleteRoleWakeupByName)
// that gates wakeupName via IDENTITY_SLUG_RE.
//
// Test strategy mirrors claude-session-server.role-reads.test.ts and
// claude-session-server.role-update-file.test.ts.

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
    writeRoleWakeupByName: vi.fn(),
    deleteRoleWakeupByName: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  writeRoleWakeupByName,
  deleteRoleWakeupByName,
} from "./identity-artifact-reader.js";
import {
  __handleRoleCreateWakeupForTests,
  __handleRoleUpdateWakeupForTests,
  __handleRoleDeleteWakeupForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub
// ──────────────────────────────────────────────────────────────────────

type WakeupCrudResponse = {
  type: string;
  wakeups?: unknown[];
  error?: string;
};

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: WakeupCrudResponse[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as WakeupCrudResponse);
  }),
};

const VALID_SPEC = {
  name: "Morning Check",
  enabled: true,
  schedule: { type: "cron", value: "0 9 * * *" },
  instruction: "Check morning email",
};

const FRESH_WAKEUPS = [
  {
    slug: "morning-check",
    name: "Morning Check",
    enabled: true,
    scheduleHuman: "every day at 09:00",
    schedule: { type: "cron", value: "0 9 * * *" },
    instruction: "Check morning email",
  },
];

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(writeRoleWakeupByName).mockReset();
  vi.mocked(deleteRoleWakeupByName).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
// role:create-wakeup
// ══════════════════════════════════════════════════════════════════════

describe("role:create-wakeup WS handler", () => {
  it("LOCAL happy path: calls writeRoleWakeupByName; response carries fresh wakeups + type=role:wakeup-created", async () => {
    vi.mocked(writeRoleWakeupByName).mockResolvedValue({ wakeups: FRESH_WAKEUPS });

    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:create-wakeup", roleName: "box-maintainer", spec: VALID_SPEC },
      "1",
    );

    expect(writeRoleWakeupByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRoleWakeupByName).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(writeRoleWakeupByName).mock.calls[0][1]).toBe("box-maintainer");
    expect(vi.mocked(writeRoleWakeupByName).mock.calls[0][2]).toEqual(VALID_SPEC);

    expect(sent[0].type).toBe("role:wakeup-created");
    expect(sent[0].wakeups).toEqual(FRESH_WAKEUPS);
    expect(sent[0].error).toBeUndefined();
  });

  it("REMOTE happy path: resolves host, opens conn, calls writer with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostA");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(writeRoleWakeupByName).mockResolvedValue({ wakeups: FRESH_WAKEUPS });

    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:create-wakeup", roleName: "box-maintainer", hostId: 3, spec: VALID_SPEC },
      "1",
    );

    expect(vi.mocked(writeRoleWakeupByName).mock.calls[0][0]).toBe(fakeConn);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
    expect(sent[0].type).toBe("role:wakeup-created");
  });

  it("invalid roleName → error envelope, no writer call", async () => {
    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:create-wakeup", roleName: "../evil", spec: VALID_SPEC },
      "1",
    );

    expect(writeRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-created",
      wakeups: [],
      error: "invalid roleName",
    });
  });

  it("invalid spec (missing name) → error envelope, no writer call", async () => {
    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:create-wakeup",
        roleName: "box-maintainer",
        spec: { enabled: true, schedule: { type: "cron" }, instruction: "x" },
      },
      "1",
    );

    expect(writeRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("role:wakeup-created");
    expect(sent[0].error).toMatch(/spec\.name/);
  });

  it("host not found → error envelope", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:create-wakeup", roleName: "box-maintainer", hostId: 999, spec: VALID_SPEC },
      "1",
    );

    expect(writeRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-created",
      wakeups: [],
      error: "host not found",
    });
  });

  it("writer throws → error propagates on envelope", async () => {
    vi.mocked(writeRoleWakeupByName).mockRejectedValue(new Error("disk full"));

    await __handleRoleCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:create-wakeup", roleName: "box-maintainer", spec: VALID_SPEC },
      "1",
    );

    expect(sent[0].type).toBe("role:wakeup-created");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBe("disk full");
  });
});

// ══════════════════════════════════════════════════════════════════════
// role:update-wakeup (same writer as create; distinct response type)
// ══════════════════════════════════════════════════════════════════════

describe("role:update-wakeup WS handler", () => {
  it("LOCAL happy path: calls writeRoleWakeupByName; response type=role:wakeup-updated", async () => {
    vi.mocked(writeRoleWakeupByName).mockResolvedValue({ wakeups: FRESH_WAKEUPS });

    await __handleRoleUpdateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:update-wakeup", roleName: "box-maintainer", spec: VALID_SPEC },
      "1",
    );

    expect(writeRoleWakeupByName).toHaveBeenCalledTimes(1);
    expect(sent[0].type).toBe("role:wakeup-updated");
    expect(sent[0].wakeups).toEqual(FRESH_WAKEUPS);
  });

  it("invalid roleName → error envelope with type=role:wakeup-updated", async () => {
    await __handleRoleUpdateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:update-wakeup", roleName: "BAD_NAME", spec: VALID_SPEC },
      "1",
    );

    expect(writeRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-updated",
      wakeups: [],
      error: "invalid roleName",
    });
  });

  it("invalid spec (enabled non-boolean) → error envelope", async () => {
    await __handleRoleUpdateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-wakeup",
        roleName: "box-maintainer",
        spec: { name: "x", enabled: "yes" as unknown as boolean, schedule: { type: "cron" }, instruction: "y" },
      },
      "1",
    );

    expect(writeRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("role:wakeup-updated");
    expect(sent[0].error).toMatch(/enabled/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// role:delete-wakeup
// ══════════════════════════════════════════════════════════════════════

describe("role:delete-wakeup WS handler", () => {
  it("LOCAL happy path: calls deleteRoleWakeupByName; response type=role:wakeup-deleted with fresh list", async () => {
    vi.mocked(deleteRoleWakeupByName).mockResolvedValue({ wakeups: [] });

    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:delete-wakeup",
        roleName: "box-maintainer",
        wakeupName: "morning-check",
      },
      "1",
    );

    expect(deleteRoleWakeupByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteRoleWakeupByName).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(deleteRoleWakeupByName).mock.calls[0][1]).toBe("box-maintainer");
    expect(vi.mocked(deleteRoleWakeupByName).mock.calls[0][2]).toBe("morning-check");

    expect(sent[0].type).toBe("role:wakeup-deleted");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBeUndefined();
  });

  it("REMOTE happy path: resolves host, opens conn, calls delete with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostD");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(deleteRoleWakeupByName).mockResolvedValue({ wakeups: [] });

    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:delete-wakeup",
        roleName: "box-maintainer",
        hostId: 3,
        wakeupName: "morning-check",
      },
      "1",
    );

    expect(vi.mocked(deleteRoleWakeupByName).mock.calls[0][0]).toBe(fakeConn);
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
    expect(sent[0].type).toBe("role:wakeup-deleted");
  });

  it("invalid roleName → error envelope, no delete call", async () => {
    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:delete-wakeup", roleName: "../evil", wakeupName: "morning-check" },
      "1",
    );

    expect(deleteRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-deleted",
      wakeups: [],
      error: "invalid roleName",
    });
  });

  it("invalid wakeup slug → error envelope, no delete call", async () => {
    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:delete-wakeup", roleName: "box-maintainer", wakeupName: "../evil" },
      "1",
    );

    expect(deleteRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-deleted",
      wakeups: [],
      error: "invalid wakeup slug",
    });
  });

  it("host not found → error envelope", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:delete-wakeup", roleName: "box-maintainer", hostId: 999, wakeupName: "morning-check" },
      "1",
    );

    expect(deleteRoleWakeupByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:wakeup-deleted",
      wakeups: [],
      error: "host not found",
    });
  });

  it("delete throws (idempotent helper hard-fails) → error propagates on envelope", async () => {
    vi.mocked(deleteRoleWakeupByName).mockRejectedValue(new Error("perm denied"));

    await __handleRoleDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "role:delete-wakeup", roleName: "box-maintainer", wakeupName: "morning-check" },
      "1",
    );

    expect(sent[0].type).toBe("role:wakeup-deleted");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBe("perm denied");
  });
});
