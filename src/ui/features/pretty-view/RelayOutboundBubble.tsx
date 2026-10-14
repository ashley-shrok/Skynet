import { useState, type MouseEvent } from "react";
import type { RelayOutboundEvent } from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import { useIdentities } from "@/state/identities-store";
import { speakVoiceCandidates } from "./voice-candidates";
import { useSpeakPlayback } from "./useSpeakPlayback";
import { addressingFor, previewLine, type RelayParty } from "./relay-addressing";
import { useRelayRoomMembers } from "./relay-room-members";
import { RelayChatBubble, RelayDmCard } from "./RelayBubbleParts";

// RelayOutboundBubble — a relay message this pane's agent sent. Harness view
// renders a folded RelayDmCard ("Aster → Tina [DM]"); the recipient comes
// from the room's members when the backend could resolve the room id from
// the send command, otherwise the card reads "Aster sent a DM".
//
// The raw send command is never shown. When the message text couldn't be
// extracted from the command, the card says so in plain words.
//
// Security: body renders as a React text child, never
// dangerouslySetInnerHTML.

export type RelayOutboundBubbleProps = Pick<RelayOutboundEvent, "room" | "body"> & {
  /** ms-epoch timestamp; shown as a hover title. */
  ts?: number;
  /** Relay-source view: plain chat bubble, always open. */
  alwaysExpanded?: boolean;
  /** hostId from PrettyViewProps — scopes the member lookup. */
  hostId?: number;
  /** The pane's own agent — the sender. */
  selfIdentity?: Identity | null;
  /** The viewing user's fallback voice — last candidate before the provider default. */
  fallbackVoice?: string | null;
};

export function RelayOutboundBubble({
  room,
  body,
  ts,
  alwaysExpanded = false,
  hostId,
  selfIdentity = null,
  fallbackVoice = null,
}: RelayOutboundBubbleProps) {
  const { byKey } = useIdentities();
  const [open, setOpen] = useState(alwaysExpanded);
  const members = useRelayRoomMembers(alwaysExpanded ? null : room, hostId);

  // Relay-source view has no pane agent — an outbound there is the viewing
  // user's own send echoed back from the room.
  const sender: RelayParty = selfIdentity
    ? {
        name: selfIdentity.displayName,
        hue: selfIdentity.colorHue,
        you: false,
        avatarUrl: selfIdentity.avatarUrl || null,
      }
    : alwaysExpanded
      ? { name: "You", hue: null, you: true }
      : { name: "This agent", hue: null, you: false };
  const addressing = addressingFor(
    selfIdentity?.identityKey.toLowerCase() ?? null,
    members,
    byKey,
    null,
  );

  const { speakState, onSpeakClick } = useSpeakPlayback({
    ownerName: "relay-speak-bubble",
    logPrefix: "relay:",
    voices: speakVoiceCandidates(selfIdentity, fallbackVoice),
    getText: () => body ?? "",
  });
  const speak =
    body !== null
      ? { speakState, onClick: (e: MouseEvent) => { void onSpeakClick(e); } }
      : null;

  const content =
    body !== null ? (
      body
    ) : (
      <div className="text-xs italic text-[rgba(232,228,216,0.5)] whitespace-normal">
        {sender.name} sent a message here, but its text couldn't be shown.
      </div>
    );

  if (alwaysExpanded) {
    return (
      <RelayChatBubble testIdPrefix="relay-outbound" sender={sender} ts={ts} speak={speak}>
        {content}
      </RelayChatBubble>
    );
  }

  return (
    <RelayDmCard
      testIdPrefix="relay-outbound"
      sender={sender}
      addressing={addressing}
      preview={body !== null ? previewLine(body) : ""}
      ts={ts}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      speak={speak}
    >
      {content}
    </RelayDmCard>
  );
}
