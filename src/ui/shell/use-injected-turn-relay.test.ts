/**
 * Regression tests for useInjectedTurnRelay hook.
 *
 * Covers the queue-and-replay fix for the silent-null-drop in
 * handleInjectedTurnReady (IdentitySessionPane) where pvSendInputRef.current
 * is null during a WS mid-reconnect / mount-race at the moment
 * upload_ready_to_inject fires.
 *
 * Test plan:
 * T1: live-ref immediate dispatch
 * T2: null-ref queue-and-replay
 * T3: stale-pending displacement
 * T4: register / unregister / register with no pending (no replay)
 * T5: log assertions matrix (all [pv-inject] branch coverage)
 * T6: StrictMode double-invoke guard
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInjectedTurnRelay } from "./use-injected-turn-relay";

describe("useInjectedTurnRelay", () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let currentSend: ((text: string, mqid?: string) => boolean) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSend = vi.fn((_text: string, _mqid?: string) => true);
    currentSend = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1: live-ref immediate dispatch — body sync, \\r+mqid at +60ms", () => {
    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    // Register a send function (live ref).
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
    });

    // Fire onInjectedTurnReady synchronously.
    act(() => {
      result.current.onInjectedTurnReady("hello world", "mqid-abc");
    });

    // Body fires synchronously (1 call).
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]).toEqual(["hello world"]);

    // Advance 60ms — CR half fires.
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1]).toEqual(["\r", "mqid-abc"]);
  });

  it("T2: null-ref queue-and-replay — stashes turn, replays on register", async () => {
    // getSendFn() returns null — no registered function yet.
    currentSend = null;

    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    // Fire onInjectedTurnReady with no registered send fn.
    act(() => {
      result.current.onInjectedTurnReady("queued text", "mqid-xyz");
    });

    // mockSend must NOT have been called.
    expect(mockSend).toHaveBeenCalledTimes(0);

    // A [pv-inject] info log must have fired with the right fields.
    const infoCalls = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    const entryLog = infoCalls.find((args) => {
      const first = args[0];
      if (typeof first === "string") return first.includes("[pv-inject]") && first.includes("entry");
      if (typeof first === "object" && first !== null)
        return String(first.operation ?? "").startsWith("pv_inject_");
      return false;
    });
    expect(entryLog).toBeDefined();

    // Now register mockSend.
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
    });

    // Flush microtasks (queueMicrotask inside onRegisterSendInput).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Body should have fired (1 call).
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]).toEqual(["queued text"]);

    // Advance 60ms — CR half fires.
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1]).toEqual(["\r", "mqid-xyz"]);
  });

  it("T3: stale-pending displacement — second turn displaces first, only second replays", async () => {
    currentSend = null;

    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    // Fire first turn with null ref — stashes into pending.
    act(() => {
      result.current.onInjectedTurnReady("first turn", "mqid-1");
    });

    // Fire second turn with null ref — should displace first and WARN.
    act(() => {
      result.current.onInjectedTurnReady("second turn", "mqid-2");
    });

    // A [pv-inject] WARN log must have fired naming displacement of mqid-1.
    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const displacementWarn = warnCalls.find((args) => {
      const first = args[0];
      return (
        typeof first === "string" && first.includes("[pv-inject]") &&
        (first.includes("displac") || first.includes("stale"))
      ) || (
        typeof first === "object" && first !== null &&
        (String(first.operation ?? "").includes("displac") || String(first.displacedMqid ?? "").includes("mqid-1"))
      );
    });
    expect(displacementWarn).toBeDefined();

    // Register mockSend — should trigger drain for ONLY the second turn.
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
    });

    // Flush microtasks.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance 60ms.
    act(() => {
      vi.advanceTimersByTime(60);
    });

    // Exactly 2 calls: second turn body + second turn CR.
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0]).toEqual(["second turn"]);
    expect(mockSend.mock.calls[1]).toEqual(["\r", "mqid-2"]);

    // "first turn" must NEVER appear in any call.
    const allCallArgs = mockSend.mock.calls.flat();
    expect(allCallArgs).not.toContain("first turn");
    expect(allCallArgs).not.toContain("mqid-1");
  });

  it("T4: register / unregister / register with no pending — no replay fires", async () => {
    currentSend = null;

    const mockSend2 = vi.fn((_text: string, _mqid?: string) => true);

    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    // Register mockSend.
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
    });

    // Immediately unregister — assert [pv-inject] ref-unregistered log fires.
    currentSend = null;
    act(() => {
      result.current.onUnregisterSendInput();
    });

    const infoCalls = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    const unregLog = infoCalls.find((args) => {
      const first = args[0];
      return (
        typeof first === "string" && first.includes("[pv-inject]") && first.includes("unregist")
      ) || (
        typeof first === "object" && first !== null &&
        String(first.operation ?? "").includes("unregist")
      );
    });
    expect(unregLog).toBeDefined();

    // Re-register with a NEW mock — no pending, so no drain.
    currentSend = mockSend2;
    act(() => {
      result.current.onRegisterSendInput(mockSend2);
    });

    // Flush microtasks.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance timers.
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Neither mock should have been called.
    expect(mockSend).toHaveBeenCalledTimes(0);
    expect(mockSend2).toHaveBeenCalledTimes(0);
  });

  it("T5: log assertions matrix — all [pv-inject] branch coverage including 60ms-window null WARN", async () => {
    currentSend = null;

    // --- (a) entry log + (c) queued-for-replay ---
    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    act(() => {
      result.current.onInjectedTurnReady("text-t5", "mqid-t5");
    });

    const infoCalls1 = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    // (a) entry log
    const hasEntry = infoCalls1.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]")) ||
        (typeof f === "object" && f !== null && String(f.operation ?? "").startsWith("pv_inject_"));
    });
    expect(hasEntry).toBe(true);

    // (c) queued-for-replay log
    const hasQueued = infoCalls1.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]") && (f.includes("queue") || f.includes("pending"))) ||
        (typeof f === "object" && f !== null && (String(f.operation ?? "").includes("queue") || String(f.operation ?? "").includes("pending")));
    });
    expect(hasQueued).toBe(true);

    (console.info as ReturnType<typeof vi.fn>).mockClear();

    // Register — triggers (d) draining-on-rebind log.
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const infoCalls2 = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    // (b) dispatching-immediately is covered in live-path; (d) draining-on-rebind here
    const hasDrain = infoCalls2.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]") && (f.includes("drain") || f.includes("rebind"))) ||
        (typeof f === "object" && f !== null && (String(f.operation ?? "").includes("drain") || String(f.operation ?? "").includes("rebind")));
    });
    expect(hasDrain).toBe(true);

    // --- (b) dispatching-immediately log: register first, then fire ---
    (console.info as ReturnType<typeof vi.fn>).mockClear();
    currentSend = mockSend;
    act(() => {
      result.current.onInjectedTurnReady("live-text", "mqid-live");
    });
    const infoCalls3 = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    const hasImmediate = infoCalls3.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]") && (f.includes("dispatch") || f.includes("immediate") || f.includes("live"))) ||
        (typeof f === "object" && f !== null && (String(f.operation ?? "").includes("dispatch") || String(f.operation ?? "").includes("immediate")));
    });
    expect(hasImmediate).toBe(true);

    // Advance 60ms — clear CR timer.
    act(() => { vi.advanceTimersByTime(60); });

    // --- (e) ref-unregistered log ---
    (console.info as ReturnType<typeof vi.fn>).mockClear();
    currentSend = null;
    act(() => { result.current.onUnregisterSendInput(); });
    const infoCalls4 = (console.info as ReturnType<typeof vi.fn>).mock.calls;
    const hasUnreg = infoCalls4.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]") && f.includes("unregist")) ||
        (typeof f === "object" && f !== null && String(f.operation ?? "").includes("unregist"));
    });
    expect(hasUnreg).toBe(true);

    // --- (f) 60ms-window null WARN: register, fire turn, unregister BEFORE 60ms fires ---
    currentSend = mockSend;
    act(() => { result.current.onRegisterSendInput(mockSend); });
    act(() => { result.current.onInjectedTurnReady("window-text", "mqid-window"); });
    // Unregister before 60ms fires.
    currentSend = null;
    act(() => { result.current.onUnregisterSendInput(); });

    (console.warn as ReturnType<typeof vi.fn>).mockClear();
    act(() => { vi.advanceTimersByTime(60); });

    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const has60msWarn = warnCalls.some((args) => {
      const f = args[0];
      return (typeof f === "string" && f.includes("[pv-inject]")) ||
        (typeof f === "object" && f !== null && String(f.operation ?? "").startsWith("pv_inject_"));
    });
    expect(has60msWarn).toBe(true);
  });

  it("T6: StrictMode double-invoke guard — second register invoke's microtask skips drain", async () => {
    currentSend = null;

    const { result } = renderHook(() =>
      useInjectedTurnRelay({ getSendFn: () => currentSend }),
    );

    // Stash a pending turn.
    act(() => {
      result.current.onInjectedTurnReady("queued text", "mqid-sm");
    });

    // Simulate StrictMode double ref-callback: register mockSend TWICE in rapid succession.
    currentSend = mockSend;
    act(() => {
      result.current.onRegisterSendInput(mockSend);
      result.current.onRegisterSendInput(mockSend); // second invoke (StrictMode)
    });

    // Flush microtasks — both queueMicrotask calls execute.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only ONE body send (not two — second microtask sees pending=null and skips).
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]).toEqual(["queued text"]);

    // Advance 60ms — only ONE CR fires.
    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1]).toEqual(["\r", "mqid-sm"]);
  });
});
