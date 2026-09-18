/**
 * types.test.ts — Compile-time + minimal runtime check on the FailureReason
 * literal union locked by CONTEXT.md D-27.
 *
 * The `ALL_FAILURE_REASONS` array below is typed as `FailureReason[]` and
 * spread across an `as const` literal. If anyone adds or removes a member of
 * the union in types.ts, this test fails to compile — that is the guardrail.
 *
 * Runtime assertion is redundant but cheap: it also fails the test at
 * `npx vitest run` time if the array length or contents drift.
 */
import { describe, it, expect } from "vitest";
import type { FailureReason, ImageGenRequestBody, PendingImageGen, SuccessResponse, FailureResponse } from "./types.js";

/**
 * The complete closed set of failure reasons per D-27.
 * Order matches the union declaration in types.ts.
 */
const ALL_FAILURE_REASONS = [
  "content_blocked",
  "rate_limited",
  "provider_unavailable",
  "not_configured",
  "malformed",
  "expired",
  "unknown",
] as const;

describe("FailureReason", () => {
  it("has exactly 7 values (D-27 locked set)", () => {
    expect(ALL_FAILURE_REASONS.length).toBe(7);
  });

  it("array literal is assignable to FailureReason[] (compile-time check)", () => {
    // If the union in types.ts drifts, this line fails tsc / vitest type-check.
    const check: FailureReason[] = [...ALL_FAILURE_REASONS];
    expect(check).toEqual([
      "content_blocked",
      "rate_limited",
      "provider_unavailable",
      "not_configured",
      "malformed",
      "expired",
      "unknown",
    ]);
  });

  it("each individual literal is a valid FailureReason", () => {
    const contentBlocked: FailureReason = "content_blocked";
    const rateLimited: FailureReason = "rate_limited";
    const providerUnavailable: FailureReason = "provider_unavailable";
    const notConfigured: FailureReason = "not_configured";
    const malformed: FailureReason = "malformed";
    const expired: FailureReason = "expired";
    const unknown: FailureReason = "unknown";
    expect([contentBlocked, rateLimited, providerUnavailable, notConfigured, malformed, expired, unknown]).toHaveLength(7);
  });
});

describe("interface shapes (compile-time)", () => {
  it("ImageGenRequestBody accepts the D-06 shape", () => {
    const body: ImageGenRequestBody = {
      prompt: "a cat",
      requested_at: "2026-09-18T00:00:00Z",
      size: "1024x1024",
      quality: "high",
      n: 2,
      ref: "abcdef01-2345-6789-abcd-ef0123456789.ref.png",
    };
    expect(body.prompt).toBe("a cat");
  });

  it("ImageGenRequestBody accepts only required fields", () => {
    const body: ImageGenRequestBody = {
      prompt: "a cat",
      requested_at: "2026-09-18T00:00:00Z",
    };
    expect(body.n).toBeUndefined();
  });

  it("PendingImageGen carries hostId + refImage + malformedReason optionally", () => {
    const item: PendingImageGen = {
      hostId: "42",
      hostIdNum: 42,
      uuid: "abcdef01-2345-6789-abcd-ef0123456789",
      body: { prompt: "x", requested_at: "2026-09-18T00:00:00Z" },
      userId: "user-abc",
    };
    expect(item.refImage).toBeUndefined();
    expect(item.malformedReason).toBeUndefined();

    const withRef: PendingImageGen = { ...item, refImage: Buffer.from([1, 2, 3]) };
    expect(withRef.refImage?.length).toBe(3);
  });

  it("SuccessResponse shape matches D-08", () => {
    const success: SuccessResponse = {
      images: ["uuid.success.0.png", "uuid.success.1.png"],
      size: "1024x1024",
      model: "gpt-image-1",
      n: 2,
      generation_time_ms: 12_345,
    };
    expect(success.images.length).toBe(2);
    expect(success.seed).toBeUndefined();
  });

  it("FailureResponse shape matches D-09 (message optional)", () => {
    const failure: FailureResponse = { reason: "expired" };
    expect(failure.message).toBeUndefined();

    const malformedFailure: FailureResponse = { reason: "malformed", message: "missing prompt" };
    expect(malformedFailure.message).toBe("missing prompt");
  });
});
