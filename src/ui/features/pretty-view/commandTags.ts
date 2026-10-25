import React from "react";
import { CommandChip } from "./CommandChip";

export { preprocessCommandTriplets } from "./commandTriplets";

/**
 * Global regex that recognizes the `⟨cmd:...⟩` sentinel emitted by
 * preprocessCommandTriplets. Group 1 captures the payload between the
 * angle brackets (e.g. "/id tina"). Callers should use `matchAll` (which
 * consumes an isolated iterator per call) rather than shared `exec` state
 * to avoid lastIndex leakage.
 */
export const CMD_MARKER_RE = /⟨cmd:([^⟩]+)⟩/g;

/**
 * Walk react-markdown's `<p>` children and, for each raw string child that
 * contains one or more `⟨cmd:...⟩` markers, split it into interleaved text
 * segments and `<CommandChip>` elements. Non-string children (already-JSX
 * from other markdown transformations like <em>, <strong>, anchors, code)
 * pass through untouched — the design intentionally only prettifies
 * top-level paragraph text where markers live post-preprocess. Any nested
 * marker that ended up inside an <em> etc. will not be prettified; this
 * is acceptable because Claude Code never emits command triplets inside
 * markdown emphasis.
 */
export function splitMarkers(
  children: React.ReactNode,
): React.ReactNode {
  return React.Children.map(children, (child, childIndex) => {
    if (typeof child !== "string") return child;
    if (!child.includes("⟨cmd:")) return child;

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let markerIndex = 0;
    // matchAll returns a fresh iterator; the `g` flag on CMD_MARKER_RE is
    // required for matchAll but no shared lastIndex is exposed to callers.
    for (const m of child.matchAll(CMD_MARKER_RE)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (start > cursor) {
        parts.push(child.slice(cursor, start));
      }
      parts.push(
        React.createElement(CommandChip, {
          key: `cmd-${childIndex}-${markerIndex}`,
          cmd: m[1],
        }),
      );
      cursor = end;
      markerIndex += 1;
    }
    if (cursor < child.length) {
      parts.push(child.slice(cursor));
    }
    return parts;
  });
}
