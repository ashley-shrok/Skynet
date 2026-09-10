/**
 * Phase 97 Plan 06 — MultiBadgeAnchor drag-source tabId threading tests.
 *
 * These tests exercise the F-2 fix: threading the enclosing relay room tab's
 * `tabId` from `MultiBadgeAnchor` down through its two per-role cell
 * subcomponents (`HumanBadgeCell` + `AgentBadgeCell`) — and, via
 * `AgentBadgeWithMeter`, into every rendered `<IdentityBadge>`. This turns
 * each per-participant badge into a drag SOURCE that carries the ROOM tab's
 * tabId in dataTransfer, per D-05 "room-showing surface as drag source".
 *
 * The IdentityBadge primitive is unchanged (Phase 93 slice 1 contract).
 * `IdentityBadge.tsx:82` gates `isDragSource = !!tabId && !isMobile` — so
 * the presence of the `tabId` prop is the entire drag-source enabler.
 *
 * ## D-18 preservation
 *
 * `MultiBadgeAnchor` still does NOT pass `onClick` to any IdentityBadge —
 * the click contract stays inert in the relay case; only the drag-source
 * contract is enabled by threading tabId. The tests below assert this
 * separation explicitly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type {
  HumanParticipant,
  AgentParticipant,
} from "./sources/relay-room-api";

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number,
): Identity {
  return {
    identityKey,
    displayName,
    title: null,
    colorHue,
    voice: null,
    role: null,
    avatarMime: "image/png",
    avatarUrl: "/avatar.png",
    avatarEtag: "abc",
    coordinator: false,
    task: null,
  } as Identity;
}

const IDENTITIES_BY_KEY = new Map<string, Identity>([
  ["zoe", makeIdentity("zoe", "Zoe", 30)],
  ["ada", makeIdentity("ada", "Ada", 90)],
  ["nelly", makeIdentity("nelly", "Nelly", 150)],
  ["bare-agent", makeIdentity("bare-agent", "Bare Agent", 200)],
]);

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useIdentities: vi.fn(() => ({
      identities: Array.from(IDENTITIES_BY_KEY.values()),
      byKey: IDENTITIES_BY_KEY,
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

// AgentBadgeWithMeter transitively reads from these stores — mock them so
// the anchor tests do not require the real fleet-status subscription.
vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionIsWorking: vi.fn(() => false),
    useSessionIsRecycling: vi.fn(() => false),
  };
});

vi.mock("@/api/fleet-status-client", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionContextPct: vi.fn(() => null),
  };
});

vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

// Spy-mock IdentityBadge so we can inspect the props each badge cell passes.
// Renders a marker div with data-testid + data-tabid + data-has-onclick so
// the tests can grep the props off the DOM (avoids fragile spy-array
// bookkeeping).
const identityBadgePropsSpy = vi.fn();
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: (props: {
    identityKey?: string;
    tabId?: string;
    onClick?: unknown;
  }) => {
    identityBadgePropsSpy(props);
    return (
      <div
        data-testid="identity-badge-spy"
        data-identity-key={props.identityKey ?? ""}
        data-tabid={props.tabId ?? ""}
        data-has-onclick={props.onClick != null ? "true" : "false"}
      />
    );
  },
}));

import { MultiBadgeAnchor } from "./MultiBadgeAnchor";

const ZOE_MXID = "@zoe:matrix.example.com";
const NELLY_MXID = "@nelly:matrix.example.com";
const ADA_MXID = "@ada:matrix.example.com";
const BARE_AGENT_MXID = "@bare-agent:matrix.example.com";
const VIEWER_MXID = "@viewer:matrix.example.com";

function makeHumans(): HumanParticipant[] {
  return [{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }];
}

// Mix of agents: nelly + ada have host mappings (AgentBadgeWithMeter branch);
// bare-agent has NO host mapping (fallback branch — plain IdentityBadge).
function makeMixedAgents(): AgentParticipant[] {
  return [
    { mxid: NELLY_MXID, identityKey: "nelly" },
    { mxid: ADA_MXID, identityKey: "ada" },
    { mxid: BARE_AGENT_MXID, identityKey: "bare-agent" },
  ];
}

const FLEET_HOSTS_MIXED: Record<string, number> = {
  // bare-agent intentionally omitted → fallback branch inside AgentBadgeCell.
  nelly: 5,
  ada: 5,
};

const TAB_ID = "relay-tab-abc-123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MultiBadgeAnchor — Phase 97 Plan 06 tabId drag-source threading", () => {
  it("Test 1: with tabId prop, every rendered IdentityBadge receives that tabId", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: makeHumans(),
          agents: makeMixedAgents(),
        }}
        viewingUserMxid={VIEWER_MXID}
        fleetIdentityHosts={FLEET_HOSTS_MIXED}
        isReady={true}
        tabId={TAB_ID}
      />,
    );
    const badges = Array.from(
      container.querySelectorAll('[data-testid="identity-badge-spy"]'),
    );
    // 1 human + 3 agents = 4 badges rendered.
    expect(badges.length).toBe(4);
    for (const badge of badges) {
      expect(badge.getAttribute("data-tabid")).toBe(TAB_ID);
    }
  });

  it("Test 2: without tabId prop, IdentityBadges receive no tabId (pre-plan regression floor)", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: makeHumans(),
          agents: makeMixedAgents(),
        }}
        viewingUserMxid={VIEWER_MXID}
        fleetIdentityHosts={FLEET_HOSTS_MIXED}
        isReady={true}
        // no tabId
      />,
    );
    const badges = Array.from(
      container.querySelectorAll('[data-testid="identity-badge-spy"]'),
    );
    expect(badges.length).toBe(4);
    for (const badge of badges) {
      // Undefined tabId is rendered as an empty data attribute.
      expect(badge.getAttribute("data-tabid")).toBe("");
    }
  });

  it("Test 3: mixed participant list — HumanBadgeCell + AgentBadgeCell fallback + AgentBadgeWithMeter branches all receive tabId", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: makeHumans(),
          agents: makeMixedAgents(),
        }}
        viewingUserMxid={VIEWER_MXID}
        fleetIdentityHosts={FLEET_HOSTS_MIXED}
        isReady={true}
        tabId={TAB_ID}
      />,
    );
    // Human cell (Zoe) — plain IdentityBadge, HumanBadgeCell branch.
    const humanCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    expect(humanCell).not.toBeNull();
    const humanBadge = humanCell?.querySelector(
      '[data-testid="identity-badge-spy"]',
    );
    expect(humanBadge?.getAttribute("data-tabid")).toBe(TAB_ID);
    expect(humanBadge?.getAttribute("data-identity-key")).toBe("zoe");

    // bare-agent cell — plain IdentityBadge inside AgentBadgeCell fallback
    // branch (no host mapping). Identify via data-mxid.
    const bareAgentCell = container.querySelector(
      `[data-testid="relay-room-participant"][data-mxid="${BARE_AGENT_MXID}"]`,
    );
    expect(bareAgentCell).not.toBeNull();
    const bareAgentBadge = bareAgentCell?.querySelector(
      '[data-testid="identity-badge-spy"]',
    );
    expect(bareAgentBadge?.getAttribute("data-tabid")).toBe(TAB_ID);
    // Fallback branch: no appendage.
    expect(
      bareAgentCell?.querySelector('[data-appendage="true"]'),
    ).toBeNull();

    // nelly cell — AgentBadgeWithMeter branch (host mapping present).
    const nellyCell = container.querySelector(
      `[data-testid="relay-room-participant"][data-mxid="${NELLY_MXID}"]`,
    );
    expect(nellyCell).not.toBeNull();
    const nellyBadge = nellyCell?.querySelector(
      '[data-testid="identity-badge-spy"]',
    );
    expect(nellyBadge?.getAttribute("data-tabid")).toBe(TAB_ID);
    // AgentBadgeWithMeter branch: has appendage.
    expect(nellyCell?.querySelector('[data-appendage="true"]')).not.toBeNull();
  });

  it("Test 4 (D-18 preservation): MultiBadgeAnchor does NOT pass onClick to any IdentityBadge, even with tabId set", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: makeHumans(),
          agents: makeMixedAgents(),
        }}
        viewingUserMxid={VIEWER_MXID}
        fleetIdentityHosts={FLEET_HOSTS_MIXED}
        isReady={true}
        tabId={TAB_ID}
      />,
    );
    const badges = Array.from(
      container.querySelectorAll('[data-testid="identity-badge-spy"]'),
    );
    expect(badges.length).toBe(4);
    for (const badge of badges) {
      // D-18: click contract stays inert in the relay case.
      expect(badge.getAttribute("data-has-onclick")).toBe("false");
    }
    // Spy-side assertion: no call ever received an onClick prop.
    for (const call of identityBadgePropsSpy.mock.calls) {
      const props = call[0] as { onClick?: unknown };
      expect(props.onClick).toBeUndefined();
    }
  });

  it("Test 5 (integration shape): the tabId prop threads through to the AgentBadgeWithMeter branch's inner IdentityBadge (D-05 room-drag source parity)", () => {
    // This mirrors what PrettyView.tsx's relay-case mount will produce once
    // it passes tabId={tabId}: every participant badge becomes a drag source
    // carrying the room tab's tabId in dataTransfer via IdentityBadge's
    // isDragSource gate.
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [],
          agents: [{ mxid: NELLY_MXID, identityKey: "nelly" }],
        }}
        viewingUserMxid={VIEWER_MXID}
        fleetIdentityHosts={{ nelly: 5 }}
        isReady={true}
        tabId={TAB_ID}
      />,
    );
    // Exactly one badge (nelly, AgentBadgeWithMeter branch).
    const badges = Array.from(
      container.querySelectorAll('[data-testid="identity-badge-spy"]'),
    );
    expect(badges.length).toBe(1);
    expect(badges[0].getAttribute("data-tabid")).toBe(TAB_ID);
    expect(badges[0].getAttribute("data-identity-key")).toBe("nelly");
    // The badge sits inside the AgentBadgeWithMeter drawer wrapper.
    const cell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="agent"]',
    );
    expect(cell?.querySelector('[data-appendage="true"]')).not.toBeNull();
  });
});
