/**
 * Phase 31 Plan 01: use-service-worker smoke tests.
 *
 * Test 5: verifies the D-13 [pwa] prefix remap — the registration-failed
 * log line must match /^\[pwa\] sw-register-failed err="/.
 *
 * The hook itself is a useEffect that calls navigator.serviceWorker.register,
 * so we mock the navigator.serviceWorker API and renderHook to trigger the
 * effect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useServiceWorker } from "./use-service-worker";

// Minimal serviceWorker stub
function makeRegistration() {
  return {
    addEventListener: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

describe("use-service-worker", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Stub navigator.serviceWorker so the hook thinks SW is supported
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        controller: null,
      },
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("Test 5: registration-failed console.error matches /^\\[pwa\\] sw-register-failed err=\"/", async () => {
    const boom = new Error("net::ERR_CONNECTION_REFUSED");

    // Make register() reject
    (
      navigator.serviceWorker.register as ReturnType<typeof vi.fn>
    ).mockRejectedValue(boom);

    // Simulate PROD env so the hook registers
    const origEnv = import.meta.env.PROD;
    // @ts-expect-error - test override
    import.meta.env.PROD = true;

    try {
      const { unmount } = renderHook(() => useServiceWorker());

      // Wait for the async register call to settle
      await vi.waitFor(() => {
        return errorSpy.mock.calls.length > 0;
      });

      unmount();

      expect(errorSpy).toHaveBeenCalled();
      const firstCallArg = errorSpy.mock.calls[0][0] as string;
      expect(firstCallArg).toMatch(/^\[pwa\] sw-register-failed err="/);
    } finally {
      // @ts-expect-error - test override
      import.meta.env.PROD = origEnv;
    }
  });
});
