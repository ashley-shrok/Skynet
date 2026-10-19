import { describe, it, expect } from "vitest";
import type { SSHHostWithStatus } from "@/main-axios";
import { sshHostToHost } from "@/lib/ssh-host-to-host";

const base = {
  id: 6,
  name: "Skynet",
  ip: "100.99.149.8",
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
