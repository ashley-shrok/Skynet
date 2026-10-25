// shape-interactive-responses: what an ask leaves in the history — a marker in
// the agent's bubble that read-aloud hears in full, an answer bubble on the
// user's side, and no [tray] notices ever shown.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { toSpeakableText } from "./useVoiceMode";
import { formatInjectedUserTurn } from "@/api/pretty-view-upload-protocol";

const ASK = "Ready.\n\n```ask\nid: ship\nquestion: Ship it?\noptions: [Now, Tonight, Hold]\n```\n\nYour call.";

describe("ChatMessage — asks and answers", () => {
  it("draws an ask as a quiet marker between the agent's paragraphs", () => {
    const { container } = render(<ChatMessage role="assistant" content={ASK} eventId="e1" />);
    const marker = screen.getByTestId("ask-marker");
    expect(marker.textContent).toContain("Asked you:");
    expect(marker.textContent).toContain("Ship it?");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain("Your call.");
    // The read-aloud copy carries the choices.
    expect(marker.querySelector(".sr-only")?.textContent).toBe("Asked you: Ship it? Now, Tonight, or Hold.");
  });

  it("voice mode reads the question and choices, not 'code block omitted'", () => {
    expect(toSpeakableText(ASK)).toBe("Ready.\n\n Asked you: Ship it? Now, Tonight, or Hold. \n\nYour call.");
  });

  it("renders a tray answer as an answer bubble with the question quoted", () => {
    render(
      <ChatMessage
        role="user"
        content={"[tray] Your earlier question \"x\" (ask x) was replaced by a newer one before I answered it.\n\n```answer\nask: ship\nquestion: Ship it?\nanswer: Tonight\n```\n\nafter dinner"}
        eventId="e2"
      />,
    );
    const b = screen.getByTestId("answer-bubble");
    expect(b.textContent).toContain("Ship it?");
    expect(b.textContent).toContain("Tonight");
    expect(b.textContent).toContain("after dinner");
    expect(b.textContent).not.toContain("[tray]");
    expect(b.textContent).not.toContain("ask: ship");
  });

  it("hides the replied-in-words notice and keeps a thumbs-up a thumbs-up", () => {
    const { container } = render(
      <ChatMessage role="user" content={'[tray] I replied in words instead of using the tray for your question "Ship it?" (ask ship).\n\nthumbs up'} eventId="e3" />,
    );
    expect(container.textContent).not.toContain("[tray]");
    expect(screen.getByLabelText("quick reply")).toBeTruthy();
  });
});

describe("ChatMessage — asks where there is no tray", () => {
  it("shows the ask as plain text in a relay room", () => {
    render(<ChatMessage role="assistant" content={ASK} eventId="e4" askTray={false} />);
    expect(screen.queryByTestId("ask-marker")).toBeNull();
    expect(screen.getByTestId("ask-fallback").textContent).toContain("options: [Now, Tonight, Hold]");
  });
});

describe("ChatMessage — review fixes", () => {
  it("only the message's last ask gets a marker; an earlier one reads as plain text", () => {
    render(
      <ChatMessage
        role="assistant"
        eventId="e5"
        content={"```ask\nid: one\nquestion: First?\noptions: [a, b]\n```\n\n```ask\nid: two\nquestion: Second?\noptions: [c, d]\n```"}
      />,
    );
    expect(screen.getAllByTestId("ask-marker")).toHaveLength(1);
    expect(screen.getByTestId("ask-marker").textContent).toContain("Second?");
    expect(screen.getByTestId("ask-fallback").textContent).toContain("First?");
  });

  it("a tray answer sent with files draws as an answer bubble above the files", () => {
    const content = formatInjectedUserTurn({
      caption: "```answer\nask: ship\nquestion: Ship it?\nanswer: Now\n```",
      files: [{ filename: "shot.png", size: 10, mimetype: "image/png", landingPath: "/tmp/shot.png", uploadTimestamp: "2026-10-25T00:00:00" }],
    });
    const { container } = render(<ChatMessage role="user" content={content} eventId="e6" />);
    expect(screen.getByTestId("answer-bubble").textContent).toContain("Now");
    expect(container.textContent).toContain("shot.png");
    expect(container.textContent).not.toContain("ask: ship");
  });
});
