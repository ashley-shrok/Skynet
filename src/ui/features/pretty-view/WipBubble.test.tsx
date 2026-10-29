// WipBubble — the working indicator: an orb in the agent's colour beside
// "Working", the same on every installation. Since shape-stop-on-orb the orb
// is also the Stop.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { WipBubble, type WipStop } from "./WipBubble";

describe("WipBubble", () => {
  it("the orb with the word 'Working', no image", () => {
    const { container } = render(<WipBubble />);
    const wip = screen.getByTestId("pv-wip");
    const orb = wip.querySelector(".pv-wip-orb")!;
    expect(orb.getAttribute("role")).toBe("status");
    expect(orb.getAttribute("aria-label")).toBe("Claude is working");
    expect(wip.textContent).toContain("Working");
    expect(container.querySelector("img")).toBeNull();
  });

  describe("the orb as Stop", () => {
    const stop = (over: Partial<WipStop> = {}): WipStop => ({ canStop: true, onStop: vi.fn(), feedback: null, ...over });
    const btn = () => screen.getByTestId("pv-wip-stop") as HTMLButtonElement;
    const noStop = () => {
      expect(screen.queryByTestId("pv-wip-stop")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByLabelText("Stop")).toBeNull();
    };
    const state = () => screen.getByTestId("pv-wip").getAttribute("data-stop");
    // A mark inside the orb means it's a button.
    const mark = () => screen.getByTestId("pv-wip").querySelector(".pv-wip-orb > i");

    it("without a stop it is a plain orb — no button", () => {
      render(<WipBubble />);
      noStop();
      expect(state()).toBe("working");
      expect(mark()).toBeNull();
    });

    it("can stop: a button named Stop, square look, a press calls onStop", () => {
      const s = stop();
      render(<WipBubble stop={s} />);
      expect(screen.getByRole("button", { name: "Stop" })).toBe(btn());
      expect(btn().getAttribute("title")).toBe("Stop");
      // Laid over the orb, outside the "working" live region.
      expect(btn().closest('[role="status"]')).toBeNull();
      expect(state()).toBe("ready");
      expect(mark()).not.toBeNull();
      fireEvent.click(btn());
      expect(s.onStop).toHaveBeenCalledTimes(1);
    });

    it("can't stop: the plain working look — no button, nothing saying Stop, a tap does nothing", () => {
      const s = stop({ canStop: false });
      render(<WipBubble stop={s} />);
      noStop();
      expect(state()).toBe("working");
      expect(mark()).toBeNull();
      fireEvent.click(screen.getByTestId("pv-wip").querySelector(".pv-wip-orb")!);
      expect(s.onStop).not.toHaveBeenCalled();
    });

    it.each([
      ["stopping", "Stopping"],
      ["stopped", "Stopped"],
      ["cancelled", "Cancelled"],
      ["nothing", "Nothing to stop"],
      ["failed", "Failed"],
    ] as const)("after a press (%s): the outcome takes the line, the orb holds still and can't be pressed", (fb, label) => {
      const s = stop({ feedback: fb });
      render(<WipBubble narration={{ short: "x", long: "y" }} stop={s} />);
      expect(state()).toBe("pressed");
      noStop();
      expect(mark()).toBeNull();
      expect(screen.getByTestId("interrupt-feedback").textContent).toBe(label);
      expect(screen.queryByTestId("wip-narration")).toBeNull();
      // Announced through the live region mounted with the button.
      expect(screen.getByText(label, { selector: ".sr-only" })).not.toBeNull();
    });

    it("a keyboard press moves focus to the indicator, where the outcome is announced", () => {
      const s = stop();
      const { rerender } = render(<WipBubble stop={s} />);
      const b = btn();
      vi.spyOn(b, "matches").mockImplementation((sel: string) => sel === ":focus-visible");
      b.focus();
      fireEvent.click(b);
      expect(s.onStop).toHaveBeenCalledTimes(1);
      rerender(<WipBubble stop={{ ...s, feedback: "stopping" }} />);
      expect(document.activeElement).toBe(screen.getByTestId("pv-wip"));
    });

    it("the orb isn't remounted when Stop comes and goes (its spin doesn't restart)", () => {
      const { rerender } = render(<WipBubble stop={stop({ canStop: false })} />);
      const orb = screen.getByTestId("pv-wip").querySelector(".pv-wip-orb");
      rerender(<WipBubble stop={stop()} />);
      expect(screen.getByTestId("pv-wip").querySelector(".pv-wip-orb")).toBe(orb);
      rerender(<WipBubble stop={stop({ feedback: "stopping" })} />);
      expect(screen.getByTestId("pv-wip").querySelector(".pv-wip-orb")).toBe(orb);
    });

    it("when the indicator goes away holding focus, focus goes on to the compose box", () => {
      const s = stop();
      const Pane = ({ show, st }: { show: boolean; st: WipStop }) => (
        <div data-pv-root>
          {show && <WipBubble stop={st} />}
          <textarea aria-label="compose" />
        </div>
      );
      const { rerender } = render(<Pane show st={s} />);
      vi.spyOn(btn(), "matches").mockImplementation((sel: string) => sel === ":focus-visible");
      fireEvent.click(btn());
      rerender(<Pane show st={{ ...s, feedback: "stopped" }} />);
      expect(document.activeElement).toBe(screen.getByTestId("pv-wip"));
      rerender(<Pane show={false} st={s} />);
      expect(document.activeElement).toBe(screen.getByLabelText("compose"));
    });

    it("a pointer press leaves focus alone", () => {
      const s = stop();
      render(<WipBubble stop={s} />);
      vi.spyOn(btn(), "matches").mockReturnValue(false);
      fireEvent.click(btn());
      expect(s.onStop).toHaveBeenCalledTimes(1);
      expect(document.activeElement).not.toBe(screen.getByTestId("pv-wip"));
    });
  });

  describe("work narration", () => {
    // jsdom has no layout: drive the fit check by stubbing the two widths it reads.
    function stubWidths(slotWidth: number, longWidth: number) {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(slotWidth);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(longWidth);
    }
    const line = { short: "Fixing it, then tests", long: "Found the cause, fixing it now, then running the tests" };
    const text = (c: HTMLElement) => c.querySelector('[data-testid="wip-narration"]')?.textContent ?? null;
    afterEach(() => vi.restoreAllMocks());

    it("shows 'Working' until the turn's first line arrives", () => {
      const { container } = render(<WipBubble />);
      expect(text(container)).toBeNull();
      expect(screen.getByTestId("pv-wip").textContent).toContain("Working");
    });

    it("the line takes the place of 'Working', long version when it fits", () => {
      stubWidths(400, 300);
      const { container } = render(<WipBubble narration={line} />);
      expect(text(container)).toBe(line.long);
      expect(screen.getByTestId("pv-wip").textContent).not.toContain("Working");
    });

    it("falls back to the short version when the long one would not fit", () => {
      stubWidths(200, 300);
      const { container } = render(<WipBubble narration={line} />);
      expect(text(container)).toBe(line.short);
    });

    it("replaces the line with a fade when a new one arrives", async () => {
      stubWidths(400, 300);
      const { container, rerender } = render(<WipBubble narration={line} />);
      rerender(<WipBubble narration={{ short: "Running tests", long: "Fix is in, running the tests now" }} />);
      const el = container.querySelector('[data-testid="wip-narration"]') as HTMLElement;
      expect(el.style.opacity).toBe("0");
      await waitFor(() => expect(text(container)).toBe("Fix is in, running the tests now"));
      expect(el.style.opacity).toBe("1");
    });
  });
});
