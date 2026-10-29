import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sockets } = vi.hoisted(() => ({ sockets: [] as FakeSocket[] }));

class FakeSocket {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  reply(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  },
}));

import {
  ARCHIVE_AGENT_BODY,
  checkActiveWakeups,
  checkActiveWakeupsForAgents,
  claimArchivePrompt,
  MULTI_CHECK_CONCURRENCY,
  releaseArchivePrompt,
  multiAgentWakeupWarning,
  needsWakeupWarning,
  singleAgentArchiveBody,
} from "./archive-wakeup-check";

const row = (slug: string, extra: Record<string, unknown>) => ({
  slug,
  name: slug.toUpperCase(),
  scheduleHuman: `sched ${slug}`,
  schedule: {},
  instruction: "",
  enabled: true,
  ...extra,
});

describe("checkActiveWakeups", () => {
  beforeEach(() => {
    sockets.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the agent's wake-ups and keeps only those that can still fire", async () => {
    const p = checkActiveWakeups(7, "wren");
    const s = sockets[0];
    s.onopen?.();
    expect(JSON.parse(s.sent[0])).toEqual({
      type: "identity:list-wakeups",
      identityKey: "wren",
      hostId: 7,
      strict: true,
    });
    s.reply({ type: "something-else" }); // ignored
    s.reply({
      type: "identity:wakeups",
      wakeups: [
        row("live", { canFireAgain: true }),
        row("spent", { canFireAgain: false }),
        row("off", { enabled: false, canFireAgain: false }),
        // An older backend without the flag: fall back to the switch.
        row("legacy", {}),
      ],
    });
    await expect(p).resolves.toEqual({
      status: "checked",
      active: [
        { slug: "live", name: "LIVE", scheduleHuman: "sched live" },
        { slug: "legacy", name: "LEGACY", scheduleHuman: "sched legacy" },
      ],
    });
    expect(s.closed).toBe(true);
  });

  it("an error reply, a failed connection or a closed socket is 'unknown'", async () => {
    const a = checkActiveWakeups(1, "a");
    sockets[0].reply({ type: "identity:wakeups", wakeups: [], error: "host unreachable" });
    await expect(a).resolves.toEqual({ status: "unknown", reason: "host unreachable" });

    const b = checkActiveWakeups(1, "b");
    sockets[1].onerror?.();
    await expect(b).resolves.toMatchObject({ status: "unknown" });

    const c = checkActiveWakeups(1, "c");
    sockets[2].onclose?.();
    await expect(c).resolves.toMatchObject({ status: "unknown" });
  });

  it("gives up after the timeout, and a late reply changes nothing", async () => {
    vi.useFakeTimers();
    const p = checkActiveWakeups(1, "slow", 4000);
    sockets[0].onopen?.();
    vi.advanceTimersByTime(3999);
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toEqual({ status: "unknown", reason: "timeout" });
    expect(sockets[0].closed).toBe(true);
    sockets[0].reply({ type: "identity:wakeups", wakeups: [row("x", { canFireAgain: true })] });
    await expect(p).resolves.toEqual({ status: "unknown", reason: "timeout" });
  });
});

describe("checkActiveWakeups — malformed reply", () => {
  beforeEach(() => {
    sockets.length = 0;
  });
  it("a reply without a list is 'unknown' at once", async () => {
    const p = checkActiveWakeups(1, "x");
    sockets[0].reply({ type: "identity:wakeups" });
    await expect(p).resolves.toEqual({ status: "unknown", reason: "malformed reply" });
  });
});

describe("checkActiveWakeupsForAgents", () => {
  beforeEach(() => {
    sockets.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at most a few checks at once per host, and keeps the agents' order", async () => {
    const agents = Array.from({ length: 8 }, (_, i) => ({ hostId: i < 7 ? 1 : 2, identityKey: `a${i}` }));
    const p = checkActiveWakeupsForAgents(agents);
    // Host 1's first batch plus host 2's only agent.
    expect(sockets).toHaveLength(MULTI_CHECK_CONCURRENCY + 1);
    const answer = () => {
      for (const s of sockets.splice(0)) {
        s.onopen?.();
        s.reply({ type: "identity:wakeups", wakeups: [] });
      }
    };
    answer();
    await vi.waitFor(() => expect(sockets.length).toBe(7 - MULTI_CHECK_CONCURRENCY));
    answer();
    const out = await p;
    expect(out.map((r) => r.agent.identityKey)).toEqual(agents.map((a) => a.identityKey));
    expect(out.every((r) => r.check.status === "checked")).toBe(true);
  });

  it("agents still queued when the overall time runs out come back 'unknown'", async () => {
    vi.useFakeTimers();
    const agents = Array.from({ length: MULTI_CHECK_CONCURRENCY + 2 }, (_, i) => ({ hostId: 1, identityKey: `a${i}` }));
    const p = checkActiveWakeupsForAgents(agents);
    await vi.advanceTimersByTimeAsync(20_000);
    const out = await p;
    expect(out.every((r) => r.check.status === "unknown")).toBe(true);
  });
});

describe("archive prompt claim", () => {
  it("only one prompt per agent at a time", () => {
    expect(claimArchivePrompt(1, "wren")).toBe(true);
    expect(claimArchivePrompt(1, "wren")).toBe(false);
    expect(claimArchivePrompt(2, "wren")).toBe(true);
    releaseArchivePrompt(1, "wren");
    expect(claimArchivePrompt(1, "wren")).toBe(true);
    releaseArchivePrompt(1, "wren");
    releaseArchivePrompt(2, "wren");
  });
});

describe("confirm wording", () => {
  const standup = { slug: "s", name: "Standup check", scheduleHuman: "Daily at 09:00" };
  const inbox = { slug: "i", name: "Inbox watcher", scheduleHuman: "When its sensor fires" };

  it("no active wake-ups: today's body, nothing added", () => {
    const check = { status: "checked" as const, active: [] };
    expect(needsWakeupWarning(check)).toBe(false);
    expect(singleAgentArchiveBody(check)).toBe(ARCHIVE_AGENT_BODY);
  });

  it("names each wake-up and points at scheduled tasks", () => {
    expect(singleAgentArchiveBody({ status: "checked", active: [standup, inbox] })).toBe(
      `${ARCHIVE_AGENT_BODY}\n\nIt has 2 wake-ups that will never fire again:\n` +
        "• Standup check — Daily at 09:00\n• Inbox watcher — When its sensor fires\n\n" +
        "If this work should keep running, set it up as a scheduled task (clock icon) first.",
    );
    expect(singleAgentArchiveBody({ status: "checked", active: [standup] })).toContain(
      "It has 1 wake-up that will never fire again:",
    );
  });

  it("a failed check says it couldn't check", () => {
    const check = { status: "unknown" as const, reason: "timeout" };
    expect(needsWakeupWarning(check)).toBe(true);
    expect(singleAgentArchiveBody(check)).toBe(
      `${ARCHIVE_AGENT_BODY}\n\nCouldn't check this agent's wake-ups — any it has will stop.`,
    );
  });

  it("several agents: names those with wake-ups and their counts, then those unchecked", () => {
    expect(
      multiAgentWakeupWarning([
        { label: "Wren", check: { status: "checked", active: [standup, inbox] } },
        { label: "Finch", check: { status: "checked", active: [standup] } },
        { label: "Robin", check: { status: "checked", active: [] } },
        { label: "Jay", check: { status: "unknown", reason: "timeout" } },
      ]),
    ).toBe(
      "2 of these agents have wake-ups that will stop: Wren (2), Finch (1).\n\n" +
        "Couldn't check the wake-ups of Jay — any they have will stop.\n\n" +
        "If this work should keep running, set it up as a scheduled task (clock icon) first.",
    );
    expect(multiAgentWakeupWarning([{ label: "Robin", check: { status: "checked", active: [] } }])).toBe("");
    expect(multiAgentWakeupWarning([])).toBe("");
  });
});
