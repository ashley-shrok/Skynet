// An archived agent, as the archived conversation tab and its view-only agent
// window see it. The look comes from the server (read from the agent's
// archived identity file) or, before that lands, from the search result that
// opened the tab.

import type { Identity } from "@/api/identities-api";
import type { ArchivedIdentityLook } from "@/api/claude-session-api";
import type { ConversationSearchResult } from "@/api/conversation-search-api";

/** The archived agent as an Identity, so the pill and window paint as usual. */
export function identityFromArchivedLook(look: ArchivedIdentityLook): Identity {
  return {
    identityKey: look.identityKey,
    hostId: look.hostId,
    displayName: look.displayName,
    title: look.title,
    colorHue: look.colorHue,
    voice: look.voice,
    role: look.role,
    roles: look.roles,
    avatarMime: "",
    avatarUrl: look.avatarUrl,
    avatarEtag: "",
    coordinator: false,
    task: look.task,
    project: null,
    pinned: false,
  };
}

/** A first look from the search result, used until the server's arrives. */
export function archivedLookFromSearchResult(r: ConversationSearchResult): ArchivedIdentityLook {
  const roles = (r.roles ?? []).map((x) => x.slug);
  return {
    identityKey: r.identityKey,
    hostId: r.hostId,
    displayName: r.displayName ?? r.identityKey,
    title: null,
    colorHue: r.colorHue ?? null,
    voice: null,
    task: r.task ?? null,
    role: roles.length === 1 ? roles[0] : null,
    roles,
    archivedRoles: [],
    roleDisplayNames: Object.fromEntries((r.roles ?? []).map((x) => [x.slug, x.displayName ?? null])),
    avatarUrl: r.avatarUrl ?? "",
  };
}

// Looks handed over by search when it opens a tab, keyed `${hostId}::${key}`,
// so the tab paints with the right name and colour before the server answers.
const seededLooks = new Map<string, ArchivedIdentityLook>();

export function seedArchivedLook(look: ArchivedIdentityLook): void {
  seededLooks.set(`${look.hostId}::${look.identityKey.toLowerCase()}`, look);
}

export function seededArchivedLook(hostId: number, identityKey: string): ArchivedIdentityLook | null {
  return seededLooks.get(`${hostId}::${identityKey.toLowerCase()}`) ?? null;
}

// ─── Turning an archived tab into the live conversation ─────────────────────
//
// The archived tab asks; AppShell (which owns the tab list) flips the tab's
// kind in place, so the same tab, split position and window carry on as the
// live conversation.

export const ARCHIVED_TAB_LIVE_EVENT = "skynet:archived-tab-live";

export type ArchivedTabLiveDetail = { tabId: string };

export function requestArchivedTabLive(tabId: string): void {
  console.info(`[archived-view] request-live tabId=${tabId}`);
  window.dispatchEvent(new CustomEvent<ArchivedTabLiveDetail>(ARCHIVED_TAB_LIVE_EVENT, { detail: { tabId } }));
}

// ─── Archiving closes every open copy ───────────────────────────────────────
//
// Fired when this browser archives an agent (sidebar row, pill, drop lane);
// AppShell closes every tab of that conversation in this window. Other
// windows and devices hear it from the server (`archived_state`).

export const AGENT_ARCHIVED_EVENT = "skynet:agent-archived";

export type AgentArchivedDetail = { hostId: number; identityKey: string };

export function announceAgentArchived(hostId: number, identityKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentArchivedDetail>(AGENT_ARCHIVED_EVENT, { detail: { hostId, identityKey } }),
  );
}

// ─── The agent window carries over when the tab turns live ──────────────────
//
// Turning live remounts the conversation view, so an agent window open on the
// archived tab would close. The archived pane notes it here just before it
// asks to turn live; the live view takes it on mount and reopens the window
// on the same tab (now editable).

/** What the archived view reports about its agent window, kept current. */
export type AgentWindowState = { open: boolean; tab?: string };

const windowReopens = new Map<string, string | undefined>();

export function noteAgentWindowReopen(tabId: string, tab: string | undefined): void {
  windowReopens.set(tabId, tab);
}

/** The window to reopen for this tab, once (null when none). */
export function takeAgentWindowReopen(tabId: string): { tab: string | undefined } | null {
  if (!windowReopens.has(tabId)) return null;
  const tab = windowReopens.get(tabId);
  windowReopens.delete(tabId);
  return { tab };
}
