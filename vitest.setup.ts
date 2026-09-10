import { afterEach, vi } from "vitest";

// Phase 103 D-23: serve-url modules fail loud at MODULE LOAD if
// SKYNET_COOKIE_DOMAIN is unset. Default it here so tests that don't
// care about the value (integration tests that mock at a lower level)
// can still import those modules. Individual tests that DO care set
// or delete this env explicitly and are unaffected by the ??=.
process.env.SKYNET_COOKIE_DOMAIN ??= "test.gigaashley.click";

// jsdom does not implement matchMedia; provide a minimal stub so hooks that
// read media queries (e.g. useIsMobile) can run. Individual tests override
// window.innerWidth / matchMedia as needed.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});
