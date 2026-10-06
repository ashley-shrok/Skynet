import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const connectDesktop = vi.fn();
const startDesktop = vi.fn();
const getDesktopStatus = vi.fn();
vi.mock("@/api/workspace-desktop-api", () => ({
  connectDesktop: (...a: unknown[]) => connectDesktop(...a),
  startDesktop: (...a: unknown[]) => startDesktop(...a),
  getDesktopStatus: (...a: unknown[]) => getDesktopStatus(...a),
}));

// Stand-in for the Guacamole canvas: records its props and exposes the callbacks.
const displayProps: Record<string, unknown>[] = [];
vi.mock("@/features/guacamole/GuacamoleDisplay", () => ({
  GuacamoleDisplay: (props: Record<string, unknown>) => {
    displayProps.push(props);
    return <div data-testid="guac-display" />;
  },
}));

import DesktopTab from "./DesktopTab";

function lastDisplay() {
  return displayProps[displayProps.length - 1] as {
    viewOnly: boolean;
    connectionConfig: {
      token: string;
      protocol: string;
      width?: number;
      height?: number;
    };
    onDisconnect: () => void;
  };
}

beforeEach(() => {
  connectDesktop.mockReset();
  startDesktop.mockReset();
  getDesktopStatus.mockReset();
  displayProps.length = 0;
});

describe("DesktopTab", () => {
  it("connects when visible and renders a view-only VNC display at the desktop's size", async () => {
    connectDesktop.mockResolvedValue({
      token: "tok",
      geometry: "1280x800",
      userHasControl: false,
    });
    render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
    await screen.findByTestId("guac-display");
    expect(connectDesktop).toHaveBeenCalledWith("alice", 7);
    const p = lastDisplay();
    expect(p.viewOnly).toBe(true);
    expect(p.connectionConfig).toEqual({
      token: "tok",
      protocol: "vnc",
      width: 1280,
      height: 800,
    });
    expect(screen.getByTestId("desktop-view-only").textContent).toContain(
      "View only",
    );
  });

  it("does not connect while hidden", () => {
    render(<DesktopTab identityKey="alice" hostId={7} isVisible={false} />);
    expect(connectDesktop).not.toHaveBeenCalled();
  });

  it("shows the stopped state with a Start button, then connects once it is running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      connectDesktop
        .mockRejectedValueOnce(new Error("not_running"))
        .mockResolvedValue({
          token: "tok2",
          geometry: "1280x800",
          userHasControl: false,
        });
      startDesktop.mockResolvedValue({ starting: true });
      getDesktopStatus
        .mockResolvedValueOnce({ available: true, running: false })
        .mockResolvedValue({ available: true, running: true });

      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      fireEvent.click(await screen.findByTestId("desktop-start"));
      await screen.findByText("Starting the desktop…");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await screen.findByTestId("guac-display");
      expect(startDesktop).toHaveBeenCalledWith("alice", 7);
      expect(lastDisplay().connectionConfig.token).toBe("tok2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers Reconnect after the stream drops, and reconnects with a fresh token", async () => {
    connectDesktop
      .mockResolvedValueOnce({
        token: "a",
        geometry: "1280x800",
        userHasControl: false,
      })
      .mockResolvedValueOnce({
        token: "b",
        geometry: "1280x800",
        userHasControl: false,
      });
    render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
    await screen.findByTestId("guac-display");
    act(() => lastDisplay().onDisconnect());
    await screen.findByText("Lost the connection to the desktop");
    fireEvent.click(screen.getByTestId("desktop-reconnect"));
    await waitFor(() => expect(lastDisplay().connectionConfig.token).toBe("b"));
  });

  it("shows friendly copy for backend error classes", async () => {
    connectDesktop.mockRejectedValue(new Error("guacd_unreachable"));
    render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
    await screen.findByText("The viewer service isn't reachable");
  });
});
