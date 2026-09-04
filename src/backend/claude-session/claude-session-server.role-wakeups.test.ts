// ─── Phase 72 Plan 01: WS handler coverage for role-scope wakeup CRUD + ─────
// ─── identity-scope wakeup create/delete parity-gap handlers ────────────────
//
// Six new WS handlers extracted to top-level functions with __handle*ForTests
// seams (mirrors Plan 22-06's claude-session-server.role-file.test.ts
// scaffolding). One happy-path integration test per handler covers the
// LOCAL branch (no SSH open, reader/writer helpers mocked, response payload
// asserted).
//
// Test map:
//   H1. identity:list-role-wakeups   -> identity:role-wakeups         + wakeups[]
//   H2. identity:update-role-wakeup  -> identity:role-wakeup-updated  + fresh list
//   H3. identity:create-role-wakeup  -> identity:role-wakeup-created  + fresh list
//   H4. identity:delete-role-wakeup  -> identity:role-wakeup-deleted  + fresh list
//   H5. identity:create-wakeup       -> identity:wakeup-created       + fresh list
//   H6. identity:delete-wakeup       -> identity:wakeup-deleted       + fresh list

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
    readRoleWakeups: vi.fn(),
    writeRoleWakeupUpdate: vi.fn(),
    writeRoleWakeupCreate: vi.fn(),
    writeRoleWakeupDelete: vi.fn(),
    writeIdentityWakeupCreate: vi.fn(),
    writeIdentityWakeupDelete: vi.fn(),
    // Keep readIdentityWakeups mocked so identity-scope handlers can hit it too
    readIdentityWakeups: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  readRoleWakeups,
  writeRoleWakeupUpdate,
  writeRoleWakeupCreate,
  writeRoleWakeupDelete,
  writeIdentityWakeupCreate,
  writeIdentityWakeupDelete,
} from "./identity-artifact-reader.js";
import {
  __handleIdentityListRoleWakeupsForTests,
  __handleIdentityUpdateRoleWakeupForTests,
  __handleIdentityCreateRoleWakeupForTests,
  __handleIdentityDeleteRoleWakeupForTests,
  __handleIdentityCreateWakeupForTests,
  __handleIdentityDeleteWakeupForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub — mirror the role-file test scaffolding
// ──────────────────────────────────────────────────────────────────────

type AnyOutbound = {
  type: string;
  wakeups?: unknown[];
  error?: string;
};

let sent: AnyOutbound[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as AnyOutbound);
  }),
};

const fakeWakeup = {
  slug: "morning-standup",
  name: "morning-standup",
  enabled: true,
  scheduleHuman: "Daily at 09:00 (box-local)",
  schedule: { type: "daily", at: "09:00" },
  instruction: "Post standup summary",
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readRoleWakeups).mockReset();
  vi.mocked(writeRoleWakeupUpdate).mockReset();
  vi.mocked(writeRoleWakeupCreate).mockReset();
  vi.mocked(writeRoleWakeupDelete).mockReset();
  vi.mocked(writeIdentityWakeupCreate).mockReset();
  vi.mocked(writeIdentityWakeupDelete).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// H1. identity:list-role-wakeups
// ──────────────────────────────────────────────────────────────────────

describe("identity:list-role-wakeups WS handler", () => {
  it("H1 happy path: LOCAL branch calls readRoleWakeups(null, key), responds with identity:role-wakeups + list", async () => {
    vi.mocked(readRoleWakeups).mockResolvedValue({ wakeups: [fakeWakeup] });

    await __handleIdentityListRoleWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:list-role-wakeups", identityKey: "tina" },
      "1",
    );

    // No SSH open when hostId omitted (LOCAL branch)
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();

    // readRoleWakeups called with null conn + identityKey
    expect(readRoleWakeups).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleWakeups).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(readRoleWakeups).mock.calls[0][1]).toBe("tina");

    // Response wire shape
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-wakeups");
    expect(sent[0].wakeups).toHaveLength(1);
    expect(sent[0].error).toBeUndefined();
  });

  it("H1 rejects invalid identityKey without opening SSH", async () => {
    await __handleIdentityListRoleWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:list-role-wakeups", identityKey: "not/a/valid key" },
      "1",
    );
    expect(readRoleWakeups).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "identity:role-wakeups",
      wakeups: [],
      error: "invalid identityKey",
    });
  });

  it("H1 surfaces reader throw (missing role frontmatter) as {error} string", async () => {
    vi.mocked(readRoleWakeups).mockRejectedValue(
      new Error("identity tina has no role: frontmatter in identity file"),
    );
    await __handleIdentityListRoleWakeupsForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:list-role-wakeups", identityKey: "tina" },
      "1",
    );
    expect(sent[0].type).toBe("identity:role-wakeups");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toContain("no role");
  });
});

// ──────────────────────────────────────────────────────────────────────
// H2. identity:update-role-wakeup
// ──────────────────────────────────────────────────────────────────────

describe("identity:update-role-wakeup WS handler", () => {
  it("H2 happy path: LOCAL branch writes then re-lists, response carries fresh list", async () => {
    vi.mocked(writeRoleWakeupUpdate).mockResolvedValue(undefined);
    vi.mocked(readRoleWakeups).mockResolvedValue({
      wakeups: [{ ...fakeWakeup, enabled: false }],
    });

    await __handleIdentityUpdateRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-wakeup",
        identityKey: "tina",
        wakeupSlug: "morning-standup",
        updates: { enabled: false },
      },
      "1",
    );

    // Write then read (order matters — server rehydrates from post-write state)
    expect(writeRoleWakeupUpdate).toHaveBeenCalledTimes(1);
    expect(readRoleWakeups).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRoleWakeupUpdate).mock.calls[0][2]).toBe("morning-standup");
    expect(vi.mocked(writeRoleWakeupUpdate).mock.calls[0][3]).toEqual({ enabled: false });

    expect(sent[0].type).toBe("identity:role-wakeup-updated");
    expect(sent[0].wakeups).toHaveLength(1);
    expect(sent[0].error).toBeUndefined();
  });

  it("H2 rejects invalid wakeupSlug without writing", async () => {
    await __handleIdentityUpdateRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-wakeup",
        identityKey: "tina",
        wakeupSlug: "not/valid/slug",
        updates: { enabled: false },
      },
      "1",
    );
    expect(writeRoleWakeupUpdate).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "identity:role-wakeup-updated",
      wakeups: [],
      error: "invalid wakeup slug",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// H3. identity:create-role-wakeup
// ──────────────────────────────────────────────────────────────────────

describe("identity:create-role-wakeup WS handler", () => {
  it("H3 happy path: LOCAL branch creates + returns fresh list", async () => {
    vi.mocked(writeRoleWakeupCreate).mockResolvedValue({ wakeups: [fakeWakeup] });

    await __handleIdentityCreateRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:create-role-wakeup",
        identityKey: "tina",
        spec: {
          name: "Morning Standup",
          enabled: true,
          schedule: { type: "daily", at: "09:00" },
          instruction: "Post standup summary",
        },
      },
      "1",
    );

    expect(writeRoleWakeupCreate).toHaveBeenCalledTimes(1);
    const passedSpec = vi.mocked(writeRoleWakeupCreate).mock.calls[0][2];
    expect(passedSpec.name).toBe("Morning Standup");
    expect(passedSpec.enabled).toBe(true);
    expect(passedSpec.instruction).toBe("Post standup summary");

    expect(sent[0].type).toBe("identity:role-wakeup-created");
    expect(sent[0].wakeups).toHaveLength(1);
    expect(sent[0].error).toBeUndefined();
  });

  it("H3 rejects invalid spec (missing name) without calling writer", async () => {
    await __handleIdentityCreateRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:create-role-wakeup",
        identityKey: "tina",
        spec: {
          // name missing
          enabled: true,
          schedule: { type: "daily" },
          instruction: "x",
        },
      },
      "1",
    );
    expect(writeRoleWakeupCreate).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("identity:role-wakeup-created");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toContain("spec.name");
  });

  it("H3 surfaces writer clobber throw as {error} string", async () => {
    vi.mocked(writeRoleWakeupCreate).mockRejectedValue(
      new Error("wakeup with this name already exists"),
    );
    await __handleIdentityCreateRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:create-role-wakeup",
        identityKey: "tina",
        spec: {
          name: "Morning Standup",
          enabled: true,
          schedule: { type: "daily", at: "09:00" },
          instruction: "Post standup summary",
        },
      },
      "1",
    );
    expect(sent[0].type).toBe("identity:role-wakeup-created");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toContain("already exists");
  });
});

// ──────────────────────────────────────────────────────────────────────
// H4. identity:delete-role-wakeup
// ──────────────────────────────────────────────────────────────────────

describe("identity:delete-role-wakeup WS handler", () => {
  it("H4 happy path: LOCAL branch deletes + returns fresh list", async () => {
    vi.mocked(writeRoleWakeupDelete).mockResolvedValue({ wakeups: [] });

    await __handleIdentityDeleteRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:delete-role-wakeup",
        identityKey: "tina",
        wakeupSlug: "morning-standup",
      },
      "1",
    );

    expect(writeRoleWakeupDelete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRoleWakeupDelete).mock.calls[0][2]).toBe("morning-standup");
    expect(sent[0].type).toBe("identity:role-wakeup-deleted");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBeUndefined();
  });

  it("H4 rejects invalid wakeupSlug without opening SSH", async () => {
    await __handleIdentityDeleteRoleWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:delete-role-wakeup",
        identityKey: "tina",
        wakeupSlug: "not/a/valid slug",
      },
      "1",
    );
    expect(writeRoleWakeupDelete).not.toHaveBeenCalled();
    expect(sent[0].error).toBe("invalid wakeup slug");
  });
});

// ──────────────────────────────────────────────────────────────────────
// H5. identity:create-wakeup (identity-scope parity gap)
// ──────────────────────────────────────────────────────────────────────

describe("identity:create-wakeup WS handler", () => {
  it("H5 happy path: LOCAL branch creates identity-scope wakeup + returns fresh list", async () => {
    vi.mocked(writeIdentityWakeupCreate).mockResolvedValue({ wakeups: [fakeWakeup] });

    await __handleIdentityCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:create-wakeup",
        identityKey: "moxie",
        spec: {
          name: "Weekly Review",
          enabled: true,
          schedule: { type: "weekly", day: "mon", at: "10:00" },
          instruction: "Post weekly review",
        },
      },
      "1",
    );

    expect(writeIdentityWakeupCreate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeIdentityWakeupCreate).mock.calls[0][1]).toBe("moxie");
    expect(sent[0].type).toBe("identity:wakeup-created");
    expect(sent[0].wakeups).toHaveLength(1);
    expect(sent[0].error).toBeUndefined();
  });

  it("H5 rejects invalid identityKey without calling writer", async () => {
    await __handleIdentityCreateWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:create-wakeup",
        identityKey: "BAD KEY!!",
        spec: {
          name: "x",
          enabled: true,
          schedule: { type: "daily" },
          instruction: "y",
        },
      },
      "1",
    );
    expect(writeIdentityWakeupCreate).not.toHaveBeenCalled();
    expect(sent[0].error).toBe("invalid identityKey");
  });
});

// ──────────────────────────────────────────────────────────────────────
// H6. identity:delete-wakeup (identity-scope parity gap)
// ──────────────────────────────────────────────────────────────────────

describe("identity:delete-wakeup WS handler", () => {
  it("H6 happy path: LOCAL branch deletes identity-scope wakeup + returns fresh list", async () => {
    vi.mocked(writeIdentityWakeupDelete).mockResolvedValue({ wakeups: [] });

    await __handleIdentityDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:delete-wakeup",
        identityKey: "moxie",
        wakeupSlug: "doomed",
      },
      "1",
    );

    expect(writeIdentityWakeupDelete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeIdentityWakeupDelete).mock.calls[0][1]).toBe("moxie");
    expect(vi.mocked(writeIdentityWakeupDelete).mock.calls[0][2]).toBe("doomed");
    expect(sent[0].type).toBe("identity:wakeup-deleted");
    expect(sent[0].wakeups).toEqual([]);
    expect(sent[0].error).toBeUndefined();
  });

  it("H6 rejects invalid wakeupSlug without opening SSH", async () => {
    await __handleIdentityDeleteWakeupForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:delete-wakeup",
        identityKey: "moxie",
        wakeupSlug: "not/a/valid slug",
      },
      "1",
    );
    expect(writeIdentityWakeupDelete).not.toHaveBeenCalled();
    expect(sent[0].error).toBe("invalid wakeup slug");
  });
});
