/**
 * The kit — shared modal parts (apple-ux look A). Behaviour, not looks:
 * dialogs resolve the way the browser pop-ups they replace did, fields wire
 * their labels/errors, the search box owns Esc while it has text, list rows
 * don't fire when their own controls are used, the host picker picks, and a
 * phone sheet closes on a swipe only while nothing has been typed in it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { Modal, ModalHead, ModalBody } from "@/components/modal";
import {
  KitButton,
  KitField,
  KitInput,
  KitSearch,
  KitListRow,
  KitHostPicker,
  KitSegmented,
  KitSwitch,
  KitSettingsRow,
  kitConfirm,
  kitPrompt,
  kitAlert,
  kitConfirmIdentity,
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
} from "./index";
import { READY_SPINNER_DELAY_MS } from "./dialogs";

const realMatchMedia = window.matchMedia;

function setPhone(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  act(() => __resetKitDialogsForTests());
});

describe("kit dialogs (replace window.confirm / prompt / alert)", () => {
  it("confirm resolves true on the main button", async () => {
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirm({ title: "Delete skill?", body: "Can't undo.", confirmLabel: "Delete", destructive: true });
    });
    const btn = await screen.findByTestId("kit-dialog-confirm");
    expect(btn).toHaveTextContent("Delete");
    expect(btn).toHaveAttribute("data-variant", "danger");
    expect(screen.getByText("Can't undo.")).toBeInTheDocument();
    fireEvent.click(btn);
    await expect(p).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByTestId("kit-confirm-dialog")).toBeNull());
  });

  it("confirm with `ready`: opens at once, greyed out (spinner after a beat) until ready, then shows the ready body", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let release!: (r: { body?: string }) => void;
      const ready = new Promise<{ body?: string }>((r) => (release = r));
      let p!: Promise<boolean>;
      act(() => {
        p = kitConfirm({ title: "Archive it?", body: "First text.", ready, confirmLabel: "Archive", destructive: true });
      });
      const btn = await screen.findByTestId("kit-dialog-confirm");
      expect(screen.getByText("First text.")).toBeInTheDocument();
      expect(btn).toBeDisabled();
      expect(btn).not.toHaveAttribute("aria-busy");
      // Enter on the form does nothing while it isn't ready.
      fireEvent.submit(btn.closest("form")!);
      act(() => {
        vi.advanceTimersByTime(READY_SPINNER_DELAY_MS);
      });
      expect(btn).toHaveAttribute("aria-busy", "true");
      await act(async () => {
        release({ body: "Full text with the warning." });
      });
      expect(screen.getByText("Full text with the warning.")).toBeInTheDocument();
      expect(screen.queryByText("First text.")).toBeNull();
      expect(btn).toBeEnabled();
      expect(btn).not.toHaveAttribute("aria-busy");
      fireEvent.click(btn);
      await expect(p).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirm with `ready`: a quick answer never shows the spinner; Cancel works before it's ready; a failure just turns the button on", async () => {
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirm({ title: "Quick?", body: "Body.", ready: Promise.resolve() });
    });
    const btn = await screen.findByTestId("kit-dialog-confirm");
    await waitFor(() => expect(btn).toBeEnabled());
    expect(btn).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("Body.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kit-dialog-cancel"));
    await expect(p).resolves.toBe(false);

    let q!: Promise<boolean>;
    act(() => {
      q = kitConfirm({ title: "Slow?", ready: new Promise(() => {}) });
    });
    expect(await screen.findByTestId("kit-dialog-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("kit-dialog-cancel"));
    await expect(q).resolves.toBe(false);

    let r!: Promise<boolean>;
    act(() => {
      r = kitConfirm({ title: "Broken?", body: "Kept.", ready: Promise.reject(new Error("x")) });
    });
    const b3 = await screen.findByTestId("kit-dialog-confirm");
    await waitFor(() => expect(b3).toBeEnabled());
    expect(screen.getByText("Kept.")).toBeInTheDocument();
    fireEvent.click(b3);
    await expect(r).resolves.toBe(true);
  });

  it("auto-answer waits for `ready` and records the body that was answered", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    let release!: () => void;
    const ready = new Promise<{ body: string }>((r) => (release = () => r({ body: "After." })));
    const p = kitConfirm({ title: "T", body: "Before.", ready });
    await Promise.resolve();
    expect(dialogs.calls).toHaveLength(0);
    release();
    await expect(p).resolves.toBe(true);
    expect(dialogs.calls[0].opts.body).toBe("After.");
  });

  it("confirm resolves false on Cancel and on Esc", async () => {
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirm({ title: "Sure?" });
    });
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await expect(p).resolves.toBe(false);

    let q!: Promise<boolean>;
    act(() => {
      q = kitConfirm({ title: "Again?" });
    });
    await screen.findByTestId("kit-confirm-dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await expect(q).resolves.toBe(false);
  });

  it("prompt returns the typed value, null on cancel, and blocks on validation", async () => {
    let p!: Promise<string | null>;
    act(() => {
      p = kitPrompt({
        title: "New file",
        defaultValue: "notes",
        validate: (v) => (v.includes("/") ? "No slashes." : null),
      });
    });
    const input = (await screen.findByTestId("kit-prompt-input")) as HTMLInputElement;
    expect(input.value).toBe("notes");
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]));
    fireEvent.change(input, { target: { value: "a/b" } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    expect(await screen.findByText("No slashes.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "reference.md" } });
    fireEvent.submit(input.closest("form")!);
    await expect(p).resolves.toBe("reference.md");

    let q!: Promise<string | null>;
    act(() => {
      q = kitPrompt({ title: "Name" });
    });
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await expect(q).resolves.toBeNull();
  });

  it("alert has a single OK and queues behind an open dialog", async () => {
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = kitAlert({ title: "First" });
      b = kitAlert({ title: "Second" });
    });
    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.queryByText("Second")).toBeNull();
    expect(screen.queryByTestId("kit-dialog-cancel")).toBeNull();
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    await a;
    expect(await screen.findByText("Second")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    await b;
  });

  it("puts focus back on what opened it", async () => {
    render(<button data-testid="opener">Delete</button>);
    const opener = screen.getByTestId("opener");
    opener.focus();
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirm({ title: "Delete it?" });
    });
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await p;
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("kit Confirm it's you", () => {
  it("asks for password and code, shows a refusal, and resolves true once accepted", async () => {
    const submit = vi
      .fn<(pw: string, code: string) => Promise<string | null>>()
      .mockResolvedValueOnce("Incorrect password")
      .mockResolvedValueOnce(null);
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirmIdentity({ needsCode: true, submit });
    });
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument();
    const pw = screen.getByTestId("kit-identity-password") as HTMLInputElement;
    const code = screen.getByTestId("kit-identity-code") as HTMLInputElement;
    expect(pw.type).toBe("password");

    // Nothing typed: blocked before asking the server.
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    expect(await screen.findByText("Enter your password.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(pw, { target: { value: "wrong" } });
    fireEvent.change(code, { target: { value: " 123456 " } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
    expect(submit).toHaveBeenLastCalledWith("wrong", "123456");

    fireEvent.change(pw, { target: { value: "right" } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    await expect(p).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByTestId("kit-identity-dialog")).toBeNull());
  });

  it("has no code field without two-step codes, and resolves false on Cancel", async () => {
    const submit = vi.fn();
    let p!: Promise<boolean>;
    act(() => {
      p = kitConfirmIdentity({ needsCode: false, submit });
    });
    await screen.findByTestId("kit-identity-password");
    expect(screen.queryByTestId("kit-identity-code")).toBeNull();
    fireEvent.click(screen.getByTestId("kit-dialog-cancel"));
    await expect(p).resolves.toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("shares one box between actions waiting at the same time", async () => {
    const submit = vi.fn().mockResolvedValue(null);
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = kitConfirmIdentity({ needsCode: false, submit });
      b = kitConfirmIdentity({ needsCode: false, submit });
    });
    fireEvent.change(await screen.findByTestId("kit-identity-password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("kit-dialog-confirm"));
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("auto-answers in tests through submit", async () => {
    const dialogs = autoAnswerKitDialogs({ identity: { password: "pw", code: "1" } });
    const submit = vi.fn().mockResolvedValue(null);
    await expect(kitConfirmIdentity({ needsCode: true, submit })).resolves.toBe(true);
    expect(submit).toHaveBeenCalledWith("pw", "1");
    expect(dialogs.calls[0].kind).toBe("identity");
  });
});

describe("kit fields", () => {
  it("wires label, help and error onto the control", () => {
    render(
      <KitField label="Slug" error="Lowercase only.">
        <KitInput defaultValue="Bad!" />
      </KitField>,
    );
    const input = screen.getByLabelText("Slug");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Lowercase only.");
  });

  it("search clears on Esc and marks itself as owning Esc while it has text", () => {
    function H() {
      const [v, setV] = useState("abc");
      return <KitSearch value={v} onValueChange={setV} aria-label="Search" />;
    }
    render(<H />);
    const input = screen.getByLabelText("Search");
    expect(input).toHaveAttribute("data-modal-esc-local");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("data-modal-esc-local");
  });
});

describe("kit rows and choices", () => {
  it("list row activates on click/Enter but not from its own controls", () => {
    const onActivate = vi.fn();
    const onMenu = vi.fn();
    render(
      <KitListRow
        title="garden-keeper"
        subtitle="Keeps the plant log"
        onActivate={onActivate}
        menu={<button type="button" onClick={onMenu}>menu</button>}
      />,
    );
    fireEvent.click(screen.getByText("menu"));
    expect(onMenu).toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("garden-keeper"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    // The avatar + text are a real button (keyboard comes free) and the
    // row's own controls sit beside it, not inside it.
    const main = screen.getByRole("button", { name: /garden-keeper/ });
    expect(main).not.toContainElement(screen.getByText("menu"));
    fireEvent.click(main);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("host picker filters and selects", () => {
    const onSelect = vi.fn();
    render(
      <KitHostPicker
        hosts={[
          { id: "1", name: "Skynet", status: "ok" },
          { id: "2", name: "boreal", status: "ok" },
          { id: "3", name: "workstation", status: "warn" },
          { id: "4", name: "robin-laptop", status: "off" },
          { id: "5", name: "minipc", status: "off", disabled: true },
        ]}
        selectedId="1"
        onSelect={onSelect}
        testIdPrefix="hp"
      />,
    );
    expect(screen.getByTestId("hp-option-1")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("hp-option-5")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Search hosts"), { target: { value: "work" } });
    expect(screen.queryByTestId("hp-option-2")).toBeNull();
    fireEvent.click(screen.getByTestId("hp-option-3"));
    expect(onSelect).toHaveBeenCalledWith("3");
  });

  it("segmented control, switch and settings row report changes", () => {
    const onSeg = vi.fn();
    const onSw = vi.fn();
    const onRow = vi.fn();
    render(
      <>
        <KitSegmented
          options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]}
          value="daily"
          onValueChange={onSeg}
          testIdPrefix="kind"
        />
        <KitSwitch checked={false} onCheckedChange={onSw} aria-label="Enabled" />
        <KitSettingsRow label="Send phrase" value='"send it"' onClick={onRow} />
      </>,
    );
    expect(screen.getByTestId("kind-daily")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("kind-weekly"));
    expect(onSeg).toHaveBeenCalledWith("weekly");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(onSw).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /Send phrase/ }));
    expect(onRow).toHaveBeenCalled();
  });

  it("segmented control: compact size and per-option hover text (why a segment is off)", () => {
    const onSeg = vi.fn();
    render(
      <KitSegmented
        size="sm"
        aria-label="View"
        options={[
          { value: "a", label: "A", disabled: true, title: "Not for this file" },
          { value: "b", label: "B" },
        ]}
        value="b"
        onValueChange={onSeg}
        testIdPrefix="v"
      />,
    );
    expect(screen.getByRole("group", { name: "View" })).toHaveAttribute("data-size", "sm");
    expect(screen.getByTestId("v-a")).toHaveAttribute("title", "Not for this file");
    expect(screen.getByTestId("v-a")).toBeDisabled();
    expect(screen.getByTestId("v-b")).not.toHaveAttribute("title");
    fireEvent.click(screen.getByTestId("v-a"));
    expect(onSeg).not.toHaveBeenCalled();
  });

  it("a settings row announces pressed on its button, in both layouts", () => {
    render(
      <>
        <KitSettingsRow label="Plain" onClick={() => {}} pressed />
        <KitSettingsRow label="Split" onClick={() => {}} pressed={false} control={<span>x</span>} />
        <KitSettingsRow label="Untoggled" onClick={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: /Plain/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Split/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Untoggled/ })).not.toHaveAttribute("aria-pressed");
  });

  it("busy button is disabled and announces it", () => {
    render(<KitButton variant="primary" busy>Saving…</KitButton>);
    const b = screen.getByRole("button", { name: /Saving/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
});

describe("phone sheets", () => {
  function SheetHarness({ size = "md" as const }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <span data-testid="state">{open ? "open" : "closed"}</span>
        <Modal open={open} onOpenChange={setOpen} size={size}>
          <ModalHead title="New project" />
          <ModalBody>
            <KitInput aria-label="Name" />
          </ModalBody>
        </Modal>
      </>
    );
  }

  const swipe = (dy: number) => {
    const head = document.querySelector('[data-slot="modal-head"]')!;
    const content = document.querySelector('[data-slot="modal-content"]')!;
    fireEvent.pointerDown(head, { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(content, { clientY: 100 + dy, pointerId: 1 });
    fireEvent.pointerUp(content, { clientY: 100 + dy, pointerId: 1 });
  };

  it("small modals are sheets on a phone, full cards on desktop", () => {
    setPhone(true);
    const { unmount } = render(<SheetHarness />);
    expect(document.querySelector('[data-slot="modal-content"]')).toHaveAttribute("data-sheet", "true");
    expect(document.querySelector("[data-sheet-grab]")).not.toBeNull();
    unmount();
    setPhone(false);
    render(<SheetHarness />);
    expect(document.querySelector('[data-slot="modal-content"]')).not.toHaveAttribute("data-sheet");
  });

  it("big modals stay full-screen on a phone", () => {
    setPhone(true);
    render(<SheetHarness size={"editor" as "md"} />);
    expect(document.querySelector('[data-slot="modal-content"]')).not.toHaveAttribute("data-sheet");
  });

  it("a swipe down closes an untouched sheet", async () => {
    vi.useFakeTimers();
    try {
      setPhone(true);
      render(<SheetHarness />);
      swipe(160);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByTestId("state")).toHaveTextContent("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a swipe down springs back once something has been typed", async () => {
    vi.useFakeTimers();
    try {
      setPhone(true);
      render(<SheetHarness />);
      const input = screen.getByLabelText("Name");
      fireEvent.input(input, { target: { value: "Trip" } });
      swipe(160);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByTestId("state")).toHaveTextContent("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a short drag springs back", () => {
    setPhone(true);
    render(<SheetHarness />);
    swipe(20);
    expect(screen.getByTestId("state")).toHaveTextContent("open");
  });
});
