/**
 * Phase 38 Wave 2 (plan 38-02) — ShareIdentityPicker tests
 *
 * Covers the nine behaviors enumerated in the plan's <behavior> block:
 *   1. Empty list → renders null (no DOM output)
 *   2. Populated list → trigger button renders with correct aria-label
 *   3. Open menu → all usernames appear as selectable items
 *   4. Already-shared marker renders for userId in alreadySharedUserIds set
 *   5. Already-shared row is NOT aria-disabled (still selectable per CONTEXT)
 *   6. Click unshared row → shareIdentity called; onShareSuccess fires with shared:true
 *   7. Click already-shared row → shareIdentity STILL called; onShareSuccess fires with shared:false
 *   8. toast.success called with the correct message for both shared:true and shared:false
 *   9. getUsersListBasic rejects → picker renders null (graceful hide)
 *  10. Unmount during pending fetch → no state-update-on-unmounted warning
 *  11. Trust-the-backend: getUsersListBasic returns the list without the current
 *      user; the current user never appears (self-exclusion is server-side)
 *
 * Mocks:
 *   - @/api/identities-api    → shareIdentity (per-test mockResolvedValue / mockRejectedValue)
 *   - @/api/user-management-api → getUsersListBasic (per-test mockResolvedValue / mockRejectedValue)
 *   - sonner                  → toast.success + toast.error spies
 *
 * jsdom shims: Radix DropdownMenu's Popper uses pointer-capture methods and
 * ResizeObserver which jsdom does not implement. We stub the minimum surface
 * needed for the DropdownMenu to open + render its content without crashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Radix DropdownMenu opens on `pointerdown` (not `click`). fireEvent.click
 * dispatches only the click event and does NOT open the menu. userEvent's
 * pointer helper synthesizes the pointerdown→pointerup→click sequence that
 * Radix listens for, so we use userEvent for menu open + item select.
 *
 * Note: userEvent.setup() with `pointerEventsCheck: 0` disables the
 * pointer-events:none guard that would otherwise fail on Radix's default
 * styles in jsdom.
 */
function makeUser() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

// ── jsdom shims for Radix Popper (used by DropdownMenu) ──────────────────────
// These live at module scope so they are in place before any component
// renders (Radix touches these on first mount).
if (typeof Element !== "undefined") {
  // Radix Popper's collision detection calls hasPointerCapture/setPointerCapture
  // during pointer interactions. jsdom does not implement them → TypeError.
  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: (id: number) => boolean }).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture) {
    (Element.prototype as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  }
  if (!(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
    (Element.prototype as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = () => {};
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
}
if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    shareIdentity: vi.fn(),
  };
});

vi.mock("@/api/user-management-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getUsersListBasic: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Late imports (after mocks are registered) ────────────────────────────────
import { shareIdentity } from "@/api/identities-api";
import { getUsersListBasic } from "@/api/user-management-api";
import { toast } from "sonner";
import { ShareIdentityPicker } from "./ShareIdentityPicker";

const mockedShareIdentity = vi.mocked(shareIdentity);
const mockedGetUsersListBasic = vi.mocked(getUsersListBasic);
const mockedToastSuccess = vi.mocked(toast.success);

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ShareIdentityPicker (Phase 38 Wave 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Test 1: empty-state hide contract
  it("Test 1: renders null when getUsersListBasic returns an empty array", async () => {
    mockedGetUsersListBasic.mockResolvedValue([]);
    const onShareSuccess = vi.fn();

    const { container } = render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    // Wait for the fetch to settle.
    await waitFor(() => {
      expect(mockedGetUsersListBasic).toHaveBeenCalledTimes(1);
    });

    // After settle: no trigger, no children — the component returns null.
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button", { name: /share identity/i })).toBeNull();
  });

  // Test 2: populated list renders the trigger
  it("Test 2: renders share trigger button when getUsersListBasic returns users", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
      { id: "u-2", username: "carol" },
    ]);
    const onShareSuccess = vi.fn();

    render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-label")).toBe("Share identity");
  });

  // Test 3: opening the menu reveals every username
  it("Test 3: opening the picker lists every user from getUsersListBasic", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
      { id: "u-2", username: "carol" },
    ]);
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    // Radix DropdownMenu portals its content into document.body; querying by
    // role="menuitem" or by accessible name finds it regardless of portal.
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /share with bob/i })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /share with carol/i })).toBeTruthy();
    });
  });

  // Test 4: already-shared marker appears for userIds in the Set
  it("Test 4: renders 'shared' marker for users in alreadySharedUserIds", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
      { id: "u-2", username: "carol" },
    ]);
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set(["u-1"])}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    await waitFor(() => {
      // Bob (u-1) is already-shared — item's aria-label reflects that
      const bobRow = screen.getByRole("menuitem", { name: /bob \(already shared\)/i });
      expect(bobRow).toBeTruthy();
      // Marker text "shared" lives inside bob's row
      expect(bobRow.textContent?.toLowerCase()).toContain("shared");
    });

    // Carol (u-2) is NOT already-shared — accessible name is "Share with carol"
    const carolRow = screen.getByRole("menuitem", { name: /share with carol/i });
    // Marker "shared" text NOT in carol's row
    expect(carolRow.textContent?.toLowerCase()).not.toContain("shared");
  });

  // Test 5: already-shared row is not aria-disabled (still selectable)
  it("Test 5: already-shared row is NOT aria-disabled (remains selectable)", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
    ]);
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set(["u-1"])}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    await waitFor(() => {
      const bobRow = screen.getByRole("menuitem", { name: /bob \(already shared\)/i });
      // Radix disabled state sets data-disabled + aria-disabled attributes.
      expect(bobRow.getAttribute("aria-disabled")).not.toBe("true");
      expect(bobRow.getAttribute("data-disabled")).toBeNull();
    });
  });

  // Test 6: clicking an unshared user calls shareIdentity + onShareSuccess(shared:true)
  it("Test 6: click unshared row → shareIdentity called; onShareSuccess fires with shared:true", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
      { id: "u-2", username: "carol" },
    ]);
    mockedShareIdentity.mockResolvedValue({
      identityId: "new-uuid",
      shared: true,
    });
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-src"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    const carolRow = await screen.findByRole("menuitem", { name: /share with carol/i });
    await user.click(carolRow);

    await waitFor(() => {
      expect(mockedShareIdentity).toHaveBeenCalledTimes(1);
      expect(mockedShareIdentity).toHaveBeenCalledWith("id-src", "u-2");
    });

    await waitFor(() => {
      expect(onShareSuccess).toHaveBeenCalledTimes(1);
      expect(onShareSuccess).toHaveBeenCalledWith({
        targetUserId: "u-2",
        shared: true,
        resultingIdentityId: "new-uuid",
      });
    });
  });

  // Test 7: clicking already-shared user STILL calls shareIdentity (no client-side no-op)
  it("Test 7: click already-shared row → shareIdentity STILL called; onShareSuccess fires with shared:false", async () => {
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-1", username: "bob" },
    ]);
    mockedShareIdentity.mockResolvedValue({
      identityId: "existing-uuid",
      shared: false,
    });
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-src"
        identityKey="tina"
        alreadySharedUserIds={new Set(["u-1"])}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    const bobRow = await screen.findByRole("menuitem", { name: /bob \(already shared\)/i });
    await user.click(bobRow);

    await waitFor(() => {
      expect(mockedShareIdentity).toHaveBeenCalledTimes(1);
      expect(mockedShareIdentity).toHaveBeenCalledWith("id-src", "u-1");
    });

    await waitFor(() => {
      expect(onShareSuccess).toHaveBeenCalledTimes(1);
      expect(onShareSuccess).toHaveBeenCalledWith({
        targetUserId: "u-1",
        shared: false,
        resultingIdentityId: "existing-uuid",
      });
    });
  });

  // Test 8: toast.success message differs by shared flag
  it("Test 8: toast.success fires with 'Shared with X' on shared:true and 'Already shared with X' on shared:false", async () => {
    // --- shared:true case ---
    mockedGetUsersListBasic.mockResolvedValue([{ id: "u-1", username: "bob" }]);
    mockedShareIdentity.mockResolvedValueOnce({
      identityId: "new-uuid",
      shared: true,
    });
    const user1 = makeUser();

    const { unmount } = render(
      <ShareIdentityPicker
        identityId="id-src"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={vi.fn()}
      />,
    );

    const trigger1 = await screen.findByRole("button", { name: /share identity/i });
    await user1.click(trigger1);
    const bobRow1 = await screen.findByRole("menuitem", { name: /share with bob/i });
    await user1.click(bobRow1);

    await waitFor(() => {
      expect(mockedToastSuccess).toHaveBeenCalledWith("Shared with bob");
    });

    unmount();
    cleanup();
    vi.clearAllMocks();

    // --- shared:false case (already-shared) ---
    mockedGetUsersListBasic.mockResolvedValue([{ id: "u-1", username: "bob" }]);
    mockedShareIdentity.mockResolvedValueOnce({
      identityId: "existing-uuid",
      shared: false,
    });
    const user2 = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-src"
        identityKey="tina"
        alreadySharedUserIds={new Set(["u-1"])}
        onShareSuccess={vi.fn()}
      />,
    );

    const trigger2 = await screen.findByRole("button", { name: /share identity/i });
    await user2.click(trigger2);
    const bobRow2 = await screen.findByRole("menuitem", { name: /bob \(already shared\)/i });
    await user2.click(bobRow2);

    await waitFor(() => {
      expect(mockedToastSuccess).toHaveBeenCalledWith("Already shared with bob");
    });
  });

  // Test 9: getUsersListBasic error → picker hides (graceful)
  it("Test 9: renders null when getUsersListBasic rejects (graceful hide, no crash)", async () => {
    mockedGetUsersListBasic.mockRejectedValue(new Error("network down"));
    const onShareSuccess = vi.fn();

    const { container } = render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    // Wait for the fetch to settle (reject).
    await waitFor(() => {
      expect(mockedGetUsersListBasic).toHaveBeenCalledTimes(1);
    });

    // Same visual as empty-list: nothing rendered.
    await waitFor(() => {
      expect(container.textContent).toBe("");
      expect(screen.queryByRole("button", { name: /share identity/i })).toBeNull();
    });
  });

  // Test 10: unmount during pending fetch — no state-update-on-unmounted warning
  it("Test 10: unmount during pending fetch does not warn about state updates on unmounted component", async () => {
    // Keep the fetch pending until we explicitly resolve it.
    let resolveList!: (v: { id: string; username: string }[]) => void;
    mockedGetUsersListBasic.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={vi.fn()}
      />,
    );

    // Unmount before the fetch resolves.
    unmount();

    // NOW resolve — the isMounted guard should prevent setState.
    resolveList([{ id: "u-1", username: "bob" }]);

    // Give the microtask queue a chance to flush.
    await Promise.resolve();
    await Promise.resolve();

    // React would console.error if setState fired post-unmount.
    const badCalls = errorSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes("unmounted component"),
    );
    expect(badCalls.length).toBe(0);

    errorSpy.mockRestore();
  });

  // Test 11: trust-the-backend — current user is never in the passed list, never renders
  it("Test 11: current user never appears in picker (backend contract; component does no re-filtering)", async () => {
    // getUsersListBasic returns a list that DOES NOT include the current user
    // (server-side ne(users.id, requester) filter). The picker trusts this and
    // does not re-inject the current user's row.
    mockedGetUsersListBasic.mockResolvedValue([
      { id: "u-bob", username: "bob" },
      { id: "u-carol", username: "carol" },
    ]);
    const onShareSuccess = vi.fn();
    const user = makeUser();

    render(
      <ShareIdentityPicker
        identityId="id-1"
        identityKey="tina"
        alreadySharedUserIds={new Set()}
        onShareSuccess={onShareSuccess}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /share identity/i });
    await user.click(trigger);

    await waitFor(() => {
      // Both non-self users appear
      expect(screen.getByRole("menuitem", { name: /share with bob/i })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /share with carol/i })).toBeTruthy();
      // The current user's username (e.g., "ashley") does NOT appear — because
      // the backend excluded them, and the component does NO re-injection.
      expect(screen.queryByRole("menuitem", { name: /share with ashley/i })).toBeNull();
    });
  });
});
