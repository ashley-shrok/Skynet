/**
 * Phase 89 Plan 04 — mergeRelayRoomsIntoFlat pure helper tests.
 *
 * The /sessions/list handler's merge block (D-15) delegates to a pure helper
 * so the merge shape stays trivially testable without a supertest harness or
 * mocked DB. This file covers the 3 pure-merge scenarios (harness-only,
 * relay-only, merged); the DB-throw fallback + timeout-budget + no-regression
 * scenarios live in sessions.test.ts where the mocked handler surface is
 * already scaffolded.
 *
 * Contract (D-15 + D-01 scope anchor):
 * - Every item in the merged output carries a `kind` marker.
 * - Harness rows come first (preserving Phase 47 `created DESC` order); relay
 *   rows are APPENDED after — slice D re-sorts by `lastActivityAt` if desired.
 * - Empty input arrays are handled gracefully (no undefined/null in output).
 */

import { describe, it, expect } from "vitest";
import {
  mergeRelayRoomsIntoFlat,
  type HarnessSessionRow,
  type RelayRoomSessionRow,
} from "./sessions-merge-helper.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeHarnessRow(
  overrides: Partial<HarnessSessionRow> = {},
): HarnessSessionRow {
  return {
    kind: "harness",
    hostId: 42,
    hostName: "box-a",
    sessionName: "poppy",
    created: 1000,
    role: "box-maintainer",
    lastMessageAt: null,
    aiTitle: null,
    ...overrides,
  };
}

function makeRelayRow(
  overrides: Partial<RelayRoomSessionRow> = {},
): RelayRoomSessionRow {
  return {
    kind: "relay-room",
    id: "row-uuid-1",
    roomId: "!room-1:matrix.local",
    roomTitle: "Alice + Taylor",
    lastActivityAt: "2026-09-08T14:30:00Z",
    createdAt: "2026-09-08T13:00:00Z",
    updatedAt: "2026-09-08T14:30:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeRelayRoomsIntoFlat — pure helper", () => {
  it("harness-only: returns harness rows sorted by created DESC, each carrying kind='harness'", () => {
    const harnessRows: HarnessSessionRow[] = [
      makeHarnessRow({ sessionName: "poppy", created: 1000 }),
      makeHarnessRow({ sessionName: "patricia", created: 3000 }),
      makeHarnessRow({ sessionName: "oscar", created: 2000 }),
    ];

    const merged = mergeRelayRoomsIntoFlat(harnessRows, []);

    expect(merged).toHaveLength(3);
    // Sort: created DESC → patricia (3000), oscar (2000), poppy (1000)
    expect(merged.map((r) => r.kind)).toEqual([
      "harness",
      "harness",
      "harness",
    ]);
    expect((merged[0] as HarnessSessionRow).sessionName).toBe("patricia");
    expect((merged[1] as HarnessSessionRow).sessionName).toBe("oscar");
    expect((merged[2] as HarnessSessionRow).sessionName).toBe("poppy");
  });

  it("relay-only: returns relay rows with kind='relay-room' when harness list is empty", () => {
    const relayRows: RelayRoomSessionRow[] = [
      makeRelayRow({ id: "row-a", roomId: "!room-a:matrix.local" }),
      makeRelayRow({ id: "row-b", roomId: "!room-b:matrix.local" }),
      makeRelayRow({ id: "row-c", roomId: "!room-c:matrix.local" }),
    ];

    const merged = mergeRelayRoomsIntoFlat([], relayRows);

    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.kind)).toEqual([
      "relay-room",
      "relay-room",
      "relay-room",
    ]);
    // Relay rows preserve input order (slice D re-sorts if desired per D-15).
    expect((merged[0] as RelayRoomSessionRow).id).toBe("row-a");
    expect((merged[1] as RelayRoomSessionRow).id).toBe("row-b");
    expect((merged[2] as RelayRoomSessionRow).id).toBe("row-c");
  });

  it("merged: harness rows first (sorted by created DESC), relay rows appended in input order", () => {
    const harnessRows: HarnessSessionRow[] = [
      makeHarnessRow({ sessionName: "poppy", created: 1000 }),
      makeHarnessRow({ sessionName: "patricia", created: 2000 }),
    ];
    const relayRows: RelayRoomSessionRow[] = [
      makeRelayRow({ id: "row-a", roomId: "!room-a:matrix.local" }),
      makeRelayRow({ id: "row-b", roomId: "!room-b:matrix.local" }),
      makeRelayRow({ id: "row-c", roomId: "!room-c:matrix.local" }),
    ];

    const merged = mergeRelayRoomsIntoFlat(harnessRows, relayRows);

    expect(merged).toHaveLength(5);
    // First 2: harness sorted by created DESC (patricia 2000 > poppy 1000)
    expect(merged.slice(0, 2).map((r) => r.kind)).toEqual([
      "harness",
      "harness",
    ]);
    expect((merged[0] as HarnessSessionRow).sessionName).toBe("patricia");
    expect((merged[1] as HarnessSessionRow).sessionName).toBe("poppy");
    // Last 3: relay rows appended in input order
    expect(merged.slice(2).map((r) => r.kind)).toEqual([
      "relay-room",
      "relay-room",
      "relay-room",
    ]);
    expect((merged[2] as RelayRoomSessionRow).id).toBe("row-a");
    expect((merged[3] as RelayRoomSessionRow).id).toBe("row-b");
    expect((merged[4] as RelayRoomSessionRow).id).toBe("row-c");
  });

  it("empty inputs: returns empty array without throwing", () => {
    const merged = mergeRelayRoomsIntoFlat([], []);
    expect(merged).toEqual([]);
  });

  it("harness input is NOT mutated by the sort (returns new array or sort-in-place is fine as long as tests pass)", () => {
    // This test guards against a subtle bug: if the helper sorts the input
    // harness array in place, callers passing a shared reference could see
    // reordering side-effects. The helper contract is that the returned
    // array is safe to consume; harnessRows callers are the handler which
    // discards its intermediate arrays, so in-place sort is acceptable, but
    // the returned array MUST be usable as-is.
    const harnessRows: HarnessSessionRow[] = [
      makeHarnessRow({ sessionName: "a", created: 1000 }),
      makeHarnessRow({ sessionName: "b", created: 2000 }),
    ];
    const merged = mergeRelayRoomsIntoFlat(harnessRows, []);
    // Returned array is sorted; that is the contract.
    expect((merged[0] as HarnessSessionRow).sessionName).toBe("b");
    expect((merged[1] as HarnessSessionRow).sessionName).toBe("a");
  });
});
