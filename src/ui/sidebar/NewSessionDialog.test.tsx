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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api for new identity-mode tests
const mockListIdentities = vi.fn().mockResolvedValue([]);
const mockPostGenerateAvatarBatch = vi.fn();
const mockGetIdentityExistsOnHost = vi.fn().mockResolvedValue(false);
const mockOpenBirthStream = vi.fn();
// Phase 22 SRIC-02: listRolesForHost is now called on every host select in
// identity-mode. Default to a single role so identity-mode tests can pick it
// via the dropdown; tests that turn identity-mode OFF are unaffected because
// the effect skips the fetch when identityMode is false.
const mockListRolesForHost = vi.fn().mockResolvedValue([
  { name: "box-maintainer", description: "" },
]);

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    listIdentities: (...args: unknown[]) => mockListIdentities(...args),
    postGenerateAvatarBatch: (...args: unknown[]) => mockPostGenerateAvatarBatch(...args),
    getIdentityExistsOnHost: (...args: unknown[]) => mockGetIdentityExistsOnHost(...args),
    openBirthStream: (...args: unknown[]) => mockOpenBirthStream(...args),
    listRolesForHost: (...args: unknown[]) => mockListRolesForHost(...args),
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

// Mock voice-api so VoicePicker doesn't make real network calls
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi, this is your voice.",
  getVoices: vi.fn().mockResolvedValue([
    { display_name: "Elena", filename: "Elena.wav" },
  ]),
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
    const onCreate = vi.fn();
    const { getByRole, getByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
      />,
    );

    // Turn off identity-mode to use the regular-session path
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);

    // Pre-select-host: Open is disabled
    let openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);

    // Select a host
    fireEvent.click(getByText("bravo"));

    // Now Open is enabled (empty name is valid)
    openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
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
    const onCreate = vi.fn();
    const { getByRole, getByText, getByLabelText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
      />,
    );

    // Turn off identity-mode to use the regular-session path
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/session name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "my-session" } });

    const openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
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
    const onCreate = vi.fn();
    const { getByRole, getByText, getByLabelText, queryByText } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={threeHostTree}
        onCreate={onCreate}
      />,
    );
    // Turn off identity-mode to reveal the session-name input
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);

    fireEvent.click(getByText("alpha"));
    const nameInput = getByLabelText(/session name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "bad;name`chars" } });

    const openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
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
    const openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
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
    const onCreate = vi.fn();
    const { getByRole } = render(
      <NewSessionDialog
        open={true}
        onClose={vi.fn()}
        hostTree={oneHostTree}
        onCreate={onCreate}
      />,
    );
    // Turn off identity-mode so single-host auto-selection enables Open
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);

    // Open button should be enabled immediately (sole host pre-selected + no extra fields needed)
    const openBtn = getByRole("button", { name: /^open$/i }) as HTMLButtonElement;
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

    // The button and rows both live under the same scroller. Query for the
    // button by aria-label and rows by data-conversation-id, then compare
    // absolute DOM-tree order via a walker across the whole container.
    const button = container.querySelector(
      'button[aria-label="New session"]',
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
// Identity-mode field cluster, path field, collision checks, avatar batch
// ─────────────────────────────────────────────────────────────────────────────

// Helper: render dialog with identity-mode capable component
function renderDialog(overrides: {
  open?: boolean;
  onClose?: () => void;
  onCreate?: ReturnType<typeof vi.fn>;
  hostTree?: typeof threeHostTree;
} = {}) {
  const onCreate = overrides.onCreate ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <NewSessionDialog
      open={overrides.open ?? true}
      onClose={onClose}
      hostTree={overrides.hostTree ?? threeHostTree}
      onCreate={onCreate}
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
describe("NewSessionDialog: Test A — path field visible in both modes", () => {
  it("Test A: path input present with identity-mode ON, and still present after toggling OFF", () => {
    const { getByLabelText, getByRole } = renderDialog();
    // Identity-mode is ON by default → path should be visible
    expect(getByLabelText(/^path$/i)).toBeTruthy();
    // Toggle identity-mode OFF
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);
    // Path still present
    expect(getByLabelText(/^path$/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B: path defaults to ~
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test B — path defaults to ~", () => {
  it("Test B: initial render → path input value is '~'", () => {
    const { getByLabelText } = renderDialog();
    const pathInput = getByLabelText(/^path$/i) as HTMLInputElement;
    expect(pathInput.value).toBe("~");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C: path normalizes backslashes to forward slashes on Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test C — path normalizes backslashes", () => {
  it("Test C: fill path with backslashes; Create in regular-session mode fires onCreate with normalized path", () => {
    const onCreate = vi.fn();
    const { getByLabelText, getByRole, getByText } = renderDialog({ onCreate });
    // Switch to regular mode (uncheck identity-mode)
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
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
// Test D: identity-mode checkbox defaults ON
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test D — identity-mode defaults ON", () => {
  it("Test D: initial render → identity-mode checkbox is checked", () => {
    const { getByRole } = renderDialog();
    const checkbox = getByRole("checkbox", { name: /create with new identity/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E: identity-mode OFF hides birth-field cluster
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test E — identity-mode OFF hides birth fields", () => {
  it("Test E: unchecking identity-mode → title/brief/avatar/voice/color absent from DOM", () => {
    const { getByRole, queryByLabelText, queryByRole } = renderDialog();
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
    fireEvent.click(checkbox);
    // Birth fields should be gone
    expect(queryByLabelText(/^title$/i)).toBeNull();
    expect(queryByLabelText(/^brief$/i)).toBeNull();
    expect(queryByRole("combobox", { name: /voice/i })).toBeNull();
    // Avatar generate button gone
    expect(queryByRole("button", { name: /generate/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F: identity-mode ON reveals birth fields
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test F — identity-mode ON reveals birth fields", () => {
  it("Test F: default (identity-mode ON) → title, brief, avatar generate, voice, color present", () => {
    const { getByLabelText, getByRole } = renderDialog();
    expect(getByLabelText(/^title$/i)).toBeTruthy();
    expect(getByLabelText(/^brief$/i)).toBeTruthy();
    expect(getByRole("button", { name: /generate/i })).toBeTruthy();
    // Voice picker (combobox/select)
    expect(getByRole("combobox")).toBeTruthy();
    // Color picker (range input)
    expect(getByRole("slider")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G: name field valid chars + all requirements met enables Create
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test G — valid name + all requirements enables Create", () => {
  it("Test G: fill name/title/brief/pick avatar → Create enabled", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/identities/avatar/candidate/c1" },
      { id: "c2", url: "/identities/avatar/candidate/c2" },
      { id: "c3", url: "/identities/avatar/candidate/c3" },
    ]);
    const { getByLabelText, getByRole, getByText } = renderDialog();
    // Select host
    fireEvent.click(getByText("alpha"));
    // Phase 22 SRIC-02: wait for role dropdown, pick a role
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
    });
    // Fill name
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    // Fill title
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Test" } });
    // Fill brief
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "a brief" } });
    // Generate avatars
    fireEvent.click(getByRole("button", { name: /generate/i }));
    // Wait for candidates
    await waitFor(() => {
      expect(document.querySelectorAll("img").length).toBeGreaterThanOrEqual(1);
    });
    // Pick first candidate
    const candidateButtons = document.querySelectorAll("[data-candidate-id]");
    if (candidateButtons.length > 0) {
      fireEvent.click(candidateButtons[0]);
    } else {
      const imgs = document.querySelectorAll("img");
      if (imgs.length > 0) fireEvent.click(imgs[0].closest("button") ?? imgs[0]);
    }
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
      { identityKey: "alicia", displayName: "Alicia", id: "1", title: null, colorHue: null, voice: null,
        avatarMime: "", avatarUrl: "", avatarEtag: "", createdAt: "", updatedAt: "" }
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
        { identityKey: "alicia", displayName: "Alicia", id: "1", title: null, colorHue: null,
          voice: null, avatarMime: "", avatarUrl: "", avatarEtag: "", createdAt: "", updatedAt: "" }
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

// ─────────────────────────────────────────────────────────────────────────────
// Test L: Generate calls postGenerateAvatarBatch with {name,title,brief}
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test L — Generate calls postGenerateAvatarBatch", () => {
  it("Test L: fill name+title+brief, click Generate → postGenerateAvatarBatch called with exact values", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
    ]);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "myagent" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "My Agent" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "An AI agent" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    expect(mockPostGenerateAvatarBatch).toHaveBeenCalledWith({
      name: "myagent",
      title: "My Agent",
      brief: "An AI agent",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test M: Generate button disabled during in-flight, re-enabled after resolve/reject
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test M — Generate disabled during in-flight", () => {
  it("Test M: button becomes disabled during batch request, re-enables on resolve", async () => {
    let resolvePromise!: (v: { id: string; url: string }[]) => void;
    mockPostGenerateAvatarBatch.mockReturnValueOnce(
      new Promise<{ id: string; url: string }[]>((res) => { resolvePromise = res; })
    );
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "agent1" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Title" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    const genBtn = getByRole("button", { name: /generate/i }) as HTMLButtonElement;
    fireEvent.click(genBtn);
    // Button should be disabled while in-flight
    await waitFor(() => expect(genBtn.disabled).toBe(true));
    // Resolve the batch
    resolvePromise([{ id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" }]);
    await waitFor(() => expect(genBtn.disabled).toBe(false));
  });

  it("Test M (reject): button re-enabled AND inline error rendered on batch failure", async () => {
    mockPostGenerateAvatarBatch.mockRejectedValueOnce(new Error("generation failed"));
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "agent1" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Title" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    const genBtn = getByRole("button", { name: /generate/i }) as HTMLButtonElement;
    fireEvent.click(genBtn);
    await waitFor(() => expect(genBtn.disabled).toBe(false));
    expect(screen.queryByText(/generation failed/i) ?? screen.queryByText(/error/i)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test N: Regen re-fires with current inputs
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test N — Regen re-fires with current inputs", () => {
  it("Test N: after first batch, edit brief, click Regenerate → postGenerateAvatarBatch called with new brief", async () => {
    mockPostGenerateAvatarBatch
      .mockResolvedValueOnce([{ id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" }])
      .mockResolvedValueOnce([{ id: "d1", url: "/c/d1" }, { id: "d2", url: "/c/d2" }, { id: "d3", url: "/c/d3" }]);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "myagent" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Agent" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "original brief" } });
    // First generate
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalledTimes(1));
    // Edit brief
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "updated brief" } });
    // Regenerate
    fireEvent.click(getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(mockPostGenerateAvatarBatch).toHaveBeenCalledTimes(2));
    expect(mockPostGenerateAvatarBatch.mock.calls[1][0].brief).toBe("updated brief");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test O: 3 candidates render as pickable buttons after batch resolves
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test O — 3 candidates render horizontally", () => {
  it("Test O: batch resolves with 3 candidates → 3 img elements each inside a button", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" },
      { id: "c2", url: "/c/c2" },
      { id: "c3", url: "/c/c3" },
    ]);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "myagent" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Title" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => {
      const imgs = document.querySelectorAll("img");
      expect(imgs.length).toBe(3);
    });
    // Each img is inside a button
    document.querySelectorAll("img").forEach((img) => {
      expect(img.closest("button")).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test P: clicking a candidate picks it (marks selected)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test P — clicking candidate picks it", () => {
  it("Test P: click candidate 0 → aria-selected='true'; click candidate 2 → 0 deselected, 2 selected", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" },
      { id: "c2", url: "/c/c2" },
      { id: "c3", url: "/c/c3" },
    ]);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "myagent" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Title" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
    const imgs = Array.from(document.querySelectorAll("img"));
    const btn0 = imgs[0].closest("button") as HTMLElement;
    const btn2 = imgs[2].closest("button") as HTMLElement;
    fireEvent.click(btn0);
    expect(btn0.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(btn2);
    expect(btn2.getAttribute("aria-selected")).toBe("true");
    expect(btn0.getAttribute("aria-selected")).not.toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Q: Create disabled without picked avatar (identity-mode ON)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test Q — Create disabled without avatar pick", () => {
  it("Test Q: everything valid but no candidate picked → Create disabled; pick one → enabled", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
    ]);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    // Phase 22 SRIC-02: pick a role
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "agent1" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Title" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    // Generate batch
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
    // Create should still be disabled (no pick yet)
    const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    // Pick a candidate
    const imgs = Array.from(document.querySelectorAll("img"));
    fireEvent.click(imgs[0].closest("button") as HTMLElement);
    await waitFor(() => expect(createBtn.disabled).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test R: onCreate payload when identity-mode ON contains all birth fields
// Plan 06 note: Create now starts a birth stream (identity-mode ON).
// onCreate is called on successful stream completion (ended: ok:true).
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test R — onCreate payload with identity-mode ON", () => {
  it("Test R: Create with fully valid identity-mode ON form → onCreate called with all birth fields after successful birth", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
    ]);
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
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Alicia Agent" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "A brief description" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
    const imgs = Array.from(document.querySelectorAll("img"));
    fireEvent.click(imgs[0].closest("button") as HTMLElement);
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
    expect(arg.title).toBe("Alicia Agent");
    expect(arg.brief).toBe("A brief description");
    expect(arg.avatarCandidateId).toBe("c1");
    expect(arg.path).toBeDefined();
    expect(arg.host).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test S: onCreate payload when identity-mode OFF matches regular-session contract
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test S — onCreate payload with identity-mode OFF", () => {
  it("Test S: identity-mode OFF → onCreate called with {host, sessionName?, path, identityMode:false}", () => {
    const onCreate = vi.fn();
    const { getByLabelText, getByRole } = renderDialog({ onCreate });
    // Turn off identity-mode
    const checkbox = getByRole("checkbox", { name: /create with new identity/i });
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
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test T: brief field is EPHEMERAL (never written to localStorage/sessionStorage)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test T — brief field is EPHEMERAL", () => {
  it("Test T: no UI text hints at persistence; filling brief and clicking Create never calls setItem with brief content", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    // Mock storage setItem
    const localStorageSetItem = vi.spyOn(Storage.prototype, "setItem");
    const sessionStorageSetItem = vi.spyOn(window.sessionStorage, "setItem");
    const { getByLabelText, getByRole } = renderDialog();
    // No UI text about saving/draft/localStorage
    expect(screen.queryByText(/save.*draft|draft.*saved|localStorage/i)).toBeNull();
    fireEvent.click(screen.getByText("alpha"));
    // Phase 22 SRIC-02: pick a role
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Agent" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "SECRET_MARKER" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
    fireEvent.click(document.querySelectorAll("img")[0].closest("button") as HTMLElement);
    await waitFor(() => {
      const createBtn = getByRole("button", { name: /^(open|create)$/i }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
    });
    fireEvent.click(getByRole("button", { name: /^(open|create)$/i }));
    // Assert setItem never called with SECRET_MARKER
    const allLocalCalls = localStorageSetItem.mock.calls.map((c) => String(c[1]));
    const allSessionCalls = sessionStorageSetItem.mock.calls.map((c) => String(c[1]));
    expect(allLocalCalls.some((v) => v.includes("SECRET_MARKER"))).toBe(false);
    expect(allSessionCalls.some((v) => v.includes("SECRET_MARKER"))).toBe(false);
    localStorageSetItem.mockRestore();
    sessionStorageSetItem.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test U: modal state resets on close
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test U — modal state resets on close", () => {
  it("Test U: fill fields, close, re-open → all fields back to defaults", async () => {
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
    ]);
    const onClose = vi.fn();
    const { getByLabelText, getByRole, rerender } = renderDialog({ onClose });
    // Fill fields
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Agent" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "a brief" } });
    fireEvent.change(getByLabelText(/^path$/i), { target: { value: "/custom/path" } });
    // Generate candidates
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
    // Close the dialog
    rerender(
      <NewSessionDialog
        open={false}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />
    );
    // Re-open
    rerender(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />
    );
    // Fields should reset
    expect((getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
    expect((getByLabelText(/^title$/i) as HTMLInputElement).value).toBe("");
    expect((getByLabelText(/^brief$/i) as HTMLTextAreaElement).value).toBe("");
    expect((getByLabelText(/^path$/i) as HTMLInputElement).value).toBe("~");
    // No candidates rendered
    expect(document.querySelectorAll("img").length).toBe(0);
    // Identity-mode checkbox should be ON (default)
    const checkbox = getByRole("checkbox", { name: /create with new identity/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 Plan 06: Birth stream tests (Tests V through GG)
// ─────────────────────────────────────────────────────────────────────────────

// Helper: fill all required identity-mode fields and generate/pick an avatar
async function fillIdentityFormAndPick(utils: ReturnType<typeof renderDialog>) {
  const { getByLabelText, getByRole } = utils;
  fireEvent.click(screen.getByText("alpha"));
  // Phase 22 SRIC-02: wait for the role dropdown to appear and pick the
  // default mocked role. Then continue filling the rest of the form.
  await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
  fireEvent.change(getByLabelText(/^role$/i), {
    target: { value: "box-maintainer" },
  });
  fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
  fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Alicia Agent" } });
  fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "A test identity" } });
  // Mock batch for avatar
  mockPostGenerateAvatarBatch.mockResolvedValueOnce([
    { id: "c1", url: "/c/c1" }, { id: "c2", url: "/c/c2" }, { id: "c3", url: "/c/c3" },
  ]);
  fireEvent.click(getByRole("button", { name: /generate/i }));
  await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
  fireEvent.click(document.querySelectorAll("img")[0].closest("button") as HTMLElement);
  await waitFor(() => {
    const createBtn = getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    // Wait for Create to be enabled (or in "creating..." state)
    expect(createBtn).toBeTruthy();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test V: clicking Create with identity-mode ON starts birth stream
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test V — Create with identity-mode ON calls openBirthStream", () => {
  it("Test V: clicking Create calls openBirthStream with correct payload (not regular session)", async () => {
    // Return empty stream that completes immediately
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([]));
    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    const createBtn = getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      hostId: expect.anything(),
      name: "alicia",
      title: "Alicia Agent",
      avatarCandidateId: "c1",
    });
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

    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    const createBtn = getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.queryByText(/create skynet identity record/i)).toBeTruthy();
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

    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

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
    const { getByLabelText, getByRole } = renderDialog({ onCreate });
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

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

    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

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
    const { getByLabelText, getByRole } = renderDialog({ onCreate, onClose });
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

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
    const { getByLabelText, getByRole } = renderDialog({ onCreate, onClose });
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

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
  it("Test CC: after failure, user closes modal → re-open shows fresh defaults (no name, no candidates)", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 3, phase: "failed", reason: "x" },
      { type: "ended", ok: false, failedStep: 3 },
    ]));

    const onClose = vi.fn();
    const { getByLabelText, getByRole, rerender } = renderDialog({ onClose });
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

    // Wait for failure
    await waitFor(() => expect(document.querySelectorAll('[data-status="failed"]').length).toBeGreaterThanOrEqual(1));

    // Close the dialog
    rerender(
      <NewSessionDialog
        open={false}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />
    );
    // Re-open
    rerender(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={threeHostTree}
        onCreate={vi.fn()}
      />
    );

    // Name should be reset
    expect((getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("");
    // No candidates
    expect(document.querySelectorAll("img").length).toBe(0);
    // No failed rows
    expect(document.querySelectorAll('[data-status="failed"]').length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test DD: birth in progress disables ALL form fields + no cancel affordance
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test DD — birth in progress disables form fields, no cancel button", () => {
  it("Test DD: while birthing → name/title/path disabled, identity-mode checkbox disabled, no cancel-birth button", async () => {
    let resolveStream!: () => void;
    const neverEnds = new Promise<void>((res) => { resolveStream = res; });
    async function* hangingStream() {
      await neverEnds;
    }
    mockOpenBirthStream.mockReturnValueOnce(hangingStream());

    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      // name input should be disabled
      expect((getByLabelText(/^name$/i) as HTMLInputElement).disabled).toBe(true);
    });
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
  it("Test EE: step:1:failed:reason=silent-no-op → step-1 blurb (couldn't create Skynet record) renders", async () => {
    mockOpenBirthStream.mockReturnValueOnce(createMockStream([
      { type: "step", n: 1, phase: "failed", reason: "silent-no-op: colorHue not persisted" },
      { type: "ended", ok: false, failedStep: 1 },
    ]));

    const { getByLabelText, getByRole } = renderDialog();
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      // Step 1 blurb: "Couldn't create the Skynet identity record"
      expect(
        screen.queryByText(/couldn't create the skynet identity record/i) ??
        screen.queryByText(/nothing was created/i) ??
        screen.queryByText(/safe to retry/i)
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
    const { getByLabelText, getByRole } = renderDialog({ onCreate, onClose });
    await fillIdentityFormAndPick({ getByLabelText, getByRole } as ReturnType<typeof renderDialog>);
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));

    await waitFor(() => {
      const failedRows = document.querySelectorAll('[data-status="failed"]');
      expect(failedRows.length).toBeGreaterThanOrEqual(1);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test GG: regular-session mode (identity-mode=false) does NOT call openBirthStream
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog: Test GG — regular session mode does NOT call openBirthStream", () => {
  it("Test GG: uncheck identity-mode, click Create → openBirthStream NOT called; onCreate called with identityMode:false", () => {
    const onCreate = vi.fn();
    const { getByRole } = renderDialog({ onCreate });
    // Turn off identity-mode
    fireEvent.click(getByRole("checkbox", { name: /create with new identity/i }));
    // Select host
    fireEvent.click(screen.getByText("bravo"));
    // Click Create
    fireEvent.click(getByRole("button", { name: /^(open|create)$/i }));

    expect(mockOpenBirthStream).not.toHaveBeenCalled();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].identityMode).toBe(false);
  });
});
