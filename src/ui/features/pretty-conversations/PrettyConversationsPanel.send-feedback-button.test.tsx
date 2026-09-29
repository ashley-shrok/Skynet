// ─── PrettyConversationsPanel — "Send feedback" CTA coverage
// The Send feedback affordance lives as a full-width shadcn <Button>
// docked just above the sidebar footer (migrated out of the header).
//
// Four cases:
//   (a) Button renders when useFeedbackEnabled() is true, with the
//       shadcn Button chrome + "Send feedback" text.
//   (b) Button is ABSENT from the DOM (not disabled, not hidden-via-CSS)
//       when useFeedbackEnabled() returns false.
//   (c) Clicking the button fires onOpenFeedback exactly once.
//   (d) Independent-gate assertion: render WITHOUT onCreateSession;
//       assert the header showPencilButton siblings are absent AND the
//       feedback CTA is present — the CTA is gated on feedbackEnabled
//       alone, not on onCreateSession.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
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
  // Phase 92 Plan 04: panel hydrate effect imports deriveDiskPinnedIds.
  // (Phase 115 Plan 115-02: sibling deriveDiskHiddenIds retired per D-21.)
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
}));

// Phase 104 Plan 02 — trapped-work-store (inert stub — panel mounts poller)
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: [],
    pinned: [],
    middle: [],
    rdpGroup: null,
    // Phase 117 Plan 117-08 — additive derived-selector fields.
    pinnedUnassigned: [],
    projectSections: [],
    rdp: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  // Phase 92 Plan 04: panel hydrate reads fleet snapshot to build identityHosts.
  getFleetSessionsSnapshot: () => [],
  selectConversation: () => {},
  pinConversation: () => {},
  unpinConversation: () => {},
  addToActiveSet: () => {},
  removeFromActiveSet: () => {},
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: () => {},
  // Phase 117 Plan 117-08 — useProjects subscription (empty).
  useProjects: () => [],
}));

// Phase 117 Plan 117-08 — collapse hook + drop API stubs.
vi.mock("@/state/use-collapsed-project-slugs", () => ({
  useCollapsedProjectSlugs: () => ({
    collapsed: new Set<string>() as ReadonlySet<string>,
    toggle: () => {},
  }),
}));
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: vi.fn(async () => ({ ok: true })),
  setRelayRoomProject: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/api/user-preferences-api", () => ({
  // Phase 92 Plan 04: getPinnedIds retired.
  // (Phase 115 Plan 115-02: putHiddenIds retired per D-21.)
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
}));

// Phase 137 D-29: GlobalFilesModal retired — mock removed.

// Phase 90 Plan 90-06: mock SkillsEditorModal + RoleModal + RunbookEditorModal
// so the panel mounts them as stubs.
vi.mock("@/features/pretty-view/SkillsEditorModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="skills-editor-modal-stub" /> : null,
}));
vi.mock("@/features/pretty-view/RolesListModal", () => ({
  RolesListModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="roles-list-modal-stub" /> : null,
}));
vi.mock("@/features/pretty-view/RoleModal", () => ({
  RoleModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="role-modal-stub" /> : null,
}));
vi.mock("@/features/pretty-view/RunbookEditorModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="runbook-editor-modal-stub" /> : null,
}));

// Mock the identities API listRolesForHost so RolesListModal renders without a
// backend call.
vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listRolesForHost: vi.fn().mockResolvedValue([]),
    roleAvatarUrl: (hostId: number, roleName: string) =>
      `/roles/${roleName}/avatar?hostId=${hostId}`,
  };
});

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

// Phase 123 shape 2 (PATTERNS.md "Mock preamble pattern"): mock the
// feedback-store useFeedbackEnabled hook. Default is false so
// "absent-when-disabled" is the safe default for any test that forgets
// to override; individual tests override with vi.mocked(useFeedbackEnabled)
// .mockReturnValue(true).
vi.mock("@/feedback/feedback-store", () => ({
  useFeedbackEnabled: vi.fn(() => false),
}));

// ─── Component under test (import AFTER mocks) ──────────────────────────────

import { PrettyConversationsPanel } from "./PrettyConversationsPanel";
import { useFeedbackEnabled } from "@/feedback/feedback-store";

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

const ONE_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("h1", "hostA")],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the useFeedbackEnabled mock to the safe default (false) between
  // tests. Individual tests override with mockReturnValue(true) where needed.
  vi.mocked(useFeedbackEnabled).mockReturnValue(false);
});

describe("PrettyConversationsPanel: Send feedback CTA (above-footer, feedbackEnabled-gated)", () => {
  it("Test 1: pv-footer-send-feedback-button exists with correct chrome when feedback is enabled", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
        onOpenFeedback={vi.fn()}
      />,
    );

    const btn = screen.getByTestId("pv-footer-send-feedback-button");
    expect(btn).toBeTruthy();
    // Shadcn <Button> emits data-slot="button"; that's the stable
    // "this is a design-system Button" marker.
    expect(btn.getAttribute("data-slot")).toBe("button");
    // Native <button type="button"> under the hood.
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    // Full-width in the .pv-feedback-slot wrapper.
    expect(btn.className).toContain("w-full");
    // Visible label — literal "Send feedback" text renders inside the button.
    expect(btn.textContent).toContain("Send feedback");
  });

  it("Test 2: pv-footer-send-feedback-button absent from DOM when useFeedbackEnabled() returns false — NOT disabled, NOT hidden-via-CSS", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(false);
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
        onOpenFeedback={vi.fn()}
      />,
    );
    // The button is ABSENT — not disabled, not hidden-via-CSS.
    // queryByTestId returns null when the element is not in the DOM at all.
    expect(screen.queryByTestId("pv-footer-send-feedback-button")).toBeNull();
  });

  it("Test 3: clicking pv-footer-send-feedback-button fires onOpenFeedback exactly once", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onOpenFeedback = vi.fn();
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
        onOpenFeedback={onOpenFeedback}
      />,
    );
    fireEvent.click(screen.getByTestId("pv-footer-send-feedback-button"));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
    // No-arg callback — variant is hardcoded to "general" inside AppShell's
    // setter closure.
    expect(onOpenFeedback).toHaveBeenCalledWith();
  });

  it("Test 4: pv-footer-send-feedback-button renders even when onCreateSession is undefined — gate is independent of showPencilButton", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    render(
      <PrettyConversationsPanel
        variant="desktop"
        // onCreateSession INTENTIONALLY OMITTED — the showPencilButton
        // siblings hide because showPencilButton === false. The feedback
        // CTA must still render because its gate is `feedbackEnabled`
        // INDEPENDENTLY.
        onDeactivateRow={() => {}}
        onOpenFeedback={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("pv-header-new-agent-button")).toBeNull();
    expect(screen.queryByTestId("pv-header-create-project-button")).toBeNull();
    expect(screen.queryByTestId("pv-header-edit-roles-button")).toBeNull();
    expect(screen.queryByTestId("pv-header-menu-button")).toBeNull();
    // …but the CTA IS present because its gate is independent.
    expect(screen.getByTestId("pv-footer-send-feedback-button")).toBeTruthy();
  });
});
