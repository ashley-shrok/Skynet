// ─── fleet-status feeder retirement grep gate (Phase 34 Plan 06, Task 4) ─────
//
// Structural assertions that the retired feeder symbols no longer appear in
// ANY non-test source file under src/ui/ and src/backend/.
//
// Uses fs.readFileSync + recursive directory traversal + string search to
// assert that:
//   - publishSessionTtyBusy: 0 non-test hits in src/ui/ + src/backend/
//   - publishSessionHasBackgroundedWork: 0 non-test hits in src/ui/ + src/backend/
//
// The test token-splits the strings to avoid self-matching in this file.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Recursive file finder
// ---------------------------------------------------------------------------

function walkFiles(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full, ext));
    } else if (ext.some((e) => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.includes("__tests__")
  );
}

// ---------------------------------------------------------------------------
// Search helper — returns all matching files with their match details
// ---------------------------------------------------------------------------

function findSourceFilesContaining(
  roots: string[],
  searchStr: string,
): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    const files = walkFiles(root, [".ts", ".tsx"]);
    for (const file of files) {
      if (isTestFile(file)) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes(searchStr)) {
        hits.push(file);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const srcUi = resolve(__dirname, "../../ui");
const srcBackend = resolve(__dirname, "../../backend");

describe("fleet-status feeder retirement: grep gate", () => {
  it("no non-test source file references the retired PTY-idle feeder symbol", () => {
    // Token-split to avoid self-matching in this test file
    const retired = "publish" + "SessionTtyBusy";
    const hits = findSourceFilesContaining([srcUi, srcBackend], retired);
    expect(hits).toHaveLength(0);
  });

  it("no non-test source file references the retired hasBgWork feeder symbol", () => {
    // Token-split to avoid self-matching in this test file
    const retired = "publish" + "SessionHas" + "BackgroundedWork";
    const hits = findSourceFilesContaining([srcUi, srcBackend], retired);
    expect(hits).toHaveLength(0);
  });
});
