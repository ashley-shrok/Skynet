/**
 * Phase 34 Plan 03 — WaitingBubble unit tests.
 *
 * Seven tests covering:
 *   Test 1: Renders the reason string passed via props exactly.
 *   Test 2: Has role="status" and aria-label including "waiting" + reason.
 *   Test 3: Outer container has justify-start (assistant-aligned).
 *   Test 4: Bubble div includes Phase 4 Glass className tokens:
 *           rounded-[var(--radius-pv-bubble)], hsla(var(--pv-id-hue)
 *           (substring checks), and NO backdrop blur (iPhone scroll jank).
 *   Test 5: Renders Hand icon SVG with aria-hidden="true".
 *   Test 6: Renders NO buttons anywhere in the tree (no interactive controls).
 *   Test 7: reason=null or "" → fallback "Waiting on you" + role/aria-label.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WaitingBubble } from "./WaitingBubble";

// ─── Test 1 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — reason string rendering", () => {
  it("renders the reason string passed via props exactly in the DOM", () => {
    render(<WaitingBubble reason="approve Bash" />);
    expect(screen.getByText("approve Bash")).toBeTruthy();
  });
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — accessibility attributes", () => {
  it('has role="status" and aria-label containing "waiting" and the reason string', () => {
    render(<WaitingBubble reason="sandbox request" />);
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
    expect(label).toContain("sandbox request");
  });
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — assistant-aligned outer container", () => {
  it("outer container div has justify-start class (assistant-aligned, same slot as WipBubble)", () => {
    const { container } = render(<WaitingBubble reason="worker request" />);
    // The outer wrapper is the first child of the container.
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toBeTruthy();
    expect(outer.className).toContain("justify-start");
  });
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — agent bubble look", () => {
  it("bubble div is the agent's solid bubble (pv-bubble-agent + pv-hue-surface), no backdrop blur", () => {
    render(<WaitingBubble reason="dialog open" />);
    // The bubble is the inner div (role="status") — grab it by role.
    // shape-conversation-view: the agent speaks in solid bubbles in its own
    // colour; the look lives in conversation.css.
    const bubble = screen.getByRole("status");
    const cls = bubble.className;
    expect(cls).toContain("pv-bubble-agent");
    expect(cls).toContain("pv-hue-surface");
    expect(cls).not.toContain("backdrop-blur");
  });
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — Hand icon glyph", () => {
  it("renders an SVG with aria-hidden=true (the Hand lucide icon)", () => {
    const { container } = render(<WaitingBubble reason="input needed" />);
    // lucide-react renders icons as <svg> with aria-hidden="true".
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Test 6 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — no interactive controls", () => {
  it("renders NO buttons anywhere in the tree (presence-only, per D-CTX lock)", () => {
    const { container } = render(<WaitingBubble reason="approve Bash" />);
    const buttons = container.querySelectorAll("button");
    // Enforces the "no interactive controls" rule from D-CTX § Waiting bubble.
    expect(buttons.length).toBe(0);
  });
});

// ─── Test 7 ───────────────────────────────────────────────────────────────────

describe("WaitingBubble — null/empty reason fallback", () => {
  it('renders "Waiting on you" fallback when reason is null', () => {
    render(<WaitingBubble reason={null} />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
  });

  it('renders "Waiting on you" fallback when reason is empty string', () => {
    render(<WaitingBubble reason="" />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    const label = statusEl.getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("waiting");
  });
});

// ─── Permission prompt form (Allow / Deny) ────────────────────────────────────

import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { PermissionPromptInfo } from "../../api/claude-session-api";

const PROMPT: PermissionPromptInfo = {
  title: "Bash command",
  description: "Stop dev server, remove scratch DB, show status",
  body: 'pkill -f "vite --port 5173"; rm -f $S/*.db*',
  reason: "Dangerous rm operation on possibly-empty variable path: $S/*.db*",
  autoDenySeconds: 20,
  yesKey: "1",
  noKey: "2",
  fingerprint: "abc123",
};

describe("WaitingBubble — permission prompt form", () => {
  it("says in plain words what the agent wants and why", () => {
    render(
      <WaitingBubble reason="permission prompt" prompt={PROMPT} onAnswer={() => {}} agentName="Leopard" />,
    );
    expect(screen.getByText("Leopard wants to run a command")).toBeTruthy();
    expect(screen.getByText(/Stop dev server, remove scratch DB/)).toBeTruthy();
    expect(screen.getByText(/possibly risky delete/)).toBeTruthy();
    expect(screen.queryByText("permission prompt")).toBeNull();
  });

  it("Allow / Deny call onAnswer with the choice", () => {
    const onAnswer = vi.fn();
    render(<WaitingBubble reason="permission prompt" prompt={PROMPT} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer.mock.calls).toEqual([["allow"], ["deny"]]);
  });

  it("shows the countdown", () => {
    render(<WaitingBubble reason="permission prompt" prompt={PROMPT} secondsLeft={17} onAnswer={() => {}} />);
    expect(screen.getByText("Auto-denies in 0:17")).toBeTruthy();
  });

  it("always shows the real command; Show details adds Claude Code's exact reason", () => {
    render(<WaitingBubble reason="permission prompt" prompt={PROMPT} onAnswer={() => {}} />);
    expect(screen.getByTestId("permission-prompt-body").textContent).toContain("rm -f");
    expect(screen.queryByText(/possibly-empty variable path/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/possibly-empty variable path/)).toBeTruthy();
  });

  it("locks the buttons and explains a sent Deny", () => {
    render(
      <WaitingBubble
        reason="permission prompt"
        prompt={PROMPT}
        onAnswer={() => {}}
        answer={{ fingerprint: "abc123", choice: "deny", status: "sent" }}
      />,
    );
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/waiting for you to say what to do instead/)).toBeTruthy();
  });

  it("re-enables the buttons after a send error", () => {
    render(
      <WaitingBubble
        reason="permission prompt"
        prompt={PROMPT}
        onAnswer={() => {}}
        answer={{ fingerprint: "abc123", choice: "allow", status: "error" }}
      />,
    );
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
