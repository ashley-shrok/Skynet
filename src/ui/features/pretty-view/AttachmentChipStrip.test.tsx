import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttachmentChipStrip } from "./AttachmentChipStrip";
import type { StagedAttachmentLike } from "./AttachmentChipStrip";

function makeAtt(overrides: Partial<StagedAttachmentLike> = {}): StagedAttachmentLike {
  return {
    tempId: overrides.tempId ?? "t1",
    file: overrides.file ?? { name: "log.txt", size: 12345, type: "text/plain" },
    status: overrides.status ?? "staged",
    bytesUploaded: overrides.bytesUploaded ?? 0,
    error: overrides.error ?? null,
  };
}

describe("AttachmentChipStrip", () => {
  it("Test 1: returns null (no wrapper) when attachments is empty", () => {
    const { container } = render(
      <AttachmentChipStrip attachments={[]} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Test 2: renders exactly one chip per attachment", () => {
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({ tempId: "a" }),
          makeAtt({ tempId: "b" }),
          makeAtt({ tempId: "c" }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const chips = screen.getAllByTestId("attachment-chip");
    expect(chips).toHaveLength(3);
  });

  it("Test 3: chip content includes filename, human size, and a remove button with aria-label", () => {
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({
            tempId: "x",
            file: { name: "log.txt", size: 2048, type: "text/plain" },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/log\.txt/)).toBeTruthy();
    // 2048 bytes → "2.0 KB" per formatHumanSize
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
    expect(screen.getByLabelText(/Remove attachment log\.txt/i)).toBeTruthy();
  });

  it("Test 4: clicking the × button invokes onRemove with the chip's tempId", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({ tempId: "a", file: { name: "one.txt", size: 100, type: "text/plain" } }),
          makeAtt({ tempId: "b", file: { name: "two.txt", size: 200, type: "text/plain" } }),
        ]}
        onRemove={onRemove}
      />,
    );
    const btn = screen.getByLabelText(/Remove attachment two\.txt/i);
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("b");
  });

  it("Test 5: uploading chip shows progress indicator at correct percentage", () => {
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({
            tempId: "p",
            status: "uploading",
            bytesUploaded: 32768,
            file: { name: "x.bin", size: 65536, type: "application/octet-stream" },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("Test 6: error status turns chip red and surfaces error text via title/text", () => {
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({
            tempId: "e",
            status: "error",
            error: "sftp_error: connection lost",
            file: { name: "bad.txt", size: 10, type: "text/plain" },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("attachment-chip");
    // Either className carries destructive/red OR data-status="error" attr.
    const cls = chip.className ?? "";
    const dataStatus = chip.getAttribute("data-status");
    expect(cls.includes("destructive") || dataStatus === "error").toBe(true);
    // Error text is available somewhere in the chip (title attr or visible)
    const chipHtml = chip.outerHTML;
    expect(chipHtml.includes("sftp_error") || chipHtml.includes("connection lost")).toBe(true);
  });

  it("Test 7: complete status renders a completion glyph (data-status=complete)", () => {
    render(
      <AttachmentChipStrip
        attachments={[
          makeAtt({
            tempId: "c",
            status: "complete",
            bytesUploaded: 65536,
            file: { name: "done.bin", size: 65536, type: "application/octet-stream" },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const chip = screen.getByTestId("attachment-chip");
    expect(chip.getAttribute("data-status")).toBe("complete");
    // Progress bar should NOT render for completed files.
    const bars = screen.queryAllByRole("progressbar");
    expect(bars).toHaveLength(0);
  });

  // Phase 05 Plan 03: readOnly prop for sender-side chip render in
  // ChatMessage. Chips echo an already-sent injected user turn — no
  // × remove, no progress ring, no error decorations.
  it("Test 8: readOnly=true hides the × remove button, progress ring, and error UI", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChipStrip
        attachments={[
          {
            tempId: "sent-1",
            file: { name: "screenshot.png", size: 20480, type: "image/png" },
            status: "complete",
            bytesUploaded: 20480,
            error: null,
          },
        ]}
        onRemove={onRemove}
        readOnly={true}
      />,
    );
    // Filename + size still render (chip is chips-only, filename + size ONLY).
    expect(screen.getByText(/screenshot\.png/)).toBeTruthy();
    expect(screen.getByText(/20\.0 KB/)).toBeTruthy();
    // × remove button MUST NOT render in readOnly mode.
    expect(
      screen.queryByLabelText(/Remove attachment screenshot\.png/i),
    ).toBeNull();
    // Progress bar MUST NOT render either.
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("Test 9: readOnly=true with error status still hides destructive glyph (sender-side never shows errored chips)", () => {
    // Sender-side rendering only happens after the whole batch succeeded
    // (upload_ready_to_inject only fires on all-complete), so error-state
    // chips should never actually reach the read-only render. Verify the
    // component tolerates the case defensively without leaking chrome.
    const onRemove = vi.fn();
    render(
      <AttachmentChipStrip
        attachments={[
          {
            tempId: "sent-e",
            file: { name: "bad.txt", size: 10, type: "text/plain" },
            status: "error",
            bytesUploaded: 0,
            error: "sftp_error",
          },
        ]}
        onRemove={onRemove}
        readOnly={true}
      />,
    );
    // No × button.
    expect(screen.queryByLabelText(/Remove attachment bad\.txt/i)).toBeNull();
    // No AlertCircle aria-label surfaced.
    expect(screen.queryByLabelText(/Upload failed/i)).toBeNull();
  });
});
