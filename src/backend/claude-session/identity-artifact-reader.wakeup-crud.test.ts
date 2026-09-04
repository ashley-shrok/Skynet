// ─── identity-artifact-reader — identity-scope wakeup create + delete (Phase 72 Plan 01) ─
//
// Phase 72 Plan 01 Task 1 tests for the parity-gap-closure writers:
//   - writeIdentityWakeupCreate — new
//   - writeIdentityWakeupDelete — new
//
// Byte-shape mirror of the role-wakeup tests, minus the two-step (identity
// scope reads/writes ~/.claude/identities/<key>/wakeups/ directly — no role
// resolution). LOCAL branch only (REMOTE branch shares the python3 tmp+rename
// primitive already covered by the existing writeIdentityWakeupUpdate tests).
//
// Coverage:
//   (a) writeIdentityWakeupCreate LOCAL — creates identities/<key>/wakeups/<slug>.json
//   (b) writeIdentityWakeupCreate LOCAL — throws on clobber
//   (c) writeIdentityWakeupCreate LOCAL — throws when name normalizes to empty slug
//   (d) writeIdentityWakeupDelete LOCAL — deletes file, idempotent on missing
//   (e) writeIdentityWakeupDelete LOCAL — invalid slug throws "invalid wakeup slug"

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
  writeIdentityWakeupCreate,
  writeIdentityWakeupDelete,
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

  it("(a) creates ~/.claude/identities/<key>/wakeups/<slug>.json with slug derived from name", async () => {
    const result = await writeIdentityWakeupCreate(null, KEY, {
      name: "Weekly Review",
      enabled: true,
      schedule: { type: "weekly", day: "mon", at: "10:00" },
      instruction: "Post weekly review",
    });

    // Slug: "weekly-review"
    const filePath = path.join(identitiesRoot, KEY, "wakeups", "weekly-review.json");
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
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "weekly-review.json"),
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
      path.join(wakeupsDir, "weekly-review.json"),
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
    const wakeupsDir = path.join(identitiesRoot, KEY, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    await fs.writeFile(
      path.join(wakeupsDir, "doomed.json"),
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

  it("(d) deletes file and is idempotent on missing file (second call succeeds)", async () => {
    const filePath = path.join(identitiesRoot, KEY, "wakeups", "doomed.json");
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
