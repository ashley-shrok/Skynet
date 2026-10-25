/**
 * ```diff / ```patch fences in a bubble render as a ChatDiffBlock (red/green
 * rows, +/− counts, fold, raw-text copy); anything else stays a plain block.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })),
}));
afterEach(cleanup);

const fence = (lang: string, body: string) => "Here:\n\n```" + lang + "\n" + body + "\n```\n";
const BARE = " - **Do the task work directly.**\n-- **Write into another identity's folder.**\n+**Route via DM.**";

function renderBubble(content: string) {
  return render(<ChatMessage role="assistant" eventId="e1" content={content} onOpenEditor={vi.fn()} />);
}

describe("ChatMessage — diff code blocks", () => {
  it("renders a bare ```diff fence as add/del/context rows with counts", () => {
    const { container } = renderBubble(fence("diff", BARE));
    const block = screen.getByTestId("chat-diff");
    expect(container.querySelector("pre")).toBeNull();
    const kinds = [...block.querySelectorAll("[data-diff-line]")].map((r) => r.getAttribute("data-diff-line"));
    expect(kinds).toEqual(["ctx", "del", "add"]);
    expect(block.textContent).toContain("+1");
    expect(block.textContent).toContain("−1");
  });

  it("treats ```patch the same way", () => {
    renderBubble(fence("patch", "-a\n+b"));
    expect(screen.getByTestId("chat-diff")).toBeTruthy();
  });

  it("falls back to a plain code block when the body isn't a diff", () => {
    const { container } = renderBubble(fence("diff", "just some text\n+plus"));
    expect(screen.queryByTestId("chat-diff")).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("leaves other languages alone", () => {
    const { container } = renderBubble(fence("ts", "-a\n+b"));
    expect(screen.queryByTestId("chat-diff")).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("folds a long diff and expands on click", () => {
    const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`).join("\n");
    renderBubble(fence("diff", body));
    const block = screen.getByTestId("chat-diff");
    expect(block.querySelectorAll("[data-diff-line]")).toHaveLength(12);
    fireEvent.click(screen.getByTestId("chat-diff-toggle"));
    expect(block.querySelectorAll("[data-diff-line]")).toHaveLength(30);
    expect(screen.getByTestId("chat-diff-toggle").textContent).toBe("Show less");
  });

  it("copies the original block text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const realNav = window.navigator;
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: new Proxy(realNav, {
        get: (t, k) => (k === "clipboard" ? { writeText } : Reflect.get(t, k)),
      }),
    });
    try {
      renderBubble(fence("diff", BARE));
      fireEvent.click(screen.getByTestId("copyable-block-copy"));
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(BARE);
    } finally {
      Object.defineProperty(window, "navigator", { configurable: true, value: realNav });
    }
  });
});
