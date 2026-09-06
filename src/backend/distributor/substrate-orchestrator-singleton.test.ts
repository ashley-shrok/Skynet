/**
 * substrate-orchestrator-singleton.test.ts — Unit tests for the singleton accessor module.
 *
 * Tests SG1-SG4 cover:
 *   SG1 — initial state is null
 *   SG2 — setter→getter round-trip returns the same reference
 *   SG3 — __resetSubstrateOrchestrator restores null
 *   SG4 — last-write-wins semantics (double-set returns the second instance)
 *
 * Phase 75-05.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { ServerSubstrateOrchestrator } from "./server-substrate-orchestrator.js";
import {
  setSubstrateOrchestrator,
  getSubstrateOrchestrator,
  __resetSubstrateOrchestrator,
} from "./substrate-orchestrator-singleton.js";

function makeMockOrch(): ServerSubstrateOrchestrator {
  return {
    start: async () => {},
    stop: () => {},
    sweepOneHost: async () => {},
    getSweepTickCount: () => 0,
  };
}

describe("substrate-orchestrator-singleton", () => {
  beforeEach(() => {
    __resetSubstrateOrchestrator();
  });

  it("SG1: returns null before any setter call", () => {
    expect(getSubstrateOrchestrator()).toBeNull();
  });

  it("SG2: setter→getter round-trip returns the same reference", () => {
    const mockOrch = makeMockOrch();
    setSubstrateOrchestrator(mockOrch);
    expect(getSubstrateOrchestrator()).toBe(mockOrch);
  });

  it("SG3: __resetSubstrateOrchestrator restores null", () => {
    const mockOrch = makeMockOrch();
    setSubstrateOrchestrator(mockOrch);
    __resetSubstrateOrchestrator();
    expect(getSubstrateOrchestrator()).toBeNull();
  });

  it("SG4: last-write-wins — second set overwrites first", () => {
    const mockA = makeMockOrch();
    const mockB = makeMockOrch();
    setSubstrateOrchestrator(mockA);
    setSubstrateOrchestrator(mockB);
    expect(getSubstrateOrchestrator()).toBe(mockB);
  });
});
