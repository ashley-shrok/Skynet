/**
 * WorkspaceTab search — in-process flows through the Files-tab search box:
 * type → results replace the folder; open / rename / delete from a result;
 * folder results, breadcrumb and Escape clear it; limits are always stated;
 * an older, slower search never lands over a newer one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SearchResponse, WorkspaceEntry } from "@/api/workspace-api";

vi.mock("@/api/workspace-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/workspace-api")>();
  return {
    ...actual,
    listWorkspace: vi.fn(),
    searchWorkspace: vi.fn(),
    readWorkspaceFile: vi.fn(async () => ({
      contentBase64: btoa("# hi"),
      sizeBytes: 4,
      filename: "deep-plan.md",
      extension: "md",
    })),
    renameWorkspaceEntry: vi.fn(async () => undefined),
    deleteWorkspaceEntry: vi.fn(async () => undefined),
    mkdirWorkspace: vi.fn(async () => undefined),
  };
});

import WorkspaceTab from "./WorkspaceTab";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import {
  deleteWorkspaceEntry,
  listWorkspace,
  mkdirWorkspace,
  renameWorkspaceEntry,
  searchWorkspace,
} from "@/api/workspace-api";

const file = (path: string, size = 10): WorkspaceEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  type: "file",
  size,
  mtimeMs: 0,
  path,
});
const dir = (path: string): WorkspaceEntry => ({ ...file(path), type: "directory", size: null });

const found = (results: WorkspaceEntry[], extra: Partial<SearchResponse> = {}): SearchResponse => ({
  results,
  truncated: false,
  timedOut: false,
  ...extra,
});

function renderTab(props: Partial<Parameters<typeof WorkspaceTab>[0]> = {}) {
  return render(
    <WorkspaceTab target={{ kind: "identity", identityKey: "ada" }} hostId={1} hue={190} {...props} />,
  );
}

function box(): HTMLInputElement {
  return screen.getByTestId("workspace-search-input") as HTMLInputElement;
}

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

/** Open a row's menu with its ⋮ button (the app's standard row menu). */
async function openRowMenu(row: HTMLElement) {
  await userEvent.setup().click(within(row).getByTestId("workspace-row-menu"));
}

/** Open a row's menu by right-clicking the row. */
function rightClick(row: HTMLElement) {
  fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("[data-testid=workspace-row]") as HTMLElement;
}

function rowNames(): string[] {
  return screen.getAllByTestId("workspace-row").map((r) => r.querySelector("span[title]")?.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listWorkspace).mockImplementation(async (_t, _h, p) => ({
    path: p,
    entries: p === "" ? [dir("docs"), file("top.md")] : [file(`${p}/inside.md`)],
  }));
});
afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
});

describe("WorkspaceTab search", () => {
  it("starts empty and unfocused", async () => {
    renderTab();
    await screen.findByText("top.md");
    expect(box().value).toBe("");
    expect(document.activeElement).not.toBe(box());
  });

  it("searches from the current folder as you type and replaces the listing with results", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(
      found([file("docs/notes/deep-plan.md"), file("plan.md"), dir("docs/plans")]),
    );
    renderTab();
    await screen.findByText("top.md");
    type("  plan ");

    await screen.findByText("deep-plan.md");
    expect(searchWorkspace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchWorkspace).mock.calls[0].slice(0, 4)).toEqual([
      { kind: "identity", identityKey: "ada" },
      1,
      "",
      "plan",
    ]);
    // Nearest first, then alphabetical; each with where it lives.
    expect(rowNames()).toEqual(["plan.md", "plans", "deep-plan.md"]);
    expect(screen.getAllByTestId("workspace-result-location").map((e) => e.textContent)).toEqual([
      "in this folder",
      "in docs",
      "in docs/notes",
    ]);
    expect(screen.queryByText("top.md")).toBeNull();
    expect(screen.getByTestId("workspace-search-skipped-note").textContent).toContain(
      "Package and environment folders",
    );
  });

  it("stops typing at the longest search the server accepts", async () => {
    renderTab();
    await screen.findByText("top.md");
    expect(box().maxLength).toBe(200);
  });

  it("only sends one search after a burst of typing", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("p");
    type("pl");
    type("pla");
    await screen.findByText("plan.md");
    expect(searchWorkspace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchWorkspace).mock.calls[0][3]).toBe("pla");
  });

  it("keeps the previous results dimmed while a newer search runs, and an older answer never lands over a newer one", async () => {
    const resolvers: ((r: SearchResponse) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.mocked(searchWorkspace).mockImplementation(
      (_t, _h, _p, _q, signal) =>
        new Promise<SearchResponse>((resolve) => {
          resolvers.push(resolve);
          signals.push(signal!);
        }),
    );
    renderTab();
    await screen.findByText("top.md");

    type("alpha");
    await waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers[0](found([file("alpha.md")]));
    await screen.findByText("alpha.md");

    type("beta");
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // Old results still shown, dimmed, with "Searching…".
    expect(screen.getByText("alpha.md")).toBeTruthy();
    expect(screen.getByTestId("workspace-search-searching")).toBeTruthy();
    expect(screen.getAllByTestId("workspace-row")[0].style.opacity).toBe("0.5");

    type("gamma");
    await waitFor(() => expect(resolvers).toHaveLength(3));
    expect(signals[1].aborted).toBe(true);
    resolvers[2](found([file("gamma.md")]));
    await screen.findByText("gamma.md");
    // The superseded search answers late — ignored.
    resolvers[1](found([file("beta.md")]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("beta.md")).toBeNull();
    expect(screen.getByText("gamma.md")).toBeTruthy();
    expect(screen.queryByTestId("workspace-search-searching")).toBeNull();
  });

  it("says when the result cap cut it short", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("a.log")], { truncated: true }));
    renderTab();
    await screen.findByText("top.md");
    type("log");
    expect((await screen.findByTestId("workspace-search-limit-notice")).textContent).toContain(
      "first 200 matches",
    );
  });

  it("says when the time limit stopped it", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("a.log")], { timedOut: true }));
    renderTab();
    await screen.findByText("top.md");
    type("log");
    expect((await screen.findByTestId("workspace-search-limit-notice")).textContent).toContain(
      "stopped after 5 seconds",
    );
  });

  it("shows no-matches, not the empty-folder message", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([]));
    renderTab();
    await screen.findByText("top.md");
    type("zzz");
    await screen.findByTestId("workspace-search-no-matches");
    expect(screen.queryByText("Empty folder")).toBeNull();
  });

  it("shows the plain-English error when the search fails", async () => {
    vi.mocked(searchWorkspace).mockRejectedValue(new Error("host_unreachable"));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    await screen.findByText("Host unreachable");
    expect(screen.queryAllByTestId("workspace-row")).toHaveLength(0);
  });

  it("hides the root-level hidden file but not a same-named file deeper down", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("ops.md"), file("sub/ops.md")]));
    renderTab({ target: { kind: "role", roleSlug: "ops" }, hiddenNames: ["ops.md"] });
    await screen.findByText("top.md");
    type("ops");
    await screen.findByText("in sub");
    expect(screen.getAllByTestId("workspace-row")).toHaveLength(1);
  });

  it("re-sorts results by a clicked column, nearest-first until then", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(
      found([file("b/zeta.md", 1), file("alpha.md", 5), file("a/b/mid.md", 9)]),
    );
    renderTab();
    await screen.findByText("top.md");
    type("md");
    await screen.findByText("zeta.md");
    expect(rowNames()).toEqual(["alpha.md", "zeta.md", "mid.md"]);
    fireEvent.click(screen.getByText(/^Size/));
    expect(rowNames()).toEqual(["zeta.md", "alpha.md", "mid.md"]);
    fireEvent.click(screen.getByText(/^Size/));
    expect(rowNames()).toEqual(["mid.md", "alpha.md", "zeta.md"]);
  });

  it("opens a file result in the viewer, and closing it returns to the same results", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/notes/deep-plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    fireEvent.click(await screen.findByText("deep-plan.md"));

    const modal = await screen.findByTestId("workspace-file-modal");
    expect(modal.textContent).toContain("deep-plan.md");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("workspace-file-modal")).toBeNull());

    expect(box().value).toBe("plan");
    expect(screen.getByText("deep-plan.md")).toBeTruthy();
    // Closing refreshes, which re-runs the search too (the viewer's teardown
    // is slow under jsdom, hence the longer wait).
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });

  it("goes into a folder result and clears the search", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([dir("docs/plans")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    fireEvent.click(await screen.findByText("plans"));
    await screen.findByText("inside.md");
    expect(vi.mocked(listWorkspace).mock.calls.at(-1)?.[2]).toBe("docs/plans");
    expect(box().value).toBe("");
    expect(screen.queryByTestId("workspace-search-skipped-note")).toBeNull();
  });

  it("searches from a subfolder and a breadcrumb jump clears it", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/x/plan.md")]));
    renderTab();
    fireEvent.click(await screen.findByText("docs"));
    await screen.findByText("inside.md");
    type("plan");
    await screen.findByText("plan.md");
    expect(vi.mocked(searchWorkspace).mock.calls[0][2]).toBe("docs");
    expect(screen.getByTestId("workspace-result-location").textContent).toBe("in x");

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    await screen.findByText("top.md");
    expect(box().value).toBe("");
  });

  it("Escape clears the search and marks the box so the modal stays open", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    expect(box().hasAttribute("data-modal-esc-local")).toBe(false);
    type("plan");
    await screen.findByText("plan.md");
    expect(box().hasAttribute("data-modal-esc-local")).toBe(true);
    fireEvent.keyDown(box(), { key: "Escape" });
    await screen.findByText("top.md");
    expect(box().value).toBe("");
  });

  it("renames a result inside its own folder, then re-runs the search", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/notes/plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    const row = (await screen.findByText("plan.md")).closest("[data-testid=workspace-row]") as HTMLElement;
    await openRowMenu(row);
    fireEvent.click(await screen.findByTestId("workspace-row-rename"));
    const input = within(row).getByDisplayValue("plan.md");
    fireEvent.change(input, { target: { value: "plan-v2.md" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(renameWorkspaceEntry).toHaveBeenCalledWith(
        { kind: "identity", identityKey: "ada" },
        1,
        "docs/notes/plan.md",
        "docs/notes/plan-v2.md",
      ),
    );
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledTimes(2));
    expect(box().value).toBe("plan");
  });

  it("deletes a result by its full path, then re-runs the search", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/plan.md"), file("plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    await screen.findByText("in docs");
    const row = screen.getByText("in docs").closest("[data-testid=workspace-row]") as HTMLElement;
    await openRowMenu(row);
    fireEvent.click(await screen.findByTestId("workspace-row-delete"));
    await waitFor(() =>
      expect(deleteWorkspaceEntry).toHaveBeenCalledWith(
        { kind: "identity", identityKey: "ada" },
        1,
        "docs/plan.md",
      ),
    );
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe('Delete "plan.md"?');
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledTimes(2));
  });

  it("download on a result points at its full path", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/notes/plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    const row = (await screen.findByText("plan.md")).closest("[data-testid=workspace-row]") as HTMLElement;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openRowMenu(row);
    fireEvent.click(await screen.findByTestId("workspace-row-download"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain("docs/notes/plan.md");
    open.mockRestore();
  });

  it("right-clicking a folder row opens the same menu as its ⋮", async () => {
    renderTab();
    await screen.findByText("top.md");
    rightClick(rowOf("top.md"));
    expect(await screen.findByTestId("workspace-row-rename")).toBeTruthy();
    expect(screen.getByTestId("workspace-row-download")).toBeTruthy();
    expect(screen.getByTestId("workspace-row-delete")).toBeTruthy();
    // Browsing has no "Show in folder" — you're already in it.
    expect(screen.queryByTestId("workspace-row-show-in-folder")).toBeNull();
  });

  it("Rename from the ⋮ menu leaves the keyboard in the name box", async () => {
    renderTab();
    await screen.findByText("top.md");
    const user = userEvent.setup();
    await user.click(within(rowOf("top.md")).getByTestId("workspace-row-menu"));
    await user.click(await screen.findByTestId("workspace-row-rename"));
    const input = await screen.findByDisplayValue("top.md");
    // Let the menu finish closing (it hands focus back on close).
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId("workspace-row-rename")).toBeNull();
  });

  it("folders get no Download item", async () => {
    renderTab();
    await screen.findByText("docs");
    rightClick(rowOf("docs"));
    await screen.findByTestId("workspace-row-rename");
    expect(screen.queryByTestId("workspace-row-download")).toBeNull();
  });

  it("right-clicking a result opens its menu, with Show in folder", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/inside.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("inside");
    await screen.findByText("in docs");
    rightClick(rowOf("inside.md"));
    expect(await screen.findByTestId("workspace-row-show-in-folder")).toBeTruthy();
    expect(screen.getByTestId("workspace-row-rename")).toBeTruthy();
  });

  it("Show in folder goes to the result's folder, ends the search and rings the item", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/inside.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("inside");
    await screen.findByText("in docs");
    await openRowMenu(rowOf("inside.md"));
    fireEvent.click(await screen.findByTestId("workspace-row-show-in-folder"));

    await waitFor(() => expect(vi.mocked(listWorkspace).mock.calls.at(-1)?.[2]).toBe("docs"));
    expect(box().value).toBe("");
    await waitFor(() =>
      expect(document.querySelector('[data-path="docs/inside.md"]')?.hasAttribute("data-flash")).toBe(true),
    );
    expect(screen.queryByTestId("workspace-result-location")).toBeNull();
    // The ring fades after a moment.
    await waitFor(
      () => expect(document.querySelector('[data-path="docs/inside.md"]')?.hasAttribute("data-flash")).toBe(false),
      { timeout: 4000 },
    );
  });

  it("Show in folder on a result in the current folder stays put and rings it", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("top.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("top");
    await screen.findByText("in this folder");
    await openRowMenu(rowOf("top.md"));
    const listCalls = vi.mocked(listWorkspace).mock.calls.length;
    fireEvent.click(await screen.findByTestId("workspace-row-show-in-folder"));
    await waitFor(() => expect(box().value).toBe(""));
    await waitFor(() =>
      expect(document.querySelector('[data-path="top.md"]')?.hasAttribute("data-flash")).toBe(true),
    );
    // Already in that folder — no reload.
    expect(vi.mocked(listWorkspace).mock.calls.length).toBe(listCalls);
  });

  it("never rings a row from the previous folder while the target folder loads", async () => {
    // A same-named file at the root and in docs/.
    vi.mocked(listWorkspace).mockImplementation(async (_t, _h, p) =>
      p === "" ? { path: "", entries: [file("README.md")] } : new Promise(() => {}),
    );
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/README.md")]));
    renderTab();
    await screen.findByText("README.md");
    type("readme");
    await screen.findByText("in docs");
    await openRowMenu(rowOf("README.md"));
    // jsdom has no scrollIntoView; record what gets scrolled to.
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      fireEvent.click(await screen.findByTestId("workspace-row-show-in-folder"));
      await waitFor(() => expect(vi.mocked(listWorkspace).mock.calls.at(-1)?.[2]).toBe("docs"));
      await new Promise((r) => setTimeout(r, 50));
      // Nothing from the old folder is scrolled to or ringed.
      expect(scrolled).toEqual([]);
      expect(document.querySelector("[data-flash]")).toBeNull();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("drops the ring if the target folder fails to load", async () => {
    let failDocs = true;
    vi.mocked(listWorkspace).mockImplementation(async (_t, _h, p) => {
      if (p === "docs" && failDocs) throw new Error("host_unreachable");
      return { path: p, entries: p === "" ? [dir("docs"), file("top.md")] : [file(`${p}/inside.md`)] };
    });
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("docs/inside.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("inside");
    await screen.findByText("in docs");
    await openRowMenu(rowOf("inside.md"));
    fireEvent.click(await screen.findByTestId("workspace-row-show-in-folder"));
    await screen.findByText("Host unreachable");
    // The folder loads fine later (Refresh) — no leftover ring.
    failDocs = false;
    fireEvent.click(screen.getByTitle("Refresh"));
    await screen.findByText("inside.md");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-flash]")).toBeNull();
  });

  it("creating a folder while searching clears the search so it shows", async () => {
    vi.mocked(searchWorkspace).mockResolvedValue(found([file("plan.md")]));
    renderTab();
    await screen.findByText("top.md");
    type("plan");
    await screen.findByText("plan.md");
    fireEvent.click(screen.getByText("New folder"));
    const input = screen.getByPlaceholderText("New folder name");
    fireEvent.change(input, { target: { value: "fresh" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mkdirWorkspace).toHaveBeenCalledWith(expect.anything(), 1, "fresh"));
    await waitFor(() => expect(box().value).toBe(""));
    await screen.findByText("top.md");
  });
});
