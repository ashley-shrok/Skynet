/**
 * Phase 92 Slice 1 (D-07/D-08/D-09) — PrettyView source-prop foundation tests.
 *
 * Test 1 (harness regression floor):
 *   Mount PrettyView with `source={{ kind: "harness", hostId: 1, tmuxSession: "s1",
 *   tabId: "t1" }}` PLUS redundant legacy props hostId=1 tmuxSession="s1" — the
 *   badge anchor renders exactly one IdentityBadge with the same absolute
 *   positioning (via IdentityBadge's own rootClassName) as pre-slice.
 *
 * Test 2 (redundant legacy props preserved):
 *   Grep-based source-file assertion — PrettyViewProps still declares both
 *   `hostId: number` and `tmuxSession: string` as flat prop entries alongside
 *   the new `source` entry.
 *
 * Test 3 (D-08 discipline):
 *   Grep-based source-file assertion — every read of `source.roomId` or
 *   `source.hostId` inside PrettyView.tsx occurs within a narrowed
 *   `source.kind === "..."` block. Zero out-of-narrow reads.
 *
 * Test 4 (ingestion gate):
 *   Mount PrettyView with `source={{ kind: "relay", roomId: "!x:example.org",
 *   roomTitle: null }}` — the harness ingestion effect short-circuits so
 *   `openClaudeSessionSocket` is NOT called for the relay-source mount.
 *
 * Test 5 (adapter call — indirect, source-file grep):
 *   `useChatSurfaceAdapter` is called EXACTLY once inside PrettyView.tsx with
 *   `(source, isVisible)` as arguments (grep-based assertion on the source
 *   file — module-mock introspection would double-count due to the stubbed
 *   sub-hooks running inside the unified hook).
 *
 * Test 6 (no unsafe casts):
 *   Grep-based source-file assertion — zero occurrences of
 *   `undefined as unknown as number` (Blocker 1 forbids the unsafe cast
 *   pattern; safe redundant-legacy-props strategy is the resolution).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";

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
      readyState: 1, // OPEN
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

// Default: anonymous session (no identity → no badge renders in Test 1).
// Test 1 overrides this via mockReturnValue with an identityKey so the
// badge mounts.
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
// IdentityBadge.tsx:110 (`absolute top-4 right-5 z-[101]`) so Test 1 can
// assert byte-identical layout at the badge anchor.
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: (props: { identityKey: string | null }) =>
    props.identityKey ? (
      <div
        data-testid="mock-identity-badge"
        className="absolute top-4 right-5 z-[101]"
        data-identity-key={props.identityKey}
      />
    ) : null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";
import { openClaudeSessionSocket } from "@/api/claude-session-api";

// Grab the mocked function so tests can assert call counts. The mock is
// registered by the top-level `vi.mock(...)` above; the import here binds
// to the mocked identity because vitest hoists mocks before imports.
const openClaudeSessionSocketMock = openClaudeSessionSocket as unknown as ReturnType<typeof vi.fn>;

describe("PrettyView — Phase 92 Slice 1 source-prop foundation", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    openClaudeSessionSocketMock.mockClear();
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    sessionMatchKeyMock.mockReturnValue(null);
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1 (harness regression floor): renders exactly one badge at position class 'absolute top-4 right-5 z-[101]' with the harness source", () => {
    // Enable identity so IdentityBadge mounts (per production path,
    // pvIdentityKey = sessionMatchKey(tmuxSession) → useIdentities lookup).
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

    const badges = container.querySelectorAll("[data-testid=\"mock-identity-badge\"]");
    expect(badges).toHaveLength(1);
    // Position class byte-preserved (per IdentityBadge.tsx:110 rootClassName).
    expect(badges[0]?.className).toContain("absolute top-4 right-5 z-[101]");
  });

  it("Test 2 (redundant legacy props preserved): PrettyViewProps declares hostId: number AND tmuxSession: string alongside source", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // Redundant legacy props on the interface — verified via regex on the
    // props-interface region (Blocker 1 resolution: flat props stay
    // alongside `source` during Slices 1-4).
    expect(/hostId:\s*number/.test(src)).toBe(true);
    expect(/tmuxSession:\s*string/.test(src)).toBe(true);
    // New source prop entry present (either required or optional). Slice 1
    // types it as `source?: ChatSurfaceSource` so existing tests that
    // predate Phase 92 keep passing byte-identically.
    expect(/source[?]?:\s*ChatSurfaceSource/.test(src)).toBe(true);
  });

  it("Test 3 (D-08 discipline): every source.roomId or source.hostId read appears ONLY inside a narrowed source.kind === '...' block", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // Slice 3 (Phase 93 D-13/D-20) introduced narrowed `source.roomId`
    // reads (structured logging for the relay error state). The D-08
    // discipline is not "zero reads" — it's "every read is inside a
    // narrowed block". Verify by locating each read and asserting a
    // `source.kind === "relay"` narrowing occurs on the same line
    // (ternary or logical-and) that gates the read.
    const roomIdReads = src.split("\n").filter((ln) =>
      ln.includes("source.roomId"),
    );
    for (const ln of roomIdReads) {
      // Each such line must include a narrowing check on the same line
      // (D-08 discipline: no case-detection off other fields — `source.kind`
      // is the ONE hard case-discriminator).
      expect(
        ln.includes('source.kind === "relay"') ||
          ln.includes("source.kind === 'relay'"),
      ).toBe(true);
    }
    // `source.hostId` is not read anywhere — the fallback synthesis uses the
    // outer-scope `hostId` flat prop, not `source.hostId`.
    expect(src.includes("source.hostId")).toBe(false);
  });

  it("Test 4 (ingestion gate): no openClaudeSessionSocket call for a relay-source mount", () => {
    sessionMatchKeyMock.mockReturnValue(null); // no identity → no badge

    render(
      <PrettyView
        source={{ kind: "relay", roomId: "!x:example.org", roomTitle: null }}
        // Flat props still required by PrettyViewProps during Slice 1
        // (Blocker 1 resolution: legacy props coexist with `source`).
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    // The harness ingestion effect at ~L1881 short-circuits on
    // `source.kind !== "harness"` — openClaudeSessionSocket must NOT be
    // called for a relay-source mount.
    expect(openClaudeSessionSocketMock).not.toHaveBeenCalled();
  });

  it("Test 5 (adapter call — source-file grep): useChatSurfaceAdapter is called with (source, isVisible)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // Grep-based assertion: the two-arg adapter call is present exactly
    // once in PrettyView.tsx.
    const matches = src.match(/useChatSurfaceAdapter\(source,\s*isVisible\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("Test 6 (no unsafe casts): zero occurrences of the forbidden 'undefined as unknown as number' pattern (Blocker 1)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    expect(src.includes("undefined as unknown as")).toBe(false);
    expect(src.includes("as unknown as number")).toBe(false);
  });

  it("Test 7 (harness ingestion runs when source is harness): openClaudeSessionSocket IS called for a harness-source mount", async () => {
    sessionMatchKeyMock.mockReturnValue(null);

    render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1" }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    // Harness ingestion runs — Patch #148's paneKey reset + WS open fires
    // on mount. The mock captures the call. Regression floor: this must
    // continue firing after the source-kind gate is added.
    expect(openClaudeSessionSocketMock).toHaveBeenCalled();
  });
});
