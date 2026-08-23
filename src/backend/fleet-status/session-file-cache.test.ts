/**
 * session-file-cache.test.ts
 *
 * Exhaustive unit tests for the session-file-cache primitive.
 * No vi.mock needed — the module has no external dependencies.
 *
 * All 10 tests cover the behavioral spec from plan 55-01:
 * cold-miss, write+read round-trip, key-collision independence,
 * hostId-type coercion, host-scoped clear, and per-test reset.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  writeSessionFileCache,
  readSessionFileCache,
  clearSessionFileCacheForHost,
  __clearAllSessionFileCacheForTests,
} from "./session-file-cache.js";
import type { SessionFileCacheEntry } from "./session-file-cache.js";

describe("session-file-cache", () => {
  beforeEach(() => {
    __clearAllSessionFileCacheForTests();
  });

  it("Test 1: cold-start returns null", () => {
    expect(readSessionFileCache("7", "aqua")).toBeNull();
    expect(readSessionFileCache(7, "aqua")).toBeNull();
  });

  it("Test 2: write-then-read round-trip", () => {
    const before = Date.now();
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/id.jsonl",
      pid: 12345,
    });
    const entry = readSessionFileCache("7", "aqua") as SessionFileCacheEntry;
    expect(entry).not.toBeNull();
    expect(entry.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/id.jsonl",
    );
    expect(entry.pid).toBe(12345);
    expect(typeof entry.writtenAt).toBe("number");
    expect(entry.writtenAt).toBeGreaterThanOrEqual(before);
  });

  it("Test 3: writer=string, reader=number resolves same entry", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/id.jsonl",
      pid: 11111,
    });
    const entry = readSessionFileCache(7, "aqua");
    expect(entry).not.toBeNull();
    expect(entry?.pid).toBe(11111);
  });

  it("Test 4: writer=number, reader=string resolves same entry", () => {
    writeSessionFileCache(7, "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/id.jsonl",
      pid: 22222,
    });
    const entry = readSessionFileCache("7", "aqua");
    expect(entry).not.toBeNull();
    expect(entry?.pid).toBe(22222);
  });

  it("Test 5: last-writer-wins", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/a.jsonl",
      pid: 11111,
    });
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/b.jsonl",
      pid: 22222,
    });
    const entry = readSessionFileCache("7", "aqua");
    expect(entry?.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/b.jsonl",
    );
    expect(entry?.pid).toBe(22222);
  });

  it("Test 6: different tmuxSession same hostId do not collide", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/aqua.jsonl",
      pid: 1001,
    });
    writeSessionFileCache("7", "beatrice", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/beatrice.jsonl",
      pid: 1002,
    });
    expect(readSessionFileCache("7", "aqua")?.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/aqua.jsonl",
    );
    expect(readSessionFileCache("7", "beatrice")?.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/beatrice.jsonl",
    );
  });

  it("Test 7: different hostId same tmuxSession do not collide", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/7-aqua.jsonl",
      pid: 2001,
    });
    writeSessionFileCache("8", "aqua", {
      sessionFile: "/home/ubuntu/.claude/projects/proj/8-aqua.jsonl",
      pid: 2002,
    });
    expect(readSessionFileCache("7", "aqua")?.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/7-aqua.jsonl",
    );
    expect(readSessionFileCache("8", "aqua")?.sessionFile).toBe(
      "/home/ubuntu/.claude/projects/proj/8-aqua.jsonl",
    );
  });

  it("Test 8: clearSessionFileCacheForHost scopes to one host", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/proj/7-aqua.jsonl",
      pid: 3001,
    });
    writeSessionFileCache("7", "beatrice", {
      sessionFile: "/proj/7-beatrice.jsonl",
      pid: 3002,
    });
    writeSessionFileCache("8", "aqua", {
      sessionFile: "/proj/8-aqua.jsonl",
      pid: 3003,
    });

    clearSessionFileCacheForHost("7");

    expect(readSessionFileCache("7", "aqua")).toBeNull();
    expect(readSessionFileCache("7", "beatrice")).toBeNull();
    expect(readSessionFileCache("8", "aqua")).not.toBeNull();
    expect(readSessionFileCache("8", "aqua")?.pid).toBe(3003);
  });

  it("Test 9: clearSessionFileCacheForHost accepts numeric hostId", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/proj/7-aqua.jsonl",
      pid: 4001,
    });
    clearSessionFileCacheForHost(7);
    expect(readSessionFileCache("7", "aqua")).toBeNull();
  });

  it("Test 10: __clearAllSessionFileCacheForTests wipes everything", () => {
    writeSessionFileCache("7", "aqua", {
      sessionFile: "/proj/7-aqua.jsonl",
      pid: 5001,
    });
    writeSessionFileCache("8", "aqua", {
      sessionFile: "/proj/8-aqua.jsonl",
      pid: 5002,
    });
    __clearAllSessionFileCacheForTests();
    expect(readSessionFileCache("7", "aqua")).toBeNull();
    expect(readSessionFileCache("8", "aqua")).toBeNull();
  });
});
