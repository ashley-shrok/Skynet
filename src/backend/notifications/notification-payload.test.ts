import { describe, it, expect } from "vitest";
import { buildClickUrl } from "./notification-payload.js";

describe("buildClickUrl", () => {
  it("omits host= when agentHostId is null", () => {
    const url = buildClickUrl("@agent:skynet", null);
    expect(url).toBe("/?openHarness=%40agent%3Askynet");
    expect(url).not.toContain("host=");
  });

  it("includes host= for a real host id", () => {
    expect(buildClickUrl("@agent:skynet", 7)).toBe("/?openHarness=%40agent%3Askynet&host=7");
    expect(buildClickUrl("@agent:skynet", "h-123")).toContain("host=h-123");
  });

  it("omits host= for an empty string", () => {
    expect(buildClickUrl("@agent:skynet", "")).not.toContain("host=");
  });
});
