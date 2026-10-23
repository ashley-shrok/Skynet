/**
 * tab-url — the desktop-leaf variant (`desktop:<hostId>:<identity>`).
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

describe("desktop TabSpec", () => {
  it("round-trips host id and identity", () => {
    const spec: TabSpec = { protocol: "desktop", hostId: "7", identityKey: "sahara-box_2" };
    const wire = encodeTabSpec(spec);
    expect(wire).toBe("desktop:7:sahara-box_2");
    expect(parseTabParam(wire)).toEqual(spec);
  });

  it.each([
    "desktop:7",
    "desktop::sahara",
    "desktop:0:sahara",
    "desktop:abc:sahara",
    "desktop:7:Sahara",
    "desktop:7:sa hara",
    "desktop:7:a:b",
    "desktop:7:" + "a".repeat(65),
  ])("drops malformed %s", (wire) => {
    expect(parseTabParam(wire)).toBeNull();
  });

  it("specForTab builds it from a desktop tab, and only with its address", () => {
    expect(
      specForTab({ type: "desktop", desktop: { hostId: 7, identityKey: "sahara" } }),
    ).toEqual({ protocol: "desktop", hostId: "7", identityKey: "sahara" });
    expect(specForTab({ type: "desktop" })).toBeNull();
  });

  it("survives the split-tree URL round trip next to a conversation", () => {
    const tree: SplitNode = {
      kind: "split",
      direction: "vertical",
      children: [
        { kind: "session", tabId: "conv" },
        { kind: "session", tabId: "desk" },
      ],
    } as SplitNode;
    const specs: Record<string, TabSpec> = {
      conv: { protocol: "tmux", host: "Skynet", session: "sahara" },
      desk: { protocol: "desktop", hostId: "7", identityKey: "sahara" },
    };
    const encoded = encodeSplitTreeToUrl(tree, (id) => specs[id] ?? null);
    const fragment = encodeWorkspaceSpec({ tabs: [specs.conv, specs.desk], splitTree: encoded });
    const params = new URLSearchParams(fragment);
    const roundTripped = new URLSearchParams({ s: params.get("s")!, t: params.get("t")! }).toString();
    const seen: TabSpec[] = [];
    const decoded = decodeSplitTreeFromUrl(roundTripped, (spec) => {
      seen.push(spec);
      return spec.protocol === "desktop" ? "desk-restored" : "conv-restored";
    });
    expect(JSON.stringify(decoded)).toContain("desk-restored");
    expect(JSON.stringify(decoded)).toContain("conv-restored");
    expect(seen).toContainEqual(specs.desk);
    expect(params.getAll("tab").map(parseTabParam)).toContainEqual(specs.desk);
  });
});
