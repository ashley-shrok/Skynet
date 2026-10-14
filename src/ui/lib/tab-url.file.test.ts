/**
 * tab-url — the file-leaf variant (`file:<base64url JSON [host, path, origin?]>`).
 */

import { describe, it, expect } from "vitest";
import {
  encodeTabSpec,
  encodeWorkspaceSpec,
  parseTabParam,
  specForTab,
  type TabSpec,
} from "./tab-url";
import { decodeSplitTreeFromUrl, encodeSplitTreeToUrl } from "./split-tree-url";
import type { SplitNode } from "./split-tree";

describe("file TabSpec", () => {
  it("round-trips host, path with ':' and spaces, and origin", () => {
    const spec: TabSpec = {
      protocol: "file",
      fileHost: "Skynet",
      path: "/home/ubuntu/a: b/notes v2.md",
      origin: "tmux:Skynet:sahara-box-maintainer-3",
    };
    const wire = encodeTabSpec(spec);
    expect(wire).toMatch(/^file:[A-Za-z0-9_-]+$/);
    expect(parseTabParam(wire)).toEqual(spec);
  });

  it("round-trips the longest valid address, multi-byte path and origin included", () => {
    const spec: TabSpec = {
      protocol: "file",
      fileHost: "Skynet",
      path: "/" + "文".repeat(4095),
      origin: "tmux:Skynet:" + "s".repeat(1012),
    };
    expect(parseTabParam(encodeTabSpec(spec))).toEqual(spec);
  });

  it("round-trips without an origin", () => {
    const spec: TabSpec = { protocol: "file", fileHost: "box", path: "/x.pdf" };
    expect(parseTabParam(encodeTabSpec(spec))).toEqual(spec);
  });

  it("keeps a relay origin but drops one that isn't a conversation", () => {
    const relay = encodeTabSpec({ protocol: "file", fileHost: "b", path: "/x", origin: "relay:!room:hs" });
    expect(parseTabParam(relay)).toMatchObject({ origin: "relay:!room:hs" });
    const bogus = encodeTabSpec({ protocol: "file", fileHost: "b", path: "/x", origin: "app:3:demo" });
    expect(parseTabParam(bogus)).toEqual({ protocol: "file", fileHost: "b", path: "/x" });
    const junk = encodeTabSpec({ protocol: "file", fileHost: "b", path: "/x", origin: "not a spec" });
    expect(parseTabParam(junk)).toEqual({ protocol: "file", fileHost: "b", path: "/x" });
  });

  it("drops malformed file specs", () => {
    const b64 = (v: unknown) =>
      btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parseTabParam("file:")).toBeNull();
    expect(parseTabParam("file:not base64!")).toBeNull();
    expect(parseTabParam(`file:${b64("just a string")}`)).toBeNull();
    expect(parseTabParam(`file:${b64(["Skynet"])}`)).toBeNull();
    expect(parseTabParam(`file:${b64(["Skynet", "relative.md"])}`)).toBeNull();
    expect(parseTabParam(`file:${b64(["bad host", "/x"])}`)).toBeNull();
    expect(parseTabParam(`file:${b64(["a", "/b", "c", "d"])}`)).toBeNull();
    expect(parseTabParam(`file:${b64({ host: "a", path: "/b" })}`)).toBeNull();
  });

  it("specForTab maps a file tab, with and without origin", () => {
    expect(specForTab({ type: "file", file: { host: "Skynet", path: "/a.md", origin: "tmux:S:x" } })).toEqual({
      protocol: "file",
      fileHost: "Skynet",
      path: "/a.md",
      origin: "tmux:S:x",
    });
    expect(specForTab({ type: "file", file: { host: "Skynet", path: "/a.md", origin: null } })).toEqual({
      protocol: "file",
      fileHost: "Skynet",
      path: "/a.md",
    });
    expect(specForTab({ type: "file" })).toBeNull();
  });

  it("survives the split-tree URL round trip next to a conversation", () => {
    const tree: SplitNode = {
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "session", tabId: "conv" },
        { kind: "session", tabId: "file" },
      ],
    } as SplitNode;
    const specs: Record<string, TabSpec> = {
      conv: { protocol: "tmux", host: "Skynet", session: "sahara" },
      file: { protocol: "file", fileHost: "Skynet", path: "/home/u/x.md", origin: "tmux:Skynet:sahara" },
    };
    // The real trip: the tree fragment is spliced into the workspace
    // fragment (re-parsed once) and read back the way consumePendingWorkspace
    // does — a path with ':' / '%' / spaces must survive it.
    specs.file = {
      protocol: "file",
      fileHost: "Skynet",
      path: "/home/u/50% done: v2/x y.md",
      origin: "tmux:Skynet:sahara",
    };
    const encoded = encodeSplitTreeToUrl(tree, (id) => specs[id] ?? null);
    const fragment = encodeWorkspaceSpec({ tabs: [specs.conv, specs.file], splitTree: encoded });
    const params = new URLSearchParams(fragment);
    const roundTripped = new URLSearchParams({ s: params.get("s")!, t: params.get("t")! }).toString();
    const seen: TabSpec[] = [];
    const decoded = decodeSplitTreeFromUrl(roundTripped, (spec) => {
      seen.push(spec);
      return spec.protocol === "file" ? "file-restored" : "conv-restored";
    });
    expect(decoded).not.toBeNull();
    expect(JSON.stringify(decoded)).toContain("file-restored");
    expect(JSON.stringify(decoded)).toContain("conv-restored");
    expect(seen).toContainEqual(specs.file);
    expect(params.getAll("tab").map(parseTabParam)).toContainEqual(specs.file);
  });
});
