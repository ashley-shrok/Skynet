// MemoryGauge — the task pill's agent-memory pie (shape-conversation-view).
// Grey and silent below 45%, amber from 45%, red from 78%; holds its last
// reading through brief null dropouts; reads "Compacting…" while a condense is
// under way; tapping opens a pop-over whose Compact conversation requests one.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryGauge, condenseConfirm, condenseFailureMessage, memoryBand } from "./MemoryGauge";

const gauge = () => screen.getByTestId("memory-gauge");

describe("memoryBand", () => {
  it("grey below 45, amber from 45, red from 78, grey when unknown", () => {
    expect(memoryBand(null)).toBe("grey");
    expect(memoryBand(undefined)).toBe("grey");
    expect(memoryBand(0)).toBe("grey");
    expect(memoryBand(44)).toBe("grey");
    expect(memoryBand(45)).toBe("amber");
    expect(memoryBand(77)).toBe("amber");
    expect(memoryBand(78)).toBe("red");
    expect(memoryBand(100)).toBe("red");
  });
});

describe("MemoryGauge", () => {
  it("silent while there's room: grey band, no percentage text", () => {
    render(<MemoryGauge pct={30} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("grey");
    expect(gauge().getAttribute("data-pct")).toBe("30");
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory: 30% used");
    expect(gauge().textContent).not.toContain("%");
  });

  it("amber and red bands show the percentage", () => {
    const { rerender } = render(<MemoryGauge pct={50} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("amber");
    expect(gauge().textContent).toContain("50%");
    rerender(<MemoryGauge pct={80} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("red");
    expect(gauge().textContent).toContain("80%");
  });

  it("unknown before any reading: no data-pct, plain 'Agent memory' label", () => {
    render(<MemoryGauge pct={null} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBeNull();
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory");
  });

  it("holds the last reading through a null dropout", () => {
    const { rerender } = render(<MemoryGauge pct={60} onCondense={vi.fn()} />);
    rerender(<MemoryGauge pct={null} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBe("60");
    expect(gauge().getAttribute("data-band")).toBe("amber");
    rerender(<MemoryGauge pct={62} onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBe("62");
  });

  it("condensing: the pie says Compacting…, keeps its reading, and drops the red alarm", () => {
    render(<MemoryGauge pct={90} condensing onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    expect(gauge().getAttribute("data-pct")).toBe("90");
    expect(gauge().textContent).toContain("Compacting…");
    expect(gauge().textContent).not.toContain("90%");
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory: compacting");
  });

  it("tapping opens the pop-over; Compact conversation requests it and closes it", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} onCondense={onCondense} />);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
    fireEvent.click(gauge());
    const pop = await screen.findByTestId("memory-pop");
    expect(pop.textContent).toContain("50% used");
    expect(pop.textContent).toContain("good moment to compact");
    fireEvent.click(screen.getByRole("button", { name: "Compact conversation" }));
    expect(onCondense).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
  });

  it("the pop-over explains each band in compact terms", async () => {
    const { rerender } = render(<MemoryGauge pct={20} onCondense={vi.fn()} />);
    fireEvent.click(gauge());
    expect((await screen.findByTestId("memory-pop")).textContent).toContain("compacting summarises it");
    rerender(<MemoryGauge pct={90} onCondense={vi.fn()} />);
    expect(screen.getByTestId("memory-pop").textContent).toContain("At 95% the agent compacts on its own");
    expect(screen.getByTestId("memory-pop").textContent).not.toMatch(/start fresh|reset/i);
  });

  it("Compact conversation is disabled when condenseDisabled", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} condenseDisabled onCondense={onCondense} />);
    fireEvent.click(gauge());
    const btn = (await screen.findByRole("button", { name: "Compact conversation" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onCondense).not.toHaveBeenCalled();
  });

  it("while condensing the button reads Compacting… and can't be pressed again", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} condensing onCondense={onCondense} />);
    fireEvent.click(gauge());
    const pop = await screen.findByTestId("memory-pop");
    expect(pop.textContent).toContain("reaches it once that's done");
    const btn = screen.getByRole("button", { name: "Compacting…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("condenseConfirm", () => {
  it("asks in compact terms and never mentions typed text", () => {
    const c = condenseConfirm();
    expect(c.title).toBe("Compact this conversation?");
    expect(c.confirmLabel).toBe("Compact");
    expect(c.body).toContain("same agent, in the same conversation");
    expect(c.body).not.toContain("typed");
  });
});

describe("condenseFailureMessage", () => {
  it("no answer at all → Not connected", () => {
    expect(condenseFailureMessage(new Error("Network Error"))).toBe("Not connected — try again in a moment");
  });
  it("504 names the machine when known", () => {
    expect(condenseFailureMessage({ response: { status: 504 } }, "boreal")).toBe("Couldn't reach boreal — try again in a moment");
    expect(condenseFailureMessage({ response: { status: 504 } })).toBe("Couldn't reach this agent's machine — try again in a moment");
  });
  it("404 → the machine may have been removed", () => {
    expect(condenseFailureMessage({ response: { status: 404 } })).toBe("Couldn't find this agent's machine — it may have been removed");
  });
  it("any other answered error → something went wrong on the server", () => {
    for (const status of [400, 500, 502]) {
      expect(condenseFailureMessage({ response: { status } })).toBe("Couldn't compact — something went wrong on the server");
    }
  });
});
