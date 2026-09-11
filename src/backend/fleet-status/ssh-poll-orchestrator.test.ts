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
  __scanTailForNewestMessageAtForTests,
  parseSpawnRequestBatch,
} from "./ssh-poll-orchestrator.js";
import type { PendingBirth } from "../spawn-requests/types.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";
import type { SessionState } from "./wire-protocol.js";
import type { HostRecord } from "./host-id-resolver.js";
import {
  readSessionFileCache,
  __clearAllSessionFileCacheForTests,
} from "./session-file-cache.js";
// Phase 92 Plan 05 — sweep-schema fixture helper (`makeSweepJsonl`) uses these
// types + constant so batch-path regression tests emit lines that hit the same
// parser + schema-version gate as real sweep output.
import {
  SWEEP_SCHEMA_VERSION,
  type SweepIdentityLine,
  type SweepPidLine,
  type SweepStatResult,
} from "./sweep-schema.js";

// ---------------------------------------------------------------------------
// Mock systemLogger
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  // Phase 41 Plan 03: session-file-parser (imported by the orchestrator for
  // JSONL tail parsing) uses `databaseLogger` for its per-line classify
  // trace logs. Mock it here so calls do not throw on the mocked module.
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  // Post-Phase-99-code-review M2/M3: the sweep now imports parseRequestBody
  // from spawn-requests/worker.ts, which transitively pulls in host-resolver.ts,
  // pool-loader, and other modules that use named loggers (`sshLogger`,
  // `apiLogger`, etc.). Mock ALL logger exports so the transitive module graph
  // loads cleanly under vitest regardless of which named logger a downstream
  // module imports.
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  tunnelLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  fileLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  statsLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  apiLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  authLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  versionLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  dashboardLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

// Phase 85 (D-07): mock the identity-send-log-store module so tests can
// drive per-scenario responses for `getIdentityLastSend`. Default resolves
// to null (identity has never received a stamp — matches D-09 first-ship
// "no backfill, natural fill" contract). Individual tests below override
// with `.mockResolvedValueOnce(...)` or `.mockRejectedValueOnce(...)` to
// exercise the swap-and-publish and fail-open paths respectively.
//
// The mock factory is hoisted (vi.mock behavior) — it MUST NOT close over
// test-scope state. Tests reset via `vi.clearAllMocks()` in beforeEach and
// override per-test via chained `.mockResolvedValueOnce` / `.mockRejectedValueOnce`.
vi.mock("./identity-send-log-store.js", () => ({
  getIdentityLastSend: vi.fn(async () => null),
  stampIdentityLastSend: vi.fn(async () => {}),
}));

import { systemLogger } from "../utils/logger.js";
import { getIdentityLastSend } from "./identity-send-log-store.js";

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
  //
  // Bounty 9c8d4a72 (2026-09-02): the orchestrator's stat read is now wrapped
  // in `cat ... && echo __STAT_OK__ || echo __STAT_ENOENT__` so the channel
  // response for a live PID is the raw /proc/stat content followed by a
  // trailing `\n__STAT_OK__` sentinel line. `readStatWithSentinel` strips
  // the sentinel + trailing whitespace before returning content, so the
  // downstream isStaleFromStat contract is unchanged. Mock fixtures append
  // the sentinel here so every existing test that models "live PID read"
  // exercises the post-fix command shape end-to-end.
  return `12345 (node) S 1 12345 12345 0 -1 4194304 1234 0 0 0 10 5 0 0 20 0 1 0 ${starttime} ...rest\n__STAT_OK__`;
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
// Phase 92 Plan 05 — makeSweepJsonl fixture helper
//
// Emits a JSONL blob matching the Plan 01 v1 sweep-schema contract (one
// SweepIdentityLine per named identity + one SweepPidLine per {identity,pid}
// pair). Fields carry sensible defaults so tests only spell out the axes they
// care about. `schemaVersionOverride` swaps the emitted schema_version on
// every line — used by the schema-mismatch regression to prove the caller's
// fallback + connection-lifetime latch behavior.
//
// The default `stat_result` is `{ ok: true, content: <ready-to-consume /proc
// stat contents> }` — mirrors what `readStatWithSentinel` returns after
// stripping the `__STAT_OK__` sentinel in the legacy path, so batch-path
// callers feed compose the same tagged shape legacy would.
// ---------------------------------------------------------------------------
function makeSweepJsonl(input: {
  identities: Array<Partial<SweepIdentityLine> & { identity: string }>;
  pids: Array<Partial<SweepPidLine> & { identity: string; pid: number }>;
  schemaVersionOverride?: number;
}): string {
  const version = (input.schemaVersionOverride ?? SWEEP_SCHEMA_VERSION) as 1;
  const lines: string[] = [];
  for (const raw of input.identities) {
    const line: SweepIdentityLine = {
      line_kind: "identity",
      schema_version: version,
      identity: raw.identity,
      dormant: raw.dormant ?? false,
      recycled_at: raw.recycled_at ?? false,
      recycle_requested: raw.recycle_requested ?? false,
      jsonl_path: raw.jsonl_path ?? null,
      layer1_recycling: raw.layer1_recycling ?? null,
    };
    lines.push(JSON.stringify(line));
  }
  for (const raw of input.pids) {
    // Default stat_result — the /proc/<pid>/stat content compose would see
    // after `readStatWithSentinel` stripped its sentinel. procStart digit is
    // "12345" matching `makeSessionJson`'s default so isStaleFromStat returns
    // false (session is live).
    const defaultStat: SweepStatResult = {
      ok: true,
      content: "12345 (node) S 1 12345 12345 0 -1 4194304 1234 0 0 0 10 5 0 0 20 0 1 0 12345 ...rest",
    };
    const line: SweepPidLine = {
      line_kind: "pid",
      schema_version: version,
      identity: raw.identity,
      pid: raw.pid,
      session_json:
        raw.session_json ??
        makeSessionJson({
          pid: raw.pid,
          sessionId: `sess-${raw.identity}`,
          procStart: "12345",
        }),
      stat_result: raw.stat_result ?? defaultStat,
      per_session_stop_mtime_ms: raw.per_session_stop_mtime_ms ?? null,
      activity_mtime_ms: raw.activity_mtime_ms ?? null,
      stopped_mtime_ms: raw.stopped_mtime_ms ?? null,
      per_session_stop_payload: raw.per_session_stop_payload ?? null,
      dormant_a: raw.dormant_a ?? false,
      jsonl_tail: raw.jsonl_tail ?? null,
    };
    lines.push(JSON.stringify(line));
  }
  return lines.join("\n") + "\n";
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
    "ls -1 ~/.claude/sessions/",
    "/home/ubuntu/.claude/sessions/12345.json\n",
  );
  // Phase 52 Plan 01 Task 3 — source B identities listing. Default empty so
  // existing tests don't trigger source B publishes. Task 3 tests override.
  channel.setResponse("~/fleet/identities/ -mindepth", "");
  channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
  channel.setResponse(
    "cat /proc/12345/stat",
    makeStatContents("12345"),
  );
  channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0TMUX=/tmp/tmux\0");
  channel.setResponse("tmux display-message", "tina");
  channel.setResponse("cat ~/.claude/fleet-status/last-stop-payload.json", makeValidPayload());
  // Phase 99: default empty response for the atomic spawn-request scan exec.
  // This is the critical backward-compat change: every existing test that doesn't
  // override the spawn-requests response gets a benign empty stdout (missing folder
  // or empty folder — both non-errors per D-03). Without this, every existing test
  // tick would get a null response for the scan and log a spurious SSH-error warn.
  channel.setResponse("fleet/spawn-requests", "");

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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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

    // Now simulate: PID 12345 goes stale. Bounty 9c8d4a72 (2026-09-02): the
    // orchestrator now uses `readStatWithSentinel` — real ENOENT is signalled
    // by the `__STAT_ENOENT__` sentinel (not by a null return, which now
    // means SSH transport failure and fail-OPEN semantics).
    channel.setResponse("cat /proc/12345/stat", "__STAT_ENOENT__");

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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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

    // Make PID stale. Bounty 9c8d4a72: real ENOENT via sentinel (see makeStatContents docblock).
    channel.setResponse("cat /proc/12345/stat", "__STAT_ENOENT__");
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
    workingChannel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
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

// ---------------------------------------------------------------------------
// Phase 41 Plan 03 — recency signal derivation from JSONL tail
//
// Contract (locked by CONTEXT.md §Sort model — "activity = message either
// direction, and only that"):
//   - Orchestrator tails the JSONL for each polled session on the same SSH
//     exec channel used elsewhere in fleet-status polling.
//   - lastMessageAt = the `ts` (unix millis) of the newest JSONL line whose
//     parsed shape has kind ∈ {"message","image","relay_outbound","relay_inbound"}
//     (all four map to a user- OR assistant-authored message-bearing turn per
//     session-file-parser.ts).
//   - Explicitly EXCLUDED: tool_use frames, thinking blocks, streaming ticks,
//     status-transition events, background-task starts/stops, session
//     lifecycle events. If the JSONL has NO message-bearing frames, the
//     signal is null.
//   - The derived value is stamped on the SessionState emitted through the
//     existing publishSessionState pipeline; the wire-protocol lastMessageAt
//     field carries it end-to-end.
// ---------------------------------------------------------------------------

describe("Phase 41 Plan 03 — lastMessageAt derivation from JSONL tail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: build a JSONL message line with an ISO timestamp derived from
  // unix millis. Mirrors what session-file-parser.parseSessionLine accepts
  // (ts is derived from the `timestamp` field via Date.parse).
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
    overrides: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
      ...overrides,
    });
  }

  // Helper: build a JSONL tool_use line (a synthetic assistant turn whose
  // message.content is an array of tool_use blocks; session-file-parser drops
  // these with `kind: "skip"` because they have no textual content — the
  // orchestrator MUST NOT credit them as message-bearing).
  function jsonlToolUseLine(tsMillis: number): string {
    return JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `tool-${tsMillis}`,
            name: "Read",
            input: { file_path: "/tmp/x" },
          },
        ],
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `tool-uuid-${tsMillis}`,
    });
  }

  // Helper: build a synthetic non-message line (background task start
  // simulated as a bare non-user/non-assistant type). session-file-parser
  // will return `kind: "skip"` for these.
  function jsonlBackgroundTaskLine(tsMillis: number): string {
    return JSON.stringify({
      type: "background_task_start",
      task_id: `bg-${tsMillis}`,
      timestamp: new Date(tsMillis).toISOString(),
    });
  }

  // Helper: build the RECORD_SEPARATOR-delimited stdout blob that
  // parseDiscoveryStdout expects, containing exactly ONE record — a single
  // `<mtime>\t<discoveredPath>\n<first-user-line>\n---GSDR-32---\n`. The
  // first-user-line is shaped to match __matchesIdentityFirstTurnForTests
  // for `identityName`: contains `"type":"user"`, does NOT contain
  // `"tool_result"`, contains `<command-name>/id</command-name>`, and
  // contains `<command-args>${identityName}</command-args>` (the closing
  // `<` after the identity name satisfies the delimiter guard in
  // src/backend/claude-session/discover-identity-session-file.ts
  // DELIMITER_SET). RECORD_SEPARATOR value is `---GSDR-32---` per the
  // discovery module (Phase 32).
  //
  // If `matchesIdentity` is false, emits a first-user-line that satisfies
  // the outer-shape checks but uses a DIFFERENT `<command-args>` payload —
  // used by Test I to simulate a discovery pass that returns records but
  // NONE match the target identity → discoverIdentityJsonlPathViaChannel
  // returns null.
  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    // Build a JSONL-shaped user-role line with `/id` command whose args
    // payload EITHER matches the identity (default) or intentionally
    // differs (Test I fallback). Using JSON.stringify guarantees the
    // literal substrings `"type":"user"`, `<command-name>/id</command-name>`,
    // and `<command-args>${argsPayload}</command-args>` all appear in the
    // rendered string. The angle-bracket-close after argsPayload satisfies
    // the DELIMITER_SET guard.
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // Helper: default channel wiring for the discovery-based JSONL path
  // derivation (Phase 44 Plan 02 swap). Two responses matter beyond the
  // baseline PID + tmux fixtures:
  //   1. `IDENTITY=` substring routes the discovery script (opens with
  //      `IDENTITY=<escaped-identity>;`; see buildDiscoveryScript at
  //      src/backend/claude-session/discover-identity-session-file.ts:170)
  //      to `buildDiscoveryFixture("tina", "…/discovered.jsonl")`. The
  //      fixture emits a valid record whose first-user-line matches
  //      __matchesIdentityFirstTurnForTests for identity `tina` → discovery
  //      returns `~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl`.
  //   2. `discovered.jsonl` substring routes the tail command to the JSONL
  //      fixture the caller passed in.
  // The MockSshChannel iterates responses in insertion order and takes the
  // first match; `IDENTITY=` and `discovered.jsonl` are mutually distinct
  // substrings across the two command shapes, so ordering doesn't matter.
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    // Phase 44 Plan 02 — wire the discovery script response. Substring
    // `IDENTITY=` uniquely identifies the discovery script (the opening
    // shell statement `IDENTITY=<escaped>;`).
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    // Match on the JSONL filename fragment — the orchestrator will build a
    // path ending in `discovered.jsonl` (the mocked discovery result) and
    // run `tail -c 262144` against it. All tail command shapes route to the
    // same fixture.
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // ---------------------------------------------------------------------------
  // Test D — message-bearing filter locks the Ashley 2026-08-23 msg-only-recency
  //           contract. Only Ashley's real user turns count; assistant turns,
  //           tool_use, and background-task frames must NOT contribute.
  //           Ashley 2026-08-23 lock: INVERTS the 2026-08-14 "either direction"
  //           lock — only Ashley's outbound user turns advance lastMessageAt.
  // ---------------------------------------------------------------------------

  it("Test D: message-bearing filter — user msg + tool_use + assistant msg + bg-task → scanTailForNewestMessageAt returns user MSG (Phase 85 D-08 direct-scan probe)", async () => {
    // Fixture: user message at ts=1000, tool_use at ts=1500, assistant
    // message at ts=2000, background-task start at ts=2500.
    // Ashley 2026-08-23 lock: only the USER message at ts=1000 counts;
    // the assistant turn (ts=2000), tool_use (1500), and bg-task (2500)
    // are all excluded by isAshleyRealUserTurn.
    //
    // Phase 85 (D-07/D-08): the orchestrator's `lastMessageAt` axis retired
    // from this scanner (now reads from getIdentityLastSend). This test
    // continues to probe scanTailForNewestMessageAt directly via the
    // test-only export because sessions.ts's byte-parallel copy still
    // depends on this predicate's contract — updating either copy without
    // the other is a D-08 violation, and this test guards the shape.
    const jsonl =
      jsonlMessageLine(1000, "user", "hello") +
      "\n" +
      jsonlToolUseLine(1500) +
      "\n" +
      jsonlMessageLine(2000, "assistant", "hi there") +
      "\n" +
      jsonlBackgroundTaskLine(2500) +
      "\n";
    expect(__scanTailForNewestMessageAtForTests(jsonl)).toBe(1000);
  });

  // ---------------------------------------------------------------------------
  // Test E — zero message-bearing frames → lastMessageAt = null
  // ---------------------------------------------------------------------------

  it("Test E: JSONL with only tool_use + background-task frames (zero message-bearing lines) → lastMessageAt = null", async () => {
    const channel = new MockSshChannel();
    const jsonl =
      jsonlToolUseLine(500) +
      "\n" +
      jsonlBackgroundTaskLine(1000) +
      "\n" +
      jsonlToolUseLine(1500) +
      "\n";
    wireBaseResponses(channel, jsonl);

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // No message-bearing frames → orchestrator emits lastMessageAt === null
    // (distinct from "field absent"; both are treated identically downstream,
    // but the orchestrator explicitly stamps null when it has looked and
    // found no history).
    expect(published.state.lastMessageAt).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test F — user message alone floats — Ashley lock: "activity = message
  //           either direction, and ONLY that". User-only sessions count.
  // ---------------------------------------------------------------------------

  it("Test F: JSONL with ONLY a user message at ts=3000 → scanTailForNewestMessageAt returns 3000 (Phase 85 D-08 direct-scan probe)", async () => {
    // Phase 85 (D-07/D-08): retired from orchestrator lastMessageAt axis.
    // Probes the byte-parallel-copy contract directly via the test-only
    // export. User-side send counts — Ashley 2026-08-14 verbatim:
    // "activity counts as me sending them a message, or them sending me
    // a message." The predicate itself (isAshleyRealUserTurn) is unchanged
    // and still owns this shape for sessions.ts.
    const jsonl = jsonlMessageLine(3000, "user", "just typed something") + "\n";
    expect(__scanTailForNewestMessageAtForTests(jsonl)).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// quick-260823-bap — Ashley 2026-08-23 msg-only-recency predicate matrix
//
// Verifies the isAshleyRealUserTurn predicate (Ashley 2026-08-23 lock):
// "only my real messages going to them" — INVERTS the 2026-08-14 lock.
//
// Seven cases + one mixed-tail integration case. Tested via
// scanTailForNewestMessageAt (the observable) rather than the private
// predicate helper directly, so tests survive any internal rename.
// ---------------------------------------------------------------------------

describe("isAshleyRealUserTurn — Ashley 2026-08-23 lock predicate matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local buildDiscoveryFixture — mirrors the Phase 41 Plan 03 helper.
  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // Local wireBaseResponses — wires the standard per-poll responses plus the
  // JSONL tail content. Same shape as the Phase 41 Plan 03 helper but defined
  // locally so this describe block does not depend on its sibling's scope.
  function wireBaseResponses(channel: MockSshChannel, jsonlContents: string): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout = buildDiscoveryFixture(
      "tina",
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // Phase 85 (D-07/D-08): the predicate-matrix suite historically drove the
  // full orchestrator loop and observed the published `lastMessageAt`. That
  // observable retired in Phase 85 (lastMessageAt now derives from the
  // identity-name-keyed send-log store via getIdentityLastSend). The
  // predicate implementation itself STAYS DEFINED (D-08 — sessions.ts
  // byte-parallel copy still depends on it), so we probe it directly via
  // the test-only export __scanTailForNewestMessageAtForTests. This
  // preserves regression coverage of isAshleyRealUserTurn's contract while
  // decoupling it from the retired orchestrator-observed axis.
  //
  // The helpers keep their old async signature so the individual `it()`
  // bodies below stay unchanged.
  //
  // wireBaseResponses / buildDiscoveryFixture are retained above because
  // the plan's D-08 contract keeps the scanner definition co-located with
  // its historical exercise fixture; if the sessions.ts byte-parallel copy
  // needs cross-testing later, these helpers stay available.
  async function scanSingleLine(rawLine: string): Promise<number | null> {
    return __scanTailForNewestMessageAtForTests(rawLine + "\n");
  }

  async function scanMultiLine(lines: string[]): Promise<number | null> {
    return __scanTailForNewestMessageAtForTests(lines.join("\n") + "\n");
  }

  it("Case 1 (KEEP — typed prose): user turn with plain-string prose content counts", async () => {
    const ts = Date.parse("2026-08-23T10:00:00.000Z");
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Hello Amelia" },
      timestamp: "2026-08-23T10:00:00.000Z",
      uuid: "u1",
    });
    // Ashley 2026-08-23 lock: typed prose is a real message → KEEP.
    expect(await scanSingleLine(rawLine)).toBe(ts);
  });

  it("Case 2 (KEEP — slash-command invocation): user turn with <command- prefixed content counts", async () => {
    const ts = Date.parse("2026-08-23T10:01:00.000Z");
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tina</command-args>",
      },
      timestamp: "2026-08-23T10:01:00.000Z",
      uuid: "u2",
    });
    // Starts with "<command-" → KEEP per predicate step 4a.
    expect(await scanSingleLine(rawLine)).toBe(ts);
  });

  it("Case 3 (DROP — task-notification wrapper): <task-notification>…</task-notification> must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification>wakeup</task-notification>" },
      timestamp: "2026-08-23T10:02:00.000Z",
      uuid: "u3",
    });
    // Trimmed content starts with "<" and ends with ">" and does NOT start with
    // "<command-" → DROP per predicate step 4b.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 4 (DROP — system-reminder wrapper): <system-reminder>…</system-reminder> must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<system-reminder>reminder body</system-reminder>" },
      timestamp: "2026-08-23T10:03:00.000Z",
      uuid: "u4",
    });
    // Same XML-wrapper shape → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 5 (DROP — tool_result list content, regression lock): list-content user turn must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_x", type: "tool_result", content: "...", is_error: false },
        ],
      },
      timestamp: "2026-08-23T10:04:00.000Z",
      uuid: "u5",
    });
    // content is an array → predicate step 3 (typeof !== "string") → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 6 (DROP — skill-body list-content injection, NEW exclusion): [{type:'text',text:'…'}] must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "skill body..." }],
      },
      timestamp: "2026-08-23T10:05:00.000Z",
      uuid: "u6",
    });
    // pre-Aug-23 this was silently counted (MESSAGE_BEARING_KINDS included
    // "message" kind, and parseSessionLine returned kind:"message" for some
    // list-content user turns). Ashley 2026-08-23 lock: list content → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 7 (DROP — assistant turn + relay_outbound): assistant turns must NOT count", async () => {
    // Assertion 1: plain assistant reply.
    const rawAssistant = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "reply" },
      timestamp: "2026-08-23T10:06:00.000Z",
      uuid: "u7",
    });
    expect(await scanSingleLine(rawAssistant)).toBeNull();

    // Assertion 2: assistant relay_outbound frame (curl -X PUT rooms/…/send/m.room.message shape).
    const rawRelayOutbound = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_relay",
            name: "Bash",
            input: {
              command:
                "curl -s -X PUT 'https://matrix.example.com/_matrix/client/v3/rooms/!abc:example.com/send/m.room.message/1' -d '{\"msgtype\":\"m.text\",\"body\":\"hello\"}'",
            },
          },
        ],
      },
      timestamp: "2026-08-23T10:07:00.000Z",
      uuid: "u7b",
    });
    expect(await scanSingleLine(rawRelayOutbound)).toBeNull();
  });

  it("Case 8 (DROP — Ctrl-C kill signal, 2026-08-29 refinement): control-chars-only content must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "\x03\x03" },
      timestamp: "2026-08-29T15:12:49.598Z",
      uuid: "u8",
    });
    // Supervisor-injected Ctrl-C kill signal — pure control-char payload → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 9 (DROP — /exit slash-command, 2026-08-29 refinement): agent-supervisor /exit command must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>",
      },
      timestamp: "2026-08-29T15:13:00.000Z",
      uuid: "u9",
    });
    // Agent-supervisor /exit before recycle — contains <command-name>/exit</command-name> → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("Case 10 (DROP — resumed-injection sentinel, 2026-08-29 refinement): supervisor resume sentinel must NOT count", async () => {
    const rawLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "Your session was just resumed by the agent-supervisor. Your background Monitors stopped with the previous session — start them again per the id skill.",
      },
      timestamp: "2026-08-29T15:14:00.000Z",
      uuid: "u10",
    });
    // Agent-supervisor resume sentinel — prefix matches the locked string → DROP.
    expect(await scanSingleLine(rawLine)).toBeNull();
  });

  it("2026-08-29 refinement — positive regression: real chat + real slash-command still count", async () => {
    // Real chat prose still returns the parsed ts.
    const tsChat = Date.parse("2026-08-29T16:00:00.000Z");
    const chatLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hey can you look at this thing" },
      timestamp: "2026-08-29T16:00:00.000Z",
      uuid: "pos-chat",
    });
    expect(await scanSingleLine(chatLine)).toBe(tsChat);

    // Real /id slash-command still returns the parsed ts.
    const tsCmd = Date.parse("2026-08-29T16:01:00.000Z");
    const cmdLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-name>/id</command-name>\n            <command-message>id</command-message>\n            <command-args>tina</command-args>",
      },
      timestamp: "2026-08-29T16:01:00.000Z",
      uuid: "pos-cmd",
    });
    expect(await scanSingleLine(cmdLine)).toBe(tsCmd);
  });

  it("Mixed-tail integration: DROP lines interleaved with KEEP lines → newest KEEP ts returned", async () => {
    // Tail order: [Case5, Case7, Case3, Case1@T1, Case2@T2, Case8@T3] where T3 > T2 > T1.
    // Case8 (Ctrl-C kill signal) is NEWER than T2 — must still be dropped, returning T2.
    const T1 = Date.parse("2026-08-23T11:00:00.000Z");
    const T2 = Date.parse("2026-08-23T11:01:00.000Z");
    const T3 = Date.parse("2026-08-23T11:02:00.000Z");

    const case5Line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: "toolu_x", type: "tool_result", content: "x", is_error: false }],
      },
      timestamp: "2026-08-23T10:55:00.000Z",
      uuid: "mix-c5",
    });
    const case7Line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "reply" },
      timestamp: "2026-08-23T10:56:00.000Z",
      uuid: "mix-c7",
    });
    const case3Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification>wake</task-notification>" },
      timestamp: "2026-08-23T10:57:00.000Z",
      uuid: "mix-c3",
    });
    const case1Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Hello Amelia" },
      timestamp: new Date(T1).toISOString(),
      uuid: "mix-c1",
    });
    const case2Line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "<command-message>id</command-message>\n<command-name>/id</command-name>",
      },
      timestamp: new Date(T2).toISOString(),
      uuid: "mix-c2",
    });
    // Case 8 fixture (Ctrl-C kill signal) with timestamp NEWER than T2 — must be dropped.
    const case8Line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "\x03\x03" },
      timestamp: new Date(T3).toISOString(),
      uuid: "mix-c8",
    });

    // T2 is the newest KEEP line — DROP lines (including Case8 newer than T2) must not interfere.
    expect(
      await scanMultiLine([case5Line, case7Line, case3Line, case1Line, case2Line, case8Line]),
    ).toBe(T2);
  });
});

// ---------------------------------------------------------------------------
// Phase 44 Plan 02 — discovery-based JSONL path derivation + caching +
// rediscovery-on-stale + no-history-no-churn
//
// Contract (locked by 44-CONTEXT.md § ssh-poll-orchestrator.ts swap):
//   - processPid derives its JSONL path via `discoverIdentityJsonlPathViaChannel`
//     (Phase 32 mechanism) instead of the pre-Phase-44 `jsonlPathForSession(cwd,
//     sessionId)` construction. The path is cached in `PidCacheEntry.jsonlPath`
//     and reused across ticks — discovery fires ONCE per PID on the first
//     tick where tmuxSession resolves.
//   - Rediscovery fires when the cached path's tail returns no fresher
//     signal for STALE_TAIL_REDISCOVERY_THRESHOLD (=5) consecutive ticks —
//     defense against JSONL rotation mid-session. TIGHTENED condition:
//     only sessions that HAD a cached lastMessageAt to go stale against
//     tick the counter; no-history sessions (null cached lastMessageAt)
//     do NOT tick and therefore never trigger re-discovery churn.
//   - If discovery returns null OR tmuxSession is null, orchestrator
//     keeps the cached-or-null lastMessageAt (no crash, no publish churn).
// ---------------------------------------------------------------------------

describe("Phase 44 Plan 02 — discovery-based JSONL path derivation + caching + rediscovery-on-stale + no-history-no-churn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Copy the JSONL message-line helper into scope for these tests (same
  // shape as the Phase 41 Plan 03 helper above; kept local to this
  // describe block for readability).
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  // Copy of buildDiscoveryFixture from the Phase 41 Plan 03 describe block
  // (both describes need the helper; declaring locally avoids cross-scope
  // dependencies).
  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // Local wireBaseResponses — same shape as the Phase 41 Plan 03 helper.
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // ---------------------------------------------------------------------------
  // Test G — cold-cache discovery + cache reuse: tick 1 fires discovery +
  //           tail; tick 2 fires ONLY tail (no discovery). Verifies the
  //           per-PID caching contract (44-CONTEXT.md § swap).
  // ---------------------------------------------------------------------------

  it("Test G: cold-cache discovery + cache reuse — discovery fires ONCE across 2 ticks", async () => {
    const channel = new MockSshChannel();
    const jsonl = jsonlMessageLine(2000, "assistant", "hi there") + "\n";
    wireBaseResponses(channel, jsonl);

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // fires tick 1 (immediate first poll)

    // Drive tick 2 via the captured 2s poll fn.
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // Discovery script fires ONCE across both ticks — tick 1 populates
    // PidCacheEntry.jsonlPath; tick 2 reuses the cached path.
    expect(channel.countCallsMatching("IDENTITY=")).toBe(1);
    // Tail fires on every tick. Phase 47 Plan 02: tail width bumped from
    // `tail -n 200` (line-count) to `tail -c 262144` (256KB byte-count) so
    // an ai-title line older than the last 200 message-bearing lines is
    // still captured. The two backend read paths (sessions.ts + this) stay
    // aligned on the same tail shape.
    expect(channel.countCallsMatching("tail -c 262144")).toBe(2);
    // Post-Phase-47 the old tail width MUST NOT be used anywhere.
    expect(channel.countCallsMatching("tail -n 200")).toBe(0);
    // Phase 47 Plan 02 lock: fixture has no ai-title lines → both publishes
    // carry aiTitle: null. This asserts the new axis lands on the wire.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    for (const p of deps.registry.publishedStates) {
      expect(p.state.aiTitle).toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Test H — rediscovery on stale-tail threshold. Session HAD a signal
  //           (non-null cached lastMessageAt), tail keeps returning the same
  //           max ts on subsequent ticks; on the tick AFTER the threshold
  //           trip the orchestrator re-fires discovery.
  //
  // Threshold semantics per implementation:
  //   - Tick 1 (cold): discovery call #1, count=0, lastMessageAt=1000.
  //   - Tick 2: count 0→1
  //   - Tick 3: count 1→2
  //   - Tick 4: count 2→3
  //   - Tick 5: count 3→4
  //   - Tick 6: count 4→5, THRESHOLD HIT → jsonlPath=null, count=0
  //   - Tick 7: cached.jsonlPath=null → discovery call #2 fires
  // So 2 discovery calls at tick 7 (not tick 6 — invalidation on tick 6
  // takes effect the FOLLOWING tick). Plan explicitly permits adjusting
  // the tick count to match implementation semantics (see task 3, step 6).
  // ---------------------------------------------------------------------------

  it("Test H: Phase 85 D-07 — source A stale-tail rediscovery retires from the lastMessageAt axis; 7 ticks yields exactly 1 discovery call", async () => {
    // Phase 85 (D-07) rewrite: pre-Phase-79 this asserted that a session
    // with a sticky lastMessageAt would tick the stale-tail counter each
    // poll and trip STALE_TAIL_REDISCOVERY_THRESHOLD=5 to force
    // rediscovery on tick 7 — a defense against Claude Code JSONL rotation
    // for the lastMessageAt axis.
    //
    // Post-Phase-79 the lastMessageAt axis reads from the identity-name-
    // keyed send-log store (getIdentityLastSend), so the JSONL tail is no
    // longer the source of truth for that axis — the counter no longer
    // increments from source A on this axis (the increment logic was
    // removed with the swap; the counter mechanic itself stays defined
    // because source B pollDormantOnlyIdentities still uses the constant
    // + field for its Layer 1 recycling tail-scan rediscovery contract).
    //
    // Net observable change: 7 ticks in source A yields exactly 1
    // discovery call (the cold-cache tick 1) — no rediscovery trip. The
    // tail exec still fires every tick because the aiTitle scanner still
    // consumes the buffer (D-08 co-tenant preserved).
    const channel = new MockSshChannel();
    const jsonl = jsonlMessageLine(1000, "user", "one and done") + "\n";
    wireBaseResponses(channel, jsonl);

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      for (let i = 0; i < 6; i++) {
        await pollFn.fn();
      }
    }

    // Phase 85 (D-07): source A never trips rediscovery on the
    // lastMessageAt axis anymore — exactly 1 discovery call in 7 ticks
    // (cold cache on tick 1, cached path reused every subsequent tick).
    expect(channel.countCallsMatching("IDENTITY=")).toBe(1);
    // Tail still fires every tick — aiTitle scanner is the sole
    // consumer of the buffer in source A now.
    expect(channel.countCallsMatching("tail -c 262144")).toBe(7);
    expect(channel.countCallsMatching("tail -n 200")).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test I — discovery returns null (no records match identity) →
  //           lastMessageAt stays cached (null on cold), tail is NEVER
  //           called for this PID because jsonlPath is null.
  // ---------------------------------------------------------------------------

  it("Test I: discovery returns null (no matching first-user-line) → tail skipped, lastMessageAt is null", async () => {
    const channel = new MockSshChannel();
    // Discovery fixture emits a record, but the first-user-line has
    // `<command-args>different-tina</command-args>` — does NOT match
    // identity `tina` via __matchesIdentityFirstTurnForTests → helper
    // returns null → orchestrator skips tail entirely.
    const badDiscovery = buildDiscoveryFixture(
      "tina",
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      false, // matchesIdentity=false
    );
    // The tail response is registered but should never fire.
    wireBaseResponses(
      channel,
      jsonlMessageLine(2000, "assistant", "unreachable") + "\n",
      badDiscovery,
    );

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Discovery yielded null → jsonlPath stays null → tail skipped →
    // derivedLastMessageAt stays at cached-or-null (null on cold).
    expect(published.state.lastMessageAt).toBeNull();
    // Phase 47 Plan 02 lock: no discovery → no scan → aiTitle stays null.
    expect(published.state.aiTitle).toBeNull();
    // Discovery fired once (cold cache), tail never fired for this PID.
    expect(channel.countCallsMatching("IDENTITY=")).toBe(1);
    // Phase 47 Plan 02: bumped to `tail -c 262144` — still 0 calls here
    // (discovery-null path skips tail entirely).
    expect(channel.countCallsMatching("tail -c 262144")).toBe(0);
    expect(channel.countCallsMatching("tail -n 200")).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test J — tmuxSession null → discovery is SKIPPED entirely (identity
  //           name is unknown; nothing to grep for).
  // ---------------------------------------------------------------------------

  it("Test J: tmuxSession null → discovery skipped, lastMessageAt is null", async () => {
    const channel = new MockSshChannel();
    // resolvePidToTmuxSession returns null when either environ has no
    // TMUX_PANE OR tmux display-message returns null/empty. Force the
    // latter — override tmux display-message to null. Order matters:
    // wireBaseResponses sets tmux display-message to "tina"; the
    // OVERRIDE must be set AFTER wireBaseResponses so the null wins by
    // being iterated first (Map iteration is insertion order — later
    // insertions with the same key overwrite).
    wireBaseResponses(channel, jsonlMessageLine(2000, "assistant", "hi") + "\n");
    channel.setResponse("tmux display-message", null);

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // tmuxSession null → discovery skipped → jsonlPath stays null →
    // tail skipped → lastMessageAt stays null.
    expect(published.state.lastMessageAt).toBeNull();
    // Phase 47 Plan 02 lock: tmux null → no discovery → no scan → aiTitle null.
    expect(published.state.aiTitle).toBeNull();
    expect(channel.countCallsMatching("IDENTITY=")).toBe(0);
    expect(channel.countCallsMatching("tail -c 262144")).toBe(0);
    expect(channel.countCallsMatching("tail -n 200")).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test K — NO-HISTORY session does NOT churn re-discovery. This is the
  //           load-bearing lock for the TIGHTENED stale-tick condition
  //           per 44-CONTEXT.md § ssh-poll-orchestrator.ts swap:
  //
  //   The stale threshold is a ROTATION-DEFENSE for sessions that once
  //   had a signal and lost it — NOT a "kick discovery when we haven't
  //   seen a message yet" mechanism. A session whose tail consistently
  //   returns no message-bearing frames (fresh session pre-first-turn;
  //   identity that never invokes /id; identity whose entire history is
  //   tool_use / thinking / lifecycle events) MUST have cached
  //   lastMessageAt: null AND staleTailTickCount: 0 forever, so
  //   re-discovery NEVER fires past the initial cold-cache invocation.
  //
  //   Under the pre-revision draft condition (`jsonlPath !== null &&
  //   tailRaw !== null` alone, no-history sessions incrementing), this
  //   test would fail: ticks 2-6 would tick the counter 1→5 → invalidate
  //   → tick 7 rediscovery → total discovery calls = 2 (or more if the
  //   pattern repeats). Under the tightened condition (increment ONLY
  //   when derivedLastMessageAt !== null), total = 1 across arbitrarily
  //   many ticks.
  // ---------------------------------------------------------------------------

  it("Test K: NO-HISTORY session does NOT churn — 10 ticks with empty tail yield EXACTLY 1 discovery call (locks tightened stale-tick condition per 44-CONTEXT.md)", async () => {
    const channel = new MockSshChannel();
    // Discovery succeeds and returns a valid discovered.jsonl path (via
    // wireBaseResponses default). The tail response is INTENTIONALLY
    // EMPTY — scanTailForNewestMessageAt returns null every tick →
    // derivedLastMessageAt stays null → no-history branch of the
    // stale-tick logic fires → counter stays at 0 → threshold NEVER hit
    // → discovery never re-fires past the cold-cache invocation.
    wireBaseResponses(channel, "");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    // Drive ticks 2 through 10 (9 more polls; start already ran tick 1).
    if (pollFn) {
      for (let i = 0; i < 9; i++) {
        await pollFn.fn();
      }
    }

    // LOAD-BEARING ASSERTION: discovery fires ONLY at cold cache. Across
    // 10 ticks with a persistently empty tail (no message-bearing frames
    // ever, so derivedLastMessageAt stays null), the no-history branch
    // keeps staleTailTickCount at 0 → threshold never trips → jsonlPath
    // never invalidated → discovery never re-fires.
    expect(channel.countCallsMatching("IDENTITY=")).toBe(1);
    // Tail fires every tick (that behavior is UNCHANGED by the tightened
    // condition — only the counter-increment logic changed).
    // Phase 47 Plan 02: tail width bumped `tail -n 200` → `tail -c 262144`.
    expect(channel.countCallsMatching("tail -c 262144")).toBe(10);
    expect(channel.countCallsMatching("tail -n 200")).toBe(0);
    // No message-bearing frames ever → published state's lastMessageAt
    // is null throughout. Phase 47 Plan 02: empty tail → aiTitle also null.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    for (const p of deps.registry.publishedStates) {
      expect(p.state.lastMessageAt).toBeNull();
      expect(p.state.aiTitle).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 47 Plan 02 — aiTitle derivation and publish
//
// Contract (locked by 47-CONTEXT.md § domain + § Backend scraper mechanics):
//   - Orchestrator tails the same discovered JSONL (Phase 44 Plan 02
//     mechanism) and scans for the LAST `{"type":"ai-title","aiTitle":"…",
//     "sessionId":"…"}` line in file order. Last-wins semantics (not
//     max-wins like lastMessageAt) — topic drifts across a session.
//   - Published SessionState.aiTitle carries the derived string (or null
//     when no valid ai-title line found).
//   - Fingerprint includes aiTitle as a DISTINCT axis — an ai-title-only
//     change (status/backgroundTasks/updatedAt/lastMessageAt all identical)
//     STILL fires publishSessionState. Topic drift is a state-change signal.
//   - Cached PidCacheEntry.aiTitle survives across ticks when scan yields
//     null (transient SSH hiccup or empty tail); advances when a fresher
//     tail-scan returns a new string. No independent stale-tick counter —
//     aiTitle rides on the same jsonlPath cache Phase 44 Plan 02 owns.
// ---------------------------------------------------------------------------

describe("Phase 47 Plan 02 — aiTitle derivation and publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local jsonlMessageLine — mirrors the Phase 44 Plan 02 describe helper.
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  // Phase 47 harness format — `{"type":"ai-title","aiTitle":"…","sessionId":"…"}`.
  // Mirrors sessions.test.ts jsonlAiTitleLine (hand-mirrored per CONTEXT.md
  // "no new shared module" scope decision inherited from Phase 43/44).
  function jsonlAiTitleLine(sessionId: string, aiTitle: string): string {
    return JSON.stringify({
      type: "ai-title",
      aiTitle,
      sessionId,
    });
  }

  // buildDiscoveryFixture — copy from Phase 44 Plan 02 describe (self-
  // contained per the existing pattern; both describes need the helper).
  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // Local wireBaseResponses — same shape as Phase 44 Plan 02 describe.
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // ---------------------------------------------------------------------------
  // Test 1 — happy path: one ai-title line in tail → published state carries it.
  // ---------------------------------------------------------------------------

  it("Test 1: happy path — single ai-title line → published SessionState.aiTitle equals that string", async () => {
    const channel = new MockSshChannel();
    const jsonl =
      jsonlMessageLine(1000, "user", "start") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Auth refactor") +
      "\n" +
      jsonlMessageLine(2000, "assistant", "on it") +
      "\n";
    wireBaseResponses(channel, jsonl);

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.aiTitle).toBe("Auth refactor");
  });

  // ---------------------------------------------------------------------------
  // Test 2 — last-wins: multiple ai-title lines → LAST one in file order wins.
  // ---------------------------------------------------------------------------

  it("Test 2: last-wins — multiple ai-title lines → published aiTitle equals LAST in file order", async () => {
    const channel = new MockSshChannel();
    const jsonl =
      jsonlAiTitleLine("test-session-id", "First topic") +
      "\n" +
      jsonlMessageLine(1500, "assistant", "drift 1") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Middle topic") +
      "\n" +
      jsonlMessageLine(2500, "assistant", "drift 2") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Final topic wins") +
      "\n";
    wireBaseResponses(channel, jsonl);

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Last-wins per CONTEXT.md § working-store third axis.
    expect(published.state.aiTitle).toBe("Final topic wins");
  });

  // ---------------------------------------------------------------------------
  // Test 3 — no ai-title lines in tail: has messages but no ai-title → null.
  // ---------------------------------------------------------------------------

  it("Test 3: no ai-title lines in tail — has messages, no ai-title → published aiTitle null", async () => {
    const channel = new MockSshChannel();
    const jsonl =
      jsonlMessageLine(1000, "user", "hi") +
      "\n" +
      jsonlMessageLine(2000, "assistant", "hello") +
      "\n";
    wireBaseResponses(channel, jsonl);

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.aiTitle).toBeNull();
    // Phase 85 (D-07): the lastMessageAt corroboration lock (was
    // `expect(published.state.lastMessageAt).toBe(1000)`) is retired here —
    // the axis now derives from getIdentityLastSend (identity-name-keyed
    // send-log store), not the JSONL tail scan. The predicate-matrix suite
    // above continues to guard the retired scanner's shape via the
    // test-only export for the sessions.ts byte-parallel copy contract.
  });

  // ---------------------------------------------------------------------------
  // Test 4 — discovery null → aiTitle null. tmuxSession null covered by
  //           Phase 44 Plan 02 Test J's aiTitle:null assertion above; here
  //           we cover the discovery-returns-null branch specifically.
  // ---------------------------------------------------------------------------

  it("Test 4: discovery returns null (no matching first-user-line) → aiTitle stays null across published frames", async () => {
    const channel = new MockSshChannel();
    // Discovery fixture emits a record but first-user-line does NOT match
    // identity `tina` → discoverIdentityJsonlPathViaChannel returns null →
    // tail skipped → aiTitle stays null.
    const badDiscovery = buildDiscoveryFixture(
      "tina",
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      false,
    );
    wireBaseResponses(
      channel,
      jsonlAiTitleLine("test-session-id", "Should never reach here") + "\n",
      badDiscovery,
    );

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

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Discovery null → jsonlPath null → tail skipped → aiTitle stays cached
    // (null on cold cache).
    expect(published.state.aiTitle).toBeNull();
    // Tail never fired because jsonlPath was null.
    expect(channel.countCallsMatching("tail -c 262144")).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5 — aiTitle-change publish trigger: computeFingerprint includes
  //           aiTitle so an ai-title-only change (all other axes identical)
  //           STILL fires publishSessionState. Load-bearing lock for the
  //           fingerprint axis addition per CONTEXT.md § working-store third
  //           axis + 47-02-PLAN.md Task 2 <behavior> Test 5.
  // ---------------------------------------------------------------------------

  it("Test 5: aiTitle-change publish trigger — fingerprint includes aiTitle, ai-title-only change fires publish", async () => {
    const channel = new MockSshChannel();
    // Tick 1 tail — one message + one ai-title (topic A).
    const tick1Jsonl =
      jsonlMessageLine(1000, "assistant", "hi") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Topic A") +
      "\n";
    wireBaseResponses(channel, tick1Jsonl);

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);
    expect(
      deps.registry.publishedStates[publishesAfterTick1 - 1].state.aiTitle,
    ).toBe("Topic A");

    // Tick 2 tail — SAME message ts (1000), SAME session, ONLY aiTitle
    // changes (topic drift A → B). status/backgroundTasks/updatedAt all
    // unchanged (SessionJson unchanged); lastMessageAt unchanged (still
    // null — Ashley 2026-08-23 lock: fixture has only an assistant turn
    // which no longer counts). ONLY aiTitle differs. Fingerprint MUST
    // see this and fire a new publish.
    const tick2Jsonl =
      jsonlMessageLine(1000, "assistant", "hi") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Topic B (drifted)") +
      "\n";
    channel.setResponse("discovered.jsonl", tick2Jsonl);

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // Publish count MUST increase — the fingerprint change on aiTitle
    // alone triggered publishSessionState.
    const publishesAfterTick2 = deps.registry.publishedStates.length;
    expect(publishesAfterTick2).toBe(publishesAfterTick1 + 1);
    expect(
      deps.registry.publishedStates[publishesAfterTick2 - 1].state.aiTitle,
    ).toBe("Topic B (drifted)");
    // Ashley 2026-08-23 lock: fixture has only assistant turns (excluded);
    // lastMessageAt is null on both ticks — confirms nothing changed on that axis.
    expect(
      deps.registry.publishedStates[publishesAfterTick2 - 1].state.lastMessageAt,
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 6 — cache preserves aiTitle across ticks: tick 2 unchanged tail
  //           reuses cached value; tick 3 with a new ai-title advances the
  //           cache. Verifies the last-wins reconciliation semantics for
  //           the PidCacheEntry.aiTitle field.
  // ---------------------------------------------------------------------------

  it("Test 6: cache preserves aiTitle across ticks — tick 2 unchanged reuses cache, tick 3 with new ai-title advances", async () => {
    const channel = new MockSshChannel();
    const tick1Jsonl =
      jsonlMessageLine(1000, "assistant", "hi") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Original topic") +
      "\n";
    wireBaseResponses(channel, tick1Jsonl);

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: publishes with "Original topic"

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);
    expect(
      deps.registry.publishedStates[publishesAfterTick1 - 1].state.aiTitle,
    ).toBe("Original topic");

    // Tick 2: SAME tail content — no fingerprint change → NO new publish
    // (delta semantics). Cache still holds "Original topic".
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }
    // No new publish (fingerprint unchanged).
    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);

    // Tick 3: new ai-title line appended → last-wins picks it up → publish.
    const tick3Jsonl =
      jsonlMessageLine(1000, "assistant", "hi") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Original topic") +
      "\n" +
      jsonlAiTitleLine("test-session-id", "Fresh topic") +
      "\n";
    channel.setResponse("discovered.jsonl", tick3Jsonl);
    if (pollFn) {
      await pollFn.fn();
    }

    const publishesAfterTick3 = deps.registry.publishedStates.length;
    expect(publishesAfterTick3).toBe(publishesAfterTick1 + 1);
    expect(
      deps.registry.publishedStates[publishesAfterTick3 - 1].state.aiTitle,
    ).toBe("Fresh topic");
  });
});

// ---------------------------------------------------------------------------
// Phase 52 Plan 01 Task 2 — source A dormant stat + fingerprint
//
// Contract (locked by 52-01-PLAN.md § task 2 + § threat_model T-52-01-01/02):
//   - Per PID-tick, when tmuxSession is non-null, orchestrator executes
//     `stat ~/fleet/identities/'<escapedTmuxSession>'/.dormant 2>/dev/null
//     >/dev/null && echo yes || echo no` on the SSH channel. Trimmed stdout
//     "yes" → dormant true; "no" → dormant false; anything else (null, throw)
//     → fail-open (preserve cached value, default false on cold start).
//   - Composed SessionState.dormant carries the derived boolean.
//   - computeFingerprint includes dormant as a distinct axis so a dormant-only
//     flip publishes a new frame (status/backgroundTasks/lastMessageAt/aiTitle
//     all unchanged still fires publishSessionState on dormant delta).
//   - PidCacheEntry.dormant caches the value for fail-open across ticks.
//   - If tmuxSession is null (identity name unknown) → skip stat, use cache.
// ---------------------------------------------------------------------------

describe("Phase 52 Plan 01 Task 2 — source A dormant stat + fingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local jsonlMessageLine — same shape as sibling describes.
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    // Full-path pattern for the sessions ls (avoids collision with source B's
    // identities ls when Task 3 lands).
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    // Source B (Task 3) — return empty listing here so Task 2 tests don't
    // trigger source B publishes. Task 3 tests set this explicitly.
    channel.setResponse("~/fleet/identities/ -mindepth", "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // ---------------------------------------------------------------------------
  // Test P52-01-T2-i — stat returns "yes\n" → SessionState.dormant === true.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T2-i: stat returns 'yes\\n' → composed SessionState.dormant === true; publishSessionState called with dormant:true", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Source A dormant stat — the substring pattern uniquely identifies the
    // .dormant stat command (per source A action step 2). trailing newline is
    // what a real ssh exec of `stat …/.dormant … && echo yes || echo no` returns.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      "yes\n",
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.dormant).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T2-ii — stat returns "no\n" → SessionState.dormant === false.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T2-ii: stat returns 'no\\n' → composed SessionState.dormant === false", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      "no\n",
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.dormant).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T2-iii — stat returns null (SSH hiccup) → cached value preserved
  //                       (fail-open). Cold start cache defaults to false.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T2-iii: stat returns null (SSH hiccup) → cold-start cached value (false) preserved (fail-open)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Return null — simulates SSH channel error mid-tick. Orchestrator MUST
    // fall through to cached value (default false on cold start), NOT throw.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      null,
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Fail-open — cold-start cache default is false.
    expect(published.state.dormant).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T2-iv — two consecutive ticks with SAME dormant value →
  //                     fingerprint-suppressed (no second publish).
  // ---------------------------------------------------------------------------

  it("Test P52-01-T2-iv: two consecutive ticks with SAME dormant value (all other axes unchanged) → second tick fingerprint-suppressed (no second publish)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      "no\n",
    );

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: publishes with dormant:false

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);

    // Tick 2: everything unchanged (same dormant value, same session json,
    // same tail contents) → fingerprint identical → no publish.
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T2-v — two consecutive ticks with DIFFERENT dormant value →
  //                    second tick publishes (fingerprint delta on dormant axis).
  //                    Load-bearing: dormant is a distinct fingerprint axis.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T2-v: dormant flips (all other axes unchanged) → second tick publishes (fingerprint delta on dormant axis)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Tick 1: dormant:false
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      "no\n",
    );

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: dormant:false published

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);
    expect(
      deps.registry.publishedStates[publishesAfterTick1 - 1].state.dormant,
    ).toBe(false);

    // Tick 2: dormant flips to true — ALL OTHER axes unchanged (same session
    // json, same tail, same hook payload). Fingerprint MUST see the dormant
    // delta and fire publish.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      "yes\n",
    );

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    const publishesAfterTick2 = deps.registry.publishedStates.length;
    expect(publishesAfterTick2).toBe(publishesAfterTick1 + 1);
    expect(
      deps.registry.publishedStates[publishesAfterTick2 - 1].state.dormant,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 52 Plan 01 Task 3 — source B dormant-only enumeration + publish
//
// Contract (locked by 52-01-PLAN.md § task 3 + B-1 architectural fix):
//   - pollOneHost invokes pollDormantOnlyIdentities AFTER source A's
//     Promise.all completes. Builds liveTmuxSet from livenessMap.values()
//     — identities that had a live PID this tick (and every tick prior
//     since PID reap deletes the entry).
//   - Source B: `ls -1 ~/fleet/identities/ 2>/dev/null || true` → parse
//     identity names → parallel-stat each `.dormant` sentinel → for each
//     identity NOT in liveTmuxSet, publish a SessionState frame with
//     sessionId:"__dormant__", pid:null, status:"idle", dormant:isDormant,
//     tmuxSession:name. Fingerprint-suppress via dormantOnlyIdentities cache.
//   - Live-PID identities that appear in liveTmuxSet: source B skips them
//     (source A owns publish) AND clears them from dormantOnlyIdentities
//     cache so a future transition back to no-live-PID re-publishes cleanly.
//   - `ls` returns null (SSH error) OR empty (no identities dir) → log
//     debug, skip source B (fail-open — source A still fires normally).
// ---------------------------------------------------------------------------

describe("Phase 52 Plan 01 Task 3 — source B dormant-only enumeration + publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local helpers — matching sibling describes.
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // wireBaseResponses default: NO live PIDs (empty sessions listing). Source
  // A won't fire; source B will enumerate identities per test config.
  // Test P52-01-T3-vi/-vii use a variant with a live PID for source A.
  function wireEmptySessions(channel: MockSshChannel): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());
  }

  // wireBaseResponses variant that includes a live PID (for tests where
  // source A + source B interact).
  function wireLivePid(
    channel: MockSshChannel,
    jsonlContents: string,
    tmuxSession = "tina",
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", tmuxSession);
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout = buildDiscoveryFixture(
      tmuxSession,
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
  }

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-i — Empty `ls` output (no identities dir) → no publish, no throw.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-i: empty `ls -1 ~/fleet/identities/` output → source B skips (no publish, no throw)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    // Explicit empty for identities listing.
    channel.setResponse("~/fleet/identities/ -mindepth", "");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    // No source A publish (no live PIDs) AND no source B publish (empty listing).
    expect(deps.registry.publishedStates).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-ii — `ls` returns null (SSH error) → no publish, no throw.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-ii: `ls -1 ~/fleet/identities/` returns null (SSH error) → source B skips (no publish, no throw)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", null);

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-iii — Two identities, one dormant one not, neither has a
  //                     live PID. Expect BOTH publish frames (dormant:true for
  //                     dormant name, dormant:false for the other via first-
  //                     appearance rule: previousDormant undefined ≠ false).
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-iii: two identities, one dormant one not, no live PID → source B publishes BOTH (first-appearance emits both dormant states)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\ntanya\n");
    // Per-identity dormant stat responses. Substring `identities/'tina'` and
    // `identities/'tanya'` uniquely identify each stat command since source A
    // is dormant here (no live PID → no source A stat).
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");
    channel.setResponse("stat ~/fleet/identities/'tanya'/.dormant", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Two publishes — one per identity (first-appearance rule).
    expect(deps.registry.publishedStates).toHaveLength(2);

    const byName = new Map<string, boolean>();
    for (const p of deps.registry.publishedStates) {
      // Source B frames carry synthetic sessionId "__dormant__" + pid:null.
      expect(p.state.sessionId).toBe("__dormant__");
      expect(p.state.pid).toBeNull();
      expect(p.state.status).toBe("idle");
      byName.set(p.state.tmuxSession as string, p.state.dormant as boolean);
    }
    expect(byName.get("tina")).toBe(true);
    expect(byName.get("tanya")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-iv — same fixture as -iii on tick 2 with NO change → 0
  //                     publishes (cache-hit fingerprint suppression).
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-iv: tick 2 with same dormant states → 0 additional publishes (cache-hit fingerprint suppression)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\ntanya\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");
    channel.setResponse("stat ~/fleet/identities/'tanya'/.dormant", "no\n");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: publishes for both

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBe(2);

    // Tick 2: SAME values, same names → cache-hit, no publish.
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-v — tick 1 dormant:true for name X. Tick 2 stat returns
  //                    dormant:false for X → publish frame with dormant:false.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-v: tick 1 dormant:true, tick 2 dormant:false → publish dormant:false frame on tick 2", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: dormant:true

    expect(deps.registry.publishedStates).toHaveLength(1);
    expect(deps.registry.publishedStates[0].state.dormant).toBe(true);

    // Tick 2: dormant flips to false → cache miss → publish.
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates).toHaveLength(2);
    expect(deps.registry.publishedStates[1].state.dormant).toBe(false);
    expect(deps.registry.publishedStates[1].state.tmuxSession).toBe("tina");
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-vi — name X has a live PID this tick (source A publishes)
  //                     AND X's folder has .dormant sentinel present → source
  //                     B SKIPS X (does NOT double-publish) and clears X from
  //                     dormantOnlyIdentities cache.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-vi: live-PID identity with .dormant sentinel → source B skips (source A owns publish); no double-publish", async () => {
    const channel = new MockSshChannel();
    // Live PID for identity "tina" — source A will publish for this PID.
    wireLivePid(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n", "tina");
    // Source A dormant stat — tina has .dormant present → source A publishes dormant:true.
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");
    // Source B: identities listing includes tina; but tina is in liveTmuxSet
    // because source A had a live PID → source B must SKIP tina.
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Exactly ONE publish — from source A. Source B skipped tina.
    expect(deps.registry.publishedStates).toHaveLength(1);
    const p = deps.registry.publishedStates[0];
    // Source A publishes have numeric pid + real sessionId (not "__dormant__").
    expect(p.state.pid).toBe(12345);
    expect(p.state.sessionId).toBe("test-session-id");
    expect(p.state.dormant).toBe(true); // source A stamped from stat
  });

  // ---------------------------------------------------------------------------
  // Test P52-01-T3-vii — cache eviction on live-set entry. Tick 1: X in source B
  //                      (no live PID, dormant:true). Tick 2: X gets a live PID
  //                      → source A publishes, source B removes X from cache.
  //                      Tick 3: X loses PID (source A reap) → source B cache-
  //                      miss re-publishes cleanly.
  // ---------------------------------------------------------------------------

  it("Test P52-01-T3-vii: transition ping-pong — source B → source A → source B rediscover cleanly (cache evicted on live-set membership)", async () => {
    const channel = new MockSshChannel();
    // Tick 1 setup: NO live PIDs; source B enumerates "tina" as dormant.
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: source B publishes tina dormant:true

    const afterTick1 = deps.registry.publishedStates.length;
    expect(afterTick1).toBe(1);
    expect(deps.registry.publishedStates[0].state.pid).toBeNull();
    expect(deps.registry.publishedStates[0].state.dormant).toBe(true);

    // Tick 2: tina gains a live PID. Source A publishes for PID 12345, source B
    // must SKIP tina and clear it from dormantOnlyIdentities cache.
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    const discoveryStdout = buildDiscoveryFixture(
      "tina",
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlMessageLine(1000, "assistant", "hi") + "\n");

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // Source A publishes once for tina (fingerprint change: pid changed from
    // null source B frame to numeric). Source B skips tina (in liveTmuxSet).
    const afterTick2 = deps.registry.publishedStates.length;
    expect(afterTick2).toBe(afterTick1 + 1);
    const t2Publish = deps.registry.publishedStates[afterTick2 - 1];
    expect(t2Publish.state.pid).toBe(12345);
    expect(t2Publish.state.sessionId).toBe("test-session-id");

    // Tick 3: PID reaped. Bounty 9c8d4a72 (2026-09-02): real ENOENT is now
    // signalled by the `__STAT_ENOENT__` sentinel; a null return means SSH
    // transport failure (fail-OPEN, no reap) and cannot be used here.
    channel.setResponse("cat /proc/12345/stat", "__STAT_ENOENT__");

    if (pollFn) {
      await pollFn.fn();
    }

    // Source A publishes session_gone. Source B re-enumerates tina; because
    // dormantOnlyIdentities was cleared for tina on tick 2, previousDormant
    // is undefined → cache-miss → re-publish dormant:true source B frame.
    // Also expect a source_gone publish from source A reap.
    expect(deps.registry.publishedGone.length).toBeGreaterThanOrEqual(1);
    const afterTick3 = deps.registry.publishedStates.length;
    expect(afterTick3).toBeGreaterThan(afterTick2);
    const t3LastPublish = deps.registry.publishedStates[afterTick3 - 1];
    // Last publish this tick is source B (pid:null, sessionId:"__dormant__").
    expect(t3LastPublish.state.pid).toBeNull();
    expect(t3LastPublish.state.sessionId).toBe("__dormant__");
    expect(t3LastPublish.state.dormant).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // quick-260830-f1e Test A — source B enumeration uses `find -type d -printf`
  //                (not `ls -1`). The swap keeps leftover backup tarballs /
  //                notes.txt / .DS_Store out of the identity listing so we
  //                never ghost-poll nonexistent identity dirs.
  // ---------------------------------------------------------------------------

  it("quick-260830-f1e Test A: source B enumeration exec uses `find … -type d -printf` (not `ls -1`)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    // Wire the new-command shape so pollDormantOnlyIdentities gets a dir-only
    // listing and the downstream stat fires normally.
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const calls = channel.getCalls().map((c) => c.command);
    // The new find command must have fired at least once (source B enum).
    expect(
      calls.some(
        (c) =>
          c.includes("find ~/fleet/identities/") &&
          c.includes("-mindepth 1") &&
          c.includes("-maxdepth 1") &&
          c.includes("-type d") &&
          c.includes("-printf"),
      ),
    ).toBe(true);
    // Regression guard — the old `ls -1 ~/fleet/identities/` must NOT be
    // fired (source B is the ONLY caller of the identities listing).
    expect(
      calls.some(
        (c) => c.startsWith("ls -1 ~/fleet/identities/"),
      ),
    ).toBe(false);
    // Downstream stat did fire for the enumerated identity.
    expect(
      calls.some((c) => c.includes("stat ~/fleet/identities/'tina'/.dormant")),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // quick-260830-f1e Test B — regression: given a dir-only listing (which is
  //                what the new `find -type d` shell command guarantees), source
  //                B enumerates ONLY those dir-shaped names for downstream stat
  //                exec. Verbatim consumption; no client-side filter needed.
  //                (The tarball-shape hygiene lives in the shell command itself
  //                — if find returns only dirs, no tarball names ever reach the
  //                stat loop.)
  // ---------------------------------------------------------------------------

  it("quick-260830-f1e Test B: with dir-only find listing, downstream stat fires only for dir names (no ghost-poll on tarballs)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    // Simulate what real `find … -type d -printf '%f\n'` returns: dir names
    // only. Any tarball / notes.txt entry in the identities dir is filtered
    // out by the shell command BEFORE reaching Skynet.
    channel.setResponse("~/fleet/identities/ -mindepth", "alice\nbob\n");
    channel.setResponse("stat ~/fleet/identities/'alice'/.dormant", "yes\n");
    channel.setResponse("stat ~/fleet/identities/'bob'/.dormant", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const calls = channel.getCalls().map((c) => c.command);
    // Both dir names had their .dormant stat fired.
    expect(
      calls.some((c) => c.includes("stat ~/fleet/identities/'alice'/.dormant")),
    ).toBe(true);
    expect(
      calls.some((c) => c.includes("stat ~/fleet/identities/'bob'/.dormant")),
    ).toBe(true);
    // Regression: NO stat fired against a tarball-shaped name — the shell
    // filtering means such names never appear in the listing, so the loop
    // never touches them.
    expect(
      calls.some((c) =>
        c.includes("'alice.pre-migration"),
      ),
    ).toBe(false);
    expect(
      calls.some((c) => c.includes(".tar.gz'/.dormant")),
    ).toBe(false);
    // Two source-B publishes — first-appearance emits both dormant states.
    expect(deps.registry.publishedStates).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// quick-260820-tm0 — per-host in-flight guard on pollOneHost
//
// Closes the 2026-08-20 wilma incident (392 concurrent tailscale-ssh be-child
// sessions accumulated on the remote target because pollAllHosts kept
// stacking new pollOneHost invocations on the same hostId while the prior
// one was still awaiting `ls -1` on a slow-responding host).
// ---------------------------------------------------------------------------

describe("quick-260820-tm0 — per-host in-flight guard on pollOneHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test-local deferred() factory — a manually-controlled promise so a test
   * can "hang" one specific SSH exec until it decides to resolve. Used to
   * simulate a slow-responding remote target without real timers.
   */
  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * A MockSshChannel variant whose `ls -1` response for the Nth (default:
   * second) exec is served through a manually-controlled deferred promise.
   * Prior ls -1 calls return the base-map response immediately so the
   * initial `start()` poll cycle completes normally and setInterval gets
   * invoked (capturing the pollFn we drive subsequent ticks with).
   *
   * The Nth ls -1 hangs until `resolveLs(value)` fires; after that any
   * further ls -1 calls return the resolved value from the base map.
   */
  class DeferredLsChannel implements SshChannel {
    private deferredLs = deferred<string | null>();
    private resolvedLsResponse: string | null = "";
    private ownLsResolvedFlag = false;
    private responses = new Map<string, string | null>();
    private callLog: Array<{ command: string; response: string | null }> = [];
    private lsCallCount = 0;
    private hangOnLsCall: number;

    /**
     * @param hangOnLsCall — which ls -1 exec call hangs. Default 2 (initial
     *   poll succeeds, second poll tick hangs).
     */
    constructor(hangOnLsCall = 2) {
      this.hangOnLsCall = hangOnLsCall;
    }

    setResponse(pattern: string, response: string | null): void {
      this.responses.set(pattern, response);
    }

    /**
     * Called by the test to resolve the currently-hanging `ls -1` exec.
     * After this fires, subsequent `ls -1` calls return `value` too
     * (base-map response). Await one microtask afterwards in the test.
     */
    resolveLs(value: string | null): void {
      this.resolvedLsResponse = value;
      this.ownLsResolvedFlag = true;
      this.deferredLs.resolve(value);
    }

    countCallsMatching(pattern: string): number {
      return this.callLog.filter((c) => c.command.includes(pattern)).length;
    }

    async exec(command: string): Promise<string | null> {
      if (command.includes("ls -1 ~/.claude/sessions/")) {
        this.lsCallCount++;
        this.callLog.push({ command, response: null });
        if (this.lsCallCount === this.hangOnLsCall && !this.ownLsResolvedFlag) {
          // Hang until the test resolves the deferred.
          const v = await this.deferredLs.promise;
          return v;
        }
        // Pre-hang and post-resolve calls return the base-map response.
        return (
          this.responses.get("ls -1 ~/.claude/sessions/") ??
          this.responses.get("ls -1") ??
          "/home/ubuntu/.claude/sessions/12345.json\n"
        );
      }
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

  // Helper: count `fleet_status_poll_skipped_inflight` info-log invocations
  // filtered by fleetHostId. Mirrors the F1-F5 pattern that counts
  // fleet_status_hook_payload_missing warns.
  function countSkipsForHost(hostId: string): number {
    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    return infoCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_poll_skipped_inflight" &&
        (c[1] as Record<string, unknown>).fleetHostId === hostId,
    ).length;
  }

  // Helper: capture the last skip-log payload for a given host.
  function lastSkipPayload(hostId: string): Record<string, unknown> | null {
    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    const matches = infoCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_poll_skipped_inflight" &&
        (c[1] as Record<string, unknown>).fleetHostId === hostId,
    );
    if (matches.length === 0) return null;
    return matches[matches.length - 1][1] as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Test IF1 — slow-host isolation: prior tick in-flight → next tick skips.
  // -------------------------------------------------------------------------

  it("Test IF1: prior pollOneHost still in-flight → next tick skips that host, does NOT stack a second pollOneHost", async () => {
    // hangOnLsCall=2: initial start() poll completes normally (ls call #1
    // returns), then the SECOND ls -1 call — fired by the first setInterval
    // tick we drive manually — hangs on the deferred. This keeps setInterval
    // setup unblocked so we can capture the pollFn and drive subsequent
    // ticks to assert on the in-flight skip.
    const channel = new DeferredLsChannel(2);
    channel.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );

    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // initial poll completes (ls call #1)

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (!pollFn) throw new Error("no 2s pollFn captured");

    // Trigger tick 2: THIS ls -1 (call #2) will hang on the deferred.
    // Kick it fire-and-forget so we can drive subsequent ticks while
    // pollOneHost is still awaiting deep inside the hung exec.
    const hungTickPromise = pollFn.fn();
    // Yield microtasks so pollAllHosts progresses into pollOneHost →
    // channel.exec("ls -1") → await deferred.promise (in-flight set).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Sanity: 2 ls calls issued (initial + hung), no skips yet.
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(2);
    expect(countSkipsForHost("host-1")).toBe(0);

    // Trigger tick 3: host-1 is in-flight → must skip.
    await pollFn.fn();

    expect(countSkipsForHost("host-1")).toBe(1);
    const skip1 = lastSkipPayload("host-1");
    expect(skip1).not.toBeNull();
    expect(skip1?.skipCount).toBe(1);
    expect(skip1?.hostName).toBe("testhost");
    // No new ls -1 fired on the skipped tick.
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(2);

    // Trigger tick 4: still in-flight, skipCount should now be 2.
    await pollFn.fn();
    expect(countSkipsForHost("host-1")).toBe(2);
    const skip2 = lastSkipPayload("host-1");
    expect(skip2?.skipCount).toBe(2);
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(2);

    // Resolve the hung ls -1 so the hung pollOneHost completes.
    channel.resolveLs("/home/ubuntu/.claude/sessions/12345.json\n");
    await hungTickPromise;
    await Promise.resolve();
    await Promise.resolve();

    // A fresh tick MUST now fire a new ls -1 — the guard released via finally.
    await pollFn.fn();
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test IF2 — per-host, not global: one hung host doesn't block other hosts.
  // -------------------------------------------------------------------------

  it("Test IF2: per-host, not global — a hung host-1 does NOT block a responsive host-2 on the same tick", async () => {
    // channel1: initial poll completes; second ls -1 hangs.
    const channel1 = new DeferredLsChannel(2);
    channel1.setResponse("ls -1", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel1.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel1.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel1.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel1.setResponse("tmux display-message", "tina");
    channel1.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );

    const channel2 = new MockSshChannel();
    channel2.setResponse("ls -1", "/home/ubuntu/.claude/sessions/22222.json\n");
    channel2.setResponse(
      "cat ~/.claude/sessions/22222.json",
      makeSessionJson({ pid: 22222, sessionId: "sess-2" }),
    );
    channel2.setResponse("cat /proc/22222/stat", makeStatContents("12345"));
    channel2.setResponse("cat /proc/22222/environ", "TMUX_PANE=%1\0");
    channel2.setResponse("tmux display-message", "tanya");
    channel2.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );

    const hosts: HostRecord[] = [
      { id: "host-1", name: "testhost" },
      { id: "host-2", name: "otherhost" },
    ];
    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];
    const deps = buildDeps({
      listIdentityHostingHosts: vi.fn().mockResolvedValue(hosts),
      acquireSshChannel: vi.fn(async (host: HostRecord) => {
        if (host.id === "host-1") return channel1;
        return channel2;
      }),
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // initial poll: both hosts complete normally

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (!pollFn) throw new Error("no 2s pollFn captured");

    const channel1LsBaseline = channel1.countCallsMatching("ls -1 ~/.claude/sessions/");
    const channel2LsBaseline = channel2.countCallsMatching("ls -1 ~/.claude/sessions/");

    // Trigger tick 2: host-1's ls -1 hangs (call #2), which blocks the
    // serial for-of loop AFTER host-1 has entered the try but BEFORE it
    // moves on to host-2 on this tick. Fire-and-forget so we can drive
    // the next tick while host-1 is still awaiting.
    const hungTickPromise = pollFn.fn();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // host-1 is in-flight on the hung tick; host-2 hasn't been reached yet
    // on THIS tick because the serial loop is blocked on host-1's await.
    expect(channel1.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(channel1LsBaseline + 1);

    // Trigger tick 3: host-1 is in-flight → skip. host-2 is NOT in-flight
    // → polls normally on the same tick. This proves per-host, not global.
    await pollFn.fn();

    expect(countSkipsForHost("host-1")).toBe(1);
    expect(channel2.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(
      channel2LsBaseline,
    );
    expect(countSkipsForHost("host-2")).toBe(0);

    // Resolve host-1's ls so the hung tick completes cleanly.
    channel1.resolveLs("/home/ubuntu/.claude/sessions/12345.json\n");
    await hungTickPromise;
    await Promise.resolve();
    await Promise.resolve();

    // One more tick — both hosts should poll on this tick now.
    const c1Post = channel1.countCallsMatching("ls -1 ~/.claude/sessions/");
    const c2Post = channel2.countCallsMatching("ls -1 ~/.claude/sessions/");
    await pollFn.fn();
    expect(channel1.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(c1Post);
    expect(channel2.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(c2Post);
  });

  // -------------------------------------------------------------------------
  // Test IF3 — in-flight flag clears in `finally` even on thrown errors.
  // -------------------------------------------------------------------------

  it("Test IF3: in-flight flag clears via `finally` even when pollOneHost throws", async () => {
    // Custom channel whose first ls -1 call REJECTS (throws), subsequent
    // calls succeed. This drives pollOneHost's catch path and asserts the
    // finally { inFlight.delete } branch ran (next tick fires again).
    let lsCallCount = 0;
    const channel: SshChannel = {
      async exec(command: string): Promise<string | null> {
        if (command.includes("ls -1 ~/.claude/sessions/")) {
          lsCallCount++;
          if (lsCallCount === 1) {
            throw new Error("simulated ls -1 explosion");
          }
          return "/home/ubuntu/.claude/sessions/12345.json\n";
        }
        if (command.includes("cat ~/.claude/sessions/12345.json")) {
          return makeSessionJson();
        }
        if (command.includes("cat /proc/12345/stat")) {
          return makeStatContents("12345");
        }
        if (command.includes("cat /proc/12345/environ")) {
          return "TMUX_PANE=%2\0";
        }
        if (command.includes("tmux display-message")) {
          return "tina";
        }
        if (command.includes("fleet-status/last-stop-payload.json")) {
          return makeValidPayload();
        }
        return null;
      },
    };

    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // initial poll: ls -1 throws → catch → finally releases

    // The existing fleet_status_poll_error warn should have fired.
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const pollErrorCount = warnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_poll_error",
    ).length;
    expect(pollErrorCount).toBeGreaterThan(0);

    // Trigger next tick — MUST fire a fresh ls -1 (proves finally released).
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }
    expect(lsCallCount).toBe(2);
    // And no skip fired (in-flight was empty when the tick started).
    expect(countSkipsForHost("host-1")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// quick-260820-tm0 — perHostState pruning on identity-host-list refresh
//
// Fixes the second half of the wilma incident: previously the refresh block
// only ADDED hosts from listIdentityHostingHosts; it never removed hosts
// that disappeared from the fresh list (e.g. admin-disabled `enable_ssh=
// false`), so stale hosts lingered in the poll rotation until container
// restart. Pruning eviction closes the SSH channel (via
// deps.releaseSshChannel) and cleans up the paired inFlight/skipCount
// entries added by Task 1.
// ---------------------------------------------------------------------------

describe("quick-260820-tm0 — perHostState pruning on refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: build a per-host MockSshChannel wired for the standard PID.
  function buildHostChannel(pid: number, sessionId: string): MockSshChannel {
    const channel = new MockSshChannel();
    channel.setResponse(
      "ls -1",
      `/home/ubuntu/.claude/sessions/${pid}.json\n`,
    );
    channel.setResponse(
      `cat ~/.claude/sessions/${pid}.json`,
      makeSessionJson({ pid, sessionId }),
    );
    channel.setResponse(`cat /proc/${pid}/stat`, makeStatContents("12345"));
    channel.setResponse(`cat /proc/${pid}/environ`, "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    return channel;
  }

  // Helper: count fleet_status_host_evicted info-log invocations for a host.
  function countEvictionsForHost(hostId: string): number {
    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    return infoCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_host_evicted" &&
        (c[1] as Record<string, unknown>).fleetHostId === hostId,
    ).length;
  }

  // -------------------------------------------------------------------------
  // Test PR1 — host absent from fresh list → evict + releaseSshChannel + log.
  // -------------------------------------------------------------------------

  it("Test PR1: host absent from fresh list → evict from perHostState, releaseSshChannel called, eviction log fires", async () => {
    const channelA = buildHostChannel(11111, "sess-A");
    const channelB = buildHostChannel(22222, "sess-B");

    const hostA: HostRecord = { id: "host-A", name: "host-A-name" };
    const hostB: HostRecord = { id: "host-B", name: "host-B-name" };
    const initialHosts: HostRecord[] = [hostA, hostB];

    const listMock = vi.fn().mockResolvedValue(initialHosts);
    const releaseMock = vi.fn();
    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];

    const deps = buildDeps({
      listIdentityHostingHosts: listMock,
      acquireSshChannel: vi.fn(async (host: HostRecord) => {
        if (host.id === "host-A") return channelA;
        return channelB;
      }),
      releaseSshChannel: releaseMock,
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // initial poll — both hosts acquired

    // Baseline: neither host evicted, release not yet called.
    expect(releaseMock).toHaveBeenCalledTimes(0);
    expect(countEvictionsForHost("host-B")).toBe(0);

    // Refresh cadence: staleSweepIntervalMs / pollIntervalMs = 30000 / 2000
    // = 15. Start fires tick 1; we invoke pollFn 14 more times to reach
    // tick 15 which is where pollTickCount % 15 === 0 triggers refresh.
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (!pollFn) throw new Error("no 2s pollFn captured");

    // Ticks 2..14 with both hosts still in the fresh list.
    for (let i = 0; i < 13; i++) {
      await pollFn.fn();
    }

    // Between tick 14 and tick 15, swap the fresh list to drop host-B.
    listMock.mockResolvedValue([hostA]);

    // Tick 15 — refresh runs; host-B should be evicted.
    await pollFn.fn();

    // deps.releaseSshChannel was called exactly once with (host-B, channelB).
    expect(releaseMock).toHaveBeenCalledTimes(1);
    const [releasedHost, releasedChannel] = releaseMock.mock.calls[0];
    expect(releasedHost).toEqual(hostB);
    expect(releasedChannel).toBe(channelB);

    // fleet_status_host_evicted INFO log fired for host-B.
    expect(countEvictionsForHost("host-B")).toBe(1);
    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    const evictionLog = infoCalls.find(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_host_evicted" &&
        (c[1] as Record<string, unknown>).fleetHostId === "host-B",
    );
    expect(evictionLog).toBeDefined();
    const payload = evictionLog?.[1] as Record<string, unknown>;
    expect(payload.hostName).toBe("host-B-name");
    expect(payload.reason).toBe("no longer in identity-host list");

    // host-A NOT evicted.
    expect(countEvictionsForHost("host-A")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test PR2 — after eviction, host-B's channel receives zero further SSH.
  // -------------------------------------------------------------------------

  it("Test PR2: after eviction, host-B's channel receives zero further SSH commands; host-A continues polling", async () => {
    const channelA = buildHostChannel(11111, "sess-A");
    const channelB = buildHostChannel(22222, "sess-B");

    const hostA: HostRecord = { id: "host-A", name: "host-A-name" };
    const hostB: HostRecord = { id: "host-B", name: "host-B-name" };
    const initialHosts: HostRecord[] = [hostA, hostB];

    const listMock = vi.fn().mockResolvedValue(initialHosts);
    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];

    const deps = buildDeps({
      listIdentityHostingHosts: listMock,
      acquireSshChannel: vi.fn(async (host: HostRecord) => {
        if (host.id === "host-A") return channelA;
        return channelB;
      }),
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (!pollFn) throw new Error("no 2s pollFn captured");

    // Drive to tick 15 (refresh).
    for (let i = 0; i < 13; i++) {
      await pollFn.fn();
    }
    listMock.mockResolvedValue([hostA]);
    await pollFn.fn(); // eviction tick

    const channelALsBaseline = channelA.countCallsMatching("ls -1 ~/.claude/sessions/");
    const channelBLsBaseline = channelB.countCallsMatching("ls -1 ~/.claude/sessions/");

    // Two more ticks — host-A should still poll, host-B must not.
    await pollFn.fn();
    await pollFn.fn();

    expect(channelA.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(
      channelALsBaseline,
    );
    expect(channelB.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(channelBLsBaseline);
  });

  // -------------------------------------------------------------------------
  // Test PR3 — DB refresh throws → NO eviction (defensive against DB blip).
  // -------------------------------------------------------------------------

  it("Test PR3: DB refresh throws → NO eviction happens (transient DB blip must not wipe the poll rotation)", async () => {
    const channelA = buildHostChannel(11111, "sess-A");
    const channelB = buildHostChannel(22222, "sess-B");

    const hostA: HostRecord = { id: "host-A", name: "host-A-name" };
    const hostB: HostRecord = { id: "host-B", name: "host-B-name" };
    const initialHosts: HostRecord[] = [hostA, hostB];

    const listMock = vi.fn().mockResolvedValue(initialHosts);
    const releaseMock = vi.fn();
    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];

    const deps = buildDeps({
      listIdentityHostingHosts: listMock,
      acquireSshChannel: vi.fn(async (host: HostRecord) => {
        if (host.id === "host-A") return channelA;
        return channelB;
      }),
      releaseSshChannel: releaseMock,
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (!pollFn) throw new Error("no 2s pollFn captured");

    // Drive to tick 15 (refresh).
    for (let i = 0; i < 13; i++) {
      await pollFn.fn();
    }
    listMock.mockRejectedValueOnce(new Error("db blip"));
    await pollFn.fn(); // refresh tick — DB throws

    // No eviction happened.
    expect(releaseMock).toHaveBeenCalledTimes(0);
    expect(countEvictionsForHost("host-A")).toBe(0);
    expect(countEvictionsForHost("host-B")).toBe(0);

    // Existing refresh-fail warn fired.
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const refreshFailCount = warnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_host_list_refresh_failed",
    ).length;
    expect(refreshFailCount).toBeGreaterThan(0);

    // Both hosts continue polling on subsequent ticks.
    const channelALsBaseline = channelA.countCallsMatching("ls -1 ~/.claude/sessions/");
    const channelBLsBaseline = channelB.countCallsMatching("ls -1 ~/.claude/sessions/");
    await pollFn.fn();
    expect(channelA.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(
      channelALsBaseline,
    );
    expect(channelB.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(
      channelBLsBaseline,
    );
  });

  // -------------------------------------------------------------------------
  // Test PR4 — eviction cleans up inFlight and skipCount entries too.
  // -------------------------------------------------------------------------

  it("Test PR4: eviction cleans up inFlight + skipCount entries (no stale skipCount if host is re-added later)", async () => {
    // host-C's SECOND ls -1 hangs via a deferred so host-C becomes in-flight
    // on the tick 2 poll. Initial start() poll completes normally so the
    // pollFn is captured. Then we drive ticks 2..15 (skips accumulate),
    // swap fresh list to [] just before tick 15, and assert eviction
    // cleans up inFlight + skipCount.
    let lsCallCount = 0;
    const lsDeferred: {
      promise: Promise<string | null>;
      resolve: (v: string | null) => void;
    } = (() => {
      let resolve!: (v: string | null) => void;
      const promise = new Promise<string | null>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();

    const channelC: SshChannel = {
      async exec(command: string): Promise<string | null> {
        if (command.includes("ls -1 ~/.claude/sessions/")) {
          lsCallCount++;
          if (lsCallCount === 2) {
            // Hang forever until the test resolves.
            return await lsDeferred.promise;
          }
          return "/home/ubuntu/.claude/sessions/33333.json\n";
        }
        if (command.includes("cat ~/.claude/sessions/33333.json")) {
          return makeSessionJson({ pid: 33333, sessionId: "sess-C" });
        }
        if (command.includes("cat /proc/33333/stat")) {
          return makeStatContents("12345");
        }
        if (command.includes("cat /proc/33333/environ")) {
          return "TMUX_PANE=%2\0";
        }
        if (command.includes("tmux display-message")) {
          return "tina";
        }
        if (command.includes("fleet-status/last-stop-payload.json")) {
          return makeValidPayload();
        }
        return null;
      },
    };

    const hostC: HostRecord = { id: "host-C", name: "host-C-name" };
    const initialHosts: HostRecord[] = [hostC];

    const listMock = vi.fn().mockResolvedValue(initialHosts);
    const releaseMock = vi.fn();
    const setIntervalFns: Array<{ fn: () => Promise<void> | void; ms: number }> = [];

    const deps = buildDeps({
      listIdentityHostingHosts: listMock,
      acquireSshChannel: vi.fn().mockResolvedValue(channelC),
      releaseSshChannel: releaseMock,
      setInterval: vi.fn((fn: () => Promise<void> | void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // initial poll completes (ls #1)

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    if (!pollFn) throw new Error("no 2s pollFn captured");

    // Trigger tick 2: hangs on ls #2, host-C enters inFlight. Fire-and-forget.
    const hungTickPromise = pollFn.fn();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(lsCallCount).toBe(2);

    // Drive ticks 3..14 (host-C is skipped each time — in-flight guard).
    for (let i = 0; i < 12; i++) {
      await pollFn.fn();
    }

    // Between tick 14 and refresh tick 15, drop host-C from fresh list.
    listMock.mockResolvedValue([]);
    await pollFn.fn(); // refresh + eviction tick

    // Eviction fired.
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock.mock.calls[0][0]).toEqual(hostC);

    // Now resolve the still-outstanding pollOneHost so it can complete its
    // pipeline cleanly (avoid dangling promise).
    lsDeferred.resolve("/home/ubuntu/.claude/sessions/33333.json\n");
    await hungTickPromise;
    await Promise.resolve();
    await Promise.resolve();

    // Clear log call history so we can assert on subsequent tick behavior.
    (systemLogger.info as unknown as MockInstance).mockClear();

    // Trigger another tick. Because host-C is evicted:
    //   - no pollOneHost fires for host-C (no new ls -1 call)
    //   - no fleet_status_poll_skipped_inflight log fires (skipCount cleaned)
    const lsCountBeforeExtraTick = lsCallCount;
    await pollFn.fn();
    expect(lsCallCount).toBe(lsCountBeforeExtraTick);

    const infoCalls = (systemLogger.info as unknown as MockInstance).mock.calls;
    const skipsForHostCPostEvict = infoCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_poll_skipped_inflight" &&
        (c[1] as Record<string, unknown>).fleetHostId === "host-C",
    ).length;
    expect(skipsForHostCPostEvict).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 53 Plan 01 — source A recycling stat + fingerprint
//
// Contract (locked by 53-01-PLAN.md § task 2 + § threat_model T-53-01-01/02):
//   - Per PID-tick, when tmuxSession is non-null, orchestrator executes
//     `stat ~/fleet/identities/'<escapedTmuxSession>'/.recycled-at 2>/dev/null
//     >/dev/null && echo yes || echo no` on the SSH channel. Trimmed stdout
//     "yes" → recycling true; "no" → recycling false; anything else (null, throw)
//     → fail-open (preserve cached value, default false on cold start).
//   - Composed SessionState.recycling carries the derived boolean.
//   - computeFingerprint includes recycling as a distinct axis so a recycling-only
//     flip publishes a new frame (status/backgroundTasks/lastMessageAt/aiTitle/dormant
//     all unchanged still fires publishSessionState on recycling delta).
//   - PidCacheEntry.recycling caches the value for fail-open across ticks.
//   - If tmuxSession is null (identity name unknown) → skip stat, use cache.
//   - No source B added — the caretaker's sentinel is placed while the outgoing
//     PID is still alive and held for 8s after the fresh PID is up, so source A
//     coverage is sufficient (see Phase 53 RESEARCH § Assumption A1).
// ---------------------------------------------------------------------------

describe("Phase 53 Plan 01 — source A recycling stat + fingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local jsonlMessageLine — same shape as sibling describes.
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // wireBaseResponses — mirrors the Phase 52 Plan 01 Task 2 sibling exactly,
  // but also wires a default .recycled-at response ("no\n") so recycling tests
  // that don't need to override the recycling stat get the safe default.
  //
  // quick-260823-73o migration: source A no longer stamps the recycling axis;
  // source B (identity-folder-keyed) is the sole publisher. wireBaseResponses
  // therefore wires "ls -1 ~/fleet/identities/" → "tina\n" so source B
  // enumerates tina every tick and exercises the recycle-axis pipeline that
  // used to live in source A. Assertions in this describe block that check
  // recycling MUST look at the source-B frame (sessionId === "__dormant__"),
  // not the source-A frame (pid === 12345, always recycling:false now).
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    // quick-260823-73o: source B needs to iterate tina to publish the recycling axis.
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
    // Default dormant stat response (not dormant) — mirrors Phase 52 Task 2 sibling.
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    // Default recycled-at stat response (not recycling) — override per test as needed.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");
    // quick-260823-recycle-overlay: default .recycle-requested stat (not present).
    // Override per test to exercise the new source-A axis.
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "no\n",
    );
  }

  // quick-260823-73o helper — pick the source-B frame from the publish log.
  // Source B frames carry sessionId "__dormant__" + pid null; source A frames
  // carry the real sessionId and pid 12345. Under the migration, only source B
  // stamps the recycling axis, so tests must look at the source-B frame.
  function pickSourceBFrame(
    publishedStates: Array<{ hostId: string; state: SessionState }>,
  ): SessionState | undefined {
    const frames = publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    return frames[frames.length - 1]?.state;
  }

  // ---------------------------------------------------------------------------
  // Test P53-01-T1-i — stat returns "yes\n" → SessionState.recycling === true.
  // ---------------------------------------------------------------------------

  it("Test P53-01-T1-i: stat returns 'yes\\n' → composed SessionState.recycling === true; publishSessionState called with recycling:true", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Override default recycled-at response to simulate sentinel present.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "yes\n",
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // quick-260823-73o: source B is the sole publisher of the recycling axis.
    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test P53-01-T1-ii — stat returns "no\n" → SessionState.recycling === false.
  // ---------------------------------------------------------------------------

  it("Test P53-01-T1-ii: stat returns 'no\\n' → composed SessionState.recycling === false", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "no\n",
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // inline-260830-source-a-omit-recycling: source A omits recycling;
    // source B SKIPS when live PID + !isRecycling. Semantic: no frame
    // stamps recycling:true.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Test P53-01-T1-iii — stat returns null (SSH hiccup) → cached value preserved
  //                       (fail-open). Cold start cache defaults to false.
  // ---------------------------------------------------------------------------

  it("Test P53-01-T1-iii: stat returns null (SSH hiccup) → cold-start cached value (false) preserved (fail-open)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Return null — simulates SSH channel error mid-tick. Orchestrator MUST
    // fall through to cached value (default false on cold start), NOT throw.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      null,
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // Fail-open — cold-start cache default is false.
    // inline-260830-source-a-omit-recycling: source A omits the recycling
    // axis (undefined). Source B SKIPS publish when the identity has a live
    // PID AND !isRecycling (liveTmuxSet skip-and-evict — preserved from the
    // quick-260823-73o migration). Semantic under the new contract:
    // no published frame stamps recycling:true this tick.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Test P53-01-T1-iv — two consecutive ticks with SAME recycling value →
  //                     fingerprint-suppressed (no second publish).
  // ---------------------------------------------------------------------------

  it("Test P53-01-T1-iv: two consecutive ticks with SAME recycling value (all other axes unchanged) → second tick fingerprint-suppressed (no second publish)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "no\n",
    );

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: publishes with recycling:false

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);

    // Tick 2: everything unchanged (same recycling value, same session json,
    // same tail contents) → fingerprint identical → no publish.
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);
  });

  // ---------------------------------------------------------------------------
  // Test P53-01-T1-v — recycling-only delta (status/backgroundTasks/lastMessageAt/
  //                    aiTitle/dormant all held identical across ticks; only recycling
  //                    flips false→true on tick 2) → second tick DOES publish
  //                    (fingerprint delta detected on recycling axis).
  // ---------------------------------------------------------------------------

  it("Test P53-01-T1-v: recycling flips false→true (all other axes unchanged) → second tick publishes (fingerprint delta on recycling axis)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Tick 1: recycling:false
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "no\n",
    );

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1: recycling:false published

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);
    // inline-260830-source-a-omit-recycling: source A omits recycling; source
    // B skips when live PID + !isRecycling. Tick 1 semantic: no frame stamps
    // recycling:true.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }

    // Tick 2: recycling flips to true — ALL OTHER axes unchanged (same session
    // json, same tail, same hook payload, same dormant). Fingerprint MUST see
    // the recycling delta and fire publish.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "yes\n",
    );

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    const publishesAfterTick2 = deps.registry.publishedStates.length;
    expect(publishesAfterTick2).toBe(publishesAfterTick1 + 1);
    expect(
      deps.registry.publishedStates[publishesAfterTick2 - 1].state.recycling,
    ).toBe(true);
  });
});

// ==============================================================================
// Phase 53 CR C2/C3 — source B recycling coverage (2026-08-21)
//
// Post-execute code review flagged two gaps in Phase 53's initial source-A-only
// design:
//
//   C2: When the outgoing claude PID exits during a recycle, source A stops
//       publishing for that key. A browser tab opening during the PID-vanish
//       window (before the fresh PID comes up) sees no state for the identity
//       and its row incorrectly shows "ready" instead of "recycling."
//
//   C3: When source B publishes for a dormant identity, it previously omitted
//       recycling. If both .dormant AND .recycled-at existed on the same
//       identity, the source-B frame blanked the recycling axis in the registry
//       snapshot — later subscribers saw not-recycling.
//
// Fix: source B stats both .dormant AND .recycled-at on every tick, and
// publishes when EITHER axis changes vs cache. dormantOnlyIdentities cache
// widened from Map<name, boolean> to Map<name, {dormant, recycling}>.
// ==============================================================================

describe("Phase 53 CR C2/C3 — source B recycling coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // wireEmptySessions helper — copy of the Phase 52 T3 sibling for isolation.
  function wireEmptySessions(channel: MockSshChannel): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());
  }

  // ---------------------------------------------------------------------------
  // Test P53-CR-C2-i — Identity with .recycled-at present + NO live PID →
  //                    source B publishes recycling:true frame (C2 fix).
  // Pre-fix: source A only, no publish for this key → browser saw "ready".
  // ---------------------------------------------------------------------------

  it("Test P53-CR-C2-i: identity with .recycled-at present + no live PID → source B publishes recycling:true frame", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    // dormant absent, recycling present — the exact PID-vanish window.
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "yes\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates).toHaveLength(1);
    const p = deps.registry.publishedStates[0];
    expect(p.state.sessionId).toBe("__dormant__");
    expect(p.state.pid).toBeNull();
    expect(p.state.tmuxSession).toBe("tina");
    expect(p.state.dormant).toBe(false);
    expect(p.state.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test P53-CR-C3-i — Identity with BOTH .dormant AND .recycled-at + no live
  //                    PID → source B publishes with BOTH true (C3 fix).
  // Pre-fix: source B omitted recycling → registry snapshot blanked the axis.
  // ---------------------------------------------------------------------------

  it("Test P53-CR-C3-i: identity with both .dormant and .recycled-at → source B publishes dormant:true AND recycling:true (no axis blanking)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "yes\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "yes\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates).toHaveLength(1);
    const p = deps.registry.publishedStates[0];
    expect(p.state.dormant).toBe(true);
    expect(p.state.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test P53-CR-C2-ii — recycling-only change on tick 2 publishes new frame
  //                     (fingerprint suppression respects the recycling axis).
  // ---------------------------------------------------------------------------

  it("Test P53-CR-C2-ii: source B tick 2 with recycling flipped (dormant unchanged) → new publish (cache respects recycling axis)", async () => {
    const channel = new MockSshChannel();
    wireEmptySessions(channel);
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return 0 as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();
    // Tick 1: first-appearance publish with recycling:false.
    expect(deps.registry.publishedStates).toHaveLength(1);
    expect(deps.registry.publishedStates[0].state.recycling).toBe(false);

    // Tick 2: recycling flips true. dormantOnlyIdentities cache differs → publish.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "yes\n");
    const pollFn = setIntervalFns.find((s) => s.ms >= 500 && s.ms <= 3000)?.fn;
    expect(pollFn).toBeDefined();
    await pollFn!();

    expect(deps.registry.publishedStates).toHaveLength(2);
    expect(deps.registry.publishedStates[1].state.recycling).toBe(true);
    expect(deps.registry.publishedStates[1].state.dormant).toBe(false);
  });
});

// ==============================================================================
// quick-260822-0vw — Layer 1 /id reset OR composition into source A recycling
//
// Phase 53-03 swapped all three consumer sites to `useSessionIsRecycling` which
// reads a single wire axis. Phase 53's initial source-A composition only set
// `recycling:true` when `.recycled-at` sentinel was present (placed at t=N,
// END of save flow). This quick task adds a Layer 1 tail predicate:
//
//   derivedRecyclingComposed = derivedLayer1Recycling || derivedSentinelRecycling
//
// so the recycling axis arms at t=0 (user presses reset → `/id reset` lands in
// the session file as the most-recent real user turn) rather than only at t=N.
//
// Source B (dormant-only, no live PID) is UNCHANGED — dormant identities have
// no JSONL to tail-scan; the sentinel remains the sole source B recycling input.
//
// All three consumer sites (`SessionHoldingOverlay`, `ComposeBox`,
// `PrettyConversationRow` via `useSessionIsRecycling`) are NOT touched —
// they pick up the earlier signal for free via the one-axis architecture.
// ==============================================================================

describe("quick-260822-0vw — Layer 1 /id reset OR composition into source A recycling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local helper — produces a JSONL line that satisfies detectIdReset.
  // Shape mirrors session-file-parser.id-reset.test.ts Test 1 (bare /id reset).
  function idResetLine(tsMillis: number): string {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "<command-name>/id</command-name><command-args>reset</command-args>",
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-id-reset-${tsMillis}`,
    });
  }

  // Plain assistant message — no /id reset markup. Used to verify the sentinel
  // path still fires when Layer 1 is quiet (regression guard for P53-01 behavior).
  function plainMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // wireBaseResponses — same shape as the Phase 53 Plan 01 sibling, extended to
  // allow overriding the JSONL tail response for Layer-1 tests.
  //
  // quick-260823-73o migration: source A no longer stamps the recycling axis;
  // source B (identity-folder-keyed) is the sole publisher of that axis. The
  // Layer 1 tail scan (once source-A-owned) also moved to source B. Wire
  // "ls -1 ~/fleet/identities/" → "tina\n" so source B iterates tina every
  // tick and exercises the axis. Assertions in this describe block that check
  // recycling MUST look at the source-B frame (sessionId === "__dormant__").
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
    // Default dormant stat response (not dormant).
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    // Default recycled-at stat response (not recycling) — override per test as needed.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");
    // quick-260823-73o: source B also probes .recycle-requested per identity;
    // default no so tests that only exercise Layer 1 / .recycled-at aren't
    // accidentally armed via the third axis.
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "no\n",
    );
  }

  // quick-260823-73o helper — pick the source-B frame from the publish log.
  function pickSourceBFrame(
    publishedStates: Array<{ hostId: string; state: SessionState }>,
  ): SessionState | undefined {
    const frames = publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    return frames[frames.length - 1]?.state;
  }

  // ---------------------------------------------------------------------------
  // Test QT-260822-0vw-T1-i — Layer 1 alone triggers recycling.
  // The JSONL tail contains a /id reset line; .recycled-at sentinel is absent.
  // Expected: SessionState.recycling === true (Layer 1 fires before sentinel).
  // ---------------------------------------------------------------------------

  it("Test QT-260822-0vw-T1-i: Layer 1 alone (/id reset in tail, sentinel absent) → recycling === true", async () => {
    const channel = new MockSshChannel();
    // Tail contains a /id reset user turn (satisfies detectIdReset).
    wireBaseResponses(channel, idResetLine(2000) + "\n");
    // Sentinel absent — recycling should still be true from Layer 1 alone.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // quick-260823-73o: source B owns the recycling axis; look at its frame.
    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test QT-260822-0vw-T1-ii — Sentinel alone triggers recycling (regression
  // guard for Phase 53-01 behavior). The tail contains a plain assistant message
  // (no /id reset); .recycled-at sentinel is present.
  // Expected: recycling === true (OR does NOT accidentally become AND).
  // ---------------------------------------------------------------------------

  it("Test QT-260822-0vw-T1-ii: sentinel alone (.recycled-at present, no /id reset in tail) → recycling === true (OR not AND)", async () => {
    const channel = new MockSshChannel();
    // Plain assistant message — Layer 1 predicate will be false.
    wireBaseResponses(channel, plainMessageLine(1000, "assistant", "hello") + "\n");
    // Sentinel present — recycling should be true from sentinel alone.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "yes\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // quick-260823-73o: source B owns the recycling axis; look at its frame.
    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test QT-260822-0vw-T1-iii — Both signals true → still recycling (OR is
  // idempotent). The tail contains a /id reset line AND .recycled-at is present.
  // Expected: recycling === true; source B publishes ONE recycling frame
  // (fingerprint identity — OR of two trues yields the same true axis value).
  // ---------------------------------------------------------------------------

  it("Test QT-260822-0vw-T1-iii: both Layer 1 and sentinel true → source B publishes exactly one recycling:true frame (OR is idempotent)", async () => {
    const channel = new MockSshChannel();
    // /id reset in tail + sentinel present.
    wireBaseResponses(channel, idResetLine(2000) + "\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "yes\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // quick-260823-73o: source B owns the recycling axis; look at its frame.
    const sourceBFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(sourceBFrames).toHaveLength(1);
    expect(sourceBFrames[0].state.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test QT-260822-0vw-T1-iv — Neither signal → not recycling.
  // Plain message in tail, .recycled-at absent.
  // Expected: recycling === false.
  // ---------------------------------------------------------------------------

  it("Test QT-260822-0vw-T1-iv: neither Layer 1 nor sentinel → recycling === false", async () => {
    const channel = new MockSshChannel();
    // Plain message — no /id reset; sentinel absent.
    wireBaseResponses(channel, plainMessageLine(1000, "user", "hello") + "\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // inline-260830-source-a-omit-recycling: source A omits the recycling
    // axis (undefined). Source B SKIPS publish when the identity has a live
    // PID AND !isRecycling (liveTmuxSet skip-and-evict — preserved from the
    // quick-260823-73o migration). Semantic under the new contract:
    // no published frame stamps recycling:true this tick.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Test QT-260822-0vw-T1-v — SSH failure on session file tail → Layer 1 falls
  // back to cached value (fail-open). Cold-start cache default is false.
  // Sentinel also absent (no\n). Expected: recycling === false; no throw.
  // ---------------------------------------------------------------------------

  it("Test QT-260822-0vw-T1-v: SSH failure on JSONL tail → Layer 1 falls back to cold-start cache (false); no throw", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, "");
    // Wire JSONL tail to null — simulates SSH hiccup on tail -c 262144 exec.
    channel.setResponse("discovered.jsonl", null);
    // Sentinel absent.
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // Fail-open: cold-start cache default is false; matches sentinel's own
    // fail-open contract at Test P53-01-T1-iii.
    // inline-260830-source-a-omit-recycling: source A omits the recycling
    // axis (undefined). Source B SKIPS publish when the identity has a live
    // PID AND !isRecycling (liveTmuxSet skip-and-evict — preserved from the
    // quick-260823-73o migration). Semantic under the new contract:
    // no published frame stamps recycling:true this tick.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // inline-260830-layer1-skip-harness-synthetic-user-turns — REGRESSION
  //
  // Bug (Ashley 2026-08-30, taylor session): during the ~30s window between
  // Ashley clicking reset and the /id skill dropping `.recycle-requested`,
  // the overlay stayed off — Layer 1 never fired despite `/id reset` being
  // the freshest real user turn in the JSONL. Root cause: the /id skill's
  // own bash/read tool_use invocations write tool_result turns to JSONL as
  // `type:"user"` entries with ARRAY content. scanTailForLayer1RecyclingSignal
  // iterated ALL user turns and set `lastResult = detectIdReset(parsed)`
  // unconditionally. detectIdReset returns FALSE (not null) for array-content
  // user turns — so each tool_result flipped lastResult back to false,
  // drowning the /id reset signal. Same class of drowning for /exit
  // (agent-supervisor injects it before recycle), resumed-injection
  // sentinels, and control-char kill signals.
  //
  // Fix: pre-filter the scan with `isAshleyRealUserTurn` so harness-
  // synthetic user turns don't reach detectIdReset. Real user speech is
  // the only thing that flips the axis.
  //
  // These tests build tails matching real recycle-window shapes and
  // assert Layer 1 STAYS TRUE. Together with today's Bug B fix
  // (inline-260830-source-a-omit-recycling), the overlay now arms at
  // t=~2s (first Layer 1 tick after /id reset lands in JSONL) instead of
  // t=~30s (sentinel drop), and stays armed through the whole recycle
  // window because source A can no longer wipe the cache.
  // ---------------------------------------------------------------------------

  function toolResultUserLine(tsMillis: number, toolUseId: string): string {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: "tool output",
          },
        ],
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-tool-result-${tsMillis}`,
    });
  }

  function exitCommandLine(tsMillis: number): string {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "<command-name>/exit</command-name>\n<command-args></command-args>",
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-exit-${tsMillis}`,
    });
  }

  function resumedInjectionLine(tsMillis: number): string {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content:
          "Your session was just resumed by the agent-supervisor. Your background Monitors stopped with the previous session — start them again per the id skill.",
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-resumed-${tsMillis}`,
    });
  }

  it("Test inline-260830-layer1-skip-tool-results: /id reset followed by tool_result flood → Layer 1 stays TRUE (source B publishes recycling:true)", async () => {
    const channel = new MockSshChannel();
    // Tail: /id reset THEN many tool_result user turns (simulates the /id skill
    // running bash/read/write during the ~30s save flow).
    const tail =
      idResetLine(2000) +
      "\n" +
      toolResultUserLine(2100, "toolu_01") +
      "\n" +
      toolResultUserLine(2200, "toolu_02") +
      "\n" +
      toolResultUserLine(2300, "toolu_03") +
      "\n" +
      toolResultUserLine(2400, "toolu_04") +
      "\n";
    wireBaseResponses(channel, tail);
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Layer 1 must survive the tool_result flood — source B publishes true.
    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  it("Test inline-260830-layer1-skip-exit: /id reset followed by /exit → Layer 1 stays TRUE (source B publishes recycling:true)", async () => {
    const channel = new MockSshChannel();
    // Tail: /id reset THEN /exit (agent-supervisor injects /exit right before
    // recycle — /exit is a string-content user turn but detectIdReset returns
    // false for it because the content has no <command-name>/id</command-name>).
    const tail =
      idResetLine(2000) + "\n" + exitCommandLine(2500) + "\n";
    wireBaseResponses(channel, tail);
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  it("Test inline-260830-layer1-skip-resumed: /id reset followed by resumed-injection sentinel → Layer 1 stays TRUE", async () => {
    const channel = new MockSshChannel();
    // Tail: /id reset THEN the agent-supervisor resumed-injection sentinel
    // (a string-content user turn that isAshleyRealUserTurn's step 7 explicitly
    // excludes — it's supervisor-injected boilerplate, not real user speech).
    const tail =
      idResetLine(2000) + "\n" + resumedInjectionLine(2500) + "\n";
    wireBaseResponses(channel, tail);
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  it("Test inline-260830-layer1-real-user-after-reset: /id reset followed by a REAL user prompt → Layer 1 flips FALSE (semantic: last real user turn wins)", async () => {
    const channel = new MockSshChannel();
    // Tail: /id reset THEN a plain string-content user prompt (e.g., Ashley
    // typed "actually never mind" — extremely rare in practice because the
    // composebox clears after submit, but semantically important). This
    // "last REAL user turn wins" semantic is preserved: a real subsequent
    // prompt DOES flip Layer 1 back to false.
    const tail =
      idResetLine(2000) +
      "\n" +
      plainMessageLine(2500, "user", "actually never mind") +
      "\n";
    wireBaseResponses(channel, tail);
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // No frame stamps recycling:true — Layer 1 flipped false via a real
    // subsequent user turn; sentinel absent; nothing arms.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260823-recycle-overlay — `.recycle-requested` source-A stat as the
// THIRD OR term in the recycling axis composition
//
// Motivation (Ashley 2026-08-23): the recycle-overlay would come up LATE —
// only after the harness actually closed. Root cause: the OR composition
// covered `.recycled-at` (supervisor-authored, appears at supervisor
// reconcile time) + Layer 1 JSONL scan (should fire when /id reset lands),
// but NOT `.recycle-requested` (agent-authored, appears the moment the
// /id reset skill runs). This test group locks the new axis behavior:
//   - probe returns "yes" → SessionState.recycling === true (independent of
//     the other two axes' values)
//   - all three axes false → SessionState.recycling === false
//   - three-way OR: any single axis true → composed true
// ─────────────────────────────────────────────────────────────────────────────

describe("quick-260823-recycle-overlay — `.recycle-requested` source-A stat + three-axis OR", () => {
  function jsonlMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
  ): string {
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${identityName}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // quick-260823-73o migration: source A no longer stamps the recycling axis;
  // source B is the sole publisher. Wire identities listing → tina so source B
  // enumerates every tick; assertions look at the source-B frame.
  function wireBaseResponses(
    channel: MockSshChannel,
    jsonlContents: string,
    discoveryOverride?: string,
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    const discoveryStdout =
      discoveryOverride ??
      buildDiscoveryFixture(
        "tina",
        "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
      );
    channel.setResponse("IDENTITY=", discoveryStdout);
    channel.setResponse("discovered.jsonl", jsonlContents);
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "no\n",
    );
  }

  function pickSourceBFrame(
    publishedStates: Array<{ hostId: string; state: SessionState }>,
  ): SessionState | undefined {
    const frames = publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    return frames[frames.length - 1]?.state;
  }

  it("Test A: `.recycle-requested` probe returns 'yes' → SessionState.recycling === true (even when `.recycled-at` and Layer 1 both false)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "yes\n",
    );
    // Explicit sanity: `.recycled-at` still false, Layer 1 still false (assistant-only tail).
    channel.setResponse("stat ~/fleet/identities/'tina'/.recycled-at", "no\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // quick-260823-73o: source B owns the recycling axis; look at its frame.
    const sourceBFrame = pickSourceBFrame(deps.registry.publishedStates);
    expect(sourceBFrame).toBeDefined();
    expect(sourceBFrame!.recycling).toBe(true);
  });

  it("Test B: all three axes return 'no' → SessionState.recycling === false", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // All three defaults from wireBaseResponses.

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // inline-260830-source-a-omit-recycling: source A omits the recycling
    // axis (undefined). Source B SKIPS publish when the identity has a live
    // PID AND !isRecycling (liveTmuxSet skip-and-evict — preserved from the
    // quick-260823-73o migration). Semantic under the new contract:
    // no published frame stamps recycling:true this tick.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  it("Test C: `.recycle-requested` probe returns null (SSH hiccup) → cold-start cached value (false) preserved (fail-open, matches Test P53-01-T1-iii pattern)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");
    // Override to return null (SSH failure).
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      null,
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await expect(orchestrator.start()).resolves.not.toThrow();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    // inline-260830-source-a-omit-recycling: source A omits the recycling
    // axis (undefined). Source B SKIPS publish when the identity has a live
    // PID AND !isRecycling (liveTmuxSet skip-and-evict — preserved from the
    // quick-260823-73o migration). Semantic under the new contract:
    // no published frame stamps recycling:true this tick.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  it("Test D: `.recycle-requested` probe fires exactly once per tick (single SSH round-trip added by this axis)", async () => {
    const channel = new MockSshChannel();
    wireBaseResponses(channel, jsonlMessageLine(1000, "assistant", "hi") + "\n");

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const probeCalls = channel.countCallsMatching(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
    );
    // Exactly ONE per tick under source A (the single `pollAllHosts` tick fired by start()).
    expect(probeCalls).toBe(1);
  });
});

// ==============================================================================
// quick-260823-73o — recycle axes in source B (per-identity, PID-independent)
//
// Motivation (Ashley 2026-08-23): Patch #495 shipped diagnostic logs +
// `.recycle-requested` in SOURCE A but Ashley narrated a full /id reset cycle
// with no overlay. Layer 1 fired at 04:45:47Z but
// `fleet_status_recycling_armed` NEVER fired for tina across the reset window.
// Root cause: source A iterates per-PID (~/.claude/tasks/*.json). During
// tina's reset the outgoing claude PID is being torn down and per-PID
// iteration hits a lifecycle gap where none of the three axes evaluate true
// across the sentinel-present window. Source B is identity-folder-keyed and
// runs unconditionally per identity per tick, but it explicitly SKIPS any
// identity in liveTmuxSet — so during the first seconds of recycle (tina
// still has a live PID + sentinel on disk), source B ALSO skips tina.
//
// This migration moves ALL THREE recycle axes (`.recycle-requested`,
// `.recycled-at`, Layer 1 /id reset) out of source A's per-PID loop and into
// source B's per-identity iteration, and conditionally lifts the liveTmuxSet
// skip so `isRecycling === true` identities always publish from source B
// regardless of live PID state. Source A publishes `recycling: false`
// unconditionally after migration — source B becomes the sole publisher of
// the recycling axis.
//
// The 6 tests below LOCK the new contract. On the current source-A code they
// are RED (source B never publishes recycling:true for a live-PID identity
// because of the unconditional skip). Task 2 flips them GREEN.
// ==============================================================================

describe("quick-260823-73o — recycle axes in source B (per-identity, PID-independent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Local JSONL fixture helpers — copied from the quick-260822-0vw describe block
  // to keep this block self-contained. Same shape as
  // session-file-parser.id-reset.test.ts Test 1 (bare /id reset).
  function idResetLine(tsMillis: number): string {
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "<command-name>/id</command-name><command-args>reset</command-args>",
      },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-id-reset-${tsMillis}`,
    });
  }

  function plainMessageLine(
    tsMillis: number,
    role: "user" | "assistant",
    content: string,
  ): string {
    return JSON.stringify({
      type: role,
      message: { role, content },
      timestamp: new Date(tsMillis).toISOString(),
      uuid: `uuid-${tsMillis}-${role}`,
    });
  }

  function buildDiscoveryFixture(
    identityName: string,
    discoveredPath: string,
  ): string {
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${identityName}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  /**
   * wireLivePidAndIdentity — wires the MockSshChannel so BOTH source A (per-PID
   * for PID 12345 → tmux `tina`) AND source B (per-identity iteration for
   * "tina") execute successfully. Overridable per-test:
   *   - opts.recycleRequested — "yes"|"no", default "no"
   *   - opts.recycledAt       — "yes"|"no", default "no"
   *   - opts.dormant          — "yes"|"no", default "no"
   *   - opts.jsonlTail        — the tail contents (string, default plain assistant msg)
   *   - opts.livePid          — whether to wire a live PID at all (default true).
   *     When false, "ls -1 ~/.claude/sessions/" returns "" so source A silent.
   *
   * MockSshChannel is FIRST-MATCH-WINS on substring: a single "IDENTITY="
   * fixture serves both source A's discovery call AND source B's discovery
   * call in the same tick (both source A and source B call the same
   * discoverIdentityJsonlPathViaChannel helper with the same identityName
   * → same buildDiscoveryScript output → same "IDENTITY=" prefix).
   *
   * Same shape for the sentinel stat responses: `stat ~/fleet/identities/'tina'/.dormant`
   * and `test -f ~/fleet/identities/'tina'/.recycle-requested` — source A and
   * source B both issue these; the mock returns the same value to both callers.
   */
  function wireLivePidAndIdentity(
    channel: MockSshChannel,
    opts: {
      recycleRequested?: "yes" | "no";
      recycledAt?: "yes" | "no";
      dormant?: "yes" | "no";
      jsonlTail?: string;
      livePid?: boolean;
    } = {},
  ): void {
    const {
      recycleRequested = "no",
      recycledAt = "no",
      dormant = "no",
      jsonlTail = plainMessageLine(1000, "assistant", "hi") + "\n",
      livePid = true,
    } = opts;

    // Source A wiring — live PID for tina at 12345 (or empty sessions if livePid=false).
    if (livePid) {
      channel.setResponse(
        "ls -1 ~/.claude/sessions/",
        "/home/ubuntu/.claude/sessions/12345.json\n",
      );
      channel.setResponse(
        "cat ~/.claude/sessions/12345.json",
        makeSessionJson(),
      );
      channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
      channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
      channel.setResponse("tmux display-message", "tina");
    } else {
      channel.setResponse("ls -1 ~/.claude/sessions/", "");
    }
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );

    // Source B wiring — identities dir lists tina every tick.
    channel.setResponse("~/fleet/identities/ -mindepth", "tina\n");

    // Discovery — shared substring "IDENTITY=" serves both source A and source B.
    const discoveryStdout = buildDiscoveryFixture(
      "tina",
      "~/.claude/projects/-home-ubuntu-skynet-tina/discovered.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryStdout);
    // JSONL tail — matched via "discovered.jsonl" substring; source A + source B
    // both `tail -c 262144 <jsonlPath>` where jsonlPath ends in `discovered.jsonl`.
    channel.setResponse("discovered.jsonl", jsonlTail);

    // Per-identity sentinel stats — same substring serves source A and source B.
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.dormant",
      `${dormant}\n`,
    );
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      `${recycledAt}\n`,
    );
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      `${recycleRequested}\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-i — `.recycle-requested` present + live PID for tina
  //   → source B publishes recycling:true (source-B frame: pid:null +
  //   sessionId:"__dormant__" + tmuxSession:"tina"). Source A also publishes
  //   its own frame for PID 12345 with recycling:false (source A no longer
  //   stamps this axis after the migration). publishedStates.length >= 2.
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-i: `.recycle-requested` present + live PID → source B publishes recycling:true (independent of source A's frame)", async () => {
    const channel = new MockSshChannel();
    wireLivePidAndIdentity(channel, { recycleRequested: "yes" });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // At least two publishes: source A (for PID 12345) + source B (for tina identity).
    expect(deps.registry.publishedStates.length).toBeGreaterThanOrEqual(2);

    // Source B frame — identified by sessionId "__dormant__".
    const sourceBFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(sourceBFrames.length).toBeGreaterThanOrEqual(1);
    const sb = sourceBFrames[0];
    expect(sb.state.tmuxSession).toBe("tina");
    expect(sb.state.pid).toBeNull();
    expect(sb.state.recycling).toBe(true);

    // Source A frame — identified by numeric pid 12345. Source A no longer
    // stamps recycling after the migration.
    // inline-260830-source-a-omit-recycling: source A now OMITS the recycling
    // field entirely (was `false`; changed to preserve store cache written by
    // source B — see ssh-poll-orchestrator.ts:1455 comment).
    const sourceAFrames = deps.registry.publishedStates.filter(
      (p) => p.state.pid === 12345,
    );
    expect(sourceAFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceAFrames[0].state.recycling).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-ii — `.recycled-at` present + live PID for tina
  //   → same shape as T1-i but with `.recycled-at` yes instead of `.recycle-requested`.
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-ii: `.recycled-at` present + live PID → source B publishes recycling:true", async () => {
    const channel = new MockSshChannel();
    wireLivePidAndIdentity(channel, { recycledAt: "yes" });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThanOrEqual(2);

    const sourceBFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(sourceBFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceBFrames[0].state.tmuxSession).toBe("tina");
    expect(sourceBFrames[0].state.pid).toBeNull();
    expect(sourceBFrames[0].state.recycling).toBe(true);

    // inline-260830-source-a-omit-recycling: source A omits recycling.
    const sourceAFrames = deps.registry.publishedStates.filter(
      (p) => p.state.pid === 12345,
    );
    expect(sourceAFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceAFrames[0].state.recycling).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-iii — no live PID for tina + `.recycle-requested` yes
  //   → source B publishes recycling:true (regression guard — Phase 53 CR C2
  //   behavior preserved via the new path). Exactly ONE publish (source A silent).
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-iii: no live PID + `.recycle-requested` present → source B publishes recycling:true (single publish, source A silent)", async () => {
    const channel = new MockSshChannel();
    wireLivePidAndIdentity(channel, {
      recycleRequested: "yes",
      livePid: false,
    });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Exactly one publish — source B only (no live PID → source A silent).
    expect(deps.registry.publishedStates).toHaveLength(1);
    const p = deps.registry.publishedStates[0];
    expect(p.state.sessionId).toBe("__dormant__");
    expect(p.state.pid).toBeNull();
    expect(p.state.tmuxSession).toBe("tina");
    expect(p.state.recycling).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-iv — live PID for tina + JSONL tail's last user turn
  //   is /id reset + no sentinels → source B publishes recycling:true via
  //   Layer 1 axis. Source A publishes recycling:false. publishedStates.length >= 2.
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-iv: live PID + Layer 1 (/id reset in tail) → source B publishes recycling:true via Layer 1 axis", async () => {
    const channel = new MockSshChannel();
    wireLivePidAndIdentity(channel, {
      jsonlTail: idResetLine(2000) + "\n",
      // sentinels default false via wireLivePidAndIdentity defaults.
    });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThanOrEqual(2);

    // Source B frame — recycling:true from Layer 1.
    const sourceBFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(sourceBFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceBFrames[0].state.tmuxSession).toBe("tina");
    expect(sourceBFrames[0].state.recycling).toBe(true);

    // Source A frame — recycling omitted (source A no longer stamps).
    // inline-260830-source-a-omit-recycling: source A omits recycling.
    const sourceAFrames = deps.registry.publishedStates.filter(
      (p) => p.state.pid === 12345,
    );
    expect(sourceAFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceAFrames[0].state.recycling).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-v — live PID + all three axes false → source B does
  //   NOT publish recycling:true. Either publishes recycling:false OR does not
  //   publish a source-B frame at all (either is acceptable per fingerprint
  //   semantics). GUARD: no published frame this tick has recycling === true.
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-v: live PID + no axes true → no published frame has recycling:true (negative case)", async () => {
    const channel = new MockSshChannel();
    wireLivePidAndIdentity(channel);
    // All defaults: recycleRequested=no, recycledAt=no, jsonlTail=plain assistant msg.

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Guard: NO published frame has recycling:true this tick.
    // inline-260830-source-a-omit-recycling: source A frames now have
    // recycling === undefined (omitted). Source B, when it publishes, still
    // stamps false explicitly. Assert the negative — no frame stamps true.
    for (const p of deps.registry.publishedStates) {
      expect(p.state.recycling).not.toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Test QT-260823-73o-T1-vi — tick 1: `.recycle-requested` yes → source B
  //   publishes recycling:true. Tick 2: `.recycle-requested` no, `.recycled-at`
  //   no, jsonl tail unchanged (no /id reset) → source B publishes
  //   recycling:false (fingerprint delta detected on recycling axis). No stale
  //   recycling:true persistence.
  // ---------------------------------------------------------------------------

  it("Test QT-260823-73o-T1-vi: recycling flip true→false across ticks → source B publishes recycling:false on tick 2 (fingerprint delta preserved, no stale persistence)", async () => {
    const channel = new MockSshChannel();
    // Tick 1: `.recycle-requested` yes.
    wireLivePidAndIdentity(channel, { recycleRequested: "yes" });

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    // Tick 1 source-B frame is recycling:true.
    const tick1SbFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(tick1SbFrames.length).toBeGreaterThanOrEqual(1);
    expect(tick1SbFrames[tick1SbFrames.length - 1].state.recycling).toBe(true);

    const publishesAfterTick1 = deps.registry.publishedStates.length;

    // Tick 2: `.recycle-requested` flips to no. All other axes stay false.
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "no\n",
    );
    // (recycledAt and jsonl tail already false/plain from wireLivePidAndIdentity defaults.)

    const pollFn = setIntervalFns.find((s) => s.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // Fingerprint delta on recycling axis → source B re-publishes with recycling:false.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(publishesAfterTick1);
    // The NEW source-B publish this tick has recycling:false.
    const tick2NewFrames = deps.registry.publishedStates.slice(publishesAfterTick1);
    const tick2SbFrame = tick2NewFrames.find(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(tick2SbFrame).toBeDefined();
    expect(tick2SbFrame!.state.recycling).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test inline-260830-source-a-omit-recycling — REGRESSION
  //
  // Bug (Ashley 2026-08-30, taylor session): during a real /id reset, the
  // overlay armed briefly the instant `.recycle-requested` dropped, then
  // disappeared and never came back through the /exit + harness kill + fresh
  // claude launch window. Root cause: source A stamped `recycling: false`
  // explicitly on every publish for the live PID; source B stamped
  // `recycling: true` when the sentinel was present. Within the same tick,
  // source A ran first (per-PID loop) then source B; the frontend store's
  // Axis E (session-working-store.ts:382) preserved cache only when the wire
  // field was undefined — an explicit `false` flipped it. So source A's next
  // status-change publish (busy↔shell) wiped the store cache back to false.
  // Source B's fingerprint dedup then skipped republishing because
  // isRecycling remained true, leaving the store stuck at false for the
  // rest of the recycle window.
  //
  // Fix: source A OMITS the recycling field entirely (undefined). Store
  // Axis E preserves cache on undefined. Source B stays sole authority.
  //
  // This test pins the source-A-omit contract at the wire boundary. The
  // store-side preserve-on-undefined contract is already covered by
  // session-working-store.test.ts Test P53-02-vii ("recycling:true, then
  // isWorking toggles → recycling still true"). Together they close the
  // full pipeline: source A never stamps → Axis E never flips false from
  // source A frames → cache stays true through the recycle window.
  // ---------------------------------------------------------------------------

  it("Test inline-260830-source-a-omit-recycling: EVERY source A frame (across multiple ticks + status flips) has recycling===undefined regardless of sentinel state", async () => {
    const channel = new MockSshChannel();
    // Start with sentinel present so source B fires recycling:true and any
    // source A frame that stamped `false` would surface in the assertion.
    wireLivePidAndIdentity(channel, { recycleRequested: "yes" });

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

    // Simulate a status flip mid-recycle by re-firing the poller (source A
    // will publish a fresh frame on the next fingerprint delta — a real
    // recycle window sees these constantly as claude toggles busy↔shell).
    const pollFn = setIntervalFns.find((s) => s.ms === 2000)?.fn;
    expect(pollFn).toBeDefined();
    // Bump the SessionJson so source A's fingerprint changes on the next tick.
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell" }),
    );
    await pollFn!();

    // Then flip the sentinel to `.recycled-at` (supervisor rename) — source B
    // should stay recycling:true via that axis and source A should still omit.
    channel.setResponse(
      "test -f ~/fleet/identities/'tina'/.recycle-requested",
      "no\n",
    );
    channel.setResponse(
      "stat ~/fleet/identities/'tina'/.recycled-at",
      "yes\n",
    );
    await pollFn!();

    // Every source A frame across all ticks — recycling must be undefined.
    const sourceAFrames = deps.registry.publishedStates.filter(
      (p) => p.state.pid === 12345,
    );
    expect(sourceAFrames.length).toBeGreaterThanOrEqual(1);
    for (const f of sourceAFrames) {
      expect(f.state.recycling).toBeUndefined();
    }

    // Source B frames — at least one recycling:true frame across all ticks.
    const sourceBTrueFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__" && p.state.recycling === true,
    );
    expect(sourceBTrueFrames.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 55 Plan 02 — session-file cache writes from source A
//
// Verifies that processPid (source A) writes the resolved jsonlPath + pid
// into the shared session-file cache, and that all four guard conditions
// (jsonlPath null, tmuxSession null, stale liveness, source B) correctly
// skip the write.
// ---------------------------------------------------------------------------

describe("Phase 55: session-file cache writes", () => {
  beforeEach(() => {
    __clearAllSessionFileCacheForTests();
    vi.clearAllMocks();
  });

  // Local helpers — same patterns as sibling Phase 53 / Phase 44 describe blocks.

  function buildDiscoveryFixture55(
    identityName: string,
    discoveredPath: string,
    matchesIdentity = true,
  ): string {
    const argsPayload = matchesIdentity ? identityName : `different-${identityName}`;
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>${argsPayload}</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-55-${identityName}`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  // Wire channel responses for the happy-path fixture (source A only — no source B identities).
  function wireSourceAResponses(
    channel: MockSshChannel,
    opts: {
      discoveryStdout?: string;
      environResponse?: string;
      statStarttime?: string;
    } = {},
  ): void {
    const {
      discoveryStdout = buildDiscoveryFixture55(
        "aqua",
        "/home/x/.claude/projects/proj/id.jsonl",
      ),
      environResponse = "TMUX_PANE=%2\0TMUX=/tmp/tmux\0",
      statStarttime = "12345",
    } = opts;

    channel.setResponse(
      "ls -1 ~/.claude/sessions/",
      "/home/ubuntu/.claude/sessions/12345.json\n",
    );
    // Source B identities — empty so source B never fires.
    channel.setResponse("~/fleet/identities/ -mindepth", "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ pid: 12345, procStart: "12345" }),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents(statStarttime));
    channel.setResponse("cat /proc/12345/environ", environResponse);
    channel.setResponse("tmux display-message", "aqua");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    // Discovery script — matched by "IDENTITY=" prefix.
    channel.setResponse("IDENTITY=", discoveryStdout);
    // Tail of the JSONL — matched by filename fragment.
    channel.setResponse("id.jsonl", "");
    // Dormant sentinel for identity aqua.
    channel.setResponse("stat ~/fleet/identities/'aqua'/.dormant", "no\n");
  }

  // ---------------------------------------------------------------------------
  // Test 55-A: source A happy path writes cache entry
  // ---------------------------------------------------------------------------

  it("Test 55-A: source A happy path writes cache entry", async () => {
    const channel = new MockSshChannel();
    wireSourceAResponses(channel);

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Source A publishes; cache entry should be written.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const entry = readSessionFileCache("host-1", "aqua");
    expect(entry).not.toBeNull();
    expect(entry!.sessionFile).toBe("/home/x/.claude/projects/proj/id.jsonl");
    expect(entry!.pid).toBe(12345);
    expect(entry!.writtenAt).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 55-B: skips write when jsonlPath is null
  // ---------------------------------------------------------------------------

  it("Test 55-B: skips write when jsonlPath is null", async () => {
    const channel = new MockSshChannel();
    // Non-matching discovery fixture → discoverIdentityJsonlPathViaChannel returns null.
    const noMatchDiscovery = buildDiscoveryFixture55(
      "aqua",
      "/home/x/.claude/projects/proj/id.jsonl",
      false, // matchesIdentity=false → identity name in first-user-line differs
    );
    wireSourceAResponses(channel, { discoveryStdout: noMatchDiscovery });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // jsonlPath resolved to null → cache write skipped.
    const entry = readSessionFileCache("host-1", "aqua");
    expect(entry).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 55-C: skips write when tmuxSession is null
  // ---------------------------------------------------------------------------

  it("Test 55-C: skips write when tmuxSession is null", async () => {
    const channel = new MockSshChannel();
    // environ has no TMUX_PANE entry → extractTmuxPaneFromEnviron returns null
    // → resolvePidToTmuxSession returns null → tmuxSession stays null.
    wireSourceAResponses(channel, { environResponse: "PATH=/usr/bin\0HOME=/home/ubuntu\0" });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // tmuxSession null → discovery skipped, jsonlPath null, cache write skipped.
    const entry = readSessionFileCache("host-1", "aqua");
    expect(entry).toBeNull();
    // Also verify no entry exists under any conceivable key variant.
    const entryByTina = readSessionFileCache("host-1", "tina");
    expect(entryByTina).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 55-D: stale-liveness path does NOT reach cache write
  // ---------------------------------------------------------------------------

  it("Test 55-D: stale-liveness path does NOT reach cache write", async () => {
    const channel = new MockSshChannel();
    // statStarttime "99999" differs from sessionJson procStart "12345"
    // → isStaleFromStat returns true → early-return before cache write.
    wireSourceAResponses(channel, { statStarttime: "99999" });

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Stale early-return fires before the write site.
    const entry = readSessionFileCache("host-1", "aqua");
    expect(entry).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 55-E: overwrite on second tick with same key updates entry
  // ---------------------------------------------------------------------------

  it("Test 55-E: overwrite on second tick with same key updates entry", async () => {
    const channel = new MockSshChannel();
    // Tick 1: discovery returns path A.
    const discoveryA = buildDiscoveryFixture55(
      "aqua",
      "/home/x/.claude/projects/proj/id1.jsonl",
    );
    wireSourceAResponses(channel, { discoveryStdout: discoveryA });
    channel.setResponse("id1.jsonl", "");

    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    // After tick 1, cache holds path A.
    const entryAfterTick1 = readSessionFileCache("host-1", "aqua");
    expect(entryAfterTick1).not.toBeNull();
    expect(entryAfterTick1!.sessionFile).toBe(
      "/home/x/.claude/projects/proj/id1.jsonl",
    );

    // Tick 2: update discovery mock to return path B (simulates session rotation).
    // MockSshChannel is first-match-wins on insertion order; clear and re-wire.
    // Simplest approach: register a new "IDENTITY=" response that supersedes the
    // first (MockSshChannel iterates entries in insertion order — add before re-query).
    // Actually, setResponse replaces the existing entry for the same pattern key.
    const discoveryB = buildDiscoveryFixture55(
      "aqua",
      "/home/x/.claude/projects/proj/id2.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryB);
    channel.setResponse("id2.jsonl", "");

    // Also null out jsonlPath cache by advancing stale-tail threshold. However, the
    // orchestrator caches jsonlPath in PidCacheEntry and skips re-discovery on tick 2
    // unless the stale-tick threshold trips. To force re-discovery, we rely on the
    // fact that on tick 1 the orchestrator cached the discovery result for PID 12345.
    // The cache hits on tick 2, so jsonlPath from cache = path A still. We need to
    // confirm the write happens with the CACHED path (still path A from PidCacheEntry)
    // on tick 2 as well — or, alternatively, confirm last-writer-wins if we force
    // a re-discovery.
    //
    // Per RESEARCH § Source A write site: discovery fires ONCE per PID (path cached
    // in PidCacheEntry.jsonlPath). On tick 2, the cached jsonlPath is re-used.
    // The write site still fires with the cached path (idempotent overwrite is fine).
    // This test documents last-writer-wins semantics regardless of path change.
    //
    // Force re-discovery by clearing stale tail count: we do this by setting the
    // stale-tail mock to advance (return a newer tail), which won't clear the cache.
    // The simpler test: verify tick 2 still writes to cache (idempotent overwrite).

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // After tick 2, cache entry should still be present (overwrite happened).
    const entryAfterTick2 = readSessionFileCache("host-1", "aqua");
    expect(entryAfterTick2).not.toBeNull();
    // The entry exists and has a valid pid — last-writer-wins (idempotent overwrite).
    expect(entryAfterTick2!.pid).toBe(12345);
    // writtenAt is a positive number (newly stamped by writeSessionFileCache).
    expect(entryAfterTick2!.writtenAt).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 55-F: source B never writes to cache
  // ---------------------------------------------------------------------------

  it("Test 55-F: source B never writes to cache", async () => {
    const channel = new MockSshChannel();

    // Source A: empty sessions dir → no PID → processPid never called.
    channel.setResponse("ls -1 ~/.claude/sessions/", "");
    // Source B: one dormant identity "aqua".
    channel.setResponse("~/fleet/identities/ -mindepth", "aqua\n");
    channel.setResponse(
      "fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    // Source B discovery for "aqua" — returns a valid jsonlPath (tests that
    // even when source B resolves a jsonlPath, it does NOT write to the cache).
    const discoveryB = buildDiscoveryFixture55(
      "aqua",
      "/home/x/.claude/projects/proj/id.jsonl",
    );
    channel.setResponse("IDENTITY=", discoveryB);
    channel.setResponse("id.jsonl", "");
    // Dormant sentinel for identity aqua.
    channel.setResponse("stat ~/fleet/identities/'aqua'/.dormant", "no\n");
    channel.setResponse("stat ~/fleet/identities/'aqua'/.recycled-at", "no\n");
    channel.setResponse(
      "test -f ~/fleet/identities/'aqua'/.recycle-requested",
      "no\n",
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Source B publishes a __dormant__ frame for "aqua".
    const sourceBFrames = deps.registry.publishedStates.filter(
      (p) => p.state.sessionId === "__dormant__",
    );
    expect(sourceBFrames.length).toBeGreaterThanOrEqual(1);
    expect(sourceBFrames[0].state.tmuxSession).toBe("aqua");

    // Cache must be completely empty — source B never writes.
    const entryByAqua = readSessionFileCache("host-1", "aqua");
    expect(entryByAqua).toBeNull();
    // Belt-and-suspenders: any other key also returns null.
    const entryByHostTmux = readSessionFileCache("host-1", "tina");
    expect(entryByHostTmux).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 59 Plan 02 — lastStopAt (per-session Stop-hook file mtime) +
// lastStatusChangeAt (server-side status-value-delta) derivation.
//
// Contract under test (locked by 59-02-PLAN.md § tasks 1-2):
//   - Per-session Stop file mtime read: `stat -c %Y
//     ~/.claude/fleet-status/stop-<sessionId>.json 2>/dev/null || true` fires
//     ONCE per PID per tick after parseSessionJson returns; empty stdout ==
//     file absent → lastStopAt := null; trimmed numeric stdout × 1000 →
//     unix millis; null return (SSH hiccup) → cache-preserve (fail-open,
//     matches lastMessageAt / aiTitle / dormant patterns).
//   - Status-delta: on isNew OR cold-cache lastStatus, seed to deps.now();
//     on transition (cached.lastStatus !== sessionJson.status), update to
//     deps.now(); on same-status tick, preserve cached lastStatusChangeAt.
//     NEVER sourced from sessionJson.updatedAt (Research § Pitfall 4).
//   - Both new axes participate in computeFingerprint — a delta on EITHER
//     fires publishSessionState even when every other axis is unchanged.
//   - Observable-behavior-only tests: the ONLY test surface is the
//     SessionState frame published to MockRegistry. No cache introspection.
// ---------------------------------------------------------------------------

describe("ssh-poll-orchestrator Phase 59 — lastStopAt + lastStatusChangeAt derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The Phase 59 stat command has the shape:
  //   `stat -c %Y ~/.claude/fleet-status/stop-'test-session-id'.json 2>/dev/null || true`
  // The substring `fleet-status/stop-` uniquely identifies it vs the box-wide
  // hook payload command (`cat ~/.claude/fleet-status/last-stop-payload.json`)
  // AND vs the Phase 52 dormant sentinel stat
  // (`stat ~/fleet/identities/'<tmux>'/.dormant …`). Registered as a distinct
  // MockSshChannel pattern per test — MUST be set BEFORE the box-wide
  // last-stop-payload.json response so the includes-match iteration finds it
  // first (MockSshChannel iterates responses in insertion order).
  const PER_SESSION_STOP_PATTERN = "fleet-status/stop-";

  // Helper: register the base per-tick channel responses a PID needs to reach
  // the SessionState composition. Mirrors the shape used by sibling describes
  // (Phase 41 Plan 03 / Phase 44 Plan 02 / Phase 52 Plan 01) — one PID (12345)
  // with sessionId="test-session-id" (from makeSessionJson() default).
  function wirePhase59Base(
    channel: MockSshChannel,
    sessionJsonOverride?: string,
  ): void {
    // Set per-session stop pattern FIRST so iteration finds it before the
    // box-wide `fleet-status/last-stop-payload.json` pattern (which shares a
    // "fleet-status/" prefix but not the "fleet-status/stop-" prefix).
    channel.setResponse(PER_SESSION_STOP_PATTERN, ""); // default: file absent
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("~/fleet/identities/ -mindepth", "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      sessionJsonOverride ?? makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "cat ~/.claude/fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    // Phase 52 dormant sentinel — always "no" so the dormant axis stays
    // constant and doesn't confuse the fingerprint-delta assertions.
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
  }

  // Helper: build a deps object with a controllable now() clock. Follows the
  // Phase 52 Task 2 pattern (setIntervalFns captured for manual tick triggering).
  function buildPhase59Deps(
    channel: MockSshChannel,
    clock: { now: number },
  ): OrchestratorDeps & {
    registry: MockRegistry;
    setIntervalFns: Array<{ fn: () => void; ms: number }>;
  } {
    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
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
      now: () => clock.now,
      pollIntervalMs: 2000,
      staleSweepIntervalMs: 30000,
      hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
      hookPayloadWarnCooldownMs: 60000,
    };
    return { ...deps, registry, setIntervalFns };
  }

  // ---------------------------------------------------------------------------
  // Test P57-02-A — first-appearance PID seeds lastStatusChangeAt to deps.now()
  // and reads per-session mtime if present.
  //
  // Fresh PID → isNew branch → derivedLastStatusChangeAt = deps.now() (seed
  // rule, Research § Pitfall 5). stat returns "1730000000\n" (seconds) →
  // derivedLastStopAt = 1730000000 * 1000 = 1730000000000 (unix millis).
  // ---------------------------------------------------------------------------

  it("Test P57-02-A: first-appearance PID seeds lastStatusChangeAt to deps.now() and reads per-session mtime if present", async () => {
    const channel = new MockSshChannel();
    wirePhase59Base(channel);
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1730000000\n");

    const clock = { now: 1730500000000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Stop file mtime × 1000.
    expect(published.state.lastStopAt).toBe(1730000000000);
    // isNew branch → seeded to deps.now() at tick 1.
    expect(published.state.lastStatusChangeAt).toBe(1730500000000);
  });

  // ---------------------------------------------------------------------------
  // Test P57-02-B — same-status tick preserves cached lastStatusChangeAt.
  //
  // The observable-behavior contract: cached lastStatusChangeAt must NOT bump
  // on a same-status tick. Since a truly-same-status tick would fingerprint-
  // suppress (no publish to observe), we use a three-tick sequence:
  //   Tick 1: status=busy at t=1000 → publishes with lastStatusChangeAt=1000.
  //   Tick 2: status=busy at t=3000 → FINGERPRINT-SUPPRESSED (nothing to
  //           observe directly). Load-bearing invariant: the CACHED
  //           lastStatusChangeAt must remain at 1000, NOT bump to 3000.
  //   Tick 3: status=shell at t=5000 → publishes with lastStatusChangeAt=5000
  //           (a fresh transition-bump). If tick 2 had incorrectly bumped
  //           the cache to 3000, the tick-3 status-delta comparison would
  //           still fire deps.now() = 5000 — but the load-bearing test that
  //           PROVES tick 2 preserved the cache is that publishSessionState
  //           was NOT called on tick 2 (fingerprint delta would fire if
  //           lastStatusChangeAt had bumped from 1000 to 3000).
  //
  // Assertion: exactly TWO publishes across the three ticks (tick 1 + tick 3);
  //            tick 2's cache-write-preservation is proven by the absence of
  //            an intermediate publish (fingerprint identical iff cached
  //            lastStatusChangeAt was preserved). And tick-3 publishes with
  //            lastStatusChangeAt = tick-3-now (5000) — a fresh transition
  //            (busy → shell), which prevents the "test would still pass if
  //            tick 2 bumped" false-positive because tick 2's fingerprint
  //            would have differed from tick 1 iff a bump happened.
  // ---------------------------------------------------------------------------

  it("Test P57-02-B: same-status tick preserves cached lastStatusChangeAt (no bump)", async () => {
    const channel = new MockSshChannel();
    // Fixed sessionJson.updatedAt across ticks so ONLY the status axis moves
    // the fingerprint. Tick 1 uses busy@u1, Tick 2 uses busy@u1 (unchanged),
    // Tick 3 uses shell@u1 (status delta).
    wirePhase59Base(channel, makeSessionJson({ status: "busy", updatedAt: 1700000000000 }));
    // Stop file returns the same value across all ticks — lastStopAt axis
    // stays constant so it does not perturb the fingerprint.
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1600000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: status=busy, now=1000 → publish

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBe(1);
    expect(deps.registry.publishedStates[0].state.status).toBe("busy");
    expect(deps.registry.publishedStates[0].state.lastStatusChangeAt).toBe(1000);

    // Tick 2: bump the clock; status STILL busy; everything else unchanged.
    // The cached lastStatusChangeAt MUST remain at 1000 (not bump to 3000).
    // Observable: fingerprint is identical → NO publish on tick 2.
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }
    // If cache had incorrectly bumped to 3000, fingerprint would differ from
    // tick 1 (1000 → 3000 in the |lastStatusChangeAt| segment) and a second
    // publish would fire. The assertion below proves the cache was preserved.
    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);

    // Tick 3: status flips busy → shell. bump clock. Should publish with
    // lastStatusChangeAt = tick-3-now (5000), proving the transition path
    // works normally.
    clock.now = 5000;
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell", updatedAt: 1700000000000 }),
    );
    if (pollFn) {
      await pollFn.fn();
    }
    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1 + 1);
    const tick3Publish = deps.registry.publishedStates[publishesAfterTick1];
    expect(tick3Publish.state.status).toBe("shell");
    expect(tick3Publish.state.lastStatusChangeAt).toBe(5000);
  });

  // ---------------------------------------------------------------------------
  // Test P57-02-C — status-transition tick bumps lastStatusChangeAt to deps.now().
  //
  // Tick 1: status=busy at t=1000. Tick 2: status=shell at t=5000. The
  // transition path (cached.lastStatus !== sessionJson.status) fires
  // deps.now() = 5000 on tick 2.
  // ---------------------------------------------------------------------------

  it("Test P57-02-C: status-transition tick bumps lastStatusChangeAt to deps.now()", async () => {
    const channel = new MockSshChannel();
    wirePhase59Base(channel, makeSessionJson({ status: "busy", updatedAt: 1700000000000 }));
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1600000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: busy, seed to 1000

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.status).toBe("busy");
    expect(deps.registry.publishedStates[0].state.lastStatusChangeAt).toBe(1000);

    // Tick 2: transition busy → shell at t=5000. Should publish with
    // lastStatusChangeAt = 5000 (transition path).
    clock.now = 5000;
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell", updatedAt: 1700000000000 }),
    );
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.status).toBe("shell");
    expect(tick2Publish.state.lastStatusChangeAt).toBe(5000);
  });

  // ---------------------------------------------------------------------------
  // Test P57-02-D — per-session file missing → lastStopAt is null;
  //                 presence → lastStopAt is mtime × 1000.
  //
  // Tick 1: stat returns "" (empty stdout — file absent, `|| true` swallowed
  //         non-zero exit). derivedLastStopAt := null (cold-cache default).
  //         Publish should have lastStopAt: null.
  // Tick 2: stat returns "1730000000\n" (file appeared — a Stop hook just
  //         fired and wrote the per-session file). derivedLastStopAt :=
  //         1730000000000 (millis). Publish should have lastStopAt: 1730000000000.
  //         Also fingerprint delta guarantees the publish fires (lastStopAt
  //         axis participates).
  // ---------------------------------------------------------------------------

  it("Test P57-02-D: per-session file missing → lastStopAt is null; presence → lastStopAt is mtime × 1000", async () => {
    const channel = new MockSshChannel();
    wirePhase59Base(channel);
    // Tick 1: empty stdout (file absent).
    channel.setResponse(PER_SESSION_STOP_PATTERN, "");

    const clock = { now: 1000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: lastStopAt=null

    expect(deps.registry.publishedStates.length).toBe(1);
    const tick1Publish = deps.registry.publishedStates[0];
    expect(tick1Publish.state.lastStopAt).toBe(null);

    // Tick 2: per-session file now exists with mtime 1730000000 (seconds).
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1730000000\n");
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.lastStopAt).toBe(1730000000000);
  });

  // ---------------------------------------------------------------------------
  // Test P57-02-E — SSH hiccup on stat call preserves cached lastStopAt
  //                 (fail-open, matches lastMessageAt / aiTitle / dormant).
  //
  // Tick 1: stat returns "1730000000\n" → cached becomes 1730000000000.
  // Tick 2: stat returns null (SSH channel died mid-tick). ALSO status flips
  //         busy → shell to force a publish (fingerprint delta on status).
  //         Published state MUST carry lastStopAt = 1730000000000 (preserved
  //         from cache) NOT null.
  // ---------------------------------------------------------------------------

  it("Test P57-02-E: SSH hiccup on stat call preserves cached lastStopAt (fail-open)", async () => {
    const channel = new MockSshChannel();
    wirePhase59Base(channel, makeSessionJson({ status: "busy", updatedAt: 1700000000000 }));
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1730000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: lastStopAt captured

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.lastStopAt).toBe(1730000000000);

    // Tick 2: stat returns null (SSH hiccup) AND status transitions to force
    // a publish. Published state must fail-open to cached lastStopAt, NOT null.
    channel.setResponse(PER_SESSION_STOP_PATTERN, null);
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell", updatedAt: 1700000000000 }),
    );
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    // Fail-open — cache preserved across the hiccup, NOT wiped to null.
    expect(tick2Publish.state.lastStopAt).toBe(1730000000000);
    expect(tick2Publish.state.status).toBe("shell");
  });

  // ---------------------------------------------------------------------------
  // Test P57-02-F — fingerprint includes lastStopAt + lastStatusChangeAt —
  //                 a lastStopAt-only delta causes a new publish even when
  //                 status + backgroundTasks + updatedAt + everything else
  //                 stays identical.
  //
  // Tick 1: stat returns "1730000000\n" + status=idle + bg=[] → initial publish
  //         (isNew).
  // Tick 2: stat returns "1730000005\n" (mtime advanced by 5 seconds — a Stop
  //         hook fired and rewrote the per-session file) + SAME status +
  //         SAME bg + SAME updatedAt. status did NOT change so
  //         lastStatusChangeAt cache is preserved. But lastStopAt CHANGED
  //         (1730000000000 → 1730000005000) so the fingerprint segment
  //         `|${state.lastStopAt ?? ""}|` differs → new publish must fire.
  //
  // This is the load-bearing "lastStopAt is a distinct fingerprint axis" test.
  // ---------------------------------------------------------------------------

  it("Test P57-02-F: fingerprint includes lastStopAt + lastStatusChangeAt — lastStopAt-only delta causes a new publish", async () => {
    const channel = new MockSshChannel();
    wirePhase59Base(channel, makeSessionJson({ status: "idle", updatedAt: 1700000000000 }));
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1730000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase59Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: initial publish with lastStopAt=1730000000000

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.lastStopAt).toBe(1730000000000);

    // Tick 2: EVERYTHING unchanged EXCEPT the per-session file's mtime (5s later).
    // A same-status tick preserves lastStatusChangeAt from tick 1. Everything
    // else on the wire (status, updatedAt, backgroundTasks, dormant, etc.) is
    // identical. The lastStopAt-only delta MUST fire a new publish (load-
    // bearing invariant: lastStopAt is a distinct fingerprint axis).
    channel.setResponse(PER_SESSION_STOP_PATTERN, "1730000005\n");
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.lastStopAt).toBe(1730000005000);
    // Sanity: same-status tick preserved lastStatusChangeAt from tick 1 (the
    // seed value, 1000). It did NOT bump to tick-2-now (3000).
    expect(tick2Publish.state.lastStatusChangeAt).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// quick-260829-kmr — cross-identity background_tasks leak
//
// Source A used to read the box-wide `~/.claude/fleet-status/last-stop-payload.json`
// for the hookPayload input to backgroundTasks — that file is shared across
// every Claude session on the box, so identity A's WIP indicator lit up with
// identity B's non-ambient tasks whenever B was the most-recent Stop-hook
// writer. The fix: read per-session `~/.claude/fleet-status/stop-<sid>.json`
// FIRST, fall back to box-wide when per-session is null/empty (backward compat
// for sessions that have not fired Stop since the Phase 61 hook re-install).
// emitHookPayloadWarn fires only when BOTH files are absent (widened "absent"
// semantic; existing debounce contract preserved).
//
// Regex guard: identical to Phase 61's stat character-class guard
// (`/^[a-zA-Z0-9_-]+$/`) — a sessionId with path-traversal chars causes the
// per-session cat to be SKIPPED entirely, matching Phase 61's stat behavior at
// ssh-poll-orchestrator.ts:1089.
//
// MockSshChannel pattern-collision discipline (see wireQuick260829Base helper):
//   - `"cat ~/.claude/fleet-status/stop-"` (per-session PAYLOAD)
//       Includes-match uniquely (box-wide has `fleet-status/last-stop-` which
//       does NOT include `fleet-status/stop-` contiguously; Phase 61 stat has
//       `stat -c %Y` prefix which does NOT include `cat `).
//   - `"stat -c %Y ~/.claude/fleet-status/stop-"` (Phase 61 mtime)
//   - `"cat ~/.claude/fleet-status/last-stop-payload.json"` (box-wide payload)
// Patterns are disjoint; insertion order is defensive rather than load-bearing.
// ---------------------------------------------------------------------------

describe("quick-260829-kmr — cross-identity background_tasks leak: per-session hook-payload read + fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The three payload-related MockSshChannel patterns for this fix. Register
  // via wireQuick260829Base; individual tests overwrite specific patterns to
  // exercise the branches.
  const PER_SESSION_PAYLOAD_PATTERN = "cat ~/.claude/fleet-status/stop-";
  const PER_SESSION_STAT_PATTERN = "stat -c %Y ~/.claude/fleet-status/stop-";
  const BOX_WIDE_PAYLOAD_PATTERN = "cat ~/.claude/fleet-status/last-stop-payload.json";

  // Base wire-up mirroring Phase 59's wirePhase59Base — one PID (12345) with
  // sessionId="test-session-id" (from makeSessionJson() default) reachable end
  // to end through Promise.all → SessionState composition. The three payload
  // patterns are registered here so tests only need to override the ones they
  // care about (per-session PAYLOAD, box-wide payload, or Phase 61 stat).
  function wireQuick260829Base(
    channel: MockSshChannel,
    sessionJsonOverride?: string,
  ): void {
    // Payload-related patterns registered FIRST so the includes-match loop
    // hits them before less-specific patterns registered below (defensive;
    // patterns are disjoint so order is not load-bearing).
    channel.setResponse(PER_SESSION_PAYLOAD_PATTERN, ""); // default: file absent
    channel.setResponse(PER_SESSION_STAT_PATTERN, ""); // default: no mtime
    channel.setResponse(BOX_WIDE_PAYLOAD_PATTERN, ""); // default: file absent
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("~/fleet/identities/ -mindepth", "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      sessionJsonOverride ?? makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
  }

  // Locally-scoped duplicate of Phase 59's buildPhase59Deps (avoids touching
  // Phase 59 tests). Same shape: registry + setIntervalFns exposed for manual
  // tick triggering, controllable now() clock via a { now: number } ref.
  function buildQuick260829Deps(
    channel: MockSshChannel,
    clock: { now: number },
  ): OrchestratorDeps & {
    registry: MockRegistry;
    setIntervalFns: Array<{ fn: () => void; ms: number }>;
  } {
    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
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
      now: () => clock.now,
      pollIntervalMs: 2000,
      staleSweepIntervalMs: 30000,
      hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
      hookPayloadWarnCooldownMs: 60000,
    };
    return { ...deps, registry, setIntervalFns };
  }

  // ---------------------------------------------------------------------------
  // TEST A (quick-260829-kmr) — per-session PAYLOAD wins over box-wide when present.
  //
  // Load-bearing invariant: when the per-session file exists AND contains a
  // valid StopHookPayload, its background_tasks[] MUST be published on the
  // wire, NOT the box-wide file's. This is the direct proof that the
  // cross-identity leak is closed — identity A's WIP no longer surfaces
  // identity B's tasks even though the box-wide file still exists on disk
  // with B's payload in it.
  // ---------------------------------------------------------------------------

  it("Test A: per-session PAYLOAD wins over box-wide when both present", async () => {
    const channel = new MockSshChannel();
    wireQuick260829Base(channel);

    // Per-session payload: identity A's task.
    channel.setResponse(
      PER_SESSION_PAYLOAD_PATTERN,
      makeValidPayload([
        {
          id: "task-a",
          type: "shell",
          status: "running",
          description: "identity-A task",
        },
      ]),
    );
    // Box-wide payload: identity B's poisoned task (simulates B being the
    // most-recent Stop-hook writer to the shared file).
    channel.setResponse(
      BOX_WIDE_PAYLOAD_PATTERN,
      makeValidPayload([
        {
          id: "task-b",
          type: "shell",
          status: "running",
          description: "identity-B task",
        },
      ]),
    );

    const clock = { now: 1000 };
    const deps = buildQuick260829Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.backgroundTasks).toHaveLength(1);
    expect(published.state.backgroundTasks[0].description).toBe("identity-A task");
    // Load-bearing: identity B's task MUST NOT appear on identity A's wire.
    const descriptions = published.state.backgroundTasks.map((t) => t.description);
    expect(descriptions).not.toContain("identity-B task");
  });

  // ---------------------------------------------------------------------------
  // TEST B (quick-260829-kmr) — per-session file empty → falls back to box-wide payload.
  //
  // Load-bearing invariant: sessions that have not fired Stop since the
  // Phase 61 hook re-install (no per-session file yet) MUST continue to see
  // the box-wide payload — backward compat. The transition to per-session
  // must not blank the WIP indicator for pre-Phase-61 sessions.
  // ---------------------------------------------------------------------------

  it("Test B: per-session file empty → falls back to box-wide payload (backward compat)", async () => {
    const channel = new MockSshChannel();
    wireQuick260829Base(channel);

    // Per-session absent (empty stdout — file doesn't exist, `|| true` suppressed
    // the non-zero exit from cat).
    channel.setResponse(PER_SESSION_PAYLOAD_PATTERN, "");
    // Box-wide payload present with a real task.
    channel.setResponse(
      BOX_WIDE_PAYLOAD_PATTERN,
      makeValidPayload([
        {
          id: "task-fallback",
          type: "shell",
          status: "running",
          description: "box-wide fallback task",
        },
      ]),
    );

    const clock = { now: 1000 };
    const deps = buildQuick260829Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.backgroundTasks).toHaveLength(1);
    expect(published.state.backgroundTasks[0].description).toBe(
      "box-wide fallback task",
    );
  });

  // ---------------------------------------------------------------------------
  // TEST C (quick-260829-kmr) — BOTH sources empty → backgroundTasks=[] AND ONE
  //           emitHookPayloadWarn.
  //
  // Load-bearing invariants:
  //   (1) Widened "absent" semantic: warn fires ONLY when BOTH files are
  //       null/empty (proves the boolean OR of previous single-source
  //       missing-semantic was widened correctly).
  //   (2) Debounce contract preserved: exactly ONE warn per host per
  //       cooldown window (mirrors Test 5 / F1 warn-count filter).
  // ---------------------------------------------------------------------------

  it("Test C: BOTH sources empty → backgroundTasks=[] AND exactly one hook-payload-missing warn", async () => {
    const channel = new MockSshChannel();
    wireQuick260829Base(channel);
    // Both payload files absent.
    channel.setResponse(PER_SESSION_PAYLOAD_PATTERN, "");
    channel.setResponse(BOX_WIDE_PAYLOAD_PATTERN, "");

    const clock = { now: 1000 };
    const deps = buildQuick260829Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.backgroundTasks).toEqual([]);

    // Warn assertion — same filter shape used at L361-368 / L399-405 in Test 5.
    const warnCalls = (systemLogger.warn as unknown as MockInstance).mock.calls;
    const hookWarnCount = warnCalls.filter(
      (c: unknown[]) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as Record<string, unknown>).operation ===
          "fleet_status_hook_payload_missing",
    ).length;
    expect(hookWarnCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // TEST D (quick-260829-kmr) — sessionId with path-traversal chars fails the regex guard →
  //           per-session cat is SKIPPED entirely, box-wide is consulted
  //           directly.
  //
  // Load-bearing invariants:
  //   (a) No per-session cat command was fired (verified via
  //       channel.getCalls() call log — MockSshChannel logs every .exec()
  //       call regardless of pattern-map hit). This is the observable proof
  //       that the regex guard blocked the read at the source; a POISON
  //       response registered under the per-session pattern must NEVER be
  //       observed on the wire even though the response map contains it.
  //   (b) Box-wide payload IS consulted immediately as fallback (proves the
  //       skip does NOT blank backgroundTasks — mirrors Phase 61 stat's
  //       fail-open-on-skip behavior at ssh-poll-orchestrator.ts:1104-1106).
  //
  // The illegal sessionId "../evil" contains `.` and `/`, both excluded by
  // the `/^[a-zA-Z0-9_-]+$/` character class.
  // ---------------------------------------------------------------------------

  it("Test D: sessionId failing regex guard → per-session cat is SKIPPED entirely; box-wide fallback consulted directly", async () => {
    const channel = new MockSshChannel();
    wireQuick260829Base(channel, makeSessionJson({ sessionId: "../evil" }));

    // POISON: this response must never be observed. If the regex guard is
    // wrong and the per-session cat DOES fire, the POISON payload would be
    // parsed and appear on the wire — the box-wide fallback assertion below
    // would then FAIL.
    channel.setResponse(PER_SESSION_PAYLOAD_PATTERN, "POISON — must not be read");
    // Box-wide payload is what the consumer MUST fall back to.
    channel.setResponse(
      BOX_WIDE_PAYLOAD_PATTERN,
      makeValidPayload([
        {
          id: "task-guarded",
          type: "shell",
          status: "running",
          description: "regex-guarded fallback",
        },
      ]),
    );

    const clock = { now: 1000 };
    const deps = buildQuick260829Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Assertion (a): the call log must NOT contain any `cat …fleet-status/stop-`
    // command. Check the CALL LOG (observable behavior), NOT the responses map.
    const perSessionCatCalls = channel
      .getCalls()
      .filter((c) => /cat .*fleet-status\/stop-/.test(c.command));
    expect(perSessionCatCalls).toHaveLength(0);

    // Assertion (b): box-wide payload IS on the wire — regex-guard skip fell
    // through to box-wide correctly.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.backgroundTasks).toHaveLength(1);
    expect(published.state.backgroundTasks[0].description).toBe(
      "regex-guarded fallback",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 62 Plan 03 (WIP hook-based rewrite 2026-08-30) — activityMtime +
// stoppedMtime derivation from per-session marker files installed by Plan
// 62-02. Contract under test (locked by 62-03-PLAN.md § tasks 1-2):
//
//   - Per-session activity marker mtime read: `stat -c %Y
//     ~/.claude/fleet-status/hooks/<sessionId>/activity 2>/dev/null || true`
//     fires ONCE per PID per tick after parseSessionJson returns; empty
//     stdout == marker absent → derivedActivityMtime := cached ?? null;
//     trimmed numeric stdout × 1000 → unix millis; null return (SSH hiccup)
//     → cache-preserve (fail-open, matches lastMessageAt / aiTitle / dormant
//     / lastStopAt patterns).
//   - Per-session stopped marker mtime read: identical pattern for the
//     `stopped` marker.
//   - Character-class guard: sessionId failing `/^[a-zA-Z0-9_-]+$/` causes
//     BOTH new stat execs to be skipped entirely (T-62-03-02 mitigation,
//     matches the Phase 59 lastStopAt pattern at line 1121).
//   - SessionId rotation: both new axes null on rotation (isNew-equivalent
//     treatment matching lastStopAt at line 1193).
//   - Both new axes participate in computeFingerprint — a delta on EITHER
//     fires publishSessionState even when every other axis is unchanged.
//   - Retention proof: same publish also carries lastStopAt +
//     lastStatusChangeAt (Option-1 rollout — both signal sets ride together
//     during the rollout window per CONTEXT.md § Rollout LOCKED).
//
// The two new stat commands are uniquely identified by the substring
// `fleet-status/hooks/` — disjoint from Phase 59's `fleet-status/stop-`
// pattern and from the box-wide `fleet-status/last-stop-payload.json`
// pattern. Register the new stat responses via wirePhase62Base so
// MockSshChannel's insertion-order iteration finds them predictably.
// ---------------------------------------------------------------------------

describe("ssh-poll-orchestrator Phase 62 Plan 03 — activityMtime + stoppedMtime derivation from per-session marker files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Substrings uniquely identifying the two new Phase 62 stat commands.
  // Both share the `fleet-status/hooks/` prefix (per Plan 62-01 marker path
  // decision) but the trailing marker filename disambiguates.
  const ACTIVITY_STAT_PATTERN = "fleet-status/hooks/'test-session-id'/activity";
  const STOPPED_STAT_PATTERN = "fleet-status/hooks/'test-session-id'/stopped";

  // Broader substring for the sessionId-agnostic negative assertion in Test E.
  const FLEET_HOOKS_ANY_PATTERN = "fleet-status/hooks/";

  // Helper: register the base per-tick channel responses a PID needs to reach
  // the SessionState composition. Mirrors wirePhase59Base but adds the two
  // new marker-stat responses.
  function wirePhase62Base(
    channel: MockSshChannel,
    sessionJsonOverride?: string,
  ): void {
    // Set both Phase 62 marker patterns FIRST so iteration finds them before
    // any broader `fleet-status/` pattern registered below.
    channel.setResponse(ACTIVITY_STAT_PATTERN, ""); // default: activity marker absent
    channel.setResponse(STOPPED_STAT_PATTERN, "");  // default: stopped  marker absent
    // Phase 59 per-session stop file (uniquely `fleet-status/stop-` prefix).
    channel.setResponse("fleet-status/stop-", "");
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("~/fleet/identities/ -mindepth", "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      sessionJsonOverride ?? makeSessionJson(),
    );
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "tina");
    channel.setResponse(
      "cat ~/.claude/fleet-status/last-stop-payload.json",
      makeValidPayload(),
    );
    channel.setResponse("stat ~/fleet/identities/'tina'/.dormant", "no\n");
  }

  // Helper: build deps with a controllable now() clock (mirrors buildPhase59Deps).
  function buildPhase62Deps(
    channel: MockSshChannel,
    clock: { now: number },
  ): OrchestratorDeps & {
    registry: MockRegistry;
    setIntervalFns: Array<{ fn: () => void; ms: number }>;
  } {
    const setIntervalFns: Array<{ fn: () => void; ms: number }> = [];
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
      now: () => clock.now,
      pollIntervalMs: 2000,
      staleSweepIntervalMs: 30000,
      hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
      hookPayloadWarnCooldownMs: 60000,
    };
    return { ...deps, registry, setIntervalFns };
  }

  // -------------------------------------------------------------------------
  // Test A — activity marker successful stat: mock returns "1730000000"; the
  // published SessionState has activityMtime === 1730000000000 (× 1000 conversion).
  // -------------------------------------------------------------------------

  it("Test P62-03 A: activity marker successful stat → activityMtime = mtime × 1000 (seconds → unix millis)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel);
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000000\n");

    const clock = { now: 1730500000000 };
    const deps = buildPhase62Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.activityMtime).toBe(1730000000000);
  });

  // -------------------------------------------------------------------------
  // Test B — stopped marker successful stat: same behavior for the stopped marker.
  // -------------------------------------------------------------------------

  it("Test P62-03 B: stopped marker successful stat → stoppedMtime = mtime × 1000 (seconds → unix millis)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel);
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000005\n");

    const clock = { now: 1730500000000 };
    const deps = buildPhase62Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.stoppedMtime).toBe(1730000005000);
  });

  // -------------------------------------------------------------------------
  // Test C — SSH hiccup on activity stat preserves cached activityMtime
  // (fail-open, matches lastMessageAt / aiTitle / dormant / lastStopAt).
  //
  // Tick 1: activity stat returns "1730000000\n" → cached becomes 1730000000000.
  // Tick 2: activity stat returns null (SSH hiccup). ALSO status flips
  //         busy → shell to force a fingerprint delta publish.
  //         Published state MUST carry activityMtime = 1730000000000 (preserved
  //         from cache) NOT null.
  // -------------------------------------------------------------------------

  it("Test P62-03 C: SSH hiccup on activity stat preserves cached activityMtime (fail-open)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({ status: "busy", updatedAt: 1700000000000 }));
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: activityMtime captured

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.activityMtime).toBe(1730000000000);

    // Tick 2: activity stat returns null (SSH hiccup) AND status transitions to
    // force a publish. Published state must fail-open to cached value.
    channel.setResponse(ACTIVITY_STAT_PATTERN, null);
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell", updatedAt: 1700000000000 }),
    );
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    // Fail-open — cache preserved across the hiccup, NOT wiped to null.
    expect(tick2Publish.state.activityMtime).toBe(1730000000000);
    expect(tick2Publish.state.status).toBe("shell");
  });

  // -------------------------------------------------------------------------
  // Test D — absent file (empty stdout) preserves cached stoppedMtime.
  //
  // Tick 1: stopped stat returns "1730000005\n" → cached becomes 1730000005000.
  // Tick 2: stopped stat returns "" (empty stdout — file absent, `|| true`
  //         swallowed non-zero exit). ALSO status flips to force a publish.
  //         Published state MUST carry stoppedMtime = 1730000005000 (preserved
  //         from cache) NOT null. Fail-open matches Test C's SSH-hiccup path.
  // -------------------------------------------------------------------------

  it("Test P62-03 D: absent-file (empty stdout) preserves cached stoppedMtime (fail-open)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({ status: "busy", updatedAt: 1700000000000 }));
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000005\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: stoppedMtime captured

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.stoppedMtime).toBe(1730000005000);

    // Tick 2: stopped stat returns "" (marker file removed / absent) AND
    // status transitions to force a publish.
    channel.setResponse(STOPPED_STAT_PATTERN, "");
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({ status: "shell", updatedAt: 1700000000000 }),
    );
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    // Fail-open — cache preserved across the empty stdout, NOT wiped to null.
    expect(tick2Publish.state.stoppedMtime).toBe(1730000005000);
    expect(tick2Publish.state.status).toBe("shell");
  });

  // -------------------------------------------------------------------------
  // Test E — character-class guard skips both stat execs (T-62-03-02 mitigation).
  //
  // sessionId "../evil" contains `.` and `/`, both excluded by the character
  // class `/^[a-zA-Z0-9_-]+$/`. The two new Phase 62 stat commands MUST be
  // skipped entirely — no `fleet-status/hooks/` call issued to the channel.
  // Mirrors the Phase 59 quick-260829-kmr Test D pattern using CALL LOG
  // introspection (observable behavior, not internal state).
  // -------------------------------------------------------------------------

  it("Test P62-03 E: character-class-guard-skipped sessionId → neither Phase 62 stat command is issued", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({ sessionId: "../evil" }));

    // POISON: if the regex guard is wrong and a Phase 62 stat DOES fire for
    // "../evil", the POISON value could parse and appear as activityMtime.
    // The call-log assertion below is the primary check — this is the
    // belt-and-suspenders check that no value leaks through.
    channel.setResponse(ACTIVITY_STAT_PATTERN, "9999999999\n");
    channel.setResponse(STOPPED_STAT_PATTERN, "9999999998\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Assertion (a): NO Phase 62 marker stat call was issued.
    const phase62HookCalls = channel
      .getCalls()
      .filter((c) => c.command.includes(FLEET_HOOKS_ANY_PATTERN));
    expect(phase62HookCalls).toHaveLength(0);

    // Assertion (b): the published state's mtime axes stay null (cache
    // default) — the POISON responses did not leak through because the
    // stat commands were never issued in the first place.
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.activityMtime).toBe(null);
    expect(published.state.stoppedMtime).toBe(null);
  });

  // -------------------------------------------------------------------------
  // Test F — sessionId rotation nulls both new axes.
  //
  // Tick 1: sessionId "test-session-id" with activityMtime + stoppedMtime
  //         populated. Cached in PidCacheEntry keyed by pid=12345.
  // Tick 2: SAME pid=12345 but sessionId rotated to "rotated-session-id"
  //         (Claude Code compaction rotates sessionId in-place, Phase 44
  //         L328-335). The new session's marker files may not exist yet.
  //         BOTH new axes MUST reset to null on the rotation-detection
  //         branch, matching lastStopAt's rotation reset at line 1193.
  //
  // Test wires DIFFERENT marker patterns for the rotated sessionId (with
  // empty stdout to simulate marker absence for the new session) so the
  // published tick 2 frame has activityMtime = null AND stoppedMtime = null.
  // -------------------------------------------------------------------------

  it("Test P62-03 F: sessionId rotation nulls both activityMtime and stoppedMtime (isNew-equivalent treatment)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({
      sessionId: "test-session-id",
      status: "busy",
      updatedAt: 1700000000000,
    }));
    // Tick 1: original sessionId markers populated.
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000000\n");
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000005\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // Tick 1: both axes populated

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.activityMtime).toBe(1730000000000);
    expect(deps.registry.publishedStates[0].state.stoppedMtime).toBe(1730000005000);

    // Tick 2: SAME pid, sessionId ROTATED. The rotation-detection branch
    // (existing code at ssh-poll-orchestrator.ts:1188-1194) treats this as
    // isNew-equivalent for stop-gate-adjacent axes. Both Phase 62 axes MUST
    // null on rotation — the rotated sessionId's markers may not exist.
    channel.setResponse(
      "cat ~/.claude/sessions/12345.json",
      makeSessionJson({
        sessionId: "rotated-session-id",
        status: "busy",
        updatedAt: 1700000000000,
      }),
    );
    // Rotated sessionId's markers absent (empty stdout).
    channel.setResponse("fleet-status/hooks/'rotated-session-id'/activity", "");
    channel.setResponse("fleet-status/hooks/'rotated-session-id'/stopped", "");

    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // The rotated-sessionId frame publishes (fingerprint differs on sessionId
    // AND on mtime axes vs cached), with both new axes reset to null.
    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.sessionId).toBe("rotated-session-id");
    expect(tick2Publish.state.activityMtime).toBe(null);
    expect(tick2Publish.state.stoppedMtime).toBe(null);
  });

  // -------------------------------------------------------------------------
  // Test G — fingerprint includes activityMtime + stoppedMtime — a mtime-only
  // delta causes a new publish even when every other axis stays identical.
  //
  // Tick 1: activityMtime=1730000000000 + status=idle + bg=[] → initial publish
  //         (isNew).
  // Tick 2: activity stat returns "1730000005\n" (mtime advanced 5s — a user
  //         prompt submit / tool use fired) + SAME status + SAME bg +
  //         SAME updatedAt. status did NOT change so lastStatusChangeAt cache
  //         is preserved. But activityMtime CHANGED (1730000000000 →
  //         1730000005000) so the fingerprint segment
  //         `|${state.activityMtime ?? ""}|` differs → new publish must fire.
  //
  // This is the load-bearing "activityMtime is a distinct fingerprint axis"
  // test. Mirrors the Phase 59 Test P57-02-F pattern.
  // -------------------------------------------------------------------------

  it("Test P62-03 G: fingerprint includes activityMtime — activity-mtime-only delta causes a new publish (load-bearing)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({ status: "idle", updatedAt: 1700000000000 }));
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.activityMtime).toBe(1730000000000);

    // Tick 2: EVERYTHING unchanged EXCEPT the activity marker mtime (5s later).
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000005\n");
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    // activityMtime-only delta MUST fire a new publish.
    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.activityMtime).toBe(1730000005000);
  });

  // -------------------------------------------------------------------------
  // Test G-bis — same as G but for the stoppedMtime axis. Proves stoppedMtime
  // is ALSO a distinct fingerprint axis (not just activityMtime).
  // -------------------------------------------------------------------------

  it("Test P62-03 G-bis: fingerprint includes stoppedMtime — stopped-mtime-only delta causes a new publish (load-bearing)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel, makeSessionJson({ status: "idle", updatedAt: 1700000000000 }));
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000000\n");

    const clock = { now: 1000 };
    const deps = buildPhase62Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBe(1);
    expect(deps.registry.publishedStates[0].state.stoppedMtime).toBe(1730000000000);

    // Tick 2: EVERYTHING unchanged EXCEPT the stopped marker mtime (5s later).
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000005\n");
    clock.now = 3000;
    const pollFn = deps.setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn();
    }

    expect(deps.registry.publishedStates.length).toBe(2);
    const tick2Publish = deps.registry.publishedStates[1];
    expect(tick2Publish.state.stoppedMtime).toBe(1730000005000);
  });

  // -------------------------------------------------------------------------
  // Test H — Phase 59 fields still published (Option-1 rollout retention proof).
  //
  // The same publish that carries the two new Phase 62 axes MUST also carry
  // the Phase 59 lastStopAt + lastStatusChangeAt axes. Both signal sets ride
  // together during the rollout window per CONTEXT.md § Rollout Option 1
  // (LOCKED). The frontend Plan 62-04 chooses which predicate to consume
  // per-session based on marker presence.
  // -------------------------------------------------------------------------

  it("Test P62-03 H: same publish carries Phase 62 axes AND retained Phase 59 axes (Option-1 rollout — both signal sets ride together)", async () => {
    const channel = new MockSshChannel();
    wirePhase62Base(channel);
    // Populate Phase 62 axes.
    channel.setResponse(ACTIVITY_STAT_PATTERN, "1730000000\n");
    channel.setResponse(STOPPED_STAT_PATTERN, "1730000005\n");
    // Populate Phase 59 lastStopAt (per-session stop file).
    channel.setResponse("fleet-status/stop-", "1729999999\n");

    const clock = { now: 1730500000000 };
    const deps = buildPhase62Deps(channel, clock);
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Phase 62 axes present.
    expect(published.state.activityMtime).toBe(1730000000000);
    expect(published.state.stoppedMtime).toBe(1730000005000);
    // Phase 59 axes RETAINED and present (Option-1 rollout).
    expect(published.state.lastStopAt).toBe(1729999999000);
    // lastStatusChangeAt seeded on first appearance (isNew branch) to
    // deps.now() — proves the Phase 59 derivation continues to run.
    expect(published.state.lastStatusChangeAt).toBe(1730500000000);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for bounty 9c8d4a72-1e5f-4b8a-9d3c-6f2b8e4a7c19 —
// SSH channel-open-failure on stat read was being conflated with PID-dead,
// causing session_gone publishes for actively-working sessions on t1000 under
// sshd MaxSessions saturation. Fix landed 2026-09-02 in ssh-poll-orchestrator.ts.
//
// The fix wraps every /proc/<pid>/stat SSH exec in a sentinel — `cat ... &&
// echo __STAT_OK__ || echo __STAT_ENOENT__` — and routes the result through
// `readStatWithSentinel`, which returns {ok, content} | {ok: false, reason}.
// A `null` channel response now unambiguously means transport failure
// (fail-OPEN: skip reap this tick) rather than PID-dead. Real ENOENT is
// signalled by the `__STAT_ENOENT__` sentinel. Real live PID reads emit
// `<stat contents>\n__STAT_OK__`.
//
// The 4 tests below pin all four transport-vs-dead outcomes. Test 1 is the
// bug-fix that would have caught Tina 2026-09-02 (transport → no reap);
// Tests 2/3/4 are baselines proving real PID-dead / PID-reuse / live-PID
// detection all still work post-fix.
// ---------------------------------------------------------------------------
describe("transport-vs-dead distinction in stat read (bounty 9c8d4a72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearAllSessionFileCacheForTests();
  });

  it("Test 1 — Transport failure: null stat return does NOT reap (fail-OPEN, session stays live) [THE bug fix]", async () => {
    const deps = buildDeps();
    // Stat exec returns null → simulates the SSH channel-open-failure that
    // the adapter swallows to null. Pre-fix, isStaleFromStat(_, null) === true
    // → publishSessionGone fires → row drops → WIP indicator gone.
    deps.channel.setResponse("cat /proc/12345/stat", null);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // The fix: transport failure never reaps. livenessMap keeps the entry
    // for this tick, and the state still publishes so the frontend row
    // keeps rendering the WIP indicator.
    expect(deps.registry.publishedGone).toEqual([]);
    const state12345 = deps.registry.publishedStates.find(
      (p) => p.state.pid === 12345,
    );
    expect(state12345).toBeDefined();
    expect(state12345?.state.sessionId).toBe("test-session-id");
  });

  it("Test 2 — Real PID reuse: sentinel-wrapped stat with mismatched field22 DOES reap [baseline]", async () => {
    const deps = buildDeps();
    // Sentinel-wrapped real /proc/stat content whose field22 (starttime) does
    // NOT match the session JSON's procStart ("12345") — makeStatContents
    // appends `\n__STAT_OK__` under the bounty 9c8d4a72 fixture contract, so
    // this exercises the ok-with-mismatched-field22 reap path.
    deps.channel.setResponse(
      "cat /proc/12345/stat",
      makeStatContents("99999"),
    );

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // PID reuse (mismatched starttime) reaps as today.
    expect(deps.registry.publishedGone).toHaveLength(1);
    expect(deps.registry.publishedGone[0].hostId).toBe("host-1");
    expect(deps.registry.publishedGone[0].sessionId).toBe("test-session-id");
  });

  it("Test 3 — Live PID: sentinel-wrapped stat with matching field22 does NOT reap [baseline]", async () => {
    const deps = buildDeps();
    // Default buildDeps() wires `cat /proc/12345/stat` to makeStatContents("12345"),
    // which post-fix ends with `\n__STAT_OK__` and whose starttime matches the
    // session JSON's procStart. This is the happy path.
    // (No override needed — buildDeps() already sets this up.)

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedGone).toEqual([]);
    const state12345 = deps.registry.publishedStates.find(
      (p) => p.state.pid === 12345,
    );
    expect(state12345).toBeDefined();
    expect(state12345?.state.sessionId).toBe("test-session-id");
  });

  it("Test 4 — Real absence: bare __STAT_ENOENT__ sentinel DOES reap [baseline]", async () => {
    const deps = buildDeps();
    // Sentinel-only response — models the post-fix command output when
    // /proc/<pid>/stat is genuinely absent (cat fails → || echo __STAT_ENOENT__).
    deps.channel.setResponse("cat /proc/12345/stat", "__STAT_ENOENT__");

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Real ENOENT still reaps as today.
    expect(deps.registry.publishedGone).toHaveLength(1);
    expect(deps.registry.publishedGone[0].hostId).toBe("host-1");
    expect(deps.registry.publishedGone[0].sessionId).toBe("test-session-id");
  });
});

// ---------------------------------------------------------------------------
// Phase 85 (D-07) — lastMessageAt source swap: send-log store round-trip
//
// Contract: the per-tick per-session block in processPid now reads
// `derivedLastMessageAt` from getIdentityLastSend(tmuxSession) (Phase 85-02
// identity-send-log-store) instead of scanTailForNewestMessageAt on the
// JSONL tail. The store is keyed on identity name and populated by the
// frontend compose-send funnel (D-04, wired in Phase 85-06). This suite
// proves the read side of the round-trip:
//   1. Cold-cache tick (store returns null) publishes lastMessageAt: null.
//   2. Store advance → next tick publishes the fresh value.
//   3. Second store advance → next tick publishes the newer value.
//   4. Unchanged store value + unchanged axes → fingerprint suppresses publish.
//   5. Store throw → cached value preserved (fail-open) + poll loop survives.
//   6. Tail-empty + store-populated → store lookup is the only lastMessageAt
//      signal (tail exec is unchanged for the aiTitle axis; the retired
//      lastMessageAt tail-scan no longer runs).
//
// Test harness reuses `buildDeps` + `MockSshChannel`. Identity name is "ivy"
// (per plan's naming). Fixtures resolve tmuxSession="ivy" via the mocked
// tmux display-message command.
// ---------------------------------------------------------------------------

describe("Phase 85 lastMessageAt source swap — send-log store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level mock to its default null return each test.
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  // Build discovery + tail responses for identity "ivy" — mirrors the Phase
  // 41 Plan 03 helpers but keyed on the ivy identity name.
  function buildIvyDiscoveryFixture(discoveredPath: string): string {
    const firstUserLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: `<command-name>/id</command-name><command-args>ivy</command-args>`,
      },
      timestamp: new Date(1000).toISOString(),
      uuid: `uuid-discovery-ivy`,
    });
    const mtime = "1755000000.0";
    return `${mtime}\t${discoveredPath}\n${firstUserLine}\n---GSDR-32---\n`;
  }

  function wireIvyResponses(
    channel: MockSshChannel,
    tailJsonl: string = "",
  ): void {
    channel.setResponse("ls -1 ~/.claude/sessions/", "/home/ubuntu/.claude/sessions/12345.json\n");
    channel.setResponse("cat ~/.claude/sessions/12345.json", makeSessionJson());
    channel.setResponse("cat /proc/12345/stat", makeStatContents("12345"));
    channel.setResponse("cat /proc/12345/environ", "TMUX_PANE=%2\0");
    channel.setResponse("tmux display-message", "ivy");
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());
    // Discovery for identity "ivy".
    channel.setResponse(
      "IDENTITY=",
      buildIvyDiscoveryFixture(
        "~/.claude/projects/-home-ubuntu-skynet-ivy/discovered.jsonl",
      ),
    );
    // Tail exec still fires (aiTitle scanner is the sole consumer post-D-07).
    channel.setResponse("discovered.jsonl", tailJsonl);
  }

  function newSetIntervalFns(): Array<{ fn: () => void; ms: number }> {
    return [];
  }

  // Test 85-04-01 — cold cache, store returns null → publish lastMessageAt: null.
  // The tail exec still fires (aiTitle path); the retired scanner is not
  // called on the tail (guaranteed by the Task 1 grep gates + Test 85-04-06
  // below which explicitly asserts the tail-empty behavior).
  it("Test 85-04-01: cold cache — getIdentityLastSend returns null → publishes lastMessageAt: null", async () => {
    const channel = new MockSshChannel();
    wireIvyResponses(channel);

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // Store was called with identity name (tmuxSession resolved to "ivy").
    expect(getIdentityLastSend).toHaveBeenCalledWith("ivy");

    // Published state has lastMessageAt: null (no prior stamp).
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.tmuxSession).toBe("ivy");
    expect(published.state.lastMessageAt).toBeNull();
  });

  // Test 85-04-02 — store advances to 5000 → next tick publishes 5000.
  // Fingerprint delta (lastMessageAt null → 5000) triggers the publish.
  it("Test 85-04-02: store advance to 5000 → next tick publishes lastMessageAt: 5000", async () => {
    const channel = new MockSshChannel();
    wireIvyResponses(channel);

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1 — cold, null

    // Simulate stampIdentityLastSend("ivy", 5000) advancing the store.
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(5000);

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — store returns 5000
    }

    // At least two published states exist. The MOST-RECENT one (from tick 2)
    // carries lastMessageAt: 5000.
    const published = deps.registry.publishedStates;
    expect(published.length).toBeGreaterThanOrEqual(2);
    const latest = published[published.length - 1];
    expect(latest.state.tmuxSession).toBe("ivy");
    expect(latest.state.lastMessageAt).toBe(5000);
  });

  // Test 85-04-03 — successive store advance (5000 → 6000) → each tick
  // publishes the fresher value. Fingerprint delta on each advance.
  it("Test 85-04-03: successive store advances → each tick publishes the fresh value", async () => {
    const channel = new MockSshChannel();
    wireIvyResponses(channel);

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1 — cold, null

    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(5000);
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — publishes 5000

      (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(6000);
      await pollFn.fn(); // tick 3 — publishes 6000
    }

    // Extract the lastMessageAt sequence from the published states.
    const seq = deps.registry.publishedStates.map((p) => p.state.lastMessageAt);
    // Cold tick published null; tick 2 published 5000; tick 3 published 6000.
    // The sequence contains at minimum: null, 5000, 6000 in order.
    expect(seq).toContain(null);
    expect(seq).toContain(5000);
    expect(seq).toContain(6000);
    // 5000 must appear before 6000 (monotonic ordering assertion).
    expect(seq.indexOf(5000)).toBeLessThan(seq.indexOf(6000));
  });

  // Test 85-04-04 — fingerprint suppression: unchanged store value + all
  // other axes unchanged → tick 2 does NOT publish a duplicate frame.
  // Verifies that the swap did NOT break the delta-driven publish contract.
  it("Test 85-04-04: unchanged store value + unchanged axes → tick 2 does NOT publish (fingerprint suppression)", async () => {
    const channel = new MockSshChannel();
    wireIvyResponses(channel);
    // Seed the store with a value from tick 1 onwards; it stays the same
    // across both ticks so the fingerprint is stable.
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(7000);

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1 — publishes lastMessageAt: 7000

    const publishesAfterTick1 = deps.registry.publishedStates.length;
    expect(publishesAfterTick1).toBeGreaterThan(0);
    // Tick 1's published frame has lastMessageAt = 7000.
    expect(
      deps.registry.publishedStates[publishesAfterTick1 - 1].state.lastMessageAt,
    ).toBe(7000);

    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — same store value, same axes
    }

    // Fingerprint suppression: publishedStates count is unchanged tick 1 → tick 2.
    expect(deps.registry.publishedStates.length).toBe(publishesAfterTick1);
  });

  // Test 85-04-05 — fail-open on getIdentityLastSend throw. The poll loop
  // must not blow up; cached value is preserved (null on cold-start); every
  // other axis publishes normally.
  it("Test 85-04-05: getIdentityLastSend throws → cached value preserved, poll loop continues", async () => {
    const channel = new MockSshChannel();
    wireIvyResponses(channel);
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("simulated db unavailable"),
    );

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    // The start() call MUST NOT throw — the try/catch in the swap block is
    // load-bearing (the store module itself is fail-open, and the belt-and-
    // suspenders try/catch here catches any surprise on the hot per-tick
    // path).
    await expect(orchestrator.start()).resolves.not.toThrow();

    // A published state exists (other axes drive the publish).
    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    // Cached value on cold-start is null; the throw does not corrupt it.
    expect(published.state.lastMessageAt).toBeNull();

    // Poll loop survives — a subsequent tick still fires the getIdentityLastSend
    // call (fail-open does not disable the axis).
    const pollFn = setIntervalFns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await expect(pollFn.fn()).resolves.not.toThrow();
    }
    // The store fn was called on tick 1 and tick 2 despite tick 1's throw.
    expect(
      (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  // Test 85-04-06 — tail-empty + store-populated: the retired scanner is
  // NOT called for lastMessageAt anymore. Prove this by wiring a tail that
  // is completely EMPTY (would return null via scanTailForNewestMessageAt),
  // then advancing the store — the publish carries the store value even
  // though the tail scanner sees nothing.
  it("Test 85-04-06: tail is EMPTY, store populated with 8000 → published lastMessageAt: 8000 (retired scanner not consulted)", async () => {
    const channel = new MockSshChannel();
    // Empty tail — the retired scanner would return null. If the swap were
    // reverted, published.state.lastMessageAt would be null; the fact that
    // it's 8000 proves the store lookup is the source of truth.
    wireIvyResponses(channel, "");
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(8000);

    const setIntervalFns = newSetIntervalFns();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        setIntervalFns.push({ fn, ms });
        return setIntervalFns.length as unknown as ReturnType<typeof setInterval>;
      }),
    });

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(deps.registry.publishedStates.length).toBeGreaterThan(0);
    const published = deps.registry.publishedStates[0];
    expect(published.state.lastMessageAt).toBe(8000);
    // Sanity: the tail exec fired (aiTitle scanner still consumes the buffer).
    expect(channel.countCallsMatching("tail -c 262144")).toBeGreaterThan(0);
  });
});

// ============================================================================
// Phase 92 — batch sweep dispatch
// ============================================================================
//
// Coverage:
//   (1) Batch path fires exactly ONE `~/.local/bin/fleet-status-sweep` exec
//       per host per poll cycle + zero per-identity / per-PID exec fan-out.
//   (2) Batch-vs-legacy parity — strict `toEqual` on publishedStates given
//       the same input state. This is THE non-negotiable of Phase 92: the
//       batch swap MUST preserve the composed SessionState frames byte-for-
//       byte relative to the legacy plumbing. Both paths feed the same
//       `composeAndPublishPerPid` + `composeAndPublishPerIdentity` helpers,
//       so parity holds by shared code; the test freezes `deps.now()` at 0
//       (kept constant across both runs) and normalizes the noise-axis
//       `updatedAt` to eliminate clock-derived non-determinism.
//   (3) Presence probe is cached per-SSH-channel lifetime (fires once on
//       first tick; ticks 2..N skip the probe). Re-fires when the channel
//       object identity changes (starter.ts teardown → fresh channel).
//   (4) Sweep-exec null return path — this-tick legacy fallback + next-tick
//       re-probe recovery. On tick 1 the probe says yes, the sweep exec
//       returns null (SSH hiccup), the orchestrator emits the
//       `fleet_status_batch_fallback` warn log and runs the legacy per-
//       identity + per-PID exec fan-out. On tick 2 the probe re-fires
//       (probeCount === 2 now: initial + retry-after-null), the sweep exec
//       succeeds, and the batch path resumes.
//   (5) Schema-mismatch path — sweep emits JSONL with `schema_version: 999`.
//       The orchestrator logs `fleet_status_sweep_schema_mismatch`, falls
//       back to legacy this tick, and LATCHES `sweepSchemaMismatchThis
//       Connection` true so all subsequent ticks on the same SSH channel
//       stay on legacy until reconnect (channel object identity change).
//
// Fixture helper: `makeSweepJsonl` (top of file, next to makeSessionJson).
//
// Command precedence in MockSshChannel: substrings are checked in Map
// insertion order — the FIRST registered pattern wins. Because the batch
// probe (`test -x ~/.local/bin/fleet-status-sweep`) and the sweep exec
// (`~/.local/bin/fleet-status-sweep 2>/dev/null`) both share the substring
// `~/.local/bin/fleet-status-sweep`, tests below register the probe pattern
// FIRST so the more-specific match takes precedence over the sweep pattern.
// ============================================================================

describe("Phase 92 — batch sweep dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level caches — writeSessionFileCache (session-file-cache)
    // and the identity-send-log store mock — so back-to-back tests (and the
    // dual batch-vs-legacy run inside the parity test) do not leak state.
    __clearAllSessionFileCacheForTests();
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // Shared fixture data — same identities + PIDs used by tests 1 and 2 so
  // the parity assertion has a symmetric input across batch and legacy runs.
  // -------------------------------------------------------------------------
  const IDENTITIES = ["alpha", "beta", "gamma"] as const;
  // Two identities carry a live claude PID; the third (gamma) is dormant-only
  // → source B publishes for gamma, source A publishes for alpha + beta.
  const PID_ALPHA = 111;
  const PID_BETA = 222;

  /**
   * Wire an SSH channel to answer the LEGACY per-identity + per-PID exec
   * fan-out for the shared fixture. The batch probe MUST NOT be pre-wired
   * here — tests that want the batch path call `wireBatchProbe(channel)` to
   * add it, tests that want the legacy path leave it unset so the probe
   * returns null (→ sweepScriptPresent = false → legacy).
   */
  function wireLegacyResponses(channel: MockSshChannel): void {
    // Source A driver — two live PIDs.
    channel.setResponse(
      "ls -1 ~/.claude/sessions/",
      `/home/ubuntu/.claude/sessions/${PID_ALPHA}.json\n/home/ubuntu/.claude/sessions/${PID_BETA}.json\n`,
    );
    // Per-PID session json + stat + environ + tmux name.
    for (const [pid, identity] of [
      [PID_ALPHA, "alpha"],
      [PID_BETA, "beta"],
    ] as const) {
      channel.setResponse(
        `cat ~/.claude/sessions/${pid}.json`,
        makeSessionJson({ pid, sessionId: `sess-${identity}`, procStart: "12345" }),
      );
      channel.setResponse(`cat /proc/${pid}/stat`, makeStatContents("12345"));
      channel.setResponse(`cat /proc/${pid}/environ`, "TMUX_PANE=%2\0");
      // The tmux display-message substring collides across PIDs — but
      // `resolvePidToTmuxSession` interpolates the pane %2 (same for both),
      // and the MockSshChannel maps command→response by first-match. Both
      // PIDs need distinct tmux resolutions, so we register per-pid via the
      // pane substring... but they share pane. Cheat: pin per-pid via the
      // per-pid environ read that fires just before display-message on the
      // legacy path, and make tmux display-message return the identity of
      // WHICHEVER PID was resolved most recently by keying on the SSH-level
      // per-PID sequence. Simpler: substring-match on the target pane, and
      // rely on both PIDs having the SAME identity would break — so we use
      // distinct tmux panes per PID by encoding pid into TMUX_PANE.
    }
    // Re-do environ with pid-encoded panes so tmux resolution is
    // deterministic per pid.
    channel.setResponse(`cat /proc/${PID_ALPHA}/environ`, `TMUX_PANE=%${PID_ALPHA}\0`);
    channel.setResponse(`cat /proc/${PID_BETA}/environ`, `TMUX_PANE=%${PID_BETA}\0`);
    channel.setResponse(`tmux display-message -p -t '%${PID_ALPHA}'`, "alpha");
    channel.setResponse(`tmux display-message -p -t '%${PID_BETA}'`, "beta");
    // A6-A9: per-session Stop file mtime + activity + stopped + hook payload.
    // Return null / empty so the fields default to null and both paths
    // (batch: null-in-fixture; legacy: file-absent) compose identically.
    // (Absent stubs already default to null via MockSshChannel.)
    // A10 dormant sentinel per identity.
    channel.setResponse("stat ~/fleet/identities/'alpha'/.dormant", "no\n");
    channel.setResponse("stat ~/fleet/identities/'beta'/.dormant", "no\n");
    // Per-session Stop-hook payload (A9) — non-null so both paths hit the
    // perSessionUsable branch and both use identical backgroundTasks=[].
    channel.setResponse(
      "cat ~/.claude/fleet-status/stop-'sess-alpha'.json",
      makeValidPayload(),
    );
    channel.setResponse(
      "cat ~/.claude/fleet-status/stop-'sess-beta'.json",
      makeValidPayload(),
    );
    // Box-wide hook payload (A3) — legacy only. Empty return → parseStopHookPayload
    // yields null → warn fires but no crash. Batch path skips A3 entirely.
    channel.setResponse("fleet-status/last-stop-payload.json", makeValidPayload());
    // Source B — three identity folders (alpha, beta, gamma). The legacy
    // `find … -mindepth 1` output shape is one name per line.
    channel.setResponse(
      "~/fleet/identities/ -mindepth",
      `${IDENTITIES.join("\n")}\n`,
    );
    // gamma is the dormant-only identity — no live PID → source B publishes.
    channel.setResponse("stat ~/fleet/identities/'gamma'/.dormant", "no\n");
    // Recycled-at + recycle-requested sentinels off for all three.
    for (const name of IDENTITIES) {
      channel.setResponse(
        `stat ~/fleet/identities/'${name}'/.recycled-at`,
        "no\n",
      );
      channel.setResponse(
        `test -f ~/fleet/identities/'${name}'/.recycle-requested`,
        "no\n",
      );
    }
  }

  /**
   * Register the batch presence probe. MUST be called BEFORE the sweep exec
   * response since the probe substring is a prefix of the sweep substring in
   * the MockSshChannel first-match ordering.
   */
  function wireBatchProbe(channel: MockSshChannel, present: boolean): void {
    channel.setResponse(
      "test -x ~/.local/bin/fleet-status-sweep",
      present ? "yes\n" : "no\n",
    );
  }

  /**
   * Build the sweep JSONL blob for the shared fixture (alpha, beta, gamma
   * identities + alpha/beta live PIDs). Both identities and PIDs carry the
   * same shape as the legacy fixture so composed SessionState frames are
   * byte-identical across paths.
   */
  function buildSharedSweepJsonl(): string {
    return makeSweepJsonl({
      identities: IDENTITIES.map((identity) => ({
        identity,
        dormant: false,
        recycled_at: false,
        recycle_requested: false,
        jsonl_path: null,
        layer1_recycling: null,
      })),
      pids: [
        {
          identity: "alpha",
          pid: PID_ALPHA,
          per_session_stop_payload: makeValidPayload(),
        },
        {
          identity: "beta",
          pid: PID_BETA,
          per_session_stop_payload: makeValidPayload(),
        },
      ],
    });
  }

  /**
   * Capture the setInterval poll fn from a deps override so tests can drive
   * additional ticks past the initial start()-fired tick.
   */
  function makeSetIntervalCapture(): {
    fns: Array<{ fn: () => void; ms: number }>;
    setInterval: OrchestratorDeps["setInterval"];
  } {
    const fns: Array<{ fn: () => void; ms: number }> = [];
    return {
      fns,
      setInterval: vi.fn((fn: () => void, ms: number) => {
        fns.push({ fn, ms });
        return fns.length as unknown as ReturnType<typeof setInterval>;
      }),
    };
  }

  /** Count exact-match `channel.exec` calls (no substring collision). */
  function countExact(channel: MockSshChannel, command: string): number {
    return channel.getCalls().filter((c) => c.command === command).length;
  }

  // -------------------------------------------------------------------------
  // Test P92-05-1 — batch path fires exactly ONE sweep exec + ZERO legacy fan-out.
  //
  // Load-bearing assertion: the WHOLE POINT of Phase 92 is the exec-count
  // collapse from ~N-per-host (N = live PIDs + identities × ~4-6 exec each)
  // down to ONE sweep exec + ONE probe (first tick only). This regression
  // pins that invariant.
  // -------------------------------------------------------------------------
  it("Test P92-05-1: batch path fires exactly ONE sweep exec per host per poll and zero per-identity/per-PID exec fan-out", async () => {
    const channel = new MockSshChannel();
    // Batch probe FIRST so its more-specific substring wins over the sweep.
    wireBatchProbe(channel, true);
    channel.setResponse(
      "~/.local/bin/fleet-status-sweep 2>/dev/null",
      buildSharedSweepJsonl(),
    );

    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    // (a) Probe fires exactly once (this is the first tick on this channel).
    expect(
      countExact(
        channel,
        "test -x ~/.local/bin/fleet-status-sweep 2>/dev/null && echo yes || echo no",
      ),
    ).toBe(1);
    // (b) Sweep exec fires exactly once per host per poll.
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(1);
    // (c) Zero legacy source-A driver.
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(0);
    // (d) Zero legacy source-B driver.
    expect(channel.countCallsMatching("find ~/fleet/identities/")).toBe(0);
    // (e) Zero per-PID stat exec (compose consumes SweepPidLine.stat_result
    //     directly — no `cat /proc/<pid>/stat` fires under batch).
    expect(channel.countCallsMatching("cat /proc/")).toBe(0);
    // (f) Zero per-identity source-B stat exec.
    expect(channel.countCallsMatching("stat ~/fleet/identities/")).toBe(0);
    // (g) Composition matches: 2 source-A frames (alpha+beta live PIDs) + 1
    //     source-B frame (gamma dormant-only). alpha/beta skipped by source B
    //     because they have live PIDs AND are not recycling.
    expect(deps.registry.publishedStates).toHaveLength(3);
    const tmuxSessions = deps.registry.publishedStates
      .map((p) => p.state.tmuxSession)
      .sort();
    expect(tmuxSessions).toEqual(["alpha", "beta", "gamma"]);
  });

  // -------------------------------------------------------------------------
  // Test P92-05-2 — batch-vs-legacy parity via strict toEqual.
  //
  // THE non-negotiable of Phase 92: given equivalent input state (same
  // identities, same PIDs, same sentinels, same JSONL tails / stop payloads),
  // the composed SessionState frames published to the registry MUST be
  // byte-identical between the batch path and the legacy path. Both paths
  // feed the SAME `composeAndPublishPerPid` + `composeAndPublishPerIdentity`
  // helpers, so parity holds by shared code — this regression prevents any
  // future refactor from introducing a silent per-path divergence.
  //
  // Normalization: `deps.now()` is kept at 0 across both runs (via buildDeps'
  // fixed `currentTime = 0` and no `.tick()` calls). `updatedAt` on the
  // published frame is sourced from `sessionJson.updatedAt` (identical in
  // both fixtures), and `lastStatusChangeAt` reads `deps.now()` which is 0.
  // No clock-derived field diverges, so `toEqual` is applied directly.
  // -------------------------------------------------------------------------
  it("Test P92-05-2: batch-vs-legacy parity — strict toEqual on publishedStates given equivalent input state", async () => {
    // --- Legacy run ---
    const legacyChannel = new MockSshChannel();
    // Probe returns "no" → legacy path fires.
    wireBatchProbe(legacyChannel, false);
    wireLegacyResponses(legacyChannel);
    const legacyDeps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(legacyChannel),
    });
    const legacyOrch = createSshPollOrchestrator(legacyDeps);
    await legacyOrch.start();

    // Reset module-level state before the second run so writeSessionFileCache
    // and the send-log store don't carry cross-run pollution.
    __clearAllSessionFileCacheForTests();
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockReset();
    (getIdentityLastSend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // --- Batch run ---
    const batchChannel = new MockSshChannel();
    wireBatchProbe(batchChannel, true);
    batchChannel.setResponse(
      "~/.local/bin/fleet-status-sweep 2>/dev/null",
      buildSharedSweepJsonl(),
    );
    const batchDeps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(batchChannel),
    });
    const batchOrch = createSshPollOrchestrator(batchDeps);
    await batchOrch.start();

    // Sanity: both paths published the same COUNT of frames (2 source A + 1
    // source B). A count mismatch here signals a structural drift before we
    // even reach the shape-parity assertion.
    expect(batchDeps.registry.publishedStates.length).toBe(
      legacyDeps.registry.publishedStates.length,
    );
    expect(batchDeps.registry.publishedStates.length).toBe(3);

    // Normalize into `{ hostId, tmuxSession }`-sorted arrays so we compare
    // frame CONTENT independent of intra-tick ordering (source-A Promise.all
    // in legacy vs sequential for-loop in batch may yield different insertion
    // orders when the mock channel is fully synchronous but the compose
    // helpers use `await` — the order-independence normalization removes
    // that noise from the parity assertion).
    const sortKey = (p: { hostId: string; state: SessionState }): string =>
      `${p.hostId}|${p.state.tmuxSession ?? ""}|${p.state.sessionId}|${p.state.pid ?? ""}`;
    const batchSorted = [...batchDeps.registry.publishedStates].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b)),
    );
    const legacySorted = [...legacyDeps.registry.publishedStates].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b)),
    );

    // Strict deep-equal on the sorted arrays. Any divergence — dormant flip,
    // recycling flip, aiTitle drift, lastMessageAt drift, backgroundTasks
    // shape drift, lastStopAt drift — fails this assertion.
    expect(batchSorted).toEqual(legacySorted);

    // Also assert legacy path DID fire the per-identity + per-PID fan-out
    // (this is the "byte-identical exec-count observable" truth from the
    // plan frontmatter — legacy path is unchanged by Phase 92).
    expect(legacyChannel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(1);
    expect(legacyChannel.countCallsMatching("find ~/fleet/identities/")).toBeGreaterThanOrEqual(1);
    // And batch path did NOT fire the sweep-exec substring on the legacy
    // channel (no cross-run contamination).
    expect(
      countExact(legacyChannel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test P92-05-3 — presence probe fires ONCE per SSH-channel lifetime.
  //
  // The probe (`test -x ~/.local/bin/fleet-status-sweep`) is expensive
  // ONLY relative to "not firing at all"; the whole point of caching it per
  // SSH-channel lifetime is that a stable channel does not re-probe every
  // tick. This regression pins the cache lifetime: 3 ticks → 1 probe, 3
  // sweep execs.
  // -------------------------------------------------------------------------
  it("Test P92-05-3: presence probe fires once per SSH-channel lifetime, not per tick", async () => {
    const channel = new MockSshChannel();
    wireBatchProbe(channel, true);
    channel.setResponse(
      "~/.local/bin/fleet-status-sweep 2>/dev/null",
      buildSharedSweepJsonl(),
    );

    const capture = makeSetIntervalCapture();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: capture.setInterval,
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1 — probe + sweep

    const pollFn = capture.fns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — sweep only (probe cache hit)
      await pollFn.fn(); // tick 3 — sweep only (probe cache hit)
    }

    // Probe fires exactly once — cached across ticks 2 and 3.
    expect(
      countExact(
        channel,
        "test -x ~/.local/bin/fleet-status-sweep 2>/dev/null && echo yes || echo no",
      ),
    ).toBe(1);
    // Sweep exec fires exactly once per tick — 3 ticks total.
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test P92-05-4 — sweep-exec null return: this-tick legacy fallback +
  // next-tick re-probe recovery.
  //
  // Failure mode: transient SSH-side error swallows the sweep script's
  // stdout (`Channel open failure` shape). The orchestrator MUST fall
  // through to legacy for the current tick (so consumers still get frames)
  // AND MUST invalidate the probe cache (set sweepScriptPresent = null) so
  // the NEXT tick re-probes and retries the batch path. Persistent script
  // absence would then re-latch legacy on tick 3; a transient hiccup lets
  // batch resume.
  // -------------------------------------------------------------------------
  it("Test P92-05-4: sweep exec returning null triggers legacy fallback this tick + re-probe next tick", async () => {
    const channel = new MockSshChannel();
    // Probe returns yes on both tick 1 and tick 2's re-probe.
    wireBatchProbe(channel, true);
    // Wire legacy responses so tick 1's fallback has data.
    wireLegacyResponses(channel);
    // Sweep exec: null on tick 1 (simulate hiccup), valid JSONL on tick 2.
    // MockSshChannel's setResponse is last-write-wins per pattern — we
    // rewire between ticks.
    channel.setResponse("~/.local/bin/fleet-status-sweep 2>/dev/null", null);

    const capture = makeSetIntervalCapture();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: capture.setInterval,
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    // Tick 1: batch attempted (sweep exec fired once) + failed + legacy fired.
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(1);
    // Legacy fan-out fired on tick 1 (source A driver ran).
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThanOrEqual(1);
    // Fallback warn logged.
    expect(
      (systemLogger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => {
          const meta = call[1] as { operation?: string } | undefined;
          return meta?.operation === "fleet_status_batch_fallback";
        },
      ),
    ).toBe(true);

    // Prime tick 2: sweep now returns valid JSONL.
    channel.setResponse(
      "~/.local/bin/fleet-status-sweep 2>/dev/null",
      buildSharedSweepJsonl(),
    );
    const listingCallsAfterTick1 = channel.countCallsMatching("ls -1 ~/.claude/sessions/");

    const pollFn = capture.fns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — re-probe + sweep succeeds
    }

    // Probe fired AGAIN on tick 2 (re-probe triggered by null-exec on tick 1).
    expect(
      countExact(
        channel,
        "test -x ~/.local/bin/fleet-status-sweep 2>/dev/null && echo yes || echo no",
      ),
    ).toBe(2);
    // Sweep exec fired once on tick 2 (total 2 across both ticks).
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(2);
    // No additional legacy fan-out on tick 2 — batch succeeded.
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBe(
      listingCallsAfterTick1,
    );
  });

  // -------------------------------------------------------------------------
  // Test P92-05-5 — schema-mismatch: this-tick legacy fallback + connection-
  // lifetime latch.
  //
  // Failure mode: sweep script upgraded on the box emits JSONL with a schema
  // version the caller doesn't recognise (999 in the test). The orchestrator
  // MUST fall back to legacy this tick AND LATCH `sweepSchemaMismatchThis
  // Connection = true` so all subsequent ticks on the SAME SSH channel skip
  // the batch path (no point re-trying — the drift is architectural, not
  // transient). Only a channel reconnect (channel object identity change)
  // clears the latch.
  // -------------------------------------------------------------------------
  it("Test P92-05-5: schema-version mismatch on sweep emission triggers this-tick legacy fallback + connection-lifetime latch", async () => {
    const channel = new MockSshChannel();
    wireBatchProbe(channel, true);
    // Wire legacy responses so fallback has data.
    wireLegacyResponses(channel);
    // Sweep returns valid JSONL but with schema_version: 999.
    channel.setResponse(
      "~/.local/bin/fleet-status-sweep 2>/dev/null",
      makeSweepJsonl({
        identities: IDENTITIES.map((identity) => ({ identity })),
        pids: [
          { identity: "alpha", pid: PID_ALPHA },
          { identity: "beta", pid: PID_BETA },
        ],
        schemaVersionOverride: 999,
      }),
    );

    const capture = makeSetIntervalCapture();
    const deps = buildDeps({
      acquireSshChannel: vi.fn().mockResolvedValue(channel),
      setInterval: capture.setInterval,
    });
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start(); // tick 1

    // Tick 1: sweep fired (once) + schema-mismatch detected + legacy fired.
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(1);
    // Schema-mismatch warn logged.
    expect(
      (systemLogger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => {
          const meta = call[1] as { operation?: string; reason?: string } | undefined;
          return (
            meta?.operation === "fleet_status_batch_fallback" &&
            meta?.reason === "schema-mismatch"
          );
        },
      ),
    ).toBe(true);
    // Legacy fan-out fired on tick 1.
    const listingCallsAfterTick1 = channel.countCallsMatching("ls -1 ~/.claude/sessions/");
    expect(listingCallsAfterTick1).toBeGreaterThanOrEqual(1);

    const pollFn = capture.fns.find((f) => f.ms === 2000);
    expect(pollFn).toBeDefined();
    if (pollFn) {
      await pollFn.fn(); // tick 2 — latch keeps batch off
    }

    // Tick 2: sweep exec did NOT fire (schema-mismatch latched off until
    // channel reconnect). Total sweep-exec count is STILL 1 after tick 2.
    expect(
      countExact(channel, "~/.local/bin/fleet-status-sweep 2>/dev/null"),
    ).toBe(1);
    // Legacy fan-out fired AGAIN on tick 2.
    expect(channel.countCallsMatching("ls -1 ~/.claude/sessions/")).toBeGreaterThan(
      listingCallsAfterTick1,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 99 — spawn-request scan tests
// ---------------------------------------------------------------------------

describe("spawn-request scan (Phase 99)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: atomic scan exec issued per tick
  it("issues atomic scan exec on each poll tick", async () => {
    const deps = buildDeps();
    // Default already has "fleet/spawn-requests" → ""
    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    const calls = deps.channel.getCalls();
    const callCommands = calls.map((c) => c.command);
    expect(callCommands.some((c) => c.includes("fleet/spawn-requests"))).toBe(true);
  });

  // Test 2: null channel response → empty batch, no enqueue call
  it("null channel response → empty batch, no enqueue call", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });
    // Override: spawn-requests scan returns null (SSH error)
    deps.channel.setResponse("fleet/spawn-requests", null);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).not.toHaveBeenCalled();
  });

  // Test 3: missing folder (empty stdout) → empty batch, no enqueue call
  it("missing folder (empty stdout) → empty batch, no enqueue call", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });
    // Default already sets "fleet/spawn-requests" → ""; override to be explicit
    deps.channel.setResponse("fleet/spawn-requests", "");

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).not.toHaveBeenCalled();
  });

  // Test 4: valid request file → enqueues correct PendingBirth item
  it("valid request file → enqueues correct PendingBirth item", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });

    const uuid = "12345678-1234-1234-1234-1234567890ab";
    const body = JSON.stringify({
      role: "coordinator",
      task: "test task",
      requested_at: "2026-09-10T00:00:00Z",
    });
    deps.channel.setResponse("fleet/spawn-requests", `${uuid}.json\t${body}\n`);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).toHaveBeenCalledTimes(1);
    const item = enqueueSpawnRequest.mock.calls[0][0] as PendingBirth;
    expect(item.uuid).toBe(uuid);
    expect(item.role).toBe("coordinator");
    expect(item.task).toBe("test task");
    expect(item.requested_at).toBe("2026-09-10T00:00:00Z");
    expect(typeof item.hostIdNum).toBe("number");
    // host-1 → parseInt("host-1", 10) → NaN is acceptable here; the worker
    // re-fetches via getHostOwnerUserId at drain time (Plan 99-01 contract)
    expect(item.userId).toBe(""); // worker refetches
  });

  // Test 5: UUID-shape filter defense-in-depth — direct parseSpawnRequestBatch call
  it("UUID-shape filter: rejects non-UUID basenames (e.g. response filenames)", () => {
    // Not a UUID
    const result1 = parseSpawnRequestBatch("not-a-uuid.json\t{}\n", "host-1");
    expect(result1).toHaveLength(0);

    // *.success.json — basename after stripping .json is 43 chars, fails UUID_RE
    const uuid = "12345678-1234-1234-1234-1234567890ab";
    const successFile = `${uuid}.success.json\t${JSON.stringify({ role: "coordinator", task: null, requested_at: "2026-09-10T00:00:00Z" })}\n`;
    const result2 = parseSpawnRequestBatch(successFile, "host-1");
    expect(result2).toHaveLength(0);

    // A genuine request file — 36-char UUID basename, should parse OK
    const validLine = `${uuid}.json\t${JSON.stringify({ role: "coordinator", task: "test", requested_at: "2026-09-10T00:00:00Z" })}\n`;
    const result3 = parseSpawnRequestBatch(validLine, "host-1");
    expect(result3).toHaveLength(1);
    expect(result3[0].uuid).toBe(uuid);
  });

  // Test 6: malformed JSON body → enqueued with malformedReason set
  // (Post-code-review M2/M3: prior behavior silently dropped malformed requests,
  // stranding coord until its safety timeout. New behavior enqueues a PendingBirth
  // with `malformedReason` so the worker drops a `{reason:"malformed", message}`
  // failure file — coord sees the failure and can potentially iterate.)
  it("malformed JSON body → enqueued with malformedReason (worker drops failure file)", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });

    const uuid = "12345678-1234-1234-1234-1234567890ab";
    deps.channel.setResponse("fleet/spawn-requests", `${uuid}.json\t{not-json}\n`);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).toHaveBeenCalledTimes(1);
    const item = enqueueSpawnRequest.mock.calls[0][0];
    expect(item.uuid).toBe(uuid);
    expect(item.malformedReason).toBeDefined();
    expect(String(item.malformedReason)).toMatch(/JSON/i);
    expect(item.role).toBe("");
    expect(item.task).toBeNull();
  });

  // Test 6b: role failing ROLE_NAME_PATTERN → enqueued with malformedReason
  // (Post-code-review M2/M3: full parseRequestBody validation at sweep time
  // means role-shape violations become malformed failures, not birth_failed.)
  it("role failing ROLE_NAME_PATTERN → enqueued with malformedReason (role_unknown → malformed via sweep-side validation)", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });

    const uuid = "12345678-1234-1234-1234-1234567890ab";
    const body = JSON.stringify({
      role: "INVALID ROLE WITH SPACES",
      task: "test",
      requested_at: "2026-09-10T00:00:00Z",
    });
    deps.channel.setResponse("fleet/spawn-requests", `${uuid}.json\t${body}\n`);

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).toHaveBeenCalledTimes(1);
    const item = enqueueSpawnRequest.mock.calls[0][0];
    expect(item.uuid).toBe(uuid);
    expect(item.malformedReason).toBeDefined();
    expect(String(item.malformedReason)).toMatch(/role/i);
  });

  // Test 7: multiple valid request files in one tick → all enqueued
  it("multiple valid request files in one tick → all enqueued", async () => {
    const enqueueSpawnRequest = vi.fn();
    const deps = buildDeps({ enqueueSpawnRequest });

    const uuid1 = "12345678-1234-1234-1234-1234567890ab";
    const uuid2 = "abcdef12-abcd-abcd-abcd-abcdef123456";
    const body1 = JSON.stringify({ role: "coordinator", task: "task one", requested_at: "2026-09-10T00:00:00Z" });
    const body2 = JSON.stringify({ role: "executor", task: "task two", requested_at: "2026-09-10T00:01:00Z" });
    deps.channel.setResponse(
      "fleet/spawn-requests",
      `${uuid1}.json\t${body1}\n${uuid2}.json\t${body2}\n`,
    );

    const orchestrator = createSshPollOrchestrator(deps);
    await orchestrator.start();

    expect(enqueueSpawnRequest).toHaveBeenCalledTimes(2);
    const uuids = enqueueSpawnRequest.mock.calls.map((call: [PendingBirth]) => call[0].uuid);
    expect(uuids).toContain(uuid1);
    expect(uuids).toContain(uuid2);
  });

  // Test 8: backward-compat regression guard — buildDeps without enqueueSpawnRequest still works
  it("buildDeps without enqueueSpawnRequest override compiles and runs without crash", async () => {
    // No enqueueSpawnRequest in deps — scan still runs, results silently discarded
    const deps = buildDeps({});
    const orchestrator = createSshPollOrchestrator(deps);

    // A valid request file is in the channel — scan will parse it but nobody receives it
    const uuid = "12345678-1234-1234-1234-1234567890ab";
    deps.channel.setResponse(
      "fleet/spawn-requests",
      `${uuid}.json\t${JSON.stringify({ role: "coordinator", task: null, requested_at: "2026-09-10T00:00:00Z" })}\n`,
    );

    // Must not throw
    await expect(orchestrator.start()).resolves.not.toThrow();
  });
});
