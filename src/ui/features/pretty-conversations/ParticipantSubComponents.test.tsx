// Phase 91 Plan 04 — ParticipantSubComponents.test.tsx
//
// Consolidated test file for:
//   - ParticipantChip (Tests 3-5)
//   - ParticipantChipStrip (Tests 6-7)
//   - ParticipantSearchInput (Tests 8-10)
//
// Uses vitest + @testing-library/react + fixture builders at top.
// Api-client tests (Tests 1-2) live in relay-room-create-api.test.ts.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ParticipantChip } from "./ParticipantChip";
import { ParticipantChipStrip } from "./ParticipantChipStrip";
import { ParticipantSearchInput } from "./ParticipantSearchInput";
import type { PickedParticipant } from "./participant-types";

// ─── Fixture builders ─────────────────────────────────────────────────────

function makeHuman(overrides: Partial<PickedParticipant> = {}): PickedParticipant {
  return {
    mxid: "@a:s",
    displayName: "Alice",
    colorHue: 200,
    avatarUrl: null,
    role: "human",
    userId: "u1",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<PickedParticipant> = {}): PickedParticipant {
  return {
    mxid: "@bot:s",
    displayName: "BotAgent",
    colorHue: 120,
    avatarUrl: null,
    role: "agent",
    identityKey: "bot-key",
    subtitle: "the bounty maintainer",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── ParticipantChip ──────────────────────────────────────────────────────

describe("ParticipantChip (Phase 91 Plan 04)", () => {
  // Test 3: basic render
  it("Test 3: renders displayName, color swatch with correct hue, and X-remove button with aria-label", () => {
    const onRemove = vi.fn();
    render(
      <ParticipantChip
        participant={makeHuman({ mxid: "@a:s", displayName: "Alice", colorHue: 200 })}
        onRemove={onRemove}
      />,
    );

    // displayName text visible
    expect(screen.getByText("Alice")).toBeInTheDocument();

    // Color swatch has hsl(200 in the swatch color value.
    // jsdom normalizes inline style HSL to RGB; use data-swatch-color
    // attribute (set by ParticipantChip) to assert the original HSL string.
    const chip = screen.getByTestId("participant-chip");
    const swatch = chip.querySelector("[aria-hidden]") as HTMLElement | null;
    expect(swatch).not.toBeNull();
    expect(swatch!.getAttribute("data-swatch-color")).toContain("hsl(200");

    // X-remove button has correct aria-label
    const removeBtn = screen.getByRole("button", { name: "Remove Alice" });
    expect(removeBtn).toBeInTheDocument();
  });

  // Test 4: X-remove fires onRemove with mxid
  it("Test 4: clicking X-remove button calls onRemove with the participant mxid", () => {
    const onRemove = vi.fn();
    render(
      <ParticipantChip
        participant={makeHuman({ mxid: "@a:s", displayName: "Alice", colorHue: 200 })}
        onRemove={onRemove}
      />,
    );
    const removeBtn = screen.getByRole("button", { name: "Remove Alice" });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith("@a:s");
  });

  // Test 5: colorHue=null fallback → NEUTRAL_GREY
  it("Test 5: colorHue=null renders swatch with NEUTRAL_GREY fallback hsl(210, 8%, 50%)", () => {
    render(
      <ParticipantChip
        participant={makeHuman({ colorHue: null })}
        onRemove={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("participant-chip");
    const swatch = chip.querySelector("[aria-hidden]") as HTMLElement | null;
    expect(swatch).not.toBeNull();
    // jsdom normalizes HSL to RGB in style; use data-swatch-color attribute
    // (set by ParticipantChip) to assert the original NEUTRAL_GREY HSL string.
    expect(swatch!.getAttribute("data-swatch-color")).toBe("hsl(210, 8%, 50%)");
  });
});

// ─── ParticipantChipStrip ─────────────────────────────────────────────────

describe("ParticipantChipStrip (Phase 91 Plan 04)", () => {
  // Test 6: empty state — placeholder visible, no role='list'
  it("Test 6: empty picked array renders placeholder text, no role=list emitted", () => {
    render(<ParticipantChipStrip picked={[]} onRemove={vi.fn()} />);
    expect(screen.getByText(/no participants selected yet/i)).toBeInTheDocument();
    // role='list' must NOT be present when empty
    expect(screen.queryByRole("list")).toBeNull();
  });

  // Test 7: populated — 2 chips, role='list' with aria-label, 2 listitem roles
  it("Test 7: populated strip renders chips with role=list and aria-label='Selected participants'", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    const b = makeHuman({ mxid: "@b:s", displayName: "Bob", userId: "u2" });
    render(
      <ParticipantChipStrip picked={[a, b]} onRemove={vi.fn()} />,
    );

    // role='list' present
    const list = screen.getByRole("list", { name: "Selected participants" });
    expect(list).toBeInTheDocument();

    // 2 listitem roles
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // Both names visible
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });
});

// ─── ParticipantSearchInput ───────────────────────────────────────────────

describe("ParticipantSearchInput (Phase 91 Plan 04)", () => {
  // Test 8: controlled behavior — no clear when value=''; clear appears for non-empty; click clears
  it("Test 8: no clear button when value empty; clear visible when value non-empty; clicking clear fires onChange('')", () => {
    const onChange = vi.fn();

    // Initial render — no clear button
    const { rerender } = render(
      <ParticipantSearchInput value="" onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();

    // Re-render with value='ab' — clear button appears
    rerender(<ParticipantSearchInput value="ab" onChange={onChange} />);
    const clearBtn = screen.getByRole("button", { name: /clear search/i });
    expect(clearBtn).toBeInTheDocument();

    // Click clear — onChange fires with ''
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith("");
  });

  // Test 9: a11y attributes
  it("Test 9: input has aria-label='Search participants' and placeholder='Search participants'", () => {
    render(<ParticipantSearchInput value="" onChange={vi.fn()} />);
    const input = screen.getByRole("searchbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-label", "Search participants");
    expect(input).toHaveAttribute("placeholder", "Search participants");
  });

  // Test 10: CSS class reuse — verified via source grep (acceptance criteria);
  // here we verify the DOM elements carry the expected class names at runtime.
  it("Test 10: DOM elements carry pv-search-container, pv-search-input, pv-search-clear class names", () => {
    const { rerender } = render(
      <ParticipantSearchInput value="" onChange={vi.fn()} />,
    );

    // pv-search-container on outer div
    const container = document.querySelector(".pv-search-container");
    expect(container).not.toBeNull();

    // pv-search-input on the input
    const inputEl = document.querySelector(".pv-search-input");
    expect(inputEl).not.toBeNull();
    expect(inputEl?.tagName.toLowerCase()).toBe("input");

    // pv-search-clear on the clear button (need non-empty value)
    rerender(<ParticipantSearchInput value="x" onChange={vi.fn()} />);
    const clearEl = document.querySelector(".pv-search-clear");
    expect(clearEl).not.toBeNull();
  });
});
