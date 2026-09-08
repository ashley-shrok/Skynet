// quick-260805-tub: coverage for the FleetSession localStorage cache helpers
// (readFleetSessionsCache / writeFleetSessionsCache) added to
// conversation-store.ts. The cache exists so a page refresh paints the last-
// known conversation-list row set immediately instead of an empty list for
// the ~200ms it takes getSessionList() to return.
//
// Scope of these tests: the two exported cache helpers in isolation. The
// AppShell wire (read-before-fetch, write-on-success) is a two-line change
// exercised by the existing AppShell.test.tsx mount-effect coverage + a full
// build.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Same api-client mock as conversation-store.test.ts — required because
// importing the store pulls in user-preferences-api at module load.
vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

import {
  readFleetSessionsCache,
  writeFleetSessionsCache,
  type FleetSession,
} from "./conversation-store";

// Phase 47 Plan 01: cache key bumped v2 → v3 (FleetSession gained
// optional aiTitle; see conversation-store.ts FLEET_CACHE_KEY comment).
// Phase 90 Plan 01: cache key bumped v3 → v4 (FleetSession gained
// optional `kind` discriminator + `roomId` + `roomTitle` — the
// Phase-89-authored /sessions/list relay-room fields; see
// conversation-store.ts FLEET_CACHE_KEY comment for the full rationale).
const CACHE_KEY = "skynet:convo-fleet-cache:v4";

const SAMPLE_A: FleetSession = {
  hostId: 1,
  hostName: "thenasty",
  sessionName: "tina",
  created: 1_700_000_000,
  role: "box-maintainer",
  // Phase 44 Plan 04: cache round-trip preserves lastMessageAt. `null` is the
  // "no history yet" wire value; the reader coerces undefined to null on
  // round-trip so consumers always see either null or a number.
  lastMessageAt: null,
  // Phase 47 Plan 01: cache round-trip preserves aiTitle. `null` is the
  // "no ai-title yet" wire value; the reader coerces undefined to null on
  // round-trip so consumers always see either null or a string.
  aiTitle: null,
  // Phase 90 Plan 01: harness kind exercised on SAMPLE_A. The round-trip
  // asserters below check that kind survives verbatim on the surviving
  // entries. roomId + roomTitle are undefined/null respectively for a
  // harness row (Matrix identity axis is not applicable) — the reader
  // preserves undefined kind/roomId and coerces roomTitle to null via the
  // same `?? null` treatment as lastMessageAt / aiTitle.
  kind: "harness",
  roomTitle: null,
};

const SAMPLE_B: FleetSession = {
  hostId: 2,
  hostName: "workstation",
  sessionName: "nelly",
  created: 1_700_000_100,
  role: null,
  lastMessageAt: 1_700_000_200,
  // Phase 47 Plan 01: populated string case — exercises the round-trip's
  // string-value branch. Combined with SAMPLE_A's null, both branches covered.
  aiTitle: "Fix cache round-trip",
  // Phase 90 Plan 01: relay-room kind exercised on SAMPLE_B. Populated
  // roomId + roomTitle exercise the string-preservation branch of the
  // round-trip for relay identity fields.
  kind: "relay-room",
  roomId: "!room:matrix.example",
  roomTitle: "Working session",
};

describe("FleetSession localStorage cache (quick-260805-tub)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("roundtrip: write then read returns the same array (deep equal)", () => {
    writeFleetSessionsCache([SAMPLE_A, SAMPLE_B]);
    const got = readFleetSessionsCache();
    expect(got).toEqual([SAMPLE_A, SAMPLE_B]);
  });

  it("cache-miss fallback: empty localStorage returns []", () => {
    expect(readFleetSessionsCache()).toEqual([]);
  });

  it("corrupt-JSON fallback: non-JSON payload returns [] without throwing", () => {
    localStorage.setItem(CACHE_KEY, "not-json{}[");
    expect(readFleetSessionsCache()).toEqual([]);
  });

  it("non-array fallback: object payload returns []", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ foo: 1 }));
    expect(readFleetSessionsCache()).toEqual([]);
  });

  it("element-shape fallback: array with malformed items filters them out", () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify([
        SAMPLE_A,
        { foo: 1 }, // missing all 4 canonical fields
        { hostId: "not-a-number", hostName: "x", sessionName: "y", created: 0 }, // wrong type
        SAMPLE_B,
      ]),
    );
    expect(readFleetSessionsCache()).toEqual([SAMPLE_A, SAMPLE_B]);
  });

  it("write-only-canonical-fields: extra fields are stripped on write (defensive filter)", () => {
    const withExtra = {
      ...SAMPLE_A,
      extraField: "should not persist",
      anotherOne: 42,
    } as FleetSession & { extraField: string; anotherOne: number };

    writeFleetSessionsCache([withExtra]);
    const raw = localStorage.getItem(CACHE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>[];
    expect(parsed).toHaveLength(1);
    // Phase 90 Plan 01: canonical field set grows by three — kind, roomId,
    // roomTitle (the Phase-89 relay identity axis + kind discriminator).
    // Alphabetical order. Note: JSON.stringify drops `undefined` values, so
    // when SAMPLE_A + kind="harness" runs through with roomId=undefined
    // that key does NOT appear in the parsed payload. The withExtra spread
    // pattern here uses SAMPLE_A which does set `kind` + `roomTitle` (and
    // leaves roomId undefined) — parsed keys therefore include kind +
    // roomTitle but NOT roomId. This is the correct steady-state for a
    // harness row: no Matrix roomId to persist.
    expect(Object.keys(parsed[0]).sort()).toEqual([
      "aiTitle",
      "created",
      "hostId",
      "hostName",
      "kind",
      "lastMessageAt",
      "role",
      "roomTitle",
      "sessionName",
    ]);
  });

  it("overwrite semantics: second write replaces first (no merge, no append)", () => {
    writeFleetSessionsCache([SAMPLE_A, SAMPLE_B]);
    writeFleetSessionsCache([SAMPLE_A]);
    expect(readFleetSessionsCache()).toEqual([SAMPLE_A]);
  });

  it("empty write: [] persists as [] (explicit empty cache, distinct from missing)", () => {
    writeFleetSessionsCache([]);
    // Read still returns [] — but the key IS set (empty-array vs cache-miss
    // are behaviorally identical to consumers, but the underlying storage
    // state differs).
    expect(localStorage.getItem(CACHE_KEY)).toBe("[]");
    expect(readFleetSessionsCache()).toEqual([]);
  });

  it("write is silent on storage failure (setItem throws)", () => {
    const original = localStorage.setItem.bind(localStorage);
    // Force setItem to throw once (mimics QuotaExceededError / disabled storage)
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => writeFleetSessionsCache([SAMPLE_A])).not.toThrow();

    spy.mockRestore();
    // Restore side effect: subsequent writes still work.
    original(CACHE_KEY, JSON.stringify([SAMPLE_B]));
    expect(readFleetSessionsCache()).toEqual([SAMPLE_B]);
  });
});
