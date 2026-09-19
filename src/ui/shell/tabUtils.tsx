/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import {
  AppWindow,
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
import { isAppTab } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";
import { useIdentities } from "@/state/identities-store";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { AppPane } from "./AppPane";

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

// ─── Phase 120 D-03 — tab icon dispatch (Record<TabType, ...>) ───────────────
//
// Refactored from a five-arm switch to a compile-time-exhaustive lookup so
// the sixth arm for the new "app" TabType is a one-line addition. TypeScript's
// `Record<TabType, ...>` gives us compile-time exhaustiveness: if TabType
// grows again, tsc surfaces the missing entry. Byte-equivalent output for
// the existing five arms (snapshot-tested in tabUtils.test.tsx).
//
// Icon-glyph choice for the `app` arm: `AppWindow` from lucide-react —
// already imported by Phase 119's PrettyConversationsPanel for the sidebar
// Apps-section header, so the icon story is coherent from sidebar tile
// header → leaf tab-bar glyph.
export const TAB_ICONS: Record<TabType, React.ElementType> = {
  dashboard: LayoutDashboard,
  terminal: Terminal,
  rdp: Monitor,
  vnc: Monitor,
  telnet: Terminal,
  app: AppWindow,
};

export function tabIcon(type: TabType) {
  const Icon = TAB_ICONS[type];
  return <Icon className="size-3.5" />;
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

// ─── Phase 120 D-04 — renderer dispatch (Record<TabType, Renderer>) ─────────
//
// Refactored from a switch-with-fall-through to a lookup table so the sixth
// arm for the new "app" TabType is a one-line addition and the three Guacamole
// protocols (`rdp`, `vnc`, `telnet`) become three explicit rows all pointing
// at the same `renderGuacamoleTab` helper (replacing the old fall-through
// pattern per D-04 cleanup — the fall-through was a subtle readability
// hazard). Byte-equivalent output for the existing five arms
// (snapshot-tested in tabUtils.test.tsx).
//
// The Renderer body copies are VERBATIM from the pre-refactor switch case
// bodies: same JSX shapes, same prop wiring, same inline logic. Only the
// dispatch shape (switch → lookup) changes.

// Closure of dependencies the current dispatch consumes. Matches the
// existing renderTabContent parameter list.
type RendererDeps = {
  onOpenSingletonTab?: (type: TabType) => void;
  onOpenTab?: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: {
      targetTmuxSession?: string | null;
      label?: string;
      allowCreateTmux?: boolean;
    },
  ) => void;
  onCloseTab?: (id: string) => void;
  isVisible: boolean;
  shouldAttach: boolean;
  onTmuxSessionChange?: (tabId: string, sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
};

type Renderer = (tab: Tab, deps: RendererDeps) => ReactNode;

// Phase 11 landing-surface swap (PURGE-01): renders the pretty-view
// empty-landing card in place of the old Skynet landing render tree.
// The "dashboard" TabType is preserved as a load-bearing fallback
// identifier in effectiveSelectedTabId + doCloseTab; the retired
// component tree under src/ui/dashboard/ becomes unreachable from
// any UI path and is slated for Phase 12+ deletion.
const renderDashboard: Renderer = () => <PrettyLandingCard />;

// Phase 93 Slice 4 (D-06): host-null gate widens for relay-room tabs.
// Previous Phase 91 UAT-fix early-return that mounted the standalone
// relay-room pane inline HERE (before the host-null check) has retired —
// TerminalOrIdentitySessionPane's relay branch (Slice 4 rewire above)
// now handles the host-optional case with a direct PrettyView-with-relay-
// source mount. Non-relay terminal tabs still require a host (unchanged
// behavior); relay-room tabs pass through with host=null to
// TerminalOrIdentitySessionPane which mounts the shared chat surface.
//
// Phase 41 Plan 02: dispatch through TerminalOrIdentitySessionPane which
// uses useIdentities().byKey to route identity panes → IdentitySessionPane
// and non-identity terminal panes → TerminalTabContent (byte-unchanged).
const renderTerminalTab: Renderer = (tab, deps) => {
  const { host, label } = tab;
  if (!host && tab.sessionKind !== "relay-room") {
    return (
      <EmptyState
        icon={TerminalSquare}
        messageKey="terminal.noHostSelected"
      />
    );
  }
  return (
    <TerminalOrIdentitySessionPane
      tab={tab}
      host={host}
      label={label}
      isVisible={deps.isVisible}
      attach={deps.shouldAttach}
      onCloseTab={deps.onCloseTab}
      onTmuxSessionChange={
        deps.onTmuxSessionChange
          ? (name) => deps.onTmuxSessionChange!(tab.id, name)
          : undefined
      }
      onTmuxSessionMissing={deps.onTmuxSessionMissing}
    />
  );
};

// Three explicit rows in RENDERERS below (rdp, vnc, telnet) all point at
// this same helper — replacing the fall-through pattern per D-04. Byte-
// equivalent to the pre-refactor rdp|vnc|telnet switch case.
const renderGuacamoleTab: Renderer = (tab, deps) => {
  const { host } = tab;
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
        isVisible={deps.isVisible}
        onClose={() => deps.onCloseTab?.(tab.id)}
      />
    </Suspense>
  );
};

// Phase 120 D-05 — app-leaf renderer. Uses isAppTab narrowing to access
// tab.app.hostId + tab.app.slug without further optional-chaining. The null
// return is defensive: upstream type-narrowing (Plan 04 extended Tab.app to
// be required-when-type-is-"app") should prevent the null branch from ever
// firing at runtime — but the guard costs nothing and keeps this dispatch
// safe if a caller ever mints an app-typed Tab without the tuple field.
const renderAppTab: Renderer = (tab, deps) => {
  if (!isAppTab(tab)) return null;
  return (
    <AppPane
      hostId={tab.app.hostId}
      slug={tab.app.slug}
      tabId={tab.id}
      isVisible={deps.isVisible}
    />
  );
};

// Record<TabType, Renderer> — compile-time exhaustive. Three explicit rows
// for rdp/vnc/telnet all pointing at the same helper (D-04 cleanup replaces
// the switch-fall-through). The `app` entry is appended (matches the
// TabType order from Plan 04 extending the union at the tail).
export const RENDERERS: Record<TabType, Renderer> = {
  dashboard: renderDashboard,
  terminal: renderTerminalTab,
  rdp: renderGuacamoleTab,
  vnc: renderGuacamoleTab,
  telnet: renderGuacamoleTab,
  app: renderAppTab,
};

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
  return RENDERERS[tab.type](tab, {
    onOpenSingletonTab,
    onOpenTab,
    onCloseTab,
    isVisible,
    shouldAttach,
    onTmuxSessionChange,
    onTmuxSessionMissing,
  });
}
