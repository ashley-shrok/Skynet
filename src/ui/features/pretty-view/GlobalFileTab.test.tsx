/**
 * GlobalFileTab component tests — covers the render branches, with focus on
 * the 2026-08-05 change that dropped the empty-branch early-return so a
 * truly-empty file (content="" && mtime===0) renders the editable textarea
 * and the user can type + save to CREATE the file.
 *
 * Tests:
 *   1. loading state renders Skeleton (no textarea)
 *   2. error state renders error message (no textarea)
 *   3. ready with non-empty content renders textarea seeded with the content
 *   4. ready with empty content + mtime=0 renders EDITABLE textarea (regression
 *      gate for the dropped early-return) — save disabled until user types,
 *      typing enables save, click fires onSave with the draft + mtime=0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GlobalFileTab from "./GlobalFileTab";

describe("GlobalFileTab — render branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 1: loading → Skeleton, no textarea, no error", () => {
    render(<GlobalFileTab state={{ status: "loading" }} onSave={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Couldn't load file/i)).toBeNull();
  });

  it("test 2: error → renders error message, no textarea", () => {
    render(
      <GlobalFileTab
        state={{ status: "error", error: "sftp read failed" }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/Couldn't load file/i)).toBeTruthy();
    expect(screen.getByText(/sftp read failed/i)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test 3: ready with non-empty content → textarea seeded with content, save disabled until edit", () => {
    render(
      <GlobalFileTab
        state={{ status: "ready", data: { content: "hello", mtime: 42 } }}
        onSave={vi.fn()}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(ta, { target: { value: "hello world" } });
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 4: ready with empty content + mtime=0 → EDITABLE textarea; type + save creates the file (regression gate for dropped early-return)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GlobalFileTab
        state={{ status: "ready", data: { content: "", mtime: 0 } }}
        onSave={onSave}
      />,
    );

    // Textarea is present and empty (NOT the "No content in this file yet." dead-end).
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("");

    // Save button starts disabled (draft === state.data.content, both "").
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // User types something — save enables.
    fireEvent.change(ta, { target: { value: "new content" } });
    expect(ta.value).toBe("new content");
    expect(saveBtn.disabled).toBe(false);

    // Click save — onSave fires with the draft + mtime=0 (write handler uses
    // mtime=0 as the "create the file" signal via SFTP tmp+rename).
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("new content", 0);
    });
  });

  it("test 5: 'No content in this file yet.' dead-end copy is GONE (regression gate)", () => {
    render(
      <GlobalFileTab
        state={{ status: "ready", data: { content: "", mtime: 0 } }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText(/no content in this file yet/i)).toBeNull();
  });
});
