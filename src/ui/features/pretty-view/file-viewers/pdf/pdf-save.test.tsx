/**
 * Binary-draft save path (PDF annotations), end to end through FileView and
 * EditableFileModal. The real PdfView embeds pdf.js in an iframe, which
 * jsdom can't run; a stand-in reports a BinaryDraft the way it does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BinaryDraft, FileModeViewProps } from "../registry";

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
const markSaved = vi.fn();

vi.mock("./PdfView", () => ({
  PdfView: ({ onBinaryDraft }: FileModeViewProps) => (
    <button
      type="button"
      data-testid="fake-annotate"
      onClick={() => {
        const draft: BinaryDraft = { getBytes: async () => BYTES, markSaved };
        onBinaryDraft?.(draft);
      }}
    >
      annotate
    </button>
  ),
}));
vi.mock("./PdfChipPreview", () => ({ PdfChipPreview: () => null }));
vi.mock("@/api/editable-file-api", () => ({ fetchTailnetUrl: vi.fn(), fetchHostFileUrl: vi.fn() }));

import { FileView } from "../FileView";
import EditableFileModal from "../../EditableFileModal";
import { fetchHostFileUrl } from "@/api/editable-file-api";

beforeEach(() => vi.clearAllMocks());

describe("FileView — binary drafts", () => {
  it("reports dirty + the draft, and its own Save writes bytes then marks saved", async () => {
    const onDraftChange = vi.fn();
    const onBinaryDraftChange = vi.fn();
    const onSaveBytes = vi.fn(async () => {});
    render(
      <FileView
        filename="spec.pdf"
        state={{ status: "loading" }}
        mediaUrl="/x/spec.pdf"
        onDraftChange={onDraftChange}
        onBinaryDraftChange={onBinaryDraftChange}
        onSaveBytes={onSaveBytes}
      />,
    );
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    fireEvent.click(screen.getByTestId("fake-annotate"));
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(true));
    expect(onBinaryDraftChange.mock.lastCall?.[0]).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(markSaved).toHaveBeenCalledWith(BYTES));
    expect(onSaveBytes).toHaveBeenCalledWith(BYTES, 0);
  });
});

describe("EditableFileModal — PDF", () => {
  it("opens without fetching, shows a disabled Save, and stages the edited bytes", async () => {
    const onStageEditedFile = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <EditableFileModal
        open
        onOpenChange={onOpenChange}
        messageEventId="e1"
        url="https://term.example.com/file/t1000/home/u/spec.pdf"
        filename="spec.pdf"
        agentIdentityName={null}
        onStageEditedFile={onStageEditedFile}
      />,
    );
    const save = (await screen.findByTestId("editable-file-modal-save")) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(fetchHostFileUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("fake-annotate"));
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onStageEditedFile).toHaveBeenCalledWith("spec.pdf", BYTES));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
