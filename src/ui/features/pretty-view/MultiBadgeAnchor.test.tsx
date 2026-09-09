/**
 * Phase 93 Slice 2 Task 2 — MultiBadgeAnchor tests.
 *
 * MultiBadgeAnchor is the multi-badge extension of PrettyView's upper-right
 * badge anchor. Only mounted when `source.kind === "relay"` (Slice 2 Task 3).
 * Renders leftward-growing badges: humans-first-alphabetical then
 * agents-alphabetical, viewing-user self-excluded (D-03).
 *
 * ## Loading vs. empty state discrimination (Warning 2 fix)
 *
 * When `isReady={false}` (WS still connecting), MultiBadgeAnchor renders a
 * subtle placeholder so the relay tab does NOT appear empty during the
 * WS-connecting window. When `isReady={true}` with zero non-self
 * participants, renders nothing (empty case).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type {
  HumanParticipant,
  AgentParticipant,
} from "@/features/relay-room-pane/relay-room-api";

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
  ["ashley", makeIdentity("ashley", "Ashley", 200)],
  ["zoe", makeIdentity("zoe", "Zoe", 30)],
  ["ada", makeIdentity("ada", "Ada", 90)],
  ["nelly", makeIdentity("nelly", "Nelly", 150)],
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

import { MultiBadgeAnchor } from "./MultiBadgeAnchor";

const ASHLEY_MXID = "@ashley:matrix.example.com";
const ZOE_MXID = "@zoe:matrix.example.com";
const ADA_MXID = "@ada:matrix.example.com";
const NELLY_MXID = "@nelly:matrix.example.com";

function makeHumans(): HumanParticipant[] {
  return [
    { mxid: ZOE_MXID, displayName: "Zoe", userId: "2" },
    { mxid: ASHLEY_MXID, displayName: "Ashley", userId: "1" },
  ];
}

function makeAgents(): AgentParticipant[] {
  return [
    { mxid: NELLY_MXID, identityKey: "nelly" },
    { mxid: ADA_MXID, identityKey: "ada" },
  ];
}

const DEFAULT_FLEET_HOSTS: Record<string, number> = {
  nelly: 5,
  ada: 5,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("MultiBadgeAnchor (Phase 93 Slice 2 Task 2)", () => {
  it("Test 1 (D-03 sort discipline): humans-alphabetical then agents-alphabetical in DOM order", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [
            { mxid: "@c:x", displayName: "Charlie", userId: "3" },
            { mxid: "@a:x", displayName: "Anna", userId: "1" },
            { mxid: "@b:x", displayName: "Bob", userId: "2" },
          ],
          agents: [
            { mxid: "@z:x", identityKey: "z" },
            { mxid: "@x:x", identityKey: "x" },
            { mxid: "@y:x", identityKey: "y" },
          ],
        }}
        viewingUserMxid="@viewer:example"
        fleetIdentityHosts={{ x: 1, y: 1, z: 1 }}
        isReady={true}
      />,
    );
    const cells = Array.from(
      container.querySelectorAll('[data-testid="relay-room-participant"]'),
    );
    // Per action §5 in the plan: agents first in DOM (visually rightmost via
    // flex-row-reverse), then humans. Within agents: x, y, z alphabetical.
    // Within humans: Anna, Bob, Charlie alphabetical.
    expect(cells.length).toBe(6);
    // DOM order: agents (x, y, z) then humans (Anna, Bob, Charlie).
    expect(cells[0].getAttribute("data-mxid")).toBe("@x:x");
    expect(cells[1].getAttribute("data-mxid")).toBe("@y:x");
    expect(cells[2].getAttribute("data-mxid")).toBe("@z:x");
    expect(cells[3].getAttribute("data-mxid")).toBe("@a:x");
    expect(cells[4].getAttribute("data-mxid")).toBe("@b:x");
    expect(cells[5].getAttribute("data-mxid")).toBe("@c:x");
  });

  it("Test 2 (D-03 self-exclusion): viewing user excluded from humans", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: makeHumans(),
          agents: [],
        }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    const humanCells = container.querySelectorAll(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    // Ashley excluded — only Zoe renders.
    expect(humanCells.length).toBe(1);
    expect(humanCells[0].getAttribute("data-mxid")).toBe(ZOE_MXID);
  });

  it("Test 3 (role attribution): each cell has data-role='human' or 'agent'", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }],
          agents: [{ mxid: NELLY_MXID, identityKey: "nelly" }],
        }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    const humanCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    const agentCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="agent"]',
    );
    expect(humanCell).not.toBeNull();
    expect(agentCell).not.toBeNull();
    expect(humanCell?.getAttribute("data-mxid")).toBe(ZOE_MXID);
    expect(agentCell?.getAttribute("data-mxid")).toBe(NELLY_MXID);
  });

  it("Test 4 (D-02 agent-cell has meter, human-cell does not)", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }],
          agents: [{ mxid: NELLY_MXID, identityKey: "nelly" }],
        }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    // Agent cell should contain the data-appendage='true' marker
    // (from AgentBadgeWithMeter — the D-09 humans-no-appendage discriminator).
    const agentCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="agent"]',
    );
    expect(agentCell?.querySelector('[data-appendage="true"]')).not.toBeNull();

    // Human cell must NOT contain the appendage marker (D-02: no meter on humans).
    const humanCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    expect(humanCell?.querySelector('[data-appendage="true"]')).toBeNull();
  });

  it("Test 5 (D-01 position): root container has 'absolute top-4 right-5 z-[101]'", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{ humans: makeHumans(), agents: [] }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    );
    expect(anchor).not.toBeNull();
    // Position parity with harness single-badge (per D-01) — same anchor
    // classes as PrettyView.tsx:3349-3366's IdentityBadge.
    expect(anchor?.className).toContain("absolute");
    expect(anchor?.className).toContain("top-4");
    expect(anchor?.className).toContain("right-5");
    expect(anchor?.className).toContain("z-[101]");
  });

  it("Test 6 (D-01 leftward growth): root uses flex-row-reverse", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{ humans: makeHumans(), agents: [] }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    );
    // flex-row-reverse means the FIRST DOM child is rightmost visually —
    // per D-01, badges grow LEFTWARD from the harness anchor.
    expect(anchor?.className).toContain("flex-row-reverse");
  });

  it("Test 7 (missing-host-mapping graceful degradation)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [],
          agents: [{ mxid: NELLY_MXID, identityKey: "nelly" }],
        }}
        viewingUserMxid={ASHLEY_MXID}
        // Empty map — agent has no host mapping.
        fleetIdentityHosts={{}}
        isReady={true}
      />,
    );
    // Agent cell still renders but WITHOUT appendage.
    const agentCell = container.querySelector(
      '[data-testid="relay-room-participant"][data-role="agent"]',
    );
    expect(agentCell).not.toBeNull();
    expect(agentCell?.querySelector('[data-appendage="true"]')).toBeNull();
    // Structured warn logged.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "agent_badge_no_host_mapping",
        identityKey: "nelly",
      }),
    );
    warnSpy.mockRestore();
  });

  it("Test 8 (loading state, Warning 2): isReady=false renders subtle placeholder", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{ humans: [], agents: [] }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={{}}
        isReady={false}
      />,
    );
    // Loading placeholder must appear.
    const loading = container.querySelector(
      '[data-testid="multi-badge-anchor-loading"]',
    );
    expect(loading).not.toBeNull();
    // No participant cells rendered while loading.
    const cells = container.querySelectorAll(
      '[data-testid="relay-room-participant"]',
    );
    expect(cells.length).toBe(0);
    // The anchor root still mounts so position class stays parked at D-01.
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    );
    expect(anchor).not.toBeNull();
  });

  it("Test 9 (empty state, Warning 2): isReady=true + only-self renders nothing", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [{ mxid: ASHLEY_MXID, displayName: "Ashley", userId: "1" }],
          agents: [],
        }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={{}}
        isReady={true}
      />,
    );
    // Empty case renders null — no anchor, no placeholder, no cells.
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    );
    expect(anchor).toBeNull();
    const loading = container.querySelector(
      '[data-testid="multi-badge-anchor-loading"]',
    );
    expect(loading).toBeNull();
    const cells = container.querySelectorAll(
      '[data-testid="relay-room-participant"]',
    );
    expect(cells.length).toBe(0);
  });

  it("Test 10 (ready-with-participants renders normally, Warning 2): isReady=true with non-self participants renders badges", () => {
    const { container } = render(
      <MultiBadgeAnchor
        participants={{
          humans: [{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }],
          agents: [{ mxid: NELLY_MXID, identityKey: "nelly" }],
        }}
        viewingUserMxid={ASHLEY_MXID}
        fleetIdentityHosts={DEFAULT_FLEET_HOSTS}
        isReady={true}
      />,
    );
    // No loading placeholder — we are ready.
    const loading = container.querySelector(
      '[data-testid="multi-badge-anchor-loading"]',
    );
    expect(loading).toBeNull();
    // Anchor mounted with badges.
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    );
    expect(anchor).not.toBeNull();
    const cells = container.querySelectorAll(
      '[data-testid="relay-room-participant"]',
    );
    expect(cells.length).toBe(2);
  });
});
