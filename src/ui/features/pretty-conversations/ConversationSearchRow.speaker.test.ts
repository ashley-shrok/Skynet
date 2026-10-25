import { describe, it, expect } from "vitest";
import { speakerLabel } from "./ConversationSearchRow";
import type { Identity } from "@/api/identities-api";

const byKey = new Map<string, Identity>([
  ["bilbo", { identityKey: "bilbo", displayName: "Bilbo", colorHue: 40, avatarUrl: "" } as unknown as Identity],
]);
const viewer = "@ashley:t1000.example";
const FINCH = { name: "Finch", key: "finch" };

describe("search passage labels read like the conversation's", () => {
  it("you and the agent", () => {
    expect(speakerLabel({ speaker: "user", text: "x" }, FINCH, byKey, viewer, null)).toBe("You");
    expect(speakerLabel({ speaker: "agent", text: "x" }, FINCH, byKey, viewer, null)).toBe("Finch");
  });

  it("a relay message the agent received names its sender", () => {
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: "@bilbo:t1000.example", relayTo: null }, FINCH, byKey, viewer, null),
    ).toBe("Bilbo → Finch");
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: "@stacy:other.example", relayTo: null }, FINCH, byKey, viewer, null),
    ).toBe("Stacy → Finch");
  });

  it("a relay message the agent sent: to you reads as the agent; to another agent as a card", () => {
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: viewer }, FINCH, byKey, viewer, null)).toBe("Finch");
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: "bilbo" }, FINCH, byKey, viewer, null)).toBe(
      "Finch → Bilbo",
    );
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: null }, FINCH, byKey, viewer, null)).toBe(
      "Finch sent a DM",
    );
  });

  it("with the room's members known, names them as the card does", () => {
    const members = [
      { mxid: "@finch:t1000.example", kind: "agent" as const, displayName: null },
      { mxid: viewer, kind: "you" as const, displayName: null },
    ];
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: null, relayRoom: "!r:x" }, FINCH, byKey, viewer, members),
    ).toBe("Finch");
    const group = [...members, { mxid: "@bilbo:t1000.example", kind: "agent" as const, displayName: null }];
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: null, relayRoom: "!r:x" }, FINCH, byKey, viewer, group),
    ).toBe("Finch → group with You, Bilbo");
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: "@bilbo:t1000.example", relayTo: null, relayRoom: "!r:x" }, FINCH, byKey, viewer, group),
    ).toBe("Bilbo → group with Finch, You");
  });
});
