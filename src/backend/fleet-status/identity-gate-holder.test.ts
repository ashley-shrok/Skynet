import { describe, it, expect, vi, afterEach } from "vitest";
import {
  canUserSeeIdentity,
  setIdentityGate,
  _resetIdentityGateForTesting,
} from "./identity-gate-holder.js";

afterEach(() => {
  _resetIdentityGateForTesting();
  vi.useRealTimers();
});

describe("identity-gate-holder (convo-scoped apps)", () => {
  it("fails closed before the gate is set", async () => {
    expect(await canUserSeeIdentity("alpha", "6", "u1")).toBe(false);
  });

  it("fails closed when the gate throws", async () => {
    setIdentityGate(async () => {
      throw new Error("ssh down");
    });
    expect(await canUserSeeIdentity("alpha", "6", "u1")).toBe(false);
  });

  it("shares one check across a burst and caches it per (user, host, identity)", async () => {
    const gate = vi.fn(async (name: string) => name === "alpha");
    setIdentityGate(gate);
    const answers = await Promise.all(
      Array.from({ length: 30 }, () => canUserSeeIdentity("alpha", "6", "u1")),
    );
    expect(answers.every(Boolean)).toBe(true);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(await canUserSeeIdentity("beta", "6", "u1")).toBe(false);
    expect(await canUserSeeIdentity("alpha", "6", "u2")).toBe(true);
    expect(gate).toHaveBeenCalledTimes(3);
  });

  it("re-checks after the TTL", async () => {
    vi.useFakeTimers();
    const gate = vi.fn(async () => true);
    setIdentityGate(gate);
    await canUserSeeIdentity("alpha", "6", "u1");
    vi.advanceTimersByTime(11_000);
    await canUserSeeIdentity("alpha", "6", "u1");
    expect(gate).toHaveBeenCalledTimes(2);
  });
});
