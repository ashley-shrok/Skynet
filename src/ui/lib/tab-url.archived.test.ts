// The archived conversation tab's address: `archived:<host>:<identity>`, the
// same shape as a tmux tab, so a reload or Move to new tab reopens it
// archived (never as a live terminal).
import { describe, it, expect } from "vitest";
import { encodeTabSpec, parseTabParam, specForTab } from "./tab-url";

describe("tab-url — archived conversation", () => {
  it("an archived tab's spec round-trips", () => {
    const spec = specForTab({
      type: "terminal",
      host: { name: "harbor", id: "7" },
      targetTmuxSession: "olden",
      sessionKind: "archived",
    });
    expect(spec).toEqual({ protocol: "archived", host: "harbor", session: "olden" });
    expect(encodeTabSpec(spec!)).toBe("archived:harbor:olden");
    expect(parseTabParam("archived:harbor:olden")).toEqual(spec);
  });

  it("a live tab of the same agent stays a tmux tab", () => {
    expect(specForTab({ type: "terminal", host: { name: "harbor", id: "7" }, targetTmuxSession: "olden" })).toEqual({
      protocol: "tmux",
      host: "harbor",
      session: "olden",
    });
  });

  it("an archived address needs an agent-shaped name", () => {
    expect(parseTabParam("archived:harbor:")).toBeNull();
    expect(parseTabParam("archived:harbor:Bad Name")).toBeNull();
    expect(parseTabParam("archived:harbor:../x")).toBeNull();
  });

  it("an archived tab without an agent name has no address", () => {
    expect(specForTab({ type: "terminal", host: { name: "harbor" }, targetTmuxSession: null, sessionKind: "archived" })).toBeNull();
  });
});
