/**
 * FilePane — a chat-shared file shown read-only in its own pane.
 *
 * Covers: the bar (file name only, view switcher for
 * multi-view types), the read-only body (editor locked, no Save), the
 * can't-show notice for read errors and for URL-sourced views whose URL no
 * longer serves, Reload re-reading, the ⋯ menu per platform, Open in modal
 * (handed to the source conversation, else a view-only modal here), Copy
 * path, the bar's drag payload, and the drag shield over the body.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));
vi.mock("@/hooks/use-is-touch-device", () => ({ useIsTouchDevice: () => false }));
vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
  fetchHostFileUrl: vi.fn(),
}));
vi.mock("@/features/pretty-view/CodeEditorImpl", () => ({
  CodeEditorImpl: (props: { content: string; disabled?: boolean; onChange: (v: string) => void }) => (
    <textarea
      data-testid="code-editor"
      value={props.content}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

vi.mock("@mdxeditor/editor", async () =>
  (await import("@/features/pretty-view/file-window.test-mocks")).mdxEditor(),
);

import { FilePane } from "./FilePane";
import { fetchHostFileUrl } from "@/api/editable-file-api";
import {
  FILE_CHIP_MIME,
  OPEN_FILE_IN_CONVERSATION_EVENT,
  type OpenFileInConversationDetail,
} from "@/features/pretty-view/file-url";

const mockedFetch = vi.mocked(fetchHostFileUrl);
const origin = window.location.origin;

function ok(text: string) {
  return {
    contentBase64: btoa(text),
    isTextByExt: true,
  } as Awaited<ReturnType<typeof fetchHostFileUrl>>;
}

function renderPane(props: Partial<React.ComponentProps<typeof FilePane>> = {}) {
  return render(
    <FilePane
      host="Skynet"
      path="/home/ubuntu/notes/todo.txt"
      tabId="file-tab-1"
      isVisible
      onCloseTab={vi.fn()}
      {...props}
    />,
  );
}

async function menuLabels(): Promise<string[]> {
  await userEvent.setup().click(screen.getByTestId("file-pane-kebab-trigger"));
  const menu = screen.getByRole("menu");
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent?.trim() ?? "");
}

async function clickMenuItem(label: string) {
  await userEvent.setup().click(screen.getByTestId("file-pane-kebab-trigger"));
  const item = Array.from(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')).find(
    (el) => el.textContent?.trim() === label,
  ) as HTMLElement;
  fireEvent.click(item);
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mobileState.isMobile = false;
  mockedFetch.mockReset();
  fetchSpy = vi.fn(async () => new Response("x", { status: 206 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FilePane — bar and read-only body", () => {
  it("shows the file name only, and the file read-only", async () => {
    mockedFetch.mockResolvedValue(ok("buy milk"));
    renderPane();
    expect(screen.getByTestId("file-pane-title").textContent).toBe("todo.txt");
    expect(screen.queryByTestId("file-pane-subtitle")).toBeNull();
    const editor = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(editor.value).toBe("buy milk");
    expect(editor.disabled).toBe(true);
    expect(screen.queryByText("Save")).toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith(`${origin}/file/Skynet/home/ubuntu/notes/todo.txt`);
  });

  it("puts the view switcher in the bar for types with several views", async () => {
    renderPane({ path: "/home/ubuntu/logo.svg" });
    const slot = screen.getByTestId("file-pane-kebab-slot");
    expect(slot.querySelector('[data-testid="file-view-mode-rendered"]')).not.toBeNull();
    expect(slot.querySelector('[data-testid="file-view-mode-source"]')).not.toBeNull();
  });

  it("puts markdown's Formatted / Plain text switch in the bar, not on a row of its own", async () => {
    window.localStorage.clear();
    mockedFetch.mockResolvedValue(ok("# Plan\n\nShip it."));
    renderPane({ path: "/home/ubuntu/notes/plan.md" });
    const editor = (await screen.findByTestId("mdxeditor")) as HTMLTextAreaElement;
    // View-only: locked, no formatting toolbar.
    expect(editor.readOnly).toBe(true);
    const slot = screen.getByTestId("file-pane-kebab-slot");
    expect(slot.querySelector('[data-testid="markdown-mode-formatted"]')).not.toBeNull();
    expect(screen.getAllByTestId("markdown-mode-formatted")).toHaveLength(1);
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
    // The bar's switch flips the body.
    fireEvent.click(slot.querySelector('[data-testid="markdown-mode-plain"]') as HTMLElement);
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
    window.localStorage.clear();
  });

  it("has no switcher for single-view types", () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane();
    expect(screen.getByTestId("file-pane-kebab-slot").querySelector('[role="tablist"]')).toBeNull();
  });
});

describe("FilePane — read aloud", () => {
  it("offers read aloud in the bar for prose files once read", async () => {
    mockedFetch.mockResolvedValue(ok("Ship the file pane today."));
    renderPane();
    await screen.findByTestId("code-editor");
    const slot = screen.getByTestId("file-pane-kebab-slot");
    expect(slot.querySelector('[data-testid="file-speak-button"]')).not.toBeNull();
    // Only one: the body doesn't show a second one.
    expect(screen.getAllByTestId("file-speak-button")).toHaveLength(1);
  });

  it("doesn't offer it for files that aren't prose", async () => {
    mockedFetch.mockResolvedValue(ok("a,b\n1,2\n"));
    renderPane({ path: "/home/ubuntu/data.csv" });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("file-speak-button")).toBeNull();
  });
});

describe("FilePane — can't show the file", () => {
  it("shows why when the read fails, and Reload reads again", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("not_found")).mockResolvedValueOnce(ok("back again"));
    renderPane();
    const notice = await screen.findByTestId("file-pane-unavailable");
    expect(notice.getAttribute("data-error-class")).toBe("not_found");
    expect(notice.textContent).toContain("File not found");
    fireEvent.click(screen.getByTestId("file-pane-reload"));
    const editor = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(editor.value).toBe("back again");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("checks that a URL-sourced view's file still exists", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("permission_denied: you do not have read access", { status: 403 }),
    );
    renderPane({ path: "/root/secret.png" });
    const notice = await screen.findByTestId("file-pane-unavailable");
    expect(notice.textContent).toContain("Permission denied");
    expect(notice.textContent).toContain("Skynet");
    expect(mockedFetch).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${origin}/file/Skynet/root/secret.png`);
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
  });

  it("renders a URL-sourced view straight from the URL when the file serves", async () => {
    renderPane({ path: "/home/ubuntu/shot.png" });
    const img = (await screen.findByAltText("shot.png")) as HTMLImageElement;
    expect(img.src).toBe(`${origin}/file/Skynet/home/ubuntu/shot.png`);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("file-pane-unavailable")).toBeNull();
  });
});

describe("FilePane — menu", () => {
  it("desktop: Open in modal, Copy path, Download, Move to new tab, Close", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane();
    expect(await menuLabels()).toEqual(["Open in modal", "Copy path", "Download", "Move to new tab", "Close"]);
  });

  it("phone: no Move to new tab or Close", async () => {
    mobileState.isMobile = true;
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane();
    expect(await menuLabels()).toEqual(["Open in modal", "Copy path", "Download"]);
  });

  it("Close closes this pane", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    const onCloseTab = vi.fn();
    renderPane({ onCloseTab });
    await clickMenuItem("Close");
    expect(onCloseTab).toHaveBeenCalledWith("file-tab-1");
  });

  it("Copy path copies the absolute path", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane();
    // userEvent.setup() installs its own clipboard stub — spy after it.
    await userEvent.setup().click(screen.getByTestId("file-pane-kebab-trigger"));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const item = Array.from(screen.getByRole("menu").querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === "Copy path",
    ) as HTMLElement;
    fireEvent.click(item);
    expect(writeText).toHaveBeenCalledWith("/home/ubuntu/notes/todo.txt");
  });

  it("Move to new tab opens the file alone in a new Skynet tab and closes this pane", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const onCloseTab = vi.fn();
    renderPane({ onCloseTab });
    await clickMenuItem("Move to new tab");
    const href = open.mock.calls[0][0] as string;
    const params = new URLSearchParams(href.slice(1));
    expect(params.get("tab")).toMatch(/^file:/);
    expect(params.get("only")).toBe("1");
    expect(onCloseTab).toHaveBeenCalledWith("file-tab-1");
    open.mockRestore();
  });
});

describe("FilePane — Open in modal", () => {
  it("hands the file to its source conversation when that conversation takes it", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    const seen: OpenFileInConversationDetail[] = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent<OpenFileInConversationDetail>).detail);
      e.preventDefault();
    };
    window.addEventListener(OPEN_FILE_IN_CONVERSATION_EVENT, listener);
    renderPane({ origin: "tmux:Skynet:sahara" });
    await clickMenuItem("Open in modal");
    window.removeEventListener(OPEN_FILE_IN_CONVERSATION_EVENT, listener);
    expect(seen).toEqual([
      {
        origin: "tmux:Skynet:sahara",
        url: `${origin}/file/Skynet/home/ubuntu/notes/todo.txt`,
        filename: "todo.txt",
      },
    ]);
    expect(screen.queryByTestId("editable-file-modal")).toBeNull();
  });

  it("opens a view-only modal here when no conversation takes it", async () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane({ origin: "tmux:Skynet:gone" });
    await clickMenuItem("Open in modal");
    expect(await screen.findByTestId("editable-file-modal-view-only-note")).toBeTruthy();
    expect(screen.queryByTestId("editable-file-modal-save")).toBeNull();
  });
});

describe("FilePane — dragging", () => {
  it("the bar drags as a pane with a file descriptor", () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane({ origin: "tmux:Skynet:sahara" });
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (t: string, v: string) => store.set(t, v),
      getData: (t: string) => store.get(t) ?? "",
      effectAllowed: "none",
      types: [] as string[],
    };
    fireEvent.dragStart(screen.getByTestId("file-pane-bar"), { dataTransfer });
    const badge = JSON.parse(store.get("application/x-skynet-badge") ?? "{}");
    expect(badge.tabId).toBe("file-tab-1");
    expect(badge.descriptor).toEqual({
      tabType: "file",
      file: { host: "Skynet", path: "/home/ubuntu/notes/todo.txt", origin: "tmux:Skynet:sahara" },
      label: "todo.txt",
    });
  });

  it("the body ignores the pointer while a Skynet drag is in flight", () => {
    mockedFetch.mockResolvedValue(ok("x"));
    renderPane();
    const body = screen.getByTestId("file-pane-body");
    const evt = new Event("dragover") as DragEvent;
    Object.defineProperty(evt, "dataTransfer", { value: { types: [FILE_CHIP_MIME] } });
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(body.style.pointerEvents).toBe("none");
  });
});
