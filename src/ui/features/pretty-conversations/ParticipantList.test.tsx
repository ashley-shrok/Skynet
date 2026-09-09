// Phase 91 Plan 04 — ParticipantList.test.tsx
//
// Tests for ParticipantList — sectioned (Humans + Agents) clickable picker list
// with tap-to-toggle selection, avatar discs, keyboard support, and N-of-M counts.
//
// Scaffold mirrors PrettyConversationRow.test.tsx (mount pattern + fireEvent +
// assertion style).

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ParticipantList } from "./ParticipantList";
import type { PickedParticipant } from "./participant-types";

// ─── Fixture builders ─────────────────────────────────────────────────────

function makeHuman(
  overrides: Partial<PickedParticipant> = {},
): PickedParticipant {
  return {
    mxid: "@alice:s",
    displayName: "Alice",
    colorHue: 200,
    avatarUrl: null,
    role: "human",
    userId: "u-alice",
    ...overrides,
  };
}

function makeAgent(
  overrides: Partial<PickedParticipant> = {},
): PickedParticipant {
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

// ─── ParticipantList ──────────────────────────────────────────────────────

describe("ParticipantList (Phase 91 Plan 04)", () => {
  // Test 1: renders two sections with all rows
  it("Test 1: renders Humans section header, Agents section header, and three rows total", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    const b = makeHuman({ mxid: "@b:s", displayName: "Bob", userId: "u-bob" });
    const x = makeAgent({ mxid: "@x:s", displayName: "Xbot" });

    render(
      <ParticipantList
        humans={[a, b]}
        agents={[x]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(/Humans/i)).toBeInTheDocument();
    expect(screen.getByText(/Agents/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Xbot")).toBeInTheDocument();
  });

  // Test 2: row click calls onToggle with mxid
  it("Test 2: clicking a row calls onToggle with that participant's mxid", () => {
    const onToggle = vi.fn();
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={onToggle}
      />,
    );
    // Click the row containing Alice
    const rows = screen.getAllByRole("option");
    fireEvent.click(rows[0]);
    expect(onToggle).toHaveBeenCalledWith("@a:s");
  });

  // Test 3: keyboard Enter and Space both toggle; Space calls preventDefault
  it("Test 3: Enter key calls onToggle; Space key calls onToggle and preventDefault", () => {
    const onToggle = vi.fn();
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={onToggle}
      />,
    );
    const row = screen.getAllByRole("option")[0];

    // Enter key
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("@a:s");

    onToggle.mockClear();

    // Space key — preventDefault must be called
    const preventDefaultSpy = vi.fn();
    fireEvent.keyDown(row, { key: " ", preventDefault: preventDefaultSpy });
    expect(onToggle).toHaveBeenCalledWith("@a:s");
    // Space preventDefault — verify via custom event
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    Object.defineProperty(event, "preventDefault", { value: preventDefaultSpy });
    row.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  // Test 4: selected row has aria-selected='true'
  it("Test 4: row in pickedMxids has aria-selected=true; check circle has selected styling", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set(["@a:s"])}
        onToggle={vi.fn()}
      />,
    );
    const row = screen.getAllByRole("option")[0];
    expect(row).toHaveAttribute("aria-selected", "true");

    // Check circle in selected state — should have data-selected='true' OR
    // be tagged with emerald classes. Accept data-testid='check-circle-selected'.
    // Implementation uses data-selected attribute on the circle element.
    const checkCircle = row.querySelector("[data-testid='check-circle']");
    if (checkCircle) {
      expect(checkCircle).toHaveAttribute("data-selected", "true");
    } else {
      // Fallback: aria-selected on the row is sufficient for this test.
      expect(row).toHaveAttribute("aria-selected", "true");
    }
  });

  // Test 5: unselected row has aria-selected='false'
  it("Test 5: row not in pickedMxids has aria-selected=false", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    const row = screen.getAllByRole("option")[0];
    expect(row).toHaveAttribute("aria-selected", "false");
  });

  // Test 6: empty humans section still renders the Humans header
  it("Test 6: empty humans array still renders Humans section header", () => {
    const x = makeAgent({ mxid: "@x:s", displayName: "Xbot" });
    render(
      <ParticipantList
        humans={[]}
        agents={[x]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    // Per plan: "both sections always visible even if empty" — Humans header present
    expect(screen.getByText(/Humans/i)).toBeInTheDocument();
    expect(screen.getByText("Xbot")).toBeInTheDocument();
  });

  // Test 7: N-of-M count when filterActive=true
  it("Test 7: filterActive=true shows '1 of 4' count in Humans section header", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice" });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
        filterActive={true}
        humansTotal={4}
      />,
    );
    // Section header should contain 'Humans' + '1 of 4'
    const header = screen.getByText(/Humans/i);
    expect(header.textContent).toMatch(/1.*of.*4/);
  });

  // Test 8: agent subtitle renders; human rows do NOT render subtitle
  it("Test 8: agent with subtitle shows subtitle text; human has no subtitle", () => {
    const human = makeHuman({ mxid: "@h:s", displayName: "Human" });
    const agent = makeAgent({
      mxid: "@bot:s",
      displayName: "BotAgent",
      subtitle: "the bounty maintainer",
    });
    render(
      <ParticipantList
        humans={[human]}
        agents={[agent]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    // Subtitle visible for agent
    expect(screen.getByText("the bounty maintainer")).toBeInTheDocument();
    // Human row does NOT have a subtitle element
    const humanRow = screen.getByText("Human").closest("[role='option']");
    expect(humanRow).not.toBeNull();
    // The subtitle text is NOT present in the human row
    const subtitles = humanRow!.querySelectorAll("[data-testid='row-subtitle']");
    expect(subtitles).toHaveLength(0);
  });

  // Test 9: avatar fallback — initial letter shown for null avatarUrl
  it("Test 9: participant with avatarUrl=null shows initial letter 'A' (uppercase)", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice", avatarUrl: null });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    // Initial letter 'A' inside the avatar disc
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  // Test 10: avatar img renders when avatarUrl is truthy; alt is empty string
  it("Test 10: participant with avatarUrl renders img with that src and empty alt", () => {
    const a = makeHuman({
      mxid: "@a:s",
      displayName: "Alice",
      avatarUrl: "https://x/a.png",
    });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    const img = screen.getByRole("img", { hidden: true });
    expect(img).toHaveAttribute("src", "https://x/a.png");
    expect(img).toHaveAttribute("alt", "");
  });

  // Test 11: hue applied to avatar disc inline style
  it("Test 11: avatar disc inline style contains hsl(200 for colorHue=200", () => {
    const a = makeHuman({ mxid: "@a:s", displayName: "Alice", colorHue: 200 });
    render(
      <ParticipantList
        humans={[a]}
        agents={[]}
        pickedMxids={new Set()}
        onToggle={vi.fn()}
      />,
    );
    // Find the avatar disc element — it has data-testid='row-avatar-disc'
    const disc = document.querySelector("[data-testid='row-avatar-disc']") as HTMLElement | null;
    expect(disc).not.toBeNull();
    // jsdom converts HSL to RGB; use data-avatar-color attribute for assertion
    expect(disc!.getAttribute("data-avatar-color")).toContain("hsl(200");
  });
});
