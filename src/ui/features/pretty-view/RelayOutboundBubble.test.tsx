/**
 * RelayOutboundBubble — a relay message the pane's agent sent.
 *
 * Folded card "Aster → Tina" (no DM tag — shape-conversation-view) when the
 * room's members are known, "Aster sent a DM" in plain words when not. A
 * message to the viewing user is an open agent bubble (RelayToYouBubble):
 * the sidebar's red envelope when it went out, a "⚠ not sent" mark when it
 * failed. The raw send command is never rendered.
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
const viewerMxidMock = vi.fn<() => string | null>(() => "@robin:harbor.example");
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
      room="!abc:harbor.example"
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
    // Unresolvable addressing still reads as plain words.
    expect(who).toContain("sent a DM");
    expect(screen.getByTestId("relay-outbound-preview").textContent).toBe(
      "Hey Tina, is the fix deployed yet?",
    );
    expect(screen.queryByTestId("relay-outbound-body")).toBeNull();
  });

  it("looks up members for the resolved room on the pane's host", () => {
    renderOut();
    expect(membersMock).toHaveBeenCalledWith("!abc:harbor.example", 42);
  });

  it("members known → 'Aster → Tina', no DM tag", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:harbor.example", kind: "agent", displayName: null },
      { mxid: "@tina:harbor.example", kind: "agent", displayName: null },
    ]);
    renderOut();
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*Tina/);
    expect(who).not.toContain("DM");
    expect(screen.queryByTestId("relay-dm-explainer")).toBeNull();
  });

  // A message to the viewing user is read in place: an open agent bubble,
  // never a folded card (shape-conversation-view).
  function expectToYouBubble() {
    const bubble = screen.getByTestId("relay-outbound-bubble");
    expect(bubble).toHaveAttribute("data-to-you", "true");
    // Painted in the sidebar's notified red, not the sender's colour (and
    // never the multi-role / roleless hue surface).
    expect(bubble).toHaveClass("pv-bubble-notified");
    expect(bubble).not.toHaveClass("pv-hue-surface");
    expect(screen.getByTestId("relay-envelope")).toBeTruthy();
    expect(screen.getByTestId("relay-outbound-body").textContent).toContain("Hey Tina, is the fix deployed yet?");
    // No who-line / header / preview / "notified" label.
    expect(screen.queryByTestId("relay-who-line")).toBeNull();
    expect(screen.queryByTestId("relay-outbound-header")).toBeNull();
    expect(screen.queryByTestId("relay-outbound-preview")).toBeNull();
    expect(bubble.textContent ?? "").not.toContain("notified");
  }

  it("DM to the viewing user → an open bubble with the red envelope", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:harbor.example", kind: "agent", displayName: null },
      { mxid: "@robin:harbor.example", kind: "you", displayName: "Robin" },
    ]);
    renderOut();
    expectToYouBubble();
    expect(screen.getByTestId("relay-envelope")).toHaveAttribute("role", "img");
    expect(screen.getByTestId("relay-envelope").getAttribute("aria-label")).toMatch(/^Notified you/);
    // Speak sits with the bubble.
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
  });

  it("relay-mcp send to the viewer's mxid (no room) → open bubble with the envelope", () => {
    renderOut({ room: null, to: "@robin:harbor.example" });
    expectToYouBubble();
  });

  it("relay-mcp send to the viewer by bare name → open bubble with the envelope", () => {
    renderOut({ room: null, to: "Robin" });
    expectToYouBubble();
  });

  it("relay-mcp send to an agent by identity name → that agent, no notified marker", () => {
    renderOut({ room: null, to: "tina" });
    const who = screen.getByTestId("relay-who-line").textContent ?? "";
    expect(who).toMatch(/Aster\s*→\s*Tina/);
    expect(who).not.toContain("notified");
  });

  it("failed relay-mcp send to the viewer → still an open bubble, no envelope, '⚠ not sent' with the reason on tap", () => {
    renderOut({
      room: null,
      to: "@robin:harbor.example",
      result: { type: "relay_send_result", toolUseId: "t1", ok: false, roomId: null, error: "relay error: boom", eventId: "r1", ts: 0 },
    });
    const bubble = screen.getByTestId("relay-outbound-bubble");
    // Never folded — the words stay readable.
    expect(screen.getByTestId("relay-outbound-body").textContent).toContain("Hey Tina, is the fix deployed yet?");
    expect(screen.queryByTestId("relay-who-line")).toBeNull();
    // It never reached the phone: no envelope, no data-to-you.
    expect(bubble).not.toHaveAttribute("data-to-you");
    // Never notified, so not red: the sender's colour.
    expect(bubble).not.toHaveClass("pv-bubble-notified");
    expect(bubble).toHaveClass("pv-hue-surface");
    expect(screen.queryByTestId("relay-envelope")).toBeNull();
    expect(bubble.textContent ?? "").not.toContain("notified");
    // "⚠ not sent" — tap to read why.
    const notSent = screen.getByTestId("relay-not-sent-reason");
    const btn = screen.getByRole("button", { name: "⚠ not sent" });
    expect(btn).toHaveAttribute("title", "relay error: boom");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(notSent.textContent).not.toContain("relay error: boom");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(notSent.textContent).toContain("relay error: boom");
  });

  it("failed relay-mcp send to an agent → folded card marked '⚠ not sent' (reason on hover), reason in the opened body", () => {
    renderOut({
      room: null,
      to: "tina",
      result: { type: "relay_send_result", toolUseId: "t1", ok: false, roomId: null, error: "relay error: boom", eventId: "r1", ts: 0 },
    });
    expect(screen.getByTestId("relay-who-line").textContent ?? "").toMatch(/Aster\s*→\s*Tina/);
    expect(screen.getByTestId("relay-not-sent")).toHaveAttribute("title", "relay error: boom");
    expect(screen.queryByTestId("relay-not-sent-reason")).toBeNull();
    fireEvent.click(screen.getByTestId("relay-outbound-header"));
    expect(screen.getByTestId("relay-not-sent-reason")).toBeTruthy();
  });

  it("successful relay-mcp send → members looked up for the result's room", () => {
    renderOut({
      room: null,
      to: "tina",
      result: { type: "relay_send_result", toolUseId: "t1", ok: true, roomId: "!dm:harbor.example", error: null, eventId: "r1", ts: 0 },
    });
    expect(membersMock).toHaveBeenCalledWith("!dm:harbor.example", 42);
    expect(screen.queryByTestId("relay-not-sent")).toBeNull();
  });

  it("room members win over `to` when both are known", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:harbor.example", kind: "agent", displayName: null },
      { mxid: "@sam:harbor.example", kind: "human", displayName: "Sam" },
    ]);
    renderOut({ to: "tina" });
    expect(screen.getByTestId("relay-who-line").textContent ?? "").toMatch(/Aster\s*→\s*Sam/);
  });

  it("DM to another person → their display name, no notified marker", () => {
    membersMock.mockReturnValue([
      { mxid: "@aster:harbor.example", kind: "agent", displayName: null },
      { mxid: "@sam:harbor.example", kind: "human", displayName: "Sam" },
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
