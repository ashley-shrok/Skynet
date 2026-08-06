/**
 * Patch #146: backend debug route tests.
 *
 * Tests exercise handleConsoleLog() at the function level (no Express harness,
 * no auth middleware) — matching the host-normalizers.test.ts pattern in this
 * project. The auth gate is verified by construction: the route wires
 * authenticateJWT before the handler, same as compose-drafts.ts.
 *
 * Key isolation: SKYNET_CONSOLE_FORWARD_LOG_PATH is overridden to a per-test
 * tmpdir file. The handler reads the env var lazily via getLogPath() so
 * per-test env overrides work without vi.resetModules().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import { DEFAULT_LOG_PATH, getLogPath, handleConsoleLog } from "./debug.js";

// ---------------------------------------------------------------------------
// Minimal Express mock (enough to drive the handler)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: () => MockRes;
};

function makeReq(body: unknown) {
  return { body } as unknown as import("express").Request;
}

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    },
  };
  return res as unknown as MockRes;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpLogPath: string;

beforeEach(() => {
  const hex = crypto.randomBytes(8).toString("hex");
  tmpLogPath = path.join(os.tmpdir(), `skynet-console-forward-test-${hex}.log`);
  process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH = tmpLogPath;
});

afterEach(() => {
  try {
    fs.unlinkSync(tmpLogPath);
  } catch {
    // File may not exist if test didn't write
  }
  delete process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getLogPath default", () => {
  // Regression guard: the log-forwarder's whole point is post-hoc inspection
  // across container restarts, so its default MUST NOT live under /tmp inside
  // the container (wiped on every --force-recreate). Bit us 2026-08-06 when
  // a deploy wiped voice-diag evidence Ashley had just produced.
  it("default is not under /tmp", () => {
    delete process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH;
    const p = getLogPath();
    expect(p.startsWith("/tmp/")).toBe(false);
    expect(p).toBe(DEFAULT_LOG_PATH);
  });
});

describe("handleConsoleLog", () => {
  it("returns 204 and writes one JSON line to the mirror file for a valid entry", () => {
    const entry = {
      ts: "2026-07-24T00:00:00.000Z",
      level: "error" as const,
      tabId: "t1",
      msg: "boom",
    };

    const req = makeReq({ entries: [entry] });
    const res = makeRes();

    handleConsoleLog(req, res as unknown as import("express").Response);

    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);

    // File should exist and contain exactly one JSON line
    expect(fs.existsSync(tmpLogPath)).toBe(true);
    const lines = fs
      .readFileSync(tmpLogPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.ts).toBe(entry.ts);
    expect(parsed.level).toBe(entry.level);
    expect(parsed.tabId).toBe(entry.tabId);
    expect(parsed.msg).toBe(entry.msg);
  });

  it("returns 400 for malformed body with missing entries field", () => {
    const req = makeReq({});
    const res = makeRes();

    handleConsoleLog(req, res as unknown as import("express").Response);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe("entries array required");
    expect(fs.existsSync(tmpLogPath)).toBe(false);
  });

  it("returns 400 when entries is not an array (string value)", () => {
    const req = makeReq({ entries: "not-an-array" });
    const res = makeRes();

    handleConsoleLog(req, res as unknown as import("express").Response);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe("entries array required");
    expect(fs.existsSync(tmpLogPath)).toBe(false);
  });

  it("returns 400 when entries array contains only invalid shapes", () => {
    const req = makeReq({ entries: [{ level: "bogus", tabId: 42, msg: null }] });
    const res = makeRes();

    handleConsoleLog(req, res as unknown as import("express").Response);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe("no valid entries");
    expect(fs.existsSync(tmpLogPath)).toBe(false);
  });
});
