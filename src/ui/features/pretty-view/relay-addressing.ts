import type { Identity } from "@/api/identities-api";
import { MXID_REGEX, resolveMxidToIdentity } from "./relay-mxid-resolve";
import type { RelayRoomMember } from "./relay-room-members";

/** One end of a relay message, ready to render. */
export interface RelayParty {
  name: string;
  /** Identity colorHue, or null for people / unresolved senders. */
  hue: number | null;
  you: boolean;
}

/**
 * Who a relay message went to:
 *   dm      — exactly one other member
 *   group   — two or more other members
 *   unknown — membership couldn't be looked up and there's no safe guess
 */
export type RelayAddressing =
  | { kind: "dm"; to: RelayParty }
  | { kind: "group"; to: RelayParty[] }
  | { kind: "unknown" };

/** Lowercased mxid localpart, or null for a malformed mxid. */
export function mxidLocalpart(mxid: string): string | null {
  const m = mxid.match(MXID_REGEX);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Readable name for an mxid with no matching identity — the localpart with a
 * leading capital (`@stacy:skynet.aithercloud.com` → "Stacy"), never the raw
 * address.
 */
export function friendlyMxidName(mxid: string): string {
  const m = mxid.match(MXID_REGEX);
  const local = m ? m[1] : mxid.replace(/^@/, "");
  return local.length > 0 ? local[0].toUpperCase() + local.slice(1) : mxid;
}

/** Resolve an mxid to a renderable party via the identities store. */
export function partyForMxid(mxid: string, byKey: Map<string, Identity>): RelayParty {
  const { identity, colorHue } = resolveMxidToIdentity(mxid, byKey);
  return {
    name: identity ? identity.displayName : friendlyMxidName(mxid),
    hue: colorHue,
    you: false,
  };
}

function partyForMember(member: RelayRoomMember, byKey: Map<string, Identity>): RelayParty {
  if (member.kind === "you") return { name: "You", hue: null, you: true };
  if (member.kind === "human") {
    return {
      name: member.displayName ?? friendlyMxidName(member.mxid),
      hue: null,
      you: false,
    };
  }
  return partyForMxid(member.mxid, byKey);
}

/**
 * Work out who a message went to from the room's members, minus the sender.
 *
 * `senderKey` is the sender's lowercased mxid localpart (identityKey for the
 * pane's own agent). `fallback` is used when members are unknown — inbound
 * messages pass the pane's agent (they were received by it), outbound pass
 * null (the recipient is genuinely unknown).
 */
export function addressingFor(
  senderKey: string | null,
  members: RelayRoomMember[] | null,
  byKey: Map<string, Identity>,
  fallback: RelayParty | null,
): RelayAddressing {
  if (members) {
    const others = members.filter((m) => mxidLocalpart(m.mxid) !== senderKey);
    if (others.length === 1) return { kind: "dm", to: partyForMember(others[0], byKey) };
    if (others.length > 1) {
      return { kind: "group", to: others.map((m) => partyForMember(m, byKey)) };
    }
  }
  return fallback ? { kind: "dm", to: fallback } : { kind: "unknown" };
}

/** First line of a message, whitespace-collapsed, for the folded preview. */
export function previewLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
