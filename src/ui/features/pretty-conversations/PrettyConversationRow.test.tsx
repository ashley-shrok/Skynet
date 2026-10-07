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
import userEvent from "@testing-library/user-event";
import type { Identity } from "@/api/identities-api";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import type { Host } from "@/types/ui-types";

// jsdom does not implement ResizeObserver; stub it so Radix's DropdownMenu
// (used by RowKebabMenu, which is the row-level kebab post
// shape-sidebar-header-affordances) doesn't throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// shape-sidebar-header-affordances: helper to open the row's kebab menu and
// click an item by name. The old test pattern (fireEvent.contextMenu(body) +
// screen.getByRole("menuitem", ...)) no longer applies — right-click is
// retired on sidebar surfaces. Hover-reveal is CSS-only on real browsers; in
// jsdom the kebab trigger is in the DOM regardless of hover state.
async function openRowKebabAndClickItem(
  container: HTMLElement,
  itemName: string | RegExp,
): Promise<void> {
  const user = userEvent.setup();
  const trigger = container.querySelector(
    '[data-testid="pv-row-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("row kebab trigger not found");
  await user.click(trigger);
  const item = screen.getByRole("menuitem", { name: itemName });
  await user.click(item);
}

async function openRowKebab(container: HTMLElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  const trigger = container.querySelector(
    '[data-testid="pv-row-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("row kebab trigger not found");
  await user.click(trigger);
  return screen.getByRole("menu");
}

// shape-sidebar-header-affordances: variant of openRowKebab that scopes the
// trigger lookup to a specific wrapper (used in multi-row test fixtures where
// the generic container.querySelector would hit the first row's kebab, not
// the intended one).
async function openRowKebabInWrapper(wrapper: HTMLElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  const trigger = wrapper.querySelector(
    '[data-testid="pv-row-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("row kebab trigger not found in wrapper");
  await user.click(trigger);
  return screen.getByRole("menu");
}

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

// Phase 104 Plan 02 — per-test override handle for useTrappedWork.
// Default is undefined (pre-fetch / D-06 start-absent).
let currentTrappedWork: { hasTrappedWork: boolean } | undefined = undefined;

vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => currentTrappedWork,
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
  // Phase 68: Identity no longer has id/createdAt/updatedAt.
  return {
    identityKey: name.toLowerCase(),
    displayName: name,
    title: null,
    colorHue: hue,
    voice: null,
    role: null,
    task: null,
    project: null,
    avatarMime: "image/png",
    // Empty avatarUrl → the row falls back to the initial-letter render path
    // (avoids any real network fetch during tests).
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentIdentity = null;
  currentTrappedWork = undefined; // Phase 104 Plan 02 — default: pre-fetch
  currentIsTouchDevice = false; // quick-260821-suv default: fine-pointer desktop
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Desktop selected row applies `selected` class + `--pv-hue` inline
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: selected-row hue treatment (class + custom property)", () => {
  it("Test 1: desktop selected row carries `selected` class AND inline `--pv-hue`", async () => {
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
  it("Test 6: click on closed row fires onSelect exactly once", async () => {
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
  it("Test 7: mobile RDP row carries `rdp` class + no PinAction (RDP long-press guard covered by TL4)", async () => {
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

  it("Test 7b: desktop RDP row carries `rdp` class + no PinAction + context menu NOW opens (quick-260804-uo4 gate relaxed)", async () => {
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
    await openRowKebab(container);
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Desktop pin button e.stopPropagation() — click fires togglePin only
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: desktop context-menu pin path", () => {
  it("Test 8: desktop non-RDP row wires onContextMenu; contextmenu → Pin item → onTogglePin fires only (not onSelect)", async () => {
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
    await openRowKebab(container);
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
  it("Test 9: no identity → avatar contains tabIcon(row.type) svg", async () => {
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
  it("Test 10: pinned=true → row carries `pinned` class AND context menu opens with an `Unpin` menu item", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /unpin/i })).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — No identity-chip in DOM (session name IS identity name)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: no identity chip", () => {
  it("Test 11: neither variant renders an IdentityBadge in the DOM", async () => {
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
  it("Test 12: unselected non-RDP active-set row does NOT carry `selected`/`ambient`/`rdp` + `--pv-hue: 210` inline", async () => {
    // Phase 41 Plan 01 (user 2026-08-14) — updated: the `ambient` class is
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
  it("Test 13 (Phase 48 Plan 05 rewrite): inActiveSet+isWorking===false is the READY branch of user's 4-input gate — no ready-dot in DOM AND no `spinner-on` class on row", async () => {
    // Pre-Phase-48 this test asserted the ready-dot span was PRESENT with
    // aria-label='ready' + data-pv-conv-ready-dot='true' + .pv-ready-dot
    // class. Phase 48 Plan 05 retires the ready-dot entirely (user 2026-
    // 08-19 verbatim: "make the spinner work on the same logic as the idle
    // indicator, except you invert it as the final step of logic there").
    // The gate `!(inActiveSet && isWorking===false && !isRecycling)`
    // evaluates to `!(true && true && true)` = `!true` = `false` for this
    // input combination → NO `spinner-on` on
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
  it("Test 14 (Phase 48 Plan 05 rewrite): RDP row with inActiveSet+isWorking===false has NO ready-dot in DOM and NO spinner-on class (idle-in-active-set branch)", async () => {
    // Pre-Phase-48 this asserted the ready-dot span was PRESENT even on RDP
    // rows at the component level. Phase 48 Plan 05 retires the ready-dot
    // entirely — the "ready-for-attention" cue is now the absence of the
    // spinner ring rather than a positive dot render. RDP + idle-in-active-
    // set still evaluates to the READY branch of user's 4-input gate
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
  it("Test 15: inActiveSet+isWorking===true renders NO ready-dot AND row carries `working` class", async () => {
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
  it("Test 16: inActiveSet+isWorking===null renders NO ready-dot AND row does NOT carry `working` class", async () => {
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
// Test 17 — Ambient (!inActiveSet) IDLE row never spins. user 2026-09-21
//           decouple: the spinner is gated on the fleet-authoritative work
//           axis alone (isWorking || isRecycling), no active-set conjunct.
//           An idle row (both predicates false) never spins, regardless of
//           active-set membership. Ambient WORKING rows now DO spin — see
//           P47-15 for that lock.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: idle rows never spin (post-2026-09-21 decouple)", () => {
  it("Test 17: !inActiveSet+isWorking===false has NO ready-dot AND NO `spinner-on` class (idle rows never spin)", async () => {
    // Under the decoupled gate `isWorking===true || isRecycling`, both
    // predicates false/undefined collapse the expression to `false` →
    // no spinner-on. The retired ready-dot is absent as well. See P47-15
    // for the working-ambient case (ambient working rows DO spin under
    // decouple).
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
  it("Test 15b: inActiveSet+isWorking===false+isRecycling===true renders NO ready-dot AND row carries `recycling` class", async () => {
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
// Test 15c-guard — idle row with no positive spinner triggers stays quiet
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: idle-in-active-set never spins", () => {
  it("Test 15c-guard: inActiveSet+isWorking===false renders no ready-dot AND no `spinner-on` class", async () => {
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
// carry the `.ambient` class. user 2026-08-14 retired that visual axis
// entirely: no row ever carries `.ambient` now, regardless of inActiveSet
// or isRdp inputs. The regression test below covers ALL FOUR combinations
// of (inActiveSet, isRdp) to lock the retirement.

describe("PrettyConversationRow: Phase 41 Plan 01 ambient-recession retirement", () => {
  it("Test AMBIENT-RETIRED-01: row NEVER carries `.ambient` class regardless of inActiveSet / isRdp inputs", async () => {
    // Iterate all four combinations of (inActiveSet, isRdp). Phase 41 Plan 01:
    // NO row emits the `.ambient` class under any input combination — the
    // toggle was retired from the className composition. user lock (§Ready-
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
  // under the decoupled gate (user 2026-09-21 decouple from active-set):
  //   `showSpinnerOn = isWorking === true || isRecycling`
  //   — with both predicates false/undefined, the expression collapses
  //   to `false` regardless of `inActiveSet`. Idle rows never spin, whether
  //   ambient or active-set. This invariant held under the prior 2026-08-20
  //   active-set-scoped gate and still holds under the decouple (the two
  //   gates agree on the idle branch; they differ only on the working-
  //   ambient branch — see P47-15 for that).
  it("Test SPINNER-INVERSION-01: isWorking===false yields NO spinner-on on either inActiveSet=true or =false — ready-dot also fully absent in both cases (idle rows never spin)", async () => {
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
      // Decoupled spinner: neither branch spins when isWorking=false.
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
// in the right-click context menu (unconditional on desktop non-RDP).
// Deactivate was removed from the context menu 2026-08-17 (user); the row
// itself no longer exposes a user-facing deactivate trigger — the panel's
// 5-min idle sweep and the "Open in new window" side effect are the only
// remaining callers of onDeactivate.
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
  it("Test 18c: desktop non-RDP row has NO PinAction and NO DeactivateAction in .pv-meta (post quick-260730-o2m strip)", async () => {
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

  it("Test 18d: desktop non-RDP row body has onContextMenu; contextmenu opens portal menu with Pin — Deactivate is NEVER in the menu even with inActiveSet + onDeactivate provided (removed 2026-08-17)", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    expect(
      within(menu).queryByRole("menuitem", { name: /deactivate/i }),
    ).toBeNull();
  });

  it("Test 18e: desktop non-RDP row NOT in active-set opens the context menu with only `Pin` (no `Deactivate`)", async () => {
    // user 2026-08-17 removed the Deactivate menu item entirely — it no
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    expect(
      within(menu).queryByRole("menuitem", { name: /deactivate/i }),
    ).toBeNull();
  });

  it("Test 18f (shape-sidebar-header-affordances rewrite): right-click opens the SAME kebab menu, touch long-press is a no-op, NO in-DOM PinAction; kebab trigger IS present", async () => {
    // Original (quick-260802-pq2) asserted: (1) mobile onContextMenu is
    // undefined — dispatching contextmenu does NOT open the portal menu;
    // (2) no in-DOM PinAction on a mobile row. shape-sidebar-header-affordances
    // amendment: context menu machinery is now retired on EVERY variant, so
    // the stronger invariant is "contextmenu dispatch is a no-op on both
    // mobile AND desktop." The kebab is the sole affordance; its trigger
    // must be in the DOM on mobile (always-visible there since no hover).
    // Right-click amendment: a mouse right-click now opens the kebab's own
    // menu (same items) at the cursor as a convenience — still one menu, not
    // the retired PrettyConversationContextMenu. Touch long-press stays a
    // no-op.
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
    // (1a) contextmenu from a touch long-press does NOT open any menu.
    const touchEv = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    Object.defineProperty(touchEv, "pointerType", { value: "touch" });
    act(() => {
      body.dispatchEvent(touchEv);
    });
    expect(touchEv.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    // (1b) A mouse right-click opens the kebab's menu (same items).
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    expect(await screen.findByTestId("pv-row-kebab-item-pin")).toBeTruthy();
    // (2) No PinAction in the row DOM.
    expect(
      container.querySelector('[data-testid="pin-action"]'),
    ).toBeNull();
    // (3) Kebab trigger IS present — the mobile row's sole affordance.
    expect(
      container.querySelector('[data-testid="pv-row-kebab-trigger"]'),
    ).not.toBeNull();
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
      title: "user Ops",
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

  it("Test 19B (Phase 48 Plan 05 rewrite): subtitle is aiTitle regardless of identity.title value — subtitleMode has no effect on subtitle content", async () => {
    currentIdentity = makeIdentity(90, "user"); // makeIdentity sets title: null
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "user" })}
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

  it("Test 19C (Phase 48 Plan 05 rewrite): aiTitle=null renders a muted italic ellipsis placeholder — the row still has a subtitle span so it doesn't collapse-look", async () => {
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
// user 2026-08-01: identity-session rows in the conversation list showed
// their tmux sessionName (lowercase identity key) as the main label, while
// the IdentityBadge showed the properly-cased `identity.displayName`. The
// row now takes its main label from identity.displayName when subtitleMode
// is "identityTitle" AND identity resolves — matching the badge's source.
// When either condition is false, the row falls back verbatim to row.label
// (raw terminal rows, unresolved identities, hostname-mode rows unchanged).

describe("PrettyConversationRow: Phase 48 Plan 05 main label source + parenthetical suffix (inline-261001-conv-title-role-suffix flipped parens to the identity's role display name with hostname fallback — supersedes inline-260823's identity.title ladder)", () => {
  it("Test 20A (inline-261001-conv-title-role-suffix rewrite): identity resolved WITH role → parenthetical is the role display name, NOT hostname and NOT identity.title; user 2026-10-01 lock", async () => {
    // Pre-inline-261001 this asserted "Nelly (Fleet Coordinator)" — title
    // always, with hostname fallback. user 2026-10-01 flipped: parens prefer
    // the role display name. User verbatim: "right now it would show
    // 'Aqua (workstation)' but it should say the role instead of host like
    // 'Aqua (Secretary)'". `identity.title` is no longer consulted here; a
    // leftover title must NOT win over the role (regression guard).
    currentIdentity = {
      ...makeIdentity(200, "Nelly"),
      role: "secretary",
      title: "Fleet Coordinator",
    };
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
    // Full textContent (identity prefix + parens suffix): "Nelly (Secretary)"
    expect(pvLabel!.textContent?.trim()).toBe("Nelly (Secretary)");
    // The lowercase tmux sessionName MUST NOT appear as the prefix.
    expect(pvLabel!.textContent?.trim()).not.toBe("nelly-session");
    // Hostname MUST NOT appear anywhere in the label when a role is set.
    expect(pvLabel!.textContent).not.toContain("thenasty");
    // identity.title MUST NOT win over the role (regression guard against
    // reverting to inline-260823's title ladder).
    expect(pvLabel!.textContent).not.toContain("Fleet Coordinator");
    // Suffix span is present with role display-name content.
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (Secretary)");
  });

  it("Test 20A2 (inline-261001-conv-title-role-suffix): role's own displayName frontmatter wins over the title-cased slug", async () => {
    // Mirrors TP4b in the task-primary test file: when identity.roleDefaults
    // carries an authored displayName, roleDisplayName returns it verbatim
    // rather than title-casing the slug.
    currentIdentity = {
      ...makeIdentity(200, "Nelly"),
      role: "skynet-maintainer",
      roleDefaults: { displayName: "Skynet Ops" },
    };
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ label: "nelly-session", targetTmuxSession: "nelly" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const suffix = container.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (Skynet Ops)");
  });

  it("Test 20B (Phase 48 Plan 05 rewrite): NO identity resolved → main label prefix is row.label (verbatim fallback), still followed by the (hostname) parens suffix when host is present", () => {
    // Fallback safety-net preserved from patch #149 in new shape: when
    // useIdentities does not resolve, the label prefix is row.label so
    // the row never ships with an empty main label. Hostname parens
    // suffix still appears from row.host — the no-identity branch of the
    // inline-261001 role→host ladder (no identity → no role → hostname).
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

  it("Test 20C (inline-261001-conv-title-role-suffix): identity resolved but role=null → parens fall back to hostname", async () => {
    // Locks the fallback contract: when an identity exists but has no
    // role (role=null — an anomalous case; every live identity carries
    // one in practice), the parenthetical falls back to the row.host.name
    // rather than showing empty parens. Matches the "host as fallback"
    // intent from inline-260823, preserved under the new role-first ladder.
    currentIdentity = { ...makeIdentity(200, "Nelly"), role: null };
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
    // displayName + hostname fallback (no role present)
    expect(pvLabel!.textContent?.trim()).toBe("Nelly (thenasty)");
    const suffix = pvLabel!.querySelector(
      ".pv-hostname-suffix",
    ) as HTMLElement | null;
    expect(suffix).toBeTruthy();
    expect(suffix!.textContent).toBe(" (thenasty)");
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

  it("UO1: desktop, inActiveSet=true, non-RDP → menu item labeled 'Open in new window'; click calls window.open with workspace URL + calls onDeactivate once", async () => {
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
    await openRowKebab(container);
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

  it("UO2: desktop, inActiveSet=false, non-RDP → menu item labeled 'Open in new window'; click calls window.open; onDeactivate NOT called", async () => {
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
    await openRowKebab(container);
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

  it("UO3: desktop, RDP row, inActiveSet=true → menu opens (gate relaxed); 'Open in new window' present; click calls window.open + onDeactivate", async () => {
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
    await openRowKebab(container);
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

  it("UO4: desktop, inActiveSet=true, window.open returns null (popup blocked) → window.open called but onDeactivate NOT called", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", { name: /open in new window/i });
    fireEvent.click(item);

    // window.open was attempted.
    expect(window.open).toHaveBeenCalledTimes(1);
    // onDeactivate must NOT be called — the new window was blocked, so
    // the original tab survives (data-loss prevention).
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("UO4b: window.open features arg must NOT include 'noopener' (regression guard, 2026-08-05 fix) — per spec, window.open with noopener always returns null, which would defeat the popup-blocker null-check and stop Open-in-new-window from ever deactivating the origin tab when inActiveSet", async () => {
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
    await openRowKebab(container);
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
});

// shape-sidebar-header-affordances: UO5 + UO6 (mobile long-press) RETIRED
// alongside the long-press machinery itself. Open-in-new-window remains
// desktop-only via the !isMobile gate in the kebab items[] builder.

// ─────────────────────────────────────────────────────────────────────────────
// Kill menu item (quick-260810-n3a) — K1-K7
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the Test 18d/18e pattern. The Kill item appears in the context menu
// ONLY when: onKill provided AND !isRdp AND !identity AND row.targetTmuxSession
// is non-null. The item carries `danger: true` (red color via inline style).

describe("PrettyConversationRow: Kill menu item (quick-260810-n3a)", () => {
  // K1: non-RDP, no identity, has targetTmuxSession, onKill provided → Kill in menu
  it("K1: desktop non-RDP row, no identity, targetTmuxSession set, onKill provided → context menu contains Kill", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /kill/i })).toBeTruthy();
  });

  // K2: identity resolves → Kill NOT in menu (identity gate)
  it("K2: identity resolves → Kill NOT in menu (identity gate)", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K3: RDP row → Kill NOT in menu (isRdp gate)
  it("K3: RDP row → Kill NOT in menu (isRdp gate)", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K4: targetTmuxSession is null → Kill NOT in menu
  it("K4: targetTmuxSession = null → Kill NOT in menu", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /kill/i })).toBeNull();
  });

  // K5: onKill NOT provided → Kill NOT in menu
  it("K5: onKill NOT provided → Kill NOT in menu", async () => {
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
    await openRowKebab(container);
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i });
    fireEvent.click(killItem);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  // K7: Kill menu item carries danger styling (red color via inline style)
  it("K7: Kill menuitem carries RowKebabMenu's danger styling (text-[hsla(0,60%,76%,1)] class)", async () => {
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
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i }) as HTMLElement;
    // RowKebabMenu renders danger items with a specific Tailwind color class
    // (see RowKebabMenu.tsx ITEM_CLASS_DANGER constant).
    expect(killItem.className).toContain("text-[hsla(0,60%,76%,1)]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 115 Plan 115-06 — Archive menu item (A1-A4)
// ─────────────────────────────────────────────────────────────────────────────
// Locks the row-menu Archive item's presence + label + styling + click wiring.
// Mirrors the Kill test shape (K1-K7): six gated presence tests, plus a click
// through. The panel is responsible for gating `onArchive` on
// fleet-synthetic-identity-backed rows (see canonicalArchiveIdForRow in
// PrettyConversationsPanel.tsx); at the ROW component level the gate is
// simply "onArchive provided" — the panel decides whether to provide it.

describe("PrettyConversationRow: Phase 115 Plan 115-06 Archive menu item", () => {
  // A1: onArchive provided → Archive menu item in menu with label "Archive"
  it("A1: desktop row with onArchive provided → context menu contains 'Archive' entry (exact-case label)", async () => {
    currentIdentity = makeIdentity(210, "wren");
    const onArchive = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "wren" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onArchive={onArchive}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    // Exact-case match — the item label MUST be "Archive" (capital A).
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    expect(archiveItem).toBeTruthy();
  });

  // A2: Archive menu item carries danger styling (red)
  it("A2: Archive menu item carries danger styling (color: #ff9a8a)", async () => {
    currentIdentity = makeIdentity(210, "wren");
    const onArchive = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "wren" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onArchive={onArchive}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", {
      name: "Archive",
    }) as HTMLElement;
    // Same danger styling as Kill (see K7 sibling test): RowKebabMenu applies
    // the danger-specific color class via its ITEM_CLASS_DANGER constant.
    expect(archiveItem.className).toContain("text-[hsla(0,60%,76%,1)]");
  });

  // A3: onArchive NOT provided → Archive item absent from the menu.
  it("A3: onArchive NOT provided → Archive item absent from the menu", async () => {
    currentIdentity = makeIdentity(210, "wren");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "wren" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        // onArchive intentionally omitted
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Archive" }),
    ).toBeNull();
  });

  // A4: Click Archive → onArchive fires exactly once.
  it("A4: click Archive menuitem → onArchive called exactly once", async () => {
    currentIdentity = makeIdentity(210, "wren");
    const onArchive = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "wren" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onArchive={onArchive}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    fireEvent.click(archiveItem);
    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 48 Plan 05 (v14 locked shape, user 2026-08-19) — spinner gate
// updated 2026-09-21 (decouple from active-set)
// ─────────────────────────────────────────────────────────────────────────────
// Tests locking the v14 shape invariants: title-line hostname parens
// suffix; subtitle line = aiTitle (or muted italic ellipsis placeholder
// when null); Server icon fully retired; ready-dot fully retired; .pv-meta
// wrapper fully retired; bounty badges relocated to avatar corners; spinner-
// on className emitted per the decoupled boolean (user 2026-09-21):
//
//   showSpinnerOn = isWorking===true || isRecycling
//
// P47-15 is a LOAD-BEARING regression guard locking the decouple — ambient
// (non-active-set) working rows DO spin, because agent-readiness is
// client-scope-independent. It guards against a regression back to the
// 2026-08-20 active-set-scoped shape (which made the same agent's readiness
// client-dependent). Do NOT weaken or delete.
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

  it("Test P48-03: subtitle line is `.pv-ai-title` span with aiTitle textContent when aiTitle is a non-empty string", async () => {
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

  it("Test P48-04: subtitle line renders U+2026 '…' with `pv-ai-title--placeholder` class when aiTitle is null", async () => {
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

  it("Test P48-05: subtitle line does NOT render any Server svg from lucide (Server icon fully retired since hostname now lives on title line)", async () => {
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

  it("Test P47-06: `.pv-ready-dot` and `[data-pv-conv-ready-dot]` are ABSENT from the DOM across all (inActiveSet, isWorking, isRecycling) combos", () => {
    // The ready-dot element is fully retired. Iterating multiple state
    // combinations guards against any residual JSX branch that would emit
    // a `.pv-ready-dot` span under some input combination.
    const combos: Array<{
      inActiveSet: boolean;
      isWorking: boolean | null;
      isRecycling: boolean;
      label: string;
    }> = [
      { inActiveSet: true, isWorking: false, isRecycling: false, label: "READY" },
      { inActiveSet: true, isWorking: true, isRecycling: false, label: "working-in-set" },
      { inActiveSet: false, isWorking: false, isRecycling: false, label: "idle-out-of-set" },
      { inActiveSet: true, isWorking: false, isRecycling: true, label: "recycling" },
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

  it("Test P47-07: `.pv-meta` wrapper is ABSENT from the row markup (element retired per 48-CONTEXT.md § .pv-meta right column retirement)", async () => {
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

  // Tests P47-08 and P47-09 (Pin + Monitor bounty-badge renders inside
  // .pv-avatar) — RETIRED in Phase 104 Plan 03 alongside the bounty-count wire.

  it("Test P47-10: row emits both `.working` AND `.active-set` classes when inActiveSet+isWorking=true (pre-Phase-48 className composition invariant preserved by Task 1)", async () => {
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
    // Gate: `!(isWorking===true || isRecycling)` — with both false the
    // expression collapses to false → no spinner-on emission.
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

  // Tests P47-12 and P47-13 (both badge wraps render / neither renders — zero-null
  // contract) — RETIRED in Phase 104 Plan 03 alongside the bounty-count wire.

  it("Test P47-15 (LOAD-BEARING): inActiveSet=false + isWorking=true → row HAS `spinner-on` class (agent-readiness is client-scope-independent, user 2026-09-21 decouple)", async () => {
    // Decoupled gate: `showSpinnerOn = isWorking === true || isRecycling`.
    // `activeSet` is a per-tab client-side artifact and the wrong axis to
    // gate on — the same agent's readiness must not appear or disappear
    // depending on which client has the tab open. `isWorking` and
    // `isRecycling` are backend-authoritative via the fleet-status poller
    // (Plan 53-03); the spinner lights whenever the agent is working
    // regardless of active-set membership. This test locks the decouple —
    // if a future change re-scoped the gate back to `inActiveSet && ...`,
    // this test would fail.
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
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    expect(body.className).toContain("spinner-on");
    // The row carries `.working` (isWorking===true) and does NOT carry
    // `.active-set` (inActiveSet=false) — the spinner is now gated on the
    // fleet-authoritative work axis alone, decoupled from client-side
    // active-set membership.
    expect(body.className).toContain("working");
    expect(body.className).not.toContain("active-set");
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
// every pre-existing describe block above (tap-select, mobile long-press,
// desktop context menu) continues to pass with `draggable={true}` and
// `onDragStart` on the row body,
// because native HTML5 drag disambiguates via the browser's own threshold
// (~5px desktop / long-press-and-move touch) rather than any handler this
// row installs at the pointerdown layer.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Phase 56 row is a drag source", () => {
  it("Test 6: dragstart writes row.id into dataTransfer under text/plain", async () => {
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

  it("Test 7: dragstart sets dataTransfer.effectAllowed = 'move'", async () => {
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

  it("Test 8: row body div carries draggable=\"true\"", async () => {
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

  it("Test 9: avatar img preserves draggable=\"false\" (image-drag suppression unchanged)", async () => {
    currentIdentity = makeIdentity(120, "nelly");
    // Give the identity an avatarUrl so the <img> renders (the initial-letter
    // fallback branch is <span>, no draggable attribute needed).
    currentIdentity.avatarUrl = "data:image/png;base64,iVBORw0KGgo=";

    // user 2026-09-01: <img> now gates on Number.isFinite(rowHostIdNum) —
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
  it("ROW-COORD-1: identity.coordinator === true renders `data-testid=coordinator-watermark` element inside .pv-row", async () => {
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

  it("ROW-COORD-2: identity.coordinator absent (undefined) → no coordinator-watermark element in DOM", async () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 104 Plan 02 — Trapped-work indicator visibility on avatar corner
// ─────────────────────────────────────────────────────────────────────────────
// The trapped-work indicator (data-testid="pv-trapped-work-indicator") renders
// inside .pv-avatar when useTrappedWork returns {hasTrappedWork:true}, and is
// absent when the hook returns undefined (pre-fetch / D-06 start-absent) or
// {hasTrappedWork:false} (probe returned no trapped work). currentTrappedWork
// is reset to undefined in beforeEach; each test sets it to the relevant shape.

describe("PrettyConversationRow: trapped-work indicator visibility (Phase 104 Plan 02)", () => {
  it("Row Test 1 (indicator absent — undefined): mock useTrappedWork returns undefined → no indicator in DOM", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = undefined;
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
    expect(screen.queryByTestId("pv-trapped-work-indicator")).toBeNull();
  });

  it("Row Test 2 (indicator absent — false): mock returns {hasTrappedWork:false} → no indicator in DOM", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = { hasTrappedWork: false };
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
    expect(screen.queryByTestId("pv-trapped-work-indicator")).toBeNull();
  });

  it("Row Test 3 (indicator present — true): mock returns {hasTrappedWork:true} → indicator exists inside .pv-avatar", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = { hasTrappedWork: true };
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
    const indicator = screen.queryByTestId("pv-trapped-work-indicator");
    expect(indicator).not.toBeNull();
    // It must be a direct descendant of the .pv-avatar container.
    const avatar = container.querySelector('[data-testid="pcrow-avatar"]');
    expect(avatar).not.toBeNull();
    expect(avatar!.contains(indicator!)).toBe(true);
  });

  it("Row Test 4 (tooltip attribute): indicator has title=\"Has local work not yet pushed to any remote\" (D-07 exact copy)", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = { hasTrappedWork: true };
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
    const indicator = screen.getByTestId("pv-trapped-work-indicator");
    expect(indicator.getAttribute("title")).toBe(
      "Has local work not yet pushed to any remote",
    );
  });

  it("Row Test 5 (icon has aria-hidden): the SVG icon inside the indicator has aria-hidden=\"true\"", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = { hasTrappedWork: true };
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
    const indicator = screen.getByTestId("pv-trapped-work-indicator");
    const svg = indicator.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("Row Test 6 (icon is GitPullRequestDraft): the inner SVG carries lucide's git-pull-request-draft class", async () => {
    currentIdentity = makeIdentity(210, "nelly");
    currentTrappedWork = { hasTrappedWork: true };
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
    const indicator = screen.getByTestId("pv-trapped-work-indicator");
    const svg = indicator.querySelector("svg");
    expect(svg).not.toBeNull();
    // lucide-react renders each icon with a class like `lucide-<kebab-name>`;
    // GitPullRequestDraft → `lucide-git-pull-request-draft`.
    const cls = svg!.getAttribute("class") ?? "";
    expect(cls).toContain("lucide-git-pull-request-draft");
    // Sanity: the pv-trapped-work-icon class is also applied.
    expect(cls).toContain("pv-trapped-work-icon");
  });

  it("Row Test 7 (non-identity row): row with no identity (matchKey null) → no indicator (useTrappedWork short-circuits)", async () => {
    // currentIdentity is null (reset in beforeEach) — no identity resolves.
    currentTrappedWork = undefined; // hook returns undefined for null identityKey
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
    expect(screen.queryByTestId("pv-trapped-work-indicator")).toBeNull();
  });

  // Row Test 8 (coexistence with bounty badges — Wave 1 A/B) — RETIRED in
  // Phase 104 Plan 03 alongside the bounty-count wire. The trapped-work
  // indicator is now the sole avatar-corner affordance.
});

// ─────────────────────────────────────────────────────────────────────────────
// "Move to project" menu item (shape-move-to-project-context-menu, 2026-09-23)
// ─────────────────────────────────────────────────────────────────────────────
//
// Row's items[] builder gates the "Move to project" parent on
//   onMoveToProject !== undefined  &&  projects.length > 0
// The panel enforces both — passes onMoveToProject as UNDEFINED for RDP rows
// AND when the fleet has zero projects — so a single-condition gate at the
// row is enough. When present, the item is a submenu-parent that carries
// projects as menuitemradio children (checkmark on the currently-assigned
// project) plus a terminal "Remove from project" only when the row IS
// currently in a project.

describe("PrettyConversationRow: Move to project menu item (shape-move-to-project-context-menu)", () => {
  it("desktop non-RDP row, onMoveToProject provided, projects non-empty → context menu contains 'Move to project' as a submenu parent (aria-haspopup=menu)", async () => {
    currentIdentity = null;
    const onMoveToProject = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={onMoveToProject}
        projects={[
          { slug: "foo", displayName: "Foo" },
          { slug: "bar", displayName: "Bar" },
        ]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const item = within(menu).getByRole("menuitem", {
      name: /move to project/i,
    });
    expect(item).toBeTruthy();
    expect(item.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("onMoveToProject undefined → 'Move to project' NOT in menu (panel enforces RDP/zero-projects gate by omitting the prop)", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        projects={[{ slug: "foo", displayName: "Foo" }]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: /move to project/i }),
    ).toBeNull();
  });

  it("projects empty → 'Move to project' NOT in menu (defense-in-depth against panel forgetting the gate)", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={vi.fn()}
        projects={[]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: /move to project/i }),
    ).toBeNull();
  });

  it("submenu lists projects in the provided order with the currently-assigned project marked (menuitemradio + aria-checked=true)", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={vi.fn()}
        projects={[
          { slug: "foo", displayName: "Foo" },
          { slug: "bar", displayName: "Bar" },
          { slug: "baz", displayName: "Baz" },
        ]}
        currentProjectSlug="bar"
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    const foo = screen.getByRole("menuitem", { name: /^foo$/i });
    const bar = screen.getByRole("menuitem", { name: /^bar$/i });
    const baz = screen.getByRole("menuitem", { name: /^baz$/i });
    // shape-sidebar-header-affordances: Radix sub-menu items render with
    // role="menuitem" (not menuitemradio). RowKebabMenu signals the "checked"
    // state via a Check icon prefix (lucide-react Check svg); the other items
    // get a sized placeholder span of the same width so labels align.
    expect(bar.querySelector("svg.lucide-check")).not.toBeNull();
    expect(foo.querySelector("svg.lucide-check")).toBeNull();
    expect(baz.querySelector("svg.lucide-check")).toBeNull();
  });

  it("Remove from project appears when currentProjectSlug is non-null", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={vi.fn()}
        projects={[{ slug: "foo", displayName: "Foo" }]}
        currentProjectSlug="foo"
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    expect(
      screen.getByRole("menuitem", { name: /remove from project/i }),
    ).toBeTruthy();
  });

  it("Remove from project is HIDDEN when currentProjectSlug is null (hidden-not-greyed)", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={vi.fn()}
        projects={[{ slug: "foo", displayName: "Foo" }]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    expect(
      screen.queryByRole("menuitem", { name: /remove from project/i }),
    ).toBeNull();
  });

  it("picking a non-current project fires onMoveToProject with that slug", async () => {
    currentIdentity = null;
    const onMoveToProject = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={onMoveToProject}
        projects={[
          { slug: "foo", displayName: "Foo" },
          { slug: "bar", displayName: "Bar" },
        ]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    await userEvent.setup().click(screen.getByRole("menuitem", { name: /^bar$/i }));
    expect(onMoveToProject).toHaveBeenCalledTimes(1);
    expect(onMoveToProject).toHaveBeenCalledWith("bar");
  });

  it("picking the currently-assigned project is a silent no-op (no setter fires)", async () => {
    currentIdentity = null;
    const onMoveToProject = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={onMoveToProject}
        projects={[
          { slug: "foo", displayName: "Foo" },
          { slug: "bar", displayName: "Bar" },
        ]}
        currentProjectSlug="foo"
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    await userEvent.setup().click(screen.getByRole("menuitem", { name: /^foo$/i }));
    expect(onMoveToProject).not.toHaveBeenCalled();
  });

  it("picking Remove from project fires onMoveToProject with null (null-clears semantic)", async () => {
    currentIdentity = null;
    const onMoveToProject = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onMoveToProject={onMoveToProject}
        projects={[{ slug: "foo", displayName: "Foo" }]}
        currentProjectSlug="foo"
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    await userEvent.setup().click(
      within(menu).getByRole("menuitem", { name: /move to project/i }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /remove from project/i }),
    );
    expect(onMoveToProject).toHaveBeenCalledTimes(1);
    expect(onMoveToProject).toHaveBeenCalledWith(null);
  });

  it("'Move to project' sits between 'Open in new window' and 'Kill' in menu order", async () => {
    currentIdentity = null;
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ targetTmuxSession: "claude-abc" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onKill={vi.fn()}
        onArchive={vi.fn()}
        onMoveToProject={vi.fn()}
        projects={[{ slug: "foo", displayName: "Foo" }]}
        currentProjectSlug={null}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    await openRowKebab(container);
    const menu = screen.getByRole("menu");
    const menuitems = within(menu).getAllByRole("menuitem");
    const labels = menuitems.map((m) => (m.textContent ?? "").trim());
    const iOpen = labels.findIndex((l) => /open in new window/i.test(l));
    const iMove = labels.findIndex((l) => /move to project/i.test(l));
    const iKill = labels.findIndex((l) => /^kill$/i.test(l));
    const iArchive = labels.findIndex((l) => /^archive$/i.test(l));
    expect(iOpen).toBeGreaterThan(-1);
    expect(iMove).toBeGreaterThan(-1);
    expect(iKill).toBeGreaterThan(-1);
    expect(iArchive).toBeGreaterThan(-1);
    expect(iMove).toBeGreaterThan(iOpen);
    expect(iMove).toBeLessThan(iKill);
    expect(iKill).toBeLessThan(iArchive);
  });
});
