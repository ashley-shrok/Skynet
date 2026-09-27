/**
 * phone-call-requests/parse-request-body.test.ts
 *
 * Unit tests for the request-body parser. Covers every rejection branch +
 * the happy path. No mocks needed — the parser is a pure function.
 */

import { describe, it, expect } from "vitest";
import { parseRequestBody, MESSAGE_MAX_LENGTH, CALLER_NAME_MAX_LENGTH } from "./parse-request-body.js";

const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function ok(body: unknown): string {
  return JSON.stringify(body);
}

describe("parseRequestBody — happy path", () => {
  it("accepts a fully-formed request body", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "Clipper the Box Maintainer",
        to_user: "alice",
        message: "Your CI build failed. Want me to investigate?",
        requested_at: "2026-09-27T12:34:56.000Z",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok !== true) throw new Error("unreachable");
    expect(result.body.caller_name).toBe("Clipper the Box Maintainer");
    expect(result.body.to_user).toBe("alice");
    expect(result.body.message).toBe("Your CI build failed. Want me to investigate?");
    expect(result.body.requested_at).toBe("2026-09-27T12:34:56.000Z");
  });

  it("accepts requested_at with UTC offset (e.g. -04:00)", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X the Y",
        to_user: "u",
        message: "m",
        requested_at: "2026-09-27T12:34:56-04:00",
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseRequestBody — malformed branches", () => {
  it("rejects invalid JSON", () => {
    const result = parseRequestBody(UUID, "{not json");
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.outcome).toBe("malformed");
    expect(result.message).toContain("invalid JSON");
  });

  it("rejects an array top-level body", () => {
    const result = parseRequestBody(UUID, JSON.stringify([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("must be a JSON object");
  });

  it("rejects unknown top-level keys", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: "u",
        message: "m",
        requested_at: "2026-09-27T12:34:56Z",
        unexpected_field: "value",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("unrecognized field: unexpected_field");
  });

  it("rejects missing caller_name", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        to_user: "u",
        message: "m",
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("caller_name");
  });

  it("rejects empty caller_name", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "   ",
        to_user: "u",
        message: "m",
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("caller_name must not be empty");
  });

  it("rejects too-long caller_name", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "x".repeat(CALLER_NAME_MAX_LENGTH + 1),
        to_user: "u",
        message: "m",
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("exceeds");
  });

  it("rejects wrong-type to_user", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: 42,
        message: "m",
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("to_user must be a string");
  });

  it("rejects empty message", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: "u",
        message: "",
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("message");
  });

  it("rejects too-long message", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: "u",
        message: "x".repeat(MESSAGE_MAX_LENGTH + 1),
        requested_at: "2026-09-27T12:34:56Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain(`exceeds ${MESSAGE_MAX_LENGTH} chars`);
  });

  it("rejects malformed requested_at (not ISO-Z)", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: "u",
        message: "m",
        requested_at: "yesterday",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("unreachable");
    expect(result.message).toContain("ISO-Z");
  });

  it("rejects missing requested_at", () => {
    const result = parseRequestBody(
      UUID,
      ok({
        caller_name: "X",
        to_user: "u",
        message: "m",
      }),
    );
    expect(result.ok).toBe(false);
  });
});
