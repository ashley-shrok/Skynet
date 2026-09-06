/**
 * Phase 80 Plan 07 — task-pill on PrettyView chat surface.
 *
 * Locks the following behaviors of the pill JSX added to PrettyView.tsx
 * as a sibling to IdentityBadge:
 *
 *   Test 1: pvIdentity.task truthy + colorHue set → pill renders with the
 *           task string and background hsla tinted from the identity's hue.
 *   Test 2: pvIdentity.task = null → no pill in DOM (D-06 fallback).
 *   Test 3: pvIdentity.task = "" (empty string) → no pill (falsy gate).
 *   Test 4: pvIdentity.task truthy + colorHue = null → pill background falls
 *           back to hue 35 (matches IdentityBadge L101 fallback).
 *   Test 5: XSS safety — task containing "<img onerror=alert(1)>" renders
 *           as literal text (React auto-escapes children).
 *
 * Uses the same WS-stub scaffolding as PrettyView.aside.test.tsx (the
 * closest analog for identity-mocked PrettyView integration tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { __resetForTest as resetWorkingStore } from "@/state/session-working-store";
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
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1]!;
}

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

// The pill's render gate is `pvIdentityKey && pvIdentity?.task`, so both
// mocks must be configurable per test:
//   sessionMatchKey        → controls pvIdentityKey (non-null string enables gate)
//   useSessionIdentity     → controls pvIdentity (must carry `task` + `colorHue`)
const sessionMatchKeyMock = vi.fn(
  (_name: string | null | undefined): string | null => null,
);
const useSessionIdentityMock = vi.fn(() => ({
  identity: null as Identity | null,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) => sessionMatchKeyMock(name),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

// IdentityBadge is stubbed to null — this test file targets the pill, and
// the badge's real rendering pulls in avatar-url plumbing irrelevant here.
vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

/** Helper — construct a well-shaped Identity with the fields the pill reads. */
function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    identityKey: "willow",
    displayName: "Willow",
    title: null,
    colorHue: 200,
    voice: null,
    role: "skynet-maintainer",
    avatarMime: "image/png",
    avatarUrl: "/identities/willow/avatar?hostId=1",
    avatarEtag: "etag-1",
    coordinator: false,
    task: "build the pool endpoint",
    ...overrides,
  };
}

describe("PrettyView — Phase 80 Plan 07 task pill", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    resetWorkingStore();
    // Default state: no identity, no key → no pill unless a test opts in.
    sessionMatchKeyMock.mockReturnValue(null);
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    // jsdom lacks ResizeObserver; useAutoScroll wires one at mount.
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1: pvIdentity.task truthy + colorHue=200 → pill renders with task + hue-200 gradient", () => {
    sessionMatchKeyMock.mockReturnValue("willow");
    useSessionIdentityMock.mockReturnValue({
      identity: makeIdentity({ task: "build the pool endpoint", colorHue: 200 }),
      identityHue: 200,
    });

    const { container, getByTestId, queryByText } = render(
      <PrettyView hostId={1} tmuxSession="willow" onSend={() => true} isVisible={true} />,
    );

    // Pill exists.
    const pill = getByTestId("pv-task-pill");
    expect(pill).toBeTruthy();
    // Text content matches the task string.
    expect(pill.textContent).toBe("build the pool endpoint");
    // Same text findable via query (defense-in-depth).
    expect(queryByText("build the pool endpoint")).toBeTruthy();
    // Inline-style attribute carries the hue-200 gradient.
    const style = pill.getAttribute("style") ?? "";
    expect(style).toContain("hsla(200,");
    // z-index-100 class applied (below badge's z-[101]).
    expect(pill.className).toContain("z-[100]");
    // No accidental XSS opening: querySelector for a script tag inside pill.
    expect(container.querySelector("[data-testid='pv-task-pill'] script")).toBeNull();
  });

  it("Test 2: pvIdentity.task=null → no pill in DOM (D-06 fallback)", () => {
    sessionMatchKeyMock.mockReturnValue("willow");
    useSessionIdentityMock.mockReturnValue({
      identity: makeIdentity({ task: null, colorHue: 200 }),
      identityHue: 200,
    });

    const { queryByTestId } = render(
      <PrettyView hostId={1} tmuxSession="willow" onSend={() => true} isVisible={true} />,
    );

    expect(queryByTestId("pv-task-pill")).toBeNull();
  });

  it("Test 3: pvIdentity.task='' (empty string) → no pill (falsy gate)", () => {
    sessionMatchKeyMock.mockReturnValue("willow");
    useSessionIdentityMock.mockReturnValue({
      identity: makeIdentity({ task: "" as unknown as null, colorHue: 200 }),
      identityHue: 200,
    });

    const { queryByTestId } = render(
      <PrettyView hostId={1} tmuxSession="willow" onSend={() => true} isVisible={true} />,
    );

    expect(queryByTestId("pv-task-pill")).toBeNull();
  });

  it("Test 4: pvIdentity.task truthy + colorHue=null → pill background falls back to hue 35", () => {
    sessionMatchKeyMock.mockReturnValue("willow");
    useSessionIdentityMock.mockReturnValue({
      identity: makeIdentity({ task: "ship the fallback", colorHue: null }),
      identityHue: null,
    });

    const { getByTestId } = render(
      <PrettyView hostId={1} tmuxSession="willow" onSend={() => true} isVisible={true} />,
    );

    const pill = getByTestId("pv-task-pill");
    const style = pill.getAttribute("style") ?? "";
    // Fallback hue = 35 (matches IdentityBadge L101 default).
    expect(style).toContain("hsla(35,");
    // Text still lands.
    expect(pill.textContent).toBe("ship the fallback");
  });

  it("Test 5 (XSS-safety): task containing raw HTML renders as literal text, not markup", () => {
    // T-80-07-01 mitigation: React auto-escapes children. Task strings
    // originate on-disk (identity file frontmatter) but conceptually flow
    // from user-editable content, so this lock defends against any future
    // path that widens task-string sourcing.
    const evil = "<img src=x onerror=alert(1)>";
    sessionMatchKeyMock.mockReturnValue("willow");
    useSessionIdentityMock.mockReturnValue({
      identity: makeIdentity({ task: evil, colorHue: 200 }),
      identityHue: 200,
    });

    const { getByTestId, container } = render(
      <PrettyView hostId={1} tmuxSession="willow" onSend={() => true} isVisible={true} />,
    );

    const pill = getByTestId("pv-task-pill");
    // The raw markup is rendered as text — textContent equals the source
    // string, and NO <img> element got injected under the pill.
    expect(pill.textContent).toBe(evil);
    expect(container.querySelector("[data-testid='pv-task-pill'] img")).toBeNull();
  });
});

// Suppress unused-import lint if any: `act` is exported by the setup shim
// but not used directly in every test here.
void act;
