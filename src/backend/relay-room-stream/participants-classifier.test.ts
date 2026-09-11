/**
 * participants-classifier.test.ts — M4 fixup coverage (2026-09-09).
 *
 * Covers the classifier's pure `classifyParticipants` seam (already
 * exercised at the WS-server integration layer in
 * `relay-room-stream-server.test.ts`, but re-tested here at the module
 * boundary with an injected `lookupHumans` stub) PLUS the M4 30s-TTL
 * cache around `lookupHumansFromUsersTable`.
 *
 * Mocking strategy mirrors host-id-resolver.test.ts:
 *   - `db` mocked as a chainable Drizzle-like fluent builder.
 *   - `users` schema mocked as a plain columns bag.
 *   - `databaseLogger` mocked so warn-on-error paths don't spam stderr.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted so the mock ref is available in the factory (which vi.mock
// lifts to the top of the file at transform time).
const { dbFromMock } = vi.hoisted(() => ({ dbFromMock: vi.fn() }));

vi.mock("../database/db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: dbFromMock,
  },
}));

vi.mock("../database/db/schema.js", () => ({
  users: { id: "id", username: "username", mxid: "mxid" },
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

// eslint-disable-next-line import/first
import {
  classifyParticipants,
  lookupHumansFromUsersTable,
  __resetHumansLookupCacheForTests,
  type ClassifyParticipantsDeps,
} from "./participants-classifier.js";
// eslint-disable-next-line import/first
import { databaseLogger } from "../utils/logger.js";

const OWNER_MXID = "@owner_human:server";
const AGENT_A_MXID = "@agent_a:server";
const AGENT_Z_MXID = "@agent_z:server";
const OTHER_HUMAN_MXID = "@zebra_human:server";

function makeDeps(
  humansMap: Map<string, { displayName: string; userId: string }> = new Map(),
): ClassifyParticipantsDeps {
  return { lookupHumans: vi.fn().mockResolvedValue(humansMap) };
}

describe("classifyParticipants (module boundary)", () => {
  it("Test C1: sorts humans by displayName, agents by identityKey", async () => {
    const deps = makeDeps(
      new Map([
        [OWNER_MXID, { displayName: "Owner", userId: "u-owner" }],
        [OTHER_HUMAN_MXID, { displayName: "Aardvark", userId: "u-aard" }],
      ]),
    );
    const result = await classifyParticipants(
      [OWNER_MXID, AGENT_Z_MXID, OTHER_HUMAN_MXID, AGENT_A_MXID],
      deps,
    );
    expect(result.humans.map((h) => h.displayName)).toEqual([
      "Aardvark",
      "Owner",
    ]);
    expect(result.agents.map((a) => a.identityKey)).toEqual([
      "agent_a",
      "agent_z",
    ]);
  });

  it("Test C2: unknown mxid → classified as agent with extracted localpart", async () => {
    const deps = makeDeps(new Map());
    const result = await classifyParticipants([AGENT_A_MXID], deps);
    expect(result.humans).toEqual([]);
    expect(result.agents).toEqual([{ mxid: AGENT_A_MXID, identityKey: "agent_a" }]);
  });

  it("Test C3: table-lookup wins over `_human` suffix — pre-Phase-88 human with suffix-less mxid classifies as human", async () => {
    const suffixless = "@ashley:server";
    const deps = makeDeps(
      new Map([[suffixless, { displayName: "Alice", userId: "u-ash" }]]),
    );
    const result = await classifyParticipants([suffixless], deps);
    expect(result.humans.length).toBe(1);
    expect(result.humans[0]!.mxid).toBe(suffixless);
    expect(result.agents.length).toBe(0);
  });

  it("Test C4: malformed mxid → extractLocalpart returns empty string; still classified as agent", async () => {
    const deps = makeDeps(new Map());
    const result = await classifyParticipants(["nonsense"], deps);
    expect(result.agents.length).toBe(1);
    expect(result.agents[0]!.identityKey).toBe("");
  });
});

describe("lookupHumansFromUsersTable (M4 fixup — 30s TTL cache)", () => {
  beforeEach(() => {
    __resetHumansLookupCacheForTests();
    dbFromMock.mockReset();
    vi.mocked(databaseLogger.warn).mockReset();
  });

  it("Test M4a: happy-path DB read builds mxid → {displayName, userId} map", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
      { id: "u-2", username: "zebra", mxid: OTHER_HUMAN_MXID },
    ]);
    const map = await lookupHumansFromUsersTable();
    expect(map.size).toBe(2);
    expect(map.get(OWNER_MXID)).toEqual({ displayName: "alice", userId: "u-1" });
    expect(map.get(OTHER_HUMAN_MXID)).toEqual({
      displayName: "zebra",
      userId: "u-2",
    });
  });

  it("Test M4b: rows with null/empty mxid are skipped", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
      { id: "u-2", username: "no-mxid-yet", mxid: null },
      { id: "u-3", username: "empty-mxid", mxid: "" },
    ]);
    const map = await lookupHumansFromUsersTable();
    expect(map.size).toBe(1);
    expect(map.has(OWNER_MXID)).toBe(true);
  });

  it("Test M4c: null username falls back to mxid as displayName", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: null, mxid: OWNER_MXID },
    ]);
    const map = await lookupHumansFromUsersTable();
    expect(map.get(OWNER_MXID)!.displayName).toBe(OWNER_MXID);
  });

  it("Test M4d (cache): second call within TTL returns cached result — DB read fires ONCE", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
    ]);
    const first = await lookupHumansFromUsersTable();
    const second = await lookupHumansFromUsersTable();
    const third = await lookupHumansFromUsersTable();
    // Same object reference on cached calls.
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(dbFromMock).toHaveBeenCalledTimes(1);
  });

  it("Test M4e (TTL expiry): cache expiry triggers a fresh DB read (30s+ elapsed)", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
    ]);
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
      { id: "u-2", username: "new-human", mxid: OTHER_HUMAN_MXID },
    ]);
    const originalNow = Date.now;
    let fakeNow = 1_700_000_000_000;
    try {
      Date.now = () => fakeNow;
      const first = await lookupHumansFromUsersTable();
      expect(first.size).toBe(1);
      // Advance past TTL (30_000 + a hair).
      fakeNow += 30_500;
      const second = await lookupHumansFromUsersTable();
      expect(second.size).toBe(2);
      expect(dbFromMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("Test M4f (error path): DB throw returns empty map, logs structured warn, does NOT poison cache", async () => {
    dbFromMock.mockRejectedValueOnce(new Error("db unreachable"));
    const result = await lookupHumansFromUsersTable();
    expect(result.size).toBe(0);
    // Structured warn fired.
    expect(databaseLogger.warn).toHaveBeenCalled();
    // Cache is NOT poisoned — a subsequent call should retry the DB, not
    // serve a stale empty for 30s.
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
    ]);
    const retry = await lookupHumansFromUsersTable();
    expect(retry.size).toBe(1);
    expect(dbFromMock).toHaveBeenCalledTimes(2);
  });

  it("Test M4g (reset helper): __resetHumansLookupCacheForTests() drops cache — next call re-reads DB", async () => {
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
    ]);
    dbFromMock.mockResolvedValueOnce([
      { id: "u-1", username: "alice", mxid: OWNER_MXID },
    ]);
    await lookupHumansFromUsersTable();
    __resetHumansLookupCacheForTests();
    await lookupHumansFromUsersTable();
    expect(dbFromMock).toHaveBeenCalledTimes(2);
  });
});
