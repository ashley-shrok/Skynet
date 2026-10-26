// The archived conversation tab's address: `archived:<host>:<identity>`, the
// same shape as a tmux tab, so a reload or Move to new tab reopens it
// archived (never as a live terminal).
import { describe, it, expect } from "vitest";
import { encodeTabSpec, parseTabParam, specForTab } from "./tab-url";

describe("tab-url — archived conversation", () => {
  it("an archived tab's spec round-trips", () => {
    const spec = specForTab({
      type: "terminal",
      host: { name: "t1000", id: "7" },
      targetTmuxSession: "olden",
      sessionKind: "archived",
    });
    expect(spec).toEqual({ protocol: "archived", host: "t1000", session: "olden" });
    expect(encodeTabSpec(spec!)).toBe("archived:t1000:olden");
    expect(parseTabParam("archived:t1000:olden")).toEqual(spec);
  });

  it("a live tab of the same agent stays a tmux tab", () => {
    expect(specForTab({ type: "terminal", host: { name: "t1000", id: "7" }, targetTmuxSession: "olden" })).toEqual({
      protocol: "tmux",
      host: "t1000",
      session: "olden",
    });
  });

  it("an archived address needs an agent-shaped name", () => {
    expect(parseTabParam("archived:t1000:")).toBeNull();
    expect(parseTabParam("archived:t1000:Bad Name")).toBeNull();
    expect(parseTabParam("archived:t1000:../x")).toBeNull();
  });

  it("an archived tab without an agent name has no address", () => {
    expect(specForTab({ type: "terminal", host: { name: "t1000" }, targetTmuxSession: null, sessionKind: "archived" })).toBeNull();
  });
});
