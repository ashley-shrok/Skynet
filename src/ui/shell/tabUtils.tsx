/* eslint-disable react-refresh/only-export-components */
import {
  LayoutDashboard,
  Monitor,
  Network,
  Server,
  Settings,
  Terminal,
  User,
  Activity,
  TerminalSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal as TerminalFeature } from "@/features/terminal/Terminal";
import type {
  TerminalHandle,
  TerminalHostConfig,
} from "@/features/terminal/Terminal";
import { ServerStats } from "@/features/server-stats/ServerStats";
import GuacamoleApp from "@/features/guacamole/GuacamoleApp";
import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard";
import { TunnelTab } from "@/features/tunnel/TunnelTab";
import type { Tab, TabType, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";

function hostToSSHHost(h: Host): SSHHost {
  return {
    id: parseInt(h.id, 10),
    name: h.name,
    ip: h.ip,
    port: h.port,
    username: h.username,
    folder: h.folder ?? "",
    tags: h.tags ?? [],
    pin: h.pin ?? false,
    authType: h.authType,
    password: h.password,
    key: h.key,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId ? parseInt(h.credentialId, 10) : undefined,
    terminalConfig: h.terminalConfig,
    enableTerminal: h.enableTerminal ?? false,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    showTerminalInSidebar: true,
    showFileManagerInSidebar: true,
    showTunnelInSidebar: true,
    showDockerInSidebar: true,
    showServerStatsInSidebar: true,
    defaultPath: h.defaultPath ?? "",
    tunnelConnections: [],
    connectionType: "ssh",
    createdAt: "",
    updatedAt: "",
  } as SSHHost;
}

function EmptyState({
  icon: Icon,
  messageKey,
}: {
  icon: React.ElementType;
  messageKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
      <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
        <Icon className="size-5 text-muted-foreground/30" />
      </div>
      <span className="text-sm font-semibold text-muted-foreground/60">
        {t(messageKey)}
      </span>
    </div>
  );
}

export function tabIcon(type: TabType) {
  switch (type) {
    case "dashboard":
      return <LayoutDashboard className="size-3.5" />;
    case "terminal":
      return <Terminal className="size-3.5" />;
    case "rdp":
      return <Monitor className="size-3.5" />;
    case "vnc":
      return <Monitor className="size-3.5" />;
    case "telnet":
      return <Terminal className="size-3.5" />;
    case "stats":
      return <Server className="size-3.5" />;
    case "host-manager":
      return <Server className="size-3.5" />;
    case "user-profile":
      return <User className="size-3.5" />;
    case "admin-settings":
      return <Settings className="size-3.5" />;
    case "tunnel":
      return <Network className="size-3.5" />;
    case "network_graph":
      return <Network className="size-3.5" />;
  }
}

function TerminalTabContent({
  tab,
  host,
  label,
  isVisible,
  onCloseTab,
  onTmuxSessionChange,
  onTmuxSessionMissing,
}: {
  tab: Tab;
  host: Host;
  label: string;
  isVisible: boolean;
  onCloseTab?: (id: string) => void;
  onTmuxSessionChange?: (sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
}) {
  const { previewTerminalTheme } = useTabsSafe();
  return (
    <CommandHistoryProvider>
      <TerminalFeature
        ref={tab.terminalRef as React.Ref<TerminalHandle>}
        hostConfig={
          {
            ...hostToSSHHost(host),
            sshPort: host.sshPort ?? host.port,
            instanceId: tab.instanceId ?? tab.id,
            restoredSessionId: tab.restoredSessionId ?? null,
          } as TerminalHostConfig
        }
        targetTmuxSession={tab.targetTmuxSession ?? null}
        allowCreateTmux={tab.allowCreateTmux ?? false}
        hostName={host.name}
        isVisible={isVisible}
        title={label}
        showTitle={false}
        splitScreen={false}
        onClose={() => onCloseTab?.(tab.id)}
        onTmuxSessionChange={onTmuxSessionChange}
        onTmuxSessionMissing={(sessionName) =>
          onTmuxSessionMissing?.(tab.instanceId, sessionName)
        }
        previewTheme={previewTerminalTheme}
      />
    </CommandHistoryProvider>
  );
}

export function renderTabContent(
  tab: Tab,
  onOpenSingletonTab?: (type: TabType) => void,
  onOpenTab?: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: {
      targetTmuxSession?: string | null;
      label?: string;
      allowCreateTmux?: boolean;
    },
  ) => void,
  onCloseTab?: (id: string) => void,
  isVisible = true,
  onTmuxSessionChange?: (tabId: string, sessionName: string | null) => void,
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void,
) {
  const { host, label } = tab;

  switch (tab.type) {
    case "dashboard":
      // Phase 11 landing-surface swap (PURGE-01): renders the pretty-view
      // empty-landing card in place of the old Skynet landing render tree.
      // The "dashboard" TabType is preserved as a load-bearing fallback
      // identifier in effectiveSelectedTabId + doCloseTab; the retired
      // component tree under src/ui/dashboard/ becomes unreachable from
      // any UI path and is slated for Phase 12+ deletion.
      return <PrettyLandingCard />;

    case "terminal":
      if (!host)
        return (
          <EmptyState
            icon={TerminalSquare}
            messageKey="terminal.noHostSelected"
          />
        );
      return (
        <TerminalTabContent
          tab={tab}
          host={host}
          label={label}
          isVisible={isVisible}
          onCloseTab={onCloseTab}
          onTmuxSessionChange={
            onTmuxSessionChange
              ? (name) => onTmuxSessionChange(tab.id, name)
              : undefined
          }
          onTmuxSessionMissing={onTmuxSessionMissing}
        />
      );

    case "stats":
      if (!host)
        return (
          <EmptyState icon={Activity} messageKey="serverStats.noHostSelected" />
        );
      return (
        <ServerStats
          hostConfig={hostToSSHHost(host)}
          title={label}
          isVisible={isVisible}
          isTopbarOpen={false}
          embedded={true}
        />
      );

    case "tunnel":
      return <TunnelTab label={label} host={host} />;

    case "rdp":
    case "vnc":
    case "telnet":
      if (!host)
        return (
          <EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />
        );
      return (
        <GuacamoleApp
          hostId={host.id}
          tabId={tab.id}
          protocol={tab.type as "rdp" | "vnc" | "telnet"}
          isVisible={isVisible}
          onClose={() => onCloseTab?.(tab.id)}
        />
      );

    case "network_graph":
      // Phase 12 Plan 02 (pre-flight for dashboard/ deletion in Plan 04): renders
      // the pretty-view empty-landing card. The network_graph TabType is preserved
      // in the union but no UI path reaches it in Skynet; the retired
      // graph card from src/ui/dashboard/cards/ becomes dead code and is
      // deleted with the dashboard subtree in Plan 04.
      return <PrettyLandingCard />;

    case "host-manager":
    case "user-profile":
    case "admin-settings":
      return null;
  }
}
