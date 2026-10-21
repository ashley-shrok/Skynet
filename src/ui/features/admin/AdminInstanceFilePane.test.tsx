/**
 * Admin → Instance file as an admin drives it (apple-ux shape-admin-modals):
 *   - shown formatted for reading under the section header, Edit at the foot
 *   - nothing written: "Nothing written yet" with Write it
 *   - Edit → Cancel / Save; Save greyed until something changed; saving goes
 *     back to reading with "Saved — sending it to every host."
 *   - Cancel with unsaved edits asks first; "keep editing" stays
 *   - the window's leave guard asks too; Esc while editing leaves the editor
 *   - the window grows only while editing
 *   - a failed save shows the backend's reason; a failed load an error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import { AdminInstanceFilePane } from "./AdminInstanceFilePane";
import type { AdminLeaveGuard } from "./AdminModal";

const m = vi.hoisted(() => ({
  getInstanceFile: vi.fn(),
  saveInstanceFile: vi.fn(),
}));

vi.mock("@/api/instance-file-api", () => ({
  getInstanceFile: m.getInstanceFile,
  saveInstanceFile: m.saveInstanceFile,
}));

vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: (props: { content: string; onChange: (v: string) => void; disabled?: boolean }) => (
    <textarea
      value={props.content}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

beforeEach(() => {
  m.getInstanceFile.mockReset();
  m.saveInstanceFile.mockReset();
});

afterEach(() => __resetKitDialogsForTests());

function renderPane() {
  const guard: { current: AdminLeaveGuard | null } = { current: null };
  const onEditingChange = vi.fn();
  render(
    <AdminInstanceFilePane
      hero={<h2>Instance file</h2>}
      registerLeaveGuard={(g) => (guard.current = g)}
      onEditingChange={onEditingChange}
    />,
  );
  return { guard, onEditingChange };
}

describe("AdminInstanceFilePane", () => {
  it("shows the file formatted for reading, under the header, with Edit", async () => {
    m.getInstanceFile.mockResolvedValue({ content: "# Team rules\n\nBe kind.", updatedAt: 1 });
    renderPane();
    const text = await screen.findByTestId("admin-instance-file-text");
    expect(text.querySelector("h1")?.textContent).toBe("Team rules");
    expect(screen.getByText("Instance file")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("admin-instance-file-edit")).toBeTruthy();
    expect(screen.queryByTestId("admin-instance-file-save")).toBeNull();
  });

  it("nothing written yet offers Write it, which opens the editor", async () => {
    m.getInstanceFile.mockResolvedValue({ content: "  ", updatedAt: null });
    renderPane();
    expect(await screen.findByTestId("admin-instance-file-empty")).toBeTruthy();
    expect(screen.queryByTestId("admin-instance-file-edit")).toBeNull();
    await userEvent.click(screen.getByTestId("admin-instance-file-write"));
    expect(await screen.findByRole("textbox")).toBeTruthy();
  });

  it("Edit → change → Save sends the draft and goes back to reading, saying so", async () => {
    const user = userEvent.setup();
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    m.saveInstanceFile.mockResolvedValue({ content: "ab", updatedAt: 2 });
    const { onEditingChange } = renderPane();
    await user.click(await screen.findByTestId("admin-instance-file-edit"));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    const box = await screen.findByRole("textbox");
    const save = screen.getByTestId("admin-instance-file-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(box, "b");
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(m.saveInstanceFile).toHaveBeenCalledWith("ab");
    expect((await screen.findByTestId("admin-instance-file-saved")).textContent).toBe("Saved — sending it to every host.");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("admin-instance-file-text").textContent).toBe("ab");
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("Cancel with unsaved edits asks first; keep editing stays, discard goes back", async () => {
    const user = userEvent.setup();
    const answers = [false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? true });
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    renderPane();
    await user.click(await screen.findByTestId("admin-instance-file-edit"));
    await user.type(await screen.findByRole("textbox"), "b");
    await user.click(screen.getByTestId("admin-instance-file-cancel"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(screen.getByRole("textbox")).toBeTruthy();
    await user.click(screen.getByTestId("admin-instance-file-cancel"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(m.saveInstanceFile).not.toHaveBeenCalled();
  });

  it("Cancel with nothing changed just goes back to reading", async () => {
    const user = userEvent.setup();
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    renderPane();
    await user.click(await screen.findByTestId("admin-instance-file-edit"));
    await user.click(await screen.findByTestId("admin-instance-file-cancel"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(dialogs.calls).toHaveLength(0);
  });

  it("the window's leave guard asks while there are unsaved edits", async () => {
    const user = userEvent.setup();
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    const { guard } = renderPane();
    await screen.findByTestId("admin-instance-file-edit");
    expect(await guard.current!()).toBe(true);
    await user.click(screen.getByTestId("admin-instance-file-edit"));
    await user.type(await screen.findByRole("textbox"), "b");
    expect(await guard.current!()).toBe(false);
    expect(dialogs.calls).toHaveLength(1);
  });

  it("Esc while editing leaves the editor (asking first when changed)", async () => {
    const user = userEvent.setup();
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    renderPane();
    await user.click(await screen.findByTestId("admin-instance-file-edit"));
    await screen.findByRole("textbox");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("shows the backend's reason when a save fails, and stays editing", async () => {
    const user = userEvent.setup();
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: null });
    m.saveInstanceFile.mockRejectedValue({ response: { data: { error: "instance file is too big" } } });
    renderPane();
    await user.click(await screen.findByTestId("admin-instance-file-edit"));
    await user.type(await screen.findByRole("textbox"), "x");
    await user.click(screen.getByTestId("admin-instance-file-save"));
    expect((await screen.findByTestId("admin-instance-file-error")).textContent).toContain("instance file is too big");
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows an error instead of the file when loading fails", async () => {
    m.getInstanceFile.mockRejectedValue(new Error("Access denied"));
    renderPane();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Access denied"));
    expect(screen.queryByTestId("admin-instance-file-edit")).toBeNull();
  });
});
