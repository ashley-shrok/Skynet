/* eslint-disable react-refresh/only-export-components */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from "react";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal } from "@/features/terminal/Terminal";
import type { IdentityPaneHandle, TerminalHandle, TerminalHostConfig } from "@/features/terminal/Terminal";
import { PrettyView } from "@/features/pretty-view/PrettyView";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { IdentityModal } from "@/features/pretty-view/IdentityModal";
import { MessageQueueDrawer } from "@/features/terminal/MessageQueueDrawer";
import { sessionMatchKey, hueFromSessionName } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
import { useTabsSafe } from "@/shell/TabContext";
import type { Tab, Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";

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
}

/**
 * Phase 41 Plan 02: IdentitySessionPane wrapper.
 *
 * Hoists isPrettyMode + pvSendInputRef + pvSendInterruptRef + isMessageQueueOpen
 * + isIdentityModalOpen from TerminalInner to this wrapper. PrettyView is always
 * mounted; Terminal is conditionally mounted (only when !isPrettyMode, i.e. when
 * user summons it via Ctrl+Shift+O or long-press-badge).
 *
 * Exposes the full IdentityPaneHandle interface via useImperativeHandle
 * (TerminalHandle + the two wrapper-owned toggles):
 * - togglePrettyMode / toggleMessageQueue: wrapper-owned setters.
 * - disconnect/reconnect/fit/sendInput/notifyResize/refresh: forwarded to inner
 *   Terminal ref when mounted; safe-noop when Terminal is not mounted.
 *
 * Identity panes start in pretty mode (isPrettyMode = true by default), replacing
 * Terminal's hasAutoActivatedPrettyRef one-shot flip.
 */
export const IdentitySessionPane = forwardRef<IdentityPaneHandle, IdentitySessionPaneProps>(
  function IdentitySessionPane(
    { tab, host, label, isVisible, attach, onCloseTab, onTmuxSessionChange, onTmuxSessionMissing },
    ref,
  ) {
    // --- Hoisted state ---
    // Identity panes start in pretty mode (default true). This replaces
    // Terminal's hasAutoActivatedPrettyRef auto-flip: the wrapper is ONLY
    // rendered for identity panes, so the default is always-on.
    const [isPrettyMode, setIsPrettyMode] = useState(true);
    const [isMessageQueueOpen, setIsMessageQueueOpen] = useState(false);
    const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);

    // --- Hoisted refs ---
    // PrettyView populates these on mount via onRegisterSendInput/onRegisterSendInterrupt.
    // MessageQueueDrawer reads pvSendInputRef.current for sends.
    const pvSendInputRef = useRef<((text: string, mqid?: string) => boolean) | null>(null);
    const pvSendInterruptRef = useRef<(() => void) | null>(null);

    // Inner Terminal ref — populated when Terminal is mounted, null when not.
    const innerTerminalRef = useRef<TerminalHandle | null>(null);

    const { previewTerminalTheme } = useTabsSafe();
    const { byKey: identitiesByKey } = useIdentities();

    const tabId = tab.id;
    const hostId = host.id;
    const effectiveTmuxSession = tab.targetTmuxSession ?? null;

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
    // togglePrettyMode and toggleMessageQueue are wrapper-owned.
    // All other methods forward to innerTerminalRef when Terminal is mounted;
    // they are safe-noops (no throw, no side effect) when Terminal is not mounted.
    // openFileManager forwards to inner Terminal (which implements it) — identity
    // panes never call it in practice, but the forward keeps the interface
    // contract honest.
    useImperativeHandle(
      ref,
      () => ({
        togglePrettyMode: () => {
          setIsPrettyMode((v) => {
            const next = !v;
            console.info({
              operation: "identity_session_pane_toggle_pretty_mode",
              tabId,
              prev: v,
              next,
            });
            return next;
          });
        },
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

    // --- onInjectedTurnReady: mirrors Terminal.tsx L3266-3276 verbatim ---
    // Phase 35 ref-forwarding pattern: send the body first (synchronously),
    // then \r + mqid 60ms later (the split-and-delay path per patch #60/#100).
    const handleInjectedTurnReady = useCallback(
      (text: string, messageQueueItemId: string) => {
        const send = pvSendInputRef.current;
        if (!send) return; // silent noop — no WS yet on this mount
        send(text);
        setTimeout(() => {
          const send2 = pvSendInputRef.current;
          if (send2) send2("\r", messageQueueItemId);
        }, 60);
      },
      [],
    );

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
    const identityColorHue = identityKey != null
      ? (identitiesByKey.get(identityKey)?.colorHue ?? null)
      : null;
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
            hostId={parseInt(host.id, 10)}
            tmuxSession={effectiveTmuxSession ?? ""}
            className="flex-1 min-h-0"
            isVisible={isVisible}
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
              // no longer generates it — the 'pv-adhoc-<uuid>' scheme is
              // retired. See
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
              //   expects. The previous 'pv-adhoc-<uuid>' generation site
              //   broke this correspondence (checker Blocker #4, iteration 1).
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
            onInjectedTurnReady={handleInjectedTurnReady}
            // Phase 35 ref-forwarding registration surface for pretty-view outbound
            // writes. IdentitySessionPane holds pvSendInputRef / pvSendInterruptRef
            // so MessageQueueDrawer (mounted OUTSIDE PrettyView as a sibling below)
            // can write to PrettyView's WS without prop-drilling wsRef upward.
            onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}
            onUnregisterSendInput={() => { pvSendInputRef.current = null; }}
            onRegisterSendInterrupt={(fn) => { pvSendInterruptRef.current = fn; }}
            onUnregisterSendInterrupt={() => { pvSendInterruptRef.current = null; }}
            // Quick 260806-lzd — long-press-to-toggle-pretty-view. IdentitySessionPane
            // owns the isPrettyMode state, so the toggle is routed here (not into
            // Terminal which doesn't own isPrettyMode post-Phase-41).
            onTogglePrettyMode={() => setIsPrettyMode((v) => !v)}
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
              onTmuxSessionMissing={(sessionName) =>
                onTmuxSessionMissing?.(tab.instanceId, sessionName)
              }
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

          {/* Session-tint div — gated on !isPrettyMode (terminal-mode only).
              Mirrors Terminal.tsx L3409-3411. Moved to wrapper so it renders
              above the terminal surface when in terminal mode. */}
          {sessionHue != null && !isPrettyMode && (
            <div className="session-tint" aria-hidden="true" />
          )}

          {/* IdentityBadge — gated on !isPrettyMode (terminal-mode surface).
              PrettyView has its OWN internal IdentityBadge (Phase 4 patch).
              This badge is the terminal-mode replacement for Terminal.tsx L3413-3423.
              Long-press: toggle back to pretty mode (same UX as pre-Phase-41). */}
          {identityKey && !isPrettyMode && (
            <IdentityBadge
              identityKey={identityKey}
              onClick={() => setIsIdentityModalOpen(true)}
              onLongPress={() => setIsPrettyMode((v) => !v)}
            />
          )}

          {/* IdentityModal — gated on !isPrettyMode (terminal-mode surface).
              Replaces Terminal.tsx L3424-3446. Wrapper owns isIdentityModalOpen. */}
          {identityKey &&
            !isPrettyMode &&
            host.id != null &&
            identitiesByKey.get(identityKey) && (
              <IdentityModal
                open={isIdentityModalOpen}
                onOpenChange={setIsIdentityModalOpen}
                identity={identitiesByKey.get(identityKey)!}
                hue={sessionHue ?? 35}
                hostId={parseInt(host.id, 10)}
                container={null}
              />
            )}
        </div>
      </CommandHistoryProvider>
    );
  },
);
