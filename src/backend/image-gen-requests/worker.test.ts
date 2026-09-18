/**
 * image-gen-requests/worker.test.ts
 *
 * Unit tests for the image-gen worker's processImageGen main-flow (Phase 116).
 *
 * Test surface (per Plan 116-03 Task 2 <behavior>):
 *   (a) adapter success (n=3) → 3 PNGs (writeBinaryFileAtomic) + 1 success.json
 *       (writeMarkdownFileAtomic) dropped; success JSON lists the exact PNG
 *       filenames it wrote; PNGs written BEFORE the JSON.
 *   (b) adapter ok=false rate_limited → only failure.json dropped, no PNGs.
 *   (c) item.malformedReason set → failure.json {reason:"malformed",
 *       message: item.malformedReason} + NO adapter call + NO token acquire.
 *   (d) TTL-expired item (requested_at 6 min old) → failure.json
 *       {reason:"expired"} + NO adapter call + NO token acquire.
 *   (e) item with refImage:Buffer → adapter called with that Buffer as 2nd arg.
 *   (f) LOCAL branch (isLocalHostId → true) → writes use conn=null and correct
 *       $HOME/fleet/image-gen-requests/<uuid>.* paths.
 *   (g) response write failure (mock throws) does NOT crash the worker.
 *
 * TTL check uses deps.now() (injectable) not Date.now() — verified via a
 * fixed-time deps.now that pushes the item past the 5-min TTL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock systemLogger + partial-mock identity-artifact-reader to control
// isLocalHostId per test.
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return {
    systemLogger: mockLogger,
    sshLogger: mockLogger,
    databaseLogger: mockLogger,
    logger: mockLogger,
  };
});

vi.mock("../claude-session/identity-artifact-reader.js", async (importActual) => {
  const actual = await importActual<typeof import("../claude-session/identity-artifact-reader.js")>();
  return {
    ...actual,
    isLocalHostId: vi.fn().mockReturnValue(false),
    writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
    writeBinaryFileAtomic: vi.fn().mockResolvedValue(undefined),
  };
});

import { processImageGen, type WorkerDeps } from "./worker.js";
import type { PendingImageGen } from "./types.js";
import type { AdapterResult } from "./adapter.js";
import type { TokenBucket } from "./token-bucket.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PendingImageGen for tests — override any field per case. */
function makePendingImageGen(overrides?: Partial<PendingImageGen>): PendingImageGen {
  return {
    hostId: "42",
    hostIdNum: 42,
    uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    body: {
      prompt: "a cat wearing a hat",
      requested_at: "2026-09-18T00:00:00Z",
      size: "1024x1024",
      n: 1,
    },
    userId: "user-abc",
    ...overrides,
  };
}

/** Build a WorkerDeps with vi.fn() for every field. */
function buildTestDeps(overrides?: Partial<WorkerDeps>): WorkerDeps {
  const mockConn = { end: vi.fn(), sftp: vi.fn() } as unknown as Awaited<
    ReturnType<WorkerDeps["connectOneShot"]>
  >;
  const mockTokenBucket: TokenBucket = {
    acquire: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({ tokens: 30, capacity: 30, refillRatePerSec: 0.5 }),
  };
  const successResult: AdapterResult = {
    ok: true,
    images: [Buffer.from("fake-png-bytes")],
    generation_time_ms: 1234,
  };
  const deps: WorkerDeps = {
    connectOneShot: vi.fn().mockResolvedValue(mockConn),
    execCommand: vi.fn().mockResolvedValue(""),
    writeMarkdownFileAtomic: vi.fn().mockResolvedValue(undefined),
    writeBinaryFileAtomic: vi.fn().mockResolvedValue(undefined),
    isLocalHostId: vi.fn().mockReturnValue(false),
    resolveHostById: vi.fn().mockResolvedValue({
      ip: "10.0.0.1",
      port: 22,
      username: "user",
      authType: "password",
      password: "secret",
    }),
    getHostOwnerUserId: vi.fn().mockResolvedValue("user_abc"),
    callOpenAiImageGen: vi.fn().mockResolvedValue(successResult),
    tokenBucket: mockTokenBucket,
    now: vi.fn().mockReturnValue(Date.parse("2026-09-18T00:00:30Z")), // 30s after requested_at
  };
  return { ...deps, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("image-gen worker.processImageGen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) adapter success with n=3 → 3 PNGs + 1 success.json dropped; PNGs BEFORE the JSON; success JSON lists the exact filenames", async () => {
    const item = makePendingImageGen({ body: { prompt: "a cat", requested_at: "2026-09-18T00:00:00Z", n: 3 } });
    const pngBufs = [Buffer.from("png-0"), Buffer.from("png-1"), Buffer.from("png-2")];
    const adapterResult: AdapterResult = {
      ok: true,
      images: pngBufs,
      generation_time_ms: 4321,
    };
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue(adapterResult),
    });

    // Track call order of the two write functions.
    const writeOrder: string[] = [];
    (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, path: string) => {
        writeOrder.push(`BIN:${path}`);
      },
    );
    (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, path: string) => {
        writeOrder.push(`JSON:${path}`);
      },
    );

    await processImageGen(item, deps);

    // Adapter called once with the body (and no refImage).
    expect(deps.callOpenAiImageGen).toHaveBeenCalledTimes(1);
    expect(deps.callOpenAiImageGen).toHaveBeenCalledWith(item.body, undefined);

    // Token acquired exactly once (D-21).
    expect(deps.tokenBucket.acquire).toHaveBeenCalledTimes(1);

    // Exactly 3 PNG writes + 1 success.json write.
    expect(deps.writeBinaryFileAtomic).toHaveBeenCalledTimes(3);
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);

    // PNG write order: 0, 1, 2 with the expected paths.
    for (let i = 0; i < 3; i++) {
      expect(writeOrder[i]).toBe(`BIN:$HOME/fleet/image-gen-requests/${item.uuid}.success.${i}.png`);
    }
    // JSON is the last write (commit-order = observe-order — Pitfall 3 response-side).
    expect(writeOrder[3]).toBe(`JSON:$HOME/fleet/image-gen-requests/${item.uuid}.success.json`);

    // Success JSON body lists the exact PNG filenames (per D-08).
    const jsonBody = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    const parsed = JSON.parse(jsonBody);
    expect(parsed.images).toEqual([
      `${item.uuid}.success.0.png`,
      `${item.uuid}.success.1.png`,
      `${item.uuid}.success.2.png`,
    ]);
    expect(parsed.n).toBe(3);
    expect(parsed.model).toBe("gpt-image-1");
    expect(parsed.size).toBe("1024x1024"); // default when body.size unspecified
    expect(parsed.generation_time_ms).toBe(4321);
  });

  it("(b) adapter ok=false rate_limited → failure.json only, no PNG writes", async () => {
    const item = makePendingImageGen();
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue({ ok: false, reason: "rate_limited" } as AdapterResult),
    });

    await processImageGen(item, deps);

    expect(deps.callOpenAiImageGen).toHaveBeenCalledTimes(1);
    expect(deps.tokenBucket.acquire).toHaveBeenCalledTimes(1);
    expect(deps.writeBinaryFileAtomic).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);

    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${item.uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "rate_limited" });
  });

  it("(c) item.malformedReason set → failure.json {malformed, message} + NO adapter call + NO token acquire", async () => {
    const item = makePendingImageGen({ malformedReason: "unrecognized field: model" });
    const deps = buildTestDeps();

    await processImageGen(item, deps);

    expect(deps.tokenBucket.acquire).not.toHaveBeenCalled();
    expect(deps.callOpenAiImageGen).not.toHaveBeenCalled();
    expect(deps.writeBinaryFileAtomic).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);

    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${item.uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({
      reason: "malformed",
      message: "unrecognized field: model",
    });
  });

  it("(d) TTL-expired item (deps.now > requested_at + 5min) → failure.json expired + NO adapter + NO token", async () => {
    const item = makePendingImageGen({
      body: { prompt: "x", requested_at: "2026-09-18T00:00:00Z" },
    });
    // Simulate deps.now() at 6 min past requested_at — Pitfall 5 TTL check.
    const deps = buildTestDeps({
      now: vi.fn().mockReturnValue(Date.parse("2026-09-18T00:06:00Z")),
    });

    await processImageGen(item, deps);

    expect(deps.tokenBucket.acquire).not.toHaveBeenCalled();
    expect(deps.callOpenAiImageGen).not.toHaveBeenCalled();
    expect(deps.writeBinaryFileAtomic).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "expired" });
  });

  it("(e) item with refImage:Buffer → adapter called with the Buffer as 2nd arg", async () => {
    const refBuf = Buffer.from("fake-ref-png-bytes");
    const item = makePendingImageGen({ refImage: refBuf });
    const deps = buildTestDeps();

    await processImageGen(item, deps);

    expect(deps.callOpenAiImageGen).toHaveBeenCalledTimes(1);
    expect(deps.callOpenAiImageGen).toHaveBeenCalledWith(item.body, refBuf);
  });

  it("(f) LOCAL branch (isLocalHostId true) → writes go with conn=null and correct $HOME/fleet path", async () => {
    const item = makePendingImageGen();
    const pngBufs = [Buffer.from("png-0")];
    const adapterResult: AdapterResult = { ok: true, images: pngBufs, generation_time_ms: 100 };
    const deps = buildTestDeps({
      isLocalHostId: vi.fn().mockReturnValue(true),
      callOpenAiImageGen: vi.fn().mockResolvedValue(adapterResult),
    });

    await processImageGen(item, deps);

    // LOCAL branch: no SSH connection needed and no host-owner lookup needed.
    expect(deps.connectOneShot).not.toHaveBeenCalled();
    expect(deps.resolveHostById).not.toHaveBeenCalled();
    expect(deps.getHostOwnerUserId).not.toHaveBeenCalled();

    // Both writes get conn=null and the correct $HOME/fleet/image-gen-requests path.
    const binCalls = (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mock.calls;
    expect(binCalls[0][0]).toBeNull();
    expect(binCalls[0][1]).toBe(`$HOME/fleet/image-gen-requests/${item.uuid}.success.0.png`);

    const jsonCalls = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls;
    expect(jsonCalls[0][0]).toBeNull();
    expect(jsonCalls[0][1]).toBe(`$HOME/fleet/image-gen-requests/${item.uuid}.success.json`);
  });

  it("(g) response write failure does NOT crash the worker (throw is caught + warn-logged)", async () => {
    const item = makePendingImageGen();
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue({ ok: false, reason: "unknown" } as AdapterResult),
      writeMarkdownFileAtomic: vi.fn().mockRejectedValue(new Error("SFTP boom")),
    });

    // Must NOT throw upward — worker's top-level try/catch swallows.
    await expect(processImageGen(item, deps)).resolves.toBeUndefined();
  });

  it("REMOTE branch: single connectOneShot connection reused for all PNG + JSON writes", async () => {
    const item = makePendingImageGen();
    const pngBufs = [Buffer.from("png-0"), Buffer.from("png-1")];
    const adapterResult: AdapterResult = { ok: true, images: pngBufs, generation_time_ms: 200 };
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue(adapterResult),
    });

    await processImageGen(item, deps);

    // Exactly ONE SSH connection opened for the whole response drop (n PNGs + 1 JSON).
    expect(deps.connectOneShot).toHaveBeenCalledTimes(1);
    // resolveHostById called once for the same reason.
    expect(deps.resolveHostById).toHaveBeenCalledTimes(1);
    // Same conn passed to every write.
    const binConns = (deps.writeBinaryFileAtomic as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const jsonConns = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(binConns[0]).toBeTruthy();
    expect(binConns[1]).toBe(binConns[0]);
    expect(jsonConns[0]).toBe(binConns[0]);
  });

  it("REMOTE branch: host not found → warn + return without adapter call side-effects (failure path)", async () => {
    // If resolveHostById returns null on the failure path, worker logs warn
    // and does not throw. Test with an ok=false adapter so we exercise the
    // failure-write path.
    const item = makePendingImageGen();
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue({ ok: false, reason: "unknown" } as AdapterResult),
      resolveHostById: vi.fn().mockResolvedValue(null),
    });

    await expect(processImageGen(item, deps)).resolves.toBeUndefined();
    // No SFTP write because there's no host to connect to.
    expect(deps.connectOneShot).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("REMOTE success write: getHostOwnerUserId is called before resolveHostById; resolveHostById receives the returned ownerUserId, NOT item.userId", async () => {
    // Bug-guard for the Phase 116 E2E fix: scan-orchestrator populates
    // item.userId = "", so the worker MUST re-resolve the host owner at
    // process-time and pass THAT userId (not item.userId) to resolveHostById.
    // Without this, resolveHostById returns null on every REMOTE call and
    // response images are silently dropped.
    const item = makePendingImageGen({ userId: "" }); // scan-orch shape
    const adapterResult: AdapterResult = {
      ok: true,
      images: [Buffer.from("png-0")],
      generation_time_ms: 111,
    };
    const RESOLVED_OWNER_ID = "user_owner_from_db_lookup";
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue(adapterResult),
      getHostOwnerUserId: vi.fn().mockResolvedValue(RESOLVED_OWNER_ID),
    });

    // Capture the ORDER of the two host-side lookups so we can prove
    // getHostOwnerUserId ran before resolveHostById.
    const callOrder: string[] = [];
    (deps.getHostOwnerUserId as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("getHostOwnerUserId");
      return RESOLVED_OWNER_ID;
    });
    (deps.resolveHostById as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("resolveHostById");
      return {
        ip: "10.0.0.1",
        port: 22,
        username: "user",
        authType: "password",
        password: "secret",
      };
    });

    await processImageGen(item, deps);

    // Call-order invariant: owner lookup FIRST, then host resolution.
    expect(callOrder).toEqual(["getHostOwnerUserId", "resolveHostById"]);

    // getHostOwnerUserId was called with the numeric host id.
    expect(deps.getHostOwnerUserId).toHaveBeenCalledTimes(1);
    expect(deps.getHostOwnerUserId).toHaveBeenCalledWith(item.hostIdNum);

    // Critical: resolveHostById received the RESOLVED owner id, NOT item.userId (which was "").
    expect(deps.resolveHostById).toHaveBeenCalledTimes(1);
    expect(deps.resolveHostById).toHaveBeenCalledWith(item.hostIdNum, RESOLVED_OWNER_ID);
    // Explicit negative assertion — item.userId ("") must NEVER be passed through.
    expect(deps.resolveHostById).not.toHaveBeenCalledWith(item.hostIdNum, "");
  });

  it("REMOTE success write: when getHostOwnerUserId returns null, response is skipped with 'host-owner userId not found' log (no resolveHostById, no SSH)", async () => {
    // If the host row was deleted between scan-tick and worker drain,
    // getHostOwnerUserId returns null. Worker must log + return without
    // calling resolveHostById or opening an SSH connection.
    const item = makePendingImageGen({ userId: "" });
    const adapterResult: AdapterResult = {
      ok: true,
      images: [Buffer.from("png-0")],
      generation_time_ms: 100,
    };
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue(adapterResult),
      getHostOwnerUserId: vi.fn().mockResolvedValue(null),
    });

    await expect(processImageGen(item, deps)).resolves.toBeUndefined();

    // getHostOwnerUserId was called (the gate).
    expect(deps.getHostOwnerUserId).toHaveBeenCalledTimes(1);
    // resolveHostById was NEVER called (short-circuited on the null-owner gate).
    expect(deps.resolveHostById).not.toHaveBeenCalled();
    // No SSH connection opened, no file dropped.
    expect(deps.connectOneShot).not.toHaveBeenCalled();
    expect(deps.writeBinaryFileAtomic).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("REMOTE failure write: getHostOwnerUserId is called before resolveHostById on the failure path too", async () => {
    // Same invariant as the success-write test, but for the failure branch.
    const item = makePendingImageGen({ userId: "" });
    const RESOLVED_OWNER_ID = "user_owner_from_db_lookup";
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue({ ok: false, reason: "rate_limited" } as AdapterResult),
      getHostOwnerUserId: vi.fn().mockResolvedValue(RESOLVED_OWNER_ID),
    });

    await processImageGen(item, deps);

    expect(deps.getHostOwnerUserId).toHaveBeenCalledTimes(1);
    expect(deps.getHostOwnerUserId).toHaveBeenCalledWith(item.hostIdNum);
    expect(deps.resolveHostById).toHaveBeenCalledTimes(1);
    expect(deps.resolveHostById).toHaveBeenCalledWith(item.hostIdNum, RESOLVED_OWNER_ID);
    expect(deps.resolveHostById).not.toHaveBeenCalledWith(item.hostIdNum, "");

    // Failure JSON was still dropped.
    expect(deps.writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = (deps.writeMarkdownFileAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe(`$HOME/fleet/image-gen-requests/${item.uuid}.failure.json`);
    expect(JSON.parse(call[2] as string)).toEqual({ reason: "rate_limited" });
  });

  it("REMOTE failure write: when getHostOwnerUserId returns null, response is skipped without opening SSH", async () => {
    const item = makePendingImageGen({ userId: "" });
    const deps = buildTestDeps({
      callOpenAiImageGen: vi.fn().mockResolvedValue({ ok: false, reason: "unknown" } as AdapterResult),
      getHostOwnerUserId: vi.fn().mockResolvedValue(null),
    });

    await expect(processImageGen(item, deps)).resolves.toBeUndefined();

    expect(deps.getHostOwnerUserId).toHaveBeenCalledTimes(1);
    expect(deps.resolveHostById).not.toHaveBeenCalled();
    expect(deps.connectOneShot).not.toHaveBeenCalled();
    expect(deps.writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
});
