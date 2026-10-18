/**
 * Puts the desktop-mcp substrate suites inside `npx vitest run` — the full-suite
 * gate before every deploy:
 *
 *   - agent-desktop.test.sh: agent-desktop (lifecycle CLI, browser server) and
 *     the real desktop-mcp over stdio and over HTTP (identity key, browser kept
 *     across a server restart). The X-server cases skip on a box without Xvnc.
 *   - agent-supervisor-desktop-mcp.test.sh: the supervisor's launch wiring
 *     (config file, start-if-down, only pass the config once it answers, key in
 *     the launch env).
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..");
const tests = join(repoRoot, "substrate", "scripts", "tests");

function run(cmd: string, args: string[], timeoutMs: number): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, { cwd: repoRoot, timeout: timeoutMs, encoding: "utf-8", stdio: "pipe" });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message}`.slice(-4000) };
  }
}

describe("desktop-mcp substrate suites", () => {
  it("agent-desktop.test.sh passes", () => {
    const r = run("bash", [join(tests, "agent-desktop.test.sh")], 180_000);
    expect(r.output).toMatch(/FAIL: 0/);
    expect(r.ok).toBe(true);
  }, 190_000);

  it("agent-supervisor-desktop-mcp.test.sh passes", () => {
    const r = run("bash", [join(tests, "agent-supervisor-desktop-mcp.test.sh")], 60_000);
    expect(r.output).toMatch(/8 pass, 0 fail/);
    expect(r.ok).toBe(true);
  }, 70_000);
});
