/**
 * starter.test.ts
 *
 * Phase 39 Plan 04 — Coverage for the exported `maybeInstallStopHook`
 * helper wired into the fleet-status IIFE's acquireSshChannel path.
 *
 * The helper is intentionally extracted to module scope in starter.ts
 * (per plan-check WARNING 2) so this test can drive it directly with
 * mocked deps — no need to boot the whole IIFE.
 *
 * The starter.ts IIFE is guarded by `if (process.env.VITEST !== "true")`
 * so importing this module here does not trigger real backend init.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeInstallStopHook } from "./starter.js";
import type { SshChannel } from "./fleet-status/ssh-poll-orchestrator.js";
import type { systemLogger as SystemLoggerType } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let installStopHookMock: ReturnType<typeof vi.fn>;
let loggerMock: typeof SystemLoggerType;
let set: Set<string>;
let channelAdapter: SshChannel;

beforeEach(() => {
  installStopHookMock = vi.fn().mockResolvedValue({
    hookInstalled: true,
    settingsUpdated: false,
  });
  loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  } as unknown as typeof SystemLoggerType;
  set = new Set<string>();
  channelAdapter = {
    exec: vi.fn().mockResolvedValue("ok"),
  };
});

// ---------------------------------------------------------------------------
// Test 1: install fires exactly once per host per lifecycle
// ---------------------------------------------------------------------------

describe("Phase 39-04 — maybeInstallStopHook helper", () => {
  it("Test 1: fires installStopHook exactly once per host per lifecycle", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, {
      installStopHook: installStopHookMock as unknown as (
        channel: SshChannel,
      ) => Promise<{ hookInstalled: boolean; settingsUpdated: boolean }>,
      systemLogger: loggerMock,
    });
    maybeInstallStopHook("host-a", channelAdapter, set, {
      installStopHook: installStopHookMock as unknown as (
        channel: SshChannel,
      ) => Promise<{ hookInstalled: boolean; settingsUpdated: boolean }>,
      systemLogger: loggerMock,
    });
    expect(installStopHookMock).toHaveBeenCalledTimes(1);
    expect(installStopHookMock).toHaveBeenCalledWith(channelAdapter);
  });
});
