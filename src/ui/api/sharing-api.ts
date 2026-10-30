import { authApi, handleApiError } from "@/main-axios";

// "Shared with" — who can see an agent, role or project on a machine more
// than one person uses.
//
//   GET  /sharing?hostId&kind&slug   → ShareState
//   POST /sharing/plan               → SharePlanSummary (what a change reaches)
//   PUT  /sharing                    → ShareState, or { gone: true } when the
//                                      caller took themselves off

export type ShareKind = "agent" | "role" | "project";

/** A role (agents) or a project above it (projects) that keeps it hidden from someone. */
export interface ShareHiderRef {
  kind: "role" | "project";
  name: string;
  label: string;
  /** "Share role" can fix it here (not a role kept on every machine, never a project). */
  fixable: boolean;
}

export type ShareState =
  | { multiUser: false }
  | {
      multiUser: true;
      /** The caller's username. */
      you: string;
      /** Everyone with access to the machine. */
      people: string[];
      /** The thing's own list; null = it has none. */
      users: string[] | null;
      /** Who shows ticked: its own list, or who can see it without one. */
      ticked: string[];
      /** Ticked but no longer on the machine. */
      former: string[];
      /** person → roles (agents) or projects above (projects) that keep it hidden from them. */
      hiddenBy: Record<string, ShareHiderRef[]>;
      instanceWide: boolean;
    };

export interface SharePlanSummary {
  added: string[];
  removed: string[];
  rolesToShare: Array<{ name: string; label: string; people: string[] }>;
  /** Names of what else it shares that the caller can see; `hidden` counts the rest. */
  alsoShared: { projects: string[]; agents: string[]; roles: string[]; hidden: number };
  alsoUnshared: { projects: string[]; agents: string[]; hidden: number };
  keptShared: Array<{ agent: string; people: string[] }>;
  keptHidden: number;
  disappearing: string[];
  disappearingHidden: number;
}

export interface ShareTarget {
  hostId: number;
  kind: ShareKind;
  slug: string;
}

/** People ticked and unticked — applied to the list as it is on the server now. */
export interface ShareChange {
  add?: string[];
  remove?: string[];
  shareRoles?: boolean;
  shareRolesFor?: string[];
}

export async function getSharing(t: ShareTarget): Promise<ShareState> {
  try {
    const response = await authApi.get("/sharing", { params: t });
    return response.data as ShareState;
  } catch (error) {
    handleApiError(error, "load who it's shared with");
  }
}

export async function planSharing(t: ShareTarget, change: ShareChange): Promise<SharePlanSummary> {
  try {
    const response = await authApi.post("/sharing/plan", { ...t, ...change });
    return response.data as SharePlanSummary;
  } catch (error) {
    handleApiError(error, "check a sharing change");
  }
}

export async function applySharing(
  t: ShareTarget,
  change: ShareChange,
): Promise<ShareState | { gone: true }> {
  try {
    const response = await authApi.put("/sharing", { ...t, ...change });
    return response.data as ShareState | { gone: true };
  } catch (error) {
    handleApiError(error, "change who it's shared with");
  }
}
