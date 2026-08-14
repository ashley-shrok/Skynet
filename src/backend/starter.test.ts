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
 *
 * Tests cover (per plan-04 §Task 2 behavior):
 *   1. install fires exactly once per host per lifecycle
 *   2. install fires again after lifecycle reset (Set.clear())
 *   3. install failure does not block helper return + failure logged
 *   4. install call passes the SshChannel adapter (has exec method)
 *   5. install-attempted Set is the only tracking state (per-lifecycle,
 *      not per-process)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeInstallStopHook } from "./starter.js";
import type { SshChannel } from "./fleet-status/ssh-poll-orchestrator.js";
import type { systemLogger as SystemLoggerType } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// Shared test fixtures — fresh per test via beforeEach
// ---------------------------------------------------------------------------

type InstallStopHookFn = (
  channel: SshChannel,
) => Promise<{ hookInstalled: boolean; settingsUpdated: boolean }>;

let installStopHookMock: ReturnType<typeof vi.fn>;
let loggerMock: typeof SystemLoggerType;
let set: Set<string>;
let channelAdapter: SshChannel;

function makeDeps() {
  return {
    installStopHook: installStopHookMock as unknown as InstallStopHookFn,
    systemLogger: loggerMock,
  };
}

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
// Tests
// ---------------------------------------------------------------------------

describe("Phase 39-04 — maybeInstallStopHook helper", () => {
  it("Test 1: fires installStopHook exactly once per host per lifecycle", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(1);
    expect(installStopHookMock).toHaveBeenCalledWith(channelAdapter);
  });

  it("Test 2: fires again after lifecycle reset (set.clear())", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    // Simulate onLastUnsubscriber cleanup
    set.clear();
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(2);
  });

  it("Test 3: install failure does not block helper return + failure logged with err.message", async () => {
    installStopHookMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"));
    // Helper is void-return — call must return synchronously without throw
    const result = maybeInstallStopHook(
      "host-a",
      channelAdapter,
      set,
      makeDeps(),
    );
    expect(result).toBeUndefined();
    // Yield to microtask queue so the .catch handler runs
    await new Promise((r) => setImmediate(r));
    // Assert loggerMock.warn saw the structured failure payload with
    // both operation + error surfaced (Plan 03 formatMessage contract)
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const warnCall = (loggerMock.warn as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(warnCall[1]).toMatchObject({
      operation: "fleet_status_hook_install_failed",
      error: "boom",
      fleetHostId: "host-a",
    });
  });

  it("Test 4: passes the SshChannel adapter (interface has exec method)", () => {
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    const passedArg = (
      installStopHookMock as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(typeof passedArg.exec).toBe("function");
    // And it must be the same reference we passed in
    expect(passedArg).toBe(channelAdapter);
  });

  it("Test 5: install-attempted Set is the only tracking state — reset re-arms across multiple lifecycles", () => {
    // Lifecycle 1
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(1);
    // Lifecycle boundary 1→2
    set.clear();
    // Lifecycle 2
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(2);
    // Lifecycle boundary 2→3
    set.clear();
    // Lifecycle 3
    maybeInstallStopHook("host-a", channelAdapter, set, makeDeps());
    expect(installStopHookMock).toHaveBeenCalledTimes(3);
  });
});
