import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { DiffChipPreview } from "./DiffChipPreview";
import { GIT_PATCH, PLAIN_UNIFIED } from "./fixtures";

describe("DiffView", () => {
  it("multi-file patch: dropdown lists All files first, then each file with counts", () => {
    render(<DiffView content={GIT_PATCH} layout="unified" />);
    const select = screen.getByTestId("diff-view-file-select") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toBe("All files (4) · +4 −1");
    expect(labels[1]).toBe("src/auth.ts · +2 −1");
    expect(labels[2]).toBe("docs/new.md (new) · +2 −0");
    expect(labels[3]).toBe("old.txt → renamed.txt (renamed) · +0 −0");
    // All files shown by default.
    expect(screen.getAllByTestId("diff-file")).toHaveLength(4);
  });

  it("picking a file in the dropdown shows only that file", () => {
    render(<DiffView content={GIT_PATCH} layout="unified" />);
    fireEvent.change(screen.getByTestId("diff-view-file-select"), { target: { value: "1" } });
    const files = screen.getAllByTestId("diff-file");
    expect(files).toHaveLength(1);
    expect(files[0].textContent).toContain("docs/new.md");
  });

  it("single-file patch has no dropdown", () => {
    render(<DiffView content={PLAIN_UNIFIED.split("--- c.txt")[0]} layout="unified" />);
    expect(screen.queryByTestId("diff-view-file-select")).toBeNull();
    expect(screen.getAllByTestId("diff-file")).toHaveLength(1);
  });

  it("unified rows carry add / del / ctx kinds", () => {
    const { container } = render(<DiffView content={PLAIN_UNIFIED} layout="unified" />);
    const kinds = Array.from(container.querySelectorAll("[data-diff-line]")).map((el) =>
      el.getAttribute("data-diff-line"),
    );
    expect(kinds).toEqual(["del", "add", "ctx", "del", "add"]);
  });

  it("side-by-side puts removal and addition on the same row", () => {
    const { container } = render(<DiffView content={PLAIN_UNIFIED} layout="split" />);
    const firstRow = container.querySelector("tbody tr:nth-child(2)")!;
    const cells = Array.from(firstRow.querySelectorAll("[data-diff-line]")).map((el) => [
      el.getAttribute("data-diff-line"),
      el.textContent,
    ]);
    expect(cells).toEqual([
      ["del", "one"],
      ["add", "uno"],
    ]);
  });

  it("binary and rename-only files explain why there are no lines", () => {
    render(<DiffView content={GIT_PATCH} layout="unified" />);
    expect(screen.getByText(/binary file, no text changes shown/i)).toBeTruthy();
    expect(screen.getByText(/no content changes/i)).toBeTruthy();
  });

  it("text that isn't a diff points the user at Raw", () => {
    render(<DiffView content={"hello\n"} layout="unified" />);
    expect(screen.getByTestId("diff-view-empty").textContent).toMatch(/switch to raw/i);
  });
});

describe("DiffChipPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the patch and shows the summary plus the first changed lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(GIT_PATCH, { status: 200 })),
    );
    render(<DiffChipPreview url="/file/h/x.patch" filename="x.patch" onError={vi.fn()} />);
    const el = await screen.findByText(/4 files/);
    expect(el.textContent).toBe("4 files · +4 −1");
    const preview = screen.getByTestId("diff-chip-preview");
    expect(preview.textContent).toContain("+const b = 2;");
    expect(preview.textContent).toContain("--- a leading-dashes line");
  });

  it("calls onError when the file isn't a diff, so the chip falls back to plain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not a diff", { status: 200 })));
    const onError = vi.fn();
    render(<DiffChipPreview url="/file/h/x.patch" filename="x.patch" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it("calls onError on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const onError = vi.fn();
    render(<DiffChipPreview url="/file/h/x.patch" filename="x.patch" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
