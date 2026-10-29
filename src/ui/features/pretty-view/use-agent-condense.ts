// The task pill's agent memory: the reading for its pie, whether a compaction
// is under way, and Compact conversation itself. Compact asks first, then posts
// to /identities/:key/condense with no guidance (nothing typed in the compose
// box goes along). An accepted request marks the session in the shared
// compact-request store, so the pie (and the conversation's working orb) read
// as compacting before the fleet-status poll sees it. A failed request says
// why in a toast.

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { authApi } from "@/main-axios";
import { markCompactRequested, useSessionCompacting } from "@/state/compact-request-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { kitConfirm } from "@/components/kit";
import { condenseConfirm, condenseFailureMessage } from "./MemoryGauge";

export interface AgentCondense {
  /** 0–100, or null while unknown. */
  pct: number | null;
  condensing: boolean;
  /** A request is on its way — a second press does nothing. */
  inFlight: boolean;
  condense: () => Promise<void>;
}

export function useAgentCondense(
  hostId: number,
  identityKey: string,
  tmuxSession: string | null,
  hostName?: string,
): AgentCondense {
  const pct = useSessionContextPct(hostId, tmuxSession ?? "");
  const sessionKey = `${hostId}:${tmuxSession ?? ""}`;
  const compacting = useSessionCompacting(sessionKey);
  const [inFlight, setInFlight] = useState(false);

  const condense = useCallback(async () => {
    if (inFlight) return;
    if (!(await kitConfirm(condenseConfirm()))) return;
    setInFlight(true);
    console.info(`[task-pill-condense] request hostId=${hostId} identityKey=${identityKey}`);
    try {
      const response = await authApi.post(`/identities/${encodeURIComponent(identityKey)}/condense`, { hostId });
      const ok =
        response?.data && typeof response.data === "object" && (response.data as { ok?: unknown }).ok === true;
      if (ok) {
        markCompactRequested(sessionKey);
      } else {
        console.warn("[task-pill-condense] answered without ok", { hostId, identityKey, status: response?.status ?? null });
        toast.error(condenseFailureMessage({ response: { status: response?.status ?? 500 } }, hostName));
      }
    } catch (err: unknown) {
      // Structured warn — never the raw error object.
      console.warn("[task-pill-condense] request failed", {
        hostId,
        identityKey,
        status: (err as { response?: { status?: unknown } } | null)?.response?.status ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
      toast.error(condenseFailureMessage(err, hostName));
    } finally {
      setInFlight(false);
    }
  }, [inFlight, hostId, identityKey, hostName, sessionKey]);

  return { pct, condensing: compacting, inFlight, condense };
}
