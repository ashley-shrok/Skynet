import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// In-process coverage for the skill-actions menu (shape skill-action-menu):
// the lightning-bolt button in ComposeBox's aux row, driven the way a user
// does — open the menu with the pointer, tap a skill, see it sent.

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const listSkillsMock = vi.fn();
const createSkillMock = vi.fn();
vi.mock("@/api/skills-api", () => ({
  listSkills: (hostId: number) => listSkillsMock(hostId),
  createSkill: (hostId: number, name: string, description: string) =>
    createSkillMock(hostId, name, description),
  SkillAlreadyExistsError: class SkillAlreadyExistsError extends Error {},
}));

import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { __resetSkillActionsStoreForTests } from "./skill-actions-store";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import { OPEN_SKILLS_EDITOR_EVENT } from "@/features/pretty-conversations/open-skills-editor";

const SKILLS = [
  { name: "recap", description: "Gives a concise recap of the session." },
  { name: "light-review", description: "Unbiased sub-agent code review" },
  { name: "explain" },
];

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    identityName: "garnet",
    canSend: true,
    ...overrides,
  };
}

/** Radix DropdownMenu opens on a primary-button pointerdown. */
function openMenu(button: HTMLElement): void {
  act(() => {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
}

async function findButton(): Promise<HTMLButtonElement> {
  return (await screen.findByTestId("skill-actions-button")) as HTMLButtonElement;
}

describe("ComposeBox — skill-actions menu", () => {
  beforeEach(() => {
    __resetSkillActionsStoreForTests();
    localStorage.clear();
    listSkillsMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
    createSkillMock.mockReset();
    __resetKitDialogsForTests();
  });

  it("button appears on the left of the control row (before the spacer and the thumbs-up) once the host's skills are known", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    expect(btn.getAttribute("aria-label")).toBe("Skills");
    // shape-conversation-view: left side holds attach + skills; the spacer
    // pushes memory / voice mode / mic / main button to the right.
    expect(screen.getByTestId("compose-row").contains(btn)).toBe(true);
    expect(btn.nextElementSibling?.classList.contains("pv-compose-spacer")).toBe(true);
    const thumbs = screen.getByLabelText("Send 'thumbs up'");
    // eslint-disable-next-line no-bitwise
    expect(btn.compareDocumentPosition(thumbs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(listSkillsMock).toHaveBeenCalledWith(1);
  });

  it("menu lists every skill alphabetically with descriptions", async () => {
    render(<ComposeBox {...baseProps()} />);
    openMenu(await findButton());
    const menu = await screen.findByTestId("skill-actions-menu");
    const names = Array.from(menu.querySelectorAll("[data-testid^='skill-actions-item-']")).map(
      (el) => el.getAttribute("data-testid")!.replace("skill-actions-item-", ""),
    );
    expect(names).toEqual(["explain", "light-review", "recap"]);
    const lr = screen.getByTestId("skill-actions-item-light-review");
    expect(lr.textContent).toContain("/light-review");
    expect(lr.textContent).toContain("Unbiased sub-agent code review");
  });

  it("tapping a skill sends /<name> at once, jumps to bottom, and leaves the typed draft alone", async () => {
    const onSend = vi.fn(() => true);
    const onGoodToGo = vi.fn();
    render(<ComposeBox {...baseProps({ onSend, onGoodToGo })} />);
    const textarea = screen.getByPlaceholderText("Write a message…") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "half-written thought" } });

    openMenu(await findButton());
    fireEvent.click(await screen.findByTestId("skill-actions-item-light-review"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/light-review");
    expect(onGoodToGo).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("half-written thought");
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
  });

  it("search ranks name matches first, the same order as the slash list", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);
    openMenu(await findButton());
    const search = (await screen.findByTestId("skill-actions-search")) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "re" } });
    const menu = screen.getByTestId("skill-actions-menu");
    const names = Array.from(menu.querySelectorAll("[data-testid^='skill-actions-item-']")).map(
      (el) => el.getAttribute("data-testid")!.replace("skill-actions-item-", ""),
    );
    // "recap" starts with it; "light-review" only contains it.
    expect(names).toEqual(["recap", "light-review"]);
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/recap");
  });

  it("opening the menu refreshes the list in the background", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(1));
    openMenu(btn);
    await screen.findByTestId("skill-actions-menu");
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
  });

  it("renders instantly from the remembered list (no fetch needed first)", async () => {
    listSkillsMock.mockReturnValue(new Promise(() => {})); // fetch never lands
    localStorage.setItem("skynet:skill-actions:v1:__anon:1", JSON.stringify(SKILLS));
    render(<ComposeBox {...baseProps()} />);
    expect(screen.getByTestId("skill-actions-button")).toBeTruthy();
  });

  it("hidden when the host has no skills", async () => {
    listSkillsMock.mockResolvedValue([]);
    render(<ComposeBox {...baseProps()} />);
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("skill-actions-button")).toBeNull();
  });

  it("hidden (and no fetch) in relay panes", async () => {
    render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    await act(async () => {});
    expect(screen.queryByTestId("skill-actions-button")).toBeNull();
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("the open menu keeps its rows still while a background refresh lands", async () => {
    render(<ComposeBox {...baseProps()} />);
    const btn = await findButton();
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(1));
    listSkillsMock.mockResolvedValueOnce([{ name: "aaa-new" }, ...SKILLS]);
    openMenu(btn);
    await screen.findByTestId("skill-actions-menu");
    await waitFor(() => expect(listSkillsMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    // Refresh landed, but the open menu still shows the open-time list.
    expect(screen.queryByTestId("skill-actions-item-aaa-new")).toBeNull();
    // Close + reopen: the new skill appears.
    act(() => {
      fireEvent.keyDown(screen.getByTestId("skill-actions-menu"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
    openMenu(btn);
    expect(await screen.findByTestId("skill-actions-item-aaa-new")).toBeTruthy();
  });

  it("an open menu closes when the button becomes disabled", async () => {
    const { rerender } = render(<ComposeBox {...baseProps()} />);
    openMenu(await findButton());
    await screen.findByTestId("skill-actions-menu");
    rerender(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
  });

  it("a failed dispatch shows the same not-connected message as thumbs-up", async () => {
    render(<ComposeBox {...baseProps({ onSend: vi.fn(() => false) })} />);
    openMenu(await findButton());
    fireEvent.click(await screen.findByTestId("skill-actions-item-recap"));
    expect(await screen.findByText(/not connected/i)).toBeTruthy();
  });

  it("a failed first fetch with nothing remembered is retried, then the button appears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listSkillsMock.mockReset();
      listSkillsMock.mockRejectedValueOnce(new Error("SSH connect failed"));
      listSkillsMock.mockResolvedValue(SKILLS);
      render(<ComposeBox {...baseProps()} />);
      await act(async () => {});
      expect(screen.queryByTestId("skill-actions-button")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByTestId("skill-actions-button")).toBeTruthy();
      expect(listSkillsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disabled exactly like thumbs-up while reconnectingActive", async () => {
    render(<ComposeBox {...baseProps({ reconnectingActive: true })} />);
    const btn = await findButton();
    expect(btn.disabled).toBe(true);
    expect((screen.getByLabelText("Send 'thumbs up'") as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays enabled while condensing (nothing is disabled during a condense)", async () => {
    render(<ComposeBox {...baseProps({ condensing: true })} />);
    const btn = await findButton();
    expect(btn.disabled).toBe(false);
    expect((screen.getByLabelText("Send 'thumbs up'") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disabled while asideActive (the thumbs-up steps away for Resume then)", async () => {
    render(<ComposeBox {...baseProps({ asideActive: true })} />);
    const btn = await findButton();
    expect(btn.disabled).toBe(true);
    expect(screen.queryByLabelText("Send 'thumbs up'")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  describe("New skill… row", () => {
    function listenForOpen(): { targets: unknown[]; stop: () => void } {
      const targets: unknown[] = [];
      const listen = (e: Event) => targets.push((e as CustomEvent).detail);
      window.addEventListener(OPEN_SKILLS_EDITOR_EVENT, listen);
      return { targets, stop: () => window.removeEventListener(OPEN_SKILLS_EDITOR_EVENT, listen) };
    }

    it("is the last row of the menu, after every skill", async () => {
      render(<ComposeBox {...baseProps()} />);
      openMenu(await findButton());
      const menu = await screen.findByTestId("skill-actions-menu");
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      expect(items[items.length - 1].getAttribute("data-testid")).toBe("skill-actions-new-skill");
      expect(items[items.length - 1].textContent).toContain("New skill…");
    });

    it("stays at the bottom while a search matches nothing", async () => {
      render(<ComposeBox {...baseProps()} />);
      openMenu(await findButton());
      fireEvent.change(await screen.findByTestId("skill-actions-search"), { target: { value: "deploy" } });
      expect(screen.getByText("No skills match")).toBeTruthy();
      expect(screen.getByTestId("skill-actions-new-skill")).toBeTruthy();
    });

    it("asks name (starting from the search text) then description, creates on this host, opens the Skills window on it — and sends nothing", async () => {
      const onSend = vi.fn(() => true);
      const answers = ["deploy", "Deploys the thing."];
      const dialogs = autoAnswerKitDialogs({ prompt: () => answers.shift() ?? null });
      createSkillMock.mockResolvedValue({ slug: "deploy", mtime: 1 });
      const opened = listenForOpen();
      try {
        render(<ComposeBox {...baseProps({ onSend, hostId: 7 })} />);
        const textarea = screen.getByPlaceholderText("Write a message…") as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: "draft stays" } });
        openMenu(await findButton());
        fireEvent.change(await screen.findByTestId("skill-actions-search"), { target: { value: "  deploy " } });
        fireEvent.click(screen.getByTestId("skill-actions-new-skill"));

        await waitFor(() => expect(opened.targets).toEqual([{ hostId: 7, skill: "deploy" }]));
        expect(createSkillMock).toHaveBeenCalledWith(7, "deploy", "Deploys the thing.");
        // The composer's own list refreshes (after the menu-open one) so the
        // new skill is there next open.
        await waitFor(() => expect(listSkillsMock.mock.calls.filter((c) => c[0] === 7).length).toBeGreaterThanOrEqual(3));
        expect(dialogs.calls[0].opts).toMatchObject({ title: "New skill", defaultValue: "deploy" });
        expect(onSend).not.toHaveBeenCalled();
        expect(textarea.value).toBe("draft stays");
        await waitFor(() => expect(screen.queryByTestId("skill-actions-menu")).toBeNull());
      } finally {
        opened.stop();
      }
    });

    it("with no search typed, the name starts blank", async () => {
      const dialogs = autoAnswerKitDialogs({ prompt: null });
      render(<ComposeBox {...baseProps()} />);
      openMenu(await findButton());
      fireEvent.click(await screen.findByTestId("skill-actions-new-skill"));
      await waitFor(() => expect(dialogs.calls.length).toBe(1));
      expect((dialogs.calls[0].opts as { defaultValue?: string }).defaultValue).toBeUndefined();
    });

    it.each([
      ["name", [null]],
      ["description", ["deploy", null]],
    ])("backing out at the %s question creates nothing and opens no window", async (_step, seq) => {
      const answers = [...seq];
      const dialogs = autoAnswerKitDialogs({ prompt: () => answers.shift() ?? null });
      const opened = listenForOpen();
      try {
        render(<ComposeBox {...baseProps()} />);
        openMenu(await findButton());
        fireEvent.click(await screen.findByTestId("skill-actions-new-skill"));
        await waitFor(() => expect(dialogs.calls.length).toBe(seq.length));
        await new Promise((r) => setTimeout(r, 20));
        expect(createSkillMock).not.toHaveBeenCalled();
        expect(opened.targets).toEqual([]);
      } finally {
        opened.stop();
      }
    });

    it("with the real dialog: the name field takes focus with the search text, and Cancel puts focus back on the ⚡ button", async () => {
      render(<ComposeBox {...baseProps()} />);
      const btn = await findButton();
      openMenu(btn);
      fireEvent.change(await screen.findByTestId("skill-actions-search"), { target: { value: "deploy" } });
      fireEvent.click(screen.getByTestId("skill-actions-new-skill"));
      await waitFor(() => {
        const field = document.activeElement as HTMLInputElement | null;
        expect(field?.tagName).toBe("INPUT");
        expect(field?.value).toBe("deploy");
        expect(field?.getAttribute("data-testid")).not.toBe("skill-actions-search");
        expect(field?.closest('[role="dialog"], [role="alertdialog"]')?.textContent).toContain("New skill");
      });
      fireEvent.click(screen.getByTestId("kit-dialog-cancel"));
      await waitFor(() => expect(document.activeElement).toBe(btn));
      expect(createSkillMock).not.toHaveBeenCalled();
    });

    it("a failed create says so and opens no window", async () => {
      const answers = ["deploy", "Deploys the thing."];
      const dialogs = autoAnswerKitDialogs({ prompt: () => answers.shift() ?? null });
      createSkillMock.mockRejectedValue(new Error("host unreachable"));
      const opened = listenForOpen();
      try {
        render(<ComposeBox {...baseProps()} />);
        openMenu(await findButton());
        fireEvent.click(await screen.findByTestId("skill-actions-new-skill"));
        await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
        expect(opened.targets).toEqual([]);
      } finally {
        opened.stop();
      }
    });

    it("Enter in a search with no matches does not start a new skill", async () => {
      const dialogs = autoAnswerKitDialogs({ prompt: null });
      render(<ComposeBox {...baseProps()} />);
      openMenu(await findButton());
      const search = await screen.findByTestId("skill-actions-search");
      fireEvent.change(search, { target: { value: "deploy" } });
      fireEvent.keyDown(search, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 20));
      expect(dialogs.calls).toEqual([]);
    });
  });
});
