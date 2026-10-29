// ─── identity:probe-trapped-work WS handler — batched fan-out (Phase 104 Plan 01) ─
//
// Response type tag "identity:trapped-work", results field name "results",
// per-result carries hasTrappedWork:boolean, delegates to readIdentityTrappedWork.

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
    readIdentityTrappedWork: vi.fn(),
    // Host 6 stands in for the co-located box (IDENTITIES_LOCAL_HOST_IDS).
    isLocalHostId: vi.fn((id: number | undefined) => id === 6),
  };
});

// Mock the per-host semaphore registry so tests can assert acquisition without
// depending on the real counting-semaphore state.
const semRun = vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => fn());
vi.mock("../ssh/host-semaphore-registry.js", () => ({
  getHostSemaphore: vi.fn(() => ({ run: semRun })),
}));

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { readIdentityTrappedWork } from "./identity-artifact-reader.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import {
  __handleIdentityProbeTrappedWorkForTests,
  TRAPPED_WORK_PER_CONN_CONCURRENCY,
} from "./claude-session-server.js";

type TrappedMsg = {
  type: "identity:trapped-work";
  results: Array<{
    identityKey: string;
    hostId: number | null;
    hasTrappedWork: boolean;
    error?: string;
  }>;
};

function makeFakeConn(label: string): { end: () => void; __label: string } {
  return { end: vi.fn(), __label: label };
}

let sent: TrappedMsg[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as TrappedMsg);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(connectOneShot).mockReset();
  vi.mocked(resolveHostById).mockReset();
  vi.mocked(readIdentityTrappedWork).mockReset();
  vi.mocked(getHostSemaphore).mockClear();
  semRun.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("identity:probe-trapped-work handler — batched per-target fan-out", () => {
  // Test 1
  it("empty targets → empty results array, no throw, no connectOneShot", async () => {
    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:probe-trapped-work", targets: [] },
      /* userId */ 1,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "identity:trapped-work", results: [] });
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(readIdentityTrappedWork).not.toHaveBeenCalled();
  });

  // Test 2
  it("local-only batch (3 targets, local hostId=6) does not open any SSH connection", async () => {
    vi.mocked(readIdentityTrappedWork).mockImplementation(
      async (_conn, identityKey) => ({
        hasTrappedWork: identityKey === "tina",
      }),
    );

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "tina", hostId: 6 },
          { identityKey: "alpha", hostId: 6 },
          { identityKey: "beta", hostId: 6 },
        ],
      },
      /* userId */ 1,
    );

    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].results).toHaveLength(3);
    const byKey = new Map(sent[0].results.map((r) => [r.identityKey, r]));
    expect(byKey.get("tina")).toMatchObject({ hostId: 6, hasTrappedWork: true });
    expect(byKey.get("alpha")).toMatchObject({ hostId: 6, hasTrappedWork: false });
    expect(byKey.get("beta")).toMatchObject({ hostId: 6, hasTrappedWork: false });
  });

  // Test 3
  it("5 targets on the same non-local hostId open EXACTLY one SSH connection (reuse)", async () => {
    const fakeConn = makeFakeConn("hostX");
    vi.mocked(resolveHostById).mockResolvedValue({
      ip: "1.2.3.4",
      username: "ubuntu",
    } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: true });

    const targets = ["a", "b", "c", "d", "e"].map((k) => ({
      identityKey: k,
      hostId: 42,
    }));

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:probe-trapped-work", targets },
      /* userId */ 1,
    );

    expect(connectOneShot).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(readIdentityTrappedWork).mock.calls;
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call[0]).toBe(fakeConn);
    }
    expect(fakeConn.end).toHaveBeenCalledTimes(1);

    expect(sent[0].results).toHaveLength(5);
    for (const r of sent[0].results) {
      expect(r.hasTrappedWork).toBe(true);
      expect(r.error).toBeUndefined();
    }
  });

  // Test 4
  it("mixed local + two distinct remote hostIds → each remote hostId gets exactly one connection; local gets none", async () => {
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
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: false });

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "local1", hostId: 6 },
          { identityKey: "remoteA1", hostId: 42 },
          { identityKey: "remoteA2", hostId: 42 },
          { identityKey: "remoteB1", hostId: 99 },
          { identityKey: "remoteB2", hostId: 99 },
          { identityKey: "remoteB3", hostId: 99 },
        ],
      },
      /* userId */ 1,
    );

    // Exactly 2 connectOneShot invocations (one per non-local hostId).
    expect(connectOneShot).toHaveBeenCalledTimes(2);
    expect(connA.end).toHaveBeenCalledTimes(1);
    expect(connB.end).toHaveBeenCalledTimes(1);
    expect(sent[0].results).toHaveLength(6);
  });

  // Test 5
  it("dead host (resolveHostById throws) → all targets in bucket get error field, hasTrappedWork:false", async () => {
    vi.mocked(resolveHostById).mockRejectedValue(new Error("host lookup failed"));

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "a", hostId: 77 },
          { identityKey: "b", hostId: 77 },
        ],
      },
      /* userId */ 1,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].results).toHaveLength(2);
    for (const r of sent[0].results) {
      expect(r.hasTrappedWork).toBe(false);
      expect(r.error).toContain("host lookup failed");
    }
  });

  // Test 6
  it("per-target error isolation via Promise.allSettled — middle target throws, siblings still succeed", async () => {
    vi.mocked(readIdentityTrappedWork).mockImplementation(
      async (_conn, identityKey) => {
        if (identityKey === "boom") throw new Error("simulated read fail");
        return { hasTrappedWork: true };
      },
    );

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "healthy1", hostId: 6 },
          { identityKey: "boom", hostId: 6 },
          { identityKey: "healthy2", hostId: 6 },
        ],
      },
      /* userId */ 1,
    );

    expect(sent).toHaveLength(1);
    const byKey = new Map(sent[0].results.map((r) => [r.identityKey, r]));
    expect(byKey.get("healthy1")).toMatchObject({
      hasTrappedWork: true,
      hostId: 6,
    });
    expect(byKey.get("healthy2")).toMatchObject({
      hasTrappedWork: true,
      hostId: 6,
    });
    const bad = byKey.get("boom");
    expect(bad).toBeDefined();
    expect(bad!.hasTrappedWork).toBe(false);
    expect(bad!.error).toContain("simulated read fail");
  });

  // Test 7 — sanity: __handleIdentityProbeTrappedWorkForTests IS the handler
  // (invariant that keeps the test seam meaningful; if this alias diverges,
  // downstream router-vs-seam tests would drift silently).
  it("test seam __handleIdentityProbeTrappedWorkForTests is truthy + callable", async () => {
    expect(__handleIdentityProbeTrappedWorkForTests).toBeTypeOf("function");
  });

  // Test 8
  it("response frame type field equals exact literal 'identity:trapped-work'", async () => {
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: false });
    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [{ identityKey: "x", hostId: 6 }],
      },
      /* userId */ 1,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("identity:trapped-work");
  });

  // Test 9 — semaphore acquisition (Phase 104 /close follow-up)
  // Every remote host-group MUST go through getHostSemaphore(hostId).run(...)
  // so concurrent probes cannot push the target's ssh2 connection past
  // MaxSessions=10. Improves on the retired handleIdentityCountBounties
  // pattern which bypassed the semaphore.
  it("remote group acquires per-host semaphore before opening SSH connection", async () => {
    vi.mocked(resolveHostById).mockResolvedValue({
      ip: "10.0.0.1",
      port: 22,
      username: "u",
      authType: "password",
      password: "p",
    } as unknown as Awaited<ReturnType<typeof resolveHostById>>);
    vi.mocked(connectOneShot).mockResolvedValue(
      makeFakeConn("conn-42") as unknown as Awaited<ReturnType<typeof connectOneShot>>,
    );
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: false });

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "tina", hostId: 42 },
          { identityKey: "tabitha", hostId: 42 },
          { identityKey: "george", hostId: 99 },
        ],
      },
      /* userId */ 1,
    );

    // Semaphore acquired for EACH unique remote hostId (42 + 99 = 2 acquisitions)
    expect(getHostSemaphore).toHaveBeenCalledTimes(2);
    expect(getHostSemaphore).toHaveBeenCalledWith(42);
    expect(getHostSemaphore).toHaveBeenCalledWith(99);
    // .run() invoked once per unique hostId — the connectOneShot + probe block
    // ran INSIDE the semaphore, not around it.
    expect(semRun).toHaveBeenCalledTimes(2);
    // Sanity check the response still arrived correctly
    expect(sent).toHaveLength(1);
    expect(sent[0].results).toHaveLength(3);
  });

  // Test 10 — local-only batch does NOT acquire the semaphore
  // (local group runs no SSH exec, so no MaxSessions pressure to gate).
  it("local-only batch does NOT acquire host semaphore (no SSH exec to gate)", async () => {
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: false });

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "tina", hostId: 6 },
          { identityKey: "tabitha", hostId: 6 },
        ],
      },
      /* userId */ 1,
    );

    expect(getHostSemaphore).not.toHaveBeenCalled();
    expect(semRun).not.toHaveBeenCalled();
  });
  // Missing/invalid hostId never falls back to the co-located box.
  it("missing / invalid hostId → per-target {error:'hostId is required'}, no read, no SSH", async () => {
    vi.mocked(readIdentityTrappedWork).mockResolvedValue({ hasTrappedWork: true });

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      {
        type: "identity:probe-trapped-work",
        targets: [
          { identityKey: "nohost" },
          { identityKey: "nullhost", hostId: null },
          { identityKey: "zerohost", hostId: 0 },
          { identityKey: "strhost", hostId: "6" },
        ],
      },
      /* userId */ 1,
    );

    expect(readIdentityTrappedWork).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].results).toHaveLength(4);
    for (const r of sent[0].results) {
      expect(r).toMatchObject({ hostId: null, hasTrappedWork: false, error: "hostId is required" });
    }
  });

  it("30 targets on ONE remote connection never run more than 8 reads at once (MaxSessions guard), all answered in order", async () => {
    expect(TRAPPED_WORK_PER_CONN_CONCURRENCY).toBe(8);
    const fakeConn = makeFakeConn("harbor");
    vi.mocked(resolveHostById).mockResolvedValue({ ip: "1.2.3.4", username: "ubuntu" } as never);
    vi.mocked(connectOneShot).mockResolvedValue(fakeConn as never);
    let active = 0;
    let peak = 0;
    vi.mocked(readIdentityTrappedWork).mockImplementation(async (_conn, key) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      if (key === "id-7") throw new Error("exec failed");
      return { hasTrappedWork: key === "id-3" };
    });
    const targets = Array.from({ length: 30 }, (_, i) => ({ identityKey: `id-${i}`, hostId: 42 }));

    await __handleIdentityProbeTrappedWorkForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "identity:probe-trapped-work", targets },
      /* userId */ 1,
    );

    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(peak).toBe(8);
    expect(sent[0].results.map((r) => r.identityKey)).toEqual(targets.map((t) => t.identityKey));
    expect(sent[0].results[3]).toMatchObject({ hasTrappedWork: true });
    expect(sent[0].results[7]).toMatchObject({ hasTrappedWork: false, error: "exec failed" });
    expect(fakeConn.end).toHaveBeenCalledTimes(1);
  });
});
