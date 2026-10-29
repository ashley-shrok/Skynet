/**
 * The compose box's text area carries only Skynet's own commands: a typed
 * message starting with a Claude Code command (or the identity-loading
 * command) never leaves, the words stay in the box and a line says why. Sends
 * out of the text area are marked for the server's own check; button sends
 * (thumbs-up) are not. A send the server refuses ends in the same state.
 *
 * Harness mirrors ComposeBox.send-funnel.test.tsx (PrettyView end to end with
 * a stub WebSocket). onSend plays the pane's part: it hands the text to
 * PrettyView's own sendInput, so the wire frames can be read off the stub.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, act, waitFor, fireEvent, screen } from "@testing-library/react";
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

const useSessionIdentityMock = vi.fn((_name: unknown) => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

// Compact conversation posts to authApi.post('/identities/<key>/condense')
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
import { __resetTextAreaSendsForTests } from "./text-area-sends";

const REFUSAL = "That command can't be used here.";

function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }) }));
  });
}

function textareaOf(container: HTMLElement): HTMLTextAreaElement {
  const t = container.querySelector('textarea[placeholder="Write a message…"]') as HTMLTextAreaElement | null;
  expect(t).not.toBeNull();
  return t!;
}

function typeAndEnter(container: HTMLElement, text: string) {
  const textarea = textareaOf(container);
  act(() => {
    fireEvent.change(textarea, { target: { value: text } });
    fireEvent.keyDown(textarea, { key: "Enter" });
  });
}

function inputFrames(ws: WsStub): Array<Record<string, unknown>> {
  return ws.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    .filter((f) => f.type === "input");
}

function pendingBubbles(container: HTMLElement): number {
  return container.querySelectorAll('[data-event-id^="pending-"]').length;
}

describe("compose box — blocked commands", () => {
  let sendInputFn: ((text: string, mqid?: string) => boolean) | null;
  let onSend: Mock<(text: string, mqid?: string) => boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    __resetTextAreaSendsForTests();
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    localStorage.clear();
    autoAnswerKitDialogs({ confirm: true });
    sendInputFn = null;
    onSend = vi.fn<(text: string, mqid?: string) => boolean>((text, mqid) => sendInputFn?.(text + "\r", mqid) ?? false);
  });

  afterEach(() => {
    __resetKitDialogsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount() {
    const view = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={onSend}
        onRegisterSendInput={(fn) => { sendInputFn = fn; }}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() => expect(view.container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull());
    return { ...view, ws };
  }

  it.each(["/clear", "/compact keep the plan", "  /Resume", "/id other-agent", "/desktop"])(
    "refuses a typed %j: nothing sent, no bubble, words kept, line shown",
    async (text) => {
      const { container, ws } = await mount();
      typeAndEnter(container, text);
      expect(onSend).not.toHaveBeenCalled();
      expect(inputFrames(ws)).toHaveLength(0);
      expect(pendingBubbles(container)).toBe(0);
      expect(textareaOf(container).value).toBe(text);
      expect(screen.getByText(REFUSAL)).toBeTruthy();
    },
  );

  it("drops the refusal line once the words are edited", async () => {
    const { container } = await mount();
    typeAndEnter(container, "/clear");
    expect(screen.getByText(REFUSAL)).toBeTruthy();
    act(() => {
      fireEvent.change(textareaOf(container), { target: { value: "/clea" } });
    });
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it("drops the refusal line when something else is sent", async () => {
    const { container } = await mount();
    typeAndEnter(container, "/clear");
    expect(screen.getByText(REFUSAL)).toBeTruthy();
    typeAndEnter(container, "hello");
    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("sends an ordinary typed message, marked as text-area input", async () => {
    const { container, ws } = await mount();
    typeAndEnter(container, "hello there");
    expect(onSend).toHaveBeenCalledTimes(1);
    const frames = inputFrames(ws);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ data: "hello there\r", textArea: true });
  });

  it.each(["/build add a button", "/clearly", "see you tomorrow\n/clear"])("lets %j through", async (text) => {
    const { container, ws } = await mount();
    typeAndEnter(container, text);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(inputFrames(ws)[0]).toMatchObject({ textArea: true });
  });

  it("leaves a button's send unmarked (thumbs-up)", async () => {
    const { container, ws } = await mount();
    const thumbs = container.querySelector('button[aria-label="Send \'thumbs up\'"]') as HTMLButtonElement | null;
    expect(thumbs).not.toBeNull();
    act(() => {
      fireEvent.click(thumbs!);
    });
    const frames = inputFrames(ws);
    expect(frames).toHaveLength(1);
    expect(frames[0].textArea).toBeUndefined();
  });

  it("a send the server refuses: bubble gone, words back in the box, line shown", async () => {
    const { container, ws } = await mount();
    typeAndEnter(container, "hello there");
    const frame = inputFrames(ws)[0];
    expect(pendingBubbles(container)).toBe(1);
    expect(textareaOf(container).value).toBe("");
    act(() => {
      ws.onmessage?.(new MessageEvent("message", {
        data: JSON.stringify({ type: "command_refused", mqid: frame.messageQueueItemId }),
      }));
    });
    await waitFor(() => expect(pendingBubbles(container)).toBe(0));
    await waitFor(() => expect(textareaOf(container).value).toBe("hello there"));
    expect(screen.getByText(REFUSAL)).toBeTruthy();
  });
});
