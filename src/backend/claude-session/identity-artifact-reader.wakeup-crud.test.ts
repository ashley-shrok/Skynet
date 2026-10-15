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
//   (b) writeIdentityWakeupCreate LOCAL — throws on clobber (existing folder)
//   (c) writeIdentityWakeupCreate LOCAL — throws when name normalizes to empty slug
//   (d) writeIdentityWakeupDelete LOCAL — deletes the whole folder, idempotent on missing
//   (e) writeIdentityWakeupDelete LOCAL — invalid slug throws "invalid wakeup slug"
//   (f) readIdentityWakeups LOCAL — folder layout only (flat files, dot-dirs, and
//       folders without wakeup.json are not wake-ups)
//   (g) writeIdentityWakeupUpdate LOCAL — patches <slug>/wakeup.json
//   (h) sensor schedule kind — accepted on create/update, humanized "Sensor"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs/promises";

// Mock tmux-helper.execCommand BEFORE importing the module under test (some
// path predicates inside identity-artifact-reader touch execCommand at module
// evaluation time; mock keeps the graph clean).
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

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

  it("(h) accepts a sensor schedule and humanizes it as Sensor", async () => {
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "inbox-watch",
      enabled: true,
      schedule: { type: "sensor" },
      instruction: "Triage what the sensor found",
    });
    const row = result.wakeups.find((w) => w.slug === "inbox-watch");
    expect(row?.schedule).toEqual({ type: "sensor" });
    expect(row?.scheduleHuman).toBe("Sensor");
  });

  it("an existing folder without wakeup.json still counts as a collision", async () => {
    await fs.mkdir(path.join(identitiesRoot, KEY, "wakeups", "weekly-review"), { recursive: true });
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
