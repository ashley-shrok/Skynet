// ─── SkewLockModal — Vitest coverage (Phase 111 Plan 02, task 3) ─────────────
// 6 tests covering the shell-level non-dismissible modal that renders when
// the skew-lock store transitions to `locked = true`. Non-dismissibility is
// enforced by D-12: no X, no escape, no click-outside; only a Reload button.
// Fatal-mode (reload-loop sentinel) replaces the Reload button with a
// contact-support message.
//
// Palette authority: modal uses only existing `--color-pv-*` tokens with
// direct `var()` — never `--background`/`--foreground` (role-file rule).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { SkewLockModal } from "./SkewLockModal";
import {
  lockSkewedSession,
  __resetForTest,
} from "@/state/skew-lock-store";

const STORAGE_KEY = "skynet_skew_reload_history";

// Stash the real window.location so tests can restore between cases.
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
);

function stubWindowLocationReload(reloadImpl: () => void) {
  Object.defineProperty(window, "location", {
    value: { reload: reloadImpl },
    writable: true,
    configurable: true,
  });
}

function restoreWindowLocation() {
  if (originalLocationDescriptor) {
    Object.defineProperty(window, "location", originalLocationDescriptor);
  }
}

beforeEach(() => {
  __resetForTest();
  sessionStorage.clear();
});

afterEach(() => {
  restoreWindowLocation();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — unlocked state renders null (no DOM).
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: unlocked renders null", () => {
  it("returns null (no dialog in DOM) when getSkewLockedSnapshot().locked === false", () => {
    const { container } = render(<SkewLockModal />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — after lockSkewedSession, modal renders a role=dialog with the
// documented title.
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: locked renders dialog with title", () => {
  it("renders role='dialog' aria-modal='true' with labelledby → 'newer version' heading", () => {
    render(<SkewLockModal />);
    act(() => {
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: "aaa",
        serverBuild: "bbb",
      });
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();

    const heading = document.getElementById(labelId as string);
    expect(heading).not.toBeNull();
    // Case-insensitive match on the documented title.
    expect(heading?.textContent).toMatch(/newer version is available/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Reload button has accessible name matching /reload/i.
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: Reload button accessible name", () => {
  it("renders a button whose accessible name matches /reload/i", () => {
    render(<SkewLockModal />);
    act(() => {
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: "aaa",
        serverBuild: "bbb",
      });
    });
    const btn = screen.getByRole("button", { name: /reload/i });
    expect(btn).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Reload click records an attempt and calls window.location.reload.
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: Reload click → record + location.reload", () => {
  it("clicking Reload records an attempt and calls window.location.reload()", () => {
    const reloadSpy = vi.fn();
    stubWindowLocationReload(reloadSpy);

    render(<SkewLockModal />);
    act(() => {
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: "aaa",
        serverBuild: "bbb",
      });
    });

    const btn = screen.getByRole("button", { name: /reload/i });
    fireEvent.click(btn);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // Attempt should now be persisted to sessionStorage.
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Fatal-mode: pre-seed 4 recent timestamps → modal renders the
// contact-support variant; Reload button is absent (or disabled and doesn't
// call reload).
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: fatal-mode after reload-loop sentinel trips", () => {
  it("renders contact-support text and NO reload-firing behavior when suppress=true", () => {
    // Pre-seed 4 recent timestamps so shouldSuppressReload() returns true.
    const now = Date.now();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([now - 3000, now - 2000, now - 1000, now]),
    );

    const reloadSpy = vi.fn();
    stubWindowLocationReload(reloadSpy);

    render(<SkewLockModal />);
    act(() => {
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: "aaa",
        serverBuild: "bbb",
      });
    });

    // Contact-support text renders.
    expect(screen.getByText(/contact support/i)).toBeTruthy();

    // Reload button is EITHER absent OR present-but-disabled + does-not-reload.
    const btn = screen.queryByRole("button", { name: /reload/i });
    if (btn === null) {
      // Absent — no click possible. reload spy should still be zero.
      expect(reloadSpy).not.toHaveBeenCalled();
    } else {
      // Present — click must not call location.reload.
      fireEvent.click(btn);
      expect(reloadSpy).not.toHaveBeenCalled();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — While locked, `inert` attribute is set on #root; when the
// component unmounts (proxy for unlock in tests), the attribute is removed.
// ─────────────────────────────────────────────────────────────────────────────

describe("SkewLockModal: inert on #root while locked", () => {
  it("sets inert on #root while locked; removes it on unmount", () => {
    // Provide a fake #root element for the effect to find.
    const fakeRoot = document.createElement("div");
    fakeRoot.id = "root";
    const setAttrSpy = vi.spyOn(fakeRoot, "setAttribute");
    const removeAttrSpy = vi.spyOn(fakeRoot, "removeAttribute");
    document.body.appendChild(fakeRoot);

    const { unmount } = render(<SkewLockModal />);
    act(() => {
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: "aaa",
        serverBuild: "bbb",
      });
    });

    expect(setAttrSpy).toHaveBeenCalledWith("inert", expect.any(String));

    unmount();
    expect(removeAttrSpy).toHaveBeenCalledWith("inert");

    document.body.removeChild(fakeRoot);
  });
});
