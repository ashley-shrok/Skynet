/**
 * Phase 40 Plan 40-03 Task 2 — EditableFileModal tests (14 total).
 *
 * Covers LOCKED decisions:
 *   - D-04 (fresh fetch at open; visible failure over silent stale — via
 *     in-body error copy only; toast layer removed per rev-2 /close 2026-08-14)
 *   - D-05 (chrome fork from GlobalFilesModal minus host picker + tabs bar;
 *     body reuses GlobalFileTab)
 *   - D-06 (editor stateless — mtime sentinel captured once; every save =
 *     fresh attachment)
 *   - UI-SPEC L167-169 draft-guard confirm gate (rev-2 explicit greenlight
 *     2026-08-14; tests 11-14)
 *
 * Tests:
 *   1. fetch fires exactly once on open (with expected URL)
 *   2. fetch does NOT fire when open=false
 *   3. success renders GlobalFileTab in ready state (textarea shows content)
 *   4. failure renders in-body error copy (in-modal error state — the ONLY
 *      "visible failure" surface; toast layer removed per rev-2)
 *   5. error-body Close button fires onOpenChange(false)
 *   6. save handler wiring — onStageEditedFile called w/ (filename,content),
 *      modal closes (composebox chip is the confirmation; toast removed rev-2)
 *   7. mtime sentinel stable (Pitfall 6 defense — typed content stays)
 *   8. portal target === document.body (Pitfall 7 defense)
 *   9. onInteractOutside guard prevents mousedown-close; Esc still closes
 *  10. state reset on close — re-open fires fetch again
 *  11. draft-guard: dirty + cancel confirm → stays open
 *  12. draft-guard: dirty + confirm → closes
 *  13. draft-guard: save-success close bypasses confirm
 *  14. draft-guard: clean close (no edits) does NOT prompt confirm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Hoisted module mocks ─────────────────────────────────────────────────────

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
}));

// ── Late imports (after mocks are registered) ────────────────────────────────

import EditableFileModal from "./EditableFileModal";
import { fetchTailnetUrl } from "@/api/editable-file-api";

// ── Fixture ──────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  messageEventId: "evt-1",
  url: "http://100.64.0.1:8000/notes.md",
  filename: "notes.md",
  agentIdentityName: "tanya",
  onStageEditedFile: vi.fn(),
};

const successFetch = () =>
  (fetchTailnetUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
    contentBase64: btoa("hello"),
    sizeBytes: 5,
    contentType: "text/plain",
    extension: "md",
    filename: "notes.md",
    isTextByExt: true,
  });

const failFetch = (msg = "boom") =>
  (fetchTailnetUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error(msg),
  );

describe("EditableFileModal — Phase 40 Plan 40-03 Task 2", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    DEFAULT_PROPS.onOpenChange = vi.fn();
    DEFAULT_PROPS.onStageEditedFile = vi.fn();
  });

  afterEach(() => {
    confirmSpy?.mockRestore?.();
  });

  it("test 1: fetch fires exactly once on open with the expected URL", async () => {
    successFetch();
    render(<EditableFileModal {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(fetchTailnetUrl).toHaveBeenCalledWith("http://100.64.0.1:8000/notes.md");
    });
    expect(fetchTailnetUrl).toHaveBeenCalledTimes(1);
  });

  it("test 2: fetch does NOT fire when open=false", async () => {
    successFetch();
    render(<EditableFileModal {...DEFAULT_PROPS} open={false} />);
    // Wait a tick to be sure any effect had a chance to fire
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchTailnetUrl).not.toHaveBeenCalled();
  });

  it("test 3: success renders GlobalFileTab in ready state (textarea seeded)", async () => {
    successFetch();
    render(<EditableFileModal {...DEFAULT_PROPS} />);
    const ta = await waitFor(() => screen.getByRole("textbox"));
    expect((ta as HTMLTextAreaElement).value).toBe("hello");
  });

  it("test 4: failure renders in-body error body (in-modal is the only visible-failure surface)", async () => {
    failFetch();
    render(<EditableFileModal {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText(/Can't fetch the current file/i)).toBeTruthy();
    });
    // UI-SPEC L110 verbatim body copy is present
    expect(
      screen.getByText(/temporary server may have shut down/i),
    ).toBeTruthy();
    // Rev-2 /close 2026-08-14: no parallel toast — the in-body error copy is
    // the sole "visible failure" surface. The toast layer sat at the app-wide
    // bottom-right anchor and would have occluded the composebox on mobile.
  });

  it("test 5: error-body Close button fires onOpenChange(false)", async () => {
    failFetch();
    const onOpenChange = vi.fn();
    render(<EditableFileModal {...DEFAULT_PROPS} onOpenChange={onOpenChange} />);
    const closeBtn = await waitFor(() =>
      screen.getByRole("button", { name: /^close$/i }),
    );
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("test 6: save wiring — onStageEditedFile(filename,content) + modal closes (composebox chip is the confirmation)", async () => {
    successFetch();
    const onStageEditedFile = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <EditableFileModal
        {...DEFAULT_PROPS}
        onStageEditedFile={onStageEditedFile}
        onOpenChange={onOpenChange}
      />,
    );
    const ta = (await waitFor(() =>
      screen.getByRole("textbox"),
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello world" } });
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await waitFor(() => {
      expect(onStageEditedFile).toHaveBeenCalledWith("notes.md", "hello world");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Rev-2 /close 2026-08-14: no save-success toast — the shape never asked
    // for ambient success feedback, and the toast anchor would have occluded
    // the composebox on mobile. The chip appearing in the composebox on save
    // is the confirmation.
  });

  it("test 7: mtime sentinel is stable — typed content survives re-renders (Pitfall 6)", async () => {
    successFetch();
    const { rerender } = render(<EditableFileModal {...DEFAULT_PROPS} />);
    const ta = (await waitFor(() =>
      screen.getByRole("textbox"),
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "typed content" } });
    expect(ta.value).toBe("typed content");
    // Force a re-render with the same props — if mtime were computed inline
    // per render, the useEffect in GlobalFileTab would re-seed the draft
    // back to state.data.content ("hello"). With a stable ref, mtime is
    // unchanged so the reseed does not fire.
    rerender(<EditableFileModal {...DEFAULT_PROPS} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(ta.value).toBe("typed content");
  });

  it("test 8: portal target === document.body (Pitfall 7)", async () => {
    successFetch();
    render(<EditableFileModal {...DEFAULT_PROPS} />);
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("test 9: onInteractOutside guard — outside mousedown does NOT close; Esc DOES close", async () => {
    successFetch();
    const onOpenChange = vi.fn();
    render(<EditableFileModal {...DEFAULT_PROPS} onOpenChange={onOpenChange} />);
    await waitFor(() => screen.getByRole("textbox"));
    // Simulate outside mousedown — the DialogContent's onInteractOutside
    // e.preventDefault() should suppress the close.
    fireEvent.mouseDown(document.body);
    // Allow radix's outside-interaction detector to process
    await new Promise((r) => setTimeout(r, 20));
    // No onOpenChange(false) from the outside click alone
    const outsideCloseCalls = onOpenChange.mock.calls.filter(
      (c) => c[0] === false,
    );
    expect(outsideCloseCalls.length).toBe(0);

    // Esc key on the dialog → radix routes to onOpenChange(false)
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => {
      const escCloses = onOpenChange.mock.calls.filter((c) => c[0] === false);
      expect(escCloses.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("test 10: state reset on close — reopening re-fires fetch", async () => {
    successFetch();
    const { rerender } = render(<EditableFileModal {...DEFAULT_PROPS} />);
    await waitFor(() => expect(fetchTailnetUrl).toHaveBeenCalledTimes(1));
    // Close
    rerender(<EditableFileModal {...DEFAULT_PROPS} open={false} />);
    await new Promise((r) => setTimeout(r, 20));
    // Re-open — fetch should re-fire (D-06 stateless — every open = fresh)
    rerender(<EditableFileModal {...DEFAULT_PROPS} open={true} />);
    await waitFor(() => expect(fetchTailnetUrl).toHaveBeenCalledTimes(2));
  });

  // ── Draft-guard confirm gate (UI-SPEC L167-169, rev-2 tests 11-14) ────────

  it("test 11: draft-guard — dirty + cancel confirm → modal stays open (onOpenChange NOT called with false)", async () => {
    successFetch();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onOpenChange = vi.fn();
    render(<EditableFileModal {...DEFAULT_PROPS} onOpenChange={onOpenChange} />);
    const ta = (await waitFor(() =>
      screen.getByRole("textbox"),
    )) as HTMLTextAreaElement;
    // Make draft dirty
    fireEvent.change(ta, { target: { value: "hello world" } });
    // Wait for GlobalFileTab's onDraftChange effect to fire (draft !== content)
    await new Promise((r) => setTimeout(r, 20));
    // Trigger a close via the header X button
    const xBtn = screen.getByRole("button", { name: /^close$/i });
    fireEvent.click(xBtn);
    // Confirm called with the exact copy per UI-SPEC L168
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    // Guard suppressed the close — no onOpenChange(false) call
    const closeCalls = onOpenChange.mock.calls.filter((c) => c[0] === false);
    expect(closeCalls.length).toBe(0);
  });

  it("test 12: draft-guard — dirty + confirm confirm → closes (onOpenChange called with false)", async () => {
    successFetch();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChange = vi.fn();
    render(<EditableFileModal {...DEFAULT_PROPS} onOpenChange={onOpenChange} />);
    const ta = (await waitFor(() =>
      screen.getByRole("textbox"),
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello world" } });
    await new Promise((r) => setTimeout(r, 20));
    const xBtn = screen.getByRole("button", { name: /^close$/i });
    fireEvent.click(xBtn);
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("test 13: draft-guard — save-success close bypasses confirm (savingRef)", async () => {
    successFetch();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onOpenChange = vi.fn();
    const onStageEditedFile = vi.fn();
    render(
      <EditableFileModal
        {...DEFAULT_PROPS}
        onOpenChange={onOpenChange}
        onStageEditedFile={onStageEditedFile}
      />,
    );
    const ta = (await waitFor(() =>
      screen.getByRole("textbox"),
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello world" } });
    await new Promise((r) => setTimeout(r, 20));
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    // Save path called onOpenChange(false) directly — confirm NOT invoked
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onStageEditedFile).toHaveBeenCalled();
  });

  it("test 14: draft-guard — clean close (no edits) does NOT prompt confirm", async () => {
    successFetch();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenChange = vi.fn();
    render(<EditableFileModal {...DEFAULT_PROPS} onOpenChange={onOpenChange} />);
    // Wait for load — do NOT type
    await waitFor(() => screen.getByRole("textbox"));
    // Give the initial onDraftChange(false) time to fire
    await new Promise((r) => setTimeout(r, 20));
    const xBtn = screen.getByRole("button", { name: /^close$/i });
    fireEvent.click(xBtn);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
