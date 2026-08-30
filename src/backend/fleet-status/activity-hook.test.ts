/**
 * activity-hook.test.ts
 *
 * Shell-level vitest coverage of activity-hook.sh — the Phase 62 leaf-level
 * primitive that touches the per-session activity marker on UserPromptSubmit
 * and PreToolUse harness hooks.
 *
 * These tests spawn `bash /abs/path/to/activity-hook.sh` via child_process.spawnSync
 * with a per-test mktemp'd HOME, pipe a synthetic harness payload on stdin, and
 * assert on the marker file's existence + mtime + fail-open discipline.
 *
 * NO ts-level mocks — this is a shell-level test. The script contract lives in
 * the .sh file; these tests defend it. The remote-hook-install.ts inlining path
 * is out of scope here (Plan 62-02 owns it).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(HERE, "activity-hook.sh");
const MARKER_FILENAME = "activity";

function runHook(input: string, homeDir: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const res = spawnSync("bash", [SCRIPT_PATH], {
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

function markerPath(homeDir: string, sid: string): string {
  return path.join(homeDir, ".claude", "fleet-status", "hooks", sid, MARKER_FILENAME);
}

describe("activity-hook.sh — per-session activity marker touch", () => {
  let tmpHome: string;
  let testStartMs: number;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "activity-hook-test-"));
    testStartMs = Date.now();
  });

  afterEach(() => {
    // Best-effort cleanup — never fatal.
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Test A: valid session_id + UserPromptSubmit payload → marker exists with fresh mtime", () => {
    const payload = JSON.stringify({
      session_id: "abc123-DEF",
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    });
    const res = runHook(payload, tmpHome);
    expect(res.status).toBe(0);
    const marker = markerPath(tmpHome, "abc123-DEF");
    expect(fs.existsSync(marker)).toBe(true);
    const stat = fs.statSync(marker);
    // mtime should be >= test start (allow filesystem 1s granularity slack)
    expect(stat.mtimeMs).toBeGreaterThanOrEqual(testStartMs - 1000);
  });

  it("Test B: valid session_id + PreToolUse payload (with tool_name) → same marker exists (event-agnostic)", () => {
    const payload = JSON.stringify({
      session_id: "abc123-DEF",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const res = runHook(payload, tmpHome);
    expect(res.status).toBe(0);
    const marker = markerPath(tmpHome, "abc123-DEF");
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("Test C: missing session_id → no marker dir, no marker file, exit 0", () => {
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit" });
    const res = runHook(payload, tmpHome);
    expect(res.status).toBe(0);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      // If mkdir -p ${MARKER_ROOT} runs (as the shape allows), the dir may
      // exist but must be empty — no per-session subdir was created.
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test D: path-traversal session_id (../evil) → no marker created anywhere, exit 0", () => {
    const payload = JSON.stringify({
      session_id: "../evil",
      hook_event_name: "UserPromptSubmit",
    });
    const res = runHook(payload, tmpHome);
    expect(res.status).toBe(0);
    // The traversal target would be tmpHome/.claude/fleet-status/hooks/../evil/activity
    // → resolves to tmpHome/.claude/fleet-status/evil/activity. Must NOT exist.
    const traversedMarker = path.join(
      tmpHome,
      ".claude",
      "fleet-status",
      "evil",
      MARKER_FILENAME,
    );
    expect(fs.existsSync(traversedMarker)).toBe(false);
    // And the literal "../evil" subdir must not exist under hooks/ either.
    const literalMarker = markerPath(tmpHome, "../evil");
    expect(fs.existsSync(literalMarker)).toBe(false);
    // And no per-session subdir under hooks/ should have been created at all.
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test E: shell-metachar session_id (a$(rm -rf ~)) → no marker created, $HOME intact, exit 0", () => {
    // Populate tmpHome with a sentinel file. If the shell somehow evaluated
    // the metachar in the session_id, `rm -rf ~` (which would resolve to
    // tmpHome under our env) would delete it. We assert it survives.
    const sentinelPath = path.join(tmpHome, "sentinel.keep");
    fs.writeFileSync(sentinelPath, "keep-me");

    const payload = JSON.stringify({
      session_id: "a$(rm -rf ~)",
      hook_event_name: "UserPromptSubmit",
    });
    const res = runHook(payload, tmpHome);
    expect(res.status).toBe(0);
    // Belt: sentinel intact.
    expect(fs.existsSync(sentinelPath)).toBe(true);
    // Suspenders: no marker under any candidate directory.
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test F: malformed JSON on stdin → exit 0, no marker", () => {
    const res = runHook("{not json", tmpHome);
    expect(res.status).toBe(0);
    const hooksRoot = path.join(tmpHome, ".claude", "fleet-status", "hooks");
    if (fs.existsSync(hooksRoot)) {
      expect(fs.readdirSync(hooksRoot)).toHaveLength(0);
    }
  });

  it("Test G: double invocation with same session_id → marker still exists, mtime advanced (or equal within FS granularity)", () => {
    const payload = JSON.stringify({
      session_id: "shared",
      hook_event_name: "UserPromptSubmit",
    });
    const res1 = runHook(payload, tmpHome);
    expect(res1.status).toBe(0);
    const marker = markerPath(tmpHome, "shared");
    expect(fs.existsSync(marker)).toBe(true);
    const mtime1 = fs.statSync(marker).mtimeMs;

    // Wait ~1.1s to guarantee mtime granularity is exceeded on any POSIX fs.
    const waitUntil = Date.now() + 1100;
    while (Date.now() < waitUntil) {
      // busy-wait — spawnSync is sync, and we don't want to introduce a fake
      // timer harness for a leaf-level shell test.
    }

    const res2 = runHook(payload, tmpHome);
    expect(res2.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
    const mtime2 = fs.statSync(marker).mtimeMs;
    // Use >= (not >) — some tmpfs mounts have coarse granularity and could
    // return equal mtimes even after a 1s wait. The invariant is "not
    // regressed"; a fresh advance is best-effort.
    expect(mtime2).toBeGreaterThanOrEqual(mtime1);
  });

  it("Test H: bash -n static-syntax check passes on the shipped script", () => {
    const res = spawnSync("bash", ["-n", SCRIPT_PATH], {
      encoding: "utf-8",
      timeout: 5000,
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });
});
