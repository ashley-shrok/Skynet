// The task pill's agent memory: the reading for its pie, whether a condense is
// under way, and Condense conversation itself. Condense asks first, then posts
// to /identities/:key/condense with no guidance (nothing typed in the compose
// box goes along). A local "requested" flag makes the pie read Condensing…
// before the fleet-status poll sees the request; the poll's condensing axis
// takes over when it turns true, and the flag clears itself after
// OPTIMISTIC_MS if it never does. A failed request says why in a toast.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authApi } from "@/main-axios";
import { useSessionIsCondensing } from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { kitConfirm } from "@/components/kit";
import { condenseConfirm, condenseFailureMessage } from "./MemoryGauge";

/** How long the pie says Condensing… on its own before the poll confirms it. */
const OPTIMISTIC_MS = 2 * 60 * 1000;

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
  const isCondensing = useSessionIsCondensing(`${hostId}:${tmuxSession ?? ""}`);
  const [inFlight, setInFlight] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!requested) return;
    if (isCondensing) {
      setRequested(false);
      return;
    }
    const t = setTimeout(() => setRequested(false), OPTIMISTIC_MS);
    return () => clearTimeout(t);
  }, [requested, isCondensing]);

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
        setRequested(true);
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
  }, [inFlight, hostId, identityKey, hostName]);

  return { pct, condensing: isCondensing || requested, inFlight, condense };
}
