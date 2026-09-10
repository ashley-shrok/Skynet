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

import { useCallback, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";

import { authApi } from "@/main-axios";
import {
  useSessionIsWorking,
  useSessionIsRecycling,
} from "@/state/session-working-store";
import { useSessionContextPct } from "@/api/fleet-status-client";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { cn } from "@/lib/utils";

// ─── Constants (VERBATIM shrink from ComposeBox.tsx L136-2337) ───────────────

/** ComposeBox L136 — kept identical for visual parity. */
const SEG_COUNT = 12;

/** Shrunk from pane-wide 12rem to 6rem per PATTERNS.md § meter well. */
const METER_WIDTH_SHRUNK = "6rem";

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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentBadgeWithMeter({
  identityKey,
  mxid: _mxid,
  hostId,
  tmuxSessionName,
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

  // Band computation VERBATIM from ComposeBox.tsx L2403-2410. NEVER
  // re-thresholded — visual parity across surfaces relies on identical bands.
  const band: "red" | "amber" | "green" =
    contextPct == null
      ? "green"
      : contextPct >= 78
        ? "red"
        : contextPct >= 45
          ? "amber"
          : "green";

  // litCount VERBATIM from ComposeBox.tsx L1207-1208.
  const litCount =
    contextPct != null ? Math.round((contextPct / 100) * SEG_COUNT) : 0;

  // Colour constants VERBATIM from ComposeBox.tsx L2411-2427.
  const litGreenBg =
    "linear-gradient(90deg, hsla(155,45%,52%,1), hsla(155,45%,42%,1))";
  const litAmberBg =
    "linear-gradient(90deg, hsla(38,75%,55%,1), hsla(38,75%,45%,1))";
  const litRedBg =
    "linear-gradient(90deg, hsla(0,72%,55%,1), hsla(0,72%,42%,1))";
  const litGreenShadow =
    "0 0 5px hsla(155,45%,45%,0.5), inset 0 0 2px rgba(220,255,235,0.45)";
  const litAmberShadow =
    "0 0 5px hsla(38,75%,55%,0.55), inset 0 0 2px rgba(255,240,200,0.5)";
  const litRedShadow =
    "0 0 6px hsla(0,72%,55%,0.7), inset 0 0 2px rgba(255,220,200,0.5)";
  const dimNeutralBg = "hsla(0,0%,100%,0.06)";

  // Recycling gates all segments to unlit (mirrors ComposeBox `isHolding`
  // logic at L2428-2439 — "powered but empty" during a recycle).
  const isDrainingLike = isRecycling;

  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* IdentityBadge — D-08 reuse, plain badge (no modification to the
          primitive, matches HumanBadgeCell approach from Plan 05). */}
      <IdentityBadge identityKey={identityKey} />
      {/* Phase 97 Finding 5: drawer wrapper — Variant A "simple slotted"
          per meter-tasting.html L164-177. margin-top: -8px tucks the drawer's
          top edge behind the pill's bottom; padding-top: 10px keeps the meter
          body away from the tucked edge; z-index: 1 sits behind the pill's
          implicit stacking so the pill's drop-shadow lands on the drawer.
          The former `mt-1` (4px spacer) on the appendage is REMOVED — its
          role is replaced by the drawer's -mt-2 + pt-[10px] geometry. */}
      <div
        data-drawer="true"
        className="relative -mt-2 pt-[10px]"
        style={{ zIndex: 1 }}
      >
        {/* Appendage container — data-appendage='true' is the D-09 discriminator
            the row-cell tests use to tell agent cells from human cells. */}
        <div
          data-appendage="true"
          data-role="agent-appendage"
          className="flex flex-row items-stretch gap-0"
        >
          {/* Meter well — VERBATIM shrink of ComposeBox.tsx L2335-2482.
              --meter-width overridden to 6rem per PATTERNS.md recommendation.
              SEG_COUNT stays at 12 for visual parity.
              Phase 97 Finding 5: corner + border tokens adjusted for the
              drawer look — `rounded-md` replaced by `rounded-b-md` (bottom
              corners only), `border-t-0` added (no top border — tuck edge
              is invisible). */}
          <div
            className={cn(
              "self-stretch rounded-b-md flex flex-row p-[2px]",
              "bg-[rgba(10,12,20,0.6)] border border-t-0 border-[rgba(220,225,245,0.1)]",
              "shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]",
            )}
            style={
              {
                "--seg-count": SEG_COUNT,
                "--meter-width": METER_WIDTH_SHRUNK,
                width: "var(--meter-width)",
                height: "18px",
              } as CSSProperties
            }
            role="meter"
            aria-label="Context window"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={contextPct ?? undefined}
            title={
              contextPct != null
                ? `Context ${contextPct}%`
                : "Context (unknown)"
            }
          >
            {/* Reset button — VERBATIM shrink of ComposeBox.tsx L2353-2382,
                with disable gate simplified (no aside/recycle awareness —
                the relay pane has no compose textarea). */}
            <button
              type="button"
              onClick={handleReset}
              disabled={resetInFlight}
              aria-label="Reset context window"
              title="Reset context window"
              className={cn(
                "h-full w-4 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer",
                "transition-[background,box-shadow,color] duration-[180ms]",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                "bg-[hsla(155,35%,20%,0.5)]",
                "shadow-[inset_0_0_3px_rgba(0,0,0,0.4)]",
                "text-[rgba(220,255,235,0.55)]",
                !isDrainingLike &&
                  "hover:bg-[linear-gradient(90deg,hsla(155,45%,52%,1),hsla(155,45%,42%,1))]",
                !isDrainingLike &&
                  "hover:shadow-[0_0_8px_hsla(155,45%,45%,0.6),_inset_0_0_3px_rgba(220,255,235,0.4)]",
                !isDrainingLike && "hover:text-[#f0f8f4]",
              )}
            >
              <RotateCcw className="size-3" />
            </button>
            <div className="w-px mx-[2px] h-full bg-[rgba(220,225,245,0.09)] shadow-[0_1px_0_rgba(0,0,0,0.55)]" />
            {/* Segment strip — VERBATIM shrink of ComposeBox.tsx L2400-2482. */}
            <div className="flex flex-row gap-[1px] min-w-[50px] flex-1 h-full">
              {Array.from({ length: SEG_COUNT }, (_, i) => {
                // Recycling gate → every segment unlit (isHolding analog).
                const isLit =
                  typeof contextPct === "number" &&
                  i < litCount &&
                  !isDrainingLike;
                let background: string;
                let boxShadow: string;
                if (isLit) {
                  background =
                    band === "red"
                      ? litRedBg
                      : band === "amber"
                        ? litAmberBg
                        : litGreenBg;
                  boxShadow =
                    band === "red"
                      ? litRedShadow
                      : band === "amber"
                        ? litAmberShadow
                        : litGreenShadow;
                } else {
                  background = dimNeutralBg;
                  boxShadow = "none";
                }
                return (
                  <div
                    key={i}
                    data-seg
                    data-lit={isLit ? "true" : "false"}
                    data-band={isLit ? band : "neutral"}
                    className="rounded-[1.5px] transition-[background,box-shadow] duration-[220ms] ease-out"
                    style={{
                      // Same explicit-calc-per-segment idiom as
                      // ComposeBox.tsx L2472 (scaled to the shrunk 1px gap).
                      width: `calc((100% - ${(SEG_COUNT - 1) * 1}px) / ${SEG_COUNT})`,
                      height: "100%",
                      flex: "0 0 auto",
                      transitionDelay: `${(SEG_COUNT - 1 - i) * 35}ms`,
                      background,
                      boxShadow,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
