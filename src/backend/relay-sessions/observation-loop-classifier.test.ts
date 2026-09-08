/**
 * observation-loop-classifier — pure decision tree unit tests.
 *
 * Zero mocks needed; the classifier is a pure function that consumes a
 * pre-computed fact-set from the observation loop. See docblock in
 * observation-loop-classifier.ts for D-08 / D-09 / D-13 rationale.
 */

import { describe, it, expect } from "vitest";

import { classifyRoom } from "./observation-loop-classifier.js";

describe("classifyRoom", () => {
  it("Test 1: two-party (user + one local agent) → exclude with reason harness_dm (D-08 exact case)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@u:s", "@agent1:s"],
      memberCount: 2,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(["@agent1:s"]),
    });
    expect(result.decision).toBe("exclude");
    expect(result.reason).toBe("harness_dm");
  });

  it("Test 2: two-party (user + one non-registry account) → materialize with reason two_party_non_agent (D-09 conservative)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@u:s", "@foreign:s"],
      memberCount: 2,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(["@agent1:s"]),
    });
    expect(result.decision).toBe("materialize");
    expect(result.reason).toBe("two_party_non_agent");
  });

  it("Test 3: two-party (user + one human — non-agent-registry other member) → materialize", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@u:s", "@human2:s"],
      memberCount: 2,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(["@agent1:s", "@agent2:s"]),
    });
    expect(result.decision).toBe("materialize");
    expect(result.reason).toBe("two_party_non_agent");
  });

  it("Test 4: 3-member room (user + 2 anyone incl. local agents) → materialize with reason group_room (D-08: exclusion is EXACTLY two-party)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@u:s", "@agent1:s", "@agent2:s"],
      memberCount: 3,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(["@agent1:s", "@agent2:s"]),
    });
    expect(result.decision).toBe("materialize");
    expect(result.reason).toBe("group_room");
  });

  it("Test 5: room in admin_rooms ignore-list → exclude with reason admin_room (D-13)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!agentsRegistry:s",
      memberMxids: ["@u:s", "@a:s", "@b:s", "@c:s"],
      memberCount: 4,
      isRoomInAdminList: true,
      agentsInRegistry: new Set(),
    });
    expect(result.decision).toBe("exclude");
    expect(result.reason).toBe("admin_room");
  });

  it("Test 6: room where user is NOT among memberMxids → exclude with reason user_not_member (defensive)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@a:s", "@b:s"],
      memberCount: 2,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(),
    });
    expect(result.decision).toBe("exclude");
    expect(result.reason).toBe("user_not_member");
  });

  it("Test 7: 1-member room (just the user, no other members) → exclude with reason solo_room (edge case)", () => {
    const result = classifyRoom({
      userMxid: "@u:s",
      roomId: "!r:s",
      memberMxids: ["@u:s"],
      memberCount: 1,
      isRoomInAdminList: false,
      agentsInRegistry: new Set(),
    });
    expect(result.decision).toBe("exclude");
    expect(result.reason).toBe("solo_room");
  });
});
