import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileSpeakButton } from "./FileSpeakButton";
import { setFileSpeakVoice } from "./file-speak";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "../webAudioStreamPlayer";
import { clearCurrentPlayer } from "../speak-singleton";

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
}));

type Opts = { onEnded?: () => void };
const players: Array<{ opts: Opts; play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }> = [];

vi.mock("../webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(),
}));

const mockedPost = vi.mocked(postSpeakStream);
const mockedCreate = vi.mocked(createWebAudioStreamPlayer);

beforeEach(() => {
  players.length = 0;
  clearCurrentPlayer();
  mockedPost.mockReset();
  mockedPost.mockImplementation(async () => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }));
  mockedCreate.mockReset();
  mockedCreate.mockImplementation((opts: Opts = {}) => {
    const p = {
      opts,
      play: vi.fn(async () => {}),
      stop: vi.fn(),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
    };
    players.push(p);
    return p;
  });
});

afterEach(() => {
  setFileSpeakVoice(null);
});

describe("FileSpeakButton", () => {
  it("renders for prose files with text, not for code files or empty text", () => {
    const { rerender } = render(<FileSpeakButton filename="notes.md" text="Hello" />);
    expect(screen.queryByLabelText("Speak file")).not.toBeNull();
    rerender(<FileSpeakButton filename="data.json" text='{"a":1}' />);
    expect(screen.queryByLabelText("Speak file")).toBeNull();
    rerender(<FileSpeakButton filename="notes.md" text="   " />);
    expect(screen.queryByLabelText("Speak file")).toBeNull();
    rerender(<FileSpeakButton filename="notes.md" text={"```\ncode only\n```\n![img](a.png)"} />);
    expect(screen.queryByLabelText("Speak file")).toBeNull();
  });

  it("speaks the markdown as plain text in the fallback voice", async () => {
    setFileSpeakVoice("nova");
    render(<FileSpeakButton filename="notes.md" text={"# Title\n\nSome **bold** words."} />);
    fireEvent.click(screen.getByLabelText("Speak file"));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith("Title.\n\nSome bold words.", ["nova"]);
    await waitFor(() => expect(screen.queryByLabelText("Pause speaking")).not.toBeNull());
  });

  it("plays a long file as back-to-back pieces, holding the next piece while paused", async () => {
    const para = "word ".repeat(3000).trim(); // ~15k chars
    render(<FileSpeakButton filename="long.txt" text={`${para}\n\n${para}`} />);
    fireEvent.click(screen.getByLabelText("Speak file"));
    await waitFor(() => expect(players[0]?.play).toHaveBeenCalled());
    expect(mockedPost.mock.calls[0][0]).toBe(para);

    // Pause, then the first piece's audio finishes: the next piece waits
    // (not fetched, not played) until resume.
    fireEvent.click(screen.getByLabelText("Pause speaking"));
    expect(players[0].pause).toHaveBeenCalled();
    players[0].opts.onEnded?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Resume speaking")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Resume speaking"));
    await waitFor(() => expect(players[1]?.play).toHaveBeenCalled());
    expect(mockedPost.mock.calls[1][0]).toBe(para);
    expect(players[0].resume).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Pause speaking")).not.toBeNull();

    players[1].opts.onEnded?.();
    await waitFor(() => expect(screen.queryByLabelText("Speak file")).not.toBeNull());
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it("reads the fallback voice at click time, not render time", async () => {
    render(<FileSpeakButton filename="a.txt" text="Hello" />);
    setFileSpeakVoice("onyx");
    fireEvent.click(screen.getByLabelText("Speak file"));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("Hello", ["onyx"]));
  });

  it("switching to another file stops the one playing", async () => {
    const { rerender } = render(<FileSpeakButton filename="a.md" text="First file" />);
    fireEvent.click(screen.getByLabelText("Speak file"));
    await waitFor(() => expect(screen.queryByLabelText("Pause speaking")).not.toBeNull());
    rerender(<FileSpeakButton filename="b.md" text="Second file" />);
    expect(players[0].stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Speak file")).not.toBeNull();
  });

  it("pausing while the next piece downloads holds it until resume", async () => {
    const para = "word ".repeat(3000).trim();
    let release!: (r: Response) => void;
    render(<FileSpeakButton filename="long.txt" text={`${para}\n\n${para}`} />);
    fireEvent.click(screen.getByLabelText("Speak file"));
    await waitFor(() => expect(players[0]?.play).toHaveBeenCalled());

    mockedPost.mockImplementationOnce(
      () => new Promise<Response>((r) => { release = r; }),
    );
    players[0].opts.onEnded?.(); // piece 1 finishes; piece 2 starts downloading
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByLabelText("Pause speaking"));
    release(new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(players[1].play).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Resume speaking")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Resume speaking"));
    expect(players[1].play).toHaveBeenCalled();
  });
});
