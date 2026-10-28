// shape-interrupt-button — ComposeBox side: a cancelled send's words come
// back into the primary box — above anything typed since. And since
// shape-stop-on-orb, no Stop in the compose box at all.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

const primary = () => screen.getByPlaceholderText("Write a message…") as HTMLTextAreaElement;

// shape-stop-on-orb: the working orb is the Stop — the compose box has none,
// in any state.
describe("ComposeBox — no Stop", () => {
  afterEach(() => vi.restoreAllMocks());

  const noStop = () => {
    expect(document.querySelector('[data-action="stop"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  };

  it("nothing typed: the thumbs-up is the main button, alone", () => {
    render(<ComposeBox {...baseProps()} />);
    noStop();
    expect(screen.getByRole("button", { name: "Send 'thumbs up'" }).getAttribute("data-main")).toBe("true");
  });

  it("typing: Send is the main button with a quiet thumbs-up beside it", () => {
    render(<ComposeBox {...baseProps()} />);
    fireEvent.change(primary(), { target: { value: "more" } });
    noStop();
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("data-main")).toBe("true");
    expect(screen.getByRole("button", { name: "Send 'thumbs up'" }).getAttribute("data-main")).toBeNull();
  });

  it("an aside up: Resume is the main button, alone", () => {
    render(<ComposeBox {...baseProps({ asideActive: true })} />);
    noStop();
    expect(screen.getByRole("button", { name: "Resume" }).getAttribute("data-main")).toBe("true");
    expect(screen.queryByRole("button", { name: "Send 'thumbs up'" })).toBeNull();
  });
});

describe("ComposeBox — giving back a cancelled send", () => {
  afterEach(() => vi.restoreAllMocks());

  it("empty primary box → the words go back into it", () => {
    const onRestoreApplied = vi.fn();
    const { rerender } = render(<ComposeBox {...baseProps({ onRestoreApplied })} />);
    rerender(
      <ComposeBox
        {...baseProps({ onRestoreApplied, restoreRequest: { id: "e1", text: "write me a poem" } })}
      />,
    );
    expect(primary().value).toBe("write me a poem");
    expect(onRestoreApplied).toHaveBeenCalledWith("e1", "primary");
  });

  it("user already typing → the words go above the draft, a blank line between", () => {
    const onRestoreApplied = vi.fn();
    const { rerender } = render(<ComposeBox {...baseProps({ onRestoreApplied })} />);
    fireEvent.change(primary(), { target: { value: "something new" } });
    rerender(
      <ComposeBox
        {...baseProps({ onRestoreApplied, restoreRequest: { id: "e2", text: "the cancelled words" } })}
      />,
    );
    expect(primary().value).toBe("the cancelled words\n\nsomething new");
    expect(onRestoreApplied).toHaveBeenCalledTimes(1);
    expect(onRestoreApplied).toHaveBeenCalledWith("e2", "primary");
  });

  it("staged attachments on the primary box stay; the words still land there", () => {
    const onRestoreApplied = vi.fn();
    const staged = [
      { tempId: "t1", file: { name: "a.png", size: 1, type: "image/png" }, status: "staged" as const, bytesUploaded: 0, error: null },
    ];
    const { rerender } = render(
      <ComposeBox {...baseProps({ onRestoreApplied, stagedAttachments: staged })} />,
    );
    rerender(
      <ComposeBox
        {...baseProps({
          onRestoreApplied,
          stagedAttachments: staged,
          restoreRequest: { id: "e3", text: "words" },
        })}
      />,
    );
    expect(primary().value).toBe("words");
    expect(onRestoreApplied).toHaveBeenCalledWith("e3", "primary");
  });

  it("a files-only send gives no words back: the draft stays exactly as typed", () => {
    const onRestoreApplied = vi.fn();
    const { rerender } = render(<ComposeBox {...baseProps({ onRestoreApplied })} />);
    fireEvent.change(primary(), { target: { value: "my draft" } });
    rerender(<ComposeBox {...baseProps({ onRestoreApplied, restoreRequest: { id: "e5", text: "  " } })} />);
    expect(primary().value).toBe("my draft");
    expect(onRestoreApplied).toHaveBeenCalledWith("e5", "primary");
  });

  it("trailing blank lines on the cancelled words don't widen the gap above the draft", () => {
    const { rerender } = render(<ComposeBox {...baseProps()} />);
    fireEvent.change(primary(), { target: { value: "new" } });
    rerender(<ComposeBox {...baseProps({ restoreRequest: { id: "e6", text: "old\n\n\n" } })} />);
    expect(primary().value).toBe("old\n\nnew");
  });

  it("each request is applied once, even across re-renders", () => {
    const onRestoreApplied = vi.fn();
    const req = { id: "e4", text: "once" };
    const { rerender } = render(<ComposeBox {...baseProps({ onRestoreApplied, restoreRequest: req })} />);
    rerender(<ComposeBox {...baseProps({ onRestoreApplied, restoreRequest: { ...req } })} />);
    expect(onRestoreApplied).toHaveBeenCalledTimes(1);
  });
});
