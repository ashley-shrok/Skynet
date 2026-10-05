/**
 * FileChip unit tests — the unified file-chip component that replaces the
 * pencil-affordance flow. Shape agreement in
 * `.planning/campaigns/more-file-editors/shape-native-viewers-in-modal.md`.
 *
 * Scope of coverage:
 *   - classifyFileChipKind maps extensions to the right kind
 *   - plain-variant renders filename + underline + optional size + download
 *   - media-variant renders the inline preview element for image / audio /
 *     video / svg, all sourced from the URL directly
 *   - click semantics: whole-chip click preventDefaults and fires onOpen;
 *     download-button click stops propagation and does NOT fire onOpen;
 *     clicks on native audio/video controls are NOT swallowed by the intercept
 *   - middle-click / ⌘-click do NOT fire onOpen (the intercept only runs on
 *     the browser's plain click)
 *   - default download path synthesizes a temporary <a download> and clicks it
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileChip, classifyFileChipKind } from "./FileChip";

describe("classifyFileChipKind", () => {
  it("recognizes common image extensions", () => {
    expect(classifyFileChipKind("photo.png")).toBe("image");
    expect(classifyFileChipKind("photo.JPG")).toBe("image");
    expect(classifyFileChipKind("photo.jpeg")).toBe("image");
    expect(classifyFileChipKind("clip.gif")).toBe("image");
    expect(classifyFileChipKind("photo.webp")).toBe("image");
  });

  it("recognizes audio extensions", () => {
    expect(classifyFileChipKind("song.mp3")).toBe("audio");
    expect(classifyFileChipKind("song.wav")).toBe("audio");
    expect(classifyFileChipKind("song.m4a")).toBe("audio");
    expect(classifyFileChipKind("song.opus")).toBe("audio");
  });

  it("recognizes video extensions", () => {
    expect(classifyFileChipKind("clip.mp4")).toBe("video");
    expect(classifyFileChipKind("clip.webm")).toBe("video");
    expect(classifyFileChipKind("clip.mov")).toBe("video");
  });

  it("recognizes svg separately from other image types", () => {
    expect(classifyFileChipKind("logo.svg")).toBe("svg");
    expect(classifyFileChipKind("logo.SVG")).toBe("svg");
  });

  it("gives delimited and diff files their registry previews", () => {
    expect(classifyFileChipKind("data.csv")).toBe("delimited");
    expect(classifyFileChipKind("data.tsv")).toBe("delimited");
    expect(classifyFileChipKind("fix.patch")).toBe("diff");
    expect(classifyFileChipKind("report.pdf")).toBe("pdf");
    expect(classifyFileChipKind("plan.docx")).toBe("docx");
  });

  it("falls back to plain for text / unknown / extensionless", () => {
    expect(classifyFileChipKind("notes.md")).toBe("plain");
    expect(classifyFileChipKind("book.epub")).toBe("plain");
    expect(classifyFileChipKind("app.log")).toBe("plain");
    expect(classifyFileChipKind("Dockerfile")).toBe("plain");
    expect(classifyFileChipKind("plainname")).toBe("plain");
    // Trailing-dot filenames (no actual extension) — plain fallback
    expect(classifyFileChipKind("weird.")).toBe("plain");
    // Leading-dot filenames (dotfile with no extension) — plain fallback
    expect(classifyFileChipKind(".gitignore")).toBe("plain");
  });
});

describe("FileChip — plain variant", () => {
  const url = "https://term.example.com/file/t1000/home/ubuntu/notes.md";

  it("renders as an anchor with the file URL as href", () => {
    render(<FileChip url={url} filename="notes.md" onOpen={vi.fn()} />);
    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(anchor.getAttribute("href")).toBe(url);
  });

  it("underlines the filename for affordance", () => {
    render(<FileChip url={url} filename="notes.md" onOpen={vi.fn()} />);
    // Look up the span by text; assert it carries the `underline` utility.
    const filenameSpan = screen.getByText("notes.md");
    expect(filenameSpan.className).toMatch(/underline/);
  });

  it("renders the file size when provided, omits it otherwise", () => {
    const { rerender } = render(
      <FileChip url={url} filename="notes.md" size={4200} onOpen={vi.fn()} />,
    );
    // 4200 bytes → 4.1 KB per formatHumanSize's one-decimal contract
    expect(screen.getByText(/4\.1 KB/)).toBeTruthy();
    rerender(<FileChip url={url} filename="notes.md" onOpen={vi.fn()} />);
    expect(screen.queryByText(/KB/)).toBeNull();
  });

  it("renders a Download button labeled with the filename", () => {
    render(<FileChip url={url} filename="notes.md" onOpen={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /download notes\.md/i }),
    ).toBeTruthy();
  });

  it("plain click fires onOpen and prevents default navigation", () => {
    const onOpen = vi.fn();
    render(<FileChip url={url} filename="notes.md" onOpen={onOpen} />);
    const anchor = screen.getByRole("link", { name: /notes\.md/i });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("download-button click does NOT fire onOpen", () => {
    const onOpen = vi.fn();
    const onDownload = vi.fn();
    render(
      <FileChip
        url={url}
        filename="notes.md"
        onOpen={onOpen}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download notes\.md/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("default download synthesizes a temporary anchor with `download` and clicks it", () => {
    // Stub appendChild/removeChild/click so we can assert the sequence
    // without actually pointing the browser at the file URL. The synthesized
    // anchor is appended to document.body, .click()'d, and removed.
    const url2 = "https://term.example.com/file/t1000/home/ubuntu/song.mp3";
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag) as HTMLElement;
        if (tag === "a") {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      });

    render(<FileChip url={url2} filename="song.mp3" onOpen={vi.fn()} />);
    // In-media chip: filename appears in the caption; use the button aria-label.
    fireEvent.click(screen.getByRole("button", { name: /download song\.mp3/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Multiple anchors get created during render (the chip's own outer
    // anchor is one). The synthesized download anchor is the LAST anchor
    // — createElement("a") calls from React's render happen first, and
    // our synthesized one fires only after the button click fires.
    const anchorResults = createSpy.mock.results.filter(
      (r) => (r.value as HTMLElement | undefined)?.tagName === "A",
    );
    const synthesized = anchorResults[anchorResults.length - 1]
      ?.value as HTMLAnchorElement | undefined;
    expect(synthesized).toBeTruthy();
    expect(synthesized!.download).toBe("song.mp3");
    expect(synthesized!.href).toBe(url2);

    createSpy.mockRestore();
  });
});

describe("FileChip — media variant", () => {
  it("renders an <img> for image kinds pointing at the URL", () => {
    const url = "https://term.example.com/file/t1000/home/ubuntu/photo.png";
    render(<FileChip url={url} filename="photo.png" onOpen={vi.fn()} />);
    const img = screen.getByRole("img", { name: "photo.png" }) as HTMLImageElement;
    expect(img.src).toBe(url);
  });

  it("renders an <img> for svg kinds pointing at the URL", () => {
    const url = "https://term.example.com/file/t1000/home/ubuntu/logo.svg";
    render(<FileChip url={url} filename="logo.svg" onOpen={vi.fn()} />);
    const img = screen.getByRole("img", { name: "logo.svg" }) as HTMLImageElement;
    expect(img.src).toBe(url);
  });

  it("renders a native <audio controls> for audio kinds", () => {
    const url = "https://term.example.com/file/t1000/home/ubuntu/song.mp3";
    const { container } = render(
      <FileChip url={url} filename="song.mp3" onOpen={vi.fn()} />,
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio!.getAttribute("src")).toBe(url);
    expect(audio!.hasAttribute("controls")).toBe(true);
  });

  it("renders a native <video controls> for video kinds without autoplay", () => {
    const url = "https://term.example.com/file/t1000/home/ubuntu/clip.mp4";
    const { container } = render(
      <FileChip url={url} filename="clip.mp4" onOpen={vi.fn()} />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe(url);
    expect(video!.hasAttribute("controls")).toBe(true);
    expect(video!.hasAttribute("autoplay")).toBe(false);
  });

  it("does NOT fire onOpen when the user interacts with the native audio controls", () => {
    // The chip's onClick walks up from event.target; if it hits an <audio>
    // before reaching the chip root, it bails out. This test simulates a
    // click on the audio element itself.
    const url = "https://term.example.com/file/t1000/home/ubuntu/song.mp3";
    const onOpen = vi.fn();
    const { container } = render(
      <FileChip url={url} filename="song.mp3" onOpen={onOpen} />,
    );
    const audio = container.querySelector("audio")!;
    fireEvent.click(audio);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("plain click on the surrounding media chip frame still fires onOpen", () => {
    const url = "https://term.example.com/file/t1000/home/ubuntu/photo.png";
    const onOpen = vi.fn();
    render(<FileChip url={url} filename="photo.png" onOpen={onOpen} />);
    // Click the anchor frame (the chip root) — the image inside is not an
    // audio/video element so the intercept fires normally.
    const anchor = screen.getAllByRole("link", { name: /photo\.png/i })[0];
    fireEvent.click(anchor);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("FileChip — diff preview", () => {
  it("renders the registry's diff preview for .patch files", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    try {
      const { container } = render(
        <FileChip url="https://x/file/h/fix.patch" filename="fix.patch" onOpen={vi.fn()} />,
      );
      expect(container.querySelector("[data-file-chip-kind='diff']")).not.toBeNull();
      expect(screen.getByTestId("diff-chip-preview")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
