/**
 * Admin → Hosts as an admin drives it (apple-ux shape-admin-modals):
 * the summary line, "Needs attention" (each row says why) above "Running
 * fine", a host one level deeper (readings, agents, about; ‹ Hosts and Esc
 * go back), polling only while the tab is visible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminHostOverview } from "@/api/admin-hosts-api";
import { AdminHostsPane, attentionReasons, needsAttention } from "./AdminHostsPane";

const m = vi.hoisted(() => ({ getAdminHosts: vi.fn() }));
vi.mock("@/api/admin-hosts-api", () => ({ getAdminHosts: m.getAdminHosts }));

const NOW = Date.now();
const GB = 1024 * 1024;

function host(p: Partial<AdminHostOverview> & { key: string; name: string }): AdminHostOverview {
  return {
    address: p.key,
    protocols: ["ssh"],
    agentHost: false,
    online: true,
    latencyMs: 20,
    lastSeenAt: NOW,
    resources: {
      os: "Ubuntu 24.04",
      arch: "x86_64",
      uptimeSec: 90000,
      cores: 4,
      load1: 1,
      memTotalKb: 16 * GB,
      memAvailKb: 12 * GB,
      diskTotalKb: 100 * GB,
      diskUsedKb: 40 * GB,
      diskAvailKb: 60 * GB,
    },
    resourcesNote: null,
    fleet: null,
    substrate: null,
    ...p,
  };
}

const HEALTHY_AGENT = host({
  key: "t1000",
  name: "Skynet",
  agentHost: true,
  fleet: { agents: 14, running: 4, apps: 3, supervisorRunning: true },
  substrate: { lastSuccessAt: NOW - 3 * 60_000, lastFailureAt: null, lastError: null, consecutiveFailures: 0, inFlight: false },
});
const FULL_DISK = host({
  key: "zoey",
  name: "ZoeyBattlestation",
  resources: { ...host({ key: "", name: "" }).resources!, diskUsedKb: 95 * GB, diskAvailKb: 5 * GB },
});
const BROKEN_AGENT = host({
  key: "beelink",
  name: "alice-beelink",
  agentHost: true,
  fleet: { agents: 5, running: 0, apps: 0, supervisorRunning: false },
  substrate: { lastSuccessAt: null, lastFailureAt: NOW - 60_000, lastError: "couldn't connect over SSH", consecutiveFailures: 3, inFlight: false },
});
const RDP_ONLY = host({
  key: "aither",
  name: "aither-cloud-prod",
  protocols: ["rdp"],
  resources: null,
  resourcesNote: "no_ssh",
  latencyMs: 2,
});
const OFFLINE = host({
  key: "laptop",
  name: "alice-laptop",
  online: false,
  latencyMs: null,
  lastSeenAt: NOW - 3 * 86_400_000,
  resources: null,
  resourcesNote: "probe_failed",
});

beforeEach(() => {
  m.getAdminHosts.mockResolvedValue({
    hosts: [HEALTHY_AGENT, RDP_ONLY, FULL_DISK, BROKEN_AGENT, OFFLINE],
    generatedAt: NOW,
  });
});
afterEach(() => vi.clearAllMocks());

/** The window keeps which host is open; this stands in for it. */
function Harness() {
  const [key, setKey] = useState<string | null>(null);
  return <AdminHostsPane selectedKey={key} onSelect={setKey} />;
}

const rowsIn = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByTestId(/^admin-host-[a-z0-9]+$/)
    .map((el) => el.getAttribute("data-testid"));

describe("AdminHostsPane — the list", () => {
  it("summarises, then lists hosts needing attention above the ones running fine", async () => {
    render(<Harness />);
    const summary = await screen.findByTestId("admin-hosts-summary");
    expect(summary.textContent).toContain("5 hosts · 4 online · 3 need attention · updated just now");
    expect(rowsIn("admin-hosts-attention")).toEqual(["admin-host-beelink", "admin-host-laptop", "admin-host-zoey"]);
    expect(rowsIn("admin-hosts-fine")).toEqual(["admin-host-aither", "admin-host-t1000"]);
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Running fine")).toBeTruthy();
  });

  it("each host that needs attention says why", async () => {
    render(<Harness />);
    expect((await screen.findByTestId("admin-host-beelink")).textContent).toContain(
      "Agent supervisor down · Substrate sync failing since 1m ago",
    );
    expect(screen.getByTestId("admin-host-laptop").textContent).toContain("Unreachable · last seen 3d ago");
    expect(screen.getByTestId("admin-host-zoey").textContent).toContain("Disk 95% full");
  });

  it("hosts running fine get one quiet line", async () => {
    render(<Harness />);
    expect((await screen.findByTestId("admin-host-t1000")).textContent).toContain(
      "4 of 14 agents running · memory 25% · 60 GB free",
    );
    expect(screen.getByTestId("admin-host-aither").textContent).toContain("RDP · 2 ms");
    expect(screen.getByTestId("admin-host-t1000").textContent).toContain("Agents");
    expect(screen.getByTestId("admin-host-aither").textContent).toContain("Remote");
  });

  it("with nothing wrong there are no group titles", async () => {
    m.getAdminHosts.mockResolvedValue({ hosts: [HEALTHY_AGENT], generatedAt: NOW });
    render(<Harness />);
    await screen.findByTestId("admin-host-t1000");
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("Running fine")).toBeNull();
  });

  it("skips polls while the browser tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    render(<Harness />);
    await screen.findByTestId("admin-hosts-summary");
    expect(m.getAdminHosts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(m.getAdminHosts).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(m.getAdminHosts).toHaveBeenCalledTimes(2);
    hidden.mockRestore();
    vi.useRealTimers();
  });

  it("never starts a second read while one is still on its way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (v: unknown) => void = () => {};
    m.getAdminHosts.mockReturnValueOnce(new Promise((r) => (release = r)));
    render(<Harness />);
    await vi.advanceTimersByTimeAsync(31_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(m.getAdminHosts).toHaveBeenCalledTimes(1);
    release({ hosts: [HEALTHY_AGENT], generatedAt: NOW });
    await screen.findByTestId("admin-host-t1000");
    vi.useRealTimers();
  });

  it("a host whose sync keeps failing stays flagged while a retry runs", async () => {
    const retrying = { ...BROKEN_AGENT, fleet: { ...BROKEN_AGENT.fleet!, supervisorRunning: true }, substrate: { ...BROKEN_AGENT.substrate!, inFlight: true } };
    expect(needsAttention(retrying)).toBe(true);
  });

  it("shows an error when the overview fails to load", async () => {
    m.getAdminHosts.mockRejectedValue(new Error("boom"));
    render(<Harness />);
    expect(await screen.findByTestId("admin-hosts-error")).toBeTruthy();
  });
});

describe("AdminHostsPane — one host", () => {
  it("an agent host: readings, agents and about; ‹ Hosts goes back", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByTestId("admin-host-t1000"));
    const view = screen.getByTestId("admin-host-view-t1000");
    expect(screen.getByTestId("admin-host-t1000-status").textContent).toContain("Online · Runs agents");
    expect(view.textContent).toContain("load 1.0 on 4 cores");
    expect(view.textContent).toContain("4.0 GB of 16 GB");
    expect(view.textContent).toContain("60 GB free");
    expect(screen.getByTestId("admin-host-t1000-cpu")).toBeTruthy();
    expect(view.textContent).toContain("4 running of 14");
    expect(view.textContent).toContain("Synced 3m ago");
    expect(view.textContent).toContain("Running");
    expect(view.textContent).toContain("Ubuntu 24.04 · x86_64");
    expect(view.textContent).toContain("1d 1h");
    expect(screen.queryByTestId("admin-host-t1000-reasons")).toBeNull();
    await userEvent.click(screen.getByTestId("admin-host-back"));
    expect(await screen.findByTestId("admin-hosts-pane")).toBeTruthy();
  });

  it("a broken agent host says why on top and shows the sync error", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByTestId("admin-host-beelink"));
    expect(screen.getByTestId("admin-host-beelink-reasons").textContent).toContain("Agent supervisor down");
    const view = screen.getByTestId("admin-host-view-beelink");
    expect(view.textContent).toContain("Down");
    expect(view.textContent).toContain("Failing since 1m ago");
    expect(view.textContent).toContain("couldn't connect over SSH");
  });

  it("a host with no readings says why; Esc goes back", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByTestId("admin-host-aither"));
    const view = screen.getByTestId("admin-host-view-aither");
    expect(view.textContent).toContain("No readings — reachable over RDP only · 2 ms");
    expect(view.textContent).toContain("Remote host");
    expect(view.textContent).not.toContain("Resources");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByTestId("admin-hosts-pane")).toBeTruthy();
  });

  it("an unreachable host shows when it was last seen", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByTestId("admin-host-laptop"));
    expect(screen.getByTestId("admin-host-laptop-status").textContent).toContain("Unreachable · last seen 3d ago");
  });
});

describe("needsAttention / attentionReasons", () => {
  const withLoad = (load1: number) =>
    host({ key: "n", name: "n", resources: { ...host({ key: "", name: "" }).resources!, load1, cores: 4 } });

  it("flags CPU only once load reaches the core count", () => {
    expect(needsAttention(withLoad(3.2))).toBe(false);
    expect(needsAttention(withLoad(4.1))).toBe(true);
    expect(needsAttention(host({ key: "ok", name: "ok" }))).toBe(false);
  });

  it("puts the reasons in words, most serious first", () => {
    expect(attentionReasons(withLoad(4.1), NOW)).toEqual(["CPU busy · load 4.1 on 4 cores"]);
    expect(attentionReasons(BROKEN_AGENT, NOW)[0]).toBe("Agent supervisor down");
    expect(attentionReasons(host({ key: "ok", name: "ok" }), NOW)).toEqual([]);
  });
});
