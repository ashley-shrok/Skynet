/**
 * identity-artifact-reader.projects.test.ts — Phase 117 Plan 117-01
 *
 * Unit tests for the project primitives added to identity-artifact-reader.ts
 * per CONTEXT.md D-01..D-05, D-25, D-30, D-32, D-36:
 *
 *   Task 1 exports:
 *     - PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/ constant
 *     - getLocalProjectsRoot(): string
 *     - readSessionProjectField(conn, identityKey): Promise<string | null>
 *     - writeSessionProjectField(conn, identityKey, projectSlug | null): Promise<void>
 *
 *   Task 2 exports (appended below):
 *     - listProjects(conn): Promise<Array<{slug, displayName}>>
 *     - readProjectFile(conn, slug): Promise<{markdown: string}>
 *     - createProject(conn, slug, displayName): Promise<void>
 *     - archiveProject(conn, slug): Promise<void>
 *
 * The load-bearing constraint (RESEARCH § Common Pitfalls #5): the frontmatter
 * writer must go through a FULL yaml.load round-trip, NOT
 * extractCosmeticsFromFrontmatter (which is field-narrowing and drops unknown
 * keys). Test 12 (writeSessionProjectField unknown-key preservation) is the
 * regression guard.
 *
 * Mocking strategy follows identity-artifact-reader.avatar-read.test.ts:
 *   - vi.mock("fs/promises") — LOCAL branch reads/writes
 *   - vi.mock("../ssh/tmux-helper.js") — REMOTE-branch execCommand
 *   - mock ssh2 Client's .sftp() for writeMarkdownFileAtomic's REMOTE branch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the dynamic import of identity-artifact-reader
// ---------------------------------------------------------------------------

const execCommandMock = vi.fn();
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: (conn: unknown, cmd: string) => execCommandMock(conn, cmd),
}));

const fsReadFileMock = vi.fn();
const fsWriteFileMock = vi.fn();
const fsRenameMock = vi.fn();
const fsMkdirMock = vi.fn();
const fsReaddirMock = vi.fn();
const fsStatMock = vi.fn();
const fsUnlinkMock = vi.fn();

vi.mock("fs/promises", () => ({
  default: {
    readFile: (p: string, opts?: unknown) => fsReadFileMock(p, opts),
    writeFile: (p: string, data: unknown, opts?: unknown) =>
      fsWriteFileMock(p, data, opts),
    rename: (from: string, to: string) => fsRenameMock(from, to),
    mkdir: (p: string, opts?: unknown) => fsMkdirMock(p, opts),
    readdir: (p: string, opts?: unknown) => fsReaddirMock(p, opts),
    stat: (p: string) => fsStatMock(p),
    unlink: (p: string) => fsUnlinkMock(p),
  },
  readFile: (p: string, opts?: unknown) => fsReadFileMock(p, opts),
  writeFile: (p: string, data: unknown, opts?: unknown) =>
    fsWriteFileMock(p, data, opts),
  rename: (from: string, to: string) => fsRenameMock(from, to),
  mkdir: (p: string, opts?: unknown) => fsMkdirMock(p, opts),
  readdir: (p: string, opts?: unknown) => fsReaddirMock(p, opts),
  stat: (p: string) => fsStatMock(p),
  unlink: (p: string) => fsUnlinkMock(p),
}));

// Import AFTER the vi.mock so the mocks bind to the module graph.
import {
  PROJECT_SLUG_RE,
  getLocalProjectsRoot,
  readSessionProjectField,
  writeSessionProjectField,
  listProjects,
  readProjectFile,
  createProject,
  archiveProject,
} from "./identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Mock SSH client builder — records SFTP + exec activity for assertions
// ---------------------------------------------------------------------------

interface SftpCall {
  op: "writeFile" | "ext_openssh_rename" | "realpath";
  args: unknown[];
}

function buildMockConn(): {
  conn: SSHClientType;
  sftp: {
    writeFile: ReturnType<typeof vi.fn>;
    ext_openssh_rename: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    realpath: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  sftpCalls: SftpCall[];
} {
  const sftpCalls: SftpCall[] = [];

  const sftp = {
    writeFile: vi.fn(
      (
        p: string,
        buf: Buffer,
        opts: unknown,
        cb: (err: Error | undefined) => void,
      ) => {
        sftpCalls.push({ op: "writeFile", args: [p, buf, opts] });
        cb(undefined);
      },
    ),
    ext_openssh_rename: vi.fn(
      (from: string, to: string, cb: (err: Error | undefined) => void) => {
        sftpCalls.push({ op: "ext_openssh_rename", args: [from, to] });
        cb(undefined);
      },
    ),
    rename: vi.fn(() => {
      throw new Error("must not call sftp.rename — use ext_openssh_rename");
    }),
    unlink: vi.fn((_p: string, cb: (err: Error | undefined) => void) => {
      cb(undefined);
    }),
    realpath: vi.fn(
      (
        p: string,
        cb: (err: Error | undefined, absPath?: string) => void,
      ) => {
        sftpCalls.push({ op: "realpath", args: [p] });
        cb(undefined, "/home/tester");
      },
    ),
    end: vi.fn(),
  };

  const conn = {
    sftp: (cb: (err: Error | undefined, s: SFTPWrapper) => void) => {
      cb(undefined, sftp as unknown as SFTPWrapper);
    },
  } as unknown as SSHClientType;

  return { conn, sftp, sftpCalls };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: fs ops reject with ENOENT — every test overrides as needed.
  fsReadFileMock.mockImplementation(() => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    return Promise.reject(err);
  });
  fsWriteFileMock.mockImplementation(() => Promise.resolve());
  fsRenameMock.mockImplementation(() => Promise.resolve());
  fsMkdirMock.mockImplementation(() => Promise.resolve());
  fsReaddirMock.mockImplementation(() => Promise.resolve([]));
  fsStatMock.mockImplementation(() => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    return Promise.reject(err);
  });
  fsUnlinkMock.mockImplementation(() => Promise.resolve());
  execCommandMock.mockResolvedValue("");
  // Ensure PROJECTS_HOST_DIR is unset by default.
  delete process.env.PROJECTS_HOST_DIR;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PROJECTS_HOST_DIR;
});

// ===========================================================================
// Task 1: PROJECT_SLUG_RE + getLocalProjectsRoot + read/writeSessionProjectField
// ===========================================================================

describe("PROJECT_SLUG_RE (D-04 kebab-case-lowercased)", () => {
  it("Test 1: accepts abc, a-b-c, proj-1, 0-9, 64-char string; rejects 65-char, uppercase, underscore, slash, empty", () => {
    // Positive cases
    expect(PROJECT_SLUG_RE.test("abc")).toBe(true);
    expect(PROJECT_SLUG_RE.test("a-b-c")).toBe(true);
    expect(PROJECT_SLUG_RE.test("proj-1")).toBe(true);
    expect(PROJECT_SLUG_RE.test("0-9")).toBe(true);
    expect(PROJECT_SLUG_RE.test("a".repeat(64))).toBe(true);

    // Negative cases
    expect(PROJECT_SLUG_RE.test("a".repeat(65))).toBe(false);
    expect(PROJECT_SLUG_RE.test("A")).toBe(false); // uppercase rejected
    expect(PROJECT_SLUG_RE.test("abc_def")).toBe(false); // underscore rejected per D-04
    expect(PROJECT_SLUG_RE.test("abc/def")).toBe(false);
    expect(PROJECT_SLUG_RE.test("")).toBe(false);

    // Byte-shape gate on the regex literal itself: no `i` flag, no `_` in charset.
    expect(PROJECT_SLUG_RE.flags).toBe("");
    expect(PROJECT_SLUG_RE.source).toBe("^[a-z0-9-]{1,64}$");
  });
});

describe("getLocalProjectsRoot", () => {
  it("Test 2a: returns process.env.PROJECTS_HOST_DIR when set", () => {
    process.env.PROJECTS_HOST_DIR = "/tmp/x";
    expect(getLocalProjectsRoot()).toBe("/tmp/x");
  });

  it("Test 2b: falls back to os.homedir()/fleet/projects when env var unset", () => {
    delete process.env.PROJECTS_HOST_DIR;
    expect(getLocalProjectsRoot()).toBe(
      path.join(os.homedir(), "fleet", "projects"),
    );
  });
});

describe("readSessionProjectField", () => {
  it("Test 3: LOCAL happy — returns 'alpha' when frontmatter has project: alpha", async () => {
    fsReadFileMock.mockResolvedValueOnce(
      `---\nrole: worker\nproject: alpha\ndisplayName: 'W'\n---\nbody`,
    );
    const result = await readSessionProjectField(null, "moxie");
    expect(result).toBe("alpha");
  });

  it("Test 4: LOCAL missing key — returns null when frontmatter has no project key", async () => {
    fsReadFileMock.mockResolvedValueOnce(
      `---\nrole: worker\ndisplayName: 'W'\n---\nbody`,
    );
    const result = await readSessionProjectField(null, "moxie");
    expect(result).toBeNull();
  });

  it("Test 5: LOCAL no frontmatter — returns null when body has no --- fence", async () => {
    fsReadFileMock.mockResolvedValueOnce("just a body, no frontmatter at all");
    const result = await readSessionProjectField(null, "moxie");
    expect(result).toBeNull();
  });

  it("Test 6: LOCAL empty file (ENOENT) — returns null without throwing", async () => {
    // fsReadFileMock default is ENOENT-reject → readIdentityFile catches and
    // returns {markdown: ""} → readSessionProjectField sees empty markdown.
    const result = await readSessionProjectField(null, "moxie");
    expect(result).toBeNull();
  });

  it("Test 6b: LOCAL bogus YAML — returns null (graceful, does not throw)", async () => {
    fsReadFileMock.mockResolvedValueOnce(
      `---\nrole: worker\ntask: value with: unquoted-colon\n---\nbody`,
    );
    const result = await readSessionProjectField(null, "moxie");
    // js-yaml may or may not accept this shape — either way, project is absent.
    expect(result).toBeNull();
  });
});

describe("writeSessionProjectField — LOCAL branch", () => {
  it("Test 7: set — inserts project: alpha; role/displayName/task preserved in order; body byte-identical", async () => {
    const original =
      "---\nrole: worker\ndisplayName: 'W'\ntask: 'foo'\n---\nsome body text\n";
    fsReadFileMock.mockResolvedValueOnce(original);

    await writeSessionProjectField(null, "moxie", "alpha");

    // writeMarkdownFileAtomic went through writeFile+rename. Grab the written contents.
    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    const written = fsWriteFileMock.mock.calls[0][1] as Buffer;
    const writtenStr = written.toString("utf-8");

    // Round-trip preserves role / displayName / task AND adds project.
    // yaml.dump default emits scalars unquoted when safe (forceQuotes:false):
    // 'W' loads as string W and re-emits as bare W. Assert on the KEY: VALUE
    // shape, not the quote style.
    expect(writtenStr).toContain("role: worker");
    expect(writtenStr).toMatch(/displayName: '?W'?/);
    expect(writtenStr).toMatch(/task: '?foo'?/);
    expect(writtenStr).toContain("project: alpha");
    // Body preserved byte-for-byte after the frontmatter block.
    expect(writtenStr).toMatch(/---\nsome body text\n$/);
  });

  it("Test 8: update — existing project: alpha becomes project: beta; alpha string gone from frontmatter", async () => {
    const original =
      "---\nrole: worker\nproject: alpha\ndisplayName: 'W'\n---\nbody\n";
    fsReadFileMock.mockResolvedValueOnce(original);

    await writeSessionProjectField(null, "moxie", "beta");

    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    const written = fsWriteFileMock.mock.calls[0][1] as Buffer;
    const writtenStr = written.toString("utf-8");

    // Isolate the frontmatter block and assert alpha does not appear inside it.
    const fmMatch = writtenStr.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];
    expect(frontmatter).toContain("project: beta");
    expect(frontmatter).not.toContain("alpha");
  });

  it("Test 9: clear — slug=null DELETES the project key entirely; other fields preserved", async () => {
    const original =
      "---\nrole: worker\nproject: alpha\ndisplayName: 'W'\ntask: 'foo'\n---\nbody\n";
    fsReadFileMock.mockResolvedValueOnce(original);

    await writeSessionProjectField(null, "moxie", null);

    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    const written = fsWriteFileMock.mock.calls[0][1] as Buffer;
    const writtenStr = written.toString("utf-8");
    const fmMatch = writtenStr.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];

    // Absent-⇒-omit invariant: NO project key at all.
    expect(frontmatter).not.toMatch(/^project:/m);
    // Must not emit `project: null` or `project: ''`.
    expect(frontmatter).not.toContain("project: null");
    expect(frontmatter).not.toContain("project: ''");
    // Other fields preserved.
    expect(frontmatter).toContain("role: worker");
    expect(frontmatter).toMatch(/displayName: '?W'?/);
    expect(frontmatter).toContain("task: foo");
  });

  it("Test 10: reject bad slug — 'Alpha' (uppercase) throws 'invalid project slug'", async () => {
    await expect(
      writeSessionProjectField(null, "moxie", "Alpha"),
    ).rejects.toThrow(/invalid project slug/);
    // No read attempted after the slug gate fails.
    expect(fsReadFileMock).not.toHaveBeenCalled();
    expect(fsWriteFileMock).not.toHaveBeenCalled();
  });

  it("Test 11: reject bad identityKey — 'BADKEY!' throws 'invalid identityKey'", async () => {
    await expect(
      writeSessionProjectField(null, "BADKEY!", "alpha"),
    ).rejects.toThrow(/invalid identityKey/);
    expect(fsReadFileMock).not.toHaveBeenCalled();
    expect(fsWriteFileMock).not.toHaveBeenCalled();
  });

  it("Test 12: unknown-key preservation — custom: foo survives round-trip (Pitfall 5 regression guard)", async () => {
    // The frontmatter carries a `custom: foo` field NOT in the
    // extractCosmeticsFromFrontmatter allowlist. If writeSessionProjectField
    // is (mis)implemented via the narrowing extractor, this key disappears
    // on round-trip. The full yaml.load path preserves it.
    const original =
      "---\nrole: worker\ndisplayName: 'W'\ncustom: foo\n---\nbody\n";
    fsReadFileMock.mockResolvedValueOnce(original);

    await writeSessionProjectField(null, "moxie", "alpha");

    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    const written = fsWriteFileMock.mock.calls[0][1] as Buffer;
    const writtenStr = written.toString("utf-8");
    const fmMatch = writtenStr.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];

    // The custom key must survive.
    expect(frontmatter).toContain("custom: foo");
    // Plus the new project key.
    expect(frontmatter).toContain("project: alpha");
    // And the existing keys.
    expect(frontmatter).toContain("role: worker");
    expect(frontmatter).toMatch(/displayName: '?W'?/);
  });

  it("Test 12b: writes atomically via writeMarkdownFileAtomic — tmp file then rename to target", async () => {
    const original = "---\nrole: worker\n---\nbody\n";
    fsReadFileMock.mockResolvedValueOnce(original);

    await writeSessionProjectField(null, "moxie", "alpha");

    // atomic write: writeFile to .tmp then rename to target
    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    expect(fsRenameMock).toHaveBeenCalledTimes(1);
    const writePath = fsWriteFileMock.mock.calls[0][0] as string;
    const renameFrom = fsRenameMock.mock.calls[0][0] as string;
    const renameTo = fsRenameMock.mock.calls[0][1] as string;
    expect(writePath.endsWith(".tmp")).toBe(true);
    expect(renameFrom).toBe(writePath);
    expect(renameTo.endsWith("/moxie.md")).toBe(true);
    expect(renameTo).not.toContain(".tmp");
  });
});

describe("writeSessionProjectField — REMOTE branch", () => {
  it("Test 13: REMOTE — readIdentityFile's cat command is invoked and writeMarkdownFileAtomic REMOTE fires with $HOME-relative target", async () => {
    const { conn, sftp, sftpCalls } = buildMockConn();
    // First execCommand call: readIdentityFile's `cat` command.
    // Second execCommand call: writeMarkdownFileAtomic's SFTP realpath (bypassed
    // — realpath is on sftp, not exec). No further exec calls needed.
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.startsWith("cat ")) {
        return Promise.resolve("---\nrole: worker\n---\nbody\n");
      }
      return Promise.resolve("");
    });

    await writeSessionProjectField(conn, "moxie", "alpha");

    // The cat command was executed with the expected $HOME-relative path.
    const catCalls = execCommandMock.mock.calls.filter(
      (c) => typeof c[1] === "string" && c[1].startsWith("cat "),
    );
    expect(catCalls.length).toBeGreaterThanOrEqual(1);
    expect(catCalls[0][1]).toContain(
      `"$HOME/fleet/identities/moxie/moxie.md"`,
    );

    // writeMarkdownFileAtomic REMOTE branch fired: SFTP realpath resolved
    // $HOME, then writeFile+ext_openssh_rename produced the expected path.
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();
    const renameArgs = sftp.ext_openssh_rename.mock.calls[0];
    const finalPath = renameArgs[1] as string;
    expect(finalPath).toBe("/home/tester/fleet/identities/moxie/moxie.md");

    // Verify writeFile received a Buffer whose contents include the new
    // project: alpha frontmatter key.
    const writeCall = sftpCalls.find((c) => c.op === "writeFile");
    expect(writeCall).toBeDefined();
    const writeBuf = writeCall!.args[1] as Buffer;
    const writeStr = writeBuf.toString("utf-8");
    expect(writeStr).toContain("project: alpha");
    expect(writeStr).toContain("role: worker");
  });
});

// ===========================================================================
// Task 2: listProjects + readProjectFile + createProject + archiveProject
// ===========================================================================

/**
 * Helper: build a Dirent-shaped object for fs.readdir({withFileTypes:true})
 * mocks. Vitest doesn't include fs.Dirent so we duck-type it.
 */
function makeDirent(name: string, isDir: boolean): {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
} {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

describe("listProjects — LOCAL branch", () => {
  it("Test L1: happy — three dirs (alpha, beta, archive); archive EXCLUDED; sorted by slug; displayName pulled from each project.md", async () => {
    // fs.readdir on the root returns 3 dirents.
    fsReaddirMock.mockImplementation((p: string, opts?: unknown) => {
      const _ = opts;
      if (typeof p === "string" && p.endsWith("projects")) {
        return Promise.resolve([
          makeDirent("beta", true),
          makeDirent("alpha", true),
          makeDirent("archive", true),
        ]);
      }
      return Promise.resolve([]);
    });
    // Each project.md read returns the frontmatter shape.
    fsReadFileMock.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("/alpha/project.md")) {
        return Promise.resolve("---\ndisplayName: 'Alpha One'\n---\n");
      }
      if (typeof p === "string" && p.includes("/beta/project.md")) {
        return Promise.resolve("---\ndisplayName: 'Beta'\n---\n");
      }
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    });

    const result = await listProjects(null);
    expect(result).toEqual([
      { slug: "alpha", displayName: "Alpha One" },
      { slug: "beta", displayName: "Beta" },
    ]);
    // archive MUST NOT appear anywhere.
    expect(result.some((p) => p.slug === "archive")).toBe(false);
  });

  it("Test L2: displayName fallback — falls back to slug when project.md missing or has no displayName", async () => {
    fsReaddirMock.mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("projects")) {
        return Promise.resolve([
          makeDirent("alpha", true), // no project.md at all
          makeDirent("beta", true), // project.md exists but no displayName in frontmatter
        ]);
      }
      return Promise.resolve([]);
    });
    fsReadFileMock.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("/alpha/project.md")) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        return Promise.reject(err);
      }
      if (typeof p === "string" && p.includes("/beta/project.md")) {
        return Promise.resolve("---\nrole: something-else\n---\n");
      }
      return Promise.reject(new Error("unexpected path: " + p));
    });

    const result = await listProjects(null);
    expect(result).toEqual([
      { slug: "alpha", displayName: "alpha" },
      { slug: "beta", displayName: "beta" },
    ]);
  });

  it("Test L3: missing root — fs.readdir ENOENT → returns []", async () => {
    fsReaddirMock.mockImplementation(() => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    });

    const result = await listProjects(null);
    expect(result).toEqual([]);
  });
});

describe("listProjects — REMOTE branch", () => {
  it("Test L4: happy — find command contains ! -name archive; two entries sorted", async () => {
    const { conn } = buildMockConn();
    let findCmdSeen = "";
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.startsWith("find ")) {
        findCmdSeen = cmd;
        // Return in NON-sorted order to prove sort happens client-side.
        return Promise.resolve("beta\nalpha\n");
      }
      if (cmd.startsWith("cat ") && cmd.includes("/alpha/project.md")) {
        return Promise.resolve("---\ndisplayName: 'Alpha One'\n---\n");
      }
      if (cmd.startsWith("cat ") && cmd.includes("/beta/project.md")) {
        return Promise.resolve("---\ndisplayName: 'Beta'\n---\n");
      }
      return Promise.resolve("");
    });

    const result = await listProjects(conn);

    expect(findCmdSeen).toContain("! -name archive");
    expect(findCmdSeen).toContain("$HOME/fleet/projects");
    expect(result).toEqual([
      { slug: "alpha", displayName: "Alpha One" },
      { slug: "beta", displayName: "Beta" },
    ]);
  });

  it("Test L5: only-slug-valid entries — BADENTRY! filtered out via PROJECT_SLUG_RE gate", async () => {
    const { conn } = buildMockConn();
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.startsWith("find ")) {
        return Promise.resolve("alpha\nBADENTRY!\nbeta\n");
      }
      if (cmd.startsWith("cat ")) {
        return Promise.resolve(""); // no project.md → displayName falls back to slug
      }
      return Promise.resolve("");
    });

    const result = await listProjects(conn);
    expect(result.map((r) => r.slug)).toEqual(["alpha", "beta"]);
    expect(result.some((r) => r.slug === "BADENTRY!")).toBe(false);
  });
});

describe("readProjectFile", () => {
  it("Test R1: LOCAL happy — returns {markdown: '...body'} from $HOME/fleet/projects/alpha/project.md", async () => {
    fsReadFileMock.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("/alpha/project.md")) {
        return Promise.resolve("---\ndisplayName: 'Alpha'\n---\nbody");
      }
      return Promise.reject(new Error("unexpected: " + p));
    });

    const result = await readProjectFile(null, "alpha");
    expect(result).toEqual({ markdown: "---\ndisplayName: 'Alpha'\n---\nbody" });
  });

  it("Test R2: LOCAL missing — fs.readFile ENOENT → returns {markdown: ''}", async () => {
    // fsReadFileMock default is ENOENT-reject.
    const result = await readProjectFile(null, "alpha");
    expect(result).toEqual({ markdown: "" });
  });

  it("Test R3: invalid slug — 'Alpha' (uppercase) throws before any I/O", async () => {
    await expect(readProjectFile(null, "Alpha")).rejects.toThrow(
      /invalid project slug/,
    );
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });
});

describe("createProject — LOCAL branch", () => {
  it("Test C1 (M2 fix): happy — parent recursive-mkdir, then atomic non-recursive mkdir(projectDir), then writeMarkdownFileAtomic with frontmatter displayName + empty body", async () => {
    // Both mkdirs succeed.
    fsMkdirMock.mockImplementation(() => Promise.resolve());

    await createProject(null, "alpha", "Alpha One");

    // Phase 117 M2 fix (2026-09-18): parent projects/ dir gets a
    // recursive mkdir, then projectDir gets a non-recursive mkdir
    // (atomic dupe-detection at the syscall level).
    expect(fsMkdirMock).toHaveBeenCalledTimes(2);

    // First call: recursive mkdir on parent projects root.
    const parentCall = fsMkdirMock.mock.calls[0];
    expect(typeof parentCall[0]).toBe("string");
    expect((parentCall[0] as string).endsWith("/projects")).toBe(true);
    expect(parentCall[1]).toMatchObject({ recursive: true });

    // Second call: NON-recursive mkdir on projectDir (atomic race guard).
    const childCall = fsMkdirMock.mock.calls[1];
    expect((childCall[0] as string).endsWith("/alpha")).toBe(true);
    // options either absent or explicitly not recursive:true — the M2
    // fix passes no options at all, so childCall[1] is undefined.
    expect(
      childCall[1] === undefined ||
        (childCall[1] as { recursive?: boolean }).recursive !== true,
    ).toBe(true);

    // Atomic write went through writeFile+rename.
    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
    const written = fsWriteFileMock.mock.calls[0][1] as Buffer;
    const writtenStr = written.toString("utf-8");

    // Frontmatter carries the displayName; body is empty per D-25.
    expect(writtenStr).toMatch(/^---\ndisplayName: '?Alpha One'?\n---\n/);
    // Body after frontmatter is empty (no # heading, no seed content).
    const bodyMatch = writtenStr.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).toBe("");

    // Rename target is $HOME/fleet/projects/alpha/project.md.
    const renameTo = fsRenameMock.mock.calls[0][1] as string;
    expect(renameTo.endsWith("/projects/alpha/project.md")).toBe(true);
  });

  it("Test C2 (M2 fix): rejects dupe slug — non-recursive mkdir throws EEXIST → re-thrown as EEXIST-shaped error; no write fires", async () => {
    // Simulate: parent mkdir succeeds; child mkdir throws EEXIST
    // (race with a concurrent create, or plain-old dupe).
    let mkdirCall = 0;
    fsMkdirMock.mockImplementation(() => {
      mkdirCall += 1;
      if (mkdirCall === 1) {
        return Promise.resolve(); // parent -p succeeds
      }
      const err = new Error("EEXIST: file already exists") as NodeJS.ErrnoException;
      err.code = "EEXIST";
      return Promise.reject(err);
    });

    await expect(
      createProject(null, "alpha", "Alpha One"),
    ).rejects.toMatchObject({
      code: "EEXIST",
    });

    // No write past the failed mkdir.
    expect(fsWriteFileMock).not.toHaveBeenCalled();
  });

  it("Test C3: rejects invalid slug — 'Alpha' throws before any I/O", async () => {
    await expect(createProject(null, "Alpha", "Alpha One")).rejects.toThrow(
      /invalid project slug/,
    );
    // Post-M2 fix: fsStatMock is no longer consulted by createProject
    // (only archiveProject uses it now). fsMkdirMock and fsWriteFileMock
    // must NOT fire because slug validation happens before any I/O.
    expect(fsMkdirMock).not.toHaveBeenCalled();
    expect(fsWriteFileMock).not.toHaveBeenCalled();
  });

  it("Test C3b: rejects empty/oversize displayName — no I/O", async () => {
    await expect(createProject(null, "alpha", "")).rejects.toThrow(
      /displayName/,
    );
    await expect(
      createProject(null, "alpha", "x".repeat(81)),
    ).rejects.toThrow(/displayName/);
    expect(fsMkdirMock).not.toHaveBeenCalled();
    expect(fsWriteFileMock).not.toHaveBeenCalled();
  });
});

describe("createProject — REMOTE branch", () => {
  it("Test C4 (M2 fix + H3 fix): happy — single-shot `mkdir -p PARENT && mkdir CHILD` combo (atomic race guard) with double-quoted $HOME, then writeMarkdownFileAtomic REMOTE", async () => {
    const { conn, sftp, sftpCalls } = buildMockConn();
    const execedCmds: string[] = [];
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      execedCmds.push(cmd);
      return Promise.resolve("");
    });

    await createProject(conn, "alpha", "Alpha One");

    // Phase 117 M2 fix (2026-09-18): pre-fix, there were TWO execs —
    // probe (test -d) then mkdir -p. Post-fix, there is ONE combined
    // exec that ensures the parent dir exists (recursive -p) and then
    // creates the child atomically (non-recursive mkdir). If the child
    // already exists, mkdir fails with a non-zero exit that
    // execWithTimeout turns into a throw — we re-map to EEXIST.
    expect(execCommandMock).toHaveBeenCalledTimes(1);
    const cmd = execedCmds[0];

    // Phase 117 H3 fix (2026-09-18): double-quoted $HOME, no single-
    // quote wrapping.
    expect(cmd).toContain('mkdir -p "$HOME/fleet/projects"');
    expect(cmd).toContain('mkdir "$HOME/fleet/projects/alpha"');
    // Regression: MUST NOT single-quote-wrap $HOME.
    expect(cmd).not.toContain("'$HOME");
    // Regression (M2): the child mkdir MUST be non-recursive — the
    // whole point of the atomic dupe-detection.
    expect(cmd).not.toMatch(/mkdir -p "\$HOME\/fleet\/projects\/alpha"/);

    // Atomic write REMOTE branch fired.
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    const renameArgs = sftp.ext_openssh_rename.mock.calls[0];
    expect(renameArgs[1]).toBe("/home/tester/fleet/projects/alpha/project.md");

    // Written contents carry displayName frontmatter.
    const writeCall = sftpCalls.find((c) => c.op === "writeFile");
    expect(writeCall).toBeDefined();
    const writeStr = (writeCall!.args[1] as Buffer).toString("utf-8");
    expect(writeStr).toMatch(/displayName: '?Alpha One'?/);
  });

  it("Test C5 (M2 fix): REMOTE rejects dupe — mkdir throws 'File exists' → re-mapped to EEXIST-shaped throw; no write fires", async () => {
    const { conn, sftp } = buildMockConn();
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      if (cmd.includes("mkdir")) {
        return Promise.reject(
          new Error(
            `mkdir: cannot create directory '/home/tester/fleet/projects/alpha': File exists`,
          ),
        );
      }
      return Promise.resolve("");
    });

    await expect(createProject(conn, "alpha", "Alpha One")).rejects.toMatchObject({
      code: "EEXIST",
    });

    // SFTP writeFile MUST NOT have fired.
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });
});

describe("archiveProject — LOCAL branch", () => {
  it("Test A1: happy — mkdir archive/ recursive, then rename projects/<slug> → projects/archive/<slug>", async () => {
    await archiveProject(null, "alpha");

    // archive/ dir created with recursive:true.
    expect(fsMkdirMock).toHaveBeenCalled();
    const mkdirCall = fsMkdirMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).endsWith("/archive"),
    );
    expect(mkdirCall).toBeDefined();
    expect(mkdirCall![1]).toMatchObject({ recursive: true });

    // rename from projects/alpha → projects/archive/alpha.
    expect(fsRenameMock).toHaveBeenCalledTimes(1);
    const [renameFrom, renameTo] = fsRenameMock.mock.calls[0];
    expect((renameFrom as string).endsWith("/projects/alpha")).toBe(true);
    expect((renameTo as string).endsWith("/projects/archive/alpha")).toBe(true);
  });

  it("Test A2: invalid slug — '../etc' throws before any I/O (path-traversal defense)", async () => {
    await expect(archiveProject(null, "../etc")).rejects.toThrow(
      /invalid project slug/,
    );
    expect(fsMkdirMock).not.toHaveBeenCalled();
    expect(fsRenameMock).not.toHaveBeenCalled();
  });

  it("Test A2b (M1 fix): archive-twice → EEXIST BEFORE any rename fires (dupe archive dest)", async () => {
    // Simulate: archive dest already exists on disk (previous archive of
    // this slug lives there). Second archive must NOT nest — must throw
    // EEXIST-coded error before touching fs.rename.
    fsStatMock.mockImplementationOnce(() =>
      Promise.resolve({ isDirectory: () => true }),
    );
    await expect(archiveProject(null, "alpha")).rejects.toMatchObject({
      code: "EEXIST",
    });
    // fs.rename must NOT have fired — nested-corruption defense.
    expect(fsRenameMock).not.toHaveBeenCalled();
  });
});

describe("archiveProject — REMOTE branch", () => {
  it("Test A3 (H3 fix): happy — probe archive dest missing, then mkdir -p archive && mv <src> <dest>, using double-quoted $HOME", async () => {
    const { conn } = buildMockConn();
    const execedCmds: string[] = [];
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      execedCmds.push(cmd);
      if (cmd.includes("test -d")) {
        return Promise.resolve("missing\n");
      }
      return Promise.resolve("");
    });

    await archiveProject(conn, "alpha");

    // Phase 117 M1 fix (2026-09-18): now TWO execs — first probes archive
    // dest, then (if missing) runs the mkdir+mv combo.
    expect(execCommandMock).toHaveBeenCalledTimes(2);
    // First exec: probe on archive dest, double-quoted $HOME.
    expect(execedCmds[0]).toContain('test -d "$HOME/fleet/projects/archive/alpha"');
    expect(execedCmds[0]).not.toContain("'$HOME");
    // Phase 117 H3 fix (2026-09-18): mkdir -p archive dir precedes mv,
    // and BOTH paths use double-quoted $HOME so the remote shell can
    // actually expand $HOME. Pre-fix, shellEscape wrapped in single
    // quotes and disabled $HOME expansion.
    expect(execedCmds[1]).toContain('mkdir -p "$HOME/fleet/projects/archive"');
    expect(execedCmds[1]).toContain('mv "$HOME/fleet/projects/alpha"');
    expect(execedCmds[1]).toContain('"$HOME/fleet/projects/archive/alpha"');
    // Regression: MUST NOT single-quote-wrap $HOME.
    expect(execedCmds[1]).not.toContain("'$HOME");
  });

  it("Test A3b (M1 fix): archive-twice REMOTE → EEXIST when probe reports archive dest exists; NO mv fires", async () => {
    const { conn } = buildMockConn();
    const execedCmds: string[] = [];
    execCommandMock.mockImplementation((_conn: unknown, cmd: string) => {
      execedCmds.push(cmd);
      if (cmd.includes("test -d")) {
        return Promise.resolve("ok\n"); // archive dest already exists
      }
      return Promise.resolve("");
    });

    await expect(archiveProject(conn, "alpha")).rejects.toMatchObject({
      code: "EEXIST",
    });

    // Only the probe should have fired — no mv, no mkdir.
    expect(execedCmds).toHaveLength(1);
    expect(execedCmds[0]).toContain("test -d");
    // Regression: mv MUST NOT have fired (nested-corruption defense).
    expect(execedCmds.some((c) => c.includes("mv "))).toBe(false);
  });
});
