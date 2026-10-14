import { describe, it, expect } from "vitest";
import { appIconUrl } from "./app-icon-url";

describe("appIconUrl", () => {
  it("appends the icon version as ?v=", () => {
    expect(appIconUrl("3", "my-app", "abcdef0123456789")).toBe(
      "/apps/3/my-app/icon?v=abcdef0123456789",
    );
  });

  it("omits ?v= when there is no version", () => {
    expect(appIconUrl(3, "my-app", null)).toBe("/apps/3/my-app/icon");
    expect(appIconUrl(3, "my-app", undefined)).toBe("/apps/3/my-app/icon");
  });
});
