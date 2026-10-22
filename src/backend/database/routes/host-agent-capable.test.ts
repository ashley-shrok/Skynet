import { describe, it, expect } from "vitest";
import { canHostAgents, sameMachine } from "./host-agent-capable.js";

const owners = {
  ip: "10.0.0.5",
  port: 22,
  username: "copyephilya",
  credentialId: 3,
  enableSsh: true,
  runsFleetSubstrate: true,
};

describe("canHostAgents", () => {
  it("is true for the row that runs the fleet substrate", () => {
    expect(canHostAgents(owners, [owners])).toBe(true);
  });

  it("is true for another user's copy of a substrate machine", () => {
    const copy = { ...owners, runsFleetSubstrate: false };
    expect(canHostAgents(copy, [owners])).toBe(true);
  });

  it("matches a copy by shared credential when usernames are empty", () => {
    const copy = { ...owners, username: "", runsFleetSubstrate: false };
    expect(canHostAgents(copy, [{ ...owners, username: "" }])).toBe(true);
  });

  it("is false for a different login on the same machine", () => {
    const other = { ...owners, username: "someone", credentialId: 9, runsFleetSubstrate: false };
    expect(canHostAgents(other, [owners])).toBe(false);
  });

  it("is false for a different machine", () => {
    const other = { ...owners, ip: "10.0.0.6", runsFleetSubstrate: false };
    expect(canHostAgents(other, [owners])).toBe(false);
  });

  it("is false for a host without SSH", () => {
    expect(canHostAgents({ ...owners, enableSsh: false }, [owners])).toBe(false);
  });
});

describe("sameMachine", () => {
  it("treats a missing port as 22", () => {
    expect(sameMachine({ ...owners, port: undefined }, owners)).toBe(true);
  });

  it("ignores case and surrounding space in the address", () => {
    expect(sameMachine({ ...owners, ip: " 10.0.0.5 " }, owners)).toBe(true);
  });
});
