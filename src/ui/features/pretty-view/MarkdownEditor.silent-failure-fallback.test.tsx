/**
 * Regression: MDXEditor's Lexical parser silently renders an empty
 * contenteditable when the input contains constructs it can't map
 * (bare `<role>` placeholders, HTML comments, etc. — see MarkdownEditor
 * docblock for the full list). MdxEditorImpl fires onSilentParseFailure
 * and MarkdownEditor swaps to CodeEditorImpl with the markdown language
 * pack — a real syntax-highlighted source editor, not a plain textarea.
 * This test proves the swap happens for the exact content the user hit
 * during modal-look UAT.
 *
 * CodeMirror renders its contenteditable with role="textbox" and
 * class="cm-content". We assert on the cm-content element to verify the
 * code-editor branch is taking over, not the (defense-in-depth)
 * RawTextarea deeper fallback that only triggers if CodeMirror itself
 * fails to bundle.
 */

import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";

const EXPLAIN_SKILL_CONTENT = `---
name: explain
description: >-
  Describe X to the user without using code symbols.
---

# Explain

Argument: \`/explain <thing>\` sets X to <thing>; bare \`/explain\` sets X.
`;

describe("MarkdownEditor — silent-parse-failure code-editor fallback", () => {
  it("swaps to CodeEditorImpl when MDXEditor renders empty despite non-empty content", async () => {
    const { container } = render(
      <MarkdownEditor
        filename="SKILL.md"
        content={EXPLAIN_SKILL_CONTENT}
        onChange={() => {}}
      />,
    );

    // Wait for one of three outcomes:
    //   (a) MDXEditor successfully rendered the content (future upgrade fixes
    //       the underlying parse bug) — editable has content.
    //   (b) MDXEditor silent-failed → CodeEditorImpl mounted — cm-content
    //       element appears with the content.
    //   (c) CodeEditorImpl itself failed to bundle (offline) → defense-in-
    //       depth RawTextarea appears.
    // Any of these means the user can see and edit their file.
    await waitFor(() => {
      const cmContent = container.querySelector(".cm-content");
      const textarea = container.querySelector("textarea");
      const editable = container.querySelector('[contenteditable="true"]');
      const editableFilled =
        editable && (editable.textContent ?? "").length > 0;
      expect(cmContent || textarea || editableFilled).toBeTruthy();
    }, { timeout: 10000 });

    const cmContent = container.querySelector(".cm-content");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");

    if (cmContent) {
      // The expected path — CodeEditorImpl rendering the markdown source.
      // CodeMirror's internal structure may chunk the content across lines,
      // so verify the known tokens are present rather than full-content eq.
      expect(cmContent.textContent).toContain("Explain");
      expect(cmContent.textContent).toContain("<thing>");
    } else if (textarea) {
      // Defense-in-depth path — RawTextarea when CodeMirror bundle fails.
      expect(textarea.value).toBe(EXPLAIN_SKILL_CONTENT);
    } else {
      // MDXEditor itself rendered — future-upgrade path. Must be the WHOLE
      // file: a partial render cut off at the bare `<thing>` is the bug.
      const editable = container.querySelector('[contenteditable="true"]');
      expect(editable?.textContent).toContain("Explain");
      expect(editable?.textContent).toContain("bare");
    }
  });

  // Field repro (2026-10-10): the explain skill opened in the skills modal
  // showed a PARTIAL formatted render cut off at "sets X to " (the bare
  // `<thing>` after it) — MDXEditor's onError fired during mount, but a
  // [filename]-keyed reset effect in the parent ran right after and wiped
  // the fallback flag. Only switching Plain → Formatted made it stick. The
  // first open must land on the full source, with the "can't show" note.
  it("first open of a partially-parsing file lands on the full source, not a truncated formatted render", async () => {
    const PARTIAL_PARSE_CONTENT = `---
name: explain
description: >-
  Describe X to the user without using code symbols.
---

# Explain

Argument: \`/explain <thing>\` sets X to <thing>; bare \`/explain\` sets X.

Not a metaphor — explain the actual thing.
`;
    const { container, getByTestId } = render(
      <MarkdownEditor filename="SKILL.md" content={PARTIAL_PARSE_CONTENT} onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-content") || container.querySelector("textarea")).toBeTruthy();
    }, { timeout: 10000 });

    const visible =
      container.querySelector(".cm-content")?.textContent ??
      container.querySelector<HTMLTextAreaElement>("textarea")?.value ??
      "";
    expect(visible).toContain("Not a metaphor");
    expect(container.querySelector(".mdxeditor")).toBeNull();
    expect(getByTestId("markdown-formatted-unavailable")).toBeTruthy();
  }, 15000);

  // A filename change must re-attempt the formatted editor: a.md failed,
  // the user fixed it in plain text, moved to b.md and back — a.md should
  // now open formatted, not stay stuck on the earlier fallback.
  it("re-attempts formatted after a filename round-trip once the file is fixed", async () => {
    const BROKEN = "# A\n\nsets X to <thing>; more text after.\n";
    const FIXED = "# A\n\nsets X to a thing; more text after.\n";
    const { container, rerender, queryByTestId } = render(
      <MarkdownEditor filename="a.md" content={BROKEN} onChange={() => {}} />,
    );
    await waitFor(() => expect(queryByTestId("markdown-formatted-unavailable")).toBeTruthy(), { timeout: 10000 });

    rerender(<MarkdownEditor filename="b.md" content={"# B\n"} onChange={() => {}} />);
    rerender(<MarkdownEditor filename="a.md" content={FIXED} onChange={() => {}} />);

    await waitFor(() => {
      expect(container.querySelector('.mdxeditor [contenteditable="true"]')?.textContent).toContain("more text after");
    }, { timeout: 10000 });
    expect(queryByTestId("markdown-formatted-unavailable")).toBeNull();
  }, 25000);
});
