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
// null = the repo probe hasn't answered yet; tests set it to settle the probe.
let gitProbeAnswer: boolean | null = null;
vi.mock("./use-has-git-repos", () => ({
  useHasGitRepos: () => gitProbeAnswer === true,
  useGitReposAnswer: () => gitProbeAnswer,
}));
vi.mock("./DesktopTab", () => ({
  default: () => <div data-testid="desktop-tab-stub" />,
}));
vi.mock("./GitTab", () => ({
  default: () => <div data-testid="git-tab-stub" />,
}));

// convo-scoped apps: the Apps tab reads the app store; tests swap the list.
import type { AppState } from "@/api/fleet-status-types";
let mockApps: AppState[] = [];
vi.mock("@/state/app-tiles-store", () => ({ useAppTiles: () => mockApps }));

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
  gitProbeAnswer = null;
  mockApps = [];
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

  it("Git hint covers only the wait: once the probe says no repo, the Git tab goes and the agent file shows", async () => {
    const { rerender } = render(<Harness open={true} initialTab="git" gitReposHint={true} />);
    expect(await screen.findByTestId("git-tab-stub")).toBeTruthy();
    gitProbeAnswer = false;
    rerender(<Harness open={true} initialTab="git" gitReposHint={true} />);
    await waitFor(() => expect(screen.queryByTestId("identity-modal-nav-git")).toBeNull());
    expect(screen.queryByTestId("git-tab-stub")).toBeNull();
  });

  it("Desktop hint latches while open: a stream blip (hint drops) doesn't pull the Desktop tab away", async () => {
    const { rerender } = render(<Harness open={true} initialTab="desktop" desktopRunningHint={true} />);
    await screen.findByTestId("desktop-tab-stub");
    rerender(<Harness open={true} initialTab="desktop" desktopRunningHint={false} />);
    expect(screen.getByTestId("desktop-tab-stub")).toBeTruthy();
    // Closing ends the latch: a later open without the hint has no Desktop tab.
    rerender(<Harness open={false} initialTab="desktop" desktopRunningHint={false} />);
    rerender(<Harness open={true} initialTab={undefined} desktopRunningHint={false} />);
    await waitFor(() => expect(screen.queryByTestId("identity-modal-nav-desktop")).toBeNull());
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


describe("IdentityModal — Apps tab (convo-scoped apps)", () => {
  const app = (over: Partial<AppState>): AppState => ({
    hostId: "7",
    slug: "tally",
    title: "Tally",
    description: "",
    port: 9505,
    hasIcon: false,
    createdAtMs: 0,
    isHealthy: true,
    healthMessage: null,
    owner: "tina",
    ...over,
  });

  it("no apps of its own → no Apps tab", async () => {
    mockApps = [app({ owner: null }), app({ slug: "other", owner: "bob" }), app({ slug: "far", hostId: "8" })];
    render(<Harness open={true} />);
    await waitFor(() => expect(screen.getByTestId("identity-modal")).toBeTruthy());
    expect(screen.queryByTestId("identity-modal-nav-apps")).toBeNull();
  });

  it("with an app of its own → Apps tab lists it", async () => {
    mockApps = [app({}), app({ slug: "side", title: "Side", owner: null })];
    render(<Harness open={true} initialTab="apps" />);
    expect(await screen.findByTestId("identity-apps-tab")).toBeTruthy();
    expect(screen.getByTestId("identity-modal-nav-apps")).toBeTruthy();
    expect(screen.getAllByTestId("identity-apps-row")).toHaveLength(1);
    expect(screen.getByText("Tally")).toBeTruthy();
  });

  it("when the last app leaves (moved to the sidebar) the modal falls back to the agent file, never blank", async () => {
    mockApps = [app({})];
    const { rerender } = render(<Harness open={true} initialTab="apps" />);
    expect(await screen.findByTestId("identity-apps-tab")).toBeTruthy();
    mockApps = [app({ owner: null })];
    rerender(<Harness open={true} initialTab="apps" />);
    await waitFor(() => expect(screen.queryByTestId("identity-modal-nav-apps")).toBeNull());
    expect(screen.queryByTestId("identity-apps-tab")).toBeNull();
    expect(screen.getByTestId("identity-modal-nav-identity").getAttribute("aria-pressed")).toBe("true");
  });
});
