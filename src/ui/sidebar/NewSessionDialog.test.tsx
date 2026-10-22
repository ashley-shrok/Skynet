// ─── NewSessionDialog — Vitest coverage ──────────────────────────────────────
// Tests 2-9 cover the modal from Plan 06-04 Task 2. Test 10 (a "start-a-new-
// session" affordance appears before conversation rows in DOM order)
// originally targeted ConversationsPanel + NewSessionButton; Phase 10 Wave 3
// retargets it to PrettyConversationsPanel's compact pencil-icon header
// button. The Test-10 constraint (button precedes rows in document order)
// is preserved verbatim; only the target component + query change. Phase 10
// Wave 4 deleted the old NewSessionButton file + pruned Test 1 (its
// isolation test); the pencil-icon in PrettyConversationsPanel is trivial
// glue already covered by PrettyConversationsPanel.test.tsx Test 5.
//
// Fixtures: small in-test hostTree object (no getSSHHosts mock — the dialog
// receives hostTree as a prop). react-i18next is mocked to a passthrough
// t(key, {defaultValue}) — matches the fork's existing test idiom
// (PrettyView.test.tsx pattern: mock the dep, keep tests fast and hermetic).
//
// ─── Phase 86 (Plan 86-06 test-side alignment) ─────────────────────────────
// Plan 86-04 stripped cosmetic UI (title text input, brief textarea, voice
// picker, color picker, entire avatar generator + upload section) from the
// identity-mode branch of NewSessionDialog. This test file's cosmetic-
// specific coverage has been removed accordingly:
//
//   Test F: rewritten — asserts the current identity-mode field cluster
//     (Task textarea, Name input, Roles group) rather than the deleted
//     title/brief/voice/color/avatar UI.
//   Test G: rewritten — Create enables on name + role + host (no more
//     cosmetic gates).
//   Test L, M, N, O, P, Q: DELETED — the batch-generate call and the
//     candidate carousel are gone.
//   Test R: rewritten — the onCreate payload no longer carries title /
//     brief / voice / colorHue / avatarCandidateId (per Plan 86-04's
//     NewSessionOnCreateOpts identityMode:true variant).
//   Test T: DELETED — the brief field it targeted no longer exists.
//   Test U: rewritten — resets no longer include title/brief.
//   RTL-01, RTL-02, RTL-03: DELETED — manual avatar upload UI is gone.
//   fillIdentityFormAndPick helper: renamed to fillIdentityForm, no longer
//     touches title/brief/generate/pick — just fills name + role.
//
// 2026-09-14 (task-field removal): the "What will this agent work on?" textarea
// was removed from the dialog — birth sends a placeholder and the agent writes
// its real task into its own frontmatter on first wake.
//   Test F: now asserts the task field is ABSENT (was: present).
//   Test U: no longer fills or re-asserts task — that state is gone.
//
// 2026-10-18 (no host step for agents): agent mode lists every host's roles
// in one dropdown (sectioned by host) and the picked role decides the host;
// the host list only renders in the admin-only shell branch.
//   Tests 3, 4: the host list render/filter now run in shell mode.
//   Tests F-K, R, V, 106A-E, Phase 88 T3/T4: "click host alpha" became
//     "pick box-maintainer from alpha" (pickRoleFromAlpha below). The mock
//     answers one role per host; with three hosts nothing is preselected.
//
// PRESERVED (non-cosmetic identity-mode surface):
//   Tests A-D — path field + identity-mode checkbox.
//   Test E — asserts cosmetic controls are absent when identity-mode OFF
//     (they are absent in all modes now — the queryByLabelText checks still
//     hold trivially).
//   Test H, I, J, K — name field, collision precheck.
//   Test S — identity-mode OFF onCreate payload.
//   Tests V-GG — birth stream lifecycle (still runs; request body just
//     carries fewer fields).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

// apple-ux (shape-creation-and-search-dialogs, 2026-10-22): the admin-only
// "Just a shell — no agent" tick-box became an Agent / Shell segmented control
// (data-testid new-session-identity-mode; segments new-session-mode-agent /
// new-session-mode-shell). chooseShell() / chooseAgent() drive it. The
// "Choose a custom agent name" tick-box is gone: the Name field is always
// shown, pre-filled with the pool suggestion when there is one.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api for new identity-mode tests
const mockListIdentities = vi.fn().mockResolvedValue([]);
const mockGetIdentityExistsOnHost = vi.fn().mockResolvedValue(false);
const mockOpenBirthStream = vi.fn();
// Phase 22 SRIC-02: listRolesForHost is called for every pickable host when
// the dialog opens in agent mode. Default to a single role per host — on the
// three-host tree there are three copies, so tests pick alpha's
// (pickRoleFromAlpha). Shell-mode
// tests are unaffected because the fetch is skipped there.
const mockListRolesForHost = vi.fn().mockResolvedValue([
  { name: "box-maintainer", description: "" },
]);
// Phase 80 Plan 80-06 Task 2: NewSessionDialog fires pickPoolName on every
// role-change in identity-mode. Rejecting silently by default so this test
// file's flow (which does not exercise pool prefill) behaves as before — no
// name-field mutation from a pool prefill, no unhandled promise rejections
// eating render budget on the already-flaky Test G / Test R flow.
const mockPickPoolName = vi.fn().mockRejectedValue(
  new Error("pickPoolName not exercised in this test file"),
);

// Phase 86 Plan 86-04: the avatar batch/manual-upload API consumers +
// AvatarCandidate type were deleted from NewSessionDialog.tsx along with
// the cosmetic UI. Do NOT re-mock them here — Plan 86-06 owns the deletion
// of the tests that exercised them.
vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    listIdentities: (...args: unknown[]) => mockListIdentities(...args),
    getIdentityExistsOnHost: (...args: unknown[]) => mockGetIdentityExistsOnHost(...args),
    openBirthStream: (...args: unknown[]) => mockOpenBirthStream(...args),
    listRolesForHost: (...args: unknown[]) => mockListRolesForHost(...args),
    pickPoolName: (...args: unknown[]) => mockPickPoolName(...args),
  };
});

// Helper: create a mock birth stream that emits the given events then ends.
// Adds a 0ms Promise.resolve() between events so React has a chance to
// batch-flush and re-render intermediate states in test assertions.
async function* createMockStream(events: Array<{type: string; n?: number; phase?: string; reason?: string; ok?: boolean; failedStep?: number; identityId?: string; sessionName?: string}>) {
  for (const evt of events) {
    await Promise.resolve(); // let React flush state updates between events
    yield evt;
  }
}

// Phase 86 Plan 86-06: voice-api mock retained — the identity-birth cluster
// no longer renders a VoicePicker, but PrettyConversationsPanel (rendered by
// Test 10) transitively pulls in VoicePicker via IdentityBadge → IdentityChip
// → IdentityRow via the identities-store. Keeping the mock inert prevents an
// accidental real-fetch on Test 10's render tree.
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  postSpeak: vi.fn().mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" })),
  postSpeakStream: vi.fn(),
}));

// Test 10 renders PrettyConversationsPanel → PrettyConversationRow which
// pulls session-hue + identities + useIsTouchDevice. Stub them to inert
// defaults so the render is deterministic and doesn't drag in identity
// registry wiring or media-query state.
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: () => null,
  useSessionIdentity: () => ({ identity: null, identityHue: null }),
}));
// Phase 106 Plan 106-04 (D-18): mock `refreshOneIdentity` so we can assert
// the D-18 ordering invariant (refresh → onCreate → onClose) in
// the success-path test. `mockRefreshOneIdentity` is exposed at
// module scope so individual tests can inspect .mock.calls / invocationCallOrder.
const mockRefreshOneIdentity = vi.fn().mockResolvedValue(true);
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map() }),
  refreshOneIdentity: (...args: unknown[]) => mockRefreshOneIdentity(...args),
}));
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// Phase 137 D-29: GlobalFilesModal retired — mock removed.

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

import { NewSessionDialog } from "./NewSessionDialog";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import {
  queryRolesGroup,
  getRolesGroup,
  pickedRoleValues,
  toggleRole,
  chooseShell,
  chooseAgent,
  shellChosen,
  queryModeSwitch,
  roleGroupHeaders,
} from "./NewSessionDialog.roles-test-helpers";
// Phase 10 Wave 3: Test 10 retargeted from the retiring ConversationsPanel
// to the new PrettyConversationsPanel. Tests 2-9 in this file cover
// NewSessionDialog in isolation and are unaffected. Wave 4 pruned Test 1
// (NewSessionButton isolation) along with the deleted NewSessionButton file.
import { PrettyConversationsPanel } from "@/features/pretty-conversations/PrettyConversationsPanel";
import {
  updateHostTree,
  updateOpenTabs,
  selectConversation,
} from "@/state/conversation-store";
import type { Host, HostFolder, Tab } from "@/types/ui-types";

function makeHost(
  id: string,
  name: string,
  overrides: Partial<Host> = {},
): Host {
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
    // Can host agents — agent mode only offers such machines.
    canHostAgents: true,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  } as Host;
}

const threeHostTree: HostFolder = {
  name: "root",
  children: [
    {
      name: "folderA",
      children: [
        makeHost("h1", "alpha", { username: "root", ip: "10.0.0.1" }),
        makeHost("h2", "bravo", { username: "root", ip: "10.0.0.2" }),
      ],
    } as HostFolder,
    makeHost("h3", "charlie", { username: "root", ip: "10.0.0.3" }),
  ],
};

const oneHostTree: HostFolder = {
  name: "root",
  children: [makeHost("only", "sole-host")],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// Agent mode has no host step: the host is whichever one the picked role
// comes from. Every host in threeHostTree offers "box-maintainer", so pick
// alpha's (h1) copy, then close the modal dropdown so role-based queries for
// the Dialog's own buttons work again.
async function pickRoleFromAlpha() {
  await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
  toggleRole("box-maintainer", "h1");
  await waitFor(() => expect(pickedRoleValues()).toEqual(["h1/box-maintainer"]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: dialog close affordance closes without emitting onCreate
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: cancel", () => {
  it("Test 2b: the Cancel button in the foot calls onClose and does NOT call onCreate", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(
      <NewSessionDialog open onClose={onClose} hostTree={threeHostTree} onCreate={onCreate} />,
    );
    const cancel = screen.getByTestId("new-session-cancel");
    expect(cancel.textContent).toBe("Cancel");
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("Test 2: clicking Close calls onClose and does NOT call onCreate", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    const { getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={onCreate}
      />,
    );
    const closeBtn = getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: host list renders all hosts from tree (across folders)
// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-18: the host list only renders in the admin shell branch now.
describe("NewSessionDialog: host list render", () => {
  it("Test 3: shell mode renders all hosts across folders (flattened)", () => {
    const { getByText, getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />,
    );
    chooseShell();
    expect(getByText("alpha")).toBeTruthy();
    expect(getByText("bravo")).toBeTruthy();
    expect(getByText("charlie")).toBeTruthy();
  });

  it("Test 3a: agent mode (default) renders no host list or host search", () => {
    const { queryByLabelText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />,
    );
    expect(queryByLabelText(/search hosts/i)).toBeNull();
    // Machine names only appear as the roles list's group headings (shown
    // from the start, each with its "No roles"), never as a host picker.
    const outsideRoles = (name: string) =>
      screen.queryAllByText(name).filter((el) => !el.closest('[data-testid="role-pick-list"]'));
    expect(outsideRoles("alpha")).toEqual([]);
    expect(outsideRoles("bravo")).toEqual([]);
    expect(outsideRoles("charlie")).toEqual([]);
    expect(screen.queryByText(/pick a host/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: search input filters the host list
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: search filter", () => {
  it("Test 4: shell mode — typing filters the host list to matching entries", () => {
    const { getByLabelText, queryByText, getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />,
    );
    chooseShell();
    const searchInput = getByLabelText(/search hosts/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "alp" } });

    expect(queryByText("alpha")).toBeTruthy();
    expect(queryByText("bravo")).toBeNull();
    expect(queryByText("charlie")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: empty name is VALID; Open is enabled after host select; onCreate
//         receives sessionName: undefined (empty allowed → server auto-fills)
// Phase 20 Plan 05: identity-mode defaults ON; test turns it OFF to exercise
// the regular-session path. onCreate now includes {path, identityMode:false}.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: empty name accepted", () => {
  it("Test 5: empty name → Open enabled after host select → onCreate({host, sessionName: undefined})", () => {
    // Phase 88 (Plan 88-02 Edit C): checkbox is admin-gated; pass isAdmin={true}
    // so the checkbox renders. Click OPTS INTO shell mode (semantic-invert).
    const onCreate = vi.fn();
    const { getByRole, getByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
        isAdmin={true}
      />,
    );

    // Click checkbox to opt into shell mode (regular-session path)
    chooseShell();

    // Pre-select-host: Open is disabled
    let openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);

    // Select a host
    fireEvent.click(getByText("bravo"));

    // Now Open is enabled (empty name is valid)
    openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);

    fireEvent.click(openBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0][0];
    expect(arg.host.id).toBe("h2");
    // Empty name → undefined (server-side auto-fills from tmux window title)
    expect(arg.sessionName).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: non-empty valid name passes through to onCreate
// Phase 20 Plan 05: identity-mode defaults ON; test turns it OFF to exercise
// the regular-session path. onCreate now includes {path, identityMode:false}.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: non-empty name passthrough", () => {
  it("Test 6: valid name → onCreate({host, sessionName: 'my-session'})", () => {
    // Phase 88: checkbox is admin-gated. Click OPTS INTO shell mode.
    const onCreate = vi.fn();
    const { getByRole, getByText, getByLabelText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
        isAdmin={true}
      />,
    );

    // Click checkbox to opt into shell mode (regular-session path)
    chooseShell();

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/^name \(optional\)$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "my-session" } });

    const openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);
    fireEvent.click(openBtn);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0][0];
    expect(arg).toMatchObject({
      host: expect.objectContaining({ id: "h1", name: "alpha" }),
      sessionName: "my-session",
      identityMode: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: invalid characters disable Open and surface an error
// Phase 20 Plan 05: identity-mode defaults ON; test turns it OFF to exercise
// the regular session-name validation path (SESSION_NAME_PATTERN).
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: invalid name disables Open", () => {
  it("Test 7: name with shell-metachars disables Open + surfaces error message", () => {
    // Phase 88: checkbox is admin-gated. Click OPTS INTO shell mode.
    const onCreate = vi.fn();
    const { getByRole, getByText, getByLabelText, queryByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
        isAdmin={true}
      />,
    );
    // Click checkbox to opt into shell mode → reveals session-name input
    chooseShell();

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/^name \(optional\)$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "bad;name`chars" } });

    const openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);

    // Error message surfaced under the input
    expect(queryByText(/letters, numbers, underscores/i)).toBeTruthy();

    // Attempting to click has no effect
    fireEvent.click(openBtn);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: no host selected → Open disabled
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: no host disables Open", () => {
  it("Test 8: fresh dialog with no host selected → Open disabled", () => {
    const { getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />,
    );
    const openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: single-host tree auto-selects the sole host on open
// Phase 20 Plan 05: identity-mode defaults ON; test turns it OFF so that
// host auto-selection alone is sufficient to enable Open (regular-session path).
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: single-host auto-select", () => {
  it("Test 9: hostTree with exactly one host → that host is pre-selected + Open enabled + click fires onCreate with the sole host", () => {
    // Phase 88: checkbox is admin-gated. Click OPTS INTO shell mode (via
    // single-host auto-selection alone Open becomes enabled without name/role).
    const onCreate = vi.fn();
    const { getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={oneHostTree}
        onCreate={onCreate}
        isAdmin={true}
      />,
    );
    // Click checkbox to opt into shell mode
    chooseShell();

    // Open button should be enabled immediately (sole host pre-selected + no extra fields needed)
    const openBtn = getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(false);

    fireEvent.click(openBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].host.id).toBe("only");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: header pencil appears BEFORE conversation rows in DOM order
// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 Wave 3: retargeted from the retiring ConversationsPanel + full-
// width NewSessionButton pair to the new PrettyConversationsPanel's compact
// pencil-icon button in the header. Same underlying constraint: the "start a
// new session" affordance renders before conversation rows in DOM order (top-
// of-scroller mount, Plan 06-04 hard constraint per CONTEXT.md §Decisions
// §New-session button). Cheap smoke coverage against future panel-header
// refactors. Verified by rendering PrettyConversationsPanel with 2 populated
// conversations and asserting the pencil-button's DOM position precedes the
// first row's `[data-conversation-id]` element.
describe("PrettyConversationsPanel: header pencil renders before rows", () => {
  beforeEach(() => {
    // Reset the module-scoped conversation-store between renders so Test 10
    // is independent of Tests 1-9. (Tests 1-9 don't touch the store, but
    // this pins the invariant.)
    updateOpenTabs([]);
    selectConversation(null);
    updateHostTree(null);
  });

  it("Test 10: header pencil appears BEFORE conversation rows in DOM order (top-of-scroller mount)", () => {
    const hostA = makeHost("hA", "alpha", { username: "root", ip: "10.0.0.1" });
    const hostTree: HostFolder = { name: "root", children: [hostA] };
    const tab1: Tab = {
      id: "t1",
      instanceId: "t1",
      type: "terminal",
      label: "session-1",
      host: hostA,
      openedAt: 0,
      targetTmuxSession: null,
    };
    const tab2: Tab = {
      id: "t2",
      instanceId: "t2",
      type: "terminal",
      label: "session-2",
      host: hostA,
      openedAt: 0,
      targetTmuxSession: null,
    };

    updateHostTree(hostTree);
    updateOpenTabs([tab1, tab2]);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={hostTree}
        onCreateSession={vi.fn()}
      />,
    );

    // The header pencil is the only header-strip action; it must precede
    // conversation rows in document order.
    const button = container.querySelector(
      'button[data-testid="pv-header-new-agent-button"]',
    ) as HTMLElement | null;
    const row1 = container.querySelector(
      '[data-conversation-id="t1"]',
    ) as HTMLElement | null;
    const row2 = container.querySelector(
      '[data-conversation-id="t2"]',
    ) as HTMLElement | null;
    expect(button).toBeTruthy();
    expect(row1).toBeTruthy();
    expect(row2).toBeTruthy();

    // Walk all elements in document order; assert button's index precedes
    // the rows' indices. This is a stable positional check that survives
    // any future markup refactor as long as the parent-child relationship
    // (button before rows within the scroller) is preserved.
    const all = Array.from(container.querySelectorAll("*")) as HTMLElement[];
    const btnIdx = all.indexOf(button!);
    const row1Idx = all.indexOf(row1!);
    const row2Idx = all.indexOf(row2!);

    expect(btnIdx).toBeGreaterThanOrEqual(0);
    expect(row1Idx).toBeGreaterThan(btnIdx);
    expect(row2Idx).toBeGreaterThan(btnIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 Plan 05: Extended NewSessionDialog tests (Tests A-U)
// Identity-mode field cluster, path field, collision checks.
// Phase 86 Plan 86-04: cosmetic UI (title/brief/voice/color/avatar) stripped;
// only Task + Name + Role remain in the identity-mode cluster.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: render dialog with identity-mode capable component
// Phase 88 (Plan 88-03): the helper now accepts an `isAdmin?: boolean`
// override with a default of `true`. Most existing tests below were
// written when the Path input + identity-mode checkbox were universal
// (not admin-gated); keeping the helper's default at isAdmin=true
// preserves their assumptions without churn. Tests that specifically
// exercise the non-admin path pass `isAdmin: false` explicitly (see
// the three new tests at the bottom of this file — Plan 88-03 Task 2
// Edit F: T1 hides both, T2 renders both defaults, T3 wire contract).
function renderDialog(overrides: {
  open?: boolean;
  onClose?: () => void;
  onCreate?: ReturnType<typeof vi.fn>;
  hostTree?: typeof threeHostTree;
  isAdmin?: boolean;
  project?: string | null;
} = {}) {
  const onCreate = overrides.onCreate ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <NewSessionDialog
      open={overrides.open ?? true}
      onClose={onClose}
      hostTree={overrides.hostTree ?? threeHostTree}
      onCreate={onCreate}
      isAdmin={overrides.isAdmin ?? true}
      project={overrides.project ?? null}
    />,
  );
  return { ...result, onCreate, onClose };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  __resetKitDialogsForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A: path field is visible ONLY when admin has opted into shell mode
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test A — path field visible only in shell mode (under isAdmin)", () => {
  it("Test A: path input hidden in default agent mode; appears after admin toggles the shell checkbox", () => {
    // The Path knob is only meaningful in the raw-shell branch (where it
    // becomes the shell's cwd). In agent mode both admin and non-admin get
    // the backend workspace-default substitution, so the field stays out of
    // the DOM. Toggling the admin-only "Just a shell" checkbox reveals it.
    const { queryByLabelText, getByLabelText, getByRole } = renderDialog();
    expect(queryByLabelText(/^path$/i)).toBeNull();
    chooseShell();
    expect(getByLabelText(/^path$/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B: path defaults to empty in shell mode
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test B — path defaults to empty (shell mode)", () => {
  it("Test B: shell-mode initial render → path input value is empty (normalizePath('') → '~' → shell opens in home)", () => {
    const { getByLabelText, getByRole } = renderDialog();
    // Path field only renders in shell mode; toggle to reveal it.
    chooseShell();
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    expect(pathInput.value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C: path normalizes backslashes to forward slashes on Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test C — path normalizes backslashes", () => {
  it("Test C: fill path with backslashes; Create in shell mode fires onCreate with normalized path", () => {
    const onCreate = vi.fn();
    const { getByLabelText, getByRole, getByText } = renderDialog({ onCreate });
    // Phase 88 semantic-invert: click OPTS INTO shell mode (was: opted out
    // of identity mode). Shell mode is the branch that calls onCreate with
    // identityMode:false — the path we're testing the normalize for.
    chooseShell();
    // Set backslash path
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "\\home\\ubuntu\\test\\dir" } });
    // Select host and fill session name to enable Create
    fireEvent.click(getByText("bravo"));
    // Click Create (Open)
    const createBtn = getByRole("button", { name: /^(open|create)$/i });
    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0][0];
    expect(arg.path).toBe("/home/ubuntu/test/dir");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D: identity-mode checkbox defaults UNCHECKED (Phase 88 — agent mode is default)
// ─────────────────────────────────────────────────────────────────────────────
// Phase 88 (Plan 88-02 Edit D): the default flipped from checked-true
// (identity mode ON was the default) to unchecked-false (agent mode IS
// the default). The local state variable was renamed from `identityMode`
// to `shellOnly` and its useState default flipped from `true` to `false`.
// The checkbox is admin-gated (Plan 88-02 Edit C) so this test renders
// under isAdmin=true (the renderDialog helper default) to see the
// checkbox at all.
// apple-ux 2026-10-22: the tick-box is now an Agent / Shell switch; Agent is
// the pressed segment on open.
describe("NewSessionDialog: Test D — Agent / Shell switch defaults to Agent (admin-only)", () => {
  it("Test D: initial render with isAdmin=true → the switch is there with Agent pressed", () => {
    renderDialog({ isAdmin: true });
    expect(queryModeSwitch()).toBeTruthy();
    expect(screen.getByTestId("new-session-mode-agent").getAttribute("aria-pressed")).toBe("true");
    expect(shellChosen()).toBe(false);
    // The old tick-box is gone.
    expect(screen.queryByRole("checkbox", { name: /just a shell/i })).toBeNull();
  });

  it("Test D2: the subtitle says what each mode opens; switching back to Agent restores the agent fields", async () => {
    renderDialog({ isAdmin: true });
    expect(screen.getByText("New conversation")).toBeTruthy();
    expect(
      screen.getByText("An agent to chat with. Its roles shape what it knows and how it helps."),
    ).toBeTruthy();
    chooseShell();
    expect(shellChosen()).toBe(true);
    expect(
      screen.getByText("A terminal on one of your machines, with no agent in it."),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    chooseAgent();
    expect(shellChosen()).toBe(false);
    expect(screen.queryByLabelText(/^path$/i)).toBeNull();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E: identity-mode OFF hides birth-field cluster
// Phase 86 Plan 86-04: cosmetic UI (title, brief, voice, color) is now
// removed entirely in identity-mode too; the test's absent-when-OFF
// assertion remains valid but trivially so. Preserved as a regression
// guard against a future accidental re-introduction.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test E — shell mode hides birth fields (opt in via checkbox)", () => {
  it("Test E: click 'Just a shell — no agent' → identity-cluster fields (task, name, role, cosmetic residue) all absent from DOM", () => {
    // Phase 88 semantic-invert: click OPTS INTO shell mode (was: opted
    // out of identity mode). Shell mode is the branch where the
    // identity-cluster is not rendered — same assertion, inverted intent.
    const { getByRole, queryByLabelText } = renderDialog();
    chooseShell();
    // Identity-cluster fields gone
    expect(queryByLabelText(/^task$/i)).toBeNull();
    expect(queryRolesGroup()).toBeNull();
    // Phase 86 Plan 86-04: title / brief / voice / color / avatar generate are
    // never rendered anymore — assert their absence as a regression guard.
    expect(queryByLabelText(/^title$/i)).toBeNull();
    expect(queryByLabelText(/^brief$/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F: identity-mode ON reveals current birth-field cluster
// Phase 86 Plan 86-04: cluster reduced to Task + Name + Role (post host-pick).
// The old cosmetic fields (title, brief, voice, color, avatar) are DELETED
// from source — those assertions have been removed.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test F — identity-mode ON reveals birth fields", () => {
  it("Test F: default (agent mode) → roles list + Name field present (no tick-box in front of it); task and cosmetic controls absent", async () => {
    const { getByLabelText, queryByLabelText, queryByRole } = renderDialog();
    // No host step: the roles list renders as soon as the hosts answer.
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(getRolesGroup()).toBeTruthy();

    // apple-ux 2026-10-22: the Name field is always shown — shape §What would
    // make it wrong: "A name field hidden behind a tick-box".
    expect(getByLabelText(/^name$/i)).toBeTruthy();
    expect(queryByLabelText(/choose a custom agent name/i)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // Several machines, nothing picked yet: the Name says to pick a role.
    expect((getByLabelText(/^name$/i) as HTMLInputElement).placeholder).toBe("Pick a role first");
    // Three machines → each gets its heading.
    expect(roleGroupHeaders()).toEqual(["alpha", "bravo", "charlie"]);

    // 2026-09-14: the task textarea was removed — birth sends a placeholder and
    // the agent self-fills its own `task:` frontmatter on first wake. Asserted
    // absent as a regression guard, same as the cosmetic controls below.
    expect(queryByLabelText(/^task$/i)).toBeNull();

    // Phase 86 Plan 86-04: cosmetic controls are deleted from source. Assert
    // their absence as a regression guard against accidental re-introduction.
    expect(queryByLabelText(/^title$/i)).toBeNull();
    expect(queryByLabelText(/^brief$/i)).toBeNull();
    expect(queryByRole("button", { name: /^generate$/i })).toBeNull();
    expect(queryByRole("button", { name: /upload avatar/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G: name + role + host → Create enabled
// Phase 86 Plan 86-04: cosmetic gates (title / brief / avatar-picked) removed
// from canOpen; identity-mode Create enables on host + valid name + role.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test G — name + role + host enables Create", () => {
  it("Test G: pick a role from alpha, fill valid name → Create enabled", async () => {
    const { getByLabelText, getByRole } = renderDialog();
    // Picking alpha's role is what picks the host.
    await pickRoleFromAlpha();
    // 2026-09-27: reveal the manual name input by opting into custom name.
    // Fill name.
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });

    await waitFor(() => {
      const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H: invalid name chars show error and disable Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test H — unslugifiable name disables Create + shows error (pretty-names shape 2026-09-30)", () => {
  it("Test H: name='🎉🎉🎉' → inline error 'at least one letter'; Create disabled", async () => {
    // Pretty-names shape: free-form text input is valid. "user Smith" now
    // slugs to "user-smith" and would be accepted — the former error about
    // kebab-case/charset no longer fires. Only input that reduces to zero
    // letters (all-emoji / all-punctuation / empty) is rejected.
    const { getByLabelText, getByRole, queryByText } = renderDialog();
    await pickRoleFromAlpha();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "🎉🎉🎉" } });
    const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    expect(queryByText(/at least one letter/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I: Skynet-side collision blocks Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test I — Skynet collision blocks Create", () => {
  it("Test I: listIdentities returns matching key → 'Already exists in Skynet' + Create disabled", async () => {
    mockListIdentities.mockResolvedValue([
      { identityKey: "alicia", displayName: "Alicia", title: null, colorHue: null, voice: null,
        role: null, avatarMime: "", avatarUrl: "", avatarEtag: "", coordinator: false }
    ]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    const { getByLabelText, getByRole } = renderDialog();
    await pickRoleFromAlpha();
    const nameInput = getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: "alicia" } });
    fireEvent.blur(nameInput);
    // Wait for debounce (300ms) + async collision checks
    await waitFor(() => {
      expect(screen.queryByText(/already exists in skynet/i)).toBeTruthy();
    }, { timeout: 2000 });
    const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test J: target-host-side collision blocks Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test J — host collision blocks Create", () => {
  it("Test J: getIdentityExistsOnHost returns true → 'Already exists on <hostname>' + Create disabled", async () => {
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(true);
    const { getByLabelText, getByRole } = renderDialog();
    await pickRoleFromAlpha();
    const nameInput = getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: "new-agent" } });
    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(screen.queryByText(/already exists on/i)).toBeTruthy();
    }, { timeout: 2000 });
    const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K: collision cleared when name changes
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test K — collision clears when name changes", () => {
  it("Test K: after collision, change name to valid unique one → error clears", async () => {
    mockListIdentities
      .mockResolvedValueOnce([
        { identityKey: "alicia", displayName: "Alicia", title: null, colorHue: null,
          voice: null, role: null, avatarMime: "", avatarUrl: "", avatarEtag: "", coordinator: false }
      ])
      .mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);

    const { getByLabelText } = renderDialog();
    await pickRoleFromAlpha();
    const nameInput = getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: "alicia" } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(screen.queryByText(/already exists in skynet/i)).toBeTruthy(), { timeout: 2000 });

    // Change name — collision state clears immediately on change
    fireEvent.change(nameInput, { target: { value: "alicia2" } });
    // The collision error should clear on change (setSkynetCollision(false) in onChange)
    await waitFor(() => expect(screen.queryByText(/already exists in skynet/i)).toBeNull(), { timeout: 2000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K2: the host now arrives with the role pick, which can come AFTER the
// name was typed — the collision precheck re-runs whenever the host changes.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test K2 — collision precheck follows the role's host", () => {
  it("Test K2: name typed before any role → no host check; pick alpha's role → checked on h1; switch to bravo's → re-checked on h2", async () => {
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockImplementation(async (hostId: unknown) => hostId === "h2");
    const { getByLabelText } = renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    const nameInput = getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: "new-agent" } });
    fireEvent.blur(nameInput);
    // No host yet → nothing to check against.
    await new Promise((r) => setTimeout(r, 400));
    expect(mockGetIdentityExistsOnHost).not.toHaveBeenCalled();

    toggleRole("box-maintainer", "h1");
    await waitFor(
      () => expect(mockGetIdentityExistsOnHost).toHaveBeenCalledWith("h1", "new-agent"),
      { timeout: 2000 },
    );
    expect(screen.queryByText(/already exists on/i)).toBeNull();

    toggleRole("box-maintainer", "h2");
    await waitFor(
      () => expect(mockGetIdentityExistsOnHost).toHaveBeenCalledWith("h2", "new-agent"),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.queryByText(/already exists on/i)).toBeTruthy());
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
  });
});

// ─── Test L / Test M / Test N / Test O / Test P / Test Q ──────────────────
// Phase 86 Plan 86-06: DELETED. These tests exercised the identity-mode
// avatar generator UI (batch-generate call, candidate carousel,
// candidate-pick gate). Plan 86-04 stripped that UI from source per
// D-CTX-86-surface-4 — the tests targeted behavior that no longer exists.

// ─────────────────────────────────────────────────────────────────────────────
// Test R: onCreate payload when identity-mode ON — Phase 86 Plan 86-04 shape
// Plan 06 note: Create starts a birth stream (identity-mode ON). onCreate
// fires on successful stream completion (ended: ok:true) with a narrowed
// payload — no title / brief / voice / colorHue / avatarCandidateId.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test R — onCreate payload with identity-mode ON", () => {
  it("Test R: Create with fully valid identity-mode ON form → onCreate called with narrowed payload (no cosmetic fields) after successful birth; payload name+sessionName come from the ended event, NOT the raw user input", async () => {
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    // Post-quick-260918-52n: user types the short pool name ("alicia") but
    // the backend derives the folder + tmux session name from the MXID
    // localpart ("alicia-box-maintainer-2"). The onCreate payload must carry
    // the DERIVED name — that IS the tmux session AppShell attaches to.
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      {
        type: "ended",
        ok: true,
        identityId: "alicia-box-maintainer-2",
        sessionName: "alicia-box-maintainer-2",
      },
    ]));
    const onCreate = vi.fn();
    const { getByLabelText, getByRole } = renderDialog({ onCreate });
    // Phase 22 SRIC-02: a role must be picked (and it picks the host).
    await pickRoleFromAlpha();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    await waitFor(() => {
      const createBtn = getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
    });
    const createBtn = getByRole("button", { name: /^(open|create|creating)/i });
    fireEvent.click(createBtn);
    // onCreate fires after birth stream completes successfully
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    const arg = onCreate.mock.calls[0][0];
    expect(arg.identityMode).toBe(true);
    // Derived-from-ended-event, NOT the user input "alicia" — this is the
    // regression guard for the "tmux session '<short>' not found" bug.
    expect(arg.name).toBe("alicia-box-maintainer-2");
    expect(arg.sessionName).toBe("alicia-box-maintainer-2");
    expect(arg.path).toBeDefined();
    expect(arg.host).toEqual(expect.objectContaining({ id: "h1", name: "alpha" }));
    // Phase 86 Plan 86-04: cosmetic fields no longer live in the payload.
    expect(arg.title).toBeUndefined();
    expect(arg.brief).toBeUndefined();
    expect(arg.voice).toBeUndefined();
    expect(arg.colorHue).toBeUndefined();
    expect(arg.avatarCandidateId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S: onCreate payload when shell mode chosen matches regular-session contract
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test S — onCreate payload with shell mode (identityMode:false)", () => {
  it("Test S: click 'Just a shell — no agent' → onCreate called with {host, sessionName?, path, identityMode:false}", () => {
    // Phase 88 semantic-invert: click OPTS INTO shell mode (was: opted out
    // of identity mode). Public payload discriminant `identityMode: false`
    // is preserved on the wire (Plan 88-02 Edit D — local var renamed to
    // `shellOnly`, public discriminant unchanged).
    const onCreate = vi.fn();
    const { getByLabelText, getByRole } = renderDialog({ onCreate });
    chooseShell();
    // Select host
    fireEvent.click(screen.getByText("bravo"));
    // Click Create
    const createBtn = getByRole("button", { name: /^(open|create)$/i });
    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0][0];
    expect(arg.identityMode).toBe(false);
    expect(arg.path).toBeDefined();
    expect(arg.host).toBeDefined();
    // No birth fields
    expect(arg.name).toBeUndefined();
    expect(arg.title).toBeUndefined();
    expect(arg.brief).toBeUndefined();
    expect(arg.avatarCandidateId).toBeUndefined();
    // For unused variable lint hygiene (getByLabelText).
    void getByLabelText;
  });
});

// ─── Test T (brief ephemeral) ─────────────────────────────────────────────
// Phase 86 Plan 86-06: DELETED. The brief textarea it targeted was removed
// in Plan 86-04 per D-CTX-86-surface-4.

// ─────────────────────────────────────────────────────────────────────────────
// Test U: modal state resets on close (Phase 86 Plan 86-06 realigned shape)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test U — modal state resets on close", () => {
  it("Test U: fill fields, close, re-open → all fields back to defaults", () => {
    const onClose = vi.fn();
    const { getByLabelText, rerender } = renderDialog({ onClose });
    // Fill the agent-mode fields. Path lives in the shell branch now; its reset
    // is covered by Test B (default is "" on shell toggle) so it isn't
    // reasserted here.
    //
    // 2026-09-14: only `name` remains fillable here — the task textarea was
    // removed, so there is no task state left to reset.
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    // And switch to Shell, so the reset of the mode is observable too.
    chooseShell();
    expect(shellChosen()).toBe(true);

    // Close the dialog.
    rerender(
      <NewSessionDialog
        open={false}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />
    );
    // Re-open
    rerender(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />
    );
    // Back to Agent, with an empty Name.
    expect(shellChosen()).toBe(false);
    expect((getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 Plan 06: Birth stream tests (Tests V through GG)
// Phase 86 Plan 86-06: helper renamed fillIdentityFormAndPick → fillIdentityForm
// (no longer generates or picks an avatar — cosmetic UI is gone).
// ─────────────────────────────────────────────────────────────────────────────

// Helper: fill the required identity-mode fields (role — which picks the
// host — and name) so Create becomes enabled. Post-Plan-86-04 there are no
// cosmetic gates — no title, brief, voice, colorHue, or avatar to fill.
async function fillIdentityForm(utils: ReturnType<typeof renderDialog>) {
  const { getByLabelText } = utils;
  await pickRoleFromAlpha();
  // The Name field is always shown; typing replaces any suggestion.
  fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
  await waitFor(() => {
    const createBtn = utils.getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    // Wait for Create to be enabled (or in "creating..." state)
    expect(createBtn).toBeTruthy();
    expect(createBtn.disabled).toBe(false);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test V: clicking Create with identity-mode ON starts birth stream
// Phase 86 Plan 86-04: birth payload no longer carries title / avatarCandidateId.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test V — Create with identity-mode ON calls openBirthStream", () => {
  it("Test V: clicking Create calls openBirthStream with correct payload (not regular session; no cosmetic fields)", async () => {
    // Return empty stream that completes immediately
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const utils = renderDialog();
    await fillIdentityForm(utils);
    const createBtn = utils.getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    // Pretty-names shape (2026-09-30): user-typed name goes on the wire as
    // `displayName`; backend derives the identity slug. `name` is reserved
    // for the pool-picked path (which this test doesn't exercise).
    expect(payload).toMatchObject({
      hostId: expect.anything(),
      displayName: "alicia",
      role: "box-maintainer",
    });
    expect(payload.name).toBeUndefined();
    // Phase 86 Plan 86-04: cosmetic fields either omitted or sent as null.
    // The birth request omits `title` and `avatarCandidateId` entirely; it
    // sends `colorHue: null` and `voice: null` (backend absent-⇒-omit rule
    // treats both as inherit-from-role).
    expect(payload.title).toBeUndefined();
    expect(payload.avatarCandidateId).toBeUndefined();
    expect(payload.colorHue).toBeNull();
    expect(payload.voice).toBeNull();
    // Must NOT contain identityMode or sessionName keys (backend-only payload)
    expect(payload).not.toHaveProperty("identityMode");
    expect(payload).not.toHaveProperty("sessionName");
  });
});

describe("NewSessionDialog: Enter in the custom name field", () => {
  it("Enter submits like clicking Create", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const utils = renderDialog();
    await fillIdentityForm(utils);
    fireEvent.keyDown(utils.getByLabelText(/^name$/i), { key: "Enter" });
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    expect(mockOpenBirthStream.mock.calls[0][0]).toMatchObject({ displayName: "alicia" });
  });

  it("Enter does nothing while Create is disabled (no role picked)", () => {
    const utils = renderDialog();
    fireEvent.change(utils.getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.keyDown(utils.getByLabelText(/^name$/i), { key: "Enter" });
    expect(mockOpenBirthStream).not.toHaveBeenCalled();
  });
});

describe("NewSessionDialog: born into a project", () => {
  it("project prop → birth request carries project; absent → no project key", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const utils = renderDialog({ project: "ops" });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.project).toBe("ops");
  });
});

// ─── Phase 106 Plan 106-04 (D-21 test-suite refresh) ─────────────────────────
// The pre-Phase-106 Tests W/X/Y/Z/AA/BB/CC/DD/EE/FF asserted on the deleted
// per-step birth-checklist UX (5 progress rows, per-step data-status="failed"
// icons, step-1/2/3 failure blurbs, modal-stays-open-on-failure). Plan 106-02
// collapsed that entire scaffolding into a spinner-in-button + modal-lock +
// generic-alert-on-failure shape (D-13/D-14/D-15/D-17). The tests below
// replace the deleted W..FF set to pin the NEW behavior:
//
//   Test 106A: during birthing, the Create button is busy (kit spinner, not
//              the "Create" text label) — D-14.
//   Test 106B: during birthing, the Cancel button is disabled AND the Dialog's
//              onOpenChange no-ops so ESC/backdrop close cannot fire onClose —
//              D-15 (modal fully locked from Create click to birth resolution).
//   Test 106C: on ended:ok:true, refreshOneIdentity fires BEFORE onCreate which
//              fires BEFORE onClose — D-18 ordering invariant + D-16 auto-route
//              chain payload preservation.
//   Test 106D: on ended:ok:false, the kit notice "Couldn't create the agent" fires
//              exactly once and onClose fires; onCreate does NOT fire — D-17.
//   Test 106E: on stream-throw (outer catch path), same failure surface as
//              Test 106D — D-17 (single generic alert regardless of failure class).
//
// Note: Test R above already exercises the ended:ok:true success payload
// shape (identityMode:true, name, no cosmetic fields). Test 106C strengthens
// that with the D-18 ordering-with-refreshOneIdentity assertion.

// ─────────────────────────────────────────────────────────────────────────────
// Test 106A: spinner-in-Create-button during birthing (D-14)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106A — Create button shows spinner during birthing", () => {
  it("Test 106A: while birthing (stream open, no ended yet), Create button shows the busy spinner instead of the 'Create' text label", async () => {
    // A stream that yields nothing and never resolves — simulates the
    // in-flight window between click and terminal `ended` event. React
    // flips `birthing=true` immediately on click; the spinner replaces
    // the button label per D-14.
    let resolveStream!: () => void;
    const neverEnds = new Promise<void>((res) => { resolveStream = res; });
    async function* hangingStream() {
      await neverEnds;
    }
    mockOpenBirthStream.mockReturnValueOnce(hangingStream());

    const utils = renderDialog();
    await fillIdentityForm(utils);
    const createBtn = utils.getByRole("button", {
      name: /^(open|create|creating|creating agent)/i,
    }) as HTMLButtonElement;
    fireEvent.click(createBtn);

    // After click, birthing===true → the Create button is the kit's busy
    // button: a spinner inside, aria-busy set, label "Creating…".
    await waitFor(() => {
      const spinnerInBtn = createBtn.querySelector(".k-spin");
      expect(spinnerInBtn).toBeTruthy();
    });
    expect(createBtn.getAttribute("aria-busy")).toBe("true");
    expect(createBtn.textContent).not.toMatch(/^create$/i);

    // Cleanup: resolve the hanging stream so React can unmount cleanly.
    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106B: modal fully locked during birthing (D-15)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106B — modal is fully locked during birthing", () => {
  it("Test 106B: while birthing → Create button disabled; pressing Escape does NOT fire onClose", async () => {
    // Same stuck-stream mock as Test 106A so `birthing===true` is stable.
    let resolveStream!: () => void;
    const neverEnds = new Promise<void>((res) => { resolveStream = res; });
    async function* hangingStream() {
      await neverEnds;
    }
    mockOpenBirthStream.mockReturnValueOnce(hangingStream());

    const onClose = vi.fn();
    const utils = renderDialog({ onClose });
    await fillIdentityForm(utils);
    const createBtn = utils.getByRole("button", {
      name: /^(open|create|creating|creating agent)/i,
    }) as HTMLButtonElement;
    fireEvent.click(createBtn);

    // Wait for birthing to flip on: the Create button goes disabled while it
    // spins.
    await waitFor(() => {
      expect(createBtn.disabled).toBe(true);
    });

    // ESC keypress on the dialog should NOT invoke onClose — the Dialog's
    // onOpenChange handler no-ops while birthing (D-15). We fire on
    // document to route through Radix Dialog's keydown listener.
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // The X close affordance is also inert while birthing (same D-15 gate).
    fireEvent.click(utils.getByRole("button", { name: /close/i }));
    expect(onClose).not.toHaveBeenCalled();

    // Cancel is disabled, the button reads "Creating…", and the form is
    // locked: the roles and the Name can't be changed mid-birth.
    const cancel = utils.getByTestId("new-session-cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    expect(createBtn.textContent).toMatch(/creating…/i);
    expect((utils.getByLabelText(/^name$/i) as HTMLInputElement).disabled).toBe(true);
    expect((utils.getByTestId("new-session-mode-shell") as HTMLButtonElement).disabled).toBe(true);
    toggleRole("box-maintainer", "h2");
    expect(pickedRoleValues()).toEqual(["h1/box-maintainer"]);

    // Cleanup
    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106C: success chain — refreshOneIdentity → onCreate → onClose (D-18, D-16)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106C — success chain fires refreshOneIdentity → onCreate → onClose in order", () => {
  it("Test 106C: on ended:ok:true, refreshOneIdentity is called BEFORE onCreate which is called BEFORE onClose; onCreate payload matches D-16 (identityMode:true, name)", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "ended", ok: true, identityId: "alicia", sessionName: "alicia" },
    ]));

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(
      utils.getByRole("button", { name: /^(open|create|creating|creating agent)/i }),
    );

    // Wait for the success chain to complete.
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // D-18: the newborn alone is fetched, by name + host (no fleet-wide fanout).
    expect(mockRefreshOneIdentity).toHaveBeenCalledWith("alicia", expect.any(Number));

    // D-18 ordering: the refresh fires BEFORE onCreate.
    const refreshOrder = mockRefreshOneIdentity.mock.invocationCallOrder[0];
    const createOrder = onCreate.mock.invocationCallOrder[0];
    const closeOrder = onClose.mock.invocationCallOrder[0];
    expect(refreshOrder).toBeLessThan(createOrder);
    // onCreate fires BEFORE onClose (existing invariant preserved).
    expect(createOrder).toBeLessThan(closeOrder);

    // D-16 payload preservation.
    expect(onCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ identityMode: true, name: "alicia" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106D: kit notice on ended:ok:false (D-17)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106D — ended:ok:false fires generic alert + onClose", () => {
  it("Test 106D: on ended:ok:false, the kit notice is shown once and onClose fires; onCreate does NOT fire", async () => {
    const dialogs = autoAnswerKitDialogs();

    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "ended", ok: false, failedStep: 6, reason: "supervisor_wait_timeout" },
    ]));

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(
      utils.getByRole("button", { name: /^(open|create|creating|creating agent)/i }),
    );

    await waitFor(() => {
      expect(dialogs.calls).toHaveLength(1);
    });
    expect(dialogs.calls[0].kind).toBe("alert");
    expect(dialogs.calls[0].opts.title).toBe("Couldn't create the agent");

    // Modal closes on failure (D-17: no fields preserved, no in-modal error state).
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // Success path did NOT fire.
    expect(onCreate).not.toHaveBeenCalled();

  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106E: kit notice on stream throw (D-17)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106E — stream throw fires generic alert + onClose", () => {
  it("Test 106E: if openBirthStream throws (network / fetch reject / abort), outer catch fires the same generic alert + onClose; onCreate does NOT fire", async () => {
    const dialogs = autoAnswerKitDialogs();

    // Async generator that throws on first iteration — routes through the
    // outer catch in NewSessionDialog.handleBirth (D-17 same-surface rule).
    async function* throwingStream(): AsyncGenerator<never> {
      // Throwing before any yield exercises the outer catch (not the
      // ended:ok:false branch), matching Plan 106-02 edit 8's dual-path
      // routing to the same alert-then-close surface.
      throw new Error("Network error");
      // eslint-disable-next-line no-unreachable
      yield {} as never;
    }
    mockOpenBirthStream.mockReturnValueOnce(throwingStream());

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(
      utils.getByRole("button", { name: /^(open|create|creating|creating agent)/i }),
    );

    await waitFor(() => {
      expect(dialogs.calls).toHaveLength(1);
    });
    expect(dialogs.calls[0].kind).toBe("alert");
    expect(dialogs.calls[0].opts.title).toBe("Couldn't create the agent");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onCreate).not.toHaveBeenCalled();

  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test GG: shell-mode (identity-mode=false payload) does NOT call openBirthStream
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test GG — shell mode does NOT call openBirthStream", () => {
  it("Test GG: click 'Just a shell — no agent', click Create → openBirthStream NOT called; onCreate called with identityMode:false", () => {
    // Phase 88 semantic-invert: click OPTS INTO shell mode. Payload
    // discriminant `identityMode:false` on the wire is unchanged.
    const onCreate = vi.fn();
    const { getByRole } = renderDialog({ onCreate });
    chooseShell();
    // Select host
    fireEvent.click(screen.getByText("bravo"));
    // Click Create
    fireEvent.click(getByRole("button", { name: /^(open|create)$/i }));

    expect(mockOpenBirthStream).not.toHaveBeenCalled();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].identityMode).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 88 new tests (Plan 88-03 Task 2 Edit F): admin-gate behavior +
// non-admin backend substitution round-trip. These lock the three
// shape-file surface changes (Path admin-gate, checkbox admin-gate,
// backend `~/<name>/` substitution) with regression coverage that did
// not exist pre-Phase-88.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Phase 88 admin-gate + backend substitution", () => {
  it("Phase 88 T1: isAdmin=false → no Path input AND no Agent / Shell switch, nor any other way to a shell", async () => {
    const { queryByLabelText, queryByRole } = renderDialog({ isAdmin: false });
    // Path field is admin-gated (Plan 88-02 Edit B: {isAdmin && (…)} wrap).
    expect(queryByLabelText(/^path$/i)).toBeNull();
    // Shape §What would make it wrong: a non-admin seeing the Agent / Shell
    // switch, or any way to open a plain shell.
    expect(queryModeSwitch()).toBeNull();
    expect(screen.queryByTestId("new-session-mode-shell")).toBeNull();
    expect(screen.queryByTestId("new-session-mode-agent")).toBeNull();
    expect(queryByRole("button", { name: /^shell$/i })).toBeNull();
    expect(queryByRole("checkbox", { name: /just a shell/i })).toBeNull();
    expect(screen.queryByText(/a terminal on one of your machines/i)).toBeNull();
    expect(queryByLabelText(/search hosts/i)).toBeNull();
    // Still the agent dialog: roles + name.
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
  });

  it("Phase 88 T1b: non-admin with one machine still never sees the switch, and Create births an agent", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const onCreate = vi.fn();
    renderDialog({ isAdmin: false, hostTree: oneHostTree, onCreate });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(queryModeSwitch()).toBeNull();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "alicia" } });
    const createBtn = screen.getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
    await waitFor(() => expect(createBtn.disabled).toBe(false));
    fireEvent.click(createBtn);
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    // No regular-session (shell) onCreate.
    expect(onCreate.mock.calls.every((c) => c[0].identityMode !== false)).toBe(true);
  });

  it("Phase 88 T2: isAdmin=true → Agent / Shell switch present on Agent AND Path field NOT rendered (agent mode default)", () => {
    const { queryByLabelText } = renderDialog({ isAdmin: true });
    // Path field is now gated on `isAdmin && shellOnly`. Default state is
    // agent mode (shellOnly=false), so the field stays out of the DOM — the
    // birth branch relies on backend workspace-default substitution.
    expect(queryByLabelText(/^path$/i)).toBeNull();
    expect(queryModeSwitch()).toBeTruthy();
    expect(shellChosen()).toBe(false);
  });

  it("Phase 88 T3: isAdmin=false submit path sends path:'' — backend substitutes `~/<name>/` per Plan 88-01 narrow", async () => {
    // Plan 88-02 Edit F: handleBirth's openBirthStream path arg is
    // `isAdmin ? normalizedPath : ""`. Under isAdmin=false this test
    // proves the client sends empty-string on the wire, handing off
    // working-directory computation to Plan 88-01's backend narrow at
    // identity-birth.ts:206 which substitutes `~/<name>/`.
    //
    // Mock pattern is the same as Test V above (empty stream that
    // completes immediately + inspect mockOpenBirthStream.mock.calls[0]).
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const utils = renderDialog({ isAdmin: false });
    await fillIdentityForm(utils);
    const createBtn = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    // The load-bearing assertion: non-admin's wire path is literal
    // empty-string. Plan 88-01 identity-birth.ts:206 substitutes
    // `~/<name>/` server-side; this test asserts only the client half of
    // the round-trip (that empty-string arrives at the API surface).
    expect(payload.path).toBe("");
    // Pretty-names shape: user-typed custom name goes on the wire as
    // displayName (backend derives the slug which drives the substitution).
    expect(payload.displayName).toBe("alicia");
  });

  it("Phase 88 T4: admin agent-mode submit sends path:'' on the wire (backend substitutes workspace default)", async () => {
    // Regression guard for the trap the previous "admin-blank" fix left
    // behind: normalizePath("") → "~", and the wire had been sending that
    // through as a truthy path, defeating identity-birth.ts's empty-path
    // substitution to ~/fleet/identities/<name>/workspace/. With the Path
    // field now gated on `isAdmin && shellOnly`, agent-mode admin submits
    // never touch normalizePath — they send literal empty-string.
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const utils = renderDialog({ isAdmin: true });
    await fillIdentityForm(utils);
    // Sanity: no Path field in agent mode, Create is enabled.
    expect(utils.queryByLabelText(/^path$/i)).toBeNull();
    const createBtn = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.path).toBe("");
  });
});

// ─── Manual avatar upload tests (RTL-01 / RTL-02 / RTL-03) ────────────────
// Phase 86 Plan 86-06: DELETED. The Upload button + preview + carousel-clear
// mutual-exclusion behavior these tests targeted was removed in Plan 86-04
// per D-CTX-86-surface-4.
