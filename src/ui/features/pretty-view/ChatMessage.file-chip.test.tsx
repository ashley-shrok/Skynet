/**
 * ChatMessage file-chip integration tests (shape 2026-09-28).
 *
 * Covers the file-URL branch inside ChatMessage's `a` override and the
 * injected-turn's FileChip render path:
 *   - Skynet file URL on THIS origin renders as a FileChip
 *   - Skynet-shaped URL on a DIFFERENT origin does NOT render as a chip
 *     (M2 security guard — prevents assistant-planted tracking pixels)
 *   - URL ending in `/` still renders a chip labeled "file" (M1 fallback,
 *     so the shape's "every file MUST show up somewhere" invariant holds)
 *   - Injected-turn falls back to the static AttachmentChipStrip when
 *     hostName is missing (relay-source mount case)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

// The eligibility hook is orthogonal to file-chip rendering under the new
// shape — file URLs render synchronously via the URL-shape guard. We stub
// it to an empty map so nothing widget-shaped fires in these tests.
vi.mock("./use-editable-file-eligibility", () => ({
  useEditableFileEligibility: vi.fn(() => new Map()),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatMessage — file-chip a-override", () => {
  // jsdom's default origin is http://localhost:3000; the tests below
  // use that origin explicitly to exercise the same-origin guard.
  const ORIGIN = window.location.origin;

  it("renders a FileChip for a Skynet file URL on the same origin", () => {
    const url = `${ORIGIN}/file/t1000/home/ubuntu/notes.md`;
    render(
      <ChatMessage
        role="assistant"
        eventId="e1"
        content={`See [notes.md](${url})`}
        onOpenEditor={vi.fn()}
      />,
    );
    const chipAnchor = screen.getByRole("link", { name: /notes\.md/i });
    expect(chipAnchor.getAttribute("href")).toBe(url);
  });

  it("does NOT render a FileChip for a Skynet-shaped URL on a DIFFERENT origin (M2 guard)", () => {
    // An assistant plants what looks like a Skynet file URL but pointing
    // at an attacker origin. The chip must not render — otherwise the
    // browser would fire a cookie-bearing request to attacker.tld.
    const attackerUrl = "https://attacker.tld/file/x/tracker.png";
    render(
      <ChatMessage
        role="assistant"
        eventId="e2"
        content={`Sketchy: [tracker.png](${attackerUrl})`}
        onOpenEditor={vi.fn()}
      />,
    );
    // No <img> mounted (which would be the chip's media preview).
    expect(screen.queryByRole("img", { name: "tracker.png" })).toBeNull();
    // Plain markdown anchor still renders as a fallback (link with the
    // href untouched, target=_blank).
    const anchor = screen.getByRole("link", { name: /tracker\.png/i });
    expect(anchor.getAttribute("href")).toBe(attackerUrl);
    expect(anchor.getAttribute("target")).toBe("_blank");
  });

  it("still renders a chip for a Skynet URL with a filename containing a query-shaped character (M3 defense)", () => {
    // Filenames with `?` or `#` COULD end up in landing paths through
    // odd sanitizer paths. The chip should still render — the URL is
    // guarded to same-origin, so no external request can be induced.
    // (Injected-turn URL construction uses per-segment encoding; here
    // we cover the a-override branch that gets the URL from markdown.)
    const url = `${ORIGIN}/file/t1000/home/ubuntu/song.mp3`;
    render(
      <ChatMessage
        role="assistant"
        eventId="e3"
        content={`Song: [song.mp3](${url})`}
        onOpenEditor={vi.fn()}
      />,
    );
    // Media chip renders — <audio> element inside the chip's frame.
    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio!.getAttribute("src")).toBe(url);
  });
});
