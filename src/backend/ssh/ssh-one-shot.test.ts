/**
 * ssh-one-shot.test.ts — unit tests for the credential-error classifier
 * that gates whether a connect-side error trips the circuit breaker.
 *
 * The classifier is the load-bearing correctness invariant for HIGH-2 in
 * the 2026-09-29 code review: auth failures (bad password, wrong key,
 * key-passphrase mismatch) must NOT open the breaker, because retrying
 * with the same bad credentials against a healthy host would just
 * reproduce the failure three times and block every other legitimate
 * caller of that peer.
 *
 * Full end-to-end coverage of connectOneShot (mocking ssh2's Client) is
 * out of scope here; those integration paths are covered by fleet-status
 * and orchestrator-level tests. This file targets the classifier itself.
 */

import { describe, expect, it } from "vitest";

import { isCredentialError } from "./ssh-one-shot.js";

describe("ssh-one-shot — isCredentialError", () => {
  it("returns true for ssh2 client-authentication errors", () => {
    // ssh2 tags auth-failure errors with `level: "client-authentication"`
    // when the auth loop exhausts all methods (see ssh2/lib/client.js).
    const err = Object.assign(new Error("All configured authentication methods failed"), {
      level: "client-authentication",
    });
    expect(isCredentialError(err)).toBe(true);
  });

  it("returns false for connect-refused / timeout / network-side errors", () => {
    // These carry no `.level` or a different level; they represent host
    // unavailability and SHOULD trip the breaker.
    expect(isCredentialError(new Error("Connect timeout after 5000ms"))).toBe(false);
    expect(isCredentialError(new Error("ECONNREFUSED 100.0.0.1:22"))).toBe(false);
    expect(
      isCredentialError(Object.assign(new Error("Protocol error"), { level: "protocol" })),
    ).toBe(false);
  });

  it("returns false for non-Error inputs (defensive)", () => {
    expect(isCredentialError(null)).toBe(false);
    expect(isCredentialError(undefined)).toBe(false);
    expect(isCredentialError("string error")).toBe(false);
    expect(isCredentialError(42)).toBe(false);
    expect(isCredentialError({})).toBe(false);
  });

  it("returns false when the level property is not the exact expected string", () => {
    // Guard against silent classifier bypass if ssh2 ever changes the tag.
    // A future test failure here signals a needed update, not a regression.
    expect(
      isCredentialError(Object.assign(new Error("x"), { level: "auth" })),
    ).toBe(false);
    expect(
      isCredentialError(Object.assign(new Error("x"), { level: "client-auth" })),
    ).toBe(false);
    expect(
      isCredentialError(Object.assign(new Error("x"), { level: 123 })),
    ).toBe(false);
  });
});
