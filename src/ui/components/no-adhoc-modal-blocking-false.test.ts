import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * `blocking={false}` retirement guard.
 *
 * The user's UAT rule (2026-09-30): every Modal MUST render a full
 * backdrop + focus trap. There is no escape hatch. The `blocking` prop
 * has been removed from the Modal component API, and this test fails
 * the ship-gate if any file re-introduces `blocking={false}` on a JSX
 * Modal element — the same shape guard as no-adhoc-modal-tabs and
 * no-personal-strings.
 *
 * Why a source grep and not just relying on TypeScript to reject the
 * unknown prop: the prop could theoretically leak in as an intersection
 * type widening, or as `{...spread}` from an untyped object, or a
 * consumer could add a custom modal wrapper. A source grep is stricter
 * than the type system on this exact anti-pattern.
 *
 * Historical retirement comments (prose that reads "blocking={false}
 * escape hatch retired") are allowlisted: they're documentation, not
 * live JSX. We only fail on the JSX form `blocking={false}` — an equals
 * sign, no space, curly braces, `false`.
 */

const ALLOWLIST_FILES = new Set([
  // This file (the guard itself contains the literal string).
  "src/ui/components/no-adhoc-modal-blocking-false.test.ts",
]);

function listGitTrackedTsxFiles(): string[] {
  try {
    const out = execSync(`git ls-files -z 'src/**/*.ts' 'src/**/*.tsx'`, {
      encoding: "utf8",
    });
    return out
      .split("\0")
      .filter((p) => p.length > 0)
      .map((p) => path.resolve(process.cwd(), p));
  } catch {
    return [];
  }
}

// The literal JSX form. Matches `blocking={false}` (exact bytes) — the
// only shape TypeScript would flag if the prop still existed. Prose that
// says "blocking={false} was retired" in a comment matches too, so we
// allowlist retirement-doc lines by scoping to the code region (skip
// lines that begin with `//`, `*`, or ` *` inside block comments).
const BLOCKING_FALSE_JSX = /blocking=\{false\}/;

function stripComments(src: string): string {
  // Remove // line comments and /* ... */ block comments — the grep
  // then only fires on live JSX. Cheap-and-cheerful; doesn't handle
  // strings with `//` inside, which is fine for this guard's purpose.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("no ad-hoc blocking={false} on Modal (retirement guard)", () => {
  it("finds files to scan", () => {
    expect(listGitTrackedTsxFiles().length).toBeGreaterThan(0);
  });

  it("no source file uses blocking={false} in live JSX", () => {
    const violations: string[] = [];
    for (const file of listGitTrackedTsxFiles()) {
      const rel = path.relative(process.cwd(), file);
      if (ALLOWLIST_FILES.has(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      const codeOnly = stripComments(src);
      if (BLOCKING_FALSE_JSX.test(codeOnly)) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        "`blocking={false}` on a Modal is retired (2026-09-30 UAT). " +
          "Every modal must render a full backdrop + focus trap. " +
          "Remove the prop from the Modal invocation in:\n" +
          violations.map((v, i) => `  ${i + 1}. ${v}`).join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });
});
