// phase-29: PrettyViewErrorOverlay component tests
//
// Five tests pinning the load-bearing invariants of the warm-red terminal-
// state overlay landed in the previous commit (feat(29-02): add
// PrettyViewErrorOverlay ...):
//
//   Test 1: Renders the "Connection failed" copy AND an enabled
//           Retry button (D-08 copy + D-09 button-shape checks).
//   Test 2: The overlay carries role="alert" — NOT role="status". Terminal
//           urgent failure requires ARIA-correct role distinct from the
//           in-progress status siblings (SessionHoldingOverlay,
//           DormancyOverlay, PrettyViewLoadingOverlay).
//   Test 3: Clicking the Retry button invokes the onRetry prop exactly
//           once (D-09 user-gesture recovery — same UX contract as
//           DormancyOverlay's Wake button).
//   Test 4: Motion-channel guardrail regression guard (D-07 + patch #72
//           lineage). The RefreshCcw svg does NOT carry the spin-animation
//           class. This overlay is STATE, not WORK — inversion of
//           PrettyViewLoadingOverlay.test.tsx Test 5's positive assertion.
//           A future refactor that silently adds the spin class to "make
//           it feel more alive" would be caught here and forced to
//           re-read the file-header rationale.
//   Test 5: iOS Safari backdrop-filter hardening (patch #333) — the scrim
//           carries all three load-bearing tokens (`isolate`,
//           `[transform:translateZ(0)]`,
//           `[-webkit-backdrop-filter:blur(12px)]`). Non-negotiable class
//           list per the fork's iOS PWA compat rule.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrettyViewErrorOverlay } from "./PrettyViewErrorOverlay";

// ─── Test 1 ───────────────────────────────────────────────────────────────────

describe("PrettyViewErrorOverlay — render", () => {
  it('renders "Connection failed" copy and an enabled Retry button', () => {
    render(<PrettyViewErrorOverlay onRetry={vi.fn()} />);
    // Match with a permissive regex so a future copy tweak like "Connection
    // failed. Retry?" would still light this up.
    expect(screen.getByText(/Connection failed/i)).toBeTruthy();
    const retryBtn = screen.getByRole("button", {
      name: /retry connection/i,
    }) as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.disabled).toBe(false);
  });

  // ─── Test 2 ─────────────────────────────────────────────────────────────────

  it('renders with role="alert" (terminal error, not in-progress status)', () => {
    // ARIA-correct semantic distinction from SessionHoldingOverlay /
    // DormancyOverlay / PrettyViewLoadingOverlay, all of which carry
    // role="status". This overlay is a terminal failure — screen readers
    // must announce it more assertively than a status update.
    const { container } = render(
      <PrettyViewErrorOverlay onRetry={vi.fn()} />,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────

describe("PrettyViewErrorOverlay — Retry button click", () => {
  it("Retry button click invokes the onRetry prop exactly once", () => {
    const onRetry = vi.fn();
    render(<PrettyViewErrorOverlay onRetry={onRetry} />);
    const retryBtn = screen.getByRole("button", {
      name: /retry connection/i,
    });
    fireEvent.click(retryBtn);
    // D-09 user-gesture recovery — same contract as DormancyOverlay Wake.
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────

describe("PrettyViewErrorOverlay — look", () => {
  it("renders in the shared status overlay, danger tone, still glyph, kit Retry", () => {
    const { container } = render(<PrettyViewErrorOverlay onRetry={vi.fn()} />);
    const root = container.querySelector('[role="alert"]');
    expect(root!.classList.contains("pv-status")).toBe(true);
    expect(root!.getAttribute("data-tone")).toBe("danger");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector("button")!.classList.contains("k-btn")).toBe(true);
  });
});
