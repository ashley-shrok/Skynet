/**
 * identity-artifact-reader.users.test.ts — Phase 129 Plan 01 Task 1
 *
 * Behavior tests for the new `users?: string[]` frontmatter field parsed by
 * extractCosmeticsFromFrontmatter. Also asserts the RawCosmetics type is
 * source-extended so a TS consumer can construct `{ users: [...] }` at compile
 * time.
 *
 * Design lock (per Plan 01 acceptance criteria): absent-⇒-omit — an empty or
 * missing `users:` list yields a returned object where the `users` key does
 * NOT exist (not `null`, not `undefined` as a set key, not `[]`). This
 * preserves the D-3 fallback semantic — "no gate on this side" is expressed
 * as absence, not as a present-but-empty sentinel.
 */
import { describe, it, expect } from "vitest";
import { extractCosmeticsFromFrontmatter } from "./identity-artifact-reader.js";
import type { RawCosmetics } from "../fleet-status/identity-appearance.js";

// ---------------------------------------------------------------------------
// Fixture helper — wrap a frontmatter body in the ---\n...\n--- fences that
// extractCosmeticsFromFrontmatter looks for.
// ---------------------------------------------------------------------------

function md(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\n# body\n`;
}

describe("extractCosmeticsFromFrontmatter — users narrowing (Phase 129)", () => {
  it("Test 1: parses a single-entry users list", () => {
    const result = extractCosmeticsFromFrontmatter(md("users:\n  - ashley"));
    expect(result.users).toEqual(["ashley"]);
  });

  it("Test 2: preserves order for a multi-entry users list", () => {
    const result = extractCosmeticsFromFrontmatter(md("users:\n  - ashley\n  - zoe"));
    expect(result.users).toEqual(["ashley", "zoe"]);
  });

  it("Test 3: absent users key yields no `users` property on the returned object", () => {
    const result = extractCosmeticsFromFrontmatter(md("displayName: Pixel"));
    // Absent-⇒-omit: `users` is not present as a key at all (NOT `null`,
    // NOT `undefined`-valued key, NOT `[]`).
    expect("users" in result).toBe(false);
  });

  it("Test 4: empty users list yields absent (normalization drops empty arrays)", () => {
    const result = extractCosmeticsFromFrontmatter(md("users: []"));
    expect("users" in result).toBe(false);
  });

  it("Test 5: mixed junk normalizes to strings-only, trimmed, non-empty preserved", () => {
    const result = extractCosmeticsFromFrontmatter(
      md('users:\n  - ashley\n  - ""\n  - "   "\n  - 42\n  - null'),
    );
    expect(result.users).toEqual(["ashley"]);
  });

  it("Test 6: scalar (non-array) users value yields absent — Array.isArray gate rejects", () => {
    const result = extractCosmeticsFromFrontmatter(md("users: ashley"));
    expect("users" in result).toBe(false);
  });

  it("Test 7: RawCosmetics type accepts a users field (compile-time proof)", () => {
    // This test is asserting the TYPE extension. If RawCosmetics does not
    // carry `users?: string[]`, this file fails typecheck and the test
    // suite never boots.
    const c: RawCosmetics = { users: ["ashley"] };
    expect(c.users).toEqual(["ashley"]);
  });

  it("Test 8 (bonus): whitespace-only + trim preserves inner whitespace-flanked names", () => {
    // Guards against overzealous "trim" that would eat interior spaces.
    // usernames don't contain spaces in practice, but we should not
    // silently mangle strings we accept.
    const result = extractCosmeticsFromFrontmatter(md("users:\n  - '  ashley  '"));
    expect(result.users).toEqual(["ashley"]);
  });
});
