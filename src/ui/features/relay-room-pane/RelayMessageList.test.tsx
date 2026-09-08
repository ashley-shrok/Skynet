/**
 * Phase 90 Plan 05 Task 2 — RelayMessageList tests.
 *
 * RelayMessageList is the bubble list wrapper for the relay-room pane:
 *   - Dispatches per-event render: viewingUser sender → OutboundBubble (D-13),
 *     otherwise → RelayRoomInboundBubble (D-12 fork consumption).
 *   - Hosts LoadMoreOlderButton at the top (D-14 reuse-as-is).
 *   - Renders D-19 attachment placeholder text ("attachment: <filename>") for
 *     inbound events with m.image/m.file/m.video/m.audio msgtype.
 *   - Empty history → empty middle (D-17 — no special empty-state chrome).
 *   - Pending-send correlation via unsigned.transaction_id === mqid (Pitfall 4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// Mock useIdentities so the forked inbound bubble renders without hitting the
// real identities module store.
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [],
    byKey: new Map<string, Identity>(),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

// Mock use-mobile so the badge primitives (indirectly imported by IdentityBadge
// via any transitive path) don't try to attach a MediaQueryList listener.
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { RelayMessageList } from "./RelayMessageList";
import type { MatrixEvent } from "./relay-room-api";

const VIEWING_MXID = "@ashley:matrix.example.com";
const OTHER_MXID = "@tina:matrix.example.com";

function makeEvent(overrides: Partial<MatrixEvent> = {}): MatrixEvent {
  return {
    event_id: `$evt-${Math.random()}`,
    type: "m.room.message",
    sender: OTHER_MXID,
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: "m.text", body: "hello" },
    ...overrides,
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    history: [] as MatrixEvent[],
    viewingUserMxid: VIEWING_MXID,
    pendingSends: [] as Array<{ mqid: string; content: string; state: "sending" | "failed" }>,
    hasOlder: false,
    loadOlderStatus: "idle" as const,
    loadOlderError: null as string | null,
    onLoadOlder: vi.fn(),
    roomTitle: "Working session" as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RelayMessageList (Phase 90 Plan 05 Task 2)", () => {
  it("Test 1: renders RelayRoomInboundBubble for other-user event + OutboundBubble for viewing-user event", () => {
    const history: MatrixEvent[] = [
      makeEvent({
        event_id: "$e1",
        sender: OTHER_MXID,
        content: { msgtype: "m.text", body: "hi from tina" },
      }),
      makeEvent({
        event_id: "$e2",
        sender: VIEWING_MXID,
        content: { msgtype: "m.text", body: "hi from ashley" },
      }),
    ];
    const { container } = render(<RelayMessageList {...makeProps({ history })} />);
    // Inbound bubble present.
    expect(container.querySelector('[data-testid="relay-room-inbound-wrap"]')).not.toBeNull();
    // Outbound (pv-bubble class carries the outbound gradient in OutboundBubble).
    expect(container.querySelector(".pv-bubble")).not.toBeNull();
    // Both bodies visible.
    expect(screen.getByText("hi from tina")).toBeInTheDocument();
    expect(screen.getByText("hi from ashley")).toBeInTheDocument();
  });

  it("Test 2: viewing-user event with matching pendingSend mqid renders OutboundBubble in sending state", () => {
    const history: MatrixEvent[] = [
      makeEvent({
        event_id: "$e-echo",
        sender: VIEWING_MXID,
        content: { msgtype: "m.text", body: "in flight" },
        unsigned: { transaction_id: "mqid-abc" },
      }),
    ];
    const pendingSends = [
      { mqid: "mqid-abc", content: "in flight", state: "sending" as const },
    ];
    render(<RelayMessageList {...makeProps({ history, pendingSends })} />);
    // OutboundBubble's sending state renders the twin-arc Loader2 with
    // data-pv-bubble-spinner attr.
    expect(document.querySelector("[data-pv-bubble-spinner]")).not.toBeNull();
  });

  it("Test 3 (D-19): inbound event with m.image msgtype renders 'attachment: <filename>' placeholder", () => {
    const history: MatrixEvent[] = [
      makeEvent({
        event_id: "$e-img",
        sender: OTHER_MXID,
        content: {
          msgtype: "m.image",
          body: "diagram.png",
          info: { filename: "diagram.png" },
        },
      }),
    ];
    render(<RelayMessageList {...makeProps({ history })} />);
    expect(screen.getByText("attachment: diagram.png")).toBeInTheDocument();
  });

  it("Test 3b (D-19): inbound event with m.file msgtype falls back to content.body for filename", () => {
    const history: MatrixEvent[] = [
      makeEvent({
        event_id: "$e-file",
        sender: OTHER_MXID,
        content: {
          msgtype: "m.file",
          body: "report.pdf",
        },
      }),
    ];
    render(<RelayMessageList {...makeProps({ history })} />);
    expect(screen.getByText("attachment: report.pdf")).toBeInTheDocument();
  });

  it("Test 4: LoadMoreOlderButton renders at top with hasOlder=true and click fires onLoadOlder", () => {
    const onLoadOlder = vi.fn();
    render(
      <RelayMessageList
        {...makeProps({ hasOlder: true, onLoadOlder })}
      />,
    );
    // LoadMoreOlderButton renders a Button whose aria-label matches its state.
    const btn = screen.getByRole("button", { name: /load older messages/i });
    fireEvent.click(btn);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("Test 4b: hasOlder=false → LoadMoreOlderButton renders nothing (no-lie invariant)", () => {
    const { container } = render(<RelayMessageList {...makeProps({ hasOlder: false })} />);
    // No buttons whose aria-label is about older messages.
    expect(container.querySelector('[aria-label*="older messages" i]')).toBeNull();
  });

  it("Test 5 (D-17): empty history array renders no bubbles + no empty-state chrome", () => {
    const { container } = render(<RelayMessageList {...makeProps({ history: [] })} />);
    // No inbound bubbles.
    expect(container.querySelector('[data-testid="relay-room-inbound-wrap"]')).toBeNull();
    // No outbound bubbles.
    expect(container.querySelector(".pv-bubble")).toBeNull();
    // No "empty state" chrome (no text like "no messages yet").
    expect(container.textContent?.toLowerCase() ?? "").not.toContain("no messages");
    expect(container.textContent?.toLowerCase() ?? "").not.toContain("empty");
    expect(container.textContent?.toLowerCase() ?? "").not.toContain("start the conversation");
  });

  it("Test 6: no dangerouslySetInnerHTML on rendered bodies (T-17-03-01 discipline)", () => {
    const history: MatrixEvent[] = [
      makeEvent({
        event_id: "$e1",
        sender: OTHER_MXID,
        content: { msgtype: "m.text", body: "<script>alert(1)</script>" },
      }),
    ];
    render(<RelayMessageList {...makeProps({ history })} />);
    // If dangerouslySetInnerHTML were used, the <script> would render as
    // markup; React text-child renders it verbatim as text.
    expect(
      screen.getByText("<script>alert(1)</script>"),
    ).toBeInTheDocument();
  });

  it("Test 7 (D-12 fork consumption): imports RelayRoomInboundBubble (the fork), NOT RelayInboundBubble (the pretty-view original)", async () => {
    // Read the source file and grep for the import statement.
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("./RelayMessageList.tsx", import.meta.url),
      "utf8",
    );
    // Must import the fork.
    expect(source).toMatch(/import[^\n]*RelayRoomInboundBubble/);
    // Must NOT import from pretty-view.
    expect(source).not.toMatch(/from\s+["'].*pretty-view\/RelayInboundBubble["']/);
    // Must NOT import the un-forked name at all.
    expect(source).not.toMatch(/import[^\n]*\bRelayInboundBubble\b(?!\w)/);
  });
});
