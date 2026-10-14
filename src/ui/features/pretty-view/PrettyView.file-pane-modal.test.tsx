/**
 * PrettyView — answering a file pane's "Open in modal".
 *
 * A file pane fires OPEN_FILE_IN_CONVERSATION_EVENT with the encoded tab spec
 * of the conversation its file came from. The matching conversation takes it
 * (preventDefault) and opens its own file modal, so Save attaches the edited
 * copy to its compose box; any other conversation leaves it alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(() => new Promise(() => {})),
  fetchHostFileUrl: vi.fn(() => new Promise(() => {})),
}));

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
const useSessionIdentityMock = vi.fn((_name?: unknown) => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
const sessionMatchKeyMock = vi.fn((_name?: unknown) => null as string | null);

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
import { encodeTabSpec } from "@/lib/tab-url";
import { OPEN_FILE_IN_CONVERSATION_EVENT } from "./file-url";

function fire(origin: string): CustomEvent {
  const ev = new CustomEvent(OPEN_FILE_IN_CONVERSATION_EVENT, {
    cancelable: true,
    detail: { origin, url: `${window.location.origin}/file/Skynet/home/u/plan.md`, filename: "plan.md" },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

describe("PrettyView — Open in modal from a file pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    sessionMatchKeyMock.mockReturnValue(null);
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
    render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "sahara", tabId: "t1" }}
        hostId={1}
        hostName="Skynet"
        tmuxSession="sahara"
        tabId="t1"
        isVisible={true}
        onSend={() => true}
      />,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the source conversation takes the request and opens its file modal", async () => {
    const ev = fire(encodeTabSpec({ protocol: "tmux", host: "Skynet", session: "sahara" }));
    expect(ev.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("editable-file-modal")).toBeTruthy();
    // Opened from a conversation, the modal keeps Save — no view-only note.
    expect(screen.queryByTestId("editable-file-modal-view-only-note")).toBeNull();
  });

  it("matches the conversation case-insensitively on the host name", () => {
    const ev = fire(encodeTabSpec({ protocol: "tmux", host: "skynet", session: "sahara" }));
    expect(ev.defaultPrevented).toBe(true);
  });

  it("another conversation's file is left alone", () => {
    const ev = fire(encodeTabSpec({ protocol: "tmux", host: "Skynet", session: "someone-else" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("editable-file-modal")).toBeNull();
  });
});
