import { describe, it, expect } from "vitest";
import { __malformedEventIdForTests as malformedEventId } from "./claude-session-server.js";

// pv-malformed-line-dedup-across-tail-restarts (2026-08-10) —
// covers the stability contract that lets appendDedup collapse re-emitted
// malformed-line frames when `tail -F -n +1` replays the same malformed
// line on WS reconnect / session_changed / patch #344 visibility resume.
describe("malformedEventId — stable content-derived id for malformed_line frames", () => {
  it("returns the SAME id for the SAME raw line on repeat calls (dedup contract)", () => {
    const line = '{"parentUuid":"e610c7c4","type":"assistant","content":[{"type":';
    expect(malformedEventId(line)).toBe(malformedEventId(line));
  });

  it("returns DIFFERENT ids for DIFFERENT raw lines (per-line uniqueness)", () => {
    const a = '{"foo":1,"broken';
    const b = '{"foo":2,"broken';
    expect(malformedEventId(a)).not.toBe(malformedEventId(b));
  });

  it("uses the `malformed-` prefix + 12 hex chars (48 bits of hash)", () => {
    const id = malformedEventId("anything");
    expect(id).toMatch(/^malformed-[0-9a-f]{12}$/);
  });

  it("collides for byte-identical inputs even from different callers", () => {
    // The regression this fixes: two independent tail-restarts, each parsing
    // the same session file, must emit the same eventId for the same line.
    const line =
      '{"parentUuid":"e610c7c4-ef04-47cb-9fca-3fa798234b1d","content":[{"type":"tool_use"';
    const idFromFirstTail = malformedEventId(line);
    const idFromSecondTail = malformedEventId(line);
    expect(idFromFirstTail).toBe(idFromSecondTail);
  });
});
