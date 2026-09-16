/**
 * Phase 70 fix — tests for branding-template.ts (index.html templating).
 *
 * Covers the three cases that matter:
 *   1. The two SKYNET literals get substituted with the branding appName
 *   2. index.html that contains no SKYNET literals passes through unchanged
 *   3. Missing index.html returns empty string (never throws)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The bundled default appName is "SKYNET" — the same literal the template
// substitutes — so an unmocked loader would make substitution invisible.
// Mocking it to a distinct operator name is what proves the swap happened.
const OPERATOR_APP_NAME = "Acme Ops";

vi.mock("./branding-config-loader.js", () => ({
  loadBrandingConfig: vi.fn(async () => ({ appName: OPERATOR_APP_NAME })),
}));

import {
  getBrandedIndexHtml,
  __resetIndexCacheForTest,
} from "./branding-template.js";

describe("branding-template getBrandedIndexHtml", () => {
  const testDir = path.join(
    os.tmpdir(),
    `branding-template-test-${Date.now()}`,
  );

  beforeEach(() => {
    __resetIndexCacheForTest();
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("substitutes the two SKYNET literals with the branding appName", async () => {
    const raw = [
      "<!doctype html>",
      "<html><head>",
      '<meta name="apple-mobile-web-app-title" content="SKYNET" />',
      "<title>SKYNET</title>",
      "</head><body></body></html>",
    ].join("\n");
    fs.writeFileSync(path.join(testDir, "index.html"), raw);

    const out = await getBrandedIndexHtml(testDir);

    expect(out).not.toContain("<title>SKYNET</title>");
    expect(out).not.toContain('content="SKYNET"');
    expect(out).toContain(`<title>${OPERATOR_APP_NAME}</title>`);
    expect(out).toContain(`content="${OPERATOR_APP_NAME}"`);
  });

  it("passes through unchanged when there are no SKYNET literals to substitute", async () => {
    const raw =
      "<!doctype html><html><head><title>Something Else</title></head><body></body></html>";
    fs.writeFileSync(path.join(testDir, "index.html"), raw);

    const out = await getBrandedIndexHtml(testDir);

    expect(out).toBe(raw);
  });

  it("returns empty string when index.html is missing (never throws)", async () => {
    const out = await getBrandedIndexHtml(testDir);
    expect(out).toBe("");
  });
});
