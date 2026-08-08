/**
 * Bounty pretty-view-per-pane-cost-diag (2026-08-08).
 * Unit tests for the interval diag emitter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  emitOnce,
  startDiagEmitter,
  stopDiagEmitter,
  type DiagEnvelope,
} from "./diag-emitter";
import {
  registerPane,
  __test_clear as __clearRegistry,
} from "./diag-registry";

function parseEmittedEnvelope(logCall: unknown[]): DiagEnvelope {
  // console.log is called as: console.log("[DIAG-REPORT]", "<json>")
  expect(logCall[0]).toBe("[DIAG-REPORT]");
  return JSON.parse(logCall[1] as string) as DiagEnvelope;
}

describe("diag-emitter", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __clearRegistry();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    stopDiagEmitter();
    logSpy.mockRestore();
    vi.useRealTimers();
  });

  it("emitOnce writes a [DIAG-REPORT] JSON envelope to console.log", () => {
    emitOnce();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const env = parseEmittedEnvelope(logSpy.mock.calls[0]);
    expect(typeof env.ts).toBe("string");
    expect(env.panes).toEqual([]);
    expect(env.mountedPaneCount).toBe(0);
    expect(typeof env.ua).toBe("string");
  });

  it("envelope includes every registered pane's snapshot", () => {
    registerPane("p1", () => ({
      kind: "pretty-view",
      paneId: "p1",
      hostId: 1,
      tmuxSession: "alpha",
      isVisible: null,
      messageCount: 42,
      wsFramesSinceLast: 7,
      domNodeCount: 123,
    }));
    registerPane("t1", () => ({
      kind: "terminal",
      paneId: "t1",
      hostId: 1,
      tmuxSession: "alpha",
      isVisible: true,
      wsBytesSinceLast: 9001,
      scrollbackLines: 500,
      domNodeCount: 42,
    }));
    emitOnce();
    const env = parseEmittedEnvelope(logSpy.mock.calls[0]);
    expect(env.mountedPaneCount).toBe(2);
    expect(env.panes).toHaveLength(2);
    const pv = env.panes.find((p) => p.kind === "pretty-view")!;
    expect(pv.messageCount).toBe(42);
    expect(pv.wsFramesSinceLast).toBe(7);
    const term = env.panes.find((p) => p.kind === "terminal")!;
    expect(term.wsBytesSinceLast).toBe(9001);
    expect(term.scrollbackLines).toBe(500);
    expect(term.isVisible).toBe(true);
  });

  it("startDiagEmitter fires emitOnce on the interval", () => {
    vi.useFakeTimers();
    startDiagEmitter(1000);
    expect(logSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(logSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2500);
    // 2500ms later = 2 more emits (at 2000ms and 3000ms boundaries)
    expect(logSpy).toHaveBeenCalledTimes(3);
  });

  it("startDiagEmitter is idempotent — calling twice does NOT double the interval", () => {
    vi.useFakeTimers();
    startDiagEmitter(1000);
    startDiagEmitter(1000);
    vi.advanceTimersByTime(1000);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("stopDiagEmitter cancels the interval", () => {
    vi.useFakeTimers();
    startDiagEmitter(1000);
    vi.advanceTimersByTime(1000);
    expect(logSpy).toHaveBeenCalledTimes(1);
    stopDiagEmitter();
    vi.advanceTimersByTime(5000);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("envelope heap is null when performance.memory is absent (Safari case)", () => {
    // vitest's jsdom does not set performance.memory by default.
    // If a prior test polluted globals, force-delete for this case.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (performance as any).memory;
    emitOnce();
    const env = parseEmittedEnvelope(logSpy.mock.calls[0]);
    expect(env.heap).toBeNull();
  });

  it("envelope heap is populated when performance.memory is present (Chrome case)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (performance as any).memory = {
      usedJSHeapSize: 100_000_000,
      totalJSHeapSize: 200_000_000,
      jsHeapSizeLimit: 4_000_000_000,
    };
    try {
      emitOnce();
      const env = parseEmittedEnvelope(logSpy.mock.calls[0]);
      expect(env.heap).toEqual({
        used: 100_000_000,
        total: 200_000_000,
        limit: 4_000_000_000,
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (performance as any).memory;
    }
  });
});
