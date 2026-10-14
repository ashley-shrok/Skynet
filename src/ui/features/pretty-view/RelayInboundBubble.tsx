import { useEffect, useState, type MouseEvent } from "react";
import type { RelayInboundEvent } from "@/api/claude-session-api";
import type { Identity } from "@/api/identities-api";
import { useIdentities } from "@/state/identities-store";
import { resolveMxidToIdentity } from "./relay-mxid-resolve";
import { detectFilePointer } from "./relay-pointer-detect";
import { speakVoiceCandidates } from "./voice-candidates";
import { stampedFetch } from "@/lib/stamped-fetch";
import { useSpeakPlayback } from "./useSpeakPlayback";
import { addressingFor, mxidLocalpart, partyForMxid, previewLine } from "./relay-addressing";
import { useRelayRoomMembers } from "./relay-room-members";
import { RelayChatBubble, RelayDmCard } from "./RelayBubbleParts";

// RelayInboundBubble — a relay message this pane's agent received (harness
// view, folded RelayDmCard: "Tina → Aster [DM]"), or a message from someone
// else in a relay room the user opened (relay-source view, plain
// RelayChatBubble).
//
// Long messages arrive as a file-pointer line from recv.sh; the bubble
// fetches the full text via /relay-pointer when opened and never shows the
// pointer line itself — only the quoted preview, as a fallback if the fetch
// fails.
//
// Security: body / fetched text render as React text children, never
// dangerouslySetInnerHTML. /relay-pointer's backend whitelist is the
// authoritative path gate; encodeURIComponent guards the query string.

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; text: string }
  | { kind: "error"; indicator: string };

/** The «…» preview recv.sh quotes inside a file-pointer line. */
function pointerPreview(pointerLine: string): string {
  const m = pointerLine.match(/«([\s\S]*?)(?:»|$)/);
  return m ? m[1].replace(/…$/, "").trim() : "";
}

export type RelayInboundBubbleProps = Pick<
  RelayInboundEvent,
  "room" | "sender" | "body"
> & {
  /** hostId from PrettyViewProps — scopes the pointer fetch and member lookup. */
  hostId: number;
  /** The viewing user's fallback voice — last candidate before the provider default. */
  fallbackVoice?: string | null;
  /** ms-epoch timestamp; shown as a hover title. */
  ts?: number;
  /** Relay-source view (user chatting IN the room): plain chat bubble,
   * always open. Harness view: folded card, tap to open. */
  alwaysExpanded?: boolean;
  /** Matrix event id. Accepted for callers; unused since auto-speak retired. */
  eventId?: string;
  /** The pane's own agent — the receiver of this message in harness view. */
  selfIdentity?: Identity | null;
};

export function RelayInboundBubble({
  room,
  sender,
  body,
  ts,
  hostId,
  alwaysExpanded = false,
  fallbackVoice = null,
  selfIdentity = null,
}: RelayInboundBubbleProps) {
  const { byKey } = useIdentities();
  const { identity } = resolveMxidToIdentity(sender, byKey);
  const senderParty = partyForMxid(sender, byKey);
  const speakVoices = speakVoiceCandidates(identity, fallbackVoice);
  const [open, setOpen] = useState(alwaysExpanded);

  const members = useRelayRoomMembers(alwaysExpanded ? null : room, hostId);
  const addressing = addressingFor(
    mxidLocalpart(sender),
    members,
    byKey,
    selfIdentity
      ? { name: selfIdentity.displayName, hue: selfIdentity.colorHue, you: false }
      : null,
  );

  const pointer = detectFilePointer(body);
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    if (!pointer) return;
    setFetchState({ kind: "loading" });
    stampedFetch(`/relay-pointer?hostId=${hostId}&path=${encodeURIComponent(pointer.pointerPath)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          console.warn(`[relay-inbound] pointer fetch failed hostId=${hostId} status=${res.status}`);
          setFetchState({ kind: "error", indicator: `${res.status}` });
          return;
        }
        return res.text().then((text) => {
          setFetchState({ kind: "done", text });
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "network error";
        console.warn(`[relay-inbound] pointer fetch error hostId=${hostId} error=${msg}`);
        setFetchState({ kind: "error", indicator: msg });
      });
  }, [pointer?.pointerPath, hostId, open]);

  const shortText = pointer ? pointerPreview(pointer.pointerLine) : body;
  const fullText = fetchState.kind === "done" ? fetchState.text : shortText;

  const { speakState, onSpeakClick } = useSpeakPlayback({
    ownerName: "relay-speak-bubble",
    logPrefix: "relay:",
    voices: speakVoices,
    getText: () => fullText,
  });

  const content = pointer ? (
    fetchState.kind === "done" ? (
      fetchState.text
    ) : fetchState.kind === "error" ? (
      <>
        {shortText}
        <div className="mt-1.5 text-xs italic text-[rgba(232,228,216,0.5)] whitespace-normal">
          Couldn't load the rest of this message.
        </div>
      </>
    ) : (
      <span className="text-xs italic text-[rgba(232,228,216,0.5)]">Loading…</span>
    )
  ) : (
    body
  );

  const speak = { speakState, onClick: (e: MouseEvent) => { void onSpeakClick(e); } };

  if (alwaysExpanded) {
    return (
      <RelayChatBubble testIdPrefix="relay-inbound" sender={senderParty} ts={ts} speak={speak}>
        {content}
      </RelayChatBubble>
    );
  }

  return (
    <RelayDmCard
      testIdPrefix="relay-inbound"
      sender={senderParty}
      addressing={addressing}
      preview={previewLine(shortText)}
      ts={ts}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      speak={speak}
    >
      {content}
    </RelayDmCard>
  );
}
