/**
 * open-harness-deep-link tests.
 *
 * Mirrors the shape of the retired open-room-deep-link tests: pure URL
 * param parser driven directly by the test, no AppShell mount.
 *
 * Behaviors covered:
 *   1. Happy path — valid mxid + valid host → callback fires, URL stripped.
 *   2. No openHarness param → callback not called, URL untouched.
 *   3. Empty openHarness (`?openHarness=`) → treated as absent.
 *   4. Whitespace-only mxid → treated as absent.
 *   5. Malformed mxid (missing `:`) → console.warn, no callback.
 *   6. Missing host param → console.warn, no callback.
 *   7. Non-numeric host → console.warn, no callback.
 *   8. Negative / zero host → console.warn, no callback.
 *   9. Callback throwing does not crash the caller.
 *  10. URL stripping preserves pathname (BASE_PATH survives).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseAndOpenHarnessFromUrl } from "./open-harness-deep-link";

describe("open-harness-deep-link", () => {
  let originalLocation: Location;
  let originalReplaceState: History["replaceState"];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalLocation = window.location;
    originalReplaceState = window.history.replaceState.bind(window.history);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
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

  it("Case 1: valid mxid + valid host → callback fires with parsed target, URL stripped", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver&host=42");
    const openHarness = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).toHaveBeenCalledTimes(1);
    expect(openHarness).toHaveBeenCalledWith({
      mxid: "@fanny:server",
      hostId: 42,
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe("/");
  });

  it("Case 2: no openHarness param → callback not called, URL untouched", () => {
    setLocation("/", "?other=value");
    const openHarness = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("Case 3: empty openHarness (`?openHarness=`) → treated as absent", () => {
    setLocation("/", "?openHarness=&host=42");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    expect(() => parseAndOpenHarnessFromUrl(openHarness)).not.toThrow();
    expect(openHarness).not.toHaveBeenCalled();
  });

  it("Case 4: whitespace-only mxid → treated as absent", () => {
    setLocation("/", "?openHarness=%20%20%20&host=42");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    expect(() => parseAndOpenHarnessFromUrl(openHarness)).not.toThrow();
    expect(openHarness).not.toHaveBeenCalled();
  });

  it("Case 5: malformed mxid (missing `:`) → warn, no callback", () => {
    setLocation("/", "?openHarness=notARealMxid&host=42");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    expect(() => parseAndOpenHarnessFromUrl(openHarness)).not.toThrow();
    expect(openHarness).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(
      String(warnSpy.mock.calls[0][0] ?? "").toLowerCase(),
    ).toContain("openharness");
  });

  it("Case 6: missing host param → warn, no callback", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0] ?? "")).toContain("host missing");
  });

  it("Case 7: non-numeric host → warn, no callback", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver&host=not-a-number");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0] ?? "")).toContain("positive integer");
  });

  it("Case 8: negative host → warn, no callback", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver&host=-5");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Case 8b: zero host → warn, no callback", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver&host=0");
    const openHarness = vi.fn();
    window.history.replaceState = vi.fn();

    parseAndOpenHarnessFromUrl(openHarness);

    expect(openHarness).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Case 9: open-callback throwing does not crash the caller", () => {
    setLocation("/", "?openHarness=%40fanny%3Aserver&host=42");
    const openHarness = vi.fn().mockImplementation(() => {
      throw new Error("failed to open harness");
    });
    window.history.replaceState = vi.fn();

    expect(() => parseAndOpenHarnessFromUrl(openHarness)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Case 10: URL cleanup preserves BASE_PATH pathname", () => {
    setLocation("/skynet/", "?openHarness=%40fanny%3Aserver&host=42");
    const openHarness = vi.fn();
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    parseAndOpenHarnessFromUrl(openHarness);

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe("/skynet/");
  });
});
