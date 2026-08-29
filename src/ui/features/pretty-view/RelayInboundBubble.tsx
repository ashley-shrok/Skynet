import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { RelayInboundEvent } from "@/api/claude-session-api";
import { useIdentities } from "@/state/identities-store";
import { resolveMxidToIdentity } from "./relay-mxid-resolve";
import { detectFilePointer } from "./relay-pointer-detect";

// Phase 17 Plan 03 — RelayInboundBubble
//
// Presentational component for a relay_inbound WS frame: renders a
// left-aligned bubble tinted with the SENDER's identity colorHue in
// PrettyView when the backend detects a task-notification user turn that
// matches the recv.sh line format ([room X] [@sender] (event $Y): BODY —
// plan 17-01 detection).
//
// Coloring uses the standard pretty-view hue-tinted bubble recipe (same
// gradient/border/shadow shape as ChatMessage assistant bubbles,
// PlanPendingBubble, ImageBubble, DormancyOverlay) — but driven by the
// SENDER's resolved colorHue rather than the pane's --pv-id-hue, so each
// inbound bubble reads as "identity X speaking as themselves" instead of
// being mistakable for the pane's own agent. Multi-user chat convention:
// "not you" shows up on the left; the pane's own agent + Ashley take
// right-alignment elsewhere.
//
// RELAYBUB-02: inbound bubble left-aligned (flex justify-start wrapper).
// RELAYBUB-03: mxid resolved via useIdentities().byKey + resolveMxidToIdentity.
// RELAYBUB-06: does NOT import IdentityBadge, ChatMessage, ComposeBox (locked).
//
// File-pointer support (17-UI-SPEC § Long-inbound file-pointer support):
//   When detectFilePointer returns non-null, fetch the file via the
//   /relay-pointer endpoint (plan 17-02, mounted on main backend port 30001).
//   Success → inline fetched body below pointer-line preview.
//   Failure → pointer-line + "📄 fetch failed ({status-or-error})".
//   Never a silent drop.
//
// Security notes:
//   T-17-03-01: body rendered via {body} in JSX (NOT dangerouslySetInnerHTML).
//   T-17-03-02: POINTER_REGEX is client-side defence-in-depth; authoritative
//               gate is backend's WHITELIST_REGEX (plan 17-02). encodeURIComponent
//               prevents path traversal in the query string.
//   T-17-03-04: fetch fires once on mount (dep array [pointerPath, hostId]).
//               No retry-on-failure — failed fetch shows indicator until unmount.
//   T-17-03-05: colorHue coerced via Number() guard in inline style.
//   T-17-03-06: hostId originates from PrettyView prop (pane tab-context);
//               authoritative gate is backend's resolveHostById (plan 17-02).

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; text: string }
  | { kind: "error"; indicator: string };

/** Neutral grey fallback for unresolved mxids per UI-SPEC § Sender colorHue chain. */
const NEUTRAL_GREY = "hsl(210, 8%, 50%)";

export type RelayInboundBubbleProps = Pick<
  RelayInboundEvent,
  "room" | "sender" | "body"
> & {
  /** hostId from PrettyViewProps — drilled from the PrettyView render site. */
  hostId: number;
  /** ms-epoch timestamp of the inbound event; when present, rendered as a
   * hover `title` on the bubble so desktop users can see when the send
   * happened. Optional at the type level so existing tests that don't care
   * about the timestamp keep compiling; PrettyView always passes it. */
  ts?: number;
};

export function RelayInboundBubble({
  room,
  sender,
  body,
  ts,
  hostId,
}: RelayInboundBubbleProps) {
  const { byKey } = useIdentities();
  const { colorHue, displayName } = resolveMxidToIdentity(sender, byKey);
  const [collapsed, setCollapsed] = useState(true);

  // Avatar-dot colour: resolved identity hue or neutral grey fallback.
  // Number() coercion guards against a stray type change (T-17-03-05).
  const avatarColor =
    colorHue !== null ? `hsl(${Number(colorHue)}, 80%, 60%)` : NEUTRAL_GREY;

  // Bubble hue for V1 assistant-parity recipe. Unresolved sender → hue 210
  // (Ashley 2026-08-18: "don't really care about the fallback"); the
  // full-saturation recipe against 210 lands as a cool blue-tinted bubble,
  // visually distinct from resolved senders' hues without needing a
  // separate branch.
  const bubbleHue = colorHue !== null ? Number(colorHue) : 210;
  const bubbleStyle = {
    background: `linear-gradient(160deg, hsla(${bubbleHue},50%,38%,0.55), hsla(${bubbleHue},45%,24%,0.6))`,
    borderColor: `hsla(${bubbleHue},65%,55%,0.32)`,
    boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(255,220,170,0.18) inset, 0 0 0 0.5px hsla(${bubbleHue},70%,55%,0.2), 0 0 32px hsla(${bubbleHue},70%,52%,0.18)`,
  } as const;

  // File-pointer detection.
  const pointer = detectFilePointer(body);

  const [fetchState, setFetchState] = useState<FetchState>({ kind: "idle" });

  useEffect(() => {
    if (collapsed) return;
    if (!pointer) return;

    // T-17-03-04: fires exactly once per mount via dep array.
    setFetchState({ kind: "loading" });

    // Fetch the pointed-to file via the /relay-pointer endpoint.
    // plan 17-02: endpoint mounted on main backend (NOT /claude-session/relay-pointer).
    // credentials: "include" — project convention (message-queue-api.ts:80,100).
    // encodeURIComponent — T-17-03-02 path-traversal defence.
    fetch(`/relay-pointer?hostId=${hostId}&path=${encodeURIComponent(pointer.pointerPath)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          setFetchState({ kind: "error", indicator: `${res.status}` });
          return;
        }
        return res.text().then((text) => {
          setFetchState({ kind: "done", text });
        });
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "network error";
        setFetchState({ kind: "error", indicator: msg });
      });
  }, [pointer?.pointerPath, hostId, collapsed]);

  return (
    <div className="flex justify-start" data-testid="relay-inbound-wrap">
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        data-testid="relay-inbound-bubble"
        data-bubble-hue={bubbleHue}
        style={bubbleStyle}
        className={cn(
          // Bubble sizing + shape — mirrors ChatMessage outer div pattern.
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] px-[18px] py-[14px]",
          // Glass depth treatment (kept from phase 17 — reads distinct from
          // ChatMessage's shadow-based bubble while colour-matching it).
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          // border-width only; color comes from inline style (sender hue).
          "border",
          // Text colour — warm off-white matching ChatMessage assistant.
          "text-[#e8e4d8]",
        )}
      >
        {/* Header: avatar-dot + resolved displayName + room — collapse toggle button */}
        <button
          type="button"
          data-testid="relay-inbound-header"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand message" : "Collapse message"}
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            "flex items-center gap-1 text-xs mb-1",
            "text-[rgba(232,_228,_216,_0.6)]",
            "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
            "w-full text-left cursor-pointer bg-transparent border-0 p-0",
          )}
        >
          {/* Avatar-dot: coloured circle whose hue follows the resolved identity.
              data-testid allows tests to find the element; data-avatar-color
              carries the raw hsl()/colour string so tests can assert on the
              exact value without jsdom's rgb() normalisation. */}
          <span
            data-testid="relay-inbound-avatar-dot"
            data-avatar-color={avatarColor}
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ color: avatarColor, backgroundColor: avatarColor }}
          />
          {displayName} · {room}
          {" "}<span aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
        </button>

        {/* Body + Footer — conditionally rendered when not collapsed */}
        {!collapsed && (
          <div data-testid="relay-inbound-body">
            {/* Body — Security (T-17-03-01): always rendered as React children, never dangerouslySetInnerHTML */}
            {pointer ? (
              <>
                {/* Pointer-line preview — always shown as small header above fetched body */}
                <div className="text-[10px] text-[rgba(232,_228,_216,_0.45)] mb-1">
                  📄 {pointer.pointerLine}
                </div>
                {fetchState.kind === "loading" && (
                  <div className="text-xs text-[rgba(232,_228,_216,_0.5)] italic">
                    loading…
                  </div>
                )}
                {fetchState.kind === "done" && (
                  <div className="whitespace-pre-wrap">{fetchState.text}</div>
                )}
                {fetchState.kind === "error" && (
                  <div className="text-xs text-[rgba(220,_180,_100,_0.9)]">
                    📄 fetch failed ({fetchState.indicator})
                  </div>
                )}
              </>
            ) : (
              /* Inline body — Security (T-17-03-01): {body} is React text child */
              <div className="whitespace-pre-wrap">{body}</div>
            )}

            {/* Footer — "via recv.sh" attribution matching prototype byte-shape */}
            <div
              className={cn(
                "text-[10px] text-right mt-1",
                "text-[rgba(232,_228,_216,_0.35)]",
              )}
            >
              via recv.sh
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
