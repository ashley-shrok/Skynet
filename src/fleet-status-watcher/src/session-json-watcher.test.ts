/**
 * Tests for session-json-watcher.ts — createSessionJsonWatcher + parseSessionJson.
 *
 * Tests 1-5 per plan spec (Task 3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock fs/promises — provides readdir + readFile
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

// Mock fs (sync) — provides watch
vi.mock("node:fs", async (importOriginal) => {
  const EventEmitter = (await import("node:events")).EventEmitter;

  class FakeWatcher extends EventEmitter {
    close() {
      /* no-op */
    }
  }

  const mockWatch = vi.fn(() => new FakeWatcher());

  return {
    default: {
      watch: mockWatch,
    },
    watch: mockWatch,
    FSWatcher: FakeWatcher,
  };
});

// Mock liveness-check
vi.mock("./liveness-check.js", () => ({
  isPidAlive: vi.fn(),
  readProcStart: vi.fn(),
}));

// Mock pid-to-tmux
vi.mock("./pid-to-tmux.js", () => ({
  resolveTmuxSessionForPid: vi.fn(),
  clearPidCache: vi.fn(),
}));

import fs from "node:fs/promises";
import fsSync from "node:fs";
import { isPidAlive } from "./liveness-check.js";
import { resolveTmuxSessionForPid, clearPidCache } from "./pid-to-tmux.js";
import { createSessionJsonWatcher, parseSessionJson } from "./session-json-watcher.js";
import type { SessionState } from "./types.js";

const mockReadFile = vi.mocked(fs.readFile);
const mockReaddir = vi.mocked(fs.readdir);
const mockWatch = vi.mocked(fsSync.watch);
const mockIsPidAlive = vi.mocked(isPidAlive);
const mockResolveTmux = vi.mocked(resolveTmuxSessionForPid);
const mockClearCache = vi.mocked(clearPidCache);

// Session fixture factory
function makeSessionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 3941934,
    sessionId: "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
    cwd: "/home/ubuntu",
    startedAt: 1786576479287,
    procStart: "53836667",
    version: "2.1.150",
    status: "busy",
    updatedAt: 1786577996976,
    ...overrides,
  });
}

const TINA_SESSION = makeSessionJson({
  pid: 3941934,
  sessionId: "session-tina",
  procStart: "53836667",
  status: "busy",
});

const TANYA_SESSION = makeSessionJson({
  pid: 131617,
  sessionId: "session-tanya",
  procStart: "11111111",
  status: "idle",
});

const TIFFANY_SESSION = makeSessionJson({
  pid: 180099,
  sessionId: "session-tiffany",
  procStart: "22222222",
  status: "shell",
});

beforeEach(() => {
  vi.clearAllMocks();
  // By default, everything is alive and resolves to a tmux session
  mockIsPidAlive.mockResolvedValue(true);
  mockResolveTmux.mockImplementation(async (pid: number) => {
    if (pid === 3941934) return "tina";
    if (pid === 131617) return "tanya";
    if (pid === 180099) return "tiffany";
    return null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseSessionJson tests
// ---------------------------------------------------------------------------
describe("parseSessionJson", () => {
  it("returns parsed SessionJson for valid JSON", () => {
    const result = parseSessionJson(TINA_SESSION);
    expect(result).not.toBeNull();
    expect(result?.pid).toBe(3941934);
    expect(result?.sessionId).toBe("session-tina");
    expect(result?.status).toBe("busy");
  });

  it("returns null for invalid JSON", () => {
    expect(parseSessionJson("not json")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(parseSessionJson('{"pid": 123}')).toBeNull();
  });

  it("returns null for invalid status", () => {
    expect(parseSessionJson(makeSessionJson({ status: "unknown" }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 1: initial scan emits one onSessionState per live PID
// ---------------------------------------------------------------------------
describe("createSessionJsonWatcher — initial scan", () => {
  it("Test 1: initial scan of directory emits one onSessionState per live PID with correct hostId, tmuxSession, sessionId, status", async () => {
    mockReaddir.mockResolvedValue(
      ["3941934.json", "131617.json", "180099.json"] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >,
    );
    mockReadFile
      .mockResolvedValueOnce(TINA_SESSION as unknown as Buffer)
      .mockResolvedValueOnce(TANYA_SESSION as unknown as Buffer)
      .mockResolvedValueOnce(TIFFANY_SESSION as unknown as Buffer);

    const emitted: SessionState[] = [];
    const handle = createSessionJsonWatcher({
      sessionsDir: "/home/ubuntu/.claude/sessions",
      hostId: "skynet-ec2",
      onSessionState(s) {
        emitted.push(s);
      },
      onSessionGone: vi.fn(),
    });

    // Wait for initial scan to complete (all promises)
    await vi.waitFor(() => expect(emitted).toHaveLength(3), { timeout: 2000 });

    const sessionIds = emitted.map((s) => s.sessionId).sort();
    expect(sessionIds).toEqual(
      ["session-tanya", "session-tiffany", "session-tina"].sort(),
    );

    const tina = emitted.find((s) => s.pid === 3941934);
    expect(tina).toBeDefined();
    expect(tina?.hostId).toBe("skynet-ec2");
    expect(tina?.tmuxSession).toBe("tina");
    expect(tina?.sessionId).toBe("session-tina");
    expect(tina?.status).toBe("busy");

    handle.close();
  });

  it("Test 4: stale file (procStart mismatch) is NOT emitted; session_stale_reaped is logged", async () => {
    mockReaddir.mockResolvedValue(
      ["3941934.json"] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );
    mockReadFile.mockResolvedValueOnce(TINA_SESSION as unknown as Buffer);
    // Stale: procStart doesn't match
    mockIsPidAlive.mockResolvedValueOnce(false);

    const emitted: SessionState[] = [];
    const goneArgs: unknown[] = [];

    // Capture stderr to check for the stale log
    let stderrCapture = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrCapture += chunk;
      return true;
    });

    const handle = createSessionJsonWatcher({
      sessionsDir: "/home/ubuntu/.claude/sessions",
      hostId: "skynet-ec2",
      onSessionState(s) {
        emitted.push(s);
      },
      onSessionGone(...args) {
        goneArgs.push(args);
      },
    });

    await vi.waitFor(() => expect(mockIsPidAlive).toHaveBeenCalled(), {
      timeout: 2000,
    });
    // Give time for logs
    await new Promise((r) => setTimeout(r, 50));

    stderrSpy.mockRestore();

    expect(emitted).toHaveLength(0);
    expect(stderrCapture).toContain("session_stale_reaped");

    handle.close();
  });
});

// ---------------------------------------------------------------------------
// Test 2: inotify modify event re-parses and emits updated SessionState
// ---------------------------------------------------------------------------
describe("createSessionJsonWatcher — inotify events", () => {
  it("Test 2: inotify modify event on existing <pid>.json re-parses and emits updated status", async () => {
    mockReaddir.mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );

    const emitted: SessionState[] = [];
    let watcherEmitter: EventEmitter | null = null;

    // Capture the watcher instance
    mockWatch.mockImplementationOnce((_path, _opts, cb) => {
      const emitter = new EventEmitter() as typeof emitter & { close: () => void };
      emitter.close = () => {};
      watcherEmitter = emitter;
      // Store the callback
      (emitter as unknown as { _cb: typeof cb })._cb = cb;
      return emitter as unknown as ReturnType<typeof fsSync.watch>;
    });

    const handle = createSessionJsonWatcher({
      sessionsDir: "/home/ubuntu/.claude/sessions",
      hostId: "skynet-ec2",
      onSessionState(s) {
        emitted.push(s);
      },
      onSessionGone: vi.fn(),
    });

    // Simulate a modify (change) event for pid 3941934
    const updatedSession = makeSessionJson({
      pid: 3941934,
      sessionId: "session-tina",
      procStart: "53836667",
      status: "idle",
      updatedAt: Date.now(),
    });
    mockReadFile.mockResolvedValueOnce(updatedSession as unknown as Buffer);

    // Trigger the inotify callback
    const cb = (watcherEmitter as unknown as { _cb: (event: string, filename: string) => void })._cb;
    if (cb) {
      cb("change", "3941934.json");
    }

    await vi.waitFor(() => expect(emitted).toHaveLength(1), { timeout: 2000 });
    expect(emitted[0]?.status).toBe("idle");
    expect(emitted[0]?.sessionId).toBe("session-tina");

    handle.close();
  });

  it("Test 3: create event on new <pid>.json triggers initial-parse + emit", async () => {
    mockReaddir.mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );

    const emitted: SessionState[] = [];
    let watcherCb: ((event: string, filename: string) => void) | null = null;

    mockWatch.mockImplementationOnce((_path, _opts, cb) => {
      watcherCb = cb as typeof watcherCb;
      const emitter = new EventEmitter() as typeof emitter & { close: () => void };
      emitter.close = () => {};
      return emitter as unknown as ReturnType<typeof fsSync.watch>;
    });

    const handle = createSessionJsonWatcher({
      sessionsDir: "/home/ubuntu/.claude/sessions",
      hostId: "skynet-ec2",
      onSessionState(s) {
        emitted.push(s);
      },
      onSessionGone: vi.fn(),
    });

    // Simulate a rename (create) event for a brand new pid
    mockReadFile.mockResolvedValueOnce(TANYA_SESSION as unknown as Buffer);
    if (watcherCb) {
      watcherCb("rename", "131617.json");
    }

    await vi.waitFor(() => expect(emitted).toHaveLength(1), { timeout: 2000 });
    expect(emitted[0]?.pid).toBe(131617);
    expect(emitted[0]?.sessionId).toBe("session-tanya");

    handle.close();
  });
});

// ---------------------------------------------------------------------------
// Test 5: periodic liveness scan reaps dead PIDs
// ---------------------------------------------------------------------------
describe("createSessionJsonWatcher — liveness sweep", () => {
  it("Test 5: periodic liveness scan reaps PIDs that transition to dead; emits onSessionGone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    mockReaddir.mockResolvedValue(
      ["3941934.json"] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );
    mockReadFile.mockResolvedValueOnce(TINA_SESSION as unknown as Buffer);
    // First call alive (initial scan), subsequent calls dead (sweep)
    mockIsPidAlive
      .mockResolvedValueOnce(true) // initial scan alive
      .mockResolvedValue(false);   // sweep detects dead

    const emitted: SessionState[] = [];
    const goneArgs: [string, string | null, string, number][] = [];

    const handle = createSessionJsonWatcher({
      sessionsDir: "/home/ubuntu/.claude/sessions",
      hostId: "skynet-ec2",
      onSessionState(s) {
        emitted.push(s);
      },
      onSessionGone(hostId, tmuxSession, sessionId, pid) {
        goneArgs.push([hostId, tmuxSession, sessionId, pid]);
      },
    });

    // Let the async initial scan microtasks run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]?.sessionId).toBe("session-tina");

    // Advance by 30s to trigger the liveness sweep
    await vi.advanceTimersByTimeAsync(30_000);

    // The sweep runs async — wait for it to complete
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(goneArgs.length).toBeGreaterThanOrEqual(1);
    expect(goneArgs[0]?.[0]).toBe("skynet-ec2");
    expect(goneArgs[0]?.[2]).toBe("session-tina");
    expect(goneArgs[0]?.[3]).toBe(3941934);
    expect(mockClearCache).toHaveBeenCalledWith(3941934);

    handle.close();
    vi.useRealTimers();
  });
});
