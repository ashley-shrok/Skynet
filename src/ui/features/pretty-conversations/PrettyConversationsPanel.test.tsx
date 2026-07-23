// ─── PrettyConversationsPanel — Vitest coverage ──────────────────────────────
// 15 tests for the flat-list panel from Phase 10 Plan 02 Task 2:
//   1)  Empty state renders idle glass card ("No conversations yet")
//   2)  Pinned rows render at top, grouped rows below (DOM order)
//   3)  NO "Pinned" section header; NO per-host semibold header
//   4)  RDP-sentinel HostGroup renders at bottom with "Remote desktop" divider
//   5)  Header pencil opens NewSessionDialog
//   6)  Header pencil NOT rendered when onCreateSession undefined
//   7)  Desktop header shows title "Conversations"
//   8)  Mobile header omits title text
//   9)  Desktop gear renders when onRailClick provided
//  10)  Mobile gear NEVER renders (even when onRailClick provided)
//  11)  settingsRowSlot renders at BOTTOM of scroll region on mobile
//  12)  Row click routes RDP → onRdpRowClick (not onDetachedRowClick, not selectConversation)
//  13)  Row click routes fleetOnly → onDetachedRowClick (not onRdpRowClick)
//  14)  Row click on plain row calls selectConversation
//  15)  onConversationSelected fires after every dispatcher branch
//
// Mock pattern lifted from NewSessionDialog.test.tsx §mocks (lines 14-35):
// react-i18next passthrough, session-hue / identities-store / touch-device
// inert stubs so PrettyConversationRow's renders are deterministic.
//
// The conversation-store is mocked at module level with a mutable
// `snapshot` object + `setSnapshot(...)` helper so tests inject
// pinned/grouped/selectedId/pinnedIds directly rather than driving the
// real derivation. This mirrors the plan's decision (Task 2 §action).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Global mocks (BEFORE component import — Vitest hoists vi.mock) ──────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) =>
    name ? name.toLowerCase() : null,
}));

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// ─── conversation-store mock ────────────────────────────────────────────────
// Mutable snapshot + spies for the two mutating actions the panel calls.
// Every test resets via setSnapshot(...) in beforeEach.

type MockRow = {
  id: string;
  type: string;
  label: string;
  host?: Host | undefined;
  targetTmuxSession: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
};

type MockGroup = {
  hostId: string;
  hostName: string;
  rows: MockRow[];
};

type MockSnapshot = {
  pinned: MockRow[];
  grouped: MockGroup[];
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
};

let snapshot: MockSnapshot = {
  pinned: [],
  grouped: [],
  selectedId: null,
  pinnedIds: new Set(),
};

function setSnapshot(next: Partial<MockSnapshot>): void {
  snapshot = {
    pinned: next.pinned ?? [],
    grouped: next.grouped ?? [],
    selectedId: next.selectedId ?? null,
    pinnedIds: next.pinnedIds ?? new Set(),
  };
}

const selectConversationSpy = vi.fn();
const togglePinConversationSpy = vi.fn();

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    pinned: snapshot.pinned,
    grouped: snapshot.grouped,
  }),
  useSelectedConversationId: () => snapshot.selectedId,
  usePinnedIds: () => snapshot.pinnedIds,
  // Patch #137: PrettyConversationsPanel now subscribes to useActiveSet
  // to drive per-row ambient recession + ready-dot visibility. Mock
  // returns an empty ReadonlySet (no rows in the active-set) so this
  // test file continues to exercise the ambient rendering path — none
  // of the tests below assert dot presence or bubble intensity, so
  // this is behaviorally invisible to them.
  useActiveSet: () => new Set<string>(),
  selectConversation: (id: string | null) => selectConversationSpy(id),
  togglePinConversation: (id: string) => togglePinConversationSpy(id),
}));

// Patch #137: PrettyConversationsPanel calls useSessionWorking(sessionKey)
// inside its per-row PrettyConversationRowLive micro-component. Mock
// returns null for every key so the ready-dot render condition is never
// satisfied — matches this test file's pre-patch-#137 behavior of never
// rendering a dot at any render site.
vi.mock("@/state/session-working-store", () => ({
  useSessionWorking: () => null,
}));

// ─── Component under test (import AFTER mocks) ──────────────────────────────

import { PrettyConversationsPanel } from "./PrettyConversationsPanel";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeHost(id: string, name: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name,
    username: "user",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "password",
    enableTerminal: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: false,
    enableDocker: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  } as Host;
}

function makeConversationRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "row-x",
    type: "terminal",
    label: "session-x",
    host: makeHost("h1", "hostA"),
    targetTmuxSession: null,
    ...overrides,
  };
}

const ONE_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("h1", "hostA")],
};

beforeEach(() => {
  vi.clearAllMocks();
  setSnapshot({
    pinned: [],
    grouped: [],
    selectedId: null,
    pinnedIds: new Set(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Empty state renders idle glass card
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: empty state", () => {
  it("Test 1: renders idle glass card and NO PrettyConversationRow when list is empty", () => {
    setSnapshot({ pinned: [], grouped: [] });
    const { container, queryByText, queryAllByTestId } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );

    // Empty-state text is present
    expect(queryByText(/no conversations yet/i)).toBeTruthy();

    // Empty card carries the gradient glass background — check the raw
    // style attribute / class for the gradient marker.
    const emptyCard = container.querySelector(
      '[data-testid="pretty-conversations-empty"]',
    ) as HTMLElement | null;
    expect(emptyCard).toBeTruthy();
    // The gradient marker lives in the Tailwind arbitrary-value bracket
    // class — the class list should include the linear-gradient token
    // authored in the source (blue-gray no-identity treatment).
    expect(emptyCard!.className).toContain("linear-gradient");

    // NO conversation-row instances rendered.
    const rows = container.querySelectorAll("[data-conversation-id]");
    expect(rows.length).toBe(0);

    // Also assert PrettyConversationRow avatar test-id is absent (belt-
    // and-suspenders — if a row DID render we would find its avatar).
    expect(queryAllByTestId("pcrow-avatar").length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Pinned rows render at top, grouped rows below (DOM order)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: pinned-first ordering", () => {
  it("Test 2: pinned rows precede grouped rows in DOM order", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [
        makeConversationRow({ id: "a", label: "alpha", host: hostA }),
        makeConversationRow({ id: "b", label: "bravo", host: hostA }),
      ],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "c", label: "charlie", host: hostA }),
            makeConversationRow({ id: "d", label: "delta", host: hostA }),
          ],
        },
      ],
      selectedId: null,
      pinnedIds: new Set(["a", "b"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" />);
    const rowNodes = Array.from(
      container.querySelectorAll("[data-conversation-id]"),
    ) as HTMLElement[];
    const ids = rowNodes.map((n) => n.getAttribute("data-conversation-id"));
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — No "Pinned" section header; no per-host semibold header
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: no section headers", () => {
  it('Test 3: does NOT render a "Pinned" section header or a per-host semibold header', () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "c", label: "charlie", host: hostA }),
          ],
        },
      ],
      pinnedIds: new Set(["a"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" />);

    // No standalone "Pinned" section header rendered. The pin GLYPH on
    // each row (a Wave 1 concern that surfaces as `data-pinned="true"`
    // + a lucide Pin svg + PinAction aria-label "Pin/Unpin") is the ONLY
    // marker. This test checks for a discrete header ELEMENT whose direct
    // text is "Pinned" — NOT a raw HTML substring, which would incorrectly
    // catch row-level pin affordances.
    //
    // Walk every element in the container; assert none has its own direct
    // text (excluding descendant text) that reads as a "Pinned" header.
    const walk = (
      node: HTMLElement,
      cb: (el: HTMLElement) => void,
    ): void => {
      cb(node);
      for (const c of Array.from(node.children) as HTMLElement[]) walk(c, cb);
    };
    let sawPinnedHeader = false;
    walk(container, (el) => {
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (/^pinned$/i.test(directText)) sawPinnedHeader = true;
    });
    expect(sawPinnedHeader).toBe(false);

    // No per-host semibold header rendered — the row's secondary line
    // renders host.name inside the row itself, but no standalone group
    // header. Assert the host name "hostA" only appears inside a row body
    // (as row-secondary-line text) and NOT as a group header (which would
    // appear OUTSIDE any [data-conversation-id] element).
    const rowNodes = Array.from(
      container.querySelectorAll("[data-conversation-id]"),
    ) as HTMLElement[];
    const rowIds = new Set(
      rowNodes.map((n) => n.getAttribute("data-conversation-id") ?? ""),
    );
    expect(rowIds.has("a")).toBe(true);
    expect(rowIds.has("c")).toBe(true);
    // "hostA" text appears inside each row's secondary line — but we
    // assert there's no ancestor node CARRYING hostA text that ISN'T
    // itself a data-conversation-id row wrapper. Reuses the walk helper
    // declared above for the "Pinned" header check.
    let sawHostAOutsideRow = false;
    walk(container, (el) => {
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? "")
        .join("");
      if (!/^\s*hostA\s*$/.test(directText)) return;
      // Element has "hostA" as its own direct text — check ancestry.
      let n: HTMLElement | null = el;
      let inRow = false;
      while (n) {
        if (n.hasAttribute("data-conversation-id")) {
          inRow = true;
          break;
        }
        n = n.parentElement;
      }
      if (!inRow) sawHostAOutsideRow = true;
    });
    expect(sawHostAOutsideRow).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — RDP-sentinel HostGroup renders at bottom with a "Remote desktop"
//          divider chip; RDP row follows the identity-tmux row in DOM order
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: RDP sentinel at bottom", () => {
  it('Test 4: __rdp__ group renders a "Remote desktop" divider and its row appears AFTER the identity-tmux row', () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "a", label: "alpha", host: hostA }),
          ],
        },
        {
          hostId: "__rdp__",
          hostName: "",
          rows: [
            makeConversationRow({
              id: "r1",
              label: "GIGAASHLEYPC",
              host: rdpHost,
              rdpHostRow: true,
              targetTmuxSession: null,
            }),
          ],
        },
      ],
    });

    const { container, queryByText } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );

    // Divider chip present
    expect(queryByText(/remote desktop/i)).toBeTruthy();
    expect(
      container.querySelector('[data-testid="rdp-divider"]'),
    ).toBeTruthy();

    // Row DOM ordering: identity row `a` precedes RDP row `r1`
    const rowA = container.querySelector(
      '[data-conversation-id="a"]',
    ) as HTMLElement;
    const rowR1 = container.querySelector(
      '[data-conversation-id="r1"]',
    ) as HTMLElement;
    expect(rowA).toBeTruthy();
    expect(rowR1).toBeTruthy();
    expect(rowR1.getAttribute("data-rdp-host-row")).toBe("true");

    // Node.DOCUMENT_POSITION_FOLLOWING = 4 — rowA precedes rowR1.
    expect(rowA.compareDocumentPosition(rowR1) & 4).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Header pencil opens NewSessionDialog
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: header pencil opens dialog", () => {
  it("Test 5: clicking the pencil opens the NewSessionDialog", () => {
    const { getByRole } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
      />,
    );

    const pencilBtn = getByRole("button", { name: /new session/i });
    fireEvent.click(pencilBtn);

    // NewSessionDialog uses shadcn Dialog which renders inside a portal.
    // getByRole("dialog") queries the whole document body.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // The dialog also contains the "Start a new conversation" title text
    // (NewSessionDialog i18n defaultValue) — sanity check.
    expect(dialog!.textContent).toMatch(/start a new conversation/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Header pencil NOT rendered when onCreateSession is undefined
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: pencil gate", () => {
  it("Test 6: pencil button is absent when onCreateSession is undefined", () => {
    const { queryByRole } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );
    expect(queryByRole("button", { name: /new session/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Desktop header shows title "Conversations"
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: desktop header title", () => {
  it('Test 7: desktop variant renders "Conversations" title text', () => {
    const { queryByText } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );
    // Exact-word match with case insensitivity to avoid picking up longer
    // strings that happen to contain "conversations".
    expect(queryByText(/^conversations$/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Mobile header omits title text
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile header no title", () => {
  it("Test 8: mobile variant omits the Conversations title but keeps pencil when wired", () => {
    const { queryByText, queryByRole } = render(
      <PrettyConversationsPanel
        variant="mobile"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
      />,
    );
    // No standalone "Conversations" title on mobile.
    expect(queryByText(/^conversations$/i)).toBeNull();
    // Pencil still present when onCreateSession is provided.
    expect(queryByRole("button", { name: /new session/i })).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Desktop gear removed (patch #133)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: desktop gear removed (patch #133)", () => {
  it("Test 9: desktop variant does NOT render the gear button (patch #133 removed shadcn DropdownMenu gear entirely)", () => {
    const { queryByRole } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );
    // Post-patch-#133: gear DropdownMenu removed entirely; no button with a
    // settings-matching aria-label should exist in either variant.
    expect(queryByRole("button", { name: /settings/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Mobile gear removed (patch #133)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile gear removed (patch #133)", () => {
  it("Test 10: mobile variant does NOT render the gear button (patch #133 removed shadcn DropdownMenu gear entirely)", () => {
    const { queryByRole } = render(
      <PrettyConversationsPanel variant="mobile" />,
    );
    expect(queryByRole("button", { name: /settings/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — settingsRowSlot renders at BOTTOM of scroll region on mobile
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile settings slot position", () => {
  it("Test 11: settingsRowSlot renders AFTER row entries in DOM order on mobile", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      grouped: [],
      pinnedIds: new Set(["a"]),
    });

    const { container, getByTestId } = render(
      <PrettyConversationsPanel
        variant="mobile"
        settingsRowSlot={<div data-testid="settings-slot">SETTINGS</div>}
      />,
    );

    const slot = getByTestId("settings-slot") as HTMLElement;
    const rowA = container.querySelector(
      '[data-conversation-id="a"]',
    ) as HTMLElement;
    expect(slot).toBeTruthy();
    expect(rowA).toBeTruthy();
    // Slot must FOLLOW row `a` in DOM order.
    expect(rowA.compareDocumentPosition(slot) & 4).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Row click routes RDP → onRdpRowClick
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (RDP)", () => {
  it("Test 12: clicking an RDP row calls onRdpRowClick and NOT selectConversation/onDetachedRowClick", () => {
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    const rdpRow = makeConversationRow({
      id: "r1",
      label: "GIGAASHLEYPC",
      host: rdpHost,
      rdpHostRow: true,
      targetTmuxSession: null,
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "__rdp__", hostName: "", rows: [rdpRow] }],
    });

    const onRdpRowClick = vi.fn();
    const onDetachedRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onRdpRowClick={onRdpRowClick}
        onDetachedRowClick={onDetachedRowClick}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="r1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(onRdpRowClick).toHaveBeenCalledTimes(1);
    expect(onRdpRowClick.mock.calls[0][0].id).toBe("r1");
    expect(onDetachedRowClick).not.toHaveBeenCalled();
    expect(selectConversationSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13 — Row click routes fleetOnly → onDetachedRowClick
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (fleet-only)", () => {
  it("Test 13: clicking a fleetOnly row calls onDetachedRowClick and NOT onRdpRowClick", () => {
    const hostA = makeHost("h1", "hostA");
    const detachedRow = makeConversationRow({
      id: "fleet::1::nelly",
      label: "nelly",
      host: hostA,
      fleetOnly: true,
      targetTmuxSession: "nelly",
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [detachedRow] }],
    });

    const onDetachedRowClick = vi.fn();
    const onRdpRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDetachedRowClick={onDetachedRowClick}
        onRdpRowClick={onRdpRowClick}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="fleet::1::nelly"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(onDetachedRowClick).toHaveBeenCalledTimes(1);
    expect(onDetachedRowClick.mock.calls[0][0].id).toBe("fleet::1::nelly");
    expect(onRdpRowClick).not.toHaveBeenCalled();
    expect(selectConversationSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — Row click on plain row calls selectConversation
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (plain)", () => {
  it("Test 14: clicking a plain openTabs-derived row calls selectConversation", () => {
    const hostA = makeHost("h1", "hostA");
    const plainRow = makeConversationRow({
      id: "t1",
      label: "session-1",
      host: hostA,
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [plainRow] }],
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="t1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("t1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15 — onConversationSelected fires after every dispatcher branch
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: onConversationSelected after every branch", () => {
  it("Test 15: onConversationSelected fires for plain, fleet-only, and RDP row clicks", () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });

    const plainRow = makeConversationRow({
      id: "t1",
      label: "session-1",
      host: hostA,
    });
    const fleetRow = makeConversationRow({
      id: "fleet::1::nelly",
      label: "nelly",
      host: hostA,
      fleetOnly: true,
      targetTmuxSession: "nelly",
    });
    const rdpRow = makeConversationRow({
      id: "r1",
      label: "GIGAASHLEYPC",
      host: rdpHost,
      rdpHostRow: true,
      targetTmuxSession: null,
    });

    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [plainRow, fleetRow],
        },
        {
          hostId: "__rdp__",
          hostName: "",
          rows: [rdpRow],
        },
      ],
    });

    const onConversationSelected = vi.fn();
    const onDetachedRowClick = vi.fn();
    const onRdpRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onConversationSelected={onConversationSelected}
        onDetachedRowClick={onDetachedRowClick}
        onRdpRowClick={onRdpRowClick}
      />,
    );

    // Plain row → onConversationSelected("t1")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="t1"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );
    // Fleet-only row → onConversationSelected("fleet::1::nelly")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="fleet::1::nelly"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );
    // RDP row → onConversationSelected("r1")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="r1"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );

    expect(onConversationSelected).toHaveBeenCalledTimes(3);
    expect(onConversationSelected.mock.calls[0][0]).toBe("t1");
    expect(onConversationSelected.mock.calls[1][0]).toBe("fleet::1::nelly");
    expect(onConversationSelected.mock.calls[2][0]).toBe("r1");
  });
});
