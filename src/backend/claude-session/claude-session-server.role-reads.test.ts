// ─── role-name-keyed READ WS handlers (Phase 90 Plan 90-07 Task 3) ─
//
// Byte-shape mirror of claude-session-server.role-update-file.test.ts (Plan
// 90-03), covering the READ variant surviving both retirements:
//   - role:get-file       → readRoleFileByName
//
// Phase 134 Plan 134-02 retired role:list-wakeups (its coverage lived here
// in the third describe block); Phase 136 retired role:list-bounties. Both
// were removed along with their reader mocks.
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
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  readRoleFileByName,
} from "./identity-artifact-reader.js";
import {
  __handleRoleGetFileForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub
// ──────────────────────────────────────────────────────────────────────

type AnyRoleReadResponse = {
  type: string;
  markdown?: string;
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

// Phase 134 Plan 134-02 retired the role:list-wakeups describe block;
// Phase 136 retired the role:list-bounties describe block. Both wire ops
// are gone — only role:get-file remains covered above.
