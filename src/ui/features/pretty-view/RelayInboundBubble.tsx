import React, { useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RelayInboundEvent } from "@/api/claude-session-api";
import { useIdentities } from "@/state/identities-store";
import { resolveMxidToIdentity } from "./relay-mxid-resolve";
import { detectFilePointer } from "./relay-pointer-detect";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import {
  getCurrentPlayer,
  setCurrentPlayer,
  getCurrentOwner,
  setCurrentOwner,
  clearCurrentPlayer,
} from "./speak-singleton";

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
// ImageBubble, DormancyOverlay) — but driven by the
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
//
// Phase 97 UAT batch #6 (2026-09-10) — chat-native strip for relay-source:
//   When `alwaysExpanded={true}` (PrettyView source.kind === "relay" — user
//   chatting IN a matrix room via Skynet, not the task-notification harness):
//     - Header strips the ` · <room>` suffix — the room is already the pane
//       context, no need to repeat.
//     - Header brightens from rgba(232,228,216,0.6) → #e8e4d8 (matches body
//       text color) so the sender name reads as chat-scale prominence.
//     - Footer "via recv.sh" is dropped — implicit for the whole pane.
//     - Bubble padding widens right side to `pr-[42px]` reserving space for
//       the speak button (mirroring ChatMessage assistant's gutter).
//     - Speak button (Volume2/Loader2/Pause/Play) renders bottom-right,
//       long-press-on-bubble arms autoplay via onLongPressSpeak(eventId).
//     - Speak singleton is shared with ChatMessage via ./speak-singleton.ts,
//       so tapping speak on either component preempts the other.
//   The `alwaysExpanded=false` (harness) branch is BYTE-FOR-BYTE UNCHANGED.

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
  /** Phase 97 UAT follow-up (2026-09-10): in relay-source PrettyView
   * (`source.kind === "relay"` — chatting IN a matrix room via Skynet),
   * bubbles render fully un-collapsed AND non-collapsible. In harness
   * PrettyView (task-notification-triggered relay bubbles), the default
   * collapsed-with-toggle behavior is preserved. When true, initial
   * state starts expanded and the header renders as a plain non-clickable
   * <div> (no toggle chevron). */
  alwaysExpanded?: boolean;
  /** Phase 97 UAT batch #6 (2026-09-10): matrix event id — used as the
   * autoplay-target discriminator and as the argument to `onLongPressSpeak`
   * when long-press arms autoplay. Only meaningful when
   * `alwaysExpanded={true}` (relay-source view). */
  eventId?: string;
  /** Phase 97 UAT batch #6 (2026-09-10): mirrors ChatMessage — when true, the
   * speak button gets the identity-hue tint (visual hint that a long-press
   * has armed autoplay for arriving messages). */
  autoplayArmed?: boolean;
  /** Phase 97 UAT batch #6 (2026-09-10): mirrors ChatMessage — when this
   * bubble's `eventId` matches, autoplay fires. */
  autoplayTargetEventId?: string | null;
  /** Phase 97 UAT batch #6 (2026-09-10): mirrors ChatMessage — long-press
   * arms autoplay in the PrettyView parent. Called with the bubble's
   * eventId on long-press fire. */
  onLongPressSpeak?: (eventId: string) => void;
};

export function RelayInboundBubble({
  room,
  sender,
  body,
  ts,
  hostId,
  alwaysExpanded = false,
  eventId,
  autoplayArmed = false,
  autoplayTargetEventId = null,
  onLongPressSpeak,
}: RelayInboundBubbleProps) {
  const { byKey } = useIdentities();
  const { colorHue, displayName, identity } = resolveMxidToIdentity(sender, byKey);
  const identityVoice: string | undefined = identity?.voice ?? undefined;
  const [collapsed, setCollapsed] = useState(!alwaysExpanded);

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

  // ─── Speak apparatus — mirror of ChatMessage's, gated on alwaysExpanded ───
  //
  // Phase 97 UAT batch #6 (2026-09-10). The refs/state are declared
  // unconditionally (Rules of Hooks); the render-side gating on
  // `alwaysExpanded` ensures the button + bubble-root pointer handlers only
  // wire up in relay-source view. In harness view the state machine sits
  // dormant — no interaction paths reach it.
  const bubbleIdRef = useRef(Symbol("relay-speak-bubble"));
  const [speakState, setSpeakState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  // Long-press detection refs
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef<boolean>(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Autoplay dedup ref — stores the last eventId we already fired autoplay for,
  // preventing double-fire if React re-renders while the effect is settling.
  const autoplayLastFiredRef = useRef<string | null>(null);

  // Cleanup: stop player on unmount if this bubble owns it; also clear any
  // pending long-press timer.
  useEffect(() => {
    return () => {
      if (getCurrentOwner() === bubbleIdRef.current) {
        const owner = bubbleIdRef.current;
        console.info(`[tts] stop-current owner=relay:${owner.toString()} trigger=unmount`);
        getCurrentPlayer()?.stop();
        clearCurrentPlayer();
      }
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  // startSpeak: extracted fresh-play path (cross-bubble preempt + loading +
  // fetch + play). Called by:
  //   - onSpeakClick (fresh-play branch)
  //   - long-press handler (single-gesture-single-action)
  //   - autoplay effect (newly-arrived relay-inbound message while armed)
  async function startSpeak(trigger: "user-click" | "autoplay" | "long-press" = "user-click") {
    // If another bubble is playing (or loading, or paused), stop it first
    // (cross-bubble preempt). This is also the only cancel-from-paused path.
    const preemptTarget = getCurrentPlayer();
    if (preemptTarget) {
      const prevOwner = getCurrentOwner();
      console.info(`[tts] stop-current owner=${prevOwner?.toString() ?? "null"} trigger=new-bubble`);
      preemptTarget.stop();
      clearCurrentPlayer();
    }

    setSpeakState("loading");
    const owner = bubbleIdRef.current;

    // Speak-start — read `body` directly, NOT containerRef.innerText. The
    // bubble container wraps both header (dot + displayName) AND body, so
    // innerText would include the sender name and TTS would speak
    // "Tina hello world" instead of "hello world" in a real browser. JSDOM
    // does not implement innerText so tests hit the fallback and never
    // surfaced this. Body is plain matrix message text — the correct source.
    const text = body;
    console.info(`[tts] speak-start owner=relay:${owner.toString()} textLen=${text.length} voice="${identityVoice ?? "default"}" trigger=${trigger}`);

    const player = createWebAudioStreamPlayer({
      onEnded: () => {
        // Only clear if this bubble still owns the singleton — guard against
        // a race where a NEW speak-click already replaced the singleton.
        if (getCurrentOwner() === owner) {
          console.info(`[tts] media-ended owner=relay:${owner.toString()}`);
          clearCurrentPlayer();
          setSpeakState("idle");
        }
      },
      onError: (err) => {
        const errName = err instanceof Error ? err.name : "unknown";
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`[tts] player-error owner=relay:${owner.toString()} errName="${errName}" errMessage="${errMessage}"`);
        if (getCurrentOwner() === owner) {
          clearCurrentPlayer();
          setSpeakState("idle");
        }
      },
      onPlaying: () => {
        console.info(`[tts] media-playing owner=relay:${owner.toString()}`);
      },
      onCanPlay: () => {
        console.info(`[tts] media-canplay owner=relay:${owner.toString()}`);
      },
      onPause: () => {
        console.info(`[tts] media-pause owner=relay:${owner.toString()}`);
      },
      onStalled: () => {
        console.warn(`[tts] media-stalled owner=relay:${owner.toString()}`);
      },
      onSuspend: () => {
        console.warn(`[tts] media-suspend owner=relay:${owner.toString()}`);
      },
    });

    // Install the singleton BEFORE the fetch so a same-tick preempt from
    // another bubble sees a non-null currentPlayer and can stop us cleanly.
    setCurrentPlayer(player);
    setCurrentOwner(owner);

    try {
      console.info(`[tts] fetch-start owner=relay:${owner.toString()} url=/voice/speak-stream textLen=${text.length}`);
      const response = await postSpeakStream(text, identityVoice ?? undefined);
      if (getCurrentOwner() !== owner) {
        console.warn(`[tts] preempt-during-fetch owner=relay:${owner.toString()} newOwner=${getCurrentOwner()?.toString() ?? "null"}`);
        return;
      }
      console.info(`[tts] fetch-resolved status=${response.status} ok=${response.ok} owner=relay:${owner.toString()}`);
      if (!response.ok) {
        console.error(`[tts] fetch-error owner=relay:${owner.toString()} status=${response.status} statusText="${response.statusText}"`);
        throw new Error(`postSpeakStream returned ${response.status}`);
      }
      setSpeakState("playing");
      console.info(`[tts] decode-init owner=relay:${owner.toString()} contextState=n/a`);
      console.info(`[tts] play-attempt owner=relay:${owner.toString()} src=stream`);
      void player.play(response).then(() => {
        console.info(`[tts] play-attempt owner=relay:${owner.toString()} result=success`);
      }).catch((err: unknown) => {
        const errName =
          err instanceof Error
            ? err.name
            : (err != null && typeof (err as Record<string, unknown>).name === "string"
                ? (err as { name: string }).name
                : "unknown");
        const errMessage =
          err instanceof Error
            ? err.message
            : (err != null && typeof (err as Record<string, unknown>).message === "string"
                ? (err as { message: string }).message
                : String(err));
        if (errName === "NotAllowedError") {
          console.warn(`[tts] play-attempt owner=relay:${owner.toString()} result=blocked errName="NotAllowedError" errMessage="${errMessage}"`);
        } else {
          console.error(`[tts] play-attempt owner=relay:${owner.toString()} result=error errName="${errName}" errMessage="${errMessage}"`);
        }
      });
    } catch (err) {
      const errName = err instanceof Error ? err.name : "unknown";
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[tts] fetch-error owner=relay:${owner.toString()} errName="${errName}" errMessage="${errMessage}"`);
      if (getCurrentOwner() === owner) {
        clearCurrentPlayer();
        setSpeakState("idle");
      }
    }
  }

  async function onSpeakClick(e: React.MouseEvent) {
    e.stopPropagation();

    if (speakState === "playing" && getCurrentOwner() === bubbleIdRef.current) {
      void getCurrentPlayer()?.pause();
      setSpeakState("paused");
      return;
    }

    if (speakState === "paused" && getCurrentOwner() === bubbleIdRef.current) {
      void getCurrentPlayer()?.resume();
      setSpeakState("playing");
      return;
    }

    void startSpeak("user-click");
  }

  // Autoplay effect: fires startSpeak() when a new target arrives that matches
  // this bubble's eventId. Uses autoplayLastFiredRef to prevent double-fire on
  // re-renders while the effect is settling. Only fires in relay-source view
  // (alwaysExpanded=true) — harness view has no speak apparatus.
  useEffect(() => {
    if (
      alwaysExpanded &&
      autoplayTargetEventId != null &&
      eventId != null &&
      autoplayTargetEventId === eventId &&
      autoplayLastFiredRef.current !== eventId
    ) {
      autoplayLastFiredRef.current = eventId;
      console.info(`[tts] autoplay-fired eventId=${eventId} armed=${autoplayTargetEventId != null} owner=relay`);
      void startSpeak("autoplay");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayTargetEventId, eventId, alwaysExpanded]);

  return (
    <div className="flex justify-start" data-testid="relay-inbound-wrap">
      <div
        ref={containerRef}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        data-testid="relay-inbound-bubble"
        data-bubble-hue={bubbleHue}
        // position: relative only in relay-source view — required for the
        // absolutely-positioned speak button anchor. Harness view keeps its
        // original static positioning so its rendering stays byte-for-byte
        // unchanged.
        style={alwaysExpanded ? { ...bubbleStyle, position: "relative" } : bubbleStyle}
        // Long-press-on-bubble handlers — only meaningful in relay-source
        // view (`alwaysExpanded=true`). Short-circuit early in the pointerDown
        // handler if the pointer target is inside the speak button so the
        // button's own long-press handlers stay the single source of truth
        // for button-anchored long-press.
        onPointerDown={
          alwaysExpanded
            ? (e) => {
                if ((e.target as HTMLElement)?.closest(".pv-speak-btn")) return;
                longPressFiredRef.current = false;
                pointerStartRef.current = { x: e.clientX, y: e.clientY };
                if (longPressTimerRef.current != null) {
                  window.clearTimeout(longPressTimerRef.current);
                }
                longPressTimerRef.current = window.setTimeout(() => {
                  longPressFiredRef.current = true;
                  longPressTimerRef.current = null;
                  if (onLongPressSpeak && eventId) onLongPressSpeak(eventId);
                  void startSpeak("long-press");
                }, 500);
              }
            : undefined
        }
        onPointerMove={
          alwaysExpanded
            ? (e) => {
                const start = pointerStartRef.current;
                if (!start || longPressTimerRef.current == null) return;
                const dx = e.clientX - start.x;
                const dy = e.clientY - start.y;
                if (Math.hypot(dx, dy) > 10) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              }
            : undefined
        }
        onPointerCancel={
          alwaysExpanded
            ? () => {
                if (longPressTimerRef.current != null) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              }
            : undefined
        }
        onPointerUp={
          alwaysExpanded
            ? () => {
                if (longPressTimerRef.current != null) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              }
            : undefined
        }
        className={cn(
          // Bubble sizing + shape — mirrors ChatMessage outer div pattern.
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)]",
          // Padding — Phase 97 UAT batch #6: relay-source view widens right
          // padding to reserve the speak-button gutter (mirroring
          // ChatMessage assistant's pr-[42px]); harness view keeps its
          // pre-existing collapsed-vs-expanded pad split byte-for-byte.
          alwaysExpanded
            ? "pl-[18px] pr-[42px] py-[14px]"
            : collapsed
              ? "px-[12px] py-[7px]"
              : "px-[18px] py-[14px]",
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
        {/* Header: avatar-dot + resolved displayName + room (harness) or
            avatar-dot + displayName only (relay-source, Phase 97 UAT batch #6).
            In default (harness) mode renders as a toggle button; when
            alwaysExpanded (relay-source view) renders as a plain non-clickable
            <div> with no chevron. */}
        {alwaysExpanded ? (
          <div
            data-testid="relay-inbound-header"
            className={cn(
              "flex items-center gap-1 text-xs mb-1",
              // Phase 97 UAT batch #6: brighten header to match body text.
              // The 60%-alpha treatment reads as "meta" (recv.sh tell); in
              // relay-source view the header IS the primary "who's talking"
              // affordance, so it earns full body-text prominence.
              "text-[#e8e4d8]",
              "font-[JetBrains_Mono_Variable,ui-monospace,monospace]",
            )}
          >
            <span
              data-testid="relay-inbound-avatar-dot"
              data-avatar-color={avatarColor}
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ color: avatarColor, backgroundColor: avatarColor }}
            />
            {/* Phase 97 UAT batch #6: room stripped — the room IS the pane
                context in relay-source view; no need to repeat. */}
            {displayName}
          </div>
        ) : (
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
        )}

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

            {/* Footer — "via recv.sh" attribution. Phase 97 UAT batch #6
                (2026-09-10): rendered ONLY in harness view; relay-source
                view drops the footer because the pane context already
                communicates the mechanism. */}
            {!alwaysExpanded && (
              <div
                className={cn(
                  "text-[10px] text-right mt-1",
                  "text-[rgba(232,_228,_216,_0.35)]",
                )}
              >
                via recv.sh
              </div>
            )}
          </div>
        )}

        {/* Speak button — Phase 97 UAT batch #6 (2026-09-10). Rendered only
            when alwaysExpanded=true (relay-source view). Copy-verbatim from
            ChatMessage's assistant speak button apparatus, wired against the
            same singleton so cross-component preempt works. */}
        {alwaysExpanded && (
          <button
            type="button"
            onPointerDown={(e) => {
              longPressFiredRef.current = false;
              pointerStartRef.current = { x: e.clientX, y: e.clientY };
              if (longPressTimerRef.current != null) {
                window.clearTimeout(longPressTimerRef.current);
              }
              longPressTimerRef.current = window.setTimeout(() => {
                longPressFiredRef.current = true;
                longPressTimerRef.current = null;
                if (eventId && onLongPressSpeak) onLongPressSpeak(eventId);
                void startSpeak("long-press");
              }, 500);
            }}
            onPointerMove={(e) => {
              const start = pointerStartRef.current;
              if (!start || longPressTimerRef.current == null) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.hypot(dx, dy) > 10) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onPointerCancel={() => {
              if (longPressTimerRef.current != null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onPointerUp={() => {
              // Clear the pending timer if it hasn't fired yet — this is a tap.
              // Do NOT clear longPressFiredRef here — the subsequent onClick
              // needs to read it.
              if (longPressTimerRef.current != null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            onClick={(e) => {
              // Suppress the tap-driven click if a long-press already fired.
              if (longPressFiredRef.current) {
                longPressFiredRef.current = false;
                e.stopPropagation();
                return;
              }
              void onSpeakClick(e);
            }}
            aria-label={
              speakState === "playing"
                ? "Pause speaking"
                : speakState === "paused"
                  ? "Resume speaking"
                  : "Speak message"
            }
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: autoplayArmed
                ? "hsla(var(--pv-id-hue),60%,70%,0.28)"
                : "rgba(0,0,0,0.28)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: autoplayArmed
                ? "hsla(var(--pv-id-hue),70%,70%,0.35)"
                : "rgba(255,255,255,0.10)",
              color: "rgba(255,220,170,0.72)",
              opacity: 0.62,
              cursor: "pointer",
              transition: "opacity 120ms, background 120ms, transform 80ms",
            }}
            className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"
          >
            {speakState === "loading" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : speakState === "playing" ? (
              <Pause size={16} />
            ) : speakState === "paused" ? (
              <Play size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
