// ─── PrettyConversationRow — Clone menu item coverage (Phase 22 SRIC-03) ─────
// Companion test file to PrettyConversationRow.test.tsx covering the new
// Clone entry in the context-menu items[] builder.
//
// Behavior spec (Tests 13-15 from 22-03-PLAN.md):
//   Test 13: onClone provided AND row.host !== null AND identity resolved
//     from row.targetTmuxSession → items[] builder emits a Clone entry
//     (label "Clone", onClick fires onClone).
//   Test 14: onClone NOT provided → no Clone entry in items[].
//   Test 15: onClone provided but row has no identity (sessionMatchKey → null
//     OR useIdentities().byKey.get() returns undefined) → no Clone entry.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import type { Host } from "@/types/ui-types";

// ─── Mocks (mirror PrettyConversationRow.test.tsx pattern) ──────────────────

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

function makeIdentity(name = "nelly"): Identity {
  // Phase 68: Identity no longer has id/createdAt/updatedAt.
  return {
    identityKey: name.toLowerCase(),
    displayName: name,
    title: "Test Op",
    colorHue: 30,
    voice: "Elena.wav",
    role: null,
    avatarMime: "image/png",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentIdentity = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: Clone menu item", () => {
  it("Test 13: onClone provided + row.host !== null + identity resolved → Clone menu item present + onClick fires onClone", () => {
    currentIdentity = makeIdentity("nelly");
    const onClone = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onClone={onClone}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    // Trigger the context menu
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    // Clone item should be present in the portal-mounted menu
    const cloneItem = screen.getByRole("menuitem", { name: /clone/i });
    expect(cloneItem).toBeTruthy();

    // Click Clone → onClone fires
    fireEvent.click(cloneItem);
    expect(onClone).toHaveBeenCalledTimes(1);
  });

  it("Test 14: onClone NOT provided → no Clone menu item", () => {
    currentIdentity = makeIdentity("nelly");
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        // no onClone
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    expect(screen.queryByRole("menuitem", { name: /clone/i })).toBeNull();
  });

  it("Test 15: onClone provided but row has no identity → no Clone menu item", () => {
    // currentIdentity stays null → useIdentities().byKey.get() returns undefined
    currentIdentity = null;
    const onClone = vi.fn();
    const { container } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onClone={onClone}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    expect(screen.queryByRole("menuitem", { name: /clone/i })).toBeNull();
    expect(onClone).not.toHaveBeenCalled();
  });
});
