/**
 * ssh-poll-orchestrator.test.ts
 *
 * Unit tests for the 2s SSH-poll orchestrator. All external dependencies
 * (SSH channels, DB host-list query, subscription registry, timers) are
 * dependency-injected and mocked here. No real SSH, no real /proc, no DB.
 *
 * Tests 1-12 cover the orchestrator's general behaviour; the
 * 'fail-open on missing hook payload file' describe block (Task 3) covers
 * all five failure modes Ashley 2026-08-13 LOCKED as must-pass.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import {
  createSshPollOrchestrator,
  type SshChannel,
  type OrchestratorDeps,
} from "./ssh-poll-orchestrator.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";
import type { SessionState } from "./wire-protocol.js";
import type { HostRecord } from "./host-id-resolver.js";

// ---------------------------------------------------------------------------
// Mock systemLogger
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// MockSshChannel
// ---------------------------------------------------------------------------

/**
 * A deterministic SSH channel for tests. Callers register command → response
 * pairs; exec() returns the matched string or null (simulating SSH error).
 */
class MockSshChannel implements SshChannel {
  private responses = new Map<string, string | null>();
  private callLog: Array<{ command: string; response: string | null }> = [];

  /** Register a substring pattern (matched via includes) → response */
  setResponse(pattern: string, response: string | null): void {
    this.responses.set(pattern, response);
  }

  /** Get all exec call log entries */
  getCalls(): Array<{ command: string; response: string | null }> {
    return [...this.callLog];
  }

  /** Count calls whose command includes the given pattern */
  countCallsMatching(pattern: string): number {
    return this.callLog.filter((c) => c.command.includes(pattern)).length;
  }

  clearCallLog(): void {
    this.callLog = [];
  }

  async exec(command: string): Promise<string | null> {
    let response: string | null = null;
    for (const [pattern, resp] of this.responses.entries()) {
      if (command.includes(pattern)) {
        response = resp;
        break;
      }
    }
    this.callLog.push({ command, response });
    return response;
  }
}

// ---------------------------------------------------------------------------
// MockRegistry
// ---------------------------------------------------------------------------

class MockRegistry implements SubscriptionRegistry {
  publishedStates: Array<{ hostId: string; state: SessionState }> = [];
  publishedGone: Array<{
    hostId: string;
    tmuxSession: string | null;
    sessionId: string;
  }> = [];
  subscribers = new Set<(frame: unknown) => void>();

  subscribe(sendFrame: (frame: unknown) => void): () => void {
    this.subscribers.add(sendFrame);
    return () => this.subscribers.delete(sendFrame);
  }

  publishSessionState(hostId: string, state: SessionState): void {
    this.publishedStates.push({ hostId, state });
  }

  publishSessionGone(
    hostId: string,
    tmuxSession: string | null,
    sessionId: string,
  ): void {
    this.publishedGone.push({ hostId, tmuxSession, sessionId });
  }

  getSnapshot(): SessionState[] {
    return this.publishedStates.map((p) => p.state);
  }

  // Phase 39 — presence-signal stubs to satisfy the extended
  // SubscriptionRegistry interface. Orchestrator tests do not exercise
  // the lifecycle events at this layer; that behavior is covered by
  // subscription-registry.test.ts Tests 8-14.
  onFirstSubscriber(_cb: (ctx: { userId: string }) => void): () => void {
    return () => {};
  }

  onLastUnsubscriber(_cb: () => void): () => void {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Helper: build valid session JSON string
// ---------------------------------------------------------------------------

function makeSessionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 12345,
    sessionId: "test-session-id",
    cwd: "/home/ubuntu",
    startedAt: 1700000000000,
    procStart: "12345",
    version: "2.1.150",
    status: "idle",
    updatedAt: 1700000001000,
    ...overrides,
  });
}

function makeStatContents(starttime = "12345"): string {
  // /proc/<pid>/stat: pid (comm) state ppid pgrp session tty tpgid flags
  //   minflt cminflt majflt cmajflt utime stime cutime cstime priority nice
  //   num_threads itrealvalue starttime ...
  return `12345 (node) S 1 12345 12345 0 -1 4194304 1234 0 0 0 10 5 0 0 20 0 1 0 ${starttime} ...rest`;
}

function makeValidPayload(tasks: unknown[] = []): string {
  return JSON.stringify({
    session_id: "test-session-id",
    transcript_path: "/home/ubuntu/.claude/projects/test/test.jsonl",
    cwd: "/home/ubuntu",
    permission_mode: "default",
    hook_event_name: "Stop",
    stop_hook_active: false,
    background_tasks: tasks,
  });
}

// ---------------------------------------------------------------------------
// Helper: build OrchestratorDeps
// ---------------------------------------------------------------------------

function buildDeps(
  overrides: Partial<OrchestratorDeps> = {},
): OrchestratorDeps & {
  registry: MockRegistry;
  channel: MockSshChannel;
  fakeTimers: {
    tick: (ms: number) => Promise<void>;
    currentTime: () => number;
  };
} {
  const channel = new MockSshChannel();
  const registry = new MockRegistry();
  const hosts: HostRecord[] = [{ id: "host-1", name: "testhost" }];

  // Default channel responses
  channel.setResponse(
    "ls -1",
    "/home/ubuntu/.claude/sessions/12345.json\n",
  );
  channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
  channel.setResponse(
    "cat /proc/12345/stat",
    makeStatContents("12345"),
  );
  channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0TMUX=/tmp/tmux\0");
  channel.setResponse("tmux display-message", "tina");
  channel.setResponse("cat ~/.claude/fleet-status/last-stop-payload.json", makeValidPayload());

  let currentTime = 0;

  const deps: OrchestratorDeps = {
    listIdentityHostingHosts: vi.fn().mockResolvedValue(hosts),
    acquireSshChannel: vi.fn().mockResolvedValue(channel),
    releaseSshChannel: vi.fn(),
    registry,
    setInterval: vi.fn((fn: () => void, ms: number) => {
      // Return a handle; actual invocation is controlled by tick()
      const handle = { fn, ms, id: Math.random() } as unknown as ReturnType<
        typeof setInterval
      >;
      return handle;
    }),
    clearInterval: vi.fn(),
    now: () => currentTime,
    pollIntervalMs: 2000,
    staleSweepIntervalMs: 30000,
    hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
    hookPayloadWarnCooldownMs: 60000,
    ...overrides,
  };

  const fakeTimers = {
    tick: async (ms: number) => {
      currentTime += ms;
      await Promise.resolve();
    },
    currentTime: () => currentTime,
  };

  return {
    ...deps,
    registry,
    channel,
    fakeTimers,
  } as OrchestratorDeps & {
    registry: MockRegistry;
    channel: MockSshChannel;
    fakeTimers: { tick: (ms: number) => Promise<void>; currentTime: () => number };
  };
}

// ---------------------------------------------------------------------------
// Test 1: createSshPollOrchestrator returns object with correct methods
// ---------------------------------------------------------------------------

describe("createSshPollOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1: returns orchestrator with start, stop, getPollTickCount methods; start does not poll until called", () => {
    const deps = buildDeps();
    const orchestrator = createSshPollOrchestrator(deps);

    expect(typeof orchestrator.start).toBe("function");
    expect(typeof orchestrator.stop).toBe("function");
    expect(typeof orchestrator.getPollTickCount).toBe("function");
    expect(orchestrator.getPollTickCount()).toBe(0);
    // No polling has happened yet
    expect(deps.registry.publishedStates).toHaveLength(0);
  });

  it("Test 2: start() queries listIdentityHostingHosts and acquires SSH channels", async () => {
    const deps = buildDeps();
    const orchestrator = createSshPollOrchestrator(deps);

    await orchestrator.start();

    expect(deps.listIdentityHostingHosts).toHaveBeenCalled();
    expect(deps.acquireSshChannel).toHaveBeenCalledWith({ id: "host-1", name: "testhost" });
  });

  it("Test 3: poll cycle executes correct SSH commands", async () => {
    const deps = buildDeps();
    const orchestrator = createSshPollOrchestrator(deps);

    await orchestrator.start();

    // After start(), an immediate first poll fires
    const calls = deps.channel.getCalls();
    const callCommands = calls.map((c) => c.command);

    // Must have listed sessions
    expect(callCommands.some((c) => c.includes("ls -1"))).toBe(true);
    // Must have catted session JSON
    expect(callCommands.some((c) => c.includes("cat ~/.claude/sessions/12345.json"))).toBe(true);
    // Must have catted stat
    expect(callCommands.some((c) => c.includes("cat /proc/12345/stat"))).toBe(true);
    // Must have catted hook payload
    expect(callCommands.some((c) => c.includes("fleet-status/last-stop-payload.json"))).toBe(true);
  });

  it("Test 4: SessionState is published when parsed successfully and not stale", async () => {
    const deps = buildDeps();
    const orchestrator = createSshPollOrchestrator(deps);

    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.hostId).toBe("host-1");
    expect(published.state.pid).toBe(12345);
    expect(published.state.sessionId).toBe("test-session-id");
  });

  it("Test 5: Fail-open — hook payload exec null → backgroundTasks=[] + rate-limited warn", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson({ status: "idle" }));
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    // Hook payload returns null (SSH error / ENOENT)
    channel.setResponse("fleet-status/last-stop-payload.json", null);

    let currentTime = 0;
    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      now: () => currentTime,
      hookPayloadWarnCooldownMs: 60000,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Should have published with backgroundTasks=[]
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.backgroundTasks).toHaveLength(0);

    // Warn should have fired once
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const hookWarnCount = warnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation === "fleet_status_hook_payload_missing",
    ).length;
    expect(hookWarnCount).toBe(1);

    // Advance time by 30s (within cooldown), trigger another poll
    currentTime += 30000;
    (systemLogger.warn as unknown as MockInstance).mockClear();

    // Manually trigger another poll cycle
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await pollFn.fn();
    }

    // Should NOT have fired another warn (within cooldown)
    const newWarnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const newHookWarnCount = newWarnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation === "fleet_status_hook_payload_missing",
    ).length;
    expect(newHookWarnCount).toBe(0);

    // Advance past cooldown (65s from start = 65000ms total, started at 0)
    currentTime = 65000;
    (systemLogger.warn as unknown as MockInstance).mockClear();

    if (pollFn) {
      await pollFn.fn();
    }

    const postCooldownWarnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const postCooldownCount = postCooldownWarnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation === "fleet_status_hook_payload_missing",
    ).length;
    expect(postCooldownCount).toBe(1);
  });

  it("Test 6: Fail-open — orchestrator does NOT throw, does NOT stop polling, does NOT publish session_gone on missing hook", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", null);

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);

    // Must not throw
    await expect(orchestrator.start()).resolves.not.toThrow();

    // States published (session-JSON-derived)
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);

    // No session_gone published
    expect(deps.registry.publishedGone).toHaveLength(0);

    // Run another poll cycle
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await expect(pollFn.fn()).resolves.not.toThrow();
    }
  });

  it("Test 7: 30s stale sweep reaps PIDs that go stale between polls", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Confirm initial publish happened
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);

    // Now simulate: PID 12345 goes stale (stat returns null = ENOENT)
    channel.setResponse("cat /proc/12345/stat", null);

    // Trigger the 30s sweep
    const sweepFn = setIntervalFns.find((f) => f.ms === 30000);
    expect(sweepFn).toBeDefined();
    if (sweepFn) {
      await sweepFn.fn();
    }

    // session_gone should have been published
    expect(deps.registry.publishedGone.length).toBeGreaterThan(0);
    expect(deps.registry.publishedGone[0].hostId).toBe("host-1");
    expect(deps.registry.publishedGone[0].sessionId).toBe("test-session-id");
  });

  it("Test 8: PID→tmux cache — environ read called exactly once across 5 poll cycles for same PID", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Run 4 more poll cycles (start() fires 1 already)
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      for (let i = 0; i < 4; i++) {
        await pollFn.fn();
      }
    }

    // environ should have been read exactly once across 5 cycles
    const environCalls = channel.countCallsMatching("cat /proc/12345/environ");
    expect(environCalls).toBe(1);
  });

  it("Test 9: When PID is reaped, cache is cleared; if same PID reappears, environ is re-read", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const environCallsAfterFirst = channel.countCallsMatching("cat /proc/12345/environ");
    expect(environCallsAfterFirst).toBe(1);

    // Make PID stale
    channel.setResponse("cat /proc/12345/stat", null);
    const sweepFn = setIntervalFns.find((f) => f.ms === 30000);
    if (sweepFn) {
      await sweepFn.fn();
    }

    // PID reaped; reset stat and session to make it "reappear"
    channel.setResponse("cat /proc/12345/stat", makeStatContents("99999")); // new procStart
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ procStart: "99999", sessionId: "new-session-id" }),
    );
    channel.clearCallLog();

    // Trigger poll
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await pollFn.fn();
    }

    // environ should be re-read for the "new" process
    const environCallsAfterReuse = channel.countCallsMatching("cat /proc/12345/environ");
    expect(environCallsAfterReuse).toBe(1);
  });

  it("Test 10: stop() clears both timers, releases SSH channels, publishes nothing after", async () => {
    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const clearIntervalHandles: Array<ReturnType<typeof setInterval>> = [];
    let handleCounter = 0;

    const deps = buildDeps({
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        const handle = ++handleCounter as unknown as ReturnType<typeof setInterval>;
        return handle;
      }),
      clearInterval: vi.fn((h: ReturnType<typeof setInterval>) => {
        clearIntervalHandles.push(h);
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const statesBeforeStop = deps.registry.publishedStates.length;

    orchestrator.stop();

    // clearInterval called for both poll and sweep timers
    expect(clearIntervalHandles.length).toBeGreaterThanOrEqual(2);

    // releaseSshChannel called
    expect(deps.releaseSshChannel).toHaveBeenCalled();

    // No more publishes after stop
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await pollFn.fn();
    }
    // publishedStates count should not have changed
    expect(deps.registry.publishedStates.length).toBe(statesBeforeStop);
  });

  it("Test 11: Structured logging — every poll cycle logs with explicit operation field", async () => {
    const deps = buildDeps();
    const orchestrator = createSshPollOrchestrator(deps);
    (systemLogger.info as unknown as MockInstance).mockClear();

    await orchestrator.start();

    // At least one info log with an operation field
    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    const hasOperationField = infoCalls.some(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        typeof (c[1] as Record<string, unknown>).operation === "string",
    );
    expect(hasOperationField).toBe(true);
  });

  it("Test 12: SSH failure for one host does not stop polling other hosts", async () => {
    const workingChannel = new MockSshChannel();
    workingChannel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    workingChannel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    workingChannel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    workingChannel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    workingChannel.setResponse("tmux display-message", "tina");
    workingChannel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());

    const hosts: HostRecord[] = [
      { id: "host-fail", name: "failhost" },
      { id: "host-ok", name: "okhost" },
    ];

    let acquireCount = 0;
    const acquireSshChannel = vi.fn().mockImplementation(async (host: HostRecord) => {
      acquireCount++;
      if (host.id === "host-fail") {
        return null; // SSH failure
      }
      return workingChannel;
    });

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      listIdentityHostingHosts: vi.fn().mockResolvedValue(hosts),
      acquireSshChannel,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // host-ok should still have published
    const okPublishes = deps.registry.publishedStates.filter(
      (p) => p.hostId === "host-ok",
    );
    expect(okPublishes.length).toBeGreaterThan(0);

    // Warn about unreachable host
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const unreachableWarn = warnCalls.some(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_host_ssh_unreachable",
    );
    expect(unreachableWarn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 3: Fail-open regression tests (Ashley 2026-08-13 LOCKED constraint)
// ---------------------------------------------------------------------------

describe("fail-open on missing hook payload file", () => {
  let setIntervalFns: Array<{ fn: () => void; ms: number }>;
  let currentTime: number;

  beforeEach(() => {
    setIntervalFns = [];
    currentTime = 0;
    vi.clearAllMocks();
  });

  function buildFailOpenDeps(channel: MockSshChannel): OrchestratorDeps & {
    registry: MockRegistry;
  } {
    const registry = new MockRegistry();
    const hosts: HostRecord[] = [{ id: "host-1", name: "testhost" }];

    const deps: OrchestratorDeps = {
      listIdentityHostingHosts: vi.fn().mockResolvedValue(hosts),
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      releaseSshChannel: vi.fn(),
      registry,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn(),
      now: () => currentTime,
      pollIntervalMs: 2000,
      staleSweepIntervalMs: 30000,
      hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
      hookPayloadWarnCooldownMs: 60000,
    };

    return { ...deps, registry };
  }

  function countHookWarn(): number {
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    return warnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation === HOOK_WARN_OP,
    ).length;
  }

  // Operation string under test — used in each scenario assertion (grep-able):
  // fleet_status_hook_payload_missing (F1 ENOENT)
  // fleet_status_hook_payload_missing (F2 empty string)
  // fleet_status_hook_payload_missing (F3 malformed JSON)
  // fleet_status_hook_payload_missing (F4 transient SSH error)
  // fleet_status_hook_payload_missing (F5 schema-invalid)
  // fleet_status_hook_payload_missing (F6 permanently missing)
  const HOOK_WARN_OP = "fleet_status_hook_payload_missing";

  // ---

  it("Test F1 (ENOENT): null exec response → backgroundTasks=[], ONE warn, no throw, no session_gone", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", null);

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);

    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    expect(deps.registry.publishedStates[0].state.backgroundTasks).toHaveLength(0);
    // Ashley 2026-08-13 LOCKED: fleet_status_hook_payload_missing warn fires exactly once (F1: ENOENT)
    expect(countHookWarn()).toBe(1);
    expect(deps.registry.publishedGone).toHaveLength(0);
  });

  it("Test F2 (empty string): empty exec response → same fail-open behaviour as ENOENT", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", "");

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);

    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    expect(deps.registry.publishedStates[0].state.backgroundTasks).toHaveLength(0);
    expect(countHookWarn()).toBe(1);
    expect(deps.registry.publishedGone).toHaveLength(0);
  });

  it("Test F3 (malformed JSON): parseStopHookPayload returns null → fail-open", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("fleet-status/last-stop-payload.json", "{not:valid,json");

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);

    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    expect(deps.registry.publishedStates[0].state.backgroundTasks).toHaveLength(0);
    expect(countHookWarn()).toBe(1);
    expect(deps.registry.publishedGone).toHaveLength(0);
  });

  it("Test F4 (transient SSH read error mid-poll): warn rate-limited, delta semantics correct", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    // First poll: valid payload with 2 tasks
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload([
        { id: "t1", type: "shell", status: "running", description: "work 1" },
        { id: "t2", type: "shell", status: "running", description: "work 2" },
      ]),
    );

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // First publish: 2 tasks
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const firstPublish = deps.registry.publishedStates[deps.registry.publishedStates.length - 1];
    expect(firstPublish.state.backgroundTasks).toHaveLength(2);
    expect(countHookWarn()).toBe(0); // no warn yet

    // Second poll: hook payload null (transient error)
    channel.setResponse("fleet-status/last-stop-payload.json", null);
    (systemLogger.warn as unknown as MockInstance).mockClear();

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // Second publish: backgroundTasks=[] (delta detected → publish)
    const afterNullPublishes = deps.registry.publishedStates.length;
    expect(afterNullPublishes).toBeGreaterThan(1);
    const secondPublish = deps.registry.publishedStates[afterNullPublishes - 1];
    expect(secondPublish.state.backgroundTasks).toHaveLength(0);
    expect(countHookWarn()).toBe(1);

    // Third poll: hook still null, within cooldown → NO new warn, NO new publish (fingerprint same)
    (systemLogger.warn as unknown as MockInstance).mockClear();
    const publishCountBefore3rd = deps.registry.publishedStates.length;
    if (pollFn) {
      await pollFn.fn();
    }
    expect(countHookWarn()).toBe(0); // rate-limited
    expect(deps.registry.publishedStates.length).toBe(publishCountBefore3rd); // no delta

    // Advance past cooldown (61s)
    currentTime = 61000;
    (systemLogger.warn as unknown as MockInstance).mockClear();

    if (pollFn) {
      await pollFn.fn();
    }
    expect(countHookWarn()).toBe(1); // cooldown expired → new warn
  });

  it("Test F5 (schema-valid JSON but wrong shape): treated as missing, fail-open", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    // background_tasks is not an array
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      JSON.stringify({ background_tasks: "not an array" }),
    );

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);

    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    expect(deps.registry.publishedStates[0].state.backgroundTasks).toHaveLength(0);
    expect(countHookWarn()).toBe(1);
    expect(deps.registry.publishedGone).toHaveLength(0);
  });

  it("Test F6 (session-JSON authoritative): status changes still publish correctly even with permanently-missing hook", async () => {
    const channel = new MockSshChannel();
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson({ status: "busy" }));
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    // Hook always missing
    channel.setResponse("fleet-status/last-stop-payload.json", null);

    const deps = buildFailOpenDeps(channel);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(countHookWarn()).toBe(1);
    const initialPublishCount = deps.registry.publishedStates.length;
    expect(initialPublishCount).toBeGreaterThan(0);

    // Transition: busy → idle
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "idle", updatedAt: 1700000002000 }),
    );
    (systemLogger.warn as unknown as MockInstance).mockClear();

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await pollFn.fn();
    }

    const afterIdleCount = deps.registry.publishedStates.length;
    expect(afterIdleCount).toBeGreaterThan(initialPublishCount);

    // Transition: idle → busy
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "busy", updatedAt: 1700000003000 }),
    );

    if (pollFn) {
      await pollFn.fn();
    }

    const afterBusyCount = deps.registry.publishedStates.length;
    expect(afterBusyCount).toBeGreaterThan(afterIdleCount);

    // Total state-change publishes = 2 (idle + busy after initial busy)
    // The warn count should have stayed at 0 (within cooldown), confirming DECOUPLED
    expect(countHookWarn()).toBe(0); // within 60s cooldown
    // 2 state-change transitions (idle and back to busy) = 2 more publishes
    expect(afterBusyCount - initialPublishCount).toBe(2);

    // Advance past cooldown and poll again (same state → no publish, but warn fires)
    currentTime = 65000;
    (systemLogger.warn as unknown as MockInstance).mockClear();

    if (pollFn) {
      await pollFn.fn();
    }

    expect(countHookWarn()).toBe(1); // cooldown expired
    expect(deps.registry.publishedStates.length).toBe(afterBusyCount); // no new state change
  });
});
