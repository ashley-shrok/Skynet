/**
 * fileLeafFromDescriptor — the file bar's cross-window drag descriptor.
 */

import { describe, it, expect } from "vitest";
import { fileLeafFromDescriptor } from "./cross-window-drag";

describe("fileLeafFromDescriptor", () => {
  it("reads a well-formed file descriptor", () => {
    expect(
      fileLeafFromDescriptor({
        tabType: "file",
        file: { host: "Skynet", path: "/home/u/a.md", origin: "tmux:Skynet:x" },
        label: "a.md",
      }),
    ).toEqual({ host: "Skynet", path: "/home/u/a.md", origin: "tmux:Skynet:x", label: "a.md" });
  });

  it("falls back to the file name and drops a bad origin", () => {
    expect(
      fileLeafFromDescriptor({ tabType: "file", file: { host: "S", path: "/x/y.pdf", origin: 3 }, label: " " }),
    ).toEqual({ host: "S", path: "/x/y.pdf", origin: null, label: "y.pdf" });
  });

  it("rejects other pane types and malformed addresses", () => {
    expect(fileLeafFromDescriptor({ tabType: "app", file: { host: "S", path: "/x" } })).toBeNull();
    expect(fileLeafFromDescriptor({ tabType: "file", file: { host: "S", path: "x" } })).toBeNull();
    expect(fileLeafFromDescriptor({ tabType: "file", file: { host: "a b", path: "/x" } })).toBeNull();
    expect(fileLeafFromDescriptor({ tabType: "file" })).toBeNull();
    expect(fileLeafFromDescriptor(null)).toBeNull();
  });
});
