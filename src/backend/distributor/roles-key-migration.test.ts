/**
 * roles-key-migration.test.ts — one case table, run against BOTH
 * implementations of the identity `role:` → `roles:` key migration:
 *   - "python": ROLES_KEY_MIGRATION_CMD (the exact command the SSH bootstrap
 *     sends) executed under a real `sh` with HOME pointed at a temp dir.
 *   - "ts": migrateRolesKeyUnder(tmpHome) (the local-host bootstrap port).
 * Every test runs against a temp HOME only — never the real ~/fleet.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { execFileSync } from "child_process";
import {
  ROLES_KEY_MIGRATION_CMD,
  parseRolesKeyMigrationOutput,
  migrateRolesKeyUnder,
  migrateRolesKeyBytes,
  type RolesKeyMigrationCounts,
} from "./roles-key-migration.js";

type Impl = "python" | "ts";

async function runImpl(impl: Impl, home: string): Promise<RolesKeyMigrationCounts> {
  if (impl === "ts") return migrateRolesKeyUnder(home);
  const out = execFileSync("sh", ["-c", ROLES_KEY_MIGRATION_CMD], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf-8",
  });
  const counts = parseRolesKeyMigrationOutput(out);
  if (!counts) throw new Error(`unparseable script output: ${out}`);
  return counts;
}

/** [name, input, expected output (null = unchanged), conflict?] */
const CASES: Array<{
  name: string;
  input: string;
  expected: string | null;
  conflict?: boolean;
  /** Migrated on the first run, but the leftover `role:` line reports as a conflict afterwards. */
  conflictAfter?: boolean;
}> = [
  {
    name: "scalar",
    input: "---\nname: a\nrole: worker\ntask: t\n---\nbody\n",
    expected: "---\nname: a\nroles: worker\ntask: t\n---\nbody\n",
  },
  {
    name: "two-role-lines-first-only",
    input: "---\nrole: a\ntask: t\nrole: b\n---\n",
    expected: "---\nroles: a\ntask: t\nrole: b\n---\n",
    conflictAfter: true,
  },
  {
    name: "byte-order-mark",
    input: "\ufeff---\nrole: worker\n---\n",
    expected: "\ufeff---\nroles: worker\n---\n",
  },
  {
    name: "flow",
    input: "---\nname: a\nrole: [a, \"b\"]  # two\n---\n",
    expected: "---\nname: a\nroles: [a, \"b\"]  # two\n---\n",
  },
  {
    name: "block-list",
    input: "---\nname: a\nrole:\n  - a\n  - b\n- c\ntask: t\n---\nbody\n",
    expected: "---\nname: a\nroles:\n  - a\n  - b\n- c\ntask: t\n---\nbody\n",
  },
  {
    name: "no-space-value",
    input: "---\nrole:x\n---\n",
    expected: "---\nroles:x\n---\n",
  },
  {
    name: "already-roles",
    input: "---\nname: a\nroles: [a, b]\n---\nrole: in body\n",
    expected: null,
  },
  {
    name: "both-keys",
    input: "---\nrole: a\nroles: b\n---\n",
    expected: null,
    conflict: true,
  },
  {
    name: "body-only",
    input: "---\nname: a\n---\nrole: x\n",
    expected: null,
  },
  {
    name: "body-role-untouched",
    input: "---\nrole: a\n---\nrole: b\n---\nrole: c\n",
    expected: "---\nroles: a\n---\nrole: b\n---\nrole: c\n",
  },
  {
    name: "second-block-ignored",
    input: "---\nname: a\n---\ntext\n---\nrole: x\n---\n",
    expected: null,
  },
  {
    name: "no-frontmatter",
    input: "name: a\nrole: x\n",
    expected: null,
  },
  {
    name: "unterminated",
    input: "---\nname: a\nrole: x\n",
    expected: null,
  },
  {
    name: "lookalike-keys",
    input: "---\nroleplay: x\nrole_x: y\n  role: z\nRole: w\n---\n",
    expected: null,
  },
  {
    name: "crlf",
    input: "---\r\nname: a\r\nrole: x\r\n---\r\nrole: body\r\n",
    expected: "---\r\nname: a\r\nroles: x\r\n---\r\nrole: body\r\n",
  },
  {
    name: "unicode-and-padded-fence",
    input: "---  \nname: café ✓\nrole: x\n---\t\nñ\n",
    expected: "---  \nname: café ✓\nroles: x\n---\t\nñ\n",
  },
];

describe("migrateRolesKeyBytes (pure)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = migrateRolesKeyBytes(Buffer.from(c.input, "utf-8"));
      if (c.expected === null) {
        expect(r.kind).toBe(c.conflict ? "conflict" : "none");
      } else {
        expect(r.kind).toBe("migrated");
        if (r.kind === "migrated") expect(r.bytes.toString("utf-8")).toBe(c.expected);
      }
    });
  }
});

describe("parseRolesKeyMigrationOutput", () => {
  it("rejects missing sentinel / missing counts line", () => {
    expect(parseRolesKeyMigrationOutput("")).toBeNull();
    expect(parseRolesKeyMigrationOutput("Traceback ...")).toBeNull();
    expect(parseRolesKeyMigrationOutput("__ROLES_KEY_MIGRATION_OK__")).toBeNull();
  });
});

for (const impl of ["python", "ts"] as const) {
  describe(`roles-key migration against a temp HOME (${impl})`, () => {
    let home: string;
    beforeEach(async () => {
      home = await fs.mkdtemp(path.join(os.tmpdir(), `roles-key-${impl}-`));
    });
    afterEach(async () => {
      await fs.rm(home, { recursive: true, force: true });
    });

    const idPath = (root: string, name: string) =>
      path.join(home, "fleet", root, name, `${name}.md`);
    const baselinePath = (root: string, name: string) =>
      path.join(home, "fleet", root, name, "role-file-watch", "last-snapshot.identity");

    async function put(p: string, content: string, mode = 0o644) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
      await fs.chmod(p, mode);
    }

    it("no fleet folders at all → zero counts, no error", async () => {
      const counts = await runImpl(impl, home);
      expect(counts).toEqual({
        filesMigrated: 0,
        baselinesMigrated: 0,
        conflicts: 0,
        conflictPaths: [],
        errorCount: 0,
        errors: [],
        deferred: 0,
      });
    });

    it("every case: identity files, baselines and archive folders", async () => {
      for (const c of CASES) {
        await put(idPath("identities", c.name), c.input);
        await put(baselinePath("identities", c.name), c.input);
        await put(idPath("identities-archive", c.name), c.input);
      }
      const changed = CASES.filter((c) => c.expected !== null).length;
      const conflicting = CASES.filter((c) => c.conflict).length;

      const counts = await runImpl(impl, home);
      expect(counts.filesMigrated).toBe(changed * 2); // identities + archive
      expect(counts.baselinesMigrated).toBe(changed);
      expect(counts.conflicts).toBe(conflicting * 3);
      expect(counts.errorCount).toBe(0);
      expect(counts.conflictPaths.every((p) => p.includes("both-keys"))).toBe(true);

      for (const c of CASES) {
        const want = c.expected ?? c.input;
        for (const p of [
          idPath("identities", c.name),
          baselinePath("identities", c.name),
          idPath("identities-archive", c.name),
        ]) {
          expect(await fs.readFile(p, "utf-8"), `${c.name} @ ${p}`).toBe(want);
        }
      }
      // No temp files left behind.
      const dir = path.dirname(idPath("identities", "scalar"));
      expect((await fs.readdir(dir)).filter((f) => f.includes("roles-tmp"))).toEqual([]);

      // Idempotent: second run changes nothing and touches nothing.
      const before = await fs.stat(idPath("identities", "scalar"));
      const again = await runImpl(impl, home);
      expect(again.filesMigrated).toBe(0);
      expect(again.baselinesMigrated).toBe(0);
      const conflictingAfter = CASES.filter((c) => c.conflictAfter).length;
      expect(again.conflicts).toBe((conflicting + conflictingAfter) * 3); // conflicts persist until a human fixes them
      expect(again.errorCount).toBe(0);
      const after = await fs.stat(idPath("identities", "scalar"));
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.ino).toBe(before.ino);
    });

    it("preserves file mode and replaces atomically (new inode)", async () => {
      const p = idPath("identities", "alpha");
      await put(p, "---\nrole: x\n---\n", 0o600);
      const before = await fs.stat(p);
      const counts = await runImpl(impl, home);
      expect(counts.filesMigrated).toBe(1);
      const after = await fs.stat(p);
      expect(after.mode & 0o7777).toBe(0o600);
      expect(after.ino).not.toBe(before.ino);
      expect(await fs.readFile(p, "utf-8")).toBe("---\nroles: x\n---\n");
    });

    it("only <name>/<name>.md and the baseline — other files untouched", async () => {
      const content = "---\nrole: x\n---\n";
      const dir = path.join(home, "fleet", "identities", "beta");
      await put(path.join(dir, "notes.md"), content);
      await put(path.join(dir, "nested", "nested.md"), content);
      await put(path.join(dir, "role-file-watch", "last-snapshot.role.x"), content);
      await put(path.join(home, "fleet", "identities", "stray.md"), content);
      const counts = await runImpl(impl, home);
      expect(counts.filesMigrated + counts.baselinesMigrated).toBe(0);
      for (const p of [
        path.join(dir, "notes.md"),
        path.join(dir, "nested", "nested.md"),
        path.join(dir, "role-file-watch", "last-snapshot.role.x"),
        path.join(home, "fleet", "identities", "stray.md"),
      ]) {
        expect(await fs.readFile(p, "utf-8")).toBe(content);
      }
    });

    it("baseline migrated even when the identity file is absent / already migrated", async () => {
      await put(baselinePath("identities", "gamma"), "---\nrole: x\n---\n");
      await put(idPath("identities", "delta"), "---\nroles: x\n---\n");
      await put(baselinePath("identities", "delta"), "---\nrole: x\n---\n");
      const counts = await runImpl(impl, home);
      expect(counts.baselinesMigrated).toBe(2);
      expect(counts.filesMigrated).toBe(0);
      expect(await fs.readFile(baselinePath("identities", "delta"), "utf-8")).toBe(
        "---\nroles: x\n---\n",
      );
    });

    it.skipIf(process.getuid?.() === 0)(
      "unwritable folder → counted as an error, other files still migrated",
      async () => {
        await put(idPath("identities", "locked"), "---\nrole: x\n---\n");
        await put(idPath("identities", "open"), "---\nrole: x\n---\n");
        const lockedDir = path.dirname(idPath("identities", "locked"));
        await fs.chmod(lockedDir, 0o555);
        try {
          const counts = await runImpl(impl, home);
          expect(counts.errorCount).toBe(1);
          expect(counts.errors[0].path).toContain("locked");
          expect(counts.filesMigrated).toBe(1);
          expect(await fs.readFile(idPath("identities", "locked"), "utf-8")).toBe(
            "---\nrole: x\n---\n",
          );
        } finally {
          await fs.chmod(lockedDir, 0o755);
        }
      },
    );
  });
}
