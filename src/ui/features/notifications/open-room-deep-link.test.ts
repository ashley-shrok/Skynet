/**
 * Phase 128 Plan 07 Task 3 — open-room-deep-link tests.
 *
 * Rationale for a dedicated module (not an inline AppShell useEffect):
 *   AppShell.tsx is a ~4256-line, hundreds-of-import load-bearing shell
 *   component. Rendering it in jsdom to test a small URL-param parser
 *   would require mocking half the codebase and produces a brittle test.
 *   Instead the deep-link parsing + guard + open-callback + URL-cleanup
 *   logic is factored into a tiny pure function this test drives directly;
 *   AppShell then wires the function once inside its mount useEffect.
 *
 * Five behavior cases (mirrors 128-07-PLAN.md Task 3 behavior list):
 *   1. Query `?openRoom=!abc:server` present → open-callback fires with
 *      "!abc:server" AND the URL is stripped via history.replaceState.
 *   2. No query param → open-callback NOT called, URL untouched.
 *   3. Empty roomId (`?openRoom=`) → treated as absent (no callback fire).
 *   4. Whitespace-only roomId → treated as absent + no crash.
 *   5. Malformed roomId (missing the `:`) → console.warn, no callback fire,
 *      no throw. This is the T-126-36 mitigation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAndOpenRoomFromUrl } from "./open-room-deep-link";

describe("open-room-deep-link", () => {
  let originalLocation: Location;
  let originalReplaceState: History["replaceState"];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalLocation = window.location;
    originalReplaceState = window.history.replaceState.bind(window.history);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore window.location by re-defining
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    window.history.replaceState = originalReplaceState;
    warnSpy.mockRestore();
  });

  function setLocation(pathname: string, search: string): void {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        pathname,
        search,
      },
    });
  }

  it("Case 1: ?openRoom=!abc:server → opens the room + strips param via replaceState", () => {
    setLocation("/", "?openRoom=%21abc%3Aserver");
    const openRoom = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    parseAndOpenRoomFromUrl(openRoom);

    expect(openRoom).toHaveBeenCalledTimes(1);
    expect(openRoom).toHaveBeenCalledWith("!abc:server");
    expect(replaceState).toHaveBeenCalledTimes(1);
    // replaceState should be called with (null, "", pathname) — param stripped
    expect(replaceState.mock.calls[0][2]).toBe("/");
  });

  it("Case 2: no openRoom param → open-callback not called, URL untouched", () => {
    setLocation("/", "?other=value");
    const openRoom = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    parseAndOpenRoomFromUrl(openRoom);

    expect(openRoom).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("Case 3: empty openRoom (`?openRoom=`) → treated as absent, no callback, no crash", () => {
    setLocation("/", "?openRoom=");
    const openRoom = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    expect(() => parseAndOpenRoomFromUrl(openRoom)).not.toThrow();
    expect(openRoom).not.toHaveBeenCalled();
  });

  it("Case 4: whitespace-only roomId → treated as absent, no crash", () => {
    setLocation("/", "?openRoom=%20%20%20");
    const openRoom = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    expect(() => parseAndOpenRoomFromUrl(openRoom)).not.toThrow();
    expect(openRoom).not.toHaveBeenCalled();
  });

  it("Case 5: malformed roomId (missing `:`) → warn, no callback, no throw", () => {
    setLocation("/", "?openRoom=notARealRoomId");
    const openRoom = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    expect(() => parseAndOpenRoomFromUrl(openRoom)).not.toThrow();
    expect(openRoom).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    // Warn message should reference the openRoom feature
    const warnMsg = String(warnSpy.mock.calls[0][0] ?? warnSpy.mock.calls[0]);
    expect(warnMsg.toLowerCase()).toContain("openroom");
  });

  it("Case 5b: open-callback throwing does not crash the caller", () => {
    setLocation("/", "?openRoom=%21abc%3Aserver");
    const openRoom = vi.fn().mockImplementation(() => {
      throw new Error("failed to open room");
    });
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    expect(() => parseAndOpenRoomFromUrl(openRoom)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
