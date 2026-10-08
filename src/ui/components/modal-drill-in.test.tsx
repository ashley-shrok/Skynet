/**
 * ModalSidebar mobile drill-in: below the `sm` breakpoint (where Modal goes
 * fullscreen) the side list and the pane are shown one at a time — list
 * first, pick an item to drill into its pane, back bar returns to the list.
 * Desktop keeps both columns side by side.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModalSidebar } from "./modal";

const realMatchMedia = window.matchMedia;

function setFullscreen(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function Harness({ files }: { files: string[] }) {
  const [value, setValue] = useState(files[0]);
  return (
    <ModalSidebar
      tabs={files.map((f) => ({ value: f, label: f }))}
      value={value}
      onValueChange={setValue}
      testIdPrefix="file"
      trailing={<button type="button">+ Add file</button>}
    >
      <div data-testid="pane">editing {value}</div>
    </ModalSidebar>
  );
}

const split = () =>
  document.querySelector('[data-slot="modal-split"]') as HTMLElement;
const listHidden = () =>
  document.querySelector('[data-slot="modal-sidebar"]')!.classList.contains("hidden");
const paneHidden = () =>
  screen.getByTestId("pane").parentElement!.classList.contains("hidden");

describe("ModalSidebar drill-in", () => {
  it("desktop: list and pane side by side, no back bar", () => {
    setFullscreen(false);
    render(<Harness files={["SKILL.md", "notes.md"]} />);
    expect(split().dataset.drill).toBeUndefined();
    expect(listHidden()).toBe(false);
    expect(paneHidden()).toBe(false);
    expect(screen.queryByTestId("file-back")).toBeNull();
  });

  it("mobile: starts on the list; picking an item shows its pane; back returns", () => {
    setFullscreen(true);
    render(<Harness files={["SKILL.md", "notes.md"]} />);
    expect(split().dataset.drill).toBe("list");
    expect(listHidden()).toBe(false);
    expect(paneHidden()).toBe(true);

    fireEvent.click(screen.getByTestId("file-notes.md"));
    expect(split().dataset.drill).toBe("pane");
    expect(listHidden()).toBe(true);
    expect(screen.getByTestId("pane")).toHaveTextContent("editing notes.md");
    const back = screen.getByTestId("file-back");
    expect(back).toHaveTextContent("Files");
    expect(back.parentElement).toHaveTextContent("notes.md");

    fireEvent.click(back);
    expect(split().dataset.drill).toBe("list");
    expect(paneHidden()).toBe(true);
  });

  it("mobile: picking the already-selected item drills in", () => {
    setFullscreen(true);
    render(<Harness files={["SKILL.md", "notes.md"]} />);
    fireEvent.click(screen.getByTestId("file-SKILL.md"));
    expect(split().dataset.drill).toBe("pane");
  });

  it("mobile: a one-item list opens straight on its pane, back still reaches the list", () => {
    setFullscreen(true);
    render(<Harness files={["SKILL.md"]} />);
    expect(split().dataset.drill).toBe("pane");
    fireEvent.click(screen.getByTestId("file-back"));
    expect(split().dataset.drill).toBe("list");
    expect(screen.getByText("+ Add file")).toBeVisible();
  });
});
