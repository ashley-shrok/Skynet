/**
 * Phase 22 SRIC-06 / Plan 22-06 Task 3 — RoleFileTab component tests.
 *
 * Byte-shape mirror of IdentityFileTab test coverage (which doesn't have
 * a dedicated file; behaviors are asserted at IdentityModal integration
 * level). This file covers the RoleFileTab's four render states so a future
 * refactor of the shared TabState<string> shape catches the role tab too.
 *
 * Tests (17-20 per plan Task 3 <behavior>):
 *   17. loading → Skeleton placeholders
 *   18. ready without onSave → read-only markdown preview
 *   19. ready with onSave → toolbar, Edit → textarea, Save calls onSave with draft
 *   20. error → renders error message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleFileTab } from "./RoleFileTab";

describe("RoleFileTab — Phase 22 SRIC-06 render states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 17: loading state renders Skeleton placeholders (no textarea, no markdown)", () => {
    render(<RoleFileTab state={{ status: "loading" }} />);
    // Read-mode markdown preview is absent, textarea is absent.
    expect(screen.queryByRole("textbox")).toBeNull();
    // Skeleton uses generic div with rounded class — safest assertion is
    // "no error text present" + "no ready-mode text present".
    expect(screen.queryByText(/Couldn't load role file/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("test 18: ready without onSave renders markdown preview in read-only mode (no toolbar, no textarea)", () => {
    const md = "# Box Maintainer\n\n## Role\n\nKeeps boxes running.";
    render(<RoleFileTab state={{ status: "ready", data: md }} />);
    // Markdown rendered: heading + paragraph text appear in the DOM.
    expect(screen.getByText("Box Maintainer")).toBeTruthy();
    expect(screen.getByText(/Keeps boxes running/)).toBeTruthy();
    // No Edit button (onSave is not threaded)
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    // No textarea (not in edit mode)
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test 19: ready with onSave → Edit toolbar → typing → Save calls onSave with draft; success flips back to read mode", async () => {
    const md = "# Original Body\n";
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleFileTab state={{ status: "ready", data: md }} onSave={onSave} />);

    // Toolbar Edit button visible in ready+onSave mode
    const editBtn = screen.getByRole("button", { name: /edit/i });
    fireEvent.click(editBtn);

    // Textarea now visible, pre-filled with draft = state.data
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe(md);

    // Type a new value into the textarea
    const newBody = "# Edited Body\n";
    fireEvent.change(textarea, { target: { value: newBody } });
    expect(textarea.value).toBe(newBody);

    // Save button becomes enabled (draft !== state.data)
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    // onSave invoked with the draft string
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(newBody);
    });

    // After successful save, edit mode collapses back → textarea gone
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  it("test 20: error state renders 'Couldn't load role file: <error>' message (no textarea, no markdown)", () => {
    render(
      <RoleFileTab
        state={{ status: "error", error: "identity tina has no role: frontmatter in identity file" }}
      />,
    );

    // Error message present. The mirror of IdentityFileTab uses ' (apostrophe entity)
    // in the copy; RTL renders the entity as a normal ' character in the DOM.
    expect(
      screen.getByText(/Couldn't load role file/i),
    ).toBeTruthy();
    expect(screen.getByText(/no role: frontmatter/i)).toBeTruthy();

    // No textarea, no Edit button, no markdown body
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});
