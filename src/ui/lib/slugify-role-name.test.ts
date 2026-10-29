// slugifyRoleName — typed name → role / skill / runbook folder slug.
// (Ported from the retired CreateRoleDialog suite.)

import { describe, it, expect } from "vitest";
import { slugifyRoleName } from "./slugify-role-name";

// The backend's role-name gate (identity-birth-orchestrator ROLE_NAME_PATTERN).
const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

describe("slugifyRoleName", () => {
  it("lowercases and hyphenates free text, and always yields a valid role name", () => {
    const cases: Array<[string, string]> = [
      ["Box Maintainer", "box-maintainer"],
      ["box-maintainer", "box-maintainer"],
      ["Box_Maintainer", "box-maintainer"],
      ["  Box   Maintainer  ", "box-maintainer"],
      ["Acme Health / Infra", "acme-health-infra"],
      ["Café Ops", "cafe-ops"],
      ["R2D2", "r2d2"],
      ["Ops!!!", "ops"],
      ["Weekly report", "weekly-report"],
    ];
    for (const [input, expected] of cases) {
      expect(slugifyRoleName(input)).toBe(expected);
      expect(ROLE_NAME_PATTERN.test(slugifyRoleName(input))).toBe(true);
    }
  });

  it("returns an empty string when there is nothing sluggable", () => {
    for (const input of ["", "   ", "!!!", "---", "  -- ", "🎉🎉"]) {
      expect(slugifyRoleName(input)).toBe("");
    }
  });

  it("caps length at 64 chars without leaving a trailing hyphen", () => {
    const slug = slugifyRoleName("a".repeat(60) + " " + "b".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
    expect(ROLE_NAME_PATTERN.test(slug)).toBe(true);
  });
});
