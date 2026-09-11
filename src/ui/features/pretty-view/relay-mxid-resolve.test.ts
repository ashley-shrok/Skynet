/**
 * Phase 17 Plan 03 — relay-mxid-resolve.ts unit tests.
 *
 * Tests: RELAYBUB-03 (mxid→identity resolution chain).
 */
import { describe, it, expect } from "vitest";
import { resolveMxidToIdentity, MXID_REGEX } from "./relay-mxid-resolve";
import type { Identity } from "@/api/identities-api";

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number | null,
): Identity {
  // Phase 68: Identity no longer has id/createdAt/updatedAt.
  return {
    identityKey,
    displayName,
    title: null,
    colorHue,
    voice: null,
    role: null,
    avatarMime: "image/png",
    avatarUrl: "/avatar.png",
    avatarEtag: "abc",
    coordinator: false,
  };
}

describe("relay-mxid-resolve — resolveMxidToIdentity", () => {
  it("Test 1: valid mxid + identityKey hit → colorHue + displayName from Identity", () => {
    const alice = makeIdentity("alice", "Alice", 200);
    const byKey = new Map([["alice", alice]]);

    const result = resolveMxidToIdentity("@Alice:homeserver.example", byKey);

    expect(result.identity).toBe(alice);
    expect(result.colorHue).toBe(200);
    expect(result.displayName).toBe("Alice");
  });

  it("Test 2: valid mxid + no identity match → colorHue null + displayName is raw mxid", () => {
    const byKey = new Map<string, Identity>();

    const result = resolveMxidToIdentity("@unknown:homeserver.example", byKey);

    expect(result.identity).toBeNull();
    expect(result.colorHue).toBeNull();
    expect(result.displayName).toBe("@unknown:homeserver.example");
  });

  it("Test 3: malformed mxid (no @ sigil) → fallback with raw input as displayName", () => {
    const byKey = new Map<string, Identity>();

    const result = resolveMxidToIdentity("notanmxid", byKey);

    expect(result.identity).toBeNull();
    expect(result.colorHue).toBeNull();
    expect(result.displayName).toBe("notanmxid");
  });

  it("Test 4: identity match uses lowercased local-part (@Alice:server matches identityKey 'alice')", () => {
    const alice = makeIdentity("alice", "Alice", 42);
    const byKey = new Map([["alice", alice]]);

    // Uppercase A — must still match via lowercasing
    const result = resolveMxidToIdentity("@Alice:server.tld", byKey);

    expect(result.identity).toBe(alice);
    expect(result.colorHue).toBe(42);
    expect(result.displayName).toBe("Alice");
  });
});

describe("relay-mxid-resolve — MXID_REGEX", () => {
  it("matches a valid mxid and captures local-part and server", () => {
    const match = "@tina:matrix.example.com".match(MXID_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("tina");
    expect(match![2]).toBe("matrix.example.com");
  });

  it("does not match a string without @ sigil", () => {
    const match = "tina:matrix.example.com".match(MXID_REGEX);
    expect(match).toBeNull();
  });
});
