// ─── identity:count-bounties WS handler — batched fan-out (quick 260727-tb1) ─
//
// The handler groups `targets` by hostId, opens exactly ONE SshConnection per
// non-local hostId (via connectOneShot), runs all identities on that host
// through it, and wraps every read in Promise.allSettled so one slow/dead
// host does not block the batch. Response is a single identity:bounty-counts
// message carrying { identityKey, hostId, onDeckCount, error? } per target.
//
// We drive the handler directly via an exported test seam
// (`__handleIdentityCountBountiesForTests`) rather than spinning up a real
// WebSocket server. The seam matches the wire shape 1:1 and gives us clean
// visibility on connectOneShot call counts + per-target error isolation.
//
// Mocking strategy (mirrors the aside test's execCommand mock pattern):
//   - ssh-one-shot.js → mocked connectOneShot returns a sentinel "conn" per
//     call so we can count opens per hostId.
//   - host-resolver.js → resolveHostById returns a stub host object.
//   - identity-artifact-reader.js → readIdentityOnDeckBountyCount is spied so
//     we can inject counts + rejections per (conn, identityKey).

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
    readIdentityOnDeckBountyCount: vi.fn(),
  };
});

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { readIdentityOnDeckBountyCount } from "./identity-artifact-reader.js";
import { __handleIdentityCountBountiesForTests } from "./claude-session-server.js";

type CountsMsg = {
  type: "identity:bounty-counts";
  counts: Array<{
    identityKey: string;
    hostId: number | null;
    onDeckCount: number;
    error?: string;
  }>;
};

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: CountsMsg[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as CountsMsg);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readIdentityOnDeckBountyCount).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("identity:count-bounties handler — batched per-target read", () => {
  it("empty targets → empty counts array, no throw", async () => {
    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:count-bounties", targets: [] },
      /* userId */ 1,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "identity:bounty-counts", counts: [] });
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(readIdentityOnDeckBountyCount).not.toHaveBeenCalled();
  });

  it("local-only batch (hostId=null) does not open any SSH connection", async () => {
    vi.mocked(readIdentityOnDeckBountyCount).mockImplementation(
      async (_conn, identityKey) => (identityKey === "tina" ? 3 : 0),
    );

    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:count-bounties",
        targets: [
          { identityKey: "tina", hostId: null },
          { identityKey: "other", hostId: null },
        ],
      },
      /* userId */ 1,
    );

    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].counts).toEqual([
      { identityKey: "tina", hostId: null, onDeckCount: 3 },
      { identityKey: "other", hostId: null, onDeckCount: 0 },
    ]);
  });

  it("5 targets on the same non-local hostId open EXACTLY one SSH connection (connection reuse)", async () => {
    const fakeConn = makeFakeConn("hostX");
    vi.mocked(resolveHostById).mockResolvedValue({
      ip: "1.2.3.4",
      username: "ubuntu",
    } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readIdentityOnDeckBountyCount).mockResolvedValue(1);

    const targets = ["a", "b", "c", "d", "e"].map((k) => ({
      identityKey: k,
      hostId: 42,
    }));

    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:count-bounties", targets },
      /* userId */ 1,
    );

    // Exactly one connectOneShot for the whole hostId=42 group.
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    // All five reads received the SAME conn (proves reuse).
    const calls = vi.mocked(readIdentityOnDeckBountyCount).mock.calls;
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call[0]).toBe(fakeConn);
    }
    // Conn is closed after the batch finishes (defensive .end()).
    expect(fakeConn.end).toHaveBeenCalledTimes(1);

    expect(sent[0].counts).toHaveLength(5);
    for (const c of sent[0].counts) {
      expect(c.onDeckCount).toBe(1);
      expect(c.error).toBeUndefined();
    }
  });

  it("per-target error isolation: one rejected read does not fail the batch (Promise.allSettled)", async () => {
    vi.mocked(readIdentityOnDeckBountyCount).mockImplementation(
      async (_conn, identityKey) => {
        if (identityKey === "boom") throw new Error("simulated dead ssh");
        return 7;
      },
    );

    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:count-bounties",
        targets: [
          { identityKey: "healthy", hostId: null },
          { identityKey: "boom", hostId: null },
          { identityKey: "also-healthy", hostId: null },
        ],
      },
      /* userId */ 1,
    );

    expect(sent).toHaveLength(1);
    const byKey = new Map(sent[0].counts.map((c) => [c.identityKey, c]));
    expect(byKey.get("healthy")).toMatchObject({
      onDeckCount: 7,
      hostId: null,
    });
    expect(byKey.get("also-healthy")).toMatchObject({
      onDeckCount: 7,
      hostId: null,
    });
    const bad = byKey.get("boom");
    expect(bad).toBeDefined();
    expect(bad!.onDeckCount).toBe(0);
    expect(bad!.error).toContain("simulated dead ssh");
  });

  it("mixed local + two distinct remote hostIds → each remote hostId gets its own single connection; local gets none", async () => {
    const connA = makeFakeConn("A");
    const connB = makeFakeConn("B");
    vi.mocked(resolveHostById).mockImplementation(
      async (hostId: number) =>
        ({
          ip: `10.0.0.${hostId}`,
          username: "ubuntu",
        }) as never,
    );
    vi.mocked(connectOneShot)
      .mockResolvedValueOnce(connA as never)
      .mockResolvedValueOnce(connB as never);
    vi.mocked(readIdentityOnDeckBountyCount).mockResolvedValue(2);

    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:count-bounties",
        targets: [
          { identityKey: "local1", hostId: null },
          { identityKey: "remoteA1", hostId: 11 },
          { identityKey: "remoteA2", hostId: 11 },
          { identityKey: "remoteB1", hostId: 22 },
        ],
      },
      /* userId */ 1,
    );

    expect(connectOneShot).toHaveBeenCalledTimes(2); // one per non-local hostId
    expect(connA.end).toHaveBeenCalledTimes(1);
    expect(connB.end).toHaveBeenCalledTimes(1);
    expect(sent[0].counts).toHaveLength(4);
    for (const c of sent[0].counts) {
      expect(c.onDeckCount).toBe(2);
    }
  });

  it("invalid identityKey (reader rejects) surfaces as a per-target error while other targets still succeed", async () => {
    // Mirror the real reader's validation posture: reject invalid keys,
    // accept valid ones. Proves the handler propagates per-target
    // rejection through the response.error field via Promise.allSettled
    // rather than 500-ing the whole batch.
    vi.mocked(readIdentityOnDeckBountyCount).mockImplementation(
      async (_conn, identityKey) => {
        if (!/^[a-z0-9_-]{1,64}$/.test(identityKey)) {
          throw new Error("invalid identityKey");
        }
        return 5;
      },
    );

    await __handleIdentityCountBountiesForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:count-bounties",
        targets: [
          { identityKey: "../etc", hostId: null }, // invalid
          { identityKey: "tina", hostId: null },
        ],
      },
      /* userId */ 1,
    );

    expect(sent).toHaveLength(1);
    const byKey = new Map(sent[0].counts.map((c) => [c.identityKey, c]));
    expect(byKey.get("tina")).toMatchObject({ onDeckCount: 5, hostId: null });
    const bad = byKey.get("../etc");
    expect(bad).toBeDefined();
    expect(bad!.onDeckCount).toBe(0);
    expect(bad!.error).toContain("invalid identityKey");
  });
});
