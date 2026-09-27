/**
 * phone-call-requests/scan-orchestrator.test.ts
 *
 * Tests for the scanner batch parser + factory happy path.
 */

import { describe, it, expect, vi } from "vitest";

const { stubLogger } = vi.hoisted(() => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { stubLogger: stub };
});
vi.mock("../utils/logger.js", () => ({
  systemLogger: stubLogger,
  databaseLogger: stubLogger,
  sshLogger: stubLogger,
  tunnelLogger: stubLogger,
  fileLogger: stubLogger,
  statsLogger: stubLogger,
  apiLogger: stubLogger,
  authLogger: stubLogger,
  versionLogger: stubLogger,
  dashboardLogger: stubLogger,
  guacLogger: stubLogger,
  logger: stubLogger,
  setGlobalLogLevel: vi.fn(),
  getGlobalLogLevel: () => "info",
}));

// Stub isLocalHostId to always REMOTE so the SSH path is exercised.
vi.mock("../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: () => false,
  writeMarkdownFileAtomic: vi.fn(),
  writeBinaryFileAtomic: vi.fn(),
}));

vi.mock("../utils/local-fleet-scan.js", () => ({
  scanLocalFleetFolder: vi.fn(),
  readLocalFleetCompanionRef: vi.fn(),
}));

import {
  parsePhoneCallRequestBatch,
  createPhoneCallScanOrchestrator,
  PHONE_CALL_SCAN_CMD,
} from "./scan-orchestrator.js";
import type { PendingPhoneCall } from "./types.js";

const UUID_A = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const UUID_B = "11111111-2222-3333-4444-555555555555";

describe("parsePhoneCallRequestBatch", () => {
  it("parses a well-formed line into a PendingPhoneCall", () => {
    const body = JSON.stringify({
      caller_name: "Clipper the Box Maintainer",
      to_user: "ashley",
      message: "yo",
      requested_at: "2026-09-27T12:00:00Z",
    });
    const stdout = `${UUID_A}.json\t${body}`;
    const results = parsePhoneCallRequestBatch(stdout, "42");
    expect(results).toHaveLength(1);
    expect(results[0].uuid).toBe(UUID_A);
    expect(results[0].hostId).toBe("42");
    expect(results[0].hostIdNum).toBe(42);
    expect(results[0].body.to_user).toBe("ashley");
    expect(results[0].malformedReason).toBeUndefined();
  });

  it("emits a malformed PendingPhoneCall for invalid JSON bodies (so the caller still gets a response)", () => {
    const stdout = `${UUID_A}.json\t{not json`;
    const results = parsePhoneCallRequestBatch(stdout, "1");
    expect(results).toHaveLength(1);
    expect(results[0].uuid).toBe(UUID_A);
    expect(results[0].malformedReason).toContain("invalid JSON");
  });

  it("skips lines whose UUID portion fails the strict shape regex", () => {
    const stdout = `notauuid.json\t{}`;
    expect(parsePhoneCallRequestBatch(stdout, "1")).toEqual([]);
  });

  it("skips lines without a TAB separator", () => {
    const stdout = `${UUID_A}.json{no tab}`;
    expect(parsePhoneCallRequestBatch(stdout, "1")).toEqual([]);
  });

  it("handles multiple lines in one batch", () => {
    const body = JSON.stringify({
      caller_name: "X",
      to_user: "u",
      message: "m",
      requested_at: "2026-09-27T12:00:00Z",
    });
    const stdout = [
      `${UUID_A}.json\t${body}`,
      `${UUID_B}.json\t${body}`,
    ].join("\n");
    const results = parsePhoneCallRequestBatch(stdout, "1");
    expect(results.map((r) => r.uuid).sort()).toEqual([UUID_A, UUID_B].sort());
  });
});

describe("PHONE_CALL_SCAN_CMD", () => {
  it("targets the phone-call-requests folder", () => {
    expect(PHONE_CALL_SCAN_CMD).toContain("~/fleet/phone-call-requests");
  });

  it("uses the mv-based atomic claim primitive", () => {
    expect(PHONE_CALL_SCAN_CMD).toContain('mv "$f" "$tmp"');
  });

  it("guards on 36-char basename length (rejects .response.json)", () => {
    expect(PHONE_CALL_SCAN_CMD).toContain("[ ${#base} -eq 36 ]");
  });
});

describe("createPhoneCallScanOrchestrator", () => {
  it("scans hosts on start() and enqueues parsed items", async () => {
    const body = JSON.stringify({
      caller_name: "X",
      to_user: "u",
      message: "m",
      requested_at: "2026-09-27T12:00:00Z",
    });
    const channelStdout = `${UUID_A}.json\t${body}`;
    const enqueue = vi.fn();
    const channel = { exec: vi.fn(async () => channelStdout) };
    const orch = createPhoneCallScanOrchestrator({
      listSubstrateHosts: async () => [
        { id: "10", name: "host-10", _connDetails: {} },
      ],
      acquireChannel: async () => channel,
      releaseChannel: vi.fn(),
      enqueue,
      setInterval: (() => 0 as unknown as ReturnType<typeof setInterval>) as never,
      clearInterval: vi.fn(),
      setTimeout: (() => 0 as unknown as ReturnType<typeof setTimeout>) as never,
      clearTimeout: vi.fn(),
      now: () => 0,
    });
    await orch.start();
    // Give the fire-and-forget scanOneHost a microtask to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    orch.stop();

    expect(enqueue).toHaveBeenCalledTimes(1);
    const enqueued = enqueue.mock.calls[0][0] as PendingPhoneCall;
    expect(enqueued.uuid).toBe(UUID_A);
    expect(channel.exec).toHaveBeenCalledWith(PHONE_CALL_SCAN_CMD);
  });
});
