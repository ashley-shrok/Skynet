/**
 * stopped-hook.test.ts
 *
 * Shell-level vitest coverage of stopped-hook.sh — the Phase 62 leaf-level
 * primitive that touches the per-session stopped marker on Stop, StopFailure,
 * and PermissionRequest harness hooks.
 *
 * Mirrors activity-hook.test.ts structure exactly; the only differences are
 * the target script, the marker filename (`stopped` vs `activity`), and Test J
 * which cross-checks the per-session directory invariant that both hooks
 * share the SAME per-session dir — a load-bearing invariant for Plan 62-03's
 * `activity_mtime > stopped_mtime` predicate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(HERE, "stopped-hook.sh");
const ACTIVITY_SCRIPT_PATH = path.join(HERE, "activity-hook.sh");
const MARKER_FILENAME = "stopped";

function runHook(scriptPath: string, input: string, homeDir: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const res = spawnSync("bash", [scriptPath], {
    input,
    env: { HOME: homeDir, PATH: process.env.PATH ?? "" },
    encoding: "utf-8",
    timeout: 5000,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function stoppedMarkerPath(homeDir: string, sid: string): string {
  return path.join(homeDir, ".claude", "fleet-status", "hooks", sid, MARKER_FILENAME);
}

function activityMarkerPath(homeDir: string, sid: string): string {
  return path.join(homeDir, ".claude", "fleet-status", "hooks", sid, "activity");
}

describe("stopped-hook.sh — per-session stopped marker touch", () => {
  let tmpHome: string;
  let testStartMs: number;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "stopped-hook-test-"));
    testStartMs = Date.now();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Test A: valid session_id + Stop payload → stopped marker exists with fresh mtime", () => {
    const payload = JSON.stringify({
      session_id: "abc",
      hook_event_name: "Stop",
    });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    const marker = stoppedMarkerPath(tmpHome, "abc");
    expect(fs.existsSync(marker)).toBe(true);
    const stat = fs.statSync(marker);
    expect(stat.mtimeMs).toBeGreaterThanOrEqual(testStartMs - 1000);
  });

  it("Test B: valid session_id + StopFailure payload → same stopped marker exists (event-agnostic)", () => {
    const payload = JSON.stringify({
      session_id: "abc",
      hook_event_name: "StopFailure",
      error: "turn ended in error",
    });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    const marker = stoppedMarkerPath(tmpHome, "abc");
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("Test C: valid session_id + PermissionRequest payload → same stopped marker exists (waiting-on-permission = done)", () => {
    const payload = JSON.stringify({
      session_id: "abc",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
    });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    const marker = stoppedMarkerPath(tmpHome, "abc");
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("Test D: missing session_id → no marker dir, no marker file, exit 0", () => {
    const payload = JSON.stringify({ hook_event_name: "Stop" });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test E: path-traversal session_id (../evil) → no marker anywhere, exit 0", () => {
    const payload = JSON.stringify({
      session_id: "../evil",
      hook_event_name: "Stop",
    });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    const traversedMarker = path.join(
      tmpHome,
      ".claude",
      "fleet-status",
      "evil",
      MARKER_FILENAME,
    );
    expect(fs.existsSync(traversedMarker)).toBe(false);
    const literalMarker = stoppedMarkerPath(tmpHome, "../evil");
    expect(fs.existsSync(literalMarker)).toBe(false);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test F: shell-metachar session_id (a$(rm -rf ~)) → no marker created, $HOME intact, exit 0", () => {
    const sentinelPath = path.join(tmpHome, "sentinel.keep");
    fs.writeFileSync(sentinelPath, "keep-me");

    const payload = JSON.stringify({
      session_id: "a$(rm -rf ~)",
      hook_event_name: "Stop",
    });
    const res = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res.status).toBe(0);
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test G: malformed JSON on stdin → exit 0, no marker", () => {
    const res = runHook(SCRIPT_PATH, "{not json", tmpHome);
    expect(res.status).toBe(0);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test H: double invocation with same session_id → marker still exists, mtime advanced (or equal within FS granularity)", () => {
    const payload = JSON.stringify({
      session_id: "shared",
      hook_event_name: "Stop",
    });
    const res1 = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res1.status).toBe(0);
    const marker = stoppedMarkerPath(tmpHome, "shared");
    expect(fs.existsSync(marker)).toBe(true);
    const mtime1 = fs.statSync(marker).mtimeMs;

    const waitUntil = Date.now() + 1100;
    while (Date.now() < waitUntil) {
      // busy-wait — see activity-hook.test.ts Test G rationale
    }

    const res2 = runHook(SCRIPT_PATH, payload, tmpHome);
    expect(res2.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
    const mtime2 = fs.statSync(marker).mtimeMs;
    expect(mtime2).toBeGreaterThanOrEqual(mtime1);
  });

  it("Test I: bash -n static-syntax check passes on the shipped script", () => {
    const res = spawnSync("bash", ["-n", SCRIPT_PATH], {
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  it("Test J (cross-invariant): activity-hook and stopped-hook write into the SAME per-session dir — both markers coexist under hooks/<sid>/", () => {
    const sid = "shared";
    // Fire activity-hook first (UserPromptSubmit-style).
    const activityPayload = JSON.stringify({
      session_id: sid,
      hook_event_name: "UserPromptSubmit",
    });
    const resA = runHook(ACTIVITY_SCRIPT_PATH, activityPayload, tmpHome);
    expect(resA.status).toBe(0);
    // Fire stopped-hook second (Stop-style).
    const stoppedPayload = JSON.stringify({
      session_id: sid,
      hook_event_name: "Stop",
    });
    const resB = runHook(SCRIPT_PATH, stoppedPayload, tmpHome);
    expect(resB.status).toBe(0);
    // Both markers must live in the SAME per-session directory.
    const activityMarker = activityMarkerPath(tmpHome, sid);
    const stoppedMarker = stoppedMarkerPath(tmpHome, sid);
    expect(fs.existsSync(activityMarker)).toBe(true);
    expect(fs.existsSync(stoppedMarker)).toBe(true);
    // Parent-directory identity: they must share the exact same parent path.
    expect(path.dirname(activityMarker)).toBe(path.dirname(stoppedMarker));
    // And that parent must be exactly hooks/<sid>/.
    expect(path.basename(path.dirname(activityMarker))).toBe(sid);
  });
});
