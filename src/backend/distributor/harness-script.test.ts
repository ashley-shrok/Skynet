/**
 * harness-script.test.ts — Runs the REAL host-side reconcile script under
 * bash against a throwaway $HOME, with fake `curl` / `df` on PATH and a fake
 * official installer that mimics the real one's on-disk effect (binary at
 * ~/.local/share/claude/versions/<v>, symlink at ~/.local/bin/claude).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  HARNESS_RECONCILE_SCRIPT,
  buildRemoteHarnessCommand,
  parseHarnessResult,
} from "./harness-script.js";
import { HARNESS_PIN, HARNESS_PIN_PATTERN } from "./harness-pin.js";

const PIN = "2.1.286";

let root: string;
let home: string;
let fakeBin: string;
let curlLog: string;

function writeExec(p: string, body: string): void {
  fs.writeFileSync(p, body, { mode: 0o755 });
}

/** A fake harness binary that reports `v` like the real one does. */
function placeVersion(v: string): string {
  const dir = path.join(home, ".local", "share", "claude", "versions");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, v);
  writeExec(p, `#!/bin/bash\necho "${v} (Claude Code)"\n`);
  return p;
}

function linkTo(target: string): void {
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.rmSync(path.join(bin, "claude"), { force: true });
  fs.symlinkSync(target, path.join(bin, "claude"));
}

function run(
  args: string[],
  extraEnv: Record<string, string> = {},
  pathOverride?: string,
): { stdout: string; status: number | null } {
  const r = spawnSync("bash", ["-c", HARNESS_RECONCILE_SCRIPT, "skynet-harness", ...args], {
    env: {
      HOME: home,
      PATH: pathOverride ?? `${fakeBin}:${process.env.PATH}`,
      CURL_LOG: curlLog,
      ...extraEnv,
    },
    encoding: "utf-8",
  });
  return { stdout: r.stdout, status: r.status };
}

function curlCalls(): number {
  return fs.existsSync(curlLog) ? fs.readFileSync(curlLog, "utf-8").split("\n").filter(Boolean).length : 0;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-script-"));
  home = path.join(root, "home");
  fakeBin = path.join(root, "fakebin");
  curlLog = path.join(root, "curl.log");
  fs.mkdirSync(home);
  fs.mkdirSync(fakeBin);

  // Fake official installer: honours FAKE_INSTALL_EXIT / FAKE_NO_LINK.
  const installer = path.join(root, "fake-install.sh");
  writeExec(
    installer,
    `#!/bin/bash
v="$1"
if [ -n "\${FAKE_INSTALL_EXIT:-}" ]; then echo "boom: cannot install"; exit "$FAKE_INSTALL_EXIT"; fi
d="$HOME/.local/share/claude/versions"; mkdir -p "$d" "$HOME/.local/bin"
printf '#!/bin/bash\\necho "%s (Claude Code)"\\n' "$v" > "$d/$v"; chmod +x "$d/$v"
[ -z "\${FAKE_NO_LINK:-}" ] && ln -sfn "$d/$v" "$HOME/.local/bin/claude"
echo "Installation complete"
`,
  );
  // Fake curl: `curl -fsSL URL -o OUT` → copy the fake installer to OUT.
  writeExec(
    path.join(fakeBin, "curl"),
    `#!/bin/bash
echo "$*" >> "$CURL_LOG"
[ -n "\${FAKE_CURL_FAIL:-}" ] && { echo "curl: (6) Could not resolve host" >&2; exit 6; }
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { cp "${installer}" "$2"; exit 0; }; shift; done
exit 2
`,
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("harness pin", () => {
  it("is an exact MAJOR.MINOR.PATCH version", () => {
    expect(HARNESS_PIN).toMatch(HARNESS_PIN_PATTERN);
    expect(HARNESS_PIN_PATTERN.test("latest")).toBe(false);
    expect(HARNESS_PIN_PATTERN.test("stable")).toBe(false);
  });
});

describe("harness reconcile script", () => {
  it("installs the pin on a host with no harness", () => {
    const { stdout, status } = run([PIN]);
    expect(status).toBe(0);
    const r = parseHarnessResult(stdout);
    expect(r).toMatchObject({ action: "installed", wanted: PIN, found: "none" });
    expect(fs.readlinkSync(path.join(home, ".local/bin/claude"))).toBe(
      path.join(home, ".local/share/claude/versions", PIN),
    );
    expect(curlCalls()).toBe(1);
    expect(fs.readFileSync(curlLog, "utf-8")).toContain("https://claude.ai/install.sh");
  });

  it("is a no-op with no download when already on the pin", () => {
    linkTo(placeVersion(PIN));
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "none", wanted: PIN, found: PIN });
    expect(curlCalls()).toBe(0);
  });

  it("treats a converged host as converged when $HOME is reached through a symlink", () => {
    linkTo(placeVersion(PIN));
    const alias = path.join(root, "home-alias");
    fs.symlinkSync(home, alias);
    const r = spawnSync("bash", ["-c", HARNESS_RECONCILE_SCRIPT, "x", PIN], {
      env: { HOME: alias, PATH: `${fakeBin}:${process.env.PATH}`, CURL_LOG: curlLog },
      encoding: "utf-8",
    });
    expect(parseHarnessResult(r.stdout)?.action).toBe("none");
  });

  it("upgrades, keeping the previous version and pruning older ones", () => {
    placeVersion("2.1.150");
    linkTo(placeVersion("2.1.200"));
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "installed", found: "2.1.200", pruned: ["2.1.150"] });
    const left = fs.readdirSync(path.join(home, ".local/share/claude/versions")).sort();
    expect(left).toEqual(["2.1.200", PIN].sort());
  });

  it("moves DOWN to an older pin the same way (rollback)", () => {
    linkTo(placeVersion("2.1.300"));
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "installed", found: "2.1.300" });
    expect(fs.readlinkSync(path.join(home, ".local/bin/claude"))).toContain(`/versions/${PIN}`);
  });

  it("relinks without downloading when the pinned version is already on disk", () => {
    placeVersion(PIN);
    linkTo(placeVersion("2.1.300"));
    placeVersion("2.1.100");
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "relinked", found: "2.1.300", pruned: ["2.1.100"] });
    expect(curlCalls()).toBe(0);
    expect(fs.readlinkSync(path.join(home, ".local/bin/claude"))).toBe(
      path.join(home, ".local/share/claude/versions", PIN),
    );
  });

  it("does not trust an on-disk pin file that reports a different version", () => {
    const dir = path.join(home, ".local/share/claude/versions");
    fs.mkdirSync(dir, { recursive: true });
    writeExec(path.join(dir, PIN), `#!/bin/bash\necho "9.9.9 (Claude Code)"\n`);
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r?.action).toBe("installed");
    expect(curlCalls()).toBe(1);
  });

  it("reports a host whose claude is not an installer-managed link as unmanaged and installs", () => {
    fs.mkdirSync(path.join(home, ".local/bin"), { recursive: true });
    writeExec(path.join(home, ".local/bin/claude"), "#!/bin/bash\necho old\n");
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "installed", found: "unmanaged" });
  });

  it("never prunes non-version entries in the versions folder", () => {
    linkTo(placeVersion("2.1.200"));
    const dir = path.join(home, ".local/share/claude/versions");
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    run([PIN]);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });

  it("fails (and leaves the old link alone) when the installer exits non-zero", () => {
    const old = placeVersion("2.1.200");
    linkTo(old);
    const r = parseHarnessResult(run([PIN], { FAKE_INSTALL_EXIT: "3" }).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "installer-exit-3" });
    expect(r?.detail).toContain("boom");
    expect(fs.readlinkSync(path.join(home, ".local/bin/claude"))).toBe(old);
    // Nothing pruned on failure.
    expect(fs.existsSync(old)).toBe(true);
  });

  it("fails when the installer download fails", () => {
    const r = parseHarnessResult(run([PIN], { FAKE_CURL_FAIL: "1" }).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "download-failed" });
  });

  it("fails verification when the installer exits 0 but never links the pin", () => {
    const r = parseHarnessResult(run([PIN], { FAKE_NO_LINK: "1" }).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "verify-failed" });
  });

  it("refuses to install when free disk is below the floor", () => {
    writeExec(
      path.join(fakeBin, "df"),
      `#!/bin/bash\necho "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "/dev/root 100 99 1000 99% /"\n`,
    );
    const r = parseHarnessResult(run([PIN]).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "low-disk" });
    expect(curlCalls()).toBe(0);
  });

  it("fails cleanly with no downloader on PATH", () => {
    // A PATH holding only the tools the script needs other than curl/wget.
    const minimal = path.join(root, "minimal");
    fs.mkdirSync(minimal);
    for (const tool of [
      "bash", "basename", "dirname", "readlink", "uname", "mkdir", "df", "awk",
      "mv", "ln", "rm", "head", "grep", "tr", "cut", "tail", "cat",
    ]) {
      const which = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf-8" }).stdout.trim();
      if (which) fs.symlinkSync(which, path.join(minimal, tool));
    }
    const r = parseHarnessResult(run([PIN], {}, minimal).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "no-downloader" });
  });

  it("rejects a non-exact pin", () => {
    for (const bad of ["latest", "2..1", "...", "2.1", "2.1.286.1"]) {
      const r = parseHarnessResult(run([bad]).stdout);
      expect(r).toMatchObject({ action: "failed", reason: "bad-pin" });
    }
    expect(curlCalls()).toBe(0);
  });

  it("reports busy instead of racing a reconcile that is already running on the host", () => {
    const work = path.join(home, ".cache/skynet-harness");
    fs.mkdirSync(work, { recursive: true });
    const holder = spawn("flock", [path.join(work, "lock"), "sleep", "10"], { stdio: "ignore" });
    try {
      // Give flock a moment to take the lock.
      spawnSync("bash", ["-c", "sleep 0.3"]);
      const r = parseHarnessResult(run([PIN]).stdout);
      expect(r).toMatchObject({ action: "failed", reason: "busy" });
      expect(curlCalls()).toBe(0);
    } finally {
      holder.kill();
    }
  });

  it("never runs a leftover installer when the fresh download fails", () => {
    const work = path.join(home, ".cache/skynet-harness");
    fs.mkdirSync(work, { recursive: true });
    const marker = path.join(root, "stale-ran");
    writeExec(path.join(work, "install.sh"), `#!/bin/bash
touch "${marker}"
`);
    const r = parseHarnessResult(run([PIN], { FAKE_CURL_FAIL: "1" }).stdout);
    expect(r).toMatchObject({ action: "failed", reason: "download-failed" });
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(work, "install.sh"))).toBe(false);
  });

  it("keeps an old version that a running process is still executing", async () => {
    const dir = path.join(home, ".local/share/claude/versions");
    fs.mkdirSync(dir, { recursive: true });
    // A real executable so /proc/<pid>/exe points at the versions file.
    const busy = path.join(dir, "2.1.100");
    fs.copyFileSync(spawnSync("bash", ["-c", "command -v sleep"], { encoding: "utf-8" }).stdout.trim(), busy);
    fs.chmodSync(busy, 0o755);
    placeVersion("2.1.150");
    linkTo(placeVersion("2.1.200"));
    const proc = spawn(busy, ["10"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 200));
      const r = parseHarnessResult(run([PIN]).stdout);
      expect(r).toMatchObject({ action: "installed", pruned: ["2.1.150"] });
      expect(fs.existsSync(busy)).toBe(true);
    } finally {
      proc.kill();
    }
  });

  it("also writes the result line to the result file when given one", () => {
    const resultFile = path.join(home, ".cache/skynet-harness/result-abc");
    const { stdout } = run([PIN, resultFile]);
    const fromFile = fs.readFileSync(resultFile, "utf-8");
    expect(fromFile.trim()).toBe(stdout.trim());
    expect(parseHarnessResult(fromFile)?.action).toBe("installed");
  });

  it("prints exactly one result line (installer chatter goes to the log)", () => {
    const { stdout } = run([PIN]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(fs.readFileSync(path.join(home, ".cache/skynet-harness/install.log"), "utf-8")).toContain(
      "Installation complete",
    );
  });
});

describe("buildRemoteHarnessCommand", () => {
  it("refuses a pin that is not an exact version", () => {
    expect(() => buildRemoteHarnessCommand("2.1.286'; rm -rf ~; '")).toThrow();
    expect(() => buildRemoteHarnessCommand("latest")).toThrow();
  });

  it("runs the script end-to-end through a shell and reports the exit marker", () => {
    linkTo(placeVersion(PIN));
    const r = spawnSync("bash", ["-c", buildRemoteHarnessCommand(PIN)], {
      env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, CURL_LOG: curlLog },
      encoding: "utf-8",
    });
    expect(r.stdout).toContain("HARNESS_EXIT:0");
    expect(parseHarnessResult(r.stdout)?.action).toBe("none");
  });

  it("does not let the installer read the script from stdin", () => {
    // The installer runs with stdin closed: a fake installer that drains
    // stdin must still see nothing and the run must complete.
    const r = spawnSync("bash", ["-c", buildRemoteHarnessCommand(PIN)], {
      env: { HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, CURL_LOG: curlLog },
      encoding: "utf-8",
      input: "garbage on stdin\n",
    });
    expect(parseHarnessResult(r.stdout)?.action).toBe("installed");
  });
});

describe("parseHarnessResult", () => {
  it("parses keys, pruned list and free-text detail", () => {
    expect(
      parseHarnessResult(
        "noise\nHARNESS_RESULT action=installed wanted=1.2.3 found=1.2.0 pruned=1.1.0,1.0.0 detail=installed via official installer\nHARNESS_EXIT:0",
      ),
    ).toEqual({
      action: "installed",
      wanted: "1.2.3",
      found: "1.2.0",
      pruned: ["1.1.0", "1.0.0"],
      detail: "installed via official installer",
    });
  });

  it("keeps detail text containing '=' and spaces intact", () => {
    const r = parseHarnessResult(
      "HARNESS_RESULT action=failed wanted=1.2.3 found=none reason=low-disk detail=5KiB free in /home/u, need x=y",
    );
    expect(r).toMatchObject({ reason: "low-disk", detail: "5KiB free in /home/u, need x=y" });
  });

  it("treats pruned=none as no prunes", () => {
    expect(
      parseHarnessResult("HARNESS_RESULT action=relinked wanted=1.2.3 found=1.2.0 pruned=none detail=x")?.pruned,
    ).toBeUndefined();
  });

  it("returns null for missing, empty or malformed output", () => {
    expect(parseHarnessResult(null)).toBeNull();
    expect(parseHarnessResult("")).toBeNull();
    expect(parseHarnessResult("HARNESS_EXIT:1")).toBeNull();
    expect(parseHarnessResult("HARNESS_RESULT action=bogus wanted=1")).toBeNull();
  });
});
