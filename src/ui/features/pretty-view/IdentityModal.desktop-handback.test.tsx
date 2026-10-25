/**
 * The Desktop tab inside the identity modal: leaving the tab mid-control
 * hands back (with a notice), and a modal closed on the Desktop tab reopens
 * on the agent file rather than an empty large modal.
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
// The real Desktop tab, over a fake backend and a stand-in canvas.
const releaseDesktopControl = vi.fn();
vi.mock("@/api/workspace-desktop-api", () => ({
  connectDesktop: vi.fn().mockResolvedValue({
    token: "view",
    geometry: "1280x800",
    userHasControl: false,
  }),
  takeDesktopControl: vi.fn().mockResolvedValue({
    token: "drive",
    geometry: "1280x800",
    userHasControl: true,
  }),
  renewDesktopControl: vi.fn().mockResolvedValue({ ok: true }),
  releaseDesktopControl: (...a: unknown[]) => releaseDesktopControl(...a),
  startDesktop: vi.fn(),
  getDesktopStatus: vi.fn(),
}));
vi.mock("@/features/guacamole/GuacamoleDisplay", () => ({
  GuacamoleDisplay: () => <div data-testid="guac-display" />,
}));
const toastInfo = vi.fn();
vi.mock("sonner", async (importOriginal) => {
  const orig = (await importOriginal()) as { toast: Record<string, unknown> };
  return {
    ...orig,
    toast: Object.assign(vi.fn(), orig.toast, {
      info: (...a: unknown[]) => toastInfo(...a),
    }),
  };
});

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
  releaseDesktopControl.mockResolvedValue({ ok: true });
  openedSockets.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});
afterAll(() => {
  vi.restoreAllMocks();
});

function renderModal(open: boolean) {
  return (
    <IdentityModal
      open={open}
      onOpenChange={vi.fn()}
      identity={BASE_IDENTITY}
      hue={200}
      hostId={7}
      onOpenRoleModal={vi.fn()}
    />
  );
}

describe("IdentityModal — Desktop tab in context", () => {
  it("switching tabs while in control hands back and says so", async () => {
    render(renderModal(true));
    fireEvent.click(await screen.findByTestId("identity-modal-nav-desktop"));
    fireEvent.click(await screen.findByTestId("desktop-take-control"));
    await screen.findByTestId("desktop-in-control");

    fireEvent.click(screen.getByTestId("identity-modal-nav-workspace"));
    await waitFor(() =>
      expect(releaseDesktopControl).toHaveBeenCalledWith("tina", 7),
    );
    expect(toastInfo).toHaveBeenCalledWith("Handed back to agent");
  });

  it("reopening after closing on the Desktop tab lands on the agent file at the normal size", async () => {
    const { rerender } = render(renderModal(true));
    fireEvent.click(await screen.findByTestId("identity-modal-nav-desktop"));
    await screen.findByTestId("desktop-tab");
    rerender(renderModal(false));
    rerender(renderModal(true));
    await waitFor(() =>
      // The normal size is the editor's: a fixed 85vh tall (the Desktop
      // tab's viewer size has no fixed height).
      expect(screen.getByTestId("identity-modal").className).toContain(
        "sm:h-[85vh]",
      ),
    );
    expect(
      screen.getByTestId("identity-modal-nav-identity").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
