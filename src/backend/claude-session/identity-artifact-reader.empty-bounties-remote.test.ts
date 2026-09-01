// ─── identity-artifact-reader — REMOTE bounties tolerance for empty/missing dir
//
// Symptom (2026-09-01, Ashley): IdentityModal showed
// "Couldn't load bounties: Command exited with code 1" when opening the
// bounties tab for an identity on a remote host whose role had no bounties
// yet. Two shell-level failure modes both surfaced identically:
//   (a) `~/.claude/roles/<role>/bounties/` does not exist yet (fresh role that
//       has never had a bounty created), or
//   (b) `bounties/` exists but is empty (or contains only `archive/`).
//
// Both flowed through `execCommand` → `Error("Command exited with code 1")`
// (empty stderr because of `2>/dev/null`) → WS `error` field → modal.
//
// The LOCAL branch already handled these cases (fs.readdir ENOENT → return
// empty; empty dir → empty loop). Only REMOTE was bugged.
//
// The fix guards the shell command with `[ -d "$DIR" ] || exit 0`, skips the
// literal-glob iteration on an empty dir with `[ "$d" = "*" ] && continue`,
// and ends with `exit 0` so a tail iteration's failed `[ -f ... ]` doesn't
// bubble up as a non-zero exit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client as SSHClientType } from "ssh2";

vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../ssh/tmux-helper.js";
import { readIdentityBounties } from "./identity-artifact-reader.js";

describe("readIdentityBounties — REMOTE, empty/missing bounties dir tolerance", () => {
  const KEY = "freshidentity";
  const ROLE = "some-fresh-role";
  const identityMd = `---\nrole: ${ROLE}\n---\n\n# ${KEY}\n`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shell command contains the tolerance guards (dir-exists check + literal-glob skip + trailing exit 0)", async () => {
    const capturedCommands: string[] = [];
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        capturedCommands.push(cmd);
        if (cmd.includes(".claude/identities/")) return identityMd;
        return "";
      },
    );

    const conn = {} as SSHClientType;
    await readIdentityBounties(conn, KEY, true);

    const bountyCommands = capturedCommands.filter(
      (c) => c.includes(".claude/roles/") && c.includes("/bounties"),
    );
    // Both open + archive commands run when includeArchived=true.
    expect(bountyCommands).toHaveLength(2);

    for (const cmd of bountyCommands) {
      // (a) preflight dir-exists check with early exit 0.
      expect(cmd).toContain('[ -d "$DIR" ] || exit 0');
      // (b) literal-glob skip so an empty dir doesn't trip `[ -f "*/bounty.json" ]`.
      expect(cmd).toContain('[ "$d" = "*" ] && continue');
      // (c) trailing exit 0 so a tail iteration's failed `[ -f ... ]` doesn't
      // bubble up as the shell's exit status.
      expect(cmd.trimEnd().endsWith("exit 0")).toBe(true);
    }
  });

  it("open command returns []; empty stdout parses to empty list (simulates missing/empty bounties dir on remote)", async () => {
    // Simulates the shell command's own behavior: with the guards in place, a
    // missing or empty bounties dir produces empty stdout AND exit 0, so
    // execCommand resolves with "" rather than throwing "Command exited with code 1".
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/")) return identityMd;
        if (cmd.includes("/bounties")) return "";
        return "";
      },
    );

    const conn = {} as SSHClientType;
    const result = await readIdentityBounties(conn, KEY);

    expect(result.bounties).toEqual([]);
    expect(result.archivedBounties).toEqual([]);
  });

  it("regression: pre-fix failure mode — shell threw `Command exited with code 1` for missing dir — no longer swallowed into modal error", async () => {
    // Before the fix, the reader would receive the throw and surface it. Now
    // the shell resolves cleanly with "" and the caller sees an empty list.
    // This test mirrors what the LOCAL branch already delivers via
    // fs.readdir ENOENT tolerance (identity-artifact-reader.ts:819-828).
    (execCommand as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd.includes(".claude/identities/")) return identityMd;
        // With the fix in place, the shell command exits 0 on missing/empty
        // dir and resolves with empty stdout — never throws to this level.
        return "";
      },
    );

    const conn = {} as SSHClientType;
    await expect(readIdentityBounties(conn, KEY)).resolves.toEqual({
      bounties: [],
      archivedBounties: [],
    });
  });
});
