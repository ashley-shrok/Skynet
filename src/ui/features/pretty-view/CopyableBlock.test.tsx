/**
 * CopyableBlock unit tests — quick task 260730-ujq.
 *
 * Covers:
 *   A. Children rendered inside the correct wrapper element.
 *   B. Copy button present with stable data-testid.
 *   C. Click copies plain text via navigator.clipboard.writeText.
 *   D. Copied affordance appears then reverts after 1500ms (fake timers).
 *   E. window.electronClipboard path preferred when available.
 *   F. Rejection from clipboard.writeText is swallowed (no unhandled promise rejection).
 *
 * NOTE on mocking navigator.clipboard in vitest jsdom:
 *   In vitest's jsdom environment, the component module and the test module
 *   may reference navigator through different prototype chains. Setting
 *   Object.defineProperty(navigator, 'clipboard', ...) only patches the
 *   test module's navigator view. The component sees the real jsdom Clipboard
 *   instance. The fix is to replace window.navigator with a Proxy that
 *   intercepts the 'clipboard' getter — the component's `window.navigator`
 *   access then sees our mock.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyableBlock } from "./CopyableBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Navigator clipboard mock via Proxy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces window.navigator with a Proxy that returns a mock clipboard.
 * The component accesses navigator.clipboard at click-time through this proxy,
 * so our vi.fn() is the function that actually gets called.
 *
 * Returns the mock writeText function and a restore() function.
 */
function mockNavigatorClipboard(writeImpl: () => Promise<void>): {
  writeText: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const writeText = vi.fn().mockImplementation(writeImpl);
  const mockClipboard = { writeText, readText: vi.fn() };
  const origNav = window.navigator;
  const navProxy = new Proxy(origNav, {
    get(target: Navigator, key: string | symbol) {
      if (key === "clipboard") return mockClipboard;
      const val = (target as Record<string | symbol, unknown>)[key];
      return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(target) : val;
    },
  });
  Object.defineProperty(window, "navigator", {
    configurable: true,
    writable: true,
    value: navProxy,
  });
  return {
    writeText,
    restore() {
      Object.defineProperty(window, "navigator", {
        configurable: true,
        writable: true,
        value: origNav,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Global cleanup after each test
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).electronClipboard;
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CopyableBlock", () => {
  // Test A: renders children inside the correct wrapper element.
  it("A: renders <code>hello</code> inside a <pre> when as='pre'", () => {
    render(
      <CopyableBlock as="pre">
        <code>hello</code>
      </CopyableBlock>,
    );
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")?.textContent).toBe("hello");
  });

  it("A: renders children inside a <blockquote> when as='blockquote'", () => {
    render(
      <CopyableBlock as="blockquote">quoted text</CopyableBlock>,
    );
    const bq = document.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("quoted text");
  });

  // Test B: copy button is present with a stable data-testid and accessible name.
  it("B: renders a button with data-testid='copyable-block-copy' and accessible name matching /copy/i", () => {
    render(
      <CopyableBlock as="pre">
        <code>test</code>
      </CopyableBlock>,
    );
    const btn = screen.getByTestId("copyable-block-copy");
    expect(btn).not.toBeNull();
    // getByRole validates the accessible name via aria-label.
    expect(screen.getByRole("button", { name: /copy/i })).not.toBeNull();
  });

  // Test C: clicking the button calls navigator.clipboard.writeText with the
  // block's plain text content.
  it("C: click calls navigator.clipboard.writeText with the block's plain text", async () => {
    const { writeText, restore } = mockNavigatorClipboard(() => Promise.resolve());
    try {
      const user = userEvent.setup();

      render(
        <CopyableBlock as="pre">
          <code>hello world</code>
        </CopyableBlock>,
      );

      await user.click(screen.getByTestId("copyable-block-copy"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("hello world");
    } finally {
      restore();
    }
  });

  it("C: blockquote — concatenated textContent is passed to writeText", async () => {
    const { writeText, restore } = mockNavigatorClipboard(() => Promise.resolve());
    try {
      const user = userEvent.setup();

      render(
        <CopyableBlock as="blockquote">
          <p>first line</p>
          <p>second line</p>
        </CopyableBlock>,
      );

      await user.click(screen.getByTestId("copyable-block-copy"));
      expect(writeText).toHaveBeenCalledTimes(1);
      // textContent joins all descendants without separator.
      expect(writeText.mock.calls[0][0]).toContain("first line");
      expect(writeText.mock.calls[0][0]).toContain("second line");
    } finally {
      restore();
    }
  });

  // Test D: Copied affordance appears immediately after click, then reverts
  // to idle state after 1500ms (fake timers).
  describe("D: Copied affordance and timer revert", () => {
    let restoreNav: (() => void) | null = null;

    beforeEach(() => {
      const { restore } = mockNavigatorClipboard(() => Promise.resolve());
      restoreNav = restore;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      restoreNav?.();
      restoreNav = null;
    });

    it("shows Copied state immediately then reverts after 1500ms", async () => {
      render(
        <CopyableBlock as="pre">
          <code>snippet</code>
        </CopyableBlock>,
      );

      // Before click: idle state.
      expect(screen.getByRole("button", { name: /copy/i })).not.toBeNull();
      expect(screen.queryByTestId("copyable-block-check")).toBeNull();

      // Use act to click and flush the microtask queue (promise resolution).
      const btn = screen.getByTestId("copyable-block-copy");
      await act(async () => {
        btn.click();
        // Flush microtasks so the writeText promise resolves and setState fires.
        await Promise.resolve();
        await Promise.resolve();
      });

      // Immediately after click: Copied state.
      expect(screen.getByRole("button", { name: /copied/i })).not.toBeNull();
      expect(screen.getByTestId("copyable-block-check")).not.toBeNull();

      // Advance 1500ms — should revert to idle.
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      expect(screen.getByRole("button", { name: /copy/i })).not.toBeNull();
      expect(screen.queryByTestId("copyable-block-check")).toBeNull();
    });
  });

  // Test E: when window.electronClipboard is available, it is preferred over
  // navigator.clipboard.writeText.
  it("E: prefers window.electronClipboard.writeText when available", async () => {
    const { writeText: navWriteText, restore } = mockNavigatorClipboard(() =>
      Promise.resolve(),
    );
    const electronWriteText = vi.fn().mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electronClipboard = {
      writeText: electronWriteText,
      readText: vi.fn(),
    };

    try {
      const user = userEvent.setup();

      render(
        <CopyableBlock as="pre">
          <code>electron path</code>
        </CopyableBlock>,
      );

      await user.click(screen.getByTestId("copyable-block-copy"));

      expect(electronWriteText).toHaveBeenCalledTimes(1);
      expect(navWriteText).not.toHaveBeenCalled();
    } finally {
      restore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).electronClipboard;
    }
  });

  // Test F: when navigator.clipboard.writeText rejects, the button stays in
  // idle state and does NOT throw (no unhandled promise rejection).
  it("F: write failure is swallowed — button stays in idle state", async () => {
    const { restore } = mockNavigatorClipboard(() =>
      Promise.reject(new Error("denied")),
    );
    try {
      const user = userEvent.setup();

      render(
        <CopyableBlock as="pre">
          <code>should fail silently</code>
        </CopyableBlock>,
      );

      // Click should resolve without throwing.
      await expect(
        user.click(screen.getByTestId("copyable-block-copy")),
      ).resolves.not.toThrow();

      // Allow async microtasks to settle.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Button must still show idle /copy/i state after a failed write.
      expect(screen.getByRole("button", { name: /copy/i })).not.toBeNull();
      expect(screen.queryByTestId("copyable-block-check")).toBeNull();
      expect(screen.queryByRole("button", { name: /copied/i })).toBeNull();
    } finally {
      restore();
    }
  });
});
