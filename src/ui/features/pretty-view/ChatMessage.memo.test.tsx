/**
 * Perf regression: ChatMessage is React.memo'd so an unchanged bubble does not
 * re-parse its markdown when the list re-renders (new message appended, or
 * unrelated parent state changes). Re-parsing every bubble on every PrettyView
 * render was a main-thread cost behind iPhone scroll/transition jank.
 *
 * Render count is observed through a counting react-markdown stub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ChatMessage } from "./ChatMessage";

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(),
}));

const markdownRenders: string[] = [];
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    markdownRenders.push(children);
    return <p>{children}</p>;
  },
}));

type Msg = { id: string; role: "user" | "assistant"; content: string };

const onThumbsUp = () => {};
const onThumbsDown = () => {};
const onOpenEditor = () => {};

let setMessages: (fn: (prev: Msg[]) => Msg[]) => void = () => {};
let bumpUnrelated: () => void = () => {};

function List({ initial }: { initial: Msg[] }) {
  const [messages, _setMessages] = useState(initial);
  const [tick, setTick] = useState(0);
  setMessages = _setMessages;
  bumpUnrelated = () => setTick((t) => t + 1);
  return (
    <div data-tick={tick}>
      {messages.map((m) => (
        <ChatMessage
          key={m.id}
          role={m.role}
          content={m.content}
          eventId={m.id}
          ts={1700000000000}
          hostName="host"
          fileDragOrigin={null}
          onThumbsUp={onThumbsUp}
          onThumbsDown={onThumbsDown}
          onOpenEditor={onOpenEditor}
        />
      ))}
    </div>
  );
}

describe("ChatMessage memoization", () => {
  beforeEach(() => {
    markdownRenders.length = 0;
  });

  it("does not re-render unchanged bubbles when a sibling is appended", async () => {
    render(
      <List
        initial={[
          { id: "a", role: "user", content: "first" },
          { id: "b", role: "assistant", content: "second" },
        ]}
      />,
    );
    // Settle any mount-time effects before counting.
    await screen.findByText("second");
    const firstCount = markdownRenders.filter((c) => c === "first").length;
    const secondCount = markdownRenders.filter((c) => c === "second").length;

    act(() => {
      setMessages((prev) => [...prev, { id: "c", role: "assistant", content: "third" }]);
    });
    await screen.findByText("third");
    act(() => {
      bumpUnrelated();
    });

    expect(markdownRenders.filter((c) => c === "first").length).toBe(firstCount);
    expect(markdownRenders.filter((c) => c === "second").length).toBe(secondCount);
    expect(markdownRenders.filter((c) => c === "third").length).toBeGreaterThan(0);
  });
});
