/**
 * RelayOutboundBubble — a relay message the pane's agent sent.
 *
 * Folded DM card "Aster → Tina [DM]" when the room's members are known,
 * "Aster sent a DM" when not. The raw send command is never rendered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { RelayRoomMember } from "./relay-room-members";

vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(),
}));

const membersMock = vi.fn<(room: string | null | undefined, hostId: number | null | undefined) => RelayRoomMember[] | null>(() => null);
const viewerMxidMock = vi.fn<() => string | null>(() => "@robin:t1000.example");
vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: () => viewerMxidMock(),
}));

vi.mock("./relay-room-members", () => ({
  useRelayRoomMembers: (room: string | null | undefined, hostId: number | null | undefined) =>
    membersMock(room, hostId),
}));

import { useIdentities } from "@/state/identities-store";
import { RelayOutboundBubble } from "./RelayOutboundBubble";

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

const aster = makeIdentity("aster", "Aster", 32);
const tina = makeIdentity("tina", "Tina", 200);

beforeEach(() => {
  membersMock.mockReset();
  membersMock.mockReturnValue(null);
  vi.mocked(useIdentities).mockReturnValue({
    identities: [aster, tina],
    byKey: new Map([
      ["aster", aster],
      ["tina", tina],
    ]),
    byHostKey: new Map(),
    loaded: true,
    refresh: vi.fn(),
  });
});

function renderOut(props: Partial<React.ComponentProps<typeof RelayOutboundBubble>> = {}) {
  return render(
    <RelayOutboundBubble
      room="!abc:t1000.example"
      body="Hey Tina, is the fix deployed yet?"
      hostId={42}
      selfIdentity={aster}
      {...props}
    />,
  );
}

describe("RelayOutboundBubble", () => {
  it("members unknown → 'Aster sent a DM' with preview, folded", () => {
    renderOut();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toContain("Aster");
    expect(who).toContain("sent a");
    expect(who).toContain("DM");
    expect(screen.getByTestId("relay-outbound-preview").textContent).toBe(
      "Hey Tina, is the fix deployed yet?",
    );
    expect(screen.queryByTestId("relay-outbound-body")).toBeNull();
  });

  it("looks up members for the resolved room on the pane's host", () => {
    renderOut();
    expect(membersMock).toHaveBeenCalledWith("!abc:t1000.example", 42);
  });

  it("members known → 'Aster → Tina' DM", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:t1000.example", kind: "agent", displayName: null },
      { mxid: "@tina:t1000.example", kind: "agent", displayName: null },
    ]);
    renderOut();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*Tina/);
    expect(who).toContain("DM");
  });

  it("DM to the viewing user → 'You' + notified marker", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:t1000.example", kind: "agent", displayName: null },
      { mxid: "@robin:t1000.example", kind: "you", displayName: "Robin" },
    ]);
    renderOut();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*You/);
    expect(who).toContain("notified");
  });

  it("relay-mcp send to the viewer's mxid (no room) → 'You' + notified marker", () => {
    renderOut({ room: null, to: "@robin:t1000.example" });
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*You/);
    expect(who).toContain("notified");
  });

  it("relay-mcp send to the viewer by bare name → 'You'", () => {
    renderOut({ room: null, to: "Robin" });
    expect(screen.getByTestId("relay-who-line").textContent ?? "").toMatch(/Aster\s*→\s*You/);
  });

  it("relay-mcp send to an agent by identity name → that agent, no notified marker", () => {
    renderOut({ room: null, to: "tina" });
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*Tina/);
    expect(who).not.toContain("notified");
  });

  it("failed relay-mcp send to the viewer → 'not sent', never 'notified'", () => {
    renderOut({
      room: null,
      to: "@robin:t1000.example",
      result: { type: "relay_send_result", toolUseId: "t1", ok: false, roomId: null, error: "relay error: boom", eventId: "r1", ts: 0 },
    });
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*You/);
    expect(who).not.toContain("notified");
    expect(screen.getByTestId("relay-not-sent")).toHaveAttribute("title", "relay error: boom");
  });

  it("successful relay-mcp send → members looked up for the result's room", () => {
    renderOut({
      room: null,
      to: "tina",
      result: { type: "relay_send_result", toolUseId: "t1", ok: true, roomId: "!dm:t1000.example", error: null, eventId: "r1", ts: 0 },
    });
    expect(membersMock).toHaveBeenCalledWith("!dm:t1000.example", 42);
    expect(screen.queryByTestId("relay-not-sent")).toBeNull();
  });

  it("room members win over `to` when both are known", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:t1000.example", kind: "agent", displayName: null },
      { mxid: "@sam:t1000.example", kind: "human", displayName: "Sam" },
    ]);
    renderOut({ to: "tina" });
    expect(screen.getByTestId("relay-who-line").textContent ?? "").toMatch(/Aster\s*→\s*Sam/);
  });

  it("DM to another person → their display name, no notified marker", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:t1000.example", kind: "agent", displayName: null },
      { mxid: "@sam:t1000.example", kind: "human", displayName: "Sam" },
    ]);
    renderOut();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*Sam/);
    expect(who).not.toContain("notified");
  });

  it("open shows the message and a speak button; no raw command, no transport text", () => {
    renderOut({ room: "$RID" });
    fireEvent.click(screen.getByTestId("relay-outbound-header"));
    expect(screen.getByTestId("relay-outbound-body").textContent).toContain(
      "Hey Tina, is the fix deployed yet?",
    );
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
    const text = screen.getByTestId("relay-outbound-bubble").textContent ?? "";
    expect(text).not.toMatch(/\$RID|curl|raw command|relay send|unknown room/);
  });

  it("unextractable body → plain-language note, no preview, no speak button", () => {
    renderOut({ body: null });
    expect(screen.queryByTestId("relay-outbound-preview")).toBeNull();
    fireEvent.click(screen.getByTestId("relay-outbound-header"));
    expect(screen.getByTestId("relay-outbound-body").textContent).toBe(
      "Aster sent a message here, but its text couldn't be shown.",
    );
    expect(screen.queryByRole("button", { name: "Speak message" })).toBeNull();
  });

  it("relay-source view with no pane agent → the viewer's own send reads 'You'", () => {
    renderOut({ alwaysExpanded: true, selfIdentity: null });
    expect(screen.getByTestId("relay-outbound-header").textContent).toBe("You");
  });

  it("card uses the pane agent's hue", () => {
    renderOut();
    expect(screen.getByTestId("relay-outbound-bubble").getAttribute("data-bubble-hue")).toBe("32");
  });

  it("alwaysExpanded → plain chat bubble, no member lookup", () => {
    renderOut({ alwaysExpanded: true });
    expect(screen.getByTestId("relay-outbound-header").textContent).toBe("Aster");
    expect(screen.getByTestId("relay-outbound-body").textContent).toContain("Hey Tina");
    expect(membersMock).toHaveBeenCalledWith(null, 42);
  });
});
