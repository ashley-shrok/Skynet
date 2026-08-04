/**
 * plan-file-fetch.test.ts (Phase 24, Plan 24-02)
 *
 * Vitest suite for the SFTP side-channel plan-file fetch. The security
 * boundary is `validatePlanPath` — every rejection case in this suite
 * asserts that the mock SFTP `.sftp()` / `.realpath` / `.stat` / `.readFile`
 * were NOT called, i.e. `fetchPlanFile` fails-closed BEFORE any network
 * contact (T-24-02 mitigation).
 *
 * Mock shape mirrors `pretty-view-upload.test.ts` L59-100 — a
 * `Map<absPath, Buffer>` backs `stat` + `readFile`; `realpath(".")` returns
 * the configured home directory string.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { fetchPlanFile, MAX_PLAN_BYTES } from "./plan-file-fetch.js";

/* --------------------------------------------------------------------- */
/*  Mock SFTP + SSH Client                                               */
/* --------------------------------------------------------------------- */

interface MockSftp {
  realpath: Mock;
  stat: Mock;
  readFile: Mock;
  __plans: Map<string, Buffer>;
}

function makeMockSftp(
  plans: Record<string, string | Buffer> = {},
  home: string = "/home/ashley",
): MockSftp {
  const map = new Map<string, Buffer>(
    Object.entries(plans).map(([k, v]) => [
      k,
      Buffer.isBuffer(v) ? v : Buffer.from(v, "utf8"),
    ]),
  );
  return {
    __plans: map,
    realpath: vi.fn(
      (p: string, cb: (err: Error | null, resolved: string) => void) => {
        queueMicrotask(() => {
          if (p === ".") cb(null, home);
          else cb(null, p);
        });
      },
    ),
    stat: vi.fn(
      (
        p: string,
        cb: (
          err: (Error & { code?: number }) | null,
          stats?: { size: number; isFile: () => boolean },
        ) => void,
      ) => {
        queueMicrotask(() => {
          const buf = map.get(p);
          if (buf) {
            cb(null, { size: buf.length, isFile: () => true });
          } else {
            const e = Object.assign(new Error("ENOENT: no such file"), {
              code: 2,
            });
            cb(e);
          }
        });
      },
    ),
    readFile: vi.fn(
      (
        p: string,
        cb: (err: Error | null, data: Buffer) => void,
      ) => {
        queueMicrotask(() => {
          const buf = map.get(p);
          if (buf) {
            cb(null, buf);
          } else {
            const e = Object.assign(new Error("ENOENT: no such file"), {
              code: 2,
            });
            // Match ssh2 shape: err set, no data — we still pass a placeholder
            // second arg so TS callback shape is satisfied.
            (cb as unknown as (e: Error) => void)(e);
          }
        });
      },
    ),
  };
}

interface MockSshClient {
  sftp: Mock;
}

function makeMockSshClient(sftp: MockSftp): MockSshClient {
  return {
    sftp: vi.fn((cb: (err: Error | null, sftp: MockSftp) => void) => {
      queueMicrotask(() => cb(null, sftp));
    }),
  };
}

/**
 * Assert `.sftp` on the Client AND every SFTP method on the SFTP mock were
 * NOT called. Called at the end of every rejection-path test so a
 * regression that leaks the bad path onto the wire fails LOUDLY.
 */
function expectNoSftpContact(client: MockSshClient, sftp: MockSftp): void {
  expect(client.sftp).not.toHaveBeenCalled();
  expect(sftp.realpath).not.toHaveBeenCalled();
  expect(sftp.stat).not.toHaveBeenCalled();
  expect(sftp.readFile).not.toHaveBeenCalled();
}

/* --------------------------------------------------------------------- */
/*  Tests                                                                */
/* --------------------------------------------------------------------- */

describe("plan-file-fetch — Phase 24 SFTP side-channel + path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ---------------- Happy path ---------------- */

  it("happy path returns file contents when slug matches regex + file exists", async () => {
    const content = "# Plan\n\nStep 1: do the thing";
    const sftp = makeMockSftp({
      "/home/ashley/.claude/plans/groovy-watching-leaf.md": content,
    });
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/groovy-watching-leaf.md",
    );
    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.content).toBe(content);
    }
  });

  /* --------------- Rejection cases (T-24-02 fail-closed) --------------- */

  it("rejects `..` in path without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/../../../etc/passwd.md",
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid plan path");
    expectNoSftpContact(client, sftp);
  });

  it("rejects backtick in slug without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/`whoami`.md",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects single quote in slug without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/foo'bar.md",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects double quote in slug without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      '~/.claude/plans/foo"bar.md',
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects dollar sign in slug without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/$USER.md",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects uppercase slug without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/FooBar.md",
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid plan path");
    expectNoSftpContact(client, sftp);
  });

  it("rejects absolute path outside plans dir without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "/etc/passwd",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects missing .md extension without touching SFTP", async () => {
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/foo",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  it("rejects slug containing a slash without touching SFTP", async () => {
    // Even without `..`, a slash inside the slug region should fail the
    // `^[a-z0-9-]+$` regex.
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/foo/bar.md",
    );
    expect("error" in result).toBe(true);
    expectNoSftpContact(client, sftp);
  });

  /* ---------------- Truncation ---------------- */

  it("truncates content larger than MAX_PLAN_BYTES with a [truncated] suffix", async () => {
    // 600KB payload: bigger than the 500KB cap.
    const big = Buffer.alloc(600 * 1024, "a".charCodeAt(0));
    const sftp = makeMockSftp({
      "/home/ashley/.claude/plans/big-plan.md": big,
    });
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/big-plan.md",
    );
    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.content.endsWith("[truncated]")).toBe(true);
      // Body is exactly MAX_PLAN_BYTES bytes; add "\n\n[truncated]" (13 chars,
      // all single-byte in utf8 → 13 bytes). Cap total length at
      // MAX_PLAN_BYTES + suffix length.
      const suffixLen = "\n\n[truncated]".length;
      expect(result.content.length).toBeLessThanOrEqual(
        MAX_PLAN_BYTES + suffixLen,
      );
      // And confirm the body prefix is preserved (first byte should still be 'a').
      expect(result.content[0]).toBe("a");
    }
  });

  /* ---------------- SFTP error propagation ---------------- */

  it("propagates SFTP readFile error as { error }", async () => {
    // Empty plans map → stat/readFile for a valid slug will ENOENT.
    const sftp = makeMockSftp();
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/never-existed.md",
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      // The propagated string should include the underlying SFTP message.
      expect(result.error).toMatch(/ENOENT/);
    }
    // Sanity: the pre-check let us THROUGH to SFTP contact (this is a valid
    // slug), so `.sftp()` and `.realpath` and `.stat` SHOULD have been called.
    expect(client.sftp).toHaveBeenCalled();
    expect(sftp.realpath).toHaveBeenCalled();
    expect(sftp.stat).toHaveBeenCalled();
  });

  /* ---------------- Home-directory resolution ---------------- */

  it("home directory resolution success builds absPath from resolvedHome + /.claude/plans/", async () => {
    // realpath(".") resolves to "/home/ashley"; store a plan there and
    // verify the fetch reads from that exact absolute path.
    const content = "# twinkling plan";
    const sftp = makeMockSftp(
      { "/home/ashley/.claude/plans/twinkling-strolling-eclipse.md": content },
      "/home/ashley",
    );
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/twinkling-strolling-eclipse.md",
    );
    expect("content" in result).toBe(true);
    if ("content" in result) expect(result.content).toBe(content);
    // Assert stat/readFile were called with the fully-resolved absolute path.
    const statCalls = sftp.stat.mock.calls.map((c) => c[0]);
    const readCalls = sftp.readFile.mock.calls.map((c) => c[0]);
    expect(statCalls).toContain(
      "/home/ashley/.claude/plans/twinkling-strolling-eclipse.md",
    );
    expect(readCalls).toContain(
      "/home/ashley/.claude/plans/twinkling-strolling-eclipse.md",
    );
  });

  it("home directory resolution with a non-standard $HOME builds absPath from that home", async () => {
    // Prove the path is computed from the resolved home, not hardcoded.
    const content = "# custom home plan";
    const sftp = makeMockSftp(
      { "/srv/agents/ashley/.claude/plans/custom-slug.md": content },
      "/srv/agents/ashley",
    );
    const client = makeMockSshClient(sftp);
    const result = await fetchPlanFile(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      "~/.claude/plans/custom-slug.md",
    );
    expect("content" in result).toBe(true);
    if ("content" in result) expect(result.content).toBe(content);
  });
});
