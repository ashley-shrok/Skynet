import { describe, it, expect, afterEach } from "vitest";
import { getBasePath } from "./base-path.js";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win.__SKYNET_BASE_PATH__;
});

describe("getBasePath", () => {
  it("returns empty string when no runtime override is set (default base)", () => {
    // Vite test env BASE_URL is "/" which the helper normalizes to "".
    expect(getBasePath()).toBe("");
  });

  it("uses the runtime override when present", () => {
    win.__SKYNET_BASE_PATH__ = "/skynet";
    expect(getBasePath()).toBe("/skynet");
  });

  it("strips a trailing slash from the runtime override", () => {
    win.__SKYNET_BASE_PATH__ = "/skynet/";
    expect(getBasePath()).toBe("/skynet");
  });
});
