// ─── identity-artifact-reader — identity-scope wakeup create + delete (Phase 72 Plan 01) ─
//
// Phase 72 Plan 01 Task 1 tests for the parity-gap-closure writers:
//   - writeIdentityWakeupCreate — new
//   - writeIdentityWakeupDelete — new
//
// Byte-shape mirror of the role-wakeup tests, minus the two-step (identity
// scope reads/writes ~/fleet/identities/<key>/wakeups/ directly — no role
// resolution). LOCAL branch only (REMOTE branch shares the python3 tmp+rename
// primitive already covered by the existing writeIdentityWakeupUpdate tests).
//
// Coverage:
//   (a) writeIdentityWakeupCreate LOCAL — creates identities/<key>/wakeups/<slug>/wakeup.json
//   (b) writeIdentityWakeupCreate LOCAL — throws on clobber (folder with wakeup.json);
//       a spec-less leftover folder is reused (fired marker cleared)
//   (c) writeIdentityWakeupCreate LOCAL — throws when name normalizes to empty slug
//   (d) writeIdentityWakeupDelete LOCAL — deletes the whole folder, idempotent on missing
//   (e) writeIdentityWakeupDelete LOCAL — invalid slug throws "invalid wakeup slug"
//   (f) readIdentityWakeups LOCAL — folder layout only (flat files, dot-dirs, and
//       folders without wakeup.json are not wake-ups)
//   (g) writeIdentityWakeupUpdate LOCAL — patches <slug>/wakeup.json
//   (h) sensor schedule kind — refused on create, kept on update, humanized "Sensor"
//   (i) REMOTE branch — create + list commands run through a real bash

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import fs from "fs/promises";

// Mock tmux-helper.execCommand BEFORE importing the module under test (some
// path predicates inside identity-artifact-reader touch execCommand at module
// evaluation time; mock keeps the graph clean).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import {
  readIdentityWakeups,
  writeIdentityWakeupCreate,
  writeIdentityWakeupDelete,
  writeIdentityWakeupUpdate,
} from "./identity-artifact-reader.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// writeIdentityWakeupCreate — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityWakeupCreate — LOCAL branch (conn=null)", () => {
  let identitiesRoot: string;
  const KEY = "moxie";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-crud-cre-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    // Pre-create the identity folder so mkdir -p can build wakeups/ underneath.
    await fs.mkdir(path.join(identitiesRoot, KEY), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
  });

  it("(a) creates ~/fleet/identities/<key>/wakeups/<slug>/wakeup.json with slug derived from name", async () => {
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "Weekly Review",
      enabled: true,
      schedule: { type: "weekly", day: "mon", at: "10:00" },
      instruction: "Post weekly review",
    });

    // Slug: "weekly-review"
    const filePath = path.join(identitiesRoot, KEY, "wakeups", "weekly-review", "wakeup.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("Weekly Review");
    expect(parsed.enabled).toBe(true);
    expect(parsed.schedule).toEqual({ type: "weekly", day: "mon", at: "10:00" });
    expect(parsed.instruction).toBe("Post weekly review");

    // Returns fresh {wakeups}
    expect(result.wakeups).toHaveLength(1);
    expect(result.wakeups[0].slug).toBe("weekly-review");
    expect(result.wakeups[0].name).toBe("Weekly Review");
  });

  it("(b) throws when a wakeup with the same normalized name already exists", async () => {
    const wakeupsDir = path.join(identitiesRoot, KEY, "wakeups");
    await fs.mkdir(path.join(wakeupsDir, "weekly-review"), { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "weekly-review", "wakeup.json"),
      JSON.stringify(
        { name: "weekly-review", enabled: true, schedule: { type: "weekly", day: "mon" }, instruction: "existing" },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "Weekly Review",
        enabled: true,
        schedule: { type: "weekly", day: "mon", at: "10:00" },
        instruction: "new",
      }),
    ).rejects.toThrow(/already exists/);

    // Existing file NOT clobbered
    const raw = await fs.readFile(
      path.join(wakeupsDir, "weekly-review", "wakeup.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.instruction).toBe("existing");
  });

  it("(c) throws when name normalizes to empty slug (e.g. name = '!!!')", async () => {
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "!!!",
        enabled: true,
        schedule: { type: "daily", at: "09:00" },
        instruction: "junk",
      }),
    ).rejects.toThrow(/normalizes to empty|invalid slug/);
  });

  it("throws when schedule missing type", async () => {
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "bad-schedule",
        enabled: true,
        // No type field
        schedule: { every: "1h" } as unknown as Record<string, unknown>,
        instruction: "test",
      }),
    ).rejects.toThrow(/schedule\.type/);
  });

  it("refuses a schedule the scheduler would refuse to fire, and writes nothing", async () => {
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "every-other-week",
        enabled: true,
        schedule: { type: "weekly", day: "fri", at: "09:00", every: 2 }, // every > 1 needs start
        instruction: "test",
      }),
    ).rejects.toThrow(/needs a `start`/);
    await expect(fs.access(path.join(identitiesRoot, KEY, "wakeups", "every-other-week"))).rejects.toThrow();
  });

  it("accepts the new kinds", async () => {
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "last-friday",
      enabled: true,
      schedule: { type: "monthly", nth: "last", weekday: "fri", at: ["09:00", "16:00"], until: "2028-01-01" },
      instruction: "test",
    });
    expect(result.wakeups.some((w) => w.slug === "last-friday")).toBe(true);
  });

  it("(h) refuses to create a sensor wake-up (agents create those on disk), and writes nothing", async () => {
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "inbox-watch",
        enabled: true,
        schedule: { type: "sensor" },
        instruction: "Triage what the sensor found",
      }),
    ).rejects.toThrow(/sensor/);
    await expect(fs.access(path.join(identitiesRoot, KEY, "wakeups", "inbox-watch"))).rejects.toThrow();
  });

  it("reuses an existing folder without wakeup.json, clearing only its fired marker", async () => {
    // A fired one-shot's leftover: folder kept, spec gone, fired marker + other state remain.
    const dir = path.join(identitiesRoot, KEY, "wakeups", "weekly-review");
    await fs.mkdir(path.join(dir, ".state"), { recursive: true });
    await fs.writeFile(path.join(dir, ".state", "weekly-review.fired"), "", "utf-8");
    await fs.writeFile(path.join(dir, ".state", "weekly-review.last"), "123", "utf-8");
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "Weekly Review",
      enabled: true,
      schedule: { type: "daily", at: "09:00" },
      instruction: "new",
    });
    expect(JSON.parse(await fs.readFile(path.join(dir, "wakeup.json"), "utf-8")).instruction).toBe("new");
    await expect(fs.access(path.join(dir, ".state", "weekly-review.fired"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, ".state", "weekly-review.last"), "utf-8")).toBe("123");
    expect((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(result.wakeups.map((w) => w.slug)).toEqual(["weekly-review"]);
  });

  it("reuses a bare existing folder (no .state) too", async () => {
    await fs.mkdir(path.join(identitiesRoot, KEY, "wakeups", "weekly-review"), { recursive: true });
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "Weekly Review",
      enabled: true,
      schedule: { type: "daily", at: "09:00" },
      instruction: "new",
    });
    expect(result.wakeups.map((w) => w.slug)).toEqual(["weekly-review"]);
  });

  it("a non-folder squatting on the slug is a collision", async () => {
    await fs.mkdir(path.join(identitiesRoot, KEY, "wakeups"), { recursive: true });
    await fs.writeFile(path.join(identitiesRoot, KEY, "wakeups", "weekly-review"), "x", "utf-8");
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "Weekly Review",
        enabled: true,
        schedule: { type: "daily", at: "09:00" },
        instruction: "new",
      }),
    ).rejects.toThrow(/already exists/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// (i) REMOTE branch — the SSH commands run through a real bash with HOME
// pointed at a temp dir, so the shell logic itself is exercised.
// ──────────────────────────────────────────────────────────────────────

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("writeIdentityWakeupCreate / readIdentityWakeups — REMOTE branch (real bash)", () => {
  let home: string;
  const KEY = "moxie";
  const conn = {} as unknown as Parameters<typeof writeIdentityWakeupCreate>[0];
  const dir = () => path.join(home, "fleet", "identities", KEY, "wakeups", "weekly-review");
  const daily = { name: "Weekly Review", enabled: true, schedule: { type: "daily", at: "09:00" }, instruction: "new" };

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-remote-"));
    await fs.mkdir(path.join(home, "fleet", "identities", KEY), { recursive: true });
    (execCommand as Mock).mockImplementation(
      (_c: unknown, cmd: string) =>
        new Promise<string>((resolve, reject) => {
          execFile("bash", ["-c", cmd], { cwd: home, env: { ...process.env, HOME: home } }, (err, stdout) =>
            err ? reject(err) : resolve(stdout),
          );
        }),
    );
  });

  afterEach(async () => {
    await fs.chmod(dir(), 0o755).catch(() => {});
    await fs.rm(home, { recursive: true, force: true });
  });

  it("creates a fresh folder + wakeup.json", async () => {
    const result = await writeIdentityWakeupCreate(conn, KEY, daily);
    expect(JSON.parse(await fs.readFile(path.join(dir(), "wakeup.json"), "utf-8")).instruction).toBe("new");
    expect(result.wakeups.map((w) => w.slug)).toEqual(["weekly-review"]);
  });

  it("a folder that has wakeup.json is a collision; nothing is clobbered", async () => {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(path.join(dir(), "wakeup.json"), JSON.stringify({ ...daily, instruction: "existing" }));
    await expect(writeIdentityWakeupCreate(conn, KEY, daily)).rejects.toThrow(/already exists/);
    expect(JSON.parse(await fs.readFile(path.join(dir(), "wakeup.json"), "utf-8")).instruction).toBe("existing");
  });

  it("reuses a spec-less leftover folder, clearing only its fired marker", async () => {
    await fs.mkdir(path.join(dir(), ".state"), { recursive: true });
    await fs.writeFile(path.join(dir(), ".state", "weekly-review.fired"), "");
    await fs.writeFile(path.join(dir(), ".state", "weekly-review.last"), "123");
    const result = await writeIdentityWakeupCreate(conn, KEY, daily);
    expect(JSON.parse(await fs.readFile(path.join(dir(), "wakeup.json"), "utf-8")).instruction).toBe("new");
    await expect(fs.access(path.join(dir(), ".state", "weekly-review.fired"))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir(), ".state", "weekly-review.last"), "utf-8")).toBe("123");
    expect(result.wakeups.map((w) => w.slug)).toEqual(["weekly-review"]);
  });

  it.skipIf(isRoot)("a failed write keeps a reused folder (it wasn't ours to remove)", async () => {
    await fs.mkdir(dir(), { recursive: true });
    await fs.chmod(dir(), 0o555); // python can't write wakeup.json.tmp
    await expect(writeIdentityWakeupCreate(conn, KEY, daily)).rejects.toThrow();
    await expect(fs.access(dir())).resolves.toBeUndefined();
  });

  it("refuses a sensor schedule before touching the host", async () => {
    await expect(writeIdentityWakeupCreate(conn, KEY, { ...daily, schedule: { type: "sensor" } })).rejects.toThrow(
      /sensor/,
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("list: a missing wakeups/ dir is empty (the loop never runs in $HOME)", async () => {
    // A decoy that would be listed if the loop ran from $HOME.
    await fs.mkdir(path.join(home, "decoy"), { recursive: true });
    await fs.writeFile(path.join(home, "decoy", "wakeup.json"), JSON.stringify(daily));
    const cmd = await readIdentityWakeups(conn, KEY).then((r) => {
      expect(r.wakeups).toEqual([]);
      return (execCommand as Mock).mock.calls[0][1] as string;
    });
    expect(cmd).toContain('2>/dev/null && { shopt -s nullglob; for d in */;');
    expect(cmd.trimEnd().endsWith("done; }")).toBe(true);
  });

  it("list: an empty wakeups/ dir is empty", async () => {
    await fs.mkdir(path.join(home, "fleet", "identities", KEY, "wakeups"), { recursive: true });
    expect((await readIdentityWakeups(conn, KEY)).wakeups).toEqual([]);
  });
});

describe("writeIdentityWakeupCreate — LOCAL failed write", () => {
  let identitiesRoot: string;
  const KEY = "moxie";
  const dir = () => path.join(identitiesRoot, KEY, "wakeups", "weekly-review");

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-local-fail-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.chmod(dir(), 0o755).catch(() => {});
    await fs.rm(identitiesRoot, { recursive: true, force: true });
  });

  it.skipIf(isRoot)("keeps a reused folder when the write fails", async () => {
    await fs.mkdir(dir(), { recursive: true });
    await fs.chmod(dir(), 0o555);
    await expect(
      writeIdentityWakeupCreate(null, KEY, {
        name: "Weekly Review",
        enabled: true,
        schedule: { type: "daily", at: "09:00" },
        instruction: "new",
      }),
    ).rejects.toThrow();
    await expect(fs.access(dir())).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
// readIdentityWakeups + writeIdentityWakeupUpdate — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("readIdentityWakeups / writeIdentityWakeupUpdate — LOCAL folder layout", () => {
  let identitiesRoot: string;
  const KEY = "moxie";
  const spec = (name: string, schedule: Record<string, unknown> = { type: "daily", at: "09:00" }) =>
    JSON.stringify({ name, enabled: true, schedule, instruction: "do it" }, null, 2) + "\n";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wakeup-folders-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;
    const wakeupsDir = path.join(identitiesRoot, KEY, "wakeups");
    await fs.mkdir(path.join(wakeupsDir, "morning"), { recursive: true });
    await fs.writeFile(path.join(wakeupsDir, "morning", "wakeup.json"), spec("morning"), "utf-8");
    await fs.mkdir(path.join(wakeupsDir, "watcher", "sensor"), { recursive: true });
    await fs.writeFile(path.join(wakeupsDir, "watcher", "wakeup.json"), spec("watcher", { type: "sensor" }), "utf-8");
    // Not wake-ups: an old-layout flat file, the scheduler's .state dir, a
    // folder with no wakeup.json.
    await fs.writeFile(path.join(wakeupsDir, "legacy.json"), spec("legacy"), "utf-8");
    await fs.mkdir(path.join(wakeupsDir, ".state"), { recursive: true });
    await fs.writeFile(path.join(wakeupsDir, ".state", "wakeup.json"), spec("state"), "utf-8");
    await fs.mkdir(path.join(wakeupsDir, "half-made"), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
  });

  it("(f) lists only <slug>/wakeup.json folders, slug = folder name", async () => {
    const { wakeups } = await readIdentityWakeups(null, KEY);
    expect(wakeups.map((w) => w.slug)).toEqual(["morning", "watcher"]);
    expect(wakeups.find((w) => w.slug === "watcher")?.scheduleHuman).toBe("Sensor");
  });

  it("(g) patches <slug>/wakeup.json in place", async () => {
    await writeIdentityWakeupUpdate(null, KEY, "morning", { enabled: false, instruction: "later" });
    const parsed = JSON.parse(
      await fs.readFile(path.join(identitiesRoot, KEY, "wakeups", "morning", "wakeup.json"), "utf-8"),
    );
    expect(parsed).toMatchObject({ name: "morning", enabled: false, instruction: "later" });
  });

  it("(h) keeps a sensor schedule on update", async () => {
    await writeIdentityWakeupUpdate(null, KEY, "watcher", { name: "watcher", schedule: { type: "sensor" } });
    const parsed = JSON.parse(
      await fs.readFile(path.join(identitiesRoot, KEY, "wakeups", "watcher", "wakeup.json"), "utf-8"),
    );
    expect(parsed.schedule).toEqual({ type: "sensor" });
  });

  it("(h2) keeps a one-time sensor's mark on update", async () => {
    const dir = path.join(identitiesRoot, KEY, "wakeups", "watcher");
    await fs.writeFile(path.join(dir, "wakeup.json"), spec("watcher", { type: "sensor", once: true }), "utf-8");
    await writeIdentityWakeupUpdate(null, KEY, "watcher", { name: "renamed", schedule: { type: "sensor", once: true } });
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "wakeup.json"), "utf-8"));
    expect(parsed).toMatchObject({ name: "renamed", schedule: { type: "sensor", once: true } });
  });

  it("(h3) never brings back a wake-up that went away while the edit was in flight", async () => {
    const dir = path.join(identitiesRoot, KEY, "wakeups", "watcher");
    const realWriteFile = fs.writeFile.bind(fs);
    // The spec disappears (e.g. a one-time sensor retiring) after it was read.
    const spy = vi.spyOn(fs, "writeFile").mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.rm(path.join(dir, "wakeup.json"), { force: true });
      return realWriteFile(...args);
    });
    try {
      await expect(writeIdentityWakeupUpdate(null, KEY, "watcher", { enabled: false })).rejects.toThrow(
        /no longer exists/,
      );
    } finally {
      spy.mockRestore();
    }
    await expect(fs.access(path.join(dir, "wakeup.json"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "wakeup.json.tmp"))).rejects.toThrow();
  });

  it("updating an old-layout flat file fails (no backward compatibility)", async () => {
    await expect(writeIdentityWakeupUpdate(null, KEY, "legacy", { enabled: false })).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// writeIdentityWakeupDelete — LOCAL branch
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityWakeupDelete — LOCAL branch (conn=null)", () => {
  let identitiesRoot: string;
  const KEY = "moxie";

  beforeEach(async () => {
    identitiesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "72-01-crud-del-"));
    process.env.IDENTITIES_HOST_DIR = identitiesRoot;

    // Seed a wakeup we can delete
    // Seeded with scheduler state + a sensor to prove the whole folder goes.
    const wakeupDir = path.join(identitiesRoot, KEY, "wakeups", "doomed");
    await fs.mkdir(path.join(wakeupDir, ".state"), { recursive: true });
    await fs.mkdir(path.join(wakeupDir, "sensor"), { recursive: true });
    await fs.writeFile(path.join(wakeupDir, ".state", "doomed.last"), "1", "utf-8");
    await fs.writeFile(
      path.join(wakeupDir, "wakeup.json"),
      JSON.stringify(
        { name: "doomed", enabled: true, schedule: { type: "daily", at: "09:00" }, instruction: "" },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    delete process.env.IDENTITIES_HOST_DIR;
    await fs.rm(identitiesRoot, { recursive: true, force: true });
  });

  it("(d) deletes the whole folder and is idempotent on missing (second call succeeds)", async () => {
    const filePath = path.join(identitiesRoot, KEY, "wakeups", "doomed");
    // Pre-delete: exists
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    const result = await writeIdentityWakeupDelete(null, KEY, "doomed");

    // Post-delete: gone
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.wakeups).toEqual([]);

    // Idempotent second call
    await expect(writeIdentityWakeupDelete(null, KEY, "doomed")).resolves.toBeDefined();
  });

  it("(e) invalid slug throws 'invalid wakeup slug' before any I/O", async () => {
    await expect(writeIdentityWakeupDelete(null, KEY, "not/a/valid slug")).rejects.toThrow(
      /invalid wakeup slug/,
    );
  });

  it("invalid identityKey throws 'invalid identityKey'", async () => {
    await expect(writeIdentityWakeupDelete(null, "BAD KEY!!", "doomed")).rejects.toThrow(
      /invalid identityKey/,
    );
  });
});
