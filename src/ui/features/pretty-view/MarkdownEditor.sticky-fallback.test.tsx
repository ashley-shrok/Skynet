/**
 * Regression: when MdxEditor can't render markdown (silent-empty OR a
 * thrown parse exception), the fallback to the code editor is STICKY for
 * the rest of the filename's lifetime in the UI. Content changes from
 * typing MUST NOT flip the branch back to MdxEditor.
 *
 * Field repro (2026-10-03): skills modal → open a skill → initial
 * swap to code editor fires → user clicks at the end of a frontmatter line,
 * hits Enter, types a letter → whole app went blank. Three bugs chained:
 *   1. The previous content-keyed check (failedContent === content) broke
 *      the instant the user typed — the equality snapped, the branch
 *      flipped back to MdxEditor, which either re-silent-failed (focus
 *      lost every keystroke) or re-threw (uncaught crash).
 *   2. MdxEditor's useMemo-based parse pipeline calls js-yaml, which THROWS
 *      a YAMLException on malformed frontmatter — this isn't an MDXEditor
 *      onError signal, it's a thrown exception during React render.
 *   3. No error boundary wrapped the MdxEditor branch, so the throw
 *      unmounted the whole app tree (the "solid-color blank tab" symptom).
 *
 * This test uses the exact malformed-frontmatter shape from the console-
 * forward log of the field repro, which deterministically throws through
 * js-yaml in both jsdom and real browsers.
 */

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";

// Exact shape of the frontmatter that threw in the field repro: a bare
// token ("a") sitting on its own line inside the frontmatter block.
// js-yaml raises `YAMLException: can not read a block mapping entry; a
// multiline key may not be an implicit key` from inside MDXEditor's import
// pipeline (useMemo → render-time throw).
const BROKEN_FRONTMATTER = `---
name: pndthp
description: "Helps streamline things."
a
---

# Pndthp
`;

describe("MarkdownEditor — sticky code-editor fallback", () => {
  it("falls back when MdxEditor throws on malformed frontmatter (no app unmount)", async () => {
    // Silence the error-boundary's console.error so the test output is clean.
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(
        <MarkdownEditor
          filename="SKILL.md"
          content={BROKEN_FRONTMATTER}
          onChange={() => {}}
        />,
      );

      // Something visible must render. Pre-fix, the YAMLException unmounted
      // the whole tree — nothing would be here. Post-fix, the error boundary
      // catches and renders the CodeEditor fallback (or the deeper RawTextarea
      // defense if the CodeMirror bundle itself failed to load).
      await waitFor(
        () => {
          const cm = container.querySelector(".cm-content");
          const ta = container.querySelector("textarea");
          expect(cm || ta).toBeTruthy();
        },
        { timeout: 3000 },
      );

      // The user needs to be able to see + fix the broken frontmatter.
      const cm = container.querySelector(".cm-content");
      const ta = container.querySelector<HTMLTextAreaElement>("textarea");
      const visibleText = cm?.textContent ?? ta?.value ?? "";
      expect(visibleText).toContain("pndthp");
    } finally {
      consoleErrSpy.mockRestore();
    }
  });

  it("stays in fallback after content changes (no flip-back to MdxEditor)", async () => {
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container, rerender } = render(
        <MarkdownEditor
          filename="SKILL.md"
          content={BROKEN_FRONTMATTER}
          onChange={() => {}}
        />,
      );

      // Wait for the initial fallback.
      await waitFor(
        () => {
          const cm = container.querySelector(".cm-content");
          const ta = container.querySelector("textarea");
          expect(cm || ta).toBeTruthy();
        },
        { timeout: 3000 },
      );

      // Simulate a keystroke: parent re-renders with new content (same
      // filename). Pre-fix, this flipped the branch back to MdxEditor and
      // either lost the user's focus (silent-failure path) or crashed the
      // whole tree (throw path).
      rerender(
        <MarkdownEditor
          filename="SKILL.md"
          content={BROKEN_FRONTMATTER + "x"}
          onChange={() => {}}
        />,
      );

      // The MdxEditor's Lexical contenteditable (`.mdx-prose`) MUST NOT be
      // mounted. If it reappeared, the sticky guard regressed.
      const mdxEditable = container.querySelector(
        '.mdx-prose[contenteditable="true"]',
      );
      expect(mdxEditable).toBeFalsy();

      // And the fallback is still rendering (either branch is fine — the
      // invariant is "something editable is here showing the content").
      const cm = container.querySelector(".cm-content");
      const ta = container.querySelector("textarea");
      expect(cm || ta).toBeTruthy();
    } finally {
      consoleErrSpy.mockRestore();
    }
  });
});
