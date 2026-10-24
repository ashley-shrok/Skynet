import React, { useState } from "react";
import { Volume2, Loader2, Pause, Play, ChevronRight, Mail } from "lucide-react";
import type { RelayAddressing, RelayParty } from "./relay-addressing";
import type { SpeakState } from "./useSpeakPlayback";

// Shared chrome for the two relay bubbles (RelayInboundBubble /
// RelayOutboundBubble). Three shapes (shape-conversation-view):
//
//   RelayDmCard      — agents messaging each other, seen in an agent's own
//                      conversation: a quiet neutral card, "Aster → Tina" plus
//                      a one-line preview; tap to open.
//   RelayToYouBubble — the agent messaging YOU over the relay: an ordinary
//                      agent bubble, always open, marked with the sidebar's red
//                      envelope (it also reached the user's phone).
//   RelayChatBubble  — a relay room the user opened themselves: the room IS
//                      the pane, so the sender's name over its bubble.
//
// Everything user-facing reads as plain language: no room ids, shell
// variables, file paths, transport names — and no "DM" tag.
// Styles: conversation.css.

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
      data-active={speakState === "playing" || speakState === "paused" ? "true" : undefined}
      className="pv-speak-btn"
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

function RelayAvatar({
  name,
  hue,
  avatarUrl,
}: {
  name: string;
  hue: number;
  avatarUrl?: string | null;
}) {
  // A broken image falls back to the initial rather than a broken-image glyph.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!avatarUrl && failedUrl !== avatarUrl;
  return (
    <span
      aria-hidden="true"
      data-testid="relay-avatar"
      className="pv-relay-avatar"
      style={{
        background: `linear-gradient(150deg, hsl(${hue},65%,55%), hsl(${hue},60%,38%))`,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          data-testid="relay-avatar-img"
          className="w-full h-full object-cover"
          draggable={false}
          onError={() => {
            console.warn(`[relay-avatar] image failed; falling back to initial name=${name} url=${avatarUrl}`);
            setFailedUrl(avatarUrl);
          }}
        />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}

function PartyName({ party }: { party: RelayParty }) {
  return <b>{party.name}</b>;
}

/** "Aster → Tina" / "Aster → group with Tina, Pixel" / "Aster sent a DM". */
function WhoLine({
  sender,
  addressing,
  failed,
}: {
  sender: RelayParty;
  addressing: RelayAddressing;
  /** The send failed (error text, shown on hover): a "not sent" marker. */
  failed?: string | null;
}) {
  const notSent = failed ? (
    <span data-testid="relay-not-sent" title={failed} className="pv-relay-notsent">
      ⚠ not sent
    </span>
  ) : null;
  const arrow = <span aria-hidden="true">→</span>;
  return (
    <span data-testid="relay-who-line" className="pv-agent-card-who">
      <PartyName party={sender} />
      {addressing.kind === "dm" ? (
        <>
          {arrow}
          <PartyName party={addressing.to} />
          {notSent}
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
          {notSent}
        </>
      ) : (
        <>
          <span>sent a DM</span>
          {notSent}
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
  /** Error text when the send failed; the card then reads "not sent". */
  failed?: string | null;
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
  failed = null,
}: RelayDmCardProps) {
  const hue = sender.hue ?? FALLBACK_HUE;
  return (
    <div className="flex justify-start" data-testid={`${testIdPrefix}-wrap`}>
      <div
        data-testid={`${testIdPrefix}-bubble`}
        data-bubble-hue={hue}
        title={ts !== undefined ? new Date(ts).toLocaleString() : undefined}
        className="pv-agent-card"
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
          className="pv-agent-card-head"
        >
          <RelayAvatar name={sender.name} hue={hue} avatarUrl={sender.avatarUrl} />
          <span className="min-w-0 block">
            <WhoLine sender={sender} addressing={addressing} failed={failed} />
            {!open && preview && (
              <span data-testid={`${testIdPrefix}-preview`} className="pv-agent-card-preview">
                {preview}
              </span>
            )}
          </span>
          <ChevronRight aria-hidden="true" />
        </div>
        {open && (
          <div data-testid={`${testIdPrefix}-body`} className="pv-agent-card-body">
            {children}
            {speak && <RelaySpeakButton speakState={speak.speakState} onClick={speak.onClick} />}
          </div>
        )}
      </div>
    </div>
  );
}

export interface RelayToYouBubbleProps {
  testIdPrefix: string;
  sender: RelayParty;
  ts?: number;
  children: React.ReactNode;
  speak?: { speakState: SpeakState; onClick: (e: React.MouseEvent) => void } | null;
  /** The send failed (error text, shown on hover): no envelope — it never
   *  reached the phone — and a "not sent" mark instead. */
  failed?: string | null;
}

/**
 * The agent messaged YOU over the relay (it also reached your phone): just an
 * agent bubble in the sender's colour, always open, with the sidebar's red
 * envelope on its corner. Never folded — even a failed send stays readable.
 */
export function RelayToYouBubble({ testIdPrefix, sender, ts, children, speak, failed = null }: RelayToYouBubbleProps) {
  const hue = sender.hue ?? FALLBACK_HUE;
  const when = ts !== undefined ? ` · ${new Date(ts).toLocaleString()}` : "";
  return (
    <div className="flex justify-start" data-testid={`${testIdPrefix}-wrap`}>
      <div
        data-testid={`${testIdPrefix}-bubble`}
        data-bubble-hue={hue}
        data-to-you={failed ? undefined : "true"}
        className="pv-bubble-agent pv-hue-surface whitespace-pre-wrap [overflow-wrap:anywhere]"
        style={{ ["--pv-b-hue" as string]: String(hue) }}
      >
        {failed ? null : (
          <span className="pv-envelope" title={`Also sent to your phone${when}`} data-testid="relay-envelope">
            <Mail aria-hidden="true" />
          </span>
        )}
        <div data-testid={`${testIdPrefix}-body`}>{children}</div>
        {failed && (
          <div data-testid="relay-not-sent" title={failed} className="pv-relay-notsent mt-1">
            ⚠ not sent
          </div>
        )}
        {speak && <RelaySpeakButton speakState={speak.speakState} onClick={speak.onClick} />}
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
        className="pv-bubble-agent [overflow-wrap:anywhere]"
        style={{ ["--pv-b-hue" as string]: String(hue) }}
      >
        <div data-testid={`${testIdPrefix}-header`} className="pv-bubble-name">
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
