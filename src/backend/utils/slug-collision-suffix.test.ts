import { describe, it, expect, vi } from "vitest";
import {
  resolveSlugCollision,
  resolveSlugCollisionSync,
} from "./slug-collision-suffix.js";

describe("resolveSlugCollision — async", () => {
  it("returns the base when nothing exists", async () => {
    const result = await resolveSlugCollision("yankee", async () => false);
    expect(result).toBe("yankee");
  });

  it("appends -2 when the base is taken", async () => {
    const existing = new Set(["yankee"]);
    const result = await resolveSlugCollision("yankee", async (s) =>
      existing.has(s),
    );
    expect(result).toBe("yankee-2");
  });

  it("chains to -5 when base through -4 are all taken", async () => {
    const existing = new Set(["foo", "foo-2", "foo-3", "foo-4"]);
    const result = await resolveSlugCollision("foo", async (s) =>
      existing.has(s),
    );
    expect(result).toBe("foo-5");
  });

  it("probes in order: base, then -2, then -3, ...", async () => {
    const seen: string[] = [];
    const existing = new Set(["bar", "bar-2"]);
    await resolveSlugCollision("bar", async (s) => {
      seen.push(s);
      return existing.has(s);
    });
    expect(seen).toEqual(["bar", "bar-2", "bar-3"]);
  });

  it("accepts a base that happens to end in -<digit> when it is free", async () => {
    // User-derived slugs never contain digits (digits spell out), so a base
    // ending in -<n> only comes from an auto-suffixed slug being re-used as
    // a base — unusual but defined behavior: treat it like any other base.
    const result = await resolveSlugCollision("foo-2", async () => false);
    expect(result).toBe("foo-2");
  });

  it("propagates predicate rejection", async () => {
    const predicate = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      resolveSlugCollision("baz", predicate),
    ).rejects.toThrow("boom");
  });
});

describe("resolveSlugCollisionSync — mirrors async semantics", () => {
  it("returns the base when nothing exists", () => {
    expect(resolveSlugCollisionSync("yankee", () => false)).toBe("yankee");
  });

  it("appends -2 when the base is taken", () => {
    const existing = new Set(["yankee"]);
    expect(
      resolveSlugCollisionSync("yankee", (s) => existing.has(s)),
    ).toBe("yankee-2");
  });

  it("chains through long runs", () => {
    const existing = new Set([
      "foo",
      "foo-2",
      "foo-3",
      "foo-4",
      "foo-5",
      "foo-6",
      "foo-7",
    ]);
    expect(
      resolveSlugCollisionSync("foo", (s) => existing.has(s)),
    ).toBe("foo-8");
  });
});
