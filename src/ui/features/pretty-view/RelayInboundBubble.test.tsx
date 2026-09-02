/**
 * Phase 17 Plan 03 — RelayInboundBubble unit tests.
 *
 * Tests: RELAYBUB-02 (inbound bubble render matrix):
 *   (1) inline body — no fetch triggered
 *   (2) file-pointer body — fetch called; on 200 body inlined (identity-dir path shape)
 *   (3) fetch 404 — fetch-failed indicator visible
 *   (4) sender resolves to identity → avatar-dot carries colorHue
 *   (5) sender unresolved → neutral grey fallback + raw mxid displayed
 *   (6) detectFilePointer matches recv.sh preview line format with em-dash boundaries
 *
 * Updated 2026-07-28 (UAT Bug 2 fix): file-pointer paths updated to
 * ~/.claude/identities/<id>/relay-state/messages/<eventid>.txt shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import { detectFilePointer } from "./relay-pointer-detect";

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
import { RelayInboundBubble } from "./RelayInboundBubble";

const mockedUseIdentities = vi.mocked(useIdentities);

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number,
): Identity {
  // Phase 68: Identity no longer has id/createdAt/updatedAt.
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

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: empty identity store
  mockedUseIdentities.mockReturnValue({
    identities: [],
    byKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  });
});

describe("RelayInboundBubble", () => {
  it("Test 1: inline body (no pointer) → renders body text (after expand), no fetch triggered", () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says the migration is finished."
        hostId={42}
      />,
    );

    // Bubble starts collapsed — expand it first.
    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    expect(screen.getByText(/Nelly says the migration is finished/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test 2: file-pointer body → fetch called with /relay-pointer?hostId=...&path=... on 200, body inlined (identity-dir path shape)", async () => {
    const fetchedBody = "This is the full relay message body from file.";
    const identityPath = "/home/ubuntu/.claude/identities/molly/relay-state/messages/_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt";
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => fetchedBody,
    } as unknown as Response);

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body={`body written to ${identityPath}`}
        hostId={42}
      />,
    );

    // Bubble starts collapsed — expand it first so the fetch fires.
    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    // Verify fetch was called with correct URL pattern
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/relay-pointer?");
    expect(url).toContain("hostId=42");
    expect(url).toContain(encodeURIComponent(identityPath));
    expect(opts?.credentials).toBe("include");

    // Fetched body is inlined
    await waitFor(() => {
      expect(screen.getByText(fetchedBody)).toBeTruthy();
    });
  });

  it("Test 3: fetch 404 → '📄 fetch failed (404)' visible (after expand)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    } as unknown as Response);

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="/home/ubuntu/.claude/identities/tina/relay-state/messages/abc-xyz.txt"
        hostId={7}
      />,
    );

    // Bubble starts collapsed — expand it first so the fetch fires.
    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    await waitFor(() => {
      expect(screen.getByText(/fetch failed \(404\)/i)).toBeTruthy();
    });
  });

  it("Test 4: sender resolves to identity → avatar-dot span carries the identity's colorHue in inline style", () => {
    const tina = makeIdentity("tina", "Tina", 45);
    mockedUseIdentities.mockReturnValue({
      identities: [tina],
      byKey: new Map([["tina", tina]]),
      loaded: true,
      refresh: vi.fn(),
    });

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Hello from Tina"
        hostId={1}
      />,
    );

    // Find the avatar-dot span — it should carry the resolved identity's colorHue.
    // We read data-avatar-color (the raw hsl string) because jsdom normalises
    // hsl() to rgb() in both .style.color and the style attribute.
    const avatarDot = document.querySelector("[data-testid='relay-inbound-avatar-dot']");
    expect(avatarDot).not.toBeNull();
    const avatarColor = (avatarDot as HTMLElement).getAttribute("data-avatar-color") ?? "";
    expect(avatarColor).toContain("hsl(45");
  });

  it("Test 5: sender doesn't resolve → avatar-dot uses hsl(210, 8%, 50%) neutral fallback + raw mxid displayed", () => {
    // byKey is empty — no match
    mockedUseIdentities.mockReturnValue({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    });

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@unknown:matrix.example.com"
        body="A message from nobody"
        hostId={1}
      />,
    );

    // Raw mxid should be visible as displayName fallback
    expect(screen.getByText(/@unknown:matrix\.example\.com/)).toBeTruthy();

    // Avatar-dot should use neutral grey fallback.
    // We read data-avatar-color because jsdom normalises hsl() to rgb().
    const avatarDot = document.querySelector("[data-testid='relay-inbound-avatar-dot']");
    expect(avatarDot).not.toBeNull();
    const avatarColor = (avatarDot as HTMLElement).getAttribute("data-avatar-color") ?? "";
    expect(avatarColor).toBe("hsl(210, 8%, 50%)");
  });

  it("Test 6b: wrapper uses justify-start (left-aligned — multi-user chat convention, 2026-08-18)", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="hello"
        hostId={1}
      />,
    );
    const wrap = document.querySelector("[data-testid='relay-inbound-wrap']");
    expect(wrap).not.toBeNull();
    expect((wrap as HTMLElement).className).toContain("justify-start");
    expect((wrap as HTMLElement).className).not.toContain("justify-end");
  });

  it("Test 6c: bubble background/border/shadow tinted with sender's resolved colorHue", () => {
    const tina = makeIdentity("tina", "Tina", 45);
    mockedUseIdentities.mockReturnValue({
      identities: [tina],
      byKey: new Map([["tina", tina]]),
      loaded: true,
      refresh: vi.fn(),
    });

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="hello from tina"
        hostId={1}
      />,
    );

    const bubble = document.querySelector("[data-testid='relay-inbound-bubble']");
    expect(bubble).not.toBeNull();
    // data-bubble-hue carries the raw numeric hue so tests can assert without
    // relying on jsdom's inline-style parsing (which strips gradients).
    expect((bubble as HTMLElement).getAttribute("data-bubble-hue")).toBe("45");
  });

  it("Test 6d: unresolved sender → bubble falls back to hue 210 (Ashley 2026-08-18: don't care about fallback)", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@unknown:matrix.example.com"
        body="hello"
        hostId={1}
      />,
    );

    const bubble = document.querySelector("[data-testid='relay-inbound-bubble']");
    expect(bubble).not.toBeNull();
    expect((bubble as HTMLElement).getAttribute("data-bubble-hue")).toBe("210");
  });

  it("Test 6: detectFilePointer matches recv.sh preview line format with em-dash boundaries", () => {
    // The exact reproducer string from Ashley's UAT (2026-07-28).
    // recv.sh preview line format: "[long message, N chars — full text at <path> — Read it] «...»"
    // The path is bounded by " — " (ASCII space + em-dash + ASCII space) on both sides.
    // JS \s matches the ASCII space adjacent to the em-dash, so the existing \s boundaries work.
    const reproStr =
      "[long message, 1960 chars — full text at /home/ubuntu/.claude/identities/molly/relay-state/messages/_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt — Read it] «Huge. Signal received before I invested…»";
    const result = detectFilePointer(reproStr);
    expect(result).not.toBeNull();
    expect(result?.pointerPath).toBe(
      "/home/ubuntu/.claude/identities/molly/relay-state/messages/_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt",
    );
  });

  // C1-C4: Collapse-by-default tests (quick 260829-qb9)
  it("C1: renders collapsed on mount — header visible, body NOT in DOM, footer NOT in DOM", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says hello"
        hostId={1}
      />,
    );

    // Header must be visible
    expect(screen.getByTestId("relay-inbound-header")).toBeTruthy();
    // displayName · room text visible
    expect(screen.getByText(/@tina:matrix\.example\.com/)).toBeTruthy();

    // Body wrapper must NOT be in DOM
    expect(screen.queryByTestId("relay-inbound-body")).toBeNull();
    // Footer text must NOT be in DOM
    expect(screen.queryByText(/via recv\.sh/)).toBeNull();
  });

  it("C2: aria-expanded='false' on header button when collapsed", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="hello"
        hostId={1}
      />,
    );

    const header = screen.getByTestId("relay-inbound-header");
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("C3: click header → body renders and footer appears; aria-expanded='true'", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says hello"
        hostId={1}
      />,
    );

    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    expect(screen.getByText(/Nelly says hello/)).toBeTruthy();
    expect(screen.getByText(/via recv\.sh/)).toBeTruthy();
    expect(screen.getByTestId("relay-inbound-header").getAttribute("aria-expanded")).toBe("true");
  });

  it("C4: second click re-collapses — body + footer gone; aria-expanded='false'", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says hello"
        hostId={1}
      />,
    );

    const header = screen.getByTestId("relay-inbound-header");
    fireEvent.click(header); // expand
    fireEvent.click(header); // collapse again

    expect(screen.queryByTestId("relay-inbound-body")).toBeNull();
    expect(screen.queryByText(/via recv\.sh/)).toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  // quick-260830-e6i Part B: shrink collapsed padding to match ChatMessage pill.
  it("C5: collapsed bubble uses tight padding (12/7); expanded bubble uses roomy padding (18/14)", () => {
    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says hello"
        hostId={1}
      />,
    );

    // Collapsed by default — tight padding.
    const bubble = screen.getByTestId("relay-inbound-bubble");
    expect(bubble).toHaveClass("px-[12px]");
    expect(bubble).toHaveClass("py-[7px]");
    expect(bubble).not.toHaveClass("px-[18px]");
    expect(bubble).not.toHaveClass("py-[14px]");

    // Expand — roomy padding.
    fireEvent.click(screen.getByTestId("relay-inbound-header"));
    expect(bubble).toHaveClass("px-[18px]");
    expect(bubble).toHaveClass("py-[14px]");
    expect(bubble).not.toHaveClass("px-[12px]");
    expect(bubble).not.toHaveClass("py-[7px]");
  });
});
