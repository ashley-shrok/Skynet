/**
 * The identity modal opens on the tab the task pill's round buttons ask for
 * (Desktop / Git), and the live hints let those tabs show from the first
 * frame instead of waiting for the modal's own checks.
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

// The modal's own checks report nothing (desktop not yet seen, no repo yet) —
// only the hints from the pill can make the tabs show.
vi.mock("./use-desktop-running", () => ({ useDesktopRunning: () => false }));
vi.mock("./use-has-git-repos", () => ({ useHasGitRepos: () => false }));
vi.mock("./DesktopTab", () => ({
  default: () => <div data-testid="desktop-tab-stub" />,
}));
vi.mock("./GitTab", () => ({
  default: () => <div data-testid="git-tab-stub" />,
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

function Harness(props: {
  open: boolean;
  initialTab?: string;
  desktopRunningHint?: boolean;
  gitReposHint?: boolean;
}) {
  return (
    <IdentityModal
      onOpenChange={vi.fn()}
      identity={BASE_IDENTITY}
      hue={200}
      hostId={7}
      onOpenRoleModal={vi.fn()}
      {...props}
    />
  );
}

describe("IdentityModal — opening on a requested tab", () => {
  it("desktop button: opens straight on Desktop, shown from the first frame via the live hint", async () => {
    render(<Harness open={true} initialTab="desktop" desktopRunningHint={true} />);
    expect(await screen.findByTestId("desktop-tab-stub")).toBeTruthy();
    expect(screen.getByTestId("identity-modal-nav-desktop")).toBeTruthy();
  });

  it("unpushed button: opens straight on Git, shown from the first frame via the hint", async () => {
    render(<Harness open={true} initialTab="git" gitReposHint={true} />);
    expect(await screen.findByTestId("git-tab-stub")).toBeTruthy();
    expect(screen.getByTestId("identity-modal-nav-git")).toBeTruthy();
  });

  it("requested Desktop tab that isn't available (desktop stopped as the button was pressed) → agent file, normal size, never an empty body", async () => {
    render(<Harness open={true} initialTab="desktop" desktopRunningHint={false} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("identity-modal-nav-identity").getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.queryByTestId("desktop-tab-stub")).toBeNull();
    expect(screen.getByTestId("identity-modal").className).not.toContain("sm:max-w-[min(1200px,80vw)]");
  });

  it("no hints → no Desktop / Git tabs (the modal's own checks decide)", async () => {
    render(<Harness open={true} />);
    await waitFor(() => expect(screen.getByTestId("identity-modal")).toBeTruthy());
    expect(screen.queryByTestId("identity-modal-nav-desktop")).toBeNull();
    expect(screen.queryByTestId("identity-modal-nav-git")).toBeNull();
  });

  it("a later plain open (no requested tab) after a desktop jump lands back on the agent file", async () => {
    const { rerender } = render(
      <Harness open={true} initialTab="desktop" desktopRunningHint={true} />,
    );
    await screen.findByTestId("desktop-tab-stub");
    rerender(<Harness open={false} initialTab="desktop" desktopRunningHint={true} />);
    // Desktop still running — a plain reopen still lands on the agent file,
    // as it always has; only the desktop button opens on Desktop.
    rerender(<Harness open={true} initialTab={undefined} desktopRunningHint={true} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("identity-modal-nav-identity").getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.queryByTestId("desktop-tab-stub")).toBeNull();
  });
});
