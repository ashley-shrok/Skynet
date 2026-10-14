import React, { useState } from "react";
import { Volume2, Loader2, Pause, Play, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RelayAddressing, RelayParty } from "./relay-addressing";
import type { SpeakState } from "./useSpeakPlayback";

// Shared chrome for the two relay bubbles (RelayInboundBubble /
// RelayOutboundBubble). Two shapes:
//
//   RelayDmCard    — an agent's own conversation: a quiet folded card,
//                    "Aster → Tina [DM]" plus a one-line preview; tap to open.
//   RelayChatBubble — a relay room the user opened themselves: the room IS
//                    the pane, so just the sender's name and the text.
//
// Everything user-facing reads as plain language: no room ids, shell
// variables, file paths or transport names.

/** Unresolved senders land on a cool blue so they still read as "someone". */
export const FALLBACK_HUE = 210;

export function RelaySpeakButton({
  speakState,
  onClick,
}: {
  speakState: SpeakState;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        background: "rgba(0,0,0,0.28)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "rgba(255,255,255,0.10)",
        color: "rgba(255,220,170,0.72)",
        opacity: 0.62,
        cursor: "pointer",
        transition: "opacity 120ms, background 120ms, transform 80ms",
      }}
      className={`pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]`}
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
  );
}

function initialOf(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : "?";
}

function RelayAvatar({ name, hue }: { name: string; hue: number }) {
  return (
    <span
      aria-hidden="true"
      data-testid="relay-avatar"
      className="grid place-items-center w-[26px] h-[26px] rounded-full text-[12px] font-semibold text-white flex-shrink-0 shadow-[0_0_0_2px_rgba(0,0,0,0.25)]"
      style={{
        background: `linear-gradient(150deg, hsl(${hue},65%,55%), hsl(${hue},60%,38%))`,
      }}
    >
      {initialOf(name)}
    </span>
  );
}

/**
 * ⓘ beside the DM tag — teaches the vocabulary the first time a user meets
 * a DM. Hover on desktop, tap on touch. Lives inside the card's clickable
 * header, so it swallows its own clicks.
 */
function DmExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What's a DM?"
        aria-expanded={open}
        data-testid="relay-dm-explainer"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="grid place-items-center w-[15px] h-[15px] rounded-full border border-[rgba(232,228,216,0.3)] text-[10px] leading-none text-[rgba(232,228,216,0.5)] bg-transparent p-0 cursor-help"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-[calc(100%+8px)] z-20 w-[260px] px-3 py-2.5 rounded-[10px] text-[12.5px] leading-[1.5] font-normal whitespace-normal text-left text-[#e8e4d8] bg-[#1d2130] border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        >
          <b className="font-semibold">Agents can DM each other.</b> When one
          agent needs something from another, it sends a direct message. You
          can follow along here, and these stay folded so they don't get in
          your way.
          <br />
          <br />
          When an agent DMs <i>you</i>, you get a notification on your phone.
        </span>
      )}
    </span>
  );
}

function PartyName({ party }: { party: RelayParty }) {
  return <b className="font-semibold text-[#e8e4d8]">{party.name}</b>;
}

/** "Aster → Tina [DM] ⓘ" / "Aster → group with Tina, Pixel" / "Aster sent a DM". */
function WhoLine({
  sender,
  addressing,
}: {
  sender: RelayParty;
  addressing: RelayAddressing;
}) {
  const arrow = <span aria-hidden="true" className="text-[12px] text-[rgba(232,228,216,0.42)]">→</span>;
  const dmTag = (
    <span className="text-[10.5px] font-semibold tracking-[0.04em] px-1.5 rounded-full border text-[hsl(var(--relay-h),80%,82%)] bg-[hsla(var(--relay-h),60%,50%,0.18)] border-[hsla(var(--relay-h),60%,60%,0.25)]">
      DM
    </span>
  );
  return (
    <span
      data-testid="relay-who-line"
      className="flex items-center gap-1.5 text-[13px] text-[rgba(232,228,216,0.62)] whitespace-nowrap min-w-0"
    >
      <PartyName party={sender} />
      {addressing.kind === "dm" ? (
        <>
          {arrow}
          <PartyName party={addressing.to} />
          {dmTag}
          <DmExplainer />
          {addressing.to.you && (
            <span className="text-[12px] text-[rgba(232,228,216,0.42)]">🔔 notified</span>
          )}
        </>
      ) : addressing.kind === "group" ? (
        <>
          {arrow}
          <span className="truncate">
            group with{" "}
            {addressing.to.map((p, i) => (
              <React.Fragment key={`${p.name}-${i}`}>
                {i > 0 && ", "}
                <PartyName party={p} />
              </React.Fragment>
            ))}
          </span>
        </>
      ) : (
        <>
          <span>sent a</span>
          {dmTag}
          <DmExplainer />
        </>
      )}
    </span>
  );
}

export interface RelayDmCardProps {
  /** testid prefix — "relay-inbound" | "relay-outbound". */
  testIdPrefix: string;
  sender: RelayParty;
  addressing: RelayAddressing;
  /** Folded one-liner; empty hides the preview row. */
  preview: string;
  /** Exact timestamp as a hover title (not shown inline). */
  ts?: number;
  open: boolean;
  onToggle: () => void;
  /** Opened content — rendered only while open. */
  children: React.ReactNode;
  speak?: { speakState: SpeakState; onClick: (e: React.MouseEvent) => void } | null;
}

export function RelayDmCard({
  testIdPrefix,
  sender,
  addressing,
  preview,
  ts,
  open,
  onToggle,
  children,
  speak,
}: RelayDmCardProps) {
  const hue = sender.hue ?? FALLBACK_HUE;
  return (
    <div className="flex justify-start" data-testid={`${testIdPrefix}-wrap`}>
      <div
        data-testid={`${testIdPrefix}-bubble`}
        data-bubble-hue={hue}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={{
          ["--relay-h" as string]: String(Number(hue)),
          background: `linear-gradient(160deg, hsla(${hue},30%,22%,0.55), hsla(${hue},25%,14%,0.55))`,
          borderColor: `hsla(${hue},40%,60%,0.16)`,
          boxShadow: `inset 3px 0 0 hsla(${hue},70%,62%,0.85), 0 6px 18px rgba(0,0,0,0.35)`,
        }}
        className={cn(
          "w-[min(85%,560px)] rounded-[12px] border text-[#e8e4d8]",
          "backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)]",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          data-testid={`${testIdPrefix}-header`}
          aria-expanded={open}
          aria-label={open ? "Collapse message" : "Expand message"}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5",
            "pl-3.5 pr-3 py-[9px] cursor-pointer rounded-[12px]",
            "hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[hsla(var(--relay-h),70%,65%,0.7)]",
          )}
        >
          <RelayAvatar name={sender.name} hue={hue} />
          <span className="min-w-0 block">
            <WhoLine sender={sender} addressing={addressing} />
            {!open && preview && (
              <span
                data-testid={`${testIdPrefix}-preview`}
                className="block text-[13px] text-[rgba(232,228,216,0.42)] whitespace-nowrap overflow-hidden text-ellipsis mt-px"
              >
                {preview}
              </span>
            )}
          </span>
          <ChevronRight
            aria-hidden="true"
            size={15}
            className={cn(
              "text-[rgba(232,228,216,0.42)] transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </div>
        {open && (
          <div
            data-testid={`${testIdPrefix}-body`}
            className="relative pl-3.5 pr-11 pb-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {children}
            {speak && <RelaySpeakButton speakState={speak.speakState} onClick={speak.onClick} />}
          </div>
        )}
      </div>
    </div>
  );
}

export interface RelayChatBubbleProps {
  testIdPrefix: string;
  sender: RelayParty;
  ts?: number;
  children: React.ReactNode;
  speak?: { speakState: SpeakState; onClick: (e: React.MouseEvent) => void } | null;
}

/** Relay-room view: the pane is the conversation, so the bubble is just chat. */
export function RelayChatBubble({ testIdPrefix, sender, ts, children, speak }: RelayChatBubbleProps) {
  const hue = sender.hue ?? FALLBACK_HUE;
  return (
    <div className="flex justify-start" data-testid={`${testIdPrefix}-wrap`}>
      <div
        data-testid={`${testIdPrefix}-bubble`}
        data-bubble-hue={hue}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        style={{
          position: "relative",
          background: `linear-gradient(160deg, hsla(${hue},50%,38%,0.5), hsla(${hue},45%,24%,0.55))`,
          borderColor: `hsla(${hue},65%,55%,0.3)`,
        }}
        className={cn(
          "max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed",
          "rounded-[var(--radius-pv-bubble)] border pl-[12px] pr-[42px] py-[7px]",
          "backdrop-blur-xl saturate-150 [-webkit-backdrop-filter:blur(20px)_saturate(1.6)]",
          "text-[#e8e4d8]",
        )}
      >
        <div
          data-testid={`${testIdPrefix}-header`}
          className="text-[12.5px] font-semibold mb-0.5"
          style={{ color: `hsl(${hue},75%,80%)` }}
        >
          {sender.name}
        </div>
        <div data-testid={`${testIdPrefix}-body`} className="whitespace-pre-wrap">
          {children}
        </div>
        {speak && <RelaySpeakButton speakState={speak.speakState} onClick={speak.onClick} />}
      </div>
    </div>
  );
}
