/**
 * desktop-deps.test.ts — DESKTOP_DEPS_CMD run under real `sh` with a sealed
 * PATH: fake sudo / apt-get / dnf / rpm-ostree stubs record their argv and
 * "install" by dropping stub commands into the bin dir. The host's real
 * /usr/bin is never on PATH, so its own Xvnc etc. can't leak in. The script
 * detaches the install, so tests wait for it before the follow-up sweep.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import nodeOs from "node:os";
import nodePath from "node:path";
import {
  DESKTOP_DEPS_CMD,
  DESKTOP_DEPS_SENTINEL,
  parseDesktopDepsOutput,
} from "./desktop-deps.js";

const ALL = ["Xvnc", "vncpasswd", "openbox", "xdotool", "import"];
// Real tools the script needs, linked into the sealed bin dir.
const TOOLS = ["sh", "tail", "rm", "id", "cat", "true", "chmod", "mkdir", "setsid", "nohup", "sleep"];

let root: string;
let bin: string;
let marker: string;
let calls: string;

async function stub(name: string, body: string): Promise<void> {
  const p = nodePath.join(bin, name);
  await fsp.writeFile(p, `#!/bin/sh\n${body}\n`);
  await fsp.chmod(p, 0o755);
}

/** A package manager stub: records its argv, then provides `provides`. */
async function pm(name: string, provides: string[], extra = ""): Promise<void> {
  const touches = provides
    .map((c) => `printf '#!/bin/sh\\n' > "${bin}/${c}"; chmod +x "${bin}/${c}"`)
    .join("\n");
  await stub(name, `echo "${name} $*" >> "${calls}"\n${extra}\n${touches}`);
}

function run(opts: { ostree?: boolean } = {}): string {
  const cmd = DESKTOP_DEPS_CMD.replace(
    "/run/ostree-booted",
    opts.ostree ? marker : nodePath.join(root, "absent"),
  );
  return execFileSync("/bin/sh", ["-c", cmd], {
    env: { PATH: bin, HOME: root },
    encoding: "utf-8",
  });
}

const lastLine = (out: string) => out.trimEnd().split("\n").pop();
const stateDir = () => nodePath.join(root, ".cache", "fleet-desktop-deps");

/** Wait for the detached install launched by the previous run to exit. */
async function settle(): Promise<void> {
  const pid = (await fsp.readFile(nodePath.join(stateDir(), "install.pid"), "utf-8")).trim();
  for (let i = 0; i < 100 && existsSync(`/proc/${pid}`); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (existsSync(`/proc/${pid}`)) throw new Error("background install never exited");
}
const recorded = async () => (await fsp.readFile(calls, "utf-8").catch(() => "")).trim();

beforeEach(async () => {
  root = await fsp.mkdtemp(nodePath.join(nodeOs.tmpdir(), "desktop-deps-"));
  bin = nodePath.join(root, "bin");
  marker = nodePath.join(root, "ostree-booted");
  calls = nodePath.join(root, "calls");
  await fsp.mkdir(bin);
  await fsp.writeFile(marker, "");
  for (const t of TOOLS) {
    // Not `command -v`: it answers "true" for the shell builtin.
    const real = ["/usr/bin", "/bin"].map((d) => nodePath.join(d, t)).find((p) => existsSync(p));
    if (!real) throw new Error(`test needs ${t} in /usr/bin or /bin`);
    await fsp.symlink(real, nodePath.join(bin, t));
  }
  // Passwordless sudo: drop -n, run the rest.
  await stub("sudo", `[ "$1" = -n ] && shift; exec "$@"`);
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("DESKTOP_DEPS_CMD", () => {
  it("everything present → present, no package manager runs, no state left", async () => {
    await pm("apt-get", []);
    for (const c of ALL) await stub(c, "");
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} present\n`);
    expect(await recorded()).toBe("");
    expect(existsSync(stateDir())).toBe(false);
  });

  it("apt host → started in background, next sweep sees installed and clears state", async () => {
    await pm("apt-get", ALL);
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} started ${ALL.join(" ")}\n`);
    await settle();
    expect((await recorded()).split("\n")).toEqual([
      "apt-get update -q",
      "apt-get install -y -q -o DPkg::Lock::Timeout=600 --no-install-recommends " +
        "tigervnc-standalone-server tigervnc-tools openbox xdotool imagemagick x11-xserver-utils",
    ]);
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} installed\n`);
    expect(existsSync(stateDir())).toBe(false);
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} present\n`);
  });

  it("installer gets /dev/null on stdin, so it can't eat the rest of the script", async () => {
    await pm("apt-get", ALL, "cat > /dev/null");
    expect(lastLine(run())).toMatch(/ started /);
    await settle();
    expect(lastLine(run())).toBe(`${DESKTOP_DEPS_SENTINEL} installed`);
  });

  it("install still running → running, nothing relaunched", async () => {
    await pm("apt-get", ALL, "sleep 1");
    expect(lastLine(run())).toMatch(/ started /);
    expect(lastLine(run())).toBe(`${DESKTOP_DEPS_SENTINEL} running ${ALL.join(" ")}`);
    await settle();
    expect((await recorded()).match(/apt-get install/g)).toHaveLength(1);
  });

  it("image-based Fedora → rpm-ostree --apply-live, only the missing packages, deduped", async () => {
    await stub("xdotool", "");
    await stub("import", "");
    await stub("xsetroot", "");
    await pm("rpm-ostree", ["Xvnc", "vncpasswd", "openbox"]);
    await pm("dnf", ALL); // present on Bazzite but can't write /usr — must not be used
    expect(lastLine(run({ ostree: true }))).toBe(
      `${DESKTOP_DEPS_SENTINEL} started Xvnc vncpasswd openbox`,
    );
    await settle();
    expect(await recorded()).toBe(
      "rpm-ostree install --idempotent --apply-live tigervnc-server openbox",
    );
  });

  it("image-based Fedora without xsetroot → requests it too", async () => {
    await pm("rpm-ostree", ALL);
    run({ ostree: true });
    await settle();
    expect(await recorded()).toBe(
      "rpm-ostree install --idempotent --apply-live tigervnc-server openbox xdotool ImageMagick xsetroot",
    );
  });

  it("dnf host (not ostree) → dnf", async () => {
    await pm("dnf", ALL);
    run();
    await settle();
    expect(await recorded()).toMatch(/^dnf install -y -q tigervnc-server openbox/);
  });

  it("no passwordless sudo → no-root, nothing installed", async () => {
    await stub("sudo", "exit 1");
    await pm("apt-get", ALL);
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} no-root ${ALL.join(" ")}\n`);
    expect(await recorded()).toBe("");
  });

  it("no known package manager → unsupported", () => {
    expect(run()).toBe(`${DESKTOP_DEPS_SENTINEL} unsupported ${ALL.join(" ")}\n`);
  });

  it("failed install → next sweep retries and carries the previous output tail", async () => {
    await pm("apt-get", ["Xvnc"], "echo 'E: Unable to locate package openbox'");
    run();
    await settle();
    const parsed = parseDesktopDepsOutput(run());
    expect(parsed).toMatchObject({
      status: "started",
      missing: ["vncpasswd", "openbox", "xdotool", "import"],
    });
    expect(parsed?.detail).toContain("Unable to locate package openbox");
    await settle();
  });
});

describe("parseDesktopDepsOutput", () => {
  it("returns null without a result line or with an unknown status", () => {
    expect(parseDesktopDepsOutput("")).toBeNull();
    expect(parseDesktopDepsOutput("sh: 1: oops")).toBeNull();
    expect(parseDesktopDepsOutput(`${DESKTOP_DEPS_SENTINEL} no-state-dir Xvnc`)).toBeNull();
  });
});
