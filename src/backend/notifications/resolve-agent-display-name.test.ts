/**
 * Phase 128 Plan 03 Task 2 — tests for `resolveAgentDisplayName(mxid)`.
 *
 * Contract exercised (from 128-03-PLAN.md <behavior>):
 *   - Happy path: mxid resolves to an identity whose appearance carries a
 *     displayName → return that displayName (truncated to 40 chars).
 *   - Appearance resolves but has no displayName → fall back to mxid
 *     local-part (truncated to 40 chars). NOTE: `resolveIdentityAppearance`
 *     itself already falls back to `capitalizeFirstIdentityKey(identityKey)`
 *     when identity cosmetics don't carry a displayName — so from this
 *     wrapper's vantage point the "no displayName" case is really "identity
 *     file was empty / unreadable / mocked to return the safe default".
 *   - Identity file read throws (SSH failure, disk error) → localPart
 *     fallback + `.warn` log; NEVER throws.
 *   - Malformed mxid (no `@` or no `:`) → best-effort local-part.
 *   - Very long displayName → truncated to 40 chars.
 *
 * Test isolation strategy:
 *   - `vi.mock("../claude-session/identity-artifact-reader.js")` controls
 *     the disk-read chain — `readIdentityFile`, `readRoleFileByName`,
 *     `extractCosmeticsFromFrontmatter`, `extractRoleFromMarkdown`. This
 *     mock keeps tests hermetic (no ~/fleet/identities/... reads).
 *   - `vi.mock("../fleet-status/identity-appearance.js")` controls the
 *     resolved appearance — per 128-03-PLAN.md's <action> block.
 *   - `vi.mock("../utils/logger.js")` provides a spy-able logger so we can
 *     assert the `.warn` fires on the failure path.
 *
 * These tests are RED-phase: they define the contract before the module
 * exists. The GREEN commit adds src/backend/notifications/resolve-agent-display-name.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../claude-session/identity-artifact-reader.js", () => ({
  readIdentityFile: vi.fn(),
  readRoleFileByName: vi.fn(),
  extractCosmeticsFromFrontmatter: vi.fn(),
  extractRoleFromMarkdown: vi.fn(),
}));

vi.mock("../fleet-status/identity-appearance.js", () => ({
  resolveIdentityAppearance: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Test imports (after mocks are declared) ─────────────────────────────────

import {
  readIdentityFile,
  readRoleFileByName,
  extractCosmeticsFromFrontmatter,
  extractRoleFromMarkdown,
} from "../claude-session/identity-artifact-reader.js";
import { resolveIdentityAppearance } from "../fleet-status/identity-appearance.js";
import { systemLogger } from "../utils/logger.js";
import { resolveAgentDisplayName } from "./resolve-agent-display-name.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("resolveAgentDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Sensible defaults so tests only override what they exercise.
    vi.mocked(readIdentityFile).mockResolvedValue({ markdown: "" });
    vi.mocked(readRoleFileByName).mockResolvedValue({ markdown: "" });
    vi.mocked(extractCosmeticsFromFrontmatter).mockReturnValue({});
    vi.mocked(extractRoleFromMarkdown).mockReturnValue(null);
    vi.mocked(resolveIdentityAppearance).mockReturnValue({
      displayName: "Ashley-Agent-Foo",
      title: null,
      colorHue: null,
      voice: null,
      task: null,
      project: null,
      coordinator: false,
      role: null,
      roleDefaults: null,
      avatarUrl: "/identities/ashley-agent-foo/avatar?hostId=0",
      pinned: false,
    });
  });

  it("returns the displayName from resolveIdentityAppearance on the happy path", async () => {
    const result = await resolveAgentDisplayName(
      "@ashley-agent-foo:t1000.taild9b663.ts.net",
    );
    expect(result).toBe("Ashley-Agent-Foo");
  });

  it("falls back to the mxid local-part when appearance resolution returns a whitespace-only / empty displayName", async () => {
    // Simulate the resolver returning an empty string (unusual but defensive).
    vi.mocked(resolveIdentityAppearance).mockReturnValue({
      displayName: "",
      title: null,
      colorHue: null,
      voice: null,
      task: null,
      project: null,
      coordinator: false,
      role: null,
      roleDefaults: null,
      avatarUrl: "",
      pinned: false,
    });
    const result = await resolveAgentDisplayName(
      "@ashley-agent-foo:t1000.taild9b663.ts.net",
    );
    expect(result).toBe("ashley-agent-foo");
  });

  it("logs .warn and falls back to local-part when readIdentityFile throws", async () => {
    vi.mocked(readIdentityFile).mockRejectedValue(
      new Error("SSH connection dropped"),
    );
    const result = await resolveAgentDisplayName(
      "@ashley-agent-foo:t1000.taild9b663.ts.net",
    );
    expect(result).toBe("ashley-agent-foo");
    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("resolveAgentDisplayName"),
      expect.objectContaining({
        mxid: "@ashley-agent-foo:t1000.taild9b663.ts.net",
      }),
    );
  });

  it("does NOT throw when the appearance resolver itself throws — falls back to local-part with warn log", async () => {
    vi.mocked(resolveIdentityAppearance).mockImplementation(() => {
      throw new Error("cosmetics merge exploded");
    });
    await expect(
      resolveAgentDisplayName("@ashley-agent-foo:t1000.taild9b663.ts.net"),
    ).resolves.toBe("ashley-agent-foo");
    expect(systemLogger.warn).toHaveBeenCalled();
  });

  it("returns best-effort local-part for a malformed mxid (no colon)", async () => {
    const result = await resolveAgentDisplayName("@no-colon-here");
    // No colon → localPart = strip leading @ → everything before ":".split()[0]
    // On "no-colon-here" this becomes "no-colon-here" (no ":", so split returns the whole string).
    expect(result).toBe("no-colon-here");
  });

  it("returns best-effort local-part for a malformed mxid (no @ prefix)", async () => {
    const result = await resolveAgentDisplayName(
      "ashley-agent-foo:server.example",
    );
    // No leading @ → strip nothing → split on ":" → first segment.
    expect(result).toBe("ashley-agent-foo");
  });

  it("truncates a very long displayName at 40 chars", async () => {
    const longName = "A".repeat(120);
    vi.mocked(resolveIdentityAppearance).mockReturnValue({
      displayName: longName,
      title: null,
      colorHue: null,
      voice: null,
      task: null,
      project: null,
      coordinator: false,
      role: null,
      roleDefaults: null,
      avatarUrl: "",
      pinned: false,
    });
    const result = await resolveAgentDisplayName(
      "@ashley-agent-foo:t1000.taild9b663.ts.net",
    );
    expect(result).toBe("A".repeat(40));
    expect(result.length).toBe(40);
  });

  it("truncates a very long local-part fallback at 40 chars", async () => {
    const longLocalPart = "b".repeat(120);
    vi.mocked(readIdentityFile).mockRejectedValue(new Error("boom"));
    const result = await resolveAgentDisplayName(
      `@${longLocalPart}:server.example`,
    );
    expect(result.length).toBe(40);
    expect(result).toBe("b".repeat(40));
  });

  it("uses role cosmetics when identity has a role and cosmetics chain succeeds", async () => {
    // Identity file has a role; the wrapper should read the role file too and
    // pass roleCosmetics into resolveIdentityAppearance.
    vi.mocked(readIdentityFile).mockResolvedValue({
      markdown: "---\nrole: agent-role\n---\nbody",
    });
    vi.mocked(extractRoleFromMarkdown).mockReturnValue("agent-role");
    vi.mocked(readRoleFileByName).mockResolvedValue({
      markdown: "---\ndisplayName: RoleName\n---",
    });
    vi.mocked(extractCosmeticsFromFrontmatter).mockImplementation((md) => {
      if (md.includes("RoleName")) return { displayName: "RoleName" };
      return {};
    });
    vi.mocked(resolveIdentityAppearance).mockImplementation((args) => ({
      displayName: args.cosmetics?.displayName ?? "capitalized-fallback",
      title: null,
      colorHue: null,
      voice: null,
      task: null,
      project: null,
      coordinator: false,
      role: args.role,
      roleDefaults: args.roleCosmetics,
      avatarUrl: "",
      pinned: args.pinned,
    }));

    const result = await resolveAgentDisplayName(
      "@ashley-agent-foo:t1000.taild9b663.ts.net",
    );

    // Verify readRoleFileByName was called with the resolved role name.
    expect(readRoleFileByName).toHaveBeenCalledWith(null, "agent-role");
    // Verify the resolver received the role + role cosmetics.
    const call = vi.mocked(resolveIdentityAppearance).mock.calls[0]?.[0];
    expect(call?.role).toBe("agent-role");
    expect(call?.roleCosmetics).toEqual({ displayName: "RoleName" });

    // The identity cosmetics were empty (its own file only had a role: line
    // in this test — extractCosmeticsFromFrontmatter mock returns {}), so
    // the resolver's `identity ?? role ?? null` cascade would fall through
    // to the role's `displayName` — but per identity-appearance.ts's carve-out,
    // displayName does NOT fall through to the role. That's the resolver's
    // problem to enforce; here we just verify the wrapper wires roleCosmetics
    // through correctly.
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
