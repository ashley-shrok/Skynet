/**
 * AdminModal — the admin control surface, opened from the shield button in
 * the sidebar footer. Only mounted for admins; every call it makes is
 * admin-gated on the backend regardless.
 *
 * Sections (side list on desktop, drill-in on mobile):
 *   - Users:   every user; a row opens AdminUserModal for that user.
 *   - Sign-in: registration / password-reset policy and session timeout.
 *   - System:  version + update check, database health, log level.
 *   - Hosts:   every machine Skynet knows about — reachability, resources,
 *              agent-host health.
 *
 * "OIDC in use" is decided once here and threaded down: true when an OIDC
 * provider is configured or any existing user signed up through OIDC.
 * Instances without OIDC see no OIDC controls or badges.
 */

import { useCallback, useEffect, useState } from "react";
import { LogIn, Server, SlidersHorizontal, Users } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalFoot,
  ModalHead,
  ModalSidebar,
  type ModalTabDef,
} from "@/components/modal";
import { getUserList, type AdminUser } from "@/api/user-management-api";
import { getOIDCConfig } from "@/main-axios";
import { AdminButton, adminErrorMessage } from "./admin-ui";
import { AdminUsersPane } from "./AdminUsersPane";
import { AdminSignInPane } from "./AdminSignInPane";
import { AdminSystemPane } from "./AdminSystemPane";
import { AdminHostsPane } from "./AdminHostsPane";
import AdminUserModal from "./AdminUserModal";

type AdminTab = "users" | "signin" | "system" | "hosts";

const TABS: ReadonlyArray<ModalTabDef<AdminTab>> = [
  { value: "users", label: "Users", Icon: Users },
  { value: "signin", label: "Sign-in", Icon: LogIn },
  { value: "system", label: "System", Icon: SlidersHorizontal },
  { value: "hosts", label: "Hosts", Icon: Server },
];

export interface AdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}

export default function AdminModal({
  open,
  onOpenChange,
  currentUserId,
}: AdminModalProps) {
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const { users: list } = await getUserList();
      setUsers(list);
      setUsersError(null);
    } catch (err) {
      setUsersError(adminErrorMessage(err, "Failed to load users."));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setTab("users");
      setSelectedUserId(null);
      return;
    }
    void loadUsers();
    getOIDCConfig()
      .then((cfg) => setOidcConfigured(!!cfg && !!cfg.client_id))
      .catch(() => setOidcConfigured(false));
  }, [open, loadUsers]);

  const oidcInUse = oidcConfigured || (users ?? []).some((u) => u.isOidc);
  const selectedUser = users?.find((u) => u.id === selectedUserId) ?? null;
  const adminCount = (users ?? []).filter((u) => u.isAdmin).length;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        size="settings"
        data-testid="admin-modal"
      >
        <ModalHead title="Admin" />
        {/* Side list on desktop, drill-in on mobile — same shape as
            Preferences. ModalSidebar re-mounts with the modal, so every
            open starts on the list on a phone. */}
        <ModalSidebar<AdminTab>
          tabs={TABS}
          value={tab}
          onValueChange={setTab}
          testIdPrefix="admin-tab"
          backLabel="Admin"
        >
          <ModalBody className="p-0">
            {tab === "users" && (
              <AdminUsersPane
                users={users}
                error={usersError}
                currentUserId={currentUserId}
                oidcInUse={oidcInUse}
                onOpenUser={setSelectedUserId}
              />
            )}
            {tab === "signin" && <AdminSignInPane oidcInUse={oidcInUse} />}
            {tab === "system" && <AdminSystemPane />}
            {tab === "hosts" && <AdminHostsPane />}
          </ModalBody>
        </ModalSidebar>
        <ModalFoot>
          <AdminButton
            data-testid="admin-close-foot"
            onClick={() => onOpenChange(false)}
          >
            Close
          </AdminButton>
        </ModalFoot>
      </Modal>

      <AdminUserModal
        user={open ? selectedUser : null}
        currentUserId={currentUserId}
        adminCount={adminCount}
        oidcInUse={oidcInUse}
        onOpenChange={(o) => {
          if (!o) setSelectedUserId(null);
        }}
        onUserChanged={() => void loadUsers()}
        onUserDeleted={() => {
          setSelectedUserId(null);
          void loadUsers();
        }}
      />
    </>
  );
}
