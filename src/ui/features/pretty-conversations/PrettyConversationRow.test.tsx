// ─── PrettyConversationRow — Vitest coverage ─────────────────────────────────
// 18 (+15b, +18b) tests covering the row component after Phase 13 Plan 01
// lift-from-mock v4:
//   1) Desktop selected-row renders with `selected` class + `--pv-hue`
//      inline custom property (was: inline hsla interpolation)
//   2) Mobile swipe past 40px threshold opens the reveal strip
//   3) Mobile swipe under threshold snaps closed
//   4) Vertical gesture > 12px yields to browser scroll (no open, no select)
//   5) Tap on swiped-open row closes it (does NOT fire onSelect)
//   6) Tap on closed row fires onSelect
//   7) RDP row (rdpHostRow=true) has `rdp` class + no swipe strip + no
//      PinAction
//   8) Desktop pin button e.stopPropagation() — click fires togglePin only
//   9) Avatar fallback for no-identity row renders a tabIcon svg
//  10) Pinned desktop row carries `pinned` class + PinAction present in DOM
//      (CSS hover-reveal / hide-when-not-pinned is untested in jsdom because
//      CSS pseudo-selectors don't run; the class presence is the reliable
//      jsdom signal)
//  11) No identity-chip in DOM (session name IS identity name)
//  12) [Phase 13] Unselected non-RDP active-set row with hue renders
//      neither `selected` nor `ambient` class + inline style contains
//      `--pv-hue: 210` — proves the full-bubble class-toggle branch is
//      taken. CSS handles the actual visual response; the class + hue
//      custom property together lock the JS-emission contract.
//  13) [Phase 13] inActiveSet+isWorking===false renders ready-dot with
//      aria-label="ready" and matching data attribute
//  14) [Phase 13] RDP row + inActiveSet+isWorking===false renders the dot
//      span (CSS handles the fill via `--pv-hue: 216` fallback → hsla-based
//      background, since RDP rows in the panel actually never satisfy the
//      isWorking===false condition — the panel passes isWorking={null} for
//      RDP rows — this test asserts the component-level render invariant)
//  15) [Phase 13] inActiveSet+isWorking===true renders NO ready-dot (JS
//      gate)
//  16) [Phase 13] inActiveSet+isWorking===null renders NO ready-dot (JS
//      gate)
//  17) [Phase 13] !inActiveSet+isWorking===false renders NO ready-dot (JS
//      gate)
// 15b) [quick-260730-qbl] inActiveSet+isWorking===false+isRecycling===true
//      renders NO ready-dot (JS gate) AND row carries `recycling` class
//      (CSS defense-in-depth gate)
//  18) [Phase 13] !inActiveSet && !isRdp row carries `ambient` class
//  18b) [Phase 13] RDP row is EXEMPT from ambient — carries `rdp` class,
//      does NOT carry `ambient` class
//
// Migration note: pre-Phase-13 tests asserted flat-hsla background inline
// style probes because the row emitted computed CSSProperties for base +
// variant treatments. Post-Phase-13, state variants are CSS class toggles;
// the tests assert on className presence instead. CSS pseudo-selectors do
// not run in jsdom, so we do NOT assert visibility-by-computed-style —
// we assert the CLASS presence, which is what drives the visibility in a
// real browser. Real-browser UAT (Wave 3 plan 13-04) covers CSS-driven
// visibility.
//
// As of quick-260730-o2m, PinAction + DeactivateAction no longer render in
// the desktop `.pv-meta` column — those actions moved into the right-click
// context menu (unconditional on desktop non-RDP rows). Mobile swipe-strip
// render is unchanged. Tests that previously asserted `[data-testid=
// "pin-action"]` presence on desktop rows now assert absence + assert the
// row body carries an `onContextMenu` handler and that dispatching a
// contextmenu event opens the portal menu (portal-mounted to document.body,
// so use `screen` / `within` — not `container` — to query it). Test 8 and
// Test 10 were rewritten; Test 7b augmented with an RDP no-onContextMenu
// guard; four new tests appended (18c/18d/18e/18f).
//
// Fixture pattern lifted from src/ui/sidebar/NewSessionDialog.test.tsx lines
// 14-35 verbatim: mock react-i18next passthrough, mock session-hue helpers
// and identities-store to per-test-controllable outputs.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent, screen, within } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import type { Host } from "@/types/ui-types";

// ─── Mocks (BEFORE component import — Vitest hoists vi.mock) ────────────────

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

// Per-test override handle: tests set `currentIdentity` to control what the
// mocked useIdentities().byKey resolves for the fixture row.
let currentIdentity: Identity | null = null;

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => {
    const byKey = new Map<string, Identity>();
    if (currentIdentity) {
      byKey.set(currentIdentity.identityKey, currentIdentity);
    }
    return { byKey, identities: [], loaded: true, refresh: async () => {} };
  },
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// Per-test override handle for useBountyCounts. Tests set
// `currentBountyCounts` to control the pair returned by the mocked hook.
// Default is undefined (pre-fetch / no pair landed).
let currentBountyCounts:
  | { pinnedCount: number; needsDeskCount: number }
  | undefined = undefined;

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => currentBountyCounts,
}));

// tabIcon is a real dep — no need to mock. tabUtils.tsx does pull in a wide
// dependency graph via renderTabContent, but for tabIcon-only usage the graph
// is tree-shaken irrelevant during test runs.

import { PrettyConversationRow } from "./PrettyConversationRow";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: "hA",
    name: "thenasty",
    username: "root",
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

function makeRow(
  overrides: Partial<ConversationRowShape> = {},
): ConversationRowShape {
  return {
    id: "conv-1",
    type: "terminal",
    label: "nelly",
    host: makeHost(),
    targetTmuxSession: "nelly",
    ...overrides,
  };
}

function makeIdentity(hue: number, name = "nelly"): Identity {
  return {
    id: "id-1",
    identityKey: name.toLowerCase(),
    displayName: name,
    title: null,
    colorHue: hue,
    avatarMime: "image/png",
    // Empty avatarUrl → the row falls back to the initial-letter render path
    // (avoids any real network fetch during tests).
    avatarUrl: "",
    avatarEtag: "",
    createdAt: "",
    updatedAt: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentIdentity = null;
  currentBountyCounts = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Desktop selected row applies `selected` class + `--pv-hue` inline
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: selected-row hue treatment (class + custom property)", () => {
  it("Test 1: desktop selected row carries `selected` class AND inline `--pv-hue`", () => {
    currentIdentity = makeIdentity(30, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={true}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper!.getAttribute("data-selected")).toBe("true");

    // The row body is the role="button" element; state variants are CSS class
    // toggles composed into its className.
    const body = wrapper!.querySelector('[role="button"]') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.className).toContain("pv-row");
    expect(body.className).toContain("pv-row--desktop");
    expect(body.className).toContain("selected");
    expect(body.className).toContain("active-set");
    // The row emits `--pv-hue: 30` inline for hue-bearing rows. jsdom's
    // CSSOM preserves CSS custom properties in the raw style attribute.
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).toContain("--pv-hue: 30");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 2/3/4/5 (mobile swipe machinery) DELETED in quick-260802-pq2.
// Coverage moves to the new "PrettyConversationRow: mobile long-press context
// menu" describe block at the end of this file (TL1-TL5) — the swipe-to-
// reveal action strip was replaced with a long-press → PrettyConversation
// ContextMenu (same component desktop right-click uses).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Tap on closed row fires onSelect
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: tap-to-select on closed row", () => {
  it("Test 6: click on closed row fires onSelect exactly once", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — RDP row (rdpHostRow=true) has `rdp` class + no swipe + no pin
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: RDP-row exclusion (T-Test-34)", () => {
  it("Test 7: mobile RDP row carries `rdp` class + no PinAction (RDP long-press guard covered by TL4)", () => {
    // quick-260802-pq2: the swipe touch sequence + data-swiped-open assertion
    // were dropped from this test. RDP no-long-press-menu is verified in TL4
    // (bottom of file). Test 7 keeps the RDP class + no-PinAction assertions
    // + data-rdp-host-row shape guard.
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;

    // No PinAction rendered.
    expect(wrapper.querySelector('[data-testid="pin-action"]')).toBeNull();

    // Row body carries the `rdp` class.
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("rdp");

    // Data-rdp-host-row set for downstream styling.
    expect(wrapper.getAttribute("data-rdp-host-row")).toBe("true");
  });

  it("Test 7b: desktop RDP row carries `rdp` class + no PinAction + context menu NOW opens (quick-260804-uo4 gate relaxed)", () => {
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    expect(wrapper.querySelector('[data-testid="pin-action"]')).toBeNull();
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("rdp");
    // quick-260804-uo4: the row-level isRdp gate on onContextMenu was dropped.
    // Dispatching a contextmenu event on a desktop RDP row now DOES open the
    // portal menu (new invariant — replaces the old "menu stays null" assertion).
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Desktop pin button e.stopPropagation() — click fires togglePin only
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: desktop context-menu pin path", () => {
  it("Test 8: desktop non-RDP row wires onContextMenu; contextmenu → Pin item → onTogglePin fires only (not onSelect)", () => {
    // Post quick-260730-o2m: the always-visible desktop PinAction in .pv-meta
    // is gone. Pin is reachable via the right-click context menu instead.
    // The menu is portal-mounted to document.body (see
    // PrettyConversationContextMenu.tsx createPortal(…, document.body)) so we
    // query via `screen`, not `container`.
    //
    // Note: PrettyConversationContextMenu uses useLayoutEffect for viewport
    // clamping which reads getBoundingClientRect. jsdom returns zeros for
    // width/height there, so the clamp is a no-op and the menu renders at
    // (clientX, clientY) verbatim.
    currentIdentity = makeIdentity(200, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const pinItem = screen.getByRole("menuitem", { name: /pin/i });
    fireEvent.click(pinItem);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Avatar fallback for no-identity row renders a tabIcon svg
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: no-identity avatar fallback", () => {
  it("Test 9: no identity → avatar contains tabIcon(row.type) svg", () => {
    // currentIdentity is null (reset in beforeEach) — useIdentities().byKey
    // will not resolve the row's targetTmuxSession, so hue is null and the
    // tabIcon fallback path renders.
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const avatar = container.querySelector(
      '[data-testid="pcrow-avatar"]',
    ) as HTMLElement | null;
    expect(avatar).toBeTruthy();
    // tabIcon("terminal") is a lucide Terminal svg. Assert an svg is rendered
    // inside the avatar container (fallback path).
    expect(avatar!.querySelector("svg")).toBeTruthy();
    // No <img> in the fallback path.
    expect(avatar!.querySelector("img")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Pinned desktop row carries `pinned` class + PinAction in DOM
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: pinned desktop row → context menu carries `Unpin` label", () => {
  it("Test 10: pinned=true → row carries `pinned` class AND context menu opens with an `Unpin` menu item", () => {
    currentIdentity = makeIdentity(80, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    // The `pinned` class on the row body is a CSS-driven visual state on
    // the row itself, not the pin button — the row is still `.pinned`
    // regardless of where the pin action lives.
    expect(body.className).toContain("pinned");
    // Post quick-260730-o2m: the always-visible desktop PinAction in
    // .pv-meta is gone; Pin/Unpin lives in the right-click context menu.
    // The label flips based on `pinned` (see PrettyConversationRow.tsx
    // items.push({ label: pinned ? "Unpin" : "Pin", … })).
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /unpin/i })).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — No identity-chip in DOM (session name IS identity name)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: no identity chip", () => {
  it("Test 11: neither variant renders an IdentityBadge in the DOM", () => {
    currentIdentity = makeIdentity(45, "nelly");
    const { container: cMobile } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    expect(cMobile.innerHTML).not.toContain("IdentityBadge");
    expect(cMobile.querySelector("[data-testid='identity-badge']")).toBeNull();

    const { container: cDesktop } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    expect(cDesktop.innerHTML).not.toContain("IdentityBadge");
    expect(cDesktop.querySelector("[data-testid='identity-badge']")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — [Phase 13] Unselected non-RDP active-set row: full-bubble branch
//           (neither `selected` nor `ambient` class, `--pv-hue` inline)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 full-bubble class-toggle branch", () => {
  it("Test 12: unselected non-RDP active-set row has neither `selected` nor `ambient` class + `--pv-hue: 210` inline", () => {
    currentIdentity = makeIdentity(210, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("pv-row");
    expect(body.className).toContain("active-set");
    // Full-bubble branch: NOT selected, NOT ambient, NOT rdp.
    expect(body.className).not.toContain("selected");
    // We must use a word-boundary check because "pv-row--mobile"/"pv-row--desktop"
    // don't contain "ambient", and no other class contains "ambient" so
    // a plain substring check suffices.
    expect(body.className).not.toContain("ambient");
    expect(body.className).not.toContain("rdp");
    // `--pv-hue: 210` inline drives the CSS hsla() expressions.
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).toContain("--pv-hue: 210");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13 — [Phase 13] inActiveSet + isWorking===false renders ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ready-dot render", () => {
  it("Test 13: inActiveSet+isWorking===false renders ready-dot with aria-label='ready' + data attribute", () => {
    currentIdentity = makeIdentity(210, "nelly");
    const { getByLabelText, queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
      />,
    );
    const dot = getByLabelText("ready") as HTMLElement;
    expect(dot.getAttribute("data-pv-conv-ready-dot")).toBe("true");
    expect(dot.className).toContain("pv-ready-dot");
    // Steady — no animation string in the inline style.
    expect(dot.style.animation).toBe("");
    // Regression: the old patch-#136 aria-label must be absent.
    expect(queryByLabelText("working")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — [Phase 13] RDP row + inActiveSet+isWorking===false: dot in DOM
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ready-dot component-level render for RDP", () => {
  it("Test 14: RDP row with inActiveSet+isWorking===false renders the dot span (component-level invariant)", () => {
    // Note: in the real app, PrettyConversationsPanel passes isWorking=null
    // for RDP rows because their sessionWorkingKey resolves against a null
    // tmuxSession → useSessionWorking returns null. This test exercises the
    // component-level contract only (JS gate: inActiveSet && isWorking===false
    // → render the dot). CSS handles the fill; the neutral `--pv-hue: 216`
    // fallback applies for hue-null rows.
    const { getByLabelText } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
      />,
    );
    const dot = getByLabelText("ready") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.className).toContain("pv-ready-dot");
    expect(dot.getAttribute("data-pv-conv-ready-dot")).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15 — [Phase 13] inActiveSet + isWorking===true renders NO ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ready-dot suppression — working", () => {
  it("Test 15: inActiveSet+isWorking===true renders NO ready-dot AND row carries `working` class", () => {
    currentIdentity = makeIdentity(210);
    const { container, queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={true}
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("working");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 16 — [Phase 13] inActiveSet + isWorking===null renders NO ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ready-dot suppression — unknown", () => {
  it("Test 16: inActiveSet+isWorking===null renders NO ready-dot AND row does NOT carry `working` class", () => {
    currentIdentity = makeIdentity(210);
    const { container, queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={null}
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("working");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 17 — [Phase 13] !inActiveSet + isWorking===false renders NO ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ready-dot suppression — ambient", () => {
  it("Test 17: !inActiveSet+isWorking===false renders NO ready-dot", () => {
    currentIdentity = makeIdentity(210);
    const { queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={false}
        isWorking={false}
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15b — [quick-260730-qbl] inActiveSet + isWorking===false +
//            isRecycling===true renders NO ready-dot AND row carries
//            `recycling` class (JS + CSS gates verified end-to-end)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: quick-260730-qbl ready-dot suppression — recycling overlay active", () => {
  it("Test 15b: inActiveSet+isWorking===false+isRecycling===true renders NO ready-dot AND row carries `recycling` class", () => {
    currentIdentity = makeIdentity(210);
    const { container, queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
        isRecycling={true}
      />,
    );
    // JS gate: `!isRecycling` suppresses the ready-dot span entirely.
    expect(queryByLabelText("ready")).toBeNull();
    // CSS defense-in-depth gate: `.pv-row.recycling` class must be present
    // so the CSS `:not(.recycling)` selector at pretty-conversations.css
    // line 463 also gates the dot even if a future JS regression were to
    // restore the span.
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("recycling");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15c — [quick-260802-w9e] inActiveSet + isWorking===false +
//            hasQueuePending===true renders NO ready-dot
//            (JS gate; extends the row-level dot predicate with the fourth
//            conjunct `!hasQueuePending` for the pinned bounty
//            `hide-idle-dot-when-queued-message-waiting-to-send`).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: quick-260802-w9e ready-dot suppression — queue armed", () => {
  it("Test 15c: inActiveSet+isWorking===false+hasQueuePending===true renders NO ready-dot (JS gate)", () => {
    currentIdentity = makeIdentity(210);
    const { queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
        hasQueuePending={true}
      />,
    );
    // JS gate: `!hasQueuePending` suppresses the ready-dot span entirely
    // even though the row would otherwise satisfy the pre-w9e predicate
    // (inActiveSet && isWorking===false && !isRecycling).
    expect(queryByLabelText("ready")).toBeNull();
  });

  it("Test 15c-guard: hasQueuePending default (false) preserves existing dot render (regression guard)", () => {
    // Verify that the new prop defaults to false so ALL pre-w9e call sites
    // (which do NOT pass hasQueuePending) continue to render the dot when
    // the other three predicates are satisfied. Guards against a
    // hypothetical default flip that would silently suppress every
    // pre-existing consumer's dot.
    currentIdentity = makeIdentity(210);
    const { queryByLabelText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
        /* hasQueuePending omitted — must default to false → dot renders */
      />,
    );
    expect(queryByLabelText("ready")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18 — [Phase 13] Ambient recession + RDP exemption (class-based)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 13 ambient recession (class toggle)", () => {
  it("Test 18: !inActiveSet && !isRdp row carries `ambient` class + does NOT carry `selected`/`rdp`", () => {
    currentIdentity = makeIdentity(210, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={false}
        /* isWorking omitted — defaults to null */
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("pv-row");
    expect(body.className).toContain("ambient");
    expect(body.className).not.toContain("selected");
    expect(body.className).not.toContain("rdp");
    expect(body.className).not.toContain("active-set");
    // Hue custom property still emitted so CSS ambient block can resolve
    // `hsla(var(--pv-hue), 40%, 20%, 0.16)` etc.
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).toContain("--pv-hue: 210");
  });

  it("Test 18b: RDP row is EXEMPT from ambient — carries `rdp` class, does NOT carry `ambient`", () => {
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={false}
        isWorking={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("rdp");
    expect(body.className).not.toContain("ambient");
    // RDP rows have no hue → no `--pv-hue` inline (CSS fallback of 216 on
    // `.pv-row` applies but the .rdp block uses non-hue backgrounds so no
    // visual leak).
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).not.toContain("--pv-hue");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18c/d/e/f — [quick-260730-o2m] Desktop context-menu-only + mobile
//                  untouched regression guards
// ─────────────────────────────────────────────────────────────────────────────
// Direct regression guards for the strip: the always-visible desktop
// PinAction + DeactivateAction icons in .pv-meta are gone; both actions live
// ONLY in the right-click context menu (unconditional on desktop non-RDP) and
// the mobile swipe strip (untouched). The four tests below lock this:
//   18c — no PinAction / no DeactivateAction in desktop .pv-meta
//   18d — desktop contextmenu opens portal menu with Pin + Deactivate items
//         when inActiveSet AND onDeactivate provided
//   18e — desktop contextmenu opens portal menu with Pin only when
//         !inActiveSet
//   18f — mobile contextmenu is a no-op (no portal menu) AND mobile
//         swipe-strip PinAction IS present

describe("PrettyConversationRow: quick-260730-o2m context-menu default regression guards", () => {
  it("Test 18c: desktop non-RDP row has NO PinAction and NO DeactivateAction in .pv-meta (post quick-260730-o2m strip)", () => {
    currentIdentity = makeIdentity(210, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={vi.fn()}
        inActiveSet={true}
      />,
    );
    // Even with pinned=true (would have rendered PinAction pre-strip) AND
    // inActiveSet=true + onDeactivate (would have rendered DeactivateAction
    // pre-strip), the desktop .pv-meta column now carries neither icon.
    expect(container.querySelector('[data-testid="pin-action"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="deactivate-action"]'),
    ).toBeNull();
  });

  it("Test 18d: desktop non-RDP row body has onContextMenu; contextmenu opens portal menu with Pin + Deactivate items when inActiveSet + onDeactivate provided", () => {
    currentIdentity = makeIdentity(210, "nelly");
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: /deactivate/i }),
    ).toBeTruthy();
  });

  it("Test 18e: desktop non-RDP row NOT in active-set opens the context menu with only `Pin` (no `Deactivate`)", () => {
    // Predicate mirrors PrettyConversationRow.tsx:
    //   if (inActiveSet && onDeactivate) items.push({ label: "Deactivate", … })
    // → when inActiveSet is false, Deactivate is filtered out and only Pin
    // remains.
    currentIdentity = makeIdentity(210, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={vi.fn()}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    expect(
      within(menu).queryByRole("menuitem", { name: /deactivate/i }),
    ).toBeNull();
  });

  it("Test 18f: mobile row body does NOT wire onContextMenu AND has NO in-DOM PinAction (quick-260802-pq2)", () => {
    // quick-260802-pq2 rewrite: the mobile swipe-reveal strip that used to
    // host PinAction / DeactivateAction / HideAction was retired. Mobile
    // action affordance is now the long-press → PrettyConversationContext
    // Menu (covered by TL1-TL5). Two guarantees this test locks:
    //   (1) The desktop right-click path (onContextMenu on row body) is
    //       STILL undefined on mobile — dispatching a contextmenu event does
    //       NOT open the portal menu. This is unchanged from pre-pq2.
    //   (2) There is NO in-DOM `[data-testid="pin-action"]` on a mobile row
    //       anymore. Pre-pq2 the swipe strip rendered PinAction unconditionally
    //       on non-RDP mobile rows; post-pq2 the row does not import PinAction
    //       at all. Long-press opens the same menu desktop right-click uses;
    //       the menu is portal-mounted, not embedded in the row DOM.
    currentIdentity = makeIdentity(210, "nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    expect(screen.queryByRole("menu")).toBeNull();
    // (2) No PinAction in the row DOM anymore.
    expect(
      container.querySelector('[data-testid="pin-action"]'),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 19 (A/B/C) — [quick-260727-f9v] subtitleMode="identityTitle" prop
// ─────────────────────────────────────────────────────────────────────────────
// New in quick-260727-f9v: the row accepts `subtitleMode?: "hostname" |
// "identityTitle"` (default "hostname" — full backward compat). When the
// panel is rendering a non-RDP, non-active-set, non-pinned host-grouped
// section, it also renders a per-host divider chip above those rows and
// wants the row sublabel to read as "which identity is this" (identity.title
// falling back to identity.displayName) rather than repeating the hostname
// the chip already announces. To avoid duplicating the Server glyph the
// chip carries, the row also DROPS its own Server glyph when subtitleMode
// is "identityTitle" AND an identity resolved.
//
// Terminal safety net (per Tina's patch #149 lesson — "known limitation,
// inert ≠ inert"): if subtitleMode="identityTitle" but the row's identity
// does NOT resolve, the render MUST fall back verbatim to the previous
// behavior (hostname text + Server icon). Test C is the load-bearing guard
// for that fallback — do NOT weaken or skip it.

describe("PrettyConversationRow: subtitleMode='identityTitle' (quick-260727-f9v)", () => {
  it("Test 19A: subtitleMode='identityTitle' + identity.title set → sublabel is title, NO Server icon in .pv-host", () => {
    currentIdentity = {
      ...makeIdentity(45, "nelly"),
      title: "Ashley Ops",
    };
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        subtitleMode="identityTitle"
      />,
    );
    const pvHost = container.querySelector(".pv-host") as HTMLElement | null;
    expect(pvHost).toBeTruthy();
    // Sublabel text is exactly the identity.title.
    expect(pvHost!.textContent?.trim()).toBe("Ashley Ops");
    // The Server icon (rendered by lucide as an svg with width=11 height=11
    // inside `.pv-host`) MUST NOT be present when identityTitle mode resolves.
    expect(pvHost!.querySelector('svg[width="11"]')).toBeNull();
    // Defense-in-depth: no svg at all inside .pv-host in the identityTitle-
    // resolved render path.
    expect(pvHost!.querySelector("svg")).toBeNull();
  });

  it("Test 19B: subtitleMode='identityTitle' + identity.title null → sublabel is displayName, NO Server icon", () => {
    currentIdentity = makeIdentity(90, "ashley"); // makeIdentity sets title: null
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "ashley" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        subtitleMode="identityTitle"
      />,
    );
    const pvHost = container.querySelector(".pv-host") as HTMLElement | null;
    expect(pvHost).toBeTruthy();
    // Fallback: identity.title is null → displayName ("ashley") is used.
    expect(pvHost!.textContent?.trim()).toBe("ashley");
    expect(pvHost!.querySelector("svg")).toBeNull();
  });

  it("Test 19C: subtitleMode='identityTitle' + NO identity resolved → verbatim fallback (hostname text + Server icon)", () => {
    // currentIdentity is null (reset in beforeEach) — useIdentities().byKey
    // will not resolve. The safety-net terminal branch MUST render the
    // previous behavior verbatim so unresolved-identity rows in host groups
    // do NOT ship with sublabel "" or "undefined" on Ashley's next click.
    // This is the guard against Tina's patch #149 lesson recurring here.
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({
          host: makeHost({ name: "hostA" }),
          targetTmuxSession: "unresolved-session",
        })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        subtitleMode="identityTitle"
      />,
    );
    const pvHost = container.querySelector(".pv-host") as HTMLElement | null;
    expect(pvHost).toBeTruthy();
    // Sublabel text falls back to the hostname (row.host.name).
    expect(pvHost!.textContent?.trim()).toBe("hostA");
    // The Server icon IS present in the fallback path (verbatim previous
    // behavior — width=11 height=11 marker from the existing render).
    expect(pvHost!.querySelector('svg[width="11"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 20 (A/B) — main-label render source: identity.displayName vs row.label
// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-08-01: identity-session rows in the conversation list showed
// their tmux sessionName (lowercase identity key) as the main label, while
// the IdentityBadge showed the properly-cased `identity.displayName`. The
// row now takes its main label from identity.displayName when subtitleMode
// is "identityTitle" AND identity resolves — matching the badge's source.
// When either condition is false, the row falls back verbatim to row.label
// (raw terminal rows, unresolved identities, hostname-mode rows unchanged).

describe("PrettyConversationRow: main label source (Ashley 2026-08-01)", () => {
  it("Test 20A: subtitleMode='identityTitle' + identity resolved → main label is identity.displayName (NOT row.label)", () => {
    // Identity's displayName is properly-cased "Nelly"; row.label is the
    // lowercase tmux sessionName "nelly-session". The .pv-label must render
    // "Nelly" — matching what IdentityBadge shows for the same identity.
    currentIdentity = { ...makeIdentity(200, "Nelly") };
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ label: "nelly-session", targetTmuxSession: "nelly" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        subtitleMode="identityTitle"
      />,
    );
    const pvLabel = container.querySelector(".pv-label") as HTMLElement | null;
    expect(pvLabel).toBeTruthy();
    expect(pvLabel!.textContent?.trim()).toBe("Nelly");
    expect(pvLabel!.textContent?.trim()).not.toBe("nelly-session");
  });

  it("Test 20B: subtitleMode='identityTitle' + NO identity resolved → main label is row.label (verbatim fallback)", () => {
    // currentIdentity null (reset in beforeEach) — safety-net fallback for
    // rows in identity-mode contexts that don't resolve an identity. MUST
    // render row.label so the row never ships with an empty main label.
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ label: "unresolved-session", targetTmuxSession: "nobody" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        subtitleMode="identityTitle"
      />,
    );
    const pvLabel = container.querySelector(".pv-label") as HTMLElement | null;
    expect(pvLabel).toBeTruthy();
    expect(pvLabel!.textContent?.trim()).toBe("unresolved-session");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TL1-TL5 — Mobile long-press → context menu (quick-260802-pq2)
// ─────────────────────────────────────────────────────────────────────────────
// The mobile swipe-to-reveal action strip was retired. A 500ms touch hold
// with <10px movement now opens the SAME PrettyConversationContextMenu that
// desktop right-click opens (portal-mounted to document.body). Coverage:
//   TL1 — 500ms hold on a mobile non-RDP row opens the menu; Pin menuitem
//         present; onSelect NOT called.
//   TL2 — Movement >10px before 500ms cancels the pending long-press. No
//         menu, no onSelect.
//   TL3 — Short tap (<500ms) still fires onSelect exactly once, no menu.
//   TL4 — Mobile RDP row NEVER opens the menu (isRdp gate).
//   TL5 — navigator.vibrate is called with 10 when present; when absent,
//         the menu still opens and no throw occurs (feature-detection lock).

describe("PrettyConversationRow: mobile long-press context menu (quick-260802-pq2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TL1: mobile non-RDP row + 500ms hold opens the menu at touch coords; Pin menuitem present; onSelect NOT called", () => {
    currentIdentity = makeIdentity(200, "nelly");
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    // The long-press did NOT fire onSelect (the trailing click gate would
    // have suppressed it anyway; jsdom does not synthesize a click on
    // touchEnd, so we're locking the "hold-alone doesn't fire onSelect"
    // guarantee too).
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("TL2: mobile non-RDP row + touchMove dx=15 (>10) before 500ms cancels the long-press; no menu, no onSelect", () => {
    currentIdentity = makeIdentity(45, "nelly");
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 215, clientY: 105 } as Touch], // hypot(15,5) ≈ 15.8 > 10
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    expect(screen.queryByRole("menu")).toBeNull();
    // jsdom does not synthesize a click on touchEnd — the assertion is
    // trivially green in this environment, but keep it to lock the
    // contract that movement bail-out does not also fire onSelect.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("TL3: mobile non-RDP row + short tap (<500ms) fires onSelect exactly once; no menu", () => {
    currentIdentity = makeIdentity(120, "nelly");
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    // No advanceTimersByTime — early touchEnd BEFORE the 500ms threshold.
    fireEvent.touchEnd(body, { changedTouches: [] });
    // Standard click path continues — jsdom does not synthesize the click,
    // so fire it explicitly (matching a real browser's short-tap sequence).
    fireEvent.click(body);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("TL4: mobile RDP row + 500ms hold DOES open the menu (quick-260804-uo4 touch gates relaxed); no throws", () => {
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    // quick-260804-uo4: the isRdp guard was dropped from touch handlers and
    // handler early-returns. Dispatching a 500ms long-press on a mobile RDP
    // row now opens the context menu (new invariant — replaces the old
    // "menu stays null" assertion).
    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("TL5a: navigator.vibrate is called with 10 on successful long-press when the API is present", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const originalVibrate = (navigator as unknown as { vibrate?: unknown }).vibrate;
    const vibrateSpy = vi.fn();
    (navigator as unknown as { vibrate: unknown }).vibrate = vibrateSpy;
    try {
      const { container } = render(
        <PrettyConversationRow
          row={makeRow()}
          selected={false}
          pinned={false}
          variant="mobile"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;

      fireEvent.touchStart(body, {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(body, { changedTouches: [] });

      expect(vibrateSpy).toHaveBeenCalledTimes(1);
      expect(vibrateSpy).toHaveBeenCalledWith(10);
    } finally {
      // Restore navigator.vibrate to its original value (undefined in jsdom).
      if (originalVibrate === undefined) {
        delete (navigator as unknown as { vibrate?: unknown }).vibrate;
      } else {
        (navigator as unknown as { vibrate: unknown }).vibrate = originalVibrate;
      }
    }
  });

  it("TL5b: long-press opens the menu and does NOT throw when navigator.vibrate is absent (feature-detection lock)", () => {
    currentIdentity = makeIdentity(60, "nelly");
    // jsdom does not implement navigator.vibrate by default; be defensive
    // in case a prior test stubbed it and skipped its own restore.
    const originalVibrate = (navigator as unknown as { vibrate?: unknown }).vibrate;
    if (originalVibrate !== undefined) {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    }
    try {
      expect(
        (navigator as unknown as { vibrate?: unknown }).vibrate,
      ).toBeUndefined();

      const { container } = render(
        <PrettyConversationRow
          row={makeRow()}
          selected={false}
          pinned={false}
          variant="mobile"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;

      fireEvent.touchStart(body, {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(body, { changedTouches: [] });

      // Menu still opens — the vibrate call is optional-chained inside the
      // timer callback and must not throw when the API is missing.
      expect(screen.getByRole("menu")).toBeTruthy();
    } finally {
      // Restore whatever was there before the test (still undefined in
      // vanilla jsdom).
      if (originalVibrate !== undefined) {
        (navigator as unknown as { vibrate: unknown }).vibrate = originalVibrate;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UO1-UO6 — Open/Move-in-new-window context-menu item (quick-260804-uo4)
// ─────────────────────────────────────────────────────────────────────────────
// Six tests covering the new context-menu item introduced in quick-260804-uo4:
//   UO1 — desktop, inActiveSet, non-RDP → "Move to new window" + window.open
//          + onDeactivate called (window handle non-null)
//   UO2 — desktop, !inActiveSet, non-RDP → "Open in new window" + window.open
//          + onDeactivate NOT called
//   UO3 — desktop, RDP row, inActiveSet → menu opens (gate relaxed) + "Move to
//          new window" + window.open + onDeactivate called
//   UO4 — desktop, inActiveSet, window.open returns null → onDeactivate NOT
//          called (popup-blocker safety)
//   UO5 — mobile long-press → menu opens but "Open/Move in new window" items
//          NOT present (desktop-only guard)
//   UO6 — mobile RDP long-press → menu opens (touch gate relaxed); no new-
//          window item (mobile-only suppression); Pin item present

describe("PrettyConversationRow: Open/Move-in-new-window context-menu item (quick-260804-uo4)", () => {
  let originalOpen: typeof window.open;

  beforeEach(() => {
    originalOpen = window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
    vi.restoreAllMocks();
  });

  it("UO1: desktop, inActiveSet=true, non-RDP → menu item labeled 'Move to new window'; click calls window.open with workspace URL + calls onDeactivate once", () => {
    // Stub window.open to return a non-null Window handle (popup not blocked).
    window.open = vi.fn(() => ({} as Window));
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /move to new window/i });
    expect(item).toBeTruthy();
    fireEvent.click(item);

    // window.open must have been called exactly once.
    expect(window.open).toHaveBeenCalledTimes(1);

    // Decode the URL argument and assert workspace spec structure.
    const openCall = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
    const urlArg = openCall[0] as string;
    expect(urlArg.startsWith("#")).toBe(true);
    const params = new URLSearchParams(urlArg.slice(1));
    expect(params.getAll("tab").length).toBe(1);
    // Default makeRow() → type=terminal, host.name=thenasty, targetTmuxSession=nelly
    // → specForTab produces {protocol:"tmux", host:"thenasty", session:"nelly"}
    // → encodeTabSpec → "tmux:thenasty:nelly"
    expect(params.get("tab")).toContain("tmux");
    expect(decodeURIComponent(params.get("tab")!)).toContain("thenasty");
    expect(decodeURIComponent(params.get("tab")!)).toContain("nelly");
    expect(params.get("active")).toBe("0");
    expect(params.get("only")).toBe("1");

    // onDeactivate called exactly once (row was in active-set + window handle non-null).
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("UO2: desktop, inActiveSet=false, non-RDP → menu item labeled 'Open in new window'; click calls window.open; onDeactivate NOT called", () => {
    window.open = vi.fn(() => ({} as Window));
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    // inActiveSet=false → label is "Open in new window" (not "Move").
    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
    expect(item).toBeTruthy();
    // "Move to new window" label must NOT appear.
    expect(within(menu).queryByRole("menuitem", { name: /move to new window/i })).toBeNull();
    fireEvent.click(item);

    expect(window.open).toHaveBeenCalledTimes(1);

    // onDeactivate must NOT be called (row was not in active-set).
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("UO3: desktop, RDP row, inActiveSet=true → menu opens (gate relaxed); 'Move to new window' present; click calls window.open + onDeactivate", () => {
    window.open = vi.fn(() => ({} as Window));
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null, type: "rdp" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    // Menu must open — proves the row-level isRdp gate was dropped.
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();

    const item = within(menu).getByRole("menuitem", { name: /move to new window/i });
    expect(item).toBeTruthy();
    fireEvent.click(item);

    expect(window.open).toHaveBeenCalledTimes(1);

    // Decode URL: RDP row with host.name=thenasty → specForTab produces
    // {protocol:"rdp", host:"thenasty"} → encoded as "rdp:thenasty"
    const openCall = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
    const urlArg = openCall[0] as string;
    expect(urlArg.startsWith("#")).toBe(true);
    const params = new URLSearchParams(urlArg.slice(1));
    expect(params.getAll("tab").length).toBe(1);
    expect(decodeURIComponent(params.get("tab")!)).toContain("rdp");
    expect(decodeURIComponent(params.get("tab")!)).toContain("thenasty");
    expect(params.get("active")).toBe("0");
    expect(params.get("only")).toBe("1");

    // onDeactivate called (inActiveSet=true + window handle non-null).
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("UO4: desktop, inActiveSet=true, window.open returns null (popup blocked) → window.open called but onDeactivate NOT called", () => {
    // Simulate popup blocker: window.open returns null.
    window.open = vi.fn(() => null as unknown as Window);
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /move to new window/i });
    fireEvent.click(item);

    // window.open was attempted.
    expect(window.open).toHaveBeenCalledTimes(1);
    // onDeactivate must NOT be called — the new window was blocked, so
    // the original tab survives (data-loss prevention).
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("UO4b: window.open features arg must NOT include 'noopener' (regression guard, 2026-08-05 fix) — per spec, window.open with noopener always returns null, which would defeat the popup-blocker null-check and stop Move-to-new-window from ever deactivating the origin tab", () => {
    window.open = vi.fn(() => ({} as Window));
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", {
      name: /move to new window/i,
    });
    fireEvent.click(item);

    expect(window.open).toHaveBeenCalledTimes(1);
    const call = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
    // features arg (index 2). Must be absent or a string that does NOT contain
    // "noopener" — anything else and every real-browser Move-to-new-window
    // click leaves the origin tab active regardless of the null-check logic.
    const features = call[2] as string | undefined;
    if (features !== undefined) {
      expect(features).not.toContain("noopener");
    }
    // Sanity: onDeactivate DID fire (matching UO1's contract — proves the
    // regression this test protects would otherwise silently break UO1's
    // real-browser behavior without failing UO1 in vitest).
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("UO5: mobile long-press → menu opens but Open/Move-in-new-window items NOT rendered (desktop-only)", () => {
    vi.useFakeTimers();
    try {
      window.open = vi.fn(() => ({} as Window));
      currentIdentity = makeIdentity(200, "nelly");
      const { container } = render(
        <PrettyConversationRow
          row={makeRow()}
          selected={false}
          pinned={false}
          variant="mobile"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          inActiveSet={true}
          onDeactivate={vi.fn()}
        />,
      );
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;

      fireEvent.touchStart(body, {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(body, { changedTouches: [] });

      // Positive control: menu must open (long-press works on mobile).
      const pinItem = screen.queryByRole("menuitem", { name: /pin/i });
      expect(pinItem).not.toBeNull();

      // Mobile-only suppression: neither Open nor Move items render on mobile.
      expect(
        screen.queryByRole("menuitem", { name: /new window/i }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("UO6: mobile RDP row long-press → menu opens (touch gates relaxed); no new-window item (mobile suppression); Pin item present", () => {
    vi.useFakeTimers();
    try {
      window.open = vi.fn(() => ({} as Window));
      const { container } = render(
        <PrettyConversationRow
          row={makeRow({ rdpHostRow: true, targetTmuxSession: null, type: "rdp" })}
          selected={false}
          pinned={false}
          variant="mobile"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          // No onDeactivate, no onToggleHide, no onClone provided — RDP mobile
          // menu should show ONLY the Pin item (Open-in-new-window is desktop-only).
        />,
      );
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;

      fireEvent.touchStart(body, {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(body, { changedTouches: [] });

      // Menu must open — proves the four touch-handler isRdp gates AND
      // three handler-body early-returns were relaxed (quick-260804-uo4).
      const menu = screen.getByRole("menu");
      expect(menu).toBeTruthy();

      // Pin item present (the only item on a mobile RDP row with no extra props).
      expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();

      // No new-window item on mobile (desktop-only suppression).
      expect(
        within(menu).queryByRole("menuitem", { name: /new window/i }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests A-F — [Phase 26 Plan 03] Bounty badge visibility — useBountyCounts
//             pair consumption (widened from Plan 26-02 singular hook)
// ─────────────────────────────────────────────────────────────────────────────
// PrettyConversationRow now consumes useBountyCounts (plural) returning the
// {pinnedCount, needsDeskCount} pair (undefined when no fetch has landed or
// when the row has no identity). The badge shows the combined pin·desk pill
// per the 4-case rendering rule (see PrettyBountyCountBadge.tsx).
//
// currentBountyCounts is reset to undefined in beforeEach; each test overrides
// it to the relevant pair shape. currentIdentity is set for identity rows
// (session match drives the useBountyCounts call site in the row).

describe("PrettyConversationRow: bounty badge visibility — useBountyCounts pair (Phase 26 Plan 03)", () => {
  it("Test A: identity row + pinnedCount=3, needsDeskCount=0 → badge textContent '3·'", () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentBountyCounts = { pinnedCount: 3, needsDeskCount: 0 };
    render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("3·");
  });

  it("Test B: identity row + pinnedCount=0, needsDeskCount=1 → badge textContent '·1'", () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentBountyCounts = { pinnedCount: 0, needsDeskCount: 1 };
    render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("·1");
  });

  it("Test C: identity row + pinnedCount=3, needsDeskCount=1 → badge textContent '3·1'", () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentBountyCounts = { pinnedCount: 3, needsDeskCount: 1 };
    render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    const badge = screen.getByTestId("pv-bounty-badge");
    expect(badge.textContent).toBe("3·1");
  });

  it("Test D: identity row + pinnedCount=0, needsDeskCount=0 → no badge (null)", () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentBountyCounts = { pinnedCount: 0, needsDeskCount: 0 };
    render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("Test E: no-identity row (sessionMatchKey → null) → no badge regardless of mock", () => {
    // currentIdentity is null (reset in beforeEach) — identity doesn't resolve.
    // useBountyCounts short-circuits to undefined when identityKey is null.
    currentBountyCounts = undefined; // explicit — hook returns undefined
    render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={false}
      />,
    );
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });

  it("Test F: pre-fetch state — hook returns undefined → no badge", () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentBountyCounts = undefined; // pre-fetch, pair hasn't landed yet
    render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
      />,
    );
    expect(screen.queryByTestId("pv-bounty-badge")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TS1-TS7 — Mobile swipe-to-act composite (quick-260808-fkg)
// ─────────────────────────────────────────────────────────────────────────────
// The row grew a swipe-to-ACT gesture layer that coexists with the TL* long-
// press layer. Swipe-right past threshold fires composite pin+activate;
// swipe-left past threshold fires composite unpin+deactivate. Both composites
// are guarded by !pinned / !inActiveSet / pinned / inActiveSet so repeated
// same-direction swipes are idempotent. Nothing is painted behind the row
// (the retired quick-260802-pq2 reveal-strip bleed-through class of bug is
// NOT reintroduced). Coverage:
//   TS1 — Swipe-right past threshold on ambient-unpinned row fires BOTH
//         composites (onTogglePin + onSelect).
//   TS2 — Swipe-right past threshold on already-pinned-AND-inActiveSet row
//         is a silent no-op (idempotency).
//   TS3 — Swipe-left past threshold on active-pinned row fires BOTH
//         composites (onTogglePin + onDeactivate).
//   TS4 — Release BELOW threshold fires NEITHER action (snap back only).
//   TS5 — Vertical drag NEVER arms the swipe (|dy| > |dx| gate).
//   TS6 — Small horizontal jitter during a tap still fires onSelect via the
//         existing tap-to-activate path (swipe never armed).
//   TS7 — RDP row swipe handlers early-return (matches the panel-side
//         rdpNoopTogglePin exemption policy).
//
// Fixture note: rowWidth defaults to 0 in jsdom (no layout engine), so the
// swipe threshold `Math.max(90, rowWidth * 0.35)` collapses to 90 in tests.
// dx values are chosen with the 90 constant in mind (past = 100+, below = 40
// or less). vi.useFakeTimers() is required because the snap-back path uses
// setTimeout(200) to clear isSnappingRef.

describe("PrettyConversationRow: mobile swipe-to-act (quick-260808-fkg)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TS1: swipe-right past threshold on ambient-unpinned row fires BOTH composites (onTogglePin + onSelect)", () => {
    currentIdentity = makeIdentity(200, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 150, clientY: 102 } as Touch], // dx=50, dy=2 → arms
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 210, clientY: 105 } as Touch], // dx=110 > 90 threshold
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200); // flush snap-back timer
    });

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TS2: swipe-right past threshold on already-pinned-AND-inActiveSet row is a silent no-op", () => {
    currentIdentity = makeIdentity(45, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 150, clientY: 102 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 210, clientY: 105 } as Touch],
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TS3: swipe-left past threshold on active-pinned row fires BOTH composites (onTogglePin + onDeactivate)", () => {
    currentIdentity = makeIdentity(120, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 150, clientY: 102 } as Touch], // dx=-50, dy=2 → arms
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 90, clientY: 105 } as Touch], // dx=-110, past-left
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("TS4: release BELOW threshold fires NEITHER action, row snaps back", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 135, clientY: 102 } as Touch], // dx=35, arms but < 90 threshold
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TS5: vertical drag NEVER arms the swipe machine, no action fires, no menu opened", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 105, clientY: 150 } as Touch], // dx=5, dy=50 → vertical wins
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 200, clientY: 150 } as Touch], // dx=100 but disarmed sticks
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("TS6: small horizontal jitter during a tap still fires onSelect (swipe never armed)", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onDeactivate={onDeactivate}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 104, clientY: 101 } as Touch], // dx=4 < 8 → gate fails, NOT armed
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    // jsdom does not synthesize a click on touchEnd — fire it explicitly
    // to exercise the standard tap path (matching TL3 pattern).
    fireEvent.click(body);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TS7: RDP row swipe handlers early-return — no composite action fires", () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="mobile"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 150, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 210, clientY: 100 } as Touch], // dx=110 past threshold on non-RDP
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
