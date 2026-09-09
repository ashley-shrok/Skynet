/**
 * Phase 93 Slice 2 Task 3 — PrettyView badge-anchor case-branch tests.
 *
 * PrettyView's upper-right badge anchor is now case-branched on
 * `source.kind`:
 *   - harness: renders exactly one <IdentityBadge> as today, byte-identical.
 *   - relay:   renders <MultiBadgeAnchor> (Task 2) at the same anchor.
 *
 * Regression floor: the harness case DOM at the badge anchor is
 * byte-identical to Slice 1 baseline. See Pitfall 1 in RESEARCH.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";
import type { Identity } from "@/api/identities-api";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
const sessionMatchKeyMock = vi.fn(() => null as string | null);

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) =>
    sessionMatchKeyMock(name as unknown as never),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

// IdentityBadge mock: render an identifiable node so tests can assert on
// presence and count. Preserve the position class from
// IdentityBadge.tsx:110 (`absolute top-4 right-5 z-[101]`) so harness case
// can assert byte-identical layout at the badge anchor.
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: (props: { identityKey: string | null }) =>
    props.identityKey ? (
      <div
        data-testid="mock-identity-badge"
        className="pv-identity-breathe absolute top-4 right-5 z-[101]"
        data-identity-key={props.identityKey}
      />
    ) : null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

// Viewing user mock — MultiBadgeAnchor needs a stable value for self-exclusion.
vi.mock("@/state/viewing-user-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useViewingUserMxid: vi.fn(() => "@viewer:example.com"),
  };
});

// Identities store — MultiBadgeAnchor's HumanBadgeCell resolves mxid → identity.
const IDENTITIES_BY_KEY = new Map<string, Identity>();

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: IDENTITIES_BY_KEY,
      loaded: true,
      refresh: vi.fn(),
    })),
    buildIdentityHostsFromFleet: vi.fn(() => ({})),
  };
});

// Session working store mocked for AgentBadgeWithMeter transitive reads.
vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionIsWorking: vi.fn(() => false),
    useSessionIsWorkingRaw: vi.fn(() => "idle"),
    useSessionIsRecycling: vi.fn(() => false),
  };
});

// Adapter mock — Slice 2 Task 3 mounts MultiBadgeAnchor when source.kind
// === 'relay' and threads adapter.participants + adapter.isReady. Provide a
// controllable mock so tests can drive the ready/loading branch.
type AdapterState = {
  messages: unknown[];
  participants: {
    humans: Array<{ mxid: string; displayName: string; userId: string }>;
    agents: Array<{ mxid: string; identityKey: string }>;
  } | null;
  sendMessage: (b: string, m: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
};
const adapterMock = vi.fn<() => AdapterState>();

vi.mock("./sources/use-chat-surface-adapter", () => ({
  useChatSurfaceAdapter: (
    ..._args: unknown[]
  ): AdapterState => adapterMock(),
}));

import { PrettyView } from "./PrettyView";
import { openClaudeSessionSocket } from "@/api/claude-session-api";

const openClaudeSessionSocketMock =
  openClaudeSessionSocket as unknown as ReturnType<typeof vi.fn>;

function defaultAdapterState(overrides: Partial<AdapterState> = {}): AdapterState {
  return {
    messages: [],
    participants: { humans: [], agents: [] },
    sendMessage: vi.fn(async () => false),
    error: null,
    isReady: false,
    ...overrides,
  };
}

describe("PrettyView — Phase 93 Slice 2 multi-badge case-branch", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    openClaudeSessionSocketMock.mockClear();
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    sessionMatchKeyMock.mockReturnValue(null);
    adapterMock.mockReturnValue(defaultAdapterState());
    resizeObserverStub = vi.fn(function () {
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1 (harness regression floor): harness source renders exactly ONE badge at 'absolute top-4 right-5 z-[101]'", () => {
    sessionMatchKeyMock.mockReturnValue("tina");

    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1", tabId: "t1" }}
        hostId={1}
        tmuxSession="s1"
        tabId="t1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    const badges = container.querySelectorAll(
      '[data-testid="mock-identity-badge"]',
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]?.className).toContain("absolute top-4 right-5 z-[101]");
    // Preserves the pv-identity-breathe class.
    expect(badges[0]?.className).toContain("pv-identity-breathe");
  });

  it("Test 2 (harness does NOT mount MultiBadgeAnchor)", () => {
    sessionMatchKeyMock.mockReturnValue("tina");

    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1" }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    expect(
      container.querySelector('[data-testid="multi-badge-anchor"]'),
    ).toBeNull();
  });

  it("Test 3 (relay case mounts MultiBadgeAnchor + hides single-badge)", () => {
    // Even with an identity key resolvable, the harness single-badge mount
    // MUST NOT render for a relay source.
    sessionMatchKeyMock.mockReturnValue("tina");
    adapterMock.mockReturnValue(
      defaultAdapterState({
        isReady: true,
        participants: {
          humans: [
            { mxid: "@zoe:x", displayName: "Zoe", userId: "2" },
          ],
          agents: [],
        },
      }),
    );

    const { container } = render(
      <PrettyView
        source={{
          kind: "relay",
          roomId: "!x:example",
          roomTitle: "test",
        }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    // MultiBadgeAnchor mounted.
    expect(
      container.querySelector('[data-testid="multi-badge-anchor"]'),
    ).not.toBeNull();
    // Harness single-badge NOT mounted (mock renders it as
    // "mock-identity-badge" — MultiBadgeAnchor's cells use IdentityBadge
    // internally too, so we count all badge mounts and assert the relay
    // participant path is what rendered them.
    // No bare IdentityBadge sitting DIRECTLY under the PrettyView root
    // outside the multi-badge-anchor container.
    const anchor = container.querySelector(
      '[data-testid="multi-badge-anchor"]',
    )!;
    // Harness single-badge mount would emit a badge that is NOT inside the
    // anchor; assert every badge is a descendant of the anchor.
    const allBadges = container.querySelectorAll(
      '[data-testid="mock-identity-badge"]',
    );
    allBadges.forEach((b) => {
      expect(anchor.contains(b)).toBe(true);
    });
  });

  it("Test 4 (relay case renders passed participants)", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({
        isReady: true,
        participants: {
          humans: [
            { mxid: "@a:x", displayName: "Alice", userId: "1" },
            { mxid: "@b:x", displayName: "Bob", userId: "2" },
          ],
          agents: [{ mxid: "@nelly:x", identityKey: "nelly" }],
        },
      }),
    );

    const { container } = render(
      <PrettyView
        source={{
          kind: "relay",
          roomId: "!x:example",
          roomTitle: "test",
        }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    // Alice + Bob + Nelly — 3 participants total (viewing user @viewer:example
    // is not in the participants list).
    const cells = container.querySelectorAll(
      '[data-testid="relay-room-participant"]',
    );
    expect(cells.length).toBe(3);
  });

  it("Test 5 (task-pill unchanged): no regression on the centered task-pill anchor", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // Task pill anchor class stays at 'absolute top-4 left-1/2
    // -translate-x-1/2 z-[100]'. Grep-based check that the string is intact.
    expect(
      src.includes("absolute top-4 left-1/2 -translate-x-1/2 z-[100]"),
    ).toBe(true);
  });

  it("Test 6 (source-file discipline): source.kind === 'harness' guards the badge mount", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // At least 2 sites reading source.kind === "harness" (one is the
    // ingestion effect gate from Slice 1; Slice 2 adds the badge anchor).
    const harnessMatches =
      src.match(/source\.kind === "harness"/g)?.length ?? 0;
    expect(harnessMatches).toBeGreaterThanOrEqual(2);
    // At least 1 site reading source.kind === "relay" (the MultiBadgeAnchor
    // mount gate).
    const relayMatches = src.match(/source\.kind === "relay"/g)?.length ?? 0;
    expect(relayMatches).toBeGreaterThanOrEqual(1);
    // MultiBadgeAnchor imported and used (import + JSX).
    expect(src.match(/MultiBadgeAnchor/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    // isReady threaded to MultiBadgeAnchor.
    expect(
      /adapter\.isReady|isReady=\{adapter/.test(src) ||
        /isReady=\{chatSurfaceAdapter/.test(src),
    ).toBe(true);
  });

  it("Test 7 (loading state passthrough, Warning 2): relay + isReady=false renders loading placeholder", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({
        isReady: false,
        participants: { humans: [], agents: [] },
      }),
    );

    const { container } = render(
      <PrettyView
        source={{
          kind: "relay",
          roomId: "!x:example",
          roomTitle: "test",
        }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    expect(
      container.querySelector('[data-testid="multi-badge-anchor-loading"]'),
    ).not.toBeNull();
  });
});
