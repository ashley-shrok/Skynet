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

  // ── Phase 40 Plan 40-03 (rev-2): optional onDraftChange callback ─────────
  // Backward-compat + firing correctness for the new optional prop consumed
  // by EditableFileModal's draft-guard confirm gate. Existing callers
  // (GlobalFilesModal) omit the prop → hook is a no-op.

  it("test 6 (Plan 40-03): backward-compat — no onDraftChange passed → existing behavior, no throw", () => {
    // Regression gate: GlobalFilesModal never passes onDraftChange. If the
    // hook throws or misbehaves when the prop is undefined, every Global
    // Files modal user is affected.
    const onSave = vi.fn();
    render(
      <GlobalFileTab
        state={{ status: "ready", data: { content: "hi", mtime: 1 } }}
        onSave={onSave}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("hi");
    // Typing should not throw — existing tests already verify the wiring;
    // this test asserts prop-omitted no-op semantics.
    fireEvent.change(ta, { target: { value: "hi world" } });
    expect(ta.value).toBe("hi world");
    // No throw, no console error — existing save-flow untouched.
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 7 (Plan 40-03): onDraftChange fires false→true→false as draft diverges/converges", () => {
    const onDraftChange = vi.fn<(dirty: boolean) => void>();
    render(
      <GlobalFileTab
        state={{ status: "ready", data: { content: "hi", mtime: 1 } }}
        onSave={vi.fn()}
        onDraftChange={onDraftChange}
      />,
    );
    // Mount-time: draft = "" briefly (from useState), then the mtime effect
    // seeds it to "hi" → the onDraftChange effect fires with false (matches).
    // We wait for at least one call to have been made ending in false.
    expect(onDraftChange).toHaveBeenCalled();
    // The most recent call after seeding should be false (clean).
    const lastCallInitial = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1];
    expect(lastCallInitial[0]).toBe(false);

    onDraftChange.mockClear();

    // Diverge → dirty=true
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi world" } });
    expect(onDraftChange).toHaveBeenCalledWith(true);

    onDraftChange.mockClear();

    // Converge back → dirty=false
    fireEvent.change(ta, { target: { value: "hi" } });
    expect(onDraftChange).toHaveBeenCalledWith(false);
  });
});
