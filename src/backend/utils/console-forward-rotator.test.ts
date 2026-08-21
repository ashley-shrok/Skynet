/**
 * Quick-260821-kyf vitest suite for console-forward-rotator.ts.
 *
 * Covers N-file rotation semantics of the shared rotateIfExceeds helper:
 *   1. small-file no-op        — under threshold → nothing happens
 *   2. over-threshold rotates  — base renamed to .log.1
 *   3. chain-bump              — pre-existing .log.1/.log.2 bump to .log.2/.log.3
 *   4. max-N drop-oldest       — .log.N is unlinked, .log.(N+1) never created
 *   5. race-simulation         — second synchronous call is a no-op (post-rename base is gone)
 *   6. rename-failure swallowed — fs.renameSync throws → helper does not throw
 *
 * Follows the tmp-file pattern from console-forward-transport.test.ts.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  rotateIfExceeds,
  MAX_FILE_BYTES,
  MAX_ROTATED_FILES,
} from "./console-forward-rotator.js";

let tmpLog: string;

beforeEach(() => {
  tmpLog = path.join(
    os.tmpdir(),
    `cfr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );
});

afterEach(() => {
  // Best-effort cleanup: base + all possible rotated suffixes up to MAX_ROTATED_FILES.
  try {
    fs.unlinkSync(tmpLog);
  } catch {
    // may not exist
  }
  for (let i = 1; i <= MAX_ROTATED_FILES + 1; i++) {
    try {
      fs.unlinkSync(`${tmpLog}.${i}`);
    } catch {
      // may not exist
    }
  }
  vi.restoreAllMocks();
});

describe("console-forward-rotator", () => {
  it("Test 1: small file under threshold is a no-op — base preserved, .log.1 not created", () => {
    fs.writeFileSync(tmpLog, "x".repeat(100));
    rotateIfExceeds(tmpLog, { maxBytes: MAX_FILE_BYTES });

    expect(fs.existsSync(tmpLog)).toBe(true);
    expect(fs.statSync(tmpLog).size).toBe(100);
    expect(fs.existsSync(`${tmpLog}.1`)).toBe(false);
  });

  it("Test 2: over-threshold base is renamed to .log.1 (never truncated)", () => {
    const content = "y".repeat(2048); // 2 KB > 1 KB threshold
    fs.writeFileSync(tmpLog, content);
    rotateIfExceeds(tmpLog, { maxBytes: 1024 });

    expect(fs.existsSync(tmpLog)).toBe(false);
    expect(fs.existsSync(`${tmpLog}.1`)).toBe(true);
    expect(fs.readFileSync(`${tmpLog}.1`, "utf-8")).toBe(content);
  });

  it("Test 3: chain-bump — existing .log.1 → .log.2, existing .log.2 → .log.3, base → .log.1", () => {
    fs.writeFileSync(tmpLog, "base".repeat(500)); // 2000 bytes > 1 KB threshold
    fs.writeFileSync(`${tmpLog}.1`, "one");
    fs.writeFileSync(`${tmpLog}.2`, "two");

    rotateIfExceeds(tmpLog, { maxBytes: 1024 });

    expect(fs.existsSync(tmpLog)).toBe(false);
    expect(fs.readFileSync(`${tmpLog}.1`, "utf-8")).toBe("base".repeat(500));
    expect(fs.readFileSync(`${tmpLog}.2`, "utf-8")).toBe("one");
    expect(fs.readFileSync(`${tmpLog}.3`, "utf-8")).toBe("two");
  });

  it("Test 4: max-N drop-oldest — .log.N is unlinked, .log.(N+1) never accumulates", () => {
    // With maxFiles=3, pre-create base + .log.1 + .log.2 + .log.3, all distinct.
    fs.writeFileSync(tmpLog, "base".repeat(500)); // over 1 KB
    fs.writeFileSync(`${tmpLog}.1`, "one");
    fs.writeFileSync(`${tmpLog}.2`, "two");
    fs.writeFileSync(`${tmpLog}.3`, "three");

    rotateIfExceeds(tmpLog, { maxBytes: 1024, maxFiles: 3 });

    expect(fs.existsSync(tmpLog)).toBe(false);
    expect(fs.readFileSync(`${tmpLog}.1`, "utf-8")).toBe("base".repeat(500));
    expect(fs.readFileSync(`${tmpLog}.2`, "utf-8")).toBe("one");
    expect(fs.readFileSync(`${tmpLog}.3`, "utf-8")).toBe("two");
    // Old .log.3 ("three") was unlinked; .log.4 never created.
    expect(fs.existsSync(`${tmpLog}.4`)).toBe(false);
  });

  it("Test 5: race-simulation — second synchronous call is a no-op (base already rotated away)", () => {
    const content = "z".repeat(2048);
    fs.writeFileSync(tmpLog, content);

    rotateIfExceeds(tmpLog, { maxBytes: 1024 });
    // After first call: base gone, content lives in .log.1
    expect(fs.existsSync(tmpLog)).toBe(false);
    expect(fs.readFileSync(`${tmpLog}.1`, "utf-8")).toBe(content);

    // Second call sees no base file → ENOENT path → returns without touching anything.
    rotateIfExceeds(tmpLog, { maxBytes: 1024 });

    // .log.1 still holds original content; .log.2 was NOT created (chain was NOT bumped a second time).
    expect(fs.readFileSync(`${tmpLog}.1`, "utf-8")).toBe(content);
    expect(fs.existsSync(`${tmpLog}.2`)).toBe(false);
  });

  it("Test 6: fs.renameSync failure is swallowed — helper does not throw", () => {
    fs.writeFileSync(tmpLog, "a".repeat(2048));
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated rename failure");
    });

    expect(() => rotateIfExceeds(tmpLog, { maxBytes: 1024 })).not.toThrow();
  });
});
