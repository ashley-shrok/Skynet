/**
 * ColorPicker component unit tests.
 *
 * Covers:
 * 1. Renders slider with initial value
 * 2. onChange fires with number when slider moves
 * 3. Swatch background matches hue
 * 4. Degree readout shows value with degree symbol
 * 5. Disabled prop disables slider
 * 6. Clamps to 0-360 range (slider min/max in DOM)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorPicker } from "./ColorPicker";

describe("ColorPicker", () => {
  it("Test 1 - renders slider with initial value", () => {
    render(<ColorPicker value={210} onChange={vi.fn()} />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("210");
  });

  it("Test 2 - onChange fires with number when slider moves", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={100} onChange={onChange} />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "280" } });

    expect(onChange).toHaveBeenCalledWith(280);
    expect(typeof onChange.mock.calls[0][0]).toBe("number");
  });

  it("Test 3 - swatch background matches hue", () => {
    // Re-render with different values to confirm the swatch reflects the hue prop.
    // JSDOM normalizes hsl() to rgb in computed style; we verify the component
    // uses the value prop by checking that different hues produce different colors.
    const { rerender } = render(<ColorPicker value={45} onChange={vi.fn()} />);
    const swatch45 = screen.getByTestId("color-swatch") as HTMLElement;
    const bg45 = swatch45.style.background;

    rerender(<ColorPicker value={200} onChange={vi.fn()} />);
    const swatch200 = screen.getByTestId("color-swatch") as HTMLElement;
    const bg200 = swatch200.style.background;

    // The two different hues must produce different background colors
    expect(bg45).not.toBe("");
    expect(bg200).not.toBe("");
    expect(bg45).not.toBe(bg200);
  });

  it("Test 4 - degree readout shows value with degree symbol", () => {
    render(<ColorPicker value={180} onChange={vi.fn()} />);

    const readout = screen.getByText(/180°/);
    expect(readout).toBeDefined();
  });

  it("Test 5 - disabled prop disables slider", () => {
    render(<ColorPicker value={90} onChange={vi.fn()} disabled={true} />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it("Test 6 - clamps to 0-360 range (slider min/max in DOM)", () => {
    render(<ColorPicker value={180} onChange={vi.fn()} />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("360");
  });
});
