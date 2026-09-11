/**
 * Regression guard for commit a56c2765 —
 *   fix(pv-attach): liveness-check cached PID on cache-hit before trusting
 *   stale sessionFile
 *
 * Regression window: Phase 55 (2026-08-23, added a fleet-status-fed cache
 * short-circuit at connectToPane) + bdb2d664 (2026-09-07, made server-driven
 * tmux teardown fire ws.close(1011) so client reconnect wakes up). Deploy
 * of the two together (2026-09-08 07:43 UTC) surfaced the latent stale-cache
 * bug: any dormant pane reconnect pinned the tail to the LAST-alive JSONL
 * instead of the latest identity JSONL. Alice observed on Tiffany + Becky
 * within hours of the deploy.
 *
 * The fix liveness-checks the cached PID via `/proc/<pid>` existence on the
 * target host before trusting the cache entry. Dead PID → fall through to
 * discoverClaudeSessionBatched so the dormant branch's identity-JSONL walk
 * picks the latest by mtime. Fail-open on SSH throw preserves pre-fix
 * behavior on flaky transport.
 *
 * The specific behavior is buried inside a long-running `wss.on("connection")`
 * handler that is impractical to unit-test end-to-end without significant
 * scaffolding. This regression test uses a source-text structural guard to
 * assert the liveness check remains present. If a future refactor moves
 * the check to a different site, update the test to point at the new site —
 * do NOT drop the assertion, since the invariant it protects (dormant
 * reconnect picks the latest JSONL, not a stale cached one) is load-bearing.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVER_SRC = fs.readFileSync(
  path.join(__dirname, "claude-session-server.ts"),
  "utf-8",
);

describe("claude-session-server.ts — pv-attach cache-hit liveness regression (commit a56c2765)", () => {
  it("cache-hit path invokes /proc/<pid> liveness check before trusting the cache", () => {
    // The exact command that /proc-tests for the cached PID's liveness.
    // Any refactor that keeps the guarantee will keep some form of this
    // shape; the exact string is what the fix landed with.
    const procTest = SERVER_SRC.match(
      /test\s+-d\s+\/proc\/\$\{cached\.pid\}\s+&&\s+echo\s+alive\s+\|\|\s+echo\s+dead/,
    );
    expect(procTest).not.toBeNull();
  });

  it("liveness result gates the cache-hit short-circuit — dead falls through", () => {
    // The variable name is the load-bearing seam — dropping the gate
    // would re-open the bug. Any refactor should keep the shape:
    // `let cachedPidAlive = true; ... if (cachedPidAlive) { ...trust cache... }`
    // else fall through to discovery.
    const gateDecl = SERVER_SRC.match(/let\s+cachedPidAlive\s*=\s*true\s*;/);
    const gateUse = SERVER_SRC.match(/if\s*\(\s*cachedPidAlive\s*\)/);
    expect(gateDecl).not.toBeNull();
    expect(gateUse).not.toBeNull();
  });

  it("liveness check fails open on SSH throw (preserves pre-fix behavior on flaky transport)", () => {
    // Mirrors 6c137306's transport-vs-dead pattern: if the /proc test
    // throws (SSH transport error), keep the cache entry rather than
    // false-invalidating and forcing a discovery on every flaky
    // reconnect. Guarded by a try/catch around the execCommand.
    //
    // Structural check: an execCommand call adjacent to a `catch` block,
    // both within the connection handler's cache-hit branch. Grep is
    // conservative — we assert both pieces exist near each other.
    const execCall = SERVER_SRC.indexOf('/proc/${cached.pid}');
    expect(execCall).toBeGreaterThan(-1);

    // Look for a `catch` within ~500 chars of the execCommand — that's
    // the fail-open handler.
    const window = SERVER_SRC.slice(execCall, execCall + 500);
    expect(window).toMatch(/catch\s*(\{|\()/);
  });
});
