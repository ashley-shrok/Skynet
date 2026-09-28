/* eslint-disable react-refresh/only-export-components */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useInjectedTurnRelay } from "./use-injected-turn-relay";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal } from "@/features/terminal/Terminal";
import type { IdentityPaneHandle, TerminalHandle, TerminalHostConfig } from "@/features/terminal/Terminal";
import { PrettyView } from "@/features/pretty-view/PrettyView";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { IdentityModal } from "@/features/pretty-view/IdentityModal";
import { MessageQueueDrawer } from "@/features/terminal/MessageQueueDrawer";
import { sessionMatchKey, hueFromSessionName } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTabsSafe } from "@/shell/TabContext";
import { specForTab, encodeWorkspaceSpec } from "@/lib/tab-url";
import {
  PrettyConversationContextMenu,
  type PrettyContextMenuItem,
  type PrettyContextMenuSubmenuItem,
} from "@/features/pretty-conversations/PrettyConversationContextMenu";
import {
  fleetRowId,
  usePinnedIds,
  pinConversation,
  unpinConversation,
  useProjects,
} from "@/state/conversation-store";
// Phase 115 Plan 115-06 (D-01): archive API client for the badge-menu
// Archive item. Same helper the panel's handleArchive uses so both entry
// points hit the identical backend endpoint.
import { archiveIdentity } from "@/api/identity-archive-api";
// Badge-menu Move-to-project (2026-09-27): same wire the row menu uses via
// PrettyConversationsPanel.handleRowMoveToProject.
import { setSessionProject } from "@/api/session-project-api";
import type { Tab, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
// Phase 137 Plan 03 (D-16): UserPreferences threaded to PrettyView for
// the fallbackVoice speak-flow resolution chain.
import type { UserPreferences } from "@/api/open-tabs-api";

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

export interface IdentitySessionPaneProps {
  tab: Tab;
  host: Host;
  label: string;
  isVisible: boolean;
  attach: boolean;
  onCloseTab?: (id: string) => void;
  onTmuxSessionChange?: (sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
  // Threaded from AppShell (via renderTabContent → tabUtils) so the
  // identity-badge context menu can admin-gate its "Switch view" item.
  // Fail-closed default at every hop.
  isAdmin?: boolean;
  // Phase 137 Plan 03 (D-16): per-user voice preferences for the
  // fallbackVoice speak-flow resolution chain in PrettyView.
  userPrefs?: UserPreferences;
}

/**
 * Phase 41 Plan 02: IdentitySessionPane wrapper.
 *
 * Hoists isPrettyMode + pvSendInputRef + pvSendInterruptRef + isMessageQueueOpen
 * + isIdentityModalOpen from TerminalInner to this wrapper. PrettyView is always
 * mounted; Terminal is conditionally mounted (only when !isPrettyMode, i.e. when
 * an admin flips the view via the identity-badge context menu).
 *
 * Exposes the IdentityPaneHandle interface via useImperativeHandle
 * (TerminalHandle + the wrapper-owned message-queue toggle):
 * - toggleMessageQueue: wrapper-owned setter.
 * - disconnect/reconnect/fit/sendInput/notifyResize/refresh: forwarded to inner
 *   Terminal ref when mounted; safe-noop when Terminal is not mounted.
 *
 * Identity panes start in pretty mode (isPrettyMode = true by default), replacing
 * Terminal's hasAutoActivatedPrettyRef one-shot flip.
 */
export const IdentitySessionPane = forwardRef<IdentityPaneHandle, IdentitySessionPaneProps>(
  function IdentitySessionPane(
    { tab, host, label, isVisible, attach, onCloseTab, onTmuxSessionChange, onTmuxSessionMissing, isAdmin = false, userPrefs },
    ref,
  ) {
    // --- Hoisted state ---
    // Identity panes start in pretty mode (default true). This replaces
    // Terminal's hasAutoActivatedPrettyRef auto-flip: the wrapper is ONLY
    // rendered for identity panes, so the default is always-on.
    const [isPrettyMode, setIsPrettyMode] = useState(true);
    const [isMessageQueueOpen, setIsMessageQueueOpen] = useState(false);
    const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
    // Terminal-mode identity-badge context menu state. Cursor coords on
    // desktop right-click; badge-anchored coords on mobile long-press
    // (positioning handled at the trigger site). Null = closed.
    // Pretty-mode has its own equivalent state slot inside PrettyView —
    // the two badges are conditionally mounted (gated on !isPrettyMode
    // vs isPrettyMode), so their menu states never coexist.
    const [terminalBadgeMenu, setTerminalBadgeMenu] = useState<
      { x: number; y: number } | null
    >(null);

    // --- Hoisted refs ---
    // PrettyView populates these on mount via onRegisterSendInput/onRegisterSendInterrupt.
    // MessageQueueDrawer reads pvSendInputRef.current for sends.
    const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null);
    const pvSendInterruptRef = useRef<(() => void) | null>(null);

    // Inner Terminal ref — populated when Terminal is mounted, null when not.
    const innerTerminalRef = useRef<TerminalHandle | null>(null);

    const { previewTerminalTheme } = useTabsSafe();
    // quick-260912-0t4 followup: byHostKey-with-byKey-fallback so the terminal-mode
    // identity badge / modal-open path picks THIS pane's own host when two identities
    // share a name across the fleet (e.g. willow on workstation + willow on t1000).
    // Same pattern as PrettyConversationRow.tsx L332-349.
    const { byHostKey: identitiesByHostKey, byKey: identitiesByKey } = useIdentities();
    const isMobile = useIsMobile();

    const tabId = tab.id;
    const hostId = host.id;
    const effectiveTmuxSession = tab.targetTmuxSession ?? null;

    // Identity-badge context-menu items — mirrors the conversation-row menu
    // (PrettyConversationRow.tsx items[] builder) so both surfaces offer the
    // same affordances for an identity. Order:
    //   Pin/Unpin → Move to new window (desktop-only) →
    //     Switch to (terminal/chat) view (admin-only) → Archive
    // Rendered on both desktop and mobile — mobile trigger is long-press
    // on the badge, desktop trigger is right-click.
    //
    // (Phase 115 Plan 115-02: prior Hide/Unhide item retired per D-21
    //  alongside the sibling row-menu affordance. 115-06 re-introduces an
    //  Archive item with red styling + a confirmation dialog.)
    //
    // Pin uses the fleet-synthetic id form (`fleet::<hostId>::<session>`)
    // so state survives openTab id churn across URL-restores — mirrors
    // PrettyConversationsPanel.handleTogglePin's shadowFleetId preference.
    // The Unpin label checks BOTH the shadow-fleet id AND tab.id so
    // legacy pins persisted under the openTab id shape still detect.
    const pinnedIds = usePinnedIds();
    // Badge-menu Move-to-project (2026-09-27): subscribe to the projects
    // list so the submenu re-renders when the wire flush changes what
    // this host has. Same store the panel reads.
    const projectsList = useProjects();
    const hostIdNum = parseInt(host.id, 10);
    const shadowFleetId =
      Number.isFinite(hostIdNum) && effectiveTmuxSession
        ? fleetRowId(hostIdNum, effectiveTmuxSession)
        : null;
    const isPinned =
      (shadowFleetId !== null && pinnedIds.has(shadowFleetId)) ||
      pinnedIds.has(tabId);

    const identityBadgeContextMenuItems = useMemo<PrettyContextMenuItem[]>(() => {
      const items: PrettyContextMenuItem[] = [];

      items.push({
        label: isPinned ? "Unpin" : "Pin",
        onClick: () => {
          if (isPinned) {
            if (shadowFleetId !== null && pinnedIds.has(shadowFleetId)) unpinConversation(shadowFleetId);
            if (pinnedIds.has(tabId)) unpinConversation(tabId);
          } else {
            pinConversation(shadowFleetId ?? tabId);
          }
        },
      });

      // Move-to-new-window is desktop-only — mobile has no multi-window story.
      if (!isMobile) {
        const spec = specForTab({
          type: tab.type,
          host: { name: host.name, id: host.id },
          targetTmuxSession: effectiveTmuxSession,
        });
        if (spec !== null) {
          items.push({
            label: "Move to new window",
            onClick: () => {
              const payload = encodeWorkspaceSpec({
                tabs: [spec],
                activeIndex: 0,
                only: true,
              });
              const w = window.open("#" + payload, "_blank");
              // Popup-blocker safety: window.open returns null when blocked.
              // Only tear down the current tab if the new window opened OK,
              // otherwise the user would lose their session with nowhere to go.
              if (w !== null) {
                onCloseTab?.(tabId);
              }
            },
          });
        }
      }

      // Admin-only "Switch to (terminal/chat) view" item. Terminal view is
      // the raw xterm surface; chat view is the agent-native bubbles/compose
      // surface. Label flips based on which side of the toggle the user is
      // currently on. Fail-closed: non-admin (or isAdmin unresolved) → item
      // is absent, not disabled. This is THE ONE affordance for the toggle
      // after the retirement of the long-press gesture and Ctrl+Shift+O
      // keyboard shortcut.
      if (isAdmin) {
        items.push({
          label: isPrettyMode ? "Switch to terminal view" : "Switch to chat view",
          onClick: () => setIsPrettyMode((v) => !v),
        });
      }

      // Badge-menu Move-to-project (2026-09-27): mirrors the row-menu item
      // at PrettyConversationRow.tsx L1507-1529. Badge is per-host by
      // construction (the identity lives on this pane's host), so the
      // per-row hostId filter the panel needs simplifies here to a
      // filter on projectsList by host.id. Same hide-not-grey rule:
      // when this host has zero projects, drop the item entirely.
      //
      // currentProjectSlug is read from the already-resolved identity's
      // `project` field (identities-store carries it, refreshed on
      // fleet-status). Checkmark marks the active slug; tapping it is
      // a silent no-op inside the onClick guard. "Remove from project"
      // leaf appears iff the identity is currently assigned to one.
      //
      // Wire: setSessionProject(hostIdNum, identityKey, slug) — same call
      // PrettyConversationsPanel.handleRowMoveToProject fires for identity
      // rows. identityKey resolution mirrors the Archive item below.
      if (shadowFleetId !== null && effectiveTmuxSession !== null) {
        const hostProjects = projectsList
          .filter((p) => p.hostId === host.id && !p.archived)
          .slice()
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (hostProjects.length > 0) {
          const identityKey = sessionMatchKey(effectiveTmuxSession) ?? effectiveTmuxSession;
          const resolved =
            (Number.isFinite(hostIdNum)
              ? identitiesByHostKey?.get(`${hostIdNum}::${identityKey}`)
              : undefined) ?? identitiesByKey.get(identityKey);
          const currentProjectSlug = resolved?.project ?? null;
          const submenu: PrettyContextMenuSubmenuItem[] = [];
          for (const p of hostProjects) {
            const isCurrent = p.slug === currentProjectSlug;
            submenu.push({
              label: p.displayName,
              checked: isCurrent,
              onClick: () => {
                if (isCurrent) return;
                void setSessionProject(hostIdNum, identityKey, p.slug).catch(
                  (err: unknown) => {
                    console.warn({
                      operation: "badge_menu_move_to_project_failed",
                      hostId: hostIdNum,
                      identityKey,
                      slug: p.slug,
                      errMessage: err instanceof Error ? err.message : String(err),
                    });
                  },
                );
              },
            });
          }
          if (currentProjectSlug !== null) {
            submenu.push({
              label: "Remove from project",
              onClick: () => {
                void setSessionProject(hostIdNum, identityKey, null).catch(
                  (err: unknown) => {
                    console.warn({
                      operation: "badge_menu_remove_from_project_failed",
                      hostId: hostIdNum,
                      identityKey,
                      errMessage: err instanceof Error ? err.message : String(err),
                    });
                  },
                );
              },
            });
          }
          items.push({
            label: "Move to project",
            submenu,
          });
        }
      }

      // Phase 115 Plan 115-06 (D-01, D-02, D-03, D-04): Archive item.
      // Mirrors the panel row menu's Archive slot BYTE-FOR-BYTE — same
      // label, same danger styling, same confirmation copy, same
      // pane-close side effect, same fire-and-forget API call. The
      // affordance-narrowing gate is `shadowFleetId !== null` (matches
      // the panel's canonicalArchiveIdForRow shape — fleet-synthetic
      // identity-backed rows only). Present on both desktop and mobile
      // now that the mobile badge grew a menu of its own.
      //
      // displayName resolution: prefer the resolved identity's
      // displayName (same field the IdentityBadge label at L261 renders),
      // fall back to the identity key from effectiveTmuxSession when the
      // identity has not yet resolved through fleet-status enrichment.
      // Matches PrettyConversationsPanel.handleArchive's resolution
      // strategy verbatim so the confirmation copy reads identically on
      // both surfaces.
      //
      // Placed LAST in the menu — most destructive item at the bottom,
      // matching the row menu's Archive placement.
      if (shadowFleetId !== null && effectiveTmuxSession !== null) {
        const identityKey = sessionMatchKey(effectiveTmuxSession) ?? effectiveTmuxSession;
        const resolved =
          (Number.isFinite(hostIdNum)
            ? identitiesByHostKey?.get(`${hostIdNum}::${identityKey}`)
            : undefined) ?? identitiesByKey.get(identityKey);
        // Mirror the sidebar row's label preference + panel-side handler:
        // task if present, else displayName, else identityKey.
        const label = resolved?.task || resolved?.displayName || identityKey;
        items.push({
          label: "Archive",
          danger: true,
          onClick: () => {
            if (!window.confirm(`archive ${label}? this can't be undone.`)) return;
            // D-04 side effect: close the visible pane BEFORE firing the
            // API call (mirrors the deleted Hide handler + the panel's
            // handleArchive).
            onCloseTab?.(tabId);
            void archiveIdentity(hostIdNum, identityKey).catch((err) => {
              console.warn({
                operation: "identity_archive_failed",
                hostId: hostIdNum,
                identityKey,
                errMessage: err instanceof Error ? err.message : String(err),
              });
            });
          },
        });
      }

      return items;
    }, [
      isMobile,
      isPinned,
      shadowFleetId,
      pinnedIds,
      tab.type,
      host.name,
      host.id,
      effectiveTmuxSession,
      tabId,
      onCloseTab,
      // Phase 115 Plan 115-06 (D-01, D-03): archive click handler reads
      // hostIdNum + identitiesByHostKey/byKey for displayName resolution.
      // hostIdNum is derived from host.id (already in deps); the two
      // identities maps drive the confirmation copy — if the resolved
      // identity's displayName changes, the memo must rebuild so the
      // next right-click renders the fresh copy.
      hostIdNum,
      identitiesByHostKey,
      identitiesByKey,
      // Badge-menu Move-to-project (2026-09-27): submenu contents derive
      // from projectsList (filtered by host.id) + the resolved identity's
      // .project field (identitiesByHostKey/byKey above).
      projectsList,
      // Admin gate + label-flip source for the "Switch view" item.
      // isAdmin from AppShell; isPrettyMode is local state — memo must
      // rebuild when either flips so the label reads the current mode.
      isAdmin,
      isPrettyMode,
    ]);

    // --- Structured log: mount ---
    useEffect(() => {
      console.info({
        operation: "identity_session_pane_mount",
        tabId,
        hostId,
        targetTmuxSession: effectiveTmuxSession,
        initialIsPrettyMode: true,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Structured log: Terminal-mount edge ---
    useEffect(() => {
      console.info({
        operation: "identity_session_pane_terminal_edge",
        tabId,
        edge: isPrettyMode ? "unmount" : "mount",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPrettyMode]);

    // --- useImperativeHandle: expose IdentityPaneHandle (TerminalHandle + toggles) ---
    // toggleMessageQueue is wrapper-owned. togglePrettyMode was previously
    // exposed here for the Ctrl+Shift+O keyboard hook; that pathway is
    // retired — the badge context-menu "Switch to (terminal/chat) view"
    // item is now the sole view-mode toggle affordance.
    // All other methods forward to innerTerminalRef when Terminal is mounted;
    // they are safe-noops (no throw, no side effect) when Terminal is not mounted.
    // openFileManager forwards to inner Terminal (which implements it) — identity
    // panes never call it in practice, but the forward keeps the interface
    // contract honest.
    useImperativeHandle(
      ref,
      () => ({
        toggleMessageQueue: () => {
          setIsMessageQueueOpen((v) => {
            const next = !v;
            console.info({
              operation: "identity_session_pane_toggle_message_queue",
              tabId,
              prev: v,
              next,
            });
            return next;
          });
        },
        disconnect: () => {
          innerTerminalRef.current?.disconnect?.();
        },
        reconnect: () => {
          innerTerminalRef.current?.reconnect?.();
        },
        fit: () => {
          innerTerminalRef.current?.fit?.();
        },
        sendInput: (data: string, messageQueueItemId?: string) => {
          innerTerminalRef.current?.sendInput?.(data, messageQueueItemId);
        },
        notifyResize: () => {
          innerTerminalRef.current?.notifyResize?.();
        },
        refresh: () => {
          innerTerminalRef.current?.refresh?.();
        },
        openFileManager: () => {
          innerTerminalRef.current?.openFileManager?.();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    // --- useInjectedTurnRelay: queue-and-replay hook (replaces the former
    // handleInjectedTurnReady inline useCallback that silently dropped turns
    // when pvSendInputRef.current === null during WS reconnect / mount-race).
    // getSendFn reads pvSendInputRef.current at call-time so the hook never
    // holds a stale capture. pvSendInputRef stays the single source of truth.
    const injectedTurnRelay = useInjectedTurnRelay({
      getSendFn: () => pvSendInputRef.current,
    });

    // --- hostConfig for Terminal (mirrors tabUtils.tsx L114-121 verbatim) ---
    const hostConfig: TerminalHostConfig = {
      ...hostToSSHHost(host),
      sshPort: host.sshPort ?? host.port,
      instanceId: tab.instanceId ?? tab.id,
      restoredSessionId: tab.restoredSessionId ?? null,
    };

    // --- Identity badge / session tint (terminal mode only, like pre-Phase-41) ---
    // identityKey is computed from the known targetTmuxSession for badge display.
    const identityKey = sessionMatchKey(effectiveTmuxSession);
    // quick-260912-0t4 followup: resolve identity via this pane's own hostId first
    // (byHostKey composite key), fall back to bare-name byKey for legacy tests and
    // pre-fleet-fetch renders. Reused at L253 (colorHue), L457 (render-gate), L461
    // (IdentityModal prop) — computed once here.
    const paneHostIdNum = parseInt(host.id, 10);
    const resolvedIdentity = identityKey == null
      ? null
      : (Number.isFinite(paneHostIdNum)
          ? identitiesByHostKey?.get(`${paneHostIdNum}::${identityKey}`)
          : undefined)
        ?? identitiesByKey.get(identityKey)
        ?? null;
    const identityColorHue = resolvedIdentity?.colorHue ?? null;
    const sessionHue = identityColorHue != null
      ? identityColorHue
      : hueFromSessionName(effectiveTmuxSession);

    return (
      <CommandHistoryProvider>
        {/* Root geometry mirrors Terminal.tsx outer wrapper at L3280-3290.
            The h-full w-full relative flex flex-col shape is intentional:
            PrettyView and Terminal are flex children that each fill 1fr. */}
        <div className="h-full w-full relative flex flex-col">

          {/* Always-mounted: PrettyView is the primary surface for identity panes.
              It owns its claude-session WS independently of Terminal. */}
          <PrettyView
            // Phase 92 Slice 1 (D-07): discriminated-union source prop.
            // Constructed inline as `{ kind: "harness", ... }` from the
            // same host + effectiveTmuxSession + tabId inputs the redundant
            // legacy props below carry. Slice 4 rewires the tabUtils
            // dispatcher's relay branch to construct a
            // `{ kind: "relay", ... }` variant at the sibling call site;
            // Slice 3 will land the real relay adapter that consumes it.
            source={{
              kind: "harness",
              hostId: parseInt(host.id, 10),
              tmuxSession: effectiveTmuxSession ?? "",
              tabId: tabId ?? undefined,
            }}
            // Phase 92 Slice 1 — redundant legacy props (Blocker 1
            // resolution). Retained alongside `source` because many
            // PrettyView internal consumers still read these flat props
            // directly: the badge anchor at PrettyView.tsx:~L3349, the
            // useSessionIsWorking key composition, the IdentityModal
            // invocation, the fleet-identity-hosts lookup, and so on.
            // Retirement of the redundant legacy props happens post-
            // Slice-4 in a follow-up cleanup once every internal consumer
            // has been proven to read from `source` instead.
            hostId={parseInt(host.id, 10)}
            hostName={host.name}
            tmuxSession={effectiveTmuxSession ?? ""}
            className="flex-1 min-h-0"
            isVisible={isVisible}
            // Phase 58 Plan 02: threads `tabId` so PrettyView can forward to
            // its own inner IdentityBadge mount (~L2927). Without this,
            // the pretty-view-surface badge would render draggable=false
            // (Plan 58-01 gate `!!tabId && !isMobile`) and only the
            // terminal-mode surface badge would be a valid drag source.
            tabId={tabId}
            identityBadgeContextMenuItems={identityBadgeContextMenuItems}
            // Phase 137 Plan 03 (D-16): user's fallbackVoice preference for
            // the speak-flow resolution chain (identity voice → user fallback
            // → backend DEFAULT_VOICE "Joanna").
            userPrefs={userPrefs}
            onSend={(text: string, mqid?: string): boolean => {
              // Patch #110: collapse pretty-view submit into a SINGLE WS event
              // with text+CR + a synthetic messageQueueItemId.
              // WHY:
              //   The prior shape sent two events (text, then a
              //   setTimeout(60ms) for \r). The 60ms gap silently DROPPED
              //   Enter when the WebSocket blipped in that window
              //   (readyState !== 1 at fire time). Text arrived at Claude
              //   Code's composer; Enter didn't; the message sat unsent.
              //   Also — mqid was never attached, so backend's
              //   isPrettyViewSubmit gate (terminal.ts:499) never fired,
              //   which meant the backend split-send path (patch #100)
              //   was dormant and the frontend was doing all the work.
              // HOW THE FIX WORKS:
              //   Backend gate fires when mqid non-empty AND data ends in
              //   \r. Sending `text + "\r"` in ONE event with mqid trips
              //   the gate → backend writes body without \r, waits 50ms,
              //   writes \r alone. Pty byte stream is byte-identical to
              //   the previous behavior; only the WS-level event count
              //   changes (2 → 1), eliminating the race window entirely.
              // Phase 50 D-01 update: mqid is now generated by ComposeBox
              // (Task 2 in 50-03-PLAN.md) and forwarded through
              // PrettyView.handleComposeSend (Task 3a). IdentitySessionPane
              // no longer generates it — the former local generation scheme
              // is retired. See
              // .planning/phases/50-optimistic-message-bubbles/50-03-PLAN.md
              // § objective "Mqid threading (Blocker #4 root-cause
              // resolution)".
              // WHY SYNTHETIC-STYLE MQID (rationale preserved for context):
              //   Pretty-view composer submits aren't tied to a queue row
              //   (MessageQueueDrawer's onSend at ~L176 below has a real mqid).
              //   The backend gate is agnostic to what the mqid encodes —
              //   it only reads it as "yes, this is a pretty-view submit,
              //   apply split-send" — so any non-empty string works. The
              //   ComposeBox-generated 'pv-optim-<...>' prefix keeps it
              //   grep-able in backend logs AND, crucially, it matches the
              //   mqid that the frontend PendingSend + the backend
              //   armPvSendWatchdog use — so paste_send_failed frames land
              //   with the SAME mqid PrettyView's flipToFailed lookup
              //   expects. The previous local generation site broke this
              //   correspondence (checker Blocker #4, iteration 1).
              // Phase 35: send routes through PrettyView's own WS
              // (pvSendInputRef) instead of the borrowed terminal SSH WS.
              const send = pvSendInputRef.current;
              if (!send) return false;
              // Defensive: if PrettyView.handleComposeSend somehow forwards
              // without an mqid (e.g., a caller that doesn't participate in
              // Phase 50's threading), fall back to the empty string. The
              // backend's isPrettyViewSubmit gate reads empty mqid as a
              // non-pretty-view path — safe no-op for the split-send +
              // watchdog arm. Should never happen in production because
              // ComposeBox always generates a pv-optim-<...> mqid, but
              // this keeps the callback type-safe.
              return send(text + "\r", mqid ?? "");
            }}
            onInterrupt={() => {
              // Patch #120 — safety-valve Ctrl-C. Routes through PrettyView's
              // own WS (Phase 35 cutover). Silent no-op on WS-not-ready.
              const send = pvSendInterruptRef.current;
              if (!send) return;
              send();
            }}
            onInjectedTurnReady={injectedTurnRelay.onInjectedTurnReady}
            // Phase 35 ref-forwarding registration surface for pretty-view outbound
            // writes. IdentitySessionPane holds pvSendInputRef / pvSendInterruptRef
            // so MessageQueueDrawer (mounted OUTSIDE PrettyView as a sibling below)
            // can write to PrettyView's WS without prop-drilling wsRef upward.
            // Order matters: assign the ref FIRST, then notify the relay hook —
            // so when the hook's drain microtask fires and calls getSendFn(), the
            // ref is already populated.
            onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; injectedTurnRelay.onRegisterSendInput(fn); }}
            onUnregisterSendInput={() => { pvSendInputRef.current = null; injectedTurnRelay.onUnregisterSendInput(); }}
            onRegisterSendInterrupt={(fn) => { pvSendInterruptRef.current = fn; }}
            onUnregisterSendInterrupt={() => { pvSendInterruptRef.current = null; }}
          />

          {/* Conditionally-mounted: Terminal cold-boots on first toggle (isPrettyMode=false)
              and tears down completely on second toggle (isPrettyMode=true).
              Every toggle-back is a fresh cold-boot (no warm-keep, no cache). */}
          {!isPrettyMode && <Terminal
              ref={innerTerminalRef}
              hostConfig={hostConfig}
              targetTmuxSession={effectiveTmuxSession}
              allowCreateTmux={tab.allowCreateTmux ?? false}
              hostName={host.name}
              isVisible={isVisible}
              attach={attach}
              title={label}
              showTitle={false}
              splitScreen={false}
              onClose={() => onCloseTab?.(tab.id)}
              onTmuxSessionChange={onTmuxSessionChange}
              onTmuxSessionMissing={() => {
                // Any tmux-session-vanished signal (self-archive, killed
                // session, URL restore to a dead session) closes the tab.
                // doCloseTab handles the server-side open_tabs purge for
                // terminal tabs via the PERSISTENT_TAB_TYPES gate.
                onCloseTab?.(tab.id);
              }}
              previewTheme={previewTerminalTheme}
            />}

          {/* MessageQueueDrawer — hoisted to wrapper alongside PrettyView so it
              can access pvSendInputRef directly (Pitfall 2 from RESEARCH.md).
              The two-event split-send body below is VERBATIM from Terminal.tsx
              L3385-3407 (60ms setTimeout preserved; Phase 35 routing preserved). */}
          {isMessageQueueOpen && host.id != null && (
            <MessageQueueDrawer
              hostId={parseInt(host.id, 10)}
              tmuxSession={effectiveTmuxSession}
              onSend={(text, messageQueueItemId) => {
                const send = pvSendInputRef.current;
                if (!send) return false;
                // First WS event: body only. Second event (60ms later): the
                // \r that Ink treats as submit, PLUS the messageQueueItemId
                // so the backend deletes the row atomically after both writes
                // have been applied to the SSH stream (patch #60).
                // Phase 35: both events now route through PrettyView's own WS
                // (pvSendInputRef) instead of the borrowed terminal SSH WS.
                send(text);
                setTimeout(() => {
                  const send2 = pvSendInputRef.current;
                  if (send2) send2("\r", messageQueueItemId);
                }, 60);
                return true;
              }}
              onClose={() => setIsMessageQueueOpen(false)}
            />
          )}

          {/* IdentityBadge — gated on !isPrettyMode (terminal-mode surface).
              PrettyView has its OWN internal IdentityBadge (Phase 4 patch).
              This badge is the terminal-mode replacement for Terminal.tsx L3413-3423.
              View-mode toggling is now surfaced through the badge's context-
              menu "Switch to chat view" item (admin-only) — the earlier long-
              press → togglePrettyMode wiring is retired.
              Phase 58 Plan 02: threads `tabId` so the badge activates as an
              HTML5 drag source (Plan 58-01 wire — badge writes dual-MIME
              payload, Phase 56 Pane onDrop rearranges via openSessionInTree,
              Phase 58 Plan 02 conv-list onDrop closes via closeTab). `tabId`
              const at L103 is `tab.id` — reused here for consistency with the
              PrettyView mount below and existing tabId consumers in this file. */}
          {identityKey && !isPrettyMode && (
            <IdentityBadge
              identityKey={identityKey}
              hostId={parseInt(host.id, 10)}
              onClick={() => setIsIdentityModalOpen(true)}
              tabId={tabId}
              dragDescriptor={{
                tabType: "terminal",
                sessionKind: "harness",
                targetTmuxSession: effectiveTmuxSession,
              }}
              onContextMenu={
                identityBadgeContextMenuItems.length > 0
                  ? (e) => {
                      e.preventDefault();
                      if (isMobile) {
                        // Mobile long-press → menu anchored to the badge,
                        // not the touch coord (which sits under the user's
                        // finger). Drops down-and-inward from the badge's
                        // bottom-left; PrettyConversationContextMenu's
                        // viewport-clamp handles edge cases.
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTerminalBadgeMenu({ x: rect.left, y: rect.bottom + 4 });
                      } else {
                        setTerminalBadgeMenu({ x: e.clientX, y: e.clientY });
                      }
                    }
                  : undefined
              }
            />
          )}
          {/* Terminal-mode badge context menu — mirrors the pretty-mode
              equivalent inside PrettyView. Same item list (built once
              above and threaded to PrettyView via
              identityBadgeContextMenuItems), same close semantics. */}
          {terminalBadgeMenu !== null &&
            identityBadgeContextMenuItems.length > 0 && (
              <PrettyConversationContextMenu
                x={terminalBadgeMenu.x}
                y={terminalBadgeMenu.y}
                items={identityBadgeContextMenuItems}
                hue={sessionHue ?? null}
                onClose={() => setTerminalBadgeMenu(null)}
              />
            )}

          {/* IdentityModal — gated on !isPrettyMode (terminal-mode surface).
              Replaces Terminal.tsx L3424-3446. Wrapper owns isIdentityModalOpen. */}
          {identityKey &&
            !isPrettyMode &&
            host.id != null &&
            resolvedIdentity && (
              <IdentityModal
                open={isIdentityModalOpen}
                onOpenChange={setIsIdentityModalOpen}
                identity={resolvedIdentity}
                hue={sessionHue ?? 35}
                hostId={paneHostIdNum}
                container={null}
              />
            )}
        </div>
      </CommandHistoryProvider>
    );
  },
);
