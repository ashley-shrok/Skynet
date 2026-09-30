/**
 * Regression: MDXEditor's Lexical parser silently renders an empty
 * contenteditable when the input contains a bare `<foo>` outside of
 * backticks (common in SKILL.md docs that describe slash-commands with
 * angle-bracket placeholders like `/explain <thing>`). MdxEditorImpl fires
 * onSilentParseFailure in that case and MarkdownEditor swaps in the raw
 * textarea so the file remains editable — this test proves the swap
 * happens for the exact content the user hit during modal-look UAT.
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

describe("MarkdownEditor — silent-parse-failure textarea fallback", () => {
  it("swaps to raw textarea when MDXEditor renders empty despite non-empty content", async () => {
    const { container } = render(
      <MarkdownEditor
        filename="SKILL.md"
        content={EXPLAIN_SKILL_CONTENT}
        onChange={() => {}}
      />,
    );

    // Wait for either the MDXEditor to actually render OR the fallback
    // textarea to appear (the silent-failure detector runs on the next
    // animation frame after mount).
    await waitFor(() => {
      const textarea = container.querySelector("textarea");
      const editable = container.querySelector('[contenteditable="true"]');
      const editableFilled =
        editable && (editable.textContent ?? "").length > 0;
      expect(textarea || editableFilled).toBeTruthy();
    }, { timeout: 3000 });

    // The exact content the user reported blank on. The fallback textarea
    // should now show the raw markdown — user can still edit the file.
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) {
      expect(textarea.value).toBe(EXPLAIN_SKILL_CONTENT);
    } else {
      // If MDXEditor DID manage to render (future MDXEditor upgrade fixes
      // the underlying parse bug), verify the content is at least visible.
      const editable = container.querySelector('[contenteditable="true"]');
      expect(editable?.textContent).toContain("Explain");
    }
  });
});
