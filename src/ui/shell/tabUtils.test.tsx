/**
 * Phase 90 Plan 07 Task 2 — tabUtils.tsx dispatcher widening tests.
 *
 * The existing `TerminalOrIdentitySessionPane` dispatcher (in tabUtils.tsx)
 * has two branches: identity-pane vs plain terminal. This plan adds a THIRD
 * branch placed FIRST (most-specific discriminator wins): if
 * `tab.sessionKind === "relay-room"` AND `tab.relayRoomId` is set, mount
 * <RelayRoomSessionPane>. If sessionKind is 'relay-room' but relayRoomId is
 * missing, log-and-fall-through (defense against inconsistent tab-open sites).
 *
 * Behaviors:
 *   1. sessionKind harness (or undefined) + identityKey present → mounts
 *      IdentitySessionPane (regression gate).
 *   2. sessionKind harness (or undefined) + no identityKey → mounts
 *      TerminalTabContent (regression gate).
 *   3. sessionKind relay-room + relayRoomId set → mounts RelayRoomSessionPane.
 *   4. sessionKind relay-room + relayRoomId MISSING → console.warn
 *      "relay-room tab missing relayRoomId" and falls through to the existing
 *      dispatcher (no crash).
 *   5. (implicit via Tests 1-4) — no regression on the existing branches.
 *   6. Source order — the new branch is placed BEFORE the identity-pane
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

vi.mock("./RelayRoomSessionPane", () => ({
  RelayRoomSessionPane: (props: {
    roomId: string;
    roomTitle: string | null;
    isVisible: boolean;
  }) => (
    <div
      data-testid="mock-relay-room-session-pane"
      data-room-id={props.roomId}
      data-room-title={props.roomTitle ?? ""}
      data-visible={String(props.isVisible)}
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
// that clearly ISN'T RelayRoomSessionPane or IdentitySessionPane. Mock @/features/terminal/Terminal.
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
    expect(screen.queryByTestId("mock-relay-room-session-pane")).toBeNull();
    expect(screen.queryByTestId("mock-terminal-tab-content")).toBeNull();
  });

  it("Test 1b (regression, undefined sessionKind = harness backward-compat): identityKey present → IdentitySessionPane", async () => {
    const tab = makeTab({
      // sessionKind omitted (undefined)
      targetTmuxSession: "tina",
    });
    render(<>{renderTabContent(tab)}</>);
    expect(await screen.findByTestId("mock-identity-session-pane")).not.toBeNull();
    expect(screen.queryByTestId("mock-relay-room-session-pane")).toBeNull();
  });

  it("Test 2 (regression): sessionKind harness + no matching identityKey → TerminalTabContent", async () => {
    const tab = makeTab({
      sessionKind: "harness",
      targetTmuxSession: "other-session", // NOT in mock identities map
    });
    render(<>{renderTabContent(tab)}</>);
    expect(await screen.findByTestId("mock-terminal-tab-content")).not.toBeNull();
    expect(screen.queryByTestId("mock-identity-session-pane")).toBeNull();
    expect(screen.queryByTestId("mock-relay-room-session-pane")).toBeNull();
  });

  it("Test 3 (NEW): sessionKind relay-room + relayRoomId set → RelayRoomSessionPane", async () => {
    const tab = makeTab({
      sessionKind: "relay-room",
      relayRoomId: "!abc:matrix.example",
      relayRoomTitle: "Design room",
      // targetTmuxSession left null — relay-room tabs have no tmux.
      targetTmuxSession: null,
    });
    render(<>{renderTabContent(tab, undefined, undefined, undefined, /* isVisible */ true)}</>);
    const pane = await screen.findByTestId("mock-relay-room-session-pane");
    expect(pane).not.toBeNull();
    expect(pane.getAttribute("data-room-id")).toBe("!abc:matrix.example");
    expect(pane.getAttribute("data-room-title")).toBe("Design room");
    expect(pane.getAttribute("data-visible")).toBe("true");
    // Neither of the existing branches fired.
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
    // Fall-through: no RelayRoomSessionPane; existing dispatcher rendered.
    expect(screen.queryByTestId("mock-relay-room-session-pane")).toBeNull();
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
});
