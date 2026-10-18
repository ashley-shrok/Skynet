// Seen tracker — clears unread marks for conversations the user is looking at.
//
// A conversation counts as seen while it is on screen (an open pane, or the
// conversation view on a phone) AND this browser tab is in front of the user
// (Page Visibility). While both hold, every finished turn it reports is
// marked seen as it arrives — so a conversation being watched never lights
// up — and coming back to a tab marks what finished while it was hidden.
//
// Order matters: the conversation store is told what's on screen BEFORE the
// marks are cleared, so a conversation that was unread as it came on screen
// is held in its list position instead of sliding out from under the click.

import { useEffect, useState } from "react";
import { markSeen, subscribeAttention } from "./attention-store";
import { setVisibleConversationIds } from "./conversation-store";

export type SeenTarget = { id: string; hostId: string; identityName: string };

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function useSeenTracker(targets: readonly SeenTarget[], screenShowsConversation: boolean): void {
  const [pageVisible, setPageVisible] = useState(pageIsVisible);

  useEffect(() => {
    const onChange = () => {
      const v = pageIsVisible();
      console.info({ operation: "seen_tracker_page_visibility", visible: v });
      setPageVisible(v);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const looking = pageVisible && screenShowsConversation;
  // Stable dependency for the effect: the targets' identity changes on every
  // render upstream, their content rarely.
  const targetsKey = looking
    ? targets.map((t) => `${t.id}|${t.hostId}|${t.identityName}`).join("\n")
    : "";

  useEffect(() => {
    const seen = looking ? targets : [];
    setVisibleConversationIds(seen.map((t) => t.id));
    if (seen.length === 0) return;
    const markAll = () => {
      for (const t of seen) markSeen(t.hostId, t.identityName);
    };
    markAll();
    // A turn that finishes while the user is watching is seen as it lands.
    return subscribeAttention(markAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);
}
