/**
 * Phase 120 Plan 01 Task 2 — Unit tests for injectBaseTag.
 *
 * Verifies the pure Buffer transform that Wave 2's app-pane
 * responseInterceptor invokes on text/html responses to inject
 * `<base href="/apps/:hostId/:slug/pane/">` so absolute-path references
 * in the app resolve under the pane's mount prefix.
 *
 * Load-bearing invariants exercised:
 *  - Case-insensitive first-match `<head[^>]*>` replacement.
 *  - Prepend fallback when no `<head>` is present.
 *  - Only the FIRST `<head>` is replaced (regex is non-global).
 *  - slug is encodeURIComponent-encoded; hostId is NOT encoded.
 *  - UTF-8 round-trip preserves multibyte content.
 *  - Content-Type gating lives at the CALLER — not exercised here.
 *
 * Pattern reference: 120-RESEARCH.md § Pattern 3 + 120-PATTERNS.md § base-tag-injector.
 */

import { describe, it, expect } from "vitest";
import { injectBaseTag } from "../base-tag-injector.js";

describe("injectBaseTag", () => {
  it("injects <base> immediately after <head> in a well-formed document", async () => {
    const input = Buffer.from(
      `<html><head><title>X</title></head><body>Y</body></html>`,
      "utf8",
    );
    const output = await injectBaseTag(input, 5, "todo");
    const html = output.toString("utf8");
    expect(html).toContain(`<head><base href="/apps/5/todo/pane/"><title>X</title>`);
  });

  it("matches <HEAD> uppercase and injects after it (case-insensitive regex)", async () => {
    const input = Buffer.from(
      `<HTML><HEAD><TITLE>X</TITLE></HEAD><BODY>Y</BODY></HTML>`,
      "utf8",
    );
    const output = await injectBaseTag(input, 5, "todo");
    const html = output.toString("utf8");
    expect(html).toContain(`<HEAD><base href="/apps/5/todo/pane/">`);
  });

  it("matches <head lang=\"en\"> attributed head and injects after the full open tag", async () => {
    const input = Buffer.from(
      `<html><head lang="en"><title>X</title></head><body>Y</body></html>`,
      "utf8",
    );
    const output = await injectBaseTag(input, 5, "todo");
    const html = output.toString("utf8");
    expect(html).toContain(`<head lang="en"><base href="/apps/5/todo/pane/">`);
  });

  it("prepends <base> when no <head> tag is present (fallback path)", async () => {
    const input = Buffer.from(`<html><body>X</body></html>`, "utf8");
    const output = await injectBaseTag(input, 5, "todo");
    const html = output.toString("utf8");
    expect(html.startsWith(`<base href="/apps/5/todo/pane/">`)).toBe(true);
    expect(html).toBe(`<base href="/apps/5/todo/pane/"><html><body>X</body></html>`);
  });

  it("replaces ONLY the first <head> tag when the document is malformed with two", async () => {
    const input = Buffer.from(
      `<html><head><title>A</title></head><head><title>B</title></head><body>Y</body></html>`,
      "utf8",
    );
    const output = await injectBaseTag(input, 5, "todo");
    const html = output.toString("utf8");
    // First head has the base tag injected after it; second head is untouched.
    const firstHeadIdx = html.indexOf(`<head>`);
    const baseIdx = html.indexOf(`<base href="/apps/5/todo/pane/">`);
    const secondHeadIdx = html.indexOf(`<head>`, firstHeadIdx + 1);
    expect(firstHeadIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeGreaterThan(firstHeadIdx);
    expect(baseIdx).toBeLessThan(secondHeadIdx);
    // Only one base tag total.
    const matches = html.match(/<base href=/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("URL-encodes a slug with a space character", async () => {
    const input = Buffer.from(`<html><head></head><body></body></html>`, "utf8");
    const output = await injectBaseTag(input, 5, "my app");
    const html = output.toString("utf8");
    expect(html).toContain(`<base href="/apps/5/my%20app/pane/">`);
  });

  it("URL-encodes a slug containing a reserved '/' character", async () => {
    const input = Buffer.from(`<html><head></head><body></body></html>`, "utf8");
    const output = await injectBaseTag(input, 5, "a/b");
    const html = output.toString("utf8");
    expect(html).toContain(`<base href="/apps/5/a%2Fb/pane/">`);
  });

  it("does NOT URL-encode hostId (it is a number cast to string, slug is encoded)", async () => {
    const input = Buffer.from(`<html><head></head><body></body></html>`, "utf8");
    // hostId 42 is a plain integer; slug carries a space to confirm the split.
    const output = await injectBaseTag(input, 42, "my app");
    const html = output.toString("utf8");
    expect(html).toContain(`<base href="/apps/42/my%20app/pane/">`);
    // No percent-encoding around the hostId digits.
    expect(html).not.toContain(`/apps/%34%32/`);
  });

  it("round-trips input as UTF-8 (Buffer→string→Buffer preserves bytes for ASCII body)", async () => {
    const html = `<html><head></head><body>hello</body></html>`;
    const input = Buffer.from(html, "utf8");
    const output = await injectBaseTag(input, 5, "todo");
    const decoded = output.toString("utf8");
    expect(decoded).toContain(`<base href="/apps/5/todo/pane/">`);
    expect(decoded).toContain(`<body>hello</body>`);
  });

  it("preserves multibyte UTF-8 content in the body (日本語 round-trip)", async () => {
    const html = `<html><head></head><body>日本語</body></html>`;
    const input = Buffer.from(html, "utf8");
    const output = await injectBaseTag(input, 5, "todo");
    const decoded = output.toString("utf8");
    expect(decoded).toContain(`<body>日本語</body>`);
    expect(decoded).toContain(`<base href="/apps/5/todo/pane/">`);
  });

  it("returns a Buffer (not a string) whose UTF-8 decoding matches the injected HTML", async () => {
    const input = Buffer.from(
      `<html><head></head><body></body></html>`,
      "utf8",
    );
    const output = await injectBaseTag(input, 5, "todo");
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.toString("utf8")).toContain(`<base href="/apps/5/todo/pane/">`);
  });
});
