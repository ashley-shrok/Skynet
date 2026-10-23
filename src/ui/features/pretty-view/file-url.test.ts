/**
 * file-url — Skynet file URL helpers + the FileChip drag payload.
 */

import { describe, it, expect } from "vitest";
import {
  buildSkynetFileUrl,
  fileNameOfPath,
  isValidFileAddress,
  parseFileChipPayload,
  parseSkynetFileUrl,
} from "./file-url";

const origin = window.location.origin;

describe("parseSkynetFileUrl", () => {
  it("splits a same-origin file URL into host + decoded absolute path", () => {
    expect(parseSkynetFileUrl(`${origin}/file/Skynet/home/ubuntu/notes/plan%20v2.md`)).toEqual({
      host: "Skynet",
      path: "/home/ubuntu/notes/plan v2.md",
    });
  });

  it("round-trips buildSkynetFileUrl, including reserved characters", () => {
    const path = "/srv/data/a ?b#c%d/ünï.csv";
    expect(parseSkynetFileUrl(buildSkynetFileUrl("box-1", path))).toEqual({ host: "box-1", path });
  });

  it("rejects other origins, missing paths and malformed escapes", () => {
    expect(parseSkynetFileUrl("https://attacker.tld/file/Skynet/etc/x.png")).toBeNull();
    expect(parseSkynetFileUrl(`${origin}/file/Skynet`)).toBeNull();
    expect(parseSkynetFileUrl(`${origin}/file/Skynet/bad%ZZ.md`)).toBeNull();
    expect(parseSkynetFileUrl(`${origin}/file/bad host/x.md`)).toBeNull();
  });
});

describe("isValidFileAddress", () => {
  it("needs a plain host segment and an absolute path", () => {
    expect(isValidFileAddress("Skynet", "/a.md")).toBe(true);
    expect(isValidFileAddress("", "/a.md")).toBe(false);
    expect(isValidFileAddress("a/b", "/a.md")).toBe(false);
    expect(isValidFileAddress("Skynet", "a.md")).toBe(false);
    expect(isValidFileAddress("Skynet", "/" + "x".repeat(5000))).toBe(false);
    expect(isValidFileAddress(7, "/a.md")).toBe(false);
  });
});

describe("path helpers", () => {
  it("names the file", () => {
    expect(fileNameOfPath("/home/ubuntu/report.pdf")).toBe("report.pdf");
  });
});

describe("parseFileChipPayload", () => {
  it("accepts a well-formed payload and keeps the origin", () => {
    const json = JSON.stringify({
      host: "Skynet",
      path: "/home/ubuntu/a.md",
      filename: "a.md",
      origin: "tmux:Skynet:sahara",
    });
    expect(parseFileChipPayload(json)).toEqual({
      host: "Skynet",
      path: "/home/ubuntu/a.md",
      filename: "a.md",
      origin: "tmux:Skynet:sahara",
    });
  });

  it("falls back to the path's file name and drops a bad origin", () => {
    const json = JSON.stringify({ host: "Skynet", path: "/x/y.csv", filename: "  ", origin: 5 });
    expect(parseFileChipPayload(json)).toEqual({
      host: "Skynet",
      path: "/x/y.csv",
      filename: "y.csv",
      origin: null,
    });
  });

  it("rejects malformed JSON and bad addresses", () => {
    expect(parseFileChipPayload("")).toBeNull();
    expect(parseFileChipPayload("{nope")).toBeNull();
    expect(parseFileChipPayload(JSON.stringify({ host: "Skynet", path: "rel.md" }))).toBeNull();
    expect(parseFileChipPayload(JSON.stringify(["Skynet", "/a"]))).toBeNull();
  });
});
