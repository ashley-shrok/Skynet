import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "./logger.js";

// Fleet-status Phase 39 Plan 03 (GATE2-04):
// formatMessage was silently swallowing every LogContext field except the
// 7-field known-order whitelist (op/user/host/tunnel/session/req/duration).
// Structured payload fields like `error`, `fleetHostId`, `hostname`, etc.
// never reached `console-forward.log` or `docker logs skynet`, which is why
// the Gate 2 SSH-poll diagnosis took as long as it did.
//
// These tests lock in:
//   - `error` (and every other non-sensitive structured field) surfaces
//   - SENSITIVE_FIELDS keep getting masked (no regression)
//   - Known-field ordering (op → user → host → tunnel → session → req → duration)
//     is preserved verbatim so downstream log-parsers do not break
//   - Objects/arrays serialize via JSON.stringify
//   - undefined/null/empty-string values are omitted
//   - TRUNCATE_FIELDS still truncate
//
// The console-forward path (enqueueBackendLog) is stubbed so tests do not
// try to write to /var/log/skynet/console-forward/console-forward.log.
vi.mock("./console-forward-transport.js", () => ({
  enqueueBackendLog: vi.fn(),
}));

describe("Logger.formatMessage — Phase 39 Plan 03 generic passthrough", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fresh spy per test; each test also constructs a new Logger so the
    // internal rate-limiter map cannot leak counts across tests.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function lastWarnArg(): string {
    const calls = warnSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const first = calls[calls.length - 1][0];
    expect(typeof first).toBe("string");
    return first as string;
  }

  it("Test 1: surfaces the `error` field in warn output alongside the operation tag", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-1", { operation: "op1", error: "boom" });
    const out = lastWarnArg();
    expect(out).toContain("op:op1");
    expect(out).toContain("error:boom");
  });

  it("Test 2: extra structured fields (fleetHostId, hostname) surface", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-2", {
      operation: "op1",
      fleetHostId: "5",
      hostname: "box1",
    });
    const out = lastWarnArg();
    expect(out).toContain("fleetHostId:5");
    expect(out).toContain("hostname:box1");
  });

  it("Test 3: SENSITIVE_FIELDS remain masked through the generic passthrough", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-3", {
      operation: "op1",
      password: "secret123",
      key: "PEMSTRING",
    });
    const out = lastWarnArg();
    expect(out).toContain("password:[MASKED]");
    expect(out).toContain("key:[MASKED]");
    expect(out).not.toContain("secret123");
    expect(out).not.toContain("PEMSTRING");
  });

  it("Test 4: known-field ordering preserved (op → user → host) regardless of input key order", () => {
    const logger = new Logger("test", "T", "#ffffff");
    // Deliberately shove keys into the object in an order that does NOT match
    // the intended output ordering. formatMessage must still emit op → user → host.
    logger.warn("msg-test-4", {
      hostId: "h1",
      operation: "op1",
      userId: "u1",
    });
    const out = lastWarnArg();
    const opIdx = out.indexOf("op:op1");
    const userIdx = out.indexOf("user:u1");
    const hostIdx = out.indexOf("host:h1");
    expect(opIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(opIdx);
    expect(hostIdx).toBeGreaterThan(userIdx);
  });

  it("Test 5: object/array values serialize via JSON.stringify", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-5", {
      operation: "op1",
      zodError: { issues: [{ path: ["a"], message: "bad" }] },
    });
    const out = lastWarnArg();
    // JSON.stringify output starts with `{"issues":[...` — check for the
    // characteristic prefix (chalk color codes can wrap the whole segment,
    // so we look for the JSON substring itself).
    expect(out).toContain('zodError:{"issues":');
    expect(out).toContain('"message":"bad"');
  });

  it("Test 6: undefined / null / empty-string values are omitted from output", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-6", {
      operation: "op1",
      empty: "",
      nullish: null,
      undef: undefined,
    });
    const out = lastWarnArg();
    expect(out).toContain("op:op1");
    expect(out).not.toContain("empty:");
    expect(out).not.toContain("nullish:");
    expect(out).not.toContain("undef:");
  });

  it("Test 7: TRUNCATE_FIELDS still truncate long payloads via sanitizeContext", () => {
    const logger = new Logger("test", "T", "#ffffff");
    logger.warn("msg-test-7", { operation: "op1", data: "a".repeat(200) });
    const out = lastWarnArg();
    // sanitizeContext truncates >100-char strings on TRUNCATE_FIELDS to
    // `substring(0,100) + "..."`. Full 200 'a's must not appear; the
    // truncation marker must appear as part of the data value.
    expect(out).not.toContain("a".repeat(200));
    // The generic passthrough serializes strings verbatim, so the trailing
    // "..." from the sanitizer survives to output.
    expect(out).toMatch(/data:a+\.\.\./);
  });
});
