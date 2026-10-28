// The host-side hidden-image filter: blanks tool-result image data (the
// agent's own looks at pictures) and nothing else, keeps every line, and
// leaves what the parser makes of each line unchanged. The sed script runs
// through a real shell here, the way a host runs it.

import { describe, it, expect, vi } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mirrors execCommand: trimmed stdout; rejects on non-zero exit with no stdout.
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(async (_conn: unknown, cmd: string) => {
    const { spawnSync } = await import("child_process");
    const r = spawnSync("/bin/sh", ["-c", cmd], { stdio: ["ignore", "pipe", "ignore"] });
    const out = r.stdout.toString("utf-8");
    if (r.status !== 0 && out === "") throw new Error(`Command exited with code ${r.status}`);
    return out.trim();
  }),
}));

import { HIDDEN_IMAGE_FILTER, HIDDEN_IMAGE_FILTER_SED, HIDDEN_IMAGE_MIN_BASE64, blankHiddenImages } from "./hidden-image-filter.js";
import { parseSessionLineQuietly } from "./session-file-parser.js";
import { readSessionFileRange } from "./session-file-range-reader.js";

const TS = "2026-10-28T00:00:00Z";
const B64 = "iVBORw0KGgo" + "A".repeat(4000) + "+/9=";

const readImage = JSON.stringify({
  type: "user",
  uuid: "r1",
  timestamp: TS,
  message: {
    role: "user",
    content: [
      { tool_use_id: "toolu_r1", type: "tool_result", content: [{ type: "image", source: { type: "base64", data: B64, media_type: "image/png" } }] },
    ],
  },
  toolUseResult: { type: "image", file: { base64: B64, type: "image/png", originalSize: 12345 } },
});
const apiBlob = JSON.stringify({
  type: "api-request-blob",
  body: { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_r1", content: [{ type: "image", source: { type: "base64", data: B64 } }] }] }] },
});
const pasted = JSON.stringify({
  type: "user",
  uuid: "p1",
  timestamp: TS,
  message: { role: "user", content: [{ type: "text", text: "look at this" }, { type: "image", source: { type: "base64", data: B64, media_type: "image/png" } }] },
});
const shortData = JSON.stringify({
  type: "user",
  uuid: "s1",
  timestamp: TS,
  message: { role: "user", content: [{ tool_use_id: "toolu_s1", type: "tool_result", content: "ok" }] },
  toolUseResult: { data: "c2hvcnQ=" },
});
const reply = JSON.stringify({ type: "assistant", uuid: "a1", timestamp: TS, message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
const fixtures = [readImage, apiBlob, pasted, shortData, reply];

function viaSed(lines: string[], filter = HIDDEN_IMAGE_FILTER): string[] {
  const dir = mkdtempSync(join(tmpdir(), "hidden-img-"));
  const f = join(dir, "s.jsonl");
  writeFileSync(f, lines.join("\n") + "\n");
  const out = execSync(`cat '${f}' | ${filter}`, { shell: "/bin/sh" }).toString("utf-8");
  return out.replace(/\n$/, "").split("\n");
}

describe("hidden-image filter", () => {
  it("blanks the agent's own image looks, keeps pasted images and every line", () => {
    const out = viaSed(fixtures);
    expect(out).toHaveLength(fixtures.length);
    expect(out[0]).not.toContain(B64);
    expect(JSON.parse(out[0]!).message.content[0].content[0].source.data).toBe("");
    expect(JSON.parse(out[0]!).toolUseResult.file).toEqual({ base64: "", type: "image/png", originalSize: 12345 });
    expect(out[1]).not.toContain(B64);
    expect(out[2]).toBe(pasted);
    expect(out[3]).toBe(shortData);
    expect(out[4]).toBe(reply);
    expect(out[0]!.length + out[1]!.length).toBeLessThan(1000);
  });

  it("perl, the sed fallback and the JS twin agree byte for byte", () => {
    expect(execSync("command -v perl", { shell: "/bin/sh" }).toString()).toMatch(/perl/);
    const js = fixtures.map(blankHiddenImages);
    expect(viaSed(fixtures)).toEqual(js);
    expect(viaSed(fixtures, HIDDEN_IMAGE_FILTER_SED)).toEqual(js);
  });

  it("the threshold stays inside every regex engine's repeat limit, and is exact", () => {
    // POSIX RE_DUP_MAX: musl, BSD and macOS reject repeat counts above 255.
    expect(HIDDEN_IMAGE_MIN_BASE64).toBeLessThanOrEqual(255);
    const at = (n: number) =>
      JSON.stringify({ type: "user", message: { content: [{ tool_use_id: "toolu_t", type: "tool_result" }] }, toolUseResult: { data: "A".repeat(n) } });
    const lines = [at(HIDDEN_IMAGE_MIN_BASE64), at(HIDDEN_IMAGE_MIN_BASE64 - 1)];
    const expected = [lines[0]!.replace(/"data":"A+"/, '"data":""'), lines[1]!];
    expect(lines.map(blankHiddenImages)).toEqual(expected);
    expect(viaSed(lines)).toEqual(expected);
    expect(viaSed(lines, HIDDEN_IMAGE_FILTER_SED)).toEqual(expected);
  });

  it("falls back to sed on a host without perl", () => {
    const dir = mkdtempSync(join(tmpdir(), "hidden-img-noperl-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, fixtures.join("\n") + "\n");
    // PATH holding only sed: `command -v perl` fails, the else branch runs.
    const sed = execSync("command -v sed", { shell: "/bin/sh" }).toString().trim();
    const bin = mkdtempSync(join(tmpdir(), "hidden-img-bin-"));
    execSync(`ln -s '${sed}' '${bin}/sed'`);
    const out = execSync(`${HIDDEN_IMAGE_FILTER} < '${f}'`, { shell: "/bin/sh", env: { PATH: bin } }).toString("utf-8");
    expect(out.replace(/\n$/, "").split("\n")).toEqual(fixtures.map(blankHiddenImages));
  });

  it("the parser makes the same of every line before and after", () => {
    const strip = (p: ReturnType<typeof parseSessionLineQuietly>) =>
      JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    const after = viaSed(fixtures);
    fixtures.forEach((line, i) => {
      const a = strip(parseSessionLineQuietly(line, "sess"));
      const b = strip(parseSessionLineQuietly(after[i]!, "sess"));
      expect(b.kind).toBe(a.kind);
      if (a.kind !== "skip" || line === pasted) expect(b).toEqual(a);
    });
    expect(parseSessionLineQuietly(readImage, "sess")).toMatchObject({ kind: "skip" });
    expect(parseSessionLineQuietly(after[2]!, "sess")).toMatchObject({ kind: "image" });
  });

  it("load-older range reads come back filtered from a host, with the right total", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hidden-img-range-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, fixtures.join("\n") + "\n");
    const conn = {} as unknown as import("ssh2").Client;
    const r = await readSessionFileRange(conn, f, 1, 3);
    expect(r.totalLines).toBe(5);
    expect(r.lines).toEqual([blankHiddenImages(readImage), blankHiddenImages(apiBlob), pasted]);
  });

  it("a missing file fails before the sentinel, as it did before the filter joined the pipe", async () => {
    const conn = {} as unknown as import("ssh2").Client;
    await expect(readSessionFileRange(conn, "/nonexistent/x.jsonl", 1, 3)).rejects.toThrow(/exited with code/);
  });

  it("local reads are filtered the same way", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hidden-img-local-"));
    const f = join(dir, "s.jsonl");
    writeFileSync(f, fixtures.join("\n") + "\n");
    const r = await readSessionFileRange(null, f, 1, 5);
    expect(r.lines).toEqual(fixtures.map(blankHiddenImages));
  });
});
