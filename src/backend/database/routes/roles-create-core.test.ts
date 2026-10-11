/**
 * createRoleOnHost — LOCAL branch (conn === null) against a real temp dir.
 * The REMOTE branch is covered through POST /roles in roles-create.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

vi.mock("../../utils/logger.js", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() };
  return { systemLogger: mockLogger, sshLogger: mockLogger, databaseLogger: mockLogger, logger: mockLogger };
});

import { createRoleOnHost, ROLE_STUB_SEED_COMMENT } from "./roles-create-core.js";

const LOG = { hostId: 6, source: "role-request" as const };

let fleetDir: string;
let rolesDir: string;
const origRolesEnv = process.env.ROLES_HOST_DIR;

beforeEach(async () => {
  fleetDir = await fs.mkdtemp(path.join(os.tmpdir(), "roles-core-"));
  rolesDir = path.join(fleetDir, "roles");
  process.env.ROLES_HOST_DIR = rolesDir;
});

afterEach(async () => {
  if (origRolesEnv === undefined) delete process.env.ROLES_HOST_DIR;
  else process.env.ROLES_HOST_DIR = origRolesEnv;
  await fs.rm(fleetDir, { recursive: true, force: true });
});

function frontmatterOf(md: string): Record<string, unknown> {
  const m = md.match(/^---\n([\s\S]*?)---\n/);
  return m ? (yaml.load(m[1]) as Record<string, unknown>) : {};
}

describe("createRoleOnHost (local)", () => {
  it("writes the role file with frontmatter and the avatar sibling", async () => {
    const result = await createRoleOnHost(
      null,
      {
        baseSlug: "garden-keeper",
        displayName: "Garden Keeper",
        description: "Tends the garden.",
        colorHue: 0,
        voice: "Danielle",
        avatar: { ext: "webp", bytes: Buffer.from("img") },
      },
      LOG,
    );
    expect(result).toMatchObject({ ok: true, name: "garden-keeper" });

    const md = await fs.readFile(path.join(rolesDir, "garden-keeper", "garden-keeper.md"), "utf-8");
    expect(frontmatterOf(md)).toEqual({
      displayName: "Garden Keeper",
      colorHue: "0",
      voice: "Danielle",
      avatar: "garden-keeper.webp",
    });
    expect(md).toContain("# garden-keeper\n\n## Role\n\nTends the garden.\n\n");
    expect(md.trimEnd().endsWith(ROLE_STUB_SEED_COMMENT)).toBe(true);
    const avatar = await fs.readFile(path.join(rolesDir, "garden-keeper", "garden-keeper.webp"));
    expect(avatar.toString()).toBe("img");
    // No leftover tmp file from the atomic write.
    expect(await fs.readdir(path.join(rolesDir, "garden-keeper"))).toEqual(
      ["garden-keeper.md", "garden-keeper.webp"],
    );
  });

  it("auto-suffixes past a live role and an archived one", async () => {
    await fs.mkdir(path.join(rolesDir, "garden-keeper"), { recursive: true });
    await fs.mkdir(path.join(fleetDir, "roles-archive", "garden-keeper-2"), { recursive: true });

    const result = await createRoleOnHost(
      null,
      { baseSlug: "garden-keeper", displayName: "Garden Keeper", description: "d" },
      LOG,
    );
    expect(result).toMatchObject({ ok: true, name: "garden-keeper-3" });
    await expect(
      fs.access(path.join(rolesDir, "garden-keeper-3", "garden-keeper-3.md")),
    ).resolves.toBeUndefined();
  });

  it("writes users: when given", async () => {
    await createRoleOnHost(
      null,
      { baseSlug: "x-role", displayName: "X Role", description: "d", users: ["Ashley"] },
      LOG,
    );
    const md = await fs.readFile(path.join(rolesDir, "x-role", "x-role.md"), "utf-8");
    expect(frontmatterOf(md).users).toEqual(["Ashley"]);
  });

  it("removes the folder when the avatar write fails", async () => {
    const realWriteFile = fs.writeFile;
    const spy = vi.spyOn(fs, "writeFile").mockImplementation(async (p, data, opts) => {
      if (String(p).endsWith(".webp")) throw new Error("disk full");
      return realWriteFile(p, data, opts as Parameters<typeof fs.writeFile>[2]);
    });
    try {
      const result = await createRoleOnHost(
        null,
        {
          baseSlug: "garden-keeper",
          displayName: "Garden Keeper",
          description: "d",
          avatar: { ext: "webp", bytes: Buffer.from("img") },
        },
        LOG,
      );
      expect(result).toEqual({ ok: false, error: "avatar_write_failed" });
      expect(await fs.readdir(rolesDir)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
