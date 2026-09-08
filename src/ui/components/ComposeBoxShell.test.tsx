/**
 * Phase 90 Plan 02 Task 2 — ComposeBoxShell primitive tests.
 *
 * ComposeBoxShell is a shared primitive COPY-extracted from ComposeBox.tsx's
 * Row 2 (textarea + Send button, L2683-3113). Row 1 (meter/reset/queue/stop/
 * thumbs-up/recap) is NOT extracted — it's PrettyView-specific per D-04.
 * Instead, the shell exposes `upperArea?: ReactNode` + `attachButton?: ReactNode`
 * slot props so pretty view (future convergence slice) could fill Row 1 and
 * the relay pane (Plan 06) passes null per D-04/D-05.
 *
 * Extraction discipline (D-03): pretty view's ComposeBox stays byte-untouched;
 * this primitive is a standalone COPY.
 */
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ComposeBoxShell, type ComposeBoxShellProps } from "./ComposeBoxShell";

/**
 * Controlled harness that wires local state into the shell — mirrors how a
 * pane orchestrator would consume the primitive.
 */
function Harness(props: Partial<ComposeBoxShellProps> & { initial?: string; onSend?: (t: string) => void }) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <ComposeBoxShell
      value={value}
      onChange={setValue}
      onSend={(t) => props.onSend?.(t)}
      upperArea={props.upperArea}
      attachButton={props.attachButton}
      placeholder={props.placeholder}
      canSend={props.canSend}
      className={props.className}
    />
  );
}

describe("ComposeBoxShell", () => {
  it("Test 1: renders textarea + Send button; typing updates controlled value", () => {
    render(<Harness />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    // Send button present
    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    expect(sendBtn).toBeInTheDocument();
    // Type into the textarea
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect((textarea as HTMLTextAreaElement).value).toBe("hello");
  });

  it("Test 2: Enter (no shift) fires onSend with trimmed value AND clears textarea; Shift+Enter does NOT fire onSend", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial="hello world" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Enter without shift → fires
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world");
    // Textarea cleared after send
    expect(textarea.value).toBe("");

    onSend.mockClear();
    // Type again then Shift+Enter → does NOT fire onSend
    fireEvent.change(textarea, { target: { value: "second" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("second");
  });

  it("Test 3: empty / whitespace-only text — Enter does NOT fire onSend; Send button is disabled", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial="   " />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
    // Send button disabled with whitespace-only text
    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    expect(sendBtn).toBeDisabled();
  });

  it("Test 4: canSend={false} disables Send button regardless of typed text", () => {
    render(<Harness initial="not empty" canSend={false} />);
    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    expect(sendBtn).toBeDisabled();
  });

  it("Test 5: upperArea slot renders provided node above textarea; undefined renders nothing", () => {
    const { rerender } = render(
      <Harness upperArea={<div data-testid="upper">upper-content</div>} />,
    );
    const upper = screen.getByTestId("upper");
    expect(upper).toBeInTheDocument();
    // Order: upperArea should appear BEFORE the textarea in the DOM.
    const textarea = screen.getByRole("textbox");
    // compareDocumentPosition returns 4 (FOLLOWING) when upper precedes textarea.
    expect(upper.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<Harness upperArea={undefined} />);
    expect(screen.queryByTestId("upper")).toBeNull();
  });

  it("Test 6: attachButton slot renders provided node; undefined renders nothing", () => {
    const { rerender } = render(
      <Harness attachButton={<button data-testid="attach">A</button>} />,
    );
    expect(screen.getByTestId("attach")).toBeInTheDocument();

    rerender(<Harness attachButton={undefined} />);
    expect(screen.queryByTestId("attach")).toBeNull();
  });

  it("Test 7: placeholder prop propagates; default 'Type a message…' when unset", () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Type a message…");

    rerender(<Harness placeholder="Say something..." />);
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("Say something...");
  });

  it("Test 8: click on Send button with valid text fires onSend with trimmed value", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial="  padded  " />);
    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("padded");
    // Cleared
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});
