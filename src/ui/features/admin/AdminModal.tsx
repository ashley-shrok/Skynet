/**
 * AdminModal — the admin control surface, opened from the crown button in
 * the sidebar footer (apple-ux shape-admin-modals). Only mounted for admins;
 * every call it makes is admin-gated on the backend regardless.
 *
 * Same family as Preferences: "Admin" over a side list, each section opening
 * with a header that says what it's for, settings that save as they change
 * (no Close button — the X closes).
 *
 *   - Users:    everyone, admins first; a user opens one level deeper in the
 *               same window (access, phone, keys, where they're signed in,
 *               their hosts, delete).
 *   - Hosts:    every host Skynet knows about, the ones that need
 *               attention first; a host opens one level deeper.
 *   - Sign-in:  registration / password-reset policy and session length.
 *   - Instance file: the CLAUDE.md every host gets at
 *               /etc/claude-code/CLAUDE.md — read, then Edit.
 *   - System (pinned at the bottom): version, database, log level, voice.
 *
 * "OIDC in use" is decided once here and threaded down: true when an OIDC
 * provider is configured or any existing user signed up through OIDC.
 * Instances without OIDC see no OIDC controls or badges.
 *
 * Leaving the instance file with unsaved edits asks first (switching
 * section, going back on a phone, Esc, the X).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, LogIn, Server, SlidersHorizontal, Users } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalHead,
  ModalSidebar,
  useModalDrillIn,
  type ModalSidebarTabDef,
} from "@/components/modal";
import { KitSectionHero } from "@/components/kit";
import { getUserList, type AdminUser } from "@/api/user-management-api";
import { getOIDCConfig } from "@/main-axios";
import { adminErrorMessage } from "./admin-ui";
import { AdminUsersPane } from "./AdminUsersPane";
import { AdminSignInPane } from "./AdminSignInPane";
import { AdminSystemPane } from "./AdminSystemPane";
import { AdminHostsPane } from "./AdminHostsPane";
import { AdminInstanceFilePane } from "./AdminInstanceFilePane";
import { AdminUserView } from "./AdminUserView";

type AdminTab = "users" | "hosts" | "signin" | "instance-file" | "system";

const SECTIONS: ReadonlyArray<ModalSidebarTabDef<AdminTab>> = [
  { value: "users", label: "Users", Icon: Users },
  { value: "hosts", label: "Hosts", Icon: Server },
  { value: "signin", label: "Sign-in", Icon: LogIn },
  { value: "instance-file", label: "Instance file", Icon: FileText },
  { value: "system", label: "System", Icon: SlidersHorizontal, pinned: true },
];

/** What each section is for — the line under its name. */
const HERO_COPY: Record<AdminTab, string> = {
  users: "Everyone with an account on this instance. Open someone to change their access or sign them out.",
  hosts: "Every host this app connects to, how it's doing, and whether its agents are running.",
  signin: "Who can make an account, and how long a sign-in lasts.",
  "instance-file": "Instructions every agent on every host starts with.",
  system: "The version this instance runs, its database, logging and voice services.",
};

/** Asked before leaving a section; resolves false to stay. */
export type AdminLeaveGuard = () => Promise<boolean>;

export interface AdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}

export default function AdminModal({ open, onOpenChange, currentUserId }: AdminModalProps) {
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedHostKey, setSelectedHostKey] = useState<string | null>(null);
  // Kept here so going into a user and back keeps what was typed.
  const [userQuery, setUserQuery] = useState("");
  const rawDrill = useModalDrillIn<AdminTab>(tab, false, open);

  // The instance file and a user's page (an unsaved phone number) register
  // this while they hold unsaved edits.
  const leaveGuard = useRef<AdminLeaveGuard | null>(null);
  const registerLeaveGuard = useCallback((guard: AdminLeaveGuard | null) => {
    leaveGuard.current = guard;
  }, []);
  const mayLeave = useCallback(async () => (leaveGuard.current ? leaveGuard.current() : true), []);

  /** False when the list couldn't be loaded (the Users list shows why). */
  const loadUsers = useCallback(async (): Promise<boolean> => {
    try {
      const { users: list } = await getUserList();
      setUsers(list);
      setUsersError(null);
      return true;
    } catch (err) {
      setUsersError(adminErrorMessage(err, "Failed to load users."));
      return false;
    }
  }, []);
  // A user page's change was saved; it reads the result from the list, so a
  // list that won't load is its error to show.
  const refreshAfterUserChange = useCallback(async () => {
    if (!(await loadUsers())) {
      throw new Error("Saved, but the user list couldn't be reloaded — close and reopen Admin to see the change.");
    }
  }, [loadUsers]);

  useEffect(() => {
    if (!open) {
      setTab("users");
      setSelectedUserId(null);
      setSelectedHostKey(null);
      setUserQuery("");
      leaveGuard.current = null;
      return;
    }
    void loadUsers();
    getOIDCConfig()
      .then((cfg) => setOidcConfigured(!!cfg && !!cfg.client_id))
      .catch(() => setOidcConfigured(false));
  }, [open, loadUsers]);

  const pickTab = useCallback(
    async (next: AdminTab) => {
      if (!(await mayLeave())) return;
      setSelectedUserId(null);
      setSelectedHostKey(null);
      setTab(next);
    },
    [mayLeave],
  );
  const drill = {
    ...rawDrill,
    // Picking the open section again lands on its top level.
    drillIn: () => {
      void mayLeave().then((ok) => {
        if (!ok) return;
        setSelectedUserId(null);
        setSelectedHostKey(null);
        rawDrill.drillIn();
      });
    },
    // Back to the section list (phone): a deeper view doesn't stay behind.
    back: () => {
      void mayLeave().then((ok) => {
        if (!ok) return;
        setSelectedUserId(null);
        setSelectedHostKey(null);
        rawDrill.back();
      });
    },
  };
  const leaveUser = useCallback(async () => {
    if (await mayLeave()) setSelectedUserId(null);
  }, [mayLeave]);
  const handleOpenChange = useCallback(
    async (next: boolean) => {
      if (next) return onOpenChange(true);
      if (!(await mayLeave())) return;
      onOpenChange(false);
    },
    [mayLeave, onOpenChange],
  );

  const oidcInUse = oidcConfigured || (users ?? []).some((u) => u.isOidc);
  const selectedUser = users?.find((u) => u.id === selectedUserId) ?? null;
  const adminCount = (users ?? []).filter((u) => u.isAdmin).length;
  const fullscreen = rawDrill.fullscreen;
  const section = SECTIONS.find((s) => s.value === tab)!;
  const deeper = (tab === "users" && selectedUser !== null) || (tab === "hosts" && selectedHostKey !== null);

  const hero = deeper ? null : (
    <KitSectionHero
      icon={section.Icon ? <section.Icon /> : null}
      title={section.label}
      description={HERO_COPY[tab]}
      className="mb-5"
      data-testid="admin-section-hero"
    />
  );

  // A new level starts at the top, not at the list's scroll position. The
  // body stays mounted across levels so the hosts list keeps what it loaded.
  const paneRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [selectedUserId, selectedHostKey]);

  const body =
    tab === "instance-file" ? (
      <AdminInstanceFilePane hero={hero} registerLeaveGuard={registerLeaveGuard} />
    ) : (
      <ModalBody key={tab} ref={paneRef} data-testid="admin-modal-pane" className="pt-1 pb-7">
        <div className="max-w-[600px] mx-auto">
          {hero}
          {tab === "users" &&
            (selectedUser ? (
              <AdminUserView
                key={selectedUser.id}
                user={selectedUser}
                currentUserId={currentUserId}
                adminCount={adminCount}
                oidcInUse={oidcInUse}
                onBack={() => void leaveUser()}
                registerLeaveGuard={registerLeaveGuard}
                onUserChanged={refreshAfterUserChange}
                onUserDeleted={() => {
                  setSelectedUserId(null);
                  void loadUsers();
                }}
              />
            ) : (
              <AdminUsersPane
                users={users}
                error={usersError}
                currentUserId={currentUserId}
                oidcInUse={oidcInUse}
                query={userQuery}
                onQueryChange={setUserQuery}
                onOpenUser={setSelectedUserId}
              />
            ))}
          {tab === "hosts" && (
            <AdminHostsPane selectedKey={selectedHostKey} onSelect={setSelectedHostKey} />
          )}
          {tab === "signin" && <AdminSignInPane oidcInUse={oidcInUse} />}
          {tab === "system" && <AdminSystemPane />}
        </div>
      </ModalBody>
    );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => void handleOpenChange(next)}
      // The instance file and the hosts list carry a lot; they get the big size.
      size={tab === "instance-file" || tab === "hosts" ? "editor" : "settings"}
      data-testid="admin-modal"
    >
      {fullscreen && (
        <ModalHead
          title={rawDrill.drilled ? <span className="sr-only">Admin</span> : "Admin"}
          closeTestId="admin-close"
          className={rawDrill.drilled ? "pb-0" : undefined}
        />
      )}
      <ModalSidebar<AdminTab>
        tabs={SECTIONS}
        value={tab}
        onValueChange={(v) => void pickTab(v)}
        testIdPrefix="admin-tab"
        rowTestId="admin-modal-nav"
        backLabel="Admin"
        width={224}
        drill={drill}
        grouped
        header={
          fullscreen ? undefined : (
            <div className="pt-4">
              <div className="px-2.5 pb-3 text-[13px] font-semibold text-[var(--k-t3)]">Admin</div>
            </div>
          )
        }
        className={
          fullscreen
            ? undefined
            : "[&>aside]:border-r [&>aside]:border-[var(--k-hair)] [&>aside]:bg-white/[0.012]"
        }
      >
        {!fullscreen && (
          <ModalHead
            title={<span className="sr-only">Admin</span>}
            closeTestId="admin-close"
            className="pb-0 min-h-[52px]"
          />
        )}
        {/* On a phone the section list replaces the section, so nothing
            behind it keeps polling or listening for Esc. */}
        {fullscreen && !rawDrill.drilled ? null : body}
      </ModalSidebar>
    </Modal>
  );
}
