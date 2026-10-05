import { describe, it, expect } from "vitest";
import {
  AUDIO_ENTRY,
  BINARY_ENTRY,
  DELIMITED_ENTRY,
  DOCX_ENTRY,
  DIFF_ENTRY,
  IMAGE_ENTRY,
  LEGACY_SHEET_ENTRY,
  LEGACY_WORD_ENTRY,
  MODEL_3D_ENTRY,
  PDF_ENTRY,
  PRESENTATION_ENTRY,
  XLSX_ENTRY,
  SVG_ENTRY,
  TEXT_ENTRY,
  VIDEO_ENTRY,
  extensionOf,
  isTextByName,
  mimeFor,
  resolveFileViewer,
  resolveMode,
} from "./registry";

describe("extensionOf", () => {
  it.each([
    ["photo.PNG", "png"],
    ["dir.v2/archive.tar.gz", "gz"],
    [".gitignore", null],
    ["Makefile", null],
    ["trailing.", null],
  ])("%s → %s", (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});

describe("resolveFileViewer", () => {
  it.each([
    ["a.png", IMAGE_ENTRY],
    ["a.svg", SVG_ENTRY],
    ["a.mp3", AUDIO_ENTRY],
    ["a.webm", VIDEO_ENTRY],
    ["a.patch", DIFF_ENTRY],
    ["a.DIFF", DIFF_ENTRY],
    ["a.csv", DELIMITED_ENTRY],
    ["a.TSV", DELIMITED_ENTRY],
    ["a.psv", DELIMITED_ENTRY],
    ["a.zip", BINARY_ENTRY],
    ["a.pdf", PDF_ENTRY],
    ["a.docx", DOCX_ENTRY],
    ["a.doc", LEGACY_WORD_ENTRY],
    ["a.ODT", LEGACY_WORD_ENTRY],
    ["a.xlsx", XLSX_ENTRY],
    ["a.XLSM", XLSX_ENTRY],
    ["a.xls", LEGACY_SHEET_ENTRY],
    ["a.ods", LEGACY_SHEET_ENTRY],
    ["a.ppt", PRESENTATION_ENTRY],
    ["a.pptx", PRESENTATION_ENTRY],
    ["a.odp", PRESENTATION_ENTRY],
    ["a.epub", BINARY_ENTRY],
    ["a.glb", MODEL_3D_ENTRY],
    ["part.STEP", MODEL_3D_ENTRY],
    ["mesh.stl", MODEL_3D_ENTRY],
    ["scan.obj", MODEL_3D_ENTRY],
    ["building.ifc", MODEL_3D_ENTRY],
    ["a.ts", TEXT_ENTRY],
    ["a.unknownext", TEXT_ENTRY],
    ["Dockerfile", TEXT_ENTRY],
  ])("%s", (name, entry) => {
    expect(resolveFileViewer(name)).toBe(entry);
  });
});

describe("resolveMode", () => {
  it("defaults to the first mode and falls back on unknown ids", () => {
    expect(resolveMode(SVG_ENTRY).id).toBe("rendered");
    expect(resolveMode(SVG_ENTRY, "source").id).toBe("source");
    expect(resolveMode(SVG_ENTRY, "nope").id).toBe("rendered");
  });
});

describe("mimeFor / isTextByName", () => {
  it("knows media MIME types", () => {
    expect(mimeFor(SVG_ENTRY, "x.svg")).toBe("image/svg+xml");
    expect(mimeFor(TEXT_ENTRY, "x.txt")).toBe("");
  });

  it("recognises text by extension or conventional basename", () => {
    expect(isTextByName("notes.md")).toBe(true);
    expect(isTextByName("sub/dir/Dockerfile")).toBe(true);
    expect(isTextByName("x.weird")).toBe(false);
  });
});
