/**
 * Parity: the agent-history lookup has three implementations — the shell
 * script the backend runs over SSH (agent-history-file.ts) and the two
 * Python sweeps on each host (pv-context-pct-sweep, fleet-status-sweep).
 * They must agree on every agent's file, or the conversation view, the
 * sidebar and the memory pie would read different histories.
 *
 * One fixture home, every tricky shape, all three implementations run for
 * real (bash and python3), answers compared.
 */
import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildAgentHistoryScript, parseAgentHistoryStdout, pickNewestOwned } from "./agent-history-file.js";

const REPO = path.resolve(__dirname, "../../..");

function run(cmd: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env } }, (err, out, errOut) =>
      err ? reject(new Error(`${cmd} failed: ${err.message}\n${errOut}`)) : resolve(out),
    ),
  );
}

const idLine = (name: string) =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: `<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>${name}</command-args>`,
    },
  });
const plainLine = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const preamble = ['{"type":"mode","mode":"normal"}', '{"type":"queue-operation","operation":"enqueue","content":"x"}'];

describe("agent-history lookup — shell and Python sweeps agree", () => {
  let home: string;
  const names = ["solo", "many", "bare-newer", "foreign", "tiff", "tiffany", "empty", "nofolder", "late-id"];
  const expected: Record<string, string | null> = {};

  async function seed(name: string, file: string, lines: string[], mtime: number, folderOwner = name) {
    const launch = `${home}/fleet/identities/${folderOwner}/workspace`;
    const dir = path.join(home, ".claude", "projects", launch.replace(/[^a-zA-Z0-9]/g, "-"));
    await fsp.mkdir(dir, { recursive: true });
    const full = path.join(dir, file);
    await fsp.writeFile(full, lines.join("\n") + "\n");
    await fsp.utimes(full, mtime, mtime);
    return full;
  }

  beforeAll(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), "history-parity-"));
    expected.solo = await seed("solo", "a.jsonl", [...preamble, idLine("solo")], 1000);
    await seed("many", "old.jsonl", [idLine("many")], 1000);
    expected.many = await seed("many", "new.jsonl", [idLine("many")], 3000);
    expected["bare-newer"] = await seed("bare-newer", "owned.jsonl", [idLine("bare-newer")], 1000);
    await seed("bare-newer", "bare.jsonl", [plainLine("reply with just: ok")], 9000);
    // A file starting with foreign's /id but outside foreign's folder.
    await seed("foreign", "x.jsonl", [idLine("foreign")], 5000, "somebody-else");
    expected.foreign = null;
    expected.tiff = await seed("tiff", "t.jsonl", [idLine("tiff")], 1000);
    await seed("tiffany", "u.jsonl", [idLine("tiff")], 1000);
    expected.tiffany = null;
    await fsp.mkdir(path.join(home, ".claude", "projects", `${home}/fleet/identities/empty/workspace`.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
    expected.empty = null;
    expected.nofolder = null;
    await seed("late-id", "a.jsonl", [plainLine("hi"), idLine("late-id")], 1000);
    expected["late-id"] = null;
  });

  afterAll(async () => {
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
  });

  it("the shell lookup finds what the fixture says", async () => {
    const out = await run("bash", ["-c", buildAgentHistoryScript(names)], { HOME: home });
    expect(Object.fromEntries(pickNewestOwned(names, parseAgentHistoryStdout(out)))).toEqual(expected);
  });

  for (const script of ["pv-context-pct-sweep.py", "fleet-status-sweep.py"]) {
    it(`${script} agrees`, async () => {
      const driver =
        "import importlib.util, json, sys\n" +
        "spec = importlib.util.spec_from_file_location('m', sys.argv[1])\n" +
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n" +
        "print(json.dumps({n: m.discover_identity_jsonl_path(n, sys.argv[2]) for n in sys.argv[3:]}))\n";
      const out = await run(
        "python3",
        ["-I", "-c", driver, path.join(REPO, "substrate/scripts", script), home, ...names],
        { HOME: home },
      );
      expect(JSON.parse(out)).toEqual(expected);
    });
  }
});

describe("agent-history lookup — symlinked home (Bazzite: /home → /var/home)", () => {
  let base: string;
  let linkHome: string;
  let expectedPath: string;

  beforeAll(async () => {
    base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "history-symlink-")));
    const realHome = path.join(base, "var-home", "riley");
    await fsp.mkdir(realHome, { recursive: true });
    linkHome = path.join(base, "home-riley");
    await fsp.symlink(realHome, linkHome);
    // Claude names the folder after the REAL launch path.
    const folder = `${realHome}/fleet/identities/rune/workspace`.replace(/[^a-zA-Z0-9]/g, "-");
    const dir = path.join(realHome, ".claude", "projects", folder);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "r.jsonl"), idLine("rune") + "\n");
    expectedPath = path.join(linkHome, ".claude", "projects", folder, "r.jsonl");
  });

  afterAll(async () => {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
  });

  it("the shell lookup names the folder from the resolved home", async () => {
    const out = await run("bash", ["-c", buildAgentHistoryScript(["rune"])], { HOME: linkHome });
    expect(pickNewestOwned(["rune"], parseAgentHistoryStdout(out)).get("rune")).toBe(expectedPath);
  });

  for (const script of ["pv-context-pct-sweep.py", "fleet-status-sweep.py"]) {
    it(`${script} names the folder from the resolved home`, async () => {
      const driver =
        "import importlib.util, sys\n" +
        "spec = importlib.util.spec_from_file_location('m', sys.argv[1])\n" +
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n" +
        "print(m.discover_identity_jsonl_path('rune', sys.argv[2]))\n";
      const out = await run("python3", ["-I", "-c", driver, path.join(REPO, "substrate/scripts", script), linkHome], {
        HOME: linkHome,
      });
      expect(out.trim()).toBe(expectedPath);
    });
  }
});

describe("agent-history lookup — inside the Skynet container, ties and symlinked files", () => {
  // Inside the container the local-host poll runs with HOME = the bind mount
  // (HOME_HOST_DIR), but Claude named the folders on the host after
  // SKYNET_HOME_MOUNT_SRC. All three implementations must name from the host.
  let mount: string;
  const hostHome = "/home/hostuser";
  const folder = (name: string) => `${hostHome}/fleet/identities/${name}/workspace`.replace(/[^a-zA-Z0-9]/g, "-");
  const env = () => ({ HOME: mount, HOME_HOST_DIR: mount, SKYNET_HOME_MOUNT_SRC: hostHome });
  const expected: Record<string, string | null> = {};
  const names = ["mounted", "tie", "linked"];

  beforeAll(async () => {
    mount = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "history-mount-")));
    const put = async (name: string, file: string, mtime: number) => {
      const dir = path.join(mount, ".claude", "projects", folder(name));
      await fsp.mkdir(dir, { recursive: true });
      const full = path.join(dir, file);
      await fsp.writeFile(full, idLine(name) + "\n");
      await fsp.utimes(full, mtime, mtime);
      return full;
    };
    expected.mounted = await put("mounted", "m.jsonl", 1000);
    // Equal times: the alphabetically first path wins everywhere.
    expected.tie = await put("tie", "a.jsonl", 2000);
    await put("tie", "b.jsonl", 2000);
    // A symlinked .jsonl is never a candidate, however new.
    expected.linked = await put("linked", "real.jsonl", 1000);
    const elsewhere = path.join(mount, "elsewhere.jsonl");
    await fsp.writeFile(elsewhere, idLine("linked") + "\n");
    await fsp.symlink(elsewhere, path.join(mount, ".claude", "projects", folder("linked"), "z-link.jsonl"));
    await fsp.utimes(elsewhere, 9000, 9000);
  });

  afterAll(async () => {
    await fsp.rm(mount, { recursive: true, force: true }).catch(() => {});
  });

  it("the shell lookup", async () => {
    const out = await run("bash", ["-c", buildAgentHistoryScript(names)], env());
    expect(Object.fromEntries(pickNewestOwned(names, parseAgentHistoryStdout(out)))).toEqual(expected);
  });

  for (const script of ["pv-context-pct-sweep.py", "fleet-status-sweep.py"]) {
    it(script, async () => {
      const driver =
        "import importlib.util, json, sys\n" +
        "spec = importlib.util.spec_from_file_location('m', sys.argv[1])\n" +
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n" +
        "print(json.dumps({n: m.discover_identity_jsonl_path(n, sys.argv[2]) for n in sys.argv[3:]}))\n";
      const out = await run("python3", ["-I", "-c", driver, path.join(REPO, "substrate/scripts", script), mount, ...names], env());
      expect(JSON.parse(out)).toEqual(expected);
    });
  }
});
