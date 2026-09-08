/**
 * Phase 90 Plan 02 Task 3 — RelayRoomInboundBubble fork tests.
 *
 * RelayRoomInboundBubble is a FORK (COPY-extraction) of RelayInboundBubble
 * per D-12 fork clarification (Ashley 2026-09-08 verbatim: "in relay
 * sessions, the collapsed nature of relay bubbles would not be what we want.
 * And there really wouldn't be a collapse feature in the relay sessions
 * because it doesn't make sense.").
 *
 * The fork:
 *   - Renders EXPANDED by default (no collapse state at all)
 *   - Has NO collapse/expand toggle button
 *   - Does NOT run pointer-detection (D-11: relay-room bubbles come from
 *     the relay directly, not parsed transcripts)
 *   - Preserves sender-hue visual encoding + left-alignment + resolved-
 *     identity dot from the original
 *   - Preserves T-17-03-01 security discipline (body rendered as React text
 *     child, never dangerouslySetInnerHTML)
 *
 * The original RelayInboundBubble stays byte-untouched in pretty view (D-03).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// Mock useIdentities so tests don't hit the real module store.
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [],
    byKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

import { useIdentities } from "@/state/identities-store";
import {
  RelayRoomInboundBubble,
  type RelayRoomInboundBubbleProps,
} from "./RelayRoomInboundBubble";

const mockedUseIdentities = vi.mocked(useIdentities);

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number,
): Identity {
  return {
    identityKey,
    displayName,
    title: null,
    colorHue,
    voice: null,
    role: null,
    avatarMime: "image/png",
    avatarUrl: "/avatar.png",
    avatarEtag: "abc",
    coordinator: false,
  };
}

function makeProps(overrides: Partial<RelayRoomInboundBubbleProps> = {}): RelayRoomInboundBubbleProps {
  return {
    room: "Working session",
    sender: "@tina:matrix.example.com",
    body: "hello from tina",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedUseIdentities.mockReturnValue({
    identities: [],
    byKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  });
});

describe("RelayRoomInboundBubble", () => {
  it("Test 1: renders EXPANDED by default — body visible on initial render, no click needed", () => {
    render(<RelayRoomInboundBubble {...makeProps({ body: "hello from tina" })} />);
    // Body visible without any user interaction.
    expect(screen.getByText("hello from tina")).toBeInTheDocument();
    // Body wrapper is present (the fork always renders it).
    expect(screen.getByTestId("relay-room-inbound-body")).toBeInTheDocument();
  });

  it("Test 2: NO aria-expanded attribute anywhere in bubble DOM (no collapse toggle exists)", () => {
    const { container } = render(<RelayRoomInboundBubble {...makeProps()} />);
    const elementsWithAriaExpanded = container.querySelectorAll("[aria-expanded]");
    expect(elementsWithAriaExpanded.length).toBe(0);
  });

  it("Test 3: NO click handler on the header — clicking header does not toggle any state", () => {
    render(<RelayRoomInboundBubble {...makeProps({ body: "static body" })} />);
    const header = screen.getByTestId("relay-room-inbound-header");
    // Header is a <div>, not a <button> — no click behavior at all.
    expect(header.tagName).toBe("DIV");
    // Click it — body should remain visible + identical.
    fireEvent.click(header);
    expect(screen.getByText("static body")).toBeInTheDocument();
    expect(screen.getByTestId("relay-room-inbound-body")).toBeInTheDocument();
  });

  it("Test 4: NO pointer-detection — file-pointer-shaped body renders verbatim, no fetch call, no 📄 icon", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    // Body matches the recv.sh file-pointer preview format that RelayInboundBubble
    // (the original) would detect and fetch. The fork must render it verbatim.
    const pointerBody =
      "[long message, 1960 chars — full text at /home/ubuntu/.claude/identities/molly/relay-state/messages/_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt — Read it] «preview text»";
    render(<RelayRoomInboundBubble {...makeProps({ body: pointerBody })} />);
    // fetch is not called (no pointer-detect path in the fork).
    expect(fetchSpy).not.toHaveBeenCalled();
    // No 📄 file-icon marker (that would be inserted by the pointer-detect
    // branch of the original — the fork does not have that branch).
    expect(screen.queryByText(/📄/)).toBeNull();
    // Raw body text renders verbatim.
    expect(screen.getByText(pointerBody)).toBeInTheDocument();
  });

  it("Test 5: identity resolution preserved — mxid → {colorHue, displayName}; avatar-dot carries color; displayName in header", () => {
    const tina = makeIdentity("tina", "Tina", 45);
    mockedUseIdentities.mockReturnValue({
      identities: [tina],
      byKey: new Map([["tina", tina]]),
      loaded: true,
      refresh: vi.fn(),
    });
    render(<RelayRoomInboundBubble {...makeProps({ sender: "@tina:matrix.example.com" })} />);
    // Avatar-dot carries the resolved color via data-avatar-color.
    const dot = document.querySelector("[data-testid='relay-room-inbound-avatar-dot']");
    expect(dot).not.toBeNull();
    const avatarColor = (dot as HTMLElement).getAttribute("data-avatar-color") ?? "";
    expect(avatarColor).toContain("hsl(45");
    // displayName visible in header.
    expect(screen.getByText(/Tina/)).toBeInTheDocument();
  });

  it("Test 6: hue-tinted bubble background preserved — data-bubble-hue carries the resolved hue", () => {
    const tina = makeIdentity("tina", "Tina", 45);
    mockedUseIdentities.mockReturnValue({
      identities: [tina],
      byKey: new Map([["tina", tina]]),
      loaded: true,
      refresh: vi.fn(),
    });
    render(<RelayRoomInboundBubble {...makeProps({ sender: "@tina:matrix.example.com" })} />);
    const bubble = document.querySelector("[data-testid='relay-room-inbound-bubble']");
    expect(bubble).not.toBeNull();
    // data-bubble-hue carries the raw numeric hue (matches original convention).
    expect((bubble as HTMLElement).getAttribute("data-bubble-hue")).toBe("45");
  });

  it("Test 7: unresolved mxid falls back to hue 210 (Ashley 2026-08-18 'don't really care about the fallback')", () => {
    // byKey empty — no match.
    render(<RelayRoomInboundBubble {...makeProps({ sender: "@unknown:matrix.example.com" })} />);
    const bubble = document.querySelector("[data-testid='relay-room-inbound-bubble']");
    expect(bubble).not.toBeNull();
    expect((bubble as HTMLElement).getAttribute("data-bubble-hue")).toBe("210");
  });

  it("Test 8: left-alignment preserved — outer wrapper carries justify-start (distinct testid from original to avoid collision)", () => {
    render(<RelayRoomInboundBubble {...makeProps()} />);
    const wrap = document.querySelector("[data-testid='relay-room-inbound-wrap']");
    expect(wrap).not.toBeNull();
    expect((wrap as HTMLElement).className).toContain("justify-start");
    expect((wrap as HTMLElement).className).not.toContain("justify-end");
  });

  it("Test 9: body rendered via React text child — T-17-03-01 preserved; screen.getByText matches verbatim", () => {
    const body = "hello world with <script>alert(1)</script> escaped as text";
    render(<RelayRoomInboundBubble {...makeProps({ body })} />);
    // React text child renders the whole string as text; the DOM contains
    // the literal string, no <script> element executes.
    expect(screen.getByText(body)).toBeInTheDocument();
    // No script tags anywhere.
    expect(document.querySelectorAll("script").length).toBe(0);
  });

  it("Test 10: ts prop propagates to bubble div title attribute (hover timestamp)", () => {
    const ts = 1725830000000; // arbitrary ms-epoch
    render(<RelayRoomInboundBubble {...makeProps({ ts })} />);
    const bubble = document.querySelector("[data-testid='relay-room-inbound-bubble']");
    expect(bubble).not.toBeNull();
    const title = (bubble as HTMLElement).getAttribute("title");
    expect(title).not.toBeNull();
    // toLocaleString is locale-dependent but always non-empty for a valid ts.
    expect(title!.length).toBeGreaterThan(0);
    // Sanity: contains a numeric year fragment.
    expect(title!).toMatch(/20\d\d|24|25|26/);
  });

  it("Test 11: NO 'via recv.sh' footer — that attribution is dropped for the relay-room fork", () => {
    render(<RelayRoomInboundBubble {...makeProps()} />);
    expect(screen.queryByText(/via recv\.sh/)).toBeNull();
  });
});
