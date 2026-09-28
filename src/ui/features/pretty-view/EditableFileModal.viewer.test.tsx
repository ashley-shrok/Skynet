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
    // The "Source" toggle button is present in the header for SVGs.
    expect(
      screen.getByRole("button", { name: /view source code/i }),
    ).toBeTruthy();
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

    // Click the Source toggle in the header.
    fireEvent.click(screen.getByRole("button", { name: /view source code/i }));

    // Fetch fires now — modal has switched into text-editor path.
    await waitFor(() => {
      expect(mockedFetchFile).toHaveBeenCalledWith(
        "https://term.example.com/file/t1000/home/ubuntu/logo.svg",
      );
    });
    // The button's label flips to "View rendered" while in code mode.
    expect(screen.getByRole("button", { name: /view rendered/i })).toBeTruthy();
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
