// Source-level guard: every one-shot SSH connection the claude-session WS
// handlers open (`const conn|probeConn = await connectOneShot(...)`) must run
// inside a getHostSemaphore(...).run(...) block, so WS-driven work shares the
// per-host slot pool with every other SSH producer. Behavioural coverage of a
// representative handler lives in claude-session-server.role-file.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "claude-session-server.ts"),
  "utf-8",
);

describe("claude-session-server one-shot connects are semaphore-wrapped", () => {
  it("each `const conn = await connectOneShot(` directly follows a getHostSemaphore(...).run(", () => {
    const lines = src.split("\n");
    const sites = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /const (conn|probeConn) = await connectOneShot\(/.test(l));
    expect(sites.length).toBeGreaterThanOrEqual(13);
    const unwrapped = sites.filter(
      ({ i }) => !/await getHostSemaphore\(\w+\)\.run\(async \(\) => \{\s*$/.test(lines[i - 1]),
    );
    expect(unwrapped.map(({ i, l }) => `${i + 1}: ${l.trim()}`)).toEqual([]);
  });
});
