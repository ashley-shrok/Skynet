/**
 * Regression guard: a pane whose SSH connection dies must not stay bound to
 * the dead connection.
 *
 * Observed 2026-10-28 (aqua@workstation, mitzi@boreal): the connection
 * dropped right after a conversation opened, the tail died with "No response
 * from server", nothing noticed, and every later send failed "Not connected"
 * until the user reopened the conversation. The fix watches the pane's
 * connection: an unexpected close tears the pane down and closes the WS with
 * the reconnect code (1011) so the client re-attaches on a fresh connection.
 *
 * The behavior lives inside the long-running `wss.on("connection")` handler,
 * which is impractical to drive end-to-end here (same constraint as the
 * pv-attach-liveness guard), so this is a source-structure guard.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVER_SRC = fs.readFileSync(path.join(__dirname, "claude-session-server.ts"), "utf-8");

describe("claude-session-server.ts — pane SSH connection loss", () => {
  const assign = SERVER_SRC.indexOf("    sshConn = conn;\n    // Long-lived for the pane's lifetime");
  const watcher = SERVER_SRC.slice(assign, assign + 1500);

  it("watches the pane connection for close right after binding it", () => {
    expect(assign).toBeGreaterThan(-1);
    expect(watcher).toMatch(/conn\.once\("close",/);
  });

  it("ignores closes from our own teardown (sshConn already moved on) and from a stopped WS", () => {
    expect(watcher).toMatch(/if \(stopped \|\| sshConn !== conn\) return;/);
  });

  it("closes the WS with the reconnect code, then tears the pane down", () => {
    const body = watcher.slice(watcher.indexOf('conn.once("close",'));
    const close = body.indexOf("closeForTornDownSession();");
    const teardown = body.indexOf("teardownPane();");
    expect(close).toBeGreaterThan(-1);
    expect(teardown).toBeGreaterThan(close);
    expect(body).toMatch(/operation: "claude_session_ssh_conn_lost"/);
  });

  it("our teardown nulls sshConn right after ending it, so the guard holds", () => {
    expect(SERVER_SRC).toMatch(/sshConn\.end\(\);\n\s+\} catch \(err\) \{[\s\S]{0,300}?\n\s+\}\n\s+sshConn = null;/);
  });
});
