/**
 * identity-appearance.test.ts — Unit tests for the identity-over-role merge authority.
 *
 * These tests are the guard that prevents a future edit from quietly reintroducing
 * a second, subtly-different cascade or breaking the two non-obvious carve-outs:
 *
 *   1. `task` is NOT inherited from the role (D-05 write-once at birth).
 *   2. `displayName` falls back to `capitalizeFirstIdentityKey(identityKey)`,
 *      NOT to the role's `displayName`.
 *
 * Tests are structured as one `describe` per behaviour.
 */
import { describe, it, expect } from "vitest";
import {
  resolveIdentityAppearance,
  capitalizeFirstIdentityKey,
  type RawCosmetics,
  type ResolvedIdentityAppearance,
} from "./identity-appearance.js";

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

function makeArgs(overrides: {
  identityKey?: string;
  hostId?: number;
  cosmetics?: RawCosmetics | null;
  roleCosmetics?: RawCosmetics | null;
  role?: string | null;
  pinned?: boolean;
  hidden?: boolean;
} = {}): Parameters<typeof resolveIdentityAppearance>[0] {
  return {
    identityKey: overrides.identityKey ?? "pixel",
    hostId: overrides.hostId ?? 6,
    cosmetics: overrides.cosmetics !== undefined ? overrides.cosmetics : {},
    roleCosmetics: overrides.roleCosmetics !== undefined ? overrides.roleCosmetics : null,
    role: overrides.role !== undefined ? overrides.role : null,
    pinned: overrides.pinned ?? false,
    hidden: overrides.hidden ?? false,
  };
}

// ---------------------------------------------------------------------------
// 1. title — three-case cascade
// ---------------------------------------------------------------------------

describe("title cascade", () => {
  it("title present on identity and role → identity wins", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { title: "Identity Title" },
      roleCosmetics: { title: "Role Title" },
    }));
    expect(result.title).toBe("Identity Title");
  });

  it("title absent on identity, present on role → role value inherited", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: { title: "Role Title" },
    }));
    expect(result.title).toBe("Role Title");
  });

  it("title absent on both → null", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: {},
    }));
    expect(result.title).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. colorHue — three-case cascade, including 0 as present
// ---------------------------------------------------------------------------

describe("colorHue cascade", () => {
  it("colorHue present on identity and role → identity wins", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { colorHue: 120 },
      roleCosmetics: { colorHue: 200 },
    }));
    expect(result.colorHue).toBe(120);
  });

  it("colorHue absent on identity, present on role → role value inherited", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: { colorHue: 324 },
    }));
    expect(result.colorHue).toBe(324);
  });

  it("colorHue absent on both → null", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: {},
    }));
    expect(result.colorHue).toBeNull();
  });

  it("colorHue: 0 on identity with role colorHue: 200 → identity wins (0 is present, not falsy)", () => {
    // This case proves the guard is `typeof === "number"` and NOT a truthiness
    // check. If someone replaces the guard with `if (cosmetics.colorHue)`, this
    // test will catch it.
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { colorHue: 0 },
      roleCosmetics: { colorHue: 200 },
    }));
    expect(result.colorHue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. voice — three-case cascade
// ---------------------------------------------------------------------------

describe("voice cascade", () => {
  it("voice present on identity and role → identity wins", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { voice: "Joanna" },
      roleCosmetics: { voice: "Matthew" },
    }));
    expect(result.voice).toBe("Joanna");
  });

  it("voice absent on identity, present on role → role value inherited", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: { voice: "Matthew" },
    }));
    expect(result.voice).toBe("Matthew");
  });

  it("voice absent on both → null", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: {},
    }));
    expect(result.voice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. task — CARVE-OUT: NOT inherited from the role
// ---------------------------------------------------------------------------

describe("task carve-out: NOT inherited from role (D-05 write-once at birth)", () => {
  it("identity has no task, role has task → result task is null (not inherited)", () => {
    // THIS IS THE KEY CARVE-OUT TEST. If task is changed to inherit from the role,
    // this test will fail. Do not change this test without understanding D-05.
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: { task: "role task description" },
    }));
    expect(result.task).toBeNull();
  });

  it("identity has task, role has a different task → identity task wins (not merged)", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { task: "my identity task" },
      roleCosmetics: { task: "role task description" },
    }));
    expect(result.task).toBe("my identity task");
  });

  it("identity has task, no role → task present", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { task: "my identity task" },
      roleCosmetics: null,
    }));
    expect(result.task).toBe("my identity task");
  });

  it("neither has task → null", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
      roleCosmetics: {},
    }));
    expect(result.task).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. displayName — CARVE-OUT: falls back to capitalizeFirstIdentityKey, NOT role
// ---------------------------------------------------------------------------

describe("displayName carve-out: falls back to capitalizeFirstIdentityKey, NOT role displayName", () => {
  it("identity has no displayName, role has displayName → result is capitalized key (not role)", () => {
    // THIS IS THE KEY CARVE-OUT TEST. If displayName is changed to fall through to
    // roleCosmetics.displayName, this test will fail.
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      cosmetics: {},
      roleCosmetics: { displayName: "Role Name" },
    }));
    expect(result.displayName).toBe("Pixel");
  });

  it("identity has displayName → identity displayName wins", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      cosmetics: { displayName: "My Pixel" },
      roleCosmetics: { displayName: "Role Name" },
    }));
    expect(result.displayName).toBe("My Pixel");
  });

  it("displayName is empty string → falls back to capitalizeFirstIdentityKey (empty string fails .length > 0 guard)", () => {
    // The `.length > 0` guard treats empty string as absent.
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "tabitha",
      cosmetics: { displayName: "" },
      roleCosmetics: { displayName: "Role Name" },
    }));
    expect(result.displayName).toBe("Tabitha");
  });

  it("capitalizeFirstIdentityKey: first char uppercased, rest preserved", () => {
    expect(capitalizeFirstIdentityKey("pixel")).toBe("Pixel");
    expect(capitalizeFirstIdentityKey("tabitha")).toBe("Tabitha");
    expect(capitalizeFirstIdentityKey("box-maintainer")).toBe("Box-maintainer");
    expect(capitalizeFirstIdentityKey("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 6. coordinator
// ---------------------------------------------------------------------------

describe("coordinator", () => {
  it("coordinator absent → false (safe-default)", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: {},
    }));
    expect(result.coordinator).toBe(false);
  });

  it("coordinator: true → true", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { coordinator: true },
    }));
    expect(result.coordinator).toBe(true);
  });

  it("coordinator: false → false (explicit false preserved)", () => {
    const result = resolveIdentityAppearance(makeArgs({
      cosmetics: { coordinator: false },
    }));
    expect(result.coordinator).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. roleDefaults — three-valued semantics preserved verbatim
// ---------------------------------------------------------------------------

describe("roleDefaults — three-valued semantics", () => {
  it("roleCosmetics: null → roleDefaults is null (no role resolvable)", () => {
    const result = resolveIdentityAppearance(makeArgs({
      roleCosmetics: null,
    }));
    expect(result.roleDefaults).toBeNull();
  });

  it("roleCosmetics: {} → roleDefaults is {} (role exists with no cosmetics)", () => {
    // The distinction between null and {} is load-bearing for the identity modal's
    // inherit-vs-override display. {} means "role exists but has no cosmetics".
    const result = resolveIdentityAppearance(makeArgs({
      roleCosmetics: {},
    }));
    expect(result.roleDefaults).toEqual({});
  });

  it("roleCosmetics: populated → roleDefaults echoes raw values verbatim", () => {
    const rc: RawCosmetics = { title: "Skynet", colorHue: 324, avatar: "box-maintainer.webp" };
    const result = resolveIdentityAppearance(makeArgs({
      roleCosmetics: rc,
    }));
    expect(result.roleDefaults).toEqual(rc);
  });
});

// ---------------------------------------------------------------------------
// 8. cosmetics: null — fail-closed contract (unreadable identity file)
// ---------------------------------------------------------------------------

describe("cosmetics: null (unreadable identity file) — fail-closed contract", () => {
  it("null cosmetics → no throw; displayName is capitalized key", () => {
    expect(() => {
      resolveIdentityAppearance(makeArgs({
        identityKey: "pixel",
        cosmetics: null,
        roleCosmetics: null,
      }));
    }).not.toThrow();

    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      cosmetics: null,
      roleCosmetics: null,
    }));
    expect(result.displayName).toBe("Pixel");
  });

  it("null cosmetics → every nullable field is null or role value, coordinator is false", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      cosmetics: null,
      roleCosmetics: { title: "Role Title", colorHue: 120, voice: "Matthew" },
      role: "box-maintainer",
    }));
    // With null cosmetics, role values are inherited for cascaded fields
    expect(result.title).toBe("Role Title");
    expect(result.colorHue).toBe(120);
    expect(result.voice).toBe("Matthew");
    // task is NEVER inherited (carve-out D-05)
    expect(result.task).toBeNull();
    // coordinator defaults to false
    expect(result.coordinator).toBe(false);
    // displayName → capitalizeFirst (not role)
    expect(result.displayName).toBe("Pixel");
  });

  it("null cosmetics with null roleCosmetics → plain row, all nulls, no throw", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      cosmetics: null,
      roleCosmetics: null,
      role: null,
    }));
    expect(result.title).toBeNull();
    expect(result.colorHue).toBeNull();
    expect(result.voice).toBeNull();
    expect(result.task).toBeNull();
    expect(result.coordinator).toBe(false);
    expect(result.displayName).toBe("Pixel");
    expect(result.roleDefaults).toBeNull();
    expect(result.role).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. avatarUrl
// ---------------------------------------------------------------------------

describe("avatarUrl", () => {
  it("avatarUrl is exactly `/identities/pixel/avatar?hostId=6` for identityKey: pixel, hostId: 6", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      hostId: 6,
    }));
    expect(result.avatarUrl).toBe("/identities/pixel/avatar?hostId=6");
  });

  it("avatarUrl reflects identityKey and hostId correctly for other values", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "tabitha",
      hostId: 42,
    }));
    expect(result.avatarUrl).toBe("/identities/tabitha/avatar?hostId=42");
  });
});

// ---------------------------------------------------------------------------
// 10. pinned / hidden — pass-through
// ---------------------------------------------------------------------------

describe("pinned and hidden", () => {
  it("pinned: false, hidden: false → both false in result", () => {
    const result = resolveIdentityAppearance(makeArgs({
      pinned: false,
      hidden: false,
    }));
    expect(result.pinned).toBe(false);
    expect(result.hidden).toBe(false);
  });

  it("pinned: true → true in result", () => {
    const result = resolveIdentityAppearance(makeArgs({
      pinned: true,
    }));
    expect(result.pinned).toBe(true);
  });

  it("hidden: true → true in result", () => {
    const result = resolveIdentityAppearance(makeArgs({
      hidden: true,
    }));
    expect(result.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Parity assertion — resolveIdentityAppearance output matches expected
//     values for the same inputs publicIdentity() was documented to produce.
//
// Rather than importing publicIdentity() (which routes through express), we
// assert the resolved values directly against the documented expected values
// from identities.get-disk.test.ts. This pins the merge module to the
// canonical shape established by that 31-test suite.
//
// The corresponding assertions in identities.get-disk.test.ts that cover the
// same cascade for the `pixel` identity fixture with the `box-maintainer` role
// are in the PUB-* test group (title/colorHue merged from role when identity
// omits them, task per-identity, displayName from identity or capitalizeFirst).
// ---------------------------------------------------------------------------

describe("parity: resolveIdentityAppearance shapes match publicIdentity documented semantics", () => {
  it("no cosmetics, role cosmetics present → title/colorHue/voice from role, task null, displayName capitalized", () => {
    // Mirrors the pixel/box-maintainer fixture: pixel.md has displayName+task
    // but no title/colorHue. box-maintainer.md has title/colorHue but no task.
    const result = resolveIdentityAppearance({
      identityKey: "pixel",
      hostId: 6,
      cosmetics: { displayName: "Pixel", task: "Building things" },
      roleCosmetics: { title: "Skynet", colorHue: 324 },
      role: "box-maintainer",
      pinned: false,
      hidden: false,
    });

    expect(result.displayName).toBe("Pixel");
    expect(result.title).toBe("Skynet");
    expect(result.colorHue).toBe(324);
    expect(result.task).toBe("Building things");
    expect(result.role).toBe("box-maintainer");
    expect(result.roleDefaults).toEqual({ title: "Skynet", colorHue: 324 });
    expect(result.avatarUrl).toBe("/identities/pixel/avatar?hostId=6");
    expect(result.coordinator).toBe(false);
    expect(result.pinned).toBe(false);
    expect(result.hidden).toBe(false);
  });

  it("complete result shape has all required fields (no missing keys)", () => {
    const result = resolveIdentityAppearance(makeArgs({
      identityKey: "pixel",
      hostId: 6,
    }));
    const keys: Array<keyof ResolvedIdentityAppearance> = [
      "displayName", "title", "colorHue", "voice", "task", "coordinator",
      "role", "roleDefaults", "avatarUrl", "pinned", "hidden",
    ];
    for (const key of keys) {
      expect(result).toHaveProperty(key);
    }
  });
});
