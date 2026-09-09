/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense } from "react";
import {
  LayoutDashboard,
  Monitor,
  Terminal,
  TerminalSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
// Lazy-loaded heavy pane wrappers (POC 2026-09-08). Cold-shell for users
// who don't immediately open a terminal / RDP tab no longer pays the
// terminal-vendor (376 KB), remote-desktop-vendor (70 KB), Terminal (103 KB),
// and GuacamoleApp (10 KB) uncompressed cost. Each chunk lazy-fetches on
// first render of its matching case in renderTabContent.
const TerminalFeature = lazy(() =>
  import("@/features/terminal/Terminal").then((m) => ({ default: m.Terminal })),
);
const IdentitySessionPane = lazy(() =>
  import("@/shell/IdentitySessionPane").then((m) => ({ default: m.IdentitySessionPane })),
);
const GuacamoleApp = lazy(() => import("@/features/guacamole/GuacamoleApp"));
import type {
  TerminalHandle,
  TerminalHostConfig,
} from "@/features/terminal/Terminal";
import { PrettyLandingCard } from "@/features/pretty-view/PrettyLandingCard";
// Phase 93 Slice 4 (D-04): relay-room tabs now route through the shared
// chat surface (PrettyView) with source.kind === "relay". The standalone
// relay-room session pane has retired; the pretty-view surface subsumes it
// via Slice 1-3's source-prop machinery (discriminated-union adapter, multi-
// badge anchor, case-selected send, ChatSurfaceErrorState). PrettyView is
// imported directly (not lazy) — Slice 1 already threads PrettyView into
// IdentitySessionPane so it's on the harness code path; adding a second
// mount site here doesn't materially move the cold-start chunk cost.
import { PrettyView } from "@/features/pretty-view/PrettyView";
import type { Tab, TabType, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";
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
      <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
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
      </Suspense>
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
  // Phase 93 Slice 4 (D-06): host widened to `Host | null`. Relay-room tabs
  // (sessionKind === "relay-room") have no fleet host — the room lives on
  // the Matrix relay. The renderTabContent case "terminal" early-return
  // that used to route relay-room tabs directly to the standalone relay-
  // room pane BEFORE the host-null gate has retired; instead the host-null
  // check widens to permit sessionKind === "relay-room" past it, and the
  // relay branch inside THIS component mounts the shared chat surface
  // (PrettyView with source.kind === "relay"), handling the host-optional
  // case. Non-relay terminal tabs still require a host at the caller
  // (renderTabContent).
  host: Host | null;
  label: string;
  isVisible: boolean;
  attach: boolean;
  onCloseTab?: (id: string) => void;
  onTmuxSessionChange?: (sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
}) {
  // Hooks MUST run unconditionally per rules-of-hooks. The relay-room branch
  // below is a conditional early return, so useIdentities() is hoisted here.
  const { byKey: identitiesByKey, loaded: identitiesLoaded } = useIdentities();

  // Phase 90 Plan 07 Task 2: NEW branch placed FIRST because it's the most-
  // specific discriminator. Reads the `sessionKind` + `relayRoomId` fields
  // Plan 01 added to Tab. Backward-compat: any tab WITHOUT sessionKind (or
  // with sessionKind === "harness") falls through to the existing identity-
  // pane / terminal branches below, byte-unchanged (Test 1/1b/2 regression
  // gates enforce this).
  //
  // Defensive fall-through: if sessionKind is "relay-room" but relayRoomId is
  // missing, log-and-fall-through rather than crash. The tab-open path
  // (Plan 07 Task 3 AppShell wiring) should always set both fields together;
  // this belt-and-suspenders keeps a misconfigured tab-open from white-
  // screening the app (worst case: renders as best-effort through the
  // existing dispatcher, likely as a terminal that shows nothing useful).
  if (tab.sessionKind === "relay-room") {
    if (!tab.relayRoomId) {
      // eslint-disable-next-line no-console
      console.warn("relay-room tab missing relayRoomId", { tabId: tab.id });
      // Fall through to the existing dispatcher below.
    } else {
      // Phase 93 Slice 4 (D-04): mount the shared chat surface with a relay-
      // kind source. PrettyView's case-branches (Slices 1-3) drive:
      //   - source-prop-selected adapter (useRelayAdapter over WS)
      //   - MultiBadgeAnchor rendering participants (Slice 2)
      //   - case-selected handleComposeSend routing to adapter.sendMessage
      //   - ChatSurfaceErrorState on adapter.error !== null
      //   - ComposeBox mode="relay" hiding Row 1 + Paperclip
      // The `hostId` + `tmuxSession` flat props are passed as inert
      // defaults (0 / "") — the harness-only code paths that read them
      // are gated behind `source.kind === "harness"` and never fire for
      // a relay source. Suspense wrapper preserved for parity with the
      // pre-Slice-4 mount UX (PrettyView isn't lazy at this call site,
      // so the boundary is harmless; matches surrounding pattern).
      return (
        <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
          <PrettyView
            source={{
              kind: "relay",
              roomId: tab.relayRoomId,
              roomTitle: tab.relayRoomTitle ?? null,
            }}
            hostId={0}
            tmuxSession=""
            className="h-full w-full"
            isVisible={isVisible}
          />
        </Suspense>
      );
    }
  }

  // Phase 93 Slice 4 (D-06): past the relay branch above, all remaining
  // branches (identity-pane, plain-terminal) require a fleet host. If the
  // caller passed host=null and sessionKind isn't "relay-room" (or fell
  // through the defensive-warn path with missing relayRoomId), render the
  // "no host selected" empty state. This restores the pre-Slice-4
  // host-required invariant for non-relay branches without needing the
  // renderTabContent early-return to double-gate.
  if (!host) {
    return <EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />;
  }

  const identityKey = tab.targetTmuxSession
    ? sessionMatchKey(tab.targetTmuxSession)
    : null;
  // During hydration (identities registry not loaded yet), assume identity
  // if the session name resolves to a key. Otherwise a URL-restored identity
  // tab briefly renders TerminalTabContent while /identities is in flight —
  // mounting a real xterm.js + SSH WebSocket for 1-2s before re-rendering
  // as IdentitySessionPane once the registry lands. Assuming identity during
  // hydration keeps the terminal from ever mounting for a tab that is going
  // to be an identity pane. Fails gracefully if the identity was renamed or
  // deleted while away: IdentitySessionPane renders briefly with a phantom
  // identityKey (identityColorHue nulls out; badge / modal are gated on both
  // !isPrettyMode AND identitiesByKey.get(identityKey) so they no-op), then
  // corrects on the next render once the registry loads.
  const isIdentityPane =
    identityKey != null &&
    (identitiesByKey.has(identityKey) || !identitiesLoaded);

  if (isIdentityPane) {
    return (
      <Suspense fallback={<EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />}>
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
      </Suspense>
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
      // Phase 93 Slice 4 (D-06): host-null gate widens for relay-room tabs.
      // Previous Phase 91 UAT-fix early-return that mounted the standalone
      // relay-room pane inline HERE (before the host-null check) has retired —
      // TerminalOrIdentitySessionPane's relay branch (Slice 4 rewire above)
      // now handles the host-optional case with a direct PrettyView-with-relay-
      // source mount. Non-relay terminal tabs still require a host (unchanged
      // behavior); relay-room tabs pass through with host=null to
      // TerminalOrIdentitySessionPane which mounts the shared chat surface.
      if (!host && tab.sessionKind !== "relay-room") {
        return (
          <EmptyState
            icon={TerminalSquare}
            messageKey="terminal.noHostSelected"
          />
        );
      }
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
        <Suspense fallback={<EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />}>
          <GuacamoleApp
            hostId={host.id}
            tabId={tab.id}
            protocol={tab.type as "rdp" | "vnc" | "telnet"}
            isVisible={isVisible}
            onClose={() => onCloseTab?.(tab.id)}
          />
        </Suspense>
      );
  }
}
