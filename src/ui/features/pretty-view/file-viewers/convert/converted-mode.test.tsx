import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { BinaryDraft, FileModeViewProps } from "../registry";

const api = vi.hoisted(() => ({
  converterAvailable: vi.fn<() => Promise<boolean>>(),
  convertDocument: vi.fn<(bytes: Uint8Array, from: string, to: string) => Promise<Uint8Array>>(),
}));

vi.mock("@/api/document-convert-api", async () => {
  class DocumentConvertError extends Error {
    constructor(readonly reason: string) {
      super(reason === "unavailable" ? "The document converter isn't running on this Skynet server." : "This file couldn't be converted.");
    }
  }
  return { ...api, DocumentConvertError };
});

import { convertedMode } from "./converted-mode";

let innerProps: FileModeViewProps | null = null;
function FakeInner(props: FileModeViewProps): JSX.Element {
  innerProps = props;
  return <div data-testid="inner">{props.filename}</div>;
}

const origFetch = globalThis.fetch;
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  innerProps = null;
  api.converterAvailable.mockResolvedValue(true);
  api.convertDocument.mockImplementation(async (_b, _from, to) => new TextEncoder().encode(`as-${to}`));
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
  URL.createObjectURL = vi.fn(() => "blob:converted");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
  vi.clearAllMocks();
});

describe("convertedMode", () => {
  it("converts the file and renders the inner viewer on the result", async () => {
    const View = convertedMode({ target: "pdf", Inner: FakeInner, saveBack: false });
    const { unmount } = render(
      <View filename="decks/q3.pptx" src="/files/q3.pptx" content="" onChange={vi.fn()} onBinaryDraft={vi.fn()} />,
    );
    expect(screen.getByTestId("converted-loading").textContent).toContain(".pptx");
    await screen.findByTestId("inner");
    expect(globalThis.fetch).toHaveBeenCalledWith("/files/q3.pptx", expect.anything());
    expect(api.convertDocument).toHaveBeenCalledWith(expect.any(Uint8Array), "pptx", "pdf", expect.anything());
    expect(innerProps?.filename).toBe("q3.pdf");
    expect(innerProps?.src).toBe("blob:converted");
    // View-only: the inner viewer gets no draft handler, so nothing to save.
    expect(innerProps?.onBinaryDraft).toBeUndefined();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:converted");
  });

  it("explains a missing converter and offers the download, without fetching the file", async () => {
    api.converterAvailable.mockResolvedValue(false);
    const View = convertedMode({ target: "xlsx", Inner: FakeInner, saveBack: false });
    render(<View filename="old.xls" src="/files/old.xls" content="" onChange={vi.fn()} />);
    const notice = await screen.findByTestId("converted-notice");
    expect(notice.textContent).toMatch(/converter isn't running/i);
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("href")).toBe("/files/old.xls");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows a failed conversion as a notice", async () => {
    api.convertDocument.mockRejectedValue(new Error("This file couldn't be converted."));
    const View = convertedMode({ target: "docx", Inner: FakeInner, saveBack: true });
    render(<View filename="broken.doc" src="/f/broken.doc" content="" onChange={vi.fn()} />);
    expect((await screen.findByTestId("converted-notice")).textContent).toMatch(/couldn't be converted/);
  });

  it("saves edits by converting back to the original format", async () => {
    const onBinaryDraft = vi.fn<(d: BinaryDraft | null) => void>();
    const View = convertedMode({ target: "docx", Inner: FakeInner, saveBack: true });
    render(<View filename="memo.odt" src="/f/memo.odt" content="" onChange={vi.fn()} onBinaryDraft={onBinaryDraft} />);
    await screen.findByTestId("inner");
    expect(innerProps?.filename).toBe("memo.docx");

    const innerDraft = {
      getBytes: vi.fn(async () => new TextEncoder().encode("edited-docx")),
      markSaved: vi.fn(),
    };
    act(() => innerProps!.onBinaryDraft!(innerDraft));
    const hostDraft = onBinaryDraft.mock.calls.at(-1)![0]!;
    const bytes = await hostDraft.getBytes();
    expect(new TextDecoder().decode(bytes)).toBe("as-odt");
    expect(api.convertDocument).toHaveBeenLastCalledWith(expect.anything(), "docx", "odt");

    // The host marks the .odt bytes saved; the editor is told about its .docx.
    hostDraft.markSaved(bytes);
    expect(new TextDecoder().decode(innerDraft.markSaved.mock.calls[0][0])).toBe("edited-docx");

    act(() => innerProps!.onBinaryDraft!(null));
    expect(onBinaryDraft).toHaveBeenLastCalledWith(null);
  });

  it("when converting back fails, the save fails and a .docx copy is offered", async () => {
    const onBinaryDraft = vi.fn<(d: BinaryDraft | null) => void>();
    const View = convertedMode({ target: "docx", Inner: FakeInner, saveBack: true });
    render(<View filename="memo.doc" src="/f/memo.doc" content="" onChange={vi.fn()} onBinaryDraft={onBinaryDraft} />);
    await screen.findByTestId("inner");
    act(() =>
      innerProps!.onBinaryDraft!({
        getBytes: async () => new TextEncoder().encode("edited-docx"),
        markSaved: vi.fn(),
      }),
    );
    api.convertDocument.mockRejectedValueOnce(new Error("boom"));
    const hostDraft = onBinaryDraft.mock.calls.at(-1)![0]!;
    await act(async () => {
      await expect(hostDraft.getBytes()).rejects.toThrow(/Couldn't save your edits as \.doc/);
    });
    const banner = await screen.findByTestId("converted-saveback-failed");
    const button = screen.getByRole("button", { name: /save as memo\.docx/i });
    expect(banner).toBeTruthy();

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    act(() => button.click());
    expect(click).toHaveBeenCalled();
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Blob;
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe("edited-docx");
    click.mockRestore();

    // A later successful save clears the banner.
    await act(async () => {
      await hostDraft.getBytes();
    });
    await waitFor(() => expect(screen.queryByTestId("converted-saveback-failed")).toBeNull());
  });
});
