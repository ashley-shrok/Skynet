// ─── per-identity-file — contract tests (Phase 92 Plan 92-01, D-05 wire generalization) ─
//
// Tests the per-identity file-touch primitive that generalizes the identity-birth
// SFTP wire (Phase 77) into a shared module with two callers: identity-birth
// (existing, refactored in Task 2) and pin action (new, wired in Plan 02).
//
// Load-bearing contracts:
//   (T1) identityKey gate uses the STRICTER identity-artifact-reader regex
//        /^[a-z0-9_-]{1,64}$/ — NOT the looser identity-birth.ts:64 regex.
//        This is the H1 fix: same regex writer + readers = no silent
//        write-succeeds-read-fails divergence.
//   (T2) relPath gate is a bounded whitelist: exactly three literals
//        ("relay.json", ".pinned", and ".hidden" — Phase 107 Plan 107-01).
//   (T3-T4) LOCAL + REMOTE happy-path writes.
//   (T5-T6) LOCAL + REMOTE removes are idempotent (ENOENT swallowed).
//   (T7-T8) LOCAL + REMOTE exists returns true/false, fail-closed on error.
//   (T9) byte-shape regression trap: relay.json target path matches the
//        pre-refactor identity-birth-orchestrator L862 literal exactly.
//   (T10) chmod is opt-in via opts.chmod — relay.json passes 0o600,
//        .pinned passes nothing (no chmod applied).
//   (T11) H1 anti-drift lock: primitive's IDENTITY_KEY_RE is identical to
//        identity-artifact-reader.ts:174 IDENTITY_KEY_RE by .source + .flags
//        AND by table-driven acceptance parity sweep.
//
// Mock strategy mirrors identity-artifact-reader.remote-writes.test.ts: install
// a throwing trap on sftp.rename that fails Test 4 loudly with a diagnostic
// naming ext_openssh_rename if a future refactor bypasses the primitive.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;
import os from "os";
import path from "path";

// LOCAL_HOST_IDS is parsed at module-load in identity-artifact-reader (imported
// transitively by per-identity-file.ts). Set the env var BEFORE any import
// evaluates via vi.hoisted, which vitest guarantees runs before hoisted imports.
vi.hoisted(() => {
  process.env.IDENTITIES_LOCAL_HOST_IDS = "999";
});

// Mock tmux-helper.execCommand so any `echo $HOME` reachable from the
// underlying writeMarkdownFileAtomic path resolves without a real ssh2 exec
// channel. Mirror the identity-artifact-reader.remote-writes.test.ts idiom.
// Also serves the REMOTE-branch chmod call the primitive issues.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn().mockResolvedValue("/home/tester\n"),
}));

// Mock node:fs/promises for LOCAL-branch assertions.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  chmod: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn(),
    chmod: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import AFTER the vi.mocks so the mocks are bound to the module graph.
import {
  writeIdentityFile,
  removeIdentityFile,
  identityFileExists,
  ALLOWED_REL_PATHS,
} from "./per-identity-file.js";
import { IDENTITY_KEY_RE as READER_IDENTITY_KEY_RE } from "./identity-artifact-reader.js";
import { IDENTITY_KEY_RE as PRIMITIVE_IDENTITY_KEY_RE } from "./per-identity-file.js";
import { execCommand } from "../ssh/tmux-helper.js";
import fsMod from "node:fs/promises";

// ──────────────────────────────────────────────────────────────────────
// SFTP mock builder — mirrors identity-artifact-reader.remote-writes.test.ts
// ──────────────────────────────────────────────────────────────────────

interface RenameCall {
  from: string;
  to: string;
}

function buildMockConn(overrides?: {
  statResult?: { err?: Error; attrs?: unknown };
  unlinkErr?: Error;
}): {
  conn: SSHClientType;
  sftp: {
    writeFile: ReturnType<typeof vi.fn>;
    ext_openssh_rename: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  renameCalls: RenameCall[];
} {
  const renameCalls: RenameCall[] = [];

  const sftp = {
    writeFile: vi.fn(
      (
        _path: string,
        _buf: Buffer,
        _opts: unknown,
        cb: (err: Error | undefined) => void,
      ) => {
        cb(undefined);
      },
    ),
    ext_openssh_rename: vi.fn(
      (from: string, to: string, cb: (err: Error | undefined) => void) => {
        renameCalls.push({ from, to });
        cb(undefined);
      },
    ),
    // Load-bearing regression trap: any future refactor that reverts to
    // sftp.rename fails Test 4 loudly with a fix-name diagnostic.
    rename: vi.fn(() => {
      throw new Error(
        "pin sentinel wire regressed to sftp.rename — must use ext_openssh_rename via writeMarkdownFileAtomic",
      );
    }),
    unlink: vi.fn((_p: string, cb: (err: Error | undefined) => void) => {
      cb(overrides?.unlinkErr);
    }),
    stat: vi.fn(
      (
        _p: string,
        cb: (err: Error | undefined, attrs: unknown) => void,
      ) => {
        const r = overrides?.statResult;
        if (r === undefined) {
          cb(undefined, { size: 0 });
          return;
        }
        cb(r.err, r.attrs);
      },
    ),
    end: vi.fn(),
  };

  const conn = {
    sftp: (cb: (err: Error | undefined, s: SFTPWrapper) => void) => {
      cb(undefined, sftp as unknown as SFTPWrapper);
    },
  } as unknown as SSHClientType;

  return { conn, sftp, renameCalls };
}

// Fake local hostId used throughout LOCAL-branch tests. LOCAL_HOST_IDS is
// module-load-parsed from IDENTITIES_LOCAL_HOST_IDS; we set that env in
// beforeAll below so isLocalHostId(LOCAL_HOST_ID) returns true.
const LOCAL_HOST_ID = 999;
const REMOTE_HOST_ID = 42;

// ──────────────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Test 1 — identityKey validation uses the STRICTER reader regex
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — identityKey gate (H1 stricter reader regex)", () => {
  it("rejects uppercase before any I/O ('Not-Valid-Key')", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("Not-Valid-Key", ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it("rejects '.' character (permitted by identity-birth.ts:64 loose regex, REJECTED by reader regex)", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("tina.core", ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });

  it("rejects '/' character (permitted by identity-birth.ts:64 loose regex, REJECTED by reader regex)", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("tina/subpath", ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });

  it("rejects '+' and '=' characters (permitted by identity-birth.ts:64 loose regex, REJECTED by reader regex)", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("tina+plus", ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    await expect(
      writeIdentityFile("tina=eq", ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });

  it("rejects >64 chars", async () => {
    const { conn, sftp } = buildMockConn();
    const overlong = "a".repeat(65);
    await expect(
      writeIdentityFile(overlong, ".pinned", "", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid identityKey/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });

  it("accepts legitimate identity keys ('tina-01', 'role_agent', 64-char)", async () => {
    for (const goodKey of ["tina-01", "role_agent", "a".repeat(64)]) {
      const { conn } = buildMockConn();
      await expect(
        writeIdentityFile(goodKey, ".pinned", "", {
          hostId: REMOTE_HOST_ID,
          conn,
        }),
      ).resolves.toBeUndefined();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 2 — relPath whitelist
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — relPath whitelist (D-01 filename lock)", () => {
  it("rejects path traversal ('../../../etc/passwd') before any I/O", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("tina", "../../../etc/passwd", "body", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid relPath/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });

  it("whitelist is exactly {relay.json, .pinned, .hidden} — Phase 107 Plan 107-01 extended to three entries", () => {
    expect(ALLOWED_REL_PATHS).toBeInstanceOf(Set);
    expect(ALLOWED_REL_PATHS.size).toBe(3);
    expect(ALLOWED_REL_PATHS.has("relay.json")).toBe(true);
    expect(ALLOWED_REL_PATHS.has(".pinned")).toBe(true);
    expect(ALLOWED_REL_PATHS.has(".hidden")).toBe(true);
  });

  it("rejects any relPath not in whitelist ('history.md', 'foo.txt')", async () => {
    const { conn, sftp } = buildMockConn();
    await expect(
      writeIdentityFile("tina", "history.md", "body", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid relPath/);
    await expect(
      writeIdentityFile("tina", "foo.txt", "body", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).rejects.toThrow(/invalid relPath/);
    expect(sftp.writeFile).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 3 — LOCAL write happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — LOCAL branch", () => {
  it("creates an empty .pinned file at $HOME/fleet/identities/<name>/.pinned via fs.writeFile — no SFTP conn touched", async () => {
    const writeFileMock = fsMod.writeFile as unknown as ReturnType<typeof vi.fn>;
    const renameMock = fsMod.rename as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", ".pinned", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    // First arg is the tmp path (tmp+rename pattern); it MUST end with `.pinned.tmp`
    const firstArg = writeFileMock.mock.calls[0][0] as string;
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".pinned",
    );
    expect(firstArg).toBe(expectedFinal + ".tmp");
    // Content threaded through unchanged — empty string
    expect(writeFileMock.mock.calls[0][1]).toBe("");
    // Rename tmp → final
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock.mock.calls[0][0]).toBe(expectedFinal + ".tmp");
    expect(renameMock.mock.calls[0][1]).toBe(expectedFinal);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 4 — REMOTE write happy path
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — REMOTE branch", () => {
  it("delegates to writeMarkdownFileAtomic (ext_openssh_rename discipline); NEVER calls sftp.rename", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityFile("tina", ".pinned", "", {
      hostId: REMOTE_HOST_ID,
      conn,
    });

    // Load-bearing: extension called exactly once, plain rename NEVER
    // (the throwing trap would fail this test loudly if bypassed).
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    // Byte-shape invariant (Phase 107 hotfix — 2026-09-12): SFTP path is
    // RELATIVE (no leading `/`, no `$HOME/` prefix). SFTP resolves relative
    // paths against the SSH user's home directory automatically. The prior
    // `$HOME/...` literal shape silently ENOENT'd because SFTP does not
    // expand `$HOME` as a shell variable.
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].to).toBe(
      "fleet/identities/tina/.pinned",
    );

    // sftp.writeFile invoked with the .tmp target BEFORE the rename
    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe(
      "fleet/identities/tina/.pinned.tmp",
    );
    // Empty contents threaded through unchanged (D-01: presence is meaning)
    const writtenBuf = writeArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);
    expect(writtenBuf.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 5 — removeIdentityFile LOCAL is idempotent
// ──────────────────────────────────────────────────────────────────────

describe("removeIdentityFile — LOCAL branch", () => {
  it("calls fs.unlink at $HOME/fleet/identities/<name>/.pinned", async () => {
    const unlinkMock = fsMod.unlink as unknown as ReturnType<typeof vi.fn>;

    await removeIdentityFile("tina", ".pinned", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    expect(unlinkMock).toHaveBeenCalledTimes(1);
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".pinned",
    );
    expect(unlinkMock.mock.calls[0][0]).toBe(expectedFinal);
  });

  it("swallows ENOENT silently (idempotent unpin)", async () => {
    const unlinkMock = fsMod.unlink as unknown as ReturnType<typeof vi.fn>;
    const enoent = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    unlinkMock.mockRejectedValueOnce(enoent);

    await expect(
      removeIdentityFile("tina", ".pinned", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 6 — removeIdentityFile REMOTE is idempotent
// ──────────────────────────────────────────────────────────────────────

describe("removeIdentityFile — REMOTE branch", () => {
  it("calls sftp.unlink; ENOENT / no-such-file is swallowed silently", async () => {
    const enoent = Object.assign(new Error("No such file"), {
      code: 2,
    });
    const { conn, sftp } = buildMockConn({ unlinkErr: enoent });

    await expect(
      removeIdentityFile("tina", ".pinned", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).resolves.toBeUndefined();

    expect(sftp.unlink).toHaveBeenCalledTimes(1);
    expect(sftp.unlink.mock.calls[0][0]).toBe(
      "fleet/identities/tina/.pinned",
    );
  });

  it("succeeds silently when file did exist", async () => {
    const { conn, sftp } = buildMockConn();

    await expect(
      removeIdentityFile("tina", ".pinned", {
        hostId: REMOTE_HOST_ID,
        conn,
      }),
    ).resolves.toBeUndefined();

    expect(sftp.unlink).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 7 — identityFileExists LOCAL contract
// ──────────────────────────────────────────────────────────────────────

describe("identityFileExists — LOCAL branch", () => {
  it("returns true when fs.stat resolves", async () => {
    const statMock = fsMod.stat as unknown as ReturnType<typeof vi.fn>;
    statMock.mockResolvedValueOnce({ size: 0 });

    const result = await identityFileExists("tina", ".pinned", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(result).toBe(true);
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".pinned",
    );
    expect(statMock.mock.calls[0][0]).toBe(expectedFinal);
  });

  it("returns false on ENOENT", async () => {
    const statMock = fsMod.stat as unknown as ReturnType<typeof vi.fn>;
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    statMock.mockRejectedValueOnce(enoent);

    const result = await identityFileExists("tina", ".pinned", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(result).toBe(false);
  });

  it("returns false on any other error (fail-closed)", async () => {
    const statMock = fsMod.stat as unknown as ReturnType<typeof vi.fn>;
    statMock.mockRejectedValueOnce(new Error("EACCES"));

    const result = await identityFileExists("tina", ".pinned", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(result).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 8 — identityFileExists REMOTE contract
// ──────────────────────────────────────────────────────────────────────

describe("identityFileExists — REMOTE branch", () => {
  it("returns true on successful sftp.stat", async () => {
    const { conn } = buildMockConn();
    const result = await identityFileExists("tina", ".pinned", {
      hostId: REMOTE_HOST_ID,
      conn,
    });
    expect(result).toBe(true);
  });

  it("returns false on stat error (ENOENT / any failure — fail-closed)", async () => {
    const enoent = Object.assign(new Error("No such file"), { code: 2 });
    const { conn } = buildMockConn({ statResult: { err: enoent } });
    const result = await identityFileExists("tina", ".pinned", {
      hostId: REMOTE_HOST_ID,
      conn,
    });
    expect(result).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 9 — byte-shape regression trap (relay.json target path unchanged)
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — byte-shape regression trap", () => {
  it("relay.json REMOTE target path matches pre-refactor identity-birth-orchestrator L862 literal", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityFile("tina", "relay.json", "{}", {
      hostId: REMOTE_HOST_ID,
      conn,
      chmod: 0o600,
    });

    // Phase 96 fleet-tree target under $HOME. Phase 107 hotfix (2026-09-12)
    // dropped the `$HOME/` literal prefix — SFTP resolves the bare relative
    // path against the SSH user's home directory automatically.
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].to).toBe(
      "fleet/identities/tina/relay.json",
    );

    // Contents threaded through unchanged (verbatim body-pass invariant)
    const writeArgs = sftp.writeFile.mock.calls[0];
    const writtenBuf = writeArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);
    expect(writtenBuf.toString("utf-8")).toBe("{}");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 10 — chmod is opt-in via opts.chmod
// ──────────────────────────────────────────────────────────────────────

describe("writeIdentityFile — chmod handling", () => {
  it("REMOTE relay.json write with chmod:0o600 issues an execCommand `chmod 600 ...`", async () => {
    const { conn } = buildMockConn();
    const execMock = execCommand as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", "relay.json", "{}", {
      hostId: REMOTE_HOST_ID,
      conn,
      chmod: 0o600,
    });

    const chmodCalls = execMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod\s+600/.test(c[1] as string),
    );
    expect(chmodCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("REMOTE .pinned write WITHOUT opts.chmod issues NO chmod command", async () => {
    const { conn } = buildMockConn();
    const execMock = execCommand as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", ".pinned", "", {
      hostId: REMOTE_HOST_ID,
      conn,
    });

    const chmodCalls = execMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod/.test(c[1] as string),
    );
    expect(chmodCalls).toHaveLength(0);
  });

  it("LOCAL relay.json write with chmod:0o600 issues fs.chmod on final path", async () => {
    const chmodMock = fsMod.chmod as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", "relay.json", "{}", {
      hostId: LOCAL_HOST_ID,
      conn: null,
      chmod: 0o600,
    });

    expect(chmodMock).toHaveBeenCalledTimes(1);
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      "relay.json",
    );
    expect(chmodMock.mock.calls[0][0]).toBe(expectedFinal);
    expect(chmodMock.mock.calls[0][1]).toBe(0o600);
  });

  it("LOCAL .pinned write WITHOUT opts.chmod does NOT call fs.chmod", async () => {
    const chmodMock = fsMod.chmod as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", ".pinned", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    expect(chmodMock).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Test 11 — H1 anti-drift lock (write⇔read regex parity)
// ──────────────────────────────────────────────────────────────────────

describe("H1 lock — primitive IDENTITY_KEY_RE parity with identity-artifact-reader.ts:174", () => {
  it("primitive regex has identical .source + .flags as reader regex", () => {
    expect(PRIMITIVE_IDENTITY_KEY_RE.source).toBe(READER_IDENTITY_KEY_RE.source);
    expect(PRIMITIVE_IDENTITY_KEY_RE.flags).toBe(READER_IDENTITY_KEY_RE.flags);
    // Verbatim value assertion for grep-recoverability
    expect(PRIMITIVE_IDENTITY_KEY_RE.source).toBe("^[a-z0-9_-]{1,64}$");
  });

  it("primitive regex accepts EXACTLY the same set of keys the reader regex accepts (table sweep)", () => {
    const cases = [
      "tina",
      "tina-01",
      "role_agent",
      "a",
      "a".repeat(64),
      "Tina",
      "tina.core",
      "tina/sub",
      "tina+plus",
      "tina=eq",
      "a".repeat(65),
      "",
    ];
    for (const k of cases) {
      const primitiveAccepts = PRIMITIVE_IDENTITY_KEY_RE.test(k);
      const readerAccepts = READER_IDENTITY_KEY_RE.test(k);
      expect(primitiveAccepts).toBe(readerAccepts);
    }
  });

  it("the looser identity-birth.ts:64 regex `/^[a-z0-9._=/+-]+$/` does NOT match the primitive regex", () => {
    // Anti-drift assertion: keys accepted by the loose route regex but
    // rejected by the primitive prove the tightening bites.
    const looseRegex = /^[a-z0-9._=/+-]+$/;
    const differentiators = ["tina.core", "tina/sub", "tina+plus", "tina=eq"];
    for (const k of differentiators) {
      expect(looseRegex.test(k)).toBe(true); // loose route would accept
      expect(PRIMITIVE_IDENTITY_KEY_RE.test(k)).toBe(false); // primitive rejects
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase 107 Plan 107-01: .hidden sentinel primitive coverage
// ──────────────────────────────────────────────────────────────────────
//
// Mirrors the existing .pinned test coverage for the new .hidden relPath.
// Tests H-01 through H-10 exercise:
//   H-01: whitelist admission (write/remove/exists accept ".hidden")
//   H-02: whitelist still bounded (".hidden.old", "hidden" without dot still rejected)
//   H-03: LOCAL write of ".hidden" preserves zero-byte body (presence-is-meaning)
//   H-04: REMOTE write of ".hidden" delegates to writeMarkdownFileAtomic with relative-path (home-resolved) + empty body
//   H-05: LOCAL remove of ".hidden" — idempotent ENOENT swallow
//   H-06: REMOTE remove of ".hidden" — idempotent SSH_FX_NO_SUCH_FILE swallow
//   H-07: LOCAL identityFileExists — true/false + fail-closed
//   H-08: REMOTE identityFileExists — true/false + fail-closed
//   H-09: no chmod applied to ".hidden" (opts.chmod omitted — mirrors .pinned treatment)
//   H-10: identityKey gate STILL applies to ".hidden" — widening relPath does NOT loosen key gate

describe("Phase 107 Plan 107-01: .hidden sentinel primitive coverage", () => {
  // ── H-01: whitelist admission ──────────────────────────────────────────

  it("H-01: writeIdentityFile / removeIdentityFile / identityFileExists accept '.hidden' (no invalid-relPath throw)", async () => {
    const writeFileMock = fsMod.writeFile as unknown as ReturnType<typeof vi.fn>;
    const renameMock = fsMod.rename as unknown as ReturnType<typeof vi.fn>;
    const unlinkMock = fsMod.unlink as unknown as ReturnType<typeof vi.fn>;
    const statMock = fsMod.stat as unknown as ReturnType<typeof vi.fn>;
    statMock.mockResolvedValueOnce({ size: 0 });

    // writeIdentityFile must NOT throw at assertValidRelPath for ".hidden"
    await expect(
      writeIdentityFile("tina", ".hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).resolves.toBeUndefined();
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);

    // removeIdentityFile must NOT throw at assertValidRelPath for ".hidden"
    await expect(
      removeIdentityFile("tina", ".hidden", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).resolves.toBeUndefined();
    expect(unlinkMock).toHaveBeenCalledTimes(1);

    // identityFileExists must NOT throw at assertValidRelPath for ".hidden"
    const exists = await identityFileExists("tina", ".hidden", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(typeof exists).toBe("boolean");
  });

  // ── H-02: whitelist still bounded ─────────────────────────────────────

  it("H-02: '.hidden.old' and 'hidden' (without dot) still throw 'invalid relPath' — whitelist bound preserved", async () => {
    // .hidden.old — suffix variant
    await expect(
      writeIdentityFile("tina", ".hidden.old", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // hidden — missing leading dot
    await expect(
      writeIdentityFile("tina", "hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);

    // .hiddenx — extended version still rejected
    await expect(
      writeIdentityFile("tina", ".hiddenx", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid relPath/);
  });

  // ── H-03: LOCAL write — zero-byte body preserved ──────────────────────

  it("H-03: LOCAL write of '.hidden' with empty string produces zero-byte file (presence-is-meaning)", async () => {
    const writeFileMock = fsMod.writeFile as unknown as ReturnType<typeof vi.fn>;
    const renameMock = fsMod.rename as unknown as ReturnType<typeof vi.fn>;

    await writeIdentityFile("tina", ".hidden", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    // tmp path must end with .hidden.tmp
    const tmpPath = writeFileMock.mock.calls[0][0] as string;
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".hidden",
    );
    expect(tmpPath).toBe(expectedFinal + ".tmp");
    // Empty contents threaded through unchanged — zero-byte body (NO contents || fallback)
    const writtenContents = writeFileMock.mock.calls[0][1] as string;
    expect(writtenContents).toBe("");

    // rename tmp → final
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock.mock.calls[0][0]).toBe(expectedFinal + ".tmp");
    expect(renameMock.mock.calls[0][1]).toBe(expectedFinal);
  });

  // ── H-04: REMOTE write — writeMarkdownFileAtomic + relative-path (home-resolved) + empty body ──

  it("H-04: REMOTE write of '.hidden' delegates to writeMarkdownFileAtomic with relative-path (home-resolved) path and empty body (byte-shape parity)", async () => {
    const { conn, sftp, renameCalls } = buildMockConn();

    await writeIdentityFile("tina", ".hidden", "", {
      hostId: REMOTE_HOST_ID,
      conn,
    });

    // Must use ext_openssh_rename (via writeMarkdownFileAtomic), NEVER sftp.rename
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(sftp.rename).not.toHaveBeenCalled();

    // Byte-shape invariant (Phase 107 hotfix): SFTP path is RELATIVE (home-resolved
    // by SFTP), not `$HOME/...` literal.
    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].to).toBe("fleet/identities/tina/.hidden");

    // sftp.writeFile invoked with the .tmp target BEFORE the rename
    expect(sftp.writeFile).toHaveBeenCalledTimes(1);
    const writeArgs = sftp.writeFile.mock.calls[0];
    expect(writeArgs[0]).toBe("fleet/identities/tina/.hidden.tmp");
    // Empty contents threaded through (presence-is-meaning — zero-byte)
    const writtenBuf = writeArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);
    expect(writtenBuf.length).toBe(0);
  });

  // ── H-05: LOCAL remove — idempotent ENOENT swallow ────────────────────

  it("H-05: LOCAL removeIdentityFile of '.hidden' swallows ENOENT silently (idempotent unhide)", async () => {
    const unlinkMock = fsMod.unlink as unknown as ReturnType<typeof vi.fn>;
    const enoent = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    unlinkMock.mockRejectedValueOnce(enoent);

    // Should resolve silently even when file doesn't exist
    await expect(
      removeIdentityFile("tina", ".hidden", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).resolves.toBeUndefined();

    // When file exists — succeeds and unlinks at the correct path
    await removeIdentityFile("tina", ".hidden", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".hidden",
    );
    expect(unlinkMock.mock.calls[1][0]).toBe(expectedFinal);
  });

  // ── H-06: REMOTE remove — SSH_FX_NO_SUCH_FILE swallow ────────────────

  it("H-06: REMOTE removeIdentityFile swallows SSH_FX_NO_SUCH_FILE (code: 2); non-ENOENT error propagates", async () => {
    // SSH_FX_NO_SUCH_FILE (numeric code 2) swallowed — idempotent unhide of a not-yet-hidden identity
    const sshNoSuchFile = Object.assign(new Error("No such file"), {
      code: 2,
    });
    const { conn: conn1 } = buildMockConn({ unlinkErr: sshNoSuchFile });
    await expect(
      removeIdentityFile("tina", ".hidden", {
        hostId: REMOTE_HOST_ID,
        conn: conn1,
      }),
    ).resolves.toBeUndefined();

    // Non-ENOENT error DOES propagate
    const permErr = Object.assign(new Error("Permission denied"), {
      code: "EACCES",
    });
    const { conn: conn2 } = buildMockConn({ unlinkErr: permErr });
    await expect(
      removeIdentityFile("tina", ".hidden", {
        hostId: REMOTE_HOST_ID,
        conn: conn2,
      }),
    ).rejects.toThrow(/Permission denied/);
  });

  // ── H-07: LOCAL identityFileExists — true/false + fail-closed ─────────

  it("H-07: LOCAL identityFileExists('.hidden') — true when file exists, false on ENOENT, false on any other error (fail-closed)", async () => {
    const statMock = fsMod.stat as unknown as ReturnType<typeof vi.fn>;

    // Returns true when fs.stat resolves
    statMock.mockResolvedValueOnce({ size: 0 });
    const existsTrue = await identityFileExists("tina", ".hidden", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(existsTrue).toBe(true);
    const expectedFinal = path.join(
      os.homedir(),
      "fleet",
      "identities",
      "tina",
      ".hidden",
    );
    expect(statMock.mock.calls[0][0]).toBe(expectedFinal);

    // Returns false on ENOENT
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    statMock.mockRejectedValueOnce(enoent);
    const existsEnoent = await identityFileExists("tina", ".hidden", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(existsEnoent).toBe(false);

    // Fail-closed: returns false on permission error (never over-report hidden)
    statMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const existsEacces = await identityFileExists("tina", ".hidden", {
      hostId: LOCAL_HOST_ID,
      conn: null,
    });
    expect(existsEacces).toBe(false);
  });

  // ── H-08: REMOTE identityFileExists — true/false + fail-closed ────────

  it("H-08: REMOTE identityFileExists('.hidden') — true on successful sftp.stat, false on any stat error (fail-closed)", async () => {
    // Returns true on successful sftp.stat
    const { conn: conn1 } = buildMockConn(); // default: stat returns { size: 0 }
    const existsTrue = await identityFileExists("tina", ".hidden", {
      hostId: REMOTE_HOST_ID,
      conn: conn1,
    });
    expect(existsTrue).toBe(true);

    // Returns false on stat error regardless of error code (fail-closed)
    const statErr = Object.assign(new Error("No such file"), { code: 2 });
    const { conn: conn2 } = buildMockConn({ statResult: { err: statErr } });
    const existsFalse = await identityFileExists("tina", ".hidden", {
      hostId: REMOTE_HOST_ID,
      conn: conn2,
    });
    expect(existsFalse).toBe(false);
  });

  // ── H-09: no chmod applied to ".hidden" ───────────────────────────────

  it("H-09: writeIdentityFile('.hidden') with opts.chmod OMITTED does NOT invoke execCommand or fs.chmod", async () => {
    const execMock = execCommand as unknown as ReturnType<typeof vi.fn>;
    const chmodMock = fsMod.chmod as unknown as ReturnType<typeof vi.fn>;

    // REMOTE branch — no chmod
    const { conn } = buildMockConn();
    await writeIdentityFile("tina", ".hidden", "", {
      hostId: REMOTE_HOST_ID,
      conn,
      // opts.chmod deliberately OMITTED
    });
    const chmodExecCalls = execMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod/.test(c[1] as string),
    );
    expect(chmodExecCalls).toHaveLength(0);
    expect(chmodMock).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // LOCAL branch — no chmod
    await writeIdentityFile("tina", ".hidden", "", {
      hostId: LOCAL_HOST_ID,
      conn: null,
      // opts.chmod deliberately OMITTED
    });
    expect(chmodMock).not.toHaveBeenCalled();
    const chmodExecCallsLocal = execMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[1] === "string" && /chmod/.test(c[1] as string),
    );
    expect(chmodExecCallsLocal).toHaveLength(0);
  });

  // ── H-10: identityKey gate STILL applies to ".hidden" ─────────────────

  it("H-10: writeIdentityFile throws at identityKey gate for '.hidden' with invalid keys — widening relPath does NOT loosen the key gate", async () => {
    // Uppercase rejected (MUST throw BEFORE reaching the whitelist gate)
    await expect(
      writeIdentityFile("Tina", ".hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identityKey/);

    // Dot-containing key rejected
    await expect(
      writeIdentityFile("tina.core", ".hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identityKey/);

    // Slash-containing key rejected
    await expect(
      writeIdentityFile("tina/sub", ".hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identityKey/);

    // Empty string rejected
    await expect(
      writeIdentityFile("", ".hidden", "", {
        hostId: LOCAL_HOST_ID,
        conn: null,
      }),
    ).rejects.toThrow(/invalid identityKey/);
  });
});
