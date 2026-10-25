// shape-interrupt-button — ComposeBox side: the interrupt button greys out
// while a send is still being delivered, and a cancelled send's words come
// back into the primary box — above anything typed since.

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

describe("ComposeBox — interrupt button availability", () => {
  afterEach(() => vi.restoreAllMocks());

  it("greyed out while a send is being delivered: disabled, click does nothing, label unchanged", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt, agentWorking: true, interruptDisabled: true })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Stop");
    fireEvent.click(btn);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("available otherwise", () => {
    const onInterrupt = vi.fn();
    render(<ComposeBox {...baseProps({ onInterrupt, agentWorking: true, interruptDisabled: false })} />);
    const btn = screen.getByRole("button", { name: "Interrupt" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  // Stop is never out of reach: "working" can lag or miss a turn.
  it("while idle: the thumbs-up is the main button, with a quiet Stop beside it", () => {
    render(<ComposeBox {...baseProps({ onInterrupt: vi.fn(), agentWorking: false })} />);
    expect(screen.getByRole("button", { name: "Interrupt" }).getAttribute("data-main")).toBeNull();
    expect(screen.getByRole("button", { name: "Send 'thumbs up'" }).getAttribute("data-main")).toBe("true");
  });

  it("while an aside is up: Resume is the main button, with a quiet Stop beside it", () => {
    render(<ComposeBox {...baseProps({ onInterrupt: vi.fn(), asideActive: true })} />);
    expect(screen.getByRole("button", { name: "Resume" }).getAttribute("data-main")).toBe("true");
    expect(screen.getByRole("button", { name: "Interrupt" }).getAttribute("data-main")).toBeNull();
  });

  it("while working: Stop is the main button with nothing typed, and steps aside next to Send while typing", () => {
    render(<ComposeBox {...baseProps({ onInterrupt: vi.fn(), agentWorking: true })} />);
    expect(screen.getByRole("button", { name: "Interrupt" }).getAttribute("data-main")).toBe("true");
    expect(screen.queryByRole("button", { name: "Send 'thumbs up'" })).toBeNull();
    fireEvent.change(primary(), { target: { value: "more" } });
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("data-main")).toBe("true");
    expect(screen.getByRole("button", { name: "Interrupt" }).getAttribute("data-main")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send 'thumbs up'" })).toBeNull();
  });

  it("while Claude Code waits on a dialog: a quiet Stop sits before the thumbs-up", () => {
    render(<ComposeBox {...baseProps({ onInterrupt: vi.fn(), agentWaiting: true })} />);
    const stop = screen.getByRole("button", { name: "Interrupt" });
    const thumbs = screen.getByRole("button", { name: "Send 'thumbs up'" });
    expect(stop.getAttribute("data-main")).toBeNull();
    expect(thumbs.getAttribute("data-main")).toBe("true");
    // eslint-disable-next-line no-bitwise
    expect(stop.compareDocumentPosition(thumbs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the Stop feedback chip keeps Stop's place after working drops", () => {
    const { rerender } = render(
      <ComposeBox {...baseProps({ onInterrupt: vi.fn(), agentWorking: true })} />,
    );
    // The press is answered: working drops while the feedback shows.
    rerender(
      <ComposeBox {...baseProps({ onInterrupt: vi.fn(), agentWorking: false, interruptFeedback: "stopped" })} />,
    );
    expect(screen.getByTestId("interrupt-feedback").getAttribute("data-feedback")).toBe("stopped");
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
    // The thumbs-up does not take the main slot under a second tap.
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
