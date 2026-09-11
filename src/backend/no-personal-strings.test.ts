import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Personal-strings enforcement.
 *
 * Guards against personal / deployment-specific identifiers landing in
 * this public repo (contributor names, personal domains, specific
 * hostnames, account IDs). The banned list lives OUTSIDE the repo so
 * this test's own source never contains a banned string — which would
 * paradoxically defeat the check.
 *
 * Discovery order for the banned-strings file:
 *   1. SKYNET_BANNED_STRINGS_FILE env var (explicit override)
 *   2. ~/fleet/roles/box-maintainer/banned-strings.txt (fleet default)
 *   3. ~/.skynet-banned-strings (fallback for forkers)
 *
 * File format is documented at the top of the file itself. Missing
 * file = test fails with a clear message (each maintainer creates
 * theirs; an empty file is valid and skips enforcement).
 *
 * Case-insensitive matching. On a hit, the failure message reports
 * only the banned-list index and char-count, never the string itself,
 * so failure logs stay clean.
 */

interface BannedList {
  banned: string[];
  allowlist: string[];
  sourcePath: string;
}

function resolveBannedStringsPath(): string | null {
  const envOverride = process.env.SKYNET_BANNED_STRINGS_FILE;
  if (envOverride && fs.existsSync(envOverride)) return envOverride;
  const home = process.env.HOME ?? "/root";
  const candidates = [
    path.join(home, "fleet", "roles", "box-maintainer", "banned-strings.txt"),
    path.join(home, ".skynet-banned-strings"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function loadBannedList(): BannedList | null {
  const p = resolveBannedStringsPath();
  if (p === null) return null;
  const raw = fs.readFileSync(p, "utf8");
  const banned: string[] = [];
  const allowlist: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    if (t.startsWith("!")) allowlist.push(t.slice(1).trim());
    else banned.push(t);
  }
  return { banned, allowlist, sourcePath: p };
}

function repoRoot(): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();
}

function gitTrackedFiles(root: string): string[] {
  return execSync("git ls-files", { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

function isBinary(bytes: Buffer): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

describe("no personal strings in repo", () => {
  it("banned-strings list is readable", () => {
    const list = loadBannedList();
    if (list === null) {
      const home = process.env.HOME ?? "/root";
      throw new Error(
        `Banned-strings list not found. Set SKYNET_BANNED_STRINGS_FILE or ` +
          `create ${home}/fleet/roles/box-maintainer/banned-strings.txt or ` +
          `${home}/.skynet-banned-strings. An empty file is valid ` +
          `(skips enforcement).`,
      );
    }
    expect(list.sourcePath).toBeTruthy();
  });

  it("no banned strings appear in git-tracked files", () => {
    const list = loadBannedList();
    if (list === null || list.banned.length === 0) return;

    const root = repoRoot();
    const files = gitTrackedFiles(root);
    // Skip this test file (self-reference protection — even though its
    // source shouldn't contain any banned string, belt-and-suspenders).
    const selfRel = "src/backend/no-personal-strings.test.ts";
    const scanFiles = files.filter((f) => f !== selfRel);

    // Also skip the resolved banned-strings file itself if it happens
    // to live inside the repo (should not, but future-proof).
    const bannedRel = path.relative(root, list.sourcePath);
    const finalFiles = scanFiles.filter((f) => f !== bannedRel);

    interface Violation {
      index: number;
      charCount: number;
      files: Set<string>;
    }
    const violations = new Map<number, Violation>();

    const loweredBanned = list.banned.map((b) => b.toLowerCase());
    const loweredAllowlist = list.allowlist.map((a) => a.toLowerCase());

    for (const rel of finalFiles) {
      const abs = path.join(root, rel);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(abs);
      } catch {
        continue;
      }
      if (isBinary(bytes)) continue;
      const content = bytes.toString("utf8");
      const loweredContent = content.toLowerCase();

      for (let i = 0; i < loweredBanned.length; i++) {
        const needle = loweredBanned[i];
        if (!loweredContent.includes(needle)) continue;

        // Line-by-line pass to apply allowlist exemption
        const lines = content.split("\n");
        let hasUnallowedHit = false;
        for (const line of lines) {
          const loweredLine = line.toLowerCase();
          if (!loweredLine.includes(needle)) continue;
          const exempted = loweredAllowlist.some((a) =>
            loweredLine.includes(a),
          );
          if (!exempted) {
            hasUnallowedHit = true;
            break;
          }
        }

        if (hasUnallowedHit) {
          const v = violations.get(i) ?? {
            index: i,
            charCount: list.banned[i].length,
            files: new Set<string>(),
          };
          v.files.add(rel);
          violations.set(i, v);
        }
      }
    }

    if (violations.size === 0) return;

    const messages = Array.from(violations.values())
      .sort((a, b) => a.index - b.index)
      .map((v) => {
        const sampleFiles = Array.from(v.files).slice(0, 5).join(", ");
        const more = v.files.size > 5 ? `, +${v.files.size - 5} more` : "";
        return `  banned #${v.index + 1} (${v.charCount} chars) in ${v.files.size} file(s): ${sampleFiles}${more}`;
      });

    throw new Error(
      `Personal-strings check found violations. Cross-reference the ` +
        `banned-list indexes below against ${list.sourcePath}:\n${messages.join("\n")}`,
    );
  });
});
