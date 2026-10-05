import { describe, it, expect } from "vitest";
import { identityRoles, identityRolesLabel } from "./identity-roles";

describe("identityRoles", () => {
  it("prefers the roles list; falls back to the single role; tolerates missing role", () => {
    expect(identityRoles({ role: null, roles: ["a-b", "c"] })).toEqual(["a-b", "c"]);
    expect(identityRoles({ role: "a-b" })).toEqual(["a-b"]);
    expect(identityRoles({ role: null })).toEqual([]);
    expect(identityRoles({ role: undefined as unknown as null })).toEqual([]);
  });
});

describe("identityRolesLabel", () => {
  it("joins display names; only the inherited-look role uses roleDefaults.displayName", () => {
    expect(
      identityRolesLabel({
        role: null,
        roles: ["box-maintainer", "sky-uat"],
        roleDefaults: null,
      }),
    ).toBe("Box Maintainer, Sky Uat");
    expect(
      identityRolesLabel({
        role: "box-maintainer",
        roleDefaults: { displayName: "Boxer" },
      }),
    ).toBe("Boxer");
  });
});
