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
import { useGamepadTabNav } from "@/hooks/use-gamepad-tab-nav";
import { useKeyboardTabNav } from "@/hooks/use-keyboard-tab-nav";
import { useKeyboardCloseTab } from "@/hooks/use-keyboard-close-tab";
import { useKeyboardMessageQueue } from "@/hooks/use-keyboard-message-queue";
import { useKeyboardTogglePrettyMode } from "@/hooks/use-keyboard-toggle-pretty-mode";
import type { TerminalHandle } from "@/features/terminal/terminal-types";
import { CommandPalette } from "@/shell/CommandPalette";
// Phase 11 Plan 03 (PURGE-02, PURGE-03): AppRail + RailView + 10 sidebar-panel
// imports (HostsPanel, SessionsPanel, QuickConnectPanel, SshToolsPanel,
// SnippetsPanel, HistoryPanel, SplitScreenPanel, UserProfilePanel,
// AdminSettingsPanel, CredentialsPanel) RETIRED here — the pretty-conversations
// sidebar is now the only visible sidebar-panel content. Panel FILES stay on
// disk (Phase 12+ scope-fence).
import { SplitView } from "@/shell/SplitView";
import { renderTabContent } from "@/shell/tabUtils";
import type {
  Tab,
  TabType,
  Host,
  SplitMode,
  HostFolder,
  ThemeId,
  FontSizeId,
} from "@/types/ui-types";
import { applyAccentColor, applyFontSize, PANE_COUNTS } from "@/lib/theme";
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
import {
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  removeFleetSession,
  updateHostsFlat,
  updateIdentitiesByKey,
  useSelectedConversationId,
  selectConversation,
  selectConversationDeferred,
  addToActiveSet,
  useActiveSet,
  readFleetSessionsCache,
  writeFleetSessionsCache,
} from "@/state/conversation-store";
import { getSessionList, killTmuxSession } from "@/api/sessions-api";
import {
  consumePendingWorkspace,
  specForTab,
  writeWorkspaceToUrl,
} from "@/lib/tab-url";
import type { TabSpec } from "@/lib/tab-url";
import {
  useMobileScreen,
  navigateToView,
  navigateToList,
} from "@/lib/mobile-flow";
import { useIdentities } from "@/state/identities-store";
// Phase 34 Plan 06: fleet-status control WebSocket — boot-time singleton
import { createFleetStatusClient } from "@/api/fleet-status-client";
import {
  publishFleetStatusSessionState,
  publishFleetStatusSessionGone,
} from "@/state/session-working-store";
import { publishFleetStatusWaitingFor } from "@/state/session-waiting-store";
import {
  publishFleetStatusTmuxSession,
  publishFleetStatusTmuxSessionGone,
} from "@/state/session-tmux-store";
// Phase 11 Plan 03 (Ashley "no settings" lock): SettingsRow import RETIRED
// alongside AppRail — the entire settings-surface tree dies here.

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
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "dashboard",
      instanceId: "dashboard",
      type: "dashboard",
      label: "SKYNET",
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
    const handle = (ref?.current as TerminalHandle | null) ?? null;
    handle?.toggleMessageQueue?.();
  });
  useKeyboardTogglePrettyMode(tabs, activeTabId, (id) => {
    const ref = terminalRefs.current.get(id);
    const handle = (ref?.current as TerminalHandle | null) ?? null;
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
  const [splitMode, setSplitMode] = useState<SplitMode>(
    () => (localStorage.getItem("skynet_splitMode") as SplitMode) ?? "none",
  );
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    () =>
      JSON.parse(localStorage.getItem("skynet_paneTabIds") ?? "null") ??
      Array(6).fill(null),
  );
  const [focusedPaneIndex, setFocusedPaneIndex] = useState<number | null>(null);
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

  useEffect(() => {
    localStorage.setItem("skynet_splitMode", splitMode);
  }, [splitMode]);

  useEffect(() => {
    localStorage.setItem("skynet_paneTabIds", JSON.stringify(paneTabIds));
  }, [paneTabIds]);

  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const { byKey: identitiesByKey } = useIdentities();
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

  const lastShiftTime = useRef(0);
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  // Patch #35: monotonic counter appended to each generated tabId so
  // multiple openTab calls in the same ms (URL-driven multi-tab restore
  // loop) don't collide when Date.now() returns identical values.
  const openTabCounter = useRef(0);
  const [paneContentEls, setPaneContentEls] = useState<
    (HTMLDivElement | null)[]
  >(Array(6).fill(null));

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

  const onPaneContentRef = useCallback(
    (paneIndex: number, el: HTMLDivElement | null) => {
      setPaneContentEls((prev) => {
        if (prev[paneIndex] === el) return prev;
        const next = [...prev];
        next[paneIndex] = el;
        return next;
      });
    },
    [],
  );

  // Phase 11 Plan 03: sidebarTitle Record<RailView, string> RETIRED — the
  // sidebar header now hardcodes "Conversations" since that's the only surface.

  // Double-shift opens command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "ShiftLeft" &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        const now = Date.now();
        if (now - lastShiftTime.current < 300)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // Phase 34 Plan 06: fleet-status control WebSocket — exactly one WS opened
  // at AppShell boot. Reconnects on drop via createFleetStatusClient's built-in
  // retry-with-backoff (mirrors patch #148 pattern). Dispatches snapshot/update/gone
  // frames to session-working-store + session-waiting-store + session-tmux-store
  // via the callbacks below.
  //
  // Callback wiring (per D-CTX § Composite state + Waiting bubble UX):
  //   onSnapshot: for each SessionState → publishFleetStatusSessionState
  //               + publishFleetStatusWaitingFor + publishFleetStatusTmuxSession
  //   onUpdate:   same as onSnapshot but for a single state
  //   onGone:     publishFleetStatusSessionGone + publishFleetStatusWaitingFor(null)
  //               + publishFleetStatusTmuxSessionGone
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

    const client = createFleetStatusClient({
      url: fleetStatusUrl,
      onSnapshot: (states) => {
        for (const state of states) {
          publishFleetStatusSessionState(state.hostId, state);
          publishFleetStatusWaitingFor(
            state.hostId,
            state.tmuxSession,
            state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
          );
          publishFleetStatusTmuxSession(state.hostId, state.tmuxSession);
        }
      },
      onUpdate: (state) => {
        publishFleetStatusSessionState(state.hostId, state);
        publishFleetStatusWaitingFor(
          state.hostId,
          state.tmuxSession,
          state.status === "waiting" ? state.waitingFor ?? "input needed" : null,
        );
        publishFleetStatusTmuxSession(state.hostId, state.tmuxSession);
      },
      onGone: (hostId, tmuxSession, sessionId) => {
        publishFleetStatusSessionGone(hostId, tmuxSession, sessionId);
        publishFleetStatusWaitingFor(hostId, tmuxSession, null);
        publishFleetStatusTmuxSessionGone(hostId, tmuxSession);
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
    },
    [],
  );

  // Backend reported the target tmux session doesn't exist on the host
  // (attach-only path; the tab was restored from URL or persisted state).
  // Purge the row from server-side open_tabs so a broken tab doesn't
  // rehydrate on next login. The tab stays visible so the inline pane
  // error is still readable — the user closes it manually.
  const handleTmuxSessionMissing = useCallback(
    (instanceId: string, _sessionName: string) => {
      deleteOpenTab(instanceId).catch(() => {});
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
    const tmux = tmuxSessionNames[activeTabId];
    // Ashley 2026-08-01: browser tab title mirrors the conversation-list
    // main-label source (patch #258) — for identity sessions, use the
    // properly-cased `identity.displayName` ("Tina") instead of the
    // lowercase tmux sessionName ("tina"). Falls back to raw tmux name,
    // then activeTab.label, then "SKYNET" (verbatim prior chain) when
    // no identity resolves.
    const resolvedKey = (tmux ?? activeTab?.label ?? "").toLowerCase();
    const identity = resolvedKey ? identitiesByKey.get(resolvedKey) : null;
    document.title =
      identity?.displayName || tmux || activeTab?.label || "SKYNET";
  }, [activeTabId, tabs, tmuxSessionNames, identitiesByKey]);

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
  // TG-17 hard shape lock: fleet fetch is EXACTLY ONCE per page-load. No
  // polling, no interval, no focus/visibility refetch, NOT wired to
  // skynet:hosts-changed. Cross-device staleness acceptable — Ashley
  // refreshes to update. The empty-dep-array useEffect enforces the lock.
  //
  // Silent try/catch on fetch failure — a network error just leaves
  // fleetSessions empty; the list falls back to Phase 6 openTabs-only
  // rendering. No toast, no retry, no user-visible surface.
  useEffect(() => {
    // quick-260805-tub: seed the store from the localStorage cache BEFORE
    // the network fetch fires. This paints the last-known conversation-list
    // row set immediately on refresh; when the fetch returns it overwrites
    // with the fresh snapshot (see writeFleetSessionsCache below). On a cold
    // cache (first ever visit, cleared storage, corrupted JSON), read returns
    // [] — identical to today's cold-start behavior, no user-visible diff.
    const cached = readFleetSessionsCache();
    if (cached.length > 0) {
      updateFleetSessions(cached);
    }

    let cancelled = false;
    (async () => {
      try {
        const sessions = await getSessionList();
        if (cancelled) return;
        const fresh = Array.isArray(sessions) ? sessions : [];
        updateFleetSessions(fresh);
        // quick-260805-tub: persist the fresh snapshot for the next refresh.
        // Silent on write failure (see writeFleetSessionsCache).
        writeFleetSessionsCache(fresh);
      } catch {
        // Silent — fleetSessions stays empty; openTabs-only rendering
        // (Phase 6 behavior) takes over. T-07-01-04 mitigation.
        // Cache is deliberately NOT touched on fetch failure — the last
        // known-good snapshot survives the network hiccup.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // EMPTY DEP ARRAY — TG-17 shape lock: exactly once per mount.

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
    updateHostsFlat(hostsById);
  }, [hostsById]);
  useEffect(() => {
    updateIdentitiesByKey(identitiesByKey);
  }, [identitiesByKey]);

  const selectedConversationId = useSelectedConversationId();
  const activeSet = useActiveSet();

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
  // arrives without `mv=1`). Ashley UAT'd patch #106 and reported taps on
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
      });
      if (!spec) continue;
      if (t.id === activeTabId) activeIndex = tabSpecs.length;
      tabSpecs.push(spec);
    }
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
          },
    );
  }, [activeTabId, tabs, tmuxSessionNames, tabsReady, mobileScreen]);

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
    const handleDegraded = () => {
      toast.loading(t("common.connectionDegraded"), {
        id: "db-connection-degraded",
        duration: Infinity,
        dismissible: false,
        action: {
          label: t("common.reload"),
          onClick: () => window.location.reload(),
        },
      });
    };

    const handleRestored = () => {
      toast.dismiss("db-connection-degraded");
      toast.success(t("common.backendReconnected"), { duration: 3000 });
    };

    dbHealthMonitor.on("database-connection-degraded", handleDegraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", handleRestored);

    return () => {
      dbHealthMonitor.off("database-connection-degraded", handleDegraded);
      dbHealthMonitor.off(
        "database-connection-degraded-cleared",
        handleRestored,
      );
    };
  }, [t]);

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
        // "Move to new window" origin URLs. Reused below in the URL-driven
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
                const hostlessTypes: TabType[] = ["dashboard"];
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
                });
              }

              // ── patch #150 C investigate (Ashley UAT 2026-07-24) ──
              // Verdict: SAME_BUG. Ashley's two symptoms — (a) only ONE
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
              // to prefetch N WebSocket handshakes at restore. When Ashley
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
                // patch #150 C fix (Ashley followup-3 UAT 2026-07-24):
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
        if (pending) {
          const openedIds: string[] = [];
          for (const spec of pending.tabs) {
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
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: {
      targetTmuxSession?: string | null;
      label?: string;
      allowCreateTmux?: boolean;
    },
  ): string {
    // Patch #35: append a monotonic counter suffix so multiple openTab
    // calls in the same synchronous tick (e.g. URL-driven multi-tab
    // restore) don't collide when Date.now() returns identical values.
    // Same-ms is possible in a tight for-loop over an array of specs.
    const tabId = `${host.name}-${type}-${Date.now()}-${openTabCounter.current++}`;
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

    let finalLabel = customLabel ?? host.name;
    setTabs((prev) => {
      if (customLabel) {
        return [
          ...prev,
          {
            id: tabId,
            instanceId,
            type,
            label: customLabel,
            host,
            openedAt,
            terminalRef: ref,
            restoredSessionId: restore?.restoredSessionId ?? null,
            targetTmuxSession,
            allowCreateTmux,
          },
        ];
      }
      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      finalLabel =
        same.length === 0 ? host.name : `${host.name} (${same.length + 1})`;

      // Retrofit the first duplicate's label to "(1)" if needed
      const next =
        same.length === 1 && !/\(\d+\)$/.test(same[0].label)
          ? prev.map((t) =>
              t.id === same[0].id ? { ...t, label: `${host.name} (1)` } : t,
            )
          : prev;

      return [
        ...next,
        {
          id: tabId,
          instanceId,
          type,
          label: finalLabel,
          host,
          openedAt,
          terminalRef: ref,
          restoredSessionId: restore?.restoredSessionId ?? null,
          targetTmuxSession,
          allowCreateTmux,
        },
      ];
    });
    setActiveTabId(tabId);

    if (PERSISTENT_TAB_TYPES.includes(type)) {
      addOpenTab({
        id: instanceId,
        tabType: type,
        hostId: host ? parseInt(host.id) : null,
        label: finalLabel,
        tabOrder: 0,
        targetTmuxSession,
      }).catch(() => {});
    }
    return tabId;
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
    // just-deactivated view while the list updates. Accepted — Ashley isn't waiting on
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
        // selectedConversationId change — which yanks Ashley off the list
        // screen and into whatever tab got promoted, when all she wanted was
        // to deactivate one row and stay put. Skip the sync on mobile; the
        // deactivated row's ring disappears with the row anyway, and the
        // survivor gets its ring the next time she taps it.
        if (!isTouchDevice) {
          selectConversation(nextId === "dashboard" ? null : nextId);
        }
      }
      setPaneTabIds((prev) => prev.map((p) => (p === id ? null : p)));
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0)
          return [
            {
              id: "dashboard",
              instanceId: "dashboard",
              type: "dashboard",
              label: "SKYNET",
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

  function splitTabQuick(tabId: string, mode: SplitMode) {
    setSplitMode(mode);
    setPaneTabIds(() => {
      const count = PANE_COUNTS[mode];
      const next: (string | null)[] = Array(6).fill(null);
      next[0] = tabId;
      // Fill remaining panes with other non-dashboard tabs in order
      let slot = 1;
      for (const tab of tabs) {
        if (slot >= count) break;
        if (tab.id !== tabId && tab.type !== "dashboard") {
          next[slot] = tab.id;
          slot++;
        }
      }
      return next;
    });
  }

  function addTabToSplit(tabId: string) {
    setPaneTabIds((prev) => {
      // Remove from any current slot first
      const next = prev.map((p) => (p === tabId ? null : p));
      // Find first empty slot within the current pane count
      const count = PANE_COUNTS[splitMode];
      for (let i = 0; i < count; i++) {
        if (!next[i]) {
          next[i] = tabId;
          break;
        }
      }
      return next;
    });
  }

  function removeTabFromSplit(tabId: string) {
    setPaneTabIds((prev) => prev.map((p) => (p === tabId ? null : p)));
  }

  function assignPane(paneIndex: number, tabId: string) {
    setPaneTabIds((prev) => {
      const next = prev.map((p) => (p === tabId ? null : p));
      next[paneIndex] = tabId;
      return next;
    });
  }

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
  }, [splitMode, sidebarWidth, sidebarOpen]);

  const isSplit = splitMode !== "none";

  // Move each tab's stable DOM node to the right container (pane or normal-view).
  // This is vanilla DOM so React's portal target never changes — changing the portal
  // target causes a remount which is exactly what we're trying to avoid.
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
      const isTerminal = tab.type === "terminal";
      const node = getTabNode(tab.id, isTerminal);
      const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
      const inPane = paneIdx !== -1;
      const paneEl = inPane ? paneContentEls[paneIdx] : null;
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
  });

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
          onRdpRowClick={(row) => {
            const host = row.host;
            if (!host) return;
            const newTabId = openTab(host, "rdp");
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
  // and jarred against the pv aesthetic Ashley signed off on. The sidebar-toggle
  // chevron (the persistent fixed top-left button at ~L1424) already handles
  // open/close so ChevronLeft was redundant; PrettyConversationsPanel's
  // `.pv-panel-header` provides the UPPERCASE title + pv-pencil affordance. The
  // reset-width button (Maximize2) died with the header — Ashley didn't call it
  // out as essential; can be re-added with pv styling if needed.

  // Plan 06-03: touchscreen viewports render the Telegram-style two-screen
  // flow — "list" (full-screen ConversationsPanel) and "view" (full-screen
  // conversation content with a top-left back button). The screen is driven
  // by the `#mv=1` URL fragment key via useMobileScreen (mobile-flow.ts).
  // Desktop (`!isTouchDevice`) is UNCHANGED from Plan 06-02.
  const isMobileListScreen = isTouchDevice && mobileScreen === "list";
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
            The fix for Ashley's small-window sidebar-affordance regression.
            Renders unconditionally at all widths (desktop wide, narrow-window
            desktop, mobile touchscreen); replaces the narrow-window thin-
            strip at the old lines 1844-1852 that used to disappear below
            some breakpoint.

            position:fixed anchors to the viewport regardless of any
            scrolling ancestor — the small-window use case has scrollable
            regions that would otherwise absorb an absolutely-positioned
            button. z-index: 30 sits above the sidebar's resize-handle at
            z-30 without needing a bump.

            Phase 13 Wave 2 SHAPE-04 (Ashley 2026-07-23): visual treatment
            rebased to the mock v4 `.pv-pencil` aesthetic — transparent
            background + transparent border + border-radius 8px (rounded-lg)
            + `--color-pv-fg-muted` icon color + `rgba(220,225,245,0.06)`
            hover bg + `--color-pv-border-quiet` hover border +
            `--color-pv-fg` hover text. Retires the Skynet-theme filled-
            glass pill (opaque rgba fill + backdrop-blur + white-alpha
            border + drop shadow + Skynet muted-foreground text) that
            Ashley called out as "the bar at the top that still looks
            Skynet." No shadow, no backdrop-blur — the mock's pencil is a
            bare transparent button that lets the pretty-view surface
            beneath show through.

            Direction (Ashley 2026-07-29 re-lock): chevron points at the
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
        {!isMobileListScreen && (
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
              // glow). Patch #272 (Ashley 2026-08-02) — recoloured from the
              // prior warm-amber (hue 35) that Ashley called "weird yellowish"
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
              that Ashley's small-window use case tripped over. The
              companion `pl-6` main-content padding that reserved space
              for the old strip is also removed. */}
          {/* Patch #144 Fix (b): the legacy mobile-view header — a shadcn
              Button back-chevron + Separator + label span that used to
              render at h-12.5 across the top of the mobile view screen —
              is removed. Patch #142's fixed-position chevron at (8,8) z-30
              (declared above at ~line 1400) is the sole back affordance
              now, and the top-right identity badge surfaces the active
              conversation's identity, so the redundant title span had
              become dead weight. Ashley's UAT (2026-07-24) confirmed two
              chevrons were rendering simultaneously on mobile-in-conv;
              deleting this block resolves the duplicate. */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            {/* Plan 06-02: tab strip DELETED unconditionally (TG-11 — full
                replacement, no toggle). The conversation-store's selectedId
                is now the single source of truth for "which conversation is
                visible"; the sidebar's ConversationsPanel row selection IS
                the affordance the tab strip used to provide.
                refreshTab is intentionally removed alongside its sole caller
                (this TabBar mount) — Plan 06-04 or later may re-introduce a
                per-row refresh affordance if Ashley's workflow needs one. */}
            <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Split view — always mounted when not mobile, hidden via CSS when inactive */}
              {!isMobile && (
                <div
                  className="absolute inset-0"
                  style={{
                    display: isSplit ? "flex" : "none",
                    flexDirection: "column",
                  }}
                >
                  <SplitView
                    tabs={tabs}
                    paneTabIds={paneTabIds}
                    splitMode={splitMode}
                    focusedPaneIndex={focusedPaneIndex}
                    onTerminalResize={resizeAllTerminals}
                    onPaneContentRef={onPaneContentRef}
                    onPaneClick={setFocusedPaneIndex}
                    onAssignPane={assignPane}
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
                    isSplit &&
                    !isMobile &&
                    paneTabIds.includes(effectiveSelectedTabId)
                      ? "none"
                      : undefined,
                  zIndex:
                    isSplit &&
                    !paneTabIds.includes(effectiveSelectedTabId)
                      ? 10
                      : undefined,
                }}
              >
                {tabs.map((tab) => {
                  const tabNode = getTabNode(tab.id, tab.type === "terminal");
                  const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
                  const inPane = paneIdx !== -1;
                  // Plan 06-02: `isVisible` signal for every mounted pane
                  // (consumed by PrettyView's WipBubble, PlanPendingBubble,
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
    </>
  );
}
