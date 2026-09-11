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
//     (Task textarea, Name input, Role dropdown) rather than the deleted
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

// Phase 88 (Plan 88-03): single source of truth for the identity-mode
// checkbox label regex. The old label "Create with new identity" was
// flipped to "Just a shell — no agent" (Plan 88-02 Edit C) so all
// getByRole("checkbox", { name: … }) sites below reference this constant
// instead of an inline literal. Prevents label-drift regressions.
const IDENTITY_MODE_CHECKBOX_RE = /just a shell.*no agent/i;

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
// Phase 22 SRIC-02: listRolesForHost is now called on every host select in
// identity-mode. Default to a single role so identity-mode tests can pick it
// via the dropdown; tests that turn identity-mode OFF are unaffected because
// the effect skips the fetch when identityMode is false.
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
// Phase 106 Plan 106-04 (D-18): mock `refreshIdentities` so we can assert
// the D-18 ordering invariant (refreshIdentities → onCreate → onClose) in
// the success-path test. `mockRefreshIdentities` is exposed at
// module scope so individual tests can inspect .mock.calls / invocationCallOrder.
const mockRefreshIdentities = vi.fn().mockResolvedValue(undefined);
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map() }),
  refreshIdentities: (...args: unknown[]) => mockRefreshIdentities(...args),
}));
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// Phase 23 (GEFM-01): mock GlobalFilesModal + API so Test 10 (which renders
// PrettyConversationsPanel) does not pull in the full modal dep tree.
vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) => (props.open ? <div data-testid="global-files-modal-stub" /> : null),
}));

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

import { NewSessionDialog } from "./NewSessionDialog";
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: dialog Cancel closes without emitting onCreate
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: cancel", () => {
  it("Test 2: clicking Cancel calls onClose and does NOT call onCreate", () => {
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
    const cancelBtn = getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: host list renders all hosts from tree (across folders)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: host list render", () => {
  it("Test 3: renders all hosts across folders (flattened)", () => {
    const { getByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />,
    );
    expect(getByText("alpha")).toBeTruthy();
    expect(getByText("bravo")).toBeTruthy();
    expect(getByText("charlie")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: search input filters the host list
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: search filter", () => {
  it("Test 4: typing filters the host list to matching entries", () => {
    const { getByLabelText, queryByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />,
    );
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);

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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/agent name/i) as HTMLInputElement;
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/agent name/i) as HTMLInputElement;
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);

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

    // Phase 23 (GEFM-01): the individual "New agent" pencil button is replaced
    // by a single MoreVertical menu button (data-testid="pv-header-menu-button").
    // The ordering test still applies: the menu trigger must precede conversation
    // rows in document order (same guarantee the old pencil provided).
    const button = container.querySelector(
      'button[data-testid="pv-header-menu-button"]',
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
    />,
  );
  return { ...result, onCreate, onClose };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A: path field is visible in both modes
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test A — path field visible in both modes (under isAdmin)", () => {
  it("Test A: path input present in agent mode (Phase-88 default), and still present after clicking checkbox to opt into shell mode", () => {
    // Phase 88 (Plan 88-02): the Path field is admin-gated. The renderDialog
    // helper defaults isAdmin=true so the Path field is visible on mount.
    // Agent mode is the new default (shellOnly=false); clicking the checkbox
    // now OPTS INTO shell mode (was: opted out of identity mode). Path stays
    // visible in both modes for admin users.
    const { getByLabelText, getByRole } = renderDialog();
    // Agent mode is default under isAdmin=true → path should be visible
    expect(getByLabelText(/^path$/i)).toBeTruthy();
    // Click checkbox to opt into shell mode
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);
    // Path still present (visible in both modes for admin)
    expect(getByLabelText(/^path$/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B: path defaults to empty (2026-09-11 fix — was "~/")
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test B — path defaults to empty", () => {
  it("Test B: initial render → path input value is empty (admin opts into backend workspace-default substitution by leaving blank)", () => {
    const { getByLabelText } = renderDialog();
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);
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
describe("NewSessionDialog: Test D — identity-mode checkbox defaults UNCHECKED (admin-only, agent mode is default)", () => {
  it("Test D: initial render with isAdmin=true → 'Just a shell — no agent' checkbox is unchecked", () => {
    const { getByRole } = renderDialog({ isAdmin: true });
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);
    // Identity-cluster fields gone
    expect(queryByLabelText(/^task$/i)).toBeNull();
    expect(queryByLabelText(/^role$/i)).toBeNull();
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
  it("Test F: default (identity-mode ON) + host picked → task, name, role dropdown present; cosmetic controls (title/brief/voice/color/generate) absent", async () => {
    const { getByLabelText, queryByLabelText, queryByRole } = renderDialog();
    // Pick a host so the role dropdown wrap renders (host-gated per L983).
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());

    // Current identity-mode fields
    expect(getByLabelText(/^task$/i)).toBeTruthy();
    expect(getByLabelText(/^name$/i)).toBeTruthy();
    expect(getByLabelText(/^role$/i)).toBeTruthy();

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
  it("Test G: pick host, pick role, fill valid name → Create enabled", async () => {
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    // Wait for role dropdown, pick the mocked role.
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
    });
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
describe("NewSessionDialog: Test H — invalid name disables Create + shows error", () => {
  it("Test H: name='Alice Smith' → inline error about valid chars; Create disabled", () => {
    const { getByLabelText, getByRole, queryByText } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "Alice Smith" } });
    const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    // Inline error about name pattern
    expect(queryByText(/\[a-z0-9/i) ?? queryByText(/name must match/i) ?? queryByText(/invalid/i)).toBeTruthy();
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
    fireEvent.click(screen.getByText("alpha"));
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
    fireEvent.click(screen.getByText("alpha"));
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
    fireEvent.click(screen.getByText("alpha"));
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
  it("Test R: Create with fully valid identity-mode ON form → onCreate called with narrowed payload (no cosmetic fields) after successful birth", async () => {
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    // Mock birth stream: immediate success
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "ended", ok: true, identityId: "abc", sessionName: "alicia" },
    ]));
    const onCreate = vi.fn();
    const { getByLabelText, getByRole } = renderDialog({ onCreate });
    fireEvent.click(screen.getByText("alpha"));
    // Phase 22 SRIC-02: pick a role
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
    });
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
    expect(arg.name).toBe("alicia");
    expect(arg.path).toBeDefined();
    expect(arg.host).toBeDefined();
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
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE });
    fireEvent.click(checkbox);
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
    const { getByLabelText, getByRole, rerender } = renderDialog({ onClose });
    // Fill Phase-86-current fields (name, path, task).
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.change(getByLabelText(/^path$/i), { target: { value: "/custom/path" } });
    fireEvent.change(getByLabelText(/^task$/i), { target: { value: "do things" } });

    // Close the dialog.
    // Phase 88 (Plan 88-01/88-02): pass isAdmin={true} on rerender so the
    // Path field + shell-only checkbox remain rendered (Plan 88-02 admin-gate).
    // NewSessionDialog defaults isAdmin=false fail-closed at destructure, so
    // without this forward the Path + checkbox would not exist in the DOM.
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
    // Fields should reset
    expect((getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
    expect((getByLabelText(/^path$/i) as HTMLInputElement).value).toBe("~/");
    expect((getByLabelText(/^task$/i) as HTMLTextAreaElement).value).toBe("");
    // Phase 88 (Plan 88-02 Edit D): the local state variable was renamed
    // from `identityMode` to `shellOnly` and its default flipped from
    // `true` to `false`. After close+reopen the shell-only checkbox
    // re-arms to the new default: UNCHECKED (agent mode is the default).
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 Plan 06: Birth stream tests (Tests V through GG)
// Phase 86 Plan 86-06: helper renamed fillIdentityFormAndPick → fillIdentityForm
// (no longer generates or picks an avatar — cosmetic UI is gone).
// ─────────────────────────────────────────────────────────────────────────────

// Helper: fill the required identity-mode fields (host, role, name) so Create
// becomes enabled. Post-Plan-86-04 there are no cosmetic gates — no title,
// brief, voice, colorHue, or avatar to fill.
async function fillIdentityForm(utils: ReturnType<typeof renderDialog>) {
  const { getByLabelText } = utils;
  fireEvent.click(screen.getByText("alpha"));
  await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
  fireEvent.change(getByLabelText(/^role$/i), {
    target: { value: "box-maintainer" },
  });
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
    expect(payload).toMatchObject({
      hostId: expect.anything(),
      name: "alicia",
      role: "box-maintainer",
    });
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

// ─── Phase 106 Plan 106-04 (D-21 test-suite refresh) ─────────────────────────
// The pre-Phase-106 Tests W/X/Y/Z/AA/BB/CC/DD/EE/FF asserted on the deleted
// per-step birth-checklist UX (5 progress rows, per-step data-status="failed"
// icons, step-1/2/3 failure blurbs, modal-stays-open-on-failure). Plan 106-02
// collapsed that entire scaffolding into a spinner-in-button + modal-lock +
// generic-alert-on-failure shape (D-13/D-14/D-15/D-17). The tests below
// replace the deleted W..FF set to pin the NEW behavior:
//
//   Test 106A: during birthing, the Create button renders a Loader2 spinner
//              (not the "Create" text label) — D-14.
//   Test 106B: during birthing, the Cancel button is disabled AND the Dialog's
//              onOpenChange no-ops so ESC/backdrop close cannot fire onClose —
//              D-15 (modal fully locked from Create click to birth resolution).
//   Test 106C: on ended:ok:true, refreshIdentities fires BEFORE onCreate which
//              fires BEFORE onClose — D-18 ordering invariant + D-16 auto-route
//              chain payload preservation.
//   Test 106D: on ended:ok:false, window.alert("agent creation failed") fires
//              exactly once and onClose fires; onCreate does NOT fire — D-17.
//   Test 106E: on stream-throw (outer catch path), same failure surface as
//              Test 106D — D-17 (single generic alert regardless of failure class).
//
// Note: Test R above already exercises the ended:ok:true success payload
// shape (identityMode:true, name, no cosmetic fields). Test 106C strengthens
// that with the D-18 ordering-with-refreshIdentities assertion.

// ─────────────────────────────────────────────────────────────────────────────
// Test 106A: spinner-in-Create-button during birthing (D-14)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106A — Create button shows spinner during birthing", () => {
  it("Test 106A: while birthing (stream open, no ended yet), Create button contains a Loader2 spinner instead of the 'Create' text label", async () => {
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

    // After click, birthing===true → Create button's text label is gone;
    // its DOM contains a Loader2 icon with the .animate-spin class.
    await waitFor(() => {
      const spinnerInBtn = createBtn.querySelector(".animate-spin");
      expect(spinnerInBtn).toBeTruthy();
    });

    // Cleanup: resolve the hanging stream so React can unmount cleanly.
    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106B: modal fully locked during birthing (D-15)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106B — modal is fully locked during birthing", () => {
  it("Test 106B: while birthing → Cancel button disabled; pressing Escape does NOT fire onClose", async () => {
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

    // Wait for birthing to flip on (visible via disabled Cancel button —
    // D-15's rendered-always-but-disabled treatment per plan 106-02).
    const cancelBtn = utils.getByRole("button", { name: /cancel/i }) as HTMLButtonElement;
    await waitFor(() => {
      expect(cancelBtn.disabled).toBe(true);
    });

    // ESC keypress on the dialog should NOT invoke onClose — the Dialog's
    // onOpenChange handler no-ops while birthing (D-15). We fire on
    // document to route through Radix Dialog's keydown listener.
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the (disabled) Cancel button should also not trigger onClose.
    fireEvent.click(cancelBtn);
    expect(onClose).not.toHaveBeenCalled();

    // Cleanup
    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106C: success chain — refreshIdentities → onCreate → onClose (D-18, D-16)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106C — success chain fires refreshIdentities → onCreate → onClose in order", () => {
  it("Test 106C: on ended:ok:true, refreshIdentities is called BEFORE onCreate which is called BEFORE onClose; onCreate payload matches D-16 (identityMode:true, name)", async () => {
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

    // D-18: refreshIdentities called (at least once).
    expect(mockRefreshIdentities).toHaveBeenCalled();

    // D-18 ordering: refreshIdentities fires BEFORE onCreate.
    const refreshOrder = mockRefreshIdentities.mock.invocationCallOrder[0];
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
// Test 106D: window.alert('agent creation failed') on ended:ok:false (D-17)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106D — ended:ok:false fires generic alert + onClose", () => {
  it("Test 106D: on ended:ok:false, window.alert is called once with 'agent creation failed' and onClose fires; onCreate does NOT fire", async () => {
    const alertSpy = vi
      .spyOn(window, "alert")
      .mockImplementation(() => { /* swallow */ });

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
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).toHaveBeenCalledWith("agent creation failed");

    // Modal closes on failure (D-17: no fields preserved, no in-modal error state).
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // Success path did NOT fire.
    expect(onCreate).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 106E: window.alert('agent creation failed') on stream throw (D-17)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test 106E — stream throw fires generic alert + onClose", () => {
  it("Test 106E: if openBirthStream throws (network / fetch reject / abort), outer catch fires the same generic alert + onClose; onCreate does NOT fire", async () => {
    const alertSpy = vi
      .spyOn(window, "alert")
      .mockImplementation(() => { /* swallow */ });

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
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).toHaveBeenCalledWith("agent creation failed");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onCreate).not.toHaveBeenCalled();

    alertSpy.mockRestore();
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
    fireEvent.click(getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE }));
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
  it("Phase 88 T1: isAdmin=false → no Path input AND no shell-only checkbox rendered", () => {
    const { queryByLabelText, queryByRole } = renderDialog({ isAdmin: false });
    // Path field is admin-gated (Plan 88-02 Edit B: {isAdmin && (…)} wrap).
    expect(queryByLabelText(/^path$/i)).toBeNull();
    // Shell-only checkbox is admin-gated (Plan 88-02 Edit C: {isAdmin && (…)} wrap).
    expect(queryByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE })).toBeNull();
  });

  it("Phase 88 T2 (2026-09-11 fix): isAdmin=true → Path input present with default value EMPTY AND shell-only checkbox present unchecked", () => {
    const { getByLabelText, getByRole } = renderDialog({ isAdmin: true });
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    expect(pathInput).toBeTruthy();
    // 2026-09-11 fix: default flipped from "~/" to "" so admin submissions
    // trigger backend workspace-default substitution to
    // ~/fleet/identities/<name>/workspace/ (Phase-96 D-04) without the admin
    // having to blank the field manually.
    expect(pathInput.value).toBe("");
    const checkbox = getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE }) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    // Plan 88-02 Edit D: local state var renamed identityMode → shellOnly,
    // useState default flipped true → false → checkbox defaults UNCHECKED.
    expect(checkbox.checked).toBe(false);
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
    // Sanity: name still passes through so backend substitution can
    // compute `~/<name>/` from it.
    expect(payload.name).toBe("alicia");
  });

  it("Phase 88 T4 (2026-09-11 fix): admin with blank Path → Create ENABLED (blank triggers backend workspace-default substitution)", async () => {
    // Alice 2026-09-11: the previous "blank Path → Create disabled + inline
    // error" behavior locked admins out of the Phase-96 workspace-default
    // substitution. Combined with useState default "~/", it meant admin-born
    // identities always carried a non-empty path on the wire, suppressing
    // Chunk 2's identity-birth.ts server-side substitution to
    // ~/fleet/identities/<name>/workspace/. Fix: blank path is now valid
    // for admins too; backend handles the empty case per Phase 88 backend
    // narrow. Admin who wants a specific path types one; admin who wants
    // the Phase-96 default just leaves it blank (the new useState default).
    const utils = renderDialog({ isAdmin: true });
    await fillIdentityForm(utils);
    const pathInput = utils.getByLabelText(/^path$/i) as HTMLInputElement;
    // 2026-09-11 fix: default state now blank, Create enabled from the
    // start (pathValid is unconditionally true).
    expect(pathInput.value).toBe("");
    const createBtnBefore = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnBefore.disabled).toBe(false);
    // Explicitly clearing (or leaving blank) does NOT disable Create anymore.
    fireEvent.change(pathInput, { target: { value: "" } });
    const createBtnAfter = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnAfter.disabled).toBe(false);
    // No inline error rendered for blank path.
    expect(utils.queryByText("Path is required.")).toBeNull();
    // Whitespace-only ALSO valid now (backend receives it and trim-checks
    // its own way; frontend no longer gates).
    fireEvent.change(pathInput, { target: { value: "   " } });
    const createBtnWs = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnWs.disabled).toBe(false);
  });
});

// ─── Manual avatar upload tests (RTL-01 / RTL-02 / RTL-03) ────────────────
// Phase 86 Plan 86-06: DELETED. The Upload button + preview + carousel-clear
// mutual-exclusion behavior these tests targeted was removed in Plan 86-04
// per D-CTX-86-surface-4.
