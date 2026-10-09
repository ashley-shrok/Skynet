/**
 * Engine tests run the real shell host-ops against temp folders: each fake
 * machine is a bash child whose $HOME is its own temp dir.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { promises as fs, existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { InstanceWideEngine, PromoteError, type SyncMachine } from "./engine.js";
import { InstanceWideStore } from "./store.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

function bashChannel(home: string): SshChannel {
  return {
    exec(command: string, stdin?: Buffer): Promise<string | null> {
      return new Promise((resolve) => {
        const child = spawn("bash", ["-c", command], {
          env: { ...process.env, HOME: home },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString("utf-8")));
        child.on("error", () => resolve(null));
        child.stdin.on("error", () => {});
        child.on("close", (code) => resolve(code !== 0 && out === "" ? null : out.trim()));
        child.stdin.end(stdin ?? Buffer.alloc(0));
      });
    },
  };
}

let tmp: string;
let homes: Record<string, string>;
let offline: Set<string>;
let machines: SyncMachine[];
let engine: InstanceWideEngine;

function skillDir(m: string, name = "demo"): string {
  return path.join(homes[m], ".claude/skills", name);
}
async function put(m: string, rel: string, content: string, name = "demo"): Promise<void> {
  const p = path.join(skillDir(m, name), rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}
function read(m: string, rel: string, name = "demo"): string | null {
  const p = path.join(skillDir(m, name), rel);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "iw-engine-"));
  homes = {};
  for (const m of ["a", "b", "c"]) {
    homes[m] = path.join(tmp, m);
    await fs.mkdir(homes[m], { recursive: true });
  }
  offline = new Set();
  machines = [
    { machineId: "1", hostName: "alpha", adminOwned: true, hostRowIds: ["1"] },
    { machineId: "2", hostName: "beta", adminOwned: true, hostRowIds: ["2"] },
    { machineId: "3", hostName: "gamma", adminOwned: false, hostRowIds: ["3"] },
  ];
  const homeOf: Record<string, string> = { "1": "a", "2": "b", "3": "c" };
  engine = new InstanceWideEngine({
    store: new InstanceWideStore(path.join(tmp, "store")),
    listMachines: async () => machines,
    acquireChannel: async (m) => (offline.has(m.machineId) ? null : bashChannel(homes[homeOf[m.machineId]])),
    immediateDelayMs: 60_000,
  });
  await put("a", "SKILL.md", "---\nname: demo\n---\nv1\n");
  await put("a", "scripts/run.sh", "echo hi\n");
});

afterEach(async () => {
  engine.stop();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("InstanceWideEngine", () => {
  it("promotes a folder and distributes it to every machine", async () => {
    const res = await engine.promote("skill", "demo", machines[0]);
    expect(res.files).toBe(2);
    await engine.syncNow();
    for (const m of ["b", "c"]) {
      expect(read(m, "SKILL.md")).toContain("v1");
      expect(read(m, "scripts/run.sh")).toBe("echo hi\n");
    }
    const [status] = await engine.status();
    expect(status.behind).toBe(0);
    expect(status.hosts.every((h) => h.state === "current")).toBe(true);
  });

  it("an admin machine's native edit flows to the master and everyone else", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("b", "SKILL.md", "edited on beta\n");
    await put("b", "notes.md", "new file\n");
    await fs.rm(path.join(skillDir("b"), "scripts/run.sh"));
    await engine.syncNow();
    for (const m of ["a", "c"]) {
      expect(read(m, "SKILL.md")).toBe("edited on beta\n");
      expect(read(m, "notes.md")).toBe("new file\n");
      expect(read(m, "scripts/run.sh")).toBeNull();
    }
  });

  it("a non-admin machine's edit is put back", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("c", "SKILL.md", "tampered\n");
    await put("c", "extra.md", "x\n");
    await engine.syncNow();
    expect(read("c", "SKILL.md")).toContain("v1");
    expect(read("c", "extra.md")).toBeNull();
    expect(read("a", "extra.md")).toBeNull();
  });

  it("conflicting admin edits: first arrival wins, the other is set aside", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("a", "SKILL.md", "alpha version\n");
    await put("b", "SKILL.md", "beta version\n");
    await engine.syncNow();
    expect(read("a", "SKILL.md")).toBe("alpha version\n");
    expect(read("b", "SKILL.md")).toBe("alpha version\n");
    expect(read("c", "SKILL.md")).toBe("alpha version\n");
    const aside = (await fs.readdir(skillDir("b"))).find((f) => f.startsWith("SKILL.md.conflict-beta-"));
    expect(aside).toBeDefined();
    expect(read("b", aside!)).toBe("beta version\n");
    // Conflict copies never travel.
    expect(await fs.readdir(skillDir("c"))).not.toContain(aside);
    const [status] = await engine.status();
    expect(status.conflicts).toBe(1);
    expect(status.hosts.find((h) => h.hostName === "beta")?.state).toBe("conflict");
    // Deleting the conflict copy clears the conflict.
    await fs.rm(path.join(skillDir("b"), aside!));
    await engine.syncNow();
    expect((await engine.status())[0].conflicts).toBe(0);
  });

  it("a missing folder is restored, never treated as a removal", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await fs.rm(skillDir("a"), { recursive: true });
    await engine.syncNow();
    expect(read("a", "SKILL.md")).toContain("v1");
    expect(read("b", "SKILL.md")).toContain("v1");
  });

  it("editor-backup and cache files do not travel", async () => {
    await put("a", "SKILL.md~", "backup\n");
    await put("a", "__pycache__/x.pyc", "bin\n");
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    expect(read("b", "SKILL.md~")).toBeNull();
    expect(read("b", "__pycache__/x.pyc")).toBeNull();
  });

  it("removal deletes the folder everywhere; an offline machine catches up later", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    offline.add("3");
    const { hostCount } = await engine.removeItem("skill", "demo");
    expect(hostCount).toBe(3);
    await engine.syncNow();
    expect(existsSync(skillDir("a"))).toBe(false);
    expect(existsSync(skillDir("b"))).toBe(false);
    expect(existsSync(skillDir("c"))).toBe(true);
    offline.delete("3");
    await engine.syncNow();
    expect(existsSync(skillDir("c"))).toBe(false);
  });

  it("an app edit to the master reaches every machine", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await engine.editMaster("skill", "demo", (s) =>
      s.writeFile("skill", "demo", "SKILL.md", Buffer.from("from the app\n")),
    );
    await engine.syncNow();
    for (const m of ["a", "b", "c"]) expect(read(m, "SKILL.md")).toBe("from the app\n");
  });

  it("an admin-sourced app edit on a non-admin machine flows back", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("c", "SKILL.md", "admin edited via gamma\n");
    engine.requestSync({ adminSourcedMachineId: "3" });
    await engine.syncNow();
    expect(read("a", "SKILL.md")).toBe("admin edited via gamma\n");
  });

  it("finds same-name folders on other machines before promotion", async () => {
    await put("b", "SKILL.md", "beta's own demo\n");
    offline.add("3");
    const res = await engine.findClashes("skill", "demo", "1");
    expect(res.clashes).toEqual(["beta"]);
    expect(res.unreachable).toEqual(["gamma"]);
    // After promotion the clashing copy is replaced (first contact → master wins).
    offline.delete("3");
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    expect(read("b", "SKILL.md")).toContain("v1");
  });

  it("refuses to promote an oversized folder", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024, 1);
    await fs.writeFile(path.join(skillDir("a"), "big.bin"), big);
    await expect(engine.promote("skill", "demo", machines[0])).rejects.toBeInstanceOf(PromoteError);
    expect(await engine.isInstanceWide("skill", "demo")).toBe(false);
  });

  it("offline machines are not counted as behind", async () => {
    offline.add("3");
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    const [status] = await engine.status();
    expect(status.hosts.find((h) => h.hostName === "gamma")?.state).toBe("offline");
    expect(status.behind).toBe(0);
  });

  it("quick admin check carries an admin machine's edit to everyone", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("b", "SKILL.md", "quick edit\n");
    await engine.quickAdminCheck();
    // The master changed, so a full pass is requested; run it now.
    await engine.syncNow();
    expect(read("c", "SKILL.md")).toBe("quick edit\n");
  });

  it("quick admin check never touches non-admin machines", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await put("c", "SKILL.md", "tampered\n");
    await engine.quickAdminCheck();
    expect(read("c", "SKILL.md")).toBe("tampered\n");
  });

  it("keeps permission bits: private files stay private, scripts stay executable", async () => {
    await fs.chmod(path.join(skillDir("a"), "scripts/run.sh"), 0o755);
    await put("a", "creds.json", "{}\n");
    await fs.chmod(path.join(skillDir("a"), "creds.json"), 0o600);
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    const mode = async (m: string, rel: string) =>
      ((await fs.stat(path.join(skillDir(m), rel))).mode & 0o777).toString(8);
    expect(await mode("b", "creds.json")).toBe("600");
    expect(await mode("b", "scripts/run.sh")).toBe("755");
  });

  it("never follows a symlinked item folder out of the home folder", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    // Replace beta's copy with a link to a folder outside its home.
    const outside = path.join(tmp, "outside");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.key"), "TOP SECRET\n");
    await fs.rm(skillDir("b"), { recursive: true });
    await fs.symlink(outside, skillDir("b"));
    await engine.syncNow();
    // Nothing from outside reached the master or anyone else; the outside
    // folder was not written to.
    expect(read("a", "secret.key")).toBeNull();
    expect(read("c", "secret.key")).toBeNull();
    expect(await fs.readdir(outside)).toEqual(["secret.key"]);
    const [status] = await engine.status();
    expect(status.hosts.find((h) => h.hostName === "beta")?.state).toBe("behind");
  });

  it("never follows a symlinked file inside an item", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    const outside = path.join(tmp, "outside.txt");
    await fs.writeFile(outside, "TOP SECRET\n");
    await fs.symlink(outside, path.join(skillDir("b"), "link.txt"));
    await engine.syncNow();
    expect(read("a", "link.txt")).toBeNull();
    // Overwriting a file that has been swapped for a link replaces the link,
    // never the file it points to.
    await fs.rm(path.join(skillDir("c"), "SKILL.md"));
    await fs.symlink(outside, path.join(skillDir("c"), "SKILL.md"));
    await engine.syncNow();
    expect(readFileSync(outside, "utf-8")).toBe("TOP SECRET\n");
    expect(read("c", "SKILL.md")).toContain("v1");
  });

  it("an emptied folder on an admin host is restored, not spread as deletes", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    await fs.rm(path.join(skillDir("b"), "SKILL.md"));
    await fs.rm(path.join(skillDir("b"), "scripts"), { recursive: true });
    await engine.syncNow();
    expect(read("a", "SKILL.md")).toContain("v1");
    expect(read("b", "SKILL.md")).toContain("v1");
  });

  it("git repos and dependency folders never travel", async () => {
    await put("a", ".git/HEAD", "ref: refs/heads/main\n");
    await put("a", "node_modules/x/index.js", "x\n");
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    expect(read("b", ".git/HEAD")).toBeNull();
    expect(read("b", "node_modules/x/index.js")).toBeNull();
  });

  it("refuses names the app's built-in files use", async () => {
    const reserved = new InstanceWideEngine({
      store: new InstanceWideStore(path.join(tmp, "store2")),
      listMachines: async () => machines,
      acquireChannel: async () => bashChannel(homes.a),
      isReservedName: (kind, name) => kind === "skill" && name === "demo",
      immediateDelayMs: 60_000,
    });
    await expect(reserved.promote("skill", "demo", machines[0])).rejects.toMatchObject({ code: "reserved" });
    reserved.stop();
  });

  it("remove counts only machines still in the fleet", async () => {
    await engine.promote("skill", "demo", machines[0]);
    await engine.syncNow();
    machines = machines.slice(0, 2);
    expect(await engine.hostCount("skill", "demo")).toBe(2);
  });

  it("syncs roles into ~/fleet/roles and binary files intact", async () => {
    const roleDir = path.join(homes.a, "fleet/roles/helper");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "helper.md"), "# helper\n");
    const bin = Buffer.from([0, 1, 2, 255, 10, 13, 0]);
    await fs.writeFile(path.join(roleDir, "avatar.webp"), bin);
    await engine.promote("role", "helper", machines[0]);
    await engine.syncNow();
    expect(readFileSync(path.join(homes.c, "fleet/roles/helper/helper.md"), "utf-8")).toBe("# helper\n");
    expect(readFileSync(path.join(homes.c, "fleet/roles/helper/avatar.webp")).equals(bin)).toBe(true);
  });
});
