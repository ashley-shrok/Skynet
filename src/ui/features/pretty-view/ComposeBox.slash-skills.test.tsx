import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// In-process coverage for the slash skill list (shape slash-skill-menu):
// typing a slash at the start of the compose box brings up the host's skills,
// driven the way a user does — type, arrow, Enter / Tab / Escape, click.

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const listSkillsMock = vi.fn();
vi.mock("@/api/skills-api", () => ({
  listSkills: (hostId: number) => listSkillsMock(hostId),
}));

import { getComposeDraft } from "@/api/compose-drafts-api";
import { ComposeBox, type ComposeBoxProps } from "./ComposeBox";
import { __resetSkillActionsStoreForTests } from "./skill-actions-store";

const SKILLS = [
  { name: "summary", description: "Gives a concise summary of the session." },
  { name: "light-review", description: "Unbiased sub-agent code review" },
  { name: "explain", description: "Describe a thing conceptually" },
  { name: "zap", description: "Load a named agent." },
  { name: "zapper" },
  { name: "agent-only", userInvocable: false },
  // Refused by the text area (a Claude Code command) — never offered.
  { name: "recap", description: "Blocked name" },
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

function box(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Write a message…") as HTMLTextAreaElement;
}

function menu(): HTMLElement | null {
  return screen.queryByTestId("slash-skill-menu");
}

function rows(): string[] {
  return Array.from(menu()?.querySelectorAll("[role='option']") ?? []).map(
    (el) => el.getAttribute("data-testid")!.replace("slash-skill-item-", ""),
  );
}

function highlighted(): string | null {
  const el = menu()?.querySelector("[aria-selected='true']");
  return el ? el.getAttribute("data-testid")!.replace("slash-skill-item-", "") : null;
}

/** Render, wait for the host's skills to be known (the bolt button shows). */
async function setup(overrides: Partial<ComposeBoxProps> = {}) {
  const user = userEvent.setup();
  const props = baseProps(overrides);
  render(<ComposeBox {...props} />);
  await screen.findByTestId("skill-actions-button");
  return { user, props, onSend: props.onSend as ReturnType<typeof vi.fn> };
}

describe("ComposeBox — slash skill list", () => {
  beforeEach(() => {
    __resetSkillActionsStoreForTests();
    localStorage.clear();
    listSkillsMock.mockReset();
    listSkillsMock.mockResolvedValue(SKILLS);
    vi.mocked(getComposeDraft).mockResolvedValue({ body: "" } as never);
  });

  it("a leading slash lists every user skill alphabetically; typing narrows and ranks it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/");
    expect(rows()).toEqual(["explain", "light-review", "summary", "zap", "zapper"]);
    expect(highlighted()).toBe("explain");
    await user.keyboard("e");
    // Name starts with "e", then names containing "e", then description hits.
    expect(rows()).toEqual(["explain", "light-review", "zapper", "summary", "zap"]);
    expect(highlighted()).toBe("explain");
    await user.keyboard("x");
    expect(rows()).toEqual(["explain"]);
  });

  it("description matches rank below name matches", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/agent");
    // "Load a named agent." and "Unbiased sub-agent code review" — description only.
    expect(rows()).toEqual(["light-review", "zap"]);
  });

  it("arrows move the highlight and wrap at both ends", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap");
    expect(rows()).toEqual(["zap", "zapper"]);
    expect(highlighted()).toBe("zap");
    await user.keyboard("{ArrowDown}");
    expect(highlighted()).toBe("zapper");
    await user.keyboard("{ArrowDown}");
    expect(highlighted()).toBe("zap");
    await user.keyboard("{ArrowUp}");
    expect(highlighted()).toBe("zapper");
  });

  it("Enter fills in the highlighted skill without sending; a second Enter sends", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/sum{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("/summary ");
    expect(box().selectionStart).toBe(9);
    expect(menu()).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/summary");
  });

  it("Tab fills in too, and you can keep typing after it", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/lig{Tab}some words");
    expect(box().value).toBe("/light-review some words");
    expect(onSend).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("an exactly typed full name sends on the first Enter", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/zap");
    expect(highlighted()).toBe("zap");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/zap");
  });

  it("an exact name with a different row arrowed to fills that row instead", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/zap{ArrowDown}{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("/zapper ");
  });

  it("nothing matching: no list, and Enter sends the text as written", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/zzz");
    expect(menu()).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((onSend.mock.calls[0] as unknown[])[0]).toBe("/zzz");
  });

  it("agent-only skills are never listed", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/agent-o");
    expect(menu()).toBeNull();
  });

  it("names the text area refuses are never offered", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/reca");
    expect(menu()).toBeNull();
  });

  it("only a slash at the very start opens it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("hello /su");
    expect(menu()).toBeNull();
  });

  it("a space after the name closes it; backspacing into the name reopens it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap ");
    expect(menu()).toBeNull();
    await user.keyboard("{Backspace}");
    expect(rows()).toEqual(["zap", "zapper"]);
  });

  it("Escape dismisses it until the text changes", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/za{Escape}");
    expect(menu()).toBeNull();
    // Moving the caret about doesn't bring it back.
    await user.keyboard("{ArrowLeft}{ArrowRight}");
    expect(menu()).toBeNull();
    await user.keyboard("pp");
    expect(rows()).toEqual(["zapper"]);
  });

  it("a dismissal lasts only until the next edit — not across typing away and back", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/za{Escape}");
    expect(menu()).toBeNull();
    await user.keyboard("p{Backspace}");
    expect(box().value).toBe("/za");
    expect(rows()).toEqual(["zap", "zapper"]);
  });

  it("a dismissal doesn't carry over to the next message", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/zzz{Escape}{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box().value).toBe(""));
    await user.keyboard("/");
    expect(rows()).toHaveLength(5);
  });

  it("text put back by the app (an interrupted message) doesn't pop it open", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const view = render(<ComposeBox {...props} overrideText={null} />);
    await screen.findByTestId("skill-actions-button");
    await user.click(box());
    await user.keyboard("/zap{Enter}");
    await waitFor(() => expect(props.onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box().value).toBe(""));
    view.rerender(<ComposeBox {...props} overrideText="/zap" />);
    await waitFor(() => expect(box().value).toBe("/zap"));
    expect(menu()).toBeNull();
  });

  it("picking the name that's already complete puts the caret after it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap more{Home}{ArrowRight}{ArrowRight}");
    expect(highlighted()).toBe("zap");
    await user.keyboard("{Tab}");
    expect(box().value).toBe("/zap more");
    expect(box().selectionStart).toBe(5);
    expect(menu()).toBeNull();
    await user.keyboard("x");
    expect(box().value).toBe("/zap xmore");
  });

  it("moving the caret out of the name closes it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap more{Home}{ArrowRight}");
    // Back inside the name of text the user typed: it shows again.
    expect(rows()).toEqual(["zap", "zapper"]);
    await user.keyboard("{End}");
    expect(menu()).toBeNull();
    // Left by moving the caret — stays closed until the text changes.
    await user.keyboard("{Home}{ArrowRight}");
    expect(menu()).toBeNull();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}p");
    expect(box().value).toBe("/zapp more");
    expect(rows()).toEqual(["zapper"]);
  });

  it("picking with words already after the name keeps them", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/za tina{Home}{ArrowRight}{ArrowRight}{ArrowRight}p");
    expect(box().value).toBe("/zap tina");
    await user.keyboard("{ArrowDown}{Tab}");
    expect(box().value).toBe("/zapper tina");
    expect(box().selectionStart).toBe(8);
  });

  it("clicking a row fills it in and keeps the caret in the box", async () => {
    const { user, onSend } = await setup();
    await user.click(box());
    await user.keyboard("/ex");
    await user.click(screen.getByTestId("slash-skill-item-explain"));
    expect(box().value).toBe("/explain ");
    expect(document.activeElement).toBe(box());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hovering a row highlights it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap");
    fireEvent.mouseMove(screen.getByTestId("slash-skill-item-zapper"));
    expect(highlighted()).toBe("zapper");
  });

  it("clicking away closes it", async () => {
    const { user } = await setup();
    await user.click(box());
    await user.keyboard("/zap");
    act(() => box().blur());
    expect(menu()).toBeNull();
    await user.click(box());
    expect(menu()).toBeNull();
  });

  it("a restored draft that starts with a slash doesn't pop it open", async () => {
    vi.mocked(getComposeDraft).mockResolvedValue({ body: "/summ" } as never);
    const { user } = await setup();
    await waitFor(() => expect(box().value).toBe("/summ"));
    await user.click(box());
    await user.keyboard("{End}");
    expect(menu()).toBeNull();
    await user.keyboard("a");
    expect(rows()).toEqual(["summary"]);
  });

  it("phone: tapping a row fills it in; Enter never sends", async () => {
    const { user, onSend } = await setup({ isTouchDevice: true });
    await user.click(box());
    await user.keyboard("/zap");
    await user.click(screen.getByTestId("slash-skill-item-zap"));
    expect(box().value).toBe("/zap ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("phone: an exact name and Enter fills in rather than sends", async () => {
    const { user, onSend } = await setup({ isTouchDevice: true });
    await user.click(box());
    await user.keyboard("/zap{Enter}");
    expect(box().value).toBe("/zap ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hidden while the box can't send", async () => {
    const { user } = await setup({ canSend: false });
    await user.click(box());
    await user.keyboard("/su");
    expect(menu()).toBeNull();
  });

  it("never in relay rooms", async () => {
    const user = userEvent.setup();
    render(<ComposeBox {...baseProps({ mode: "relay" })} />);
    await user.click(box());
    await user.keyboard("/su");
    expect(menu()).toBeNull();
    expect(listSkillsMock).not.toHaveBeenCalled();
  });
});
