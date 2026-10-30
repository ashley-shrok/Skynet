/**
 * AdminModal — the Admin window as an admin drives it (apple-ux
 * shape-admin-modals).
 *
 *   Window
 *     - "Admin" over Users, Hosts, Sign-in, Instance file, System pinned
 *       last; each section opens with its header; no Close button
 *   Users
 *     - Admins and Members groups, alphabetical, "You" on your own row
 *     - OIDC mark only where OIDC is in use
 *     - search appears past eight users
 *   A user (one level deeper)
 *     - opens in the same window; "‹ Users" and Esc go back
 *     - own page: admin switch + delete disabled; last admin can't be deleted
 *     - promote after confirm, push access, both reload the list
 *     - phone: Save appears only once the number changes
 *     - delete needs the typed username; a mismatch deletes nothing
 *     - only that user's live sign-ins; log out one / everywhere
 *     - only hosts that user owns
 *   Sign-in
 *     - OIDC-only switches hidden without OIDC, shown with it
 *     - session length saves on leaving the box; out of range isn't saved
 *   Instance file
 *     - another section or the X with unsaved edits asks first
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminUser } from "@/api/user-management-api";
import {
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
} from "@/components/kit";
import AdminModal from "./AdminModal";
import { getAdminHosts } from "@/api/admin-hosts-api";

const m = vi.hoisted(() => ({
  getUserList: vi.fn(),
  getSessions: vi.fn(),
  makeUserAdmin: vi.fn(),
  removeAdminStatus: vi.fn(),
  deleteUser: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  setUserPhone: vi.fn(),
  setUserNotificationsEnabled: vi.fn(),
  getOidcAutoProvision: vi.fn(),
  getOIDCConfig: vi.fn(),
  getPasswordLoginAllowed: vi.fn(),
  getSSHHosts: vi.fn(),
}));

vi.mock("@/api/user-management-api", () => ({
  getUserList: m.getUserList,
  getSessions: m.getSessions,
  makeUserAdmin: m.makeUserAdmin,
  removeAdminStatus: m.removeAdminStatus,
  deleteUser: m.deleteUser,
  revokeSession: m.revokeSession,
  revokeAllUserSessions: m.revokeAllUserSessions,
  setUserPhone: m.setUserPhone,
  setUserNotificationsEnabled: m.setUserNotificationsEnabled,
  getOidcAutoProvision: m.getOidcAutoProvision,
  updatePasswordLoginAllowed: vi.fn(),
  updateOidcAutoProvision: vi.fn(),
}));

vi.mock("@/main-axios", () => ({
  getOIDCConfig: m.getOIDCConfig,
  getPasswordLoginAllowed: m.getPasswordLoginAllowed,
}));

vi.mock("@/api/settings-api", () => ({
  getSessionTimeout: vi.fn(async () => ({ timeoutHours: 24 })),
  updateSessionTimeout: vi.fn(),
  getLogLevel: vi.fn(async () => ({ level: "info" })),
  updateLogLevel: vi.fn(),
}));

vi.mock("@/api/system-status-api", () => ({
  getVersionInfo: vi.fn(async () => ({
    localVersion: "2.3.2",
    status: "update_check_disabled",
  })),
  getAdminDbHealth: vi.fn(async () => ({ status: "ok" })),
}));

vi.mock("@/api/voice-api", () => ({
  getTtsProviders: vi.fn(async () => ({
    primary: { id: "openai", label: "OpenAI" },
    backup: { id: null, label: null },
  })),
}));

vi.mock("@/api/admin-hosts-api", () => ({
  getAdminHosts: vi.fn(async () => ({ hosts: [], generatedAt: Date.now() })),
}));

vi.mock("@/api/ssh-host-management-api", () => ({
  getSSHHosts: m.getSSHHosts,
}));

vi.mock("@/api/service-secrets-api", () => ({
  getUserServiceSecrets: vi.fn(async () => []),
  setUserServiceSecret: vi.fn(),
  clearUserServiceSecret: vi.fn(),
}));

vi.mock("@/api/instance-file-api", () => ({
  getInstanceFile: vi.fn(async () => ({ content: "# Rules" })),
  saveInstanceFile: vi.fn(),
}));

vi.mock("@/features/pretty-view/WorkspaceTab", () => ({
  default: (props: { target: { kind: string }; hostId: number; introCopy?: string }) => (
    <div data-testid="workspace-tab-stub">
      {props.target.kind}:{props.hostId} {props.introCopy}
    </div>
  ),
}));

vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: (props: { content: string; onChange: (v: string) => void }) => (
    <textarea value={props.content} onChange={(e) => props.onChange(e.target.value)} />
  ),
}));

function user(
  overrides: Partial<AdminUser> & { id: string; username: string },
): AdminUser {
  return {
    isAdmin: false,
    isOidc: false,
    totpEnabled: false,
    mxid: null,
    phoneE164: null,
    avatarPath: null,
    notificationsEnabled: false,
    ...overrides,
  };
}

const USERS: AdminUser[] = [
  user({
    id: "me",
    username: "alice",
    isAdmin: true,
    mxid: "@alice_human:skynet",
  }),
  user({ id: "u2", username: "riley" }),
  user({ id: "u3", username: "bob", isOidc: true }),
];

function renderModal() {
  return render(<AdminModal open onOpenChange={vi.fn()} currentUserId="me" />);
}

async function openUser(name: string) {
  const row = await screen.findByText(name);
  await userEvent.click(row);
  return screen.findByTestId("admin-user-view");
}

const sw = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const btn = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  m.getUserList.mockResolvedValue({ users: USERS });
  m.getOIDCConfig.mockResolvedValue(null);
  m.getPasswordLoginAllowed.mockResolvedValue({ allowed: true });
  m.getOidcAutoProvision.mockResolvedValue({ enabled: false });
  m.getSessions.mockResolvedValue({ sessions: [] });
  m.getSSHHosts.mockResolvedValue([]);
  m.makeUserAdmin.mockResolvedValue({});
  m.deleteUser.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetKitDialogsForTests();
});

describe("AdminModal — window", () => {
  it("lists the sections with System last, opens on Users with its header, and has no Close button", async () => {
    renderModal();
    await screen.findByTestId("admin-users-pane");
    const nav = screen.getAllByTestId(/^admin-tab-/).map((b) => b.textContent);
    expect(nav).toEqual(["Users", "Hosts", "Sign-in", "Instance file", "System"]);
    expect(screen.getByTestId("admin-section-hero").textContent).toContain("Users");
    expect(screen.queryByText("Close")).toBeNull();
    expect(screen.queryByText(/Machines/)).toBeNull();
  });

  it("a host's Files opens its home folder one level below the host; back and Esc return to the host", async () => {
    vi.mocked(getAdminHosts).mockResolvedValue({
      generatedAt: Date.now(),
      hosts: [
        {
          key: "harbor",
          name: "harbor",
          address: "100.1.1.1",
          protocols: ["ssh"],
          agentHost: true,
          online: true,
          latencyMs: 3,
          lastSeenAt: Date.now(),
          resources: null,
          resourcesNote: "probe_failed",
          fleet: null,
          substrate: null,
          filesHostId: 7,
        },
      ],
    });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-hosts"));
    await userEvent.click(await screen.findByTestId("admin-host-harbor"));
    await userEvent.click(screen.getByTestId("admin-host-harbor-files"));
    expect(screen.getByTestId("admin-host-files-pane")).toBeTruthy();
    expect(screen.getByTestId("workspace-tab-stub").textContent).toContain("host:7");
    expect(screen.getByTestId("workspace-tab-stub").textContent).toContain("signs in as on harbor");
    expect(screen.queryByTestId("admin-section-hero")).toBeNull();

    // The host page stays loaded underneath: back shows it at once, no re-read.
    const reads = vi.mocked(getAdminHosts).mock.calls.length;
    await userEvent.click(screen.getByTestId("admin-host-files-back"));
    expect(screen.getByTestId("admin-host-view-harbor")).toBeTruthy();
    expect(screen.queryByTestId("admin-host-files-pane")).toBeNull();
    expect(vi.mocked(getAdminHosts).mock.calls.length).toBe(reads);

    // Esc steps back one level only — to the host page, not the host list.
    await userEvent.click(screen.getByTestId("admin-host-harbor-files"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("admin-host-view-harbor")).toBeTruthy();
    expect(screen.queryByTestId("admin-host-files-pane")).toBeNull();
    expect(screen.getByTestId("admin-modal")).toBeTruthy();

    // Another section and back lands on the list, not the old Files view.
    await userEvent.click(screen.getByTestId("admin-host-harbor-files"));
    await userEvent.click(screen.getByTestId("admin-tab-system"));
    await userEvent.click(screen.getByTestId("admin-tab-hosts"));
    expect(await screen.findByTestId("admin-hosts-pane")).toBeTruthy();
    expect(screen.queryByTestId("admin-host-files-pane")).toBeNull();
    vi.mocked(getAdminHosts).mockImplementation(async () => ({ hosts: [], generatedAt: Date.now() }));
  });

  it("each section opens with its own header", async () => {
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-hosts"));
    expect(await screen.findByTestId("admin-hosts-pane")).toBeTruthy();
    expect(screen.getByTestId("admin-section-hero").textContent).toContain("Hosts");
    expect(await screen.findByText("No hosts yet.")).toBeTruthy();
    await userEvent.click(screen.getByTestId("admin-tab-system"));
    expect(await screen.findByTestId("admin-system-pane")).toBeTruthy();
    expect(screen.getByTestId("admin-section-hero").textContent).toContain("System");
  });
});

describe("AdminModal — Users", () => {
  it("puts admins and members in their own groups, alphabetical, with You on your own row", async () => {
    renderModal();
    await screen.findByTestId("admin-users-pane");
    const admins = screen.getByTestId("admin-users-admins");
    const members = screen.getByTestId("admin-users-members");
    expect(admins.textContent).toContain("Admins · 1");
    expect(within(admins).getAllByRole("button").map((r) => r.textContent)).toEqual([expect.stringContaining("alice")]);
    expect(members.textContent).toContain("Members · 2");
    expect(within(members).getAllByRole("button").map((r) => r.textContent)).toEqual([
      expect.stringContaining("bob"),
      expect.stringContaining("riley"),
    ]);
    expect(screen.getByTestId("admin-user-row-me").textContent).toContain("You");
    expect(screen.getByTestId("admin-user-row-u2").textContent).not.toContain("You");
  });

  it("hides OIDC marks when OIDC isn't configured and nobody is flagged OIDC", async () => {
    m.getUserList.mockResolvedValue({ users: USERS.map((u) => ({ ...u, isOidc: false })) });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    expect(screen.queryByText(/OIDC/)).toBeNull();
  });

  it("shows the OIDC mark when a provider is configured", async () => {
    m.getOIDCConfig.mockResolvedValue({ client_id: "abc" });
    m.getUserList.mockResolvedValue({ users: USERS.map((u) => ({ ...u, isOidc: u.id === "u3" })) });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("admin-user-row-u3").textContent).toContain("OIDC"));
  });

  it("no search box for a short list; past eight users one appears and narrows the list", async () => {
    renderModal();
    await screen.findByTestId("admin-users-pane");
    expect(screen.queryByTestId("admin-users-search")).toBeNull();
    cleanupAndRender([
      ...USERS,
      ...Array.from({ length: 7 }, (_, i) => user({ id: `x${i}`, username: `extra${i}` })),
    ]);
    const search = await screen.findByTestId("admin-users-search");
    await userEvent.type(search, "ril");
    expect(screen.getByTestId("admin-user-row-u2")).toBeTruthy();
    expect(screen.queryByTestId("admin-user-row-me")).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "nobody");
    expect(screen.getByTestId("admin-users-no-matches")).toBeTruthy();
  });
});

function cleanupAndRender(users: AdminUser[]) {
  cleanup();
  m.getUserList.mockResolvedValue({ users });
  renderModal();
}

describe("AdminModal — a user", () => {
  it("opens one level deeper in the same window; ‹ Users goes back", async () => {
    renderModal();
    await openUser("riley");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByTestId("admin-user-name").textContent).toBe("riley");
    expect(screen.getByTestId("admin-user-standing").textContent).toBe("Member");
    expect(screen.queryByTestId("admin-section-hero")).toBeNull();
    await userEvent.click(screen.getByTestId("admin-user-back"));
    expect(await screen.findByTestId("admin-users-pane")).toBeTruthy();
  });

  it("Esc goes back to the list instead of closing the window", async () => {
    const onOpenChange = vi.fn();
    render(<AdminModal open onOpenChange={onOpenChange} currentUserId="me" />);
    await openUser("riley");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByTestId("admin-users-pane")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("picking Users in the side list again goes back to the list", async () => {
    renderModal();
    await openUser("riley");
    await userEvent.click(screen.getByTestId("admin-tab-users"));
    expect(await screen.findByTestId("admin-users-pane")).toBeTruthy();
  });

  it("your own page: Administrator · You, admin switch and delete disabled, with why", async () => {
    renderModal();
    await openUser("alice");
    expect(screen.getByTestId("admin-user-standing").textContent).toBe("Administrator · You");
    expect(sw("admin-user-admin-switch").disabled).toBe(true);
    expect(btn("admin-user-delete").disabled).toBe(true);
    expect(screen.getByText("You can't delete your own account from here.")).toBeTruthy();
  });

  it("won't delete the last admin", async () => {
    m.getUserList.mockResolvedValue({
      users: [user({ id: "me", username: "alice" }), user({ id: "a2", username: "root", isAdmin: true })],
    });
    renderModal();
    await openUser("root");
    expect(btn("admin-user-delete").disabled).toBe(true);
    expect(screen.getByText(/only admin/)).toBeTruthy();
  });

  it("promotes a user after confirmation and reloads the list", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await openUser("riley");
    await userEvent.click(sw("admin-user-admin-switch"));
    await waitFor(() => expect(m.makeUserAdmin).toHaveBeenCalledWith("u2"));
    expect(dialogs.calls[0].opts.title).toMatch(/Make riley an admin/);
    await waitFor(() => expect(m.getUserList).toHaveBeenCalledTimes(2));
  });

  it("declining the admin confirm changes nothing", async () => {
    autoAnswerKitDialogs({ confirm: false });
    renderModal();
    await openUser("riley");
    await userEvent.click(sw("admin-user-admin-switch"));
    expect(m.makeUserAdmin).not.toHaveBeenCalled();
  });

  it("grants push notifications to a non-admin and reloads the list", async () => {
    m.setUserNotificationsEnabled.mockResolvedValue({});
    renderModal();
    await openUser("riley");
    expect(sw("admin-user-notifications-switch").disabled).toBe(false);
    expect(sw("admin-user-notifications-switch").checked).toBe(false);
    await userEvent.click(sw("admin-user-notifications-switch"));
    await waitFor(() => expect(m.setUserNotificationsEnabled).toHaveBeenCalledWith("u2", true));
    await waitFor(() => expect(m.getUserList).toHaveBeenCalledTimes(2));
  });

  it("shows notifications as always on, and locked, for admins", async () => {
    renderModal();
    await openUser("alice");
    expect(sw("admin-user-notifications-switch").disabled).toBe(true);
    expect(sw("admin-user-notifications-switch").checked).toBe(true);
  });

  it("phone: Save appears only once the number changes, and saves it", async () => {
    m.setUserPhone.mockResolvedValue({});
    renderModal();
    await openUser("riley");
    expect(screen.queryByTestId("admin-user-phone-save")).toBeNull();
    await userEvent.type(screen.getByTestId("admin-user-phone-input"), "+17165550100");
    await userEvent.click(screen.getByTestId("admin-user-phone-save"));
    await waitFor(() => expect(m.setUserPhone).toHaveBeenCalledWith("u2", "+17165550100"));
    await waitFor(() => expect(m.getUserList).toHaveBeenCalledTimes(2));
  });

  it("requires the typed username before deleting, then goes back to the list", async () => {
    let typed = "rile";
    const dialogs = autoAnswerKitDialogs({ prompt: () => typed });
    renderModal();
    await openUser("riley");
    await userEvent.click(screen.getByTestId("admin-user-delete"));
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-user-delete-error").textContent).toContain("didn't match");

    // The dialog itself refuses a mismatched name before it resolves.
    const opts = dialogs.calls[0].opts as { validate?: (v: string) => string | null | undefined };
    expect(opts.validate?.("rile")).toBeTruthy();
    expect(opts.validate?.("riley")).toBeFalsy();

    typed = "riley";
    await userEvent.click(screen.getByTestId("admin-user-delete"));
    await waitFor(() => expect(m.deleteUser).toHaveBeenCalledWith("riley"));
    expect(await screen.findByTestId("admin-users-pane")).toBeTruthy();
  });

  it("shows only that user's live sign-ins; log out one, then everywhere", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const base = { deviceType: "web", createdAt: past, lastActiveAt: past };
    m.getSessions.mockResolvedValue({
      sessions: [
        { ...base, id: "s1", userId: "u2", deviceInfo: "Firefox", expiresAt: future },
        { ...base, id: "s5", userId: "u2", deviceInfo: "Safari", expiresAt: future },
        { ...base, id: "s2", userId: "u2", deviceInfo: "Old", expiresAt: past },
        { ...base, id: "s3", userId: "u2", deviceInfo: "Revoked", expiresAt: future, isRevoked: true },
        { ...base, id: "s4", userId: "me", deviceInfo: "Mine", expiresAt: future },
      ],
    });
    m.revokeSession.mockResolvedValue({});
    m.revokeAllUserSessions.mockResolvedValue({});
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    renderModal();
    await openUser("riley");
    expect(await screen.findByTestId("admin-session-s1")).toBeTruthy();
    expect(screen.getByTestId("admin-session-s5")).toBeTruthy();
    expect(screen.queryByTestId("admin-session-s2")).toBeNull();
    expect(screen.queryByTestId("admin-session-s3")).toBeNull();
    expect(screen.queryByTestId("admin-session-s4")).toBeNull();
    expect(screen.getByText("Signed in · 2")).toBeTruthy();

    await userEvent.click(screen.getByTestId("admin-session-revoke-s1"));
    await waitFor(() => expect(m.revokeSession).toHaveBeenCalledWith("s1"));
    expect(dialogs.calls[0].opts.title).toBe("Log out this device?");

    await userEvent.click(screen.getByTestId("admin-user-sessions-revoke-all"));
    await waitFor(() => expect(m.revokeAllUserSessions).toHaveBeenCalledWith("u2", false));
    expect(dialogs.calls[1].opts.title).toBe("Log riley out everywhere?");
  });

  it("says when someone isn't signed in anywhere, with no log-out-everywhere row", async () => {
    renderModal();
    await openUser("riley");
    expect(await screen.findByTestId("admin-user-sessions-empty")).toBeTruthy();
    expect(screen.queryByTestId("admin-user-sessions-revoke-all")).toBeNull();
  });

  it("shows only hosts the user owns", async () => {
    m.getSSHHosts.mockResolvedValue([
      { id: 1, name: "harbor", ip: "10.0.0.1", port: 22, username: "riley", userId: "u2", status: "online" },
      { id: 2, name: "other", ip: "10.0.0.2", port: 22, username: "alice", userId: "me", status: "online" },
    ]);
    renderModal();
    await openUser("riley");
    expect((await screen.findByTestId("admin-user-host-1")).textContent).toContain("harbor");
    expect(screen.queryByTestId("admin-user-host-2")).toBeNull();
    expect(screen.getByText("Hosts · 1")).toBeTruthy();
    expect(m.getSSHHosts).toHaveBeenCalledWith(false);
  });
});

describe("AdminModal — Sign-in", () => {
  it("hides OIDC-only switches when OIDC isn't in use", async () => {
    m.getUserList.mockResolvedValue({ users: USERS.map((u) => ({ ...u, isOidc: false })) });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    await screen.findByTestId("admin-signin-timeout-input");
    expect(screen.queryByTestId("admin-signin-passwordLogin")).toBeNull();
    expect(screen.queryByTestId("admin-signin-oidcAutoProvision")).toBeNull();
    expect(m.getPasswordLoginAllowed).not.toHaveBeenCalled();
  });

  it("has no sign-up or password-reset switches", async () => {
    m.getOIDCConfig.mockResolvedValue({ client_id: "abc" });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    await screen.findByTestId("admin-signin-passwordLogin");
    expect(screen.queryByTestId("admin-signin-registration")).toBeNull();
    expect(screen.queryByTestId("admin-signin-passwordReset")).toBeNull();
    expect(screen.queryByText(/allow registration/i)).toBeNull();
    expect(screen.queryByText(/allow password reset/i)).toBeNull();
  });

  it("shows OIDC-only switches when a provider is configured", async () => {
    m.getOIDCConfig.mockResolvedValue({ client_id: "abc" });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    expect(await screen.findByTestId("admin-signin-passwordLogin")).toBeTruthy();
    expect(screen.getByTestId("admin-signin-oidcAutoProvision")).toBeTruthy();
  });

  it("session length saves when the box is left, with no Save button", async () => {
    const settings = await import("@/api/settings-api");
    (settings.updateSessionTimeout as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    const box = (await screen.findByTestId("admin-signin-timeout-input")) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("24"));
    expect(screen.queryByTestId("admin-signin-timeout-save")).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "48");
    box.blur();
    await waitFor(() => expect(settings.updateSessionTimeout).toHaveBeenCalledWith(48));
    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
  });

  it("an out-of-range session length isn't saved and says what's allowed", async () => {
    const settings = await import("@/api/settings-api");
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    const box = (await screen.findByTestId("admin-signin-timeout-input")) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("24"));
    await userEvent.clear(box);
    await userEvent.type(box, "999");
    box.blur();
    expect(screen.getByText(/between 1 and 720/)).toBeTruthy();
    expect(settings.updateSessionTimeout).not.toHaveBeenCalled();
  });
});

describe("AdminModal — Instance file", () => {
  it("another section or the X with unsaved edits asks first; 'keep editing' stays", async () => {
    const onOpenChange = vi.fn();
    const answers = [false, false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? true });
    render(<AdminModal open onOpenChange={onOpenChange} currentUserId="me" />);
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-instance-file"));
    await userEvent.click(await screen.findByTestId("admin-instance-file-edit"));
    await userEvent.type(await screen.findByRole("textbox"), "!");

    await userEvent.click(screen.getByTestId("admin-tab-users"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(screen.getByRole("textbox")).toBeTruthy();

    await userEvent.click(screen.getByTestId("admin-close"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(2));
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("admin-tab-users"));
    expect(await screen.findByTestId("admin-users-pane")).toBeTruthy();
  });
});

describe("AdminModal — a user (review fixes)", () => {
  it("the back link takes focus when a user opens", async () => {
    renderModal();
    await openUser("riley");
    expect(document.activeElement).toBe(screen.getByTestId("admin-user-back"));
  });

  it("keeps the search across opening someone and coming back", async () => {
    m.getUserList.mockResolvedValue({
      users: [...USERS, ...Array.from({ length: 7 }, (_, i) => user({ id: `x${i}`, username: `extra${i}` }))],
    });
    renderModal();
    await userEvent.type(await screen.findByTestId("admin-users-search"), "ril");
    await userEvent.click(screen.getByTestId("admin-user-row-u2"));
    await userEvent.click(await screen.findByTestId("admin-user-back"));
    expect(((await screen.findByTestId("admin-users-search")) as HTMLInputElement).value).toBe("ril");
    expect(screen.queryByTestId("admin-user-row-me")).toBeNull();
  });

  it("an unsaved phone number is asked about before leaving; Esc in the box puts it back", async () => {
    const answers = [false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? true });
    renderModal();
    await openUser("riley");
    const box = screen.getByTestId("admin-user-phone-input") as HTMLInputElement;
    await userEvent.type(box, "+1716");
    await userEvent.click(screen.getByTestId("admin-user-back"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard the new number?");
    expect(screen.getByTestId("admin-user-view")).toBeTruthy();

    box.focus();
    await userEvent.keyboard("{Escape}");
    expect(box.value).toBe("");
    expect(screen.getByTestId("admin-user-view")).toBeTruthy();

    await userEvent.type(box, "+1");
    await userEvent.click(screen.getByTestId("admin-tab-hosts"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(2));
    expect(await screen.findByTestId("admin-hosts-pane")).toBeTruthy();
  });

  it("your own page with one other device has no log-out-other-devices row (its Log out does that)", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const base = { deviceType: "web", createdAt: past, lastActiveAt: past, userId: "me", expiresAt: future };
    m.getSessions.mockResolvedValue({
      sessions: [
        { ...base, id: "here", deviceInfo: "This one", isCurrentSession: true },
        { ...base, id: "phone", deviceInfo: "Phone" },
      ],
    });
    renderModal();
    await openUser("alice");
    expect(await screen.findByTestId("admin-session-phone")).toBeTruthy();
    expect(screen.getByTestId("admin-session-here").textContent).toContain("This browser");
    expect(screen.queryByTestId("admin-user-sessions-revoke-all")).toBeNull();
  });

  it("the admin switch stays busy until the list has the change", async () => {
    autoAnswerKitDialogs({ confirm: true });
    let release: () => void = () => {};
    renderModal();
    await openUser("riley");
    m.getUserList.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ users: USERS.map((u) => (u.id === "u2" ? { ...u, isAdmin: true } : u)) });
        }),
    );
    await userEvent.click(sw("admin-user-admin-switch"));
    await waitFor(() => expect(m.makeUserAdmin).toHaveBeenCalled());
    expect(sw("admin-user-admin-switch").disabled).toBe(true);
    release();
    await waitFor(() => expect(sw("admin-user-admin-switch").checked).toBe(true));
    expect(sw("admin-user-admin-switch").disabled).toBe(false);
  });
});

describe("AdminModal — Sign-in (review fixes)", () => {
  it("a valid change still saves when the window closes without leaving the box", async () => {
    const settings = await import("@/api/settings-api");
    (settings.updateSessionTimeout as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { rerender } = renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    const box = (await screen.findByTestId("admin-signin-timeout-input")) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("24"));
    // Change the value without moving focus out (no blur fires).
    await userEvent.clear(box);
    await userEvent.type(box, "12");
    (settings.updateSessionTimeout as ReturnType<typeof vi.fn>).mockClear();
    rerender(<AdminModal open={false} onOpenChange={vi.fn()} currentUserId="me" />);
    await waitFor(() => expect(settings.updateSessionTimeout).toHaveBeenCalledWith(12));
  });
});
