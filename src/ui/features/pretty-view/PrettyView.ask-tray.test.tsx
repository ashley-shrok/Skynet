/**
 * shape-interactive-responses — in-process flows for the ask tray: the agent's
 * question shows above the compose box, answering sends an ordinary message
 * that restates it, typing instead is a reply in words, the tray outlives
 * agent activity but not the user's own messages, newer questions replace
 * older ones, several questions answer with one Send, and it collapses.
 * Harness mirrors ComposeBox.send-funnel.test.tsx (real PrettyView, WS stub).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent, screen, within } from "@testing-library/react";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1]!;
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const useSessionIdentityMock = vi.fn((_name?: unknown) => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

// Phase 90 Plan 00 Wave 0 Task 3 (D-03 mechanical rewire): ComposeBox's
// reset button now dispatches through authApi.post('/agent-reset/...')
// instead of routing through the pretty-view WS funnel. Mock authApi.post
// so tests can drive success + failure paths.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn(),
      get: vi.fn(),
    },
  };
});

import { PrettyView } from "./PrettyView";


function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }) }));
  });
}

let line = 0;
function frame(ws: WsStub, role: "user" | "assistant", content: string, eventId = `ev-${++line}`) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "message", role, content, eventId, ts: Date.now() + line, line: ++line }),
      }),
    );
  });
}

const SHIP = "Fix is ready.\n\n```ask\nid: ship\nquestion: How should I ship the relay fix?\noptions:\n  - Ship now (recommended) | About 4 minutes\n  - Hold it\n```\n";
const BOX = `Three decisions:

\`\`\`ask
id: box
questions:
  - question: What size?
    header: Size
    options: [4 GB, 8 GB]
  - question: Which agents move?
    header: Agents
    kind: pick-several
    options: [Jarvis, Sparrow]
  - question: Name it?
    header: Name
    kind: text
\`\`\`
`;

function textarea(container: HTMLElement): HTMLTextAreaElement {
  return container.querySelector('textarea[placeholder="Write a message…"]') as HTMLTextAreaElement;
}
const tray = () => screen.queryByTestId("ask-tray");

describe("Interactive responses — the tray above the compose box", () => {
  let onSendMock: ReturnType<typeof vi.fn<(text: string, mqid?: string) => boolean>>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    onSendMock = vi.fn((_text: string, _mqid?: string) => true);
    localStorage.clear();
    autoAnswerKitDialogs({ confirm: true });
  });

  afterEach(() => {
    __resetKitDialogsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount() {
    const r = render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={onSendMock} hostName="box" />);
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() => expect(textarea(r.container)).not.toBeNull());
    return { ...r, ws };
  }

  const sent = (i = 0) => onSendMock.mock.calls[i]![0] as string;

  it("an ask shows in the tray and as a marker in the bubble; one tap answers it", async () => {
    const { ws, container } = await mount();
    frame(ws, "assistant", SHIP);
    await waitFor(() => expect(tray()).not.toBeNull());
    expect(tray()!.textContent).toContain("How should I ship the relay fix?");
    expect(within(tray()!).getByText("recommended")).toBeTruthy();
    // The bubble has a quiet marker, never controls.
    const marker = screen.getByTestId("ask-marker");
    expect(marker.textContent).toContain("Asked you:");
    expect(marker.querySelector("button")).toBeNull();

    act(() => { fireEvent.click(within(tray()!).getByRole("radio", { name: /Ship now/ })); });
    expect(onSendMock).toHaveBeenCalledOnce();
    expect(sent()).toBe("```answer\nask: ship\nquestion: How should I ship the relay fix?\nanswer: Ship now\n```");
    // Closed at once, and the pending bubble reads as an answer.
    expect(tray()).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-event-id^="pending-"] [data-testid="answer-bubble"]')).not.toBeNull());
  });

  it("what is typed in the compose box rides along as the note", async () => {
    const { ws, container } = await mount();
    frame(ws, "assistant", SHIP);
    await waitFor(() => expect(tray()).not.toBeNull());
    act(() => { fireEvent.change(textarea(container), { target: { value: "after lunch" } }); });
    act(() => { fireEvent.click(within(tray()!).getByRole("radio", { name: /Hold it/ })); });
    expect(sent().endsWith("```\n\nafter lunch")).toBe(true);
    expect(textarea(container).value).toBe("");
  });

  it("typing a reply instead closes the tray and tells the agent it was answered in words", async () => {
    const { ws, container } = await mount();
    frame(ws, "assistant", SHIP);
    await waitFor(() => expect(tray()).not.toBeNull());
    act(() => {
      fireEvent.change(textarea(container), { target: { value: "Let's wait for Ana" } });
      fireEvent.keyDown(textarea(container), { key: "Enter" });
    });
    expect(sent()).toBe(
      '[tray] I replied in words instead of using the tray for your question "How should I ship the relay fix?" (ask ship).\n\nLet\'s wait for Ana',
    );
    expect(tray()).toBeNull();
    // The notice never shows in the user's bubble.
    const pending = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pending.textContent).toContain("Let's wait for Ana");
    expect(pending.textContent).not.toContain("[tray]");
  });

  it("stays up through later agent replies; only a message from the user closes it (any device)", async () => {
    const { ws } = await mount();
    frame(ws, "assistant", SHIP);
    frame(ws, "assistant", "The build also finished on its own.");
    await waitFor(() => expect(tray()).not.toBeNull());
    // An answer sent from another device arrives as a user message.
    frame(ws, "user", "```answer\nask: ship\nquestion: How should I ship the relay fix?\nanswer: Hold it\n```");
    await waitFor(() => expect(tray()).toBeNull());
    expect(screen.getByTestId("answer-bubble").textContent).toContain("Hold it");
  });

  it("a newer question replaces the open one; the next message says so", async () => {
    const { ws } = await mount();
    frame(ws, "assistant", SHIP);
    frame(ws, "assistant", "Actually:\n\n```ask\nid: when\nquestion: When should I ship?\noptions: [Now, Tonight]\n```\n");
    await waitFor(() => expect(tray()?.textContent).toContain("When should I ship?"));
    act(() => { fireEvent.click(within(tray()!).getByRole("radio", { name: /Tonight/ })); });
    expect(sent().startsWith('[tray] Your earlier question "How should I ship the relay fix?" (ask ship) was replaced by a newer one before I answered it.\n\n```answer\nask: when\n')).toBe(true);
  });

  it("several questions: tabs tick as answered, one Send once all are answered, Something else per question", async () => {
    const { ws } = await mount();
    frame(ws, "assistant", BOX);
    await waitFor(() => expect(tray()).not.toBeNull());
    const t = () => within(tray()!);
    const send = () => t().getByTestId("ask-send") as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    // Picking in the first question moves on to the next.
    act(() => { fireEvent.click(t().getByRole("radio", { name: /8 GB/ })); });
    expect(t().getByRole("tab", { name: /Size/ }).getAttribute("data-done")).toBe("true");
    expect(t().getByRole("tab", { name: /Agents/ }).getAttribute("aria-selected")).toBe("true");
    act(() => { fireEvent.click(t().getByRole("checkbox", { name: /Jarvis/ })); });
    act(() => { fireEvent.click(t().getByRole("checkbox", { name: /Sparrow/ })); });
    act(() => { fireEvent.click(t().getByRole("tab", { name: /Name/ })); });
    expect(send().disabled).toBe(true);
    act(() => { fireEvent.click(t().getByText("Something else…")); });
    act(() => { fireEvent.change(t().getByLabelText("Something else"), { target: { value: "you pick" } }); });
    expect(send().disabled).toBe(false);
    act(() => { fireEvent.click(send()); });
    expect(sent()).toBe(
      "```answer\nask: box\nanswers:\n  - question: What size?\n    answer: 8 GB\n  - question: Which agents move?\n    answer:\n      - Jarvis\n      - Sparrow\n  - question: Name it?\n    answer: you pick\n    other: true\n```",
    );
  });

  it("collapses to a one-line strip and opens again; a new question arrives open", async () => {
    const { ws } = await mount();
    frame(ws, "assistant", SHIP);
    await waitFor(() => expect(tray()).not.toBeNull());
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Hide the question for now" })); });
    expect(tray()!.getAttribute("data-collapsed")).toBe("true");
    expect(tray()!.textContent).toContain("Question waiting:");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Show the question" })); });
    expect(tray()!.getAttribute("data-collapsed")).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Hide the question for now" })); });
    frame(ws, "assistant", "```ask\nid: next\nquestion: Next one?\noptions: [a, b]\n```");
    await waitFor(() => expect(tray()?.textContent).toContain("Next one?"));
    expect(tray()!.getAttribute("data-collapsed")).toBeNull();
  });

  it("an unreadable ask gets no tray; the bubble shows it as plain text", async () => {
    const { ws } = await mount();
    frame(ws, "assistant", "```ask\nquestion: Pick one\noptions: [only]\n```");
    await waitFor(() => expect(screen.getByTestId("ask-fallback").textContent).toContain("question: Pick one"));
    expect(tray()).toBeNull();
  });
});
