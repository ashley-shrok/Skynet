import { describe, it, expect } from "vitest";
import { appLeafFromDescriptor } from "./cross-window-drag";

describe("appLeafFromDescriptor (app bar cross-window drops)", () => {
  it("well-formed app descriptor → openTab args", () => {
    expect(
      appLeafFromDescriptor({ tabType: "app", app: { hostId: 3, slug: "todo" }, label: "Todo" }),
    ).toEqual({ hostId: 3, slug: "todo", label: "Todo" });
  });

  it("missing label falls back to the slug", () => {
    expect(appLeafFromDescriptor({ tabType: "app", app: { hostId: 3, slug: "todo" } })).toEqual({
      hostId: 3,
      slug: "todo",
      label: "todo",
    });
  });

  it("non-app descriptors are not app leaves", () => {
    expect(appLeafFromDescriptor({ tabType: "terminal" })).toBeNull();
    expect(appLeafFromDescriptor(null)).toBeNull();
    expect(appLeafFromDescriptor(undefined)).toBeNull();
  });

  it("malformed app tuples are rejected", () => {
    expect(appLeafFromDescriptor({ tabType: "app", app: null })).toBeNull();
    expect(appLeafFromDescriptor({ tabType: "app", app: { hostId: "3", slug: "todo" } })).toBeNull();
    expect(appLeafFromDescriptor({ tabType: "app", app: { hostId: 3, slug: "" } })).toBeNull();
    expect(appLeafFromDescriptor({ tabType: "app", app: { hostId: Number.NaN, slug: "x" } })).toBeNull();
  });

  it("applies the same gate as URL-restored app leaves (no path tricks, sane host ids)", () => {
    const app = (hostId: unknown, slug: unknown) =>
      appLeafFromDescriptor({ tabType: "app", app: { hostId, slug } });
    expect(app(1, "..")).toBeNull();
    expect(app(1, "../evil")).toBeNull();
    expect(app(1, "Todo")).toBeNull();
    expect(app(1, "a".repeat(65))).toBeNull();
    expect(app(-1, "todo")).toBeNull();
    expect(app(0, "todo")).toBeNull();
    expect(app(1.5, "todo")).toBeNull();
    expect(app(1e300, "todo")).toBeNull();
    expect(app(12, "my-app-2")).toEqual({ hostId: 12, slug: "my-app-2", label: "my-app-2" });
  });

  it("caps and trims the label", () => {
    const leaf = appLeafFromDescriptor({
      tabType: "app",
      app: { hostId: 1, slug: "todo" },
      label: "  " + "x".repeat(300),
    });
    expect(leaf?.label.length).toBe(128);
    expect(
      appLeafFromDescriptor({ tabType: "app", app: { hostId: 1, slug: "todo" }, label: "   " })?.label,
    ).toBe("todo");
  });
});
