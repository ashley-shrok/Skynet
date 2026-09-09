/**
 * Phase 93 Slice 4 — tabUtils.tsx dispatcher rewire tests (D-04, D-06, D-21).
 *
 * The dispatcher retires the standalone relay-room pane and routes
 * relay-room tabs to the shared chat surface `PrettyView` with a relay-kind
 * source prop (D-04). The renderTabContent case "terminal" early-return
 * that gated the pre-Slice-4 inline relay-room mount ahead of the
 * host-null gate retires (D-06); host-null handling moves inside
 * TerminalOrIdentitySessionPane's relay branch, and the case "terminal"
 * host-null gate widens with a `!== "relay-room"` exception.
 *
 * Behaviors:
 *   1. sessionKind harness (or undefined) + identityKey present → mounts
 *      IdentitySessionPane (regression gate).
 *   2. sessionKind harness (or undefined) + no identityKey → mounts
 *      TerminalTabContent (regression gate).
 *   3. sessionKind relay-room + relayRoomId set → mounts PrettyView with
 *      source.kind === "relay".
 *   4. sessionKind relay-room + relayRoomId MISSING → console.warn
 *      "relay-room tab missing relayRoomId" and falls through to the existing
 *      dispatcher (no crash).
 *   5. (implicit via Tests 1-4) — no regression on the existing branches.
 *   6. Source order — the relay-room branch appears BEFORE the identity-pane
 *      branch in tabUtils.tsx (verified via a text grep of the impl file).
 *
 * Mocks: each of the three inner components is replaced with a
 * data-testid-emitting double so branch selection can be asserted directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { promises as fs } from "node:fs";
import * as path from "node:path";

// ── Mocks: swap the three inner components with data-testid doubles ─────────

// Phase 93 Slice 4 (D-04): relay-room tabs now route to PrettyView with a
// relay-kind source. Mock exposes source.kind + roomId + isVisible so the
// dispatch-target assertions can inspect what tabUtils passed through.
vi.mock("@/features/pretty-view/PrettyView", () => ({
  PrettyView: (props: {
    source?: { kind?: string; roomId?: string; roomTitle?: string | null };
    isVisible?: boolean;
  }) => (
    <div
      data-testid="mock-pretty-view"
      data-source-kind={props.source?.kind ?? "none"}
      data-room-id={props.source?.roomId ?? ""}
      data-room-title={props.source?.roomTitle ?? ""}
      data-visible={String(props.isVisible ?? false)}
    />
  ),
}));

vi.mock("./IdentitySessionPane", () => ({
  IdentitySessionPane: () => (
    <div data-testid="mock-identity-session-pane" />
  ),
}));

// TerminalTabContent lives INSIDE tabUtils.tsx (not a separate module), so we
// mock the Terminal feature it composes; the test just needs to see something
// that clearly ISN'T PrettyView or IdentitySessionPane. Mock @/features/terminal/Terminal.
vi.mock("@/features/terminal/Terminal", () => ({
  Terminal: () => <div data-testid="mock-terminal-tab-content" />,
}));

// Provide inert stubs for tabUtils' misc transitive deps.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@/features/pretty-view/PrettyLandingCard", () => ({
  PrettyLandingCard: () => <div data-testid="mock-pretty-landing-card" />,
}));

vi.mock("@/features/guacamole/GuacamoleApp", () => ({
  default: () => <div data-testid="mock-guacamole-app" />,
}));

vi.mock("@/shell/TabContext", () => ({
  useTabsSafe: () => ({ previewTerminalTheme: null }),
}));

vi.mock("@/features/terminal/command-history/CommandHistoryContext", () => ({
  CommandHistoryProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useCommandHistory: () => ({ history: [], addCommand: () => {} }),
}));

// The identity-branch gate reads useIdentities().byKey — mock returns a Map
// with a single identity, so a targetTmuxSession that resolves to that key
// gets routed to IdentitySessionPane (Test 1). Test 2 uses a tmux name that
// does NOT resolve to any registered identity so the branch falls to the
// TerminalTabContent leg.
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map([["tina", { identityKey: "tina", displayName: "Tina" }]]),
    identities: [],
    loaded: true,
    refresh: () => {},
  }),
}));

// session-hue.sessionMatchKey: return the tmux name lowercased (matches the
// PrettyConversationsPanel test convention at L51). "tina" → "tina" resolves
// against the mock identities map; "other-session" → "other-session" does not.
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) =>
    name ? name.toLowerCase() : null,
  hueFromSessionName: () => null,
}));

// ── Component under test ────────────────────────────────────────────────────
import { renderTabContent } from "./tabUtils";
import type { Tab, Host } from "@/types/ui-types";

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: "1",
    name: "hostA",
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

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    instanceId: "inst-1",
    type: "terminal",
    label: "session",
    host: makeHost(),
    openedAt: 1,
    ...overrides,
  };
}

describe("tabUtils dispatcher: relay-room third branch", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("Test 1 (regression): sessionKind harness + identityKey present → IdentitySessionPane", async () => {
    const tab = makeTab({
      sessionKind: "harness",
      targetTmuxSession: "tina", // resolves against mock identities
    });
    render(<>{renderTabContent(tab)}</>);
    // Panes are lazy-loaded (post-2026-09-08 perf work) — await Suspense resolve.
    expect(await screen.findByTestId("mock-identity-session-pane")).not.toBeNull();
    expect(screen.queryByTestId("mock-pretty-view")).toBeNull();
    expect(screen.queryByTestId("mock-terminal-tab-content")).toBeNull();
  });

  it("Test 1b (regression, undefined sessionKind = harness backward-compat): identityKey present → IdentitySessionPane", async () => {
    const tab = makeTab({
      // sessionKind omitted (undefined)
      targetTmuxSession: "tina",
    });
    render(<>{renderTabContent(tab)}</>);
    expect(await screen.findByTestId("mock-identity-session-pane")).not.toBeNull();
    expect(screen.queryByTestId("mock-pretty-view")).toBeNull();
  });

  it("Test 2 (regression): sessionKind harness + no matching identityKey → TerminalTabContent", async () => {
    const tab = makeTab({
      sessionKind: "harness",
      targetTmuxSession: "other-session", // NOT in mock identities map
    });
    render(<>{renderTabContent(tab)}</>);
    expect(await screen.findByTestId("mock-terminal-tab-content")).not.toBeNull();
    expect(screen.queryByTestId("mock-identity-session-pane")).toBeNull();
    expect(screen.queryByTestId("mock-pretty-view")).toBeNull();
  });

  it("Test 3 (Slice 4 rewire, D-04): sessionKind relay-room + relayRoomId set → PrettyView with source.kind === 'relay'", async () => {
    const tab = makeTab({
      sessionKind: "relay-room",
      relayRoomId: "!abc:matrix.example",
      relayRoomTitle: "Design room",
      // targetTmuxSession left null — relay-room tabs have no tmux.
      targetTmuxSession: null,
    });
    render(<>{renderTabContent(tab, undefined, undefined, undefined, /* isVisible */ true)}</>);
    const pv = await screen.findByTestId("mock-pretty-view");
    expect(pv).not.toBeNull();
    expect(pv.getAttribute("data-source-kind")).toBe("relay");
    expect(pv.getAttribute("data-room-id")).toBe("!abc:matrix.example");
    expect(pv.getAttribute("data-room-title")).toBe("Design room");
    expect(pv.getAttribute("data-visible")).toBe("true");
    // Neither of the existing branches fired.
    expect(screen.queryByTestId("mock-identity-session-pane")).toBeNull();
    expect(screen.queryByTestId("mock-terminal-tab-content")).toBeNull();
  });

  it("Test 3b (Slice 4, D-06): relay-room tab with host: null still routes to PrettyView (not the 'no host selected' EmptyState)", async () => {
    const tab = makeTab({
      sessionKind: "relay-room",
      relayRoomId: "!room:x",
      relayRoomTitle: null,
      targetTmuxSession: null,
      host: undefined, // relay-room tabs have no fleet host
    });
    render(<>{renderTabContent(tab, undefined, undefined, undefined, /* isVisible */ true)}</>);
    const pv = await screen.findByTestId("mock-pretty-view");
    expect(pv).not.toBeNull();
    expect(pv.getAttribute("data-source-kind")).toBe("relay");
    expect(pv.getAttribute("data-room-id")).toBe("!room:x");
  });

  it("Test 3c (Slice 4 regression floor, D-06): non-relay terminal tab with host: null still returns 'no host selected' EmptyState", () => {
    const tab = makeTab({
      // sessionKind omitted / harness — this is a normal terminal tab
      targetTmuxSession: "other-session",
      host: undefined,
    });
    render(<>{renderTabContent(tab)}</>);
    // Empty state renders (via translation-key text); no pane mounts.
    expect(screen.queryByTestId("mock-pretty-view")).toBeNull();
    expect(screen.queryByTestId("mock-identity-session-pane")).toBeNull();
    expect(screen.queryByTestId("mock-terminal-tab-content")).toBeNull();
  });

  it("Test 4 (defensive): sessionKind relay-room + relayRoomId MISSING → console.warn + fall through, no crash", async () => {
    const tab = makeTab({
      sessionKind: "relay-room",
      // relayRoomId omitted — defensive path.
      targetTmuxSession: "other-session", // will fall through to TerminalTabContent
    });
    render(<>{renderTabContent(tab)}</>);
    // Warn fired with the exact message + tabId payload.
    const matching = warnSpy.mock.calls.find((call) => {
      const [msg, payload] = call;
      return (
        msg === "relay-room tab missing relayRoomId" &&
        payload &&
        typeof payload === "object" &&
        (payload as { tabId?: string }).tabId === "tab-1"
      );
    });
    expect(matching).toBeDefined();
    // Fall-through: no PrettyView (relay branch bailed); existing dispatcher rendered.
    expect(screen.queryByTestId("mock-pretty-view")).toBeNull();
    expect(await screen.findByTestId("mock-terminal-tab-content")).not.toBeNull();
  });

  it("Test 6 (source order): the relay-room branch appears BEFORE the identity-pane branch in tabUtils.tsx", async () => {
    const filePath = path.resolve(
      process.cwd(),
      "src/ui/shell/tabUtils.tsx",
    );
    const source = await fs.readFile(filePath, "utf8");
    const relayIdx = source.indexOf('sessionKind === "relay-room"');
    const identityIdx = source.indexOf("isIdentityPane");
    expect(relayIdx).toBeGreaterThanOrEqual(0);
    expect(identityIdx).toBeGreaterThanOrEqual(0);
    // Most-specific discriminator wins: relay-room branch must come FIRST
    // (lower line number ↔ smaller string index in a monotonically-scanned
    // file). Guards against a future refactor that reorders branches.
    expect(relayIdx).toBeLessThan(identityIdx);
  });

  it("Test 7 (Slice 4 dispatcher discipline): tabUtils.tsx contains PrettyView import + mount, no retired-pane refs", async () => {
    const filePath = path.resolve(
      process.cwd(),
      "src/ui/shell/tabUtils.tsx",
    );
    const source = await fs.readFile(filePath, "utf8");
    // Direct import of PrettyView (Slice 4 rewire).
    expect(source).toContain('from "@/features/pretty-view/PrettyView"');
    // Relay branch mounts PrettyView with source.kind === "relay".
    expect(source).toMatch(/kind:\s*"relay"/);
    // Retired pane — no lazy import, no JSX mount. Comment references
    // documenting the swap are allowed (they explain the retirement).
    expect(source).not.toMatch(/import\("@\/shell\/RelayRoomSession[Pp]ane/);
    expect(source).not.toMatch(/<RelayRoomSession[Pp]ane\b/);
    // Case "terminal" host-null gate now widens with a `!== "relay-room"` exception (D-06).
    expect(source).toMatch(/!host\s*&&\s*tab\.sessionKind\s*!==\s*"relay-room"/);
  });
});
