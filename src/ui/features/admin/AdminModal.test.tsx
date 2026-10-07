/**
 * AdminModal + AdminUserModal tests
 *
 *   Users tab
 *     - lists every user, sorted, with Admin / You badges
 *     - no OIDC badge when OIDC isn't in use; badge appears when it is
 *     - clicking a row opens that user's modal
 *   User modal
 *     - own row: admin switch + delete disabled
 *     - last admin can't be deleted
 *     - promote calls makeUserAdmin after confirm, then re-fetches the list
 *     - delete needs the typed username; a mismatch deletes nothing
 *     - Sessions tab only shows that user's live sessions
 *     - Hosts tab only shows hosts that user owns
 *   Sign-in tab
 *     - OIDC-only toggles hidden without OIDC, shown with it
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminUser } from "@/api/user-management-api";
import AdminModal from "./AdminModal";

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
  getPasswordResetAllowed: vi.fn(),
  getOidcAutoProvision: vi.fn(),
  getOIDCConfig: vi.fn(),
  getRegistrationAllowed: vi.fn(),
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
  getPasswordResetAllowed: m.getPasswordResetAllowed,
  getOidcAutoProvision: m.getOidcAutoProvision,
  updateRegistrationAllowed: vi.fn(),
  updatePasswordResetAllowed: vi.fn(),
  updatePasswordLoginAllowed: vi.fn(),
  updateOidcAutoProvision: vi.fn(),
}));

vi.mock("@/main-axios", () => ({
  getOIDCConfig: m.getOIDCConfig,
  getRegistrationAllowed: m.getRegistrationAllowed,
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

vi.mock("@/api/ssh-host-management-api", () => ({
  getSSHHosts: m.getSSHHosts,
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
    username: "ashley",
    isAdmin: true,
    mxid: "@ashley_human:skynet",
  }),
  user({ id: "u2", username: "zoey" }),
  user({ id: "u3", username: "bob", isOidc: true }),
];

function renderModal() {
  return render(<AdminModal open onOpenChange={vi.fn()} currentUserId="me" />);
}

async function openUser(name: string) {
  const row = await screen.findByText(name);
  await userEvent.click(row);
  return screen.findByTestId("admin-user-modal");
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getUserList.mockResolvedValue({ users: USERS });
  m.getOIDCConfig.mockResolvedValue(null);
  m.getRegistrationAllowed.mockResolvedValue({ allowed: true });
  m.getPasswordLoginAllowed.mockResolvedValue({ allowed: true });
  m.getPasswordResetAllowed.mockResolvedValue(false);
  m.getOidcAutoProvision.mockResolvedValue({ enabled: false });
  m.getSessions.mockResolvedValue({ sessions: [] });
  m.getSSHHosts.mockResolvedValue([]);
  m.makeUserAdmin.mockResolvedValue({});
  m.deleteUser.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminModal — Users tab", () => {
  it("lists users sorted by name with Admin and You badges", async () => {
    renderModal();
    const pane = await screen.findByTestId("admin-users-pane");
    const rows = within(pane).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("ashley"),
      expect.stringContaining("bob"),
      expect.stringContaining("zoey"),
    ]);
    const me = screen.getByTestId("admin-user-row-me");
    expect(me.textContent).toContain("You");
    expect(me.textContent).toContain("Admin");
  });

  it("hides OIDC badges when OIDC isn't configured and nobody is flagged OIDC", async () => {
    m.getUserList.mockResolvedValue({
      users: USERS.map((u) => ({ ...u, isOidc: false })),
    });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    expect(screen.queryByText("OIDC")).toBeNull();
  });

  it("shows the OIDC badge when a provider is configured", async () => {
    m.getOIDCConfig.mockResolvedValue({ client_id: "abc" });
    m.getUserList.mockResolvedValue({
      users: USERS.map((u) => ({ ...u, isOidc: u.id === "u3" })),
    });
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("admin-user-row-u3").textContent).toContain(
        "OIDC",
      ),
    );
  });

  it("opens the user's modal when a row is clicked", async () => {
    renderModal();
    const modal = await openUser("zoey");
    expect(within(modal).getByTestId("admin-user-account")).toBeTruthy();
  });
});

describe("AdminUserModal", () => {
  it("disables the admin switch and delete on your own account", async () => {
    renderModal();
    await openUser("ashley");
    expect(
      (screen.getByTestId("admin-user-admin-switch") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("admin-user-delete") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("won't delete the last admin", async () => {
    m.getUserList.mockResolvedValue({
      users: [
        user({ id: "me", username: "ashley" }),
        user({ id: "a2", username: "root", isAdmin: true }),
      ],
    });
    renderModal();
    await openUser("root");
    expect(
      (screen.getByTestId("admin-user-delete") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/only admin/)).toBeTruthy();
  });

  it("promotes a user after confirmation and reloads the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderModal();
    await openUser("zoey");
    await userEvent.click(screen.getByTestId("admin-user-admin-switch"));
    await waitFor(() => expect(m.makeUserAdmin).toHaveBeenCalledWith("u2"));
    await waitFor(() => expect(m.getUserList).toHaveBeenCalledTimes(2));
  });

  it("grants push notifications to a non-admin and reloads the list", async () => {
    m.setUserNotificationsEnabled.mockResolvedValue({});
    renderModal();
    await openUser("zoey");
    const sw = screen.getByTestId(
      "admin-user-notifications-switch",
    ) as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    await waitFor(() =>
      expect(m.setUserNotificationsEnabled).toHaveBeenCalledWith("u2", true),
    );
    await waitFor(() => expect(m.getUserList).toHaveBeenCalledTimes(2));
  });

  it("shows notifications as always on, and locked, for admins", async () => {
    renderModal();
    await openUser("ashley");
    const sw = screen.getByTestId(
      "admin-user-notifications-switch",
    ) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("requires the typed username before deleting", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("zoe");
    renderModal();
    await openUser("zoey");
    await userEvent.click(screen.getByTestId("admin-user-delete"));
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-user-delete-error").textContent).toContain(
      "didn't match",
    );

    prompt.mockReturnValue("zoey");
    await userEvent.click(screen.getByTestId("admin-user-delete"));
    await waitFor(() => expect(m.deleteUser).toHaveBeenCalledWith("zoey"));
    await waitFor(() =>
      expect(screen.queryByTestId("admin-user-modal")).toBeNull(),
    );
  });

  it("shows only that user's live sessions", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const base = { deviceType: "web", createdAt: past, lastActiveAt: past };
    m.getSessions.mockResolvedValue({
      sessions: [
        {
          ...base,
          id: "s1",
          userId: "u2",
          deviceInfo: "Firefox",
          expiresAt: future,
        },
        { ...base, id: "s2", userId: "u2", deviceInfo: "Old", expiresAt: past },
        {
          ...base,
          id: "s3",
          userId: "u2",
          deviceInfo: "Revoked",
          expiresAt: future,
          isRevoked: true,
        },
        {
          ...base,
          id: "s4",
          userId: "me",
          deviceInfo: "Mine",
          expiresAt: future,
        },
      ],
    });
    renderModal();
    await openUser("zoey");
    await userEvent.click(screen.getByTestId("admin-user-tab-sessions"));
    expect(await screen.findByTestId("admin-session-s1")).toBeTruthy();
    expect(screen.queryByTestId("admin-session-s2")).toBeNull();
    expect(screen.queryByTestId("admin-session-s3")).toBeNull();
    expect(screen.queryByTestId("admin-session-s4")).toBeNull();
  });

  it("shows only hosts the user owns", async () => {
    m.getSSHHosts.mockResolvedValue([
      {
        id: 1,
        name: "t1000",
        ip: "10.0.0.1",
        port: 22,
        username: "zoey",
        userId: "u2",
        status: "online",
      },
      {
        id: 2,
        name: "other",
        ip: "10.0.0.2",
        port: 22,
        username: "ashley",
        userId: "me",
        status: "online",
      },
    ]);
    renderModal();
    await openUser("zoey");
    await userEvent.click(screen.getByTestId("admin-user-tab-hosts"));
    expect((await screen.findByTestId("admin-host-1")).textContent).toContain(
      "t1000",
    );
    expect(screen.queryByTestId("admin-host-2")).toBeNull();
    expect(m.getSSHHosts).toHaveBeenCalledWith(false);
  });
});

describe("AdminModal — Sign-in tab", () => {
  it("hides OIDC-only toggles when OIDC isn't in use", async () => {
    m.getUserList.mockResolvedValue({
      users: USERS.map((u) => ({ ...u, isOidc: false })),
    });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    await screen.findByTestId("admin-signin-registration");
    expect(screen.queryByTestId("admin-signin-passwordLogin")).toBeNull();
    expect(screen.queryByTestId("admin-signin-oidcAutoProvision")).toBeNull();
    expect(m.getPasswordLoginAllowed).not.toHaveBeenCalled();
  });

  it("shows OIDC-only toggles when a provider is configured", async () => {
    m.getOIDCConfig.mockResolvedValue({ client_id: "abc" });
    renderModal();
    await screen.findByTestId("admin-users-pane");
    await userEvent.click(screen.getByTestId("admin-tab-signin"));
    expect(
      await screen.findByTestId("admin-signin-passwordLogin"),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-signin-oidcAutoProvision")).toBeTruthy();
  });
});
