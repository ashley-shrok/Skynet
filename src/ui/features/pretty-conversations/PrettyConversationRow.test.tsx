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
//  17) [2026-08-14 reversal] !inActiveSet+isWorking===false renders the
//      ready-dot (was NO ready-dot pre-reversal). inActiveSet dropped from
//      the JS gate after fleet-status became backend-authoritative for
//      every session (Phase 34 Plan 06 cutover); ambient rows now surface
//      "ready for attention" too.
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

// quick-260821-suv: per-test override handle for useIsTouchDevice — flip
// `currentIsTouchDevice = true` before rendering to simulate an iPad
// (matchMedia `(pointer: coarse) and (hover: none)` matches: true) and drive
// the TL6/TL7/TL8 coarse-pointer wiring tests. Reset to false in the top-
// level beforeEach so pre-existing TL1-TL5/UO1-UO6 coverage sees the
// original stub behaviour.
let currentIsTouchDevice = false;

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => currentIsTouchDevice,
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
  currentIsTouchDevice = false; // quick-260821-suv default: fine-pointer desktop
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
  it("Test 12: unselected non-RDP active-set row does NOT carry `selected`/`ambient`/`rdp` + `--pv-hue: 210` inline", () => {
    // Phase 41 Plan 01 (Ashley 2026-08-14) — updated: the `ambient` class is
    // now retired from the row's className toggle table entirely. The
    // `.not.toContain("ambient")` assertion below is now trivially true for
    // every row (see Test AMBIENT-RETIRED-01 for a stronger, coverage-of-
    // all-combinations regression).
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
    expect(body.className).not.toContain("selected");
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

describe("PrettyConversationRow: Phase 48 Plan 05 idle-affordance retirement (was Phase 13 ready-dot render)", () => {
  it("Test 13 (Phase 48 Plan 05 rewrite): inActiveSet+isWorking===false is the READY branch of Ashley's 4-input gate — no ready-dot in DOM AND no `spinner-on` class on row", () => {
    // Pre-Phase-48 this test asserted the ready-dot span was PRESENT with
    // aria-label='ready' + data-pv-conv-ready-dot='true' + .pv-ready-dot
    // class. Phase 48 Plan 05 retires the ready-dot entirely (Ashley 2026-
    // 08-19 verbatim: "make the spinner work on the same logic as the idle
    // indicator, except you invert it as the final step of logic there").
    // The 4-input gate `!(inActiveSet && isWorking===false && !isRecycling
    // && !hasQueuePending)` evaluates to `!(true && true && true && true)`
    // = `!true` = `false` for this input combination → NO `spinner-on` on
    // the row. This test locks BOTH: ready-dot fully absent + row has no
    // spinner-on class (idle-in-active-set is the ONE combination that
    // suppresses the spinner).
    currentIdentity = makeIdentity(210, "nelly");
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
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
    expect(container.querySelector(".pv-ready-dot")).toBeNull();
    expect(container.querySelector("[data-pv-conv-ready-dot]")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — [Phase 13] RDP row + inActiveSet+isWorking===false: dot in DOM
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 48 Plan 05 idle-affordance retirement for RDP (was Phase 13 ready-dot component-level render for RDP)", () => {
  it("Test 14 (Phase 48 Plan 05 rewrite): RDP row with inActiveSet+isWorking===false has NO ready-dot in DOM and NO spinner-on class (idle-in-active-set branch)", () => {
    // Pre-Phase-48 this asserted the ready-dot span was PRESENT even on RDP
    // rows at the component level. Phase 48 Plan 05 retires the ready-dot
    // entirely — the "ready-for-attention" cue is now the absence of the
    // spinner ring rather than a positive dot render. RDP + idle-in-active-
    // set still evaluates to the READY branch of Ashley's 4-input gate
    // (`!(true && true && true && true)` = `false`) → no spinner-on class.
    const { container, queryByLabelText } = render(
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
    expect(queryByLabelText("ready")).toBeNull();
    expect(container.querySelector(".pv-ready-dot")).toBeNull();
    expect(container.querySelector("[data-pv-conv-ready-dot]")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
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
// Test 17 — Ambient (!inActiveSet) idle row never spins. Ashley 2026-08-20
//           UAT tightening scoped the spinner to active-set-only, so ambient
//           idle rows have neither the retired ready-dot nor the spinner-on
//           class. (Prior 2026-08-19 full-inversion shape briefly lit every
//           ambient row and Ashley reported it as inverted.)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: ambient rows never spin (post-2026-08-20 UAT tightening)", () => {
  it("Test 17: !inActiveSet+isWorking===false has NO ready-dot AND NO `spinner-on` class (ambient rows are silent for both indicators)", () => {
    // Under the active-set-scoped gate `inActiveSet && (isWorking===true ||
    // isRecycling || hasQueuePending)`, inActiveSet=false short-circuits the
    // whole expression to `false` → no spinner-on. Combined with the retired
    // ready-dot, ambient idle rows carry NEITHER indicator — they are fully
    // silent. See also P47-15 for the same invariant with isWorking=true
    // (ambient working rows also don't spin).
    currentIdentity = makeIdentity(210);
    const { container, queryByLabelText } = render(
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
    expect(container.querySelector(".pv-ready-dot")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
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

  it("Test 15c-guard (Phase 48 Plan 05 rewrite): hasQueuePending default (false) preserves the READY branch — no ready-dot in DOM + no spinner-on class on row", () => {
    // Pre-Phase-48 this asserted the ready-dot rendered when hasQueuePending
    // was omitted (default false). Phase 48 Plan 05 retires the ready-dot;
    // the READY branch of Ashley's 4-input gate now suppresses the
    // spinner-on class instead of rendering a positive dot. The guard's
    // spirit — "the omitted hasQueuePending prop defaults to false and does
    // NOT accidentally trip the spinner ON" — is preserved by asserting the
    // spinner-on class stays absent when the other three predicates are
    // satisfied.
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
        /* hasQueuePending omitted — must default to false → no spinner-on */
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
    expect(container.querySelector(".pv-ready-dot")).toBeNull();
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18 (Phase 41 Plan 01 REWRITE) — Ambient recession RETIRED
// ─────────────────────────────────────────────────────────────────────────────
// The pre-Phase-41 Test 18 asserted that a `!inActiveSet && !isRdp` row DID
// carry the `.ambient` class. Ashley 2026-08-14 retired that visual axis
// entirely: no row ever carries `.ambient` now, regardless of inActiveSet
// or isRdp inputs. The regression test below covers ALL FOUR combinations
// of (inActiveSet, isRdp) to lock the retirement.

describe("PrettyConversationRow: Phase 41 Plan 01 ambient-recession retirement", () => {
  it("Test AMBIENT-RETIRED-01: row NEVER carries `.ambient` class regardless of inActiveSet / isRdp inputs", () => {
    // Iterate all four combinations of (inActiveSet, isRdp). Phase 41 Plan 01:
    // NO row emits the `.ambient` class under any input combination — the
    // toggle was retired from the className composition. Ashley lock (§Ready-
    // dot uniformity + retirement of ambient recession).
    const combos: Array<{ inActiveSet: boolean; isRdp: boolean; label: string }> = [
      { inActiveSet: false, isRdp: false, label: "!inActiveSet && !isRdp" },
      { inActiveSet: true, isRdp: false, label: "inActiveSet && !isRdp" },
      { inActiveSet: false, isRdp: true, label: "!inActiveSet && isRdp" },
      { inActiveSet: true, isRdp: true, label: "inActiveSet && isRdp" },
    ];
    for (const { inActiveSet, isRdp, label } of combos) {
      currentIdentity = isRdp ? null : makeIdentity(210, "nelly");
      const row = isRdp
        ? makeRow({ rdpHostRow: true, targetTmuxSession: null })
        : makeRow();
      const { container, unmount } = render(
        <PrettyConversationRow
          row={row}
          selected={false}
          pinned={false}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          inActiveSet={inActiveSet}
          isWorking={null}
        />,
      );
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;
      expect(body.className, `combo=${label}`).toContain("pv-row");
      expect(body.className, `combo=${label}`).not.toContain("ambient");
      unmount();
    }
  });

  // isWorking===false on BOTH inActiveSet=true and =false yields NO spinner-on
  // under the active-set-scoped gate (Ashley 2026-08-20 UAT tightening):
  //   inActiveSet=true  + isWorking===false → active-set-idle → no spinner-on
  //                                            (the ready-dot's exclusive
  //                                            branch).
  //   inActiveSet=false + isWorking===false → ambient rows silent → no
  //                                            spinner-on (short-circuits on
  //                                            the outer `inActiveSet`
  //                                            conjunct).
  // The two branches WERE briefly asymmetric under the 2026-08-19 full-
  // inversion shape, and Ashley reported that as "idle rows have spinners" on
  // first UAT — this test now locks the tightened symmetry so a regression
  // back to the full-inversion shape would fail. The ready-dot is fully
  // retired in both branches (that part was unchanged by the tightening).
  it("Test SPINNER-INVERSION-01: isWorking===false yields NO spinner-on on either inActiveSet=true or =false — ready-dot also fully absent in both cases (ambient-scope tightening)", () => {
    for (const inActiveSet of [true, false]) {
      currentIdentity = makeIdentity(210);
      const { container, queryByLabelText, unmount } = render(
        <PrettyConversationRow
          row={makeRow()}
          selected={false}
          pinned={false}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          inActiveSet={inActiveSet}
          isWorking={false}
        />,
      );
      // ready-dot fully retired in BOTH branches.
      expect(queryByLabelText("ready"), `inActiveSet=${inActiveSet}`).toBeNull();
      expect(
        container.querySelector(".pv-ready-dot"),
        `inActiveSet=${inActiveSet}`,
      ).toBeNull();
      // Active-set-scoped spinner: neither branch spins when isWorking=false.
      const wrapper = container.querySelector(
        '[data-conversation-id="conv-1"]',
      ) as HTMLElement;
      const body = wrapper.querySelector('[role="button"]') as HTMLElement;
      expect(body.className, `inActiveSet=${inActiveSet}`).not.toContain(
        "spinner-on",
      );
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18c/d/e/f — [quick-260730-o2m] Desktop context-menu-only + mobile
//                  untouched regression guards
// ─────────────────────────────────────────────────────────────────────────────
// Direct regression guards for the strip: the always-visible desktop
// PinAction + DeactivateAction icons in .pv-meta are gone; Pin action lives
// in the right-click context menu (unconditional on desktop non-RDP) and
// the mobile swipe strip (untouched). Deactivate was removed from the
// context menu 2026-08-17 (Ashley); swipe-LEFT remains the sole UI trigger.
// The four tests below lock this:
//   18c — no PinAction / no DeactivateAction in desktop .pv-meta
//   18d — desktop contextmenu opens portal menu with Pin but NEVER Deactivate
//         (regardless of inActiveSet + onDeactivate)
//   18e — desktop contextmenu opens portal menu with Pin only (Deactivate
//         absent) when !inActiveSet — same invariant as 18d, kept as a
//         redundant guard against a regression that only fires on the
//         inActiveSet=false branch
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

  it("Test 18d: desktop non-RDP row body has onContextMenu; contextmenu opens portal menu with Pin — Deactivate is NEVER in the menu even with inActiveSet + onDeactivate provided (removed 2026-08-17)", () => {
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
      within(menu).queryByRole("menuitem", { name: /deactivate/i }),
    ).toBeNull();
  });

  it("Test 18e: desktop non-RDP row NOT in active-set opens the context menu with only `Pin` (no `Deactivate`)", () => {
    // Ashley 2026-08-17 removed the Deactivate menu item entirely — it no
    // longer renders regardless of inActiveSet. Kept as a redundant guard
    // against a regression that only manifests on the inActiveSet=false
    // branch (semantically identical to Test 18d now).
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

describe("PrettyConversationRow: Phase 48 Plan 05 aiTitle subtitle (was quick-260727-f9v subtitleMode='identityTitle')", () => {
  it("Test 19A (Phase 48 Plan 05 rewrite): subtitle is aiTitle when provided; subtitleMode='identityTitle' is now inert (accepted for backward compat, has no runtime effect)", () => {
    // Pre-Phase-48 the sublabel was rendered inside .pv-host and its
    // content depended on subtitleMode ('hostname' vs 'identityTitle')
    // and identity resolution. Phase 48 Plan 05 replaces the sublabel
    // entirely with a subtitle .pv-ai-title span whose content is the
    // aiTitle prop — subtitleMode is retained on the interface for
    // backward compat but has no runtime effect.
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
        aiTitle="Fix bug X"
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    expect(pvAiTitle!.textContent?.trim()).toBe("Fix bug X");
    // Server icon fully retired (hostname is now on the title line).
    expect(container.querySelector('svg[width="11"]')).toBeNull();
    // Pre-Phase-48 .pv-host block is retired from the render.
    expect(container.querySelector(".pv-host")).toBeNull();
  });

  it("Test 19B (Phase 48 Plan 05 rewrite): subtitle is aiTitle regardless of identity.title value — subtitleMode has no effect on subtitle content", () => {
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
        aiTitle="Reviewing test coverage"
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    expect(pvAiTitle!.textContent?.trim()).toBe("Reviewing test coverage");
    expect(pvAiTitle!.querySelector("svg")).toBeNull();
  });

  it("Test 19C (Phase 48 Plan 05 rewrite): aiTitle=null renders a muted italic ellipsis placeholder — the row still has a subtitle span so it doesn't collapse-look", () => {
    // The safety-net semantics from patch #149 are preserved in a new
    // shape: instead of falling back to hostname+Server-icon, an
    // aiTitle-null row falls back to a placeholder .pv-ai-title--
    // placeholder span with a U+2026 ellipsis. Row visual weight is
    // preserved regardless of ai-title presence.
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
        aiTitle={null}
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    // U+2026 ellipsis (single character).
    expect(pvAiTitle!.textContent?.trim()).toBe("…");
    // Placeholder marker class present so CSS can apply muted-italic styling.
    expect(pvAiTitle!.className).toContain("pv-ai-title--placeholder");
    // Server icon fully absent (hostname is now on the title line's
    // .pv-hostname-suffix, not paired with an icon here).
    expect(container.querySelector('svg[width="11"]')).toBeNull();
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

describe("PrettyConversationRow: Phase 48 Plan 05 main label source + parenthetical suffix (was Ashley 2026-08-01 main label source; inline-260823-conv-title-suffix flipped parens to identity.title with hostname fallback)", () => {
  it("Test 20A (inline-260823-conv-title-suffix rewrite): identity resolved WITH title → parenthetical is identity.title, NOT hostname; Ashley 2026-08-23 lock", () => {
    // Pre-inline-260823 this asserted "Nelly (thenasty)" — hostname always.
    // Ashley 2026-08-23 flipped: parens prefer identity.title over
    // host.name. Hostname was almost never useful in the row; title carries
    // the meaningful "who is this" signal (Secretary / Athena / etc).
    currentIdentity = { ...makeIdentity(200, "Nelly"), title: "Fleet Coordinator" };
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
    // Full textContent (identity prefix + parens suffix): "Nelly (Fleet Coordinator)"
    expect(pvLabel!.textContent?.trim()).toBe("Nelly (Fleet Coordinator)");
    // The lowercase tmux sessionName MUST NOT appear as the prefix.
    expect(pvLabel!.textContent?.trim()).not.toBe("nelly-session");
    // Hostname MUST NOT appear anywhere in the label when title is set.
    expect(pvLabel!.textContent).not.toContain("thenasty");
    // Suffix span is present with title content.
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (Fleet Coordinator)");
  });

  it("Test 20B (Phase 48 Plan 05 rewrite): NO identity resolved → main label prefix is row.label (verbatim fallback), still followed by the (hostname) parens suffix when host is present", () => {
    // Fallback safety-net preserved from patch #149 in new shape: when
    // useIdentities does not resolve, the label prefix is row.label so
    // the row never ships with an empty main label. Hostname parens
    // suffix still appears from row.host — inline-260823 hostname-fallback
    // path also exercises this shape (no identity → no title → hostname).
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
    expect(pvLabel!.textContent?.trim()).toBe("unresolved-session (thenasty)");
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (thenasty)");
  });

  it("Test 20C (inline-260823-conv-title-suffix): identity resolved but title=null → parens fall back to hostname (Ashley 2026-08-23 hostname-as-fallback semantic)", () => {
    // Locks the fallback contract: when an identity exists but has no
    // title (title=null OR empty string), the parenthetical falls back to
    // the row.host.name rather than showing empty parens. Matches Ashley's
    // "maybe the host name is a fallback" framing.
    currentIdentity = { ...makeIdentity(200, "Nelly"), title: null };
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
    // displayName + hostname fallback (no title present)
    expect(pvLabel!.textContent?.trim()).toBe("Nelly (thenasty)");
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (thenasty)");
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
// UO1-UO6 — Open-in-new-window context-menu item (quick-260804-uo4;
//           label unified 2026-08-18 — was "Move to new window" when
//           inActiveSet, "Open in new window" otherwise; now always "Open in
//           new window". onDeactivate side-effect on success still distinguishes
//           the two cases.)
// ─────────────────────────────────────────────────────────────────────────────
// Six tests:
//   UO1 — desktop, inActiveSet, non-RDP → "Open in new window" + window.open
//          + onDeactivate called (window handle non-null)
//   UO2 — desktop, !inActiveSet, non-RDP → "Open in new window" + window.open
//          + onDeactivate NOT called
//   UO3 — desktop, RDP row, inActiveSet → menu opens (gate relaxed) + "Open in
//          new window" + window.open + onDeactivate called
//   UO4 — desktop, inActiveSet, window.open returns null → onDeactivate NOT
//          called (popup-blocker safety)
//   UO5 — mobile long-press → menu opens but "Open in new window" item NOT
//          present (desktop-only guard)
//   UO6 — mobile RDP long-press → menu opens (touch gate relaxed); no new-
//          window item (mobile-only suppression); Pin item present

describe("PrettyConversationRow: Open-in-new-window context-menu item (quick-260804-uo4)", () => {
  let originalOpen: typeof window.open;

  beforeEach(() => {
    originalOpen = window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
    vi.restoreAllMocks();
  });

  it("UO1: desktop, inActiveSet=true, non-RDP → menu item labeled 'Open in new window'; click calls window.open with workspace URL + calls onDeactivate once", () => {
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
    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
    expect(item).toBeTruthy();
    // Regression guard: legacy "Move to new window" label must never appear again.
    expect(within(menu).queryByRole("menuitem", { name: /move to new window/i })).toBeNull();
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
    // Label is unified "Open in new window" regardless of active-set (2026-08-18).
    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
    expect(item).toBeTruthy();
    // Legacy "Move to new window" label must NOT appear.
    expect(within(menu).queryByRole("menuitem", { name: /move to new window/i })).toBeNull();
    fireEvent.click(item);

    expect(window.open).toHaveBeenCalledTimes(1);

    // onDeactivate must NOT be called (row was not in active-set).
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("UO3: desktop, RDP row, inActiveSet=true → menu opens (gate relaxed); 'Open in new window' present; click calls window.open + onDeactivate", () => {
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

    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
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
    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
    fireEvent.click(item);

    // window.open was attempted.
    expect(window.open).toHaveBeenCalledTimes(1);
    // onDeactivate must NOT be called — the new window was blocked, so
    // the original tab survives (data-loss prevention).
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("UO4b: window.open features arg must NOT include 'noopener' (regression guard, 2026-08-05 fix) — per spec, window.open with noopener always returns null, which would defeat the popup-blocker null-check and stop Open-in-new-window from ever deactivating the origin tab when inActiveSet", () => {
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
      name: /open in new window/i,
    });
    fireEvent.click(item);

    expect(window.open).toHaveBeenCalledTimes(1);
    const call = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
    // features arg (index 2). Must be absent or a string that does NOT contain
    // "noopener" — anything else and every real-browser Open-in-new-window
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
  it("Test A: identity row + pinnedCount=3, needsDeskCount=0 → only pin wrap renders with count 3", () => {
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
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.queryByTestId("pv-bounty-badge-needs-desk")).toBeNull();
  });

  it("Test B: identity row + pinnedCount=0, needsDeskCount=1 → only desk wrap renders with count 1", () => {
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
    expect(screen.queryByTestId("pv-bounty-badge-pinned")).toBeNull();
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("1");
  });

  it("Test C: identity row + pinnedCount=3, needsDeskCount=1 → both wraps render with their counts", () => {
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
    expect(screen.getByTestId("pv-bounty-badge-pinned").textContent).toBe("3");
    expect(screen.getByTestId("pv-bounty-badge-needs-desk").textContent).toBe("1");
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

// ─────────────────────────────────────────────────────────────────────────────
// TSD1-TSD8 — Desktop mouse-drag swipe-to-act (quick-260812-uxk)
// ─────────────────────────────────────────────────────────────────────────────
// Desktop-native equivalent of the mobile touch swipe machine (TS1-TS7
// above). Parallel onMouseDown/onMouseMove/onMouseUp/onMouseLeave
// handlers on the row body share the SAME internal refs the touch
// handlers use. Wiring is gated on `variant === "desktop" && !isRdp`;
// mobile keeps touch-only, desktop-RDP keeps right-click-only. All six
// locked design decisions from the touch machine header comment block
// apply verbatim (threshold, 8px floor, 0.6 rubber-band, 200ms snap-
// back, past-threshold glow class, idempotency). onMouseLeave mid-drag
// is the mouse-only cancel path (touchcancel-equivalent), covered by
// TSD8. Coverage:
//   TSD1 — swipe-right past threshold on unpinned+inActive=false fires
//          composite (onTogglePin + onSelect); trailing click
//          suppressed via suppressNextClickRef.
//   TSD2 — swipe-right past threshold on pinned+inActive silent no-op.
//   TSD3 — swipe-left past threshold on pinned+inActive fires composite
//          (onTogglePin + onDeactivate); trailing click suppressed.
//   TSD4 — swipe-left past threshold on unpinned+inActive=false silent
//          no-op.
//   TSD5 — release below threshold: no composite, snap back, trailing
//          click DOES fire onSelect (tap path intact).
//   TSD6 — vertical drag beyond tap floor never arms; no composite.
//   TSD7 — RDP row: mouse handlers unbound (variant+isRdp gate); no
//          composite regardless of dx.
//   TSD8 — onMouseLeave mid-drag: snap back WITHOUT firing composite.
//
// Fixture note: rowWidth is 0 in jsdom → threshold collapses to 90.
// vi.useFakeTimers() required for the 200ms snap-back drain. Same
// fixture shape as the TS1-TS7 mobile block above.

describe("PrettyConversationRow: desktop mouse-drag swipe (quick-260812-uxk)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TSD1: swipe-right past threshold on unpinned+inActiveSet=false fires composite; trailing click suppressed", () => {
    currentIdentity = makeIdentity(200, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 }); // dx=50, dy=2 → arms
    fireEvent.mouseMove(body, { clientX: 210, clientY: 105 }); // dx=110 > 90 threshold
    fireEvent.mouseUp(body, { clientX: 210, clientY: 105 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDeactivate).not.toHaveBeenCalled();

    // Verify trailing-click suppression: a follow-up click MUST NOT
    // increment onSelect beyond 1 (suppressNextClickRef engaged).
    fireEvent.click(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("TSD2: swipe-right past threshold on pinned+inActiveSet=true is a silent no-op", () => {
    currentIdentity = makeIdentity(45, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 });
    fireEvent.mouseMove(body, { clientX: 210, clientY: 105 });
    fireEvent.mouseUp(body, { clientX: 210, clientY: 105 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TSD3: swipe-left past threshold on pinned+inActiveSet=true fires composite; trailing click suppressed", () => {
    currentIdentity = makeIdentity(120, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={true}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 }); // dx=-50, dy=2 → arms
    fireEvent.mouseMove(body, { clientX: 90, clientY: 105 });  // dx=-110, past-left threshold
    fireEvent.mouseUp(body, { clientX: 90, clientY: 105 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    // Verify trailing-click suppression.
    fireEvent.click(body);
    expect(onSelect).toHaveBeenCalledTimes(0);
  });

  it("TSD4: swipe-left past threshold on unpinned+inActiveSet=false is a silent no-op", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 });
    fireEvent.mouseMove(body, { clientX: 90, clientY: 105 });
    fireEvent.mouseUp(body, { clientX: 90, clientY: 105 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TSD5: release BELOW threshold: no composite, snap back, trailing click DOES fire onSelect (tap path intact)", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 135, clientY: 102 }); // dx=35, arms but < 90 threshold
    fireEvent.mouseUp(body, { clientX: 135, clientY: 102 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();

    // Below-threshold release: suppressNextClickRef NOT set → tap path intact.
    fireEvent.click(body);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("TSD6: vertical mouse-move beyond tap floor without horizontal does NOT arm swipe; no composite fires", () => {
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 105, clientY: 150 }); // dx=5, dy=50 → vertical wins, disarmed
    fireEvent.mouseMove(body, { clientX: 200, clientY: 150 }); // dx=100 but disarmed sticks
    fireEvent.mouseUp(body, { clientX: 200, clientY: 150 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("TSD7: RDP row — mouse handlers unbound (variant+isRdp gate); no composite fires", () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        inActiveSet={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    // Same past-threshold sequence as TSD1, but on an RDP row.
    // Handlers are unbound at the DOM level so no state ever changes.
    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 });
    fireEvent.mouseMove(body, { clientX: 210, clientY: 105 });
    fireEvent.mouseUp(body, { clientX: 210, clientY: 105 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("TSD8: onMouseLeave mid-drag snaps back WITHOUT firing composite (touchcancel-equivalent)", () => {
    currentIdentity = makeIdentity(200, "nelly");
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onDeactivate = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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

    fireEvent.mouseDown(body, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(body, { clientX: 150, clientY: 102 }); // arms
    fireEvent.mouseMove(body, { clientX: 210, clientY: 105 }); // past threshold, armed
    fireEvent.mouseLeave(body, { clientX: 300, clientY: 105 }); // cancel — snap back, no fire
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onTogglePin).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S1-S2 — Context-menu SINGLETON (quick-260809-94y)
// ─────────────────────────────────────────────────────────────────────────────
// Only one row's context menu can be open at a time across the list. Opening
// a second row's menu closes the first (module-scoped `currentClose` ref +
// notifyMenuOpened/notifyMenuClosed helpers in PrettyConversationRow.tsx).
// Unmount cleanup drains the singleton so a torn-down row's close-fn is not
// leaked past its lifetime.

describe("PrettyConversationRow: context-menu singleton (quick-260809-94y)", () => {
  it("S1: opening Row B's context menu closes Row A's context menu (only 1 menu open at a time)", () => {
    const { container } = render(
      <>
        <PrettyConversationRow
          row={makeRow({ id: "conv-A", label: "alpha" })}
          selected={false}
          pinned={false}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
        />
        <PrettyConversationRow
          row={makeRow({ id: "conv-B", label: "bravo" })}
          selected={false}
          pinned={true}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
        />
      </>,
    );

    const wrapperA = container.querySelector(
      '[data-conversation-id="conv-A"]',
    ) as HTMLElement;
    const bodyA = wrapperA.querySelector('[role="button"]') as HTMLElement;

    const wrapperB = container.querySelector(
      '[data-conversation-id="conv-B"]',
    ) as HTMLElement;
    const bodyB = wrapperB.querySelector('[role="button"]') as HTMLElement;

    // Open Row A's context menu.
    fireEvent.contextMenu(bodyA, { clientX: 100, clientY: 100 });
    expect(screen.getAllByRole("menu")).toHaveLength(1);

    // Open Row B's context menu — Row A's menu must close (singleton).
    fireEvent.contextMenu(bodyB, { clientX: 200, clientY: 200 });
    expect(screen.getAllByRole("menu")).toHaveLength(1);

    // Verify the remaining menu is Row B's: Row B is pinned=true so its menu
    // renders "Unpin" (Row A is pinned=false → "Pin"). If Row A's menu were
    // still open we'd see "Pin" but NOT "Unpin"; the presence of "Unpin" (and
    // absence of a standalone "Pin") proves Row B's menu is the visible one.
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /unpin/i })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: /^pin$/i })).toBeNull();
  });

  it("S2: unmounting a row while its menu is open clears the singleton so another row can open normally", () => {
    // Render Row A alone and open its context menu.
    const { container, unmount } = render(
      <PrettyConversationRow
        row={makeRow({ id: "conv-A" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapperA = container.querySelector(
      '[data-conversation-id="conv-A"]',
    ) as HTMLElement;
    const bodyA = wrapperA.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(bodyA, { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeTruthy();

    // Unmount Row A — cleanup effect calls notifyMenuClosed(closeSelf),
    // draining the singleton. The portal is removed by React too.
    unmount();
    expect(screen.queryByRole("menu")).toBeNull();

    // Render Row B and open its context menu — must succeed cleanly (no leaked
    // stale close-fn in the singleton that would fire spuriously).
    const { container: c2 } = render(
      <PrettyConversationRow
        row={makeRow({ id: "conv-B" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapperB = c2.querySelector(
      '[data-conversation-id="conv-B"]',
    ) as HTMLElement;
    const bodyB = wrapperB.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(bodyB, { clientX: 200, clientY: 200 });
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kill menu item (quick-260810-n3a) — K1-K7
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the Test 18d/18e pattern. The Kill item appears in the context menu
// ONLY when: onKill provided AND !isRdp AND !identity AND row.targetTmuxSession
// is non-null. The item carries `danger: true` (red color via inline style).

describe("PrettyConversationRow: Kill menu item (quick-260810-n3a)", () => {
  // K1: non-RDP, no identity, has targetTmuxSession, onKill provided → Kill in menu
  it("K1: desktop non-RDP row, no identity, targetTmuxSession set, onKill provided → context menu contains Kill", () => {
    currentIdentity = null; // no identity resolves
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /kill/i })).toBeTruthy();
  });

  // K2: identity resolves → Kill NOT in menu (identity gate)
  it("K2: identity resolves → Kill NOT in menu (identity gate)", () => {
    currentIdentity = makeIdentity(210, "nelly"); // identity resolves
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "nelly" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K3: RDP row → Kill NOT in menu (isRdp gate)
  it("K3: RDP row → Kill NOT in menu (isRdp gate)", () => {
    currentIdentity = null;
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K4: targetTmuxSession is null → Kill NOT in menu
  it("K4: targetTmuxSession = null → Kill NOT in menu", () => {
    currentIdentity = null;
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: null })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K5: onKill NOT provided → Kill NOT in menu
  it("K5: onKill NOT provided → Kill NOT in menu", () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        // onKill intentionally omitted
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K6: all gates satisfied → click Kill → onKill called exactly once
  it("K6: all gates satisfied → click Kill menuitem → onKill called exactly once", async () => {
    currentIdentity = null;
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i });
    fireEvent.click(killItem);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  // K7: Kill menu item carries danger styling (red color via inline style)
  it("K7: Kill menuitem has danger styling (color: #ff9a8a from PrettyConversationContextMenu danger branch)", () => {
    currentIdentity = null;
    const onKill = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={onKill}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i }) as HTMLElement;
    // PrettyConversationContextMenu renders danger items with color: "#ff9a8a"
    // (see PrettyConversationContextMenu.tsx line 212: `color: item.danger ? "#ff9a8a" : "#e8e4d8"`)
    // jsdom normalizes hex → rgb(...) in computed style; match either form.
    expect(killItem.style.color).toMatch(/rgb\(255,\s*154,\s*138\)|#ff9a8a/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 48 Plan 05 (v14 locked shape, Ashley 2026-08-19)
// ─────────────────────────────────────────────────────────────────────────────
// New tests locking the v14 shape invariants: title-line hostname parens
// suffix; subtitle line = aiTitle (or muted italic ellipsis placeholder
// when null); Server icon fully retired; ready-dot fully retired; .pv-meta
// wrapper fully retired; bounty badges relocated to avatar corners; spinner-
// on className emitted per the active-set-scoped 4-input boolean (Ashley
// 2026-08-20 UAT tightening of 2026-08-19 verbatim):
//
//   showSpinnerOn = inActiveSet
//                && (isWorking===true || isRecycling || hasQueuePending)
//
// P47-14 and P47-15 are LOAD-BEARING regression guards. P47-14 locks
// hasQueuePending as a first-class input within the active-set scope. P47-15
// locks the ambient-scope short-circuit — non-active-set rows never spin.
// Together they guard against BOTH the pre-Phase-48 CSS-only gate `.pv-row
// .active-set:is(.working, .recycling)` (which dropped hasQueuePending) AND
// the 2026-08-19 full-inversion shape (which lit every ambient idle row).
// Do NOT weaken or delete either.
describe("PrettyConversationRow: Phase 48 Plan 05 v14 shape", () => {
  it("Test P48-01: title line renders identityName + ' (hostname)' suffix (parens contain hostname, single space between name and parens)", () => {
    currentIdentity = { ...makeIdentity(210, "Tanya") };
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({
          host: makeHost({ name: "skynet-ec2" }),
          targetTmuxSession: "tanya",
        })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const pvLabel = container.querySelector(".pv-label") as HTMLElement | null;
    expect(pvLabel).toBeTruthy();
    expect(pvLabel!.textContent?.trim()).toBe("Tanya (skynet-ec2)");
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (skynet-ec2)");
  });

  it("Test P48-02: title line renders JUST identityName when row.host is null (no trailing parens, no space)", () => {
    currentIdentity = { ...makeIdentity(210, "Tanya") };
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ host: null, targetTmuxSession: "tanya" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const pvLabel = container.querySelector(".pv-label") as HTMLElement | null;
    expect(pvLabel).toBeTruthy();
    expect(pvLabel!.textContent?.trim()).toBe("Tanya");
    expect(pvLabel!.querySelector(".pv-hostname-suffix")).toBeNull();
  });

  it("Test P48-03: subtitle line is `.pv-ai-title` span with aiTitle textContent when aiTitle is a non-empty string", () => {
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle="Fix bug X"
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    expect(pvAiTitle!.textContent).toBe("Fix bug X");
    // Not the placeholder variant.
    expect(pvAiTitle!.className).not.toContain("pv-ai-title--placeholder");
  });

  it("Test P48-04: subtitle line renders U+2026 '…' with `pv-ai-title--placeholder` class when aiTitle is null", () => {
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle={null}
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    // Single U+2026 ellipsis character.
    expect(pvAiTitle!.textContent).toBe("…");
    expect(pvAiTitle!.className).toContain("pv-ai-title--placeholder");
  });

  it("Test P48-05: subtitle line does NOT render any Server svg from lucide (Server icon fully retired since hostname now lives on title line)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ host: makeHost({ name: "skynet" }) })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle="X"
      />,
    );
    const pvAiTitle = container.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    // No lucide Server (or any) svg inside the subtitle span with aria-hidden=true.
    expect(pvAiTitle!.querySelector("svg")).toBeNull();
    // Regression: the pre-Phase-48 Server icon marker was width=11 height=11.
    expect(container.querySelector('svg[width="11"]')).toBeNull();
  });

  it("Test P47-06: `.pv-ready-dot` and `[data-pv-conv-ready-dot]` are ABSENT from the DOM across all four (inActiveSet, isWorking, isRecycling, hasQueuePending) combos", () => {
    // The ready-dot element is fully retired. Iterating multiple state
    // combinations guards against any residual JSX branch that would emit
    // a `.pv-ready-dot` span under some input combination.
    const combos: Array<{
      inActiveSet: boolean;
      isWorking: boolean | null;
      isRecycling: boolean;
      hasQueuePending: boolean;
      label: string;
    }> = [
      { inActiveSet: true, isWorking: false, isRecycling: false, hasQueuePending: false, label: "READY" },
      { inActiveSet: true, isWorking: true, isRecycling: false, hasQueuePending: false, label: "working-in-set" },
      { inActiveSet: false, isWorking: false, isRecycling: false, hasQueuePending: false, label: "idle-out-of-set" },
      { inActiveSet: true, isWorking: false, isRecycling: true, hasQueuePending: false, label: "recycling" },
      { inActiveSet: true, isWorking: false, isRecycling: false, hasQueuePending: true, label: "queue-pending" },
    ];
    for (const c of combos) {
      currentIdentity = makeIdentity(210, "tanya");
      const { container, unmount } = render(
        <PrettyConversationRow
          row={makeRow()}
          selected={false}
          pinned={false}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          inActiveSet={c.inActiveSet}
          isWorking={c.isWorking}
          isRecycling={c.isRecycling}
          hasQueuePending={c.hasQueuePending}
          aiTitle={null}
        />,
      );
      expect(
        container.querySelector(".pv-ready-dot"),
        `combo=${c.label}`,
      ).toBeNull();
      expect(
        container.querySelector("[data-pv-conv-ready-dot]"),
        `combo=${c.label}`,
      ).toBeNull();
      unmount();
    }
  });

  it("Test P47-07: `.pv-meta` wrapper is ABSENT from the row markup (element retired per 48-CONTEXT.md § .pv-meta right column retirement)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
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
    expect(container.querySelector(".pv-meta")).toBeNull();
  });

  it("Test P47-08: Pin badge wrap renders INSIDE `.pv-avatar` when pinnedCount > 0 (avatar bottom-left corner marker)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    currentBountyCounts = { pinnedCount: 3, needsDeskCount: 0 };
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
    const pinWrap = container.querySelector(
      '.pv-avatar [data-testid="pv-bounty-badge-pinned"]',
    );
    expect(pinWrap).not.toBeNull();
    expect(pinWrap!.textContent).toBe("3");
  });

  it("Test P47-09: Monitor badge wrap renders INSIDE `.pv-avatar` when needsDeskCount > 0 (avatar bottom-right corner marker)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    currentBountyCounts = { pinnedCount: 0, needsDeskCount: 2 };
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
    const deskWrap = container.querySelector(
      '.pv-avatar [data-testid="pv-bounty-badge-needs-desk"]',
    );
    expect(deskWrap).not.toBeNull();
    expect(deskWrap!.textContent).toBe("2");
  });

  it("Test P47-10: row emits both `.working` AND `.active-set` classes when inActiveSet+isWorking=true (pre-Phase-48 className composition invariant preserved by Task 1)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
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
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("working");
    expect(body.className).toContain("active-set");
  });

  it("Test P47-11: idle-in-active-set row is the READY branch — no `.spinner-on`, no `.working`, no `.recycling` (locks the ONE combination that suppresses the spinner)", () => {
    // Ashley's 4-input gate: `!(true && true && true && true)` = `!true`
    // = `false` → no spinner-on emission. This is the ONE and ONLY input
    // combination that suppresses the spinner. Any other combination
    // yields spinner-on = true.
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
        isRecycling={false}
        hasQueuePending={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
    expect(body.className).not.toContain("working");
    expect(body.className).not.toContain("recycling");
  });

  it("Test P47-12: both badge wraps render when pinnedCount > 0 AND needsDeskCount > 0 (both counts positive)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    currentBountyCounts = { pinnedCount: 3, needsDeskCount: 2 };
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
    expect(
      container.querySelector(
        '.pv-avatar [data-testid="pv-bounty-badge-pinned"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '.pv-avatar [data-testid="pv-bounty-badge-needs-desk"]',
      ),
    ).not.toBeNull();
  });

  it("Test P47-13: neither badge wrap renders when both pinnedCount === 0 AND needsDeskCount === 0 (PrettyBountyCountBadge's zero-null contract preserved through the relocation)", () => {
    currentIdentity = makeIdentity(210, "tanya");
    currentBountyCounts = { pinnedCount: 0, needsDeskCount: 0 };
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
    expect(
      container.querySelector(
        '.pv-avatar [data-testid="pv-bounty-badge-pinned"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '.pv-avatar [data-testid="pv-bounty-badge-needs-desk"]',
      ),
    ).toBeNull();
  });

  it("Test P47-14 (LOAD-BEARING): inActiveSet=true + isWorking=false + hasQueuePending=true → row HAS `spinner-on` class (queue-pending trips the spinner even when the row would otherwise satisfy the pre-Phase-48 ready condition)", () => {
    // Ashley's 4-input gate: `!(true && true && true && false)` =
    // `!false` = `true` → spinner-on. Under the pre-revision CSS-only
    // gate `.pv-row.active-set:is(.working, .recycling)` this row would
    // have failed (it has neither `.working` nor `.recycling` — 2 of the
    // 4 inputs, hasQueuePending in particular, were invisible to CSS).
    // This test guards against regression back to the CSS-only shape.
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={true}
        isWorking={false}
        isRecycling={false}
        hasQueuePending={true}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("spinner-on");
    // Row does NOT carry `.working` or `.recycling` — the pre-revision
    // CSS-only gate would have MISSED this row. The JS gate catches it.
    expect(body.className).not.toContain("working");
    expect(body.className).not.toContain("recycling");
  });

  it("Test P47-15 (LOAD-BEARING): inActiveSet=false + isWorking=true → row does NOT have `spinner-on` class (ambient rows never spin, Ashley 2026-08-20 UAT tightening)", () => {
    // Active-set-scoped gate: `inActiveSet && (isWorking===true ||
    // isRecycling || hasQueuePending)` short-circuits to `false` when
    // inActiveSet=false, regardless of the inner three predicates. Ambient
    // rows are silent for BOTH the retired ready-dot and the spinner.
    // This test locks the ambient-scope tightening — if a future change
    // widened the gate back to the 2026-08-19 full-inversion shape (where
    // ambient working AND ambient idle rows both spun), this test would
    // fail. Paired with P47-14 which locks queue-pending as a first-class
    // input within the active-set scope.
    currentIdentity = makeIdentity(210, "tanya");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        inActiveSet={false}
        isWorking={true}
        isRecycling={false}
        hasQueuePending={false}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).not.toContain("spinner-on");
    // The row DOES carry `.working` (isWorking===true) but does NOT carry
    // `.active-set` — under the active-set-scoped gate, `.working` alone
    // without `.active-set` is not enough to trip the spinner.
    expect(body.className).toContain("working");
    expect(body.className).not.toContain("active-set");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TL6-TL8 — iPad coarse-pointer + desktop-variant long-press context menu
// (quick-260821-suv)
// ─────────────────────────────────────────────────────────────────────────────
// iPad reports `window.innerWidth >= 768` in every orientation (10.9" landscape
// = 1180px, Pro 12.9" = 1024×1366, Mini portrait = 768 exactly). The
// pre-quick-260821-suv wiring gated touch handlers on
// `variant === "mobile"` — which is derived from `useIsMobile()` at the panel
// mount site, itself derived from `window.innerWidth < 768`. Result: iPad
// long-press was dead, iPad swipe-to-act was dead, both blocked by the same
// gate.
//
// The fix widens the four `onTouch*` JSX prop gates from
// `isMobile ? h : undefined` to `(isMobile || isTouchDevice) ? h : undefined`
// where `isTouchDevice = useIsTouchDevice()` reads the
// `(pointer: coarse) and (hover: none)` matchMedia query.
//
// TL6 — coarse pointer + variant="desktop" → touch handlers wire; 500ms hold
//        opens the menu (was RED before the row edit; GREEN after).
// TL7 — fine pointer + variant="desktop" → touch handlers stay off; touch
//        sequence does NOT open the menu; synthetic contextmenu (right-click)
//        DOES open the menu (desktop path unchanged control).
// TL8 — mobile variant → menu opens regardless of isTouchDevice (mobile
//        regression control).

describe("PrettyConversationRow: iPad (coarse-pointer + desktop-variant) long-press context menu (quick-260821-suv)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TL6: desktop variant + coarse-pointer touchscreen + 500ms hold opens the menu at touch coords; Pin menuitem present; onSelect NOT called", () => {
    currentIsTouchDevice = true; // simulate iPad matchMedia (pointer: coarse) and (hover: none)
    currentIdentity = makeIdentity(180, "nelly");
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
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
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("TL7: desktop variant + fine-pointer (no touchscreen) — touch handlers NOT wired; synthetic contextmenu right-click STILL opens the menu (desktop path unchanged control)", () => {
    currentIsTouchDevice = false; // fine-pointer desktop
    currentIdentity = makeIdentity(60, "nelly");
    const onSelect = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={onSelect}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    // Touch sequence must NOT open the menu — the four onTouch* props are
    // `undefined` on a fine-pointer desktop row.
    fireEvent.touchStart(body, {
      touches: [{ clientX: 200, clientY: 100 } as Touch],
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    expect(screen.queryByRole("menu")).toBeNull();

    // But right-click (contextmenu) DOES open the menu — desktop path is
    // unchanged (the `onContextMenu={!isMobile ? ... : undefined}` prop is
    // orthogonal to the coarse-pointer gate).
    fireEvent.contextMenu(body, { clientX: 220, clientY: 110 });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("TL8: mobile variant + fine-pointer matchMedia — long-press still opens the menu (mobile regression control; widening the OR gate did not break the pre-quick-260821-suv mobile path)", () => {
    currentIsTouchDevice = false; // deliberately false — mobile gate should still win
    currentIdentity = makeIdentity(210, "nelly");
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

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 56 Plan 03 Task 1 — Row is a drag source (Tests 6-9)
//
// Test 6: dragstart writes tabId to dataTransfer as text/plain
// Test 7: dragstart sets effectAllowed = 'move'
// Test 8: row body div carries draggable="true"
// Test 9: avatar img preserves draggable="false" (pre-existing gate)
//
// Tests 1-5 (existing gestures still fire) are covered by non-regression:
// every pre-existing describe block above (tap-select, mobile swipe,
// mobile long-press, desktop mouse-swipe, desktop context menu) continues
// to pass with `draggable={true}` and `onDragStart` on the row body,
// because native HTML5 drag disambiguates via the browser's own threshold
// (~5px desktop / long-press-and-move touch) rather than any handler this
// row installs at the pointerdown layer.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 56 row is a drag source", () => {
  it("Test 6: dragstart writes row.id into dataTransfer under text/plain", () => {
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ id: "test-tab-99" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="test-tab-99"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(body, { dataTransfer: dt });
    // Patch #511: dragstart now writes TWO payloads:
    //  1. text/plain = row.id (legacy fallback; scaffold tests + logging)
    //  2. application/x-skynet-row = JSON row shape (real drop path uses this
    //     to run the click-flow ladder — openTab-if-needed for fleet-only /
    //     rdp-host rows).
    expect(dt.setData).toHaveBeenCalledTimes(2);
    expect(dt.setData).toHaveBeenNthCalledWith(1, "text/plain", "test-tab-99");
    expect(dt.setData).toHaveBeenNthCalledWith(
      2,
      "application/x-skynet-row",
      expect.any(String),
    );
    const jsonArg = (dt.setData as ReturnType<typeof vi.fn>).mock.calls[1][1] as string;
    const parsed = JSON.parse(jsonArg);
    expect(parsed.id).toBe("test-tab-99");
    expect(parsed).toHaveProperty("host");
    expect(parsed).toHaveProperty("targetTmuxSession");
    expect(parsed).toHaveProperty("fleetOnly");
    expect(parsed).toHaveProperty("rdpHostRow");
  });

  it("Test 7: dragstart sets dataTransfer.effectAllowed = 'move'", () => {
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ id: "test-tab-99" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="test-tab-99"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(body, { dataTransfer: dt });
    expect(dt.effectAllowed).toBe("move");
  });

  it("Test 8: row body div carries draggable=\"true\"", () => {
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
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.getAttribute("draggable")).toBe("true");
  });

  it("Test 9: avatar img preserves draggable=\"false\" (image-drag suppression unchanged)", () => {
    currentIdentity = makeIdentity(120, "nelly");
    // Give the identity an avatarUrl so the <img> renders (the initial-letter
    // fallback branch is <span>, no draggable attribute needed).
    currentIdentity.avatarUrl = "data:image/png;base64,iVBORw0KGgo=";

    // Ashley 2026-09-01: <img> now gates on Number.isFinite(rowHostIdNum) —
    // when row.host.id is non-numeric (as in the default makeHost fixture
    // where id="hA") the render falls back to the initial-letter placeholder
    // to avoid a broken-image affordance. Provide a numeric host id so the
    // avatar-img path actually renders under test.
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ host: makeHost({ id: "1" }) })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const img = container.querySelector(".pv-avatar-img") as HTMLElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("draggable")).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 67 Plan 67-02 Track A — coordinator watermark on the conversation-list
// row. Two tests locking presence-when-true / absence-when-absent contract for
// the `.pv-row` FIRST-child watermark span.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 67 coordinator watermark", () => {
  it("ROW-COORD-1: identity.coordinator === true renders `data-testid=coordinator-watermark` element inside .pv-row", () => {
    currentIdentity = { ...makeIdentity(200, "nelly"), coordinator: true };
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
    const watermark = container.querySelector(
      '[data-testid="coordinator-watermark"]',
    );
    expect(watermark).not.toBeNull();
    // Positional contract: watermark lives INSIDE the .pv-row body, not
    // sibling to it.
    const row = container.querySelector(".pv-row") as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row!.contains(watermark)).toBe(true);
  });

  it("ROW-COORD-2: identity.coordinator absent (undefined) → no coordinator-watermark element in DOM", () => {
    // makeIdentity fixture omits coordinator — with widened Identity + strict:
    // false tsconfig this compiles fine and the field is undefined at runtime.
    currentIdentity = makeIdentity(200, "nelly");
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
    expect(
      container.querySelector('[data-testid="coordinator-watermark"]'),
    ).toBeNull();
  });
});
