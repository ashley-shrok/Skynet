/* eslint-disable react-refresh/only-export-components */
import {
  LayoutDashboard,
  Monitor,
  Terminal,
  TerminalSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal as TerminalFeature } from "@/features/terminal/Terminal";
import type {
  TerminalHandle,
  TerminalHostConfig,
} from "@/features/terminal/Terminal";
import GuacamoleApp from "@/features/guacamole/GuacamoleApp";
import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard";
import type { Tab, TabType, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";
import { IdentitySessionPane } from "@/shell/IdentitySessionPane";
import { useIdentities } from "@/state/identities-store";
import { sessionMatchKey } from "@/features/terminal/session-hue";

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
      <div className="size-10 rounded-full bg-[color:var(--color-pv-surface-quiet)] flex items-center justify-center">
        <Icon className="size-5 text-[color:var(--color-pv-fg-dim)]" />
      </div>
      <span className="text-sm font-semibold text-[color:var(--color-pv-fg-dim)]">
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
  }
}

function TerminalTabContent({
  tab,
  host,
  label,
  isVisible,
  attach,
  onCloseTab,
  onTmuxSessionChange,
  onTmuxSessionMissing,
}: {
  tab: Tab;
  host: Host;
  label: string;
  isVisible: boolean;
  attach: boolean;
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
        attach={attach}
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

// Phase 41 Plan 02: TerminalOrIdentitySessionPane — inline component that
// calls useIdentities() at render time (hook rule) and dispatches to either
// IdentitySessionPane (identity panes where targetTmuxSession matches a registered
// identity key) or TerminalTabContent (all other terminal panes, byte-unchanged).
// Non-identity SSH panes and RDP/Guacamole panes MUST route to TerminalTabContent
// and the existing non-terminal cases respectively — not through this component.
//
// No CommandHistoryProvider here: TerminalTabContent provides its own, and
// IdentitySessionPane provides its own (per Task 1 implementation).
function TerminalOrIdentitySessionPane({
  tab,
  host,
  label,
  isVisible,
  attach,
  onCloseTab,
  onTmuxSessionChange,
  onTmuxSessionMissing,
}: {
  tab: Tab;
  host: Host;
  label: string;
  isVisible: boolean;
  attach: boolean;
  onCloseTab?: (id: string) => void;
  onTmuxSessionChange?: (sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
}) {
  const { byKey: identitiesByKey } = useIdentities();
  const identityKey = tab.targetTmuxSession
    ? sessionMatchKey(tab.targetTmuxSession)
    : null;
  const isIdentityPane = identityKey != null && identitiesByKey.has(identityKey);
  console.info(`[ctx-pct-diag] identity-route decide isIdentityPane=${isIdentityPane} identityKey=${identityKey ?? 'null'} hasInStore=${identityKey != null ? identitiesByKey.has(identityKey) : 'n/a'}`);

  if (isIdentityPane) {
    return (
      <IdentitySessionPane
        tab={tab}
        host={host}
        label={label}
        isVisible={isVisible}
        attach={attach}
        ref={tab.terminalRef as React.Ref<TerminalHandle>}
        onCloseTab={onCloseTab}
        onTmuxSessionChange={onTmuxSessionChange}
        onTmuxSessionMissing={onTmuxSessionMissing}
      />
    );
  }

  return (
    <TerminalTabContent
      tab={tab}
      host={host}
      label={label}
      isVisible={isVisible}
      attach={attach}
      onCloseTab={onCloseTab}
      onTmuxSessionChange={onTmuxSessionChange}
      onTmuxSessionMissing={onTmuxSessionMissing}
    />
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
  shouldAttach: boolean = false,
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
      // Phase 41 Plan 02: dispatch through TerminalOrIdentitySessionPane which
      // uses useIdentities().byKey to route identity panes → IdentitySessionPane
      // and non-identity terminal panes → TerminalTabContent (byte-unchanged).
      return (
        <TerminalOrIdentitySessionPane
          tab={tab}
          host={host}
          label={label}
          isVisible={isVisible}
          attach={shouldAttach}
          onCloseTab={onCloseTab}
          onTmuxSessionChange={
            onTmuxSessionChange
              ? (name) => onTmuxSessionChange(tab.id, name)
              : undefined
          }
          onTmuxSessionMissing={onTmuxSessionMissing}
        />
      );

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
  }
}
