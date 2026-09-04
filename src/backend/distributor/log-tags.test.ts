/**
 * log-tags.test.ts — Behavioral tests asserting exact operation-field values
 * + payload shapes for the four fleet-substrate log-tag helpers.
 *
 * The four operation strings are grep-anchors for a box-maintainer diagnosing
 * a substrate propagation failure by tailing console-forward.log — the
 * primary reader per the shape doc (72-CONTEXT.md § Code context). Signature
 * drift on any of them silently breaks the grep story.
 *
 * These tests mock the systemLogger module (vi.mock) and assert the exact
 * message string + payload object each helper passes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { systemLogger } from "../utils/logger.js";
import {
  logSweepResult,
  logItemChanged,
  logItemFailed,
  logSweepHookError,
} from "./log-tags.js";

const infoMock = systemLogger.info as ReturnType<typeof vi.fn>;
const warnMock = systemLogger.warn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  infoMock.mockClear();
  warnMock.mockClear();
});

describe("log-tags helpers", () => {
  it("Test 1: logSweepResult emits fleet_substrate_sweep_result with full payload on info", () => {
    logSweepResult({
      hostId: "host-abc",
      hostName: "exec-vm-1",
      itemsChecked: 19,
      itemsChanged: 2,
      itemsFailed: 0,
      durationMs: 42,
    });

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();

    const [message, payload] = infoMock.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    expect(payload).toEqual(
      expect.objectContaining({
        operation: "fleet_substrate_sweep_result",
        hostId: "host-abc",
        hostName: "exec-vm-1",
        itemsChecked: 19,
        itemsChanged: 2,
        itemsFailed: 0,
        durationMs: 42,
      }),
    );
  });

  it("Test 2: logItemChanged emits fleet_substrate_item_changed with full payload on info", () => {
    logItemChanged({
      hostId: "host-abc",
      hostName: "exec-vm-1",
      entrySlug: "agent-supervisor",
      installPath: "~/.local/bin/agent-supervisor",
      changeKind: "installed-new",
      restartHookFired: "agent-supervisor.service",
    });

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalled();

    const [message, payload] = infoMock.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    expect(payload).toEqual(
      expect.objectContaining({
        operation: "fleet_substrate_item_changed",
        hostId: "host-abc",
        hostName: "exec-vm-1",
        entrySlug: "agent-supervisor",
        installPath: "~/.local/bin/agent-supervisor",
        changeKind: "installed-new",
        restartHookFired: "agent-supervisor.service",
      }),
    );
  });

  it("Test 3: logItemFailed emits fleet_substrate_item_failed with full payload on warn", () => {
    logItemFailed({
      hostId: "host-abc",
      hostName: "exec-vm-1",
      entrySlug: "id-skill",
      installPath: "~/.claude/skills/id/SKILL.md",
      stage: "write",
      errorMessage: "Permission denied",
    });

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(infoMock).not.toHaveBeenCalled();

    const [message, payload] = warnMock.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    expect(payload).toEqual(
      expect.objectContaining({
        operation: "fleet_substrate_item_failed",
        hostId: "host-abc",
        hostName: "exec-vm-1",
        entrySlug: "id-skill",
        installPath: "~/.claude/skills/id/SKILL.md",
        stage: "write",
        errorMessage: "Permission denied",
      }),
    );
  });

  it("Test 4: all four helpers pass payload as the SECOND argument (spy-shape discipline)", () => {
    // Sweep result → info, 2 args, second arg is the payload object.
    logSweepResult({
      hostId: "h",
      hostName: "n",
      itemsChecked: 1,
      itemsChanged: 0,
      itemsFailed: 0,
      durationMs: 1,
    });
    expect(infoMock.mock.calls[0]).toHaveLength(2);
    expect(typeof infoMock.mock.calls[0][0]).toBe("string");
    expect(typeof infoMock.mock.calls[0][1]).toBe("object");
    infoMock.mockClear();

    // Item changed → info, same 2-arg shape.
    logItemChanged({
      hostId: "h",
      hostName: "n",
      entrySlug: "s",
      installPath: "~/p",
      changeKind: "bytes-updated",
      restartHookFired: null,
    });
    expect(infoMock.mock.calls[0]).toHaveLength(2);
    expect(typeof infoMock.mock.calls[0][0]).toBe("string");
    expect(typeof infoMock.mock.calls[0][1]).toBe("object");
    infoMock.mockClear();

    // Item failed → warn, 2-arg shape.
    logItemFailed({
      hostId: "h",
      hostName: "n",
      entrySlug: "s",
      installPath: "~/p",
      stage: "chmod",
      errorMessage: "e",
    });
    expect(warnMock.mock.calls[0]).toHaveLength(2);
    expect(typeof warnMock.mock.calls[0][0]).toBe("string");
    expect(typeof warnMock.mock.calls[0][1]).toBe("object");
    warnMock.mockClear();

    // Sweep hook error → warn, 2-arg shape.
    logSweepHookError({ hostId: "h", hostName: "n", errorMessage: "e" });
    expect(warnMock.mock.calls[0]).toHaveLength(2);
    expect(typeof warnMock.mock.calls[0][0]).toBe("string");
    expect(typeof warnMock.mock.calls[0][1]).toBe("object");
  });

  it("Test 5: logSweepHookError emits fleet_substrate_sweep_hook_error with full payload on warn", () => {
    logSweepHookError({
      hostId: "host-abc",
      hostName: "exec-vm-1",
      errorMessage: "runSweepForHost rejected: TypeError foo",
    });

    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(infoMock).not.toHaveBeenCalled();

    const [message, payload] = warnMock.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    expect(payload).toEqual(
      expect.objectContaining({
        operation: "fleet_substrate_sweep_hook_error",
        hostId: "host-abc",
        hostName: "exec-vm-1",
        errorMessage: "runSweepForHost rejected: TypeError foo",
      }),
    );
  });
});
