/**
 * AdminInstanceFilePane tests
 *   - loads the current instance file into the editor
 *   - Save is disabled until the draft changes, then saves the draft
 *   - a failed save shows the backend's reason
 *   - a failed load shows an error instead of the editor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminInstanceFilePane } from "./AdminInstanceFilePane";

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

describe("AdminInstanceFilePane", () => {
  it("loads the current instance file into the editor", async () => {
    m.getInstanceFile.mockResolvedValue({ content: "# Team rules", updatedAt: 1 });
    render(<AdminInstanceFilePane />);
    expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("# Team rules");
  });

  it("saves the edited draft; Save is disabled until something changes", async () => {
    const user = userEvent.setup();
    m.getInstanceFile.mockResolvedValue({ content: "a", updatedAt: 1 });
    m.saveInstanceFile.mockResolvedValue({ content: "ab", updatedAt: 2 });
    render(<AdminInstanceFilePane />);
    const box = await screen.findByRole("textbox");
    const save = screen.getByTestId("admin-instance-file-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(box, "b");
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(m.saveInstanceFile).toHaveBeenCalledWith("ab");
    await screen.findByTestId("admin-instance-file-saved");
    expect(save.disabled).toBe(true);
  });

  it("shows the backend's reason when a save fails", async () => {
    const user = userEvent.setup();
    m.getInstanceFile.mockResolvedValue({ content: "", updatedAt: null });
    m.saveInstanceFile.mockRejectedValue({ response: { data: { error: "instance file is too big" } } });
    render(<AdminInstanceFilePane />);
    await user.type(await screen.findByRole("textbox"), "x");
    await user.click(screen.getByTestId("admin-instance-file-save"));
    expect((await screen.findByRole("alert")).textContent).toContain("instance file is too big");
  });

  it("shows an error instead of the editor when loading fails", async () => {
    m.getInstanceFile.mockRejectedValue(new Error("Access denied"));
    render(<AdminInstanceFilePane />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Access denied"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
