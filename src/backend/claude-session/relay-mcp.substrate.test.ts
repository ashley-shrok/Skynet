/**
 * Puts the relay-mcp substrate suites inside `npx vitest run` — the full-suite
 * gate before every deploy:
 *
 *   - test_relay_mcp.py: the real relay-mcp server against a fake Matrix
 *     homeserver, driven over MCP HTTP (DM find-or-create, identity header,
 *     token refresh, browser refusal, files).
 *   - agent-supervisor-relay-mcp.test.sh: the supervisor's launch wiring
 *     (config file, start-if-down, only pass the config once it answers).
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

describe("relay-mcp substrate suites", () => {
  it("test_relay_mcp.py passes", () => {
    const r = run("python3", [join(tests, "test_relay_mcp.py")], 120_000);
    expect(r.output).toMatch(/FAIL: 0/);
    expect(r.ok).toBe(true);
  }, 130_000);

  it("agent-supervisor-relay-mcp.test.sh passes", () => {
    const r = run("bash", [join(tests, "agent-supervisor-relay-mcp.test.sh")], 60_000);
    expect(r.output).toMatch(/6 pass, 0 fail/);
    expect(r.ok).toBe(true);
  }, 70_000);
});
