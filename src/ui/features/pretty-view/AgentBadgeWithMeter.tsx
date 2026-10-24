/**
 * Phase 93 Slice 2 Task 1 — AgentBadgeWithMeter.
 *
 * Ported byte-for-byte from Slice D's agent badge with appendage per D-10
 * (Phase 93 Slice 4 retired the source). Renames the exported function +
 * rehomes into pretty-view/ so the retirement of the standalone relay-source
 * tree doesn't orphan it.
 *
 * Renders the plain IdentityBadge (D-08 reuse — same badges as pretty view
 * / terminal mode) PLUS a shrunk meter appendage (sourced via Wave 0's
 * `useSessionContextPct` hook) PLUS a reset button (dispatches to Wave 0's
 * POST /agent-reset endpoint).
 *
 * ## D-10 correctness by construction (Pitfall 2 mitigation)
 *
 * The badge appendage subscribes to the SAME sources PrettyView reads and
 * dispatches through the SAME seam PrettyView writes to. No hidden per-agent
 * WS, no bespoke store, no parent-mediated plumbing that could drift.
 *
 * READ SIDE:
 *   - `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)` — same store,
 *     same key format as PrettyView's `sessionWorkingKey` (L1363).
 *   - `useSessionIsRecycling(\`${hostId}:${tmuxSessionName}\`)` — same store
 *     Axis E per Phase 53 Plan 03.
 *   - `useSessionContextPct(hostId, tmuxSessionName)` — Wave 0 (Plan 00)
 *     fleet-status hook; the SAME source PrettyView reads post D-03
 *     mechanical swap. Zero-drift guarantee.
 *
 * WRITE SIDE:
 *   - Reset click fires `authApi.post('/agent-reset/${hostId}/${encodeURI-
 *     Component(tmuxSessionName)}', {body: ''})` — Wave 0 (Plan 00)
 *     endpoint; the SAME endpoint PrettyView's reset button dispatches
 *     through post Wave 0 rewire.
 *
 * ## Composition (no parent callbacks)
 *
 * Reset dispatch is INTERNAL to this component — no parent-supplied
 * reset-click callback prop. The parent (MultiBadgeAnchor) does not need
 * to know or plumb the reset action. Simpler than the prior revision that
 * deferred the endpoint.
 *
 * ## Extraction discipline (D-03)
 *
 * Meter well + reset button visuals are COPIED verbatim from ComposeBox.tsx
 * L2287-2434 (with `--meter-width` overridden to a shrunk value). Does NOT
 * import from ComposeBox to preserve the D-03 no-modification invariant —
 * shrinking a copy is the only path that keeps both surfaces byte-independent.
 *
 * ## Security
 *
 * The reset endpoint carries `{body: ''}` (empty) — no textarea contents to
 * pass through since the badge appendage has no compose field. Error
 * handling logs structurally (`operation: 'agent_reset_failed'`) with only
 * hostId + tmuxSessionName + err.message; never the full error object.
 * `encodeURIComponent(tmuxSessionName)` mitigates path traversal (T-93-02-01).
 */

import { useCallback, useState } from "react";

import { authApi } from "@/main-axios";
import {
  useSessionIsWorking,
  useSessionIsRecycling,
} from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { kitConfirm } from "@/components/kit";
import { MemoryGauge } from "./MemoryGauge";

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
  const isRecycling = useSessionIsRecycling(`${hostId}:${tmuxSessionName}`);
  // Wave 0 fleet-status hook — same source PrettyView reads post D-03
  // mechanical swap. Test 3 regression gate.
  const contextPct = useSessionContextPct(hostId, tmuxSessionName);

  // Reset in-flight guard (prevents double-fire on rapid clicks). Not a ref
  // because the button's disabled attribute needs to re-render on state
  // change.
  const [resetInFlight, setResetInFlight] = useState<boolean>(false);

  // D-10 correctness invariant — WRITE SIDE ──────────────────────────────────
  // Reset click hits the SAME endpoint PrettyView's reset button dispatches
  // through post Wave 0 rewire. Test 8 regression gate.
  const handleReset = useCallback(async () => {
    if (resetInFlight) return;
    if (
      !(await kitConfirm({
        title: "Reset the agent's context window?",
        body: "It saves where it's up to, then restarts fresh.",
        confirmLabel: "Reset",
      }))
    )
      return;
    setResetInFlight(true);
    try {
      await authApi.post(
        `/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}`,
        { body: "" },
      );
    } catch (err: unknown) {
      // Structured warn — never JSON.stringify the raw error (PATTERNS.md § 2).
      // eslint-disable-next-line no-console
      console.warn({
        operation: "agent_reset_failed",
        hostId,
        tmuxSessionName,
        err: err instanceof Error ? err.message : "unknown",
      });
      // No auto-retry per Test 10 — user re-clicks if desired.
    } finally {
      setResetInFlight(false);
    }
  }, [resetInFlight, hostId, tmuxSessionName]);

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
          red, tap for Start fresh). data-appendage='true' is the discriminator
          the row-cell tests use to tell agent cells from human cells. */}
      <div data-appendage="true" data-role="agent-appendage" className="pv-float rounded-full">
        <MemoryGauge
          pct={contextPct}
          emptied={isRecycling}
          resetDisabled={resetInFlight}
          onStartFresh={() => {
            void handleReset();
          }}
        />
      </div>
    </div>
  );
}
