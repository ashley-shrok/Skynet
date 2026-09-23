/**
 * identity-visibility-gate.test.ts — Phase 129 Plan 01 Task 2
 *
 * Full-matrix unit tests for isIdentityVisibleToUser — the pure companion
 * function to resolveIdentityAppearance's cosmetics merge. Zero DB / express /
 * logger imports; three-arg pure function, so no fixture builder needed.
 *
 * The 10-case matrix covers:
 *   [nullCaller × emptyLists × userOnBoth × userOnRoleOnly
 *    × userOnIdOnly × zoeOnBoth-userEmpty × case-sensitivity
 *    × nullCosmetics × sharedRoleNarrowIdentity]
 *
 * Design locks under test:
 *   - D-2 intersection: both sides must pass; empty/absent = "no gate on that side"
 *   - D-3 fallback: empty/absent list on either side means "open on that side"
 *   - null callerUsername disables gate entirely (internal / test bypass)
 *   - Pitfall 7: case-sensitive comparison (no toLowerCase/toUpperCase)
 */
import { describe, it, expect } from "vitest";
import { isIdentityVisibleToUser } from "./identity-visibility-gate.js";

describe("isIdentityVisibleToUser — Phase 129 per-user visibility gate", () => {
  it("Test 1: null caller username disables the gate entirely (returns true)", () => {
    expect(isIdentityVisibleToUser(null, null, null)).toBe(true);
    expect(isIdentityVisibleToUser({}, {}, null)).toBe(true);
    expect(
      isIdentityVisibleToUser(
        { users: ["user"] },
        { users: ["zoe"] },
        null,
      ),
    ).toBe(true);
  });

  it("Test 2: both sides empty/absent → open per D-3 fallback", () => {
    expect(isIdentityVisibleToUser({}, {}, "user")).toBe(true);
    expect(isIdentityVisibleToUser(null, null, "user")).toBe(true);
    expect(
      isIdentityVisibleToUser({ users: [] }, { users: [] }, "user"),
    ).toBe(true);
  });

  it("Test 3: both sides list User → open for User", () => {
    expect(
      isIdentityVisibleToUser(
        { users: ["user"] },
        { users: ["user"] },
        "user",
      ),
    ).toBe(true);
  });

  it("Test 4: both sides list User → CLOSED for Zoe (D-2 intersection)", () => {
    expect(
      isIdentityVisibleToUser(
        { users: ["user"] },
        { users: ["user"] },
        "zoe",
      ),
    ).toBe(false);
  });

  it("Test 5: role open + identity narrow → CLOSED for non-matching user", () => {
    // Identity side lists user; role side is empty (open). Zoe fails
    // identity gate → hidden.
    expect(
      isIdentityVisibleToUser({ users: ["user"] }, {}, "zoe"),
    ).toBe(false);
  });

  it("Test 6: role narrow + identity open → CLOSED for non-matching user", () => {
    // Role side lists user; identity side is empty (open). Zoe fails
    // role gate → hidden.
    expect(
      isIdentityVisibleToUser({}, { users: ["user"] }, "zoe"),
    ).toBe(false);
  });

  it("Test 7: shared role, identity-side narrow to User → CLOSED for Zoe", () => {
    // The intersection-semantics headliner: a role shared by user+zoe can
    // still contain identities each narrowed further via identity.users.
    expect(
      isIdentityVisibleToUser(
        { users: ["user"] },
        { users: ["user", "zoe"] },
        "zoe",
      ),
    ).toBe(false);
  });

  it("Test 8: shared role AND shared identity → open for both users", () => {
    expect(
      isIdentityVisibleToUser(
        { users: ["user", "zoe"] },
        { users: ["user", "zoe"] },
        "user",
      ),
    ).toBe(true);
    expect(
      isIdentityVisibleToUser(
        { users: ["user", "zoe"] },
        { users: ["user", "zoe"] },
        "zoe",
      ),
    ).toBe(true);
  });

  it("Test 9: case-sensitive comparison — 'User' does NOT match 'user' (Pitfall 7 lock)", () => {
    expect(
      isIdentityVisibleToUser(
        { users: ["User"] },
        { users: ["User"] },
        "user",
      ),
    ).toBe(false);
  });

  it("Test 10: null cosmetics on either side → treated as 'no gate'", () => {
    // null identityCos treated as "no gate on identity side".
    // Role side lists user → open for user.
    expect(
      isIdentityVisibleToUser(null, { users: ["user"] }, "user"),
    ).toBe(true);
    // null roleCos treated as "no gate on role side".
    // Identity side lists user → closed for zoe.
    expect(
      isIdentityVisibleToUser({ users: ["user"] }, null, "zoe"),
    ).toBe(false);
  });
});
