/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent } from "@/components/sheet";
import { ChevronLeft } from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo, createRef, startTransition } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
// Phase 70 Plan 04: branding config (three prior hardcoded-brand fallback
// replacements below) + favicon side-effect hook. Hooks are consumers of
// Plan 70-03's module-singleton store; brandingConfig is closed over by
// the tab-init / document.title / tab-reset fallback chains that used to
// hardcode the brand string.
import { useBrandingConfig } from "@/branding/branding-store";
import { useGamepadTabNav } from "@/hooks/use-gamepad-tab-nav";
import { useKeyboardTabNav } from "@/hooks/use-keyboard-tab-nav";
import { useKeyboardCloseTab } from "@/hooks/use-keyboard-close-tab";
import { useKeyboardMessageQueue } from "@/hooks/use-keyboard-message-queue";
import { useKeyboardTogglePrettyMode } from "@/hooks/use-keyboard-toggle-pretty-mode";
// Phase 121 Plan 04: feedback pipeline UI wire.
//   - useKeyboardTriggerFeedbackDev: dev-only Ctrl+Alt+F / Ctrl+Alt+T chord.
//     Hook is a no-op in production builds (import.meta.env.DEV gate).
//   - FeedbackModal: shared composition modal (general + thumbs_down variants).
//   - postFeedback: authApi.post wrapper for POST /feedback.
//   - fetchFeedbackConfig: GET /api/feedback/enabled; MUST fire after auth,
//     which is why it lives in AppShell's mount useEffect (AppShell only
//     renders post-auth) rather than in src/main.tsx alongside branding.
import { useKeyboardTriggerFeedbackDev } from "@/hooks/use-keyboard-trigger-feedback-dev";
import { FeedbackModal } from "@/feedback/FeedbackModal";
import { postFeedback } from "@/feedback/feedback-api";
import { fetchFeedbackConfig } from "@/feedback/feedback-fetch";
import type { IdentityPaneHandle } from "@/features/terminal/terminal-types";
import { CommandPalette } from "@/shell/CommandPalette";
// Phase 11 Plan 03 (PURGE-02, PURGE-03): AppRail + RailView + 10 sidebar-panel
// imports (HostsPanel, SessionsPanel, QuickConnectPanel, SshToolsPanel,
// SnippetsPanel, HistoryPanel, SplitScreenPanel, UserProfilePanel,
// AdminSettingsPanel, CredentialsPanel) RETIRED here — the pretty-conversations
// sidebar is now the only visible sidebar-panel content. Panel FILES stay on
// disk (Phase 12+ scope-fence).
import { SplitView } from "@/shell/SplitView";
// quick-260829-ih3: CollapsedPanelCloseLane — proxy close-target lane that
// stands in for the PrettyConversationsPanel during a badge drag when the
// sidebar is closed. See .planning/shapes/shape-drop-lane-close-in-split-view.md.
import CollapsedPanelCloseLane, {
  useDraggedBadgeTabId,
  shouldMountCloseLane,
} from "@/shell/CollapsedPanelCloseLane";
import { renderTabContent } from "@/shell/tabUtils";
import type {
  Tab,
  TabType,
  Host,
  HostFolder,
  ThemeId,
  FontSizeId,
} from "@/types/ui-types";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import { useTheme } from "@/components/theme-provider";
import {
  getSSHHosts,
  getUserInfo,
  getOpenTabs,
  addOpenTab,
  deleteOpenTab,
  patchOpenTab,
  getActiveSessions,
  getUserPreferences,
  type UserPreferences,
  type OpenTabRecord,
} from "@/main-axios";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import type { SSHHostWithStatus } from "@/main-axios";
// Phase 11 Plan 03 (PURGE-03): ConnectionsPanel import RETIRED alongside AppRail.
import { PrettyConversationsPanel } from "@/features/pretty-conversations/PrettyConversationsPanel";
// Phase 91 Plan 05 — CreateRelayRoomResponse type for onCreateRelayRoom callback.
import type { CreateRelayRoomResponse } from "@/features/pretty-conversations/participant-types";
// Phase 122 Plan 03 Task 3 — ConversationSearchResult type for the new
// onSearchResultOpenActive prop wired to PrettyConversationsPanel below
// (mirrors the onDetachedRowClick handler shape at line ~3068).
import type { ConversationSearchResult } from "@/api/conversation-search-api";
import {
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  removeFleetSession,
  upsertFleetSession,
  updateHostsFlat,
  updateIdentitiesByKey,
  useSelectedConversationId,
  selectConversation,
  selectConversationDeferred,
  addToActiveSet,
  useActiveSet,
  readFleetSessionsCache,
  writeFleetSessionsCache,
  useRelayRoomTitles,
  // Phase 117 Plan 117-07 (D-37 / D-39): projects slice mutators + relay-room
  // and identity project-assignment map setters. setProjects is used by the
  // boot-time hydration path (aggregate across all hosts).
  // mergeProjectsForHost is used by the fleet-status client's
  // onProjectListChanged callback — the wire frame is scoped to one host,
  // so the client merges per-host instead of wholesale-replacing (which
  // used to vaporize other hosts' projects from client state).
  setProjects,
  mergeProjectsForHost,
  setRoomProjectAssignments,
  // Phase 117 H1 fix (2026-09-18): identity-project map setter fed by an
  // AppShell effect that derives the Map from useIdentities() on every
  // identities-store change. Closes the loop between the identity carrier
  // (D-05 — identity file's `project:` frontmatter) and projectForRow's
  // per-row bucket resolution.
  setIdentityProjectAssignments,
} from "@/state/conversation-store";
import type { ProjectRow } from "@/state/conversation-store";
// Phase 117 Plan 117-07 (Fix 1 gate): boot-time hydration API — listProjects
// per host (project list) + listRelayRoomProjectTags per host (u.project.<slug>
// account_data enumeration for relay-room membership). Feeds setProjects +
// setRoomProjectAssignments before the first WS snapshot arrives.
import {
  listProjects,
  listRelayRoomProjectTags,
} from "@/api/project-list-api";
import { getSessionList, killTmuxSession } from "@/api/sessions-api";
import {
  consumePendingWorkspace,
  specForTab,
  writeWorkspaceToUrl,
} from "@/lib/tab-url";
import type { TabSpec } from "@/lib/tab-url";
// Phase 120 LOW-15 cleanup (2026-09-19): route the app-tile drop dispatch
// log through the fleet's structured frontend logger instead of raw
// console.info. Every other console.* call in this file is pre-existing
// (Phase 56 / 64 / 97 drop-lane dispatch) and stays as-is — this cleanup
// is scoped to the Phase 120 additions per the review's LOW-15 finding.
import { systemLogger } from "@/lib/frontend-logger";
// Phase 56 Plan 02 — split-tree state (retires the prior mode-enum + slot-
// array state and their localStorage effects). URL is the single source of
// truth for the split arrangement.
import type { SplitNode, SplitPath, DropEdge } from "@/lib/split-tree";
import { insertAtEdge, removeLeaf, findLeaf, findLargestLeafPath, getNodeAt, collectTabIds, replaceLeaf, swapLeaves } from "@/lib/split-tree";
import { computeNearestEdge, overlayGeometryForZone } from "@/shell/SplitView";
import {
  postDragAccept,
  subscribeToDragAccepts,
} from "@/shell/cross-window-drag";
import {
  encodeSplitTreeToUrl,
  decodeSplitTreeFromUrl,
} from "@/lib/split-tree-url";
import {
  useMobileScreen,
  navigateToView,
  navigateToList,
} from "@/lib/mobile-flow";
import {
  useIdentities,
  mergeIdentityAppearance,
  setIdentityProject,
} from "@/state/identities-store";
// Phase 34 Plan 06: fleet-status control WebSocket — boot-time singleton
import { createFleetStatusClient } from "@/api/fleet-status-client";
import type { SessionState } from "@/api/fleet-status-types";
import {
  publishFleetStatusSessionState,
  publishFleetStatusSessionGone,
  // Phase 44 Plan 04 — seed the max-wins reconciliation chokepoint from the
  // /sessions/list payload (both cached rehydrate and fresh fetch paths).
  seedSessionLastMessageAt,
  // Phase 47 Plan 04 — seed the LAST-WINS reconciliation chokepoint (aiTitle
  // axis, Plan 47-03) from the /sessions/list payload alongside the Phase 44
  // Plan 04 lastMessageAt seed. Same 2-site pattern (cached rehydrate loop +
  // fresh fetch loop); both paths are load-bearing so a row's ai-title is
  // seeded regardless of which source class delivered the row.
  seedSessionAiTitle,
} from "@/state/session-working-store";
// Phase 126 Plan 02 (D-18): AudioContext unlock installer for the readiness
// cue subsystem — wired below via a mount-only useEffect.
import { initReadyCueAudioUnlock } from "@/audio/ready-cue";
import { publishFleetStatusWaitingFor } from "@/state/session-waiting-store";
// Phase 119 Plan 119-02 (D-14, D-16): the standalone app-tiles store slice
// consumes the three app frames dispatched by 119-01's fleet-status-client
// switch cases. AppShell wires the callbacks below (createFleetStatusClient
// call) so that every app-snapshot / app-update / app-gone frame lands in
// the store atomically per D-14. Store is deliberately NOT bolted onto
// conversation-store / identities-store / any session store (D-16).
import {
  publishAppSnapshot,
  publishAppUpdate,
  publishAppGone,
} from "@/state/app-tiles-store";
import { useAnyIdentityModalOpen } from "@/state/identity-modal-open-store";
import {
  publishFleetStatusTmuxSession,
  publishFleetStatusTmuxSessionGone,
  useSessionTmuxName,
} from "@/state/session-tmux-store";
// Phase 128 Plan 07 (D-08) — notificationclick deep-link receiver.
// parseAndOpenRoomFromUrl: pure URL-param parser fired inside a
// mount-only useEffect. Reads `?openRoom=<roomId>` written by the
// public/sw.js notificationclick handler (Plan 04) and opens the
// target relay-room tab, then strips the param via replaceState
// (T-126-38 confidentiality — a copied URL after arrival doesn't
// embed the roomId; a reload doesn't re-trigger the deep-link).
// The Enable-notifications opt-in surface is the modal opened from
// the PrettyConversationsPanel kebab menu (feature-detected).
import { parseAndOpenRoomFromUrl } from "@/features/notifications/open-room-deep-link";
// Phase 11 Plan 03 (user "no settings" lock): SettingsRow import RETIRED
// alongside AppRail — the entire settings-surface tree dies here.

// Patch #512 diag: compact string form of a SplitNode tree for log tracing.
// Shape: `L(tabId)` for a session leaf; `S-v[left,right]` or `S-h[top,bot]`
// for splits. Truncates long tabIds to keep log lines readable.
function describeTreeShape(node: SplitNode | null): string {
  if (node === null) return "null";
  const short = (s: string) => (s.length > 24 ? s.slice(0, 21) + "…" : s);
  if (node.kind === "session") return `L(${short(node.tabId)})`;
  const marker = node.direction === "vertical" ? "S-v" : "S-h";
  return `${marker}[${describeTreeShape(node.children[0])},${describeTreeShape(node.children[1])}]`;
}

function sshHostToHost(h: SSHHostWithStatus): Host {
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh ?? (h.connectionType === "ssh" || !h.connectionType),
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableRdp: h.enableRdp ?? h.connectionType === "rdp",
    enableVnc: h.enableVnc ?? h.connectionType === "vnc",
    enableTelnet: h.enableTelnet ?? h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    jumpHosts: (h.jumpHosts ?? []).map((j) => ({
      hostId: String(j.hostId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: h.socks5ProxyChain ?? [],
  };
}

function buildHostTree(hosts: SSHHostWithStatus[]): HostFolder {
  const root: HostFolder = { name: "root", children: [] };
  const folderMap = new Map<string, HostFolder>();
  const getOrCreateFolder = (path: string): HostFolder => {
    if (folderMap.has(path)) return folderMap.get(path)!;
    const parts = path.split(" / ");
    let current = root;
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated} / ${part}` : part;
      if (!folderMap.has(accumulated)) {
        const folder: HostFolder = { name: part, children: [] };
        folderMap.set(accumulated, folder);
        current.children.push(folder);
      }
      current = folderMap.get(accumulated)!;
    }
    return current;
  };
  for (const h of hosts) {
    const host = sshHostToHost(h);
    if (h.folder) {
      getOrCreateFolder(h.folder).children.push(host);
    } else {
      root.children.push(host);
    }
  }
  return root;
}
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { setTheme } = useTheme();
  // Phase 70 Plan 04: consume the branding store (Plan 70-03) so the three
  // prior hardcoded-brand fallbacks below (initial tab label, document.title
  // last-fallback slot, tab-reset-on-close label) use the operator-configured
  // brandingConfig.appName instead.
  //
  // bounty branding-favicon-coverage-gap: the favicon hook (see
  // src/ui/branding/apply-favicon.ts) used to be called here too, but
  // AppShell only mounts post-login — the login screen therefore never got
  // operator favicon overrides. The call was lifted to App() in
  // src/main.tsx (which wraps BOTH <Auth> and <AppShell>). Do NOT re-add
  // the call here — that would double-rewrite <link rel="icon"> hrefs.
  const brandingConfig = useBrandingConfig();
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "dashboard",
      instanceId: "dashboard",
      type: "dashboard",
      label: brandingConfig.appName,
      openedAt: Date.now(),
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  const [tmuxSessionNames, setTmuxSessionNames] = useState<
    Record<string, string>
  >({});

  useGamepadTabNav(tabs, activeTabId, setActiveTabId);
  useKeyboardTabNav(tabs, activeTabId, setActiveTabId);
  useKeyboardCloseTab(tabs, activeTabId, closeTab);
  useKeyboardMessageQueue(tabs, activeTabId, (id) => {
    const ref = terminalRefs.current.get(id);
    // Phase 41 code-review H2: cast to Partial<IdentityPaneHandle> because
    // the ref may hold either a plain TerminalHandle (non-identity SSH
    // panes) or an IdentityPaneHandle (identity panes via
    // IdentitySessionPane). Only identity panes implement toggleMessageQueue
    // — optional chaining short-circuits when the method is absent, which
    // matches runtime reality and satisfies the type.
    const handle = (ref?.current as Partial<IdentityPaneHandle> | null) ?? null;
    handle?.toggleMessageQueue?.();
  });
  useKeyboardTogglePrettyMode(tabs, activeTabId, (id) => {
    const ref = terminalRefs.current.get(id);
    // Same Partial<IdentityPaneHandle> cast rationale as toggleMessageQueue above.
    const handle = (ref?.current as Partial<IdentityPaneHandle> | null) ?? null;
    handle?.togglePrettyMode?.();
  });
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    reopenTabsOnLogin: false,
  });
  const [userPrefsLoaded, setUserPrefsLoaded] = useState(false);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  // Flips to true once the initial DB read (restore or skip) is done — sync must not fire before this
  const [tabsReady, setTabsReady] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Phase 121 Plan 04: FeedbackModal open state.
  //   Discriminated-union — `false` means closed; the string variant marks
  //   BOTH open AND which entry variant is showing. Single atom avoids the
  //   invalid state where "open with no variant" would compile but crash
  //   the modal's render branch.
  const [feedbackOpen, setFeedbackOpen] = useState<
    false | "general" | "thumbs_down"
  >(false);
  // Phase 121 Plan 04: dev-only chord opens FeedbackModal (Ctrl+Alt+F general,
  // Ctrl+Alt+T thumbs_down). Hook is a no-op in prod builds via its own
  // import.meta.env.DEV gate (T-121-18 mitigation).
  useKeyboardTriggerFeedbackDev((variant) => setFeedbackOpen(variant));
  // Phase 121 Plan 04: fire GET /api/feedback/enabled once on AppShell mount.
  // AppShell only renders AFTER auth succeeds, so this call reaches the
  // auth-gated route with the JWT cookie attached (contrast /api/branding
  // which is pre-login and fetched from src/main.tsx). Silent no-op on
  // failure per feedback-fetch.ts contract — never blocks boot.
  useEffect(() => {
    void fetchFeedbackConfig();
  }, []);
  // Phase 56 Plan 02: split state retired from localStorage. The URL is the
  // single source of truth. The initializer returns null because the tab set
  // (needed for the (host,session) → tabId resolver) is empty on first render;
  // the loadSavedTabs effect at ~L906-1149 decodes and hydrates the tree
  // after tabs are materialized.
  const [splitTree, setSplitTree] = useState<SplitNode | null>(null);
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  // Coral drop-target preview for the empty-PV wrapper. The overlay owns
  // dragover/drop when splitTree === null (the SplitView Pane's own preview
  // handles the splitTree-non-null case). Zone semantics:
  //   - `null`   = no drag in progress → no overlay.
  //   - `"full"` = drop will REPLACE the tree with a single leaf (empty PV,
  //                self-drop, or active tab isn't a session). Whole-body coral.
  //   - DropEdge = drop will `insertAtEdge(active, [], dropped, edge)` and
  //                create a real split. Edge-zoned half-body coral.
  // inline-260902 (identity-badge-drop-preview-not-edge-zoned-when-one-agent-open):
  // before this widening, state was a boolean and the overlay always drew
  // whole-body — user UAT: one-agent case highlighted the whole area even
  // when hovering left/right, mismatching the actual drop routing which had
  // always used computeNearestEdge to pick a real edge.
  //
  // Cleared on drop / bounding-rect-guarded dragleave / window-level dragend
  // (Escape-cancel). Ref-based zone-change gate for the structured log
  // mirrors SplitView.tsx:223 prevZoneRef discipline — synchronous ref-write
  // inside handler bodies avoids React 18 strict-mode double-fire from a
  // setState functional updater.
  const [convRowDragZone, setConvRowDragZone] = useState<
    DropEdge | "full" | null
  >(null);
  const prevEmptyPvZoneRef = useRef<DropEdge | "full" | null>(null);
  // Patch #513: memoized Set of tabIds currently rendered as leaves in the
  // splitTree. Passed to PrettyConversationsPanel to drive (a) the row
  // "selected" glow on every in-view session (not just the single
  // selectedId) and (b) the auto-deactivate-idle-convs sweep's
  // exemption so in-view sessions can't be silently killed while the
  // user is watching them. Identity flips only when splitTree itself
  // changes — cheap prop for the panel to consume.
  const visibleInSplitTreeTabIds = useMemo<ReadonlySet<string>>(
    () => new Set(collectTabIds(splitTree)),
    [splitTree],
  );
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);

  // Patch #153: desktop sidebar is open by default on load. Gated on
  // viewport width (768 = useIsMobile breakpoint) so narrow/mobile
  // start closed and the mobile-flow list-view takes over — avoids
  // an open→close flicker from the L256 mobile-auto-close effect.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 768;
  });
  // Phase 11 Plan 03: railView state RETIRED (rail is gone; pretty-conversations
  // is the only sidebar-panel content). profileDropdownOpen also retired —
  // it was an AppRail-only state per Plan 01 Section E item 2.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("skynet_sidebarWidth");
    return saved ? parseInt(saved, 10) : 266;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);

  useEffect(() => {
    localStorage.setItem("skynet_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  // Phase 56 Plan 02: split state is URL-persisted via the workspace URL-sync
  // effect at ~L768 (splitTree threaded through WorkspaceSpec). Prior
  // localStorage-backed effects for the retired mode + slot-array state were
  // deleted here — no fallback read either.

  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const { byKey: identitiesByKey } = useIdentities();
  // quick-260829-ih3: window-scoped hook — returns the tabId of the currently-
  // in-flight identity badge drag (via IdentityBadge dragstart payload MIME
  // application/x-skynet-badge), or null if none is in flight. Feeds the
  // CollapsedPanelCloseLane mount gate below.
  const draggedBadgeTabId = useDraggedBadgeTabId();

  // Phase 41 Plan 02: document.title retarget — read the active tab's tmux
  // session name from the fleet-status broadcast store (session-tmux-store)
  // instead of ONLY from the Terminal-callback-fed tmuxSessionNames record.
  // This satisfies CONTEXT.md LOCKED: "tab-title mechanism reads tmuxSessionName
  // from the fleet-status broadcast" — required so identity panes (where
  // Terminal is not mounted at open time) still surface a meaningful title.
  //
  // Key format: `${numericHostId}:${tmuxSessionName}` — matches
  // session-tmux-store's publishFleetStatusTmuxSession key convention.
  // Computed once at hook scope so useSessionTmuxName (a hook) can be called
  // unconditionally per React rules.
  const _activeTabForTitle = tabs.find((t) => t.id === activeTabId);
  const activeSessionKey =
    _activeTabForTitle?.host?.id != null
      ? `${_activeTabForTitle.host.id}:${_activeTabForTitle.targetTmuxSession ?? ""}`
      : null;
  const activeTmuxFromStore = useSessionTmuxName(activeSessionKey);

  // Plan 06-03: mobile-flow drives list-vs-view rendering on touchscreen
  // viewports. Reads the `#mv=1` URL fragment key (patch #25 pattern
  // extended); AppShell gates ALL mobile-flow-driven rendering on
  // `isTouchDevice` so desktop is untouched.
  const mobileScreen = useMobileScreen();

  const sidebarOpenBeforeMobile = useRef(sidebarOpen);
  useEffect(() => {
    // Plan 06-03: gate this legacy narrow-window sidebar auto-close effect
    // on `!isTouchDevice`. On touchscreens the sidebar IS the list screen
    // (full viewport when mobileScreen === "list"), so auto-closing it
    // makes no sense. The effect still fires for the original use case —
    // a narrow desktop window (mouse-based, `pointer: fine`) transitioning
    // through the isMobile width breakpoint.
    if (isTouchDevice) return;
    if (isMobile) {
      sidebarOpenBeforeMobile.current = sidebarOpen;
      setSidebarOpen(false);
    } else {
      setSidebarOpen(sidebarOpenBeforeMobile.current);
    }
  }, [isMobile, isTouchDevice]);

  useEffect(() => {
    getUserInfo()
      .then((info) => setIsAdmin(info.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  // Phase 126 Plan 02 (D-18): install first-gesture AudioContext unlock so
  // playTink() from mounted PrettyView instances fires post-user-interaction.
  // Idempotent per Plan 01 Task 2 — safe under StrictMode double-invoke.
  useEffect(() => {
    initReadyCueAudioUnlock();
  }, []);

  // Phase 59 Plan 01 Gap 1 — window-level dragend listener for the empty-PV
  // coral tint's Escape-cancel path. Escape cancels a drag WITHOUT moving
  // the cursor, so no dragleave fires; dragend on the drag source is the
  // only reliable signal. Window-level attach because dragend fires on the
  // SOURCE element (conv-list row), not on the empty-PV wrapper; scoping to
  // the wrapper would miss it. Idempotent — clearing already-false state is
  // a no-op, so this is safe even when a drop already cleared the state.
  // Dep on splitTree so the log's splitTreeNull field reflects current state.
  useEffect(() => {
    const onDragEnd = () => {
      setConvRowDragZone(null);
      if (prevEmptyPvZoneRef.current !== null) {
        // eslint-disable-next-line no-console
        console.info(
          `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTree === null}`,
        );
        prevEmptyPvZoneRef.current = null;
      }
    };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, [splitTree]);

  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  // Patch #35: monotonic counter appended to each generated tabId so
  // multiple openTab calls in the same ms (URL-driven multi-tab restore
  // loop) don't collide when Date.now() returns identical values.
  const openTabCounter = useRef(0);
  // Phase 56 Plan 02: prior pane-element array retired; the tree-based renderer
  // uses a Map<tabId, HTMLDivElement> populated imperatively by callback refs
  // from each leaf's Pane. A ref (not state) is correct here — the DOM-
  // placement effect at ~L1488-1546 reads from it inside its own useEffect
  // pass keyed on tabs + splitTree, so no re-render is needed on Map mutation.
  const paneElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Stable per-tab DOM nodes — created once per tab, never destroyed while the tab lives.
  // We always portal each tab's content into its own node, then move that node between
  // the normal-view container and the pane container via vanilla DOM so React's portal
  // target never changes (changing the target causes a remount).
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const normalViewRef = useRef<HTMLDivElement>(null);

  const getTabNode = useCallback((tabId: string, isTerminal: boolean) => {
    if (!tabNodesRef.current.has(tabId)) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.overflow = "hidden";
      // Phase 14B Slice 9: rebased from bg-background (prior fork theme) to the
      // pv base gradient token. Non-terminal tabs get a solid pv-base backdrop
      // so the createPortal loop's mount surface still reads as opaque.
      if (!isTerminal) el.style.background = "var(--color-pv-base)";
      tabNodesRef.current.set(tabId, el);
    }
    return tabNodesRef.current.get(tabId)!;
  }, []);

  // Phase 56 Plan 02: onPaneContentRef takes (tabId, el) instead of
  // (paneIndex, el) — the tree-based renderer is keyed by tabId at every
  // leaf. Populates paneElsRef.current so the DOM-placement effect can look
  // up the target element for reparenting via `paneElsRef.current.get(tab.id)`.
  const onPaneContentRef = useCallback(
    (tabId: string, el: HTMLDivElement | null) => {
      if (el) {
        paneElsRef.current.set(tabId, el);
      } else {
        paneElsRef.current.delete(tabId);
      }
    },
    [],
  );

  // Phase 11 Plan 03: sidebarTitle Record<RailView, string> RETIRED — the
  // sidebar header now hardcodes "Conversations" since that's the only surface.

  useEffect(() => {
    const handle = () => onLogout();
    window.addEventListener("skynet:logout", handle);
    return () => window.removeEventListener("skynet:logout", handle);
  }, [onLogout]);

  useEffect(() => {
    const handleSessionExpired = () => onLogout();
    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, [onLogout]);

  // Phase 111 Plan 05 — hostsByIdRef: a ref that tracks the live hostsById memo
  // so applyFleetState (inside the mount-once [] effect below) can resolve hostName
  // from the current host map without closing over a stale first-render value.
  // The empty-dep-array effect is deliberate (one WS client per mount); a ref is
  // how a live value reaches it without re-subscribing the socket.
  const hostsByIdRef = useRef<Map<number, Host>>(new Map());

  // Phase 34 Plan 06: fleet-status control WebSocket — exactly one WS opened
  // at AppShell boot. Reconnects on drop via createFleetStatusClient's built-in
  // retry-with-backoff (mirrors patch #148 pattern). Dispatches snapshot/update/gone
  // frames to session-working-store + session-waiting-store + session-tmux-store
  // via the callbacks below.
  //
  // Callback wiring (per D-CTX § Composite state + Waiting bubble UX):
  //   onSnapshot: for each SessionState → applyFleetState (appearance FIRST, then
  //               publishFleetStatusSessionState + publishFleetStatusWaitingFor
  //               + publishFleetStatusTmuxSession, THEN upsertFleetSession LAST)
  //   onUpdate:   same as onSnapshot but for a single state (calls applyFleetState once)
  //   onGone:     publishFleetStatusSessionGone + publishFleetStatusWaitingFor(null)
  //               + publishFleetStatusTmuxSessionGone + removeFleetSession (Plan 111-05)
  //
  // Phase 111 Plan 04 — appearance-before-row ordering (CONTRACT, not detail):
  //   PrettyConversationRow resolves its hue/title/task from identities-store's
  //   byHostKey composite map (NOT from SessionState directly). So appearance must
  //   land in identities-store BEFORE the row upsert, or the row paints undressed
  //   for one frame and dresses on the next — the correction-flicker the shape calls
  //   a failure even when the final state is right. mergeIdentityAppearance fires
  //   FIRST; upsertFleetSession fires LAST. Both writes are synchronous in one
  //   callback body, so React batches them into a single render.
  //
  // Phase 111 Plan 05 — what makes the list live:
  //   applyFleetState now also calls upsertFleetSession (as the LAST call) so a
  //   pulse frame creates a dressed row without a page reload. onGone now also
  //   calls removeFleetSession so a frame for a session that has ended removes
  //   its row without a reload. Together these close the gap that left the list
  //   frozen for the life of the tab.
  //
  //   hostId coercion: SessionState.hostId is a STRING on the wire; Identity.hostId is a
  //   NUMBER. parseInt once at this boundary — mirroring the Kill handler's pattern at
  //   killTmuxSession(parseInt(row.host.id, 10), ...) — so no string leaks inward and the
  //   `${hostIdNum}::${key}` composite key is always a number template join.
  //
  // Phase 41 Plan 01: session-tmux-store is an additional dispatch target.
  // SessionState.tmuxSession is already on the fleet-status wire — no backend
  // change required. The store keyed by hostId:tmuxSession allows the
  // document.title effect (Plan 41-02) and PrettyView to resolve the tmux
  // session name when Terminal is not mounted.
  //
  // URL derivation: same protocol (ws/wss) as the page + same host + /fleet-status/ws
  // deps: [] — mount-once; reads only stable window.location at mount time.
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const fleetStatusUrl = `${proto}//${window.location.host}/fleet-status/ws`;

    // Phase 111 Plan 04 — shared per-state body for onSnapshot (loop) and
    // onUpdate (single call). Appearance merges FIRST so byHostKey is populated
    // before any downstream subscriber re-renders a row.
    const applyFleetState = (fleetState: SessionState): void => {
      // Coerce once at the boundary: SessionState.hostId is STRING on the wire;
      // Identity.hostId is NUMBER. A naive template join (`${state.hostId}::key`)
      // appears to work but silently drops entries when a typeof guard rejects
      // the string — mirroring parseInt(row.host.id, 10) from the Kill handler.
      const hostIdNum = parseInt(fleetState.hostId, 10);

      // Appearance FIRST (Plan 111-04): land in identities-store before the row
      // publish so PrettyConversationRow never sees a row without its cosmetics.
      // The !=(null) check covers both null (host sent no appearance) and undefined
      // (legacy path pre-Plan-111-02) — both mean "no appearance this tick" and
      // must be a no-op, never a blank.
      if (
        fleetState.identityAppearance != null &&
        fleetState.tmuxSession != null &&
        Number.isFinite(hostIdNum)
      ) {
        mergeIdentityAppearance(hostIdNum, fleetState.tmuxSession, fleetState.identityAppearance);
      }

      // Then the three existing publishes — byte-identical to before Plan 111-04.
      publishFleetStatusSessionState(fleetState.hostId, fleetState);
      publishFleetStatusWaitingFor(
        fleetState.hostId,
        fleetState.tmuxSession,
        fleetState.status === "waiting" ? fleetState.waitingFor ?? "input needed" : null,
      );
      publishFleetStatusTmuxSession(fleetState.hostId, fleetState.tmuxSession);

      // Phase 111 Plan 05 — row create (LAST, after appearance, per the ordering
      // contract above). Guard: a frame with no tmux session cannot become a row.
      // hostIdNum is reused from the coercion above — one parseInt at the boundary.
      if (fleetState.tmuxSession == null || fleetState.tmuxSession === "") return;
      if (!Number.isFinite(hostIdNum)) return;
      // Resolve hostName from the live hostsByIdRef so we get the current map
      // rather than whatever was captured at mount time (the effect dep array is []).
      const hostName = hostsByIdRef.current.get(hostIdNum)?.name ?? "";
      // Appearance is already in identities-store (mergeIdentityAppearance fired above),
      // so role is available via identityAppearance. Take it from there so the row's
      // role axis is filled even before GET /identities returns.
      const role = fleetState.identityAppearance?.role ?? null;
      upsertFleetSession({
        hostId: hostIdNum,
        hostName,
        sessionName: fleetState.tmuxSession,
        created: Date.now(),
        role,
      });
    };

    const client = createFleetStatusClient({
      url: fleetStatusUrl,
      onSnapshot: (states) => {
        for (const fleetState of states) {
          applyFleetState(fleetState);
        }
      },
      onUpdate: (fleetState) => {
        applyFleetState(fleetState);
      },
      // Phase 117 Plan 117-07 (D-37): project-list-changed wire frame from
      // 117-03's registry.publishProjectListChanged. Backend fires this on
      // every project create / archive. The frame is SCOPED to one hostId
      // (see wire-protocol.ts) and carries the full projects list for THAT
      // host only. We merge per-host via mergeProjectsForHost so entries
      // for other hosts survive unchanged. The wire type `ProjectListEntry`
      // on fleet-status-types.ts mirrors ProjectRow byte-for-byte (both
      // are {slug, displayName, hostId, hostname, archived}), so no field
      // massaging is required at the adapter boundary.
      onProjectListChanged: (hostId, projects) =>
        mergeProjectsForHost(hostId, projects),
      // Per-identity project delta from the backend's session-project write
      // path — patch the affected row's `project` field in place so the
      // sidebar reflects the new bucket without a full /identities refetch.
      // Silent no-op if the identity isn't yet in the store (WS frame beat
      // the REST fetch); the fetch will read the on-disk field.
      onSessionProjectChanged: (identityKey, hostId, project) => {
        setIdentityProject(identityKey, hostId, project);
      },
      onGone: (hostId, tmuxSession, sessionId) => {
        // The three pre-existing publishes — mark per-session state. These are
        // orthogonal to membership and must remain. Do NOT reorder.
        publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
        publishFleetStatusWaitingFor(hostId, tmuxSession, null);
        publishFleetStatusTmuxSessionGone(hostId, tmuxSession);

        // Phase 111 Plan 05 — row remove. Guard: a gone frame's tmuxSession is
        // nullable on the wire. A null would match nothing in removeFleetSession
        // today (filter predicate requires both fields), but the explicit guard
        // documents that and prevents a future `?? ""` from accidentally matching
        // a malformed row with an empty sessionName.
        if (tmuxSession == null || tmuxSession === "") return;
        const goneHostId = parseInt(hostId, 10);
        // Non-finite hostId coercion guard — same one-coercion-at-boundary discipline.
        if (!Number.isFinite(goneHostId)) return;
        // Relay-room rows are structurally immune: they carry no hostId and no
        // sessionName, so removeFleetSession's tuple filter cannot match one.
        removeFleetSession(goneHostId, tmuxSession);
      },
      // Phase 119 Plan 119-02 (D-14): route the three Phase 118 app frames
      // into the app-tiles-store slice. Store handles atomic reconciliation
      // per D-14 (snapshot = full-list replacement, update = one-key upsert,
      // gone = one-key delete). No host-visibility re-check here — Phase 118
      // D-15's app-frame-filter is the sole authority (client re-filter would
      // drift). No try/catch — publish fns are pure Map + notify (no failure
      // surface); a thrown error would rightfully surface at the client.
      onAppSnapshot: (apps) => {
        publishAppSnapshot(apps);
      },
      onAppUpdate: (app) => {
        publishAppUpdate(app);
      },
      onAppGone: (hostId, slug) => {
        publishAppGone(hostId, slug);
      },
    });

    return () => client.dispose();
  }, []);

  const handleTmuxSessionChange = useCallback(
    (tabId: string, sessionName: string | null) => {
      setTmuxSessionNames((prev) => {
        if (sessionName === null) {
          if (!(tabId in prev)) return prev;
          const { [tabId]: _drop, ...rest } = prev;
          return rest;
        }
        if (prev[tabId] === sessionName) return prev;
        return { ...prev, [tabId]: sessionName };
      });
      // Also patch tab.targetTmuxSession in the `tabs` React state so the
      // conversation-store row for this tab reflects the runtime session
      // name. Otherwise for a non-identity tab created with
      // targetTmuxSession:null (backend picks a fresh skynet-<id>-<hash>),
      // the row.targetTmuxSession stays null and the Kill context-menu item
      // (gated on non-null targetTmuxSession at PrettyConversationRow.tsx
      // line ~1408) never appears until page refresh re-hydrates from
      // server-side fleet-status. Guard on non-null to avoid clobbering a
      // known target when a transient null fires (e.g. session_expired).
      if (sessionName !== null) {
        setTabs((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            if (t.id === tabId && t.targetTmuxSession !== sessionName) {
              changed = true;
              return { ...t, targetTmuxSession: sessionName };
            }
            return t;
          });
          return changed ? next : prev;
        });
        // Persist to server-side open_tabs so a page refresh sees the
        // current session name without waiting for a fleet-status
        // catch-up cycle. Silent catch: local state is already correct;
        // server persistence is best-effort.
        import("@/main-axios").then(({ patchOpenTab }) => {
          patchOpenTab(tabId, { targetTmuxSession: sessionName }).catch(() => {});
        });
      }
    },
    [],
  );

  // Backend reported the target tmux session doesn't exist on the host
  // (attach-only path; the tab was restored from URL or persisted state).
  // Purge the row from server-side open_tabs so a broken tab doesn't
  // rehydrate on next login. The tab stays visible so the inline pane
  // error is still readable — the user closes it manually.
  const handleTmuxSessionMissing = useCallback(
    (instanceId: string, sessionName: string) => {
      // Phase 41 code-review M5: log the failure. Previously this
      // swallowed all rejections silently, so a persistent backend
      // failure to delete the row meant the broken tab kept
      // rehydrating on every login with zero telemetry. The tab
      // stays visible either way (see block comment above) — the log
      // just makes the underlying failure diagnosable.
      deleteOpenTab(instanceId).catch((err) => {
        console.warn(
          `[app-shell] delete-open-tab-failed operation="app_shell_delete_open_tab_failed" instanceId="${instanceId}" sessionName="${sessionName}" err="${err instanceof Error ? err.message : String(err)}"`,
        );
      });
    },
    [],
  );

  useEffect(() => {
    setTmuxSessionNames((prev) => {
      const live = new Set(tabs.map((t) => t.id));
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, name] of Object.entries(prev)) {
        if (live.has(id)) next[id] = name;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    // Phase 41 Plan 02: tmux source is now the fleet-status broadcast store
    // (activeTmuxFromStore, derived at hook scope via useSessionTmuxName)
    // with the legacy Terminal-callback-fed tmuxSessionNames[activeTabId]
    // record as the fallback for non-identity panes where the store has no
    // entry (workstation-style SSH hosts without a live tmux+claude backend).
    // The identity displayName → tmux → label → brand-fallback chain is
    // preserved verbatim — only the tmux source changes (and Phase 70 Plan 04
    // swapped the last-fallback slot from the hardcoded brand string to
    // brandingConfig.appName).
    const tmux = activeTmuxFromStore ?? tmuxSessionNames[activeTabId];
    // Browser tab title for identity sessions shows the identity's `task`
    // string (frontmatter task: field — what the agent is currently working
    // on) rather than the displayName, so the tab surfaces the WORK not the
    // AGENT. Falls back to displayName when the identity has no task set
    // (null), then raw tmux name, then activeTab.label, then
    // brandingConfig.appName. The "Untitled conversation" placeholder is
    // intentionally NOT special-cased — if that's the task, that's what shows.
    const resolvedKey = (tmux ?? activeTab?.label ?? "").toLowerCase();
    const identity = resolvedKey ? identitiesByKey.get(resolvedKey) : null;
    document.title =
      identity?.task ||
      identity?.displayName ||
      tmux ||
      activeTab?.label ||
      brandingConfig.appName;
    console.info({
      operation: "app_shell_title_resolve",
      activeTabId,
      tmuxFromStore: activeTmuxFromStore,
      tmuxFromLegacyRecord: tmuxSessionNames[activeTabId] ?? null,
      resolvedTitle: document.title,
    });
  }, [activeTabId, tabs, tmuxSessionNames, identitiesByKey, activeTmuxFromStore, brandingConfig.appName]);

  // ─── Conversation-store sync (Plan 06-02) ────────────────────────────────
  // The conversation-store is a pure DERIVATION of AppShell's tab state; it
  // is fed via effects that fire on `tabs` and `realHostTree` changes. The
  // store's own reference-equality no-op guards (Plan 06-01) elide idle
  // re-emissions, but as a defense-in-depth (plan-check NOTE-05) we also
  // memoize the tree by JSON key so a `buildHostTree` rebuild that produces
  // identical content does not bump the store's snapshot version.
  const stableHostTreeKey = useMemo(
    () => (realHostTree ? JSON.stringify(realHostTree) : ""),
    [realHostTree],
  );
  const stableHostTree = useMemo(
    () => realHostTree,
    // deliberately keyed on the JSON snapshot, not the ref — this is the
    // NOTE-05 thrash-guard for host-tree polling that produces reference-
    // inequal but content-equal trees.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableHostTreeKey],
  );
  useEffect(() => {
    updateHostTree(stableHostTree);
  }, [stableHostTree]);
  useEffect(() => {
    updateOpenTabs(tabs);
  }, [tabs]);

  // ─── Plan 07-01: fleet-native store extension (TG-12, TG-14, TG-17) ──────
  // Two additional inputs feed the conversation-store: a one-shot fleet-
  // discovery snapshot (getSessionList()) and a flat hostId → Host lookup
  // derived from realHostTree.
  //
  // TG-17 hard shape lock (Phase 111 D-07 amendment):
  //   NO polling. NO interval. NOT wired to skynet:hosts-changed. Silent
  //   try/catch on fetch failure. No toast, no retry, no user-visible surface.
  //
  //   Phase 111 D-07 changes the TIMING RULE, not the existence of the fetch:
  //   GET /sessions/list now fires on open AND on becoming visible again, via the
  //   SAME fetchAndApplyFleetSessions path both times. This pairs with the WS
  //   client's visibility reconnect (fleet-status-client.ts) so both halves of
  //   "coming back shows what's current" fire on the same event.
  //
  //   The cache seed (readFleetSessionsCache) and the cold-start flag-flip
  //   (updateFleetSessions([])) stay MOUNT-ONLY — they are not in the shared
  //   fetch path because re-seeding from localStorage on a re-ask would push
  //   OLDER data into the working store, and the flag-flip has no purpose once
  //   fleetSessionsLoaded is already true.

  // In-flight coalescing ref — a useRef<boolean> so rapid hidden/visible cycling
  // on mobile does not stack concurrent fetches. Modeled on identities-store's
  // refreshInflight. NOT a success-latch (this path must be repeatable);
  // only CONCURRENCY is guarded. Set to true on fetch start, cleared in finally.
  const fetchInflightRef = useRef<boolean>(false);

  // mountedRef — guards the mount effect's try-branch from writing store state
  // after unmount (React strict-mode double-invoke / fast unmounts). The re-ask
  // path does not use a cancelled flag; the fetchInflightRef prevents stacked
  // fetches so a concurrent resolve after unmount is structurally prevented.
  const mountedRef = useRef<boolean>(false);

  // fetchAndApplyFleetSessions — shared between mount and the visibility re-ask.
  // opts.isColdStart distinguishes the first fetch from subsequent re-asks so
  // the catch branch can apply the quick-260821-m36 flag-flip only when needed.
  const fetchAndApplyFleetSessions = useCallback(async (opts: { isColdStart: boolean }) => {
    if (fetchInflightRef.current) return; // coalesce concurrent fetches
    fetchInflightRef.current = true;
    try {
      const sessions = await getSessionList();
      if (opts.isColdStart && !mountedRef.current) return; // unmounted during cold-start fetch
      const fresh = Array.isArray(sessions) ? sessions : [];
      updateFleetSessions(fresh);
      // Phase 44 Plan 04 — seed working-store from the fresh /sessions/list
      // snapshot. Max-wins reconciliation in the working-store handles
      // ordering vs. WS-live updates (which may arrive before or after this).
      //
      // Phase 47 Plan 04 — same loop now also seeds the aiTitle axis
      // (Plan 47-03 LAST-WINS chokepoint). Distinct semantics from Axis B:
      // ai-titles evolve as the session's topic drifts, so LAST-WINS is
      // correct (freshest arrival replaces older). A WS frame arriving
      // AFTER this seed will overwrite via the same chokepoint.
      for (const s of fresh) {
        seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null);
        seedSessionAiTitle(s.hostId, s.sessionName, s.aiTitle ?? null); // Phase 47 Plan 04
      }
      // quick-260805-tub: persist the fresh snapshot for the next refresh.
      // Both cold-start and re-ask update the cache — a successful re-ask
      // is strictly good. Silent on write failure (see writeFleetSessionsCache).
      writeFleetSessionsCache(fresh);
    } catch {
      if (opts.isColdStart) {
        // quick-260821-m36: flag-flip on failure so cold-cache clients don't
        // stay stuck at "Loading agents…". updateFleetSessions([]) is safe on
        // cold start — the empty array is a shallow no-op on fleetSessions, but
        // the fleetSessionsLoaded false→true transition is unconditional per
        // quick-260727-kbw (conversation-store.ts). The `if (!mountedRef.current)`
        // guard avoids writing store state after unmount.
        //
        // ⚠️ Re-ask path deliberately does NOT run this: fleetSessionsLoaded is
        // already true on a re-ask, so the only effect would be wiping every row
        // on a transient network blip — the "failed record read removes a
        // conversation" failure mode. T-111-35 mitigation.
        if (mountedRef.current) updateFleetSessions([]);
      }
      // Silent — no toast, no console.warn. Cache deliberately NOT touched on
      // failure — the last known-good snapshot survives the network hiccup
      // (writeFleetSessionsCache only runs in the try-branch above).
      // T-07-01-04 mitigation.
    } finally {
      fetchInflightRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mount effect — seed from localStorage cache THEN fetch (cold start only).
  // TG-17: the empty dep array now enforces "the SEED is exactly once per mount"
  // rather than "the fetch is" — the fetch now also fires on visibility (below).
  useEffect(() => {
    mountedRef.current = true;
    // quick-260805-tub: seed the store from the localStorage cache BEFORE
    // the network fetch fires. This paints the last-known conversation-list
    // row set immediately on refresh; when the fetch returns it overwrites
    // with the fresh snapshot (see writeFleetSessionsCache below). On a cold
    // cache (first ever visit, cleared storage, corrupted JSON), read returns
    // [] — identical to today's cold-start behavior, no user-visible diff.
    //
    // MOUNT-ONLY: re-seeding from localStorage on a re-ask would push OLDER
    // data into the working store, undressing rows that the WS snapshot just
    // dressed. readFleetSessionsCache is called exactly once per mount.
    const cached = readFleetSessionsCache();
    if (cached.length > 0) {
      updateFleetSessions(cached);
      // Phase 44 Plan 04 — feed cached rows into the working-store max-wins
      // reconciliation. If the fresh fetch below returns fresher values, they
      // overwrite; if it returns stale or null, cache values persist. Also
      // paints the correct middle-zone order immediately on cold-start (via
      // the flipped null-to-bottom Rule 1), before the fresh fetch resolves.
      //
      // Phase 47 Plan 04 — same loop now also seeds the aiTitle axis (Plan
      // 47-03 LAST-WINS chokepoint). Coalesces undefined → null so pre-Phase-47
      // cached rows (aiTitle field absent on their FleetSession) are treated
      // identically to explicit-null. Null seed is a no-op under the
      // advanceSessionAiTitle guard, so this is safe on cold cache.
      for (const s of cached) {
        seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null);
        seedSessionAiTitle(s.hostId, s.sessionName, s.aiTitle ?? null); // Phase 47 Plan 04
      }
    }
    void fetchAndApplyFleetSessions({ isColdStart: true });
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // EMPTY DEP ARRAY — TG-17 shape lock: the SEED is exactly once per mount.
          // The fetch also fires on becoming-visible (see effect below).

  // Visibility re-ask — fire GET /sessions/list on becoming visible (D-07).
  // Pairs with fleet-status-client.ts's visibility reconnect so both halves
  // of "coming back shows what's current" fire on the same event and cannot
  // diverge. No isIosPwa() gate — D-12 wants re-ask on every platform.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void fetchAndApplyFleetSessions({ isColdStart: false });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchAndApplyFleetSessions]);

  // Flat hostId → Host lookup for the click-a-detached-row handler.
  // Reuses the NOTE-05 stableHostTreeKey thrash-guard: rebuilt only when
  // the host-tree JSON snapshot changes, so idle polls that produce
  // reference-inequal-but-content-equal trees do NOT churn the store's
  // hostsFlat input.
  const hostsById = useMemo(() => {
    const m = new Map<number, Host>();
    if (!realHostTree) return m;
    const walk = (folder: HostFolder): void => {
      for (const child of folder.children) {
        if ("children" in child) walk(child);
        else m.set(parseInt(child.id), child);
      }
    };
    walk(realHostTree);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableHostTreeKey]);
  useEffect(() => {
    // Phase 111 Plan 05 — keep ref live so applyFleetState can resolve hostName
    // from the current map even though its enclosing effect has an empty dep array.
    hostsByIdRef.current = hostsById;
    updateHostsFlat(hostsById);
  }, [hostsById]);
  useEffect(() => {
    updateIdentitiesByKey(identitiesByKey);
  }, [identitiesByKey]);

  const selectedConversationId = useSelectedConversationId();
  const activeSet = useActiveSet();
  // Phase 97 UAT follow-up (2026-09-10): fleet-derived roomId → roomTitle
  // map. Consumed by the sync effect below to backfill relay-room tabs
  // that were opened via URL-restore before the fleet session list arrived
  // with the friendly title.
  const relayRoomTitles = useRelayRoomTitles();

  // Phase 97 UAT follow-up (2026-09-10) — relay-room title backfill sync.
  //
  // A URL-restore opens a relay-room tab with `label = spec.roomId` (raw
  // `!xxx:server`) because the friendly title isn't known at restore time
  // (the fleet session list arrives later). Once the fleet list lands with
  // `roomTitle`, this effect syncs the friendly title back into the tab's
  // `label` + `relayRoomTitle` so:
  //   - the conv-list item re-derives (rowFromTab reads `tab.label`)
  //   - the Chrome tab title re-derives (document.title effect earlier
  //     reads `activeTab?.label`).
  //
  // Runs on every relayRoomTitles change (only publishes a new reference
  // when the derived roomId→roomTitle content actually changes — see
  // getRelayRoomTitlesSnapshot in conversation-store). Idempotent: if
  // every tab's label already matches, setTabs sees no changes and
  // returns the same array reference (Object.is stability preserves
  // downstream deps).
  //
  // ⚠️ Placement: this useEffect MUST sit AFTER the `const relayRoomTitles
  // = useRelayRoomTitles()` declaration above. The dep array
  // `[relayRoomTitles]` is evaluated at the useEffect call site during
  // render — placing the useEffect before the const declaration would
  // hit a TDZ ReferenceError at first render (fleet regression 2026-09-10:
  // exactly this happened; app failed to boot with "Cannot access 'He'
  // before initialization" in minified AppShell).
  useEffect(() => {
    if (relayRoomTitles.size === 0) return;
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.sessionKind !== "relay-room" || !t.relayRoomId) return t;
        const fleetTitle = relayRoomTitles.get(t.relayRoomId);
        if (!fleetTitle) return t;
        // Update if the current label is stale (still shows raw roomId or
        // relayRoomTitle is null). Comparing to relayRoomId catches the
        // URL-restore-stub case; comparing to fleetTitle catches later
        // rename-in-fleet propagation.
        if (t.label === fleetTitle && t.relayRoomTitle === fleetTitle) {
          return t;
        }
        changed = true;
        return { ...t, label: fleetTitle, relayRoomTitle: fleetTitle };
      });
      return changed ? next : prev;
    });
  }, [relayRoomTitles]);

  // The "effective active-inline" id is whatever drives the currently-visible
  // conversation view. For session-type tabs (those the conversation-store
  // owns) that is `selectedConversationId`; for singleton / dashboard tabs
  // (host-manager, dashboard, user-profile, admin-settings, tunnel,
  // network_graph — all excluded from the store's ALLOW-list per Plan
  // 06-01), it falls back to `activeTabId`.
  const effectiveSelectedTabId = useMemo(() => {
    if (
      selectedConversationId &&
      tabs.some((t) => t.id === selectedConversationId)
    ) {
      return selectedConversationId;
    }
    return activeTabId;
  }, [selectedConversationId, activeTabId, tabs]);

  // One-way store → AppShell sync: when the ConversationsPanel selects a
  // conversation, mirror it into `activeTabId` so downstream consumers
  // (URL-sync effect, document-title effect, fit-on-active-change effect,
  // keyboard nav, split-view gate) continue to work off a single scalar.
  // Reverse direction (activeTabId → store) is NOT wired — that would
  // create a feedback loop with URL-restore paths that set `activeTabId`
  // before `tabs` is populated. The store consumes `tabs` via the
  // updateOpenTabs effect above and coerces `selectedId` internally when
  // needed (Plan 06-01 T-06-01-01 defense).
  useEffect(() => {
    if (
      selectedConversationId &&
      selectedConversationId !== activeTabId &&
      tabs.some((t) => t.id === selectedConversationId)
    ) {
      setActiveTabId(selectedConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  // Plan 06-03 T-06-03-06 defense: if the user is on the mobile view screen
  // (`mobileScreen === "view"`) but no conversation is currently selected
  // — because it ended, was closed elsewhere, or the store's stale-selection
  // defense (T-06-01-01) coerced selectedId to null — navigate back to the
  // list so the user isn't stranded on an empty view.
  //
  // Patch #132 Fix A: DEBOUNCE the trigger. Tab-open reconciliation briefly
  // nulls selectedConversationId then repopulates within a frame or two;
  // that transient dip used to trip this defense mid-tap and cascade into
  // the URL-sync race that stripped mv=1 (diag-tap-bounce.js confirmed).
  // Real "conversation ended" survives 200ms of no-selection easily; a
  // reconcile null-then-refill does not.
  useEffect(() => {
    if (
      !isTouchDevice ||
      mobileScreen !== "view" ||
      selectedConversationId
    ) {
      return;
    }
    const t = setTimeout(() => navigateToList(), 200);
    return () => clearTimeout(t);
  }, [isTouchDevice, mobileScreen, selectedConversationId]);

  // Patch #111 F3: mobile-tap safety-net. Any change to selectedConversationId
  // on a touch device navigates to the view screen — redundant with the
  // per-handler navigateToView() calls at each row-tap site (Plan 06-03 /
  // 07-01 / 07-02) but catches any code path that changes selection without
  // calling the mobile-flow imperatively (Plan 06-04 selectConversationDeferred
  // flush from a fresh openTab; keyboard shortcut selection; deep-link that
  // arrives without `mv=1`). user UAT'd patch #106 and reported taps on
  // existing fleet-native rows "do nothing" on mobile — the click handlers
  // fire but something in the URL / mobileScreen propagation edge-cases when
  // selection is upstream of the tap wiring. navigateToView is a no-op when
  // already on view (see mobile-flow.ts: `if (hashParams.get(MV_KEY) === MV_VALUE) return`),
  // so the redundant call is free when the per-handler path worked.
  //
  // Deliberately NOT gated on mobileScreen — a stale "list" screen with a
  // fresh selectedId is exactly the state we want to force out of.
  useEffect(() => {
    if (isTouchDevice && selectedConversationId) {
      navigateToView();
    }
  }, [isTouchDevice, selectedConversationId]);

  // Keep the browser URL in sync with the full open-tab set so Chrome's
  // tab-restore (or a bookmark, or a fresh incognito window) reopens the exact
  // same workspace. Emits `#tab=X&tab=Y&active=N` — see patch #35. `only=1`
  // is intentionally NOT emitted here; it's a one-shot marker set only by
  // Move-to-new-window (patch #34). Gated on tabsReady so this doesn't fire
  // until the persisted-restore + URL-driven-open pass has settled the
  // initial tab set — otherwise the default dashboard would clobber the
  // incoming `#tab=` param. See patch #25.
  useEffect(() => {
    if (!tabsReady) return;
    const tabSpecs: TabSpec[] = [];
    let activeIndex: number | undefined;
    for (const t of tabs) {
      const spec = specForTab({
        type: t.type,
        host: t.host,
        // Prefer the live tmux session name discovered post-connect
        // (patch #1) — it's what actually persists across reattaches.
        // Fall back to any explicit target the tab was opened with.
        targetTmuxSession: tmuxSessionNames[t.id] ?? t.targetTmuxSession,
        // Phase 97 Plan 05 (Finding 7): relay-room tabs surface via
        // sessionKind + relayRoomId; specForTab's relay branch emits
        // `relay:<roomId>`. URL is keyed on roomId alone — title landing
        // later must NOT trigger a URL rewrite (see D-15/D-16 landmine).
        sessionKind: t.sessionKind,
        relayRoomId: t.relayRoomId,
        // Phase 120 D-16 — app tabs surface via t.type === "app" + t.app.
        // specForTab's app branch emits `app:<hostId>:<slug>` (see
        // tab-url.ts:313-320). tab.app is undefined for non-app tabs;
        // specForTab returns null for those and the loop continues.
        app: t.app,
      });
      if (!spec) continue;
      if (t.id === activeTabId) activeIndex = tabSpecs.length;
      tabSpecs.push(spec);
    }
    // Phase 56 Plan 02: pre-encode the split tree so writeWorkspaceToUrl
    // splices the `s=`/`t=` params into the outer WorkspaceSpec fragment.
    // The sessionAddress callback maps a tabId → its durable TabSpec
    // (matching the same specForTab resolution used above). If a leaf's tab
    // no longer has a durable spec (e.g. a dashboard tab crept into the
    // tree), split-tree-url.ts's pre-pass strips it — defence-in-depth.
    const splitTreeFragment = encodeSplitTreeToUrl(splitTree, (tabId) => {
      const t = tabs.find((tab) => tab.id === tabId);
      if (!t) return null;
      // Prefer the tab's explicit targetTmuxSession over the runtime
      // tmuxSessionNames map so a shared-link's encoded fragment is
      // stable across the Terminal's post-mount callback that
      // populates tmuxSessionNames a moment later. Fall back to the
      // runtime map only when targetTmuxSession is unset (a bare
      // `claude` launch with no identity, discovered via poll).
      // Otherwise the URL you copy at T=0 would differ from the URL
      // observable at T+1s once Terminal reports back (real UX
      // regression for share-a-link, caught in Phase 56 code review).
      return specForTab({
        type: t.type,
        host: t.host,
        targetTmuxSession: t.targetTmuxSession ?? tmuxSessionNames[t.id],
        // Phase 97 Plan 05 (Finding 7): relay leaf inside a split tree
        // round-trips via sessionKind + relayRoomId (same shape as the
        // top-level URL-sync loop above).
        sessionKind: t.sessionKind,
        relayRoomId: t.relayRoomId,
        // Phase 120 D-16 — app leaf inside a split tree; parallel to the
        // top-level URL-sync loop above. Emits `app:<hostId>:<slug>` so
        // the workspace-share flow + Chrome-tab-restore round-trip apps
        // in a split.
        app: t.app,
      });
    });
    writeWorkspaceToUrl(
      tabSpecs.length === 0
        ? null
        : {
            tabs: tabSpecs,
            activeIndex,
            // Plan 06-03: preserve the mobile-view marker so patch #25's
            // URL-sync effect doesn't clobber `#mv=1` on every tabs change.
            // Only emitted when we're actually on the view screen; on the
            // list screen the field is undefined and encodeWorkspaceSpec
            // omits `&mv=1`. Desktop viewport passes undefined too (mobile-
            // Screen is "list" when isTouchDevice is false because
            // navigateToView is only called from the touchscreen row-tap
            // handler below).
            mobileView: mobileScreen === "view" ? true : undefined,
            // Phase 56 Plan 02: pre-encoded split-tree fragment (or
            // undefined for an empty tree). Threaded through
            // encodeWorkspaceSpec via the new WorkspaceSpec.splitTree field.
            splitTree: splitTreeFragment || undefined,
          },
    );
  }, [activeTabId, tabs, tmuxSessionNames, tabsReady, mobileScreen, splitTree]);

  useEffect(() => {
    // Fire on whichever id drives the visible pane. Plan 06-02: activeTabId
    // and effectiveSelectedTabId are kept in sync via the store→AppShell
    // mirror effect above, so this dep list catches both direct-set
    // (setActiveTabId from a keyboard shortcut, URL restore, or singleton
    // open) and store-driven changes (a ConversationsPanel row click).
    const targetId = effectiveSelectedTabId ?? activeTabId;
    const activeTab = tabs.find((t) => t.id === targetId);
    if (!activeTab?.terminalRef) return;
    let innerRafId: number;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        const ref = activeTab.terminalRef?.current;
        ref?.fit?.();
        ref?.notifyResize?.();
        ref?.refresh?.();
      });
    });
    return () => {
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [activeTabId, effectiveSelectedTabId]);

  useEffect(() => {
    getUserPreferences()
      .then((prefs) => {
        setUserPrefs(prefs);
        if (prefs.theme) setTheme(prefs.theme as ThemeId);
        if (prefs.fontSize) applyFontSize(prefs.fontSize as FontSizeId);
        if (prefs.accentColor) {
          localStorage.setItem("skynet-accent", prefs.accentColor);
          applyAccentColor(prefs.accentColor);
        }
        if (prefs.language && prefs.language !== i18n.language) {
          localStorage.setItem("i18nextLng", prefs.language);
          void i18n.changeLanguage(prefs.language);
        }
      })
      .catch(() => {})
      .finally(() => setUserPrefsLoaded(true));
  }, []);

  // Load real hosts from API
  const loadHosts = useCallback(async () => {
    try {
      const raw = await getSSHHosts();
      const converted = raw.map(sshHostToHost);
      setAllHosts(converted);
      setRealHostTree(buildHostTree(raw));
    } catch {
      // Keep empty state on error
    } finally {
      setHostsLoading(false);
      setHostsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    window.addEventListener("skynet:hosts-changed", loadHosts);
    return () => window.removeEventListener("skynet:hosts-changed", loadHosts);
  }, [loadHosts]);

  // Sync tab host data when allHosts updates (e.g. after editing terminal theme in host settings)
  useEffect(() => {
    if (allHosts.length === 0) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.host
          ? { ...t, host: allHosts.find((h) => h.id === t.host!.id) ?? t.host }
          : t,
      ),
    );
  }, [allHosts]);

  // ── Phase 117 Plan 117-07 (D-05 two-carrier membership + D-39) — boot-time
  //    hydration for projects state ─────────────────────────────────────────
  //
  // Fires once per allHosts refresh. Fetches the project list AND the
  // relay-room project-tag assignments (Fix 1 gate — D-05 relay-room carrier
  // is NOT deferred) for every managed host in parallel. Per-host failures
  // are swallowed (partial hydration is better than none) so a single flaky
  // host does not blank the entire projects state.
  //
  // Wire-event updates from 117-03's publishProjectListChanged flow through
  // the same setProjects setter — identity-equal-skip absorbs the no-op
  // when the boot hydration and first WS snapshot are byte-identical, so
  // there is NO race between the two paths and NO gratuitous re-render.
  //
  // Room-project assignments come from GET /relay-rooms/project-tags. Matrix
  // rooms are fleet-wide (one relay room shared across all hosts), so the
  // per-host fetches return the SAME set — dedup by roomId; last write wins.
  useEffect(() => {
    if (allHosts.length === 0) return;
    let cancelled = false;

    void (async () => {
      // Aggregate ProjectRow[] across managed hosts. listProjects returns
      // {projects: ProjectSummary[]}; enrich with hostId + hostname to
      // become ProjectRow (the shape setProjects wants).
      const projectResults = await Promise.all(
        allHosts.map(async (h) => {
          try {
            const { projects } = await listProjects(parseInt(h.id, 10));
            const rows: ProjectRow[] = projects.map((p) => ({
              slug: p.slug,
              displayName: p.displayName,
              hostId: h.id,
              hostname: h.name,
              archived: p.archived,
            }));
            return rows;
          } catch {
            return [] as ProjectRow[];
          }
        }),
      );
      if (cancelled) return;
      const aggregated: ProjectRow[] = projectResults.flat();
      setProjects(aggregated);

      // Relay-room project-tag hydration (Fix 1 gate). Aggregates the
      // per-host assignments into a single Map<roomId, slug>. Since relay
      // rooms are fleet-wide, the same room may be returned by multiple
      // hosts — we dedupe on roomId with last-write-wins semantics (all
      // hosts should agree on the assignment, so any consistent choice is
      // fine).
      const tagResults = await Promise.all(
        allHosts.map(async (h) => {
          try {
            const { assignments } = await listRelayRoomProjectTags(
              parseInt(h.id, 10),
            );
            return assignments;
          } catch {
            return [] as Array<{ roomId: string; slug: string }>;
          }
        }),
      );
      if (cancelled) return;
      const roomMap = new Map<string, string>();
      for (const list of tagResults) {
        for (const { roomId, slug } of list) {
          roomMap.set(roomId, slug);
        }
      }
      setRoomProjectAssignments(roomMap);
    })();

    return () => {
      cancelled = true;
    };
  }, [allHosts]);

  // Phase 117 H1 fix (2026-09-18): identity-project assignments ────────────
  //
  // The frontend's `state.identityProjectAssignments` Map is what
  // projectForRow() reads to bucket identity conversations into their
  // project section. The map is keyed on `${hostId}::${identityKey.toLowerCase()}`
  // and its values are project slugs.
  //
  // Nothing in production code (pre-H1) ever called setIdentityProjectAssignments
  // — only tests did. This effect closes the loop by deriving the Map from
  // useIdentities() on every identities-store change. Combined with M6's
  // wire-schema extension for IdentityAppearanceSchema.project, this covers
  // both boot hydration AND live WS source-B updates.
  //
  // The setter's identity-equal-skip absorbs no-op fires (StrictMode
  // double-invoke, listeners-fire-without-changes, etc.).
  useEffect(() => {
    const next = new Map<string, string>();
    for (const identity of identitiesByKey.values()) {
      if (identity.project == null) continue;
      if (typeof identity.hostId !== "number") continue;
      const key = `${identity.hostId}::${identity.identityKey.toLowerCase()}`;
      next.set(key, identity.project);
    }
    setIdentityProjectAssignments(next);
  }, [identitiesByKey]);

  // Custom event bridge: any surface can request a tab open via skynet:open-tab
  useEffect(() => {
    const handle = (e: Event) => {
      const { hostId, type } = (
        e as CustomEvent<{ hostId: string; type?: TabType }>
      ).detail;
      const host = allHosts.find((h) => h.id === hostId);
      if (host) connectHost(host, type);
    };
    window.addEventListener("skynet:open-tab", handle);
    return () => window.removeEventListener("skynet:open-tab", handle);
  }, [allHosts]);

  const PERSISTENT_TAB_TYPES: TabType[] = [
    "terminal",
    "rdp",
    "vnc",
    "telnet",
    // Phase 120 D-16 — app tabs persist so reload restores the leaf. The
    // (hostId, slug) tuple flows through addOpenTab's appSlug + hostId
    // fields (Plan 03 added the app_slug column); restoredTabs.push below
    // reconstructs Tab.app when saved.tabType === "app" && saved.appSlug
    // is populated.
    "app",
  ];

  // On load: always read saved tabs from DB so background sessions are preserved across refreshes.
  // If reopenTabsOnLogin is on, also restore them as open tabs in the tab bar.
  const tabRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (!hostsLoaded || !userPrefsLoaded) return;
    if (tabRestoreAttemptedRef.current) return;
    tabRestoreAttemptedRef.current = true;

    async function loadSavedTabs() {
      try {
        const [savedTabs, activeSessions] = await Promise.all([
          getOpenTabs(),
          getActiveSessions(),
        ]);

        // Patch 25 fix: the URL-driven-open block below must run even when
        // there are no persisted tabs — otherwise a hash-only session
        // restore falls through to setTabsReady(true), URL-sync fires with
        // the default dashboard activeTabId, and the hash gets clobbered.
        // So gate the persisted-restore on `savedTabs.length > 0` inline
        // instead of returning early.
        const hasSavedTabs =
          Array.isArray(savedTabs) && savedTabs.length > 0;

        // Hoisted for patch #34: consume the pending URL workspace BEFORE
        // the restore branch so the `only` flag can suppress rehydrate for
        // "Open in new window" origin URLs. Reused below in the URL-driven
        // open block. Idempotent: consumePendingWorkspace clears
        // sessionStorage on first call; a second call would return null.
        // Patch #35: pending is now a WorkspaceSpec (list of tabs + optional
        // active index + optional only) instead of a single TabSpec.
        const pending = consumePendingWorkspace();

        const sessionByInstanceId = new Map(
          hasSavedTabs
            ? (Array.isArray(activeSessions) ? activeSessions : [])
                .filter((s) => s.tabInstanceId != null)
                .map((s) => [s.tabInstanceId, s])
            : [],
        );

        let restoredTabs: Tab[] = [];
        if (hasSavedTabs) {
          if (userPrefs.reopenTabsOnLogin && !pending?.only) {
            const hasPersistentTabs = tabs.some((t) =>
              PERSISTENT_TAB_TYPES.includes(t.type),
            );
            if (!hasPersistentTabs) {
              for (const saved of savedTabs as OpenTabRecord[]) {
                const host = saved.hostId
                  ? allHosts.find((h) => h.id === String(saved.hostId))
                  : undefined;
                // MEDIUM-6 code-review fix (2026-09-19): `"app"` joins
                // `"dashboard"` as a hostless type on the restore path. Per
                // shape 4 "gone-at-reload is a display concern, not a
                // behaviour concern": if the app's home host has been
                // removed from `allHosts` between save and reload, the
                // leaf should STILL restore — the proxy attempt will fail
                // and Phase 103's interstitial renders the failure surface
                // inside the leaf. Pre-fix, missing-host app tabs were
                // silently `continue`d, dropping the tab and breaking
                // split-geometry preservation across reloads.
                const hostlessTypes: TabType[] = ["dashboard", "app"];
                if (!host && !hostlessTypes.includes(saved.tabType as TabType))
                  continue;

                if (host) {
                  if (saved.tabType === "terminal" && !host.enableSsh) continue;
                  if (saved.tabType === "rdp" && !host.enableRdp) continue;
                  if (saved.tabType === "vnc" && !host.enableVnc) continue;
                  if (saved.tabType === "telnet" && !host.enableTelnet) continue;
                }

                // Singleton tabs use their type as the stable ID; host-bound tabs get a unique ID
                const tabId = host
                  ? `${host.name}-${saved.tabType}-${Date.now()}-${saved.tabOrder}`
                  : saved.id;
                const liveSession = sessionByInstanceId.get(saved.id);
                const restoredSessionId =
                  liveSession?.sessionId ?? saved.backendSessionId ?? null;

                restoredTabs.push({
                  id: tabId,
                  instanceId: saved.id,
                  type: saved.tabType as TabType,
                  label: saved.label,
                  host,
                  openedAt: new Date(saved.createdAt).getTime(),
                  restoredSessionId,
                  targetTmuxSession: saved.targetTmuxSession ?? null,
                  terminalRef:
                    saved.tabType === "terminal" ? createRef() : undefined,
                  // Phase 120 D-16 — reconstruct Tab.app when the saved row
                  // is an app tab AND both halves of the (hostId, slug)
                  // tuple are populated. Mid-rollout legacy rows (Plan 03
                  // shipped but Plan 07 didn't) restore without the tuple —
                  // isAppTab narrows to false and renderAppTab returns null
                  // (empty leaf, non-fatal degradation per T-120-40).
                  ...(saved.tabType === "app" &&
                  saved.hostId != null &&
                  saved.appSlug != null
                    ? {
                        app: {
                          hostId: saved.hostId,
                          slug: saved.appSlug,
                        },
                      }
                    : {}),
                });
              }

              // ── patch #150 C investigate (user UAT 2026-07-24) ──
              // Verdict: SAME_BUG. user's two symptoms — (a) only ONE
              // restored tab glowed with .active-set, and (b) the un-glowed
              // tab "did NOT auto-load its content, had to wait" — collapse
              // to a single root cause here: only `restoredTabs[0]` is
              // routed through any store-side signal.
              //
              // Mechanism traced end-to-end:
              //   1. `selectConversationDeferred(restoredTabs[0].id)` here
              //      parks id in `pendingSelectId` (openTabs is still empty
              //      at this synchronous call — setTabs above is batched).
              //   2. React commit → useEffect at L427 → `updateOpenTabs(tabs)`
              //      → the pending-flush at conversation-store.ts:530-533
              //      sets `state.selectedId = restoredTabs[0].id`. NOTE: the
              //      flush path does NOT call `addToActiveSet` — only the
              //      selectedId slot moves.
              //   3. PrettyConversationsPanel.tsx:162-164 useEffect fires on
              //      `selectedId` change → `addToActiveSet(selectedId)` →
              //      restoredTabs[0] glows. Every OTHER restoredTabs entry
              //      is invisible to this whole chain: no pendingSelectId
              //      write, no selectedId flip, no addToActiveSet.
              //
              // Content-load path (why the un-glowed tab also "didn't load"):
              // every tab in `tabs` mounts via the createPortal loop below
              // (~L1598-1626) regardless of selection, BUT Terminal.tsx's
              // WebSocket-connect effect at L2800-2831 is gated on `isVisible`
              // = `!inPane && tab.id === effectiveSelectedTabId`. Only the
              // focused tab is `isVisible=true`, so only its restoredSessionId
              // reconnects at mount. This is CORRECT behavior — we don't want
              // to prefetch N WebSocket handshakes at restore. When user
              // clicks the un-glowed row, `selectConversation` fires (Pretty
              // ConversationsPanel L208), addToActiveSet gives glow + mirror
              // effect L510-519 sets activeTabId → effectiveSelectedTabId
              // flips → isVisible=true → connect fires. That IS the load.
              // The "had to wait" perception is WebSocket handshake latency,
              // not a distinct bug.
              //
              // Fix (patch #150 C below): call `addToActiveSet(t.id)` for
              // EVERY restoredTab so all glow at mount, PLUS keep the single
              // `selectConversationDeferred(restoredTabs[0].id)` for focus/
              // selectedId. We deliberately do NOT loop selectConversation
              // Deferred per tab: pendingSelectId is last-write-wins so it
              // would only ever flush the FINAL restored id, and calling
              // selectConversation directly per tab (for tabs already in
              // openTabs) would move selectedId to the last one, fighting
              // the retained setActiveTabId(restoredTabs[0].id). addToActive
              // Set is the right primitive because it's idempotent per-id
              // and produces the glow without disturbing selection.
              //
              // Consequence: NO #150 D commit needed. Task 4 skipped.
              // ─────────────────────────────────────────────────────────
              if (restoredTabs.length > 0) {
                setTabs((prev) => {
                  const existingIds = new Set(prev.map((t) => t.id));
                  const newTabs = restoredTabs.filter(
                    (t) => !existingIds.has(t.id),
                  );
                  return newTabs.length > 0 ? [...prev, ...newTabs] : prev;
                });
                setActiveTabId(restoredTabs[0].id);
                selectConversationDeferred(restoredTabs[0].id);
                // patch #150 C fix (user followup-3 UAT 2026-07-24):
                // give EVERY restored tab a glow, not just restoredTabs[0].
                // Pre-#150 C the single selectConversationDeferred above
                // only propagated to activeSet for the first tab (via
                // pending-flush → selectedId → PrettyConversationsPanel
                // effect at L162-164 — see the C-investigate block above
                // for the full mechanism trace). addToActiveSet is
                // idempotent and does NOT disturb selectedId, so it's the
                // right primitive: it produces the glow for every restored
                // tab while keeping the "first restored tab is focused"
                // contract (setActiveTabId + selectConversationDeferred
                // above) intact. Regression guard: store-level test
                // "two-URL-tab restore glows both restored tabs" in
                // conversation-store.test.ts.
                for (const t of restoredTabs) addToActiveSet(t.id);
              }
              // Restored tabs are in the tab bar, not in background records
            }
          } else {
            // Not restoring to tab bar — keep as background records for ConnectionsPanel
            setBackgroundTabRecords(savedTabs as OpenTabRecord[]);
          }
        }

        // URL-driven initial open — patches #25 (single tab), #35 (multi-tab).
        // Composes with persisted restore: for each spec in the URL, if it
        // matches a restoredTabs entry, capture that id; otherwise open a
        // fresh tab and capture its id. After the loop, focus the tab at
        // pending.activeIndex. Runs BEFORE setTabsReady(true) so the URL-sync
        // effect fires only once with the final tab set.
        // Phase 56 Plan 02: openedIds is lifted OUT of this block so the
        // splitTree hydration below can also read it — the alphabet in the
        // encoded tree references pending.tabs by position, and openedIds
        // holds the resolution for each of those positions.
        const openedIds: string[] = [];
        const pendingTabSpecsForResolver: TabSpec[] = pending?.tabs ?? [];
        if (pending) {
          for (const spec of pending.tabs) {
            // Phase 97 Plan 05 (Finding 7): relay-room tabs restore via
            // openTab(null, "terminal", ...) matching the onRelayRoomRowClick
            // shape at AppShell.tsx:2169-2176. This branch MUST come before
            // any spec.host access — TabSpec is a discriminated union
            // (Task 1); the relay variant has host?: never.
            // Phase 120 D-16 — app-tab URL restore. TabSpec's app variant
            // carries hostId (string) + slug; construct Tab.app with
            // Number(spec.hostId) at the wire boundary. Idempotency:
            // reuse an already-restored app tab if one with the same
            // (hostId, slug) tuple exists. D-15 multi-instance is NOT
            // violated: idempotency runs per spec in pending.tabs, so
            // two distinct app tabs in the URL (same or different tuple)
            // each get their own openedIds entry via openTab below.
            if (spec.protocol === "app") {
              const restoreHostId = Number(spec.hostId);
              const match = restoredTabs.find(
                (t) =>
                  t.type === "app" &&
                  t.app?.hostId === restoreHostId &&
                  t.app?.slug === spec.slug,
              );
              if (match) {
                openedIds.push(match.id);
              } else {
                const newId = openTab(null, "app", undefined, {
                  app: { hostId: restoreHostId, slug: spec.slug },
                  label: spec.slug,
                  allowCreateTmux: false,
                });
                if (newId) openedIds.push(newId);
              }
              continue; // skip host-required logic below
            }
            if (spec.protocol === "relay") {
              // Idempotency: reuse an already-restored relay-room tab if one
              // with the same roomId exists.
              const match = restoredTabs.find(
                (t) =>
                  t.sessionKind === "relay-room" &&
                  t.relayRoomId === spec.roomId,
              );
              if (match) {
                openedIds.push(match.id);
              } else {
                // Structured log for URL-restore forensics. Room ID is
                // masked to localpart-before-colon to avoid leaking the full
                // share-sensitive address (Phase 93 Landmine 6 discipline;
                // defense-in-depth for T-97-05-03).
                const localpart =
                  spec.roomId.split(":")[0]?.replace(/^!/, "").slice(0, 12) ??
                  "unknown";
                // eslint-disable-next-line no-console
                console.info({
                  operation: "relay_room_url_restore",
                  roomIdLocalpart: localpart,
                  hasMatch: false,
                });
                const newId = openTab(null, "terminal", undefined, {
                  sessionKind: "relay-room",
                  relayRoomId: spec.roomId,
                  // useRelayAdapter fills in the title via the session frame.
                  relayRoomTitle: null,
                  // Loading placeholder — the tab label updates once the
                  // room title lands from the session frame.
                  label: spec.roomId,
                  allowCreateTmux: false,
                });
                if (newId) openedIds.push(newId);
              }
              continue; // skip the host-required logic below
            }
            const wantType: TabType =
              spec.protocol === "tmux"
                ? "terminal"
                : (spec.protocol as TabType);
            const wantSession =
              spec.protocol === "tmux" ? (spec.session ?? null) : null;
            // Look up host by name (case-insensitive) OR id as a rename-fallback.
            const needle = spec.host.toLowerCase();
            const host =
              allHosts.find((h) => h.name.toLowerCase() === needle) ??
              allHosts.find((h) => h.id === spec.host);
            if (!host) continue;
            const enabledForType =
              (wantType === "terminal" && host.enableSsh) ||
              (wantType === "rdp" && host.enableRdp) ||
              (wantType === "vnc" && host.enableVnc) ||
              (wantType === "telnet" && host.enableTelnet);
            if (!enabledForType) continue;
            const match = restoredTabs.find(
              (t) =>
                t.host?.id === host.id &&
                t.type === wantType &&
                (t.targetTmuxSession ?? null) === wantSession,
            );
            if (match) {
              openedIds.push(match.id);
            } else {
              const newId = openTab(
                host,
                wantType,
                undefined,
                wantSession
                  ? { targetTmuxSession: wantSession, label: wantSession }
                  : undefined,
              );
              if (newId) openedIds.push(newId);
            }
          }
          // Focus the requested active tab. If activeIndex is missing or
          // out of range, fall back to the first opened id (openTab already
          // sets active on each call, so the last iteration wins if we don't
          // override — this restores predictable focus regardless).
          if (openedIds.length > 0) {
            const idx =
              typeof pending.activeIndex === "number" &&
              pending.activeIndex >= 0 &&
              pending.activeIndex < openedIds.length
                ? pending.activeIndex
                : 0;
            setActiveTabId(openedIds[idx]);
            selectConversationDeferred(openedIds[idx]);
            // patch #230 A: URL-restored tabs need the same #150 C fix
            // as persisted-restore above — without addToActiveSet per
            // opened tab, non-active URL-hash tabs stay ambient in
            // pretty-conversations and don't connect their WebSocket
            // until first click. addToActiveSet is idempotent, so
            // openedIds[idx] getting hit both here and via the
            // selectConversationDeferred → selectedId → panel effect
            // path is a harmless no-op.
            for (const id of openedIds) addToActiveSet(id);
          }
        }

        // Phase 56 Plan 02: hydrate splitTree from the URL fragment after
        // the tab set has been materialized. The resolver maps a TabSpec
        // back to a live tabId by walking (a) restoredTabs (from persisted
        // restore above), and (b) the ids openedIds captured for freshly
        // URL-opened tabs. A null resolver return drops the leaf;
        // decodeSplitTreeFromUrl collapses any single-child split that
        // results (graceful degradation per Plan 56-01's Test 10). A decoded
        // null tree leaves splitTree at its initial null — no visible split,
        // matches "no split state".
        //
        // openedIds is a POSITIONAL projection over pending.tabs but the
        // in-loop `continue` on unmatched host/type skips push — so we
        // reconcile by resolving each pending-tab spec independently against
        // the just-populated tab set. Since openTab has synchronous access
        // to the host/type/session in its options, and setTabs is batched,
        // the resolver's most reliable source is a keyed lookup of pending.
        // tabs specs onto the ids we accumulated.
        if (pending?.splitTree) {
          // Build a spec-key → tabId map from ONLY the successfully-opened
          // pending tabs. Rebuild the same host/type filter loop to keep the
          // positional accounting straight even under `continue` skips.
          const specToTabId = new Map<string, string>();
          {
            let openedIdx = 0;
            for (const spec of pending.tabs) {
              // Phase 97 Plan 05 (Finding 7) BLOCKER-1: relay branch MUST
              // come before any spec.host access — TabSpec's discriminated
              // union types host as never on the relay variant, and the
              // runtime value is undefined. Prior to this branch the loop
              // called `spec.host.toLowerCase()` and built a bogus
              // `"relay:undefined:"` key that masked the bug.
              if (spec.protocol === "relay") {
                const key = `relay:${spec.roomId}`;
                const id = openedIds[openedIdx];
                if (id) specToTabId.set(key, id);
                openedIdx += 1;
                continue;
              }
              // Phase 120 D-16 — app branch MUST come before any spec.host
              // access. Symmetric with the relay branch above; the app
              // variant carries host?: never so runtime host is undefined.
              if (spec.protocol === "app") {
                const key = `app:${spec.hostId}:${spec.slug}`;
                const id = openedIds[openedIdx];
                if (id) specToTabId.set(key, id);
                openedIdx += 1;
                continue;
              }
              const wantType: TabType =
                spec.protocol === "tmux"
                  ? "terminal"
                  : (spec.protocol as TabType);
              const wantSession =
                spec.protocol === "tmux" ? (spec.session ?? null) : null;
              const needle = spec.host.toLowerCase();
              const host =
                allHosts.find((h) => h.name.toLowerCase() === needle) ??
                allHosts.find((h) => h.id === spec.host);
              if (!host) continue;
              const enabledForType =
                (wantType === "terminal" && host.enableSsh) ||
                (wantType === "rdp" && host.enableRdp) ||
                (wantType === "vnc" && host.enableVnc) ||
                (wantType === "telnet" && host.enableTelnet);
              if (!enabledForType) continue;
              const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;
              const id = openedIds[openedIdx];
              if (id) specToTabId.set(key, id);
              openedIdx += 1;
            }
          }
          const resolver = (spec: TabSpec): string | null => {
            // Phase 97 Plan 05 (Finding 7) BLOCKER-1: relay branch first —
            // matches on roomId identity (both the map key and the fallback
            // walk). The unpatched form threw TypeError on spec.host.toLowerCase()
            // and produced a bogus fallback host-id comparison.
            if (spec.protocol === "relay") {
              const key = `relay:${spec.roomId}`;
              const hit = specToTabId.get(key);
              if (hit) return hit;
              // Fallback: walk restoredTabs + closure tabs looking for a
              // relay-room tab with the same roomId.
              for (const t of [...restoredTabs, ...tabs]) {
                if (
                  t.sessionKind === "relay-room" &&
                  t.relayRoomId === spec.roomId
                ) {
                  return t.id;
                }
              }
              return null;
            }
            const key = `${spec.protocol}:${spec.host}:${spec.session ?? ""}`;
            const hit = specToTabId.get(key);
            if (hit) return hit;
            // Fallback: walk restoredTabs + closure tabs.
            const wantSession =
              spec.protocol === "tmux" ? (spec.session ?? null) : null;
            const wantHostNeedle = spec.host.toLowerCase();
            for (const t of [...restoredTabs, ...tabs]) {
              const hostNameMatch =
                (t.host?.name ?? "").toLowerCase() === wantHostNeedle;
              const hostIdMatch = t.host?.id === spec.host;
              const sessionMatch =
                (t.targetTmuxSession ?? null) === wantSession;
              if ((hostNameMatch || hostIdMatch) && sessionMatch) return t.id;
            }
            return null;
          };
          const decoded = decodeSplitTreeFromUrl(pending.splitTree, resolver);
          if (decoded !== null) setSplitTree(decoded);
        }
        // Reference pendingTabSpecsForResolver so lint doesn't flag it —
        // it's declared as a defensive alias but the resolver uses the
        // in-line reload above for accuracy.
        void pendingTabSpecsForResolver;

      } catch {
        // silently fail
      } finally {
        setTabsReady(true);
      }
    }

    loadSavedTabs();
  }, [hostsLoaded, userPrefsLoaded]);

  // Debounced tab-order sync: when tab order changes, patch each persistent tab's tabOrder in DB.
  const orderSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevTabOrderRef = useRef<string>("");
  useEffect(() => {
    if (!tabsReady) return;
    const persistable = tabs.filter((t) =>
      PERSISTENT_TAB_TYPES.includes(t.type),
    );
    const orderKey = persistable.map((t) => t.instanceId).join(",");
    if (orderKey === prevTabOrderRef.current) return;
    prevTabOrderRef.current = orderKey;

    if (orderSyncTimeoutRef.current) clearTimeout(orderSyncTimeoutRef.current);
    orderSyncTimeoutRef.current = setTimeout(() => {
      persistable.forEach((t, i) => {
        patchOpenTab(t.instanceId, { tabOrder: i }).catch(() => {});
      });
    }, 500);

    return () => {
      if (orderSyncTimeoutRef.current)
        clearTimeout(orderSyncTimeoutRef.current);
    };
  }, [tabs, tabsReady]);

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(
    // Phase 90 Plan 07 Task 3: first arg widened to accept `null` — relay-
    // room tabs have NO Host (the room lives on the Matrix relay, not any
    // fleet host). Legacy callers still pass a Host as before; the null
    // path is only exercised by the relay-room branch of the sidebar
    // onRelayRoomRowClick callback (mounted below at the
    // PrettyConversationsPanel invocation site).
    host: Host | null,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: {
      targetTmuxSession?: string | null;
      label?: string;
      allowCreateTmux?: boolean;
      // Phase 90 Plan 07 Task 3 — relay-room fields threaded onto the Tab
      // so tabUtils's dispatcher branches to the shared chat surface
      // (PrettyView with source.kind === "relay" per Phase 93 Slice 4).
      // Plan 01 widened Tab with these three fields; here we accept them
      // as options and pass them onto the Tab object below.
      sessionKind?: "harness" | "relay-room";
      relayRoomId?: string;
      relayRoomTitle?: string | null;
      // Phase 120 D-02 — app tuple. Present only when type === "app";
      // carries the (hostId, slug) identifying the app leaf. AppShell's
      // AppTile onOpenApp callback + onDropAppTileInTree callback both
      // pass this through so the created Tab carries `Tab.app` and
      // persistence + URL-fragment round-trips see the tuple.
      app?: { hostId: number; slug: string };
    },
  ): string {
    // Patch #35: append a monotonic counter suffix so multiple openTab
    // calls in the same synchronous tick (e.g. URL-driven multi-tab
    // restore) don't collide when Date.now() returns identical values.
    // Same-ms is possible in a tight for-loop over an array of specs.
    //
    // Phase 90 Plan 07 Task 3: `host?.name ?? "relay-room"` for the id
    // prefix — the id shape stays greppable in logs even for host-less
    // relay-room tabs. `host` is null for relay-room tabs.
    const hostNameForId = host?.name ?? "relay-room";
    const tabId = `${hostNameForId}-${type}-${Date.now()}-${openTabCounter.current++}`;
    const instanceId =
      restore?.instanceId ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    const openedAt = Date.now();
    const ref = type === "terminal" ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);
    const targetTmuxSession = options?.targetTmuxSession ?? null;
    // Ephemeral (see Tab type): only set true when the New Session dialog
    // asked for a fresh session name. Restored tabs (URL, persisted) never
    // set it, so a killed target session errors instead of resurrecting
    // as an empty pane.
    const allowCreateTmux = options?.allowCreateTmux ?? false;
    // If caller supplied a tmux session label, use it directly (skip the
    // "(2)", "(3)" duplicate-host-name dedupe pass since the session name
    // is what disambiguates).
    const customLabel = options?.label ?? null;
    // Phase 90 Plan 07 Task 3 — the relay-room fields; only present when
    // the caller is spawning a relay-room tab.
    const sessionKind = options?.sessionKind;
    const relayRoomId = options?.relayRoomId;
    const relayRoomTitle = options?.relayRoomTitle ?? null;
    // Phase 120 D-02 — app tuple; only present when the caller is spawning
    // an app-type tab. Present when type === "app"; absent otherwise.
    const appTuple = options?.app;

    // Fallback label when host is null and no custom label supplied — use
    // the room title (if any) so the tab title reads meaningfully; else the
    // room id; else a bare "Relay room". Relay-room callers always supply
    // a label, so this fallback only fires defensively.
    const hostName = host?.name ?? relayRoomTitle ?? relayRoomId ?? "Relay room";

    let finalLabel = customLabel ?? hostName;
    setTabs((prev) => {
      if (customLabel) {
        return [
          ...prev,
          {
            id: tabId,
            instanceId,
            type,
            label: customLabel,
            host: host ?? undefined,
            openedAt,
            terminalRef: ref,
            restoredSessionId: restore?.restoredSessionId ?? null,
            targetTmuxSession,
            allowCreateTmux,
            ...(sessionKind !== undefined ? { sessionKind } : {}),
            ...(relayRoomId !== undefined ? { relayRoomId } : {}),
            ...(sessionKind === "relay-room"
              ? { relayRoomTitle }
              : {}),
            // Phase 120 D-02 — app-tab tuple. Only spread when the caller
            // provided the app option (i.e. type === "app"). D-15 multi-
            // instance: no dedupe here — a second openTab call with the
            // same (hostId, slug) tuple appends a fresh Tab, resulting in
            // two independent leaves that each connect independently.
            ...(appTuple !== undefined ? { app: appTuple } : {}),
          },
        ];
      }
      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === hostName,
      );
      finalLabel =
        same.length === 0 ? hostName : `${hostName} (${same.length + 1})`;

      // Retrofit the first duplicate's label to "(1)" if needed
      const next =
        same.length === 1 && !/\(\d+\)$/.test(same[0].label)
          ? prev.map((t) =>
              t.id === same[0].id ? { ...t, label: `${hostName} (1)` } : t,
            )
          : prev;

      return [
        ...next,
        {
          id: tabId,
          instanceId,
          type,
          label: finalLabel,
          host: host ?? undefined,
          openedAt,
          terminalRef: ref,
          restoredSessionId: restore?.restoredSessionId ?? null,
          targetTmuxSession,
          allowCreateTmux,
          ...(sessionKind !== undefined ? { sessionKind } : {}),
          ...(relayRoomId !== undefined ? { relayRoomId } : {}),
          ...(sessionKind === "relay-room" ? { relayRoomTitle } : {}),
          // Phase 120 D-02 — see the customLabel branch above.
          ...(appTuple !== undefined ? { app: appTuple } : {}),
        },
      ];
    });
    setActiveTabId(tabId);

    if (PERSISTENT_TAB_TYPES.includes(type)) {
      addOpenTab({
        id: instanceId,
        tabType: type,
        // Phase 90 Plan 07 Task 3: relay-room tabs have no host so hostId
        // is null. Backend persistence layer already accepts null hostId
        // for other tab types with no host binding (settings singletons,
        // dashboard). Docs for relay-room persistence semantics deferred
        // to a follow-up quick if/when open-tab restore for relay-room
        // becomes desirable.
        //
        // Phase 120 D-16: app tabs carry hostId via the app tuple (not via
        // the resolved `host` object — AppTile passes null for the host arg
        // to openTab and provides { app: { hostId, slug } } via options).
        // Fall through to the tuple's hostId when host is absent so the
        // persisted row identifies the home box for reload restore.
        hostId: host
          ? parseInt(host.id)
          : appTuple
            ? appTuple.hostId
            : null,
        label: finalLabel,
        tabOrder: 0,
        targetTmuxSession,
        // Phase 120 D-16 — app-slug tuple half. Null for every non-app tab
        // type (matches the nullable column added in Plan 03).
        appSlug: appTuple?.slug ?? null,
      }).catch(() => {});
    }
    return tabId;
  }, []);

  // Phase 128 Plan 07 Task 3 (D-08) — openRoom deep-link handler.
  //
  // The public/sw.js notificationclick handler (Plan 04) navigates the
  // client to `/?openRoom=<roomId>`. This mount-only effect delegates to
  // parseAndOpenRoomFromUrl, which:
  //   - reads the openRoom param via `new URLSearchParams(window.location.search)`;
  //   - guards on non-empty + basic Matrix-room-id shape (starts with `!`,
  //     contains `:`) so malformed input warns without crashing (T-126-36);
  //   - fires the injected open-callback below to open the relay-room tab;
  //   - strips the openRoom param via `window.history.replaceState(null, "", pathname)`
  //     so a reload doesn't re-trigger the deep-link and a copied URL after
  //     arrival doesn't embed the roomId (T-126-38).
  //
  // AppShell's open-callback mirrors the sidebar's onRelayRoomRowClick
  // handler (site ~L3200): looks up the friendly title from the
  // relay-room-titles snapshot, calls openTab with the same relay-room
  // options shape, then selectConversationDeferred to promote the tab.
  // If the fleet snapshot hasn't populated the title yet, the raw roomId
  // is used as the label — the Phase 97 title-backfill effect (L1131-1151)
  // upgrades the label when the fleet snapshot lands.
  //
  // Runs once per mount: guarded by openRoomFiredRef so a store-driven
  // re-render doesn't re-trigger. No auto-prompt for notification
  // permission on mount (D-10) — the opt-in surface is the modal
  // opened from the PrettyConversationsPanel kebab menu.
  const openRoomFiredRef = useRef(false);
  useEffect(() => {
    if (openRoomFiredRef.current) return;
    openRoomFiredRef.current = true;
    parseAndOpenRoomFromUrl((roomId) => {
      // Look up the friendly title from the relay-room-titles snapshot;
      // fall back to the roomId as label if the snapshot isn't populated
      // yet (Phase 97 title-backfill effect will fix the label later).
      const roomTitle = relayRoomTitles.get(roomId) ?? null;
      const newTabId = openTab(null, "terminal", undefined, {
        sessionKind: "relay-room",
        relayRoomId: roomId,
        relayRoomTitle: roomTitle,
        label: roomTitle ?? roomId,
        allowCreateTmux: false,
      });
      selectConversationDeferred(newTabId);
    });
    // Deliberately mount-only — the sw.js navigation reloads the SPA (or
    // navigates the existing client via .navigate), so a fresh AppShell
    // mount is exactly when the param is meaningful. Later re-renders
    // must not fire this again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectHost(host: Host, preferredType?: TabType) {
    const type: TabType =
      preferredType ??
      (host.enableSsh
        ? "terminal"
        : host.enableRdp
          ? "rdp"
          : host.enableVnc
            ? "vnc"
            : host.enableTelnet
              ? "telnet"
              : "terminal");
    openTab(host, type);
  }

  // Phase 11 Plan 03: openSingletonTab function RETIRED per Plan 01 Section E
  // item 6 disposition protocol. Post-strip grep confirmed zero surviving
  // consumers: the AppRail onOpenTab prop (line 1844) died with the AppRail
  // mount removal, the ConnectionsPanel onReopenTab callback (line 1658) died
  // with the {railView==="connections"} panel-branch strip, and the
  // renderTabContent pass-through (line 2037) had no live consumer in
  // tabUtils.tsx after Plan 02's <PrettyLandingCard/> swap replaced the
  // <DashboardTab onOpenSingletonTab={...}/> that was its only case-body user.

  const SESSION_TAB_TYPES: TabType[] = ["terminal", "rdp", "vnc", "telnet"];

  function doCloseTab(id: string) {
    const tabToClose = tabs.find((t) => t.id === id);
    if (
      tabToClose?.instanceId &&
      PERSISTENT_TAB_TYPES.includes(tabToClose.type)
    ) {
      deleteOpenTab(tabToClose.instanceId).catch(() => {});
    }

    terminalRefs.current.delete(id);
    // Patch #TBD (bounty #5 — deactivate-conversation-instant):
    // WHY: deactivating an active conversation used to freeze the UI for ~1s because
    // these four setState calls batched with the Zustand `removeFromActiveSet` from the
    // caller (handleRowDeactivate) into a single React commit that unmounted the
    // deactivated PrettyView AND mounted a fresh PrettyView (WS setup + backfill
    // dispatch + hundreds of message bubbles).
    // WHAT: startTransition tells React to commit the urgent Zustand active-set removal
    // first (list paints instantly), then commit this tab switch as a deferred transition
    // (new pane mounts async without blocking the paint).
    // TRADE-OFF: for a fraction of a second the right pane may still show the
    // just-deactivated view while the list updates. Accepted — user isn't waiting on
    // the session unload, she's waiting on the list to acknowledge her tap.
    // DO NOT revert to a synchronous batch — this split is the whole point of the block.
    startTransition(() => {
      if (id === activeTabId) {
        const remaining = tabs.filter((t) => t.id !== id);
        const nextId =
          remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard";
        setActiveTabId(nextId);
        // Patch #180: keep selectedConversationId in lockstep with activeTabId
        // when a close forces the switch. Otherwise `.pv-row.selected` (the
        // bright ring + glow from patch #175) stays anchored to the dead id
        // and the survivor gains no visible selection indicator. Dashboard is
        // not a conversation, so fall back to null (clears the ring entirely).
        //
        // Mobile guard: on touch devices this sync also drives the patch #111
        // F3 effect (~L582) that fires navigateToView() on any
        // selectedConversationId change — which yanks user off the list
        // screen and into whatever tab got promoted, when all she wanted was
        // to deactivate one row and stay put. Skip the sync on mobile; the
        // deactivated row's ring disappears with the row anyway, and the
        // survivor gets its ring the next time she taps it.
        if (!isTouchDevice) {
          selectConversation(nextId === "dashboard" ? null : nextId);
        }
      }
      // Phase 56 Plan 02: split state is now a recursive SplitNode tree.
      // removeLeaf drops the closing tab's leaf and collapses any single-
      // child parent split by promoting the surviving sibling. Cheap no-op
      // (Object.is on return === input) when the tab is not in the tree.
      setSplitTree((prev) => removeLeaf(prev, id));
      // Clear focused-tab reference on close so it can't dangle at a
      // closed tab's id (Phase 57/58 layer more focus-driven visuals on
      // this signal — a stale reference silently breaks them).
      setFocusedTabId((prev) => (prev === id ? null : prev));
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0)
          return [
            {
              id: "dashboard",
              instanceId: "dashboard",
              type: "dashboard",
              label: brandingConfig.appName,
              openedAt: Date.now(),
            },
          ];
        return next;
      });
    });
  }

  function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    const confirmEnabled = localStorage.getItem("confirmTabClose") === "true";
    if (tab && SESSION_TAB_TYPES.includes(tab.type) && confirmEnabled) {
      toast(t("nav.confirmClose"), {
        duration: 5000,
        action: {
          label: t("nav.close"),
          onClick: () => doCloseTab(id),
        },
        cancel: {
          label: t("nav.cancel"),
          onClick: () => {},
        },
      });
      return;
    }
    doCloseTab(id);
  }

  // Phase 56 Plan 02: the four preset-mode helpers (add / remove / quick /
  // assign) are RETIRED. Their consumers were the retired SplitView prop set
  // (slot-array assignment, mode-enum preset picker). The new tree model has
  // one uniform handler — openSessionInTree — driven by drop events.
  //
  // openSessionInTree is the single drop handler for both first-drop-into-
  // empty and drop-onto-existing-cell paths. removeLeaf-then-insertAtEdge
  // handles both "add a session that isn't in the tree" and "move a session
  // that's already somewhere in the tree to a new position" uniformly:
  //   - If the session isn't in the tree, removeLeaf is a no-op (Object.is
  //     on input === output holds true) and insertAtEdge plants it.
  //   - If the session is already in the tree, removeLeaf collapses the
  //     source cell and insertAtEdge splits the target cell — same net
  //     effect as a move.
  // Plan 56-03 wires the row-drag source; this plan wires the drop receiver.
  const openSessionInTree = useCallback(
    (tabId: string, path: SplitPath, edge: DropEdge) => {
      setSplitTree((prev) => {
        // Patch #512 diag: log tree edit boundaries so a failing drop is
        // debuggable from console-forward alone.
        const prevShape = describeTreeShape(prev);
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-tree] openSessionInTree tabId=${tabId} targetPath=${JSON.stringify(path)} edge=${edge} prev=${prevShape}`,
        );
        // Empty tree → root-insert; edge is irrelevant.
        if (prev === null) {
          const next = insertAtEdge(null, [], { kind: "session", tabId }, edge);
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-tree] openSessionInTree branch=empty-root next=${describeTreeShape(next)}`,
          );
          return next;
        }

        // Same-cell drop: the target IS the leaf being moved. No-op —
        // avoid the null-flicker (splitTree → null → repopulated) that
        // otherwise ripples through the visibility gate and any
        // splitTree-dependent effect.
        const sourcePath = findLeaf(prev, tabId);
        if (
          sourcePath !== null &&
          sourcePath.length === path.length &&
          sourcePath.every((v, i) => v === path[i])
        ) {
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-tree] openSessionInTree branch=same-cell-noop sourcePath=${JSON.stringify(sourcePath)}`,
          );
          return prev;
        }

        // Capture the target's tabId BEFORE removeLeaf collapses ancestors.
        // The `path` argument was resolved against `prev`; after removeLeaf
        // any ancestor split may have collapsed, shifting downstream
        // indices. Look up the target leaf's tabId here, then rediscover
        // its fresh path in the post-removal tree.
        const targetNode = getNodeAt(prev, path);
        const targetTabId =
          targetNode !== null && targetNode.kind === "session"
            ? targetNode.tabId
            : null;

        const withoutDup = removeLeaf(prev, tabId);
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-tree] openSessionInTree post-remove targetTabId=${targetTabId ?? "(null)"} withoutDup=${describeTreeShape(withoutDup)} sourcePath=${sourcePath !== null ? JSON.stringify(sourcePath) : "(none)"}`,
        );
        if (withoutDup === null) {
          // Source was the whole tree (single leaf) — plant fresh.
          const next = insertAtEdge(null, [], { kind: "session", tabId }, edge);
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-tree] openSessionInTree branch=source-was-whole-tree next=${describeTreeShape(next)}`,
          );
          return next;
        }

        // If the target's tabId is the tab we just removed (target IS
        // source through a different code path — e.g. same tabId appears
        // at different-looking paths under aliasing), treat as a no-op.
        if (targetTabId === null || targetTabId === tabId) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pv-split-tree] openSessionInTree branch=target-null-or-same targetTabId=${targetTabId ?? "(null)"} tabId=${tabId} → return withoutDup (no visible change)`,
          );
          return withoutDup;
        }

        // Rediscover the target's fresh path in the post-removal tree.
        const freshPath = findLeaf(withoutDup, targetTabId);
        if (freshPath === null) {
          // Target vanished during removeLeaf (shouldn't happen for a
          // distinct tabId, but guard anyway). Preserve surviving cells.
          // eslint-disable-next-line no-console
          console.warn(
            `[pv-split-tree] openSessionInTree branch=target-vanished targetTabId=${targetTabId} → return withoutDup`,
          );
          return withoutDup;
        }

        try {
          const next = insertAtEdge(
            withoutDup,
            freshPath,
            { kind: "session", tabId },
            edge,
          );
          // eslint-disable-next-line no-console
          console.info(
            `[pv-split-tree] openSessionInTree branch=insert freshPath=${JSON.stringify(freshPath)} next=${describeTreeShape(next)}`,
          );
          return next;
        } catch (err) {
          // Preserve surviving cells over degraded root-insert. Wiping
          // the tree on a caller-side path error was the CVE-class bug
          // caught in code review (would silently destroy every other
          // open session in the arrangement).
          // eslint-disable-next-line no-console
          console.warn(
            `[pv-split-tree] openSessionInTree branch=insert-catch freshPath=${JSON.stringify(freshPath)} err=${(err as Error).message} → return withoutDup`,
          );
          return withoutDup;
        }
      });
      setFocusedTabId(tabId);
    },
    [],
  );

  // ─── Phase 64 Plan 02: center-drop handlers ─────────────────────────────
  //
  // Both mirror openSessionInTree's functional-updater shape (setSplitTree
  // wrapped around a Plan 64-01 helper) with SYMMETRIC FOCUS SEMANTICS
  // per CONTEXT.md § In-scope item 2 (revised): the session the user was
  // "carrying" during the drag lands focused in its new cell.
  //   - replaceInTree(replacementTabId, targetTabId) → focus goes to the
  //     replacement (the incoming session).
  //   - swapInTree(tabIdA, tabIdB) → focus goes to tabIdA (the dragged
  //     badge's source session, which lands in its new cell).
  //
  // Neither handler calls closeTab — the displaced session on replace
  // stays live in `tabs[]`, just kicked out of the grid ("still present in
  // the conv list, just no longer occupying a slot" per CONTEXT.md § What
  // this is line 3). The URL-sync effect at :868 fires on every splitTree
  // change automatically — no additional wiring needed.
  //
  // See:
  //   .planning/phases/64-multi-view-center-drop/64-CONTEXT.md
  //   src/ui/lib/split-tree.ts replaceLeaf + swapLeaves (Plan 64-01).

  const replaceInTree = useCallback(
    (replacementTabId: string, targetTabId: string) => {
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] replace target=${targetTabId} with=${replacementTabId}`,
      );
      setSplitTree((prev) => replaceLeaf(prev, targetTabId, replacementTabId));
      setFocusedTabId(replacementTabId);
    },
    [],
  );

  const swapInTree = useCallback(
    (tabIdA: string, tabIdB: string) => {
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] swap a=${tabIdA} b=${tabIdB}`,
      );
      setSplitTree((prev) => swapLeaves(prev, tabIdA, tabIdB));
      setFocusedTabId(tabIdA);
    },
    [],
  );

  // Rescue affordance for the "Session no longer exists" pane placeholder in
  // SplitView. Fires when the user clicks the placeholder's Close button on a
  // leaf whose tabId is no longer present in tabs[] — cross-window drag left
  // a stranger tabId, or a session died mid-view. Prunes the leaf and
  // collapses any resulting single-child split via split-tree removeLeaf.
  const closeStalePane = useCallback((tabId: string) => {
    // eslint-disable-next-line no-console
    console.info(`[pv-split-tree] closeStalePane tabId=${tabId}`);
    setSplitTree((prev) => removeLeaf(prev, tabId));
  }, []);

  // ─── Cross-window drag/drop (2026-09-17) ───────────────────────────────
  //
  // When a drag ends up in a DIFFERENT same-origin Skynet window
  // (two Chrome windows/tabs each running Skynet), the receiving window
  // should verify the payload resolves to a real (host + identity) it has
  // access to and open a fresh session for it — rather than blindly planting
  // a leaf pointing at a stranger tabId (which produced the "Session no
  // longer exists" placeholder pane and had no dismiss affordance until
  // this pass added the Close button above).
  //
  // Wire (see @/shell/cross-window-drag for the transport):
  //   1. Source (drag origin) — IdentityBadge / PrettyConversationRow mint
  //      a dragId at dragstart, arm {dragId → tabId} in the module, and
  //      embed dragId in the drag payload.
  //   2. Target (drop landing) — resolveBadgePayloadTabId / the existing
  //      resolveRowPayloadTabId map descriptor→tabId, opening a fresh tab
  //      if needed. On success, post BroadcastChannel accept with dragId.
  //   3. Source (again) — subscribeToDragAccepts fires with the tabId that
  //      was armed for the dragId. We doCloseTab that tabId — the drag
  //      behaves as a hard MOVE (session lives in exactly one window).
  //
  // Same-window drops don't loop back (BroadcastChannel doesn't deliver a
  // post to the sender's own channel — spec-guaranteed), so same-window
  // drag/swap behavior is unchanged.

  const resolveBadgePayloadTabId = useCallback(
    (payload: {
      tabId?: string | null;
      identityKey?: string | null;
      hostId?: number | null;
      descriptor?: {
        tabType?: TabType;
        sessionKind?: "harness" | "relay-room";
        relayRoomId?: string;
        relayRoomTitle?: string | null;
        targetTmuxSession?: string | null;
      } | null;
    }): string | null => {
      // Same-window: tabId already known to this window's tabs[].
      if (
        typeof payload.tabId === "string" &&
        tabs.some((t) => t.id === payload.tabId)
      ) {
        return payload.tabId;
      }
      // Cross-window: descriptor is required to open a fresh session.
      const descriptor = payload.descriptor;
      if (!descriptor) return null;
      // Relay-room: hostless tab, keyed by relayRoomId.
      if (
        descriptor.sessionKind === "relay-room" &&
        typeof descriptor.relayRoomId === "string" &&
        descriptor.relayRoomId.length > 0
      ) {
        return openTab(null, "terminal", undefined, {
          sessionKind: "relay-room",
          relayRoomId: descriptor.relayRoomId,
          relayRoomTitle: descriptor.relayRoomTitle ?? null,
          label: descriptor.relayRoomTitle ?? descriptor.relayRoomId,
        });
      }
      // Host-based session (terminal/rdp/vnc/telnet). hostId lookup against
      // this window's flat host map — target window must have this host in
      // its own tree for the fresh-open to succeed. Missing host = silent
      // reject (no black hole).
      if (typeof payload.hostId !== "number") return null;
      const host = hostsById.get(payload.hostId);
      if (!host) return null;
      const type: TabType = descriptor.tabType ?? "terminal";
      if (type === "rdp") return openTab(host, "rdp");
      if (type === "terminal") {
        return openTab(host, "terminal", undefined, {
          targetTmuxSession: descriptor.targetTmuxSession ?? null,
          label: descriptor.targetTmuxSession ?? undefined,
          allowCreateTmux: false,
        });
      }
      return openTab(host, type);
    },
    [tabs, hostsById, openTab],
  );

  // Edge-zone badge drop handler — the counterpart to onDropRowInTree for
  // the row MIME. Resolves payload to a real tabId (same-window match or
  // cross-window fresh-open), inserts into the split tree, echoes the
  // dragId back so the source window can hard-close its outbound tab.
  const onDropBadgeInTree = useCallback(
    (
      payload: {
        tabId?: string | null;
        dragId?: string | null;
        identityKey?: string | null;
        hostId?: number | null;
        descriptor?: {
          tabType?: TabType;
          sessionKind?: "harness" | "relay-room";
          relayRoomId?: string;
          relayRoomTitle?: string | null;
          targetTmuxSession?: string | null;
        } | null;
      },
      path: SplitPath,
      edge: DropEdge,
    ) => {
      const resolvedTabId = resolveBadgePayloadTabId(payload);
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] onDropBadgeInTree resolve payloadTabId=${payload.tabId ?? "?"} identity=${payload.identityKey ?? "?"} hostId=${payload.hostId ?? "?"} → resolvedTabId=${resolvedTabId ?? "(null — aborting)"}`,
      );
      if (resolvedTabId === null) return;
      openSessionInTree(resolvedTabId, path, edge);
      selectConversationDeferred(resolvedTabId);
      if (typeof payload.dragId === "string" && payload.dragId.length > 0) {
        postDragAccept(payload.dragId);
      }
    },
    [resolveBadgePayloadTabId, openSessionInTree],
  );

  // Center-zone badge drop handler. Same-window: swap (both tabs live in
  // this window's tabs[], both remain live post-swap). Cross-window: the
  // resolver opens a fresh tab for the descriptor, then replaceLeaf swaps
  // the fresh tab into the target slot; the target's previous tab remains
  // in tabs[] but no longer occupies a pane (parity with row-replace).
  // Distinguisher: resolvedTabId === payload.tabId means same-window (the
  // resolver returned the local tabId as-is); otherwise the resolver just
  // opened fresh.
  const onCenterDropBadge = useCallback(
    (
      payload: {
        tabId?: string | null;
        dragId?: string | null;
        identityKey?: string | null;
        hostId?: number | null;
        descriptor?: {
          tabType?: TabType;
          sessionKind?: "harness" | "relay-room";
          relayRoomId?: string;
          relayRoomTitle?: string | null;
          targetTmuxSession?: string | null;
        } | null;
      },
      targetTabId: string,
    ) => {
      const resolvedTabId = resolveBadgePayloadTabId(payload);
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] onCenterDropBadge resolve payloadTabId=${payload.tabId ?? "?"} identity=${payload.identityKey ?? "?"} hostId=${payload.hostId ?? "?"} → resolvedTabId=${resolvedTabId ?? "(null — aborting)"} targetTabId=${targetTabId}`,
      );
      if (resolvedTabId === null) return;
      if (resolvedTabId === targetTabId) {
        // Self-drop — same-window drop of the badge onto its own pane.
        // Existing swap-with-self collapses to a no-op; we mirror that.
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-drop] center-self-drop-ignored (badge) resolvedTabId=${resolvedTabId}`,
        );
        return;
      }
      if (resolvedTabId === payload.tabId) {
        // Same-window: both source and target live in tabs[] — swap.
        swapInTree(resolvedTabId, targetTabId);
      } else {
        // Cross-window: resolvedTabId was just freshly opened — replace.
        replaceInTree(resolvedTabId, targetTabId);
      }
      if (typeof payload.dragId === "string" && payload.dragId.length > 0) {
        postDragAccept(payload.dragId);
      }
    },
    [resolveBadgePayloadTabId, swapInTree, replaceInTree],
  );

  // Accept subscription — when a target window echoes back a dragId that
  // was armed as an outbound drag from THIS window, hard-close the source
  // tab so the drag behaves as a MOVE (session lives in one window at a
  // time). BroadcastChannel deliberately does NOT deliver a post back to
  // the sender's own channel, so same-window drops don't reach here.
  //
  // Ref pattern: subscribe ONCE at mount; the callback reads doCloseTab
  // through a ref so it doesn't get pinned to a stale render's closure.
  const doCloseTabRef = useRef(doCloseTab);
  useEffect(() => {
    doCloseTabRef.current = doCloseTab;
  });
  useEffect(() => {
    const unsub = subscribeToDragAccepts((tabId) => {
      // eslint-disable-next-line no-console
      console.info(
        `[cross-window-drag] source-close-on-accept tabId=${tabId}`,
      );
      doCloseTabRef.current(tabId);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Patch #511 (Phase 56 hotfix follow-up): the drag payload from
  // PrettyConversationRow now carries the full row shape (host,
  // targetTmuxSession, fleetOnly, rdpHostRow) alongside the row.id. The
  // click-flow priority ladder is:
  //   1. rdpHostRow  → openTab(host, "rdp")
  //   2. fleetOnly   → openTab(host, "terminal", ..., { targetTmuxSession, ... })
  //   3. default     → row is already an open tab; use row.id directly
  // We mirror the same ladder here so a drop onto a not-yet-opened row
  // opens the underlying tab (matching what a click would have done),
  // and returns the tab id that ends up in the openTabs array.
  //
  // Returns the resolved tabId (existing or freshly-opened) or null if the
  // payload was malformed / not resolvable.
  const resolveRowPayloadTabId = useCallback(
    (payload: {
      id: string;
      host: Host | null;
      targetTmuxSession: string | null;
      fleetOnly: boolean;
      rdpHostRow: boolean;
      matrixRoomId?: string | null;
      roomTitle?: string | null;
    }): string | null => {
      if (tabs.some((t) => t.id === payload.id)) {
        return payload.id;
      }
      if (payload.rdpHostRow && payload.host) {
        return openTab(payload.host, "rdp");
      }
      if (payload.fleetOnly && payload.host && payload.targetTmuxSession) {
        return openTab(payload.host, "terminal", undefined, {
          targetTmuxSession: payload.targetTmuxSession,
          label: payload.targetTmuxSession,
          allowCreateTmux: false,
        });
      }
      // Relay-room row: hostless tab keyed by the Matrix roomId. Cross-window
      // path — a relay-room row dragged into another Skynet window resolves
      // to a fresh terminal tab with sessionKind: "relay-room" so the
      // Tab dispatcher routes to PrettyView with source.kind === "relay"
      // (Phase 90 Plan 07 Task 3 shape). label falls back to the roomId
      // when no roomTitle is provided.
      if (
        typeof payload.matrixRoomId === "string" &&
        payload.matrixRoomId.length > 0
      ) {
        return openTab(null, "terminal", undefined, {
          sessionKind: "relay-room",
          relayRoomId: payload.matrixRoomId,
          relayRoomTitle: payload.roomTitle ?? null,
          label: payload.roomTitle ?? payload.matrixRoomId,
        });
      }
      return null;
    },
    [tabs, openTab],
  );

  // Companion to openSessionInTree that accepts a raw drag payload from a
  // conv-list row. Resolves the tabId (opening the tab if it wasn't
  // already open), then inserts into the split tree at (path, edge).
  // Both the AppShell right-side outer drop handler and SplitView's Pane
  // onDrop call through this — single place for the ladder + tree edit.
  const onDropRowInTree = useCallback(
    (
      payload: {
        id: string;
        dragId?: string | null;
        host: Host | null;
        targetTmuxSession: string | null;
        fleetOnly: boolean;
        rdpHostRow: boolean;
        matrixRoomId?: string | null;
        roomTitle?: string | null;
      },
      path: SplitPath,
      edge: DropEdge,
    ) => {
      const tabId = resolveRowPayloadTabId(payload);
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] onDropRowInTree resolve rowId=${payload.id} fleetOnly=${payload.fleetOnly === true} rdpHostRow=${payload.rdpHostRow === true} hostId=${payload.host?.id ?? "?"} tmux=${payload.targetTmuxSession ?? "?"} → resolvedTabId=${tabId ?? "(null — aborting)"}`,
      );
      if (tabId === null) return;
      openSessionInTree(tabId, path, edge);
      selectConversationDeferred(tabId);
      // Cross-window: echo the dragId back so the source window can hard-
      // close its outbound tab (move semantics). Same-window drops don't
      // loop back through BroadcastChannel (spec-guaranteed), so this is
      // a no-op there.
      if (typeof payload.dragId === "string" && payload.dragId.length > 0) {
        postDragAccept(payload.dragId);
      }
    },
    [resolveRowPayloadTabId, openSessionInTree],
  );

  // Phase 120 D-06 — left-click on an AppTile: open the app in a new pane
  // leaf via openTab with type: "app" and the (hostId, slug) tuple. D-15
  // multi-instance is preserved: no dedupe here — every click emits a
  // fresh openTab call. Label is the app's static title (D-19 — tab bar
  // shows the metadata title, not the app's live document.title).
  const onOpenApp = useCallback(
    (hostId: number, slug: string, title: string) => {
      const newTabId = openTab(null, "app", undefined, {
        app: { hostId, slug },
        label: title,
        allowCreateTmux: false,
      });
      // Promote the freshly-created app tab to selected — without this the
      // tab exists in the tabs array but the visible surface still points at
      // the previously-selected conversation, and the click looks like a
      // no-op. Mirrors onCreateSession's promotion pattern.
      selectConversationDeferred(newTabId);
      // If a split arrangement is already up, slot the new app leaf into
      // the currently-largest pane so the click actually reveals the app
      // rather than hiding it behind the fullscreen active-tab render.
      // Empty tree (no split) falls through to the fullscreen path via
      // selectedId. Mirrors onCreateSession at the sidebarPanelContent site.
      if (splitTree !== null) {
        const targetPath = findLargestLeafPath(splitTree);
        if (targetPath !== null) {
          openSessionInTree(newTabId, targetPath, "right");
        }
      }
      systemLogger.info("app-tile click onOpenApp", {
        operation: "app_shell_on_open_app",
        hostId,
        slug,
        tabId: newTabId,
        hadSplitTree: splitTree !== null,
      });
      if (isTouchDevice) navigateToView();
      if (isMobile) setSidebarOpen(false);
    },
    [openTab, splitTree, openSessionInTree, isTouchDevice, isMobile],
  );

  // Phase 120 D-07 — edge-drop on the split view carrying an AppTile
  // payload. Mirror of onDropRowInTree: openTab creates a fresh app leaf,
  // openSessionInTree inserts it at the requested edge. No dedupe (D-15
  // multi-instance): a drop always creates a new leaf, even if the same
  // app is already open elsewhere. No dragId echo — AppTile is a copy
  // gesture (effectAllowed="copy"), not a move; there is no source tab to
  // hard-close.
  const onDropAppTileInTree = useCallback(
    (
      payload: { hostId: number; slug: string; title: string },
      path: SplitPath,
      edge: DropEdge,
    ) => {
      // LOW-15 fix (2026-09-19): structured logger over raw console.info.
      // hostId + slug + edge extracted per the role-file 2026-08-11
      // "actionable in isolation" directive; path stringified inline.
      systemLogger.info("pv-split-drop onDropAppTileInTree", {
        operation: "pv_split_drop_on_drop_app_tile_in_tree",
        hostId: payload.hostId,
        slug: payload.slug,
        edge,
        path: JSON.stringify(path),
      });
      const newTabId = openTab(null, "app", undefined, {
        app: { hostId: payload.hostId, slug: payload.slug },
        label: payload.title,
        allowCreateTmux: false,
      });
      openSessionInTree(newTabId, path, edge);
      selectConversationDeferred(newTabId);
    },
    [openTab, openSessionInTree],
  );

  // Center-zone row drop handler (2026-09-18). Row-source counterpart to
  // onCenterDropBadge — resolves the payload through resolveRowPayloadTabId
  // BEFORE hitting the tree. Without this, a fleet-only-detached row
  // (row.id = fleet-synthetic string like `fleet::7::aqua`) planted the
  // raw id into the tree via replaceLeaf, the DOM-placement effect at
  // :2531-2586 relocated the displaced session's node back to normal-view,
  // and the normal-view display gate at :3478-3491 showed it full-screen
  // over the split-view (user saw the "replaced" pane taking the whole
  // area). Symmetric miss to patch #511 which fixed the same trap on the
  // edge-drop path via `onDropRowInTree` — center-drop needed the same
  // treatment. Always dispatches to replaceInTree (never swapInTree): row
  // drops originate from the sidebar and signal "replace what was here",
  // not "swap slots" — if the user wanted a swap they'd drag the badge.
  // Full write-up: `bounties/center-drop-row-resolver/`.
  const onCenterDropRow = useCallback(
    (
      payload: {
        id: string;
        dragId?: string | null;
        host: Host | null;
        targetTmuxSession: string | null;
        fleetOnly: boolean;
        rdpHostRow: boolean;
        matrixRoomId?: string | null;
        roomTitle?: string | null;
      },
      targetTabId: string,
    ) => {
      const resolvedTabId = resolveRowPayloadTabId(payload);
      // eslint-disable-next-line no-console
      console.info(
        `[pv-split-drop] onCenterDropRow resolve rowId=${payload.id} fleetOnly=${payload.fleetOnly === true} rdpHostRow=${payload.rdpHostRow === true} hostId=${payload.host?.id ?? "?"} tmux=${payload.targetTmuxSession ?? "?"} → resolvedTabId=${resolvedTabId ?? "(null — aborting)"} targetTabId=${targetTabId}`,
      );
      if (resolvedTabId === null) return;
      if (resolvedTabId === targetTabId) {
        // Self-drop — sidebar row for the target's own tab dropped onto
        // itself. replaceLeaf's same-id branch is a no-op, but log it for
        // parity with the badge-side and to avoid a needless setSplitTree.
        // eslint-disable-next-line no-console
        console.info(
          `[pv-split-drop] center-self-drop-ignored (row) resolvedTabId=${resolvedTabId}`,
        );
        return;
      }
      replaceInTree(resolvedTabId, targetTabId);
      if (typeof payload.dragId === "string" && payload.dragId.length > 0) {
        postDragAccept(payload.dragId);
      }
    },
    [resolveRowPayloadTabId, replaceInTree],
  );

  // ─── Sidebar ─────────────────────────────────────────────────────────────
  // Phase 11 Plan 03: handleRailClick + editHostInManager RETIRED — the rail
  // is gone, HostsPanel is gone, no consumers remain.

  const onSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSidebarDragging(true);
      const startX = e.clientX;
      const startW = sidebarWidth;
      function onMove(ev: MouseEvent) {
        setSidebarWidth(
          Math.max(160, Math.min(480, startW + ev.clientX - startX)),
        );
      }
      function onUp() {
        setSidebarDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  // Resize all terminals in panes + active terminal when split mode or sidebar changes
  const resizeAllTerminals = useCallback(() => {
    const id = requestAnimationFrame(() => {
      tabs.forEach((tab) => {
        if (!tab.terminalRef) return;
        const ref = tab.terminalRef.current;
        ref?.fit?.();
        ref?.notifyResize?.();
      });
    });
    return id;
  }, [tabs]);

  useEffect(() => {
    const id = resizeAllTerminals();
    return () => cancelAnimationFrame(id);
    // Phase 56 Plan 02: dep on splitTree — the tree replaces the retired
    // mode enum as the change trigger for re-fit-all-terminals.
  }, [splitTree, sidebarWidth, sidebarOpen]);

  const hasSplit = splitTree !== null;

  // Move each tab's stable DOM node to the right container (pane or normal-view).
  // This is vanilla DOM so React's portal target never changes — changing the portal
  // target causes a remount which is exactly what we're trying to avoid.
  //
  // Phase 56 Plan 02: pane lookup keys on the tree (findLeaf) instead of the
  // retired slot-array indexOf, and paneEl lookup is via paneElsRef.current.get
  // (a Map<tabId, HTMLDivElement>) instead of the retired pane-element array.
  useEffect(() => {
    const normalView = normalViewRef.current;
    if (!normalView) return;

    const tabIds = new Set(tabs.map((t) => t.id));

    // Remove nodes for closed tabs
    for (const [id, node] of tabNodesRef.current) {
      if (!tabIds.has(id)) {
        node.remove();
        tabNodesRef.current.delete(id);
      }
    }

    for (const tab of tabs) {
      // Phase 41 Plan 02: identity terminal panes get the pv-base background
      // (like non-terminal tabs) since PrettyView is the primary surface.
      // Non-identity terminal panes keep the terminal dark background.
      const isIdentityTerminal =
        tab.type === "terminal" &&
        tab.targetTmuxSession != null &&
        identitiesByKey.has(tab.targetTmuxSession.toLowerCase());
      // Relay-room tabs are opened with type="terminal" so they slot into the
      // same tab-strip machinery, but they render a lazy React component (not
      // xterm.js) and MUST NOT get the terminal-visibility styling below, or
      // the transparent full-viewport overlay catches all clicks and shows a
      // stuck Suspense fallback on top of every other pane. (Bug at arc-close
      // UAT 2026-09-09 — user: no relay-room tab in strip + "no host selected"
      // bubble stuck at top middle + entire pane area became un-clickable.)
      const isRelayRoom =
        tab.type === "terminal" && tab.sessionKind === "relay-room";
      const isTerminal =
        tab.type === "terminal" && !isIdentityTerminal && !isRelayRoom;
      const node = getTabNode(tab.id, isTerminal);
      const inPane =
        hasSplit && findLeaf(splitTree, tab.id) !== null;
      const paneEl = inPane
        ? (paneElsRef.current.get(tab.id) ?? null)
        : null;
      // Plan 06-02: the "visible-inline" tab is now driven by the
      // conversation-store's selectedId (falling back to activeTabId for
      // singleton/dashboard tabs the store doesn't own). The rest of this
      // effect stays byte-for-byte — same tabNodesRef, same DOM-move via
      // appendChild, same visibility/display toggles — so patch #35's
      // load-bearing DOM-node-stability contract is preserved. T-06-02-01
      // mitigation: only the SELECTION drives which node is visible; the
      // MOUNT LIFECYCLE mechanism is untouched.
      const activeInline = !inPane && tab.id === effectiveSelectedTabId;

      if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
      } else {
        if (node.parentElement !== normalView) normalView.appendChild(node);
        if (isTerminal) {
          node.style.display = "";
          node.style.visibility = activeInline ? "visible" : "hidden";
          node.style.pointerEvents = activeInline ? "auto" : "none";
          node.style.zIndex = activeInline ? "1" : "0";
        } else {
          node.style.visibility = "";
          node.style.pointerEvents = "";
          node.style.zIndex = activeInline ? "2" : "";
          node.style.display = activeInline ? "" : "none";
        }
      }
    }
  }, [tabs, splitTree, hasSplit, effectiveSelectedTabId, identitiesByKey, getTabNode]);

  const terminalTabs = tabs.filter((t) => t.type === "terminal");

  // Sidebar panel content — pretty-conversations is the only visible surface.
  // Phase 11 Plan 03 (PURGE-03): 11 sibling {railView === "X"} branches
  // (hosts, credentials, quick-connect, ssh-tools, snippets, history,
  // sessions, split-screen, connections, user-profile, admin-settings)
  // RETIRED. The conversations branch is the sole survivor; its outer
  // `${railView==="conversations" ? "" : "hidden"}` toggle also retired
  // since it's the only possible content now. Panel FILES themselves stay
  // on disk (Phase 12+ scope-fence). See 11-01-STRIP-LIST.md §E.8.
  const sidebarPanelContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0">
        <PrettyConversationsPanel
          variant={isMobile ? "mobile" : "desktop"}
          sidebarToggleOverlaps={isMobile && !isTouchDevice && sidebarOpen}
          visibleInSplitTreeTabIds={visibleInSplitTreeTabIds}
          isAdmin={isAdmin}
          onOpenApp={onOpenApp}
          // Phase 58 PV58-CONVLIST-DROP-TARGET-CLOSE + PV58-DOCLOSETAB-TREE-
          // RECONCILE: badge drop on the conv-list panel closes the tab.
          // closeTab already reconciles splitTree via removeLeaf inside
          // doCloseTab (AppShell.tsx:1498) — no additional wiring needed
          // here. openTabIds is the validation source for the panel's drop
          // guard (per security_config / threat T-58-02-01: validate the
          // parsed tabId matches an entry in currently-open tabs before
          // firing onCloseSession).
          onCloseSession={closeTab}
          // Phase 123 shape 2 (D-07/D-08): lift the EXISTING feedbackOpen
          // state atom (L357) to "general" when the panel's header
          // "Send feedback" button is clicked. Reuses the shape-1
          // FeedbackModal mount at L4041 unchanged (D-18) — no parallel
          // useState, no second modal, no new imports needed. The dev-chord
          // path (L363) and this production button share the same setter
          // deliberately per D-08.
          onOpenFeedback={() =>
            setFeedbackOpen((prev) => (prev === false ? "general" : prev))
          }
          openTabIds={tabs.map((t) => t.id)}
          onConversationSelected={
            isTouchDevice ? () => navigateToView() : undefined
          }
          hostTree={realHostTree}
          onCreateSession={(opts) => {
            // opts is a three-way discriminated union (see NewSessionDialog.tsx
            // NewSessionOnCreateOpts). Narrow on the discriminant explicitly —
            // no bare truthy checks — because "existing" (quick-260806-bz7 clone
            // auto-route) is also truthy and must not fall into the birth branch.
            //   identityMode: false      → regular-session shape (sessionName optional)
            //   identityMode: true       → identity-birth-success shape (sessionName = opts.name)
            //   identityMode: "existing" → open on already-born identity (clone flow); sessionName = opts.identityName
            const host = opts.host;
            let sessionName: string | undefined;
            if (opts.identityMode === false) {
              sessionName = opts.sessionName;
            } else if (opts.identityMode === true) {
              // identity name doubles as tmux session name (Nelly mechanism)
              sessionName = opts.name;
            } else {
              // "existing": identityName IS the tmux session name (same Nelly mechanism)
              sessionName = opts.identityName;
            }
            const newTabId = openTab(host, "terminal", undefined, {
              targetTmuxSession: sessionName ?? null,
              label: sessionName ?? undefined,
              // For identity-birth: backend already ran `tmux new-session -d -s <name>` at step 2
              // and launched claude at step 3. Frontend attaches to existing session — do NOT
              // create a new one (prevents race where frontend also tries to create and
              // either fails "session already exists" or clobbers by creating a duplicate).
              // Same reasoning for the clone flow ("existing"): backend created the tmux
              // session as part of the clone step, so the frontend just attaches.
              allowCreateTmux: opts.identityMode === false,
            });
            selectConversationDeferred(newTabId);
            // When a split view is already up, slot the new agent into the
            // currently-largest pane instead of hiding the whole arrangement
            // behind the fullscreen active-tab render. Empty tree (no split)
            // falls through to the pre-existing fullscreen behaviour.
            if (splitTree !== null) {
              const targetPath = findLargestLeafPath(splitTree);
              if (targetPath !== null) {
                openSessionInTree(newTabId, targetPath, "right");
              }
            }
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
          }}
          onDetachedRowClick={(row) => {
            const host = row.host;
            if (!host) return;
            const sessionName = row.targetTmuxSession;
            if (!sessionName) return;
            const newTabId = openTab(host, "terminal", undefined, {
              targetTmuxSession: sessionName,
              label: sessionName,
              allowCreateTmux: false,
            });
            selectConversationDeferred(newTabId);
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
          }}
          onSearchResultOpenActive={(result: ConversationSearchResult) => {
            // Phase 122 Plan 03 Task 3 — verbatim mirror of the sibling
            // onDetachedRowClick handler above. The only shape difference:
            // the search-result carries hostId + tmuxSessionName as
            // separate fields (not row.host + row.targetTmuxSession),
            // because search-results don't ship a full ConversationRow
            // shape. Resolve hostId → Host via hostsById (the same lookup
            // used at line 2534 for onTabActivate). tmuxSessionName ==
            // identityKey by fleet convention (see backend
            // conversation-search.ts docblock and Task 1 forward-patch
            // commit cf4ced1b).
            const host = hostsById.get(result.hostId);
            if (!host) return;
            const sessionName = result.tmuxSessionName;
            if (!sessionName) return;
            const newTabId = openTab(host, "terminal", undefined, {
              targetTmuxSession: sessionName,
              // Use aiTitle when available (Wave-1 backend deferral: always
              // null today, but the piggyback follow-up per 122-02-SUMMARY
              // will populate it — this handler already handles both cases).
              label: result.aiTitle || sessionName,
              allowCreateTmux: false,
            });
            selectConversationDeferred(newTabId);
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
          }}
          onRdpRowClick={(row) => {
            const host = row.host;
            if (!host) return;
            const newTabId = openTab(host, "rdp");
            selectConversationDeferred(newTabId);
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
          }}
          onRelayRoomRowClick={(row) => {
            // Phase 90 Plan 07 Task 3 (BLOCKER #3 fix). Mirrors the shape
            // of onDetachedRowClick — both open a session pane on click —
            // but with the relay-room fields threaded through the openTab
            // options bag so tabUtils's dispatcher branches to the shared
            // chat surface (PrettyView with source.kind === "relay" per
            // Phase 93 Slice 4). First arg to openTab is null: relay-
            // room tabs have NO Host (the room lives on the Matrix relay,
            // not any fleet host). openTab was widened to accept
            // `Host | null` for exactly this call site.
            if (!row.roomId) {
              // eslint-disable-next-line no-console
              console.warn("relay-room row missing roomId at AppShell", {
                rowId: row.id,
              });
              return;
            }
            const newTabId = openTab(null, "terminal", undefined, {
              sessionKind: "relay-room",
              relayRoomId: row.roomId,
              relayRoomTitle: row.roomTitle ?? null,
              label: row.roomTitle ?? row.roomId,
              // Relay-room tabs have no tmux to create; safe-noop.
              allowCreateTmux: false,
            });
            selectConversationDeferred(newTabId);
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
          }}
          onDeactivateRow={(row) => {
            // quick-260727-gm3: deactivate is a tab-close variant.
            // Reuse the existing closeTab function verbatim — it already
            // routes to doCloseTab and handles the confirm-tab-close
            // toast branch. That behavior is preserved for deactivate
            // clicks too (deactivate === "close this tab"; the store-
            // level activeSet removal is composed by the panel's
            // handleRowDeactivate before this callback fires).
            closeTab(row.id);
          }}
          onCreateRelayRoom={(result: CreateRelayRoomResponse) => {
            // Phase 91 Plan 05 Task 3 — mirror onRelayRoomRowClick shape
            // (L2139-2166) byte-for-byte but with roomId + roomTitle sourced
            // from the create response instead of a sidebar row.
            if (!result.roomId) {
              // eslint-disable-next-line no-console
              console.warn({
                operation: "new_conversation_modal_missing_room_id",
                roomTitle: result.roomTitle,
              });
              return;
            }
            // openTab signature: (host: Host | null, type: TabType, restore?,
            // options?) — 4 args, no positional label between type and options bag.
            const newTabId = openTab(null, "terminal", undefined, {
              sessionKind: "relay-room",
              relayRoomId: result.roomId,
              relayRoomTitle: result.roomTitle ?? null,
              label: result.roomTitle ?? result.roomId,
              // Relay-room tabs have no tmux to create; safe-noop.
              allowCreateTmux: false,
            });
            selectConversationDeferred(newTabId);
            if (isTouchDevice) navigateToView();
            if (isMobile) setSidebarOpen(false);
            // eslint-disable-next-line no-console
            console.info({
              operation: "new_conversation_modal_tab_opened",
              roomId: result.roomId,
              roomTitle: result.roomTitle,
            });
            // W5: explicit fleet refresh — getSessionList runs ONCE per
            // page-load (no polling), so the new relay-room row needs an
            // explicit push into the store or the sidebar won't reflect it
            // until the next reload. Best-effort: log-and-swallow refresh
            // failure; the tab is already open so the user can send.
            void getSessionList()
              .then((sessions) => {
                updateFleetSessions(sessions);
              })
              .catch((err: unknown) => {
                // eslint-disable-next-line no-console
                console.warn({
                  operation: "new_conversation_modal_refresh_failed",
                  roomId: result.roomId,
                  err: err instanceof Error ? err.message : "unknown",
                });
              });
          }}
          onKillRow={async (row) => {
            // quick-260810-n3a: Kill the underlying tmux session on the host,
            // then close the tab. The panel's handleRowKill already ran
            // window.confirm — this callback fires only on confirm=true.
            // Defense-in-depth guard: row-side gate already prevents rows
            // without host or targetTmuxSession from surfacing Kill.
            if (!row.host || !row.targetTmuxSession) {
              console.warn(
                "onKillRow: missing host or targetTmuxSession — no-op",
                row.id,
              );
              return;
            }
            try {
              await killTmuxSession(
                parseInt(row.host.id, 10),
                row.targetTmuxSession,
              );
              closeTab(row.id);
              removeFleetSession(parseInt(row.host.id, 10), row.targetTmuxSession);
            } catch (err) {
              window.alert(
                err instanceof Error ? err.message : "Failed to kill session",
              );
            }
          }}
        />
      </div>
    </div>
  );

  // Phase 14B Slice 1 (Bug A): outer `sidebarHeader` retired. The prior fork's
  // bar with mixed-case "Conversations" title + reset-width Maximize2 button +
  // ChevronLeft close-sidebar button lived above the pretty-conversations panel
  // and jarred against the pv aesthetic user signed off on. The sidebar-toggle
  // chevron (the persistent fixed top-left button at ~L1424) already handles
  // open/close so ChevronLeft was redundant; PrettyConversationsPanel's
  // `.pv-panel-header` provides the UPPERCASE title + pv-pencil affordance. The
  // reset-width button (Maximize2) died with the header — user didn't call it
  // out as essential; can be re-added with pv styling if needed.

  // Plan 06-03: touchscreen viewports render the Telegram-style two-screen
  // flow — "list" (full-screen ConversationsPanel) and "view" (full-screen
  // conversation content with a top-left back button). The screen is driven
  // by the `#mv=1` URL fragment key via useMobileScreen (mobile-flow.ts).
  // Desktop (`!isTouchDevice`) is UNCHANGED from Plan 06-02.
  const isMobileListScreen = isTouchDevice && mobileScreen === "list";
  // Hide the mobile back-button while an IdentityModal is open — the modal
  // is portalled into chatRegionEl inside PrettyView, which sits inside a
  // per-tab wrapper set to position:absolute + z-index:2 (a stacking
  // context). The modal's inner z-[120] is capped at that z:2, below the
  // fixed z:30 back button. Rather than restructure the stack, we hide the
  // button for the modal's duration. Desktop is unaffected: this button
  // doubles as the sidebar-toggle on desktop and its role there is
  // orthogonal (and desktop keeps patch #108 composer-uncovered behavior).
  const anyIdentityModalOpen = useAnyIdentityModalOpen();
  const hideBackButtonForModal = isTouchDevice && anyIdentityModalOpen;
  // Patch #144 Fix (b): `isMobileViewScreen` derivation removed together
  // with the legacy mobile-view header block below. mobileScreen === "view"
  // is now expressed implicitly via `!isMobileListScreen` on the fixed
  // top-left chevron (line ~1400) since that's the only remaining
  // mobile-view-only affordance.

  return (
    <>
      <div
        className="flex w-screen bg-[color:var(--color-pv-base)]"
        style={{
          height: "100dvh",
          paddingTop: "max(env(safe-area-inset-top), 0px)",
        }}
      >
        {/* Phase 10 Wave 3: persistent top-left sidebar-toggle chevron.
            The fix for user's small-window sidebar-affordance regression.
            Renders unconditionally at all widths (desktop wide, narrow-window
            desktop, mobile touchscreen); replaces the narrow-window thin-
            strip at the old lines 1844-1852 that used to disappear below
            some breakpoint.

            position:fixed anchors to the viewport regardless of any
            scrolling ancestor — the small-window use case has scrollable
            regions that would otherwise absorb an absolutely-positioned
            button. z-index: 30 sits above the sidebar's resize-handle at
            z-30 without needing a bump.

            Phase 13 Wave 2 SHAPE-04 (user 2026-07-23): visual treatment
            rebased to the mock v4 `.pv-pencil` aesthetic — transparent
            background + transparent border + border-radius 8px (rounded-lg)
            + `--color-pv-fg-muted` icon color + `rgba(220,225,245,0.06)`
            hover bg + `--color-pv-border-quiet` hover border +
            `--color-pv-fg` hover text. Retires the Skynet-theme filled-
            glass pill (opaque rgba fill + backdrop-blur + white-alpha
            border + drop shadow + Skynet muted-foreground text) that
            user called out as "the bar at the top that still looks
            Skynet." No shadow, no backdrop-blur — the mock's pencil is a
            bare transparent button that lets the pretty-view surface
            beneath show through.

            Direction (user 2026-07-29 re-lock): chevron points at the
            EDGE'S DIRECTION OF MOTION on click. sidebarOpen === true →
            chevron points ← (default ChevronLeft), meaning "click, the
            sidebar collapses leftward." sidebarOpen === false → rotate
            180° so it points → ("click, the sidebar expands rightward").
            Touch devices don't rotate — the icon is always ← because the
            touch behavior is "back to conversations" (a leftward-return
            navigation), not a sidebar toggle. */}
        {/* Patch #134: on touch mobile the persistent-toggle is dual-purpose.
            On desktop it toggles sidebarOpen (unchanged). On touch mobile it
            calls navigateToList() so the same top-left chevron affordance
            "goes back to the conversation list" the user is looking for —
            functionally symmetric with desktop (where opening the sidebar
            surfaces the conversation list). Hidden on mobile-list-screen
            (nothing to navigate to; would be a phantom no-op tap). */}
        {!isMobileListScreen && !hideBackButtonForModal && (
          <button
            type="button"
            onClick={() =>
              isTouchDevice ? navigateToList() : setSidebarOpen(!sidebarOpen)
            }
            aria-label={t(
              isTouchDevice
                ? "nav.conversations.backToList"
                : "nav.sidebar.toggle",
              {
                defaultValue: isTouchDevice
                  ? "Back to conversations"
                  : "Toggle sidebar",
              },
            )}
            title={t(
              isTouchDevice
                ? "nav.conversations.backToList"
                : "nav.sidebar.toggle",
              {
                defaultValue: isTouchDevice
                  ? "Back to conversations"
                  : "Toggle sidebar",
              },
            )}
            className={
              isTouchDevice
                ? "fixed flex items-center justify-center rounded-full text-[#f0ebe0] hover:text-white transition-transform hover:scale-[1.03] active:scale-[0.97] cursor-pointer"
                : "fixed flex items-center justify-center w-8 h-8 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] transition-colors cursor-pointer " +
                  (sidebarOpen
                    ? "rounded-r-lg border-y border-r border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-base)] hover:bg-[rgba(220,225,245,0.06)] hover:border-[color:var(--color-pv-border-quiet-strong)]"
                    : "rounded-lg border border-[color:var(--color-pv-border-quiet)] bg-[rgba(220,225,245,0.06)] hover:bg-[rgba(220,225,245,0.12)] hover:border-[color:var(--color-pv-border-quiet-strong)]")
            }
            style={{
              // Touch: mirror the identity badge's visual offset so the back
              // button reads as its left-side counterpart. The badge is
              // Tailwind `top-4 right-5` inside PrettyView; PrettyView sits
              // under `safe-area-inset-top + 12px session-view padding`. So
              // badge-top from viewport = safe-area + 12 + 1rem. Reuse the
              // exact same rem-based math so both offsets scale together
              // under patch #165's html=24 mobile bump.
              top: isTouchDevice
                ? "calc(max(env(safe-area-inset-top), 8px) + 12px + 1rem)"
                : "max(env(safe-area-inset-top), 8px)",
              left: !isTouchDevice && sidebarOpen
                ? `${sidebarEditing ? 560 : sidebarWidth}px`
                : isTouchDevice
                  ? "calc(max(env(safe-area-inset-left), 0px) + 1.25rem)"
                  : "max(env(safe-area-inset-left), 8px)",
              zIndex: 30,
              transition: sidebarDragging ? "none" : "left 0.2s",
              // Touch-only hue-glass treatment: identity-avatar-badge visual
              // language (round, hue-tinted gradient, inset highlight + outer
              // glow). Patch #272 (user 2026-08-02) — recoloured from the
              // prior warm-amber (hue 35) that user called "weird yellowish"
              // to a dark blue/gray drawn from the pv palette family (the
              // user-bubble mid-blue-gray at hsl~220/28%/16-25% is the seed).
              // Reads as "part of the scheme" rather than a lone warm accent.
              // Still ambient — doesn't compete with the identity badge (which
              // wears the pane's identity colorHue).
              ...(isTouchDevice
                ? {
                    width: 64,
                    height: 64,
                    background:
                      "linear-gradient(160deg, hsla(218, 25%, 22%, 0.85), hsla(218, 25%, 14%, 0.9))",
                    border: "1px solid hsla(218, 35%, 55%, 0.35)",
                    boxShadow:
                      "0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(220,225,245,0.3), 0 0 24px hsla(218, 40%, 55%, 0.3)",
                    backdropFilter: "blur(20px) saturate(1.4)",
                    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                  }
                : {}),
            }}
          >
            <span
              style={{
                display: "inline-flex",
                transform:
                  !isTouchDevice && !sidebarOpen
                    ? "rotate(180deg)"
                    : undefined,
                transition: "transform 220ms",
              }}
            >
              <ChevronLeft className={isTouchDevice ? "size-8" : "size-4"} />
            </span>
          </button>
        )}

        {/* Phase 11 Plan 03 (PURGE-02): AppRail mount RETIRED here — the
            skinny icon rail was the primary UI entry point to every dead
            Skynet surface (host manager, snippets, admin, user profile,
            etc.). With the rail gone, the pretty-conversations sidebar is
            the only visible sidebar chrome; touchscreens already had no
            rail per Plan 06-03. */}

        {/* Desktop (non-touch): inline resizable sidebar. Plan 06-03: also
            gated on `!isTouchDevice` so touchscreens don't get the inline
            column even when the viewport is wide (an iPad in landscape). */}
        {!isMobile && !isTouchDevice && (
          <div
            className={`relative flex flex-col bg-[color:var(--color-pv-base)] shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-[hsla(var(--pv-hue,35),55%,50%,0.6)]" : "border-[color:var(--color-pv-border-quiet)]"}` : ""}`}
            style={{
              width: sidebarOpen ? (sidebarEditing ? 560 : sidebarWidth) : 0,
              transition: sidebarDragging ? "none" : "width 0.2s",
            }}
          >
            {sidebarPanelContent}

            {sidebarOpen && !sidebarEditing && (
              <div
                onMouseDown={onSidebarMouseDown}
                className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${sidebarDragging ? "bg-[hsla(var(--pv-hue,35),55%,50%,0.6)]" : "hover:bg-[hsla(var(--pv-hue,35),55%,50%,0.4)]"}`}
              />
            )}
          </div>
        )}

        {/* Narrow non-touch desktop (e.g. resized laptop window without a
            touchscreen): sidebar as an overlay Sheet. Plan 06-03: excluded
            from touchscreens — those use the mobile flow's full-screen
            list-vs-view branch below. */}
        {isMobile && !isTouchDevice && (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="p-0 flex flex-col w-[min(85vw,360px)] max-w-full gap-0"
              style={{ height: "100dvh" }}
            >
              {sidebarPanelContent}
            </SheetContent>
          </Sheet>
        )}

        {/* Touchscreen list screen: full-viewport sidebar column, no
            main-content column visible. Uses a plain `<div>` (NOT the Sheet
            component) per plan Step D — the mobile flow's two screens
            REPLACE each other, they don't peek/panel/overlay.
            `sidebarPanelContent` is reused verbatim so the ConversationsPanel
            renders the same content (with the mobile SettingsRow slot filled
            in above). The main-content region below is CSS-hidden (not
            conditionally unmounted) so the createPortal loop's tab nodes
            and normalViewRef stay mounted — the T-06-02-01 mount-lifecycle-
            regression mitigation depends on that identity being preserved
            across list-vs-view switches too. Phase 14B Slice 1 retired the
            outer sidebarHeader that used to sit above the panel (Bug A). */}
        {isMobileListScreen && (
          <div
            className="flex flex-col flex-1 min-w-0 bg-[color:var(--color-pv-base)]"
            style={{ height: "100dvh" }}
          >
            {sidebarPanelContent}
          </div>
        )}

        {/* Main content area. On touchscreen viewports, hidden via CSS when
            mobileScreen === "list" (0-width) so the createPortal loop and
            normalViewRef stay mounted — persistence-contract mitigation
            (T-06-02-01) applies across list-vs-view switches, not just
            across conversation switches. When mobileScreen === "view",
            takes the full width and prepends a top-left back button
            header. Desktop path is unchanged. */}
        <div
          className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200`}
          style={
            isMobileListScreen
              ? { width: 0, flex: "0 0 0px", overflow: "hidden" }
              : isTouchDevice
                ? { paddingTop: 12 }
                : undefined
          }
          aria-hidden={isMobileListScreen ? true : undefined}
        >
          {/* Phase 10 Wave 3: the narrow-window thin-strip reveal button
              that used to live here (patch #28) is REMOVED. Its role is
              taken over by the persistent top-left sidebar-toggle chevron
              at the top of the AppShell root — one canonical toggle,
              renders at all widths, no breakpoint-dependent disappearance
              that user's small-window use case tripped over. The
              companion `pl-6` main-content padding that reserved space
              for the old strip is also removed. */}
          {/* Patch #144 Fix (b): the legacy mobile-view header — a shadcn
              Button back-chevron + Separator + label span that used to
              render at h-12.5 across the top of the mobile view screen —
              is removed. Patch #142's fixed-position chevron at (8,8) z-30
              (declared above at ~line 1400) is the sole back affordance
              now, and the top-right identity badge surfaces the active
              conversation's identity, so the redundant title span had
              become dead weight. user's UAT (2026-07-24) confirmed two
              chevrons were rendering simultaneously on mobile-in-conv;
              deleting this block resolves the duplicate. */}
          {/* quick-260829-ih3: CollapsedPanelCloseLane — proxy close-target
              for the collapsed conv-list panel during a badge drag. Gate
              matches the shape file's suppression rules:
                - !isMobile              (no split view on mobile)
                - !isMobileListScreen    (sidebar occupies the whole viewport)
                - !sidebarOpen           (real panel is already the drop
                                          target — no need for a proxy)
              Mounted INSIDE the main-content column (:2253 outer, which is
              already `relative flex flex-col flex-1 min-w-0 overflow-hidden`)
              but OUTSIDE the inner :2291 wrapper that owns the empty-PV drop
              handlers — so the lane's absolute-positioned coral hover state
              doesn't compete with PrettyView drop targets. Wire pass-throughs
              mirror the panel-drop wire at :1919 verbatim (closeTab +
              tabs.map(t => t.id)) — same close routine, new surface. */}
          {shouldMountCloseLane({
            isMobile,
            isMobileListScreen,
            sidebarOpen,
          }) && (
            <CollapsedPanelCloseLane
              draggedBadgeTabId={draggedBadgeTabId}
              openTabIds={tabs.map((t) => t.id)}
              onCloseTab={closeTab}
            />
          )}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            {/* Plan 06-02: tab strip DELETED unconditionally (TG-11 — full
                replacement, no toggle). The conversation-store's selectedId
                is now the single source of truth for "which conversation is
                visible"; the sidebar's ConversationsPanel row selection IS
                the affordance the tab strip used to provide.
                refreshTab is intentionally removed alongside its sole caller
                (this TabBar mount) — Plan 06-04 or later may re-introduce a
                per-row refresh affordance if user's workflow needs one. */}
            <div
              className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
              onDragOver={(e) => {
                // Patch #510: accept conv-list-row drags (text/plain) even
                // when SplitView is display:none (splitTree === null). Without
                // this, drops into an empty PrettyView area died silently
                // because the SplitView Pane onDrop wasn't in the visible
                // DOM. File drags (Files in types) fall through to
                // PrettyView's own onDragOver — no double-handling because
                // PrettyView bubbles up here and would return early only
                // when NOT Files; but since Files IS present, PrettyView
                // already preventDefaulted higher in the composed path and
                // this handler's preventDefault is idempotent.
                //
                // App-tile addendum (2026-09-20): AppTile deliberately does
                // NOT setData("text/plain", ...) (AppTile.tsx:178-180 —
                // hardened against stray browser drags), so it fails the
                // text/plain gate. Accept its application/x-skynet-app-tile
                // MIME here too — matches SplitView.tsx:195-201's
                // hasSkynetDragPayload contract, and without it the very
                // first drop from the sidebar Apps section on a fresh client
                // (splitTree === null, no Pane mounted) silently no-ops.
                const types = e.dataTransfer.types;
                if (
                  !types.includes("text/plain") &&
                  !types.includes("application/x-skynet-app-tile")
                )
                  return;
                if (types.includes("Files")) return;
                e.preventDefault();
                // inline-260902 (identity-badge-drop-preview): compute the
                // zone the drop will actually route to and paint the overlay
                // to match. Mirrors the branch logic in the onDrop handler
                // below — if the drop would `insertAtEdge` (active is a real
                // session, drop tab id differs from active), preview an edge
                // zone; else preview whole-body. Best-effort self-drop
                // detection via the badge payload's tabId (getData is
                // available at dragover for same-origin drags); row-payload
                // self-drop detection would need resolveRowPayloadTabId which
                // may open tabs and isn't safe to run on every dragover, so
                // that cosmetic edge case is accepted.
                const rect = e.currentTarget.getBoundingClientRect();
                const activeTab = tabs.find((t) => t.id === activeTabId);
                const activeIsSession =
                  activeTab != null &&
                  activeTab.type === "terminal" &&
                  activeTab.targetTmuxSession != null &&
                  identitiesByKey.has(
                    activeTab.targetTmuxSession.toLowerCase(),
                  );
                let wouldReplace = !activeIsSession || activeTab == null;
                if (!wouldReplace && activeTab != null) {
                  const badgeJson = e.dataTransfer.getData(
                    "application/x-skynet-badge",
                  );
                  if (badgeJson) {
                    try {
                      const parsed = JSON.parse(badgeJson) as {
                        tabId?: unknown;
                      };
                      if (
                        typeof parsed?.tabId === "string" &&
                        parsed.tabId === activeTab.id
                      ) {
                        wouldReplace = true;
                      }
                    } catch {
                      /* fall through — best-effort */
                    }
                  }
                }
                const zone: DropEdge | "full" = wouldReplace
                  ? "full"
                  : computeNearestEdge(rect, e.clientX, e.clientY);
                setConvRowDragZone((prev) => (prev === zone ? prev : zone));
                if (prevEmptyPvZoneRef.current !== zone) {
                  // eslint-disable-next-line no-console
                  console.info(
                    `[empty-pv-drop-preview] zone=${zone} splitTreeNull=${splitTree === null}`,
                  );
                  prevEmptyPvZoneRef.current = zone;
                }
              }}
              onDragLeave={(e) => {
                // Phase 59 Gap 1 — type-gate FIRST (mirror SplitView.tsx:292).
                // Scoped to Skynet-owned drag payloads (text/plain for
                // row/badge, application/x-skynet-app-tile for AppTile
                // — see the onDragOver gate above for the app-tile addendum
                // rationale) so unrelated dragleaves (browser file drags,
                // native OS drags) never clear tint state.
                const types = e.dataTransfer.types;
                if (
                  !types.includes("text/plain") &&
                  !types.includes("application/x-skynet-app-tile")
                )
                  return;
                const rect = e.currentTarget.getBoundingClientRect();
                // Bounding-rect stateless guard (mirror SplitView.tsx:301-305)
                // — robust against dragleaves fired when the cursor crosses
                // child DOM boundaries inside the wrapper.
                const stillInside =
                  e.clientX >= rect.left &&
                  e.clientX <= rect.right &&
                  e.clientY >= rect.top &&
                  e.clientY <= rect.bottom;
                if (stillInside) return;
                setConvRowDragZone(null);
                if (prevEmptyPvZoneRef.current !== null) {
                  // eslint-disable-next-line no-console
                  console.info(
                    `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTree === null}`,
                  );
                  prevEmptyPvZoneRef.current = null;
                }
              }}
              onDrop={(e) => {
                // Phase 59 Gap 1 tint clear — clear FIRST regardless of
                // downstream branches (mirror SplitView.tsx:323-324 — drop
                // always clears state immediately, even for skip paths).
                // Idempotent — clearing already-null state is a no-op.
                setConvRowDragZone(null);
                if (prevEmptyPvZoneRef.current !== null) {
                  // eslint-disable-next-line no-console
                  console.info(
                    `[empty-pv-drop-preview] zone=none splitTreeNull=${splitTree === null}`,
                  );
                  prevEmptyPvZoneRef.current = null;
                }
                const types = e.dataTransfer.types;
                if (
                  !types.includes("text/plain") &&
                  !types.includes("application/x-skynet-app-tile")
                )
                  return;
                if (types.includes("Files")) return;
                e.preventDefault();
                // Patch #514 belt-and-suspenders: outer handler ONLY runs
                // when splitTree is null. When splitTree is non-null,
                // Pane's native drop listener catches drops on portaled
                // content (React portals bubble via React tree, not DOM
                // tree — so React onDrop on Pane never fires for drops on
                // the portaled PrettyView; native DOM listener does).
                // Pane native listener calls stopPropagation, which halts
                // native bubbling and prevents React's synthetic dispatch
                // to this outer handler. This explicit guard defends
                // against edge cases where Pane didn't catch (e.g. drop
                // landed on a gap between panes) — in that case, do
                // nothing rather than clobber the existing tree via the
                // pre-#514 "replace with split(active, dropped)" branch,
                // which was the observed regression in user's UAT.
                if (splitTree !== null) {
                  // eslint-disable-next-line no-console
                  console.info(
                    `[pv-split-drop] outer skipped (splitTree non-null; expected Pane native listener to have caught it)`,
                  );
                  return;
                }
                // Reaching here means splitTree was null at drop time.
                //
                // App-tile branch (2026-09-20) — must run BEFORE the row
                // dispatch below, because AppTile drags carry ONLY
                // application/x-skynet-app-tile (no text/plain, no
                // application/x-skynet-row), so the row path would
                // early-return with resolvedTabId=null and silently drop
                // the payload on the floor. Behavior mirrors the row
                // branch below: no active session → tree becomes
                // leaf(new-app-tab); active session shown → split(active,
                // new-app-tab) at nearest edge. Never a self-drop
                // (app-tile has no source tab), so no wouldReplace
                // equality guard.
                const appTileJson = e.dataTransfer.getData(
                  "application/x-skynet-app-tile",
                );
                if (appTileJson) {
                  let parsed:
                    | { hostId: number; slug: string; title: string }
                    | null = null;
                  try {
                    const raw = JSON.parse(appTileJson) as {
                      hostId?: unknown;
                      slug?: unknown;
                      title?: unknown;
                    };
                    if (
                      typeof raw?.hostId === "number" &&
                      typeof raw?.slug === "string" &&
                      typeof raw?.title === "string"
                    ) {
                      parsed = {
                        hostId: raw.hostId,
                        slug: raw.slug,
                        title: raw.title,
                      };
                    }
                  } catch {
                    /* fall through to row handling — row parse will also
                       return null and this drop becomes a no-op */
                  }
                  if (parsed !== null) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const edge = computeNearestEdge(
                      rect,
                      e.clientX,
                      e.clientY,
                    );
                    const activeTab = tabs.find((t) => t.id === activeTabId);
                    const activeIsSession =
                      activeTab != null &&
                      (activeTab.sessionKind === "relay-room" ||
                        (activeTab.type === "terminal" &&
                          activeTab.targetTmuxSession != null &&
                          identitiesByKey.has(
                            activeTab.targetTmuxSession.toLowerCase(),
                          )));
                    const newTabId = openTab(null, "app", undefined, {
                      app: { hostId: parsed.hostId, slug: parsed.slug },
                      label: parsed.title,
                      allowCreateTmux: false,
                    });
                    systemLogger.info("pv-split-drop outer app-tile dispatch", {
                      operation: "pv_split_drop_outer_app_tile",
                      hostId: parsed.hostId,
                      slug: parsed.slug,
                      edge,
                      activeIsSession,
                    });
                    setSplitTree(() => {
                      const droppedLeaf = {
                        kind: "session" as const,
                        tabId: newTabId,
                      };
                      if (!activeIsSession || activeTab == null) {
                        return droppedLeaf;
                      }
                      const activeLeaf = {
                        kind: "session" as const,
                        tabId: activeTab.id,
                      };
                      return insertAtEdge(activeLeaf, [], droppedLeaf, edge);
                    });
                    selectConversationDeferred(newTabId);
                    setFocusedTabId(newTabId);
                    return;
                  }
                }
                //
                // Behavior spec (from shape file, row branch):
                //  - empty PrettyView area (no active session shown) →
                //    tree becomes leaf(payload).
                //  - active session X shown in normal-view →
                //    split(existing X, payload) at nearest edge.
                //
                // Patch #511: parse the rich JSON payload (host,
                // targetTmuxSession, fleetOnly, rdpHostRow) and route
                // through resolveRowPayloadTabId which mirrors the row-
                // click ladder — openTab-if-needed for fleet-only /
                // rdp-host rows. Fall back to text/plain-only for legacy
                // drags that never learned the JSON payload.
                const richJson = e.dataTransfer.getData(
                  "application/x-skynet-row",
                );
                let resolvedTabId: string | null = null;
                if (richJson) {
                  try {
                    const parsed = JSON.parse(richJson);
                    resolvedTabId = resolveRowPayloadTabId(parsed);
                  } catch {
                    resolvedTabId = null;
                  }
                }
                if (resolvedTabId === null) {
                  const bareId = e.dataTransfer.getData("text/plain");
                  if (bareId && tabs.some((t) => t.id === bareId)) {
                    resolvedTabId = bareId;
                  }
                }
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] outer resolvedTabId=${resolvedTabId ?? "(null — aborting)"} splitTree=${describeTreeShape(splitTree)}`,
                );
                if (resolvedTabId === null) return;
                const tabId = resolvedTabId;
                const rect = e.currentTarget.getBoundingClientRect();
                const edge = computeNearestEdge(rect, e.clientX, e.clientY);
                const activeTab = tabs.find((t) => t.id === activeTabId);
                // Phase 97 F-2 UAT follow-up (2026-09-10): relay-room tabs
                // are valid split targets too. Previously this gate only
                // recognized harness sessions (terminal + tmux-identity
                // mapping), so dropping a harness session onto an open
                // relay pane's edge fell through to the `return droppedLeaf`
                // path (replace-with-single-leaf) instead of the intended
                // split branch at line ~2856. Relay tabs carry
                // `sessionKind === "relay-room"` (Phase 90 discriminator)
                // and have no tmux session, so accept the sessionKind
                // marker directly.
                const activeIsSession =
                  activeTab != null &&
                  (activeTab.sessionKind === "relay-room" ||
                    (activeTab.type === "terminal" &&
                      activeTab.targetTmuxSession != null &&
                      identitiesByKey.has(
                        activeTab.targetTmuxSession.toLowerCase(),
                      )));
                // eslint-disable-next-line no-console
                console.info(
                  `[pv-split-drop] outer edge=${edge} activeTabId=${activeTabId} activeIsSession=${activeIsSession} activeSessionKind=${activeTab?.sessionKind ?? "(none)"} activeTabType=${activeTab?.type ?? "(none)"} activeTargetTmuxSession=${activeTab?.targetTmuxSession ?? "(none)"} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}`,
                );
                setSplitTree(() => {
                  const droppedLeaf = {
                    kind: "session" as const,
                    tabId,
                  };
                  if (
                    !activeIsSession ||
                    activeTab == null ||
                    activeTab.id === tabId
                  ) {
                    return droppedLeaf;
                  }
                  const activeLeaf = {
                    kind: "session" as const,
                    tabId: activeTab.id,
                  };
                  // Plant the active session as root, then insert the
                  // dropped one at the requested edge — reuses the
                  // library's own edge→direction mapping.
                  return insertAtEdge(activeLeaf, [], droppedLeaf, edge);
                });
                // Ensure the dropped tab is selected. selectConversationDeferred
                // parks the id if it isn't yet in openTabs (openTab writes are
                // batched); the deferred flush kicks in on the next
                // updateOpenTabs and the pane becomes visible.
                selectConversationDeferred(tabId);
                setFocusedTabId(tabId);
              }}
            >
              {/* Phase 59 Plan 01 Gap 1 — coral drop-target-affordance tint
                  overlay. Sibling to the SplitView (:2482+) and normal-view
                  (:2528+) containers. Render gate `convRowDragZone !== null
                  && splitTree === null` enforces the architectural exclusion:
                  when splitTree becomes non-null (a session is showing in
                  a Pane), the Pane's own overlay (SplitView.tsx:439-454)
                  owns preview state — this outer tint MUST defer. Palette
                  values verbatim from SplitView.tsx:446-447 (`--highlight`
                  from prototype). pointer-events-none is LOAD-BEARING —
                  drop still fires on the underlying wrapper's onDrop.
                  zIndex 30 sits above normal-view (z-10 at :2528+) but
                  below the mobile back-chevron (z-30 at :1400) — they
                  don't co-occupy this container.
                  inline-260902 (identity-badge-drop-preview): geometry now
                  reflects the zone (edge-zoned half-body for the insertAtEdge
                  branch, whole-body for the leaf-replace branch) instead of
                  always-whole-body. Uses overlayGeometryForZone from
                  SplitView so the edge-zoned geometry stays a single source
                  of truth with Pane's own overlay. */}
              {convRowDragZone !== null && splitTree === null && (
                <div
                  data-testid="empty-pv-drop-preview"
                  data-zone={convRowDragZone}
                  className="absolute pointer-events-none"
                  style={(() => {
                    const geom =
                      convRowDragZone === "full"
                        ? { left: 0, top: 0, width: "100%", height: "100%" }
                        : (() => {
                            const g = overlayGeometryForZone(convRowDragZone, {
                              left: 0,
                              top: 0,
                              right: 100,
                              bottom: 100,
                              width: 100,
                              height: 100,
                            });
                            return {
                              left: `${g.left}%`,
                              top: `${g.top}%`,
                              width: `${g.width}%`,
                              height: `${g.height}%`,
                            };
                          })();
                    return {
                      ...geom,
                      background: "rgba(255, 184, 150, 0.22)",
                      border: "2px solid rgba(255, 184, 150, 0.60)",
                      zIndex: 30,
                      transition: "opacity 120ms ease",
                    };
                  })()}
                />
              )}
              {/* Split view — always mounted when not mobile, hidden via CSS when inactive */}
              {!isMobile && (
                <div
                  className="absolute inset-0"
                  // LOAD-BEARING: this display gate prevents a first-paint mispaint of the
                  // "no split" default state while URL-restore is pending. splitTree hydrates
                  // inside loadSavedTabs (a useEffect at L906-1149) which fires AFTER first
                  // render, so splitTree === null on the initial paint of any session that
                  // lands with a URL-encoded split. This visibility gate keeps SplitView
                  // hidden until splitTree becomes non-null. Do NOT remove without either
                  // lifting hydration to useLayoutEffect or adding a synchronous URL-parse
                  // to the useState lazy initializer. See CONTEXT.md § "Persistence race on
                  // first load".
                  style={{
                    display: hasSplit ? "flex" : "none",
                    flexDirection: "column",
                  }}
                >
                  <SplitView
                    tabs={tabs}
                    splitTree={splitTree}
                    focusedTabId={focusedTabId}
                    onTerminalResize={resizeAllTerminals}
                    onPaneContentRef={onPaneContentRef}
                    onPaneClick={setFocusedTabId}
                    onOpenSessionInTree={openSessionInTree}
                    onDropRowInTree={(payload, path, edge) =>
                      onDropRowInTree(
                        payload as {
                          id: string;
                          dragId?: string | null;
                          host: Host | null;
                          targetTmuxSession: string | null;
                          fleetOnly: boolean;
                          rdpHostRow: boolean;
                          matrixRoomId?: string | null;
                          roomTitle?: string | null;
                        },
                        path,
                        edge,
                      )
                    }
                    // Phase 120 D-07 — app-tile edge-drop wiring.
                    // SplitView's drop dispatch parses the JSON payload and
                    // hands the typed object here; AppShell calls openTab +
                    // openSessionInTree to place the fresh app leaf.
                    onDropAppTileInTree={onDropAppTileInTree}
                    // Phase 64 Plan 02 center-drop wiring: SplitView
                    // center-zone drop dispatches to replaceInTree (from
                    // conv-list source MIME) or swapInTree (from open badge
                    // source MIME). Both go through setSplitTree so the
                    // URL-sync effect at :868 auto-encodes the new tree —
                    // no additional wiring needed.
                    //
                    // 2026-09-18: onCenterDropRow is the resolver-aware
                    // counterpart to onReplaceInTree — SplitView prefers it
                    // when wired so row.id from fleet-only-detached rows
                    // (fleet-synthetic strings) gets resolved to a real
                    // tabId before hitting the tree. onReplaceInTree stays
                    // as the fallback (kept for existing tests / any
                    // future consumer that only needs the raw shape).
                    onReplaceInTree={replaceInTree}
                    onCenterDropRow={(payload, targetTabId) =>
                      onCenterDropRow(
                        payload as {
                          id: string;
                          dragId?: string | null;
                          host: Host | null;
                          targetTmuxSession: string | null;
                          fleetOnly: boolean;
                          rdpHostRow: boolean;
                          matrixRoomId?: string | null;
                          roomTitle?: string | null;
                        },
                        targetTabId,
                      )
                    }
                    onSwapInTree={swapInTree}
                    onDropBadgeInTree={(payload, path, edge) =>
                      onDropBadgeInTree(
                        payload as {
                          tabId?: string | null;
                          dragId?: string | null;
                          identityKey?: string | null;
                          hostId?: number | null;
                          descriptor?: {
                            tabType?: TabType;
                            sessionKind?: "harness" | "relay-room";
                            relayRoomId?: string;
                            relayRoomTitle?: string | null;
                            targetTmuxSession?: string | null;
                          } | null;
                        },
                        path,
                        edge,
                      )
                    }
                    onCenterDropBadge={(payload, targetTabId) =>
                      onCenterDropBadge(
                        payload as {
                          tabId?: string | null;
                          dragId?: string | null;
                          identityKey?: string | null;
                          hostId?: number | null;
                          descriptor?: {
                            tabType?: TabType;
                            sessionKind?: "harness" | "relay-room";
                            relayRoomId?: string;
                            relayRoomTitle?: string | null;
                            targetTmuxSession?: string | null;
                          } | null;
                        },
                        targetTabId,
                      )
                    }
                    onCloseStalePane={closeStalePane}
                  />
                </div>
              )}

              {/* Normal-view container. Tab nodes are appended here (or to pane elements)
                  by the DOM-placement effect above. React portals each tab's content
                  into its stable per-tab node so the component is never remounted.
                  When split is active, shown on top only if the active tab is not in a pane. */}
              <div
                ref={normalViewRef}
                className="absolute inset-0"
                style={{
                  display:
                    hasSplit &&
                    !isMobile &&
                    effectiveSelectedTabId != null &&
                    findLeaf(splitTree, effectiveSelectedTabId) !== null
                      ? "none"
                      : undefined,
                  zIndex:
                    hasSplit &&
                    (effectiveSelectedTabId == null ||
                      findLeaf(splitTree, effectiveSelectedTabId) === null)
                      ? 10
                      : undefined,
                }}
              >
                {tabs.map((tab) => {
                  // Phase 41 Plan 02: identity terminal panes get pv-base
                  // background (PrettyView is the primary surface).
                  const _isIdentityTerminal =
                    tab.type === "terminal" &&
                    tab.targetTmuxSession != null &&
                    identitiesByKey.has(tab.targetTmuxSession.toLowerCase());
                  // Relay-room tabs are non-terminal despite type="terminal" —
                  // see the isRelayRoom comment in the tabs-effect above.
                  const _isRelayRoom =
                    tab.type === "terminal" && tab.sessionKind === "relay-room";
                  const tabNode = getTabNode(tab.id, tab.type === "terminal" && !_isIdentityTerminal && !_isRelayRoom);
                  const inPane =
                    hasSplit && findLeaf(splitTree, tab.id) !== null;
                  // Plan 06-02: `isVisible` signal for every mounted pane
                  // (consumed by PrettyView's WipBubble, WaitingBubble,
                  // MessageQueueDrawer, SessionHoldingOverlay via Terminal.tsx
                  // isVisible prop pathway) now derives from
                  // effectiveSelectedTabId — same semantics as before
                  // ("is this pane the currently-visible one?"), only the
                  // underlying scalar changed.
                  const activeInline = !inPane && tab.id === effectiveSelectedTabId;
                  const isInActiveSet = activeSet.has(tab.id);
                  const shouldAttach = inPane || activeInline || isInActiveSet;
                  return createPortal(
                    renderTabContent(
                      tab,
                      // Phase 11 Plan 03: openSingletonTab arg dropped
                      // (retired; renderTabContent's onOpenSingletonTab
                      // param stays as an optional undefined-safe slot).
                      undefined,
                      openTab,
                      closeTab,
                      inPane || activeInline,
                      shouldAttach,
                      handleTmuxSessionChange,
                      handleTmuxSessionMissing,
                    ),
                    tabNode,
                    tab.id,
                  );
                })}
              </div>
            </div>
          </div>

          {/* Plan 06-03: MobileBottomBar mount DELETED unconditionally
              (TG-07 — bottom nav bar removed as a UI surface). Its
              destinations (host-manager, credentials, quick-connect,
              ssh-tools, snippets, history, split-screen, user-profile,
              admin-settings) migrated to the SettingsRow component
              (Plan 06-02) which this plan mounts at the bottom of the
              mobile ConversationsPanel via the `settingsRowSlot` prop
              above. No feature flag, no conditional rendering, no
              per-user opt-in — deletion is total. */}
        </div>
      </div>

      <CommandPalette
        isOpen={commandPaletteOpen}
        setIsOpen={setCommandPaletteOpen}
        onOpenTab={openTab}
      />

      {/* Phase 121 Plan 04: FeedbackModal + dev-chord + fire-and-forget POST.
          Mounted UNCONDITIONALLY — even when useFeedbackEnabled() is false —
          so the dev chord (Ctrl+Alt+F / Ctrl+Alt+T) can still exercise the
          pipeline before env vars are wired. The backend POST /feedback will
          503 harmlessly in that case. Shape 2 (general button) and Shape 3
          (message thumbs) will gate THEIR triggers on useFeedbackEnabled();
          THIS mount is deliberately un-gated. */}
      <FeedbackModal
        open={feedbackOpen !== false}
        variant={feedbackOpen === false ? "general" : feedbackOpen}
        onOpenChange={(next) => {
          if (!next) setFeedbackOpen(false);
        }}
        onSubmit={(userNote) => {
          // Capture variant BEFORE closing (setFeedbackOpen(false) below).
          const variant =
            feedbackOpen === false ? "general" : feedbackOpen;
          // Shape 3 will supply real messageRef + exchangeText from the
          // message-thumb call site. For the Shape 1 dev-trigger we synthesize
          // placeholder values so operators can exercise the pipeline end-to-
          // end (subject line + body block + optional --- Exchange --- section
          // per D-19). General never carries messageRef/exchangeText (D-23 +
          // D-25); server-side (Plan 03) strips them anyway.
          const payload =
            variant === "thumbs_down"
              ? {
                  kind: "thumbs_down" as const,
                  userNote,
                  messageRef: "dev-fake-msg",
                  exchangeText:
                    "User asked: Q\n\nAssistant replied: A",
                }
              : { kind: "general" as const, userNote };
          void postFeedback(payload);
          // D-14 toast fires BEFORE the close-triggering setState to avoid any
          // race where sonner's imperative scheduler is deferred past the
          // visible-fade window during unmount.
          // LOW-2: duration 2000ms per shape spec ("~2 second fade").
          toast.success("Thanks — feedback sent.", { duration: 2000 });
          setFeedbackOpen(false);
        }}
        onDismissWithoutSubmit={() => {
          // D-11 thumbs_down dismiss-without-note: still fires ONE email
          // (the vote itself). Empty userNote is intentional. Same
          // synthesized dev-trigger payload as the Send path above.
          void postFeedback({
            kind: "thumbs_down",
            userNote: "",
            messageRef: "dev-fake-msg",
            exchangeText: "User asked: Q\n\nAssistant replied: A",
          });
          // LOW-2: duration 2000ms per shape spec ("~2 second fade").
          toast.success("Thanks — feedback sent.", { duration: 2000 });
        }}
      />
    </>
  );
}
