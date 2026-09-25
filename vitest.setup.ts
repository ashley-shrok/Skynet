import { afterEach, vi } from "vitest";

// Phase 103 D-23: serve-url modules fail loud at MODULE LOAD if
// SKYNET_COOKIE_DOMAIN is unset. Default it here so tests that don't
// care about the value (integration tests that mock at a lower level)
// can still import those modules. Individual tests that DO care set
// or delete this env explicitly and are unaffected by the ??=.
process.env.SKYNET_COOKIE_DOMAIN ??= "test.example.com";

// 2026-09-25: fleet-status legacy per-identity fan-out is disabled in
// production (see src/backend/fleet-status/ssh-poll-orchestrator.ts dispatch
// site). Tests still exercise the legacy path — 100+ tests wire per-identity
// SSH responses and rely on the fallthrough. Default the flag to "true" here
// so the existing suite passes unchanged. Production docker-compose does NOT
// set it, so production skips the tick and forces re-probe on batch failure.
process.env.SKYNET_FLEET_STATUS_LEGACY_ENABLED ??= "true";

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
