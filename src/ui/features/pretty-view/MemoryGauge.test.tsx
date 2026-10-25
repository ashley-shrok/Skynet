// MemoryGauge — the composer's agent-memory pie (shape-conversation-view).
// Grey and silent below 45%, amber from 45%, red from 78%; holds its last
// reading through brief null dropouts; reads "Condensing…" while a condense is
// under way; tapping opens a pop-over whose Condense conversation requests one.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryGauge, condenseConfirm, memoryBand } from "./MemoryGauge";

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

  it("condensing: the pie says Condensing…, keeps its reading, and drops the red alarm", () => {
    render(<MemoryGauge pct={90} condensing onCondense={vi.fn()} />);
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    expect(gauge().getAttribute("data-pct")).toBe("90");
    expect(gauge().textContent).toContain("Condensing…");
    expect(gauge().textContent).not.toContain("90%");
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory: condensing");
  });

  it("tapping opens the pop-over; Condense conversation requests it and closes it", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} onCondense={onCondense} />);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
    fireEvent.click(gauge());
    const pop = await screen.findByTestId("memory-pop");
    expect(pop.textContent).toContain("50% used");
    expect(pop.textContent).toContain("good moment to condense");
    fireEvent.click(screen.getByRole("button", { name: "Condense conversation" }));
    expect(onCondense).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
  });

  it("the pop-over explains each band in condense terms", async () => {
    const { rerender } = render(<MemoryGauge pct={20} onCondense={vi.fn()} />);
    fireEvent.click(gauge());
    expect((await screen.findByTestId("memory-pop")).textContent).toContain("condensing summarises it");
    rerender(<MemoryGauge pct={90} onCondense={vi.fn()} />);
    expect(screen.getByTestId("memory-pop").textContent).toContain("At 95% the agent condenses on its own");
    expect(screen.getByTestId("memory-pop").textContent).not.toMatch(/start fresh|reset/i);
  });

  it("Condense conversation is disabled when condenseDisabled", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} condenseDisabled onCondense={onCondense} />);
    fireEvent.click(gauge());
    const btn = (await screen.findByRole("button", { name: "Condense conversation" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onCondense).not.toHaveBeenCalled();
  });

  it("while condensing the button reads Condensing… and can't be pressed again", async () => {
    const onCondense = vi.fn();
    render(<MemoryGauge pct={50} condensing onCondense={onCondense} />);
    fireEvent.click(gauge());
    const pop = await screen.findByTestId("memory-pop");
    expect(pop.textContent).toContain("reaches it once that's done");
    const btn = screen.getByRole("button", { name: "Condensing…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("condenseConfirm", () => {
  it("asks in condense terms; mentions typed text only for the composer", () => {
    const withText = condenseConfirm(true);
    expect(withText.title).toBe("Condense this conversation?");
    expect(withText.confirmLabel).toBe("Condense");
    expect(withText.body).toContain("same agent, in the same conversation");
    expect(withText.body).toContain("Anything you've typed guides what the summary keeps.");
    expect(condenseConfirm(false).body).not.toContain("typed");
  });
});
