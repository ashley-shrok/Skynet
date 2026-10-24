// MemoryGauge — the composer's agent-memory pie (shape-conversation-view).
// Grey and silent below 45%, amber from 45%, red from 78%; holds its last
// reading through brief null dropouts; emptied (draining / holding) shows as
// unknown; tapping opens a pop-over whose Start fresh runs the reset.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryGauge, memoryBand } from "./MemoryGauge";

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
    render(<MemoryGauge pct={30} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("grey");
    expect(gauge().getAttribute("data-pct")).toBe("30");
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory: 30% used");
    expect(gauge().textContent).not.toContain("%");
  });

  it("amber and red bands show the percentage", () => {
    const { rerender } = render(<MemoryGauge pct={50} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("amber");
    expect(gauge().textContent).toContain("50%");
    rerender(<MemoryGauge pct={80} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-band")).toBe("red");
    expect(gauge().textContent).toContain("80%");
  });

  it("unknown before any reading: no data-pct, plain 'Agent memory' label", () => {
    render(<MemoryGauge pct={null} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBeNull();
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory");
  });

  it("holds the last reading through a null dropout", () => {
    const { rerender } = render(<MemoryGauge pct={60} onStartFresh={vi.fn()} />);
    rerender(<MemoryGauge pct={null} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBe("60");
    expect(gauge().getAttribute("data-band")).toBe("amber");
    rerender(<MemoryGauge pct={62} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBe("62");
  });

  it("emptied (draining / holding) shows unknown and forgets the held reading", () => {
    const { rerender } = render(<MemoryGauge pct={80} onStartFresh={vi.fn()} />);
    rerender(<MemoryGauge pct={80} emptied onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBeNull();
    expect(gauge().getAttribute("data-band")).toBe("grey");
    // After the reset, a null dropout does not bring the old reading back.
    rerender(<MemoryGauge pct={null} onStartFresh={vi.fn()} />);
    expect(gauge().getAttribute("data-pct")).toBeNull();
  });

  it("tapping opens the pop-over; Start fresh runs the reset and closes it", async () => {
    const onStartFresh = vi.fn();
    render(<MemoryGauge pct={50} onStartFresh={onStartFresh} />);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
    fireEvent.click(gauge());
    const pop = await screen.findByTestId("memory-pop");
    expect(pop.textContent).toContain("50% used");
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(onStartFresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("memory-pop")).toBeNull();
  });

  it("Start fresh is disabled when resetDisabled", async () => {
    const onStartFresh = vi.fn();
    render(<MemoryGauge pct={50} resetDisabled onStartFresh={onStartFresh} />);
    fireEvent.click(gauge());
    const btn = (await screen.findByRole("button", { name: "Start fresh" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onStartFresh).not.toHaveBeenCalled();
  });
});
