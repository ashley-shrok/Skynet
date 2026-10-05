import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DelimitedChipPreview } from "./DelimitedChipPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DelimitedChipPreview", () => {
  it("shows the header, the first rows, and the size", async () => {
    const csv = "name,age\n" + Array.from({ length: 10 }, (_, i) => `p${i},${i}`).join("\n") + "\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(csv)));
    render(<DelimitedChipPreview url="/file/h/p.csv" filename="p.csv" onError={vi.fn()} />);
    expect(await screen.findByText("10 rows × 2 columns")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("p3")).toBeTruthy();
    expect(screen.queryByText("p4")).toBeNull(); // only 4 preview rows
  });

  it("reads tab-separated files as tabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a,b\tc\n1\t2\n")));
    render(<DelimitedChipPreview url="/file/h/t.tsv" filename="t.tsv" onError={vi.fn()} />);
    expect(await screen.findByText("a,b")).toBeTruthy();
  });

  it("falls back to the plain chip for an empty file or a failed fetch", async () => {
    const onError = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
    render(<DelimitedChipPreview url="/file/h/e.csv" filename="e.csv" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());

    const onError2 = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    render(<DelimitedChipPreview url="/file/h/f.csv" filename="f.csv" onError={onError2} />);
    await waitFor(() => expect(onError2).toHaveBeenCalled());
  });
});
