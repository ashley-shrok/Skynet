/**
 * Phase 128 Plan 03 Task 1 — tests for the pure `derivePreviewText` utility.
 *
 * Contract exercised (from 128-03-PLAN.md <behavior>):
 *   - m.text  → body verbatim (truncated at 100 chars)
 *   - m.image → "image 🖼️"  (or "image 🖼️ (filename)" when filename present)
 *   - m.audio → "audio 🎤"
 *   - m.video → "video 🎬"
 *   - m.file  → "file 📎"  (or "file 📎 (filename)" when filename present)
 *   - undefined msgtype → treated as m.text (returns body truncated at 100)
 *   - unknown msgtype (m.location etc.) → body fallback
 *   - unknown msgtype + no body → "(message)" — NEVER empty (Pitfall 3: iOS
 *     invalidates silent pushes)
 *
 * These tests are RED-phase: they define the contract before the module exists.
 * The GREEN commit adds src/backend/notifications/preview-text.ts.
 *
 * Why pure-function tests with no mocks:
 *   `derivePreviewText` has zero I/O and zero side effects. Every case is a
 *   direct input-output assertion. No vi.mock, no fixtures, no setup/teardown.
 */

import { describe, it, expect } from "vitest";

import { derivePreviewText } from "./preview-text.js";

describe("derivePreviewText", () => {
  // ─── m.text / undefined msgtype ─────────────────────────────────────────

  it("returns the body verbatim for m.text under 100 chars", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.text", body: "hi" },
    });
    expect(result).toBe("hi");
  });

  it("truncates m.text bodies at 100 chars", () => {
    const longBody = "x".repeat(200);
    const result = derivePreviewText({
      content: { msgtype: "m.text", body: longBody },
    });
    expect(result).toBe("x".repeat(100));
    expect(result.length).toBe(100);
  });

  it("treats undefined msgtype as m.text (returns body)", () => {
    const result = derivePreviewText({
      content: { msgtype: undefined, body: "hi" },
    });
    expect(result).toBe("hi");
  });

  // ─── m.image ────────────────────────────────────────────────────────────

  it("returns the plain image label when no filename is present", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.image" },
    });
    expect(result).toBe("image 🖼️");
  });

  it("appends the filename in parens when present for m.image", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.image", filename: "screenshot.png" },
    });
    expect(result).toBe("image 🖼️ (screenshot.png)");
  });

  // ─── m.audio ────────────────────────────────────────────────────────────

  it("returns the audio label for m.audio", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.audio" },
    });
    expect(result).toBe("audio 🎤");
  });

  // ─── m.video ────────────────────────────────────────────────────────────

  it("returns the video label for m.video", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.video" },
    });
    expect(result).toBe("video 🎬");
  });

  // ─── m.file ─────────────────────────────────────────────────────────────

  it("returns the plain file label when no filename is present", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.file" },
    });
    expect(result).toBe("file 📎");
  });

  it("appends the filename in parens when present for m.file", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.file", filename: "report.pdf" },
    });
    expect(result).toBe("file 📎 (report.pdf)");
  });

  // ─── Unknown msgtype fallback ───────────────────────────────────────────

  it("falls back to the body for unknown msgtype when a body is present", () => {
    const result = derivePreviewText({
      content: { msgtype: "m.location", body: "some fallback" },
    });
    expect(result).toBe("some fallback");
  });

  it('returns "(message)" for unknown msgtype with no body (Pitfall 3 — never empty)', () => {
    const result = derivePreviewText({
      content: { msgtype: "m.location" },
    });
    expect(result).toBe("(message)");
    expect(result.length).toBeGreaterThan(0);
  });

  // ─── Additional guardrails ──────────────────────────────────────────────

  it("returns non-empty EMPTY_FALLBACK for m.text with empty body (Pitfall 3 — never empty)", () => {
    // Empty m.text body is edge — Matrix allows it (rare, e.g. from edit
    // pipeline races). Module contract (Pitfall 3): NEVER return "" because
    // iOS's silent-revocation heuristic invalidates the subscription when
    // the visible notification body renders empty. The m.text branch must
    // fall through to the same EMPTY_FALLBACK sentinel the default branch
    // uses. Fix pass: post-review M-2.
    const result = derivePreviewText({
      content: { msgtype: "m.text", body: "" },
    });
    expect(result).toBe("(message)");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns non-empty EMPTY_FALLBACK for undefined msgtype with empty body (Pitfall 3 — never empty)", () => {
    // Same discipline for the undefined-msgtype branch (which shares the
    // m.text case-body). Fix pass: post-review M-2.
    const result = derivePreviewText({
      content: { msgtype: undefined, body: "" },
    });
    expect(result).toBe("(message)");
    expect(result.length).toBeGreaterThan(0);
  });
});
