/**
 * parse-request-body.test.ts — unit tests for the image-gen request-body
 * parser.
 *
 * Coverage:
 *   - JSON.parse failures → malformed
 *   - Non-object / null / array bodies → malformed
 *   - Missing required `prompt` → malformed
 *   - Empty / whitespace-only `prompt` → malformed
 *   - Prompt > 4000 chars (D-06 V5 cap) → malformed
 *   - Missing required `requested_at` → malformed
 *   - Invalid `requested_at` string → malformed
 *   - Unrecognized top-level key → malformed with "unrecognized field: <k>" (D-06 CRITICAL)
 *   - `n` not integer / out-of-range → malformed
 *   - `size` / `quality` non-string → malformed
 *   - `ref` non-string / bad shape → malformed
 *   - Happy path (prompt + requested_at only) → ok: true
 *   - Happy path with all optionals → ok: true
 */
import { describe, it, expect } from "vitest";
import { parseRequestBody } from "./parse-request-body.js";

const VALID_UUID = "abcdef01-2345-6789-abcd-ef0123456789";
const VALID_REQUESTED_AT = "2026-09-18T00:00:00Z";

describe("parseRequestBody — malformed JSON", () => {
  it("rejects invalid JSON with descriptive message", () => {
    const result = parseRequestBody(VALID_UUID, "{not json}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.message).toContain("invalid JSON");
    }
  });

  it("rejects empty string as invalid JSON", () => {
    const result = parseRequestBody(VALID_UUID, "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.message).toContain("invalid JSON");
    }
  });
});

describe("parseRequestBody — non-object bodies", () => {
  it("rejects null body", () => {
    const result = parseRequestBody(VALID_UUID, "null");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a JSON object");
  });

  it("rejects array body", () => {
    const result = parseRequestBody(VALID_UUID, "[1,2,3]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a JSON object");
  });

  it("rejects string body", () => {
    const result = parseRequestBody(VALID_UUID, '"hello"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a JSON object");
  });

  it("rejects number body", () => {
    const result = parseRequestBody(VALID_UUID, "42");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a JSON object");
  });
});

describe("parseRequestBody — unrecognized fields (D-06 CRITICAL)", () => {
  it("rejects unrecognized top-level key with descriptive message", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, wat: "huh" });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.message).toContain("unrecognized field");
      expect(result.message).toContain("wat");
    }
  });

  it("rejects a smuggled `model` field (D-26 lock protects against this)", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, model: "dall-e-3" });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("unrecognized field");
      expect(result.message).toContain("model");
    }
  });

  it("rejects multiple unrecognized fields (reports first found)", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, foo: 1, bar: 2 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/unrecognized field: (foo|bar)/);
  });
});

describe("parseRequestBody — prompt validation", () => {
  it("rejects missing prompt", () => {
    const body = JSON.stringify({ requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("prompt");
  });

  it("rejects non-string prompt", () => {
    const body = JSON.stringify({ prompt: 42, requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("prompt");
  });

  it("rejects empty prompt", () => {
    const body = JSON.stringify({ prompt: "", requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("prompt");
  });

  it("rejects whitespace-only prompt", () => {
    const body = JSON.stringify({ prompt: "   \n\t  ", requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("prompt");
  });

  it("rejects prompt > 4000 chars (D-06 V5)", () => {
    const bigPrompt = "x".repeat(4001);
    const body = JSON.stringify({ prompt: bigPrompt, requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("4000");
  });

  it("accepts prompt = exactly 4000 chars", () => {
    const bigPrompt = "x".repeat(4000);
    const body = JSON.stringify({ prompt: bigPrompt, requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(true);
  });
});

describe("parseRequestBody — requested_at validation", () => {
  it("rejects missing requested_at", () => {
    const body = JSON.stringify({ prompt: "cat" });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("requested_at");
  });

  it("rejects non-string requested_at", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: 1_700_000_000 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("requested_at");
  });

  it("rejects unparseable requested_at string", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: "not a date" });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("requested_at");
  });
});

describe("parseRequestBody — optional field type checks", () => {
  it("rejects non-string size", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, size: 1024 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("size");
  });

  it("rejects non-string quality", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, quality: true });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("quality");
  });

  it("rejects non-integer n", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, n: 1.5 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("n");
  });

  it("rejects n < 1", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, n: 0 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("n");
  });

  it("rejects n > 10", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, n: 11 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("n");
  });

  it("accepts n = 1 and n = 10", () => {
    for (const n of [1, 10]) {
      const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, n });
      const result = parseRequestBody(VALID_UUID, body);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.body.n).toBe(n);
    }
  });

  it("rejects non-string ref", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, ref: 42 });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("ref");
  });

  it("rejects ref with bad shape (missing .ref.ext)", () => {
    const body = JSON.stringify({ prompt: "cat", requested_at: VALID_REQUESTED_AT, ref: "not-a-ref.png" });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("ref");
  });

  it("rejects ref with wrong extension", () => {
    const body = JSON.stringify({
      prompt: "cat",
      requested_at: VALID_REQUESTED_AT,
      ref: `${VALID_UUID}.ref.gif`,
    });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("ref");
  });

  it("accepts ref matching <uuid>.ref.png|jpg|jpeg|webp", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp", "PNG"]) {
      const body = JSON.stringify({
        prompt: "cat",
        requested_at: VALID_REQUESTED_AT,
        ref: `${VALID_UUID}.ref.${ext}`,
      });
      const result = parseRequestBody(VALID_UUID, body);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.body.ref).toBe(`${VALID_UUID}.ref.${ext}`);
    }
  });
});

describe("parseRequestBody — happy paths", () => {
  it("accepts minimal valid body (prompt + requested_at only)", () => {
    const body = JSON.stringify({ prompt: "a cat", requested_at: VALID_REQUESTED_AT });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.prompt).toBe("a cat");
      expect(result.body.requested_at).toBe(VALID_REQUESTED_AT);
      expect(result.body.size).toBeUndefined();
      expect(result.body.quality).toBeUndefined();
      expect(result.body.n).toBeUndefined();
      expect(result.body.ref).toBeUndefined();
    }
  });

  it("accepts full valid body with all optionals", () => {
    const body = JSON.stringify({
      prompt: "a portrait",
      requested_at: VALID_REQUESTED_AT,
      size: "1024x1024",
      quality: "high",
      n: 3,
      ref: `${VALID_UUID}.ref.jpg`,
    });
    const result = parseRequestBody(VALID_UUID, body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({
        prompt: "a portrait",
        requested_at: VALID_REQUESTED_AT,
        size: "1024x1024",
        quality: "high",
        n: 3,
        ref: `${VALID_UUID}.ref.jpg`,
      });
    }
  });
});
