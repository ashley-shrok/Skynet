import { describe, it, expect } from "vitest";
import {
  derivePrettyNameSlug,
  PRETTY_NAME_MAX_LEN,
} from "./pretty-name-slug.js";

describe("derivePrettyNameSlug — happy path", () => {
  it("lowercases and dashes a simple multi-word name", () => {
    expect(derivePrettyNameSlug("Box Maintainer")).toEqual({
      ok: true,
      slug: "box-maintainer",
    });
  });

  it("collapses runs of punctuation into one dash", () => {
    expect(derivePrettyNameSlug("hello!!!   world")).toEqual({
      ok: true,
      slug: "hello-world",
    });
  });

  it("trims leading / trailing whitespace from input", () => {
    expect(derivePrettyNameSlug("   padded   ")).toEqual({
      ok: true,
      slug: "padded",
    });
  });

  it("strips leading + trailing non-letter runs cleanly", () => {
    expect(derivePrettyNameSlug("!!! wild !!!")).toEqual({
      ok: true,
      slug: "wild",
    });
  });
});

describe("derivePrettyNameSlug — digit spell-out", () => {
  it("spells leading digits so slugs stay letter-first", () => {
    expect(derivePrettyNameSlug("2FA Admin")).toEqual({
      ok: true,
      slug: "two-fa-admin",
    });
  });

  it("spells inline digits with dashes around them", () => {
    expect(derivePrettyNameSlug("H2O tracker")).toEqual({
      ok: true,
      slug: "h-two-o-tracker",
    });
  });

  it("spells every digit position for pure-digit input", () => {
    expect(derivePrettyNameSlug("22")).toEqual({
      ok: true,
      slug: "two-two",
    });
  });

  it("covers all ten digits in order", () => {
    expect(derivePrettyNameSlug("0 1 2 3 4 5 6 7 8 9")).toEqual({
      ok: true,
      slug: "zero-one-two-three-four-five-six-seven-eight-nine",
    });
  });

  it("adjacent letters and digits don't fuse into made-up words", () => {
    expect(derivePrettyNameSlug("a2b3c")).toEqual({
      ok: true,
      slug: "a-two-b-three-c",
    });
  });
});

describe("derivePrettyNameSlug — emoji / unicode stripping", () => {
  it("drops emoji and keeps the alpha chunk", () => {
    expect(derivePrettyNameSlug("🎉 Party 🎉")).toEqual({
      ok: true,
      slug: "party",
    });
  });

  it("drops non-ASCII letters (accented chars treated as separators)", () => {
    // Deliberate: no accent-folding — simpler and matches project behavior.
    // Diacritics become dashes, which is fine because the alpha fragments survive.
    const result = derivePrettyNameSlug("Café");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe("caf");
  });
});

describe("derivePrettyNameSlug — rejection cases", () => {
  it("rejects empty input", () => {
    expect(derivePrettyNameSlug("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects whitespace-only input", () => {
    expect(derivePrettyNameSlug("   ")).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects input whose letters all drop out (all-emoji)", () => {
    expect(derivePrettyNameSlug("🎉🎉🎉")).toEqual({
      ok: false,
      reason: "unslugifiable",
    });
  });

  it("rejects input of only punctuation", () => {
    expect(derivePrettyNameSlug("!!!---???")).toEqual({
      ok: false,
      reason: "unslugifiable",
    });
  });

  it("rejects input longer than the length cap", () => {
    const tooLong = "a".repeat(PRETTY_NAME_MAX_LEN + 1);
    expect(derivePrettyNameSlug(tooLong)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts input exactly at the length cap", () => {
    const atCap = "a".repeat(PRETTY_NAME_MAX_LEN);
    expect(derivePrettyNameSlug(atCap)).toEqual({
      ok: true,
      slug: atCap,
    });
  });

  it("length cap is measured on trimmed input, not raw", () => {
    const trimmedAtCap = `   ${"a".repeat(PRETTY_NAME_MAX_LEN)}   `;
    expect(derivePrettyNameSlug(trimmedAtCap)).toEqual({
      ok: true,
      slug: "a".repeat(PRETTY_NAME_MAX_LEN),
    });
  });
});

describe("derivePrettyNameSlug — digit-in-collision-suffix invariant", () => {
  it("user-derived slug never contains a digit", () => {
    const samples = [
      "Project 42",
      "Area 51",
      "3M Materials",
      "007 Agent",
      "iPhone 15 Pro",
    ];
    for (const s of samples) {
      const r = derivePrettyNameSlug(s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
});
