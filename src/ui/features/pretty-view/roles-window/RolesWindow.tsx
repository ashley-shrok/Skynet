// RolesWindow — the one roles window (apple-ux shape-roles-modals).
//
// One window that moves between views instead of a stack of modals that
// close each other: the library of roles, one role (picture, name,
// description; role file / skills / files / git tabs), one skill (one
// level deeper), a new-role form and archived roles. The back control — and
// Esc — always goes up exactly one level; the X closes. Leaving a view with
// unsaved edits asks first (each view registers a guard).
//
// Opened from the sidebar's roles button (library), from a role name in an
// agent's window (straight onto that role), and from the new-conversation
// dialog's "New role…" (straight onto the new-role form, whose back/cancel
// and create go back to the new-conversation dialog).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, escBelongsElsewhere } from "@/components/modal";
import type { Host, HostFolder } from "@/types/ui-types";
import { listRolesForHost, type RoleSummary } from "@/api/identities-api";
import { listInstanceWide, type InstanceWideList } from "@/api/instance-wide-api";
import { listArchivedRoles, type ArchivedRoleListEntry } from "@/api/roles-archive-list-api";
import { useIdentities } from "@/state/identities-store";
import { identityRoles } from "@/lib/identity-roles";
import { roleDisplayName } from "@/lib/role-display-name";
import { requestNewConversation } from "@/lib/new-conversation-request";
import type { TabState } from "../IdentityFileTab";
import { RolesLibraryView } from "./RolesLibraryView";
import { RoleView, type RoleTab } from "./RoleView";
import { RoleSkillView } from "./RoleSkillView";
import { requestOpenScheduledTasks } from "@/features/pretty-conversations/open-scheduled-tasks";
import { NewRoleView } from "./NewRoleView";
import { ArchivedRolesView } from "./ArchivedRolesView";

/** The app accent — a role with no colorHue. */
export const ROLE_FALLBACK_HUE = 190;

export function roleHue(role: Pick<RoleSummary, "colorHue">): number {
  return typeof role.colorHue === "number" ? role.colorHue : ROLE_FALLBACK_HUE;
}

/** A role's colour behind its picture (or initial). */
export function roleAvatarColor(hue: number): string {
  return `hsl(${hue}, 42%, 34%)`;
}

function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
export function collectRoleHosts(tree: HostFolder | null): Host[] {
  const out: Host[] = [];
  const walk = (children: (Host | HostFolder)[]) => {
    for (const c of children) {
      if (isFolder(c)) walk(c.children);
      else out.push(c);
    }
  };
  walk(tree?.children ?? []);
  return out.filter((h) => h.enableRdp !== true);
}

export type RolesWindowStart =
  | { view: "library"; hostId?: number | null }
  | { view: "role"; hostId: number; role: RoleSummary }
  | { view: "new"; host?: Host | null };

/** The new-conversation dialog's "New role…" hop: where back and create go. */
export interface NewRoleHop {
  onBack: () => void;
  onCreated: (result: { role: string; host: Host; description: string }) => void;
}

type Nav =
  | { view: "library" }
  | { view: "role"; role: RoleSummary }
  | { view: "skill"; role: RoleSummary; skill: string; description?: string }
  | { view: "new" }
  | { view: "archived" };

/** Why the window closed, when it wasn't simply dismissed. */
/** Why the window closed itself — either way it went somewhere else, so an
 *  agent window it was opened from doesn't come back. */
export type RolesWindowCloseReason = "start-conversation" | "open-scheduled-tasks";

export interface RolesWindowProps {
  open: boolean;
  onOpenChange: (open: boolean, reason?: RolesWindowCloseReason) => void;
  hostTree: HostFolder | null;
  start: RolesWindowStart;
  newRoleHop?: NewRoleHop | null;
  container?: HTMLElement | null;
}

/** A view's "may I leave?" — resolves false to stay. */
export type LeaveGuard = () => Promise<boolean>;
/** A view's own Esc handling — returns true when it used the Esc. */
export type EscapeHandler = () => boolean;

export function RolesWindow({
  open,
  onOpenChange,
  hostTree,
  start,
  newRoleHop,
  container,
}: RolesWindowProps): JSX.Element {
  const flatHosts = useMemo(() => collectRoleHosts(hostTree), [hostTree]);
  const [hostId, setHostId] = useState<number | null>(null);
  const [nav, setNav] = useState<Nav>({ view: "library" });
  const [roleTab, setRoleTab] = useState<RoleTab>("role");
  const [hueOverride, setHueOverride] = useState<number | null>(null);

  const guardRef = useRef<LeaveGuard | null>(null);
  const escapeRef = useRef<EscapeHandler | null>(null);
  const registerGuard = useCallback((g: LeaveGuard | null) => {
    guardRef.current = g;
  }, []);
  const registerEscape = useCallback((h: EscapeHandler | null) => {
    escapeRef.current = h;
  }, []);

  // ── Open / reset ─────────────────────────────────────────────────────────
  // Each open starts a fresh session: the starting view and host are set in
  // the same render the window opens in (no flash of the last session), and
  // the views remount (keyed by session) so they register their own guards.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSession((n) => n + 1);
      setHueOverride(null);
      setRoleTab("role");
      if (start.view === "role") {
        setHostId(start.hostId);
        setNav({ view: "role", role: start.role });
      } else if (start.view === "new") {
        setHostId(start.host ? Number(start.host.id) : flatHosts.length === 1 ? Number(flatHosts[0].id) : null);
        setNav({ view: "new" });
      } else {
        const wanted = start.hostId ?? null;
        setHostId(
          wanted != null && flatHosts.some((h) => Number(h.id) === wanted)
            ? wanted
            : flatHosts.length === 1
              ? Number(flatHosts[0].id)
              : null,
        );
        setNav({ view: "library" });
      }
    }
  }
  useEffect(() => {
    if (open) console.info({ operation: "roles_window_open", start: start.view });
    else {
      guardRef.current = null;
      escapeRef.current = null;
    }
    // Logged once per open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Shared data: shared-role list (also says whether you're an admin),
  //    this host's roles, its archived roles ──────────────────────────────
  const [instanceWide, setInstanceWide] = useState<InstanceWideList | null>(null);
  const [iwKey, setIwKey] = useState(0);
  useEffect(() => {
    if (!open) {
      setInstanceWide(null);
      return;
    }
    let cancelled = false;
    listInstanceWide("role")
      .then((list) => !cancelled && setInstanceWide(list))
      .catch(() => !cancelled && setInstanceWide({ isAdmin: false, items: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, iwKey]);
  const isAdmin = instanceWide?.isAdmin ?? false;

  const [roles, setRoles] = useState<TabState<RoleSummary[]>>({ status: "loading" });
  const [rolesKey, setRolesKey] = useState(0);
  useEffect(() => {
    if (!open || hostId == null) return;
    let cancelled = false;
    setRoles({ status: "loading" });
    listRolesForHost(hostId)
      .then((entries) => {
        if (cancelled) return;
        const sorted = [...entries].sort((a, b) =>
          roleDisplayName(a.name, a.displayName).localeCompare(roleDisplayName(b.name, b.displayName), undefined, {
            sensitivity: "base",
          }),
        );
        setRoles({ status: "ready", data: sorted });
      })
      .catch((err: unknown) => {
        if (!cancelled) setRoles({ status: "error", error: err instanceof Error ? err.message : "Failed to load roles" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, hostId, rolesKey]);

  const [archived, setArchived] = useState<TabState<ArchivedRoleListEntry[]>>({ status: "loading" });
  const [archivedKey, setArchivedKey] = useState(0);
  useEffect(() => {
    if (!open || hostId == null) return;
    let cancelled = false;
    setArchived({ status: "loading" });
    listArchivedRoles(hostId)
      .then((entries) => !cancelled && setArchived({ status: "ready", data: entries }))
      .catch((err: unknown) => {
        if (!cancelled) setArchived({ status: "error", error: err instanceof Error ? err.message : "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, hostId, archivedKey]);

  // ── Agents per role ──────────────────────────────────────────────────────
  // Shared ("instance-wide") — from the role itself or the shared list (a
  // role opened from an agent's window may not carry the flag).
  const isShared = useCallback(
    (role: Pick<RoleSummary, "name" | "instanceWide">): boolean =>
      !!role.instanceWide || !!instanceWide?.items.some((i) => i.name === role.name),
    [instanceWide],
  );

  // A shared role counts its agents on every host.
  const { identities } = useIdentities();
  const agentsHolding = useCallback(
    (role: Pick<RoleSummary, "name" | "instanceWide">): typeof identities => {
      const everyHost = isShared(role);
      return identities.filter((i) => identityRoles(i).includes(role.name) && (everyHost || i.hostId === hostId));
    },
    [identities, hostId, isShared],
  );

  // A new picture keeps its file name, so the library's image needs a fresh URL.
  const [avatarBusts, setAvatarBusts] = useState<Record<string, number>>({});

  // ── Navigation ───────────────────────────────────────────────────────────
  const leave = useCallback(async (): Promise<boolean> => {
    const g = guardRef.current;
    if (g && !(await g())) return false;
    guardRef.current = null;
    escapeRef.current = null;
    return true;
  }, []);

  const go = useCallback(
    async (next: Nav): Promise<void> => {
      if (!(await leave())) return;
      if (next.view !== "role" && next.view !== "skill") setHueOverride(null);
      if (next.view === "role" && nav.view !== "skill") setRoleTab("role");
      console.debug("[RolesWindow] nav", { from: nav.view, to: next.view });
      setNav(next);
    },
    [leave, nav.view],
  );

  const goBack = useCallback(async (): Promise<void> => {
    if (nav.view === "skill") return go({ view: "role", role: nav.role });
    if (nav.view === "new" && newRoleHop) {
      if (!(await leave())) return;
      newRoleHop.onBack();
      return;
    }
    if (nav.view !== "library") return go({ view: "library" });
  }, [nav, go, leave, newRoleHop]);

  const handleOpenChange = useCallback(
    async (next: boolean): Promise<void> => {
      if (next) return onOpenChange(true);
      if (!(await leave())) return;
      onOpenChange(false);
    },
    [leave, onOpenChange],
  );

  // Esc goes up a level (the library closes). A view may use Esc itself
  // first (closing a pop-over, cancelling an edit). Kit dialogs and menus
  // keep their own Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (escBelongsElsewhere(e, document.querySelector("[data-testid='roles-window']"))) return;
      if (escapeRef.current?.()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (nav.view === "library") return;
      e.preventDefault();
      e.stopPropagation();
      void goBack();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, nav.view, goBack]);

  // A role's details changed in its view (description, colour, voice,
  // picture) — keep the library row and the open view in step.
  const patchRole = useCallback((name: string, patch: Partial<RoleSummary>) => {
    if (patch.avatar) setAvatarBusts((b) => ({ ...b, [name]: Date.now() }));
    setRoles((prev) =>
      prev.status === "ready"
        ? { status: "ready", data: prev.data.map((r) => (r.name === name ? { ...r, ...patch } : r)) }
        : prev,
    );
    setNav((prev) =>
      (prev.view === "role" || prev.view === "skill") && prev.role.name === name
        ? { ...prev, role: { ...prev.role, ...patch } }
        : prev,
    );
  }, []);

  const hostName = (id: number | null): string =>
    flatHosts.find((h) => Number(h.id) === id)?.name ?? "this host";

  // ── Render ───────────────────────────────────────────────────────────────
  const hue =
    nav.view === "role" || nav.view === "skill"
      ? (hueOverride ?? roleHue(nav.role))
      : nav.view === "new"
        ? (hueOverride ?? undefined)
        : undefined;
  const size = nav.view === "role" || nav.view === "skill" ? "editor" : "list";

  let body: JSX.Element | null = null;
  if (nav.view === "library") {
    body = (
      <RolesLibraryView
        key={session}
        flatHosts={flatHosts}
        hostId={hostId}
        onHostChange={setHostId}
        roles={roles}
        instanceWide={instanceWide}
        archivedCount={archived.status === "ready" ? archived.data.length : 0}
        agentsFor={(r) => agentsHolding(r).length}
        avatarBusts={avatarBusts}
        onOpenRole={(role) => void go({ view: "role", role })}
        onNewRole={() => void go({ view: "new" })}
        onOpenArchived={() => void go({ view: "archived" })}
      />
    );
  } else if (nav.view === "role" && hostId != null) {
    body = (
      <RoleView
        key={`${session}:${hostId}:${nav.role.name}`}
        hostId={hostId}
        hostName={hostName(hostId)}
        role={nav.role}
        shared={isShared(nav.role)}
        isAdmin={isAdmin}
        instanceWideItem={instanceWide?.items.find((i) => i.name === nav.role.name) ?? null}
        agents={agentsHolding(nav.role)}
        tab={roleTab}
        onTabChange={setRoleTab}
        onBack={() => void goBack()}
        onOpenSkill={(skill, description) => void go({ view: "skill", role: nav.role, skill, description })}
        onRoleChanged={(patch) => patchRole(nav.role.name, patch)}
        onHueDraft={setHueOverride}
        onSharingChanged={() => {
          setIwKey((k) => k + 1);
          setRolesKey((k) => k + 1);
        }}
        onArchived={() => {
          setRoles((prev) =>
            prev.status === "ready" ? { status: "ready", data: prev.data.filter((r) => r.name !== nav.role.name) } : prev,
          );
          setArchivedKey((k) => k + 1);
          void go({ view: "library" });
        }}
        onOpenScheduledTasks={async () => {
          if (!(await leave())) return;
          onOpenChange(false, "open-scheduled-tasks");
          requestOpenScheduledTasks({ role: nav.role.name, hostId });
        }}
        onStartConversation={async () => {
          if (!(await leave())) return;
          requestNewConversation({ hostId, role: nav.role.name });
          onOpenChange(false, "start-conversation");
        }}
        registerGuard={registerGuard}
        registerEscape={registerEscape}
      />
    );
  } else if (nav.view === "skill" && hostId != null) {
    body = (
      <RoleSkillView
        key={`${session}:${hostId}:${nav.role.name}:${nav.skill}`}
        hostId={hostId}
        role={nav.role}
        skill={nav.skill}
        description={nav.description}
        readOnly={isShared(nav.role) && !isAdmin}
        onBack={() => void goBack()}
        onClose={() => void handleOpenChange(false)}
        onDeleted={() => {
          guardRef.current = null;
          setRoleTab("skills");
          setNav({ view: "role", role: nav.role });
        }}
        onRenamed={(newName) => {
          // Nothing unsaved is left behind: a rename only starts from a clean
          // view, or saves the edited main file along with it.
          guardRef.current = null;
          setNav({ view: "skill", role: nav.role, skill: newName, description: nav.description });
        }}
        registerGuard={registerGuard}
        registerEscape={registerEscape}
      />
    );
  } else if (nav.view === "new") {
    body = (
      <NewRoleView
        key={session}
        flatHosts={flatHosts}
        initialHostId={hostId}
        backLabel={newRoleHop ? "Back" : "Roles"}
        onBack={() => void goBack()}
        onHueDraft={setHueOverride}
        registerGuard={registerGuard}
        onCreated={async ({ role, host, description }) => {
          guardRef.current = null;
          if (newRoleHop) {
            newRoleHop.onCreated({ role, host, description });
            return;
          }
          const createdHostId = Number(host.id);
          setHostId(createdHostId);
          setRolesKey((k) => k + 1);
          let summary: RoleSummary = { name: role, description };
          try {
            summary = (await listRolesForHost(createdHostId)).find((r) => r.name === role) ?? summary;
          } catch {
            // The role exists; its view loads what it needs on its own.
          }
          setHueOverride(null);
          setRoleTab("role");
          setNav({ view: "role", role: summary });
        }}
      />
    );
  } else if (nav.view === "archived" && hostId != null) {
    body = (
      <ArchivedRolesView
        key={session}
        hostId={hostId}
        hostName={hostName(hostId)}
        archived={archived}
        onBack={() => void goBack()}
        onRestored={() => setRolesKey((k) => k + 1)}
      />
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => void handleOpenChange(o)}
      size={size}
      hue={hue}
      container={container ?? undefined}
      data-testid="roles-window"
    >
      {body}
    </Modal>
  );
}

export default RolesWindow;
