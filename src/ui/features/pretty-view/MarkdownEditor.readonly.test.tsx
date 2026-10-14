/**
 * MarkdownEditor — view-only (file pane) Markdown stays formatted.
 *
 * Regression: a locked formatted editor renders contenteditable="false"; the
 * "formatted editor silently rendered nothing" check used to look only for
 * contenteditable="true", so every view-only .md fell back to plain source.
 * Uses the real formatted editor (no mock) — the mock would hide the bug.
 */

import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor — readOnly", () => {
  it("renders formatted, locked, with no editing toolbar", async () => {
    const { container } = render(
      <MarkdownEditor
        filename="notes.md"
        content={"# Plan\n\nShip the **file pane**.\n"}
        onChange={() => {}}
        disabled
        readOnly
      />,
    );
    await waitFor(() => expect(container.querySelector(".mdx-prose")).not.toBeNull(), { timeout: 5000 });
    // Past the 200ms silent-failure check — still formatted, never the source editor.
    await new Promise((r) => setTimeout(r, 400));
    expect(container.querySelector(".mdx-prose")).not.toBeNull();
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });
});
