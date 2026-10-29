import { describe, it, expect } from "vitest";
import type { SSHHostWithStatus } from "@/main-axios";
import { sshHostToHost } from "@/lib/ssh-host-to-host";

const base = {
  id: 6,
  name: "Skynet",
  ip: "100.70.0.1",
  port: 22,
  username: "ubuntu",
  status: "online",
} as unknown as SSHHostWithStatus;

describe("sshHostToHost", () => {
  // The new-conversation and scheduled-task pickers only offer hosts with
  // runsFleetSubstrate === true; dropping it here empties both pickers.
  it("carries runsFleetSubstrate through", () => {
    expect(sshHostToHost({ ...base, runsFleetSubstrate: true }).runsFleetSubstrate).toBe(true);
    expect(sshHostToHost({ ...base, runsFleetSubstrate: false }).runsFleetSubstrate).toBe(false);
  });

  it("treats a missing runsFleetSubstrate as false", () => {
    expect(sshHostToHost(base).runsFleetSubstrate).toBe(false);
  });
});

describe("sshHostToHost canHostAgents", () => {
  // Another user's copy of a fleet machine has runsFleetSubstrate off but
  // canHostAgents on; the pickers must still offer it.
  it("carries canHostAgents through", () => {
    expect(sshHostToHost({ ...base, canHostAgents: true }).canHostAgents).toBe(true);
    expect(sshHostToHost({ ...base, canHostAgents: false }).canHostAgents).toBe(false);
  });

  it("is true when the row itself runs the fleet substrate", () => {
    expect(sshHostToHost({ ...base, runsFleetSubstrate: true }).canHostAgents).toBe(true);
  });
});
