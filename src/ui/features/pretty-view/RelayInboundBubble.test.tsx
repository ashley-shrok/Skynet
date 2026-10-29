/**
 * RelayInboundBubble — a relay message the pane's agent received.
 *
 * Harness view: folded DM card ("Tina → Aster [DM]" + one-line preview),
 * tap to open. Relay-source view: plain chat bubble. Long messages fetch
 * their full text via /relay-pointer and never show the pointer line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import { detectFilePointer } from "./relay-pointer-detect";
import type { RelayRoomMember } from "./relay-room-members";

vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(),
}));

const membersMock = vi.fn<(room: string | null | undefined, hostId: number | null | undefined) => RelayRoomMember[] | null>(() => null);
vi.mock("./relay-room-members", () => ({
  useRelayRoomMembers: (room: string | null | undefined, hostId: number | null | undefined) =>
    membersMock(room, hostId),
}));

import { useIdentities } from "@/state/identities-store";
import { RelayInboundBubble } from "./RelayInboundBubble";

const mockedUseIdentities = vi.mocked(useIdentities);

function makeIdentity(identityKey: string, displayName: string, colorHue: number): Identity {
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
    task: null,
    project: null,
  };
}

function seedIdentities(list: Identity[]) {
  const byKey = new Map(list.map((i) => [i.identityKey.toLowerCase(), i]));
  mockedUseIdentities.mockReturnValue({
    identities: list,
    byKey,
    byHostKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  });
}

const tina = makeIdentity("tina", "Tina", 200);
const aster = makeIdentity("aster", "Aster", 32);
const pixel = makeIdentity("pixel", "Pixel", 280);

const POINTER_PATH =
  "/home/ubuntu/fleet/identities/molly/relay-state/messages/_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt";
const POINTER_BODY = `[long message, 641 chars — full text at ${POINTER_PATH} — Read it] «Hi Aster — Vesper here. Heads up about the speak button…»`;

beforeEach(() => {
  vi.restoreAllMocks();
  membersMock.mockReset();
  membersMock.mockReturnValue(null);
  seedIdentities([tina, aster, pixel]);
});

function renderHarness(props: Partial<React.ComponentProps<typeof RelayInboundBubble>> = {}) {
  return render(
    <RelayInboundBubble
      room="!abc:harbor.example"
      sender="@tina:harbor.example"
      body="Yep, it went out this morning."
      hostId={42}
      selfIdentity={aster}
      {...props}
    />,
  );
}

describe("RelayInboundBubble — harness view (folded card)", () => {
  it("starts folded: who-line + preview, no body", () => {
    renderHarness();
    const who = screen.getByTestId("relay-who-line");
    expect(who.textContent).toContain("Tina");
    expect(who.textContent).toContain("→");
    expect(who.textContent).toContain("Aster");
    // shape-conversation-view: no DM tag, no ⓘ explainer, no "notified".
    expect(who.textContent).not.toContain("DM");
    expect(who.textContent).not.toContain("notified");
    expect(screen.getByTestId("relay-inbound-preview").textContent).toBe(
      "Yep, it went out this morning.",
    );
    expect(screen.queryByTestId("relay-inbound-body")).toBeNull();
    expect(screen.getByTestId("relay-inbound-header")).toHaveAttribute("aria-expanded", "false");
  });

  it("click opens: body + speak button, preview hidden; second click folds", () => {
    renderHarness();
    const header = screen.getByTestId("relay-inbound-header");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("relay-inbound-body").textContent).toContain(
      "Yep, it went out this morning.",
    );
    expect(screen.queryByTestId("relay-inbound-preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
    fireEvent.click(header);
    expect(screen.queryByTestId("relay-inbound-body")).toBeNull();
  });

  it("avatar slot shows the sender identity's avatar image", () => {
    renderHarness();
    const img = screen.getByTestId("relay-avatar-img");
    expect(img).toHaveAttribute("src", "/avatar.png");
  });

  it("avatar slot falls back to the initial when the image fails or the sender is unresolved", () => {
    renderHarness();
    fireEvent.error(screen.getByTestId("relay-avatar-img"));
    expect(screen.queryByTestId("relay-avatar-img")).toBeNull();
    expect(screen.getByTestId("relay-avatar").textContent).toBe("T");

    renderHarness({ sender: "@stranger:harbor.example" });
    const avatars = screen.getAllByTestId("relay-avatar");
    expect(avatars[avatars.length - 1].textContent).toBe("S");
  });

  it("Enter key toggles the card", () => {
    renderHarness();
    const header = screen.getByTestId("relay-inbound-header");
    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.getByTestId("relay-inbound-body")).toBeTruthy();
  });

  it("shows no technical text: no room id, no raw mxid, no transport names, no time", () => {
    renderHarness({ ts: Date.UTC(2026, 9, 14, 14, 16) });
    fireEvent.click(screen.getByTestId("relay-inbound-header"));
    const text = screen.getByTestId("relay-inbound-bubble").textContent ?? "";
    expect(text).not.toMatch(/!abc|@tina|harbor\.example|recv\.sh|curl|relay send/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    // Exact time is still available on hover.
    expect(screen.getByTestId("relay-inbound-bubble").getAttribute("title")).toBeTruthy();
  });

  it("unresolved sender reads as a name, not an address", () => {
    renderHarness({ sender: "@quinn:chat.example.org" });
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toContain("Quinn");
    expect(who).not.toContain("@quinn");
    expect(who).not.toContain("example.org");
  });

  it("card is tinted with the sender's hue; unresolved sender falls back to 210", () => {
    const { unmount } = renderHarness();
    expect(screen.getByTestId("relay-inbound-bubble").getAttribute("data-bubble-hue")).toBe("200");
    unmount();
    renderHarness({ sender: "@stranger:elsewhere.example" });
    expect(screen.getByTestId("relay-inbound-bubble").getAttribute("data-bubble-hue")).toBe("210");
  });

  it("members known, two in room → DM to the other member", () => {
    membersMock.mockReturnValue([
      { mxid: "@tina:harbor.example", kind: "agent", displayName: null },
      { mxid: "@pixel:harbor.example", kind: "agent", displayName: null },
    ]);
    renderHarness();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Tina\s*→\s*Pixel/);
    expect(who).not.toContain("DM");
  });

  it("members known, three in room → 'group with' and no DM tag", () => {
    membersMock.mockReturnValue([
      { mxid: "@tina:harbor.example", kind: "agent", displayName: null },
      { mxid: "@pixel:harbor.example", kind: "agent", displayName: null },
      { mxid: "@aster:harbor.example", kind: "agent", displayName: null },
    ]);
    renderHarness();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toContain("group with");
    expect(who).toContain("Pixel");
    expect(who).toContain("Aster");
    expect(who).not.toContain("DM");
  });

  it("no DM explainer (ⓘ) on the card", () => {
    renderHarness();
    expect(screen.queryByTestId("relay-dm-explainer")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("no member lookup in relay-source view", () => {
    renderHarness({ alwaysExpanded: true });
    expect(membersMock).toHaveBeenCalledWith(null, 42);
  });
});

describe("RelayInboundBubble — long messages", () => {
  it("folded preview is the quoted text, not the pointer line", () => {
    renderHarness({ body: POINTER_BODY });
    const preview = screen.getByTestId("relay-inbound-preview").textContent ?? "";
    expect(preview).toBe("Hi Aster — Vesper here. Heads up about the speak button");
    expect(preview).not.toContain("/home/");
  });

  it("opening fetches the full text via /relay-pointer and shows it", async () => {
    const fetchedBody = "This is the full relay message body from file.";
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => fetchedBody,
    } as unknown as Response);

    renderHarness({ body: POINTER_BODY });
    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/relay-pointer?");
    expect(url).toContain("hostId=42");
    expect(url).toContain(encodeURIComponent(POINTER_PATH));
    expect(opts?.credentials).toBe("include");

    await waitFor(() => expect(screen.getByText(fetchedBody)).toBeTruthy());
    expect(screen.getByTestId("relay-inbound-body").textContent).not.toContain("/home/");
  });

  it("fetch failure → preview text + plain-language note, no status codes", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "not found",
    } as unknown as Response);

    renderHarness({ body: POINTER_BODY });
    fireEvent.click(screen.getByTestId("relay-inbound-header"));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load the rest of this message/)).toBeTruthy(),
    );
    const body = screen.getByTestId("relay-inbound-body").textContent ?? "";
    expect(body).toContain("Heads up about the speak button");
    expect(body).not.toMatch(/404|fetch failed|\/home\//);
  });

  it("detectFilePointer matches recv.sh preview line format with em-dash boundaries", () => {
    const result = detectFilePointer(POINTER_BODY);
    expect(result).not.toBeNull();
    expect(result!.pointerPath).toBe(POINTER_PATH);
  });
});

describe("RelayInboundBubble — relay-source view (plain chat bubble)", () => {
  it("renders open with sender name + body + speak button, no DM chrome", () => {
    renderHarness({ alwaysExpanded: true, body: "Morning! The backup finished." });
    expect(screen.getByTestId("relay-inbound-header").textContent).toBe("Tina");
    expect(screen.getByTestId("relay-inbound-body").textContent).toBe("Morning! The backup finished.");
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
    expect(screen.queryByTestId("relay-who-line")).toBeNull();
    expect(screen.queryByText("DM")).toBeNull();
  });

  it("header is not a toggle", () => {
    renderHarness({ alwaysExpanded: true });
    expect(screen.getByTestId("relay-inbound-header").getAttribute("role")).toBeNull();
  });
});
