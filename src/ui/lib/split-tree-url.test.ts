// Phase 56 Plan 01 Task 2 — vitest suite for split-tree-url.ts.
//
// Behaviour spec is the plan file's Task 2 `<behavior>` block; every test
// below cites its plan-item number. See:
//   .planning/phases/56-visual-session-management-foundation-recursive-split-tree-da/56-01-PLAN.md
//
// The codec round-trips SplitNode ↔ URL fragment via a session-address
// alphabet (host + tmux-session pair) so the URL layer stays decoupled from
// ephemeral tabId values that regenerate every page load. Grammar is
// documented at the top of split-tree-url.ts.

import { describe, it, expect } from "vitest";
import type { TabSpec } from "./tab-url";
import {
  encodeSplitTreeToUrl,
  decodeSplitTreeFromUrl,
} from "./split-tree-url";
import {
  type SplitNode,
  type DropEdge,
  insertAtEdge,
  findLeaf,
  collectTabIds,
} from "./split-tree";

// ─── shared fixtures ──────────────────────────────────────────────────────

/** Synthetic tab table. Maps each ephemeral tabId → durable TabSpec (the
 *  addressing alphabet — matches src/ui/lib/tab-url.ts's spec shape). */
type Fixture = {
  address: (tabId: string) => TabSpec | null;
  resolve: (spec: TabSpec) => string | null;
};

function makeFixture(rows: ReadonlyArray<[string, TabSpec]>): Fixture {
  const tabIdToSpec = new Map<string, TabSpec>();
  const specKeyToTabId = new Map<string, string>();
  for (const [tabId, spec] of rows) {
    tabIdToSpec.set(tabId, spec);
    specKeyToTabId.set(specKey(spec), tabId);
  }
  return {
    address: (tabId) => tabIdToSpec.get(tabId) ?? null,
    resolve: (spec) => specKeyToTabId.get(specKey(spec)) ?? null,
  };
}

function specKey(spec: TabSpec): string {
  return `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;
}

const leaf = (id: string): SplitNode => ({ kind: "session", tabId: id });

// ─── suite ────────────────────────────────────────────────────────────────

describe("split-tree-url", () => {
  // Test 1: encode(null) --------------------------------------------------
  it("Test 1: encodeSplitTreeToUrl(null, resolver) returns the empty string", () => {
    const { address } = makeFixture([]);
    expect(encodeSplitTreeToUrl(null, address)).toBe("");
  });

  // Test 2: decode("") ----------------------------------------------------
  it("Test 2: decodeSplitTreeFromUrl('', resolver) returns null", () => {
    const { resolve } = makeFixture([]);
    expect(decodeSplitTreeFromUrl("", resolve)).toBeNull();
  });

  // Test 3: legible encoding ---------------------------------------------
  it(
    "Test 3: encodes a single-leaf tree into a debugger-legible string containing session name and host",
    () => {
      const fx = makeFixture([
        ["tab1", { protocol: "tmux", host: "skynet-t1000", session: "aqua" }],
      ]);
      const url = encodeSplitTreeToUrl(leaf("tab1"), fx.address);
      // Debugger-legibility check: both session name and host name must be
      // present in the encoded string (either verbatim or URL-encoded).
      expect(
        url.includes("aqua") || url.includes(encodeURIComponent("aqua")),
      ).toBe(true);
      expect(
        url.includes("skynet-t1000") ||
          url.includes(encodeURIComponent("skynet-t1000")),
      ).toBe(true);
      // Structure: contains both alphabet param and tree param.
      expect(url).toMatch(/(^|&)s=/);
      expect(url).toMatch(/(^|&)t=/);
    },
  );

  // Test 4: round-trip on a random depth-3-5 tree ------------------------
  it("Test 4: round-trips a randomly-built tree of depth 3-5 (JSON.stringify equal)", () => {
    // Build a fixture with 10 unique host+session pairs.
    const rows: Array<[string, TabSpec]> = [];
    for (let i = 0; i < 10; i += 1) {
      rows.push([
        `tab${i}`,
        { protocol: "tmux", host: `host${i}`, session: `sess${i}` },
      ]);
    }
    const fx = makeFixture(rows);

    // Deterministic LCG.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(arr: readonly T[]): T =>
      arr[Math.floor(rand() * arr.length)];
    const edges: readonly DropEdge[] = ["left", "right", "top", "bottom"];

    // Build a tree by 20 insertAtEdge ops. Ensure every tabId is unique
    // and mapped in the fixture.
    let tree: SplitNode | null = leaf("tab0");
    let nextId = 1;
    for (let op = 0; op < 20 && nextId < 10; op += 1) {
      const ids = collectTabIds(tree);
      const targetId = pick(ids);
      const targetPath = findLeaf(tree, targetId);
      if (targetPath === null) {
        throw new Error("test-setup invariant failed");
      }
      tree = insertAtEdge(
        tree,
        targetPath,
        leaf(`tab${nextId++}`),
        pick(edges),
      );
    }

    const url = encodeSplitTreeToUrl(tree, fx.address);
    expect(url).not.toBe("");
    const decoded = decodeSplitTreeFromUrl(url, fx.resolve);
    // Deep equality via JSON.stringify (children arrays serialize with the
    // canonical order, so this is a fair invariant).
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(tree));
  });

  // Test 5: null round-trips through empty-string round-trips through null
  it("Test 5: decode(encode(null)) === null (empty-tree null round-trip)", () => {
    const fx = makeFixture([]);
    expect(
      decodeSplitTreeFromUrl(encodeSplitTreeToUrl(null, fx.address), fx.resolve),
    ).toBeNull();
  });

  // Test 6: malformed tolerance — garbage input --------------------------
  it("Test 6: totally malformed input returns null (no throw)", () => {
    const fx = makeFixture([]);
    expect(
      decodeSplitTreeFromUrl("completely-not-a-valid-encoding", fx.resolve),
    ).toBeNull();
    expect(decodeSplitTreeFromUrl("!@#$%", fx.resolve)).toBeNull();
    expect(
      decodeSplitTreeFromUrl("this=has&equals=but&no=tree", fx.resolve),
    ).toBeNull();
  });

  // Test 7: malformed tolerance — missing close bracket ------------------
  it("Test 7: missing close bracket returns null", () => {
    const fx = makeFixture([
      ["tab0", { protocol: "tmux", host: "h0", session: "s0" }],
      ["tab1", { protocol: "tmux", host: "h1", session: "s1" }],
    ]);
    // Build a valid URL, then strip the trailing ')'.
    const good = encodeSplitTreeToUrl(
      { kind: "split", direction: "horizontal", children: [leaf("tab0"), leaf("tab1")] },
      fx.address,
    );
    // Drop the last ')' from the t= param — makes the tree unparseable.
    const bad = good.replace(/\)$/, "");
    // Sanity: the mutation actually removed a paren.
    expect(bad).not.toBe(good);
    expect(decodeSplitTreeFromUrl(bad, fx.resolve)).toBeNull();
  });

  // Test 8: unknown direction char --------------------------------------
  it("Test 8: unknown direction char returns null", () => {
    const fx = makeFixture([
      ["tab0", { protocol: "tmux", host: "h0", session: "s0" }],
      ["tab1", { protocol: "tmux", host: "h1", session: "s1" }],
    ]);
    // Craft a URL by hand with 'q(0,1)' instead of 'h(0,1)' or 'v(0,1)'.
    const url = "s=tmux:h0:s0~tmux:h1:s1&t=q(0,1)";
    expect(decodeSplitTreeFromUrl(url, fx.resolve)).toBeNull();
  });

  // Test 9: out-of-bounds session index ---------------------------------
  it("Test 9: leaf index out-of-bounds against alphabet returns null", () => {
    const fx = makeFixture([
      ["tab0", { protocol: "tmux", host: "h0", session: "s0" }],
    ]);
    // Alphabet has 1 entry (index 0); referencing 99 is out of bounds.
    const url = "s=tmux:h0:s0&t=h(0,99)";
    expect(decodeSplitTreeFromUrl(url, fx.resolve)).toBeNull();
  });

  // Test 10: graceful degradation on resolver miss ----------------------
  it(
    "Test 10: unknown session mid-tree is dropped and its parent split collapses",
    () => {
      // Build a 3-session tree: split-v(  split-h(A, B)  ,  C  )
      const A: TabSpec = { protocol: "tmux", host: "hA", session: "sA" };
      const B: TabSpec = { protocol: "tmux", host: "hB", session: "sB" };
      const C: TabSpec = { protocol: "tmux", host: "hC", session: "sC" };
      const encFx = makeFixture([
        ["tabA", A],
        ["tabB", B],
        ["tabC", C],
      ]);
      const tree: SplitNode = {
        kind: "split",
        direction: "vertical",
        children: [
          {
            kind: "split",
            direction: "horizontal",
            children: [leaf("tabA"), leaf("tabB")],
          },
          leaf("tabC"),
        ],
      };
      const url = encodeSplitTreeToUrl(tree, encFx.address);
      expect(url).not.toBe("");

      // Decoder resolver: B is unknown (session no longer exists). A and C
      // remain. Expected: the inner split-h collapses to just A, then the
      // outer split-v remains as split-v(A, C) with fresh tabIds.
      const decFx = makeFixture([
        // Note: use different ephemeral tabIds than the encoder to match the
        // real page-reload scenario — the session (host+name) is durable,
        // the tabId is ephemeral.
        ["tabA2", A],
        // B is deliberately missing.
        ["tabC2", C],
      ]);
      const decoded = decodeSplitTreeFromUrl(url, decFx.resolve);
      expect(decoded).not.toBeNull();
      if (decoded === null) return;
      // Structure: split-v(leaf('tabA2'), leaf('tabC2')).
      expect(decoded).toEqual({
        kind: "split",
        direction: "vertical",
        children: [leaf("tabA2"), leaf("tabC2")],
      });
    },
  );

  // Test 11: all-misses → null -------------------------------------------
  it("Test 11: all resolver misses collapse the tree to null", () => {
    const A: TabSpec = { protocol: "tmux", host: "hA", session: "sA" };
    const B: TabSpec = { protocol: "tmux", host: "hB", session: "sB" };
    const encFx = makeFixture([
      ["tabA", A],
      ["tabB", B],
    ]);
    const tree: SplitNode = {
      kind: "split",
      direction: "horizontal",
      children: [leaf("tabA"), leaf("tabB")],
    };
    const url = encodeSplitTreeToUrl(tree, encFx.address);
    // Decoder resolver returns null for everything.
    const decoded = decodeSplitTreeFromUrl(url, () => null);
    expect(decoded).toBeNull();
  });

  // Test 12: adversarial oversized input ---------------------------------
  it(
    "Test 12: >50KB adversarial input returns null in bounded time",
    () => {
      const fx = makeFixture([]);
      // Deep-nested opening parens without matching closes — the classic
      // "exponential parser blowup" attack surface.
      const blob = "s=tmux:h:s&t=" + "h(0,".repeat(20_000);
      expect(blob.length).toBeGreaterThan(50_000);
      const start = Date.now();
      const decoded = decodeSplitTreeFromUrl(blob, fx.resolve);
      const elapsed = Date.now() - start;
      expect(decoded).toBeNull();
      // Bounded time: <100ms per plan Test 12 hint.
      expect(elapsed).toBeLessThan(100);
    },
  );
});
