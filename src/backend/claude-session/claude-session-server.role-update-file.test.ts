// ─── role:update-file WS handler (Phase 90 Plan 90-03 Task 2) ─
//
// Byte-shape mirror of claude-session-server.role-file.test.ts covering the
// existing identity:update-role-file handler, but keyed directly on roleName
// (no identity two-step). Companion wire type for the RoleModal save path
// per D-08.3 planner-pick.
//
// Test strategy mirrors the existing role-file test:
//   - vi.mock the reader/writer helpers so we can control responses and
//     surface throws per-test.
//   - vi.mock connectOneShot + resolveHostById so we can steer LOCAL vs
//     REMOTE routing without a real ssh2 pair.
//   - Drive the handler via the exported __handleRoleUpdateFileForTests seam.
//   - Assert on the outbound wire messages captured by the wsStub.send spy.
//
// Test map (7 cases per plan Task 2 <behavior>):
//   A. LOCAL happy path: writeRoleFileByName(null, roleName, contents) then
//      readRoleFileByName(null, roleName); response identity-echoes markdown.
//   B. REMOTE happy path: resolves host, opens ssh conn, calls writer+reader
//      with the conn, closes conn in finally.
//   C. Invalid roleName: response {markdown:"", error:"invalid roleName"};
//      no SSH open, no writer call.
//   D. Missing host (resolveHostById → null): {error:"host not found"};
//      no writer call.
//   E. Contents not a string: {error:"contents must be a string"}; no writer call.
//   F. Writer throws (oversized payload): error propagates on the envelope.
//   G. Test seam export __handleRoleUpdateFileForTests exists.

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
    writeRoleFileByName: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import {
  readRoleFileByName,
  writeRoleFileByName,
} from "./identity-artifact-reader.js";
import {
  __handleRoleUpdateFileForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub — mirror the role-file test scaffolding
// ──────────────────────────────────────────────────────────────────────

type RoleFileUpdatedEvent = {
  type: "role:file-updated";
  markdown: string;
  error?: string;
};

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: RoleFileUpdatedEvent[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as RoleFileUpdatedEvent);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readRoleFileByName).mockReset();
  vi.mocked(writeRoleFileByName).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Test G: seam export presence (compile-time reference proves the seam
// exists; the import at the top of this file would fail otherwise)
// ──────────────────────────────────────────────────────────────────────

describe("role:update-file WS handler — test seam", () => {
  it("test G: exports __handleRoleUpdateFileForTests (mirrors __handleIdentityUpdateRoleFileForTests)", () => {
    expect(__handleRoleUpdateFileForTests).toBeTypeOf("function");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests A, B — happy paths (LOCAL + REMOTE)
// ──────────────────────────────────────────────────────────────────────

describe("role:update-file WS handler — happy paths", () => {
  it("test A: LOCAL branch calls writeRoleFileByName then readRoleFileByName; response carries fresh markdown", async () => {
    vi.mocked(writeRoleFileByName).mockResolvedValue(undefined);
    vi.mocked(readRoleFileByName).mockResolvedValue({
      markdown: "---\ntitle: Skynet\n---\n\nbody",
    });

    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "box-maintainer",
        contents: "---\ntitle: Skynet\n---\n\nbody",
        // hostId omitted → LOCAL branch (same as identity handler)
      },
      /* userId */ "1",
    );

    // Write then read (order matters — server rehydrates from post-write state)
    expect(writeRoleFileByName).toHaveBeenCalledTimes(1);
    expect(readRoleFileByName).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRoleFileByName).mock.calls[0][0]).toBeNull(); // LOCAL: null conn
    expect(vi.mocked(writeRoleFileByName).mock.calls[0][1]).toBe("box-maintainer");
    expect(vi.mocked(writeRoleFileByName).mock.calls[0][2]).toBe(
      "---\ntitle: Skynet\n---\n\nbody",
    );

    // Response wire shape mirrors identity:role-file-updated but with new type
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("role:file-updated");
    expect(sent[0].markdown).toBe("---\ntitle: Skynet\n---\n\nbody");
    expect(sent[0].error).toBeUndefined();

    // No SSH round-trip on LOCAL branch
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("test B: REMOTE branch resolves host, opens ssh conn, calls writer+reader with conn, closes conn", async () => {
    const fakeConn = makeFakeConn("hostX");
    vi.mocked(resolveHostById).mockResolvedValue({
      ip: "1.2.3.4",
      username: "ubuntu",
    } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(writeRoleFileByName).mockResolvedValue(undefined);
    vi.mocked(readRoleFileByName).mockResolvedValue({ markdown: "role body\n" });

    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "box-maintainer",
        hostId: 3,
        contents: "role body\n",
      },
      /* userId */ "1",
    );

    // REMOTE flow: resolveHostById + connectOneShot each fired exactly once
    expect(resolveHostById).toHaveBeenCalledTimes(1);
    expect(connectOneShot).toHaveBeenCalledTimes(1);

    // writer + reader got the fake conn (proves REMOTE routing)
    expect(vi.mocked(writeRoleFileByName).mock.calls[0][0]).toBe(fakeConn);
    expect(vi.mocked(readRoleFileByName).mock.calls[0][0]).toBe(fakeConn);

    // Conn closed in finally
    expect(fakeConn.end).toHaveBeenCalledTimes(1);

    // Response OK
    expect(sent[0]).toEqual({ type: "role:file-updated", markdown: "role body\n" });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tests C, D, E — validation errors that fire without opening SSH
// ──────────────────────────────────────────────────────────────────────

describe("role:update-file WS handler — validation errors", () => {
  it("test C: rejects invalid roleName (fails ROLE_NAME_PATTERN) without opening SSH or calling writer", async () => {
    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "../evil",
        contents: "x",
      },
      /* userId */ "1",
    );

    expect(writeRoleFileByName).not.toHaveBeenCalled();
    expect(readRoleFileByName).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:file-updated",
      markdown: "",
      error: "invalid roleName",
    });
  });

  it("test D: bad hostId — resolveHostById returns null → {error:'host not found'}, no writer call", async () => {
    vi.mocked(resolveHostById).mockResolvedValue(null as never);

    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "box-maintainer",
        hostId: 999,
        contents: "body",
      },
      /* userId */ "1",
    );

    expect(writeRoleFileByName).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:file-updated",
      markdown: "",
      error: "host not found",
    });
  });

  it("test E: contents not a string → {error:'contents must be a string'}, no writer call", async () => {
    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "box-maintainer",
        contents: 42, // wrong type
      },
      /* userId */ "1",
    );

    expect(writeRoleFileByName).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "role:file-updated",
      markdown: "",
      error: "contents must be a string",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test F — writer throws (oversized-payload gate inside writeRoleFileByName)
// ──────────────────────────────────────────────────────────────────────

describe("role:update-file WS handler — writer throws propagate", () => {
  it("test F: writeRoleFileByName byte-cap throw surfaces as {error} on the response envelope", async () => {
    vi.mocked(writeRoleFileByName).mockRejectedValue(
      new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES"),
    );

    await __handleRoleUpdateFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "role:update-file",
        roleName: "box-maintainer",
        contents: "oversized (simulated by mock throw)",
      },
      /* userId */ "1",
    );

    // Re-read did NOT happen since write threw
    expect(readRoleFileByName).not.toHaveBeenCalled();

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("role:file-updated");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toContain("IDMEDIT_MAX_MARKDOWN_BYTES");
  });
});
