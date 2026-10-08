import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  SCAN_CMD,
  attachmentFilenameError,
  attachmentReadCmd,
  buildResponse,
  parseEnvelope,
  parseScanOutput,
} from "./protocol.js";

const UUID = "0b5c2f9e-1a2b-4c3d-8e9f-001122334455";
const UUID2 = "7d1e2f3a-4b5c-4d6e-9f00-aabbccddeeff";

describe("parseEnvelope", () => {
  const base = {
    service: "agent-phone",
    requested_at: "2026-10-08T00:00:00Z",
    input: { a: 1 },
  };

  it("accepts a minimal envelope", () => {
    const r = parseEnvelope(JSON.stringify(base));
    expect(r).toEqual({ ok: true, envelope: { ...base, attachments: {} } });
  });

  it("accepts pretty-printed JSON", () => {
    expect(parseEnvelope(JSON.stringify(base, null, 2)).ok).toBe(true);
  });

  it("accepts attachments", () => {
    const r = parseEnvelope(
      JSON.stringify({ ...base, attachments: { ref: `${UUID}.in.ref.png` } }),
    );
    expect(r.ok === true && r.envelope.attachments).toEqual({
      ref: `${UUID}.in.ref.png`,
    });
  });

  it.each([
    ["not json", "{", /invalid JSON/],
    ["array", "[]", /JSON object/],
    [
      "unknown key",
      JSON.stringify({ ...base, extra: 1 }),
      /unrecognized envelope field: extra/,
    ],
    [
      "bad service",
      JSON.stringify({ ...base, service: "Bad Name" }),
      /service/,
    ],
    [
      "missing requested_at",
      JSON.stringify({ ...base, requested_at: undefined }),
      /requested_at/,
    ],
    [
      "bad requested_at",
      JSON.stringify({ ...base, requested_at: "yesterday" }),
      /requested_at/,
    ],
    [
      "missing input",
      JSON.stringify({ service: "x", requested_at: base.requested_at }),
      /input/,
    ],
    [
      "bad slot",
      JSON.stringify({ ...base, attachments: { "Bad Slot": "f" } }),
      /slot/,
    ],
  ])("rejects %s", (_name, body, message) => {
    const r = parseEnvelope(body);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(message);
  });

  it("keeps the service name on failure so the response can carry it", () => {
    const r = parseEnvelope(JSON.stringify({ ...base, extra: 1 }));
    expect(r.ok === false && r.service).toBe("agent-phone");
  });
});

describe("attachmentFilenameError", () => {
  const exts = ["png", "jpg"];
  it("accepts the canonical name", () => {
    expect(
      attachmentFilenameError(UUID, "ref", `${UUID}.in.ref.png`, exts),
    ).toBeNull();
  });
  it("rejects another request's attachment", () => {
    expect(
      attachmentFilenameError(UUID, "ref", `${UUID2}.in.ref.png`, exts),
    ).toMatch(/must be named/);
  });
  it("rejects a disallowed extension", () => {
    expect(
      attachmentFilenameError(UUID, "ref", `${UUID}.in.ref.gif`, exts),
    ).toMatch(/one of/);
  });
  it("rejects path tricks", () => {
    expect(
      attachmentFilenameError(UUID, "ref", `${UUID}.in.ref.png/../x`, exts),
    ).not.toBeNull();
    expect(
      attachmentFilenameError(UUID, "ref", `../${UUID}.in.ref.png`, exts),
    ).not.toBeNull();
  });
});

describe("buildResponse", () => {
  it("builds a success with files", () => {
    expect(buildResponse("s", { ok: true, result: { x: 1 } }, ["f"])).toEqual({
      ok: true,
      service: "s",
      result: { x: 1 },
      files: ["f"],
    });
  });
  it("merges details into the error without letting them override the code", () => {
    expect(
      buildResponse("s", {
        ok: false,
        code: "busy",
        message: "m",
        details: { seconds: 3, code: "x" },
      }),
    ).toEqual({
      ok: false,
      service: "s",
      error: { code: "busy", message: "m", seconds: 3 },
    });
  });
});

describe("SCAN_CMD against a real folder", () => {
  let home: string;
  let dir: string;
  const run = () =>
    execFileSync("bash", ["-c", SCAN_CMD], {
      env: { ...process.env, HOME: home },
    }).toString();

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-services-scan-"));
    dir = path.join(home, "fleet", "service-requests");
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it("is a no-op when the folder does not exist", () => {
    fs.rmSync(dir, { recursive: true });
    expect(run()).toBe("");
  });

  it("claims envelopes, leaves .claimed.json, and skips every other wire file", () => {
    const body = '{\n  "service": "x",\n  "input": "tab\there"\n}';
    fs.writeFileSync(path.join(dir, `${UUID}.json`), body);
    for (const other of [
      `${UUID2}.claimed.json`,
      `${UUID2}.response.json`,
      `${UUID2}.in.ref.png`,
      `${UUID2}.json.tmp.123`,
    ]) {
      fs.writeFileSync(path.join(dir, other), "x");
    }

    const claimed = parseScanOutput(run());
    expect(claimed).toEqual([{ uuid: UUID, body }]);
    expect(fs.existsSync(path.join(dir, `${UUID}.json`))).toBe(false);
    expect(
      fs.readFileSync(path.join(dir, `${UUID}.claimed.json`), "utf-8"),
    ).toBe(body);
    expect(parseScanOutput(run())).toEqual([]);
  });

  it("deletes wire files older than a day but not fresh ones or foreign files", () => {
    const old = path.join(dir, `${UUID}.response.json`);
    const fresh = path.join(dir, `${UUID2}.response.json`);
    const foreign = path.join(dir, "notes.txt");
    for (const f of [old, fresh, foreign]) fs.writeFileSync(f, "x");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(foreign, twoDaysAgo, twoDaysAgo);

    run();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it("attachmentReadCmd reads at most maxBytes + 1", () => {
    fs.writeFileSync(
      path.join(dir, `${UUID}.in.ref.png`),
      Buffer.alloc(100, 7),
    );
    const out = execFileSync(
      "bash",
      ["-c", attachmentReadCmd(`${UUID}.in.ref.png`, 10)],
      {
        env: { ...process.env, HOME: home },
      },
    ).toString();
    expect(Buffer.from(out, "base64").byteLength).toBe(11);
  });
});
