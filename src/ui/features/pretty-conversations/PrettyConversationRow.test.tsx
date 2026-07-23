// ─── PrettyConversationRow — Vitest coverage ─────────────────────────────────
// 18 tests covering the row component from Phase 10 Plan 01 Task 3 + patch
// #136 + patch #137:
//   1) Desktop selected-row hue treatment (inline hsla interpolation) —
//      updated for patch #137 to pass explicit inActiveSet={true}
//   2) Mobile swipe past 40px threshold opens the reveal strip
//   3) Mobile swipe under threshold snaps closed
//   4) Vertical gesture > 12px yields to browser scroll (no open, no select)
//   5) Tap on swiped-open row closes it (does NOT fire onSelect)
//   6) Tap on closed row fires onSelect
//   7) RDP row (rdpHostRow=true) has no swipe strip and no pin button
//   8) Desktop pin button e.stopPropagation() — click fires togglePin only
//   9) Avatar fallback for no-identity row renders a tabIcon svg
//  10) Pinned row on desktop always shows pin button (not hover-gated)
//  11) No identity-chip in DOM (session name IS identity name)
//  12) [patch #136] Unselected non-RDP row with hue renders full hue-bubble
//      body treatment — updated for patch #137 to pass inActiveSet={true}
//      so the row stays in the full-bubble branch (ambient-vs-full branch
//      exercised by Test 18)
//  13) [patch #137] inActiveSet+isWorking===false renders ready-dot with
//      aria-label="ready" and matching data attribute (renamed + inverted
//      from the retired patch #136 working-dot render slot)
//  14) [patch #137] RDP row + inActiveSet+isWorking===false uses neutral
//      rgba(240,235,224,…) ready-dot fill (proves the neutral-branch
//      fallback is wired end-to-end)
//  15) [patch #137] inActiveSet+isWorking===true renders NO ready-dot
//  16) [patch #137] inActiveSet+isWorking===null renders NO ready-dot
//  17) [patch #137] !inActiveSet+isWorking===false renders NO ready-dot
//      (ambient never shows it)
//  18) [patch #137] !inActiveSet && !isRdp row applies ambient body style
//      (flat hsla background, no drop shadow, no backdrop-blur)
//  18b) [patch #137] RDP row is EXEMPT from ambient — inActiveSet=false
//      still uses the neutral full-bubble treatment
//
// Fixture pattern lifted from src/ui/sidebar/NewSessionDialog.test.tsx lines
// 14-35 verbatim: mock react-i18next passthrough, mock session-hue helpers
// and identities-store to per-test-controllable outputs.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
// is tree-shaken irrelevant during test runs; the terminal/guacamole modules
// are only touched from renderTabContent (not tabIcon). If jsdom complains
// about a transitive import during Test 9's render, revisit.

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
// Test 1 — Desktop variant renders selected-row hue treatment
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: selected-row hue treatment", () => {
  it("Test 1: desktop selected row applies the inline hsla(hue,...) gradient", () => {
    currentIdentity = makeIdentity(30, "nelly");
    // Patch #137: inActiveSet={true} keeps the row in the full-bubble
    // treatment; without it the row would render the ambient recession
    // and Test 1's linear-gradient assertion below would fail. The panel
    // always passes inActiveSet={true} for a selected row because
    // selectConversation adds to the active-set as a side-effect.
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

    // The row body carries the selected-style inline. Find it by role=button
    // scoped to the wrapper (there's exactly one — the row body itself; the
    // PinAction desktop button is opacity-0 but still queryable — so scope
    // by parent).
    //
    // NOTE: jsdom's CSSOM parser normalizes `hsla(30, 50%, 38%, 0.30)` to
    // `rgba(145, 97, 48, 0.3)` when read through `HTMLElement.style.*`. To
    // verify the ROW's source-of-truth is the interpolated hsla string we
    // read the raw `style` attribute directly (bypasses CSSOM
    // normalization). This is what actually ships to the DOM and what
    // Ashley's visual review pattern-matches on.
    const body = wrapper!.querySelector('[role="button"]') as HTMLElement;
    expect(body).toBeTruthy();
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).toContain("hsla(30,");
    expect(rawStyle).toContain("linear-gradient(160deg");
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
// Test 7 — RDP row (rdpHostRow=true) has no swipe strip and no pin button
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: RDP-row exclusion (T-Test-34)", () => {
  it("Test 7: mobile RDP row skips swipe wiring and renders no PinAction", () => {
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

    // Touch sequence that would otherwise open — no data-swiped-open.
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
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

  it("Test 7b: desktop RDP row renders no PinAction", () => {
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
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Desktop pin button e.stopPropagation() — click fires togglePin only
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: pin click stopPropagation", () => {
  it("Test 8: desktop pin click fires onTogglePin only, not onSelect", () => {
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
    const pin = container.querySelector(
      '[data-testid="pin-action"]',
    ) as HTMLElement | null;
    expect(pin).toBeTruthy();
    fireEvent.click(pin!);
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
// Test 10 — Pinned row on desktop always shows pin button (not hover-gated)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: pinned desktop pin visibility", () => {
  it("Test 10: pinned=true → desktop pin column has opacity-100 (not hover-gated)", () => {
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
    const pin = container.querySelector(
      '[data-testid="pin-action"]',
    ) as HTMLElement | null;
    expect(pin).toBeTruthy();
    // The visibility wrapper is the parent div of the pin button.
    const visibilityWrapper = pin!.parentElement as HTMLElement;
    expect(visibilityWrapper.className).toContain("opacity-100");
    // The hover-gate class should NOT be present when pinned.
    expect(visibilityWrapper.className).not.toContain("opacity-0");
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
// Test 12 — [patch #136] Unselected non-RDP row with hue renders full
//           hue-bubble body treatment (not the previous selected-only reduced
//           alpha treatment)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #136 full-bubble-every-row", () => {
  it("Test 12: unselected non-RDP row with hue renders full hue-bubble body style", () => {
    currentIdentity = makeIdentity(210, "nelly");
    // Patch #137: inActiveSet={true} keeps the row in the full-bubble
    // treatment; the ambient-vs-full body branch is exercised by Test 18.
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
    // Body div is the role="button" element (scoped inside the wrapper).
    // jsdom's CSSOM normalizes hsla → rgba INSIDE `linear-gradient(...)`
    // functions but preserves hsla in other contexts (box-shadow, plain
    // color). So we probe two invariants:
    //   1. background contains `linear-gradient(160deg, ` with 0.55/0.6
    //      alpha values — proves the full-bubble treatment is applied.
    //   2. box-shadow contains an `hsla(210, ...)` substring — proves the
    //      row.hue was interpolated (not defaulted to the neutral branch).
    // Together these lock the "every-row-gets-the-bubble" behavior against
    // the pre-patch-#136 "selected-only reduced-alpha" treatment.
    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    const rawStyle = body.getAttribute("style") ?? "";
    expect(rawStyle).toContain("linear-gradient(160deg, ");
    // 0.55 outer + 0.6 inner alpha stops verbatim from patch #136 spec.
    // jsdom normalizes 0.60 → 0.6 and 0.55 → 0.55.
    expect(rawStyle).toMatch(/linear-gradient\(160deg,[^;]*0\.55[^;]*0\.6\)/);
    // Hue-driven interpolation is provable via the box-shadow's hue-hairline
    // + hue-glow (jsdom preserves hsla in box-shadow context).
    expect(rawStyle).toContain("hsla(210,");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13 — [patch #137] inActiveSet + isWorking===false renders ready-dot
//           with correct a11y + data-attribute wiring (renamed + inverted
//           from the retired patch #136 working-dot render slot)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ready-dot render", () => {
  it("Test 13: inActiveSet+isWorking===false renders ready-dot with aria-label='ready'", () => {
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
    // Steady — no animation string in the inline style.
    expect(dot.style.animation).toBe("");
    // Regression: the old patch-#136 aria-label must be absent.
    expect(queryByLabelText("working")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — [patch #137] RDP row + inActiveSet+isWorking===false uses neutral
//           rgba(240,235,224,…) ready-dot fill (proves neutral-branch
//           fallback is wired end-to-end)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ready-dot neutral fallback", () => {
  it("Test 14: RDP row with inActiveSet+isWorking===false uses neutral rgba dot", () => {
    // currentIdentity stays null (beforeEach reset) — RDP row + no identity
    // → hue is null → dot renders the neutral rgba(240,235,224,…) background.
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
    const rawStyle = dot.getAttribute("style") ?? "";
    expect(rawStyle).toContain("rgba(240,235,224");
    // Defensive: no hsla substring anywhere in the dot's style — the hue
    // branch should NOT have fired.
    expect(rawStyle).not.toContain("hsla(");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15 — [patch #137] inActiveSet + isWorking===true renders NO ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ready-dot suppression — working", () => {
  it("Test 15: inActiveSet+isWorking===true renders NO ready-dot", () => {
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
        isWorking={true}
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 16 — [patch #137] inActiveSet + isWorking===null renders NO ready-dot
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ready-dot suppression — unknown", () => {
  it("Test 16: inActiveSet+isWorking===null renders NO ready-dot", () => {
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
        isWorking={null}
      />,
    );
    expect(queryByLabelText("ready")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 17 — [patch #137] !inActiveSet + isWorking===false renders NO ready-dot
//           (ambient rows never show it)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ready-dot suppression — ambient", () => {
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
// Test 18 — [patch #137] Ambient recession + RDP exemption
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: patch #137 ambient recession", () => {
  it("Test 18: !inActiveSet && !isRdp row applies ambient body style (flat hsla background, no drop shadow, no backdrop-blur)", () => {
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
    const rawStyle = body.getAttribute("style") ?? "";
    // Ambient flat background (NOT linear-gradient). jsdom's CSSOM
    // normalizes hsla → rgba when applied to `background`, so we probe
    // via: (a) no linear-gradient substring, (b) a hue-derived hairline
    // hsla still present in box-shadow (jsdom preserves hsla inside
    // box-shadow), and (c) 0.16 alpha in the raw background value.
    expect(rawStyle).not.toContain("linear-gradient");
    // Hue-hairline hsla in box-shadow proves the ambient branch is hue-
    // derived rather than the hue-null fallback.
    expect(rawStyle).toContain("hsla(210, 60%, 55%, 0.08)");
    // Ambient background carries the 0.16 alpha stop.
    expect(rawStyle).toMatch(/background:[^;]*0\.16/);
    // NO backdrop-filter (or explicitly "none"). jsdom normalizes the
    // property name to `backdrop-filter` in the raw style string.
    expect(rawStyle.replace(/\s/g, "")).toMatch(
      /backdrop-filter:none|backdropfilter:none/i,
    );
    // NO 8px+ drop shadow (patch #136 signature was "0 8px 24px …").
    expect(rawStyle).not.toContain("0 8px 24px");
  });

  it("Test 18b: RDP row is EXEMPT from ambient — inActiveSet=false still uses neutral bubble treatment (not ambient)", () => {
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
    const rawStyle = body.getAttribute("style") ?? "";
    // Neutral RDP full-bubble treatment retained — the 60,65,80 stop
    // is the patch #136 baseline for RDP rows. jsdom's CSSOM adds a
    // space between rgba components ("rgba(60, 65, 80, …)").
    expect(rawStyle).toMatch(/rgba\(60,\s*65,\s*80/);
    // Full-bubble drop shadow signature — proves RDP did NOT go ambient.
    expect(rawStyle).toContain("0 8px 24px");
  });
});
