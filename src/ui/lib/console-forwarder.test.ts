/**
 * Patch #146: frontend console-forwarder tests.
 *
 * Proves the two load-bearing invariants:
 *  1. Console-preservation: calling console.error after init still fires
 *     the original console.error method (DevTools console is not broken).
 *  2. Enqueue: calls to log/warn/error produce envelopes with matching
 *     level/msg in the internal buffer.
 *
 * Phase 31 Plan 01 extensions:
 *  3. setLogContext threads hostId/sessionKey into enqueued entries.
 *  4. Log calls before setLogContext produce entries without hostId/sessionKey.
 *  5. setLogContext({}) clears the context (no fields in subsequent entries).
 *
 * Fake timers are used in all tests to prevent the 500ms batch flush
 * from firing a real fetch call during test execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We import the module fresh per test via vi.resetModules() in beforeEach
// to defeat the `initialized` guard — each test gets an uninitialized module.
// Alternatively, we can use the exported __test_reset() function.

describe("console-forwarder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Test 1: original console.error is still called after init (console-preservation invariant)", async () => {
    // Use vi.resetModules so we get a fresh module with initialized=false
    vi.resetModules();
    const { initConsoleForwarder } = await import("./console-forwarder.js");

    // Spy on console.error BEFORE calling initConsoleForwarder.
    // The spy captures the original reference; initConsoleForwarder patches on
    // top of the spy, so calling console.error will hit the patch → the patch
    // calls the (spied) original + enqueues.
    const spy = vi.spyOn(console, "error");

    const received: string[] = [];
    initConsoleForwarder({
      onEnqueue: (entry) => received.push(entry.msg),
    });

    console.error("probe-message");

    // Original (spied) method must have been called with the probe message
    expect(spy).toHaveBeenCalledWith("probe-message");

    // Message must also appear in the buffer (enqueued)
    expect(received).toContain("probe-message");
  });

  it("Test 2: log/warn/error calls produce 3 envelopes with correct level and msg", async () => {
    vi.resetModules();
    const { initConsoleForwarder, __test_getBuffer } = await import(
      "./console-forwarder.js"
    );

    initConsoleForwarder();

    console.log("one");
    console.warn("two");
    console.error("three");

    const buf = __test_getBuffer();

    expect(buf).toHaveLength(3);

    const logEntry = buf.find((e) => e.level === "log");
    const warnEntry = buf.find((e) => e.level === "warn");
    const errorEntry = buf.find((e) => e.level === "error");

    expect(logEntry).toBeDefined();
    expect(logEntry?.msg).toBe("one");
    expect(logEntry?.ts).toBeTruthy();
    expect(typeof logEntry?.ts).toBe("string");

    expect(warnEntry).toBeDefined();
    expect(warnEntry?.msg).toBe("two");
    expect(warnEntry?.ts).toBeTruthy();

    expect(errorEntry).toBeDefined();
    expect(errorEntry?.msg).toBe("three");
    expect(errorEntry?.ts).toBeTruthy();
  });

  it("Test 3: setLogContext threads hostId and sessionKey into enqueued entries", async () => {
    vi.resetModules();
    const { initConsoleForwarder, setLogContext, __test_getBuffer } =
      await import("./console-forwarder.js");

    initConsoleForwarder();
    setLogContext({ hostId: 42, sessionKey: "s-abc" });

    console.log("context-test");

    const buf = __test_getBuffer();
    expect(buf).toHaveLength(1);
    const entry = buf[0];
    expect(entry.hostId).toBe(42);
    expect(entry.sessionKey).toBe("s-abc");
  });

  it("Test 4: log call BEFORE setLogContext produces entry without hostId/sessionKey (not undefined-set — omitted keys)", async () => {
    vi.resetModules();
    const { initConsoleForwarder, __test_getBuffer } = await import(
      "./console-forwarder.js"
    );

    initConsoleForwarder();
    // No setLogContext call — context is empty by default
    console.log("no-context");

    const buf = __test_getBuffer();
    expect(buf).toHaveLength(1);
    const entry = buf[0];
    expect("hostId" in entry).toBe(false);
    expect("sessionKey" in entry).toBe(false);
  });

  it("Test 5: setLogContext({}) clears the context — subsequent entries have no hostId/sessionKey", async () => {
    vi.resetModules();
    const { initConsoleForwarder, setLogContext, __test_getBuffer } =
      await import("./console-forwarder.js");

    initConsoleForwarder();
    setLogContext({ hostId: 99, sessionKey: "s-xyz" });
    // Now clear
    setLogContext({});

    console.log("cleared");

    const buf = __test_getBuffer();
    expect(buf).toHaveLength(1);
    const entry = buf[0];
    expect("hostId" in entry).toBe(false);
    expect("sessionKey" in entry).toBe(false);
  });
});
