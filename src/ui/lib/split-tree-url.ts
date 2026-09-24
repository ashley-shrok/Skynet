// ─── split-tree-url.ts ─────────────────────────────────────────────────────
// Phase 56 Plan 01 — URL codec for the split-tree data model.
//
// 56-CONTEXT.md § "In-scope this phase" item 2: URL becomes the source of
// truth for split-tree layout — refresh, share, tab-clone all reproduce the
// layout. 56-CONTEXT.md § "What would make it wrong":
//   1. "The URL becomes an unreadable soup" — this grammar is legible in
//      a debugger; session names appear verbatim (or URL-encoded), NOT
//      as a base64 blob.
//   2. "A saved URL layout silently breaks on reload because it references
//      sessions that no longer exist. Degradation must be graceful: drop
//      missing sessions from the layout, keep valid ones, never blank-screen"
//      — encoded here as the resolver-miss collapse pass at the end of decode.
//
// WIRE GRAMMAR (executor pick, documented per plan Task 2 <action> block):
//
//     <url>       ::= 's=' <alphabet> '&t=' <tree>
//     <alphabet>  ::= <spec>  ('~' <spec>)*
//     <spec>      ::= exact output of tab-url.ts `encodeTabSpec` (this module
//                     delegates encode + parse to that codec so every TabSpec
//                     variant round-trips: tmux, terminal, rdp, vnc, telnet,
//                     relay, and app). Historically only tmux was accepted;
//                     Phase 120 introduced app leaves in split trees, so the
//                     codec must handle every variant symmetrically.
//     <tree>      ::= <leaf> | <split>
//     <leaf>      ::= decimal integer index into <alphabet>, base 10, no
//                     leading '+' or '-' or whitespace, in-range against
//                     the alphabet length
//     <split>     ::= ('h' | 'v') '(' <tree> ',' <tree> ')'
//                     'h' = horizontal divider (stacked), 'v' = vertical
//                     divider (side-by-side), matching the SplitDirection
//                     convention in split-tree.ts.
//
// Empty tree: encode(null) returns "" and decode("") returns null. Any
// parse error, missing param, out-of-bounds index, or depth-cap trip
// returns null — the decoder NEVER surfaces an exception to the caller.
//
// RECURSION DEPTH CAP: 20. Deeper trees are physically unusable on a
// screen — 20 splits > 1M cells. See threat register T-56-01.
//
// SISTER CODEC: src/ui/lib/tab-url.ts. This codec delegates per-spec encode
// and parse to tab-url.ts so alphabet entries round-trip symmetrically with
// the #tab= URL scheme; the local grammar only owns the alphabet separator
// (~), the tree grammar (h/v splits), and the resolver-miss collapse pass.
//
// NO REACT / DOM / BACKEND / ui-types IMPORTS.

import { type TabSpec, encodeTabSpec, parseTabParam } from "./tab-url";
import { collectTabIds, removeLeaf, type SplitNode } from "./split-tree";

const MAX_DEPTH = 20;

// ─── encodeSplitTreeToUrl ──────────────────────────────────────────────────

/** Serialize the tree to a URLSearchParams-compatible string. If ANY leaf's
 *  tabId lacks a durable address (sessionAddress returns null), that leaf is
 *  stripped from the tree via removeLeaf before encoding — defence-in-depth
 *  against dashboard tabs accidentally reaching the tree. Returns "" for a
 *  null (or fully-degraded-to-null) input. */
export function encodeSplitTreeToUrl(
  root: SplitNode | null,
  sessionAddress: (tabId: string) => TabSpec | null,
): string {
  if (root === null) return "";
  // Pre-pass: strip any leaf whose tabId doesn't map to a durable spec.
  let filtered: SplitNode | null = root;
  for (const tabId of collectTabIds(root)) {
    if (sessionAddress(tabId) === null) {
      filtered = removeLeaf(filtered, tabId);
      if (filtered === null) return "";
    }
  }
  if (filtered === null) return "";
  const orderedIds = collectTabIds(filtered);
  // Build the alphabet in traversal order. Assign each unique tabId a stable
  // index. (In practice every tabId is unique in the tree by construction,
  // but dedupe defensively via a Map so the alphabet ordering is stable
  // regardless of any future consumer relaxing that invariant.)
  const tabIdToIndex = new Map<string, number>();
  const specs: TabSpec[] = [];
  for (const tabId of orderedIds) {
    if (tabIdToIndex.has(tabId)) continue;
    const spec = sessionAddress(tabId);
    if (spec === null) continue; // already-stripped in the pre-pass
    tabIdToIndex.set(tabId, specs.length);
    specs.push(spec);
  }
  if (specs.length === 0) return "";
  const alphabet = specs.map(encodeSpec).join("~");
  const treeStr = stringifyTree(filtered, tabIdToIndex);
  return `s=${alphabet}&t=${treeStr}`;
}

// Delegates to tab-url.ts's encodeTabSpec so every TabSpec variant (tmux,
// terminal, rdp, vnc, telnet, relay, app) round-trips correctly. The prior
// local implementation read spec.host on every variant and produced
// "app:undefined" / "relay:undefined" for app + relay leaves whose
// TabSpec discriminated-union carries host?: never — the decoder then
// rejected the alphabet and the whole split tree silently collapsed on
// reload (visible as "one thing shows up after reload" when a split
// contained an app tab). encodeTabSpec's output never contains '~', so
// the alphabet's tilde separator remains unambiguous.
function encodeSpec(spec: TabSpec): string {
  return encodeTabSpec(spec);
}

function stringifyTree(
  node: SplitNode,
  tabIdToIndex: Map<string, number>,
): string {
  if (node.kind === "session") {
    const idx = tabIdToIndex.get(node.tabId);
    // Safety fallthrough: if the pre-pass and the recursion agree, this
    // Map.get always returns a defined index. If it ever doesn't (future
    // consumer relaxes an invariant), emit -1 — the decoder rejects any
    // out-of-range index and returns null, so the invalid encoding never
    // silently corrupts a saved layout.
    return String(idx ?? -1);
  }
  const ch = node.direction === "horizontal" ? "h" : "v";
  return `${ch}(${
    stringifyTree(node.children[0], tabIdToIndex)
  },${stringifyTree(node.children[1], tabIdToIndex)})`;
}

// ─── decodeSplitTreeFromUrl ────────────────────────────────────────────────

/** Parse a URL fragment payload back into a SplitNode tree. Uses the
 *  caller-supplied `resolver` to look up the current tabId for each
 *  host+session pair; a null resolver-return means "session no longer
 *  exists" and that leaf is dropped from the layout (single-child parent
 *  splits collapse via the removeLeaf rule). Contract: this entrypoint
 *  never surfaces an exception to callers — every error path returns
 *  null instead. */
export function decodeSplitTreeFromUrl(
  str: string,
  resolver: (spec: TabSpec) => string | null,
): SplitNode | null {
  if (str === "") return null;
  try {
    return decodeInner(str, resolver);
  } catch {
    // Belt-and-braces: any internal invariant exception is caught here so
    // the exported entrypoint's no-surface contract holds. See plan
    // acceptance criterion — the decoder MUST NOT surface exceptions to
    // callers; a caught invariant becomes a null return (same graceful-
    // degradation behaviour as a malformed URL).
    return null;
  }
}

function decodeInner(
  str: string,
  resolver: (spec: TabSpec) => string | null,
): SplitNode | null {
  // Cheap DoS defence: bail early on absurdly-long inputs. 50KB is the
  // adversarial threshold in Test 12; a legitimate depth-20 tree is
  // several hundred bytes at most.
  if (str.length > 100_000) return null;

  const params = new URLSearchParams(str);
  const alphabetRaw = params.get("s");
  const treeRaw = params.get("t");
  if (alphabetRaw === null || treeRaw === null) return null;
  if (alphabetRaw === "" || treeRaw === "") return null;

  const specStrings = alphabetRaw.split("~");
  const specs: TabSpec[] = [];
  for (const specStr of specStrings) {
    const spec = decodeSpec(specStr);
    if (spec === null) return null;
    specs.push(spec);
  }

  // Recursive-descent parser with cursor + depth cap.
  const cursor = { pos: 0 };

  // Intermediate tree uses `IntermediateNode` — a leaf may carry an alphabet
  // INDEX (number) rather than a tabId (string) so the resolver-miss collapse
  // pass can walk it after parsing. A split has the usual shape.
  type IntLeaf = { kind: "leaf"; alphabetIndex: number };
  type IntSplit = {
    kind: "split";
    direction: "horizontal" | "vertical";
    children: [IntermediateNode, IntermediateNode];
  };
  type IntermediateNode = IntLeaf | IntSplit;

  function parseNode(depth: number): IntermediateNode | null {
    if (depth > MAX_DEPTH) return null;
    if (cursor.pos >= treeRaw.length) return null;
    const ch = treeRaw.charCodeAt(cursor.pos);
    // 'h' = 104, 'v' = 118
    if (ch === 104 /* 'h' */ || ch === 118 /* 'v' */) {
      const direction = ch === 104 ? "horizontal" : "vertical";
      cursor.pos += 1;
      if (treeRaw.charCodeAt(cursor.pos) !== 40 /* '(' */) return null;
      cursor.pos += 1;
      const a = parseNode(depth + 1);
      if (a === null) return null;
      if (treeRaw.charCodeAt(cursor.pos) !== 44 /* ',' */) return null;
      cursor.pos += 1;
      const b = parseNode(depth + 1);
      if (b === null) return null;
      if (treeRaw.charCodeAt(cursor.pos) !== 41 /* ')' */) return null;
      cursor.pos += 1;
      return { kind: "split", direction, children: [a, b] };
    }
    // Otherwise expect a decimal integer index. Consume [0-9]+ only.
    const startPos = cursor.pos;
    while (cursor.pos < treeRaw.length) {
      const c = treeRaw.charCodeAt(cursor.pos);
      if (c < 48 /* '0' */ || c > 57 /* '9' */) break;
      cursor.pos += 1;
    }
    if (cursor.pos === startPos) return null; // no digits consumed
    const digits = treeRaw.slice(startPos, cursor.pos);
    // Reject leading zeros on multi-digit indices to keep the encoding
    // canonical (encoder never emits '007'; if a decoder-side URL contains
    // one, treat it as malformed).
    if (digits.length > 1 && digits.charCodeAt(0) === 48 /* '0' */) return null;
    const idx = Number.parseInt(digits, 10);
    if (!Number.isInteger(idx)) return null;
    if (idx < 0 || idx >= specs.length) return null;
    return { kind: "leaf", alphabetIndex: idx };
  }

  const parsed = parseNode(0);
  if (parsed === null) return null;
  // Must have consumed the entire t= payload — trailing junk is malformed.
  if (cursor.pos !== treeRaw.length) return null;

  // Resolver pass: walk the intermediate tree, replacing each leaf's
  // alphabet-index with the resolved tabId, or `null` if the session no
  // longer exists. Then collapse null leaves per the removeLeaf rule.
  //
  // Implementation: first materialize to a `SplitNode` with sentinel leaves
  // whose tabId is a unique marker; then use `removeLeaf` from split-tree.ts
  // to drop each marker, exercising the exact collapse semantics tested in
  // Task 1's suite. Guarantees the URL-level graceful-degradation and the
  // tree-level invariant are enforced by the SAME code path.
  const missingMarkers: string[] = [];
  let missingCounter = 0;

  function materialize(node: IntermediateNode): SplitNode {
    if (node.kind === "leaf") {
      const spec = specs[node.alphabetIndex];
      const tabId = resolver(spec);
      if (tabId === null) {
        const marker = ` missing-${missingCounter++} `;
        missingMarkers.push(marker);
        return { kind: "session", tabId: marker };
      }
      return { kind: "session", tabId };
    }
    return {
      kind: "split",
      direction: node.direction,
      children: [materialize(node.children[0]), materialize(node.children[1])],
    };
  }

  let materialized: SplitNode | null = materialize(parsed);
  for (const marker of missingMarkers) {
    if (materialized === null) break;
    materialized = removeLeaf(materialized, marker);
  }
  return materialized;
}

// Delegates to tab-url.ts's parseTabParam so every TabSpec variant round-
// trips symmetrically with encodeSpec above. parseTabParam already
// validates each variant at the wire boundary (tmux needs host+session;
// app needs hostId matching /^[1-9][0-9]{0,9}$/ and slug matching APP_SLUG_RE;
// relay needs a non-empty roomId ≤ 512 chars; terminal/rdp/vnc/telnet need
// a non-empty host) and returns null fail-safe on any malformed input,
// which cascades to the whole decode returning null per decodeInner's
// contract.
function decodeSpec(str: string): TabSpec | null {
  return parseTabParam(str);
}
