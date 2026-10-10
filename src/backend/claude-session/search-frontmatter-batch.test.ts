/**
 * search-frontmatter-batch — one exec per batch, archive-folder routing,
 * live-then-archive role fallback. The shell script itself is exercised
 * against a real temp $HOME (it's plain sh + awk).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { execCommandMock } = vi.hoisted(() => ({ execCommandMock: vi.fn() }));
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: (conn: unknown, cmd: string) => execCommandMock(conn, cmd),
}));

import {
  readIdentityFrontmattersBatch,
  readRoleFrontmattersBatch,
} from "./search-frontmatter-batch.js";

let home: string;
const write = (rel: string, body: string) => {
  const f = path.join(home, "fleet", rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "fm-batch-"));
  write("identities/muffin/muffin.md", "---\nrole: baker\ntask: Live task\n---\n\n# body mentions --- nothing\n");
  write("identities-archive/scone/scone.md", "---\nrole: baker\ntask: Archived task\n---\nbody\n");
  write("roles/baker/baker.md", "---\ncolorHue: '324'\n---\n# baker\n");
  write("roles-archive/oldrole/oldrole.md", "---\ncolorHue: 98\n---\n");
  execCommandMock.mockImplementation(async (_conn: unknown, cmd: string) =>
    execFileSync("sh", ["-c", cmd], { env: { ...process.env, HOME: home } }).toString().trim(),
  );
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("readIdentityFrontmattersBatch", () => {
  it("reads live and archived keys in ONE exec, frontmatter only; missing/invalid keys map to empty", async () => {
    execCommandMock.mockClear();
    const out = await readIdentityFrontmattersBatch(
      {} as never,
      ["muffin", "scone", "ghost", "../etc"],
      new Set(["scone"]),
    );
    expect(execCommandMock).toHaveBeenCalledTimes(1);
    // execCommand trims stdout, so the final record may lose its newline —
    // irrelevant to the frontmatter parsers; compare trimmed.
    expect(out.get("muffin")?.trimEnd()).toBe("---\nrole: baker\ntask: Live task\n---");
    expect(out.get("scone")?.trimEnd()).toBe("---\nrole: baker\ntask: Archived task\n---");
    expect(out.get("ghost")).toBe("");
    expect(out.has("../etc")).toBe(false);
  });

  it("propagates exec failure so the caller can fail closed", async () => {
    execCommandMock.mockRejectedValueOnce(new Error("Channel open failure"));
    await expect(
      readIdentityFrontmattersBatch({} as never, ["muffin"], new Set()),
    ).rejects.toThrow("Channel open failure");
  });
});

describe("readRoleFrontmattersBatch", () => {
  it("prefers the live role, falls back to the archive, empty when neither", async () => {
    const out = await readRoleFrontmattersBatch({} as never, ["baker", "oldrole", "nope"]);
    expect(out.get("baker")?.archived).toBe(false);
    expect(out.get("baker")?.markdown.trimEnd()).toBe("---\ncolorHue: '324'\n---");
    expect(out.get("oldrole")?.archived).toBe(true);
    expect(out.get("oldrole")?.markdown.trimEnd()).toBe("---\ncolorHue: 98\n---");
    expect(out.get("nope")).toEqual({ markdown: "", archived: true });
  });
});
