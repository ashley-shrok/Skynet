/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/separator";
import { Button } from "@/components/button";
import { Sheet, SheetContent } from "@/components/sheet";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo, createRef } from "react";
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
import { AppRail } from "@/sidebar/AppRail";
import type { RailView } from "@/sidebar/AppRail";
import { HostsPanel } from "@/sidebar/HostsPanel";
import { SessionsPanel } from "@/sidebar/SessionsPanel";
import { QuickConnectPanel } from "@/sidebar/QuickConnectPanel";
import { SshToolsPanel } from "@/sidebar/SshToolsPanel";
import { SnippetsPanel } from "@/sidebar/SnippetsPanel";
import { HistoryPanel } from "@/sidebar/HistoryPanel";
import { SplitScreenPanel } from "@/sidebar/SplitScreenPanel";
import { UserProfilePanel } from "@/sidebar/UserProfilePanel";
import { AdminSettingsPanel } from "@/sidebar/AdminSettingsPanel";
import { CredentialsPanel } from "@/sidebar/CredentialsPanel";
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
import { ConnectionsPanel } from "@/sidebar/ConnectionsPanel";
import { ConversationsPanel } from "@/sidebar/ConversationsPanel";
import {
  updateHostTree,
  updateOpenTabs,
  useSelectedConversationId,
} from "@/state/conversation-store";
import { TransferMonitor } from "@/features/file-manager/TransferMonitor.tsx";
import { getPendingTransferIds } from "@/features/file-manager/transferNotificationStore.ts";
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
import { SettingsRow } from "@/sidebar/SettingsRow";

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
      label: t("nav.dashboard"),
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
    () => (localStorage.getItem("termix_splitMode") as SplitMode) ?? "none",
  );
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    () =>
      JSON.parse(localStorage.getItem("termix_paneTabIds") ?? "null") ??
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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railView, setRailView] = useState<RailView>("conversations");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 266;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);

  useEffect(() => {
    localStorage.setItem("termix_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("termix_splitMode", splitMode);
  }, [splitMode]);

  useEffect(() => {
    localStorage.setItem("termix_paneTabIds", JSON.stringify(paneTabIds));
  }, [paneTabIds]);

  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
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
  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
    useState<boolean>(() => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      return v !== null ? v === "true" : true;
    });
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
      if (!isTerminal) el.classList.add("bg-background");
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

  const sidebarTitle: Record<RailView, string> = {
    conversations: t("nav.conversations.title", { defaultValue: "Conversations" }),
    hosts: "Hosts",
    sessions: "Sessions",
    credentials: "Credentials",
    "quick-connect": "Quick Connect",
    "ssh-tools": "SSH Tools",
    snippets: "Snippets",
    history: "History",
    "split-screen": "Split Screen",
    connections: t("nav.connections"),
    "user-profile": "User Profile",
    "admin-settings": "Admin Settings",
  };

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
        if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteShortcutEnabled]);

  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      setCommandPaletteShortcutEnabled(v !== null ? v === "true" : true);
    };
    window.addEventListener("commandPaletteShortcutEnabledChanged", handler);
    return () =>
      window.removeEventListener(
        "commandPaletteShortcutEnabledChanged",
        handler,
      );
  }, []);

  useEffect(() => {
    const handle = () => onLogout();
    window.addEventListener("termix:logout", handle);
    return () => window.removeEventListener("termix:logout", handle);
  }, [onLogout]);

  useEffect(() => {
    const handleSessionExpired = () => onLogout();
    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, [onLogout]);

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
    document.title = tmux || activeTab?.label || "Termix";
  }, [activeTabId, tabs, tmuxSessionNames]);

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

  const selectedConversationId = useSelectedConversationId();

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
  useEffect(() => {
    if (
      isTouchDevice &&
      mobileScreen === "view" &&
      !selectedConversationId
    ) {
      navigateToList();
    }
  }, [isTouchDevice, mobileScreen, selectedConversationId]);

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
          localStorage.setItem("termix-accent", prefs.accentColor);
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
    window.addEventListener("termix:hosts-changed", loadHosts);
    return () => window.removeEventListener("termix:hosts-changed", loadHosts);
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

  // Let HostManager trigger tab opens via custom event
  useEffect(() => {
    const handle = (e: Event) => {
      const { hostId, type } = (
        e as CustomEvent<{ hostId: string; type?: TabType }>
      ).detail;
      const host = allHosts.find((h) => h.id === hostId);
      if (host) connectHost(host, type);
    };
    window.addEventListener("termix:open-tab", handle);
    return () => window.removeEventListener("termix:open-tab", handle);
  }, [allHosts]);

  const PERSISTENT_TAB_TYPES: TabType[] = [
    "terminal",
    "rdp",
    "vnc",
    "telnet",
    "files",
    "docker",
    "stats",
    "tunnel",
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
                const hostlessTypes: TabType[] = ["dashboard", "tunnel"];
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

              if (restoredTabs.length > 0) {
                setTabs((prev) => {
                  const existingIds = new Set(prev.map((t) => t.id));
                  const newTabs = restoredTabs.filter(
                    (t) => !existingIds.has(t.id),
                  );
                  return newTabs.length > 0 ? [...prev, ...newTabs] : prev;
                });
                setActiveTabId(restoredTabs[0].id);
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

  const openSingletonTab = useCallback(
    function openSingletonTab(type: TabType, pendingEvent?: string) {
      if (type === "host-manager") {
        if (pendingEvent === "host-manager:add-credential") {
          setSidebarOpen(true);
          setRailView("credentials");
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("host-manager:add-credential"),
              ),
            0,
          );
        } else {
          setSidebarOpen(true);
          setRailView("hosts");
          if (pendingEvent) {
            setTimeout(
              () => window.dispatchEvent(new CustomEvent(pendingEvent)),
              0,
            );
          }
        }
        return;
      }
      if (type === "user-profile" || type === "admin-settings") {
        setSidebarEditing(false);
        setRailView(type as RailView);
        setSidebarOpen(true);
        return;
      }
      const id = type;
      const singletonLabels: Partial<Record<TabType, string>> = {
        "host-manager": t("nav.hostManager"),
        docker: t("nav.docker"),
        tunnel: t("nav.tunnels"),
        network_graph: t("nav.networkGraph"),
      };
      setTabs((prev) => {
        if (prev.find((t) => t.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            instanceId: id,
            type,
            label: singletonLabels[type] ?? type,
            openedAt: Date.now(),
          },
        ];
      });
      setActiveTabId(id);
      if (PERSISTENT_TAB_TYPES.includes(type)) {
        addOpenTab({
          id,
          tabType: type,
          hostId: null,
          label: singletonLabels[type] ?? type,
          tabOrder: 0,
        }).catch(() => {});
      }
    },
    [t],
  );

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
    if (id === activeTabId) {
      const remaining = tabs.filter((t) => t.id !== id);
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
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
            label: t("nav.dashboard"),
            openedAt: Date.now(),
          },
        ];
      return next;
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

  // ─── Rail / sidebar ──────────────────────────────────────────────────────

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      if (view !== railView) setSidebarEditing(false);
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  function editHostInManager(host: Host) {
    setSidebarOpen(true);
    setRailView("hosts");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("host-manager:edit-host", { detail: host.id }),
      );
    }, 0);
  }

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

  // Only mount TransferMonitor when there's actual work for it. Upstream
  // mounts it unconditionally; combined with the sub-2s polling loop it does
  // (POLL_INTERVAL_MS = 2000 in TransferMonitor.tsx), that flooded the backend
  // with /ssh/file_manager/ssh/activeTransfers requests on every browser tab
  // whether or not the user ever opens the file manager — and any cancelled
  // request tripped dbHealthMonitor's false-positive "connection lost" toast.
  // Gate: a "files" tab is open, OR a pending transfer id is in localStorage
  // (persisted across reloads by transferNotificationStore). See fork patch #27.
  const needsTransferMonitor = useMemo(
    () =>
      tabs.some((t) => t.type === "files") ||
      getPendingTransferIds().length > 0,
    [tabs],
  );

  // Sidebar panel content — shared between desktop inline sidebar and mobile sheet
  const sidebarPanelContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Plan 06-02: conversations panel is the default RailView and lives
          at the top of the sidebar-panel-content stack. Mounted-always with
          the `hidden` class toggle (same idiom as hosts / credentials below)
          so its store subscriptions stay live across rail-view swaps — that
          matters for Plan 06-04's deferred-select race defense which relies
          on the store's listener registry being registered even when the
          panel is not currently visible. */}
      <div
        className={`flex flex-col flex-1 min-h-0 ${railView === "conversations" ? "" : "hidden"}`}
      >
        <ConversationsPanel
          onRailClick={(view) => {
            handleRailClick(view);
            if (isMobile) setSidebarOpen(false);
          }}
          isAdmin={isAdmin}
          // Plan 06-03: on touchscreen viewports, a row tap ALSO transitions
          // to the mobile view screen (Telegram-style list-vs-view). Desktop
          // ignores this handler — the row-select is already handled by the
          // store's selectConversation which drives the effectiveSelectedTabId
          // portal path (Plan 06-02).
          onConversationSelected={
            isTouchDevice ? () => navigateToView() : undefined
          }
          // Plan 06-03: mobile-only settings row. Absent on desktop — desktop
          // reaches settings via the gear icon in the ConversationsPanel
          // header (Plan 06-02). SettingsRow lives at the BOTTOM of the
          // scroller so it doesn't compete with pinned or active rows for
          // prime attention (TG-10). Uses the same handleRailClick + isAdmin
          // pair so mobile row and desktop gear route to the same
          // destinations from one canonical menu-item registry.
          settingsRowSlot={
            isTouchDevice ? (
              <SettingsRow onRailClick={handleRailClick} isAdmin={isAdmin} />
            ) : undefined
          }
        />
      </div>

      <div
        className={`flex flex-col flex-1 min-h-0 ${railView === "hosts" ? "" : "hidden"}`}
      >
        <HostsPanel
          onOpenTab={(host, type) => {
            connectHost(host, type);
            if (isMobile) setSidebarOpen(false);
          }}
          onEditHost={editHostInManager}
          hostTree={realHostTree ?? undefined}
          loading={hostsLoading}
          onEditingChange={setSidebarEditing}
          active={railView === "hosts"}
        />
      </div>

      <div
        className={`flex flex-col flex-1 min-h-0 ${railView === "credentials" ? "" : "hidden"}`}
      >
        <CredentialsPanel
          onEditingChange={setSidebarEditing}
          active={railView === "credentials"}
        />
      </div>

      {railView === "quick-connect" && (
        <QuickConnectPanel
          onConnect={(host, type) => {
            openTab(host, type);
            if (isMobile) setSidebarOpen(false);
          }}
        />
      )}

      {railView === "ssh-tools" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SshToolsPanel
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "snippets" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SnippetsPanel
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "history" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <HistoryPanel terminalTabs={terminalTabs} activeTabId={activeTabId} />
        </div>
      )}

      {railView === "sessions" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <SessionsPanel
            onOpenTab={(host, type, restore, options) => {
              openTab(host, type, restore, options);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>
      )}

      {railView === "split-screen" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SplitScreenPanel
            tabs={tabs}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            paneTabIds={paneTabIds}
            setPaneTabIds={setPaneTabIds}
            onAssignPane={assignPane}
          />
        </div>
      )}

      {railView === "connections" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ConnectionsPanel
            tabs={tabs}
            activeTabId={activeTabId}
            allHosts={allHosts}
            backgroundTabRecords={backgroundTabRecords}
            onSwitchToTab={(tabId) => {
              setActiveTabId(tabId);
              if (isMobile) setSidebarOpen(false);
            }}
            onCloseTab={closeTab}
            onReopenTab={(record, restoredSessionId) => {
              const host = record.hostId
                ? allHosts.find((h) => h.id === String(record.hostId))
                : undefined;
              const hostlessTypes: TabType[] = ["tunnel"];
              if (!host && !hostlessTypes.includes(record.tabType as TabType))
                return;
              setBackgroundTabRecords((prev) =>
                prev.filter((r) => r.id !== record.id),
              );
              if (host) {
                const effectiveSessionId =
                  restoredSessionId ?? record.backendSessionId ?? null;
                openTab(
                  host,
                  record.tabType as TabType,
                  {
                    instanceId: record.id,
                    restoredSessionId: effectiveSessionId,
                  },
                  { targetTmuxSession: record.targetTmuxSession ?? null },
                );
              } else {
                openSingletonTab(record.tabType as TabType);
              }
              if (isMobile) setSidebarOpen(false);
            }}
            onForgetBackground={(recordId) => {
              setBackgroundTabRecords((prev) =>
                prev.filter((r) => r.id !== recordId),
              );
            }}
          />
        </div>
      )}

      {railView === "user-profile" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <UserProfilePanel
            username={username}
            onLogout={onLogout}
            userPrefs={userPrefs}
            onPrefsChange={setUserPrefs}
          />
        </div>
      )}

      {railView === "admin-settings" && isAdmin && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AdminSettingsPanel />
        </div>
      )}
    </div>
  );

  // Sidebar header — shared
  const sidebarHeader = (
    <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0">
      <span className="flex-1 text-base font-bold tracking-tight text-foreground px-3">
        {sidebarTitle[railView]}
      </span>
      {!isMobile && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 border-y-0 border-border rounded-none text-muted-foreground hover:text-foreground"
            title="Reset width"
            onClick={() => setSidebarWidth(266)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </>
      )}
      <Separator orientation="vertical" />
      <Button
        variant="ghost"
        size="icon"
        className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
        onClick={() => setSidebarOpen(false)}
      >
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );

  // Plan 06-03: touchscreen viewports render the Telegram-style two-screen
  // flow — "list" (full-screen ConversationsPanel) and "view" (full-screen
  // conversation content with a top-left back button). The screen is driven
  // by the `#mv=1` URL fragment key via useMobileScreen (mobile-flow.ts).
  // Desktop (`!isTouchDevice`) is UNCHANGED from Plan 06-02.
  const isMobileListScreen = isTouchDevice && mobileScreen === "list";
  const isMobileViewScreen = isTouchDevice && mobileScreen === "view";

  // The active conversation's label — used as the title in the mobile-view
  // header. Falls back to a generic string when nothing is selected (which
  // shouldn't happen thanks to T-06-03-06 stranded-user defense, but a
  // safe fallback is cheap).
  const activeConversationLabel =
    tabs.find((t) => t.id === effectiveSelectedTabId)?.label ??
    t("nav.conversations.title", { defaultValue: "Conversations" });

  return (
    <>
      <div className="flex w-screen bg-background" style={{ height: "100dvh" }}>
        {/* Skinny icon rail — non-touch devices only. Gate is pointer/hover,
            not window width, so narrow desktop windows still get the rail.
            Also hidden when the sidebar panel is collapsed: rail + panel
            behave as one unit. The chevron-right reveal button at the left
            of the main content brings BOTH back on click. See fork patch #28.
            Plan 06-03: touchscreen viewports never get the rail — the
            mobile flow's SettingsRow (inside ConversationsPanel) is where
            touchscreens reach the destinations the rail routes to. */}
        {sidebarOpen && !isTouchDevice && (
          <AppRail
            railView={railView}
            sidebarOpen={sidebarOpen}
            splitMode={splitMode}
            username={username}
            isAdmin={isAdmin}
            profileDropdownOpen={profileDropdownOpen}
            onProfileDropdownChange={setProfileDropdownOpen}
            onRailClick={handleRailClick}
            onOpenTab={openSingletonTab}
            onLogout={onLogout}
          />
        )}

        {/* Desktop (non-touch): inline resizable sidebar. Plan 06-03: also
            gated on `!isTouchDevice` so touchscreens don't get the inline
            column even when the viewport is wide (an iPad in landscape). */}
        {!isMobile && !isTouchDevice && (
          <div
            className={`relative flex flex-col bg-sidebar shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-accent-brand/60" : "border-border"}` : ""}`}
            style={{
              width: sidebarOpen ? (sidebarEditing ? 560 : sidebarWidth) : 0,
              transition: sidebarDragging ? "none" : "width 0.2s",
            }}
          >
            {sidebarHeader}
            {sidebarPanelContent}

            {sidebarOpen && !sidebarEditing && (
              <div
                onMouseDown={onSidebarMouseDown}
                className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${sidebarDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
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
              className="p-0 flex flex-col w-[min(85vw,360px)] max-w-full bg-sidebar border-r border-border gap-0"
              style={{ height: "100dvh" }}
            >
              {sidebarHeader}
              {sidebarPanelContent}
            </SheetContent>
          </Sheet>
        )}

        {/* Touchscreen list screen: full-viewport sidebar column, no
            main-content column visible. Uses a plain `<div>` (NOT the Sheet
            component) per plan Step D — the mobile flow's two screens
            REPLACE each other, they don't peek/panel/overlay. `sidebarHeader`
            + `sidebarPanelContent` are reused verbatim so the ConversationsPanel
            renders the same content (with the mobile SettingsRow slot filled
            in above). The main-content region below is CSS-hidden (not
            conditionally unmounted) so the createPortal loop's tab nodes
            and normalViewRef stay mounted — the T-06-02-01 mount-lifecycle-
            regression mitigation depends on that identity being preserved
            across list-vs-view switches too. */}
        {isMobileListScreen && (
          <div
            className="flex flex-col flex-1 min-w-0 bg-sidebar"
            style={{ height: "100dvh" }}
          >
            {sidebarHeader}
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
          className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200 ${!isMobile && !sidebarOpen && !isTouchDevice ? "pl-6" : ""}`}
          style={
            isMobileListScreen
              ? { width: 0, flex: "0 0 0px", overflow: "hidden" }
              : undefined
          }
          aria-hidden={isMobileListScreen ? true : undefined}
        >
          {!isMobile && !sidebarOpen && !isTouchDevice && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Open Sidebar"
              className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center w-6 bg-sidebar border-r border-border text-muted-foreground hover:text-accent-brand hover:bg-accent-brand/5 transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          )}
          {/* Plan 06-03: mobile-view header with a top-left back button.
              Renders ONLY when the user is on the mobile view screen
              (`isMobileViewScreen`). Back button calls navigateToList()
              which pops the pushState entry via history.back() (or
              replaceState-strips the `mv=1` fragment key when the entry
              is a fresh deep-link — see mobile-flow.ts). Title shows the
              active conversation's label so the user has visual context
              for what they're viewing. Reuses the sidebarHeader chrome
              idiom for consistency (h-12.5 row, ChevronLeft icon, muted-
              foreground default with hover:text-foreground). */}
          {isMobileViewScreen && (
            <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0 bg-sidebar">
              <Button
                variant="ghost"
                size="icon"
                className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => navigateToList()}
                aria-label={t("nav.conversations.backToList", {
                  defaultValue: "Back to conversations",
                })}
                title={t("nav.conversations.backToList", {
                  defaultValue: "Back to conversations",
                })}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Separator orientation="vertical" />
              <span className="flex-1 text-base font-bold tracking-tight text-foreground px-3 truncate">
                {activeConversationLabel}
              </span>
            </div>
          )}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            {/* Plan 06-02: tab strip DELETED unconditionally (TG-11 — full
                replacement, no toggle). The conversation-store's selectedId
                is now the single source of truth for "which conversation is
                visible"; the sidebar's ConversationsPanel row selection IS
                the affordance the tab strip used to provide.
                splitTabQuick / addTabToSplit / removeTabFromSplit are still
                used by SplitScreenPanel (rail entry). refreshTab is
                intentionally removed alongside its sole caller (this TabBar
                mount) — Plan 06-04 or later may re-introduce a per-row
                refresh affordance if Ashley's workflow needs one. */}
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
                  return createPortal(
                    renderTabContent(
                      tab,
                      openSingletonTab,
                      openTab,
                      closeTab,
                      inPane || activeInline,
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
      {needsTransferMonitor && <TransferMonitor />}
    </>
  );
}
