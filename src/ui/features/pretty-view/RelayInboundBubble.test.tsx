/**
 * Phase 17 Plan 03 — RelayInboundBubble unit tests.
 *
 * Tests: RELAYBUB-02 (inbound bubble render matrix):
 *   (1) inline body — no fetch triggered
 *   (2) file-pointer body — fetch called; on 200 body inlined
 *   (3) fetch 404 — fetch-failed indicator visible
 *   (4) sender resolves to identity → avatar-dot carries colorHue
 *   (5) sender unresolved → neutral grey fallback + raw mxid displayed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import { RelayInboundBubble } from "./RelayInboundBubble";

const mockedUseIdentities = vi.mocked(useIdentities);

function makeIdentity(
  identityKey: string,
  displayName: string,
  colorHue: number,
): Identity {
  return {
    id: `id-${identityKey}`,
    identityKey,
    displayName,
    title: null,
    colorHue,
    avatarMime: "image/png",
    avatarUrl: "/avatar.png",
    avatarEtag: "abc",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
  it("Test 1: inline body (no pointer) → renders body text, no fetch triggered", () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="Nelly says the migration is finished."
        hostId={42}
      />,
    );

    expect(screen.getByText(/Nelly says the migration is finished/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test 2: file-pointer body → fetch called with /relay-pointer?hostId=...&path=... on 200, body inlined", async () => {
    const fetchedBody = "This is the full relay message body from file.";
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => fetchedBody,
    } as unknown as Response);

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="body written to /tmp/relay-msg-abc123.txt"
        hostId={42}
      />,
    );

    // Verify fetch was called with correct URL pattern
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/relay-pointer?");
    expect(url).toContain("hostId=42");
    expect(url).toContain(encodeURIComponent("/tmp/relay-msg-abc123.txt"));
    expect(opts?.credentials).toBe("include");

    // Fetched body is inlined
    await waitFor(() => {
      expect(screen.getByText(fetchedBody)).toBeTruthy();
    });
  });

  it("Test 3: fetch 404 → '📄 fetch failed (404)' visible", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not found",
    } as unknown as Response);

    render(
      <RelayInboundBubble
        room="!roomAlias:server.tld"
        sender="@tina:matrix.example.com"
        body="/tmp/relay-msg-xyz.txt"
        hostId={7}
      />,
    );

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
});
