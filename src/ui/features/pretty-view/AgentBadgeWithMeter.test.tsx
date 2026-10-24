/**
 * Phase 93 Slice 2 Task 1 — AgentBadgeWithMeter tests.
 *
 * AgentBadgeWithMeter is a byte-preserving port of Slice D's agent badge
 * with appendage (Phase 93 Slice 4 retired the source). Renders the plain
 * IdentityBadge + the agent-memory pie (MemoryGauge, sourced via Wave 0
 * `useSessionContextPct`) whose pop-over's Start fresh dispatches to Wave 0
 * `POST /agent-reset` (shape-conversation-view replaced the segmented meter
 * + reset button).
 *
 * ## D-10 correctness regression gates (ported verbatim from Slice D)
 *   - Test 2 (READ SIDE — working-state key format): asserts
 *     useSessionIsWorking is called with EXACTLY `${hostId}:${tmuxSessionName}`.
 *   - Test 3 (READ SIDE — contextPct source): asserts useSessionContextPct
 *     is called with (hostId, tmuxSessionName).
 *   - Test 8 (WRITE SIDE — /agent-reset endpoint URL): asserts the reset
 *     click hits `/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}`.
 *
 * These three tests guarantee that the ported component sources from the
 * same channels PrettyView reads AND dispatches through the same seam
 * PrettyView writes to — no drift possible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import type { Identity } from "@/api/identities-api";

// Mock the Wave 0 hooks BEFORE importing the component under test.
// subscribeSessionWorkingStore is pulled in transitively by conversation-store
// (IdentityBadge now imports useProjects from conversation-store, which subscribes
// at module load) — no-op mock is sufficient since this test doesn't exercise
// working-store change propagation.
vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: vi.fn(),
  useSessionIsRecycling: vi.fn(),
  subscribeSessionWorkingStore: vi.fn(),
}));

vi.mock("@/api/fleet-status-client", () => ({
  useSessionContextPct: vi.fn(),
}));

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

vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [] as Identity[],
    byKey: new Map<string, Identity>([
      [
        "nelly",
        {
          identityKey: "nelly",
          displayName: "Nelly",
          title: null,
          colorHue: 150,
          voice: null,
          role: null,
          avatarMime: "image/png",
          avatarUrl: "/avatar.png",
          avatarEtag: "abc",
          coordinator: false,
          task: null,
        } as Identity,
      ],
    ]),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { authApi } from "@/main-axios";
import {
  useSessionIsWorking,
  useSessionIsRecycling,
} from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { AgentBadgeWithMeter } from "./AgentBadgeWithMeter";

const mockedUseSessionIsWorking =
  useSessionIsWorking as unknown as ReturnType<typeof vi.fn>;
const mockedUseSessionIsRecycling =
  useSessionIsRecycling as unknown as ReturnType<typeof vi.fn>;
const mockedUseSessionContextPct =
  useSessionContextPct as unknown as ReturnType<typeof vi.fn>;
const mockedPost = authApi.post as unknown as ReturnType<typeof vi.fn>;

// The reset now lives behind the memory pie: tap the gauge, then Start fresh.
async function clickStartFresh(): Promise<HTMLButtonElement> {
  fireEvent.click(screen.getByTestId("memory-gauge"));
  const btn = (await screen.findByRole("button", { name: "Start fresh" })) as HTMLButtonElement;
  fireEvent.click(btn);
  return btn;
}

const DEFAULT_PROPS = {
  identityKey: "nelly",
  mxid: "@nelly:matrix.example.com",
  hostId: 5,
  tmuxSessionName: "nelly",
};

beforeEach(() => {
  mockedUseSessionIsWorking.mockReset();
  mockedUseSessionIsRecycling.mockReset();
  mockedUseSessionContextPct.mockReset();
  mockedPost.mockReset();
  mockedUseSessionIsWorking.mockReturnValue(false);
  mockedUseSessionIsRecycling.mockReturnValue(false);
  mockedUseSessionContextPct.mockReturnValue(null);
  // Reset button now shows a kit confirm (kitConfirm) first (patched to prevent
  // accidental resets). Auto-accept in tests that click it — the confirm
  // gate itself is covered by the dedicated reset-confirm.test.tsx specs.
  autoAnswerKitDialogs({ confirm: true });
});

afterEach(() => {
  __resetKitDialogsForTests();
  vi.restoreAllMocks();
});

describe("AgentBadgeWithMeter (Phase 93 Slice 2 Task 1 — byte-preserving port)", () => {
  it("Test 1: renders the plain IdentityBadge for the given identityKey", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    // Assert via the pv-identity-badge class (root of the IdentityBadge).
    const badge = document.querySelector(".pv-identity-badge");
    expect(badge).not.toBeNull();
  });

  it("Test 2 (D-10 / Pitfall 2 READ-SIDE regression gate): useSessionIsWorking called with `${hostId}:${tmuxSessionName}` exact key format", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    // The key format must be EXACTLY `${hostId}:${tmuxSessionName}` — same
    // shape PrettyView reads at sessionWorkingKey (PrettyView.tsx L1363).
    expect(mockedUseSessionIsWorking).toHaveBeenCalledWith("5:nelly");
  });

  it("Test 3 (D-10 / Pitfall 2 READ-SIDE regression gate — contextPct source): useSessionContextPct called with (hostId, tmuxSessionName)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    // Must call the Wave 0 hook with (hostId, tmuxSessionName) — the SAME
    // source PrettyView reads post Wave 0 mechanical swap.
    expect(mockedUseSessionContextPct).toHaveBeenCalledWith(5, "nelly");
  });

  it("Test 4: contextPct=30 → grey band (silent while there's room)", () => {
    mockedUseSessionContextPct.mockReturnValue(30);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByTestId("memory-gauge");
    expect(meter).toHaveAttribute("data-pct", "30");
    expect(meter).toHaveAttribute("aria-label", "Agent memory: 30% used");
    expect(meter).toHaveAttribute("data-band", "grey");
  });

  it("Test 5: contextPct=50 → amber band (threshold 45)", () => {
    mockedUseSessionContextPct.mockReturnValue(50);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByTestId("memory-gauge");
    expect(meter).toHaveAttribute("data-pct", "50");
    expect(meter).toHaveAttribute("aria-label", "Agent memory: 50% used");
    expect(meter).toHaveAttribute("data-band", "amber");
  });

  it("Test 6: contextPct=80 → red band (threshold 78)", () => {
    mockedUseSessionContextPct.mockReturnValue(80);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByTestId("memory-gauge");
    expect(meter).toHaveAttribute("data-pct", "80");
    expect(meter).toHaveAttribute("aria-label", "Agent memory: 80% used");
    expect(meter).toHaveAttribute("data-band", "red");
  });

  it("Test 7: contextPct=null → no reading (data-pct absent) + label 'Agent memory'", () => {
    mockedUseSessionContextPct.mockReturnValue(null);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByTestId("memory-gauge");
    expect(meter.getAttribute("data-pct")).toBeNull();
    expect(meter).toHaveAttribute("title", "Agent memory");
  });

  it("Test 8 (D-10 WRITE-SIDE regression gate): reset click fires authApi.post with /agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}", async () => {
    mockedPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    await clickStartFresh();
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    const [url, body] = mockedPost.mock.calls[0];
    expect(url).toBe(`/agent-reset/5/${encodeURIComponent("nelly")}`);
    expect(body).toEqual({ body: "" });
  });

  it("Test 8a: confirm dismissed → no dispatch (accidental-reset guard)", async () => {
    // Override the default beforeEach stub with false.
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    await clickStartFresh();
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].kind).toBe("confirm");
    await new Promise((r) => setTimeout(r, 0));
    // No authApi.post call — the confirm gate short-circuited.
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("Test 8b: tmux session with special chars → URL is properly encoded", async () => {
    mockedPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    render(
      <AgentBadgeWithMeter
        {...DEFAULT_PROPS}
        tmuxSessionName="agent name with spaces"
      />,
    );
    await clickStartFresh();
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    const [url] = mockedPost.mock.calls[0];
    // spaces → %20 via encodeURIComponent
    expect(url).toBe(
      `/agent-reset/5/${encodeURIComponent("agent name with spaces")}`,
    );
  });

  it("Test 9: Start fresh disabled while in-flight (prevents double-fire)", async () => {
    // Never-resolving promise so the reset stays in-flight.
    let resolvePost: (v: unknown) => void = () => {};
    mockedPost.mockReturnValueOnce(
      new Promise((r) => {
        resolvePost = r;
      }),
    );
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    await clickStartFresh();
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    // The pop-over closes on Start fresh; reopen it — the button is disabled.
    fireEvent.click(screen.getByTestId("memory-gauge"));
    const again = (await screen.findByRole("button", { name: "Start fresh" })) as HTMLButtonElement;
    expect(again).toBeDisabled();
    // Rapid second click — must NOT fire the request again.
    fireEvent.click(again);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // Resolve the request — button re-enables.
    resolvePost({ status: 200, data: { ok: true } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start fresh" })).not.toBeDisabled();
    });
  });

  it("Test 10: reset error → structured warn logged; component does NOT crash + does NOT retry", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedPost.mockRejectedValueOnce(new Error("network failed"));
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    await clickStartFresh();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    const warnCall = warnSpy.mock.calls[0][0];
    expect(warnCall).toMatchObject({
      operation: "agent_reset_failed",
      hostId: 5,
      tmuxSessionName: "nelly",
    });
    // No auto-retry
    expect(mockedPost).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("Test 11: isRecycling=true → the pie shows as emptied (unknown, grey) regardless of contextPct", () => {
    mockedUseSessionIsRecycling.mockReturnValue(true);
    mockedUseSessionContextPct.mockReturnValue(50);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByTestId("memory-gauge");
    expect(meter.getAttribute("data-pct")).toBeNull();
    expect(meter).toHaveAttribute("data-band", "grey");
  });

  it("Test 12: appendage container carries data-appendage='true' (D-09 humans-no-appendage discriminator preserved)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const appendage = document.querySelector("[data-appendage='true']");
    expect(appendage).not.toBeNull();
    // The memory pie lives inside it.
    expect(appendage!.querySelector("[data-testid='memory-gauge']")).not.toBeNull();
  });
});
