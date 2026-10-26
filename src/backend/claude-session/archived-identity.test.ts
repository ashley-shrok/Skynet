import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildArchivedAppsScript,
  parseArchivedAppsStdout,
  probeIdentityFolderState,
  readArchivedAppsLocal,
  buildIdentityFolderStateScript,
} from "./archived-identity.js";
import { archivedIdentityRootShellWord } from "../database/routes/workspace-routes.js";
import { readIdentityFile, readIdentityWakeups } from "./identity-artifact-reader.js";

function bash(script: string, home: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("bash", ["-c", script], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home } }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  );
}

describe("archived-identity", () => {
  let home: string;
  const ICON = Buffer.from("RIFF0000WEBPVP8 fake");

  beforeAll(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), "archived-identity-"));
    await fsp.mkdir(path.join(home, "fleet/identities/livey"), { recursive: true });
    await fsp.mkdir(path.join(home, "fleet/identities-archive/both"), { recursive: true });
    await fsp.mkdir(path.join(home, "fleet/identities/both"), { recursive: true });
    const apps = path.join(home, "fleet/identities-archive/old/apps");
    await fsp.mkdir(path.join(apps, "tracker"), { recursive: true });
    await fsp.writeFile(path.join(apps, "tracker/app.json"), JSON.stringify({ title: "Tracker", description: "Counts things" }));
    await fsp.writeFile(path.join(apps, "tracker/icon.webp"), ICON);
    await fsp.mkdir(path.join(apps, "bare"), { recursive: true });
    await fsp.writeFile(path.join(apps, "bare/app.json"), "not json");
    await fsp.mkdir(path.join(apps, "no-manifest"), { recursive: true });
  });

  afterAll(async () => {
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
  });

  it("tells live, archived and gone apart; live wins when both exist", async () => {
    const exec = (c: string) => bash(c, home);
    expect(await probeIdentityFolderState(exec, "livey")).toBe("live");
    expect(await probeIdentityFolderState(exec, "old")).toBe("archived");
    expect(await probeIdentityFolderState(exec, "both")).toBe("live");
    expect(await probeIdentityFolderState(exec, "nobody")).toBe("gone");
  });

  it("never runs the probe for an unsafe name", async () => {
    let ran = false;
    expect(await probeIdentityFolderState(async () => { ran = true; return "live"; }, "a b;rm")).toBe("gone");
    expect(ran).toBe(false);
    expect(buildIdentityFolderStateScript("x")).toContain("identities-archive/x");
  });

  const expected = [
    { slug: "bare", title: "bare", description: null, iconDataUrl: null },
    { slug: "tracker", title: "Tracker", description: "Counts things", iconDataUrl: `data:image/webp;base64,${ICON.toString("base64")}` },
  ];

  it("lists an archived agent's apps over the shell", async () => {
    expect(parseArchivedAppsStdout(await bash(buildArchivedAppsScript("old"), home))).toEqual(expected);
    expect(parseArchivedAppsStdout(await bash(buildArchivedAppsScript("nobody"), home))).toEqual([]);
  });

  it("lists the same apps locally", async () => {
    expect(await readArchivedAppsLocal(path.join(home, "fleet/identities-archive"), "old")).toEqual(expected);
    expect(await readArchivedAppsLocal(path.join(home, "fleet/identities-archive"), "nobody")).toEqual([]);
  });

  it("the archived view's workspace root is decided by the host: live wins, else the archive", async () => {
    expect((await bash(`printf '%s' ${archivedIdentityRootShellWord("old")}`, home)).trim()).toBe(
      `${home}/fleet/identities-archive/old/workspace`,
    );
    expect((await bash(`printf '%s' ${archivedIdentityRootShellWord("both")}`, home)).trim()).toBe(
      `${home}/fleet/identities/both/workspace`,
    );
    expect(() => archivedIdentityRootShellWord("a b")).toThrow();
  });

  it("the archived view's apps come from the live folder once the agent is back", async () => {
    const liveApps = path.join(home, "fleet/identities/both/apps/fresh");
    await fsp.mkdir(liveApps, { recursive: true });
    await fsp.writeFile(path.join(liveApps, "app.json"), JSON.stringify({ title: "Fresh" }));
    await fsp.mkdir(path.join(home, "fleet/identities-archive/both/apps/stale"), { recursive: true });
    await fsp.writeFile(path.join(home, "fleet/identities-archive/both/apps/stale/app.json"), JSON.stringify({ title: "Stale" }));
    const viaShell = parseArchivedAppsStdout(await bash(buildArchivedAppsScript("both"), home));
    const local = await readArchivedAppsLocal(
      path.join(home, "fleet/identities-archive"),
      "both",
      path.join(home, "fleet/identities"),
    );
    expect(viaShell.map((a) => a.title)).toEqual(["Fresh"]);
    expect(local.map((a) => a.title)).toEqual(["Fresh"]);
  });

  it("the archived view's agent file and wake-ups: live wins, else the archive (local reads)", async () => {
    await fsp.writeFile(path.join(home, "fleet/identities-archive/old/old.md"), "archived file");
    await fsp.writeFile(path.join(home, "fleet/identities/both/both.md"), "live file");
    await fsp.writeFile(path.join(home, "fleet/identities-archive/both/both.md"), "stale file");
    const prev = process.env.IDENTITIES_HOST_DIR;
    process.env.IDENTITIES_HOST_DIR = path.join(home, "fleet/identities");
    try {
      expect((await readIdentityFile(null, "old", { archived: true })).markdown).toBe("archived file");
      expect((await readIdentityFile(null, "both", { archived: true })).markdown).toBe("live file");
      expect((await readIdentityFile(null, "old")).markdown).toBe("");
      expect((await readIdentityWakeups(null, "old", { archived: true })).wakeups).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.IDENTITIES_HOST_DIR;
      else process.env.IDENTITIES_HOST_DIR = prev;
    }
  });
});
