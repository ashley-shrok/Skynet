// ─── PrettyConversationRow — Vitest coverage ─────────────────────────────────
// 18 (+18b) tests covering the row component after Phase 13 Plan 01
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
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
// Test 2 — Mobile swipe-left past threshold opens the reveal strip
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: mobile swipe open", () => {
  it("Test 2: swipe-left dx=-60 (past 40px threshold) opens the strip", () => {
    currentIdentity = makeIdentity(120, "nelly");
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
    fireEvent.touchMove(body, {
      touches: [{ clientX: 140, clientY: 100 } as Touch],
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    expect(wrapper.getAttribute("data-swiped-open")).toBe("true");
    // PinAction inside the reveal strip is queryable.
    const pin = wrapper.querySelector(
      '[data-testid="pin-action"]',
    ) as HTMLElement | null;
    expect(pin).toBeTruthy();
    expect(pin!.getAttribute("aria-label")).toMatch(/pin/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Mobile swipe under threshold snaps closed
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: mobile swipe below threshold", () => {
  it("Test 3: swipe-left dx=-25 (under 40px threshold) snaps closed", () => {
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
    fireEvent.touchMove(body, {
      touches: [{ clientX: 175, clientY: 100 } as Touch],
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    // data-swiped-open should be absent (attribute is omitted, not "false")
    expect(wrapper.getAttribute("data-swiped-open")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Vertical gesture > 12px yields to browser scroll
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: vertical-gesture bail-out", () => {
  it("Test 4: dy=20 aborts the swipe and does NOT fire onSelect", () => {
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
      touches: [{ clientX: 150, clientY: 120 } as Touch], // dy=20 > 12
    });
    fireEvent.touchEnd(body, { changedTouches: [] });

    expect(wrapper.getAttribute("data-swiped-open")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Tap on swiped-open row closes it, does NOT fire onSelect
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: tap-to-close on swiped-open row", () => {
  it("Test 5: click on swiped-open row closes it without firing onSelect", () => {
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

    // Open first
    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 140, clientY: 100 } as Touch],
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    expect(wrapper.getAttribute("data-swiped-open")).toBe("true");

    // Now tap the body
    fireEvent.click(body);
    expect(wrapper.getAttribute("data-swiped-open")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

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
  it("Test 7: mobile RDP row carries `rdp` class + skips swipe + no PinAction", () => {
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

    // Touch sequence that would otherwise open — no data-swiped-open.
    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 140, clientY: 100 } as Touch],
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    expect(wrapper.getAttribute("data-swiped-open")).toBeNull();

    // Data-rdp-host-row set for downstream styling.
    expect(wrapper.getAttribute("data-rdp-host-row")).toBe("true");
  });

  it("Test 7b: desktop RDP row carries `rdp` class + no PinAction + no onContextMenu wiring", () => {
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
    // quick-260730-o2m: the new unconditional context-menu behavior MUST NOT
    // reach RDP rows. The `!isRdp` guard survives on the row-body
    // onContextMenu prop, so dispatching a contextmenu event on a desktop
    // RDP row's body does NOT open a portal menu.
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    expect(screen.queryByRole("menu")).toBeNull();
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

  it("Test 18f: mobile row body does NOT wire onContextMenu (mobile swipe-strip carries the actions instead)", () => {
    // Mobile-untouched regression guard: dispatching contextmenu on a
    // mobile row's body does NOT open the portal menu (onContextMenu is
    // undefined on mobile per !isMobile && !isRdp guard); AND the mobile
    // swipe-strip PinAction is still present.
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
    // Mobile swipe-strip PinAction is present (rendered inside the reveal
    // strip, unaffected by this strip).
    expect(
      container.querySelector('[data-testid="pin-action"]'),
    ).toBeTruthy();
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
