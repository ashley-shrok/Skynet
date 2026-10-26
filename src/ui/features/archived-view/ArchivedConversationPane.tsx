// An archived agent's conversation, opened from search: the normal chat view,
// view-only. The server decides where the agent is (it opens the archived
// history, or says the agent is live again); this pane paints the agent's
// look, puts an "Archived" strip with Un-archive where the compose box would
// be, and turns itself into the live conversation in place once the agent is
// back (its identity loaded and its session running, like a sidebar row).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive } from "lucide-react";
import type { Host } from "@/types/ui-types";
import type { Tab } from "@/types/ui-types";
import type { ArchivedIdentityLook, ArchivedStateEvent } from "@/api/claude-session-api";
import { unarchiveIdentity } from "@/api/identity-unarchive-api";
import { useIdentities, refreshOneIdentity } from "@/state/identities-store";
import { clearPendingArchive, getFleetSessionsSnapshot, useConversations } from "@/state/conversation-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { encodeWorkspaceSpec, specForTab } from "@/lib/tab-url";
import { KitButton } from "@/components/kit";
import { PrettyView } from "@/features/pretty-view/PrettyView";
import { StatusOverlay } from "@/features/pretty-view/StatusOverlay";
import type { RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import {
  identityFromArchivedLook,
  noteAgentWindowReopen,
  requestArchivedTabLive,
  seededArchivedLook,
  type AgentWindowState,
} from "./archived-identity";
import { unarchiveFailureNotice } from "./unarchive-notice";

/** How often a waiting un-archive checks whether the agent is back. */
const BACK_CHECK_MS = 5_000;

type UnarchiveState =
  | { phase: "idle" }
  | { phase: "working" }
  /** Done or handed off — waiting for the agent to show up live. */
  | { phase: "returning"; slow: boolean }
  | { phase: "failed"; title: string; body: string };

function fallbackLook(hostId: number, identityKey: string): ArchivedIdentityLook {
  return {
    identityKey,
    hostId,
    displayName: identityKey.charAt(0).toUpperCase() + identityKey.slice(1),
    title: null,
    colorHue: null,
    voice: null,
    task: null,
    role: null,
    roles: [],
    archivedRoles: [],
    roleDisplayNames: {},
    avatarUrl: "",
  };
}

export function ArchivedConversationPane({
  tab,
  host,
  isVisible,
  onCloseTab,
}: {
  tab: Tab;
  host: Host;
  isVisible: boolean;
  onCloseTab?: (id: string) => void;
}) {
  const identityKey = (tab.targetTmuxSession ?? "").toLowerCase();
  const hostId = parseInt(host.id, 10);
  const isMobile = useIsMobile();

  const [look, setLook] = useState<ArchivedIdentityLook>(
    () => seededArchivedLook(hostId, identityKey) ?? fallbackLook(hostId, identityKey),
  );
  const [folder, setFolder] = useState<"loading" | "archived" | "no-history" | "gone">("loading");
  const [unarchive, setUnarchive] = useState<UnarchiveState>({ phase: "idle" });

  // ── Back to live ─────────────────────────────────────────────────────────
  // "Back" = the same test a sidebar row passes: the identity is loaded and
  // its session is in the fleet list. Until then the tab stays archived (a
  // live pane opened earlier would find no session and give up).
  const { byHostKey } = useIdentities();
  useConversations(); // re-render on fleet-session changes
  const identityLive = !!byHostKey?.get(`${hostId}::${identityKey}`);
  const sessionLive = getFleetSessionsSnapshot().some(
    (s) => s.hostId === hostId && s.sessionName.toLowerCase() === identityKey,
  );
  const flippedRef = useRef(false);
  const windowState = useRef<AgentWindowState>({ open: false });
  // Only once the agent is coming back — this tab's own un-archive, or the
  // server saying it's live again. The browser's lists alone can be stale
  // (an agent archived elsewhere moments ago is still in them).
  const comingBack = unarchive.phase === "returning";
  useEffect(() => {
    if (flippedRef.current || !comingBack || !identityLive || !sessionLive) return;
    flippedRef.current = true;
    console.info(`[archived-view] agent back hostId=${hostId} identity=${identityKey} tabId=${tab.id}`);
    clearPendingArchive(hostId, identityKey);
    // An open agent window stays open, on the same tab, once live.
    if (windowState.current.open) noteAgentWindowReopen(tab.id, windowState.current.tab);
    requestArchivedTabLive(tab.id);
  }, [comingBack, identityLive, sessionLive, hostId, identityKey, tab.id]);

  // While returning, keep asking for the identity (the fleet list refreshes
  // on its own; the identity registry doesn't learn of it by itself).
  const returning = unarchive.phase === "returning";
  useEffect(() => {
    if (!returning || identityLive) return;
    void refreshOneIdentity(identityKey, hostId);
    const t = setInterval(() => void refreshOneIdentity(identityKey, hostId), BACK_CHECK_MS);
    return () => clearInterval(t);
  }, [returning, identityLive, identityKey, hostId]);

  const onState = useCallback(
    (ev: ArchivedStateEvent) => {
      if (ev.look) setLook(ev.look);
      if (ev.state === "live") {
        // Un-archived since this tab was opened (or elsewhere): wait for it
        // to be back, then turn live.
        setUnarchive((u) => (u.phase === "returning" ? u : { phase: "returning", slow: false }));
        return;
      }
      if (ev.state === "gone") {
        setFolder("gone");
        return;
      }
      setFolder(ev.noHistory ? "no-history" : "archived");
    },
    [],
  );

  const runUnarchive = useCallback(async () => {
    if (unarchive.phase === "working" || unarchive.phase === "returning") return;
    setUnarchive({ phase: "working" });
    console.info(`[archived-view] unarchive start hostId=${hostId} identity=${identityKey}`);
    try {
      const { outcome } = await unarchiveIdentity(hostId, identityKey);
      console.info(`[archived-view] unarchive outcome=${outcome} hostId=${hostId} identity=${identityKey}`);
      setUnarchive({ phase: "returning", slow: outcome === "pending" });
    } catch (err) {
      const notice = unarchiveFailureNotice(err, identityKey);
      console.info(`[archived-view] unarchive failed hostId=${hostId} identity=${identityKey} title="${notice.title}"`);
      setUnarchive({ phase: "failed", ...notice });
    }
  }, [unarchive.phase, hostId, identityKey]);

  // ── Pill menu: Move to new tab, Close (desktop), Un-archive ──────────────
  const menuItems = useMemo<RowKebabMenuItem[]>(() => {
    const items: RowKebabMenuItem[] = [];
    if (!isMobile) {
      const spec = specForTab({
        type: "terminal",
        host: { name: host.name, id: host.id },
        targetTmuxSession: identityKey,
        sessionKind: "archived",
      });
      if (spec) {
        items.push({
          label: "Move to new tab",
          onClick: () => {
            const w = window.open("#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }), "_blank");
            if (w !== null) onCloseTab?.(tab.id);
          },
        });
      }
      if (onCloseTab) items.push({ label: "Close", onClick: () => onCloseTab(tab.id) });
    }
    if (folder !== "gone") items.push({ label: "Un-archive", onClick: () => void runUnarchive() });
    return items;
  }, [isMobile, host.name, host.id, identityKey, onCloseTab, tab.id, folder, runUnarchive]);

  const identity = useMemo(() => identityFromArchivedLook(look), [look]);

  // ── The strip where the compose box would be ─────────────────────────────
  const statusLine =
    unarchive.phase === "working"
      ? "Un-archiving…"
      : unarchive.phase === "returning"
        ? unarchive.slow
          ? "Still un-archiving — this conversation opens as soon as it's back."
          : "Coming back…"
        : unarchive.phase === "failed"
          ? `${unarchive.title}. ${unarchive.body}`
          : folder === "gone"
            ? "This conversation is no longer in the archive."
            : "This conversation is archived. Un-archive it to carry on.";
  const busy = unarchive.phase === "working" || unarchive.phase === "returning";
  const footer = (
    <div className="pv-archived-strip" data-testid="archived-strip" role="status">
      <span className="pv-archived-strip-mark">
        <Archive className="size-4" aria-hidden="true" />
        Archived
      </span>
      <span className="pv-archived-strip-text" data-testid="archived-strip-status" data-tone={unarchive.phase === "failed" ? "danger" : undefined}>
        {statusLine}
      </span>
      {folder !== "gone" && (
        <KitButton
          size="sm"
          variant="primary"
          busy={busy}
          disabled={busy}
          onClick={() => void runUnarchive()}
          data-testid="archived-unarchive"
        >
          Un-archive
        </KitButton>
      )}
    </div>
  );

  const overlay =
    folder === "no-history" ? (
      <StatusOverlay
        icon={<Archive className="pv-status-icon" aria-hidden="true" />}
        title="No history was kept"
        subline={`${look.displayName}'s conversation wasn't kept when it was archived.`}
        testId="archived-no-history"
      />
    ) : folder === "gone" ? (
      <StatusOverlay
        icon={<Archive className="pv-status-icon" aria-hidden="true" />}
        title="Not in the archive"
        subline="It may have been un-archived or removed."
        testId="archived-gone"
      />
    ) : null;

  return (
    <div className="h-full w-full relative flex flex-col" data-testid="archived-conversation-pane">
      <PrettyView
        source={{ kind: "harness", hostId, tmuxSession: identityKey, tabId: tab.id }}
        hostId={hostId}
        hostName={host.name}
        tmuxSession={identityKey}
        className="flex-1 min-h-0"
        isVisible={isVisible}
        tabId={tab.id}
        identityBadgeContextMenuItems={menuItems}
        archived={{ identity, archivedRoles: look.archivedRoles, onState, footer, overlay, windowState }}
      />
    </div>
  );
}
