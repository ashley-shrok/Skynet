// Phase 90 Plan 01 — sessions-api type-widening tests.
//
// `RemoteTmuxSession` was widened to carry the Phase-89 `kind` discriminator
// (`"harness" | "relay-room"`) plus the relay-room-only fields
// (id/roomId/roomTitle/lastActivityAt/createdAt/updatedAt) that
// `/sessions/list` now returns alongside the existing harness fields.
//
// The wire contract source-of-truth lives in
// `src/backend/database/routes/sessions-merge-helper.ts` as a discriminated
// union (HarnessSessionRow | RelayRoomSessionRow). The frontend deliberately
// carries the fields as OPTIONAL on a single flat interface (rather than a
// full discriminated-union refactor) so pre-Phase-89 rehydrated caches — where
// `kind` will simply be absent — still typecheck as a `RemoteTmuxSession`.
// Consumers reading `kind` treat `undefined` as `"harness"` per Phase 90
// PATTERNS.md § backward-compat rule.

import { describe, it, expect } from "vitest";
import type { RemoteTmuxSession } from "./sessions-api";

describe("sessions-api (Phase 90 Plan 01): RemoteTmuxSession widening", () => {
  // ─── Test 1: harness-only shape typechecks (no regression) ────────────────
  it("Test 1: accepts a canonical harness row with explicit kind: 'harness'", () => {
    // Every existing harness field stays present; the new `kind` marker
    // adds a discriminator without breaking any existing shape.
    const harness: RemoteTmuxSession = {
      kind: "harness",
      hostId: 1,
      hostName: "thenasty",
      sessionName: "tina",
      created: 1_700_000_000,
      role: "box-maintainer",
      lastMessageAt: 1_700_000_100,
      aiTitle: "Fix bug X",
    };
    expect(harness.kind).toBe("harness");
    expect(harness.hostId).toBe(1);
    expect(harness.sessionName).toBe("tina");
  });

  // ─── Test 2: relay-room shape typechecks (new kind='relay-room' branch) ──
  it("Test 2: accepts a canonical relay-room row with kind: 'relay-room' + relay fields", () => {
    // Relay-room rows carry a different identity axis (id + roomId, not
    // hostId + sessionName). Because the widening is flat-optional (not a
    // discriminated-union refactor), the harness-shape fields are simply
    // omitted at construction — the type allows this via `?`.
    const relayRoom: RemoteTmuxSession = {
      kind: "relay-room",
      // relay-only fields
      id: "sess-abc",
      roomId: "!abc:matrix.example",
      roomTitle: "Ashley + team",
      lastActivityAt: "2026-09-08T20:00:00Z",
      createdAt: "2026-09-08T10:00:00Z",
      updatedAt: "2026-09-08T20:00:00Z",
      // harness-shape fields: not applicable to a relay-room row — the flat
      // widening allows omission (they're not optional on the pre-widening
      // shape, but the widening intentionally does NOT tighten). For type-
      // level acceptance in the test we supply harmless zero-values that
      // downstream consumers never read when `kind === "relay-room"`.
      hostId: 0,
      hostName: "",
      sessionName: "",
      created: 0,
      role: null,
    };
    expect(relayRoom.kind).toBe("relay-room");
    expect(relayRoom.roomId).toBe("!abc:matrix.example");
    expect(relayRoom.roomTitle).toBe("Ashley + team");
  });

  // ─── Test 3: backward-compat — kind absent means harness ──────────────────
  it("Test 3: accepts a pre-Phase-89 shape with kind absent (backward-compat)", () => {
    // A rehydrated cache from a pre-Phase-89 client would deserialize into
    // an object with no `kind` field. This must still typecheck — the
    // widening leaves `kind` optional. Consumers treat undefined as
    // `"harness"` per PATTERNS.md § backward-compat rule.
    const legacy: RemoteTmuxSession = {
      hostId: 2,
      hostName: "workstation",
      sessionName: "nelly",
      created: 1_699_000_000,
      role: null,
    };
    expect(legacy.kind).toBeUndefined();
    // Backward-compat semantic: `kind ?? "harness"` yields "harness".
    const effectiveKind = legacy.kind ?? "harness";
    expect(effectiveKind).toBe("harness");
  });

  // ─── Test 4: mixed-list round-trip (harness + relay-room together) ────────
  it("Test 4: accepts a merged /sessions/list response with harness + relay-room rows", () => {
    // Mirrors what /sessions/list actually returns post-Phase-89: a flat
    // array containing rows of both kinds. Each element must satisfy the
    // widened `RemoteTmuxSession` type without a cast or assertion.
    const merged: RemoteTmuxSession[] = [
      {
        kind: "harness",
        hostId: 1,
        hostName: "thenasty",
        sessionName: "tina",
        created: 1_700_000_000,
        role: "box-maintainer",
        lastMessageAt: 1_700_000_100,
        aiTitle: null,
      },
      {
        kind: "relay-room",
        id: "sess-xyz",
        roomId: "!xyz:matrix.example",
        roomTitle: null,
        lastActivityAt: null,
        createdAt: "2026-09-08T10:00:00Z",
        updatedAt: "2026-09-08T20:00:00Z",
        // flat-widening zero-values for harness fields (see Test 2 comment)
        hostId: 0,
        hostName: "",
        sessionName: "",
        created: 0,
        role: null,
      },
    ];
    expect(merged.length).toBe(2);
    // Discriminator-switch pattern downstream consumers will use.
    const kinds = merged.map((s) => s.kind ?? "harness");
    expect(kinds).toEqual(["harness", "relay-room"]);
  });

  // ─── Test 5: kind field is optional at the type level ─────────────────────
  it("Test 5: kind is optional (undefined is a legal value)", () => {
    // Type-level assertion: an object literal that OMITS `kind` typechecks
    // as a valid RemoteTmuxSession. Enforced via runtime-safe TS assertion.
    const noKind: RemoteTmuxSession = {
      hostId: 3,
      hostName: "host3",
      sessionName: "sess3",
      created: 100,
      role: null,
    };
    // TS: if kind were required, `noKind.kind` would be `"harness" | "relay-room"`.
    // With optional, it's `"harness" | "relay-room" | undefined`.
    const k: "harness" | "relay-room" | undefined = noKind.kind;
    expect(k).toBeUndefined();
  });
});
