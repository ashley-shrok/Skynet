import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Modal-tabs canonicalization enforcement.
 *
 * The user's stated meta-goal (2026-09-30 UAT): if she asks a future
 * agent to add a modal with tabs, it should reuse the canonical
 * `<ModalTabs>` component in src/ui/components/modal.tsx without her
 * having to police the diff. This test converts hope into
 * ship-gate-blocking enforcement.
 *
 * We scan every git-tracked *Modal*.tsx file under src/ui/features/ for
 * two ad-hoc-tab signatures:
 *
 *   1. The old bordered-pill class chord — a specific combination of
 *      utility classes that any hand-rolled tab-strip in this codebase
 *      historically uses. If a file trips both markers in the same
 *      element, it's reinventing tabs.
 *
 *   2. A plain <button> with `aria-pressed=` inside a modal that ALSO
 *      does NOT import `ModalTabs`. This catches the case where an
 *      agent styled their tabs differently but still built the row by
 *      hand.
 *
 * The one legitimate carve-out: files that import `ModalTabs` from
 * @/components/modal are trusted — they've adopted the canonical
 * component, whatever else they do around it is their business.
 *
 * On failure the message names the file and points at the fix
 * (`ModalTabs`), so the corrective action is obvious.
 */

const FEATURES_ROOT = path.join(__dirname, "..", "features");

function listGitTrackedModalFiles(): string[] {
  try {
    const out = execSync(
      `git ls-files -z '${FEATURES_ROOT}/**/*Modal*.tsx'`,
      { encoding: "utf8" },
    );
    return out
      .split("\0")
      .filter((p) => p.length > 0 && !p.endsWith(".test.tsx"))
      .map((p) => path.resolve(process.cwd(), p));
  } catch {
    return [];
  }
}

const PILL_TAB_SIGNATURE =
  /rounded-md[^"]*text-\[12(?:\.5)?px\][^"]*cursor-pointer[\s\S]{0,400}aria-pressed/;

const NAKED_TABS_SIGNATURE =
  /<button[^>]*aria-pressed=/;

describe("no ad-hoc modal tabs (canonicalization guard)", () => {
  const modalFiles = listGitTrackedModalFiles();

  it("finds *Modal*.tsx files to scan", () => {
    expect(modalFiles.length).toBeGreaterThan(0);
  });

  it("every modal with tab-like buttons uses <ModalTabs>", () => {
    const violations: Array<{ file: string; reason: string }> = [];
    for (const file of modalFiles) {
      const src = fs.readFileSync(file, "utf8");
      const importsModalTabs = /import\s+\{[^}]*\bModalTabs\b[^}]*\}\s+from\s+["']@\/components\/modal["']/
        .test(src);
      if (importsModalTabs) continue;

      if (PILL_TAB_SIGNATURE.test(src)) {
        violations.push({
          file: path.relative(process.cwd(), file),
          reason:
            "matches the old bordered-pill tab signature (rounded-md + " +
            "text-[12/12.5px] + cursor-pointer + aria-pressed)",
        });
        continue;
      }
      if (NAKED_TABS_SIGNATURE.test(src)) {
        violations.push({
          file: path.relative(process.cwd(), file),
          reason:
            "has a <button aria-pressed=...> tab-like element but does " +
            "not import ModalTabs",
        });
      }
    }

    if (violations.length > 0) {
      const lines = violations.map(
        (v, i) => `  ${i + 1}. ${v.file}\n     ${v.reason}`,
      );
      throw new Error(
        "Ad-hoc modal tabs detected. Use `<ModalTabs>` from " +
          "@/components/modal instead of hand-rolling tab-row styles. " +
          "Files:\n" +
          lines.join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });
});
