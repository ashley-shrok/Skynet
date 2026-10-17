import { describe, it, expect } from "vitest";
import type { Identity } from "@/api/identities-api";
import { addressingFor, friendlyMxidName, partyForAddressee, previewLine } from "./relay-addressing";

const ident = (identityKey: string, displayName: string, colorHue: number) =>
  ({ identityKey, displayName, colorHue }) as Identity;
const byKey = new Map([
  ["aster", ident("aster", "Aster", 32)],
  ["tina", ident("tina", "Tina", 200)],
]);

describe("partyForAddressee", () => {
  const viewer = "@ashley:t1000.example";
  it("the viewer's mxid, any case → You", () => {
    expect(partyForAddressee("@Ashley:t1000.example", byKey, viewer)).toEqual({ name: "You", hue: null, you: true });
  });
  it("the viewer's bare localpart → You", () => {
    expect(partyForAddressee("ashley", byKey, viewer).you).toBe(true);
  });
  it("an identity name → that identity", () => {
    expect(partyForAddressee("Tina", byKey, viewer)).toEqual({ name: "Tina", hue: 200, you: false, avatarUrl: null });
  });
  it("an agent's mxid → resolved through identities", () => {
    expect(partyForAddressee("@aster:t1000.example", byKey, viewer).name).toBe("Aster");
  });
  it("someone unknown → their name capitalized, not you", () => {
    expect(partyForAddressee("stacy", byKey, viewer)).toEqual({ name: "Stacy", hue: null, you: false });
  });
  it("no viewer mxid → never You", () => {
    expect(partyForAddressee("ashley", byKey, null).you).toBe(false);
  });
});

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
    expect(a).toEqual({ kind: "dm", to: { name: "Tina", hue: 200, you: false, avatarUrl: null } });
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
