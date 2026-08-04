// ─── identity:get-role-file / identity:update-role-file WS handlers ─
//
// Phase 22 SRIC-06 / Plan 22-06 Task 2: verifies the two new WS handlers that
// wire the IdentityModal Role tab to the backend two-step readers/writers.
//
// Test strategy mirrors claude-session-server.count-bounties.test.ts:
//   - vi.mock the reader/writer helpers so we can control responses and
//     surface throws per-test.
//   - vi.mock connectOneShot + resolveHostById so we can steer LOCAL vs
//     REMOTE routing without a real ssh2 pair.
//   - Drive the handlers via the exported __handleIdentityGet/UpdateRoleFileForTests
//     seams (byte-shape mirror of __handleIdentityCountBountiesForTests).
//   - Assert on the outbound wire messages captured by the wsStub.send spy.
//
// Test map (tests 10-15 per plan Task 2 <behavior>):
//   10. get-role-file happy path: LOCAL branch, readRoleFile called with null
//       conn, response wire shape matches identity:role-file with markdown.
//   11. get-role-file rejects invalid identityKey with the same error shape as
//       identity:get-identity-file (markdown: "", error: "invalid identityKey").
//   12. get-role-file surfaces resolveRoleForIdentity throw as {error} string.
//   13. update-role-file happy path: writes then re-reads, response carries the
//       fresh markdown so the client rehydrates from server truth.
//   14. update-role-file rejects oversized contents via the writeRoleFile throw
//       (byte cap enforced inside the helper — surfaces as {error}).
//   15. update-role-file surfaces resolveRoleForIdentity throw (missing role
//       frontmatter propagates through writeRoleFile).

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
    readRoleFile: vi.fn(),
    writeRoleFile: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { readRoleFile, writeRoleFile } from "./identity-artifact-reader.js";
import {
  __handleIdentityGetRoleFileForTests,
  __handleIdentityUpdateRoleFileForTests,
} from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire-shape types + WS stub — mirror the count-bounties test scaffolding
// ──────────────────────────────────────────────────────────────────────

type RoleFileEvent = { type: "identity:role-file"; markdown: string; error?: string };
type RoleFileUpdatedEvent = { type: "identity:role-file-updated"; markdown: string; error?: string };
type AnyOutbound = RoleFileEvent | RoleFileUpdatedEvent;

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: AnyOutbound[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as AnyOutbound);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readRoleFile).mockReset();
  vi.mocked(writeRoleFile).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// identity:get-role-file — tests 10-12
// ──────────────────────────────────────────────────────────────────────

describe("identity:get-role-file WS handler", () => {
  it("test 10: LOCAL branch calls readRoleFile(null, key) and responds with markdown", async () => {
    // Hint LOCAL branch by omitting hostId — handler treats undefined as LOCAL
    vi.mocked(readRoleFile).mockResolvedValue({
      markdown: "# Box Maintainer\n\n## Role\n\nKeeps boxes running.\n",
    });

    await __handleIdentityGetRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:get-role-file", identityKey: "tina" },
      /* userId */ "1",
    );

    // No SSH open when hostId omitted (LOCAL branch)
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();

    // readRoleFile called with null conn + identityKey
    expect(readRoleFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readRoleFile).mock.calls[0][0]).toBeNull();
    expect(vi.mocked(readRoleFile).mock.calls[0][1]).toBe("tina");

    // Response wire shape: {type: "identity:role-file", markdown: "..."}
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file");
    expect(sent[0].markdown).toContain("Keeps boxes running.");
    expect(sent[0].error).toBeUndefined();
  });

  it("test 11: rejects invalid identityKey (fails IDENTITY_KEY_RE) with {markdown: '', error: 'invalid identityKey'}", async () => {
    await __handleIdentityGetRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:get-role-file", identityKey: "not/a/valid key" },
      /* userId */ "1",
    );

    // No reader nor SSH call for invalid key
    expect(readRoleFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();

    // Response mirrors identity:get-identity-file error shape
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toBe("invalid identityKey");
  });

  it("test 12: surfaces resolveRoleForIdentity throw (missing role: frontmatter) as {error} string", async () => {
    // readRoleFile throws when identity has no role: frontmatter
    // (surfaced from inside resolveRoleForIdentity per Plan 22-01 contract).
    vi.mocked(readRoleFile).mockRejectedValue(
      new Error("identity tina has no role: frontmatter in identity file"),
    );

    await __handleIdentityGetRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:get-role-file", identityKey: "tina" },
      /* userId */ "1",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toContain("no role");
    expect(sent[0].error).toContain("tina");
  });

  it("REMOTE branch: resolves host, opens ssh conn, calls readRoleFile(conn), closes conn", async () => {
    const fakeConn = makeFakeConn("hostX");
    vi.mocked(resolveHostById).mockResolvedValue({
      ip: "1.2.3.4",
      username: "ubuntu",
    } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readRoleFile).mockResolvedValue({ markdown: "role body\n" });

    await __handleIdentityGetRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:get-role-file", identityKey: "tina", hostId: 42 },
      /* userId */ "1",
    );

    // REMOTE flow: resolveHostById + connectOneShot each fired exactly once
    expect(resolveHostById).toHaveBeenCalledTimes(1);
    expect(connectOneShot).toHaveBeenCalledTimes(1);

    // readRoleFile got the fake conn (proves REMOTE routing)
    expect(vi.mocked(readRoleFile).mock.calls[0][0]).toBe(fakeConn);

    // Conn closed after the read
    expect(fakeConn.end).toHaveBeenCalledTimes(1);

    // Response OK
    expect(sent[0]).toEqual({ type: "identity:role-file", markdown: "role body\n" });
  });
});

// ──────────────────────────────────────────────────────────────────────
// identity:update-role-file — tests 13-15
// ──────────────────────────────────────────────────────────────────────

describe("identity:update-role-file WS handler", () => {
  it("test 13: LOCAL branch calls writeRoleFile then re-reads via readRoleFile; response carries fresh markdown", async () => {
    vi.mocked(writeRoleFile).mockResolvedValue(undefined);
    vi.mocked(readRoleFile).mockResolvedValue({ markdown: "# Updated Role\n" });

    await __handleIdentityUpdateRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-file",
        identityKey: "tina",
        contents: "# Updated Role\n",
        // hostId omitted → LOCAL branch (same as get handler)
      },
      /* userId */ "1",
    );

    // Write then read (order matters — server rehydrates from post-write state)
    expect(writeRoleFile).toHaveBeenCalledTimes(1);
    expect(readRoleFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeRoleFile).mock.calls[0][0]).toBeNull(); // LOCAL: null conn
    expect(vi.mocked(writeRoleFile).mock.calls[0][1]).toBe("tina");
    expect(vi.mocked(writeRoleFile).mock.calls[0][2]).toBe("# Updated Role\n");

    // Response wire shape mirrors identity:identity-file-updated
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file-updated");
    expect(sent[0].markdown).toBe("# Updated Role\n");
    expect(sent[0].error).toBeUndefined();

    // No SSH round-trip on LOCAL branch
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("test 14: writeRoleFile byte-cap throw surfaces as {error} string in the response", async () => {
    vi.mocked(writeRoleFile).mockRejectedValue(
      new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES"),
    );

    await __handleIdentityUpdateRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-file",
        identityKey: "tina",
        contents: "oversized (simulated by mock throw)",
      },
      /* userId */ "1",
    );

    // Re-read did NOT happen since write threw
    expect(readRoleFile).not.toHaveBeenCalled();

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file-updated");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toContain("IDMEDIT_MAX_MARKDOWN_BYTES");
  });

  it("test 15: writeRoleFile propagates resolveRoleForIdentity throw (missing role) as {error} string", async () => {
    vi.mocked(writeRoleFile).mockRejectedValue(
      new Error("identity moxie has no role: frontmatter in identity file"),
    );

    await __handleIdentityUpdateRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-file",
        identityKey: "moxie",
        contents: "# body",
      },
      /* userId */ "1",
    );

    expect(readRoleFile).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:role-file-updated");
    expect(sent[0].markdown).toBe("");
    expect(sent[0].error).toContain("no role");
    expect(sent[0].error).toContain("moxie");
  });

  it("rejects invalid identityKey without opening SSH", async () => {
    await __handleIdentityUpdateRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-file",
        identityKey: "BAD KEY!!",
        contents: "# body",
      },
      /* userId */ "1",
    );

    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(readRoleFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "identity:role-file-updated",
      markdown: "",
      error: "invalid identityKey",
    });
  });

  it("rejects non-string contents without opening SSH", async () => {
    await __handleIdentityUpdateRoleFileForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:update-role-file",
        identityKey: "tina",
        contents: 42, // wrong type
      },
      /* userId */ "1",
    );

    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "identity:role-file-updated",
      markdown: "",
      error: "contents must be a string",
    });
  });
});
