import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Old-look guard. The app's look is the kit (@/components/kit, palette --k-*
 * in kit/kit.css) plus the conversation view's conversation.css. The
 * pre-redesign "glass" look — backdrop blur, the navy glass gradient, the
 * legacy shared Button / Textarea / Input / Label / Tooltip — must not spread.
 *
 * Each allowlist names the screens that still carry the old look and haven't
 * been restyled yet (login, SSH dialogs, terminal chrome). The lists should
 * only ever shrink: restyle a screen, remove it here. Never add to them.
 */

const BLUR_ALLOWED = new Set([
  "src/ui/components/tooltip.tsx",
  "src/ui/features/keyboard/Toolbar.tsx",
  "src/ui/ssh/dialogs/HostKeyVerificationDialog.tsx",
  "src/ui/ssh/dialogs/OPKSSHDialog.tsx",
  "src/ui/ssh/dialogs/PassphraseDialog.tsx",
  "src/ui/ssh/dialogs/SSHAuthDialog.tsx",
  "src/ui/ssh/dialogs/TOTPDialog.tsx",
  "src/ui/ssh/dialogs/TmuxSessionPicker.tsx",
  "src/ui/ssh/dialogs/WarpgateDialog.tsx",
]);

const GLASS_COLOUR_ALLOWED = new Set([
  "src/ui/features/terminal/Terminal.tsx",
]);

const LEGACY_IMPORT_ALLOWED = new Set([
  "src/ui/auth/Auth.tsx",
  "src/ui/components/password-input.tsx",
  "src/ui/features/guacamole/GuacamoleApp.tsx",
  "src/ui/features/keyboard/Toolbar.tsx",
  "src/ui/features/pretty-view/ComposeBox.tsx",
  "src/ui/features/terminal/Terminal.tsx",
  "src/ui/ssh/connection-log/ConnectionLog.tsx",
  "src/ui/ssh/dialogs/HostKeyVerificationDialog.tsx",
  "src/ui/ssh/dialogs/OPKSSHDialog.tsx",
  "src/ui/ssh/dialogs/PassphraseDialog.tsx",
  "src/ui/ssh/dialogs/SSHAuthDialog.tsx",
  "src/ui/ssh/dialogs/TOTPDialog.tsx",
  "src/ui/ssh/dialogs/TmuxSessionPicker.tsx",
  "src/ui/ssh/dialogs/WarpgateDialog.tsx",
]);

const OLD_TABS_ALLOWED = new Set(["src/ui/ssh/dialogs/SSHAuthDialog.tsx"]);

const BLUR = /backdrop-blur|backdrop-filter|backdropFilter|WebkitBackdropFilter/;
const GLASS_COLOUR = /rgba\(\s*45\s*,\s*55\s*,\s*80/;
const LEGACY_IMPORT =
  /from\s+["']@\/components\/(button|textarea|input|label|password-input|tooltip)(\.tsx)?["']/;
const OLD_TABS = /\bTabs(List|Trigger)\b/;

function trackedSources(): string[] {
  const out = execSync(
    `git ls-files -z 'src/ui/**/*.ts' 'src/ui/**/*.tsx' 'src/ui/**/*.css'`,
    { encoding: "utf8" },
  );
  return out
    .split("\0")
    .filter((p) => p.length > 0 && !/\.test\.tsx?$/.test(p) && fs.existsSync(p));
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

// Imports are matched on the raw source (a "/*" inside a string can throw the
// comment stripper off); everything else on comment-stripped code.
const files = trackedSources().map((p) => {
  const raw = fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
  const code = stripComments(raw);
  const imports = raw.split("\n").filter((l) => /^\s*import\b|^\s*\}?\s*from\s/.test(l)).join("\n");
  return { rel: p, code, imports };
});

type Src = (typeof files)[number];
const inCode = (f: Src) => f.code;
const inImports = (f: Src) => f.imports;

function offenders(
  re: RegExp,
  allowed: Set<string>,
  where: (f: Src) => string = inCode,
  skip: (rel: string) => boolean = () => false,
) {
  return files.filter((f) => !allowed.has(f.rel) && !skip(f.rel) && re.test(where(f))).map((f) => f.rel);
}

describe("no old look in new code", () => {
  it("finds the sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no backdrop blur (solid surfaces and solid dims only)", () => {
    expect(offenders(BLUR, BLUR_ALLOWED)).toEqual([]);
  });

  it("no old navy glass gradient", () => {
    expect(offenders(GLASS_COLOUR, GLASS_COLOUR_ALLOWED)).toEqual([]);
  });

  it("no legacy Button / Textarea / Input / Label / Tooltip imports — use @/components/kit", () => {
    expect(offenders(LEGACY_IMPORT, LEGACY_IMPORT_ALLOWED, inImports)).toEqual([]);
  });

  it("no old glass tab strip (TabsList / TabsTrigger)", () => {
    expect(
      offenders(OLD_TABS, OLD_TABS_ALLOWED, inCode, (rel) => rel === "src/ui/components/tabs.tsx"),
    ).toEqual([]);
  });

  it("allowlists only name files that still need them (they must shrink)", () => {
    const stale = (re: RegExp, allowed: Set<string>, where: (f: Src) => string = inCode) =>
      [...allowed].filter((rel) => {
        const f = files.find((x) => x.rel === rel);
        return !f || !re.test(where(f));
      });
    expect(stale(BLUR, BLUR_ALLOWED)).toEqual([]);
    expect(stale(GLASS_COLOUR, GLASS_COLOUR_ALLOWED)).toEqual([]);
    expect(stale(LEGACY_IMPORT, LEGACY_IMPORT_ALLOWED, inImports)).toEqual([]);
    expect(stale(OLD_TABS, OLD_TABS_ALLOWED)).toEqual([]);
  });
});
