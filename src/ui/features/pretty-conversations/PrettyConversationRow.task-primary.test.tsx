// ─── PrettyConversationRow — task-primary body swap coverage ─────────────────
// Phase 80 Plan 08 (Ashley 2026-09-06 shape-locked) — the `.pv-body` markup is
// now a gated ternary on `identity?.task`. When truthy → task-primary display:
// top line = identity.task alone (reuses .pv-label), subtitle = role prominent
// via <strong> + (displayName) muted via existing .pv-hostname-suffix class.
// The aiTitle drops entirely from the task-primary branch (Ashley greenlit the
// drop per 80-CONTEXT specifics §last bullet — "do NOT quietly preserve it").
//
// When identity?.task is null OR empty string → fallback branch preserves the
// pre-Phase-80 markup verbatim (D-06). Regression guarded by the existing
// PrettyConversationRow.test.tsx (96 tests) — all continue passing after the
// swap because the else-branch is byte-parity with pre-edit source.
//
// This file is a NEW sibling test file rather than an extension so the diff
// boundary between plans 80-08 and the pre-Phase-80 test surface stays clean.
// Fixture pattern lifted from PrettyConversationRow.test.tsx lines 68-206
// verbatim: mock react-i18next / session-hue / identities-store / bounty-counts
// / use-is-touch-device, per-test currentIdentity override handle.
//
// Coverage (6 required + 1 extra `long task string` guard for T-80-08-02):
//   1. task truthy → top line = task; subtitle contains role + (displayName);
//      aiTitle text absent.
//   2. task = null → fallback markup (name-primary + aiTitle subtitle).
//   3. task = "" (empty string) → fallback (task-primary requires truthy).
//   4. Role wrapped in <strong> in task-primary branch.
//   5. .pv-hostname-suffix span present in task-primary subtitle (muted parens).
//   6. identity=undefined → fallback renders row.label.
//   7. Long task string (T-80-08-02 mitigation guard) — .pv-label class already
//      handles fade-truncation; assertion that the row still renders without
//      throwing and the task text appears in the .pv-label span.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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
// mocked useIdentities().byKey resolves for the fixture row. Set to null to
// simulate an unresolved identity (row.label fallback path).
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

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => undefined,
}));

// Phase 104 Plan 02 — trapped-work-store (inert stub — row imports the hook)
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
}));

import { PrettyConversationRow } from "./PrettyConversationRow";

// ─── Fixture helpers (mirror PrettyConversationRow.test.tsx) ─────────────────

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
    label: "willow",
    host: makeHost(),
    targetTmuxSession: "willow",
    ...overrides,
  };
}

function makeIdentityWithTask(overrides: Partial<Identity> = {}): Identity {
  return {
    identityKey: "willow",
    displayName: "Willow",
    title: null,
    colorHue: 210,
    voice: null,
    role: "skynet-maintainer",
    avatarMime: "image/png",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
    task: "build the pool endpoint",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentIdentity = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// TP1 — task truthy → task-primary render (task on top, role + name subtitle,
//       aiTitle text absent).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: task-primary body render (Phase 80 Plan 08)", () => {
  it("TP1: identity.task truthy → top line = task; subtitle contains role + (displayName); aiTitle text absent", () => {
    currentIdentity = makeIdentityWithTask({
      task: "build the pool endpoint",
      role: "skynet-maintainer",
      displayName: "Willow",
    });
    const { container, queryByText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle="Should not appear in task-primary branch"
      />,
    );

    // Top line: .pv-label carries the task string alone (no hostname suffix).
    const label = container.querySelector(".pv-label") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.textContent?.trim()).toBe("build the pool endpoint");

    // Subtitle: .pv-ai-title span (reused per D-03) carries role + parens.
    const subtitle = container.querySelector(".pv-ai-title") as HTMLElement | null;
    expect(subtitle).toBeTruthy();
    expect(subtitle!.textContent).toContain("skynet-maintainer");
    expect(subtitle!.textContent).toContain("(Willow)");

    // aiTitle text MUST NOT appear anywhere — the task-primary branch drops
    // the AI-generated conversation summary entirely.
    expect(
      queryByText("Should not appear in task-primary branch"),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP2 — task = null → fallback markup preserved (D-06 regression guard).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: fallback when task is null (D-06)", () => {
  it("TP2: identity.task=null → fallback renders identity.displayName as prefix and aiTitle in the subtitle span", () => {
    currentIdentity = makeIdentityWithTask({
      task: null,
      displayName: "Willow",
      title: null,
    });
    const { container, queryByText } = render(
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

    // Fallback top line: displayName + hostname suffix (per pre-Phase-80).
    const label = container.querySelector(".pv-label") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain("Willow");

    // aiTitle text is present in the subtitle (fallback branch preserves it).
    expect(queryByText("Fix bug X")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP3 — task = "" (empty string) → falsy, falls back (task-primary requires truthy).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: fallback when task is empty string (D-06)", () => {
  it("TP3: identity.task='' → fallback branch (empty string is falsy; task-primary requires truthy)", () => {
    currentIdentity = makeIdentityWithTask({
      task: "" as unknown as string | null,
      displayName: "Willow",
    });
    const { container, queryByText } = render(
      <PrettyConversationRow
        row={makeRow()}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle="AI summary here"
      />,
    );

    // Fallback: displayName in .pv-label prefix, aiTitle text present.
    const label = container.querySelector(".pv-label") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain("Willow");
    expect(queryByText("AI summary here")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP4 — role wrapped in <strong> in the task-primary branch.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: role prominence in task-primary subtitle", () => {
  it("TP4: task-primary subtitle wraps identity.role inside a <strong> tag", () => {
    currentIdentity = makeIdentityWithTask({
      task: "ship the pill",
      role: "skynet-maintainer",
    });
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

    // Locate <strong> and confirm it holds the role text.
    const subtitle = container.querySelector(".pv-ai-title") as HTMLElement;
    const strong = subtitle.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong!.tagName).toBe("STRONG");
    expect(strong!.textContent).toBe("skynet-maintainer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP5 — .pv-hostname-suffix span present in task-primary subtitle (muted parens).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: task-primary subtitle uses .pv-hostname-suffix for muted parens", () => {
  it("TP5: task-primary subtitle contains a .pv-hostname-suffix span holding (displayName)", () => {
    currentIdentity = makeIdentityWithTask({
      task: "wire the modal",
      role: "skynet-maintainer",
      displayName: "Willow",
    });
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

    const subtitle = container.querySelector(".pv-ai-title") as HTMLElement;
    const suffix = subtitle.querySelector(".pv-hostname-suffix") as HTMLElement;
    expect(suffix).toBeTruthy();
    // Verbatim text content: "(Willow)"
    expect(suffix.textContent).toBe("(Willow)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP6 — identity undefined → fallback renders row.label (D-06 safety net).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: fallback when identity is undefined", () => {
  it("TP6: no identity resolved → .pv-label contains row.label (existing behavior preserved)", () => {
    // currentIdentity remains null (reset in beforeEach), so useIdentities
    // returns an empty byKey Map → identity resolution yields null → falsy →
    // fallback branch renders row.label as the prefix.
    const { container } = render(
      <PrettyConversationRow
        row={makeRow({ label: "unresolved-session", targetTmuxSession: "nobody" })}
        selected={false}
        pinned={false}
        variant="desktop"
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        aiTitle={null}
      />,
    );
    const label = container.querySelector(".pv-label") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain("unresolved-session");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TP7 — Long task string mitigation guard (T-80-08-02): reused .pv-label class
//       handles fade-truncation. Row renders without throwing and the task
//       text is inside the .pv-label span.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationRow: long task string reuses .pv-label fade-truncation (T-80-08-02)", () => {
  it("TP7: a 400-character task string renders inside .pv-label without throwing", () => {
    const longTask = "x".repeat(400);
    currentIdentity = makeIdentityWithTask({ task: longTask });
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
    const label = container.querySelector(".pv-label") as HTMLElement | null;
    expect(label).toBeTruthy();
    expect(label!.textContent).toBe(longTask);
  });
});
