/**
 * Phase 90 Plan 05 Task 2 — IdentityBadgeRow tests.
 *
 * IdentityBadgeRow is the horizontal participant row at the top of the
 * relay-room pane:
 *   - D-07 humans first (alphabetical by displayName) then agents
 *     (alphabetical by identityKey), with the viewing user excluded from the
 *     humans list.
 *   - D-09 humans get the plain IdentityBadge with NO appendage — absence is
 *     the human/agent visual distinction.
 *   - Per-agent cell is a placeholder in this plan (Plan 06 fills the
 *     appendage). Exposes a `data-slot="agent-badge-appendage"` cell for Plan
 *     06 to replace.
 *   - D-20 narrow-viewport: overflow-x-auto fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { HumanParticipant, AgentParticipant } from "./relay-room-api";

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

// Populate byKey so IdentityBadge can resolve human + agent keys.
const IDENTITIES_BY_KEY = new Map<string, Identity>([
  ["ashley", makeIdentity("ashley", "Ashley", 200)],
  ["zoe", makeIdentity("zoe", "Zoe", 30)],
  ["ada", makeIdentity("ada", "Ada", 90)],
  ["nelly", makeIdentity("nelly", "Nelly", 150)],
]);

vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: Array.from(IDENTITIES_BY_KEY.values()),
    byKey: IDENTITIES_BY_KEY,
    loaded: true,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { IdentityBadgeRow } from "./IdentityBadgeRow";

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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("IdentityBadgeRow (Phase 90 Plan 05 Task 2)", () => {
  it("Test 1 (D-07): humans first alphabetical then agents alphabetical, viewing user excluded", () => {
    const { container } = render(
      <IdentityBadgeRow
        humans={makeHumans()}
        agents={makeAgents()}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    // Read the rendered testids in DOM order — first HumanBadgeCells,
    // then AgentBadgeCellPlaceholders. Row cells expose a
    // data-testid="relay-room-participant" with a data-mxid attr.
    const cells = Array.from(
      container.querySelectorAll('[data-testid="relay-room-participant"]'),
    );
    // Expected order: Zoe (human — Ashley excluded), then agents alphabetical
    // by identityKey → ada, nelly.
    expect(cells.length).toBe(3);
    expect(cells[0].getAttribute("data-mxid")).toBe(ZOE_MXID);
    expect(cells[0].getAttribute("data-role")).toBe("human");
    expect(cells[1].getAttribute("data-mxid")).toBe(ADA_MXID);
    expect(cells[1].getAttribute("data-role")).toBe("agent");
    expect(cells[2].getAttribute("data-mxid")).toBe(NELLY_MXID);
    expect(cells[2].getAttribute("data-role")).toBe("agent");
  });

  it("Test 2 (D-09): human cells render WITHOUT an appendage marker", () => {
    const { container } = render(
      <IdentityBadgeRow
        humans={[{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }]}
        agents={[]}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    // The appendage slot marker MUST NOT appear on any human cell.
    const humanCells = container.querySelectorAll(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    expect(humanCells.length).toBe(1);
    for (const cell of Array.from(humanCells)) {
      expect(
        cell.querySelector('[data-slot="agent-badge-appendage"]'),
      ).toBeNull();
    }
  });

  it("Test 3: agent cell renders the plain badge PLUS a data-slot='agent-badge-appendage' placeholder container", () => {
    const { container } = render(
      <IdentityBadgeRow
        humans={[]}
        agents={[{ mxid: NELLY_MXID, identityKey: "nelly" }]}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    const agentCells = container.querySelectorAll(
      '[data-testid="relay-room-participant"][data-role="agent"]',
    );
    expect(agentCells.length).toBe(1);
    // Placeholder slot present for Plan 06 to fill.
    expect(
      agentCells[0].querySelector('[data-slot="agent-badge-appendage"]'),
    ).not.toBeNull();
    // Plain badge (from IdentityBadge primitive) also present — verify by
    // presence of the identity-badge-root testid.
    expect(
      agentCells[0].querySelector('[data-testid="identity-badge-root"]'),
    ).not.toBeNull();
  });

  it("Test 4 (D-20): outer row container uses overflow-x-auto for narrow-viewport fallback", () => {
    const { container } = render(
      <IdentityBadgeRow
        humans={makeHumans()}
        agents={makeAgents()}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    const row = container.querySelector(
      '[data-testid="relay-room-identity-badge-row"]',
    );
    expect(row).not.toBeNull();
    expect(row!.className).toContain("overflow-x-auto");
  });

  it("Test 5: uses the existing IdentityBadge primitive (grep-verifiable import)", async () => {
    // Import site verified by grep in acceptance criteria; here we assert the
    // primitive actually mounts — its testid appears in the DOM.
    const { container } = render(
      <IdentityBadgeRow
        humans={[{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }]}
        agents={[]}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    expect(
      container.querySelector('[data-testid="identity-badge-root"]'),
    ).not.toBeNull();
  });

  it("Test 6: absolute positioning of IdentityBadge is neutralized inside the row", () => {
    // The IdentityBadge primitive's rootClassName carries `absolute top-4
    // right-5 z-[101]` — inside a row that would break the horizontal
    // layout. The row cell wraps IdentityBadge in a container that
    // establishes a positioning context (relative) so the absolute
    // positioning becomes a no-op relative to that cell rather than the
    // page. Assert the immediate parent of the identity-badge-root carries
    // the "relative" class (or similar positioning context marker).
    const { container } = render(
      <IdentityBadgeRow
        humans={[{ mxid: ZOE_MXID, displayName: "Zoe", userId: "2" }]}
        agents={[]}
        viewingUserMxid={ASHLEY_MXID}
      />,
    );
    const badge = container.querySelector(
      '[data-testid="identity-badge-root"]',
    );
    expect(badge).not.toBeNull();
    const parent = badge!.parentElement;
    expect(parent).not.toBeNull();
    // The wrapper carries `relative` to establish a non-absolute positioning
    // context for the badge's absolute positioning.
    expect(parent!.className).toContain("relative");
  });

  it("Test 7: viewing-user filter is a no-op when viewingUserMxid does not match any human", () => {
    const { container } = render(
      <IdentityBadgeRow
        humans={makeHumans()}
        agents={[]}
        viewingUserMxid="@stranger:elsewhere.com"
      />,
    );
    const humanCells = container.querySelectorAll(
      '[data-testid="relay-room-participant"][data-role="human"]',
    );
    // Both humans render (Zoe + Ashley); sorted alphabetically by displayName.
    expect(humanCells.length).toBe(2);
    expect(humanCells[0].getAttribute("data-mxid")).toBe(ASHLEY_MXID);
    expect(humanCells[1].getAttribute("data-mxid")).toBe(ZOE_MXID);
  });
});
