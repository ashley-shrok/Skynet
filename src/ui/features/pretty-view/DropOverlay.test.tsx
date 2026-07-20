import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DropOverlay } from "./DropOverlay";

describe("DropOverlay", () => {
  it("Test 8: returns null when neither dragging nor folderRejected", () => {
    const { container } = render(
      <DropOverlay isDragOver={false} folderDropRejected={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Test 9: renders 'Drop files here' when isDragOver=true", () => {
    render(<DropOverlay isDragOver={true} folderDropRejected={false} />);
    expect(screen.getByText(/drop files here/i)).toBeTruthy();
  });

  it("Test 10: renders folder-nudge copy when folderDropRejected=true", () => {
    render(<DropOverlay isDragOver={false} folderDropRejected={true} />);
    expect(
      screen.getByText(/please attach files or zip first/i),
    ).toBeTruthy();
  });

  it("Test 11: outermost overlay uses pointer-events-none (children of pretty-view still get pointer events)", () => {
    const { container } = render(
      <DropOverlay isDragOver={true} folderDropRejected={false} />,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer).toBeTruthy();
    const cls = outer.className ?? "";
    expect(cls.includes("pointer-events-none")).toBe(true);
  });

  it("folder-rejected overlay ALSO uses pointer-events-none (parity with drag-over variant)", () => {
    const { container } = render(
      <DropOverlay isDragOver={false} folderDropRejected={true} />,
    );
    const outer = container.firstChild as HTMLElement;
    const cls = outer.className ?? "";
    expect(cls.includes("pointer-events-none")).toBe(true);
  });
});
