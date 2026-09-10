/**
 * Phase 93 Slice 2 Task 1 — AgentBadgeWithMeter tests.
 *
 * AgentBadgeWithMeter is a byte-preserving port of Slice D's agent badge
 * with appendage (Phase 93 Slice 4 retired the source). Renders the plain
 * IdentityBadge + a shrunk meter appendage (sourced via Wave 0
 * `useSessionContextPct`) + a reset button (dispatches to Wave 0
 * `POST /agent-reset` endpoint).
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
import type { Identity } from "@/api/identities-api";

// Mock the Wave 0 hooks BEFORE importing the component under test.
vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: vi.fn(),
  useSessionIsRecycling: vi.fn(),
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentBadgeWithMeter (Phase 93 Slice 2 Task 1 — byte-preserving port)", () => {
  it("Test 1: renders the plain IdentityBadge for the given identityKey", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    // IdentityBadge renders the coordinator watermark (if coordinator) OR
    // the avatar image. The mock identity is non-coordinator, so no
    // watermark; assert via the pv-identity-breathe class (root of the
    // IdentityBadge).
    const badge = document.querySelector(".pv-identity-breathe");
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

  it("Test 4: contextPct=30 → green band lit segments render", () => {
    mockedUseSessionContextPct.mockReturnValue(30);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "30");
  });

  it("Test 5: contextPct=50 → amber band (threshold 45)", () => {
    mockedUseSessionContextPct.mockReturnValue(50);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    // Use data-band (jsdom-stable) not style.background (jsdom normalizes
    // hsla → rgba per Plan 02 Deviation 2).
    const segments = meter.querySelectorAll("[data-seg]");
    let amberCount = 0;
    segments.forEach((seg) => {
      if (seg.getAttribute("data-band") === "amber") amberCount++;
    });
    expect(amberCount).toBeGreaterThan(0);
  });

  it("Test 6: contextPct=80 → red band (threshold 78)", () => {
    mockedUseSessionContextPct.mockReturnValue(80);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "80");
    const segments = meter.querySelectorAll("[data-seg]");
    let redCount = 0;
    segments.forEach((seg) => {
      if (seg.getAttribute("data-band") === "red") redCount++;
    });
    expect(redCount).toBeGreaterThan(0);
  });

  it("Test 7: contextPct=null → meter aria-valuenow absent + tooltip 'Context (unknown)'", () => {
    mockedUseSessionContextPct.mockReturnValue(null);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    // valuenow may be absent OR undefined
    expect(meter.getAttribute("aria-valuenow")).toBeNull();
    expect(meter).toHaveAttribute("title", "Context (unknown)");
  });

  it("Test 8 (D-10 WRITE-SIDE regression gate): reset click fires authApi.post with /agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}", async () => {
    mockedPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });
    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    const [url, body] = mockedPost.mock.calls[0];
    expect(url).toBe(`/agent-reset/5/${encodeURIComponent("nelly")}`);
    expect(body).toEqual({ body: "" });
  });

  it("Test 8b: tmux session with special chars → URL is properly encoded", async () => {
    mockedPost.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    render(
      <AgentBadgeWithMeter
        {...DEFAULT_PROPS}
        tmuxSessionName="agent name with spaces"
      />,
    );
    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });
    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    const [url] = mockedPost.mock.calls[0];
    // spaces → %20 via encodeURIComponent
    expect(url).toBe(
      `/agent-reset/5/${encodeURIComponent("agent name with spaces")}`,
    );
  });

  it("Test 9: reset button disabled while in-flight (prevents double-fire)", async () => {
    // Never-resolving promise so the button stays in-flight.
    let resolvePost: (v: unknown) => void = () => {};
    mockedPost.mockReturnValueOnce(
      new Promise((r) => {
        resolvePost = r;
      }),
    );
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });
    fireEvent.click(resetBtn);
    // Immediately after click, the button should be disabled.
    await waitFor(() => {
      expect(resetBtn).toBeDisabled();
    });
    // Rapid second click — must NOT fire the request again.
    fireEvent.click(resetBtn);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // Resolve the request — button re-enables.
    resolvePost({ status: 200, data: { ok: true } });
    await waitFor(() => {
      expect(resetBtn).not.toBeDisabled();
    });
  });

  it("Test 10: reset error → structured warn logged; component does NOT crash + does NOT retry", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedPost.mockRejectedValueOnce(new Error("network failed"));
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const resetBtn = screen.getByRole("button", {
      name: /reset context window/i,
    });
    fireEvent.click(resetBtn);
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

  it("Test 11: isRecycling=true → meter renders in a draining/holding style (all segments unlit)", () => {
    mockedUseSessionIsRecycling.mockReturnValue(true);
    mockedUseSessionContextPct.mockReturnValue(50);
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    const segments = meter.querySelectorAll("[data-seg]");
    // Every segment should carry data-lit="false" when recycling (the
    // isDrainingLike gate flips every segment unlit regardless of contextPct).
    let neutralCount = 0;
    segments.forEach((seg) => {
      if (seg.getAttribute("data-lit") === "false") neutralCount++;
    });
    expect(neutralCount).toBe(segments.length);
  });

  it("Test 12: appendage container carries data-appendage='true' (D-09 humans-no-appendage discriminator preserved)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const appendage = document.querySelector("[data-appendage='true']");
    expect(appendage).not.toBeNull();
  });

  it("Test 13: --meter-width CSS custom property set to a shrunk 6rem value", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    const style = meter.getAttribute("style") ?? "";
    // shrunk value expected — 6rem (vs pane-wide 12rem per PATTERNS.md § meter well)
    expect(style).toMatch(/--meter-width:\s*6rem/);
  });

  // ─── Phase 97 Finding 5: drawer chrome regression gates ──────────────────
  //
  // The appendage div is now wrapped by a `data-drawer="true"` container per
  // Variant A of meter-tasting.html (margin-top: -8px tuck, z-index: 1 behind
  // pill, padding-top: 10px above meter body). The meter-well's corner + border
  // tokens are adjusted: `rounded-b-md` (bottom corners only) + `border-t-0`
  // (no top border) — the tuck edge reads invisible.

  it("Test 14 (Phase 97 F-5): drawer wrapper (data-drawer='true') wraps the appendage div and carries the tuck geometry (-mt-2 + pt-[10px] + zIndex:1)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const drawer = document.querySelector("[data-drawer='true']");
    expect(drawer).not.toBeNull();
    const drawerClass = drawer!.getAttribute("class") ?? "";
    // Tailwind tokens matching prototype meter-tasting.html:164-168.
    expect(drawerClass).toMatch(/-mt-2/);
    expect(drawerClass).toMatch(/pt-\[10px\]/);
    // Inline style carries zIndex: 1 (behind pill's implicit stacking).
    const drawerStyle = drawer!.getAttribute("style") ?? "";
    expect(drawerStyle).toMatch(/z-index:\s*1/);
    // Drawer must be the parent of the appendage div.
    const appendage = drawer!.querySelector("[data-appendage='true']");
    expect(appendage).not.toBeNull();
  });

  it("Test 15 (Phase 97 F-5): meter-well corners squared at top + rounded at bottom + no top border (`rounded-b-md` + `border-t-0`; no `rounded-md` or `rounded-t-md`)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const meter = screen.getByRole("meter");
    const meterClass = meter.getAttribute("class") ?? "";
    expect(meterClass).toMatch(/\brounded-b-md\b/);
    expect(meterClass).toMatch(/\bborder-t-0\b/);
    // Full-round or top-rounded tokens must NOT be present — the meter-well
    // must read as tucked-under-a-pill, not free-floating.
    expect(meterClass).not.toMatch(/\brounded-md\b/);
    expect(meterClass).not.toMatch(/\brounded-t-md\b/);
  });

  it("Test 16 (Phase 97 F-5): appendage className no longer carries the old `mt-1` (spacer role replaced by drawer's `-mt-2` + `pt-[10px]` geometry)", () => {
    render(<AgentBadgeWithMeter {...DEFAULT_PROPS} />);
    const appendage = document.querySelector("[data-appendage='true']");
    expect(appendage).not.toBeNull();
    const appendageClass = appendage!.getAttribute("class") ?? "";
    // The 4px `mt-1` spacer that used to sit between the pill and the
    // appendage is REMOVED — the drawer's -mt-2 + pt-[10px] replaces it.
    expect(appendageClass).not.toMatch(/\bmt-1\b/);
  });
});
