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
const takeDesktopControl = vi.fn();
const renewDesktopControl = vi.fn();
const releaseDesktopControl = vi.fn();
vi.mock("@/api/workspace-desktop-api", () => ({
  connectDesktop: (...a: unknown[]) => connectDesktop(...a),
  startDesktop: (...a: unknown[]) => startDesktop(...a),
  getDesktopStatus: (...a: unknown[]) => getDesktopStatus(...a),
  takeDesktopControl: (...a: unknown[]) => takeDesktopControl(...a),
  renewDesktopControl: (...a: unknown[]) => renewDesktopControl(...a),
  releaseDesktopControl: (...a: unknown[]) => releaseDesktopControl(...a),
}));

const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

// Stand-in for the Guacamole canvas: records its props and exposes the callbacks.
const displayProps: Record<string, unknown>[] = [];
vi.mock("@/features/guacamole/GuacamoleDisplay", () => ({
  GuacamoleDisplay: (props: Record<string, unknown>) => {
    displayProps.push(props);
    return <div data-testid="guac-display" />;
  },
}));

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));

import DesktopTab from "./DesktopTab";

function lastDisplay() {
  return displayProps[displayProps.length - 1] as {
    viewOnly: boolean;
    fixedRemoteSize?: boolean;
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
  takeDesktopControl.mockReset();
  renewDesktopControl.mockReset().mockResolvedValue({ ok: true });
  releaseDesktopControl.mockReset().mockResolvedValue({ ok: true });
  toastError.mockReset();
  toastInfo.mockReset();
  displayProps.length = 0;
  mobileState.isMobile = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
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
    // The agent's screen size is never the viewer's to change.
    expect(p.fixedRemoteSize).toBe(true);
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

  describe("body sizing", () => {
    function mockViewport(phone: boolean) {
      vi.spyOn(window, "matchMedia").mockImplementation(
        (query: string) =>
          ({
            matches: phone,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      );
    }
    function body(): HTMLElement {
      return screen.getByTestId("desktop-tab").children[1] as HTMLElement;
    }

    it("takes the desktop's shape on a wide screen", async () => {
      mockViewport(false);
      connectDesktop.mockResolvedValue({
        token: "tok",
        geometry: "1920x1080",
        userHasControl: false,
      });
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      await screen.findByTestId("guac-display");
      expect(body().style.aspectRatio).toBe("1920 / 1080");
      expect(body().style.width).toBe("100%");
    });

    it("drops the aspect ratio on a phone so the picture fits the screen width", async () => {
      mockViewport(true);
      connectDesktop.mockResolvedValue({
        token: "tok",
        geometry: "1280x800",
        userHasControl: false,
      });
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      await screen.findByTestId("guac-display");
      expect(body().style.aspectRatio).toBe("");
      expect(body().style.width).toBe("100%");
    });
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

  describe("take control", () => {
    const view = { token: "view", geometry: "1280x800", userHasControl: false };
    const drive = {
      token: "drive",
      geometry: "1280x800",
      userHasControl: true,
    };

    it("switches to an interactive display, tells the modal, and renews the lease", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        connectDesktop.mockResolvedValue(view);
        takeDesktopControl.mockResolvedValue(drive);
        const onControlChange = vi.fn();
        render(
          <DesktopTab
            identityKey="alice"
            hostId={7}
            isVisible
            onControlChange={onControlChange}
          />,
        );
        fireEvent.click(await screen.findByTestId("desktop-take-control"));
        await screen.findByTestId("desktop-in-control");
        expect(takeDesktopControl).toHaveBeenCalledWith("alice", 7);
        expect(lastDisplay().viewOnly).toBe(false);
        expect(lastDisplay().fixedRemoteSize).toBe(true);
        expect(lastDisplay().connectionConfig.token).toBe("drive");
        expect(onControlChange).toHaveBeenLastCalledWith(true);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        expect(renewDesktopControl).toHaveBeenCalledWith("alice", 7);
      } finally {
        vi.useRealTimers();
      }
    });

    it("hand back releases the lease and returns to a view-only stream", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockResolvedValue(drive);
      const onControlChange = vi.fn();
      render(
        <DesktopTab
          identityKey="alice"
          hostId={7}
          isVisible
          onControlChange={onControlChange}
        />,
      );
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      fireEvent.click(await screen.findByTestId("desktop-hand-back"));
      await screen.findByTestId("desktop-view-only");
      expect(releaseDesktopControl).toHaveBeenCalledWith("alice", 7);
      expect(onControlChange).toHaveBeenLastCalledWith(false);
      await waitFor(() => expect(lastDisplay().viewOnly).toBe(true));
      expect(lastDisplay().connectionConfig.token).toBe("view");
    });

    it("releases when the tab closes while in control", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockResolvedValue(drive);
      const { unmount } = render(
        <DesktopTab identityKey="alice" hostId={7} isVisible />,
      );
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      await screen.findByTestId("desktop-in-control");
      unmount();
      expect(releaseDesktopControl).toHaveBeenCalledWith("alice", 7);
    });

    it("says it handed back when the tab is hidden while in control", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockResolvedValue(drive);
      const onControlChange = vi.fn();
      const { rerender } = render(
        <DesktopTab
          identityKey="alice"
          hostId={7}
          isVisible
          onControlChange={onControlChange}
        />,
      );
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      await screen.findByTestId("desktop-in-control");
      rerender(
        <DesktopTab
          identityKey="alice"
          hostId={7}
          isVisible={false}
          onControlChange={onControlChange}
        />,
      );
      expect(releaseDesktopControl).toHaveBeenCalledWith("alice", 7);
      expect(onControlChange).toHaveBeenLastCalledWith(false);
      expect(toastInfo).toHaveBeenCalledWith("Handed back to agent");
    });

    it("says nothing when the tab is hidden while only watching", async () => {
      connectDesktop.mockResolvedValue(view);
      const { rerender } = render(
        <DesktopTab identityKey="alice" hostId={7} isVisible />,
      );
      await screen.findByTestId("guac-display");
      rerender(<DesktopTab identityKey="alice" hostId={7} isVisible={false} />);
      expect(releaseDesktopControl).not.toHaveBeenCalled();
      expect(toastInfo).not.toHaveBeenCalled();
    });

    it("releases when the stream drops while in control", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockResolvedValue(drive);
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      await screen.findByTestId("desktop-in-control");
      act(() => lastDisplay().onDisconnect());
      await screen.findByText("Lost the connection to the desktop");
      expect(releaseDesktopControl).toHaveBeenCalledTimes(1);
    });

    it("stays view-only and says why when taking control fails", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockRejectedValue(new Error("permission_denied"));
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(screen.getByTestId("desktop-view-only")).toBeTruthy();
      expect(lastDisplay().viewOnly).toBe(true);
      expect(releaseDesktopControl).not.toHaveBeenCalled();
    });

    it("shows when someone else has paused the agent", async () => {
      connectDesktop.mockResolvedValue({ ...view, userHasControl: true });
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      await screen.findByTestId("guac-display");
      expect(screen.getByTestId("desktop-view-only").textContent).toContain(
        "agent paused",
      );
    });

    it("hand back waits for the release before reconnecting", async () => {
      connectDesktop.mockResolvedValue(view);
      takeDesktopControl.mockResolvedValue(drive);
      let finishRelease: () => void = () => {};
      releaseDesktopControl.mockImplementation(
        () => new Promise((r) => (finishRelease = () => r({ ok: true }))),
      );
      render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      fireEvent.click(await screen.findByTestId("desktop-take-control"));
      fireEvent.click(await screen.findByTestId("desktop-hand-back"));
      await waitFor(() => expect(releaseDesktopControl).toHaveBeenCalled());
      expect(connectDesktop).toHaveBeenCalledTimes(1);
      await act(async () => finishRelease());
      await waitFor(() => expect(connectDesktop).toHaveBeenCalledTimes(2));
    });

    it("keeps the paused note current while watching", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        connectDesktop.mockResolvedValue({ ...view, userHasControl: true });
        const status = {
          available: true,
          running: true,
          display: 100,
          vncPort: 16000,
          geometry: "1280x800",
          userHasControl: false,
        };
        getDesktopStatus.mockResolvedValue(status);
        render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
        await screen.findByTestId("guac-display");
        const note = () => screen.getByTestId("desktop-view-only").textContent;
        expect(note()).toContain("agent paused");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(16_000);
        });
        expect(getDesktopStatus).toHaveBeenCalledWith("alice", 7);
        expect(note()).not.toContain("agent paused");

        getDesktopStatus.mockResolvedValue({ ...status, userHasControl: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(16_000);
        });
        expect(note()).toContain("agent paused");
        // Re-reading control never reconnects the stream.
        expect(connectDesktop).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("doesn't poll control status while it has control", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        connectDesktop.mockResolvedValue(view);
        takeDesktopControl.mockResolvedValue(drive);
        render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
        fireEvent.click(await screen.findByTestId("desktop-take-control"));
        await screen.findByTestId("desktop-in-control");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        expect(getDesktopStatus).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("open beside conversation", () => {
    it("the button calls onPopOut", async () => {
      connectDesktop.mockResolvedValue({ token: "t", geometry: "1280x800", userHasControl: false });
      const onPopOut = vi.fn();
      render(<DesktopTab identityKey="alice" hostId={7} isVisible onPopOut={onPopOut} />);
      fireEvent.click(await screen.findByTestId("desktop-pop-out"));
      expect(onPopOut).toHaveBeenCalledTimes(1);
    });

    it("no button without onPopOut, or on a phone", async () => {
      connectDesktop.mockResolvedValue({ token: "t", geometry: "1280x800", userHasControl: false });
      const { unmount } = render(<DesktopTab identityKey="alice" hostId={7} isVisible />);
      await screen.findByTestId("guac-display");
      expect(screen.queryByTestId("desktop-pop-out")).toBeNull();
      unmount();
      mobileState.isMobile = true;
      render(<DesktopTab identityKey="alice" hostId={7} isVisible onPopOut={vi.fn()} />);
      await screen.findAllByTestId("guac-display");
      expect(screen.queryByTestId("desktop-pop-out")).toBeNull();
    });
  });
});
