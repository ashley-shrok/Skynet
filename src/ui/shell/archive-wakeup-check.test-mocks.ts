// Test double for archive-wakeup-check: the wording helpers stay real, the
// per-agent lookup is driven from the test. Use as
//   vi.mock("@/shell/archive-wakeup-check", async (o) =>
//     (await import("@/shell/archive-wakeup-check.test-mocks")).archiveWakeupCheck(o));
// and set `wakeupCheckMock.impl` (reset by `resetWakeupCheckMock`) to control
// what each agent's check returns. A plain object rather than a vi.fn so
// restoreAllMocks / clearAllMocks in a suite never wipe the default.

import type { WakeupCheck } from "./archive-wakeup-check";

type Impl = (hostId: number, identityKey: string) => Promise<WakeupCheck>;

const DEFAULT_IMPL: Impl = async () => ({ status: "checked", active: [] });

export const wakeupCheckMock: { impl: Impl; calls: [number, string][] } = {
  impl: DEFAULT_IMPL,
  calls: [],
};

export function resetWakeupCheckMock(): void {
  wakeupCheckMock.impl = DEFAULT_IMPL;
  wakeupCheckMock.calls = [];
}

export async function archiveWakeupCheck(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import("./archive-wakeup-check");
  const checkActiveWakeups = (hostId: number, identityKey: string) => {
    wakeupCheckMock.calls.push([hostId, identityKey]);
    return wakeupCheckMock.impl(hostId, identityKey);
  };
  return {
    ...actual,
    checkActiveWakeups,
    checkActiveWakeupsForAgents: <T extends { hostId: number; identityKey: string }>(agents: T[]) =>
      Promise.all(
        agents.map(async (agent) => ({ agent, check: await checkActiveWakeups(agent.hostId, agent.identityKey) })),
      ),
  };
}
