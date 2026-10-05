/**
 * EditableFileModal viewer-branch tests (shape 2026-09-28).
 *
 * When the modal opens on a media file (image / audio / video / SVG in
 * rendered mode), it renders a native browser viewer directly from the
 * URL — no base64 fetch, no text editor. SVG can toggle to code mode,
 * which flips the modal back into the text-editor fetch flow.
 *
 * Coverage:
 *   - image → <img src={url}> is rendered; fetch is NOT called
 *   - audio → native <audio> element rendered; fetch is NOT called
 *   - video → native <video> element rendered; fetch is NOT called
 *   - svg default → <img src={url}> rendered; fetch is NOT called
 *   - svg toggle → "Source" button flips to code editor, fetch fires
 *   - plain text → existing fetch + text-editor path (regression check)
 *
 * Mock strategy mirrors EditableFileModal.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Hoisted module mocks (mirror EditableFileModal.test.tsx) ────────────────

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
  fetchHostFileUrl: vi.fn(),
}));

vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: {
    markdown: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      value={props.markdown}
      onChange={(e) => props.onChange?.(e.target.value)}
      disabled={props.readOnly}
      data-testid="mdxeditor"
    />
  ),
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  tablePlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
  frontmatterPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  InsertTable: () => null,
  ListsToggle: () => null,
  InsertFrontmatter: () => null,
}));

import EditableFileModal from "./EditableFileModal";
import { fetchHostFileUrl } from "@/api/editable-file-api";

const mockedFetchFile = vi.mocked(fetchHostFileUrl);

function baseProps(overrides: Partial<{
  filename: string;
  url: string;
}> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    messageEventId: "e1",
    url: overrides.url ?? "https://term.example.com/file/t1000/home/ubuntu/photo.png",
    filename: overrides.filename ?? "photo.png",
    agentIdentityName: null,
    onStageEditedFile: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default the fetch to a never-resolving promise so text-editor paths
  // that DO fetch don't accidentally succeed with undefined data.
  mockedFetchFile.mockImplementation(() => new Promise(() => {}));
});

describe("EditableFileModal — media viewer branches", () => {
  it("renders an <img> pointing at the URL for image kinds without fetching bytes", async () => {
    render(<EditableFileModal {...baseProps({ filename: "photo.png" })} />);
    const img = await screen.findByAltText("photo.png") as HTMLImageElement;
    expect(img.src).toBe(
      "https://term.example.com/file/t1000/home/ubuntu/photo.png",
    );
    expect(mockedFetchFile).not.toHaveBeenCalled();
  });

  it("renders native <audio controls> for audio kinds without fetching bytes", async () => {
    const { container } = render(
      <EditableFileModal
        {...baseProps({
          filename: "song.mp3",
          url: "https://term.example.com/file/t1000/home/ubuntu/song.mp3",
        })}
      />,
    );
    // Wait for the modal to portal into document.body then look up.
    await waitFor(() => {
      expect(document.body.querySelector("audio")).not.toBeNull();
    });
    const audio = document.body.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe(
      "https://term.example.com/file/t1000/home/ubuntu/song.mp3",
    );
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(mockedFetchFile).not.toHaveBeenCalled();
    void container; // silence unused warning
  });

  it("renders native <video controls> without autoplay for video kinds", async () => {
    render(
      <EditableFileModal
        {...baseProps({
          filename: "clip.mp4",
          url: "https://term.example.com/file/t1000/home/ubuntu/clip.mp4",
        })}
      />,
    );
    await waitFor(() => {
      expect(document.body.querySelector("video")).not.toBeNull();
    });
    const video = document.body.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(
      "https://term.example.com/file/t1000/home/ubuntu/clip.mp4",
    );
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(mockedFetchFile).not.toHaveBeenCalled();
  });

  it("SVG defaults to rendered <img> mode without fetching bytes", async () => {
    render(
      <EditableFileModal
        {...baseProps({
          filename: "logo.svg",
          url: "https://term.example.com/file/t1000/home/ubuntu/logo.svg",
        })}
      />,
    );
    const img = await screen.findByAltText("logo.svg") as HTMLImageElement;
    expect(img.src).toBe(
      "https://term.example.com/file/t1000/home/ubuntu/logo.svg",
    );
    expect(mockedFetchFile).not.toHaveBeenCalled();
    // Modal-unification 2026-09-29: SVG toggle is a segmented [Rendered |
    // Source] pill (role="tab") in the head actions slot — replaces the
    // single button that flipped its label. In rendered mode, the
    // "Rendered" tab is selected.
    const renderedTab = screen.getByTestId(
      "file-view-mode-rendered",
    );
    const sourceTab = screen.getByTestId(
      "file-view-mode-source",
    );
    expect(renderedTab.getAttribute("aria-selected")).toBe("true");
    expect(sourceTab.getAttribute("aria-selected")).toBe("false");
  });

  it("SVG toggle flips to code mode and fires the fetch", async () => {
    render(
      <EditableFileModal
        {...baseProps({
          filename: "logo.svg",
          url: "https://term.example.com/file/t1000/home/ubuntu/logo.svg",
        })}
      />,
    );
    // Initial render is rendered-mode — <img> visible, no fetch.
    expect(await screen.findByAltText("logo.svg")).toBeTruthy();
    expect(mockedFetchFile).not.toHaveBeenCalled();

    // Click the Source tab in the head's segmented control.
    fireEvent.click(
      screen.getByTestId("file-view-mode-source"),
    );

    // Fetch fires now — modal has switched into text-editor path.
    await waitFor(() => {
      expect(mockedFetchFile).toHaveBeenCalledWith(
        "https://term.example.com/file/t1000/home/ubuntu/logo.svg",
      );
    });
    // Now the "Source" tab is the selected one.
    expect(
      screen
        .getByTestId("file-view-mode-source")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("file-view-mode-rendered")
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});

describe("EditableFileModal — text path regression", () => {
  it("plain text file still fires the fetch (no viewer intercept)", async () => {
    render(
      <EditableFileModal
        {...baseProps({
          filename: "notes.md",
          url: "https://term.example.com/file/t1000/home/ubuntu/notes.md",
        })}
      />,
    );
    await waitFor(() => {
      expect(mockedFetchFile).toHaveBeenCalledWith(
        "https://term.example.com/file/t1000/home/ubuntu/notes.md",
      );
    });
  });
});

describe("EditableFileModal — binary fallback", () => {
  function b64(bytes: number[]): string {
    return btoa(String.fromCharCode(...bytes));
  }

  it("known-binary extension shows the can't-preview notice without fetching", async () => {
    render(
      <EditableFileModal
        {...baseProps({
          filename: "bundle.zip",
          url: "https://term.example.com/file/t1000/home/ubuntu/bundle.zip",
        })}
      />,
    );
    expect(await screen.findByText(/can't preview this file/i)).toBeTruthy();
    expect(mockedFetchFile).not.toHaveBeenCalled();
    const download = screen.getByRole("link", { name: /download/i });
    expect(download.getAttribute("href")).toBe(
      "https://term.example.com/file/t1000/home/ubuntu/bundle.zip",
    );
    // Nothing to edit → no Save foot.
    expect(screen.queryByTestId("editable-file-modal-save")).toBeNull();
  });

  it("unknown extension whose bytes sniff as binary shows the notice, not decoded garbage", async () => {
    mockedFetchFile.mockResolvedValueOnce({
      contentBase64: b64([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]),
      sizeBytes: 7,
      contentType: null,
      extension: "dat2",
      filename: "blob.dat2",
      isTextByExt: false,
      isTextByBytes: false,
    } as never);
    render(
      <EditableFileModal
        {...baseProps({
          filename: "blob.dat2",
          url: "https://term.example.com/file/t1000/home/ubuntu/blob.dat2",
        })}
      />,
    );
    expect(await screen.findByText(/can't preview this file/i)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByTestId("editable-file-modal-save")).toBeNull();
  });

  it("unknown extension whose bytes sniff as text opens in the editor", async () => {
    mockedFetchFile.mockResolvedValueOnce({
      contentBase64: btoa("key = value\n"),
      sizeBytes: 12,
      contentType: null,
      extension: "cfg2",
      filename: "app.cfg2",
      isTextByExt: false,
      isTextByBytes: true,
    } as never);
    render(
      <EditableFileModal
        {...baseProps({
          filename: "app.cfg2",
          url: "https://term.example.com/file/t1000/home/ubuntu/app.cfg2",
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText(/can't preview this file/i)).toBeNull();
      expect(screen.getByTestId("editable-file-modal-save")).toBeTruthy();
    });
  });
});
