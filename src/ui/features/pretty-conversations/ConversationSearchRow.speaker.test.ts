import { describe, it, expect } from "vitest";
import { speakerLabel } from "./ConversationSearchRow";
import type { Identity } from "@/api/identities-api";

const byKey = new Map<string, Identity>([
  ["bilbo", { identityKey: "bilbo", displayName: "Bilbo", colorHue: 40, avatarUrl: "" } as unknown as Identity],
]);
const viewer = "@ashley:t1000.example";

describe("search passage labels read like the conversation's", () => {
  it("you and the agent", () => {
    expect(speakerLabel({ speaker: "user", text: "x" }, "Finch", byKey, viewer)).toBe("You");
    expect(speakerLabel({ speaker: "agent", text: "x" }, "Finch", byKey, viewer)).toBe("Finch");
  });

  it("a relay message the agent received names its sender", () => {
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: "@bilbo:t1000.example", relayTo: null }, "Finch", byKey, viewer),
    ).toBe("Bilbo → Finch");
    expect(
      speakerLabel({ speaker: "relay", text: "x", relayFrom: "@stacy:other.example", relayTo: null }, "Finch", byKey, viewer),
    ).toBe("Stacy → Finch");
  });

  it("a relay message the agent sent: to you reads as the agent; to another agent as a card", () => {
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: viewer }, "Finch", byKey, viewer)).toBe("Finch");
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: "bilbo" }, "Finch", byKey, viewer)).toBe(
      "Finch → Bilbo",
    );
    expect(speakerLabel({ speaker: "relay", text: "x", relayFrom: null, relayTo: null }, "Finch", byKey, viewer)).toBe(
      "Finch sent a DM",
    );
  });
});
