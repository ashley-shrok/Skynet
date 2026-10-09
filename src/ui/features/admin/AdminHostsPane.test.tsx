import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AdminHostOverview } from "@/api/admin-hosts-api";
import { AdminHostsPane, needsAttention } from "./AdminHostsPane";

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
  name: "ashley-beelink",
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
  name: "ashley-laptop",
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

describe("AdminHostsPane", () => {
  it("summarises and sorts machines needing attention first", async () => {
    render(<AdminHostsPane />);
    const summary = await screen.findByTestId("admin-hosts-summary");
    expect(summary.textContent).toContain("5 hosts");
    expect(summary.textContent).toContain("4 online");
    expect(summary.textContent).toContain("3 need attention");

    const order = screen
      .getAllByTestId(/^admin-host-[a-z0-9]+$/)
      .map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual([
      "admin-host-beelink",
      "admin-host-laptop",
      "admin-host-zoey",
      "admin-host-aither",
      "admin-host-t1000",
    ]);
  });

  it("renders resource meters and agent-host health", async () => {
    render(<AdminHostsPane />);
    const card = await screen.findByTestId("admin-host-t1000");
    const c = within(card);
    expect(c.getByTestId("admin-host-t1000-cpu").textContent).toContain("load 1.0 / 4 cores");
    expect(c.getByTestId("admin-host-t1000-mem").textContent).toContain("4.0 GB / 16 GB");
    expect(c.getByTestId("admin-host-t1000-disk").textContent).toContain("60 GB free");
    expect(card.textContent).toContain("14 agents");
    expect(card.textContent).toContain("4 running");
    expect(card.textContent).toContain("substrate synced 3m ago");
    expect(card.textContent).toContain("supervisor running");
    expect(card.textContent).toContain("Ubuntu 24.04 · x86_64 · up 1d 1h");
  });

  it("shows substrate failure reason and supervisor down", async () => {
    render(<AdminHostsPane />);
    const card = await screen.findByTestId("admin-host-beelink");
    expect(card.textContent).toContain("substrate sync failed");
    expect(card.textContent).toContain("couldn't connect over SSH");
    expect(card.textContent).toContain("supervisor down");
  });

  it("explains missing readings and offline hosts", async () => {
    render(<AdminHostsPane />);
    expect((await screen.findByTestId("admin-host-aither")).textContent).toContain(
      "No resource readings — reachable over RDP only · 2 ms",
    );
    expect(screen.getByTestId("admin-host-laptop-status").textContent).toBe(
      "unreachable · last seen 3d ago",
    );
  });

  it("skips polls while the browser tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    render(<AdminHostsPane />);
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

  it("shows an error when the overview fails to load", async () => {
    m.getAdminHosts.mockRejectedValue(new Error("boom"));
    render(<AdminHostsPane />);
    expect(await screen.findByTestId("admin-hosts-error")).toBeTruthy();
  });
});

describe("needsAttention", () => {
  it("flags CPU only once load reaches the core count", () => {
    const withLoad = (load1: number) =>
      host({ key: "n", name: "n", resources: { ...host({ key: "", name: "" }).resources!, load1, cores: 4 } });
    expect(needsAttention(withLoad(3.2))).toBe(false);
    expect(needsAttention(withLoad(4.1))).toBe(true);
    expect(needsAttention(host({ key: "ok", name: "ok" }))).toBe(false);
  });
});
