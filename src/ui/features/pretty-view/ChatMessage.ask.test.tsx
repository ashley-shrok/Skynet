// shape-interactive-responses: what an ask leaves in the history — a marker in
// the agent's bubble that read-aloud hears in full, an answer bubble on the
// user's side, and no [tray] notices ever shown.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { toSpeakableText } from "./useVoiceMode";

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
