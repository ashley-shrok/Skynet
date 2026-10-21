// What's new — per-person seen bookkeeping. Pure functions; the route
// (database/routes/whats-new.ts) does the storage.
//
// A person's record is the list of note ids they have seen, stored as JSON.
// No record yet (null) means they have never been counted: they are quietly
// marked as having seen every note that exists right now and shown nothing.
// Existing accounts are counted at server start (count-existing-accounts.ts)
// so a note shipped before their next visit isn't swallowed; counting on
// first load covers accounts created since the last boot.
// An empty list is a real record ("seen nothing") — distinct from null, so a
// person counted while there were zero notes still sees the first note.
//
// Seen ids are never pruned against the current note list: after a rollback
// to an older build, ids from the newer build stay remembered and are not
// shown again on the way back up.

import type { WhatsNewNote } from "./notes.js";

export const WHATS_NEW_SEEN_MAX = 5000;

export function parseSeen(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export interface ResolveResult {
  /** Notes this person hasn't seen, newest first. */
  unseen: WhatsNewNote[];
  /** New stored value when the record must be written, else null. */
  initialSeen: string | null;
}

export function resolveUnseen(
  seenRaw: string | null | undefined,
  notes: readonly WhatsNewNote[],
): ResolveResult {
  const seen = parseSeen(seenRaw);
  if (seen === null) {
    return { unseen: [], initialSeen: JSON.stringify(notes.map((n) => n.id)) };
  }
  const seenSet = new Set(seen);
  const unseen = notes.filter((n) => !seenSet.has(n.id)).reverse();
  return { unseen, initialSeen: null };
}

/**
 * Adds the given ids (only those that are real notes in this build) to the
 * record. Returns the new stored value, or null when nothing changed. A
 * person with no record yet is counted first (every current note seen), so
 * marking can never leave older notes looking unseen.
 */
export function markSeen(
  seenRaw: string | null | undefined,
  ids: readonly string[],
  notes: readonly WhatsNewNote[],
): string | null {
  const parsed = parseSeen(seenRaw);
  if (parsed === null) return JSON.stringify(notes.map((n) => n.id));
  const known = new Set(notes.map((n) => n.id));
  const seenSet = new Set(parsed);
  const next = [...parsed];
  for (const id of ids) {
    if (known.has(id) && !seenSet.has(id)) {
      seenSet.add(id);
      next.push(id);
    }
  }
  if (next.length === parsed.length) return null;
  return JSON.stringify(next.slice(-WHATS_NEW_SEEN_MAX));
}
