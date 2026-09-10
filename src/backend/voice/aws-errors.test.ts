import { describe, it, expect } from "vitest";
import { isAwsAccessDenied } from "./aws-errors.js";

/**
 * Phase 98 plan 04 — isAwsAccessDenied truth-table test suite.
 *
 * Truth-table style (one `it()` per contract row) mirroring the
 * slashCommandTransform.test.ts convention in this directory. Each row is a
 * locked behavior contract from 98-04-PLAN.md § Task 1 <behavior>.
 *
 * Coverage rationale:
 *
 * - Positive matches: AccessDeniedException name (canonical AWS SDK shape),
 *   $metadata.httpStatusCode === 403 (raw HTTP path), and both together
 *   (belt-and-suspenders — real AccessDenied responses from the SDK carry
 *   both signals; guard must not require only one).
 *
 * - Negative matches: plain Error, null / undefined / non-Error primitives,
 *   sibling AWS exceptions like ThrottlingException (name mismatch AND
 *   status 429), and Errors with unrelated status codes (500) — all must
 *   fall through to false so the caller's non-access-denied error branch
 *   runs.
 *
 * Why this matters: this guard is the off-switch mechanism per
 * 98-CONTEXT.md § Provider access ("off-switch is policy-absence"). A
 * false-negative would surface AccessDenied as a 500 error spam in logs
 * instead of routing to the info-level 503-with-clean-error path. A
 * false-positive would incorrectly mark real errors (throttling, 500s) as
 * "feature dark" and hide legitimate bugs.
 */

describe("isAwsAccessDenied — positive matches", () => {
  it("returns true when err.name === 'AccessDeniedException'", () => {
    const err = new Error("Access denied");
    (err as unknown as { name: string }).name = "AccessDeniedException";
    expect(isAwsAccessDenied(err)).toBe(true);
  });

  it("returns true when err.$metadata.httpStatusCode === 403", () => {
    const err = new Error("Forbidden");
    (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode: 403,
    };
    expect(isAwsAccessDenied(err)).toBe(true);
  });

  it("returns true when both name and $metadata.httpStatusCode indicate access denied", () => {
    const err = new Error("Access denied");
    (err as unknown as { name: string }).name = "AccessDeniedException";
    (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode: 403,
    };
    expect(isAwsAccessDenied(err)).toBe(true);
  });
});

describe("isAwsAccessDenied — negative matches", () => {
  it("returns false for plain Error('random')", () => {
    expect(isAwsAccessDenied(new Error("random"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAwsAccessDenied(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAwsAccessDenied(undefined)).toBe(false);
  });

  it("returns false for number 42", () => {
    expect(isAwsAccessDenied(42)).toBe(false);
  });

  it("returns false for plain object {}", () => {
    expect(isAwsAccessDenied({})).toBe(false);
  });

  it("returns false for ThrottlingException (name mismatch AND status !== 403)", () => {
    const err = new Error("Rate exceeded");
    (err as unknown as { name: string }).name = "ThrottlingException";
    (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode: 429,
    };
    expect(isAwsAccessDenied(err)).toBe(false);
  });

  it("returns false for Error with $metadata.httpStatusCode === 500", () => {
    const err = new Error("Server error");
    (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode: 500,
    };
    expect(isAwsAccessDenied(err)).toBe(false);
  });
});
