/**
 * participants-classifier.ts — Phase 90 Plan 04 Task 2.
 *
 * SHARED classifier module — the single source of truth for the
 * humans/agents partition used by BOTH the WS server (Task 2) AND the
 * `GET /relay-room/:roomId/participants` REST endpoint (Task 3).
 *
 * ## Why shared (T-90-04-C1 — W#9 consistency invariant)
 *
 * Slice D's warning register calls out W#9: if the WS server's live
 * `participants` frame and the REST endpoint's initial `participants`
 * fetch produce different partitions for the same room, the user sees a
 * jarring badge-row re-shuffle at the exact moment the WS connects.
 * The mitigation is to import the SAME classifier from both surfaces.
 *
 * Task 2 Test 12 grep-verifies both surfaces call this helper.
 *
 * ## Classification policy
 *
 * The mxid namespace convention (established in Phase 88 slice A):
 *
 *   - Human user mxids follow `@<username>_human:<server>` — the `_human`
 *     suffix on the localpart is the marker.
 *   - Agent (Claude Code identity) mxids follow `@<identityKey>:<server>` —
 *     NO `_human` suffix, and typically match an entry in the
 *     agents-registry table.
 *
 * For the v1 classifier, we use the users table as the authoritative
 * humans list (users.mxid), and treat every remaining joined member as an
 * agent. This is more robust than pure string-suffix matching because:
 *
 *   (a) A pre-Phase-88 human with a suffix-less mxid still classifies as
 *       human by table lookup.
 *   (b) An agent that happens to have `_human` in its identity key is
 *       still an agent (table lookup wins over suffix).
 *
 * Registry-room membership is NOT required for the classification — the
 * agents-registry room enrollment is a separate concern (Phase 89 D-09
 * authority set for backfill). Here we only need the humans membership;
 * everyone else in the room is by definition an agent.
 *
 * ## Return shape
 *
 * `{humans: HumanParticipant[], agents: AgentParticipant[]}` — each list
 * is sorted alphabetically (humans by displayName, agents by identityKey)
 * per D-07. The frontend renders the row humans-first, agents-second,
 * within-group-alphabetical.
 *
 * ## Isolation for testing
 *
 * Deps are injected via `ClassifyParticipantsDeps` — `lookupHumans`
 * returns the {mxid → {displayName, userId}} map from the users table.
 * Tests provide a stub; production wires `lookupHumansFromUsersTable`
 * (also exported).
 */

import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * A human participant in a relay room. Corresponds to a row in the users
 * table whose mxid appears in the room's joined-member set.
 */
export interface HumanParticipant {
  mxid: string;
  displayName: string;
  userId: string;
}

/**
 * An agent participant in a relay room. Every joined mxid not matched by
 * a user row is classified as an agent. `identityKey` is derived from the
 * mxid's localpart (the part between `@` and `:`).
 */
export interface AgentParticipant {
  mxid: string;
  identityKey: string;
}

/**
 * Deps for classifyParticipants — the humans lookup is injected so tests
 * can stub the DB without wiring the full Drizzle harness.
 */
export interface ClassifyParticipantsDeps {
  /**
   * Return a map from mxid → {displayName, userId} for every user row
   * that has a non-null mxid. Called once per classification.
   */
  lookupHumans: () => Promise<Map<string, { displayName: string; userId: string }>>;
}

/**
 * Result shape shared by both the WS server (Task 2) and the REST endpoint
 * (Task 3).
 */
export interface ClassifiedParticipants {
  humans: HumanParticipant[];
  agents: AgentParticipant[];
}

/**
 * Extract the localpart from an mxid (the part between `@` and `:`).
 * Returns an empty string on malformed input.
 */
function extractLocalpart(mxid: string): string {
  const at = mxid.indexOf("@");
  const colon = mxid.indexOf(":");
  if (at !== 0 || colon <= 1) return "";
  return mxid.slice(1, colon);
}

/**
 * Classify a list of joined-member mxids into humans + agents. Sorted
 * within each group per D-07 (humans by displayName, agents by
 * identityKey).
 */
export async function classifyParticipants(
  memberMxids: string[],
  deps: ClassifyParticipantsDeps,
): Promise<ClassifiedParticipants> {
  const humansLookup = await deps.lookupHumans();

  const humans: HumanParticipant[] = [];
  const agents: AgentParticipant[] = [];

  for (const mxid of memberMxids) {
    const humanRow = humansLookup.get(mxid);
    if (humanRow !== undefined) {
      humans.push({
        mxid,
        displayName: humanRow.displayName,
        userId: humanRow.userId,
      });
    } else {
      agents.push({
        mxid,
        identityKey: extractLocalpart(mxid),
      });
    }
  }

  // D-07 sort — humans by displayName, agents by identityKey. Stable
  // alphabetical (case-insensitive would be nicer UX but tests must lock
  // an exact ordering — use raw localeCompare for determinism).
  humans.sort((a, b) => a.displayName.localeCompare(b.displayName));
  agents.sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  return { humans, agents };
}

/**
 * Production `lookupHumans` implementation. Reads users.mxid + users.id +
 * users.username via Drizzle and builds the mxid-keyed map. Called once
 * per classification (no caching — the humans set is small and drift
 * matters).
 */
export async function lookupHumansFromUsersTable(): Promise<
  Map<string, { displayName: string; userId: string }>
> {
  try {
    const rows = (await db
      .select({
        id: users.id,
        username: users.username,
        mxid: users.mxid,
      })
      .from(users)) as Array<{
      id: string;
      username: string | null;
      mxid: string | null;
    }>;

    const map = new Map<string, { displayName: string; userId: string }>();
    for (const row of rows) {
      if (typeof row.mxid !== "string" || row.mxid.length === 0) continue;
      const displayName =
        typeof row.username === "string" && row.username.length > 0
          ? row.username
          : row.mxid;
      map.set(row.mxid, { displayName, userId: row.id });
    }
    return map;
  } catch (err) {
    databaseLogger.warn(
      "participants-classifier: lookupHumansFromUsersTable failed — returning empty humans set",
      {
        operation: "participants_classifier_lookup_humans_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return new Map();
  }
}
