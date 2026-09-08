import { cn } from "@/lib/utils";
import { useIdentities } from "@/state/identities-store";
import { resolveMxidToIdentity } from "../pretty-view/relay-mxid-resolve";

// Phase 90 Plan 02 Task 3 — RelayRoomInboundBubble fork.
//
// FORK (COPY-extraction) of `src/ui/features/pretty-view/RelayInboundBubble.tsx`
// per D-12 fork clarification (Ashley 2026-09-08, verbatim during
// plan-checker review):
//
//   "in relay sessions, the collapsed nature of relay bubbles would not be
//    what we want. And there really wouldn't be a collapse feature in the
//    relay sessions because it doesn't make sense."
//
// The original RelayInboundBubble was designed for the harness-pane's
// peer-agent-chatter rendering: collapsed-by-default so the pane isn't
// dominated by inbound chatter, with a pointer-detect path for
// transcript-parsed cases where the body is a truncated recv.sh preview
// pointing at a file the frontend can fetch (Plan 17-02 /relay-pointer).
//
// The relay-room pane has different UX requirements:
//   - Expanded-always: users open a relay-session pane specifically to read
//     the conversation. Collapse would hide the content.
//   - No pointer-detect: D-11 establishes relay-room bubbles come from the
//     relay directly (not parsed transcripts), so there's no truncated
//     preview to detect and nothing to fetch.
//
// D-12 fork clarification: rather than parameterize the original with a
// second `mode` axis (which grows the harness pane's surface area and adds
// runtime branching), the fork is a COPY. Two nearly-identical files coexist
// (harness pane's collapsed-with-pointer-detect vs relay-room pane's
// expanded-always) so:
//   (a) the harness pane's peer-chatter rendering stays byte-untouched (D-03)
//   (b) the relay-room pane's simpler shape is not obscured by unused
//       machinery
//   (c) neither surface is at risk of a shared-refactor regression
//
// A future convergence slice may extract a parameterized primitive if
// visual drift becomes real. This docblock exists to warn future
// maintainers against a naive "let's dedupe" refactor attempt — the fork is
// deliberate.
//
// Security discipline (T-17-03-01 preserved from source):
//   Body rendered via `{body}` in JSX (React text child), NEVER interpreted
//   as HTML. Sender-side content from other room members is untrusted by
//   default; the React text-child render is the load-bearing XSS defense.
//
// Preserved verbatim from source:
//   - Left-alignment (`flex justify-start`).
//   - Hue-tinted bubble background from resolved sender identity.
//   - Unresolved-mxid fallback to hue 210 (Ashley 2026-08-18 "don't
//     really care about the fallback").
//   - Neutral-grey avatar-dot for unresolved senders (Sender colorHue
//     chain per UI-SPEC).
//   - Identity resolution via `useIdentities` + `resolveMxidToIdentity`
//     (imported from the pretty-view sibling — pure helper with no
//     runtime state; importing across the pretty-view boundary is safe
//     since it's a resolver, not a component).
//
// Removed entirely from source (D-12 fork clarification): see the plan file
// (`90-02-PLAN.md § Task 3`) for the exhaustive strip list. Summary: the
// fork carries NO collapse machinery, NO pointer-detect machinery, NO
// stream-attribution footer. The header is a static presentational element
// (no click behavior, no expand affordance, no toggle glyph). The body
// renders unconditionally with no truncation-preview branch. Grep gates in
// the plan enforce zero occurrences of the source's collapse + fetch
// tokens in this file (the plan lists the exact greps).

/** Neutral grey fallback for unresolved mxids per UI-SPEC § Sender colorHue chain. */
const NEUTRAL_GREY = "hsl(210, 8%, 50%)";

export interface RelayRoomInboundBubbleProps {
  /** Room title or room ID — rendered in the header next to the sender name. */
  room: string;
  /** Matrix user ID of the sender (e.g. `@tina:matrix.example.com`). */
  sender: string;
  /** Message body. Rendered as a React text child (T-17-03-01). */
  body: string;
  /**
   * Optional ms-epoch timestamp. When present, rendered as a hover `title`
   * on the bubble so desktop users can see when the message arrived.
   */
  ts?: number;
}

export function RelayRoomInboundBubble({
  room,
  sender,
  body,
  ts,
}: RelayRoomInboundBubbleProps) {
  const { byKey } = useIdentities();
  const { colorHue, displayName } = resolveMxidToIdentity(sender, byKey);

  // Avatar-dot colour: resolved identity hue or neutral grey fallback.
  // Number() coercion guards against a stray type change (T-17-03-05 preserved).
  const avatarColor =
    colorHue !== null ? `hsl(${Number(colorHue)}, 80%, 60%)` : NEUTRAL_GREY;

  // Bubble hue: resolved sender hue, or fallback to 210 (Ashley 2026-08-18:
  // "don't really care about the fallback"; the full-saturation recipe
  // against 210 lands as a cool blue-tinted bubble, visually distinct from
  // resolved senders' hues without needing a separate branch).
  const bubbleHue = colorHue !== null ? Number(colorHue) : 210;
  const bubbleStyle = {
    background: `linear-gradient(160deg, hsla(${bubbleHue},50%,38%,0.55), hsla(${bubbleHue},45%,24%,0.6))`,
    borderColor: `hsla(${bubbleHue},65%,55%,0.32)`,
    boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(255,220,170,0.18) inset, 0 0 0 0.5px hsla(${bubbleHue},70%,55%,0.2), 0 0 32px hsla(${bubbleHue},70%,52%,0.18)`,
  } as const;

  return (
    <div className="flex justify-start" data-testid="relay-room-inbound-wrap">
      <div
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        data-testid="relay-room-inbound-bubble"
        data-bubble-hue={bubbleHue}
        style={bubbleStyle}
        className={cn(
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          // Expanded-always padding — no collapsed/expanded ternary
          // (D-12 fork clarification: no collapse state).
          "px-[18px] py-[14px]",
          "backdrop-blur-xl saturate-150",
          "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "border",
          "text-[#e8e4d8]",
        )}
      >
        {/* Header: static <div> (NOT <button>) carrying avatar-dot +
            displayName + room. Preserves the visual language of the source's
            collapse-toggle header (avatar dot + name + room) but with no
            click behavior, no expand-state ARIA attributes, no toggle glyph. */}
        <div
          data-testid="relay-room-inbound-header"
          className={cn(
            "flex items-center gap-1 text-xs mb-1",
            "text-[rgba(232,_228,_216,_0.6)]",
            "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
          )}
        >
          {/* Avatar-dot: coloured circle whose hue follows the resolved
              identity. data-testid allows tests to find the element;
              data-avatar-color carries the raw hsl()/colour string so tests
              can assert on the exact value without jsdom's rgb()
              normalisation. */}
          <span
            data-testid="relay-room-inbound-avatar-dot"
            data-avatar-color={avatarColor}
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ color: avatarColor, backgroundColor: avatarColor }}
          />
          {displayName} · {room}
        </div>

        {/* Body — rendered UNCONDITIONALLY (no collapse gate). No
            file-pointer parsing, no fetch, no 📄 icon, no stream-source
            footer. Security (T-17-03-01): body is a React text child. */}
        <div data-testid="relay-room-inbound-body">
          <div className="whitespace-pre-wrap">{body}</div>
        </div>
      </div>
    </div>
  );
}
