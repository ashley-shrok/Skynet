/**
 * Phase 93 Slice 2 Task 1 — AgentBadgeWithMeter.
 *
 * Ported byte-for-byte from Slice D's agent badge with appendage per D-10
 * (Phase 93 Slice 4 retired the source). Renames the exported function +
 * rehomes into pretty-view/ so the retirement of the standalone relay-source
 * tree doesn't orphan it.
 *
 * Renders the plain IdentityBadge (D-08 reuse — same badges as pretty view
 * / terminal mode) PLUS the agent's memory pie, whose pop-over carries
 * Condense conversation.
 *
 * ## D-10 correctness by construction (Pitfall 2 mitigation)
 *
 * The badge appendage subscribes to the SAME sources PrettyView reads and
 * requests through the SAME seam PrettyView's composer uses. No hidden
 * per-agent WS, no bespoke store, no parent-mediated plumbing that could drift.
 *
 * READ SIDE:
 *   - `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)` — same store,
 *     same key format as PrettyView's `sessionWorkingKey`.
 *   - `useSessionIsCondensing(\`${hostId}:${tmuxSessionName}\`)` — same
 *     store's condensing axis.
 *   - `useSessionContextPct(hostId, tmuxSessionName)` — the fleet-status
 *     hook PrettyView reads.
 *
 * WRITE SIDE:
 *   - Condense fires `authApi.post('/identities/<identityKey>/condense',
 *     {hostId})` — the same request the composer's Condense button makes,
 *     minus guidance (the badge has no compose field).
 *
 * Errors log structurally (`operation: 'agent_condense_failed'`) with only
 * hostId + identityKey + err.message; never the full error object.
 */

import { useCallback, useEffect, useState } from "react";

import { authApi } from "@/main-axios";
import {
  useSessionIsWorking,
  useSessionIsCondensing,
} from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { kitConfirm } from "@/components/kit";
import { MemoryGauge, condenseConfirm } from "./MemoryGauge";

/** How long the pie says Condensing… on its own before the poll confirms it. */
const OPTIMISTIC_MS = 2 * 60 * 1000;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AgentBadgeWithMeterProps {
  /** Agent's identity key (lowercased). */
  identityKey: string;
  /** Agent's Matrix mxid (from Plan 04 participants response). */
  mxid: string;
  /**
   * Agent's home host id — resolved by the parent
   * (MultiBadgeAnchor in Slice 2) via
   * `buildIdentityHostsFromFleet` at identities-store.ts L74.
   */
  hostId: number;
  /**
   * Agent's own tmux session name — the D-10 session-working-store key
   * partner AND the Wave 0 useSessionContextPct hook argument.
   */
  tmuxSessionName: string;
  /**
   * Phase 97 Finding 2: enclosing tab's tabId — drag-source pass-through to
   * inner IdentityBadge. Undefined → the inner badge is not a drag source
   * (parity with pre-Phase-97 behavior). D-18 preserved: no onClick is
   * supplied by this component; only drag-source is enabled by tabId.
   */
  tabId?: string;
  /**
   * Cross-window drag descriptor pieces (2026-09-18) — the enclosing relay
   * room's id + title. Threaded to the inner IdentityBadge as
   * dragDescriptor so a drop in a DIFFERENT same-origin Skynet window can
   * open a fresh relay-room tab for the same (roomId + roomTitle). Absent →
   * cross-window drops from this badge silent-reject.
   */
  relayRoomId?: string;
  relayRoomTitle?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentBadgeWithMeter({
  identityKey,
  mxid: _mxid,
  hostId,
  tmuxSessionName,
  tabId,
  relayRoomId,
  relayRoomTitle,
}: AgentBadgeWithMeterProps) {
  // D-10 correctness invariant — READ SIDE ───────────────────────────────────
  // Key EXACT format `${hostId}:${tmuxSessionName}` — same shape PrettyView
  // reads at PrettyView.tsx L1363. Test 2 regression gate. Inlined at each
  // call site (not extracted to a local) so the grep gate on the exact
  // template literal shape trips on any accidental reshaping.
  const _isWorking = useSessionIsWorking(`${hostId}:${tmuxSessionName}`);
  const isCondensing = useSessionIsCondensing(`${hostId}:${tmuxSessionName}`);
  // Wave 0 fleet-status hook — same source PrettyView reads post D-03
  // mechanical swap. Test 3 regression gate.
  const contextPct = useSessionContextPct(hostId, tmuxSessionName);

  // In-flight guard (prevents double-fire on rapid clicks) plus a local
  // "requested" flag so the pie reads Condensing… before the fleet-status
  // poll sees the request. Cleared when the store's condensing axis takes
  // over, or after OPTIMISTIC_MS if it never does.
  const [requestInFlight, setRequestInFlight] = useState<boolean>(false);
  const [requested, setRequested] = useState<boolean>(false);
  useEffect(() => {
    if (!requested) return;
    if (isCondensing) {
      setRequested(false);
      return;
    }
    const t = setTimeout(() => setRequested(false), OPTIMISTIC_MS);
    return () => clearTimeout(t);
  }, [requested, isCondensing]);

  const handleCondense = useCallback(async () => {
    if (requestInFlight) return;
    if (!(await kitConfirm(condenseConfirm()))) return;
    setRequestInFlight(true);
    try {
      await authApi.post(`/identities/${encodeURIComponent(identityKey)}/condense`, { hostId });
      setRequested(true);
    } catch (err: unknown) {
      // Structured warn — never JSON.stringify the raw error (PATTERNS.md § 2).
      // eslint-disable-next-line no-console
      console.warn({
        operation: "agent_condense_failed",
        hostId,
        identityKey,
        err: err instanceof Error ? err.message : "unknown",
      });
      // No auto-retry — the user presses again if they want.
    } finally {
      setRequestInFlight(false);
    }
  }, [requestInFlight, hostId, identityKey]);

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      {/* The participant pill. tabId makes it a drag SOURCE carrying the
          room tab's tabId; no onClick (D-18). */}
      <IdentityBadge
        identityKey={identityKey}
        tabId={tabId}
        dragDescriptor={
          typeof relayRoomId === "string" && relayRoomId.length > 0
            ? {
                tabType: "terminal" as const,
                sessionKind: "relay-room" as const,
                relayRoomId,
                relayRoomTitle: relayRoomTitle ?? null,
              }
            : undefined
        }
      />
      {/* Under it, the agent's memory — the composer's pie (grey / amber /
          red, tap for Condense conversation). data-appendage='true' is the
          discriminator the row-cell tests use to tell agent cells from human
          cells. */}
      <div data-appendage="true" data-role="agent-appendage" className="pv-float rounded-full">
        <MemoryGauge
          pct={contextPct}
          condensing={isCondensing || requested}
          condenseDisabled={requestInFlight}
          onCondense={() => {
            void handleCondense();
          }}
        />
      </div>
    </div>
  );
}
