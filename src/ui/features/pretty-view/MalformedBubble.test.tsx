/**
 * pv-malformed-jsonl-placeholder-bubble (2026-08-10) — MalformedBubble
 * component render tests.
 *
 * Compact placeholder rendered when the backend delivers a
 * {type:"malformed_line", bytes:N} WS frame — Claude Code's JSONL writer
 * occasionally races an assistant turn and a file-history-snapshot onto
 * the same line and cuts the first mid-string. Content is unrecoverable,
 * so the bubble carries only the byte count as a diagnostic hint that
 * something was silently dropped from the pretty view.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MalformedBubble } from "./MalformedBubble";

describe("MalformedBubble — malformed-JSONL placeholder rendering", () => {
  it("renders the byte count and the 'content lost' notice", () => {
    render(<MalformedBubble bytes={2307} />);
    expect(
      screen.getByText(
        /malformed JSONL line — 2307 bytes, content lost; check terminal/,
      ),
    ).toBeTruthy();
  });

  it("puts the timestamp on the outer element's title attribute when ts is provided", () => {
    const ts = Date.parse("2026-08-10T02:34:23.561Z");
    const { container } = render(<MalformedBubble bytes={1024} ts={ts} />);
    const withTitle = container.querySelector("[title]");
    expect(withTitle).toBeTruthy();
    expect(withTitle?.getAttribute("title")).toEqual(new Date(ts).toLocaleString());
  });

  it("omits the title attribute when ts is not provided", () => {
    const { container } = render(<MalformedBubble bytes={1024} />);
    const withTitle = container.querySelector("[title]");
    expect(withTitle).toBeNull();
  });
});
