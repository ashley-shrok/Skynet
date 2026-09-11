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
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map() }),
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
// Test B: path defaults to ~/
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test B — path defaults to ~/", () => {
  it("Test B: initial render → path input value is '~/'", () => {
    const { getByLabelText } = renderDialog();
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    expect(pathInput.value).toBe("~/");
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

// ─────────────────────────────────────────────────────────────────────────────
// Test W: 5 progress rows render on birth start
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test W — 5 progress rows appear after Create", () => {
  it("Test W: after clicking Create, 5 step rows appear with correct labels", async () => {
    // Stream that stays open (never completes)
    let resolveStream!: () => void;
    const neverEnds = new Promise<void>((res) => { resolveStream = res; });
    async function* hangingStream() {
      await neverEnds;
    }
    mockOpenBirthStream.mockReturnValueOnce(hangingStream());

    const utils = renderDialog();
    await fillIdentityForm(utils);
    const createBtn = utils.getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    fireEvent.click(createBtn);

    await waitFor(() => {
      // Phase 68 SHAPE B: Step 1 is now "Check identity name is available on host"
      expect(screen.queryByText(/check identity name is available/i)).toBeTruthy();
    });
    expect(screen.queryByText(/launch claude cli/i)).toBeTruthy();
    expect(screen.queryByText(/bootstrap dance/i)).toBeTruthy();
    expect(screen.queryByText(/\/id command/i)).toBeTruthy();

    // Cleanup: resolve the hanging stream
    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test X: step:N:started → row flips to in-progress
// Use a controlled stream: pause after step:2:started so React renders the
// intermediate state, then assert, then let the stream continue/end.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test X — step started marks row in-progress", () => {
  it("Test X: emit step:2:started followed by failure → row 2 shows in-progress then failed", async () => {
    // Use a stream that has a visible intermediate in-progress state by
    // eventually ending with a failure (so the component doesn't auto-close)
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 2, phase: "started" },
      { type: "step", n: 2, phase: "failed", reason: "test" },
      { type: "ended", ok: false, failedStep: 2 },
    ]));

    const utils = renderDialog();
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    // Wait for the stream to complete and show a failed step
    await waitFor(() => {
      const failedRows = document.querySelectorAll('[data-status="failed"]');
      expect(failedRows.length).toBeGreaterThanOrEqual(1);
    });
    // At this point, step 2 should be "failed" (was "in-progress" before)
    // The key state transition happened: pending → in-progress → failed
    const failedRows = document.querySelectorAll('[data-status="failed"]');
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Y: step:N:completed → row flips to done
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test Y — step completed marks row done", () => {
  it("Test Y: all 5 steps started+completed + ended:ok:true → all rows show done", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 1, phase: "started" },
      { type: "step", n: 1, phase: "completed" },
      { type: "step", n: 2, phase: "started" },
      { type: "step", n: 2, phase: "completed" },
      { type: "step", n: 3, phase: "started" },
      { type: "step", n: 3, phase: "completed" },
      { type: "step", n: 4, phase: "started" },
      { type: "step", n: 4, phase: "completed" },
      { type: "step", n: 5, phase: "started" },
      { type: "step", n: 5, phase: "completed" },
      { type: "ended", ok: true, identityId: "abc", sessionName: "alicia" },
    ]));

    const onCreate = vi.fn();
    const utils = renderDialog({ onCreate });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    // Wait for successful birth (onCreate called = stream completed with ok:true)
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    }, { timeout: 3000 });
    // After success, onCreate fires with identityMode:true
    expect(onCreate.mock.calls[0][0].identityMode).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Z: step:N:failed → row shows failed + failure blurb
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test Z — step failed shows failed row + blurb", () => {
  it("Test Z: emit step:2:failed → row 2 data-status=failed AND blurb with 'tmux session' text appears", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 2, phase: "failed", reason: "Connect timeout" },
      { type: "ended", ok: false, failedStep: 2 },
    ]));

    const utils = renderDialog();
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      const failedRows = document.querySelectorAll('[data-status="failed"]');
      expect(failedRows.length).toBeGreaterThanOrEqual(1);
    });
    // Step-2 blurb: "Skynet record created, but couldn't open a tmux session"
    await waitFor(() => {
      expect(screen.queryByText(/skynet record created.*tmux/i) ?? screen.queryByText(/couldn't open a tmux session/i) ?? screen.queryByText(/tmux session/i)).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test AA: successful birth closes modal + calls onCreate
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test AA — successful birth closes modal + calls onCreate", () => {
  it("Test AA: all 5 steps complete + ended:ok:true → onClose called + onCreate called with identityMode:true payload", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 1, phase: "started" },
      { type: "step", n: 1, phase: "completed" },
      { type: "step", n: 2, phase: "started" },
      { type: "step", n: 2, phase: "completed" },
      { type: "step", n: 3, phase: "started" },
      { type: "step", n: 3, phase: "completed" },
      { type: "step", n: 4, phase: "started" },
      { type: "step", n: 4, phase: "completed" },
      { type: "step", n: 5, phase: "started" },
      { type: "step", n: 5, phase: "completed" },
      { type: "ended", ok: true, identityId: "abc", sessionName: "alicia" },
    ]));

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    // onCreate should have been called with identity birth payload
    const arg = onCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.identityMode).toBe(true);
    expect(arg.name).toBe("alicia");
    // Modal should close
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test BB: failed birth keeps modal OPEN, onCreate NOT called
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test BB — failed birth keeps modal open", () => {
  it("Test BB: ended:ok:false → modal stays open (onClose not called) + onCreate not called", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 3, phase: "failed", reason: "x" },
      { type: "ended", ok: false, failedStep: 3 },
    ]));

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    // Wait for stream to finish
    await waitFor(() => {
      const failedRows = document.querySelectorAll('[data-status="failed"]');
      expect(failedRows.length).toBeGreaterThanOrEqual(1);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test CC: close after failure resets ALL state
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test CC — close after failure resets state", () => {
  it("Test CC: after failure, user closes modal → re-open shows fresh defaults (no name)", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 3, phase: "failed", reason: "x" },
      { type: "ended", ok: false, failedStep: 3 },
    ]));

    const onClose = vi.fn();
    const utils = renderDialog({ onClose });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    // Wait for failure
    await waitFor(() => expect(document.querySelectorAll('[data-status="failed"]').length).toBeGreaterThanOrEqual(1));

    // Close the dialog.
    // Phase 88: pass isAdmin={true} on rerender so the admin-gated Path field
    // + shell-only checkbox remain rendered (renderDialog helper's default
    // isAdmin=true does not propagate through utils.rerender's raw JSX).
    utils.rerender(
      <NewSessionDialog
        open={false}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />
    );
    // Re-open
    utils.rerender(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
        isAdmin={true}
      />
    );

    // Name should be reset
    expect((utils.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
    // No failed rows
    expect(document.querySelectorAll('[data-status="failed"]').length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test DD: birth in progress disables ALL form fields + no cancel affordance
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test DD — birth in progress disables form fields, no cancel button", () => {
  it("Test DD: while birthing → name/path disabled, identity-mode checkbox disabled, no cancel-birth button", async () => {
    let resolveStream!: () => void;
    const neverEnds = new Promise<void>((res) => { resolveStream = res; });
    async function* hangingStream() {
      await neverEnds;
    }
    mockOpenBirthStream.mockReturnValueOnce(hangingStream());

    const utils = renderDialog();
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      // name input should be disabled
      expect((utils.getByLabelText(/^name$/i) as HTMLInputElement).disabled).toBe(true);
    });
    // Phase 88: shell-only checkbox is disabled during birth (existing
    // formDisabled binding; renderDialog helper defaults isAdmin=true so
    // the checkbox is present to inspect).
    const checkbox = utils.getByRole("checkbox", { name: IDENTITY_MODE_CHECKBOX_RE }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    // No cancel-birth button
    expect(screen.queryByRole("button", { name: /cancel.*birth|cancel birth/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /stop birth/i })).toBeNull();

    resolveStream();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test EE: step:1:failed with silent-no-op reason surfaces step-1 blurb
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test EE — step-1 failure shows correct blurb", () => {
  it("Test EE: step:1:failed → step-1 blurb (identity name already in use on host) renders", async () => {
    // Phase 68: SHAPE B — Step 1 is now an SSH-side on-disk collision probe
    // (not a Skynet DB record creation). Blurb updated to reflect the new meaning.
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 1, phase: "failed", reason: "identity already exists on this host" },
      { type: "ended", ok: false, failedStep: 1 },
    ]));

    const utils = renderDialog();
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      // Step 1 blurb: Phase 68 SHAPE B — "The identity name is already in use on this host"
      expect(
        screen.queryByText(/identity name.*already in use/i) ??
        screen.queryByText(/already in use on this host/i) ??
        screen.queryByText(/pick a different name/i)
      ).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test FF: openBirthStream throwing surfaces as step-1 failure
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test FF — fetch error surfaces as step-1 failure", () => {
  it("Test FF: openBirthStream throws → row 1 shows failed, modal stays open, no state reset", async () => {
    async function* throwingStream(): AsyncGenerator<never> {
      throw new Error("Network error");
      // eslint-disable-next-line no-unreachable
      yield {} as never;
    }
    mockOpenBirthStream.mockReturnValueOnce(throwingStream());

    const onCreate = vi.fn();
    const onClose = vi.fn();
    const utils = renderDialog({ onCreate, onClose });
    await fillIdentityForm(utils);
    fireEvent.click(utils.getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      const failedRows = document.querySelectorAll('[data-status="failed"]');
      expect(failedRows.length).toBeGreaterThanOrEqual(1);
    });
    expect(onClose).not.toHaveBeenCalled();
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

  it("Phase 88 T2: isAdmin=true → Path input present with default value '~/' AND shell-only checkbox present unchecked", () => {
    const { getByLabelText, getByRole } = renderDialog({ isAdmin: true });
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    expect(pathInput).toBeTruthy();
    // Plan 88-02 Edit B inner JSX preserves useState("~/") default.
    expect(pathInput.value).toBe("~/");
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

  it("Phase 88 T4 (follow-up): admin with blank Path → Create disabled + inline error rendered", async () => {
    // Phase 88 follow-up bounty (endorsed inline by Alice 2026-09-08 during
    // /close): admin-side Path field must reject blank submits at the
    // frontend so the belt-and-suspenders backend fallback stays as safety
    // net rather than the primary defense.
    //
    // Non-admins vacuously pass validation (they don't see the field, path
    // state stays at useState("~/") default). Admins visibly clearing the
    // field to empty/whitespace-only → Create disabled + inline error.
    const utils = renderDialog({ isAdmin: true });
    await fillIdentityForm(utils);
    const pathInput = utils.getByLabelText(/^path$/i) as HTMLInputElement;
    // Default state: Path = "~/", Create enabled (pathValid true).
    const createBtnBefore = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnBefore.disabled).toBe(false);
    // Clear the Path field to empty — pathValid flips false.
    fireEvent.change(pathInput, { target: { value: "" } });
    const createBtnAfter = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnAfter.disabled).toBe(true);
    // Inline error surface (mirrors name-field affordance at L1006).
    expect(pathInput.getAttribute("aria-invalid")).toBe("true");
    expect(utils.getByText("Path is required.")).toBeTruthy();
    // Whitespace-only ALSO rejected (path.trim() !== "" is the predicate).
    fireEvent.change(pathInput, { target: { value: "   " } });
    const createBtnWs = utils.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtnWs.disabled).toBe(true);
  });
});

// ─── Manual avatar upload tests (RTL-01 / RTL-02 / RTL-03) ────────────────
// Phase 86 Plan 86-06: DELETED. The Upload button + preview + carousel-clear
// mutual-exclusion behavior these tests targeted was removed in Plan 86-04
// per D-CTX-86-surface-4.
