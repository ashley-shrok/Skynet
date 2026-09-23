import { describe, it, expect } from "vitest";
import { extractSkewTag } from "./skew-tag.js";

describe("extractSkewTag", () => {
  it("returns the build value from a URL with only a build query param", () => {
    expect(extractSkewTag({ url: "/socket?build=abc123def456" })).toBe(
      "abc123def456",
    );
  });

  it("returns the build value when other query params are present", () => {
    expect(extractSkewTag({ url: "/socket?token=xyz&build=abc" })).toBe("abc");
  });

  it("returns null when the URL has no query string", () => {
    expect(extractSkewTag({ url: "/socket" })).toBeNull();
  });

  it("returns an empty string when build is present but empty (distinct from null)", () => {
    expect(extractSkewTag({ url: "/socket?build=" })).toBe("");
  });

  it("returns null when req.url is undefined", () => {
    expect(extractSkewTag({ url: undefined })).toBeNull();
  });

  it("returns the first value when build is repeated (matches URLSearchParams.get)", () => {
    expect(extractSkewTag({ url: "/socket?build=aaa&build=bbb" })).toBe("aaa");
  });
});
