import { describe, it, expect } from "vitest";
import type { Identity } from "@/api/identities-api";
import { addressingFor, friendlyMxidName, previewLine } from "./relay-addressing";

const ident = (identityKey: string, displayName: string, colorHue: number) =>
  ({ identityKey, displayName, colorHue }) as Identity;
const byKey = new Map([
  ["aster", ident("aster", "Aster", 32)],
  ["tina", ident("tina", "Tina", 200)],
]);

describe("relay-addressing", () => {
  it("friendlyMxidName drops the server and capitalizes", () => {
    expect(friendlyMxidName("@stacy:skynet.aithercloud.com")).toBe("Stacy");
    expect(friendlyMxidName("not-an-mxid")).toBe("Not-an-mxid");
  });

  it("one other member → dm, resolved through identities", () => {
    const a = addressingFor(
      "aster",
      [
        { mxid: "@aster:x", kind: "agent", displayName: null },
        { mxid: "@tina:x", kind: "agent", displayName: null },
      ],
      byKey,
      null,
    );
    expect(a).toEqual({ kind: "dm", to: { name: "Tina", hue: 200, you: false } });
  });

  it("sender match is case-insensitive on the localpart", () => {
    const a = addressingFor(
      "aster",
      [
        { mxid: "@Aster:x", kind: "agent", displayName: null },
        { mxid: "@ashley:x", kind: "you", displayName: "Ashley" },
      ],
      byKey,
      null,
    );
    expect(a).toEqual({ kind: "dm", to: { name: "You", hue: null, you: true } });
  });

  it("two or more others → group", () => {
    const a = addressingFor(
      "aster",
      [
        { mxid: "@aster:x", kind: "agent", displayName: null },
        { mxid: "@tina:x", kind: "agent", displayName: null },
        { mxid: "@sam:x", kind: "human", displayName: "Sam" },
      ],
      byKey,
      null,
    );
    expect(a.kind).toBe("group");
    expect(a.kind === "group" && a.to.map((p) => p.name)).toEqual(["Tina", "Sam"]);
  });

  it("unknown members → fallback party, or unknown without one", () => {
    const self = { name: "Aster", hue: 32, you: false };
    expect(addressingFor("tina", null, byKey, self)).toEqual({ kind: "dm", to: self });
    expect(addressingFor("aster", null, byKey, null)).toEqual({ kind: "unknown" });
    expect(addressingFor("aster", [{ mxid: "@aster:x", kind: "agent", displayName: null }], byKey, null)).toEqual({ kind: "unknown" });
  });

  it("previewLine collapses whitespace", () => {
    expect(previewLine("  Hi\n\nthere   you ")).toBe("Hi there you");
  });
});
