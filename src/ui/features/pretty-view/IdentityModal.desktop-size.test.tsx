/**
 * The identity modal switches to the large editor size while the Desktop tab
 * is active (so the agent's desktop is big enough to work in) and back to its
 * normal size for every other tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub ──────────────────────────────────────────────────────────────────
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

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
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
  openedSockets.push(ws);
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    getIdentityNoDormancy: vi.fn().mockResolvedValue(false),
    setIdentityNoDormancy: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1" }),
}));

// The agent's desktop is running, so the Desktop tab shows.
vi.mock("./use-desktop-running", () => ({ useDesktopRunning: () => true }));
vi.mock("./DesktopTab", () => ({
  default: () => <div data-testid="desktop-tab-stub" />,
}));

import { IdentityModal } from "./IdentityModal";

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  task: null,
  project: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
});
afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});
afterAll(() => {
  vi.restoreAllMocks();
});

// The large "editor" modal size vs the identity modal's normal "xl" size.
const EDITOR_WIDTH = "sm:max-w-[min(1200px,80vw)]";
const XL_WIDTH = "sm:max-w-[640px]";

function modalClass(): string {
  return screen.getByTestId("identity-modal").className;
}

describe("IdentityModal — grows for the Desktop tab", () => {
  it("uses the editor size while Desktop is active and the normal size on every other tab", async () => {
    render(
      <IdentityModal
        open={true}
        onOpenChange={vi.fn()}
        identity={BASE_IDENTITY}
        hue={200}
        hostId={7}
        onOpenRoleModal={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("identity-modal")).toBeTruthy();
    });
    expect(modalClass()).toContain(XL_WIDTH);
    expect(modalClass()).not.toContain(EDITOR_WIDTH);

    fireEvent.click(screen.getByTestId("identity-modal-nav-desktop"));
    await screen.findByTestId("desktop-tab-stub");
    expect(modalClass()).toContain(EDITOR_WIDTH);

    for (const tab of ["identity", "identity-wakeups", "workspace"]) {
      fireEvent.click(screen.getByTestId(`identity-modal-nav-${tab}`));
      await waitFor(() => expect(modalClass()).toContain(XL_WIDTH));
      expect(modalClass()).not.toContain(EDITOR_WIDTH);
    }
  });
});
